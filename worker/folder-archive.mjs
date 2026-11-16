import { folderMimeType } from './settings.mjs';
import { zipLength, zipStream } from './zip.mjs';
import { archiveKey, storedArchive } from './stored-archive.mjs';

const googleMime = 'application/vnd.google-apps.';
const officeMime = 'application/vnd.openxmlformats-officedocument.';
const encoder = new TextEncoder();
const exportsByType = new Map([
	['document', [officeMime + 'wordprocessingml.document', '.docx']],
	['spreadsheet', [officeMime + 'spreadsheetml.sheet', '.xlsx']],
	['presentation', [officeMime + 'presentationml.presentation', '.pptx']],
	['drawing', ['application/pdf', '.pdf']],
	['script', [googleMime + 'script+json', '.json']]
]);

function safeName(name) {
	const safe = name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[ ]+|[. ]+$/g, '');
	return /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(safe) ? '_' + safe : safe || '_';
}

function uniqueName(name, used) {
	const safe = safeName(name);
	const dot = safe.lastIndexOf('.');
	const stem = dot > 0 ? safe.slice(0, dot) : safe;
	const extension = dot > 0 ? safe.slice(dot) : '';
	let candidate = safe;
	for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
		candidate = stem + ' (' + suffix + ')' + extension;
	}
	used.add(candidate.toLowerCase());
	return candidate;
}

function fileDetails(file) {
	const type = file.mimeType || '';
	if (type === folderMimeType) return { directory: true, extension: '', size: 0n };
	if (type.startsWith(googleMime)) {
		const format = exportsByType.get(type.slice(googleMime.length));
		if (format) return { mimeType: format[0], extension: format[1] };
		const content = encoder.encode('[InternetShortcut]\r\nURL=https://drive.google.com/open?id='
			+ encodeURIComponent(file.id) + '\r\n');
		return { extension: '.url', content, size: BigInt(content.byteLength) };
	}
	return { extension: '', size: /^\d+$/.test(file.size ?? '') ? BigInt(file.size) : undefined };
}

async function archiveEntries(drive, id, root, signal) {
	const entries = [{ name: encoder.encode(root + '/'), directory: true, size: 0n }];
	async function walk(folderId, prefix) {
		const used = new Set();
		let pageToken = null;
		do {
			signal.throwIfAborted();
			const result = await drive._ls(folderId, pageToken, 0, 1000);
			if (!Array.isArray(result?.data?.files)) throw new Error('Google Drive could not list the folder.');
			for (const file of result.data.files) {
				if (file.name.toLowerCase() === '.password') continue;
				const details = fileDetails(file);
				if (!details.directory && !details.content && file.capabilities?.canDownload === false) {
					throw new Error('Google Drive restricts downloads for ' + file.name + '.');
				}
				const path = prefix + uniqueName(file.name + details.extension, used) + (details.directory ? '/' : '');
				const name = encoder.encode(path);
				if (name.byteLength > 0xffff) throw new Error('A file path is too long for ZIP.');
				entries.push({ ...details, name, file, modifiedTime: file.modifiedTime });
				if (details.directory) await walk(file.id, path);
			}
			pageToken = result.nextPageToken;
		} while (pageToken);
	}
	await walk(id, root + '/');
	return entries;
}

async function openFile(drive, entry, signal) {
	if (entry.content) return [entry.content];
	let response;
	if (entry.mimeType) {
		const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.file.id)}/export`);
		url.searchParams.set('mimeType', entry.mimeType);
		const options = await drive.requestOption({ 'Accept-Encoding': 'identity' });
		response = await fetch(url, { ...options, signal });
	} else {
		response = await drive.down(entry.file, null, false, signal);
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error('Google Drive could not download ' + entry.file.name + '.');
	}
	return response.body ?? [];
}

async function findFolder(drive, path) {
	// Resolve from the configured root on each request so a shared link cannot follow a moved folder.
	let id = drive.root.id;
	const names = path.split('/').filter(Boolean);
	for (const name of names) {
		if (decodeURIComponent(name).toLowerCase() === '.password') return null;
		id = await drive._findDirId(id, name);
		if (!id) return null;
	}
	const root = safeName(names.length ? decodeURIComponent(names.at(-1)) : drive.root.name);
	return { id, root };
}

function archiveHeaders(root) {
	const encoded = encodeURIComponent(root + '.zip').replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
	const asciiName = root.replace(/[^\x20-\x7e]/g, '_') + '.zip';
	return new Headers({
		'Content-Type': 'application/zip',
		'Content-Disposition': 'attachment; filename="' + asciiName + "\"; filename*=UTF-8''" + encoded,
		'Accept-Ranges': 'none'
	});
}

async function liveArchive(request, drive, { id, root }, headers, includeLength = false) {
	const entries = await archiveEntries(drive, id, root, request.signal);
	if (includeLength) {
		const length = zipLength(entries);
		if (length !== undefined) headers.set('Content-Length', length.toString());
	}
	if (request.method === 'HEAD') return new Response(null, { headers });

	// A known response length makes aria2 split live ZIPs even with Accept-Ranges: none.
	const body = zipStream(entries, (entry, signal) => openFile(drive, entry, signal), request.signal);
	return new Response(body, { headers, encodeBody: 'manual' });
}

export async function folderArchive(request, drive, path, bucket) {
	const folder = await findFolder(drive, path);
	if (!folder) return new Response('Folder not found.', { status: 404 });
	const headers = archiveHeaders(folder.root);
	if (bucket) {
		const key = await archiveKey(drive.authConfig.settings, folder.id);
		const stored = await storedArchive(request, bucket, key, headers);
		if (stored) return stored;
	}
	try {
		return await liveArchive(request, drive, folder, headers);
	} catch (error) {
		return new Response(error.message || 'Could not prepare the folder ZIP.', { status: 502 });
	}
}

export async function prepareArchive(request, drive, path) {
	const folder = await findFolder(drive, path);
	if (!folder) throw new Error('Folder not found in this Drive index.');
	const key = await archiveKey(drive.authConfig.settings, folder.id);
	const response = await liveArchive(request, drive, folder, archiveHeaders(folder.root), true);
	return { key, response };
}

