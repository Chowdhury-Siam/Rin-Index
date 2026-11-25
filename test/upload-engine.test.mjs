import assert from 'node:assert/strict';
import { test } from 'node:test';

const MIB = 1024 * 1024;
const SERVER_MAX_CHUNK = 95 * MIB;
const TIMEOUT = { timeout: 8000 };

// The engine is a classic script that publishes itself on globalThis, so the
// same file runs in the browser and here.
await import('../public/assets/js/upload-engine.js');
const { Engine, SpeedMeter, CLIENT_MAX_CHUNK, MAX_ATTEMPTS } = globalThis.RinUploadEngine;

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
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

// Lets every pending microtask of the engine run.
const tick = () => new Promise(resolve => setImmediate(resolve));

function responseLike(status, data) {
	return { status, ok: status >= 200 && status < 400, json: async () => data };
}

function chunkParams(url) {
	const offset = Number(/[?&]offset=(\d+)/.exec(url)[1]);
	const length = Number(/[?&]len=(\d+)/.exec(url)[1]);
	return { offset, length };
}

// Stands in for the Worker's upload routes. `log.committed` is the byte Drive
// reports for status queries; `net.down` takes the whole network offline and
// `net.statusOverride` replaces the status answer.
function sessionFetch(size, log = {}, net = {}) {
	return async url => {
		if (net.down) throw new TypeError('network unreachable');
		const target = String(url);
		if (target.includes('upload=start')) {
			(log.starts ||= []).push(target);
			if (net.startOverride) return net.startOverride();
			return responseLike(200, { token: 'tok', chunk_size: 16 * MIB, max_chunk: net.maxChunk || SERVER_MAX_CHUNK, total: size });
		}
		if (target.includes('upload=cancel')) {
			(log.cancels ||= []).push(target);
			return responseLike(200, { cancelled: net.cancelled !== false });
		}
		(log.status ||= []).push(target);
		if (net.statusOverride) return net.statusOverride();
		return responseLike(200, { done: false, committed: log.committed ?? 0 });
	};
}

// A chunk that stays in flight until the engine aborts it, like an XHR that
// the user pauses.
function holdUntilAborted(signal) {
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(new Error('The upload request was cancelled.'));
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
	});
}

// Records every engine event and waits for the next event of a type. Call
// next() before the action that should trigger the event.
function tracker(events) {
	const waiters = [];
	return {
		onEvent: event => {
			events.push(event);
			for (const waiter of waiters.splice(0)) {
				if (waiter.type === event.type) waiter.gate.resolve(event);
				else waiters.push(waiter);
			}
		},
		next: type => {
			const gate = deferred();
			waiters.push({ type, gate });
			return gate;
		}
	};
}

function collecting(events) {
	return event => events.push(event);
}

const mibs = (...sizes) => sizes.map(mib => mib * MIB);

// Chunk sizing.

test('chunk ceilings stay inside the Cloudflare Free request-body limit', () => {
	assert.equal(CLIENT_MAX_CHUNK, 95 * MIB);
	assert.ok(CLIENT_MAX_CHUNK < 100_000_000, 'the browser ceiling must stay under 100 MB');
	assert.equal(CLIENT_MAX_CHUNK % (256 * 1024), 0, 'chunks are multiples of the 256 KiB unit Drive commits');
	assert.equal(MAX_ATTEMPTS, 5);
});

test('chunks double after every fully committed chunk and stop at the lowest ceiling', TIMEOUT, async () => {
	const run = async (options = {}) => {
		const size = 250 * MIB;
		const chunks = [];
		const engine = new Engine({
			now: () => 0,
			sleep: () => Promise.resolve(),
			fetchImpl: sessionFetch(size, {}, { maxChunk: options.maxChunk }),
			transport: async url => {
				const { offset, length } = chunkParams(url);
				chunks.push(length);
				const done = offset + length === size;
				return responseLike(200, { done, committed: done ? size : offset + length });
			}
		});
		const state = await engine.upload([fakeFile('Big.bin', size)], {
			path: '/0:/',
			getHeaders: () => ({}),
			maxChunkSize: options.maxChunkSize,
			onEvent: () => {}
		});
		assert.equal(state.succeeded, 1);
		return chunks;
	};
	// 16 + 32 + 64 + 95 + 43 = 250 MiB: four pauses between chunks instead of
	// the sixteen that fixed 16 MiB chunks would pay.
	assert.deepEqual(await run(), mibs(16, 32, 64, 95, 43));
	// A Worker that advertises more than the browser may send changes nothing.
	assert.deepEqual(await run({ maxChunk: 200 * MIB }), mibs(16, 32, 64, 95, 43));
	// A lower ceiling from the Worker or from the page wins.
	assert.deepEqual(await run({ maxChunk: 40 * MIB }), mibs(16, 32, 40, 40, 40, 40, 40, 2));
	assert.deepEqual(await run({ maxChunkSize: 48 * MIB }), mibs(16, 32, 48, 48, 48, 48, 10));
});

