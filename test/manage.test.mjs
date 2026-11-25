import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeDrive } from '../test-support/fake-drive.mjs';
import { folderMimeType } from '../worker/settings.mjs';

const env = {
	GOOGLE_CLIENT_ID: 'test-client',
	GOOGLE_CLIENT_SECRET: 'test-secret',
	GOOGLE_REFRESH_TOKEN: 'test-refresh',
	DRIVE_ROOT_ID: 'root'
};
const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const adminAuth = basic('admin', 'admin-pass');
const adminEnv = { ...env, ADMIN_PASSWORD: 'admin-pass' };
const video = 'video/x-matroska';
const SEASON = '/0:/Season%201/';
const STORAGE_QUERY = '/0:/?manage=storage';
let counter = 0;

/**
 * A fresh Worker instance in front of a seeded fake Drive. The tree holds
 * "Season 1" (id-1) with "Episode 01.mkv" (id-2) and "Episode 02.mkv" (id-3),
 * and "Notes.md" (id-4) in the root.
 */
async function setup(t, { workerEnv = adminEnv, driveOptions = {} } = {}) {
	const drive = createFakeDrive(driveOptions).seed();
	t.mock.method(globalThis, 'fetch', drive.fetch);
	const { default: worker } = await import(`../worker/worker-beta.js?manage-${counter++}`);
	// A header set to null is left out, so `Authorization: null` sends none.
	const request = (path, { method, body, raw, headers = {} } = {}) => {
		const sent = { Authorization: adminAuth, ...(body === undefined && raw === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers };
		for (const [name, value] of Object.entries(sent)) if (value === null) delete sent[name];
		return worker.fetch(new Request('https://index.test' + path, {
			// Anything that carries a body is a POST, as the page sends it.
			method: method || (body === undefined && raw === undefined ? 'GET' : 'POST'),
			headers: sent,
			body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body)
		}), workerEnv);
	};
	// Posts a form the way the page does; `auth` null sends no credentials.
	const post = async (path, form, auth = adminAuth) => {
		const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
		if (auth) headers.Authorization = auth;
		const response = await worker.fetch(new Request('https://index.test' + path, {
			method: 'POST', headers, body: new URLSearchParams(form)
		}), workerEnv);
		return response.json();
	};
	return {
		drive,
		request,
		manage: (action, body, path = '/0:/', options = {}) => request(`${path}?manage=${action}`, { body, ...options }),
		storage: (query = '', auth = adminAuth, headers = {}) => request(STORAGE_QUERY + query, { headers: { Authorization: auth, ...headers } }),
		list: (path = '/0:/', { page = 0, token, auth = adminAuth } = {}) =>
			post(path, { page_index: String(page), ...(token ? { page_token: token } : {}) }, auth),
		// The same listing request with any headers (a session cookie, for one).
		form: (path, fields, headers = {}) => {
			const sent = { 'Content-Type': 'application/x-www-form-urlencoded' };
			for (const [name, value] of Object.entries(headers)) if (value !== null) sent[name] = value;
			return worker.fetch(new Request('https://index.test' + path, {
				method: 'POST', headers: sent, body: new URLSearchParams(fields)
			}), workerEnv);
		},
		search: (q, auth = adminAuth) => post('/0:search', { q, page_index: '0' }, auth),
		names: data => data.data.files.map(file => file.name),
		writes: () => drive.calls.filter(call => /^(files\.(create|update|delete)|session\.)/.test(call.kind)),
		lastList: () => drive.calls.filter(call => call.kind === 'files.list').at(-1)
	};
}

async function expect(response, status, error) {
	assert.equal(response.status, status, await response.clone().text());
	const body = await response.json();
	if (error) assert.match(body.error, error);
	return body;
}

test('file management answers only to the admin pair, before Google Drive is contacted', async t => {
	const { drive, manage } = await setup(t);
	const bodies = {
		mkdir: { name: 'x' },
		rename: { id: 'id-4', to: 'x' },
		move: { ids: ['id-4'], to: '/' },
		delete: { ids: ['id-4'] }
	};
	const others = [
		['no credentials', null],
		['a wrong admin password', basic('admin', 'nope')],
		['the site viewer pair', basic('viewer', 'site-pass')]
	];
	for (const [action, body] of Object.entries(bodies)) {
		for (const [who, authorization] of others) {
			const response = await manage(action, body, '/0:/', { headers: { Authorization: authorization } });
			assert.equal(response.status, 401, `${action} by ${who}`);
			assert.equal(await response.text(), 'Admin sign-in required.');
			if (authorization === null) {
				assert.match(response.headers.get('WWW-Authenticate'), /^Basic realm="Rin Index admin"/);
			} else {
				assert.equal(response.headers.get('WWW-Authenticate'), null, 'no native login prompt over the page');
			}
		}
	}
	assert.equal(drive.calls.length, 0, 'not even a token refresh');
	assert.equal(drive.items.size, 4, 'nothing changed');
});

