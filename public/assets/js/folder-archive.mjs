const folderMime = 'application/vnd.google-apps.folder';

export function safeArchiveName(name) {
	const safe = name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[ ]+|[. ]+$/g, '');
	return /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(safe) ? '_' + safe : safe || '_';
}

function uniqueName(name, used) {
	const safe = safeArchiveName(name);
	const dot = safe.lastIndexOf('.');
	const stem = dot > 0 ? safe.slice(0, dot) : safe;
	const extension = dot > 0 ? safe.slice(dot) : '';
	let candidate = safe;
	for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
		candidate = stem + ' (' + suffix + ')' + extension;
	}
	used.add(candidate.toLowerCase());
	return candidate;
}

export async function openFolderArchive(path, { signal, onFile = () => {} } = {}) {
	if (!/^\/\d+:\/(?:.*\/)?$/.test(path)) throw new Error('Choose a folder to download.');

	async function request(action, fields, label) {
		signal?.throwIfAborted();
		const response = await fetch(path + '?archive=1', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...fields }),
			signal
		});
		if (!response.ok) {
			const message = (await response.text()).trim() || 'The download was interrupted.';
			throw new Error(label ? label + ': ' + message : message);
		}
		return response;
	}

	const folder = await (await request('start', {})).json();
	const root = safeArchiveName(folder.name);

	async function* walk(id, prefix) {
		const used = new Set();
		let pageToken;
		do {
			const page = await (await request('list', { id, pageToken }, prefix)).json();
			for (const file of page.files) {
				const lastModified = file.modifiedTime ? new Date(file.modifiedTime) : undefined;
				if (file.mimeType === folderMime) {
					const directory = prefix + uniqueName(file.name, used) + '/';
					yield { name: directory, lastModified };
					yield* walk(file.id, directory);
					continue;
				}
				onFile(file.name);
				const response = await request('file', { id: file.id }, file.name);
				const extension = response.headers.get('X-Rin-Archive-Extension') || '';
				const name = prefix + uniqueName(file.name + extension, used);
				yield { name, input: response.body ?? '', lastModified };
			}
			pageToken = page.pageToken;
		} while (pageToken);
	}

	async function* entries() {
		yield { name: root + '/' };
		yield* walk(folder.id, root + '/');
	}

	return { filename: root + '.zip', entries: entries() };
}

export async function folderZip(path, makeZip, options) {
	const archive = await openFolderArchive(path, options);
	return { filename: archive.filename, stream: makeZip(archive.entries) };
}
