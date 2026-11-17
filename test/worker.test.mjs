import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderMimeType, readSettings } from '../worker/settings.mjs';

const env = {
	GOOGLE_CLIENT_ID: 'test-client',
	GOOGLE_CLIENT_SECRET: 'test-secret',
	GOOGLE_REFRESH_TOKEN: 'test-refresh',
	DRIVE_ROOT_ID: 'root',
	INDEX_PASSWORD: 'test:password'
};
const auth = 'Basic ' + Buffer.from('viewer:test:password').toString('base64');

test('configuration requires a root and makes password protection optional', () => {
	assert.throws(() => readSettings({ ...env, DRIVE_ROOT_ID: '' }), /DRIVE_ID/);
	assert.throws(() => readSettings({ ...env, DRIVE_ID: 'not/a/folder/id' }), /DRIVE_ID/);
	assert.equal(readSettings(env).DRIVE_ID, 'root');
	assert.equal(readSettings({ ...env, DRIVE_ID: '  folder-id  ' }).DRIVE_ID, 'folder-id');
	assert.equal(readSettings(env).INDEX_USERNAME, 'viewer');
	assert.equal(readSettings(env).SITE_NAME, 'Rin Index');
	assert.equal(readSettings(env).PROTECT_FILE_LINK, 'false');
	assert.equal(readSettings({ ...env, INDEX_PASSWORD: '' }).INDEX_PUBLIC, 'true');
	assert.throws(() => readSettings({
		...env, INDEX_PASSWORD: '', PROTECT_FILE_LINK: 'true'
	}), /INDEX_PASSWORD/);
	assert.equal(readSettings({ ...env, INDEX_PUBLIC: 'true' }).INDEX_PASSWORD, undefined);
});

test('opt-in download protection requires the index password', async t => {
	const { default: worker } = await import('../worker/worker-beta.js');
	const calls = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		url = new URL(url);
		calls.push(url);
		if (url.hostname === 'oauth2.googleapis.com') {
			assert.equal(options.body.get('refresh_token'), 'test-refresh');
			return Response.json({ access_token: 'test-access', expires_in: 3600 });
		}
		assert.equal(options.headers.authorization, 'Bearer test-access');
		if (url.pathname.endsWith('/root')) return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname.endsWith('/files')) {
			assert.match(url.searchParams.get('q'), /'root' in parents/);
			return Response.json({ files: [{ id: 'file-id', name: 'hello & goodbye.html' }] });
		}
		if (url.pathname.endsWith('/file-id')) {
			assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
			assert.equal(options.headers.Range, 'bytes=0-2');
			return new Response('<h1', { status: 206, headers: { 'Content-Type': 'text/html' } });
		}
		assert.fail(`Unexpected request ${url}`);
	});
	const protectedEnv = { ...env, PROTECT_FILE_LINK: 'true' };
	const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), protectedEnv);
	const filePath = '/0:/hello%20%26%20goodbye.html?inline=true';

	assert.equal((await request('/')).headers.get('Location'), 'https://index.test/0:/');
	for (const path of ['/0:/', '/0:search', filePath]) {
		const denied = await request(path);
		assert.equal(denied.status, 401);
		assert.match(denied.headers.get('WWW-Authenticate'), /^Basic /);
	}
	assert.equal(calls.length, 0);

	const page = await request('/0:/', { headers: { Authorization: auth } });
	assert.equal(page.status, 200);
	const html = await page.text();
	assert.match(html, /<title>Rin Index<\/title>/);
	assert.match(html, /href="\/assets\/css\/rin-index\.css"/);
	assert.match(html, /src="\/assets\/js\/app\.js"/);
	const listing = await request('/0:/', {
		method: 'POST',
		headers: { Authorization: auth },
		body: new URLSearchParams({ page_index: '0' })
	});
	assert.equal((await listing.json()).data.files[0].name, 'hello & goodbye.html');
	const download = await request(filePath, { headers: { Authorization: auth, Range: 'bytes=0-2' } });
	assert.equal(download.status, 206);
	assert.match(download.headers.get('Content-Disposition'), /^attachment;.*hello%20%26%20goodbye.html/);
	assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(await download.text(), '<h1');
	assert.equal(calls.filter(url => url.hostname === 'oauth2.googleapis.com').length, 1);
});

test('direct downloads work without the password by default', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?default-links');
	t.mock.method(globalThis, 'fetch', async url => {
		url = new URL(url);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname.endsWith('/root')) return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname.endsWith('/files')) {
			return Response.json({ files: [{ id: 'file-id', name: 'hello.txt' }] });
		}
		if (url.pathname.endsWith('/file-id')) return new Response('hello');
		assert.fail(`Unexpected request ${url}`);
	});

	const request = path => worker.fetch(new Request('https://index.test' + path), env);
	assert.equal((await request('/0:/')).status, 401);
	assert.equal((await request('/0:/hello.txt?a=view')).status, 401);
	const download = await request('/0:/hello.txt');
	assert.equal(download.status, 200);
	assert.equal(await download.text(), 'hello');
});

