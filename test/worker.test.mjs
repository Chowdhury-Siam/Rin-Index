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

test('the folder link list is a private HTTP attachment with one direct URL per file', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?link-list');
	const folder = (id, name, parent) => ({ id, name, parents: [parent], mimeType: folderMimeType });
	const file = (name, parent, canDownload = true) => ({ name, parents: [parent], capabilities: { canDownload } });
	const unicodeName = '日本語 & Café "Notes"';
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') {
			assert.ok(url.searchParams.get('fields').split(',').includes('name'));
			return Response.json({ id: 'real-root', name: 'My Drive', mimeType: folderMimeType });
		}
		assert.equal(url.pathname, '/drive/v3/files');
		const query = url.searchParams.get('q');
		if (query.startsWith("'real-root' in parents")) {
			const folders = [folder('arc', 'ARC 01', 'real-root'), folder('unicode', unicodeName, 'real-root')];
			return Response.json({ files: folders.filter(item => query.includes(`name = '${item.name}'`)) });
		}
		assert.match(url.searchParams.get('fields'), /parents/);
		if (query.startsWith("('arc' in parents)")) {
			if (url.searchParams.get('pageToken') === 'next') {
				return Response.json({ files: [file('Episode 02.mkv', 'arc'), file('.Password', 'arc'), file('Blocked.txt', 'arc', false)] });
			}
			return Response.json({ files: [folder('extras', 'Extras', 'arc'), folder('empty', 'Empty', 'arc'), file('Episode & 01.mkv', 'arc')], nextPageToken: 'next' });
		}
		assert.match(query, /^\('extras' in parents or 'empty' in parents\)/);
		return Response.json({ files: [file('Subs #1.srt', 'extras')] });
	});
	const get = (path, headers, method = 'GET') => worker.fetch(new Request('https://index.test' + path, { headers, method }), env);
	const endpoint = '/0:/ARC%2001/?download=links';
	const headers = { Authorization: auth };
	assert.equal((await get(endpoint, {})).status, 401);
	assert.equal((await get('/0:/Missing/?download=links', headers)).status, 404);
	assert.equal((await get(endpoint, headers, 'POST')).status, 405);
	const head = await get(endpoint, headers, 'HEAD');
	const disposition = `attachment; filename="ARC 01.txt"; filename*=UTF-8''ARC%2001.txt`;
	assert.equal(head.headers.get('Content-Disposition'), disposition);
	assert.equal(head.body, null);
	const root = await get('/0:/?download=links', headers, 'HEAD');
	assert.equal(root.headers.get('Content-Disposition'), `attachment; filename="My Drive.txt"; filename*=UTF-8''My%20Drive.txt`);
	const unicode = await get('/0:/' + encodeURIComponent(unicodeName) + '/?download=links', headers, 'HEAD');
	assert.equal(unicode.headers.get('Content-Disposition'), `attachment; filename="___ & Cafe _Notes_.txt"; filename*=UTF-8''${encodeURIComponent('日本語 & Café _Notes_.txt')}`);
	const download = await get(endpoint, headers);
	assert.equal(download.status, 200);
	assert.equal(download.headers.get('Content-Type'), 'text/plain; charset=utf-8');
	assert.equal(download.headers.get('Content-Disposition'), disposition);
	assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(await download.text(), [
		'https://index.test/0:/ARC%2001/Episode%20%26%2001.mkv',
		'https://index.test/0:/ARC%2001/Episode%2002.mkv',
		'https://index.test/0:/ARC%2001/Extras/Subs%20%231.srt',
		''
	].join('\n'));
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

// Admin uploads.

const adminEnv = { ...env, ADMIN_PASSWORD: 'admin-pass' };
const adminAuth = 'Basic ' + Buffer.from('admin:admin-pass').toString('base64');
const SESSION_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=sess-1';

test('admin upload settings are optional and validated', () => {
	assert.equal(readSettings(env).ADMIN_USERNAME, 'admin');
	assert.equal(readSettings(env).ADMIN_PASSWORD, undefined);
	assert.equal(readSettings(adminEnv).ADMIN_PASSWORD, 'admin-pass');
	assert.equal(readSettings({ ...adminEnv, ADMIN_USERNAME: ' root ' }).ADMIN_USERNAME, 'root');
	assert.throws(() => readSettings({ ...adminEnv, ADMIN_USERNAME: 'not:valid' }), /ADMIN_USERNAME/);
	assert.equal(readSettings({ ...env, ADMIN_PASSWORD: '   ' }).ADMIN_PASSWORD, undefined);
});

