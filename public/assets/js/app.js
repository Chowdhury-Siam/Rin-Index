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

// Inline icon set drawn for Rin Index on a 24px grid, stroked at 1.7.
const iconSprite = `
<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="display:none">
	<symbol id="i-folder" viewBox="0 0 24 24"><path d="M3.8 6.4c0-1 .8-1.8 1.8-1.8h3.5c.5 0 1 .2 1.3.6l1 1.2h7c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H5.6c-1 0-1.8-.8-1.8-1.8z"/></symbol>
	<symbol id="i-file" viewBox="0 0 24 24"><path d="M13.2 3.8H7.4c-1 0-1.8.8-1.8 1.8v12.8c0 1 .8 1.8 1.8 1.8h9.2c1 0 1.8-.8 1.8-1.8V9z"/><path d="M13.2 3.8V9h5.2"/></symbol>
	<symbol id="i-text" viewBox="0 0 24 24"><path d="M13.2 3.8H7.4c-1 0-1.8.8-1.8 1.8v12.8c0 1 .8 1.8 1.8 1.8h9.2c1 0 1.8-.8 1.8-1.8V9z"/><path d="M13.2 3.8V9h5.2"/><path d="M8.8 13h6.4M8.8 16h6.4M8.8 10h3"/></symbol>
	<symbol id="i-image" viewBox="0 0 24 24"><rect x="3.8" y="5.5" width="16.4" height="13" rx="1.8"/><circle cx="8.6" cy="10" r="1.5"/><path d="M6.2 16.5 9.4 13l2.2 2.3 2.6-2.7 3.6 3.7"/></symbol>
	<symbol id="i-video" viewBox="0 0 24 24"><rect x="3.8" y="5.5" width="16.4" height="13" rx="1.8"/><path d="M10.3 9.5v5l4.4-2.5z"/></symbol>
	<symbol id="i-audio" viewBox="0 0 24 24"><path d="M9.6 17.4V7.5l7.2-1.6v9.5"/><circle cx="7.6" cy="17.4" r="2"/><circle cx="14.8" cy="15.4" r="2"/></symbol>
	<symbol id="i-archive" viewBox="0 0 24 24"><rect x="4.2" y="4.5" width="15.6" height="15" rx="1.8"/><path d="M12 4.5v4.2M10 8.7h4"/></symbol>
	<symbol id="i-code" viewBox="0 0 24 24"><path d="m8.6 8.4-3.6 3.6 3.6 3.6M15.4 8.4l3.6 3.6-3.6 3.6M13.2 6.2l-2.4 11.6"/></symbol>
	<symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.6"/><path d="m15 15 4.6 4.6"/></symbol>
	<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4.4v10.2M7.5 10.4l4.5 4.5 4.5-4.5M4.5 19.6h15"/></symbol>
	<symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 14.6V4.4M7.5 8.4 12 3.9l4.5 4.5M4.5 19.6h15"/></symbol>
	<symbol id="i-link" viewBox="0 0 24 24"><path d="M9.3 9.3h7.2c.9 0 1.6.7 1.6 1.6v7.2c0 .9-.7 1.6-1.6 1.6H9.3c-.9 0-1.6-.7-1.6-1.6v-7.2c0-.9.7-1.6 1.6-1.6z"/><path d="M14.7 6.7V6c0-.9-.7-1.6-1.6-1.6H5.9C5 4.4 4.3 5.1 4.3 6v7.2c0 .9.7 1.6 1.6 1.6h.7"/></symbol>
	<symbol id="i-pause" viewBox="0 0 24 24"><path d="M9.2 6.6v10.8M14.8 6.6v10.8"/></symbol>
	<symbol id="i-play" viewBox="0 0 24 24"><path d="M9 6.8v10.4L17.4 12z"/></symbol>
	<symbol id="i-x" viewBox="0 0 24 24"><path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4"/></symbol>
	<symbol id="i-check" viewBox="0 0 24 24"><path d="m5.6 12.6 4.2 4.2 8.6-9.6"/></symbol>
	<symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9.4 6.4 5.6 5.6-5.6 5.6"/></symbol>
	<symbol id="i-collapse" viewBox="0 0 24 24"><path d="m6.4 9.4 5.6 5.6 5.6-5.6"/></symbol>
	<symbol id="i-external" viewBox="0 0 24 24"><path d="M13.6 5.4h5v5M18.6 5.4 11 13"/><path d="M16 14v4.2c0 .9-.7 1.6-1.6 1.6H6c-.9 0-1.6-.7-1.6-1.6V8.2c0-.9.7-1.6 1.6-1.6h4"/></symbol>
	<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.8"/><path d="M12 3.6v2M12 18.4v2M3.6 12h2M18.4 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5 6.1 17.9"/></symbol>
	<symbol id="i-moon" viewBox="0 0 24 24"><path d="M19.4 13.4A7.4 7.4 0 0 1 10.6 4.6a7.4 7.4 0 1 0 8.8 8.8z"/></symbol>
	<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5.4" y="10.6" width="13.2" height="9" rx="1.6"/><path d="M8.4 10.6V8.4a3.6 3.6 0 0 1 7.2 0v2.2"/></symbol>
	<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4.6 3 19.4h18z"/><path d="M12 10.4v3.6M12 17.2v.2"/></symbol>
	<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.4v4.2h-4.2"/></symbol>
</svg>`;

function icon(name, className) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('class', (className ? className + ' ' : '') + 'icon');
	svg.setAttribute('aria-hidden', 'true');
	const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
	use.setAttribute('href', '#i-' + name);
	svg.append(use);
	return svg;
}

