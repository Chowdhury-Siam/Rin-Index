import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { prepareFolderZip } from '../worker/worker-beta.js';

async function aws(endpoint, args, body) {
	const child = spawn('aws', ['--endpoint-url', endpoint, ...args], {
		stdio: [body ? 'pipe' : 'ignore', 'inherit', 'inherit']
	});
	const completed = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('close', code => code === 0 ? resolve() : reject(new Error('R2 upload command failed.')));
	});
	try {
		if (body) await Promise.all([pipeline(body, child.stdin), completed]);
		else await completed;
	} catch (error) {
		child.kill();
		await completed.catch(() => {});
		throw error;
	}
}

try {
	const env = process.env;
	const bucket = env.R2_ARCHIVE_BUCKET || '';
	const account = env.CLOUDFLARE_ACCOUNT_ID || '';
	if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Set the R2_ARCHIVE_BUCKET repository secret.');
	if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('Set the CLOUDFLARE_ACCOUNT_ID repository secret.');
	if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error('Set both R2 archive access key repository secrets.');
	const path = new URL(env.RIN_ARCHIVE_FOLDER || '/', 'https://rin-index.invalid').pathname;
	if (!/^\/0:\/(?:.*\/)?$/.test(path)) throw new Error('Enter a Rin Index folder URL that ends in a slash.');

	const { key, response } = await prepareFolderZip(env, path.slice(3));
	const endpoint = 'https://' + account + '.r2.cloudflarestorage.com';
	const version = crypto.randomUUID();
	const destination = 's3://' + bucket + '/' + key + '/' + version + '.zip';
	const args = ['s3', 'cp', '-', destination, '--only-show-errors', '--content-type', 'application/zip'];
	const length = response.headers.get('Content-Length');
	if (length) args.push('--expected-size', length);

	try {
		console.log('Uploading the ZIP to R2. The existing download stays available until the upload finishes.');
		await aws(endpoint, args, response.body);
	} catch (error) {
		await aws(endpoint, ['s3', 'rm', destination, '--only-show-errors']).catch(() => {
			console.warn('Could not remove the failed ZIP upload.');
		});
		throw error;
	}
	// Publish a small pointer only after the entire ZIP has reached R2.
	await aws(endpoint, ['s3api', 'put-object', '--bucket', bucket, '--key', key + '/current', '--metadata', 'version=' + version]);
	console.log('Resumable ZIP is ready. Open the same folder in Rin Index and use Copy ZIP link.');
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
