import { writeFile } from 'node:fs/promises';
import { folderMimeType, readSettings, refreshGoogleToken } from '../worker/settings.mjs';

try {
	const destination = process.argv[2];
	if (!destination) throw new Error('Provide a destination for the Worker secrets file.');
	const settings = readSettings(process.env);
	const { access_token, scope } = await refreshGoogleToken(settings);
	if (scope && !scope.split(' ').includes('https://www.googleapis.com/auth/drive.readonly')) {
		throw new Error('Authorize the Drive read-only scope before generating the refresh token.');
	}
	const rootUrl = new URL(`https://www.googleapis.com/drive/v3/files/${settings.DRIVE_ROOT_ID}`);
	rootUrl.search = new URLSearchParams({ fields: 'mimeType,trashed', supportsAllDrives: 'true' });
	const response = await fetch(rootUrl, {
		headers: { Authorization: `Bearer ${access_token}` },
		signal: AbortSignal.timeout(15000)
	});
	if (!response.ok) {
		throw new Error(`Google Drive could not open DRIVE_ROOT_ID (HTTP ${response.status}). Check the ID, account access, and whether the Drive API is enabled.`);
	}
	const root = await response.json();
	if (root.mimeType !== folderMimeType || root.trashed) {
		throw new Error('DRIVE_ROOT_ID must point to an existing folder or Shared Drive.');
	}
	await writeFile(destination, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
	console.log('Google authorization and Drive folder verified.');
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