test('the viewer password of a private index does not unlock file management', async t => {
	const { drive, manage, list, storage } = await setup(t, {
		workerEnv: { ...env, INDEX_PASSWORD: 'site-pass', ADMIN_PASSWORD: 'admin-pass' }
	});
	const viewer = basic('viewer', 'site-pass');
	assert.equal((await manage('delete', { ids: ['id-4'] }, '/0:/', { headers: { Authorization: viewer } })).status, 401);
	assert.equal((await manage('mkdir', { name: 'x' }, '/0:/', { headers: { Authorization: viewer } })).status, 401);
	assert.deepEqual((await list('/0:/', { auth: viewer })).data.files.map(file => file.name), ['Season 1', 'Notes.md'], 'the viewer still browses');
	assert.equal((await storage('', null)).status, 401, 'and the storage summary stays behind the site password');
	assert.equal(drive.calls.filter(call => /files\.(create|update|delete)/.test(call.kind)).length, 0);
});

test('file management is not configured without an admin password', async t => {
	const { drive, manage } = await setup(t, { workerEnv: env });
	for (const action of ['mkdir', 'rename', 'move', 'delete', 'purge']) {
		const body = await expect(await manage(action, { name: 'x', ids: ['id-4'], id: 'id-4', to: '/' }), 503, /File management is not configured/);
		assert.equal(body.code, undefined);
	}
	assert.equal(drive.calls.length, 0);
});

