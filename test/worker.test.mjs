import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSettings } from '../worker/settings.mjs';

const env = {
	GOOGLE_CLIENT_ID: 'test-client',
	GOOGLE_CLIENT_SECRET: 'test-secret',
	GOOGLE_REFRESH_TOKEN: 'test-refresh',
	DRIVE_ROOT_ID: 'root',
	INDEX_PASSWORD: 'test:password'
};
const auth = 'Basic ' + Buffer.from('viewer:test:password').toString('base64');

test('configuration requires a root and makes password protection optional', () => {
	assert.throws(() => readSettings({ ...env, DRIVE_ROOT_ID: '' }), /DRIVE_ROOT_ID/);
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
		if (url.pathname.endsWith('/root')) return Response.json({ id: 'real-root' });
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
		if (url.pathname.endsWith('/root')) return Response.json({ id: 'real-root' });
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

test('a public folder can be listed without a password', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?public-test');
	t.mock.method(globalThis, 'fetch', async url => {
		url = new URL(url);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-access' });
		if (url.pathname.endsWith('/root')) return Response.json({ id: 'real-root' });
		if (url.pathname.endsWith('/drives/folder-id')) return Response.json({}, { status: 404 });
		if (url.pathname.endsWith('/files')) {
			assert.match(url.searchParams.get('q'), /'folder-id' in parents/);
			return Response.json({ files: [] });
		}
		assert.fail(`Unexpected request ${url}`);
	});
	const publicEnv = {
		...env, DRIVE_ROOT_ID: 'folder-id', INDEX_PASSWORD: ''
	};
	const url = 'https://index.test/0:/';
	const response = await worker.fetch(new Request(url), publicEnv);
	assert.equal(response.status, 200);
	assert.match(await response.text(), /"root_type":2/);
	const listing = await worker.fetch(new Request(url, {
		method: 'POST', body: new URLSearchParams({ page_index: '0' })
	}), publicEnv);
	assert.deepEqual((await listing.json()).data.files, []);
});