test('chunks grow adaptively and progress events carry speed and ETA', TIMEOUT, async () => {
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
		onEvent: collecting(events)
	});

	// The first chunk is the advertised 16 MiB; the second doubles (capped by
	// the remaining bytes) instead of paying the per-request pause twice.
	assert.deepEqual(chunks.map(chunk => chunk.length), mibs(16, 24));
	assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 16 * MIB]);
	assert.deepEqual(chunks[1].body, { name: 'Movie.mp4', start: 16 * MIB, end: 40 * MIB, byteLength: 24 * MIB });

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
	assert.equal(state.cancelled, 0);
	assert.equal(events.at(-1).type, 'batch-done');
	assert.equal(events.at(-1).succeeded, 1);
});

test('a failed chunk resyncs to the committed offset without counting bytes twice', TIMEOUT, async () => {
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
		onEvent: collecting(events)
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
	assert.equal(retry.limit, 5);
	assert.equal(state.succeeded, 1);
	assert.equal(state.failed, 0);
	assert.equal(events.filter(event => event.type === 'batch-progress').at(-1).retries, 1);
});

test('a failed chunk drops the chunk size back to the start size', TIMEOUT, async () => {
	const chunks = [];
	const size = 200 * MIB;
	let failed = false;
	const log = {};
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async url => {
			const { offset, length } = chunkParams(url);
			chunks.push(length);
			if (chunks.length === 2 && !failed) {
				failed = true;
				log.committed = 16 * MIB;
				throw new TypeError('network reset');
			}
			const done = offset + length === size;
			log.committed = done ? size : offset + length;
			return responseLike(200, { done, committed: done ? size : offset + length });
		}
	});
	const state = await engine.upload([fakeFile('Big.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: () => {}
	});
	assert.equal(state.succeeded, 1);
	// After the interruption the next chunk is small again and grows afresh.
	assert.deepEqual(chunks, mibs(16, 32, 16, 32, 64, 72));
});

test('a partially committed chunk resumes from the confirmed byte', TIMEOUT, async () => {
	let clock = 0;
	const chunks = [];
	const events = [];
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
		onEvent: collecting(events)
	});
	assert.equal(state.succeeded, 1);
	assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 10 * MIB], 'the next chunk starts at the committed byte');
	assert.deepEqual(chunks.map(chunk => chunk.length), mibs(16, 14));
	const confirmed = events.filter(event => event.type === 'file-progress' && event.committed === 10 * MIB);
	assert.equal(confirmed.at(-1).uploaded, 10 * MIB, 'the bar follows the byte Drive confirmed');
});

test('multiple files transfer concurrently with batch totals', TIMEOUT, async () => {
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
			onEvent: collecting(events)
		}
	);
	await tick();
	assert.equal(pending.length, 2, 'both files are in flight at once');
	pending[0].gate.resolve({ done: true, committed: size });
	pending[1].gate.resolve({ done: true, committed: size });
	const state = await batch;
	assert.equal(state.succeeded, 2);
	const batchProgress = events.filter(event => event.type === 'batch-progress').at(-1);
	assert.equal(batchProgress.filesTotal, 2);
	assert.equal(batchProgress.total, 2 * size);
	assert.equal(batchProgress.uploaded, 2 * size);
	assert.equal(batchProgress.active, 0, 'nothing is transferring once both files finish');
	const batchDone = events.at(-1);
	assert.equal(batchDone.type, 'batch-done');
	assert.equal(batchDone.succeeded, 2);
	assert.equal(batchDone.failed, 0);
});

test('progress reports where the upload time goes', TIMEOUT, async () => {
	let clock = 0;
	const events = [];
	const size = 40 * MIB;
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size),
		transport: async (url, init, onProgress) => {
			const { offset, length } = chunkParams(url);
			clock += 1000; // bytes leaving the browser
			onProgress(length);
			clock += 500; // waiting for Google Drive's answer
			const done = offset + length === size;
			return responseLike(200, { done, committed: done ? size : offset + length });
		}
	});
	const handle = engine.start([fakeFile('Movie.mp4', size, 'video/mp4')], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: collecting(events)
	});
	const state = await handle.done;
	assert.equal(state.succeeded, 1);

	const done = events.find(event => event.type === 'file-done');
	assert.equal(done.sendMs, 2000, 'two seconds sending two chunks');
	assert.equal(done.waitMs, 1000, 'one second waiting for two confirmations');
	assert.equal(done.activeMs, 3000);
	assert.equal(done.retries, 0);
	const batch = events.filter(event => event.type === 'batch-progress').at(-1);
	assert.equal(batch.sendMs, 2000);
	assert.equal(batch.waitMs, 1000);
	const report = handle.report();
	assert.equal(report.sendMs, 2000);
	assert.equal(report.waitMs, 1000);
	assert.equal(report.activeMs, 3000);
	assert.equal(report.elapsedMs, 3000);
	assert.equal(report.bytes, size);
	assert.equal(report.succeeded, 1);
	assert.deepEqual(report.files[0].chunks, [{ size: 16 * MIB, count: 1 }, { size: 24 * MIB, count: 1 }]);
});

