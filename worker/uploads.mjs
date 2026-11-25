/**
 * Admin-only resumable uploads to Google Drive, sized for Cloudflare Workers Free.
 *
 * Protocol: the browser starts a resumable session for the open folder, then
 * PUTs one chunk per request. Chunk bodies are streamed straight through to
 * the Drive session while they are still arriving from the browser, and the
 * upstream PUT declares its exact length, so the browser→Worker and
 * Worker→Drive legs overlap instead of running back to back. Chunks stay just
 * under the Free plan's ~100 MB request-body ceiling, the Worker never
 * buffers a whole chunk in memory, and each request performs a single
 * upstream subrequest. Chunks always target one resumable session, so an
 * interrupted upload resumes at Google's last committed byte instead of
 * creating a duplicate file. A cancel closes that session through Drive's
 * DELETE so the partial bytes are dropped instead of lingering for a week.
 *
 * The Drive session URL is sealed with AES-GCM (key derived from
 * GOOGLE_CLIENT_SECRET) into an opaque token. Raw session URLs, OAuth tokens,
 * and admin credentials never appear in any response.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Initial chunk advertised to clients: a multiple of Drive's 256 KiB chunk
// unit, comfortably below the Workers Free request-body limit. Clients grow
// the chunk adaptively (bounded by max_chunk) as the transfer proves reliable.
const CHUNK_SIZE = 16 * 1024 * 1024;
// Hard server-side ceiling for one chunk: the biggest multiple of Drive's
// 256 KiB unit below the 100 MB request-body limit of Cloudflare Free and
// Pro zones. Cloudflare answers anything larger with 413 before the Worker
// runs, so the browser's own ceiling matches this number.
const MAX_CHUNK = 95 * 1024 * 1024;
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_SESSION_ORIGIN = 'https://www.googleapis.com';

const uploadKeys = new Map();

function uploadKey(secret) {
	if (!uploadKeys.has(secret)) {
		uploadKeys.set(secret, crypto.subtle
			.digest('SHA-256', encoder.encode('rin-index-upload:' + secret))
			.then(digest => crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])));
	}
	return uploadKeys.get(secret);
}

async function sealSession(payload, secret) {
	const key = await uploadKey(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload))));
	const bytes = new Uint8Array(iv.length + cipher.length);
	bytes.set(iv);
	bytes.set(cipher, iv.length);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function openSession(token, secret) {
	try {
		const normalized = token.replaceAll('-', '+').replaceAll('_', '/');
		const bytes = Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), char => char.charCodeAt(0));
		if (bytes.length <= 12) return null;
		const key = await uploadKey(secret);
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
		return JSON.parse(decoder.decode(plain));
	} catch {
		return null;
	}
}

async function safeEqual(a, b) {
	const [da, db] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(String(a))),
		crypto.subtle.digest('SHA-256', encoder.encode(String(b)))
	]);
	const x = new Uint8Array(da);
	const y = new Uint8Array(db);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

// The page's own requests name themselves, so an expired admin session can be
// reported to its sign-in dialog instead of opening the browser's login prompt.
const CLIENT_HEADER = 'X-Requested-With';

// Admin session --------------------------------------------------------------
// A successful sign-in also sets a session cookie, so an administrator stays
// signed in while moving between folders. The cookie holds an expiry and an
// HMAC of it under a key derived from the admin pair, never the password
// itself: scripts on the page cannot read it, and changing the pair ends
// every session at once.
const SESSION_COOKIE = 'rin_admin_session';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessionKeys = new WeakMap();

function base64Url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlBytes(text) {
	const normalized = text.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
	return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function sessionKey(settings) {
	if (!sessionKeys.has(settings)) {
		const material = encoder.encode(['rin-index-session', settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD].join('\0'));
		sessionKeys.set(settings, crypto.subtle.digest('SHA-256', material)
			.then(digest => crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])));
	}
	return sessionKeys.get(settings);
}

async function sessionToken(settings, expires) {
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(settings), encoder.encode('rin-session:' + expires)));
	return expires + '.' + base64Url(signature);
}

/** True when the request carries a session cookie that is current and genuinely signed. */
async function hasSession(request, settings) {
	const cookies = request.headers.get('Cookie') || '';
	let token = '';
	for (const part of cookies.split(';')) {
		const separator = part.indexOf('=');
		if (part.slice(0, separator).trim() === SESSION_COOKIE) token = part.slice(separator + 1).trim();
	}
	const match = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
	if (!match) return false;
	const expires = Number(match[1]);
	const now = Date.now();
	if (expires <= now || expires > now + SESSION_TTL) return false;
	return crypto.subtle.verify('HMAC', await sessionKey(settings), base64UrlBytes(match[2]), encoder.encode('rin-session:' + match[1]));
}