test('uploads are refused without admin credentials', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-gate');
	let sessions = 0;
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname === '/upload/drive/v3/files') sessions++;
		if (url.pathname === '/drive/v3/files') return Response.json({ files: [] });
		assert.fail(`Unexpected request ${url}`);
	});
	const config = { ...env, INDEX_PASSWORD: '', ADMIN_PASSWORD: 'admin-pass' };
	const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), config);
	const start = {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'a.txt', size: 1, type: 'text/plain' })
	};

	const anonymous = await request('/0:/?upload=start', start);
	assert.equal(anonymous.status, 401);
	assert.match(anonymous.headers.get('WWW-Authenticate'), /^Basic realm="Rin Index admin"/);

	const viewer = await request('/0:/?upload=start', { ...start, headers: { ...start.headers, Authorization: auth } });
	assert.equal(viewer.status, 401);

	const wrongPassword = 'Basic ' + Buffer.from('admin:wrong').toString('base64');
	const wrong = await request('/0:/?upload=start', { ...start, headers: { ...start.headers, Authorization: wrongPassword } });
	assert.equal(wrong.status, 401);

	assert.equal((await request('/0:/?upload=whoami')).status, 401);
	assert.equal(sessions, 0);
});

test('uploads are disabled without an admin password', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-off');
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') return Response.json({ id: 'real-root', mimeType: folderMimeType });
		assert.fail(`Unexpected request ${url}`);
	});
	const response = await worker.fetch(new Request('https://index.test/0:/?upload=start', {
		method: 'POST',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'a.txt', size: 1 })
	}), env);
	assert.equal(response.status, 503);
	assert.match((await response.json()).error, /not configured/);
});

test('an admin starts a resumable upload into a nested folder and streams chunks', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-flow');
	t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname === '/upload/drive/v3/files' && options.method === 'POST') {
			assert.equal(url.searchParams.get('uploadType'), 'resumable');
			assert.equal(options.headers['X-Upload-Content-Length'], '11');
			assert.equal(options.headers['X-Upload-Content-Type'], 'video/x-matroska');
			assert.match(options.headers.Authorization, /^Bearer test-access$/);
			assert.deepEqual(JSON.parse(options.body), { name: 'Episode 01.mkv', parents: ['season1'] });
			return new Response(null, { status: 200, headers: { Location: SESSION_URL } });
		}
		if (url.pathname === '/upload/drive/v3/files') {
			assert.equal(url.searchParams.get('upload_id'), 'sess-1');
			assert.equal(options.method, 'PUT');
			assert.equal(typeof options.body?.getReader, 'function', 'chunks must stream through as a ReadableStream');
			const range = options.headers['Content-Range'];
			if (range === 'bytes 0-4/11') {
				assert.equal(await new Response(options.body).text(), 'Hello');
				return new Response(null, { status: 308, headers: { Range: 'bytes=0-4' } });
			}
			assert.equal(range, 'bytes 5-10/11');
			assert.equal(await new Response(options.body).text(), ' World');
			return Response.json({ id: 'new-file', name: 'Episode 01.mkv', size: '11' }, { status: 201 });
		}
		assert.equal(url.pathname, '/drive/v3/files');
		const query = url.searchParams.get('q');
		if (query.includes("name = 'Season 1'")) {
			return Response.json({ files: [{ id: 'season1', name: 'Season 1', mimeType: folderMimeType }] });
		}
		assert.fail(`Unexpected request ${url}`);
	});
	const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), adminEnv);
	const started = await request('/0:/Season%201/?upload=start', {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Episode 01.mkv', size: 11, type: 'video/x-matroska' })
	});
	assert.equal(started.status, 200);
	const startBody = await started.text();
	const session = JSON.parse(startBody);
	assert.equal(session.chunk_size, 16 * 1024 * 1024);
	assert.equal(session.max_chunk, 96 * 1024 * 1024);
	assert.equal(session.total, 11);
	assert.match(session.token, /^[A-Za-z0-9_-]+$/);
	assert.ok(!startBody.includes(SESSION_URL), 'session URL must stay sealed');
	assert.ok(!startBody.includes('test-access'), 'access token must not leak');
	assert.ok(!startBody.includes('admin-pass'), 'admin password must not leak');

	const first = await request('/0:/Season%201/?upload=chunk&u=' + encodeURIComponent(session.token) + '&offset=0&len=5', {
		method: 'PUT',
		headers: { Authorization: adminAuth },
		body: 'Hello'
	});
	assert.equal(first.status, 200);
	assert.deepEqual(await first.json(), { done: false, committed: 5 });

	const second = await request('/0:/Season%201/?upload=chunk&u=' + encodeURIComponent(session.token) + '&offset=5&len=6', {
		method: 'PUT',
		headers: { Authorization: adminAuth },
		body: ' World'
	});
	assert.equal(second.status, 200);
	assert.deepEqual(await second.json(), {
		done: true,
		committed: 11,
		file: { id: 'new-file', name: 'Episode 01.mkv', size: '11' }
	});
});