document.body.innerHTML = iconSprite + `
	<a class="skip-link" href="#main">Skip to files</a>
	<div class="frame">
		<header class="topbar">
			<a class="brand" href="__ROOT__"><img src="/assets/rin-mark.png" width="26" height="26" alt="">Rin Index</a>
			<div class="topbar-actions">
				<button class="icon-btn theme-toggle" type="button" aria-label="Switch theme"></button>
				<a class="source-link" href="https://github.com/Chowdhury-Siam/Google-Index">Source ${'' /* icon appended in JS */}</a>
			</div>
		</header>
		<main id="main" tabindex="-1">
			<section class="pagehead" aria-labelledby="heading">
				<nav class="crumbs" aria-label="Folder path"></nav>
				<h1 class="page-title" id="heading">Drive <em>files</em></h1>
				<p class="drive-label"></p>
				<form class="search" role="search" method="get" hidden>
					<label class="sr-only" for="query">Search drive</label>
					<span class="field"><svg class="icon" aria-hidden="true"><use href="#i-search"></use></svg>
						<input id="query" name="q" type="search" placeholder="Search drive" maxlength="200" required>
					</span>
					<button class="button button-primary" type="submit">Search</button>
				</form>
			</section>
			<section class="folder-notes markdown" aria-label="Folder notes" hidden></section>
			<section class="panel">
				<div class="panel-head">
					<h2 class="panel-title"></h2>
					<div class="panel-tools">
						<p class="count"></p>
						<a class="button button-secondary save-folder-links" hidden>Save links (.txt)</a>
						<button class="button button-primary download-files" type="button" hidden>Download files</button>
						<button class="button button-secondary admin-signin" type="button" hidden>Admin</button>
						<button class="button button-primary upload-files" type="button" hidden>Upload</button>
					</div>
				</div>
				<input class="upload-input" type="file" multiple hidden>
				<p class="load-status" role="status" hidden></p>
				<div class="list-head" aria-hidden="true">
					<span>Name</span><span>Last modified</span><span>Size</span><span></span>
				</div>
				<ul class="file-list" aria-label="Files and folders"></ul>
				<p class="notice" role="status"></p>
				<form class="folder-password inline" hidden>
					<label for="folder-password">Folder password</label>
					<input id="folder-password" name="password" type="password" required>
					<button class="button button-primary" type="submit">Unlock</button>
				</form>
				<div class="panel-actions" hidden>
					<button class="button button-secondary load-more" type="button">Load more</button>
				</div>
			</section>
			<section class="folder-readme markdown" aria-label="Folder README" hidden></section>
		</main>
	</div>

	<div class="modal-backdrop signin-backdrop" hidden>
		<div class="modal signin" role="dialog" aria-modal="true" aria-labelledby="signin-title">
			<div class="modal-head">
				<h2 id="signin-title">Admin sign-in</h2>
				<span class="spacer"></span>
				<button class="icon-btn signin-close" type="button" aria-label="Close"></button>
			</div>
			<form class="modal-body signin-form">
				<p class="signin-error" hidden></p>
				<div class="field">
					<label for="admin-user">Username</label>
					<input id="admin-user" name="user" autocomplete="username" required>
				</div>
				<div class="field">
					<label for="admin-pass">Password</label>
					<input id="admin-pass" name="pass" type="password" autocomplete="current-password" required>
				</div>
				<button class="button button-primary" type="submit">Sign in</button>
			</form>
		</div>
	</div>

	<div class="modal-backdrop preview-backdrop" hidden>
		<div class="modal preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
			<div class="modal-head">
				<h2 class="preview-name" id="preview-title"></h2>
				<span class="spacer"></span>
				<button class="icon-btn preview-copy" type="button" aria-label="Copy direct URL"></button>
				<a class="icon-btn preview-download" aria-label="Download"></a>
				<button class="icon-btn preview-close" type="button" aria-label="Close preview"></button>
			</div>
			<div class="modal-body">
				<p class="preview-meta"></p>
				<div class="preview-stage"><p class="notice">Loading preview…</p></div>
			</div>
		</div>
	</div>

	<div class="modal-backdrop upload-backdrop" hidden>
		<div class="modal upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
			<div class="modal-head">
				<h2 id="upload-title">Uploading files</h2>
				<span class="spacer"></span>
				<button class="icon-btn upload-minimize" type="button" aria-label="Minimize upload progress"></button>
				<button class="icon-btn upload-close" type="button" aria-label="Close upload progress"></button>
			</div>
			<div class="upload-overview">
				<div class="topline">
					<span class="upload-percent">0%</span>
					<span class="upload-figures"></span>
				</div>
				<div class="bar"><div class="bar-fill"></div></div>
				<div class="upload-sub"></div>
			</div>
			<ul class="upload-list"></ul>
			<div class="modal-foot">
				<button class="button button-secondary upload-pause-all" type="button">Pause all</button>
				<button class="button button-secondary upload-resume-all" type="button">Resume all</button>
				<button class="button button-danger upload-cancel-rest" type="button">Cancel remaining</button>
				<button class="button button-secondary upload-retry-failed" type="button" hidden>Retry failed</button>
				<button class="button button-secondary upload-copy-report" type="button" hidden>Copy report</button>
			</div>
		</div>
	</div>

	<button class="upload-dock" type="button" hidden></button>
	<div class="toast" role="status" aria-live="polite"></div>
`;

