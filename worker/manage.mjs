/**
 * Admin-only file management for the indexed Google Drive tree (create
 * folders, rename, move, trash) and the storage summary of the connected
 * Google account.
 *
 * Items are addressed by their Drive file ID together with the index path of
 * the folder the browser listed them in. The Worker resolves that path from
 * the configured root, so it can only name a folder inside the index, then
 * asks Drive for the item and checks that it really is a child of that
 * folder. An ID from outside the indexed tree is therefore refused before
 * anything changes, and two files that share a name are told apart (Drive
 * names are not unique within a folder).
 *
 * Deleting moves items to Drive's trash, where they can be restored for 30
 * days. The storage summary reports how much the trash holds because trashed
 * files keep counting against the quota.
 *
 * Every action checks the admin pair before the request body is read or
 * Google Drive is contacted, and accepts JSON only: a cross-site form post
 * cannot send JSON, and a cross-origin script cannot attach JSON to a fetch
 * without a CORS preflight that this Worker never answers.
 */
import { folderMimeType } from './settings.mjs';
import { adminDenied, json } from './uploads.mjs';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const ITEM_FIELDS = 'id,name,mimeType,parents,trashed,capabilities(canRename,canTrash,canDelete,canMoveItemWithinDrive)';
// Items per move or delete request. A move costs up to three Drive calls per
// item (its metadata, a name check in the destination, the write), so a full
// batch stays well inside the 50 subrequests that Cloudflare Workers Free
// allows per request; the browser sends larger selections in several requests.
const BATCH_LIMIT = 12;
// One Drive metadata or write call gives up after this long.
const DRIVE_TIMEOUT = 20000;
// How long a storage summary is reused before Drive is asked again.
const STORAGE_TTL = 10 * 60 * 1000;
const MUTATIONS = { mkdir: true, rename: true, move: true, delete: true };
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UNREACHABLE = 'Google Drive could not be reached. Try again in a moment.';
const GONE = 'This item is no longer in this folder. Refresh the list and try again.';

// A failed step: what went wrong, plus the response the browser receives.
function failure(status, error, extra) {
	return {
		ok: false,
		status,
		error,
		code: extra?.code || 'drive',
		retry: extra?.retry === true,
		response: json(Object.assign({ error }, extra), status)
	};
}

/** The item fields the browser needs, and nothing else. */
function publicItem(item) {
	return { id: item.id, name: item.name, mimeType: item.mimeType };
}

