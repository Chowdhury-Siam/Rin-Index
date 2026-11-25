import assert from 'node:assert/strict';
import { test } from 'node:test';

const MIB = 1024 * 1024;

// The engine is a classic script that publishes itself on globalThis, so the
// same file runs in the browser and here.
await import('../public/assets/js/upload-engine.js');
const { Engine } = globalThis.RinUploadEngine;

function fakeFile(name, size, type = 'text/plain') {
	return {
		name,
		size,
		type,
		slice(start, end) {
			return { name, start, end, byteLength: end - start };
		}
	};
}

// A deferred lets each test control exactly when a transport call resolves,
// which proves concurrency and keeps every timing assertion deterministic.
function deferred() {
	let resolve;
	const promise = new Promise(r => { resolve = r; });
	return { promise, resolve };
}

function responseLike(status, data) {
	return { status, ok: status >= 200 && status < 300, json: async () => data };
}

function chunkParams(url) {
	const offset = Number(/[?&]offset=(\d+)/.exec(url)[1]);
	const length = Number(/[?&]len=(\d+)/.exec(url)[1]);
	return { offset, length };
}

function sessionFetch(size, log = {}) {
	return async url => {
		if (url.includes('upload=start')) {
			(log.starts ||= []).push(url);
			return responseLike(200, { token: 'tok', chunk_size: 16 * MIB, max_chunk: 96 * MIB, total: size });
		}
		(log.status ||= []).push(url);
		return responseLike(200, { done: false, committed: log.committed ?? 0 });
	};
}

test('chunks grow adaptively and progress events carry speed and ETA', async () => {
	let clock = 0;
	const chunks = [];
	const events = [];
	const size = 40 * MIB;
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size),
		transport: async (url, init, onProgress) => {
			const { offset, length } = chunkParams(url);
			chunks.push({ offset, length, body: init.body });
			clock += 500;
			onProgress(length / 4);
			clock += 500;
			onProgress(length / 2);
			clock += 1000;
			const done = offset + length === size;
			return responseLike(200, { done, committed: done ? size : offset + length });
		}
	});
	const state = await engine.upload([fakeFile('Movie.mp4', size, 'video/mp4')], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: event => events.push(event)
	});

	// The first chunk is the advertised 16 MiB; the second doubles (capped by
	// the remaining bytes) instead of paying per-request overhead twice.
	assert.deepEqual(chunks.map(chunk => chunk.length), [16 * MIB, 24 * MIB]);
	assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 16 * MIB]);

	const progress = events.filter(event => event.type === 'file-progress');
	assert.ok(progress.some(event => event.uploaded === 8 * MIB), 'mid-chunk progress is reported');
	for (const event of progress) {
		assert.ok(event.uploaded <= size, 'progress never exceeds the file size');
		assert.ok(event.percent >= 0 && event.percent <= 100);
	}
	const afterFirstChunk = progress.find(event => event.uploaded === 16 * MIB && event.committed === 16 * MIB);
	assert.equal(afterFirstChunk.speed, 8 * MIB, 'speed comes from the confirmed samples');
	assert.equal(afterFirstChunk.eta, 3, 'ETA uses the confirmed remaining bytes');
	assert.equal(state.succeeded, 1);
	assert.equal(events.at(-1).type, 'batch-done');
	assert.equal(events.at(-1).succeeded, 1);
});

test('a failed chunk resyncs to the committed offset without counting bytes twice', async () => {
	let clock = 0;
	const transportCalls = [];
	const events = [];
	const size = 24 * MIB;
	let failedOnce = false;
	const log = { committed: 16 * MIB };
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		windowMs: 60000,
		fetchImpl: sessionFetch(size, log),
		transport: async (url, init, onProgress) => {
			const { offset, length } = chunkParams(url);
			transportCalls.push({ offset, length });
			if (offset === 0) {
				clock = 2000;
				return responseLike(200, { done: false, committed: 16 * MIB });
			}
			if (!failedOnce) {
				failedOnce = true;
				clock = 3000;
				onProgress(8 * MIB);
				throw new TypeError('network reset');
			}
			clock = 3500;
			onProgress(4 * MIB);
			clock = 5000;
			return responseLike(200, { done: true, committed: size });
		}
	});
	const state = await engine.upload([fakeFile('Movie.mp4', size, 'video/mp4')], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: event => events.push(event)
	});

	assert.equal(log.starts.length, 1, 'the retry reuses the session, not a new file');
	assert.equal(log.status.length, 1, 'one resync after the interruption');
	// The failed 8 MiB in-flight chunk is re-sent, but the meter never counts
	// it twice: final speed is 24 MiB over 5 s, not 32 MiB over 5 s.
	const progress = events.filter(event => event.type === 'file-progress');
	const last = progress.at(-1);
	assert.equal(last.uploaded, size);
	assert.equal(last.speed, size / 5, 'retried bytes are not double counted');
	const retry = events.find(event => event.type === 'file-retry');
	assert.equal(retry.attempt, 1);
	assert.equal(state.succeeded, 1);
	assert.equal(state.failed, 0);
});