for (const link of document.querySelectorAll('a[href="__ROOT__"]')) link.href = root;
document.querySelector('.source-link').append(icon('external'));
document.querySelector('.theme-toggle').append(icon('moon'));
document.querySelector('.signin-close').append(icon('x'));
document.querySelector('.preview-copy').append(icon('link'));
document.querySelector('.preview-download').append(icon('download'));
document.querySelector('.preview-close').append(icon('x'));
document.querySelector('.upload-minimize').append(icon('collapse'));
document.querySelector('.upload-close').append(icon('x'));
document.querySelector('.download-files').prepend(icon('download'));
document.querySelector('.upload-files').prepend(icon('upload'));
document.querySelector('.save-folder-links').prepend(icon('download'));

function create(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function nameFromPath(segment) {
	try { return decodeURIComponent(segment); } catch { return segment; }
}

/* ------------------------------------------------------------------ theme --- */

const themeToggle = document.querySelector('.theme-toggle');
let themePreferenceSaved = false;
try { themePreferenceSaved = Boolean(localStorage.getItem('rin-theme')); } catch {}

function applyTheme(theme, save) {
	document.documentElement.dataset.theme = theme;
	themeToggle.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
	themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
	if (save) {
		try { localStorage.setItem('rin-theme', theme); } catch {}
		themePreferenceSaved = true;
	}
}

themeToggle.addEventListener('click', () => {
	applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
});
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
if (!themePreferenceSaved && window.matchMedia) {
	const media = matchMedia('(prefers-color-scheme: dark)');
	const follow = () => { if (!themePreferenceSaved) applyTheme(media.matches ? 'dark' : 'light', false); };
	if (media.addEventListener) media.addEventListener('change', follow);
}

/* -------------------------------------------------------------- headings --- */

const title = isSearch ? 'Search results' : (segments.length ? nameFromPath(segments.at(-1)) : 'Drive files');
if (title !== 'Drive files') document.getElementById('heading').textContent = title;
const driveLabel = document.querySelector('.drive-label');
driveLabel.textContent = isSearch
	? 'Results for “' + model.q + '”'
	: [name !== 'Rin Index' ? name : '', driveType].filter(Boolean).join(' · ');
document.title = title + (name === 'Rin Index' ? ' · Rin Index' : ' · ' + name + ' · Rin Index');

const crumbs = document.querySelector('.crumbs');
function crumb(text, href) {
	if (crumbs.children.length) {
		const divider = icon('chevron', 'sep');
		crumbs.append(divider);
	}
	const element = create(href ? 'a' : 'span', href ? '' : 'current', text);
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

/* ----------------------------------------------------------- file kinds --- */

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
	if (/^(js|mjs|ts|json|py|sh|java|go|php|css|html|xml|yaml|yml|ini|toml)$/.test(ext)) return { type: 'code', label: ext.toUpperCase() };
	return { type: 'file', label: ext ? ext.toUpperCase() : 'File' };
}

function kindIcon(type) {
	const names = { folder: 'folder', image: 'image', video: 'video', audio: 'audio', archive: 'archive', code: 'code', text: 'text', pdf: 'text' };
	return icon(names[type] || 'file', 'icon-file');
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

/* ------------------------------------------------------------ copy & toast --- */

async function writeClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {}
	try {
		const helper = document.createElement('textarea');
		helper.value = text;
		helper.setAttribute('readonly', '');
		helper.style.position = 'fixed';
		helper.style.left = '-9999px';
		document.body.append(helper);
		helper.select();
		const copied = document.execCommand('copy');
		helper.remove();
		return copied;
	} catch {
		return false;
	}
}

const toast = document.querySelector('.toast');
let toastTimer = 0;
function showToast(text) {
	toast.textContent = text;
	toast.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// Copy URL: copies the same direct-download address the row's download
// button uses (origin + encoded nested path), so every access rule the
// Worker enforces for a direct download also applies to the copied URL.
async function copyDirectUrl(url, fileName) {
	const copied = await writeClipboard(url);
	showToast(copied ? 'URL copied · ' + fileName : 'Copy blocked · ' + url);
}

function copyUrlButton(url, fileName) {
	const button = create('button', 'icon-btn');
	button.type = 'button';
	button.title = 'Copy direct URL';
	button.setAttribute('aria-label', 'Copy direct URL for ' + fileName);
	button.append(icon('link'));
	button.addEventListener('click', () => copyDirectUrl(url, fileName));
	return button;
}

function downloadIconLink(filePath, fileName) {
	const link = create('a', 'icon-btn');
	link.href = filePath;
	link.download = fileName;
	link.title = 'Download ' + fileName;
	link.setAttribute('aria-label', 'Download ' + fileName);
	link.append(icon('download'));
	return link;
}

/* ------------------------------------------------------------- data load --- */

async function post(endpoint, fields = {}) {
	const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams(fields) });
	if (!response.ok) throw new Error('Request failed. Try again in a moment.');
	return response;
}

const notice = document.querySelector('.notice');
function showNotice(message) {
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
		showNotice(error.message);
		button.disabled = false;
	}
}

