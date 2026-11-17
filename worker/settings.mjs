export const folderMimeType = 'application/vnd.google-apps.folder';

export function readSettings(env) {
	const settings = {};
	for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
		const value = env[name]?.trim();
		if (!value) throw new Error(`Set ${name} before deploying.`);
		settings[name] = value;
	}

	settings.DRIVE_ID = env.DRIVE_ID?.trim() || env.DRIVE_ROOT_ID?.trim();
	if (!settings.DRIVE_ID) throw new Error('Set DRIVE_ID before deploying.');
	if (!/^[A-Za-z0-9_-]+$/.test(settings.DRIVE_ID)) {
		throw new Error('DRIVE_ID must be a folder ID, Shared Drive ID, or root.');
	}
	settings.SITE_NAME = env.SITE_NAME?.trim() || 'Rin Index';
	const hasPassword = Boolean(env.INDEX_PASSWORD?.trim());
	settings.INDEX_PUBLIC = env.INDEX_PUBLIC?.trim().toLowerCase() || (hasPassword ? 'false' : 'true');
	if (!['true', 'false'].includes(settings.INDEX_PUBLIC)) {
		throw new Error('INDEX_PUBLIC must be true or false.');
	}
	settings.PROTECT_FILE_LINK = env.PROTECT_FILE_LINK?.trim().toLowerCase() || 'false';
	if (!['true', 'false'].includes(settings.PROTECT_FILE_LINK)) {
		throw new Error('PROTECT_FILE_LINK must be true or false.');
	}
	if (settings.PROTECT_FILE_LINK === 'true' && settings.INDEX_PUBLIC === 'true') {
		throw new Error('Set INDEX_PASSWORD and use a private index to protect direct downloads.');
	}
	if (settings.INDEX_PUBLIC === 'false') {
		settings.INDEX_USERNAME = env.INDEX_USERNAME?.trim() || 'viewer';
		if (!/^[\x21-\x7e]+$/.test(settings.INDEX_USERNAME) || settings.INDEX_USERNAME.includes(':')) {
			throw new Error('INDEX_USERNAME must use printable ASCII without spaces or colons.');
		}
		if (!hasPassword) throw new Error('Set INDEX_PASSWORD for a private index.');
		settings.INDEX_PASSWORD = env.INDEX_PASSWORD;
	}
	return settings;
}

export async function readDriveRoot(driveId, accessToken) {
	const url = new URL(`https://www.googleapis.com/drive/v3/files/${driveId}`);
	url.search = new URLSearchParams({ fields: 'id,mimeType,trashed,driveId,parents', supportsAllDrives: 'true' });
	const response = await fetch(url, {
		headers: { authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(15000)
	});
	if (!response.ok) {
		throw new Error(`Google Drive could not open DRIVE_ID (HTTP ${response.status}). Check the folder ID and share the folder directly with the Google account that authorized Rin Index.`);
	}
	const folder = await response.json();
	if (!folder.id || folder.mimeType !== folderMimeType || folder.trashed) {
		throw new Error('DRIVE_ID must point to an existing folder or Shared Drive.');
	}
	return folder;
}

export async function refreshGoogleToken(settings) {
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		body: new URLSearchParams({
			client_id: settings.GOOGLE_CLIENT_ID,
			client_secret: settings.GOOGLE_CLIENT_SECRET,
			refresh_token: settings.GOOGLE_REFRESH_TOKEN,
			grant_type: 'refresh_token'
		}),
		signal: AbortSignal.timeout(15000)
	});
	if (!response.ok) {
		throw new Error(`Google rejected the token refresh (HTTP ${response.status}). Check your OAuth credentials.`);
	}
	const token = await response.json();
	if (!token.access_token) throw new Error('Google returned no Drive access token.');
	return token;
}