test('admin sign-in expiry stops the file without retries', TIMEOUT, async () => {
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
		onEvent: collecting(events)
	});
	assert.equal(log.status?.length || 0, 0, 'expired admin sign-in must not trigger a resync');
	const error = events.find(event => event.type === 'file-error');
	assert.match(error.message, /Admin sign-in expired/);
	assert.equal(state.failed, 1);
});

test('an expired upload session fails immediately instead of retrying', TIMEOUT, async () => {
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
		onEvent: collecting(events)
	});
	const error = events.find(event => event.type === 'file-error');
	assert.match(error.message, /session expired/);
	assert.equal(state.failed, 1);
	const retries = events.filter(event => event.type === 'file-retry');
	assert.equal(retries.length, 0, 'a dead session must not be retried');
});

test('a zero-byte file completes in a single request', TIMEOUT, async () => {
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
		onEvent: collecting(events)
	});
	assert.deepEqual(chunks, [{ offset: 0, length: 0 }]);
	assert.equal(state.succeeded, 1);
	assert.ok(events.some(event => event.type === 'file-done'));
});

// Pause, resume, and cancel.

test('pausing aborts the chunk in flight, keeps the session, and reports no ETA', TIMEOUT, async () => {
	let clock = 0;
	const chunks = [];
	const events = [];
	const size = 40 * MIB;
	const inFlight = deferred();
	const record = tracker(events);
	const paused = record.next('file-paused');
	// Drive kept only 5 MiB of the 16 MiB chunk the browser had partly sent.
	const log = { committed: 5 * MIB };
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async (url, init, onProgress) => {
			const { offset, length } = chunkParams(url);
			chunks.push({ offset, length, signal: init.signal });
			if (chunks.length === 1) {
				clock += 1000;
				onProgress(8 * MIB);
				inFlight.resolve();
				return holdUntilAborted(init.signal);
			}
			clock += 1000;
			onProgress(length / 2);
			clock += 1000;
			const done = offset + length === size;
			return responseLike(200, { done, committed: done ? size : offset + length });
		}
	});
	const handle = engine.start([fakeFile('Movie.mp4', size, 'video/mp4')], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await inFlight.promise;
	assert.equal(handle.summary().active, 1);
	assert.equal(handle.pause(), true);
	const event = await paused.promise;
	await tick();

	assert.equal(event.committed, 5 * MIB, 'the pause is reported at the byte Drive confirmed');
	assert.equal(event.uploaded, 5 * MIB);
	assert.equal(event.percent, 12.5);
	assert.equal(event.speed, null, 'no speed while paused');
	assert.equal(event.eta, null, 'no ETA while paused');
	assert.equal(event.reason, 'user');
	assert.equal(event.message, '');
	assert.equal(event.confirmed, true);
	assert.deepEqual(handle.summary(), { active: 0, paused: 1, unfinished: 1 });
	assert.equal(chunks[0].signal.aborted, true, 'the in-flight chunk was aborted');
	const batch = events.find(item => item.type === 'batch-progress' && item.paused === 1);
	assert.equal(batch.eta, null, 'the batch ETA is hidden while everything is paused');
	assert.equal(batch.speed, null);

	assert.equal(handle.resume(0), true);
	const state = await handle.done;
	assert.equal(state.succeeded, 1);
	assert.equal(log.starts.length, 1, 'resume keeps the same Drive session: no duplicate file');
	assert.equal(log.status.length, 2, 'one check when pausing, one before resuming');
	// The interrupted chunk is not restarted from its beginning: the next
	// chunk starts at the byte Drive confirmed.
	assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 5 * MIB, 21 * MIB]);
	assert.deepEqual(chunks.map(chunk => chunk.length), mibs(16, 16, 19));
	const resumed = events.find(item => item.type === 'file-resumed');
	assert.equal(resumed.committed, 5 * MIB);
	const afterResume = events.find(item => item.type === 'file-progress' && item.committed === 5 * MIB && item.uploaded > 5 * MIB);
	assert.ok(afterResume, 'progress continues from the confirmed byte');
	assert.ok(!events.some(item => item.type === 'file-error'));
	assert.equal(events.at(-1).type, 'batch-done');
	assert.ok(events.findIndex(item => item.type === 'batch-done') > events.lastIndexOf(batch), 'batch-done comes last');
});