test('management requests are validated before anything changes', async t => {
	const { drive, manage, request, writes } = await setup(t);
	await expect(await request('/0:/?manage=purge', { body: { ids: ['id-4'] } }), 400, /Unknown management action/);
	await expect(await request('/0:/?manage=delete', { method: 'GET' }), 405, /Use POST/);
	await expect(await manage('delete', null, '/0:/', { headers: { 'Content-Type': 'text/plain' }, raw: 'ids=id-4' }), 415, /application\/json/);
	await expect(await manage('delete', null, '/0:/', { raw: '{"ids":' }), 400, /could not be read/);
	await expect(await manage('delete', { ids: ['id-4'] }, '/0:/Notes.md'), 400, /folder page/);
	await expect(await manage('delete', { ids: ['id-4'] }, '/0:/', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, /Cross-site/);

	for (const name of ['', '   ', '..', '.', 'a/b', 'a\\b', 'a\u0000b', 'x'.repeat(501), 42, null]) {
		await expect(await manage('mkdir', { name }), 400, /valid folder name/);
	}
	await expect(await manage('rename', { id: 'id-4' }), 400, /item and its new name/);
	await expect(await manage('rename', { id: 'id-4', to: '..' }), 400, /item and its new name/);
	await expect(await manage('rename', { id: '../id-4', to: 'x' }), 400, /item and its new name/);
	for (const ids of [[], 'id-4', Array(13).fill('id-2'), ['bad id'], [7], null]) {
		await expect(await manage('delete', { ids }), 400, /Select between 1 and 12/);
		await expect(await manage('move', { ids, to: '/' }), 400, /Select between 1 and 12/);
	}
	await expect(await manage('move', { ids: ['id-4'] }), 400, /destination folder/);
	await expect(await manage('move', { ids: ['id-4'], to: '/../' }), 400, /destination folder/);
	await expect(await manage('move', { ids: ['id-4'], to: '/Missing/' }), 404, /no longer inside the index/);
	await expect(await manage('mkdir', { name: 'x' }, '/0:/Missing/'), 404, /no longer inside the index/);
	assert.equal(writes().length, 0, 'nothing was written');
});

test('an admin creates folders, and a listing shows them without waiting', async t => {
	const { drive, manage, list, names } = await setup(t);
	// One item per page makes the first page cacheable between requests.
	drive.pageSize = 1;
	assert.deepEqual(names(await list()), ['Season 1']);
	const before = drive.count('files.list');
	assert.deepEqual(names(await list()), ['Season 1']);
	assert.equal(drive.count('files.list'), before, 'an unchanged first page is served from the cache');

	const created = await expect(await manage('mkdir', { name: 'Season 2 & More' }), 200);
	assert.deepEqual(created, { folder: { id: 'id-5', name: 'Season 2 & More', mimeType: folderMimeType }, existed: false });
	const call = drive.calls.find(item => item.kind === 'files.create');
	assert.equal(call.method, 'POST');
	assert.equal(call.url.pathname, '/drive/v3/files');
	assert.equal(call.query.get('supportsAllDrives'), 'true');
	assert.deepEqual(JSON.parse(call.body), { name: 'Season 2 & More', mimeType: folderMimeType, parents: ['root'] });
	assert.equal(drive.find('Season 2 & More').mimeType, folderMimeType, 'the folder exists on Drive');

	assert.ok(drive.count('files.list') > before, 'the cached first page was dropped');
	const page = await list();
	const second = await list('/0:/', { page: 1, token: page.nextPageToken });
	assert.equal(second.data.files[0].name, 'Season 2 & More');

	const nested = await expect(await manage('mkdir', { name: 'Extras' }, SEASON), 200);
	assert.deepEqual(JSON.parse(drive.calls.at(-1).body), { name: 'Extras', mimeType: folderMimeType, parents: ['id-1'] });
	assert.equal(nested.folder.id, 'id-6');
	drive.pageSize = 0;
	assert.deepEqual(names(await list(SEASON)), ['Extras', 'Episode 01.mkv', 'Episode 02.mkv']);
});

test('a new folder never shadows an item that is already there', async t => {
	const { drive, manage } = await setup(t);
	const clash = await expect(await manage('mkdir', { name: 'Season 1' }), 409, /A folder named “Season 1” already exists here/);
	assert.equal(clash.code, 'exists');
	const reused = await expect(await manage('mkdir', { name: 'Season 1', reuse: true }), 200);
	assert.deepEqual(reused, { folder: { id: 'id-1', name: 'Season 1', mimeType: folderMimeType }, existed: true });
	const file = await expect(await manage('mkdir', { name: 'Notes.md' }), 409, /A file named “Notes.md” already exists here/);
	assert.equal(file.code, 'exists');
	await expect(await manage('mkdir', { name: 'Notes.md', reuse: true }), 409, /A file named “Notes.md” already exists here/);
	assert.equal(drive.count('files.create'), 0, 'no second folder was made');
});

test('renaming changes the real item, and names stay unique inside a folder', async t => {
	const { drive, manage, list, names, request } = await setup(t);
	const renamed = await expect(await manage('rename', { id: 'id-2', to: 'Episode 01 (1080p).mkv' }, SEASON), 200);
	assert.deepEqual(renamed, { item: { id: 'id-2', name: 'Episode 01 (1080p).mkv', mimeType: video }, changed: true });
	const call = drive.calls.find(item => item.kind === 'files.update');
	assert.equal(call.method, 'PATCH');
	assert.equal(call.url.pathname, '/drive/v3/files/id-2');
	assert.equal(call.query.get('supportsAllDrives'), 'true');
	assert.equal(call.query.has('addParents'), false, 'a rename only changes the name');
	assert.deepEqual(JSON.parse(call.body), { name: 'Episode 01 (1080p).mkv' });
	// The old address is gone and the new one opens.
	assert.equal((await request('/0:/Season%201/Episode%2001.mkv')).status, 404);
	assert.equal(await (await request('/0:/Season%201/Episode%2001%20(1080p).mkv')).text(), 'media of Episode 01 (1080p).mkv');

	const same = await expect(await manage('rename', { id: 'id-2', to: 'Episode 01 (1080p).mkv' }, SEASON), 200);
	assert.deepEqual(same, { item: { id: 'id-2', name: 'Episode 01 (1080p).mkv', mimeType: video }, changed: false });
	assert.equal(drive.count('files.update'), 1, 'renaming to the same name writes nothing');

	const clash = await expect(await manage('rename', { id: 'id-3', to: 'Episode 01 (1080p).mkv' }, SEASON), 409, /An item named “Episode 01 \(1080p\)\.mkv” already exists here/);
	assert.equal(clash.code, 'exists');
	await expect(await manage('rename', { id: 'id-3', to: 'Season 1' }), 404, /no longer in this folder/);

	// Quotes survive the Drive query; a backslash or slash is refused as a
	// path separator.
	const odd = "It's \"2026\"";
	await expect(await manage('rename', { id: 'id-4', to: odd }), 200);
	assert.equal(drive.items.get('id-4').name, odd);
	assert.equal(await (await request('/0:/' + encodeURIComponent(odd))).text(), 'media of ' + odd);
	await expect(await manage('rename', { id: 'id-4', to: 'back\\slash' }), 400, /item and its new name/);

	// Folders rename too, and the old path stops listing them.
	drive.folder('Extras', ['id-1']);
	const folder = await expect(await manage('rename', { id: 'id-1', to: 'Season One' }), 200);
	assert.deepEqual(folder, { item: { id: 'id-1', name: 'Season One', mimeType: folderMimeType }, changed: true });
	assert.deepEqual(names(await list(SEASON)), [], 'the old path is no longer a folder');
	assert.deepEqual(names(await list('/0:/Season%20One/')), ['Extras', 'Episode 01 (1080p).mkv', 'Episode 02.mkv']);

	// An item the account may not rename is named and left alone.
	drive.items.get('id-3').capabilities.canRename = false;
	const locked = await expect(await manage('rename', { id: 'id-3', to: 'Renamed.mkv' }, '/0:/Season%20One/'), 403, /doesn’t allow this account to rename “Episode 02\.mkv”/);
	assert.equal(locked.code, 'forbidden');
	assert.equal(drive.items.get('id-3').name, 'Episode 02.mkv');

	// Only items of the folder in the URL are reachable.
	const elsewhere = await manage('rename', { id: 'id-4', to: 'Elsewhere.txt' }, '/0:/Season%20One/');
	assert.equal(elsewhere.status, 404);
	const missing = await manage('rename', { id: 'no-such-item', to: 'x' });
	assert.equal(missing.status, 404);
	assert.equal(drive.count('files.update'), 3, 'neither was written');
});

test('an item outside the indexed folder cannot be managed through its ID', async t => {
	const drive = createFakeDrive({ rootId: 'index-root' });
	const outside = drive.folder('Private', ['elsewhere']);
	const secret = drive.file('Secret.txt', [outside.id], { size: '1' });
	drive.folder('Index root', [], { id: 'index-root' });
	const notes = drive.file('Notes.md', ['index-root'], { size: '2' });
	t.mock.method(globalThis, 'fetch', drive.fetch);
	const { default: worker } = await import('../worker/worker-beta.js?manage-outside');
	const manage = (action, body) => worker.fetch(new Request(`https://index.test/0:/?manage=${action}`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	}), { ...adminEnv, DRIVE_ROOT_ID: 'index-root' });

	const renamed = await manage('rename', { id: secret.id, to: 'Stolen.txt' });
	assert.equal(renamed.status, 404);
	assert.match((await renamed.json()).error, /no longer in this folder/);
	const moved = await manage('move', { ids: [secret.id], to: '/' });
	assert.equal((await moved.json()).results[0].code, 'missing');
	const deleted = await manage('delete', { ids: [secret.id] });
	assert.equal((await deleted.json()).changed, 0);
	assert.equal(secret.name, 'Secret.txt', 'an ID from outside the index changes nothing');

	const inside = await manage('rename', { id: notes.id, to: 'Read me.md' });
	assert.equal(inside.status, 200, 'an item of the indexed folder is renamed');
	assert.deepEqual(drive.calls.filter(call => call.method === 'PATCH').map(call => call.url.pathname), ['/drive/v3/files/' + notes.id]);
});