// A name the index can address: no path separators or control characters,
// and not a relative path segment, which browsers drop from a URL.
function cleanName(value) {
	if (typeof value !== 'string') return '';
	const name = value.trim();
	if (!name || name.length > 500 || /[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..') return '';
	return name;
}

function validIds(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > BATCH_LIMIT) return null;
	if (!value.every(id => typeof id === 'string' && ID_PATTERN.test(id))) return null;
	return [...new Set(value)];
}

// Decodes an index path (URL-encoded segments) so two paths can be compared.
function decodePath(value) {
	return value.split('/').map(segment => {
		try { return decodeURIComponent(segment); } catch { return segment; }
	}).join('/');
}

// A destination path as the browser sends it: '/A/B/'. It is only ever
// resolved from the index root, so it cannot leave the indexed tree.
function cleanPath(value) {
	if (typeof value !== 'string' || !value.startsWith('/') || /[\\?\x00-\x1f\x7f#]/.test(value)) return '';
	const segments = value.split('/').filter(Boolean);
	if (segments.some(segment => segment === '.' || segment === '..')) return '';
	// '/' for the root of the index, '/A/B/' below it.
	return '/' + segments.join('/') + (segments.length ? '/' : '');
}

// The request body as JSON: `false` when its content type is not JSON, and
// `null` when a JSON body cannot be parsed.
async function readJson(request) {
	if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) return false;
	try {
		const body = await request.json();
		return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
	} catch {
		return null;
	}
}

/**
 * One Drive call with the shared access token and a timeout. A network
 * failure, or a token that cannot be refreshed, comes back as a 502 answer
 * instead of an exception.
 */
async function driveCall(gd, url, { method = 'GET', body } = {}) {
	let init;
	try {
		init = await gd.requestOption(body === undefined ? {} : { 'Content-Type': 'application/json; charset=UTF-8' }, method);
	} catch {
		return { ok: false, response: json({ error: UNREACHABLE, retry: true }, 502) };
	}
	if (body !== undefined) init.body = JSON.stringify(body);
	if (typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(DRIVE_TIMEOUT);
	try {
		return { ok: true, response: await fetch(url, init) };
	} catch {
		return { ok: false, response: json({ error: UNREACHABLE, retry: true }, 502) };
	}
}

/**
 * Reads a Drive refusal into a message the browser shows as it is. Drive
 * states the reason in error.errors[0].reason; a token that was authorized
 * for reading only is the common case after an upgrade.
 */
async function refusal(response, verb, name) {
	let details = null;
	try { details = (await response.json()).error; } catch {}
	const reason = details?.errors?.[0]?.reason || '';
	const status = response.status;
	if (status === 403 && reason === 'insufficientPermissions' && /insufficient (authentication )?scopes/i.test(details.message || '')) {
		return failure(403, 'The Google sign-in behind this index has read-only access. Reauthorize it with the full Drive scope (https://www.googleapis.com/auth/drive) to manage files.', { code: 'scope' });
	}
	if (status === 404) return failure(404, `“${name}” is no longer there. Refresh the list and try again.`, { code: 'missing' });
	if (status === 403) return failure(403, `Google Drive refused to ${verb} “${name}”. Check that this account can edit that folder.`, { code: 'forbidden' });
	if (status === 429) return failure(503, 'Google Drive is limiting requests. Wait a moment and try again.', { code: 'rate_limit', retry: true });
	if (status >= 500) return failure(502, 'Google Drive could not complete that. Try again.', { retry: true });
	return failure(502, `Google Drive refused to ${verb} “${name}” (HTTP ${status}).`);
}

// The folder an index path points to, resolved from the configured root.
async function resolveFolder(gd, path) {
	let id;
	try {
		id = await gd.findPathId(path);
	} catch {
		return failure(502, 'Google Drive could not open this folder. Try again.');
	}
	if (!id) return failure(404, 'This folder is no longer inside the index.');
	return { ok: true, id };
}

// The Drive query form of a name: backslashes and quotes escaped.
function queryValue(value) {
	return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/**
 * The item named `name` directly inside `folderId`, or null. Drive names are
 * not unique, so this is the first of several same-named items.
 */
async function findChild(gd, folderId, name) {
	const params = new URLSearchParams({
		...gd.fileListParams(),
		q: `'${folderId}' in parents and name = '${queryValue(name)}' and trashed = false`,
		fields: 'files(id,name,mimeType)',
		pageSize: '1'
	});
	const call = await driveCall(gd, `${DRIVE_API}/files?${params}`);
	if (!call.ok) return failure(502, UNREACHABLE, { retry: true });
	if (!call.response.ok) return refusal(call.response, 'look up', name);
	const found = (await call.response.json()).files?.[0];
	return { ok: true, item: found || null };
}

/**
 * Reads one item and checks that it is a child of the folder the browser
 * listed it in. The metadata read is what keeps an ID from anywhere else in
 * the account from being touched.
 */
async function loadItem(gd, id, folderId) {
	const call = await driveCall(gd, `${DRIVE_API}/files/${id}?supportsAllDrives=true&fields=${encodeURIComponent(ITEM_FIELDS)}`);
	if (!call.ok) return failure(502, UNREACHABLE, { retry: true });
	if (!call.response.ok) {
		if (call.response.status === 404) return failure(404, GONE, { code: 'missing' });
		return refusal(call.response, 'open', 'this item');
	}
	const item = await call.response.json();
	if (!item || item.id !== id || !Array.isArray(item.parents) || item.trashed) {
		return failure(404, GONE, { code: 'missing' });
	}
	if (!item.parents.includes(folderId)) return failure(404, GONE, { code: 'missing' });
	return { ok: true, item };
}

// Drive reports what the account may do with each item; an item shared with
// read-only access is refused here with a clear reason instead of failing
// halfway through a batch.
function notAllowed(action, item) {
	return { ok: false, code: 'forbidden', error: `Google Drive doesn’t allow this account to ${action} “${item.name}”.` };
}

// The single Drive write for one item of a move or delete batch. Resolves to
// null when it went through.
async function writeItem(gd, action, item, destination) {
	let call;
	if (action === 'delete') {
		call = await driveCall(gd, `${DRIVE_API}/files/${item.id}?supportsAllDrives=true&fields=${encodeURIComponent('id,name,trashed')}`, {
			method: 'PATCH',
			body: { trashed: true }
		});
	} else {
		// A file has one parent; removing every current parent with the same
		// request that adds the new one makes the move a single step.
		const query = new URLSearchParams({
			addParents: destination,
			removeParents: item.parents.join(','),
			supportsAllDrives: 'true',
			fields: 'id,name,parents'
		});
		call = await driveCall(gd, `${DRIVE_API}/files/${item.id}?${query}`, { method: 'PATCH' });
	}
	if (!call.ok) return failure(502, UNREACHABLE, { retry: true });
	if (!call.response.ok) return refusal(call.response, action, item.name);
	return null;
}

async function mkdir(gd, folderId, body) {
	const name = cleanName(body.name);
	if (!name) return json({ error: 'Provide a valid folder name.' }, 400);
	const found = await findChild(gd, folderId, name);
	if (!found.ok) return found.response;
	if (found.item) {
		if (found.item.mimeType !== folderMimeType) {
			return json({ error: `A file named “${name}” already exists here.`, code: 'exists' }, 409);
		}
		// A folder upload asks to reuse a folder of that name instead of
		// failing over one it made a moment ago.
		if (body.reuse === true) return json({ folder: { id: found.item.id, name, mimeType: folderMimeType }, existed: true });
		return json({ error: `A folder named “${name}” already exists here.`, code: 'exists' }, 409);
	}
	const call = await driveCall(gd, `${DRIVE_API}/files?supportsAllDrives=true&fields=${encodeURIComponent('id,name,mimeType')}`, {
		method: 'POST',
		body: { name, mimeType: folderMimeType, parents: [folderId] }
	});
	if (!call.ok) return call.response;
	if (!call.response.ok) return (await refusal(call.response, 'create a folder in', name)).response;
	const created = await call.response.json();
	gd.invalidate();
	return json({ folder: { id: created.id, name, mimeType: folderMimeType }, existed: false });
}

async function rename(gd, folderId, body) {
	const id = typeof body.id === 'string' && ID_PATTERN.test(body.id) ? body.id : '';
	const name = cleanName(body.to);
	if (!id || !name) return json({ error: 'Provide the item and its new name.' }, 400);
	const loaded = await loadItem(gd, id, folderId);
	if (!loaded.ok) return loaded.response;
	const { item } = loaded;
	if (item.name === name) return json({ item: publicItem(item), changed: false });
	if (item.capabilities?.canRename === false) {
		return json(notAllowed('rename', item), 403);
	}
	// Drive itself allows same-named items, but the index opens items by
	// path, so a second item with one name could never be reached.
	const clash = await findChild(gd, folderId, name);
	if (!clash.ok) return clash.response;
	if (clash.item) return json({ error: `An item named “${name}” already exists here.`, code: 'exists' }, 409);
	const call = await driveCall(gd, `${DRIVE_API}/files/${id}?supportsAllDrives=true&fields=${encodeURIComponent('id,name')}`, {
		method: 'PATCH',
		body: { name }
	});
	if (!call.ok) return call.response;
	if (!call.response.ok) return (await refusal(call.response, 'rename', item.name)).response;
	gd.invalidate();
	return json({ item: { id, name, mimeType: item.mimeType }, changed: true });
}

/** Moves or trashes up to BATCH_LIMIT items of one folder. */
async function changeItems(gd, action, path, folderId, body) {
	const ids = validIds(body.ids);
	if (!ids) return json({ error: `Select between 1 and ${BATCH_LIMIT} items.` }, 400);
	const moving = action === 'move';
	let destination = null;
	let destinationPath = '';
	if (moving) {
		destinationPath = cleanPath(body.to);
		if (!destinationPath) return json({ error: 'Provide the destination folder.' }, 400);
		const target = await resolveFolder(gd, destinationPath);
		if (!target.ok) return json({ error: 'The destination folder is no longer inside the index.' }, 404);
		destination = target.id;
	}

	// One metadata read per item, all at once. Nothing is written before
	// every item has been read and checked.
	const loaded = await Promise.all(ids.map(id => loadItem(gd, id, folderId)));
	const results = new Array(ids.length);
	const plan = [];
	loaded.forEach((entry, index) => {
		if (!entry.ok) {
			results[index] = { id: ids[index], name: '', ok: false, code: entry.code, error: entry.error };
			return;
		}
		const { item } = entry;
		if (moving) {
			if (item.parents.includes(destination)) {
				results[index] = { ...publicItem(item), ok: true, changed: false };
				return;
			}
			if (item.capabilities?.canMoveItemWithinDrive === false) {
				results[index] = { ...publicItem(item), ...notAllowed('move', item) };
				return;
			}
			// The folder picker never offers a folder inside the selection;
			// this covers a request that names one anyway.
			if (item.mimeType === folderMimeType) {
				const own = decodePath(path) + item.name + '/';
				const target = decodePath(destinationPath);
				if (target === own || target.startsWith(own)) {
					results[index] = { ...publicItem(item), ok: false, code: 'self', error: 'A folder can’t be moved into itself or one of its subfolders.' };
					return;
				}
			}
		} else if (item.capabilities?.canTrash === false && item.capabilities?.canDelete !== true) {
			results[index] = { ...publicItem(item), ...notAllowed('delete', item) };
			return;
		}
		plan.push({ item, index });
	});

	// The index opens items by path, so a name that is already taken in the
	// destination would leave one of the two unreachable.
	const pending = [];
	if (moving && plan.length) {
		const clashes = await Promise.all(plan.map(({ item }) => findChild(gd, destination, item.name)));
		plan.forEach((entry, position) => {
			const clash = clashes[position];
			if (!clash.ok) results[entry.index] = { ...publicItem(entry.item), ok: false, code: clash.code, error: clash.error };
			else if (clash.item) {
				results[entry.index] = { ...publicItem(entry.item), ok: false, code: 'exists', error: `“${entry.item.name}” already exists in the destination folder.` };
			} else {
				pending.push(entry);
			}
		});
	} else {
		pending.push(...plan);
	}

	const written = await Promise.all(pending.map(({ item }) => writeItem(gd, action, item, destination)));
	let changed = 0;
	written.forEach((outcome, position) => {
		const { item, index } = pending[position];
		if (outcome) results[index] = { ...publicItem(item), ok: false, code: outcome.code, error: outcome.error };
		else {
			results[index] = { ...publicItem(item), ok: true, changed: true };
			changed++;
		}
	});
	if (changed) gd.invalidate();
	const failed = results.filter(result => !result.ok).length;
	return json({ changed, failed, results });
}

/** Route ?manage=mkdir|rename|move|delete on a folder page. */
export async function handleManageRequest(request, gd, action, path) {
	// Checked before the body is read or Google Drive is contacted.
	const denied = await adminDenied(request, gd.authConfig.settings, 'manage');
	if (denied) return denied;
	if (!MUTATIONS[action]) return json({ error: 'Unknown management action.' }, 400);
	if (request.method !== 'POST') return json({ error: 'Use POST for this action.' }, 405);
	if (!path.endsWith('/')) return json({ error: 'This action works on a folder page.' }, 400);
	if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
		return json({ error: 'Cross-site requests are refused.' }, 403);
	}
	const body = await readJson(request);
	if (body === false) return json({ error: 'Send JSON with a Content-Type of application/json.' }, 415);
	if (body === null) return json({ error: 'The request body could not be read.' }, 400);

	const folder = await resolveFolder(gd, path);
	if (!folder.ok) return folder.response;
	if (action === 'mkdir') return mkdir(gd, folder.id, body);
	if (action === 'rename') return rename(gd, folder.id, body);
	return changeItems(gd, action, path, folder.id, body);
}

/**
 * Summarises the account's storage from Drive's own quota. Drive reports
 * bytes as strings and leaves `limit` out when no limit applies, so a value
 * Drive did not report stays null instead of being estimated.
 */
function summarizeQuota(quota) {
	const bytes = value => {
		if (value == null || value === '') return null;
		const number = Number(value);
		return Number.isSafeInteger(number) && number >= 0 ? number : null;
	};
	const total = bytes(quota?.limit);
	const used = bytes(quota?.usage);
	return {
		total,
		used,
		available: total !== null && used !== null ? Math.max(0, total - used) : null,
		usedInDrive: bytes(quota?.usageInDrive),
		usedInTrash: bytes(quota?.usageInDriveTrash),
		fetchedAt: Date.now()
	};
}

/**
 * Route ?manage=storage: the storage of the Google account behind the index,
 * shown to its administrator only. Checked before Google Drive is contacted.
 * `refresh=1` asks Drive for the current quota instead of the cached summary;
 * the page asks for that after an upload or a management action, so the
 * figures it shows are always ones Drive really reported.
 */
export async function handleStorageRequest(request, gd) {
	const denied = await adminDenied(request, gd.authConfig.settings, 'manage');
	if (denied) return denied;
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return json({ error: 'Use GET to read the storage summary.' }, 405);
	}
	const fresh = new URL(request.url).searchParams.get('refresh') === '1';
	const cached = gd.storageCache;
	if (!fresh && cached && Date.now() - cached.at < STORAGE_TTL) {
		return json({ cached: true, ...cached.data });
	}
	const call = await driveCall(gd, `${DRIVE_API}/about?fields=storageQuota`);
	let data = null;
	let failed = false;
	if (call.ok && call.response.ok) {
		try { data = summarizeQuota((await call.response.json()).storageQuota); } catch {}
	} else if (call.ok) {
		// A refusal is not worth caching; the quota may well be readable a
		// moment later.
		failed = true;
	}
	if (data && (data.used !== null || data.total !== null)) {
		gd.storageCache = { at: Date.now(), data };
		return json({ cached: false, ...data });
	}
	// A stale answer beats none: the quota rarely moves fast, and the next
	// page load asks again.
	if (cached) return json({ cached: true, stale: true, ...cached.data });
	if (!call.ok) return call.response;
	if (failed) return json({ error: 'Google Drive could not report the storage usage. Try again.', retry: true }, 502);
	return json({ error: 'Google Drive did not report the storage usage.' }, 502);
}
