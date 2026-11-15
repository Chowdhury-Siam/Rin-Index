import { folderZip, safeArchiveName } from './folder-archive.mjs';

const { order, name, model } = window.RIN_INDEX;
const root = '/' + order + ':/';
const path = location.pathname;
const isSearch = Boolean(model.is_search_page);
const isFolder = path.endsWith('/');
const segments = isSearch ? [] : path.slice(root.length).split('/').filter(Boolean);
const searchPath = '/' + order + ':search';
const driveType = ['My Drive', 'Shared Drive', 'Google Drive folder'][model.root_type] || 'Google Drive';

const folderMime = 'application/vnd.google-apps.folder';
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const textExtensions = new Set('txt md log csv tsv json xml yaml yml ini toml html htm css js mjs ts py sh java go php'.split(' '));

document.body.innerHTML = `
	<a class="skip-link" href="#main">Skip to files</a>
	<div class="frame">
		<header class="topbar">
			<a class="brand" href="__ROOT__"><img src="/assets/rin-mark.png" width="38" height="38" alt="">Rin Index</a>
			<a class="nav-current" href="__ROOT__">Browse files</a>
			<a class="source-link" href="https://github.com/Chowdhury-Siam/Google-Index">Source <span aria-hidden="true">↗</span></a>
		</header>
		<main id="main" tabindex="-1">
			<section class="hero" aria-labelledby="heading">
				<nav class="crumbs" aria-label="Folder path"></nav>
				<h1 id="heading"><span>Drive</span> <em>files</em></h1>
				<p class="drive-label"></p>
				<form class="search" role="search" method="get" hidden>
					<label class="sr-only" for="query">Search drive</label>
					<span class="symbol symbol-search" aria-hidden="true"></span>
					<input id="query" name="q" type="search" placeholder="Search drive" maxlength="200" required>
					<button class="button button-primary" type="submit">Search</button>
				</form>
			</section>
			<section class="folder-notes markdown" aria-label="Folder notes" hidden></section>
			<section class="panel">
				<div class="panel-top">
					<h2></h2>
					<div class="panel-tools">
						<p class="count"></p>
						<button class="button button-secondary cancel-archive" type="button" hidden>Cancel</button>
						<button class="button button-primary download-folder" type="button" hidden><span class="symbol symbol-download" aria-hidden="true"></span>Download folder</button>
					</div>
				</div>
				<p class="archive-status" role="status" hidden></p>
				<div class="column-labels" aria-hidden="true">
					<span>Name</span><span>Last modified</span><span>Size</span><span></span>
				</div>
				<ul class="file-list" aria-label="Files and folders"></ul>
				<p class="notice" role="status"></p>
				<form class="folder-password" hidden>
					<label for="folder-password">Folder password</label>
					<input id="folder-password" name="password" type="password" required>
					<button class="button button-primary" type="submit">Unlock</button>
				</form>
				<div class="panel-actions" hidden>
					<button class="button button-secondary" type="button">Load more</button>
				</div>
			</section>
			<section class="preview panel" aria-label="File preview" hidden></section>
			<section class="folder-readme markdown" aria-label="Folder README" hidden></section>
		</main>
	</div>
`;
for (const link of document.querySelectorAll('a[href="__ROOT__"]')) link.href = root;