function row(file) {
	const kind = fileKind(file);
	const folder = kind.type === 'folder';
	const filePath = path + encodeURIComponent(file.name);
	const entry = create('li', 'row');

	const main = create(isSearch ? 'button' : 'a', 'row-main' + (folder ? ' is-folder' : ''));
	if (isSearch) {
		main.type = 'button';
		main.addEventListener('click', () => openResult(main, file, kind));
	} else {
		main.href = filePath + (folder ? '/' : '?a=view');
	}
	const name = create('span', 'row-name', file.name);
	name.title = file.name;
	main.append(kindIcon(kind.type), name);

	const side = create('div', 'row-side');
	side.append(
		create('span', 'row-date', modified(file)),
		create('span', 'row-size', formatSize(file.size))
	);
	const actions = create('div', 'row-actions');
	if (!isSearch && !folder) {
		actions.append(
			copyUrlButton(filePath, file.name),
			downloadIconLink(filePath, file.name)
		);
	}
	side.append(actions);
	entry.append(main, side);
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
const loadButton = document.querySelector('.load-more');
const fileList = document.querySelector('.file-list');
const count = document.querySelector('.count');
const folderPassword = document.querySelector('.folder-password');
const downloadFilesButton = document.querySelector('.download-files');
const saveLinksButton = document.querySelector('.save-folder-links');
const loadStatus = document.querySelector('.load-status');
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
	loadStatus.hidden = false;
	loadStatus.textContent = 'Finding files… Allow multiple downloads if your browser asks.';
	let requested = 0;
	let skipped = 0;
	try {
		for await (const { file, filePath } of folderFiles()) {
			if (file.capabilities?.canDownload === false) {
				skipped++;
			} else {
				startDownload(filePath, file.name);
				requested++;
				loadStatus.textContent = 'Starting downloads… ' + numbers.format(requested) + ' requested. Allow multiple downloads if asked.';
				await new Promise(resolve => setTimeout(resolve, 350));
			}
		}
		let message = requested ? 'Check your browser’s downloads. ' + numbers.format(requested) + ' requested.' : 'No downloadable files found.';
		if (skipped) message += ' Google Drive restricted ' + numbers.format(skipped) + (skipped === 1 ? ' file.' : ' files.');
		loadStatus.textContent = message;
	} catch (error) {
		const progress = requested ? numbers.format(requested) + ' downloads requested. ' : '';
		loadStatus.textContent = progress + error.message;
	} finally {
		downloadFilesButton.disabled = false;
	}
}