test('moving changes the parent folder on Drive, with a result for every item', async t => {
	const { drive, manage, list, names } = await setup(t);
	const moved = await expect(await manage('move', { ids: ['id-2', 'id-3'], to: '/' }, SEASON), 200);
	assert.deepEqual(moved, {
		changed: 2,
		failed: 0,
		results: [
			{ id: 'id-2', name: 'Episode 01.mkv', mimeType: video, ok: true, changed: true },
			{ id: 'id-3', name: 'Episode 02.mkv', mimeType: video, ok: true, changed: true }
		]
	});
	const patches = drive.calls.filter(call => call.kind === 'files.update');
	assert.deepEqual(patches.map(call => call.url.pathname).sort(), ['/drive/v3/files/id-2', '/drive/v3/files/id-3']);
	for (const call of patches) {
		assert.equal(call.method, 'PATCH');
		assert.equal(call.query.get('addParents'), 'root');
		assert.equal(call.query.get('removeParents'), 'id-1');
		assert.equal(call.query.get('supportsAllDrives'), 'true');
		assert.equal(call.body ?? null, null, 'a move sends no metadata');
	}
	assert.equal(drive.calls.filter(call => call.method === 'DELETE').length, 0, 'a move never deletes');
	assert.deepEqual(names(await list()), ['Season 1', 'Episode 01.mkv', 'Episode 02.mkv', 'Notes.md']);
	assert.deepEqual(names(await list(SEASON)), []);

	// An item that is already in the destination is reported, not written again.
	const there = await expect(await manage('move', { ids: ['id-2'], to: '/' }), 200);
	assert.deepEqual(there, { changed: 0, failed: 0, results: [{ id: 'id-2', name: 'Episode 01.mkv', mimeType: video, ok: true, changed: false }] });
	assert.equal(drive.count('files.update'), 2);

	// A folder cannot move into itself or into one of its own subfolders.
	drive.folder('Extras', ['id-1']);
	const itself = await expect(await manage('move', { ids: ['id-1'], to: '/Season%201/' }), 200);
	assert.equal(itself.results[0].code, 'self');
	const nested = await expect(await manage('move', { ids: ['id-1'], to: '/Season%201/Extras/' }), 200);
	assert.equal(nested.results[0].code, 'self');
	assert.equal(nested.changed, 0);
	assert.deepEqual(drive.items.get('id-1').parents, ['root']);

	// A name that is taken in the destination would leave one item unreachable.
	drive.file('Episode 01.mkv', ['id-1']);
	const clash = await expect(await manage('move', { ids: ['id-2'], to: '/Season%201/' }), 200);
	assert.equal(clash.results[0].code, 'exists');
	assert.match(clash.results[0].error, /already exists in the destination folder/);
	assert.deepEqual(drive.items.get('id-2').parents, ['root']);

	// One request reports each item on its own.
	drive.file('Loose.txt', ['root']);
	drive.items.get('id-3').capabilities.canMoveItemWithinDrive = false;
	const mixed = await expect(await manage('move', { ids: ['id-7', 'no-such-item', 'id-3'], to: '/Season%201/' }), 200);
	assert.equal(mixed.changed, 1);
	assert.equal(mixed.failed, 2);
	assert.deepEqual(mixed.results.map(result => [result.id, result.ok, result.code]), [
		['id-7', true, undefined], ['no-such-item', false, 'missing'], ['id-3', false, 'forbidden']
	]);
	assert.deepEqual(drive.items.get('id-7').parents, ['id-1']);
	assert.deepEqual(drive.items.get('id-3').parents, ['root']);
});