test('resuming re-checks Drive and continues from its byte even if Drive committed more', TIMEOUT, async () => {
	let clock = 0;
	const chunks = [];
	const events = [];
	const size = 48 * MIB;
	const inFlight = deferred();
	const record = tracker(events);
	const paused = record.next('file-paused');
	// The pause landed after Drive had already stored the whole first chunk.
	const log = { committed: 16 * MIB };
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async (url, init, onProgress) => {
			const { offset, length } = chunkParams(url);
			chunks.push({ offset, length });
			if (chunks.length === 1) {
				inFlight.resolve();
				return holdUntilAborted(init.signal);
			}
			clock += 1000;
			const done = offset + length === size;
			return responseLike(200, { done, committed: done ? size : offset + length });
		}
	});
	const handle = engine.start([fakeFile('Movie.mp4', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await inFlight.promise;
	handle.pause();
	const event = await paused.promise;
	// The browser never saw a confirmation, so the report is honest.
	assert.equal(event.committed, 16 * MIB);
	assert.equal(handle.summary().paused, 1);
	await tick();
	assert.deepEqual(chunks.map(chunk => chunk.offset), [0], 'nothing is sent while paused');
	assert.equal(log.starts.length, 1);

	handle.resume(0);
	await handle.done;
	// The 16 MiB Drive already stored are not sent again.
	assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 16 * MIB, 32 * MIB]);
	assert.equal(log.starts.length, 1, 'one session from first byte to last');
});

test('resume finishes the file when Drive already has every byte', TIMEOUT, async () => {
	const events = [];
	const size = 16 * MIB;
	const inFlight = deferred();
	const net = {};
	const record = tracker(events);
	const paused = record.next('file-paused');
	const log = {};
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log, net),
		transport: async (url, init) => {
			inFlight.resolve();
			return holdUntilAborted(init.signal);
		}
	});
	const handle = engine.start([fakeFile('Movie.mp4', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await inFlight.promise;
	handle.pause();
	await paused.promise;
	await tick();
	// Drive completed the chunk just before the abort landed.
	net.statusOverride = () => responseLike(200, { done: true, committed: size });
	handle.resume(0);
	const state = await handle.done;
	assert.equal(state.succeeded, 1);
	assert.ok(events.some(event => event.type === 'file-done'), 'the finished file is kept, not re-uploaded');
	assert.equal(log.starts.length, 1);
	assert.ok(!events.some(event => event.type === 'file-error'));
});

test('resume reports a session that expired while paused', TIMEOUT, async () => {
	const events = [];
	const size = 16 * MIB;
	const inFlight = deferred();
	const net = {};
	const record = tracker(events);
	const paused = record.next('file-paused');
	const log = {};
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log, net),
		transport: async (url, init) => {
			inFlight.resolve();
			return holdUntilAborted(init.signal);
		}
	});
	const handle = engine.start([fakeFile('Movie.mp4', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await inFlight.promise;
	handle.pause();
	await paused.promise;
	await tick();
	net.statusOverride = () => responseLike(410, { error: 'gone', restart: true });
	assert.equal(handle.resume(0), true);
	const state = await handle.done;
	assert.equal(state.failed, 1);
	assert.match(events.find(event => event.type === 'file-error').message, /session expired/);
	assert.equal(events.at(-1).type, 'batch-done');
});

test('cancelling aborts the transfer, stops retries, closes the session, and keeps finished files', TIMEOUT, async () => {
	let clock = 0;
	const chunks = [];
	const events = [];
	const size = 16 * MIB;
	const inFlight = deferred();
	const record = tracker(events);
	const cancelled = record.next('file-cancelled');
	const log = {};
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async (url, init, onProgress) => {
			const { offset, length } = chunkParams(url);
			chunks.push({ offset, length });
			if (chunks.length === 2) {
				clock += 1000;
				onProgress(6 * MIB);
				inFlight.resolve();
				return holdUntilAborted(init.signal);
			}
			clock += 1000;
			onProgress(length);
			return responseLike(200, { done: true, committed: size });
		}
	});
	const handle = engine.start([fakeFile('Done.bin', size), fakeFile('Stop.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		concurrency: 1,
		onEvent: record.onEvent
	});
	await inFlight.promise;
	assert.equal(handle.cancel(1), true);
	const event = await cancelled.promise;
	const state = await handle.done;

	assert.equal(event.committed, 0, 'nothing of the second file was confirmed');
	assert.equal(event.closed, true, 'Drive confirmed the session was closed');
	assert.equal(log.cancels.length, 1, 'the Worker was asked to close exactly one session');
	assert.match(log.cancels[0], /upload=cancel&u=tok$/);
	assert.equal(chunks.length, 2, 'no further chunk was sent after the cancel');
	assert.deepEqual(state, { filesTotal: 2, succeeded: 1, failed: 0, cancelled: 1, total: 2 * size });
	const done = events.find(item => item.type === 'file-done');
	assert.equal(done.name, 'Done.bin', 'the file that already finished stays uploaded');
	assert.ok(!events.some(item => item.type === 'file-retry'), 'cancel stops the automatic retries');
	assert.ok(!events.some(item => item.type === 'file-paused'), 'a cancelled file is never parked as paused');
	assert.equal(events.at(-1).type, 'batch-done');
	assert.equal(handle.report().cancelled, 1);
});

