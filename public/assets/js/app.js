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
						<a class="button button-secondary save-folder-links" hidden>Save links (.txt)</a>
						<button class="button button-primary download-files" type="button" hidden><span class="symbol symbol-download" aria-hidden="true"></span>Download files</button>
						<button class="button button-secondary admin-signin" type="button" hidden>Admin</button>
						<button class="button button-primary upload-files" type="button" hidden><span class="symbol symbol-upload" aria-hidden="true"></span>Upload</button>
					</div>
				</div>
				<form class="admin-signin-form" hidden>
					<label for="admin-user">Admin username</label>
					<input id="admin-user" name="user" autocomplete="username" required>
					<label for="admin-pass">Admin password</label>
					<input id="admin-pass" name="pass" type="password" autocomplete="current-password" required>
					<button class="button button-primary" type="submit">Sign in</button>
				</form>
				<input class="upload-input" type="file" multiple hidden>
				<p class="download-status" role="status" hidden></p>
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
			<div class="upload-modal" hidden>
				<div class="upload-modal-backdrop"></div>
				<section class="upload-modal-card" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title">
					<header class="upload-modal-header">
						<h2 id="upload-modal-title">Uploading files</h2>
						<button class="upload-modal-close" type="button" aria-label="Close upload progress"><span class="symbol symbol-close" aria-hidden="true"></span>Close</button>
					</header>
					<div class="upload-batch" hidden>
						<p class="upload-batch-status"></p>
						<div class="upload-bar"><span></span></div>
						<p class="upload-batch-detail"></p>
					</div>
					<ul class="upload-modal-files"></ul>
				</section>
			</div>
		</main>
	</div>
	<p class="copy-toast" role="status" aria-live="polite" hidden></p>
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

// Copy URL: copies the same direct-download address the row's download
// button uses (origin + encoded nested path), so every access rule the
// Worker enforces for a direct download also applies to the copied URL.
function copyUrlButton(downloadAnchor, fileName) {
	const button = create('button', 'row-copy');
	button.type = 'button';
	button.title = 'Copy direct URL';
	button.setAttribute('aria-label', 'Copy direct URL for ' + fileName);
	button.append(create('span', 'symbol symbol-copy'));
	button.addEventListener('click', () => copyDirectUrl(downloadAnchor.href, fileName));
	return button;
}

async function copyDirectUrl(url, fileName) {
	let copied = false;
	try {
		await navigator.clipboard.writeText(url);
		copied = true;
	} catch {}
	if (!copied) {
		// Fallback for browsers or plain-HTTP contexts without the
		// asynchronous clipboard API.
		try {
			const helper = document.createElement('textarea');
			helper.value = url;
			helper.className = 'copy-helper';
			helper.setAttribute('readonly', '');
			document.body.append(helper);
			helper.select();
			copied = document.execCommand('copy');
			helper.remove();
		} catch {}
	}
	showCopyToast(copied ? 'URL copied · ' + fileName : 'Copy blocked · ' + url);
}

