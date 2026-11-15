import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { folderZip, openFolderArchive, safeArchiveName } from '../public/assets/js/folder-archive.mjs';
import { folderMimeType as folderMime } from '../worker/settings.mjs';

test('folder ZIP uses the index login and Drive ancestry for file access', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?folder-zip');
	const env = {
		GOOGLE_CLIENT_ID: 'test-client',
		GOOGLE_CLIENT_SECRET: 'test-secret',
		GOOGLE_REFRESH_TOKEN: 'test-refresh',
		DRIVE_ROOT_ID: 'root',
		INDEX_PASSWORD: 'password'
	};
	const files = {
		album: { id: 'album', name: 'Archive folder', mimeType: folderMime, parents: ['personal-root'] },
		video: { id: 'video', name: 'Large video.mkv', mimeType: 'video/x-matroska', parents: ['album'], size: '5000000000' },
		doc: { id: 'doc', name: 'Notes', mimeType: 'application/vnd.google-apps.document', parents: ['album'] },
		secret: { id: 'secret', name: '.Password', mimeType: 'text/plain', parents: ['album'] },
		outside: { id: 'outside', name: 'Shared to me', parents: ['foreign-root'] },
		trashed: { id: 'trashed', name: 'Deleted', parents: ['album'], trashed: true }
	};
	const calls = [];
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		const tail = url.pathname.split('/').at(-1);
		calls.push(url);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'token' });
		if (tail === 'root') return Response.json({ id: 'personal-root' });
		if (tail === 'files') {
			const query = url.searchParams.get('q');
			if (query.includes("name = 'Archive folder'")) return Response.json({ files: [files.album] });
			assert.match(query, /'album' in parents/);
			if (url.searchParams.get('pageToken') === 'second') return Response.json({ files: [files.doc] });
			return Response.json({ files: [files.video, files.secret], nextPageToken: 'second' });
		}
		if (tail === 'video' && url.searchParams.get('alt') === 'media') {
			return new Response('sample stream', { headers: { 'Content-Type': 'video/x-matroska' } });
		}
		if (tail === 'export') {
			assert.match(url.pathname, /\/doc\/export$/);
			assert.match(url.searchParams.get('mimeType'), /wordprocessingml\.document$/);
			return new Response('sample document');
		}
		return Response.json(files[tail] || {});
	});

	const archive = (args, loggedIn = true) => worker.fetch(new Request('https://rin.test/0:/Archive%20folder/?archive=1', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(loggedIn ? { Authorization: 'Basic ' + btoa('viewer:password') } : {})
		},
		body: JSON.stringify(args)
	}), env);
	assert.equal((await archive({ action: 'start' }, false)).status, 401);
	assert.equal(calls.length, 0);
	assert.deepEqual(await (await archive({ action: 'start' })).json(), {
		name: 'Archive folder', id: 'album'
	});
	const first = await (await archive({ action: 'list', id: 'album' })).json();
	assert.deepEqual(first.files.map(file => file.id), ['video']);
	assert.equal(first.pageToken, 'second');
	assert.equal((await (await archive({ action: 'list', id: 'album', pageToken: 'second' })).json()).files[0].id, 'doc');
	assert.equal(await (await archive({ action: 'file', id: 'video' })).text(), 'sample stream');
	const doc = await archive({ action: 'file', id: 'doc' });
	assert.equal(doc.headers.get('X-Rin-Archive-Extension'), '.docx');
	assert.equal(await doc.text(), 'sample document');
	for (const id of ['outside', 'secret', 'trashed']) {
		assert.equal((await archive({ action: 'file', id })).status, 404);
	}
});

function fakeFolder(t) {
	const fetchedFiles = [];
	t.mock.method(globalThis, 'fetch', async (endpoint, options) => {
		assert.equal(endpoint, '/0:/?archive=1');
		const { action, id, pageToken } = JSON.parse(options.body);
		if (action === 'start') return Response.json({ name: 'Samples', id: 'root' });
		if (action === 'file') {
			fetchedFiles.push(id);
			return new Response(id);
		}
		if (id === 'nested') return Response.json({ files: [{ id: 'nested-file', name: '../track.txt' }] });
		if (id === 'empty') return Response.json({ files: [] });
		if (pageToken === 'next') return Response.json({ files: [{ id: 'copy', name: 'track.txt' }] });
		return Response.json({
			files: [
				{ id: 'nested', name: 'Subfolder', mimeType: folderMime },
				{ id: 'empty', name: 'Empty', mimeType: folderMime },
				{ id: 'first', name: 'Track.txt' }
			],
			pageToken: 'next'
		});
	});
	return fetchedFiles;
}

test('archive entries stream lazily and preserve empty folders, pagination, and duplicate names', async t => {
	const fetchedFiles = fakeFolder(t);
	const archive = await openFolderArchive('/0:/');
	assert.equal(archive.filename, 'Samples.zip');
	assert.deepEqual(await archive.entries.next(), { value: { name: 'Samples/' }, done: false });
	assert.deepEqual(fetchedFiles, []);
	const names = [];
	for await (const entry of archive.entries) {
		names.push(entry.name);
		if (entry.input) assert.ok(await new Response(entry.input).text());
	}
	assert.deepEqual(names, [
		'Samples/Subfolder/', 'Samples/Subfolder/.._track.txt', 'Samples/Empty/',
		'Samples/Track.txt', 'Samples/track (2).txt'
	]);
	assert.deepEqual(fetchedFiles, ['nested-file', 'first', 'copy']);
	assert.equal(safeArchiveName('..'), '_');
	assert.equal(safeArchiveName('CON.txt'), '_CON.txt');
});

const zipModule = new URL('../public/assets/vendor/client-zip.mjs', import.meta.url);
test('the staged ZIP library writes the folder and its files into an archive', {
	skip: !existsSync(zipModule) && 'GitHub Actions stages the browser ZIP library before running this test'
}, async t => {
	fakeFolder(t);
	const { makeZip } = await import(zipModule.href);
	const { stream } = await folderZip('/0:/', makeZip);
	const result = Buffer.from(await new Response(stream).arrayBuffer());
	assert.equal(result.readUInt32LE(0), 0x04034b50);
	assert.equal(result.readUInt32LE(result.length - 22), 0x06054b50);
	assert.ok(result.includes('Samples/Empty/'));
	assert.ok(result.includes('Samples/track (2).txt'));
});