test('cancelling during a retry back-off sends nothing further', TIMEOUT, async () => {
	const chunks = [];
	const events = [];
	const backoff = deferred();
	const firstFailure = deferred();
	const record = tracker(events);
	const cancelled = record.next('file-cancelled');
	const log = {};
	const engine = new Engine({
		now: () => 0,
		sleep: () => backoff.promise,
		fetchImpl: sessionFetch(16 * MIB, log),
		transport: async url => {
			chunks.push(chunkParams(url));
			firstFailure.resolve();
			throw new TypeError('network reset');
		}
	});
	const handle = engine.start([fakeFile('Stop.bin', 16 * MIB)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await firstFailure.promise;
	// Let the engine enter its back-off sleep, then cancel.
	await tick();
	assert.equal(handle.cancel(0), true);
	backoff.resolve();
	await cancelled.promise;
	const state = await handle.done;
	assert.equal(chunks.length, 1, 'the failed chunk is not retried after a cancel');
	assert.equal(log.status?.length || 0, 0, 'no resync after a cancel');
	assert.equal(log.cancels.length, 1);
	assert.equal(state.cancelled, 1);
});

test('cancelling while the session opens closes it as soon as it exists', TIMEOUT, async () => {
	const chunks = [];
	const events = [];
	const opening = deferred();
	const record = tracker(events);
	const cancelled = record.next('file-cancelled');
	const log = {};
	const net = { startOverride: () => opening.promise };
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(16 * MIB, log, net),
		transport: async url => {
			chunks.push(chunkParams(url));
			return responseLike(200, { done: true, committed: 16 * MIB });
		}
	});
	const handle = engine.start([fakeFile('Stop.bin', 16 * MIB)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await tick();
	assert.equal(handle.cancel(0), true);
	assert.equal(log.cancels, undefined, 'nothing is closed before the session exists');
	opening.resolve(responseLike(200, { token: 'tok', chunk_size: 16 * MIB, max_chunk: SERVER_MAX_CHUNK, total: 16 * MIB }));
	const event = await cancelled.promise;
	const state = await handle.done;
	assert.equal(event.closed, true);
	assert.equal(log.cancels.length, 1);
	assert.equal(chunks.length, 0, 'no byte of the file is sent');
	assert.deepEqual(state, { filesTotal: 1, succeeded: 0, failed: 0, cancelled: 1, total: 16 * MIB });
});

test('a cancel that arrives while a pause is being confirmed wins', TIMEOUT, async () => {
	const events = [];
	const size = 16 * MIB;
	const inFlight = deferred();
	const status = deferred();
	const net = { statusOverride: () => status.promise };
	const record = tracker(events);
	const cancelled = record.next('file-cancelled');
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, {}, net),
		transport: async (url, init) => {
			inFlight.resolve();
			return holdUntilAborted(init.signal);
		}
	});
	const handle = engine.start([fakeFile('Stop.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await inFlight.promise;
	handle.pause();
	await tick();
	assert.equal(handle.cancel(0), true, 'the file can still be cancelled while the pause settles');
	status.resolve(responseLike(200, { done: false, committed: 0 }));
	const event = await cancelled.promise;
	const state = await handle.done;
	assert.equal(event.closed, true);
	assert.equal(state.cancelled, 1);
	assert.ok(!events.some(item => item.type === 'file-paused'), 'the file ends cancelled, not paused');
});

test('a pending file can be paused before it starts and resumed later', TIMEOUT, async () => {
	let clock = 0;
	const order = [];
	const events = [];
	const first = deferred();
	const record = tracker(events);
	const paused = record.next('file-paused');
	const log = {};
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(16 * MIB, log),
		transport: async url => {
			const { length } = chunkParams(url);
			order.push(length);
			if (order.length === 1) await first.promise;
			clock += 1000;
			return responseLike(200, { done: true, committed: 16 * MIB });
		}
	});
	const handle = engine.start([fakeFile('A.bin', 16 * MIB), fakeFile('B.bin', 16 * MIB)], {
		path: '/0:/',
		getHeaders: () => ({}),
		concurrency: 1,
		onEvent: record.onEvent
	});
	await tick();
	assert.deepEqual(handle.summary(), { active: 1, paused: 0, unfinished: 2 });
	handle.pause(1);
	const event = await paused.promise;
	assert.equal(event.index, 1);
	assert.equal(event.committed, 0);
	assert.equal(event.reason, 'user');
	assert.equal(event.eta, null);
	first.resolve();
	await tick();
	assert.equal(order.length, 1, 'the paused file never started while its lane opened up');
	assert.equal(log.starts.length, 1, 'a paused waiting file has no Drive session yet');
	assert.deepEqual(handle.summary(), { active: 0, paused: 1, unfinished: 1 });
	assert.equal(handle.pause(1), false, 'an already paused file stays as it is');
	assert.equal(handle.resume(1), true);
	const state = await handle.done;
	assert.equal(state.succeeded, 2);
	assert.deepEqual(order, mibs(16, 16));
	assert.equal(log.starts.length, 2);
});

