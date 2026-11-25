/**
 * Admin-only resumable uploads to Google Drive, sized for Cloudflare Workers Free.
 *
 * Protocol: the browser starts a resumable session for the open folder, then
 * PUTs one chunk per request. Each Worker request performs a single upstream
 * subrequest, and chunks stay far below the Free plan's ~100 MB request-body
 * ceiling, so only one chunk is ever held in Worker memory. Chunks always
 * target one resumable session, so an interrupted upload resumes at Google's
 * last committed byte instead of creating a duplicate file.
 *
 * The Drive session URL is sealed with AES-GCM (key derived from
 * GOOGLE_CLIENT_SECRET) into an opaque token. Raw session URLs, OAuth tokens,
 * and admin credentials never appear in any response.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 16 MiB: a multiple of Drive's 256 KiB chunk unit, comfortably below the
// Workers Free request-body limit, and small enough to bound isolate memory.
const CHUNK_SIZE = 16 * 1024 * 1024;
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

/** True when the request carries the admin basic-auth pair. */
export async function isAdminRequest(request, settings) {
	if (!settings?.ADMIN_PASSWORD) return false;
	const match = /^Basic +([A-Za-z0-9+/=]+)$/i.exec(request.headers.get('Authorization') || '');
	if (!match) return false;
	try {
		const bytes = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0));
		const decoded = decoder.decode(bytes);
		const separator = decoded.indexOf(':');
		if (separator < 0) return false;
		const user = decoded.slice(0, separator);
		const pass = decoded.slice(separator + 1);
		return await safeEqual(user, settings.ADMIN_USERNAME) && await safeEqual(pass, settings.ADMIN_PASSWORD);
	} catch {
		return false;
	}
}

function json(value, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8' }
	});
}

function adminRequired() {
	return new Response('Admin sign-in required.', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="Rin Index admin", charset="UTF-8"',
			'Content-Type': 'text/plain; charset=utf-8'
		}
	});
}

/**
 * Route ?upload=start|chunk|status|whoami. Every action is admin-gated
 * before any Drive request is made.
 */
export async function handleUploadRequest(request, gd, action, path) {
	const settings = gd.authConfig.settings;
	if (!settings.ADMIN_PASSWORD) {
		return json({ error: 'Uploads are not configured. Set ADMIN_PASSWORD to enable them.' }, 503);
	}
	if (!(await isAdminRequest(request, settings))) {
		return adminRequired();
	}
	if (action === 'whoami') return json({ admin: true });
	if (action === 'start') return uploadStart(request, gd, path);
	if (action === 'chunk') return uploadChunk(request, gd);
	if (action === 'status') return uploadStatus(request, gd);
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
	return json({ token, chunk_size: CHUNK_SIZE, total: size });
}

async function uploadChunk(request, gd) {
	if (request.method !== 'PUT') return json({ error: 'Use PUT to send a chunk.' }, 405);
	const url = new URL(request.url);
	const session = await openSession(url.searchParams.get('u') || '', gd.authConfig.settings.GOOGLE_CLIENT_SECRET);
	if (!session) return json({ error: 'This upload is no longer known. Start it again.', restart: true }, 404);
	const offset = Number(url.searchParams.get('offset'));
	const total = session.s;
	if (!Number.isInteger(offset) || offset < 0 || offset > total) {
		return json({ error: 'Invalid chunk offset.' }, 400);
	}

	// One chunk (at most CHUNK_SIZE) is buffered, never the whole file, and
	// each request makes exactly one upstream subrequest.
	let body;
	try {
		body = await request.arrayBuffer();
	} catch {
		return json({ error: 'The chunk did not arrive completely. Retry to resume.', retry: true }, 502);
	}
	const length = body.byteLength;
	if (length === 0 && total > 0) {
		return json({ error: 'Send the chunk bytes, or check the upload status.' }, 400);
	}
	if (length > CHUNK_SIZE) {
		return json({ error: 'The chunk exceeds the supported size.' }, 413);
	}
	if (offset + length > total) {
		return json({ error: 'The chunk would exceed the file size.' }, 400);
	}
	const contentRange = total === 0 ? 'bytes */0' : `bytes ${offset}-${offset + length - 1}/${total}`;
	let response;
	try {
		response = await fetch(session.u, {
			method: 'PUT',
			headers: { 'Content-Range': contentRange },
			body
		});
	} catch {
		return json({ error: 'The chunk could not reach Google Drive. Retry to resume.', retry: true }, 502);
	}
	return relayUploadResponse(response, session);
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
	return relayUploadResponse(response, session);
}

function relayUploadResponse(response, session) {
	if (response.status === 308) {
		const range = /^bytes=0-(\d+)$/.exec(response.headers.get('Range') || '');
		return json({ done: false, committed: range ? Number(range[1]) + 1 : 0 });
	}
	if (response.status === 200 || response.status === 201) {
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
	if (response.status === 429 || response.status === 403) {
		return json({ error: 'Google Drive rate-limited this chunk. Wait a moment and retry.', retry: true }, 503);
	}
	return json({ error: `Google Drive returned HTTP ${response.status} for this chunk.`, retry: true }, 502);
}