const copyToast = document.querySelector('.copy-toast');
let copyToastTimer = 0;
function showCopyToast(text) {
	copyToast.textContent = text;
	copyToast.hidden = false;
	clearTimeout(copyToastTimer);
	copyToastTimer = setTimeout(() => { copyToast.hidden = true; }, 2200);
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
	if (!isSearch && !folder) {
		const download = downloadLink(filePath, file.name, true);
		action.append(download, copyUrlButton(download, file.name));
	}
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
const downloadFilesButton = document.querySelector('.download-files');
const saveLinksButton = document.querySelector('.save-folder-links');
const downloadStatus = document.querySelector('.download-status');
let pageIndex = 0;
let nextPageToken = '';
let password = '';
let loading = false;

async function* folderFiles() {
	const folders = [path];
	for (const folder of folders) {
		let pageToken = '';
		let index = 0;
		do {
			const fields = { page_index: index, page_token: pageToken };
			if (folder === path && password) fields.password = password;
			const response = await post(folder, fields);
			const listing = await response.json();
			if (!Array.isArray(listing.data?.files)) throw new Error('Could not list ' + nameFromPath(folder.split('/').at(-2)) + '.');
			for (const file of listing.data.files) {
				const filePath = folder + encodeURIComponent(file.name);
				if (file.mimeType === folderMime) folders.push(filePath + '/');
				else yield { file, filePath };
			}
			pageToken = listing.nextPageToken;
			index++;
		} while (pageToken);
	}
}

function startDownload(url, name) {
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.hidden = true;
	document.body.append(link);
	link.click();
	link.remove();
}

async function downloadFolderFiles() {
	downloadFilesButton.disabled = true;
	downloadStatus.hidden = false;
	downloadStatus.textContent = 'Finding files… Allow multiple downloads if your browser asks.';
	let requested = 0;
	let skipped = 0;
	try {
		for await (const { file, filePath } of folderFiles()) {
			if (file.capabilities?.canDownload === false) {
				skipped++;
			} else {
				startDownload(filePath, file.name);
				requested++;
				downloadStatus.textContent = 'Starting downloads… ' + numbers.format(requested) + ' requested. Allow multiple downloads if asked.';
				await new Promise(resolve => setTimeout(resolve, 350));
			}
		}
		let message = requested ? 'Check your browser’s downloads. ' + numbers.format(requested) + ' requested.' : 'No downloadable files found.';
		if (skipped) message += ' Google Drive restricted ' + numbers.format(skipped) + (skipped === 1 ? ' file.' : ' files.');
		downloadStatus.textContent = message;
	} catch (error) {
		const progress = requested ? numbers.format(requested) + ' downloads requested. ' : '';
		downloadStatus.textContent = progress + error.message;
	} finally {
		downloadFilesButton.disabled = false;
	}
}

// Admin uploads: the Worker seals the Drive session behind an opaque token,
// so credentials, tokens, and session URLs never appear in page responses.
// The engine (upload-engine.js) drives resumable chunks with live speed and
// ETA; this layer renders the centered progress popup and refreshes the
// listing when the batch finishes.
const uploadButton = document.querySelector('.upload-files');
const adminButton = document.querySelector('.admin-signin');
const adminForm = document.querySelector('.admin-signin-form');
const uploadInput = document.querySelector('.upload-input');
const uploadModal = document.querySelector('.upload-modal');
const uploadModalTitle = document.querySelector('#upload-modal-title');
const uploadModalClose = document.querySelector('.upload-modal-close');
const uploadBatch = document.querySelector('.upload-batch');
const uploadBatchStatus = document.querySelector('.upload-batch-status');
const uploadBatchFill = document.querySelector('.upload-batch .upload-bar span');
const uploadBatchDetail = document.querySelector('.upload-batch-detail');
const uploadFilesList = document.querySelector('.upload-modal-files');
const uploadRows = [];
let adminHeader = null;
let uploadEngine = null;

function authHeaders() {
	return adminHeader ? { 'Authorization': adminHeader } : {};
}

function basicAuthValue(username, password) {
	const bytes = new TextEncoder().encode(username + ':' + password);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return 'Basic ' + btoa(binary);
}

function refreshListing() {
	fileList.replaceChildren();
	for (const selector of ['.folder-notes', '.folder-readme']) {
		const section = document.querySelector(selector);
		section.replaceChildren();
		section.hidden = true;
	}
	pageIndex = 0;
	nextPageToken = '';
	loadPage();
}

// XHR transport gives byte-granular progress events while a chunk streams,
// keeping the progress bar, speed, and ETA current without polling.
function xhrTransport(url, init, onProgress) {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open(init.method || 'GET', url);
		for (const [name, value] of Object.entries(init.headers || {})) {
			try { request.setRequestHeader(name, value); } catch {}
		}
		if (onProgress) {
			request.upload.onprogress = event => {
				if (event.lengthComputable) onProgress(event.loaded);
			};
		}
		request.onload = () => resolve({
			status: request.status,
			ok: request.status >= 200 && request.status < 300,
			headers: { get: name => request.getResponseHeader(name) },
			json: async () => JSON.parse(request.responseText)
		});
		request.onerror = () => reject(new TypeError('The chunk could not reach Rin Index.'));
		request.onabort = () => reject(new TypeError('The upload request was cancelled.'));
		request.send(init.body);
	});
}

function getUploadEngine() {
	if (!uploadEngine) uploadEngine = new window.RinUploadEngine.Engine({ transport: xhrTransport });
	return uploadEngine;
}