test('a zero-byte file paused while its session opens is still sent after a resume', TIMEOUT, async () => {
	const chunks = [];
	const events = [];
	const opening = deferred();
	const record = tracker(events);
	const paused = record.next('file-paused');
	const net = { startOverride: () => opening.promise };
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(0, {}, net),
		transport: async url => {
			chunks.push(chunkParams(url));
			return responseLike(200, { done: true, committed: 0 });
		}
	});
	const handle = engine.start([fakeFile('Empty.txt', 0)], { path: '/0:/', getHeaders: () => ({}), onEvent: record.onEvent });
	await tick();
	assert.equal(handle.pause(0), true);
	opening.resolve(responseLike(200, { token: 'tok', chunk_size: 16 * MIB, max_chunk: SERVER_MAX_CHUNK, total: 0 }));
	const event = await paused.promise;
	assert.equal(event.committed, 0);
	assert.ok(!events.some(item => item.type === 'file-done'), 'an empty file is not reported as uploaded before it was sent');
	assert.equal(chunks.length, 0);
	handle.resume(0);
	const state = await handle.done;
	assert.deepEqual(chunks, [{ offset: 0, length: 0 }]);
	assert.equal(state.succeeded, 1);
});

test('pause, resume, and cancel apply to every file at once', TIMEOUT, async () => {
	let clock = 0;
	const log = {};
	const events = [];
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(16 * MIB, log),
		transport: async (url, init, onProgress) => {
			await holdUntilAborted(init.signal).catch(() => {});
			return holdUntilAborted(init.signal);
		}
	});
	const handle = engine.start([fakeFile('A.bin', 16 * MIB), fakeFile('B.bin', 16 * MIB), fakeFile('C.bin', 16 * MIB)], {
		path: '/0:/',
		getHeaders: () => ({}),
		concurrency: 3,
		onEvent: collecting(events)
	});
	await tick();
	assert.equal(handle.summary().active, 3);
	handle.pause();
	await tick();
	assert.equal(handle.summary().paused, 3, 'every file is paused');
	assert.equal(handle.summary().active, 0);
	handle.cancel();
	const state = await handle.done;
	assert.equal(state.cancelled, 3);
	assert.equal(log.cancels.length, 3, 'every unfinished session is closed');
	assert.equal(events.at(-1).type, 'batch-done');
});

test('batch controls resume every paused file together', TIMEOUT, async () => {
	let clock = 0;
	const events = [];
	const log = {};
	let round = 0;
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(16 * MIB, log),
		transport: async (url, init, onProgress) => {
			if (round === 0) return holdUntilAborted(init.signal);
			clock += 1000;
			onProgress(16 * MIB);
			return responseLike(200, { done: true, committed: 16 * MIB });
		}
	});
	const record = tracker(events);
	const paused = [record.next('file-paused'), record.next('file-paused')];
	const handle = engine.start([fakeFile('A.bin', 16 * MIB), fakeFile('B.bin', 16 * MIB)], {
		path: '/0:/',
		getHeaders: () => ({}),
		concurrency: 2,
		onEvent: record.onEvent
	});
	await tick();
	assert.equal(handle.summary().active, 2);
	handle.pause();
	await Promise.all(paused.map(gate => gate.promise));
	await tick();
	assert.deepEqual(handle.summary(), { active: 0, paused: 2, unfinished: 2 });
	round = 1;
	assert.equal(handle.resume(), true);
	const state = await handle.done;
	assert.equal(state.succeeded, 2);
	assert.equal(log.starts.length, 2, 'each file keeps the session it started with');
	assert.equal(log.cancels, undefined, 'resuming closes nothing');
	assert.deepEqual(events.filter(event => event.type === 'file-resumed').map(event => event.index), [0, 1]);
});

test('cancelled files leave the batch totals', TIMEOUT, async () => {
	const events = [];
	const log = {};
	const size = 16 * MIB;
	let round = 0;
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async (url, init, onProgress) => {
			if (round === 0) return holdUntilAborted(init.signal);
			onProgress(size);
			return responseLike(200, { done: true, committed: size });
		}
	});
	const record = tracker(events);
	const cancelled = record.next('file-cancelled');
	const handle = engine.start([fakeFile('Keep.bin', size), fakeFile('Drop.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		concurrency: 2,
		onEvent: record.onEvent
	});
	await tick();
	handle.cancel(1);
	await cancelled.promise;
	await tick();
	const batch = events.filter(event => event.type === 'batch-progress').at(-1);
	assert.equal(batch.total, size, 'the cancelled file no longer counts as work to do');
	assert.equal(batch.cancelled, 1);
	assert.equal(batch.active, 1);
	// The surviving file has to be released from its own hold before it can
	// finish in round 1.
	handle.pause(0);
	await tick();
	round = 1;
	handle.resume(0);
	const state = await handle.done;
	assert.deepEqual(state, { filesTotal: 2, succeeded: 1, failed: 0, cancelled: 1, total: 2 * size });
});