test('a partially committed chunk resumes from the confirmed byte', async () => {
	let clock = 0;
	const chunks = [];
	const size = 24 * MIB;
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size),
		transport: async url => {
			const { offset, length } = chunkParams(url);
			chunks.push({ offset, length });
			clock += 1000;
			const done = offset + length === size;
			// Google only committed 10 MiB of the first 16 MiB chunk.
			return responseLike(200, { done, committed: offset === 0 ? 10 * MIB : size });
		}
	});
	const state = await engine.upload([fakeFile('Part.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: () => {}
	});
	assert.equal(state.succeeded, 1);
	assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 10 * MIB], 'the next chunk starts at the committed byte');
	assert.deepEqual(chunks.map(chunk => chunk.length), [16 * MIB, 14 * MIB]);
});

test('multiple files transfer concurrently with batch totals', async () => {
	let clock = 0;
	const pending = [];
	const events = [];
	const size = 16 * MIB;
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size),
		transport: async (url, init, onProgress) => {
			const params = chunkParams(url);
			const gate = deferred();
			pending.push({ ...params, gate });
			const data = await gate.promise;
			clock = 4000;
			onProgress(params.length);
			clock = 8000;
			return responseLike(200, data);
		}
	});
	const batch = engine.upload(
		[fakeFile('A.bin', size), fakeFile('B.bin', size)],
		{
			path: '/0:/',
			getHeaders: () => ({}),
			concurrency: 2,
			onEvent: event => events.push(event)
		}
	);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(pending.length, 2, 'both files are in flight at once');
	pending[0].gate.resolve({ done: true, committed: size });
	pending[1].gate.resolve({ done: true, committed: size });
	const state = await batch;
	assert.equal(state.succeeded, 2);
	const batchProgress = events.filter(event => event.type === 'batch-progress').at(-1);
	assert.equal(batchProgress.filesTotal, 2);
	assert.equal(batchProgress.total, 2 * size);
	assert.equal(batchProgress.uploaded, 2 * size);
	const batchDone = events.at(-1);
	assert.equal(batchDone.type, 'batch-done');
	assert.equal(batchDone.succeeded, 2);
	assert.equal(batchDone.failed, 0);
});

test('admin sign-in expiry stops the file without retries', async () => {
	const events = [];
	const log = {};
	const size = 16 * MIB;
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async () => responseLike(401, {})
	});
	const state = await engine.upload([fakeFile('A.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: event => events.push(event)
	});
	assert.equal(log.status?.length || 0, 0, 'expired admin sign-in must not trigger a resync');
	const error = events.find(event => event.type === 'file-error');
	assert.match(error.message, /Admin sign-in expired/);
	assert.equal(state.failed, 1);
});

test('an expired upload session fails immediately instead of retrying', async () => {
	const events = [];
	const size = 16 * MIB;
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size),
		transport: async () => responseLike(502, { error: 'gone', restart: true })
	});
	const state = await engine.upload([fakeFile('A.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: event => events.push(event)
	});
	const error = events.find(event => event.type === 'file-error');
	assert.match(error.message, /session expired/);
	assert.equal(state.failed, 1);
	const retries = events.filter(event => event.type === 'file-retry');
	assert.equal(retries.length, 0, 'a dead session must not be retried');
});

test('a zero-byte file completes in a single request', async () => {
	const chunks = [];
	const events = [];
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(0),
		transport: async url => {
			chunks.push(chunkParams(url));
			return responseLike(200, { done: true, committed: 0 });
		}
	});
	const state = await engine.upload([fakeFile('Empty.txt', 0)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: event => events.push(event)
	});
	assert.deepEqual(chunks, [{ offset: 0, length: 0 }]);
	assert.equal(state.succeeded, 1);
	assert.ok(events.some(event => event.type === 'file-done'));
});

test('a stalled upload gives up after five attempts', async () => {
	const transportCalls = [];
	const events = [];
	const log = { committed: 0 };
	const size = 16 * MIB;
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async url => {
			transportCalls.push(chunkParams(url));
			throw new TypeError('network reset');
		}
	});
	const state = await engine.upload([fakeFile('Stuck.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: event => events.push(event)
	});
	assert.equal(transportCalls.length, 5, 'five chunk attempts');
	assert.equal(log.status.length, 4, 'four resyncs between attempts');
	const error = events.find(event => event.type === 'file-error');
	assert.match(error.message, /paused after several retries/);
	assert.equal(state.failed, 1);
});