test('Workspace exports and Drive shortcuts download individually', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?workspace-downloads');
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname.endsWith('/root')) return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname.endsWith('/files')) {
			const query = url.searchParams.get('q');
			const file = query.includes("name = 'Document'")
				? { id: 'doc-id', name: 'Document', mimeType: 'application/vnd.google-apps.document' }
				: { id: 'shortcut-id', name: 'Shortcut', mimeType: 'application/vnd.google-apps.shortcut' };
			return Response.json({ files: [file] });
		}
		assert.equal(url.pathname, '/drive/v3/files/doc-id/export');
		assert.equal(url.searchParams.get('mimeType'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		return new Response('exported document');
	});
	const get = name => worker.fetch(new Request('https://index.test/0:/' + name), env);
	const exported = await get('Document');
	assert.equal(exported.headers.get('Content-Disposition'), "attachment; filename*=UTF-8''Document.docx");
	assert.equal(await exported.text(), 'exported document');
	const shortcut = await get('Shortcut');
	assert.equal(shortcut.headers.get('Content-Disposition'), "attachment; filename*=UTF-8''Shortcut.url");
	assert.match(await shortcut.text(), /drive\.google\.com\/open\?id=shortcut-id/);
});

const rootCases = [
	{ name: 'a My Drive folder', parents: ['parent-id'], rootType: 2 },
	{ name: 'a shared folder when My Drive is unavailable', unavailableMyDrive: true, rootType: 2 },
	{ name: 'a folder inside a Shared Drive', driveId: 'shared-drive', parents: ['parent-id'], rootType: 2 },
	{ name: 'a whole Shared Drive', driveId: 'folder-id', rootType: 1 },
	{ name: 'the actual My Drive root ID', myDriveRoot: true, rootType: 0 }
];

for (const { name, driveId, parents, myDriveRoot, unavailableMyDrive, rootType } of rootCases) {
	test(`DRIVE_ID exposes ${name} at the index root`, async t => {
		const { default: worker } = await import(`../worker/worker-beta.js?root=${encodeURIComponent(name)}`);
		const folder = { id: 'folder-id', mimeType: folderMimeType, driveId, parents };
		const file = { id: 'file-id', name: 'ARC 01.zip', mimeType: 'application/zip', size: '3' };
		const subfolder = { id: 'subfolder-id', name: 'Subfolder', mimeType: folderMimeType };
		t.mock.method(globalThis, 'fetch', async input => {
			const url = new URL(input);
			if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
			assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
			if (url.pathname.endsWith('/files/folder-id')) return Response.json(folder);
			if (myDriveRoot && url.pathname.endsWith('/files/root')) return Response.json(folder);
			if (unavailableMyDrive && url.pathname.endsWith('/files/root')) return new Response(null, { status: 404 });
			if (url.pathname.endsWith('/files/file-id')) {
				if (url.searchParams.get('alt') === 'media') return new Response('zip');
				return Response.json({ ...file, parents: ['folder-id'] });
			}
			assert.equal(url.pathname, '/drive/v3/files');
			assert.equal(url.searchParams.get('includeItemsFromAllDrives'), 'true');
			assert.equal(url.searchParams.get('corpora'), rootType === 1 ? 'drive' : 'user');
			assert.equal(url.searchParams.get('driveId'), rootType === 1 ? driveId : null);
			const query = url.searchParams.get('q');
			if (query.startsWith("'subfolder-id' in parents")) return Response.json({ files: [] });
			assert.match(query, /^'folder-id' in parents/);
			if (query.includes("name = 'Subfolder'")) return Response.json({ files: [subfolder] });
			if (query.includes("name = 'ARC 01.zip'")) return Response.json({ files: [file] });
			return Response.json({ files: [subfolder, file] });
		});
		const config = { ...env, DRIVE_ID: 'folder-id', INDEX_PASSWORD: '' };
		const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), config);
		const post = fields => ({ method: 'POST', body: new URLSearchParams(fields) });
		const page = await request('/0:/');
		assert.equal(page.status, 200);
		assert.match(await page.text(), new RegExp(`"root_type":${rootType}`));
		const listing = await request('/0:/', post({ page_index: '0' }));
		assert.deepEqual((await listing.json()).data.files, [subfolder, file]);
		const nested = await request('/0:/Subfolder/', post({ page_index: '0' }));
		assert.deepEqual((await nested.json()).data.files, []);
		const link = await request('/0:id2path', post({ id: file.id }));
		assert.equal(await link.text(), '/ARC%2001.zip');
		const download = await request('/0:/ARC%2001.zip');
		assert.equal(download.status, 200);
		assert.equal(await download.text(), 'zip');
		const oldFolderLink = await request('/0:/?download=zip');
		assert.equal(oldFolderLink.status, 200);
		assert.match(oldFolderLink.headers.get('Content-Type'), /^text\/html/);
	});
}