test('pause time is left out of the measurement', TIMEOUT, async () => {
	let clock = 0;
	const events = [];
	const size = 21 * MIB;
	const inFlight = deferred();
	const record = tracker(events);
	const paused = record.next('file-paused');
	const log = { committed: 5 * MIB };
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async (url, init, onProgress) => {
			if (events.some(item => item.type === 'file-resumed')) {
				clock += 2000;
				return responseLike(200, { done: true, committed: size });
			}
			clock += 1000;
			onProgress(8 * MIB);
			inFlight.resolve();
			return holdUntilAborted(init.signal);
		}
	});
	const handle = engine.start([fakeFile('Movie.mp4', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await inFlight.promise;
	handle.pause();
	await paused.promise;
	await tick();
	clock += 600000; // ten minutes paused
	handle.resume(0);
	const state = await handle.done;
	assert.equal(state.succeeded, 1);
	const done = events.find(event => event.type === 'file-done');
	assert.equal(done.activeMs, 3000, 'one second before the pause, two after it');
	assert.equal(done.sendMs, 3000);
	assert.equal(handle.report().elapsedMs, 603000);
});

// Connection drops.

test('a stalled upload is parked as paused and resumes from the committed byte', TIMEOUT, async () => {
	const transportCalls = [];
	const events = [];
	const log = { committed: 0 };
	const size = 16 * MIB;
	let online = false;
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log),
		transport: async url => {
			transportCalls.push(chunkParams(url));
			if (!online) throw new TypeError('network reset');
			return responseLike(200, { done: true, committed: size });
		}
	});
	const handle = engine.start([fakeFile('Stuck.bin', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: collecting(events)
	});
	await tick();
	await tick();
	assert.equal(transportCalls.length, MAX_ATTEMPTS, 'five chunk attempts before parking');
	assert.equal(log.status.length, MAX_ATTEMPTS, 'a resync after each failed attempt, then one to confirm the parked position');
	assert.deepEqual(handle.summary(), { active: 0, paused: 1, unfinished: 1 });
	const parked = events.find(event => event.type === 'file-paused');
	assert.equal(parked.reason, 'stalled');
	assert.equal(parked.committed, 0);
	assert.equal(parked.confirmed, true);
	assert.equal(parked.eta, null);
	assert.equal(parked.speed, null);
	assert.match(parked.message, /Resume when you are back online/);
	assert.ok(!events.some(event => event.type === 'file-error'), 'a drop is not reported as a lost file');
	assert.equal(events.filter(event => event.type === 'file-retry').length, MAX_ATTEMPTS);
	assert.equal(handle.report().retries, MAX_ATTEMPTS);

	// Back online: the file resumes on the session it already has.
	online = true;
	handle.resume(0);
	const state = await handle.done;
	assert.equal(log.starts.length, 1);
	assert.equal(state.succeeded, 1);
	assert.equal(state.cancelled, 0);
	assert.equal(transportCalls.length, MAX_ATTEMPTS + 1);
});

test('a connection drop keeps the session and resumes from the byte Drive confirmed', TIMEOUT, async () => {
	let clock = 0;
	const chunks = [];
	const events = [];
	const net = { down: false };
	const size = 40 * MIB;
	const firstChunk = deferred();
	const log = { committed: 0 };
	const engine = new Engine({
		now: () => clock,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, log, net),
		transport: async (url, init, onProgress) => {
			const { offset, length } = chunkParams(url);
			chunks.push({ offset, length });
			if (net.down) throw new TypeError('network reset');
			if (chunks.length === 1) {
				clock += 1000;
				onProgress(8 * MIB);
				// The first chunk completes only once the test lets it.
				await firstChunk.promise;
				log.committed = 16 * MIB;
				clock += 1000;
				return responseLike(200, { done: false, committed: 16 * MIB });
			}
			clock += 1000;
			onProgress(length / 2);
			clock += 1000;
			const done = offset + length === size;
			return responseLike(200, { done, committed: done ? size : offset + length });
		}
	});
	const record = tracker(events);
	const parked = record.next('file-paused');
	const handle = engine.start([fakeFile('Movie.mp4', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await tick();
	assert.deepEqual(chunks, [{ offset: 0, length: 16 * MIB }]);
	// The line drops with the first chunk in flight and stays down.
	net.down = true;
	firstChunk.resolve();
	const event = await parked.promise;
	await tick();
	assert.equal(event.reason, 'stalled');
	assert.equal(event.confirmed, false, 'Drive could not be reached to confirm the position');
	assert.equal(event.committed, 16 * MIB, 'the last position the browser knew is kept');
	assert.equal(event.uploaded, 16 * MIB);
	assert.equal(event.eta, null);
	assert.equal(handle.summary().paused, 1);
	assert.equal(log.starts.length, 1, 'a drop never opens a second session');
	assert.equal(chunks.length, 1 + MAX_ATTEMPTS, 'five more attempts, then the file waits');

	// Back online. Drive stored 4 MiB of the chunk that was cut off.
	net.down = false;
	log.committed = 20 * MIB;
	assert.equal(handle.resume(0), true);
	const state = await handle.done;
	assert.equal(state.succeeded, 1);
	assert.equal(log.starts.length, 1, 'the same session is used: no restart, no duplicate file');
	assert.deepEqual(chunks.slice(6).map(chunk => chunk.offset), [20 * MIB, 36 * MIB], 'the upload continues from the byte Drive confirmed');
	const resumed = events.find(item => item.type === 'file-resumed');
	assert.equal(resumed.committed, 16 * MIB, 'resuming starts at the last byte the browser knew');
	assert.ok(events.some(item => item.type === 'file-progress' && item.committed === 20 * MIB && item.uploaded === 20 * MIB), 'the confirmed position becomes the new start');
	assert.ok(!events.some(item => item.type === 'file-error'));
});

test('resuming while still offline leaves the file paused with a clear reason', TIMEOUT, async () => {
	const events = [];
	const net = { down: false };
	const size = 16 * MIB;
	const inFlight = deferred();
	let calls = 0;
	const record = tracker(events);
	const first = record.next('file-paused');
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(size, {}, net),
		transport: async (url, init) => {
			calls++;
			inFlight.resolve();
			if (calls === 1) return holdUntilAborted(init.signal);
			return responseLike(200, { done: true, committed: size });
		}
	});
	const handle = engine.start([fakeFile('Movie.mp4', size)], {
		path: '/0:/',
		getHeaders: () => ({}),
		onEvent: record.onEvent
	});
	await inFlight.promise;
	handle.pause();
	const userPause = await first.promise;
	assert.equal(userPause.reason, 'user');
	await tick();
	net.down = true;
	const second = record.next('file-paused');
	assert.equal(handle.resume(0), true);
	const event = await second.promise;
	await tick();
	assert.equal(events.filter(item => item.type === 'file-paused').length, 2);
	assert.equal(event.reason, 'stalled');
	assert.equal(event.confirmed, false);
	assert.equal(event.eta, null);
	assert.match(event.message, /could not reach Google Drive/);
	assert.deepEqual(handle.summary(), { active: 0, paused: 1, unfinished: 1 });

	// Once the line is back the same button resumes the file for real.
	net.down = false;
	const done = record.next('file-done');
	handle.resume(0);
	await done.promise;
	const state = await handle.done;
	assert.equal(state.succeeded, 1);
});