// A session cookie is sent on top-level visits from other sites, where it
// only has to identify the admin; every request that changes anything is a
// POST, which SameSite=Lax never carries across sites.
function sessionCookie(request, token, maxAge) {
	const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
	return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function withCookie(response, cookie) {
	response.headers.append('Set-Cookie', cookie);
	return response;
}

/**
 * Route ?manage=login|logout. Neither touches Google Drive. `login` answers
 * only to the admin pair and sets the HttpOnly session cookie; `logout`
 * clears it for whoever asks, which reveals nothing and changes no file.
 */
export async function handleAdminSession(request, settings, action) {
	if (request.method !== 'POST') {
		return json({ error: action === 'logout' ? 'Use POST to sign out.' : 'Use POST to sign in.' }, 405);
	}
	if (action === 'logout') return withCookie(json({ admin: false }), sessionCookie(request, '', 0));
	if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
		return json({ error: 'Cross-site requests are refused.' }, 403);
	}
	const denied = await adminDenied(request, settings, 'session');
	if (denied) return denied;
	const expires = Date.now() + SESSION_TTL;
	return withCookie(json({ admin: true, expires }), sessionCookie(request, await sessionToken(settings, expires), SESSION_TTL / 1000));
}

/** True when the request carries the admin basic-auth pair or a current admin session. */
export async function isAdminRequest(request, settings) {
	if (!settings?.ADMIN_PASSWORD) return false;
	const match = /^Basic +([A-Za-z0-9+/=]+)$/i.exec(request.headers.get('Authorization') || '');
	if (match) {
		try {
			const bytes = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0));
			const decoded = decoder.decode(bytes);
			const separator = decoded.indexOf(':');
			if (separator < 0) return false;
			const user = decoded.slice(0, separator);
			const pass = decoded.slice(separator + 1);
			if (await safeEqual(user, settings.ADMIN_USERNAME) && await safeEqual(pass, settings.ADMIN_PASSWORD)) return true;
		} catch {
			return false;
		}
	}
	return hasSession(request, settings);
}

export function json(value, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8' }
	});
}

/**
 * The 401 every admin route answers to anyone else. A request that already
 * presented credentials, or one made by the page's own script, gets no
 * challenge: the page shows its sign-in dialog instead of the browser opening
 * its login prompt over it.
 */
export function adminRequired(request) {
	const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
	if (!request.headers.has('Authorization') && !request.headers.has(CLIENT_HEADER)) {
		headers['WWW-Authenticate'] = 'Basic realm="Rin Index admin", charset="UTF-8"';
	}
	return new Response('Admin sign-in required.', { status: 401, headers });
}

/**
 * What stops an admin route when admin access is not configured (503) or the
 * request is neither signed in nor carries the admin pair (401); null when it
 * may go on. The router runs it before Google Drive is contacted, and each
 * handler runs it again on its own.
 */
export async function adminDenied(request, settings, feature) {
	if (!settings.ADMIN_PASSWORD) {
		const error = feature === 'upload'
			? 'Uploads are not configured. Set ADMIN_PASSWORD to enable them.'
			: feature === 'session'
				? 'Admin access is not configured. Set ADMIN_PASSWORD to enable it.'
				: 'File management is not configured. Set ADMIN_PASSWORD to enable it.';
		return json({ error }, 503);
	}
	if (!(await isAdminRequest(request, settings))) return adminRequired(request);
	return null;
}

/**
 * Route ?upload=start|chunk|status|cancel|whoami. Every action is admin-gated
 * before any Drive request is made.
 */
export async function handleUploadRequest(request, gd, action, path) {
	const denied = await adminDenied(request, gd.authConfig.settings, 'upload');
	if (denied) return denied;
	if (action === 'whoami') return json({ admin: true });
	if (action === 'start') return uploadStart(request, gd, path);
	if (action === 'chunk') return uploadChunk(request, gd);
	if (action === 'status') return uploadStatus(request, gd);
	if (action === 'cancel') return uploadCancel(request, gd);
	return json({ error: 'Unknown upload action.' }, 400);
}