function create(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function nameFromPath(segment) {
	try { return decodeURIComponent(segment); } catch { return segment; }
}

const title = isSearch ? 'Search results' : (segments.length ? nameFromPath(segments.at(-1)) : 'Drive files');
if (title !== 'Drive files') document.getElementById('heading').textContent = title;
const label = document.querySelector('.drive-label');
label.textContent = isSearch
	? 'Results for “' + model.q + '”'
	: [name !== 'Rin Index' ? name : '', driveType].filter(Boolean).join(' · ');
document.title = title + (name === 'Rin Index' ? ' · Rin Index' : ' · ' + name + ' · Rin Index');

const crumbs = document.querySelector('.crumbs');
function crumb(text, href) {
	if (crumbs.children.length) {
		const divider = create('span', 'crumb-divider', '/');
		divider.setAttribute('aria-hidden', 'true');
		crumbs.append(divider);
	}
	const element = create(href ? 'a' : 'span', '', text);
	if (href) element.href = href;
	else element.setAttribute('aria-current', 'page');
	crumbs.append(element);
}
crumb('Drive', isSearch || segments.length ? root : null);
if (isSearch) crumb('Search');
let parent = root;
segments.forEach((segment, index) => {
	parent += segment + '/';
	crumb(nameFromPath(segment), index < segments.length - 1 ? parent : null);
});

const searchForm = document.querySelector('.search');
if (model.root_type < 2) {
	searchForm.hidden = false;
	searchForm.action = searchPath;
	searchForm.elements.q.value = isSearch ? model.q : '';
}

function extension(filename) {
	return filename.includes('.') ? filename.split('.').at(-1).toLowerCase() : '';
}

function fileKind(file) {
	const type = file.mimeType || '';
	if (type === folderMime) return { type: 'folder', label: 'Folder' };
	const ext = extension(file.name);
	if (/^image\/(png|jpeg|gif|bmp|webp|avif)$/.test(type) || /^(png|jpg|jpeg|gif|bmp|webp|avif)$/.test(ext)) {
		return { type: 'image', label: 'Image' };
	}
	if (type.startsWith('video/') || /^(mp4|webm|avi|mkv|mov|mpeg|mpg|wmv|m4v|rm|rmvb|asf|ts|flv)$/.test(ext)) {
		return { type: 'video', label: 'Video' };
	}
	if (type.startsWith('audio/') || /^(mp3|m4a|wav|ogg|flac|aac)$/.test(ext)) return { type: 'audio', label: 'Audio' };
	if (type === 'application/pdf' || ext === 'pdf') return { type: 'pdf', label: 'PDF' };
	if (type.startsWith('text/') || textExtensions.has(ext)) return { type: 'text', label: ext ? ext.toUpperCase() : 'Text file' };
	if (/^(zip|7z|rar|gz|tar|xz|apk)$/.test(ext)) return { type: 'archive', label: ext.toUpperCase() };
	return { type: 'file', label: ext ? ext.toUpperCase() : 'File' };
}

function formatSize(size) {
	if (size == null || size === '' || !Number.isFinite(Number(size))) return '—';
	const bytes = Number(size);
	const unit = bytes < 1024 ? 0 : Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
	return numbers.format(bytes / 1024 ** unit)
		+ ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][unit];
}

function modified(file) {
	if (!file.modifiedTime) return '—';
	const date = new Date(file.modifiedTime);
	return Number.isNaN(date.getTime()) ? '—' : dates.format(date);
}

function icon(type) {
	const element = create('span', 'file-icon file-icon-' + type);
	element.setAttribute('aria-hidden', 'true');
	element.append(create('span', 'symbol symbol-' + (type === 'folder' ? 'folder' : 'file')));
	return element;
}

function downloadLink(filePath, fileName, compact = false) {
	const link = create('a', compact ? 'row-download' : 'button button-primary');
	link.href = filePath;
	link.download = fileName;
	link.setAttribute('aria-label', 'Download ' + fileName);
	link.title = 'Download ' + fileName;
	const glyph = create('span', 'symbol symbol-download');
	glyph.setAttribute('aria-hidden', 'true');
	link.append(glyph);
	if (!compact) link.append('Download');
	return link;
}

async function post(endpoint, fields = {}) {
	const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams(fields) });
	if (!response.ok) throw new Error('Request failed. Try again in a moment.');
	return response;
}

const notice = document.querySelector('.notice');
function showNotice(message, type = '') {
	notice.className = 'notice' + (type ? ' ' + type : '');
	notice.textContent = message;
	notice.hidden = !message;
}

async function openResult(button, file, kind) {
	button.disabled = true;
	showNotice('Locating file…');
	try {
		const result = await post('/' + order + ':id2path', { id: file.id });
		const target = await result.text();
		if (!target.startsWith('/')) throw new Error('This item is outside the indexed folder.');
		const filePath = '/' + order + ':' + target;
		location.assign(filePath + (kind.type === 'folder' ? '' : '?a=view'));
	} catch (error) {
		showNotice(error.message, 'warning');
		button.disabled = false;
	}
}

