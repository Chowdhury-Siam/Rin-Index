export async function archiveKey(settings, folderId) {
	const scope = JSON.stringify([settings.DRIVE_ROOT_ID, settings.GOOGLE_REFRESH_TOKEN, folderId]);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
	return 'archives/' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function byteRange(value, size) {
	const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
	if (!match || !(match[1] || match[2])) return undefined;
	const total = BigInt(size);
	const offset = match[1] ? BigInt(match[1]) : total - BigInt(match[2]);
	const stop = match[1] && match[2] ? BigInt(match[2]) + 1n : total;
	const start = offset < 0n ? 0n : offset;
	const end = stop < total ? stop : total;
	if (start >= end) return null;
	return { offset: Number(start), length: Number(end - start) };
}

export async function storedArchive(request, bucket, key, headers) {
	const pointer = await bucket.head(key + '/current');
	if (!pointer) return null;
	const version = pointer.customMetadata?.version;
	if (!/^[a-f0-9-]{36}$/.test(version || '')) return null;
	const source = key + '/' + version + '.zip';
	const info = await bucket.head(source);
	if (!info) return null;
	const modified = info.uploaded.toUTCString();
	headers.set('Accept-Ranges', 'bytes');
	headers.set('ETag', info.httpEtag);
	headers.set('Last-Modified', modified);
	headers.set('Content-Length', String(info.size));
	if (request.method === 'HEAD') return new Response(null, { headers });

	const ifRange = request.headers.get('If-Range');
	const range = !ifRange || ifRange === info.httpEtag || ifRange === modified
		? byteRange(request.headers.get('Range') || '', info.size) : undefined;
	if (range === null) {
		headers.set('Content-Length', '0');
		headers.set('Content-Range', 'bytes */' + info.size);
		return new Response(null, { status: 416, headers });
	}
	const object = await bucket.get(source, { range, onlyIf: { etagMatches: info.etag } });
	if (!object?.body) {
		return new Response('The folder ZIP changed. Start the download again.', {
			status: 503, headers: { 'Retry-After': '1' }
		});
	}
	if (range) {
		headers.set('Content-Length', String(range.length));
		headers.set('Content-Range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + info.size);
	}
	let body = object.body;
	if (typeof FixedLengthStream === 'function') {
		const fixed = new FixedLengthStream(range ? range.length : info.size);
		body.pipeTo(fixed.writable).catch(() => {});
		body = fixed.readable;
	}
	return new Response(body, { headers, status: range ? 206 : 200, encodeBody: 'manual' });
}