async function uploadStart(request, gd, path) {
	if (request.method !== 'POST') return json({ error: 'Use POST to start an upload.' }, 405);
	if (!path.endsWith('/')) return json({ error: 'Uploads start from a folder page.' }, 400);
	const settings = gd.authConfig.settings;
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Send JSON with name, size, and type.' }, 400);
	}
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const size = Number(body.size);
	const type = typeof body.type === 'string' && /^[!-~]{1,200}$/.test(body.type) ? body.type : 'application/octet-stream';
	if (!name || name.length > 500 || /[\\/\x00-\x1f\x7f]/.test(name)) {
		return json({ error: 'Provide a valid file name.' }, 400);
	}
	if (!Number.isInteger(size) || size < 0 || size > 5 * 1024 ** 4) {
		return json({ error: 'Provide the exact file size in bytes.' }, 400);
	}

	// Resolve the destination server-side from the configured root, so the
	// upload can only ever land inside the indexed folder tree.
	let folderId;
	try {
		folderId = await gd.findPathId(path);
	} catch {
		return json({ error: 'Google Drive could not resolve this folder. Try again.' }, 502);
	}
	if (!folderId) return json({ error: 'Folder not found inside this index.' }, 404);

	const url = new URL(DRIVE_UPLOAD_URL);
	url.search = new URLSearchParams({ uploadType: 'resumable', supportsAllDrives: 'true' });
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer ' + await gd.accessToken(),
				'Content-Type': 'application/json; charset=UTF-8',
				'X-Upload-Content-Type': type,
				'X-Upload-Content-Length': String(size)
			},
			body: JSON.stringify({ name, parents: [folderId] })
		});
	} catch {
		return json({ error: 'Google Drive could not start the upload. Try again.' }, 502);
	}
	if (response.status === 401 || response.status === 403) {
		return json({ error: 'This Google account cannot create files in that folder. Check the Drive write scope and folder permissions.' }, response.status);
	}
	if (!response.ok) {
		return json({ error: `Google Drive rejected the upload session (HTTP ${response.status}).` }, 502);
	}
	const location = response.headers.get('Location');
	if (!location || !location.startsWith(DRIVE_SESSION_ORIGIN)) {
		return json({ error: 'Google Drive did not return an upload session.' }, 502);
	}
	const token = await sealSession({ u: location, s: size }, settings.GOOGLE_CLIENT_SECRET);
	return json({ token, chunk_size: CHUNK_SIZE, max_chunk: MAX_CHUNK, total: size });
}

async function uploadChunk(request, gd) {
	if (request.method !== 'PUT') return json({ error: 'Use PUT to send a chunk.' }, 405);
	const url = new URL(request.url);
	const session = await openSession(url.searchParams.get('u') || '', gd.authConfig.settings.GOOGLE_CLIENT_SECRET);
	if (!session) return json({ error: 'This upload is no longer known. Start it again.', restart: true }, 404);
	const offset = Number(url.searchParams.get('offset'));
	const length = Number(url.searchParams.get('len'));
	const total = session.s;
	if (!Number.isInteger(offset) || offset < 0 || offset > total) {
		return json({ error: 'Invalid chunk offset.' }, 400);
	}
	if (!Number.isInteger(length) || length < 0 || length > MAX_CHUNK) {
		return json({ error: 'Invalid chunk size.' }, 400);
	}
	if (length === 0 && total > 0) {
		return json({ error: 'Send the chunk bytes, or check the upload status.' }, 400);
	}
	if (offset + length > total) {
		return json({ error: 'The chunk would exceed the file size.' }, 400);
	}

	// A declared body length that disagrees with the query makes Google fail
	// only after the whole body was transferred, so reject it up front. A
	// request without the header (a proxied chunked body) is left alone.
	const declaredHeader = request.headers.get('Content-Length');
	if (declaredHeader !== null) {
		const declared = Number(declaredHeader);
		if (!Number.isFinite(declared) || declared !== length) {
			return json({ error: 'The chunk length does not match its body.' }, 400);
		}
	}

	// Stream the chunk straight through to the Drive session: the upstream
	// PUT starts while the request body is still arriving, so the two network
	// legs overlap. The declared length travels in Content-Range, and the
	// upstream PUT also carries this chunk's exact Content-Length: Google's
	// reference for resumable chunks sets it, and a body of known length can
	// be forwarded as it arrives, while a body of unknown length has to be
	// spooled somewhere before its size is known. Each request performs
	// exactly one upstream subrequest, and no full chunk is ever buffered.
	const contentRange = total === 0 ? 'bytes */0' : `bytes ${offset}-${offset + length - 1}/${total}`;
	let response;
	try {
		response = await fetch(session.u, {
			method: 'PUT',
			headers: { 'Content-Range': contentRange, 'Content-Length': String(length) },
			body: request.body
		});
	} catch {
		return json({ error: 'The chunk could not reach Google Drive. Retry to resume.', retry: true }, 502);
	}
	return relayUploadResponse(response, session, gd);
}

