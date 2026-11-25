// Rin Index upload engine: resumable multi-chunk uploads with live progress.
//
// Loaded as a classic script before app.js; exposes globalThis.RinUploadEngine.
// The engine is DOM-free and every dependency (transport, fetch, clock, sleep)
// is injectable, so the same code runs in the browser and in Node tests.
//
// Throughput design: chunks are sent sequentially on one Drive session (the
// resumable protocol forbids parallel ranges), so speed comes from keeping
// the pipe busy. The chunk size grows adaptively after fully committed
// chunks to amortize per-request overhead, multiple files transfer
// concurrently, and progress is sampled from bytes Google actually
// committed. Provisional in-flight samples smooth the display but roll back
// when a chunk fails, so retried bytes are never counted twice.
(function () {
	'use strict';

	const DEFAULT_MAX_CHUNK = 32 * 1024 * 1024;
	const MAX_ATTEMPTS = 5;

	function fatalError(message) {
		const error = new Error(message);
		error.fatal = true;
		return error;
	}

	// Rolling-window speed meter. Samples are (time, bytes) pairs; confirmed
	// samples count only bytes Google committed, provisional samples track
	// bytes in flight. confirm() keeps the provisional samples the server
	// actually committed and drops the rest, so a failed or partially
	// accepted chunk contributes no phantom progress.
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
			if (this.samples.length && this.samples[this.samples.length - 1].b > committed) return;
			this.samples = this.samples.filter(s => !s.p || s.b <= committed);
			this.samples.push({ t: this.now(), b: committed, p: false });
			this.mark = this.samples.length;
			this.prune();
		},
		rollback() {
			this.samples.length = this.mark;
			this.prune();
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
		// with bounded concurrency. Resolves when every file finished, with
		// {filesTotal, succeeded, failed, total}.
		async upload(files, ctx) {
			const items = files.map((file, index) => ({
				file, index, name: file.name, size: file.size,
				meter: null, committed: 0, displayed: 0, state: 'pending'
			}));
			const state = {
				items,
				totalBytes: items.reduce((sum, item) => sum + item.size, 0),
				succeeded: 0,
				failed: 0
			};
			const concurrency = Math.max(1, Math.min(ctx.concurrency || 1, items.length));
			this.emit(ctx, { type: 'batch-start', filesTotal: items.length, total: state.totalBytes });
			let cursor = 0;
			const lane = async () => {
				while (cursor < items.length) {
					const item = items[cursor++];
					await this.uploadFile(item, ctx, state);
				}
			};
			await Promise.all(Array.from({ length: concurrency }, () => lane()));
			this.emit(ctx, {
				type: 'batch-done',
				filesTotal: items.length,
				succeeded: state.succeeded,
				failed: state.failed,
				total: state.totalBytes
			});
			return { filesTotal: items.length, succeeded: state.succeeded, failed: state.failed, total: state.totalBytes };
		},

		async uploadFile(item, ctx, state) {
			const meter = new SpeedMeter(this.now, this.windowMs);
			item.meter = meter;
			item.state = 'starting';
			const total = item.size;
			const emitFile = event => {
				this.emit(ctx, Object.assign({ type: 'file-progress', index: item.index, name: item.name, total }, event));
				this.emitBatch(ctx, state);
			};
			this.emit(ctx, { type: 'file-start', index: item.index, name: item.name, total });
			this.emitBatch(ctx, state);
			meter.confirm(0);
			try {
				const session = await this.startSession(item.file, ctx);
				if (total === 0) {
					const data = await this.putChunk(session, ctx, 0, 0, null, null);
					if (!data.done) throw new Error('Google Drive did not accept the empty file.');
					item.committed = total;
					item.displayed = total;
					item.state = 'done';
					state.succeeded++;
					meter.confirm(total);
					emitFile({ uploaded: total, committed: total, percent: 100, speed: meter.speed(), eta: 0 });
					this.emit(ctx, { type: 'file-done', index: item.index, name: item.name, total });
					this.emitBatch(ctx, state);
					return;
				}

				const startChunk = session.chunk_size || 16 * 1024 * 1024;
				const maxChunk = Math.min(
					ctx.maxChunkSize || DEFAULT_MAX_CHUNK,
					Number.isInteger(session.max_chunk) ? session.max_chunk : Infinity
				);
				let chunkSize = Math.max(256 * 1024, Math.min(startChunk, maxChunk));
				let attempts = 0;
				let committed = 0;

				while (committed < total) {
					const length = Math.min(chunkSize, total - committed);
					const chunkStart = committed;
					const body = item.file.slice(chunkStart, chunkStart + length);
					let inFlight = 0;
					const onProgress = loaded => {
						if (typeof loaded !== 'number' || loaded < 0) return;
						inFlight = Math.min(loaded, length);
						const uploaded = Math.min(chunkStart + inFlight, total);
						if (uploaded > item.displayed) {
							item.displayed = uploaded;
							meter.sample(uploaded, true);
							const speed = meter.speed();
							emitFile({
								uploaded,
								committed,
								percent: total ? uploaded / total * 100 : 100,
								speed,
								eta: speed ? (total - committed) / speed : null
							});
						}
					};
					try {
						const data = await this.putChunk(session, ctx, chunkStart, length, body, onProgress);
						if (data.done) {
							committed = total;
							meter.confirm(total);
							item.committed = total;
							item.displayed = total;
							item.state = 'done';
							state.succeeded++;
							emitFile({ uploaded: total, committed: total, percent: 100, speed: meter.speed(), eta: 0 });
							this.emit(ctx, { type: 'file-done', index: item.index, name: item.name, total });
							this.emitBatch(ctx, state);
							return;
						}
						committed = data.committed;
						meter.confirm(committed);
						item.committed = committed;
						item.displayed = Math.max(item.displayed, committed);
						item.state = 'uploading';
						const speed = meter.speed();
						emitFile({
							uploaded: item.displayed,
							committed,
							percent: item.displayed / total * 100,
							speed,
							eta: speed ? (total - committed) / speed : null
						});
						if (committed === chunkStart + length) {
							chunkSize = Math.min(chunkSize * 2, maxChunk);
							attempts = 0;
						}
					} catch (error) {
						meter.rollback();
						if (error && error.fatal) throw error;
						attempts++;
						if (attempts >= MAX_ATTEMPTS) {
							throw new Error((error && error.message ? error.message + ' ' : '') +
								'The upload paused after several retries. Try again to resume from where it stopped.');
						}
						item.state = 'retrying';
						this.emit(ctx, {
							type: 'file-retry',
							index: item.index,
							name: item.name,
							attempt: attempts,
							message: error && error.message ? error.message : 'The chunk upload failed.',
							committed
						});
						await this.sleep(Math.min(400 * attempts, 2000));
						committed = await this.queryStatus(session, ctx);
						meter.confirm(committed);
						item.committed = committed;
						item.displayed = committed;
						chunkSize = Math.max(256 * 1024, Math.min(startChunk, maxChunk));
						const speed = meter.speed();
						emitFile({
							uploaded: committed,
							committed,
							percent: total ? committed / total * 100 : 100,
							speed,
							eta: speed ? (total - committed) / speed : null
						});
					}
				}

				// The server confirmed every byte but never reported completion.
				const final = await this.queryStatus(session, ctx);
				if (final < total) throw new Error('Google Drive stopped confirming this upload.');
				committed = total;
				meter.confirm(total);
				item.committed = total;
				item.displayed = total;
				item.state = 'done';
				state.succeeded++;
				emitFile({ uploaded: total, committed: total, percent: 100, speed: meter.speed(), eta: 0 });
				this.emit(ctx, { type: 'file-done', index: item.index, name: item.name, total });
				this.emitBatch(ctx, state);
			} catch (error) {
				item.state = 'error';
				state.failed++;
				this.emit(ctx, {
					type: 'file-error',
					index: item.index,
					name: item.name,
					message: error && error.message ? error.message : 'The upload failed.'
				});
				this.emitBatch(ctx, state);
			}
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
				throw new Error((data && data.error) || 'The upload could not start.');
			}
			return data;
		},

		async putChunk(session, ctx, offset, length, body, onProgress) {
			const url = ctx.path + '?upload=chunk&u=' + encodeURIComponent(session.token) +
				'&offset=' + offset + '&len=' + length;
			const init = { method: 'PUT', headers: Object.assign({}, ctx.getHeaders()), body };
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

		emit(ctx, event) {
			if (typeof ctx.onEvent !== 'function') return;
			try { ctx.onEvent(event); } catch {}
		},

		emitBatch(ctx, state) {
			const items = state.items;
			let uploaded = 0;
			let confirmed = 0;
			let speed = 0;
			let speedKnown = false;
			for (const item of items) {
				uploaded += item.displayed;
				confirmed += item.committed;
				if (item.meter) {
					const value = item.meter.speed();
					if (value != null) { speed += value; speedKnown = true; }
				}
			}
			this.emit(ctx, {
				type: 'batch-progress',
				uploaded,
				committed: confirmed,
				total: state.totalBytes,
				percent: state.totalBytes ? uploaded / state.totalBytes * 100 : 100,
				speed: speedKnown ? speed : null,
				eta: speedKnown && speed > 0 ? (state.totalBytes - confirmed) / speed : null,
				filesDone: state.succeeded + state.failed,
				filesTotal: items.length,
				succeeded: state.succeeded,
				failed: state.failed
			});
		}
	};

	globalThis.RinUploadEngine = { Engine: UploadEngine, SpeedMeter, DEFAULT_MAX_CHUNK };
})();