import { crc32 } from 'node:zlib';

const localSize = 50;
const centralSize = 74;
const descriptorSize = 24;
const endSize = 98;
const max32 = 0xffffffff;

export function zipLength(entries) {
	let length = BigInt(endSize);
	for (const entry of entries) {
		if (entry.size === undefined) return undefined;
		length += entry.size + BigInt(localSize + centralSize + 2 * entry.name.byteLength +
			(entry.directory ? 0 : descriptorSize));
	}
	return length;
}

function dosDateTime(modifiedTime) {
	const date = new Date(modifiedTime);
	const year = date.getUTCFullYear();
	if (!(year >= 1980 && year <= 2107)) return 0x00210000;
	const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
	return (day << 16) | (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
}

// Store entries without compression. ZIP64 keeps sizes and offsets valid past 4 GiB.
function header(entry, offset, size = 0n, checksum = 0) {
	const central = offset !== undefined;
	const prefix = central ? 46 : 30;
	const extraSize = central ? 28 : 20;
	const bytes = new Uint8Array(prefix + entry.name.byteLength + extraSize);
	const view = new DataView(bytes.buffer);
	const flags = 0x0800 | (entry.directory ? 0 : 0x0008);
	const versionOffset = central ? 6 : 4;
	view.setUint32(0, central ? 0x02014b50 : 0x04034b50, true);
	if (central) view.setUint16(4, 45, true);
	view.setUint16(versionOffset, 45, true);
	view.setUint16(versionOffset + 2, flags, true);
	view.setUint32(versionOffset + 6, dosDateTime(entry.modifiedTime), true);
	view.setUint32(versionOffset + 10, checksum, true);
	view.setUint32(versionOffset + 14, max32, true);
	view.setUint32(versionOffset + 18, max32, true);
	view.setUint16(versionOffset + 22, entry.name.byteLength, true);
	view.setUint16(versionOffset + 24, extraSize, true);
	if (central) {
		view.setUint32(38, entry.directory ? 0x10 : 0, true);
		view.setUint32(42, max32, true);
	}
	bytes.set(entry.name, prefix);
	const extra = prefix + entry.name.byteLength;
	view.setUint16(extra, 1, true);
	view.setUint16(extra + 2, extraSize - 4, true);
	view.setBigUint64(extra + 4, size, true);
	view.setBigUint64(extra + 12, size, true);
	if (central) view.setBigUint64(extra + 20, offset, true);
	return bytes;
}

function descriptor(checksum, size) {
	const bytes = new Uint8Array(descriptorSize);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x08074b50, true);
	view.setUint32(4, checksum, true);
	view.setBigUint64(8, size, true);
	view.setBigUint64(16, size, true);
	return bytes;
}

function endRecords(count, start, length) {
	const bytes = new Uint8Array(endSize);
	const view = new DataView(bytes.buffer);
	// ZIP64 end record, locator, then the classic end record.
	view.setUint32(0, 0x06064b50, true);
	view.setBigUint64(4, 44n, true);
	view.setUint16(12, 45, true);
	view.setUint16(14, 45, true);
	view.setBigUint64(24, count, true);
	view.setBigUint64(32, count, true);
	view.setBigUint64(40, length, true);
	view.setBigUint64(48, start, true);
	view.setUint32(56, 0x07064b50, true);
	view.setBigUint64(64, start + length, true);
	view.setUint32(72, 1, true);
	view.setUint32(76, 0x06054b50, true);
	view.setUint16(84, 0xffff, true);
	view.setUint16(86, 0xffff, true);
	view.setUint32(88, max32, true);
	view.setUint32(92, max32, true);
	return bytes;
}

export function zipStream(entries, openFile, requestSignal) {
	const abort = new AbortController();
	const signal = requestSignal ? AbortSignal.any([abort.signal, requestSignal]) : abort.signal;

	async function* bytes() {
		const central = [];
		let offset = 0n;
		for (const entry of entries) {
			signal.throwIfAborted();
			let size = 0n;
			let checksum = 0;
			const local = header(entry);
			yield local;
			if (!entry.directory) {
				for await (const chunk of await openFile(entry, signal)) {
					checksum = crc32(chunk, checksum);
					size += BigInt(chunk.byteLength);
					yield chunk;
				}
				if (entry.size !== undefined && entry.size !== size) throw new Error('A Drive file changed during the download.');
				yield descriptor(checksum, size);
			}
			central.push(header(entry, offset, size, checksum));
			offset += BigInt(local.byteLength + (entry.directory ? 0 : descriptorSize)) + size;
		}

		let centralLength = 0n;
		for (const record of central) {
			centralLength += BigInt(record.byteLength);
			yield record;
		}
		yield endRecords(BigInt(central.length), offset, centralLength);
	}

	const iterator = bytes();
	return new ReadableStream({
		async pull(controller) {
			const { done, value } = await iterator.next();
			if (done) controller.close();
			else controller.enqueue(value);
		},
		async cancel(reason) {
			abort.abort(reason);
			await iterator.return();
		}
	});
}