function row(file) {
	const kind = fileKind(file);
	const folder = kind.type === 'folder';
	const filePath = path + encodeURIComponent(file.name);
	const entry = create('li', 'file-row');
	const link = create(isSearch ? 'button' : 'a', 'file-name');
	if (isSearch) {
		link.type = 'button';
		link.addEventListener('click', () => openResult(link, file, kind));
	} else {
		link.href = filePath + (folder ? '/' : '?a=view');
	}
	const nameGroup = create('span', 'name-group');
	const displayName = create('span', 'name-text', file.name);
	displayName.title = file.name;
	nameGroup.append(displayName, create('span', 'type-text', kind.label));
	link.append(icon(kind.type), nameGroup);
	const action = create('span', 'row-action');
	if (!isSearch && !folder) action.append(downloadLink(filePath, file.name, true));
	if (folder) {
		const arrow = create('span', 'row-arrow', '›');
		arrow.setAttribute('aria-hidden', 'true');
		action.append(arrow);
	}
	entry.append(link, create('span', 'row-date', modified(file)), create('span', 'row-size', formatSize(file.size)), action);
	return entry;
}

async function showMarkdown(file, target) {
	if (!window.markdownit) return;
	try {
		const response = await fetch(path + encodeURIComponent(file.name));
		if (!response.ok) return;
		target.innerHTML = window.markdownit().render(await response.text());
		target.hidden = !target.textContent.trim() && !target.children.length;
	} catch {
		// The file list stays available if a folder note cannot be loaded.
	}
}

const panel = document.querySelector('.panel');
const panelActions = document.querySelector('.panel-actions');
const loadButton = panelActions.querySelector('button');
const fileList = document.querySelector('.file-list');
const count = document.querySelector('.count');
const folderPassword = document.querySelector('.folder-password');
const archiveButton = document.querySelector('.download-folder');
const cancelArchive = document.querySelector('.cancel-archive');
const archiveStatus = document.querySelector('.archive-status');
let pageIndex = 0;
let nextPageToken = '';
let password = '';
let loading = false;

async function downloadFolder() {
	const controller = new AbortController();
	const { signal } = controller;
	const cancel = () => controller.abort();
	archiveStatus.hidden = false;
	archiveStatus.textContent = 'Preparing folder download…';
	archiveButton.disabled = true;
	try {
		if (typeof window.showSaveFilePicker !== 'function') {
			if (!navigator.serviceWorker) throw new Error('Open this page in a browser that supports streaming downloads.');
			await navigator.serviceWorker.register('/rin-folder-download.mjs', { type: 'module' });
			await navigator.serviceWorker.ready;
			archiveStatus.textContent = 'Download requested. Check your browser’s downloads.';
			location.assign('/_rin-folder.zip?' + new URLSearchParams({ path }));
			return;
		}
		const folderName = segments.length ? nameFromPath(segments.at(-1)) : name;
		const handle = await window.showSaveFilePicker({
			suggestedName: safeArchiveName(folderName) + '.zip',
			types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }]
		});
		cancelArchive.hidden = false;
		cancelArchive.addEventListener('click', cancel);
		const { makeZip } = await import('../vendor/client-zip.mjs');
		const { stream } = await folderZip(path, makeZip, {
			signal,
			onFile: file => { archiveStatus.textContent = 'Adding ' + file + '…'; }
		});
		signal.throwIfAborted();
		await stream.pipeTo(await handle.createWritable(), { signal });
		archiveStatus.textContent = 'Folder saved as a ZIP.';
	} catch (error) {
		archiveStatus.textContent = error.name === 'AbortError' ? 'Folder download canceled.' : (error.message || 'Could not download this folder.');
	} finally {
		archiveButton.disabled = false;
		cancelArchive.hidden = true;
		cancelArchive.removeEventListener('click', cancel);
	}
}

