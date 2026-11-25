import { writeFile } from 'node:fs/promises';
import { readDriveRoot, readSettings, refreshGoogleToken } from '../worker/settings.mjs';

	try {
		const destination = process.argv[2];
		if (!destination) throw new Error('Provide a destination for the Worker secrets file.');
		const settings = readSettings(process.env);
		const { access_token, scope } = await refreshGoogleToken(settings);
		const granted = (scope || '').split(' ');
		const readOnlyScope = 'https://www.googleapis.com/auth/drive.readonly';
		const fullScope = 'https://www.googleapis.com/auth/drive';
		if (!granted.includes(readOnlyScope) && !granted.includes(fullScope)) {
			throw new Error('Authorize the Drive read-only scope before generating the refresh token.');
		}
		if (settings.ADMIN_PASSWORD && !granted.includes(fullScope)) {
			throw new Error('Uploads need the full Drive scope (https://www.googleapis.com/auth/drive) because the drive.file scope cannot create files in existing folders. Reauthorize with the drive scope, or remove ADMIN_PASSWORD to deploy without uploads.');
		}
		await readDriveRoot(settings.DRIVE_ID, access_token);
		await writeFile(destination, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
		console.log('Google authorization and Drive folder verified.');
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