async function loadPage() {
	if (loading) return;
	loading = true;
	loadButton.disabled = true;
	showNotice(pageIndex ? 'Loading more files…' : 'Loading files…');
	try {
		const fields = { page_index: pageIndex, page_token: nextPageToken };
		if (isSearch) fields.q = model.q;
		if (password) fields.password = password;

		const response = await post(isSearch ? searchPath : path, fields);
		const data = await response.json();
		if (data.error?.code === 401) {
			folderPassword.hidden = false;
			panelActions.hidden = true;
			showNotice(password ? 'That folder password was incorrect.' : 'Enter the password for this folder.');
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
		showNotice(error.message || 'Could not load files.');
		panelActions.hidden = false;
		loadButton.textContent = 'Try again';
	} finally {
		loading = false;
		loadButton.disabled = false;
	}
}

function refreshListing() {
	fileList.replaceChildren();
	count.textContent = '';
	for (const selector of ['.folder-notes', '.folder-readme']) {
		const section = document.querySelector(selector);
		section.replaceChildren();
		section.hidden = true;
	}
	pageIndex = 0;
	nextPageToken = '';
	loadPage();
}

/* --------------------------------------------------------------- preview --- */

const previewBackdrop = document.querySelector('.preview-backdrop');
const previewTitle = document.querySelector('.preview-name');
const previewMeta = document.querySelector('.preview-meta');
const previewStage = document.querySelector('.preview-stage');
const previewDownload = document.querySelector('.preview-download');

function parentPath() {
	const parts = path.slice(root.length).split('/').filter(Boolean);
	return root + parts.slice(0, -1).join('/') + (parts.length > 1 ? '/' : '');
}

function leavePreview() {
	const fallback = setTimeout(() => location.assign(parentPath() || root), 400);
	window.addEventListener('pagehide', () => clearTimeout(fallback), { once: true });
	history.back();
}

document.querySelector('.preview-close').addEventListener('click', leavePreview);
previewBackdrop.addEventListener('click', event => {
	if (event.target === previewBackdrop) leavePreview();
});

async function previewFile() {
	previewBackdrop.hidden = false;
	try {
		const response = await post(path);
		const file = await response.json();
		const kind = fileKind(file);
		previewTitle.textContent = file.name;
		previewMeta.textContent = [kind.label, formatSize(file.size), modified(file)].join(' · ');
		previewDownload.href = path;
		previewDownload.download = file.name;
		document.querySelector('.preview-copy').onclick = () => copyDirectUrl(path, file.name);

		previewStage.replaceChildren(create('p', 'notice', 'Loading preview…'));
		const inline = path + '?inline=true';
		let media = null;
		if (kind.type === 'image') {
			media = create('img');
			media.alt = file.name;
		} else if (kind.type === 'audio' || kind.type === 'video') {
			media = create(kind.type);
			media.controls = true;
			media.preload = 'metadata';
		} else if (kind.type === 'pdf') {
			media = create('iframe');
			media.title = 'Preview of ' + file.name;
		} else if (kind.type === 'text') {
			const content = await fetch(path);
			if (!content.ok) throw new Error('Could not load this preview.');
			previewStage.replaceChildren(create('pre', '', await content.text()));
		} else {
			previewStage.replaceChildren(create('p', 'notice', 'This file is available to download.'));
		}

		if (media) {
			media.addEventListener('error', () => {
				previewStage.replaceChildren(create('p', 'notice', 'This file could not be previewed. Use Download to open it on your device.'));
			}, { once: true });
			media.src = inline;
			previewStage.replaceChildren(media);
		}
	} catch (error) {
		previewStage.replaceChildren(create('p', 'notice', error.message || 'Could not load this file.'));
	}
}

/* ------------------------------------------------------------ admin sign-in --- */

const adminButton = document.querySelector('.admin-signin');
const signinBackdrop = document.querySelector('.signin-backdrop');
const signinForm = document.querySelector('.signin-form');
const signinError = document.querySelector('.signin-error');
let adminHeader = null;

function authHeaders() {
	return adminHeader ? { 'Authorization': adminHeader } : {};
}

function basicAuthValue(username, password) {
	const bytes = new TextEncoder().encode(username + ':' + password);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return 'Basic ' + btoa(binary);
}

function closeSignin() {
	signinBackdrop.hidden = true;
	signinError.hidden = true;
}

adminButton.addEventListener('click', () => {
	signinBackdrop.hidden = false;
	signinForm.elements.user.focus();
});
document.querySelector('.signin-close').addEventListener('click', closeSignin);
signinBackdrop.addEventListener('click', event => {
	if (event.target === signinBackdrop) closeSignin();
});

signinForm.addEventListener('submit', async event => {
	event.preventDefault();
	signinError.hidden = true;
	const header = basicAuthValue(signinForm.elements.user.value, signinForm.elements.pass.value);
	try {
		const response = await fetch(path + '?upload=whoami', { headers: { 'Authorization': header } });
		if (!response.ok) throw new Error();
		adminHeader = header;
		closeSignin();
		signinForm.reset();
		adminButton.hidden = true;
		uploadButton.hidden = false;
	} catch {
		signinError.textContent = 'That admin sign-in did not work. Check the username and password.';
		signinError.hidden = false;
	}
});

/* ---------------------------------------------------------------- uploads --- */

// Admin uploads: the Worker seals the Drive session behind an opaque token,
// so credentials, tokens, and session URLs never appear in page responses.
// The engine (upload-engine.js) drives resumable chunks with live speed and
// ETA and exposes pause / resume / cancel; this layer renders the centered
// progress popup and refreshes the listing when the batch finishes.
const uploadButton = document.querySelector('.upload-files');
const uploadInput = document.querySelector('.upload-input');
const uploadBackdrop = document.querySelector('.upload-backdrop');
const uploadTitle = document.querySelector('#upload-title');
const uploadPercent = document.querySelector('.upload-percent');
const uploadFigures = document.querySelector('.upload-figures');
const uploadSub = document.querySelector('.upload-sub');
const uploadFill = document.querySelector('.upload-overview .bar-fill');
const uploadList = document.querySelector('.upload-list');
const uploadDock = document.querySelector('.upload-dock');
const pauseAllButton = document.querySelector('.upload-pause-all');
const resumeAllButton = document.querySelector('.upload-resume-all');
const cancelRestButton = document.querySelector('.upload-cancel-rest');
const retryFailedButton = document.querySelector('.upload-retry-failed');
const copyReportButton = document.querySelector('.upload-copy-report');

const MAX_ATTEMPTS = window.RinUploadEngine.MAX_ATTEMPTS;
const PAUSABLE = { pending: true, queued: true, starting: true, uploading: true, retrying: true, resuming: true };
const FINAL_STATES = { done: true, cancelled: true, error: true };

const upload = {
	handle: null,
	files: [],
	states: [],
	rows: [],
	batch: null,
	done: false,
	renderQueued: false
};

let uploadEngine = null;
function getUploadEngine() {
	if (!uploadEngine) uploadEngine = new window.RinUploadEngine.Engine({ transport: xhrTransport });
	return uploadEngine;
}

// XHR transport gives byte-granular progress events while a chunk streams,
// keeping the progress bar, speed, and ETA current without polling. The
// engine's AbortSignal stops the request in flight when a file is paused or
// cancelled.
function xhrTransport(url, init, onProgress) {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open(init.method || 'GET', url);
		request.responseType = 'json';
		for (const [name, value] of Object.entries(init.headers || {})) {
			try { request.setRequestHeader(name, value); } catch {}
		}
		const cleanSignal = () => {
			if (init.signal) init.signal.removeEventListener('abort', abort);
		};
		const finish = () => {
			cleanSignal();
			request.upload.onprogress = null;
			resolve({
				status: request.status,
				ok: request.status >= 200 && request.status < 400,
				json: async () => request.response
			});
		};
		const fail = () => {
			cleanSignal();
			reject(new TypeError('The chunk could not reach Rin Index.'));
		};
		const abort = () => {
			cleanSignal();
			request.abort();
			const error = new Error('The upload request was cancelled.');
			error.name = 'AbortError';
			reject(error);
		};
		if (onProgress) {
			request.upload.onprogress = event => {
				if (event.lengthComputable) onProgress(event.loaded);
			};
		}
		request.addEventListener('load', finish);
		request.addEventListener('error', fail);
		if (init.signal) {
			if (init.signal.aborted) {
				abort();
				return;
			}
			init.signal.addEventListener('abort', abort, { once: true });
		}
		request.send(init.body ?? null);
	});
}

