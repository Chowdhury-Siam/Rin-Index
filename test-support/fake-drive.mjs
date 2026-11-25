/**
 * An in-memory Google Drive that answers the requests the Worker makes, for
 * the Worker tests and the local smoke server. It keeps a tree of items,
 * honours the `fields` parameter the way Drive does (an unrequested field is
 * simply absent), paginates lists, and offers fault injection.
 *
 *   const drive = createFakeDrive();
 *   t.mock.method(globalThis, 'fetch', drive.fetch);
 *   drive.folder('Season 1', ['root']);
 *   drive.file('a.txt', ['id-1'], { size: '3' });
 *   drive.failWith('files.update', 403);
 *
 * Every request is recorded in drive.calls as { kind, method, url, query }.
 */

const FOLDER = 'application/vnd.google-apps.folder';
const SCOPE_ERROR = {
	error: {
		code: 403,
		message: 'Insufficient Permission: Request had insufficient authentication scopes.',
		errors: [{
			message: 'Insufficient Permission: Request had insufficient authentication scopes.',
			domain: 'global',
			reason: 'insufficientPermissions'
		}]
	}
};
const ALL_CAPABILITIES = ['canRename', 'canTrash', 'canDelete', 'canMoveItemWithinDrive', 'canDownload'];

function driveError(status, reason, message) {
	return Response.json({
		error: { code: status, message, errors: [{ message, domain: 'global', reason }] }
	}, { status });
}

// The fields of one item that a `fields` value names, e.g.
// "id,name,parents,capabilities(canRename,canTrash)".
function project(item, fields) {
	const out = {};
	// "id,name,parents,capabilities(a,b)": commas inside parentheses
	// belong to the nested part.
	const pattern = /([\w.]+)(?:\(([^)]*)\))?\s*(?:,|$)/g;
	for (const match of String(fields || '').matchAll(pattern)) {
		const [, key, nested] = match;
		if (item[key] === undefined) continue;
		if (nested !== undefined && item[key] && typeof item[key] === 'object') {
			const picked = {};
			for (const name of nested.split(',')) {
				if (item[key][name.trim()] !== undefined) picked[name.trim()] = item[key][name.trim()];
			}
			out[key] = picked;
		} else {
			out[key] = item[key];
		}
	}
	return out;
}

function unescapeQueryValue(value) {
	return value.replaceAll("\\'", "'").replaceAll('\\\\', '\\');
}

/** What a Drive query asks for: parents, an exact name, and "contains" words. */
function parseQuery(query) {
	const parents = [...query.matchAll(/'((?:[^'\\]|\\.)*)' in parents/g)].map(match => unescapeQueryValue(match[1]));
	const name = /name = '((?:[^'\\]|\\.)*)'/.exec(query);
	const folderOnly = query.includes("mimeType = '" + FOLDER + "'");
	const words = [...query.matchAll(/name contains '((?:[^'\\]|\\.)*)'/g)].map(match => unescapeQueryValue(match[1]));
	return { parents, name: name ? unescapeQueryValue(name[1]) : null, folderOnly, words };
}

// "folder,name,modifiedTime desc": folders first, then by name, newest first
// among equal names.
function compareItems(orderBy) {
	const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
	return (a, b) => {
		const folders = Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER);
		if (folders) return folders;
		if (!orderBy?.includes('name')) return 0;
		return byName(a, b) || (b.modifiedTime || '').localeCompare(a.modifiedTime || '');
	};
}