async function uploadStatus(request, gd) {
	if (request.method !== 'POST' && request.method !== 'GET') {
		return json({ error: 'Use POST to check an upload.' }, 405);
	}
	const url = new URL(request.url);
	const session = await openSession(url.searchParams.get('u') || '', gd.authConfig.settings.GOOGLE_CLIENT_SECRET);
	if (!session) return json({ error: 'This upload is no longer known. Start it again.', restart: true }, 404);
	let response;
	try {
		response = await fetch(session.u, {
			method: 'PUT',
			headers: { 'Content-Range': `bytes */${session.s}` }
		});
	} catch {
		return json({ error: 'Could not reach Google Drive. Try again.', retry: true }, 502);
	}
	return relayUploadResponse(response, session, gd);
}

// Cancels an unfinished session. Drive's resumable protocol closes a session
// when it receives DELETE on the session URL and answers 499 to every later
// PUT or status query; an abandoned session would otherwise hold its partial
// bytes for a week. Best effort: when Drive cannot confirm, the browser still
// stops and Google expires the session on its own.
async function uploadCancel(request, gd) {
	if (request.method !== 'POST' && request.method !== 'DELETE') {
		return json({ error: 'Use POST to cancel an upload.' }, 405);
	}
	const url = new URL(request.url);
	const session = await openSession(url.searchParams.get('u') || '', gd.authConfig.settings.GOOGLE_CLIENT_SECRET);
	if (!session) return json({ error: 'This upload is no longer known. Nothing is left to cancel.' }, 404);
	let response;
	try {
		response = await fetch(session.u, {
			method: 'DELETE',
			signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
		});
	} catch {
		return json({ error: 'Google Drive could not be reached to close the upload. It expires on its own.', cancelled: false, retry: true }, 502);
	}
	// 499 is Drive's answer for a cancelled session; 404/410 mean it already
	// expired on its own.
	if (response.ok || response.status === 499) return json({ cancelled: true });
	if (response.status === 404 || response.status === 410) return json({ cancelled: true, expired: true });
	if (response.status === 401 || response.status === 403) {
		return json({ error: 'Google Drive refused to close this upload session.', cancelled: false }, 502);
	}
	return json({ error: `Google Drive returned HTTP ${response.status} while closing the upload.`, cancelled: false, retry: true }, 502);
}

// A completed upload changed the folder and the account's storage, so the
// cached listings and quota summary are dropped before the answer goes out.
function relayUploadResponse(response, session, gd) {
	if (response.status === 308) {
		const range = /^bytes=0-(\d+)$/.exec(response.headers.get('Range') || '');
		return json({ done: false, committed: range ? Number(range[1]) + 1 : 0 });
	}
	if (response.status === 200 || response.status === 201) {
		if (gd) gd.invalidate();
		return response.json().then(file => json({
			done: true,
			committed: session.s,
			file: file && typeof file === 'object'
				? { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType }
				: null
		})).catch(() => json({ done: true, committed: session.s, file: null }));
	}
	if (response.status === 404 || response.status === 410) {
		return json({ error: 'This upload session expired. Start the upload again.', restart: true }, 410);
	}
	// Drive answers 499 once a session was cancelled through DELETE.
	if (response.status === 499) {
		return json({ error: 'This upload was cancelled and cannot be continued. Start it again.', restart: true }, 410);
	}
	if (response.status === 429 || response.status === 403) {
		return json({ error: 'Google Drive rate-limited this chunk. Wait a moment and retry.', retry: true }, 503);
	}
	return json({ error: `Google Drive returned HTTP ${response.status} for this chunk.`, retry: true }, 502);
}