function formatSpeed(bytesPerSecond) {
	if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
	return (bytesPerSecond / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function formatEta(seconds) {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
	const total = Math.round(seconds);
	if (total < 60) return total + 's left';
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return minutes + 'm ' + (total % 60) + 's left';
	return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm left';
}

function formatSplit(sendMs, waitMs) {
	const total = sendMs + waitMs;
	if (!total) return null;
	const sendShare = Math.round(sendMs / total * 100);
	return 'sending ' + sendShare + '% · waiting for Google Drive ' + (100 - sendShare) + '%';
}

function fileStateText(record) {
	const speed = formatSpeed(record.speed);
	switch (record.state) {
		case 'pending':
		case 'queued':
			return 'Waiting';
		case 'starting':
			return 'Starting…';
		case 'resuming':
			return 'Checking with Google Drive…';
		case 'uploading': {
			const parts = [Math.max(0, Math.min(100, record.percent || 0)).toFixed(0) + '%', formatSize(record.uploaded) + ' of ' + formatSize(record.total)];
			if (speed) parts.push(speed);
			const eta = formatEta(record.eta);
			if (eta) parts.push(eta);
			return parts.join(' · ');
		}
		case 'retrying':
			return 'Retrying (' + record.attempt + ' of ' + MAX_ATTEMPTS + ')…';
		case 'pausing':
			return 'Pausing…';
		case 'paused':
			return 'Paused · ' + Math.max(0, Math.min(100, record.percent || 0)).toFixed(0) + '%';
		case 'cancelling':
			return 'Cancelling…';
		case 'done': {
			const seconds = record.activeMs ? Math.round(record.activeMs / 1000) : 0;
			const rate = seconds ? formatSpeed(record.total / seconds) : null;
			return 'Done · ' + formatSize(record.total) + (rate ? ' · ' + rate : '');
		}
		case 'cancelled':
			return 'Cancelled';
		case 'error':
			return 'Failed';
		default:
			return '';
	}
}

function fileNote(record) {
	if (record.state === 'paused') {
		const at = record.committed ? ' at ' + formatSize(record.committed) + ' of ' + formatSize(record.total) : '';
		if (record.reason === 'stalled') {
			return (record.message || 'The connection dropped.') +
				(navigator.onLine === false ? ' · It will resume automatically when the connection returns.' : '');
		}
		return 'Paused' + at + ' · Google Drive kept the upload session. No estimate while paused.';
	}
	if (record.state === 'cancelled') {
		return record.closed === false
			? 'Google Drive could not confirm the session was closed. It expires on its own after a week.'
			: 'Google Drive closed the upload session. Files that finished uploading are kept.';
	}
	if (record.state === 'error') return record.message || 'The upload failed.';
	if (record.state === 'retrying') {
		return (record.message || 'The connection dropped.') + ' · Resumes from ' + formatSize(record.committed) + ' of ' + formatSize(record.total) + ' confirmed.';
	}
	if (record.state === 'resuming') {
		return 'Asking Google Drive how much it received before continuing.';
	}
	return '';
}

function modalRow(index) {
	if (upload.rows[index]) return upload.rows[index];
	const record = upload.states[index];
	const item = create('li', 'upload-row');
	const line = create('div', 'line');
	const nameEl = create('span', 'upload-name', record ? record.name : '');
	if (record) nameEl.title = record.name;
	const stateEl = create('span', 'upload-state', '');
	const controls = create('div', 'upload-controls');
	const pauseBtn = create('button', 'icon-btn');
	pauseBtn.type = 'button';
	pauseBtn.title = 'Pause';
	pauseBtn.setAttribute('aria-label', 'Pause ' + (record ? record.name : 'file'));
	pauseBtn.addEventListener('click', () => {
		if (!upload.handle) return;
		const current = upload.states[index];
		if (!current) return;
		if (current.state === 'paused') {
			if (upload.handle.resume(index)) {
				current.state = 'resuming';
				scheduleUploadRender();
			}
		} else if (upload.handle.pause(index)) {
			current.state = 'pausing';
			scheduleUploadRender();
		}
	});
	const cancelBtn = create('button', 'icon-btn');
	cancelBtn.type = 'button';
	cancelBtn.title = 'Cancel';
	cancelBtn.setAttribute('aria-label', 'Cancel ' + (record ? record.name : 'file'));
	cancelBtn.addEventListener('click', () => {
		if (!upload.handle) return;
		if (upload.handle.cancel(index)) {
			upload.states[index].state = 'cancelling';
			scheduleUploadRender();
		}
	});
	controls.append(pauseBtn, cancelBtn);
	line.append(nameEl, stateEl, controls);
	const bar = create('div', 'bar');
	const fill = create('div', 'bar-fill');
	bar.append(fill);
	const noteEl = create('p', 'note', '');
	noteEl.hidden = true;
	item.append(line, bar, noteEl);
	uploadList.append(item);
	upload.rows[index] = { item, nameEl, stateEl, noteEl, fill, pauseBtn, cancelBtn };
	return upload.rows[index];
}

function handleUploadEvent(event) {
	if (event.index !== undefined && upload.states[event.index]) {
		const record = upload.states[event.index];
		Object.assign(record, event);
		if (event.type === 'file-start') record.state = 'starting';
		if (event.type === 'file-progress') record.state = 'uploading';
		if (event.type === 'file-done') record.state = 'done';
		if (event.type === 'file-paused') record.state = 'paused';
		if (event.type === 'file-cancelled') record.state = 'cancelled';
		if (event.type === 'file-error') record.state = 'error';
		if (event.type === 'file-retry') record.state = 'retrying';
		if (event.type === 'file-resumed') record.state = 'resuming';
	}
	if (event.type === 'batch-start') {
		upload.batch = event;
		upload.done = false;
	} else if (event.type === 'batch-progress') {
		upload.batch = event;
	} else if (event.type === 'batch-done') {
		upload.done = true;
		upload.batch = Object.assign({}, upload.batch, event);
	}
	scheduleUploadRender();
}

function scheduleUploadRender() {
	if (upload.renderQueued) return;
	upload.renderQueued = true;
	requestAnimationFrame(() => {
		upload.renderQueued = false;
		renderUpload();
	});
}

function renderUpload() {
	let unfinished = 0;
	let paused = 0;
	let pausable = 0;
	let failed = 0;
	for (let index = 0; index < upload.states.length; index++) {
		const record = upload.states[index];
		if (!record) continue;
		const row = modalRow(index);
		row.item.className = 'upload-row'
			+ (record.state === 'done' ? ' is-done' : '')
			+ (record.state === 'paused' ? ' is-paused' : '')
			+ (record.state === 'error' ? ' is-error' : '');
		row.fill.className = 'bar-fill'
			+ (record.state === 'paused' ? ' paused' : '')
			+ (record.state === 'cancelled' ? ' cancelled' : '');
		const percent = Math.max(0, Math.min(100, record.percent || 0));
		row.fill.style.width = (record.state === 'done' ? 100 : percent).toFixed(1) + '%';
		row.stateEl.textContent = fileStateText(record);
		const note = fileNote(record);
		row.noteEl.hidden = !note;
		row.noteEl.className = 'note' + (record.state === 'error' ? ' error' : '');
		row.noteEl.textContent = note;
		const final = Boolean(FINAL_STATES[record.state]);
		const isPaused = record.state === 'paused';
		row.pauseBtn.hidden = final || record.state === 'cancelling' || record.state === 'pausing';
		row.pauseBtn.replaceChildren(icon(isPaused ? 'play' : 'pause'));
		row.pauseBtn.title = isPaused ? 'Resume' : 'Pause';
		row.pauseBtn.setAttribute('aria-label', (isPaused ? 'Resume ' : 'Pause ') + record.name);
		row.pauseBtn.disabled = isPaused && record.reason === 'stalled' && navigator.onLine === false;
		row.cancelBtn.hidden = final || record.state === 'cancelling';

		if (!final) unfinished++;
		if (isPaused) paused++;
		if (!final && !isPaused && record.state !== 'cancelling' && record.state !== 'pausing') pausable++;
		if (record.state === 'error') failed++;
	}

	const batch = upload.batch;
	if (batch) {
		const percent = Math.max(0, Math.min(100, batch.percent || 0));
		uploadFill.style.width = percent.toFixed(1) + '%';
		uploadPercent.textContent = percent.toFixed(0) + '%';
		const figures = [];
		if (batch.filesTotal > 1) figures.push((batch.filesDone || 0) + ' of ' + batch.filesTotal + ' files');
		figures.push(formatSize(batch.uploaded) + ' of ' + formatSize(batch.total));
		const speed = formatSpeed(batch.speed);
		if (speed) figures.push(speed);
		const eta = formatEta(batch.eta);
		if (eta) figures.push(eta);
		uploadFigures.textContent = figures.join(' · ');

		const sub = [];
		const split = formatSplit(batch.sendMs, batch.waitMs);
		if (split && !upload.done) sub.push(split);
		if (batch.paused) sub.push(batch.paused + (batch.paused === 1 ? ' file paused' : ' files paused'));
		if (batch.retries) sub.push(batch.retries + (batch.retries === 1 ? ' retry' : ' retries'));
		uploadSub.textContent = sub.join(' · ');

		uploadTitle.textContent = upload.done
			? (batch.failed ? 'Uploads finished (' + batch.succeeded + ' of ' + batch.filesTotal + ')' : 'Uploads finished')
			: (batch.filesTotal > 1 ? 'Uploading ' + batch.filesTotal + ' files' : 'Uploading ' + (upload.states[0] ? upload.states[0].name : 'files'));
	}

	pauseAllButton.disabled = !pausable;
	pauseAllButton.hidden = upload.done && !pausable;
	resumeAllButton.disabled = !paused;
	resumeAllButton.hidden = upload.done && !paused;
	cancelRestButton.disabled = !unfinished;
	cancelRestButton.hidden = upload.done && !unfinished;
	retryFailedButton.hidden = !(upload.done && failed);
	copyReportButton.hidden = !upload.done || !upload.batch;

	if (!uploadBackdrop.hidden) {
		uploadDock.hidden = true;
	} else if (!upload.done && batch) {
		uploadDock.hidden = false;
		const dockBar = create('div', 'bar');
		const dockFill = create('div', 'bar-fill');
		dockFill.style.width = percent0(batch);
		dockBar.append(dockFill);
		uploadDock.replaceChildren(
			icon('upload'),
			create('span', '', percent0(batch) + ' · ' + (formatSpeed(batch.speed) || 'paused')),
			dockBar
		);
	} else {
		uploadDock.hidden = true;
	}
}

function percent0(batch) {
	if (!batch) return 0;
	return Math.max(0, Math.min(100, batch.percent || 0)).toFixed(0) + '%';
}

function openUploadModal() {
	uploadBackdrop.hidden = false;
	uploadDock.hidden = true;
	scheduleUploadRender();
}

function closeUploadModal() {
	uploadBackdrop.hidden = true;
	renderUpload();
}

document.querySelector('.upload-close').addEventListener('click', closeUploadModal);
document.querySelector('.upload-minimize').addEventListener('click', closeUploadModal);
uploadDock.addEventListener('click', openUploadModal);
uploadBackdrop.addEventListener('click', event => {
	if (event.target === uploadBackdrop) closeUploadModal();
});

pauseAllButton.addEventListener('click', () => {
	if (!upload.handle) return;
	if (upload.handle.pause()) {
		for (const record of upload.states) if (record && PAUSABLE[record.state]) record.state = 'pausing';
		scheduleUploadRender();
	}
});
resumeAllButton.addEventListener('click', () => {
	if (!upload.handle) return;
	if (upload.handle.resume()) {
		for (const record of upload.states) if (record && record.state === 'paused') record.state = 'resuming';
		scheduleUploadRender();
	}
});
cancelRestButton.addEventListener('click', () => {
	if (!upload.handle) return;
	if (upload.handle.cancel()) {
		for (const record of upload.states) {
			if (record && !FINAL_STATES[record.state] && record.state !== 'cancelling') record.state = 'cancelling';
		}
		scheduleUploadRender();
	}
});
retryFailedButton.addEventListener('click', () => {
	const failedFiles = upload.states.filter(record => record && record.state === 'error').map(record => record.file);
	if (failedFiles.length) startUpload(failedFiles);
});
copyReportButton.addEventListener('click', async () => {
	const text = buildReport();
	showToast(await writeClipboard(text) ? 'Report copied to the clipboard' : 'Copy blocked');
});

function buildReport() {
	const report = upload.handle ? upload.handle.report() : null;
	if (!report) return 'No upload report available.';
	const lines = ['Rin Index upload report'];
	const finished = report.succeeded + report.cancelled + report.failed;
	const minutes = Math.floor(report.elapsedMs / 60000);
	const seconds = Math.round((report.elapsedMs % 60000) / 1000);
	lines.push(finished + ' of ' + report.files.length + ' files settled · ' + formatSize(report.bytes) + ' uploaded · ' +
		(minutes ? minutes + 'm ' : '') + seconds + 's elapsed');
	const split = formatSplit(report.sendMs, report.waitMs);
	if (split) lines.push('Time: ' + split + (report.retries ? ' · ' + report.retries + ' retries' : ''));
	for (const file of report.files) {
		const parts = ['  ' + file.name, formatSize(file.total)];
		if (file.state === 'done') {
			const seconds = file.activeMs ? Math.round(file.activeMs / 1000) : 0;
			parts.push('done' + (seconds ? ' in ' + seconds + 's' : '') +
				(seconds ? ' at ' + (formatSpeed(file.total / seconds) || '—') : ''));
		} else if (file.state === 'cancelled') {
			parts.push('cancelled at ' + formatSize(file.committed));
		} else {
			parts.push(file.state);
		}
		if (file.chunks.length) {
			parts.push('chunks ' + file.chunks.map(chunk => Math.round(chunk.size / (1024 * 1024)) + 'MiB×' + chunk.count).join(', '));
		}
		if (file.retries) parts.push(file.retries + ' retries');
		lines.push(parts.join(' · '));
	}
	return lines.join('\n');
}

// Leaving the page mid-upload would drop every in-flight chunk, so warn
// while anything is unfinished (paused files included).
window.addEventListener('beforeunload', event => {
	if (upload.handle && upload.handle.summary().unfinished > 0) {
		event.preventDefault();
		event.returnValue = '';
	}
});

// Files parked by a connection drop resume by themselves once the browser
// is back online; user-paused files stay paused until Resume is pressed.
window.addEventListener('online', () => {
	if (!upload.handle) return;
	for (let index = 0; index < upload.states.length; index++) {
		const record = upload.states[index];
		if (record && record.state === 'paused' && record.reason === 'stalled') {
			if (upload.handle.resume(index)) record.state = 'resuming';
		}
	}
	scheduleUploadRender();
});

function startUpload(files) {
	if (!files.length) return;
	openUploadModal();
	uploadButton.disabled = true;
	upload.files = files;
	upload.rows = [];
	uploadList.replaceChildren();
	upload.states = files.map(file => ({
		file, name: file.name, total: file.size, state: 'pending',
		uploaded: 0, committed: 0, percent: 0, speed: null, eta: null,
		reason: '', message: '', attempt: 0, closed: null
	}));
	upload.batch = null;
	upload.done = false;
	upload.handle = getUploadEngine().start(files, {
		path,
		getHeaders: authHeaders,
		concurrency: 2,
		onEvent: handleUploadEvent
	});
	upload.handle.done.then(state => {
		uploadButton.disabled = false;
		if (state.succeeded) refreshListing();
	}).catch(() => {
		uploadButton.disabled = false;
	});
	scheduleUploadRender();
}

function setupAdminUploads() {
	if (model.is_admin) {
		uploadButton.hidden = false;
	} else {
		adminButton.hidden = false;
	}
	uploadButton.addEventListener('click', () => uploadInput.click());
	uploadInput.addEventListener('change', () => {
		const files = [...uploadInput.files];
		uploadInput.value = '';
		if (files.length) startUpload(files);
	});
	document.addEventListener('keydown', event => {
		if (event.key !== 'Escape') return;
		if (!uploadBackdrop.hidden) closeUploadModal();
		else if (!signinBackdrop.hidden) closeSignin();
		else if (!previewBackdrop.hidden) leavePreview();
	});
}

/* -------------------------------------------------------------- start up --- */

if (isSearch || isFolder) {
	panel.querySelector('.panel-title').textContent = isSearch ? 'Matching files' : 'Files and folders';
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