test('deleting moves items to the trash, never erases them outright', async t => {
	const { drive, manage, list, names, request } = await setup(t);
	const deleted = await expect(await manage('delete', { ids: ['id-4'] }), 200);
	assert.deepEqual(deleted, {
		changed: 1,
		failed: 0,
		results: [{ id: 'id-4', name: 'Notes.md', mimeType: 'text/plain', ok: true, changed: true }]
	});
	const call = drive.calls.find(item => item.kind === 'files.update');
	assert.equal(call.method, 'PATCH');
	assert.equal(call.url.pathname, '/drive/v3/files/id-4');
	assert.equal(call.query.get('supportsAllDrives'), 'true');
	assert.deepEqual(JSON.parse(call.body), { trashed: true });
	assert.equal(drive.calls.filter(item => item.method === 'DELETE').length, 0, 'nothing is deleted for good');
	assert.deepEqual(drive.trash().map(item => item.name), ['Notes.md']);
	assert.deepEqual(names(await list()), ['Season 1']);
	assert.equal((await request('/0:/Notes.md')).status, 404);
	const again = await expect(await manage('delete', { ids: ['id-4'] }), 200);
	assert.equal(again.results[0].code, 'missing', 'a trashed item is no longer part of the folder');

	// An item the account may not trash is reported while the others go.
	drive.items.get('id-3').capabilities.canTrash = false;
	drive.items.get('id-3').capabilities.canDelete = false;
	const mixed = await expect(await manage('delete', { ids: ['id-2', 'id-3'] }, SEASON), 200);
	assert.equal(mixed.changed, 1);
	assert.equal(mixed.failed, 1);
	assert.deepEqual(mixed.results.map(result => [result.name, result.ok, result.code]), [
		['Episode 01.mkv', true, undefined], ['Episode 02.mkv', false, 'forbidden']
	]);
	assert.deepEqual(drive.trash().map(item => item.name).sort(), ['Episode 01.mkv', 'Notes.md']);
});

test('Drive refusals and outages come back as clear, retryable answers', async t => {
	const { drive, manage } = await setup(t);
	drive.scope = 'readonly';
	const readonly = await expect(await manage('mkdir', { name: 'x' }), 403, /full Drive scope \(https:\/\/www\.googleapis\.com\/auth\/drive\)/);
	assert.equal(readonly.code, 'scope');
	drive.scope = 'full';

	drive.offline = true;
	const offline = await expect(await manage('mkdir', { name: 'x' }), 502, /could not/);
	assert.equal(offline.retry, true);
	drive.offline = false;

	drive.failWith('files.update', 500);
	const broken = await expect(await manage('rename', { id: 'id-4', to: 'x.txt' }), 502, /could not complete that/);
	assert.equal(broken.retry, true);
	drive.failWith('files.update', 429);
	const limited = await expect(await manage('rename', { id: 'id-4', to: 'x.txt' }), 503, /limiting requests/);
	assert.equal(limited.code, 'rate_limit');
	assert.equal(limited.retry, true);
	drive.failWith('files.get', 403);
	const forbidden = await expect(await manage('rename', { id: 'id-4', to: 'x.txt' }), 403, /refused to open/);
	assert.equal(forbidden.code, 'forbidden');
	drive.failWith('files.create', 404);
	assert.equal((await manage('mkdir', { name: 'x' })).status, 404);
	assert.equal(drive.items.get('id-4').name, 'Notes.md', 'nothing changed');
	assert.equal(drive.items.size, 4, 'no folder was made');
});

