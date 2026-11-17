import { writeFile } from 'node:fs/promises';
import { readDriveRoot, readSettings, refreshGoogleToken } from '../worker/settings.mjs';

try {
	const destination = process.argv[2];
	if (!destination) throw new Error('Provide a destination for the Worker secrets file.');
	const settings = readSettings(process.env);
	const { access_token, scope } = await refreshGoogleToken(settings);
	if (scope && !scope.split(' ').includes('https://www.googleapis.com/auth/drive.readonly')) {
		throw new Error('Authorize the Drive read-only scope before generating the refresh token.');
	}
	await readDriveRoot(settings.DRIVE_ID, access_token);
	await writeFile(destination, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
	console.log('Google authorization and Drive folder verified.');
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