export function createFakeDrive(options = {}) {
	const rootId = options.rootId || 'root';
	let nextId = 1;
	let nextSession = 1;
	const items = new Map();
	const sessions = new Map();
	const failures = [];

	const drive = {
		rootId,
		calls: [],
		items,
		sessions,
		quota: {
			limit: '1099511627776',
			usage: '698976482740',
			usageInDrive: '698976482740',
			usageInDriveTrash: '0'
		},
		// 'full' answers writes; 'readonly' refuses each of them the way a
		// token authorized for drive.readonly does.
		scope: 'full',
		// While true every call fails as a network error.
		offline: false,
		// Pages of this many items per list page; 0 uses the requested
		// pageSize, as Drive does.
		pageSize: 0,

		/** Adds an item; the parent 'root' means the index root. */
		add(fields = {}) {
			const id = fields.id || 'id-' + nextId++;
			const { folder, ...rest } = fields;
			const item = {
				trashed: false,
				modifiedTime: '2026-11-20T10:00:00.000Z',
				capabilities: Object.fromEntries(ALL_CAPABILITIES.map(name => [name, true])),
				...rest,
				id,
				name: fields.name || id,
				mimeType: fields.mimeType || (folder ? FOLDER : 'text/plain'),
				parents: (fields.parents || [rootId]).map(parent => parent === 'root' ? rootId : parent),
				...(fields.size === undefined ? {} : { size: String(fields.size) })
			};
			items.set(id, item);
			return item;
		},
		folder(name, parents, extra = {}) {
			return drive.add({ name, parents, folder: true, ...extra });
		},
		file(name, parents, extra = {}) {
			return drive.add({ name, parents, size: 0, ...extra });
		},
		find(name, parentId = rootId) {
			return [...items.values()].find(item => item.name === name && item.parents.includes(parentId));
		},
		children(parentId = rootId) {
			return [...items.values()].filter(item => item.parents.includes(parentId));
		},
		visible(parentId = rootId) {
			return drive.children(parentId).filter(item => !item.trashed);
		},
		trash() {
			return [...items.values()].filter(item => item.trashed);
		},

		/** Makes the next `times` calls of a kind fail with an HTTP status. */
		failWith(kind, status, times = 1) {
			failures.push({ kind, status, times });
		},

		/** Lets Drive expire every open upload session. */
		expireSessions() {
			for (const session of sessions.values()) session.expired = true;
		},
		openSessions() {
			return sessions.size;
		},
		/** The bytes every open session has received so far. */
		received() {
			return [...sessions.values()].reduce((sum, session) => sum + session.bytes.length, 0);
		},

		// A small tree that resembles a real index.
		seed() {
			const season = drive.folder('Season 1', [rootId]);
			drive.file('Episode 01.mkv', [season.id], { size: '115862272', mimeType: 'video/x-matroska' });
			drive.file('Episode 02.mkv', [season.id], { size: '120586240', mimeType: 'video/x-matroska' });
			drive.file('Notes.md', [rootId], { size: '120' });
			return drive;
		},
		reset() {
			drive.calls.length = 0;
			failures.length = 0;
		}
	};
	drive.fetch = (input, init) => handle(input, init);
	drive.count = kind => drive.calls.filter(call => call.kind === kind).length;
	return drive;

	async function readBody(init = {}) {
		const { body } = init;
		if (body == null) return null;
		if (typeof body === 'string') return body;
		if (body instanceof URLSearchParams) return body.toString();
		return new Response(body).text();
	}

	function answerRange(session) {
		// Drive answers an empty session without a Range header.
		return session.bytes.length
			? { Range: 'bytes=0-' + (session.bytes.length - 1) }
			: {};
	}

	async function handle(input, init = {}) {
		const url = new URL(input);
		const method = String(init.method || 'GET').toUpperCase();
		let kind = 'other';
		if (url.hostname === 'oauth2.googleapis.com') kind = 'token';
		else if (url.pathname === '/drive/v3/about') kind = 'about.get';
		else if (url.pathname === '/drive/v3/files') kind = method === 'POST' ? 'files.create' : 'files.list';
		else if (url.pathname.startsWith('/drive/v3/files/')) kind = method === 'GET' ? 'files.get' : `files.${{ POST: 'create', PATCH: 'update', DELETE: 'delete' }[method] || method.toLowerCase()}`;
		// The session URL shares the path of the session start; the method
		// tells them apart.
		else if (url.pathname.startsWith('/upload/drive/v3/files')) kind = { POST: 'session.start', DELETE: 'session.delete' }[method] || 'session.put';
		drive.calls.push({ kind, method, url, query: url.searchParams, headers: init.headers, body: init.body });

		if (drive.offline) throw new TypeError('fetch failed');
		const position = failures.findIndex(failure => failure.kind === kind);
		if (position !== -1) {
			const [failure] = failures.splice(position, 1);
			if (--failure.times > 0) failures.splice(position, 0, failure);
			return driveError(failure.status, 'backendError', `Injected HTTP ${failure.status} for ${kind}.`);
		}

		if (kind === 'token') {
			const form = new URLSearchParams(await readBody(init));
			if (form.get('grant_type') !== 'refresh_token') return driveError(400, 'invalid_request', 'Invalid grant type.');
			return Response.json({ access_token: 'test-access', expires_in: 3600 });
		}

		if (kind === 'about.get') return Response.json({ storageQuota: { ...drive.quota } });

		if (kind === 'files.list') {
			const query = parseQuery(url.searchParams.get('q') || '');
			let list = [...items.values()].filter(item => !item.trashed && item.name !== '.password');
			if (query.parents.length) list = list.filter(item => query.parents.some(parent => item.parents.includes(parent)));
			if (query.folderOnly) list = list.filter(item => item.mimeType === FOLDER);
			if (query.name !== null) list = list.filter(item => item.name === query.name);
			for (const word of query.words) list = list.filter(item => item.name.includes(word));
			list.sort(compareItems(url.searchParams.get('orderBy')));
			const size = drive.pageSize || Number(url.searchParams.get('pageSize')) || 100;
			const start = Number(url.searchParams.get('pageToken')) || 0;
			const page = list.slice(start, start + size);
			const fileFields = /files\((.*)\)/.exec(url.searchParams.get('fields') || '')?.[1] ?? '';
			const body = {};
			if (start + size < list.length) body.nextPageToken = String(start + size);
			body.files = page.map(item => project(item, fileFields));
			return Response.json(body);
		}

		if (kind === 'files.get') {
			const id = url.pathname.split('/')[4];
			// The root folder always exists, whatever the configured ID.
			const item = items.get(id) || (id === rootId ? { id, name: 'My Drive', mimeType: FOLDER } : undefined);
			if (!item) return driveError(404, 'notFound', 'File not found: ' + id);
			if (url.searchParams.get('alt') === 'media') return new Response('media of ' + item.name);
			if (url.searchParams.has('mimeType')) return new Response('export of ' + item.name);
			return Response.json(project(item, url.searchParams.get('fields') || ''));
		}

		const writing = kind === 'files.create' || kind === 'files.update' || kind === 'files.delete' || kind === 'session.start';
		if (writing && drive.scope === 'readonly') return Response.json(SCOPE_ERROR, { status: 403 });

		if (kind === 'files.create') {
			const body = JSON.parse(await readBody(init));
			return Response.json(project(drive.add(body), url.searchParams.get('fields') || ''));
		}

		if (kind === 'files.update') {
			const item = items.get(url.pathname.split('/')[4]);
			if (!item) return driveError(404, 'notFound', 'File not found.');
			const text = await readBody(init);
			const body = text ? JSON.parse(text) : {};
			if (body.name !== undefined && body.name !== item.name) {
				if (item.mimeType === FOLDER && drive.find(body.name, item.parents[0])) {
					return driveError(409, 'conflict', 'A folder with this name already exists.');
				}
				item.name = body.name;
			}
			if (body.trashed !== undefined) item.trashed = Boolean(body.trashed);
			const addParents = url.searchParams.get('addParents');
			if (addParents !== null) {
				const removed = new Set((url.searchParams.get('removeParents') || '').split(',').filter(Boolean));
				item.parents = [...item.parents.filter(parent => !removed.has(parent)), ...addParents.split(',').filter(Boolean)]
					.filter((parent, index, all) => all.indexOf(parent) === index);
			}
			item.modifiedTime = new Date().toISOString();
			return Response.json(project(item, url.searchParams.get('fields') || ''));
		}

		if (kind === 'files.delete') {
			items.delete(url.pathname.split('/')[4]);
			return new Response(null, { status: 204 });
		}

		if (kind === 'session.start') {
			const body = JSON.parse(await readBody(init));
			const key = 'sess-' + nextSession++;
			sessions.set(key, {
				name: body.name,
				parents: body.parents,
				type: init.headers['X-Upload-Content-Type'],
				total: Number(init.headers['X-Upload-Content-Length']),
				bytes: new Uint8Array(0)
			});
			return new Response(null, {
				status: 200,
				headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + key }
			});
		}

		// An open resumable session: a status query, a chunk, or a cancel.
		const key = url.searchParams.get('upload_id');
		const session = sessions.get(key);
		if (!session) return driveError(404, 'notFound', 'Upload session not found.');
		if (kind === 'session.delete') {
			sessions.delete(key);
			return new Response(null, { status: 499 });
		}
		if (session.expired) return driveError(404, 'notFound', 'Upload session expired.');
		const range = String(init.headers['Content-Range'] || '');
		if (range.startsWith('bytes */')) {
			if (session.bytes.length === session.total) {
				return Response.json({ id: 'uploaded', name: session.name, size: String(session.total) }, { status: 200 });
			}
			return new Response(null, { status: 308, headers: answerRange(session) });
		}
		const chunk = /^bytes (\d+)-(\d+)\/(\d+|%)$/.exec(range);
		if (!chunk) return driveError(400, 'badRequest', 'Invalid Content-Range.');
		if (Number(chunk[1]) !== session.bytes.length) return new Response(null, { status: 308, headers: answerRange(session) });
		const bytes = new Uint8Array(await new Response(init.body ?? null).arrayBuffer());
		if (options.msPerMib) await new Promise(resolve => setTimeout(resolve, options.msPerMib * bytes.length / 1048576));
		session.bytes = new Uint8Array([...session.bytes, ...bytes]);
		if (session.bytes.length < session.total) return new Response(null, { status: 308, headers: answerRange(session) });
		const item = drive.add({
			name: session.name,
			parents: session.parents,
			size: session.total,
			mimeType: session.type || 'application/octet-stream',
			modifiedTime: new Date().toISOString()
		});
		drive.quota.usage = String(BigInt(drive.quota.usage) + BigInt(session.total));
		drive.quota.usageInDrive = String(BigInt(drive.quota.usageInDrive) + BigInt(session.total));
		sessions.delete(key);
		return Response.json(project(item, 'id,name,size,mimeType'), { status: session.total === 0 ? 200 : 201 });
	}
}