test('the storage summary reports what Drive reports, and never estimates', async t => {
	const { drive, storage, manage, request } = await setup(t);
	const first = await expect(await storage(), 200);
	assert.equal(first.cached, false);
	assert.equal(first.total, 1099511627776);
	assert.equal(first.used, 698976482740);
	assert.equal(first.available, first.total - first.used);
	assert.equal(first.usedInDrive, 698976482740);
	assert.equal(first.usedInTrash, 0);
	assert.equal(typeof first.fetchedAt, 'number');
	assert.deepEqual(Object.keys(first).sort(), ['available', 'cached', 'fetchedAt', 'total', 'used', 'usedInDrive', 'usedInTrash']);
	assert.equal(drive.calls.find(call => call.kind === 'about.get').query.get('fields'), 'storageQuota');

	// Later page loads are served the same summary without asking Drive again,
	// so browsing never turns into Drive requests.
	assert.equal((await expect(await storage(), 200)).cached, true);
	assert.equal(drive.count('about.get'), 1);

	// After an upload or a management action the page asks for the current quota.
	const fresh = await expect(await storage('&refresh=1'), 200);
	assert.equal(fresh.cached, false);
	assert.equal(drive.count('about.get'), 2);

	// When Drive reports no limit, nothing is invented for it.
	drive.quota = { usage: '5368709120', usageInDrive: '1073741824', usageInDriveTrash: '1024' };
	const unlimited = await expect(await storage('&refresh=1'), 200);
	assert.deepEqual(unlimited, {
		cached: false, total: null, used: 5368709120, available: null, usedInDrive: 1073741824, usedInTrash: 1024, fetchedAt: unlimited.fetchedAt
	});

	// A failed read keeps the last good answer, and says so.
	drive.failWith('about.get', 500);
	const stale = await expect(await storage('&refresh=1'), 200);
	assert.equal(stale.stale, true);
	assert.equal(stale.used, 5368709120);
	drive.quota = { usage: '4294967296' };
	assert.equal((await expect(await storage('&refresh=1'), 200)).used, 4294967296, 'Drive is asked again once it answers');

	// A change made through the index drops the summary, so the next read is current.
	drive.quota = { usage: '1' };
	await storage('&refresh=1');
	drive.quota = { usage: '99' };
	await manage('delete', { ids: ['id-4'] });
	assert.equal((await expect(await storage(), 200)).used, 99);

	await expect(await request(STORAGE_QUERY, { method: 'POST', body: {} }), 405, /Use GET/);
});

test('the storage summary is for the admin only', async t => {
	const { drive, storage } = await setup(t, {
		workerEnv: { ...env, INDEX_PASSWORD: 'site-pass', ADMIN_PASSWORD: 'admin-pass' }
	});
	const anonymous = await storage('', null);
	assert.equal(anonymous.status, 401);
	assert.match(anonymous.headers.get('WWW-Authenticate'), /^Basic realm="Rin Index admin"/);
	const viewer = await storage('', basic('viewer', 'site-pass'));
	assert.equal(viewer.status, 401, 'the site password does not reveal the account quota');
	assert.equal(await viewer.text(), 'Admin sign-in required.');
	assert.equal(drive.calls.length, 0, 'Google Drive is not asked for anyone else');

	const admin = await expect(await storage(), 200);
	assert.equal(admin.cached, false);
	assert.equal(drive.count('about.get'), 1);
});

test('a refused request made by the page opens no browser login prompt', async t => {
	const { storage, request } = await setup(t);
	const fromPage = { Authorization: null, 'X-Requested-With': 'Rin Index' };
	for (const sent of [
		await storage('', null, { 'X-Requested-With': 'Rin Index' }),
		await request('/0:/?manage=delete', { body: { ids: ['id-4'] }, headers: fromPage }),
		await request('/0:/?upload=start', { body: { name: 'a.txt', size: 1, type: 'text/plain' }, headers: fromPage })
	]) {
		assert.equal(sent.status, 401);
		assert.equal(sent.headers.get('WWW-Authenticate'), null, 'the page shows its own sign-in dialog');
	}
	// Typed into the address bar, the same address may still use the browser's prompt.
	assert.match((await storage('', null)).headers.get('WWW-Authenticate'), /^Basic realm="Rin Index admin"/);
});