async function loadPage() {
	if (loading) return;
	loading = true;
	loadButton.disabled = true;
	showNotice(pageIndex ? 'Loading more files…' : 'Loading files…', 'loading');
	try {
		const fields = { page_index: pageIndex, page_token: nextPageToken };
		if (isSearch) fields.q = model.q;
		if (password) fields.password = password;

		const response = await post(isSearch ? searchPath : path, fields);
		const data = await response.json();
		if (data.error?.code === 401) {
			folderPassword.hidden = false;
			panelActions.hidden = true;
			showNotice(password ? 'That folder password was incorrect.' : 'Enter the password for this folder.', 'warning');
			folderPassword.elements.password.focus();
			return;
		}
		if (data.data?.error) throw new Error('Google Drive could not load these files.');
		folderPassword.hidden = true;
		const files = data.data?.files || [];
		for (const file of files) {
			fileList.append(row(file));
			if (isFolder && !isSearch) {
				if (file.name === 'HEAD.md') showMarkdown(file, document.querySelector('.folder-notes'));
				if (file.name === 'README.md') showMarkdown(file, document.querySelector('.folder-readme'));
			}
		}
		const total = fileList.children.length;
		count.textContent = numbers.format(total) + (total === 1 ? ' item' : ' items');
		nextPageToken = data.nextPageToken || '';
		pageIndex += 1;
		panelActions.hidden = !nextPageToken;
		loadButton.textContent = 'Load more';
		showNotice(total ? '' : isSearch ? 'No files matched your search.' : 'This folder is empty.');
	} catch (error) {
		showNotice(error.message || 'Could not load files.', 'warning');
		panelActions.hidden = false;
		loadButton.textContent = 'Try again';
	} finally {
		loading = false;
		loadButton.disabled = false;
	}
}

async function previewFile() {
	panel.hidden = true;
	const preview = document.querySelector('.preview');
	preview.hidden = false;
	const message = create('p', 'notice loading', 'Loading preview…');
	message.setAttribute('role', 'status');
	preview.append(message);
	try {
		const response = await post(path);
		const file = await response.json();
		const kind = fileKind(file);
		const header = create('header', 'preview-header');
		const detail = create('div', 'preview-detail');
		detail.append(create('h2', '', file.name), create('p', '', [kind.label, formatSize(file.size), modified(file)].join(' · ')));
		header.append(icon(kind.type), detail, downloadLink(path, file.name));
		preview.prepend(header);

		const inline = path + '?inline=true';
		let media;
		if (kind.type === 'image') {
			media = create('img', 'preview-image');
			media.alt = file.name;
		} else if (kind.type === 'audio' || kind.type === 'video') {
			media = create(kind.type, 'preview-media');
			media.controls = true;
			media.preload = 'metadata';
		} else if (kind.type === 'pdf') {
			media = create('iframe', 'preview-pdf');
			media.title = 'Preview of ' + file.name;
		} else if (kind.type === 'text') {
			const content = await fetch(path);
			if (!content.ok) throw new Error('Could not load this preview.');
			preview.append(create('pre', 'preview-text', await content.text()));
		} else {
			preview.append(create('p', 'notice', 'This file is available to download.'));
		}

		if (media) {
			media.addEventListener('error', () => {
				media.replaceWith(create('p', 'notice warning', 'This file could not be previewed. Use Download to open it on your device.'));
			}, { once: true });
			media.src = inline;
			preview.append(media);
		}
		message.remove();
	} catch (error) {
		message.className = 'notice warning';
		message.textContent = error.message || 'Could not load this file.';
	}
}

if (isSearch || isFolder) {
	panel.querySelector('h2').textContent = isSearch ? 'Matching files' : 'Files and folders';
	if (isFolder && !isSearch) {
		archiveButton.hidden = false;
		archiveButton.addEventListener('click', downloadFolder);
	}
	loadButton.addEventListener('click', loadPage);
	folderPassword.addEventListener('submit', event => {
		event.preventDefault();
		password = folderPassword.elements.password.value;
		loadPage();
	});
	loadPage();
} else {
	previewFile();
}