test('an interrupted upload resumes from the committed offset without a duplicate', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-resume');
	let sessions = 0;
	const total = 3 * 1024 * 1024;
	t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname === '/upload/drive/v3/files' && options.method === 'POST') {
			sessions++;
			return new Response(null, { status: 200, headers: { Location: SESSION_URL } });
		}
		if (url.pathname === '/upload/drive/v3/files') {
			const range = options.headers['Content-Range'];
			if (range === 'bytes */' + total) {
				assert.equal(options.body, undefined, 'status query sends no bytes');
				return new Response(null, { status: 308, headers: { Range: 'bytes=0-1048575' } });
			}
			if (range === 'bytes 1048576-3145727/' + total) return Response.json({ id: 'new-file' }, { status: 201 });
			if (range === 'bytes 1048576-2097151/' + total) return new Response(null, { status: 500 });
			assert.equal(range, 'bytes 0-1048575/' + total);
			return new Response(null, { status: 308, headers: { Range: 'bytes=0-1048575' } });
		}
		assert.equal(url.pathname, '/drive/v3/files');
		if (url.searchParams.get('q').includes("name = 'Season 1'")) {
			return Response.json({ files: [{ id: 'season1', name: 'Season 1', mimeType: folderMimeType }] });
		}
		assert.fail(`Unexpected request ${url}`);
	});
	const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), adminEnv);
	const started = await request('/0:/Season%201/?upload=start', {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Movie.mp4', size: total, type: 'video/mp4' })
	});
	const session = await started.json();
	const chunkUrl = (offset, len) => '/0:/Season%201/?upload=chunk&u=' + encodeURIComponent(session.token) + '&offset=' + offset + '&len=' + len;
	const auth = { Authorization: adminAuth };

	const first = await request(chunkUrl(0, 1024 * 1024), { method: 'PUT', headers: auth, body: 'a'.repeat(1024 * 1024) });
	assert.deepEqual(await first.json(), { done: false, committed: 1024 * 1024 });

	const failed = await request(chunkUrl(1024 * 1024, 1024 * 1024), { method: 'PUT', headers: auth, body: 'b'.repeat(1024 * 1024) });
	assert.equal(failed.status, 502);
	assert.equal((await failed.json()).retry, true);

	const status = await request('/0:/Season%201/?upload=status&u=' + encodeURIComponent(session.token), {
		method: 'POST',
		headers: auth
	});
	assert.equal(status.status, 200);
	assert.deepEqual(await status.json(), { done: false, committed: 1024 * 1024 });

	const rest = await request(chunkUrl(1024 * 1024, 2 * 1024 * 1024), { method: 'PUT', headers: auth, body: 'c'.repeat(2 * 1024 * 1024) });
	assert.equal((await rest.json()).done, true);

	assert.equal(sessions, 1, 'retrying must reuse the session, not create a second file');
});