test('an admin session survives navigation without storing the password', async t => {
	const { drive, request, form, manage, storage } = await setup(t);
	const pageModel = async (headers = {}) =>
		JSON.parse(/window\.RIN_INDEX = (\{.*?\});<\/script>/s.exec(await (await request('/0:/', { headers: { Authorization: null, ...headers } })).text())[1]);
	const cookieOf = response => response.headers.get('Set-Cookie');
	const login = (headers = {}) => request('/0:/?manage=login', { body: {}, headers });
	assert.equal((await pageModel()).model.is_admin, false, 'nobody is an admin before signing in');
	const before = drive.calls.length;

	// Only the admin pair opens a session, and that never contacts Google Drive.
	for (const credentials of [null, basic('admin', 'nope'), basic('viewer', 'x')]) {
		const refused = await login({ Authorization: credentials });
		assert.equal(refused.status, 401);
		assert.equal(cookieOf(refused), null);
		if (credentials === null) assert.match(refused.headers.get('WWW-Authenticate'), /^Basic realm="Rin Index admin"/);
		else assert.equal(refused.headers.get('WWW-Authenticate'), null);
	}
	assert.equal((await request('/0:/?manage=login')).status, 405, 'a link cannot sign anyone in');
	assert.equal((await request('/0:/?manage=login', { body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
	const signedIn = await login();
	assert.equal(drive.calls.length, before, 'signing in never contacts Google Drive');
	const body = await signedIn.json();
	assert.deepEqual(Object.keys(body).sort(), ['admin', 'expires']);
	assert.equal(body.admin, true);
	assert.ok(Math.abs(body.expires - Date.now() - 8 * 60 * 60 * 1000) < 5000, 'eight hours from now');
	const cookie = cookieOf(signedIn);
	assert.match(cookie, /^rin_admin_session=\d{13}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure$/);
	assert.equal(cookie.includes(basic('admin', 'admin-pass').slice(6)), false, 'the cookie never carries the admin pair');
	const session = { Authorization: null, Cookie: cookie.slice(0, cookie.indexOf(';')) };

	// The session stands in for the pair on every admin route.
	assert.equal((await pageModel(session)).model.is_admin, true, 'the next page knows its admin');
	const listed = await (await form('/0:/', { page_index: '0' }, session)).json();
	assert.equal(listed.data.files[0].capabilities.canRename, true);
	assert.equal((await manage('mkdir', { name: 'By session' }, '/0:/', { headers: session })).status, 200);
	assert.equal(drive.find('By session', drive.rootId).mimeType, folderMimeType);
	assert.equal((await expect(await storage('&refresh=1', null, session), 200)).cached, false);
	assert.equal(typeof (await (await request('/0:/?upload=start', { body: { name: 'a.txt', size: 3, type: 'text/plain' }, headers: session })).json()).token, 'string');

	// A session that was altered or cut short is worth nothing.
	const [expires, signature] = session.Cookie.split('=')[1].split('.');
	const forged = [
		`rin_admin_session=${Number(expires) + 1}.${signature}`,
		`rin_admin_session=${expires}.${signature.slice(0, 42)}${signature.at(42) === 'A' ? 'B' : 'A'}`,
		`rin_admin_session=${expires}`,
		'rin_admin_session=' + basic('admin', 'admin-pass').slice(6)
	];
	for (const value of forged) {
		const headers = { Authorization: null, Cookie: value };
		assert.equal((await pageModel(headers)).model.is_admin, false, value);
		assert.equal((await manage('delete', { ids: ['id-4'] }, '/0:/', { headers })).status, 401, value);
	}
	assert.equal(drive.items.size, 5, 'no forged session deleted anything');

	// It is valid only during the eight hours it was issued for.
	t.mock.timers.enable({ apis: ['Date'], now: Number(expires) - 8 * 60 * 60 * 1000 - 5000 });
	assert.equal((await pageModel(session)).model.is_admin, false, 'not before it could have been issued');
	t.mock.timers.reset();
	t.mock.timers.enable({ apis: ['Date'], now: Number(expires) - 60_000 });
	assert.equal((await pageModel(session)).model.is_admin, true);
	t.mock.timers.tick(120_000);
	assert.equal((await pageModel(session)).model.is_admin, false, 'and not after it expires');
	assert.equal((await manage('delete', { ids: ['id-4'] }, '/0:/', { headers: session })).status, 401);
	assert.equal(drive.items.size, 5, 'the expired session deleted nothing');
	t.mock.timers.reset();

	// Signing out clears it, for whoever asks, without touching Google Drive.
	const calls = drive.calls.length;
	const logout = await request('/0:/?manage=logout', { body: {}, headers: { Authorization: null, Cookie: session.Cookie } });
	assert.equal((await logout.json()).admin, false);
	assert.match(cookieOf(logout), /^rin_admin_session=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax; Secure$/);
	assert.equal((await request('/0:/?manage=logout', { method: 'GET' })).status, 405, 'a link cannot sign anyone out');
	assert.equal(drive.calls.length, calls);
});

test('changing the admin password ends every session', async t => {
	const before = await setup(t);
	const cookie = (await before.request('/0:/?manage=login', { body: {} })).headers.get('Set-Cookie').split(';')[0];
	// A deployment with a new admin pair, met by a session issued under the old one.
	const after = await setup(t, { workerEnv: { ...env, ADMIN_PASSWORD: 'rotated' } });
	const stale = { Authorization: null, Cookie: cookie };
	const page = await (await after.request('/0:/', { headers: stale })).text();
	assert.equal(JSON.parse(/window\.RIN_INDEX = (\{.*?\});<\/script>/s.exec(page)[1]).model.is_admin, false);
	assert.equal((await after.manage('delete', { ids: ['id-4'] }, '/0:/', { headers: stale })).status, 401);
	assert.equal((await after.request('/0:/?manage=login', { body: {}, headers: { Authorization: adminAuth } })).status, 401, 'the old pair no longer signs in');
	const renewed = await after.request('/0:/?manage=login', { body: {}, headers: { Authorization: basic('admin', 'rotated') } });
	assert.match(renewed.headers.get('Set-Cookie'), /^rin_admin_session=\d{13}\./);
	assert.notEqual(renewed.headers.get('Set-Cookie').split(';')[0], cookie, 'and the new session is its own');
	assert.equal(after.drive.items.size, 4, 'nothing was deleted');
});

test('a storage summary that Drive cannot provide is an error and is never cached', async t => {
	const { drive, storage } = await setup(t);
	drive.quota = { limit: 'soon', usage: '' };
	await expect(await storage(), 502, /did not report the storage usage/);
	drive.failWith('about.get', 500);
	await expect(await storage(), 502, /could not report the storage usage/);
	drive.offline = true;
	const offline = await expect(await storage(), 502, /could not be reached/);
	assert.equal(offline.retry, true);
	drive.offline = false;
	drive.quota = { limit: '1000', usage: '250', usageInDrive: '250', usageInDriveTrash: '0' };
	const recovered = await expect(await storage(), 200);
	assert.deepEqual(recovered, { cached: false, total: 1000, used: 250, available: 750, usedInDrive: 250, usedInTrash: 0, fetchedAt: recovered.fetchedAt });
});

test('listings tell an admin what may be done with each item, and only an admin', async t => {
	const { drive, list, search, request, lastList } = await setup(t);
	drive.pageSize = 1;
	const admin = await list();
	assert.equal(lastList().query.get('fields'),
		'nextPageToken, files(id, name, mimeType, size, modifiedTime, capabilities(canDownload,canRename,canTrash,canDelete,canMoveItemWithinDrive))');
	assert.deepEqual(admin.data.files[0].capabilities, { canDownload: true, canRename: true, canTrash: true, canDelete: true, canMoveItemWithinDrive: true });

	const page = await list('/0:/', { auth: null });
	assert.equal(lastList().query.get('fields'), 'nextPageToken, files(id, name, mimeType, size, modifiedTime, capabilities(canDownload))');
	assert.deepEqual(page.data.files[0].capabilities, { canDownload: true }, 'no management fields for anyone else');

	// Both first pages are cached, each with its own fields.
	const before = drive.count('files.list');
	await list();
	await list('/0:/', { auth: null });
	assert.equal(drive.count('files.list'), before);
	assert.equal((await list()).data.files[0].capabilities.canRename, true);
	assert.deepEqual((await list('/0:/', { auth: null })).data.files[0].capabilities, { canDownload: true });

	// Search results follow the same rule.
	const found = await search('Episode');
	assert.equal(lastList().query.get('fields'), 'nextPageToken, files(id, name, mimeType, size , modifiedTime, capabilities(canRename,canTrash,canDelete,canMoveItemWithinDrive))');
	assert.equal(found.data.files[0].capabilities.canRename, true);
	await search('Episode', null);
	assert.equal(lastList().query.get('fields'), 'nextPageToken, files(id, name, mimeType, size , modifiedTime)');
	assert.equal((await search('Episode', null)).data.files[0].capabilities, undefined);

	// The page itself only tells an admin that they are one.
	const model = async authorization => JSON.parse(/window\.RIN_INDEX = (\{.*?\});<\/script>/s.exec(await (await request('/0:/', { headers: { Authorization: authorization } })).text())[1]);
	assert.deepEqual(await model(adminAuth), { order: 0, name: 'Rin Index', model: { root_type: 0, can_upload: true, is_admin: true } });
	assert.deepEqual(await model(null), { order: 0, name: 'Rin Index', model: { root_type: 0, can_upload: true, is_admin: false } });
});

test('cached lookups expire on their own', async t => {
	const { drive, list } = await setup(t);
	t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
	drive.pageSize = 1;
	await list();
	const before = drive.count('files.list');
	await list();
	assert.equal(drive.count('files.list'), before);
	t.mock.timers.tick(29_000);
	await list();
	assert.equal(drive.count('files.list'), before, 'still cached just under the limit');
	t.mock.timers.tick(2_000);
	await list();
	assert.ok(drive.count('files.list') > before, 'dropped after 30 seconds');
});

test('a finished upload drops the cached listing', async t => {
	const { drive, list, request } = await setup(t);
	drive.pageSize = 1;
	await list();
	await list();
	const before = drive.count('files.list');
	const start = body => request('/0:/?upload=start', { body });
	const chunk = (session, offset, len, text) => request(`/0:/?upload=chunk&u=${encodeURIComponent(session.token)}&offset=${offset}&len=${len}`, {
		method: 'PUT', raw: text, headers: { 'Content-Type': null }
	});

	const whole = await (await start({ name: 'Whole.txt', size: 5, type: 'text/plain' })).json();
	assert.equal((await (await chunk(whole, 0, 5, 'Hello')).json()).done, true);
	await list();
	assert.ok(drive.count('files.list') > before, 'the listing was dropped when the upload finished');

	const settled = drive.count('files.list');
	const partial = await (await start({ name: 'Partial.txt', size: 10, type: 'text/plain' })).json();
	assert.equal((await (await chunk(partial, 0, 5, 'Half ')).json()).done, false);
	await list();
	assert.equal(drive.count('files.list'), settled, 'an unfinished upload changes nothing yet');
});