function formatSpeed(bytesPerSecond) {
	if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
	return (bytesPerSecond / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function formatEta(seconds) {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
	const total = Math.round(seconds);
	if (total < 60) return total + 's left';
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return minutes + 'm ' + (total % 60) + 's left';
	return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm left';
}

function modalRow(event) {
	if (uploadRows[event.index]) return uploadRows[event.index];
	const item = create('li', 'upload-modal-file');
	const name = create('p', 'upload-file-name', event.name);
	name.title = event.name;
	const bar = create('div', 'upload-bar');
	const fill = create('span');
	bar.append(fill);
	const detail = create('p', 'upload-file-detail', 'Starting…');
	item.append(name, bar, detail);
	uploadFilesList.append(item);
	uploadRows[event.index] = { item, fill, detail };
	return uploadRows[event.index];
}

function handleUploadEvent(event) {
	if (event.type === 'file-start') {
		modalRow(event);
		return;
	}
	if (event.type === 'file-progress') {
		const row = modalRow(event);
		row.fill.style.width = Math.min(100, event.percent || 0).toFixed(1) + '%';
		row.detail.textContent = (event.percent || 0).toFixed(0) + '% · ' +
			formatSize(event.uploaded) + ' of ' + formatSize(event.total) + ' · ' +
			formatSpeed(event.speed) + ' · ' + formatEta(event.eta);
		return;
	}
	if (event.type === 'file-retry') {
		const row = modalRow(event);
		row.item.classList.add('retrying');
		row.detail.textContent = 'Retrying (attempt ' + event.attempt + ')… ' +
			formatSize(event.committed) + ' of ' + formatSize(event.total) + ' confirmed';
		return;
	}
	if (event.type === 'file-done') {
		const row = modalRow(event);
		row.item.classList.remove('retrying');
		row.item.classList.add('done');
		row.fill.style.width = '100%';
		row.detail.textContent = 'Uploaded · ' + formatSize(event.total);
		return;
	}
	if (event.type === 'file-error') {
		const row = modalRow(event);
		row.item.classList.remove('retrying');
		row.item.classList.add('error');
		row.fill.style.width = row.fill.style.width || '0%';
		row.detail.textContent = event.message;
		return;
	}
	if (event.type === 'batch-progress') {
		uploadBatch.hidden = event.filesTotal <= 1;
		uploadBatchFill.style.width = Math.min(100, event.percent || 0).toFixed(1) + '%';
		uploadBatchStatus.textContent = event.filesDone + ' of ' + event.filesTotal + ' files · ' +
			formatSize(event.uploaded) + ' of ' + formatSize(event.total);
		uploadBatchDetail.textContent = (event.percent || 0).toFixed(0) + '% · ' +
			formatSpeed(event.speed) + ' · ' + formatEta(event.eta);
		return;
	}
	if (event.type === 'batch-done') {
		uploadModalTitle.textContent = event.failed
			? 'Uploads finished (' + event.succeeded + ' of ' + event.filesTotal + ')'
			: 'Uploads finished';
		uploadBatchDetail.textContent = event.succeeded + ' of ' + event.filesTotal + ' uploaded' +
			(event.failed ? ' · ' + event.failed + ' failed' : '');
	}
}

function openUploadModal() {
	uploadFilesList.replaceChildren();
	uploadRows.length = 0;
	uploadBatch.hidden = true;
	uploadBatchFill.style.width = '0%';
	uploadModalTitle.textContent = 'Uploading files';
	uploadModal.hidden = false;
	document.body.classList.add('upload-open');
}

function closeUploadModal() {
	uploadModal.hidden = true;
	document.body.classList.remove('upload-open');
}

function startUpload(files) {
	openUploadModal();
	uploadButton.disabled = true;
	getUploadEngine().upload(files, {
		path,
		getHeaders: authHeaders,
		concurrency: 2,
		onEvent: handleUploadEvent
	}).then(state => {
		uploadButton.disabled = false;
		if (state.succeeded) refreshListing();
	}).catch(() => {
		uploadButton.disabled = false;
	});
}

function setupAdminUploads() {
	if (model.is_admin) {
		uploadButton.hidden = false;
	} else {
		adminButton.hidden = false;
		adminButton.addEventListener('click', () => {
			adminButton.hidden = true;
			adminForm.hidden = false;
			adminForm.elements.user.focus();
		});
		adminForm.addEventListener('submit', async event => {
			event.preventDefault();
			const header = basicAuthValue(adminForm.elements.user.value, adminForm.elements.pass.value);
			try {
				const response = await fetch(path + '?upload=whoami', { headers: { 'Authorization': header } });
				if (!response.ok) throw new Error();
				adminHeader = header;
				adminForm.hidden = true;
				adminForm.reset();
				uploadButton.hidden = false;
			} catch {
				showNotice('That admin sign-in did not work. Check the username and password.', 'warning');
			}
		});
	}
	uploadButton.addEventListener('click', () => uploadInput.click());
	uploadInput.addEventListener('change', () => {
		const files = [...uploadInput.files];
		uploadInput.value = '';
		if (files.length) startUpload(files);
	});
	uploadModalClose.addEventListener('click', closeUploadModal);
	document.querySelector('.upload-modal-backdrop').addEventListener('click', closeUploadModal);
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && !uploadModal.hidden) closeUploadModal();
	});
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
		downloadFilesButton.hidden = false;
		saveLinksButton.href = path + '?download=links';
		saveLinksButton.hidden = false;
		downloadFilesButton.addEventListener('click', downloadFolderFiles);
		if (model.can_upload) setupAdminUploads();
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

