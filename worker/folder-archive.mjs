import { folderMimeType } from './settings.mjs';

const idPattern = /^[A-Za-z0-9_-]+$/;
const googleMime = 'application/vnd.google-apps.';
const officeMime = 'application/vnd.openxmlformats-officedocument.';
const exportsByType = {
	document: [officeMime + 'wordprocessingml.document', '.docx'],
	spreadsheet: [officeMime + 'spreadsheetml.sheet', '.xlsx'],
	presentation: [officeMime + 'presentationml.presentation', '.pptx'],
	drawing: ['application/pdf', '.pdf'],
	script: [googleMime + 'script+json', '.json']
};

export async function folderArchive(request, drive, path) {
	let args;
	try {
		args = await request.json();
	} catch {
		return new Response('Invalid folder download request.', { status: 400 });
	}
	if (!args || typeof args !== 'object') return new Response('Invalid folder download request.', { status: 400 });

	if (args.action === 'start') {
		const id = await drive.findPathId(path);
		if (!id) return new Response('Folder not found.', { status: 404 });
		const name = path === '/' ? drive.root.name : decodeURIComponent(path.split('/').at(-2));
		return Response.json({ id, name });
	}

	const { id, action, pageToken } = args;
	if (typeof id !== 'string' || !idPattern.test(id) ||
		(action !== 'list' && action !== 'file') ||
		(pageToken != null && typeof pageToken !== 'string')) {
		return new Response('Invalid folder download request.', { status: 400 });
	}

	const rootId = drive.root.id;
	let file;
	if (id === rootId || (rootId === 'root' && id === drive.authConfig.user_drive_real_root_id)) {
		file = { id, mimeType: folderMimeType };
	} else {
		const chain = await drive.findParentFilesRecursion(id);
		if (!chain?.length || chain.some(parent => parent.trashed || parent.name?.toLowerCase() === '.password')) {
			return new Response('Item not found in this index.', { status: 404 });
		}
		[file] = chain;
	}

	if (action === 'list' && file.mimeType === folderMimeType) {
		const result = await drive._ls(id, pageToken);
		if (!Array.isArray(result?.data?.files)) return new Response('Google Drive could not list this folder.', { status: 502 });
		return Response.json({
			files: result.data.files.filter(entry => entry.name.toLowerCase() !== '.password'),
			pageToken: result.nextPageToken
		});
	}
	if (action === 'file' && file.mimeType !== folderMimeType) return archiveFile(request, drive, file);
	return new Response('Item type does not match the request.', { status: 400 });
}

async function archiveFile(request, drive, file) {
	if (file.capabilities?.canDownload === false) return new Response('Google Drive restricts downloads for this file.', { status: 403 });
	const type = file.mimeType || '';
	if (!type.startsWith(googleMime)) {
		const response = await drive.down(file, null, false, request.signal);
		if (response.ok) return response;
		await response.body?.cancel();
		return new Response('Google Drive could not download this file.', { status: 502 });
	}

	const key = type.slice(googleMime.length);
	const format = Object.hasOwn(exportsByType, key) ? exportsByType[key] : undefined;
	if (!format) {
		return new Response(`[InternetShortcut]\r\nURL=https://drive.google.com/open?id=${file.id}\r\n`, {
			headers: { 'X-Rin-Archive-Extension': '.url' }
		});
	}

	const [mimeType, extension] = format;
	const url = new URL(`https://www.googleapis.com/drive/v3/files/${file.id}/export`);
	url.searchParams.set('mimeType', mimeType);
	const options = await drive.requestOption();
	const response = await fetch(url, { ...options, signal: request.signal });
	if (!response.ok) {
		await response.body?.cancel();
		return new Response('Google Drive could not export this file.', { status: 502 });
	}
	return new Response(response.body, {
		headers: {
			'Content-Type': mimeType,
			'X-Rin-Archive-Extension': extension
		}
	});
}
