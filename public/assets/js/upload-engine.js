// Rin Index upload engine: resumable multi-chunk uploads with live progress,
// pause / resume / cancel, and a measurement of where the upload time goes.
//
// Loaded as a classic script before app.js; exposes globalThis.RinUploadEngine.
// The engine is DOM-free and every dependency (transport, fetch, clock, sleep)
// is injectable, so the same code runs in the browser and in Node tests.
//
// Throughput design: Google only reveals where the next chunk may start after
// it confirms the previous one, so the chunks of one file go out one at a time
// and no byte moves between a chunk's last byte and Google's answer. That fixed
// pause is paid once per chunk, so the chunk size doubles after every fully
// committed chunk, up to the ceiling the Worker advertises, and several files
// transfer concurrently. Progress is sampled from bytes Google committed;
// provisional in-flight samples smooth the display but are dropped when a
// chunk fails, so retried bytes are never counted twice.
//
// Control design: each file owns one Drive upload session from its first byte
// to its last. Pausing aborts the chunk in flight and keeps the session, so
// resuming asks Drive which bytes it committed and continues from there
// instead of starting over or creating a second file. Cancelling aborts the
// transfer, stops the automatic retries, and asks the Worker to close the
// session. A transfer that keeps failing is parked as paused rather than
// reported as lost, so it can be resumed once the connection is back.
//
// Measurement: every chunk attempt is split into the time bytes were leaving
// the browser and the time spent waiting for Google Drive's confirmation.
// Both are summed per file and per batch (file-done, batch-progress, and the
// handle's report()), which shows whether a slow upload is limited by the
// line itself or by the pauses between chunks.
(function () {
	'use strict';

	const KIB = 1024;
	const MIB = 1024 * 1024;
	// Google commits bytes in 256 KiB units, so every chunk size is a multiple.
	const CHUNK_UNIT = 256 * KIB;
	// First chunk the browser sends. Small enough to lose little on a flaky
	// link, large enough to keep per-request overhead low.
	const START_CHUNK = 16 * MIB;
	// Largest chunk this browser ever sends: the biggest multiple of 256 KiB
	// below the 100 MB request-body limit of Cloudflare Free and Pro zones.
	// The Worker advertises its own ceiling and the lower of the two wins.
	const CLIENT_MAX_CHUNK = 95 * MIB;
	// Failed chunk attempts before the file is parked as paused.
	const MAX_ATTEMPTS = 5;
	// Status checks when settling a pause or confirming a resume. Google may
	// still be finishing an interrupted chunk when the first query arrives.
	const SETTLE_ATTEMPTS = 3;
	const FINAL = { done: true, cancelled: true, error: true };
	const ABORT = typeof AbortController === 'function'
		? AbortController
		: function () { this.signal = {}; this.abort = function () {}; };

	function fatalError(message) {
		const error = new Error(message);
		error.fatal = true;
		return error;
	}

	function errorMessage(error, fallback) {
		return error && error.message ? error.message : fallback;
	}

	// Rounds a chunk size down to Google's 256 KiB unit.
	function chunkUnit(size) {
		if (!Number.isFinite(size)) return size;
		return Math.max(CHUNK_UNIT, Math.floor(size / CHUNK_UNIT) * CHUNK_UNIT);
	}

	// Rolling-window speed meter. Samples are (time, bytes) pairs; confirmed
	// samples count only bytes Google committed, provisional samples track
	// bytes in flight. confirm() drops the provisional samples the server did
	// not keep, so a failed or partly accepted chunk contributes no phantom
	// progress. reset() drops every sample so a resumed transfer is measured
	// from its restart, not from a sample taken before a long pause.
	function SpeedMeter(now, windowMs) {
		this.now = now;
		this.windowMs = windowMs === undefined ? 8000 : windowMs;
		this.samples = [];
		this.mark = 0;
	}

	SpeedMeter.prototype = {
		sample(bytes, provisional) {
			this.samples.push({ t: this.now(), b: bytes, p: !!provisional });
			this.prune();
		},
		confirm(committed) {
			this.samples = this.samples.filter(sample => !sample.p || sample.b <= committed);
			const last = this.samples[this.samples.length - 1];
			if (!last || last.b !== committed) this.samples.push({ t: this.now(), b: committed, p: false });
			this.mark = this.samples.length;
			this.prune();
		},
		rollback() {
			this.samples.length = this.mark;
			this.prune();
		},
		reset() {
			this.samples = [];
			this.mark = 0;
		},
		prune() {
			const cutoff = this.now() - this.windowMs;
			let drop = 0;
			while (drop + 2 < this.samples.length && this.samples[drop + 1].t < cutoff) drop++;
			if (drop) {
				this.samples.splice(0, drop);
				this.mark = Math.max(0, this.mark - drop);
			}
		},
		speed() {
			if (this.samples.length < 2) return null;
			const first = this.samples[0];
			const last = this.samples[this.samples.length - 1];
			const seconds = (last.t - first.t) / 1000;
			if (seconds <= 0) return null;
			return Math.max(0, (last.b - first.b) / seconds);
		}
	};

	function UploadEngine(options) {
		this.fetchImpl = options.fetchImpl || function (url, init) { return fetch(url, init); };
		this.transport = options.transport || null;
		this.now = options.now || function () {
			return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
		};
		this.sleep = options.sleep || function (ms) { return new Promise(resolve => setTimeout(resolve, ms)); };
		this.windowMs = options.windowMs === undefined ? 8000 : options.windowMs;
	}

	UploadEngine.prototype = {
		// Uploads an array of File-like objects ({name, size, type, slice})
		// with bounded concurrency. Resolves when every file finished, was
		// cancelled, or failed, with {filesTotal, succeeded, failed, cancelled,
		// total}. A paused file keeps the promise pending until it is resumed
		// or cancelled.
		upload(files, ctx) {
			return this.start(files, ctx).done;
		},

		// Same as upload(), plus controls over the running batch:
		//   pause(index)  stop sending chunks for one file (every file when
		//                 omitted) and keep its Drive session
		//   resume(index) ask Drive for the committed byte and continue
		//   cancel(index) stop the transfer and retries, close the session
		//   summary()     {active, paused, unfinished} live counters
		//   report()      per-file and batch timing of the transfer so far
		start(files, ctx) {
			const items = files.map((file, index) => ({
				file, index, name: file.name, size: file.size,
				meter: new SpeedMeter(this.now, this.windowMs),
				committed: 0, displayed: 0, state: 'pending',
				session: null, control: null, controller: null, task: null,
				started: false, reason: '', message: '',
				retries: 0, chunks: {}, sendMs: 0, waitMs: 0, activeMs: 0, activeSince: null
			}));
			const state = {
				items,
				totalBytes: items.reduce((sum, item) => sum + item.size, 0),
				succeeded: 0,
				failed: 0,
				cancelled: 0,
				active: 0,
				settled: false,
				startedAt: this.now(),
				endedAt: null
			};
			const concurrency = Math.max(1, Math.min(ctx.concurrency || 1, items.length || 1));
			let finish;
			const done = new Promise(resolve => { finish = resolve; });

			const settle = () => {
				if (state.settled) return true;
				if (items.some(item => !FINAL[item.state])) return false;
				state.settled = true;
				state.endedAt = this.now();
				const result = {
					filesTotal: items.length,
					succeeded: state.succeeded,
					failed: state.failed,
					cancelled: state.cancelled,
					total: state.totalBytes
				};
				this.emit(ctx, Object.assign({ type: 'batch-done' }, result));
				finish(result);
				return true;
			};
			const pump = () => {
				if (state.settled) return;
				for (const item of items) {
					if (state.active >= concurrency) break;
					if (item.state !== 'pending' && item.state !== 'queued') continue;
					state.active++;
					item.task = this.runItem(item, ctx, state).then(() => {
						state.active--;
						item.task = null;
						if (!settle()) {
							pump();
							this.emitBatch(ctx, state);
						}
					});
				}
			};
			const each = index => items.filter(item => index === undefined || item.index === index);
			// Parks a file that never opened a session (still waiting for a
			// lane), so there is nothing to confirm with Drive.
			const parkNow = item => {
				item.control = null;
				item.state = 'paused';
				item.reason = 'user';
				this.emit(ctx, {
					type: 'file-paused',
					index: item.index,
					name: item.name,
					total: item.size,
					uploaded: 0,
					committed: 0,
					percent: 0,
					speed: null,
					eta: null,
					reason: 'user',
					message: '',
					confirmed: true
				});
			};
			const control = {
				done,
				pause: index => {
					let changed = false;
					for (const item of each(index)) {
						if (FINAL[item.state] || item.control || item.state === 'paused' || item.state === 'cancelling') continue;
						if (item.state === 'pending' || item.state === 'queued') parkNow(item);
						else {
							item.control = 'pause';
							if (item.controller) item.controller.abort();
						}
						changed = true;
					}
					if (changed) this.emitBatch(ctx, state);
					return changed;
				},
				resume: index => {
					let changed = false;
					for (const item of each(index)) {
						if (item.state !== 'paused') continue;
						item.control = null;
						item.reason = '';
						item.message = '';
						item.state = 'queued';
						changed = true;
					}
					if (changed) pump();
					return changed;
				},
				cancel: index => {
					let changed = false;
					for (const item of each(index)) {
						if (FINAL[item.state] || item.state === 'cancelling') continue;
						changed = true;
						if (item.state === 'pending' || item.state === 'queued' || item.state === 'paused') {
							// Nothing is in flight, so close the session directly.
							item.control = null;
							item.task = this.finishCancel(item, ctx, state).then(() => {
								item.task = null;
								if (!settle()) pump();
							});
						} else {
							item.control = 'cancel';
							if (item.controller) item.controller.abort();
						}
					}
					return changed;
				},
				summary: () => ({
					active: items.filter(item => item.task && !FINAL[item.state] && item.state !== 'cancelling').length,
					paused: items.filter(item => item.state === 'paused').length,
					unfinished: items.filter(item => !FINAL[item.state]).length
				}),
				// Where the time went so far. sendMs is time bytes were leaving
				// the browser, waitMs is time between a chunk's last byte and
				// Google Drive's answer, activeMs is everything else a file
				// spent transferring (session start, status checks, retry
				// back-off) and excludes pauses.
				report: () => {
					const sum = key => items.reduce((total, item) => total + item[key], 0);
					return {
						elapsedMs: Math.max(0, (state.endedAt == null ? this.now() : state.endedAt) - state.startedAt),
						activeMs: sum('activeMs'),
						sendMs: sum('sendMs'),
						waitMs: sum('waitMs'),
						retries: sum('retries'),
						bytes: items.reduce((total, item) => total + (item.state === 'done' ? item.size : 0), 0),
						succeeded: state.succeeded,
						failed: state.failed,
						cancelled: state.cancelled,
						files: items.map(item => ({
							name: item.name,
							total: item.size,
							state: item.state,
							committed: item.committed,
							retries: item.retries,
							activeMs: item.activeMs,
							sendMs: item.sendMs,
							waitMs: item.waitMs,
							chunks: Object.keys(item.chunks)
								.map(Number)
								.sort((a, b) => a - b)
								.map(size => ({ size, count: item.chunks[size] }))
						}))
					};
				}
			};

			this.emit(ctx, { type: 'batch-start', filesTotal: items.length, total: state.totalBytes });
			this.emitBatch(ctx, state);
			pump();
			settle();
			return control;
		},

		// Wall-clock time a file spends transferring, pauses excluded.
		activate(item) {
			item.activeSince = this.now();
		},
		deactivate(item) {
			if (item.activeSince == null) return;
			item.activeMs += Math.max(0, this.now() - item.activeSince);
			item.activeSince = null;
		},

		// Runs one file from its current position until it finishes, pauses,
		// is cancelled, or fails. A resumed file runs through here a second
		// time with its session still attached.
		async runItem(item, ctx, state) {
			const total = item.size;
			const meter = item.meter;
			const emitFile = event => {
				this.emit(ctx, Object.assign({ type: 'file-progress', index: item.index, name: item.name, total }, event));
				this.emitBatch(ctx, state);
			};
			try {
				const resuming = item.state === 'queued';
				if (!item.started) {
					item.state = 'starting';
					this.activate(item);
					this.emit(ctx, { type: 'file-start', index: item.index, name: item.name, total });
					this.emitBatch(ctx, state);
					meter.confirm(0);
					try {
						item.session = await this.startSession(item.file, ctx);
					} catch (error) {
						if (item.control === 'cancel') return await this.finishCancel(item, ctx, state);
						if (error && error.fatal) throw error;
						// No session exists, so the file starts over once resumed.
						return await this.park(item, ctx, state, 'stalled', 'Rin Index could not reach Google Drive to start the upload. Resume when you are back online.', false);
					}
					item.started = true;
				}
				const session = item.session;
				// Pause or cancel may have arrived while the session was opening.
				if (item.control) return await this.hold(item, ctx, state);

				if (total === 0) {
					item.state = 'uploading';
					const data = await this.putChunk(session, ctx, 0, 0, null, null, null);
					if (!data.done) throw new Error('Google Drive did not accept the empty file.');
					return this.finish(item, ctx, state);
				}

				let committed = item.committed;
				if (resuming) {
					item.state = 'resuming';
					this.activate(item);
					this.emit(ctx, { type: 'file-resumed', index: item.index, name: item.name, committed });
					this.emitBatch(ctx, state);
					// Always take the offset from Drive: it may be behind what
					// the browser sent for an interrupted chunk, or ahead of the
					// last value the browser saw.
					const confirmed = await this.confirmOffset(item, ctx);
					if (item.control) return await this.hold(item, ctx, state);
					if (confirmed === null) {
						return await this.park(item, ctx, state, 'stalled', 'Rin Index could not reach Google Drive to confirm the upload. Check the connection and resume again.', false);
					}
					if (confirmed >= total) return this.finish(item, ctx, state);
					committed = confirmed;
					item.committed = committed;
					item.displayed = committed;
					meter.reset();
					meter.confirm(committed);
					emitFile({
						uploaded: committed,
						committed,
						percent: committed / total * 100,
						speed: null,
						eta: null
					});
				}

				const startChunk = Math.min(chunkUnit(session.chunk_size || START_CHUNK), CLIENT_MAX_CHUNK);
				// The Worker's ceiling and this browser's own ceiling (the
				// Cloudflare request-body limit) both apply.
				const hardMax = Math.max(CHUNK_UNIT, Math.min(
					CLIENT_MAX_CHUNK,
					chunkUnit(Number.isInteger(session.max_chunk) ? session.max_chunk : Infinity),
					chunkUnit(Number.isFinite(ctx.maxChunkSize) ? ctx.maxChunkSize : Infinity)
				));
				let chunkSize = Math.min(startChunk, hardMax);
				let attempts = 0;

				while (committed < total) {
					if (item.control) return await this.hold(item, ctx, state);
					const length = Math.min(chunkSize, total - committed);
					const chunkStart = committed;
					const body = item.file.slice(chunkStart, chunkStart + length);
					const controller = new ABORT();
					item.controller = controller;
					item.state = 'uploading';
					const startedAt = this.now();
					let sentAt = 0;
					let inFlight = 0;
					const onProgress = loaded => {
						if (typeof loaded !== 'number' || loaded < 0) return;
						sentAt = this.now();
						inFlight = Math.min(loaded, length);
						const uploaded = Math.min(chunkStart + inFlight, total);
						if (uploaded > item.displayed) {
							item.displayed = uploaded;
							meter.sample(uploaded, true);
							const speed = meter.speed();
							emitFile({
								uploaded,
								committed,
								percent: uploaded / total * 100,
								speed,
								eta: speed ? (total - committed) / speed : null
							});
						}
					};
					// Splits one chunk attempt between sending bytes and waiting
					// for Google Drive to confirm them. A transport without
					// progress events counts all of it as sending.
					const account = () => {
						const mark = sentAt || this.now();
						item.sendMs += Math.max(0, mark - startedAt);
						item.waitMs += Math.max(0, this.now() - mark);
					};
					try {
						const data = await this.putChunk(session, ctx, chunkStart, length, body, onProgress, controller.signal);
						item.controller = null;
						account();
						// Every chunk Google kept in full counts for the report.
						if (data.done || data.committed === chunkStart + length) {
							item.chunks[length] = (item.chunks[length] || 0) + 1;
						}
						if (data.done) return this.finish(item, ctx, state);
						committed = data.committed;
						meter.confirm(committed);
						item.committed = committed;
						item.displayed = committed;
						const speed = meter.speed();
						emitFile({
							uploaded: committed,
							committed,
							percent: committed / total * 100,
							speed,
							eta: speed ? (total - committed) / speed : null
						});
						if (committed === chunkStart + length) {
							// Fully committed: the link is healthy, so pay the
							// pause between chunks less often from now on.
							chunkSize = Math.min(chunkSize * 2, hardMax);
							attempts = 0;
						}
					} catch (error) {
						item.controller = null;
						account();
						meter.rollback();
						item.displayed = item.committed;
						// The browser stopped this chunk on purpose (pause or
						// cancel); that is not a failure.
						if (item.control) return await this.hold(item, ctx, state);
						if (error && error.fatal) throw error;
						attempts++;
						item.retries++;
						item.state = 'retrying';
						this.emit(ctx, {
							type: 'file-retry',
							index: item.index,
							name: item.name,
							attempt: attempts,
							limit: MAX_ATTEMPTS,
							message: errorMessage(error, 'The chunk upload failed.'),
							committed
						});
						this.emitBatch(ctx, state);
						await this.sleep(Math.min(400 * attempts, 2000));
						if (item.control) return await this.hold(item, ctx, state);
						if (attempts >= MAX_ATTEMPTS) {
							// Keep the session and hand control back: the file
							// resumes from the committed byte once the
							// connection returns.
							return await this.park(item, ctx, state, 'stalled', 'The connection kept failing. Resume when you are back online to continue from where it stopped.');
						}
						// Google may have kept any part of the interrupted
						// chunk, so ask before sending again.
						try {
							committed = await this.queryStatus(session, ctx);
						} catch (statusError) {
							// The status check needs the network too. The next
							// chunk attempt counts as the next try.
							if (statusError && statusError.fatal) throw statusError;
							committed = item.committed;
							chunkSize = Math.min(startChunk, hardMax);
							continue;
						}
						meter.confirm(committed);
						item.committed = committed;
						item.displayed = committed;
						item.state = 'uploading';
						chunkSize = Math.min(startChunk, hardMax);
						const speed = meter.speed();
						emitFile({
							uploaded: committed,
							committed,
							percent: committed / total * 100,
							speed,
							eta: speed ? (total - committed) / speed : null
						});
					}
				}

				// The server confirmed every byte but never reported completion.
				const final = await this.queryStatus(session, ctx);
				if (final < total) throw new Error('Google Drive stopped confirming this upload.');
				return this.finish(item, ctx, state);
			} catch (error) {
				if (item.control === 'cancel') return await this.finishCancel(item, ctx, state);
				this.fail(item, ctx, state, error);
			}
		},

		// Applies a pending pause or cancel to a file with no chunk in flight.
		async hold(item, ctx, state) {
			const control = item.control;
			item.control = null;
			item.controller = null;
			if (control === 'cancel') return this.finishCancel(item, ctx, state);
			return this.park(item, ctx, state, 'user');
		},

		// Stops the file and keeps its Drive session. Drive is asked how many
		// bytes it committed, so the bar and every later resume start from the
		// confirmed byte rather than from what the browser managed to send.
		async park(item, ctx, state, reason, message, confirm = true) {
			const total = item.size;
			this.deactivate(item);
			let confirmed = null;
			if (confirm && item.session) {
				confirmed = await this.confirmOffset(item, ctx);
				// A cancel that arrived during the status check wins.
				if (item.control === 'cancel') return this.finishCancel(item, ctx, state);
				if (total > 0 && confirmed >= total) return this.finish(item, ctx, state);
				if (confirmed !== null) item.committed = confirmed;
			}
			item.control = null;
			item.controller = null;
			item.state = 'paused';
			item.reason = reason;
			item.message = message || '';
			item.displayed = item.committed;
			item.meter.reset();
			this.emit(ctx, {
				type: 'file-paused',
				index: item.index,
				name: item.name,
				total,
				uploaded: item.committed,
				committed: item.committed,
				percent: total ? item.committed / total * 100 : 100,
				speed: null,
				eta: null,
				reason,
				message: item.message,
				confirmed: confirmed !== null
			});
			this.emitBatch(ctx, state);
		},

		// Stops the file for good: no further retries, and the Worker is asked
		// to close the Drive session so the partial bytes are discarded.
		async finishCancel(item, ctx, state) {
			this.deactivate(item);
			item.control = null;
			item.controller = null;
			item.state = 'cancelling';
			item.meter.reset();
			this.emitBatch(ctx, state);
			const closed = item.session ? await this.closeSession(item.session, ctx) : true;
			item.session = null;
			item.state = 'cancelled';
			item.displayed = item.committed;
			state.cancelled++;
			this.emit(ctx, {
				type: 'file-cancelled',
				index: item.index,
				name: item.name,
				total: item.size,
				committed: item.committed,
				closed
			});
			this.emitBatch(ctx, state);
		},

		finish(item, ctx, state) {
			const total = item.size;
			this.deactivate(item);
			item.control = null;
			item.controller = null;
			item.state = 'done';
			state.succeeded++;
			item.committed = total;
			item.displayed = total;
			item.meter.confirm(total);
			this.emit(ctx, {
				type: 'file-progress',
				index: item.index,
				name: item.name,
				total,
				uploaded: total,
				committed: total,
				percent: 100,
				speed: item.meter.speed(),
				eta: 0
			});
			this.emit(ctx, {
				type: 'file-done',
				index: item.index,
				name: item.name,
				total,
				activeMs: item.activeMs,
				sendMs: item.sendMs,
				waitMs: item.waitMs,
				retries: item.retries
			});
			this.emitBatch(ctx, state);
		},

		fail(item, ctx, state, error) {
			this.deactivate(item);
			item.control = null;
			item.controller = null;
			item.state = 'error';
			state.failed++;
			item.displayed = item.committed;
			item.meter.reset();
			this.emit(ctx, {
				type: 'file-error',
				index: item.index,
				name: item.name,
				message: errorMessage(error, 'The upload failed.')
			});
			this.emitBatch(ctx, state);
		},

		async startSession(file, ctx) {
			const response = await this.fetchImpl(ctx.path + '?upload=start', {
				method: 'POST',
				headers: Object.assign({ 'Content-Type': 'application/json' }, ctx.getHeaders()),
				body: JSON.stringify({ name: file.name, size: file.size, type: file.type || 'application/octet-stream' })
			});
			if (response.status === 401) throw fatalError('Admin sign-in expired. Sign in again and retry the upload.');
			let data = null;
			try { data = await response.json(); } catch {}
			if (!response.ok || !data || typeof data.token !== 'string' || !Number.isInteger(data.chunk_size)) {
				const error = new Error((data && data.error) || 'The upload could not start.');
				if (data && data.restart) error.fatal = true;
				throw error;
			}
			return data;
		},

		async putChunk(session, ctx, offset, length, body, onProgress, signal) {
			const url = ctx.path + '?upload=chunk&u=' + encodeURIComponent(session.token) +
				'&offset=' + offset + '&len=' + length;
			const init = { method: 'PUT', headers: Object.assign({}, ctx.getHeaders()), body };
			if (signal) init.signal = signal;
			const response = this.transport
				? await this.transport(url, init, onProgress)
				: await this.fetchImpl(url, init);
			if (response.status === 401) throw fatalError('Admin sign-in expired. Sign in again and retry the upload.');
			let data = null;
			try { data = await response.json(); } catch {}
			if (!response.ok || !data || typeof data.done !== 'boolean' || typeof data.committed !== 'number') {
				const error = new Error((data && data.error) || 'The chunk upload failed.');
				if (data && data.restart) {
					error.fatal = true;
					error.message = 'This upload session expired. Start the upload again.';
				}
				throw error;
			}
			return data;
		},

		async queryStatus(session, ctx) {
			const response = await this.fetchImpl(ctx.path + '?upload=status&u=' + encodeURIComponent(session.token), {
				method: 'POST',
				headers: Object.assign({}, ctx.getHeaders())
			});
			if (response.status === 401) throw fatalError('Admin sign-in expired. Sign in again and retry the upload.');
			let data = null;
			try { data = await response.json(); } catch {}
			if (response.ok && data && (data.done || typeof data.committed === 'number')) {
				return data.done ? session.total : data.committed;
			}
			const error = new Error((data && data.error) || 'Could not confirm how much of the file Google Drive received.');
			if (data && data.restart) {
				error.fatal = true;
				error.message = 'This upload session expired. Start the upload again.';
			}
			throw error;
		},

		// Asks Drive for the committed byte, retrying briefly because Google
		// can still be finishing an interrupted chunk. Returns null when Drive
		// stays unreachable; a dead session still throws.
		async confirmOffset(item, ctx) {
			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				if (attempt) await this.sleep(400 * attempt);
				try {
					return await this.queryStatus(item.session, ctx);
				} catch (error) {
					if (error && error.fatal) throw error;
				}
			}
			return null;
		},

		// Asks the Worker to close the Drive session. Best effort: false means
		// Drive could not confirm, and Google drops an abandoned session on
		// its own after a week.
		async closeSession(session, ctx) {
			try {
				const response = await this.fetchImpl(ctx.path + '?upload=cancel&u=' + encodeURIComponent(session.token), {
					method: 'POST',
					headers: Object.assign({}, ctx.getHeaders())
				});
				const data = await response.json();
				return Boolean(response.ok && data && data.cancelled);
			} catch {
				return false;
			}
		},

		emit(ctx, event) {
			if (typeof ctx.onEvent !== 'function') return;
			try { ctx.onEvent(event); } catch {}
		},

		emitBatch(ctx, state) {
			const items = state.items;
			let total = state.totalBytes;
			let uploaded = 0;
			let confirmed = 0;
			let speed = 0;
			let speedKnown = false;
			let sendMs = 0;
			let waitMs = 0;
			let retries = 0;
			let active = 0;
			let paused = 0;
			for (const item of items) {
				sendMs += item.sendMs;
				waitMs += item.waitMs;
				retries += item.retries;
				// Cancelled files are no longer part of the batch.
				if (item.state === 'cancelled') {
					total -= item.size;
					continue;
				}
				uploaded += item.displayed;
				confirmed += item.committed;
				if (item.state === 'paused') paused++;
				else if (!FINAL[item.state]) active++;
				if (!FINAL[item.state] && item.state !== 'paused') {
					const value = item.meter.speed();
					if (value != null) {
						speed += value;
						speedKnown = true;
					}
				}
			}
			const remaining = Math.max(0, total - confirmed);
			this.emit(ctx, {
				type: 'batch-progress',
				uploaded,
				committed: confirmed,
				total,
				percent: total ? uploaded / total * 100 : 100,
				speed: speedKnown ? speed : null,
				eta: speedKnown && speed > 0 ? remaining / speed : null,
				filesDone: state.succeeded + state.failed + state.cancelled,
				filesTotal: items.length,
				succeeded: state.succeeded,
				failed: state.failed,
				cancelled: state.cancelled,
				active,
				paused,
				retries,
				sendMs,
				waitMs
			});
		}
	};

	globalThis.RinUploadEngine = {
		Engine: UploadEngine,
		SpeedMeter,
		CLIENT_MAX_CHUNK,
		START_CHUNK,
		MAX_ATTEMPTS
	};
})();
