import { folderZip } from './assets/js/folder-archive.mjs';
import { makeZip } from './assets/vendor/client-zip.mjs';

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || url.pathname !== '/_rin-folder.zip' || event.request.method !== 'GET') return;
	event.respondWith(download(url.searchParams.get('path') || '', event.request.signal));
});

async function download(path, signal) {
	try {
		const { filename, stream } = await folderZip(path, makeZip, { signal });
		const encoded = encodeURIComponent(filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
		return new Response(stream, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': "attachment; filename*=UTF-8''" + encoded,
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (error) {
		return new Response(error.message || 'Could not start the folder download.', { status: 400 });
	}
}
