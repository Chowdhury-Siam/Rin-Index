import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderMimeType } from '../worker/settings.mjs';
import { zipLength, zipStream } from '../worker/zip.mjs';

const env = {
	GOOGLE_CLIENT_ID: 'test-client',
	GOOGLE_CLIENT_SECRET: 'test-secret',
	GOOGLE_REFRESH_TOKEN: 'test-refresh',
	DRIVE_ROOT_ID: 'root',
	INDEX_PASSWORD: 'password'
};
const authorization = 'Basic ' + btoa('viewer:password');

test('a shared folder ZIP URL supports HEAD and GET with the index login', async t => {
	const { default: worker } = await import('../worker/worker-beta.js?archive-url');
	const album = { id: 'album', name: 'Archive folder', mimeType: folderMimeType };
	const body = { video: 'sample video stream', copy: 'distinct file' };
	const calls = [];
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input);
		calls.push(url);
		if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'token' });
		const id = url.pathname.split('/').at(-1);
		if (url.searchParams.get('alt') === 'media') {
			return new Response(body[id], { headers: { 'Content-Type': 'application/octet-stream' } });
		}
		assert.equal(id, 'files');
		const query = url.searchParams.get('q');
		if (query.includes("name = 'Archive folder'")) return Response.json({ files: [album] });
		if (query.includes("name = 'Missing'")) return Response.json({ files: [] });
		if (query.startsWith("'empty' in parents")) return Response.json({ files: [] });
		assert.match(query, /^'album' in parents/);
		assert.equal(url.searchParams.get('pageSize'), '1000');
		if (url.searchParams.get('pageToken') === 'next') {
			return Response.json({ files: [{ id: 'copy', name: 'video.mkv', size: String(body.copy.length) }] });
		}
		return Response.json({
			files: [
				{ id: 'empty', name: 'Empty folder', mimeType: folderMimeType },
				{ id: 'video', name: 'Video.mkv', size: String(body.video.length) },
				{ id: 'secret', name: '.Password' }
			],
			nextPageToken: 'next'
		});
	});

	const request = (method, headers = {}, folder = 'Archive%20folder') => worker.fetch(new Request(
		'https://rin.test/0:/' + folder + '/?download=zip', { method, headers }
	), env);
	assert.equal((await request('GET')).status, 401);
	assert.equal((await request('HEAD')).status, 401);
	assert.equal(calls.length, 0);
	assert.equal((await request('HEAD', { authorization }, 'Missing')).status, 404);
	const head = await request('HEAD', { authorization });
	assert.equal(head.status, 200);
	assert.equal(head.body, null);
	assert.equal(head.headers.get('Content-Type'), 'application/zip');
	assert.match(head.headers.get('Content-Disposition'), /filename="Archive folder.zip"/);
	assert.equal(calls.filter(url => url.searchParams.get('alt') === 'media').length, 0);

	const download = await request('GET', { authorization, Range: 'bytes=0-' });
	assert.equal(download.status, 200);
	assert.equal(download.headers.get('Accept-Ranges'), 'none');
	assert.equal(download.headers.get('Content-Length'), head.headers.get('Content-Length'));
	assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
	const zip = Buffer.from(await download.arrayBuffer());
	assert.equal(zip.length, Number(head.headers.get('Content-Length')));
	assert.equal(zip.readUInt32LE(0), 0x04034b50);
	assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
	assert.ok(zip.includes('Archive folder/Empty folder/'));
	assert.ok(zip.includes('Archive folder/video (2).mkv'));
	assert.ok(zip.includes(body.video));
	assert.ok(zip.includes(body.copy));
	assert.ok(!zip.includes('.Password'));
});

test('the ZIP writer preserves ZIP64 sizes over 4 GiB without buffering files', async () => {
	const size = 0x100000001n;
	const block = new Uint8Array(4 * 1024 * 1024);
	const name = new TextEncoder().encode('large.mkv');
	const entries = [{ name, size }];
	async function* content() {
		for (let remaining = size; remaining > 0n; remaining -= BigInt(block.byteLength)) {
			yield remaining < BigInt(block.byteLength) ? block.subarray(0, Number(remaining)) : block;
		}
	}
	let received = 0n;
	let central;
	for await (const chunk of zipStream(entries, content)) {
		received += BigInt(chunk.byteLength);
		if (chunk.byteLength === 74 + name.byteLength) central = new DataView(chunk.buffer);
	}
	assert.equal(received, zipLength(entries));
	assert.equal(central.getUint32(0, true), 0x02014b50);
	assert.equal(central.getBigUint64(46 + name.byteLength + 4, true), size);
	assert.equal(central.getBigUint64(46 + name.byteLength + 12, true), size);
});

