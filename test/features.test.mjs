/**
 * Tests for the v6 listing features: requested orderings, structured search
 * filters (type: / size:), and the row-thumbnail proxy that keeps the OAuth
 * token inside the Worker.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeDrive } from '../test-support/fake-drive.mjs';

const env = {
	GOOGLE_CLIENT_ID: 'test-client',
	GOOGLE_CLIENT_SECRET: 'test-secret',
	GOOGLE_REFRESH_TOKEN: 'test-refresh',
	DRIVE_ROOT_ID: 'root',
	INDEX_PASSWORD: 'test:password'
};
const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const auth = basic('viewer', 'test:password');
const adminEnv = { ...env, ADMIN_PASSWORD: 'admin-pass' };
const adminAuth = basic('admin', 'admin-pass');
const publicEnv = { ...env, INDEX_PASSWORD: undefined, INDEX_PUBLIC: 'true' };
let counter = 0;

/**
 * A fresh Worker in front of a seeded fake Drive. The root holds "Season 1"
 * (a folder), "Notes.md" (120 B), "poster.png" (an image Drive can render),
 * and "plain.jpg" (an image with no thumbnail).
 */
async function setup(t, { workerEnv = adminEnv } = {}) {
	const drive = createFakeDrive().seed();
	drive.file('poster.png', ['root'], { size: '482133', mimeType: 'image/png', thumbnailLink: 'https://lh3.googleusercontent.com/poster=s220' });
	drive.file('plain.jpg', ['root'], { size: '1000', mimeType: 'image/jpeg' });
	t.mock.method(globalThis, 'fetch', drive.fetch);
	const { default: worker } = await import(`../worker/worker-beta.js?features-${counter++}`);
	const post = async (path, form, authorization = adminAuth) => {
		const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
		if (authorization) headers.Authorization = authorization;
		const response = await worker.fetch(new Request('https://index.test' + path, { method: 'POST', headers, body: new URLSearchParams(form) }), workerEnv);
		return response.json();
	};
	return {
		drive,
		worker,
		request: (path, { method, headers = {} } = {}) => worker.fetch(new Request('https://index.test' + path, {
			method: method || 'GET',
			headers: { Authorization: adminAuth, ...headers }
		}), workerEnv),
		list: (path = '/0:/', { sort, dir, authorization = adminAuth, page = 0 } = {}) =>
			post(path, {
				page_index: String(page),
				...(sort ? { sort } : {}),
				...(dir ? { dir } : {})
			}, authorization),
		search: (q, authorization = adminAuth, page = 0) => post('/0:search', { q, page_index: String(page) }, authorization),
		lastList: () => drive.calls.filter(call => call.kind === 'files.list').at(-1),
		// The root resolution also uses files.list; a folder listing is the
		// query that names a parent and excludes .password.
		listingCount: () => drive.calls.filter(call => call.kind === 'files.list'
			&& String(call.query.get('q') || '').includes("name !='.password'")).length
	};
}

test('a listing can be ordered by name, size, or date', async t => {
	const { list, lastList } = await setup(t);
	const bySize = (await list('/0:/', { sort: 'size', dir: 'desc' })).data.files.map(file => file.name);
	assert.equal(lastList().query.get('orderBy'), 'folder,size desc');
	// Folders lead; among files the largest comes first.
	assert.deepEqual(bySize, ['Season 1', 'poster.png', 'plain.jpg', 'Notes.md']);

	const byName = (await list('/0:/', { sort: 'name', dir: 'asc' })).data.files.map(file => file.name);
	assert.equal(lastList().query.get('orderBy'), 'folder,name');
	assert.deepEqual(byName, ['Season 1', 'Notes.md', 'plain.jpg', 'poster.png']);

	const byNameDesc = (await list('/0:/', { sort: 'name', dir: 'desc' })).data.files.map(file => file.name);
	assert.equal(lastList().query.get('orderBy'), 'folder,name desc');
	assert.deepEqual(byNameDesc, ['Season 1', 'poster.png', 'plain.jpg', 'Notes.md']);

	const byAge = (await list('/0:/', { sort: 'modifiedTime', dir: 'asc' })).data.files.map(file => file.name);
	assert.equal(lastList().query.get('orderBy'), 'folder,modifiedTime');
	assert.deepEqual(byAge, ['Season 1', 'Notes.md', 'plain.jpg', 'poster.png']);
});

test('an unknown or missing sort keeps the historic default ordering', async t => {
	const { drive, list, lastList } = await setup(t);
	await list('/0:/');
	assert.equal(lastList().query.get('orderBy'), 'folder,name,modifiedTime desc');
	await list('/0:/', { sort: 'name;drop table', dir: 'desc' });
	assert.equal(lastList().query.get('orderBy'), 'folder,name,modifiedTime desc', 'unrecognized values change nothing');
	// The page that lists a folder to crawl it (Download files) sends no sort
	// and lands on the same default.
	await list('/0:/Season%201/');
	assert.equal(lastList().query.get('orderBy'), 'folder,name,modifiedTime desc');
});