test('a session that cannot be opened parks the file and a resume starts it', TIMEOUT, async () => {
	const events = [];
	const log = {};
	const net = { startOverride: () => { throw new TypeError('network unreachable'); } };
	const record = tracker(events);
	const parked = record.next('file-paused');
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(16 * MIB, log, net),
		transport: async () => responseLike(200, { done: true, committed: 16 * MIB })
	});
	const handle = engine.start([fakeFile('Later.bin', 16 * MIB)], { path: '/0:/', getHeaders: () => ({}), onEvent: record.onEvent });
	const event = await parked.promise;
	await tick();
	assert.equal(event.reason, 'stalled');
	assert.equal(event.confirmed, false);
	assert.match(event.message, /could not reach Google Drive to start/);
	assert.deepEqual(handle.summary(), { active: 0, paused: 1, unfinished: 1 });
	assert.ok(!events.some(item => item.type === 'file-error'));

	net.startOverride = null;
	const done = record.next('file-done');
	handle.resume(0);
	await done.promise;
	const state = await handle.done;
	assert.equal(state.succeeded, 1);
	assert.equal(log.starts.length, 2, 'the start that failed offline is retried once the line is back');
});

test('a rejected admin sign-in at the start is an error, not a pause', TIMEOUT, async () => {
	const events = [];
	const net = { startOverride: () => responseLike(401, {}) };
	const engine = new Engine({
		now: () => 0,
		sleep: () => Promise.resolve(),
		fetchImpl: sessionFetch(16 * MIB, {}, net),
		transport: async () => responseLike(200, { done: true, committed: 16 * MIB })
	});
	const state = await engine.upload([fakeFile('A.bin', 16 * MIB)], { path: '/0:/', getHeaders: () => ({}), onEvent: collecting(events) });
	assert.equal(state.failed, 1);
	assert.match(events.find(event => event.type === 'file-error').message, /Admin sign-in expired/);
	assert.ok(!events.some(event => event.type === 'file-paused'));
});

test('the speed meter restarts after a pause instead of averaging across it', () => {
	let clock = 0;
	const meter = new SpeedMeter(() => clock, 8000);
	meter.confirm(0);
	clock = 1000;
	meter.confirm(10);
	assert.equal(meter.speed(), 10);
	clock = 600000;
	meter.reset();
	meter.confirm(10);
	assert.equal(meter.speed(), null, 'no speed until the transfer moves again');
	clock = 601000;
	meter.confirm(20);
	assert.equal(meter.speed(), 10, 'the new speed ignores the time spent paused');
});

test('the speed meter drops in-flight bytes the server did not keep', () => {
	let clock = 0;
	const meter = new SpeedMeter(() => clock, 8000);
	meter.confirm(0);
	clock = 1000;
	meter.sample(16, true);
	clock = 2000;
	meter.confirm(10);
	assert.equal(meter.speed(), 5, 'only the confirmed 10 bytes count');
	assert.deepEqual(meter.samples.map(sample => sample.b), [0, 10]);
});