test('chunk requests validate the declared length', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-len');
	let upstreamChunks = 0;
	t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname === '/upload/drive/v3/files' && options.method === 'POST') {
			return new Response(null, { status: 200, headers: { Location: SESSION_URL } });
		}
		if (url.pathname === '/upload/drive/v3/files') {
			upstreamChunks++;
			// Google rejects a body shorter than the declared Content-Range.
			return new Response(null, { status: 400 });
		}
		if (url.pathname === '/drive/v3/files') return Response.json({ files: [] });
		assert.fail(`Unexpected request ${url}`);
	});
	const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), adminEnv);
	const started = await request('/0:/?upload=start', {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'a.txt', size: 11, type: 'text/plain' })
	});
	const session = await started.json();
	const chunkUrl = (offset, len) => '/0:/?upload=chunk&u=' + encodeURIComponent(session.token) + '&offset=' + offset + '&len=' + len;
	const put = body => ({ method: 'PUT', headers: { Authorization: adminAuth }, body });

	assert.equal((await request(chunkUrl(0, 'abc'), put('Hello'))).status, 400);
	assert.equal((await request(chunkUrl(0, 500 * 1024 * 1024), put('Hello'))).status, 400);
	assert.equal((await request(chunkUrl(10, 5), put('Hello'))).status, 400);
	const mismatch = await request(chunkUrl(0, 5), put('abc'));
	assert.equal(mismatch.status, 502);
	assert.equal((await mismatch.json()).retry, true);
	assert.equal(upstreamChunks, 1, 'only the length-consistent chunk reaches Google');
});

test('upload destinations outside the index root are refused', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-destination');
	let sessions = 0;
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname === '/upload/drive/v3/files') sessions++;
		if (url.pathname === '/drive/v3/files') return Response.json({ files: [] });
		assert.fail(`Unexpected request ${url}`);
	});
	const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), adminEnv);
	const missing = await request('/0:/Missing/?upload=start', {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'a.txt', size: 1 })
	});
	assert.equal(missing.status, 404);
	assert.match((await missing.json()).error, /not found/);

	const filePage = await request('/0:/hello.txt?upload=start', {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'a.txt', size: 1 })
	});
	assert.equal(filePage.status, 400);
	assert.match((await filePage.json()).error, /folder page/);
	assert.equal(sessions, 0);
});

test('Drive write errors surface a clear message', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-forbidden');
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') return Response.json({ id: 'real-root', mimeType: folderMimeType });
		if (url.pathname === '/upload/drive/v3/files') return new Response(null, { status: 403 });
		if (url.pathname === '/drive/v3/files') return Response.json({ files: [] });
		assert.fail(`Unexpected request ${url}`);
	});
	const response = await worker.fetch(new Request('https://index.test/0:/?upload=start', {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'a.txt', size: 1 })
	}), adminEnv);
	assert.equal(response.status, 403);
	assert.match((await response.json()).error, /cannot create files/);
});

test('the admin pair browses a private index and core flows keep working with uploads enabled', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?uploads-core');
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname === '/drive/v3/files/root') {
			return Response.json({ id: 'real-root', name: 'My Drive', mimeType: folderMimeType });
		}
		if (url.pathname.endsWith('/files/file-id') && url.searchParams.get('alt') === 'media') {
			return new Response('hello');
		}
		assert.equal(url.pathname, '/drive/v3/files');
		const query = url.searchParams.get('q');
		if (query.includes("name = 'hello.txt'")) {
			return Response.json({ files: [{ id: 'file-id', name: 'hello.txt', mimeType: 'text/plain' }] });
		}
		return Response.json({ files: [{ id: 'file-id', name: 'hello.txt', mimeType: 'text/plain' }] });
	});
	const request = (path, options) => worker.fetch(new Request('https://index.test' + path, options), adminEnv);

	assert.equal((await request('/0:/')).status, 401);
	const adminPage = await request('/0:/', { headers: { Authorization: adminAuth } });
	assert.equal(adminPage.status, 200);
	const adminHtml = await adminPage.text();
	assert.match(adminHtml, /"can_upload":true/);
	assert.match(adminHtml, /"is_admin":true/);
	const viewerPage = await request('/0:/', { headers: { Authorization: auth } });
	const viewerHtml = await viewerPage.text();
	assert.match(viewerHtml, /"can_upload":true/);
	assert.match(viewerHtml, /"is_admin":false/);

	const listing = await request('/0:/', {
		method: 'POST',
		headers: { Authorization: adminAuth },
		body: new URLSearchParams({ page_index: '0' })
	});
	assert.equal(listing.status, 200);
	assert.equal((await listing.json()).data.files[0].name, 'hello.txt');

	const download = await request('/0:/hello.txt', { headers: { Authorization: adminAuth } });
	assert.equal(download.status, 200);
	assert.equal(await download.text(), 'hello');

	const links = await request('/0:/?download=links', { method: 'HEAD', headers: { Authorization: adminAuth } });
	assert.equal(links.status, 200);
	assert.match(links.headers.get('Content-Disposition'), /^attachment; filename="My Drive\.txt"/);
});