test('one ordering per cache slot: the same sort reuses the listing, a different one refetches', async t => {
	const { listingCount, list } = await setup(t);
	await list('/0:/', { sort: 'size', dir: 'desc' });
	await list('/0:/', { sort: 'size', dir: 'desc' });
	assert.equal(listingCount(), 1, 'the same ordering is served from the cache');
	await list('/0:/', { sort: 'name', dir: 'asc' });
	assert.equal(listingCount(), 2, 'a different ordering is its own listing');
	// A page without a sort is yet another slot, and stays consistent.
	await list('/0:/');
	await list('/0:/');
	assert.equal(listingCount(), 3);
});

test('single-page folders are cached too, so repeat visits skip Drive', async t => {
	const { listingCount, list } = await setup(t);
	await list('/0:/');
	await list('/0:/');
	await list('/0:/');
	assert.equal(listingCount(), 1, 'one page, one Drive call, however often it is read');
});

test('type: and size: tokens become Drive clauses and the plain words stay name matches', async t => {
	const { search, lastList } = await setup(t);
	await search('holiday type:video size:>100mb');
	const query = lastList().query.get('q');
	assert.match(query, /name contains 'holiday'/);
	assert.match(query, /mimeType contains 'video\//);
	assert.match(query, /size > 104857600/);
	assert.doesNotMatch(query, /type:/, 'the token itself never reaches Drive as a name word');
	assert.doesNotMatch(query, /size:/);
});

test('filters alone run a search, and unknown tokens fall back to name words', async t => {
	const { search, lastList } = await setup(t);
	const images = (await search('type:image')).data.files.map(file => file.name);
	assert.deepEqual(images, ['plain.jpg', 'poster.png']);
	assert.doesNotMatch(lastList().query.get('q'), /name contains/);

	// "banana" is not a known kind, so it stays a plain keyword; the historic
	// sanitizer strips the colon from it, exactly as it always did.
	const none = (await search('type:banana')).data.files.map(file => file.name);
	assert.deepEqual(none, [], 'nothing is named typebanana');
	assert.match(lastList().query.get('q'), /name contains 'typebanana'/);
});

test('a size ceiling and unit suffixes parse to the right bytes', async t => {
	const { search, lastList } = await setup(t);
	await search('size:<500b');
	assert.match(lastList().query.get('q'), /size < 500\b/);
	await search('size:>2kb');
	assert.match(lastList().query.get('q'), /size > 2048\b/);
	await search('size:<1gb');
	assert.match(lastList().query.get('q'), /size < 1073741824\b/);
});

test('row thumbnails proxy Drive renders and keep the token server-side', async t => {
	const { drive, request, listingCount } = await setup(t);
	const response = await request('/0:/poster.png?thumb=1');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
	assert.match(response.headers.get('Cache-Control'), /^private, max-age=\d+$/, 'a private index never publishes thumbnails to the edge');
	assert.equal(await response.text(), 'thumb-bytes-of /poster=s220');

	const upstream = drive.calls.find(call => call.kind === 'thumb.get');
	assert.equal(upstream.headers.authorization, 'Bearer test-access', 'the Worker presents the token, not the page');

	// The second request reuses the cached listing; only the render refetches.
	await request('/0:/poster.png?thumb=1');
	assert.equal(listingCount(), 1);
	assert.equal(drive.count('thumb.get'), 2);
});

test('a public index marks thumbnails shareable at the edge', async t => {
	const { request } = await setup(t, { workerEnv: publicEnv });
	const response = await request('/0:/poster.png?thumb=1');
	assert.equal(response.status, 200);
	assert.match(response.headers.get('Cache-Control'), /^public, max-age=\d+$/);
});

test('a file without a thumbnail answers 404, and a folder path is just the folder page', async t => {
	const { request } = await setup(t);
	const bare = await request('/0:/plain.jpg?thumb=1');
	assert.equal(bare.status, 404);
	const folder = await request('/0:/Season%201/?thumb=1', { headers: { Authorization: adminAuth } });
	assert.equal(folder.status, 200);
	assert.match(folder.headers.get('Content-Type'), /text\/html/, 'a folder with thumb=1 is served as the listing page, not an image');
});

test('a protected index keeps thumbnails behind the same password as the files', async t => {
	const { request } = await setup(t, { workerEnv: { ...env, PROTECT_FILE_LINK: 'true' } });
	const denied = await request('/0:/poster.png?thumb=1', { headers: { Authorization: null } });
	assert.equal(denied.status, 401);
	const allowed = await request('/0:/poster.png?thumb=1', { headers: { Authorization: auth } });
	assert.equal(allowed.status, 200);
});
