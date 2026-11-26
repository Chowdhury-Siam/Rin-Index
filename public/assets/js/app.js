const { order, name, model } = window.RIN_INDEX;
const root = '/' + order + ':/';
const path = location.pathname;
const isSearch = Boolean(model.is_search_page);
const isFolder = path.endsWith('/');
const segments = isSearch ? [] : path.slice(root.length).split('/').filter(Boolean);
const searchPath = '/' + order + ':search';
const driveType = ['My Drive', 'Shared Drive', 'Google Drive folder'][model.root_type] || 'Google Drive';

// The page's own requests name themselves so an admin gate can answer 401
// without the browser opening its login prompt over the page.
const CLIENT_MARKER = 'Rin Index';
const canAdmin = Boolean(model.can_upload);
const isAdmin = Boolean(model.is_admin);
// Rows the admin may act on: folders carry the full set, search results
// everything except selection (they were listed somewhere else).
const rowMenus = isAdmin && (isFolder || isSearch);
const selectable = isAdmin && isFolder && !isSearch;

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
	<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5.4" y="10.6" width="13.2" height="9" rx="1.6"/><path d="M8.4 10.6V8.4a3.6 3.6 0 0 1 7.2 0v2.2"/></symbol>
	<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4.6 3 19.4h18z"/><path d="M12 10.4v3.6M12 17.2v.2"/></symbol>
	<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.4v4.2h-4.2"/></symbol>
	<symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></symbol>
	<symbol id="i-edit" viewBox="0 0 24 24"><path d="M4.4 19.6h4L19 9l-4-4L4.4 15.6z"/><path d="m13.6 6.4 4 4"/></symbol>
	<symbol id="i-trash" viewBox="0 0 24 24"><path d="M4.4 7h15.2"/><path d="M9 7V5.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V7"/><path d="m6.4 7 .9 11.4c.1.9.8 1.6 1.7 1.6h6c.9 0 1.6-.7 1.7-1.6L17.6 7"/><path d="M10 11v5M14 11v5"/></symbol>
	<symbol id="i-move" viewBox="0 0 24 24"><path d="M3.8 6.4c0-1 .8-1.8 1.8-1.8h3.5c.5 0 1 .2 1.3.6l1 1.2h5.6c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H5.6c-1 0-1.8-.8-1.8-1.8z"/><path d="M9.5 14.6h5M12.4 12l2.6 2.6-2.6 2.6"/></symbol>
	<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
	<symbol id="i-new-folder" viewBox="0 0 24 24"><path d="M3.8 6.4c0-1 .8-1.8 1.8-1.8h3.5c.5 0 1 .2 1.3.6l1 1.2h7c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H5.6c-1 0-1.8-.8-1.8-1.8z"/><path d="M12 10.4v5M9.5 12.9h5"/></symbol>
	<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3.2 1.9"/></symbol>
	<symbol id="i-sort" viewBox="0 0 24 24"><path d="M8 6.5v11M8 6.5 5 9.5M8 6.5l3 3M16 17.5v-11M16 17.5l3-3M16 17.5l-3-3"/></symbol>
	<symbol id="i-home" viewBox="0 0 24 24"><path d="M4.6 11.2 12 4.8l7.4 6.4"/><path d="M6.4 10.4v8.2c0 .6.4 1 1 1h9.2c.6 0 1-.4 1-1v-8.2"/><path d="M10 19.6v-5h4v5"/></symbol>
	<symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7.4 18.4a4.2 4.2 0 0 1-.5-8.4 5.4 5.4 0 0 1 10.5 1.2 3.6 3.6 0 0 1-.6 7.2z"/><path d="M12 14.8v3.6M10.2 16.2 12 14.4l1.8 1.8"/></symbol>
	<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.6"/><path d="M5.2 19.6a6.8 6.8 0 0 1 13.6 0"/></symbol>
	<symbol id="i-signout" viewBox="0 0 24 24"><path d="M9.5 5.2H6.6c-.9 0-1.6.7-1.6 1.6v10.4c0 .9.7 1.6 1.6 1.6h2.9"/><path d="m14.5 8.4 3.6 3.6-3.6 3.6"/><path d="M18.1 12H9.9"/></symbol>
	<symbol id="i-back" viewBox="0 0 24 24"><path d="M14.6 6.4 9 12l5.6 5.6"/></symbol>
	<symbol id="i-subtitles" viewBox="0 0 24 24"><rect x="3.8" y="5" width="16.4" height="14" rx="1.8"/><path d="M7.4 15.2h3.4M13.4 15.2h3.2"/></symbol>
	<symbol id="i-volume" viewBox="0 0 24 24"><path d="M4.4 9.5v5h3l4.2 3.5V6L7.4 9.5z"/><path d="M14.6 9.6a3.4 3.4 0 0 1 0 4.8"/><path d="M17 7.4a6.6 6.6 0 0 1 0 9.2"/></symbol>
	<symbol id="i-mute" viewBox="0 0 24 24"><path d="M4.4 9.5v5h3l4.2 3.5V6L7.4 9.5z"/><path d="m15.4 9.6 4.4 4.8M19.8 9.6l-4.4 4.8"/></symbol>
	<symbol id="i-pip" viewBox="0 0 24 24"><rect x="3.8" y="4.5" width="16.4" height="15" rx="1.8"/><path d="M12.2 13.2h5.6v4.8h-5.6z"/></symbol>
	<symbol id="i-fullscreen" viewBox="0 0 24 24"><path d="M4.4 9.2V4.4h4.8M15.2 4.4h4.4v4.8M19.6 14.8v4.8h-4.8M8.8 19.6H4.4v-4.8"/></symbol>
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
		<nav class="rail" aria-label="Primary">
			<a class="rail-brand" href="__ROOT__" title="Rin Index"><img src="/assets/rin-mark.png" width="26" height="26" alt=""></a>
			<a class="rail-icon rail-home" href="__ROOT__" title="Drive home" aria-label="Drive home"><svg class="icon" aria-hidden="true"><use href="#i-home"></use></svg></a>
			<button class="icon-btn rail-icon recent-button" type="button" aria-label="Recently opened" title="Recently opened" hidden></button>
			<button class="icon-btn rail-icon rail-search" type="button" aria-label="Search drive" title="Search drive" hidden></button>
			<button class="icon-btn rail-icon rail-storage" type="button" aria-label="Drive storage" title="Drive storage" hidden></button>
			<span class="spacer"></span>
			<a class="rail-icon source-link" href="https://github.com/Chowdhury-Siam/Google-Index" title="Source on GitHub" aria-label="Source on GitHub">${'' /* icon appended in JS */}</a>
			<button class="icon-btn rail-avatar admin-lock" type="button" aria-label="Admin sign-in" hidden></button>
		</nav>
		<div class="main">
			<header class="topbar">
				<a class="brand brand-compact" href="__ROOT__"><img src="/assets/rin-mark.png" width="22" height="22" alt="">Rin Index</a>
				<h1 class="page-title" id="heading">Drive <em>files</em></h1>
				<div class="topbar-actions">
					<a class="button button-secondary save-folder-links" hidden>Save links (.txt)</a>
					<button class="button button-secondary download-files" type="button" hidden>Download files</button>
					<button class="button button-primary new-button" type="button" hidden>New</button>
				</div>
			</header>
			<main id="main" tabindex="-1">
				<section class="pagehead" aria-labelledby="heading">
					<nav class="crumbs" aria-label="Folder path"></nav>
					<p class="drive-label"></p>
					<form class="search" role="search" method="get" hidden>
						<label class="sr-only" for="query">Search drive</label>
						<span class="field"><svg class="icon" aria-hidden="true"><use href="#i-search"></use></svg>
							<input id="query" name="q" type="search" placeholder="Search drive" maxlength="200" required>
						</span>
						<button class="button button-primary" type="submit">Search</button>
					</form>
					<p class="search-hint" hidden>Filters: type:video · type:image · type:audio · type:doc · type:folder · size:&gt;100MB</p>
					<div class="search-chips" aria-label="Active search filters" hidden></div>
					<section class="storage" aria-label="Drive storage" hidden>
						<div class="storage-head">
							<h2 class="storage-title"><svg class="icon" aria-hidden="true"><use href="#i-cloud"></use></svg>Drive storage</h2>
							<span class="storage-percent">—</span>
						</div>
						<div class="bar"><div class="bar-fill"></div></div>
						<dl class="storage-figures"></dl>
						<p class="storage-note"></p>
						<button class="icon-btn storage-refresh" type="button" aria-label="Refresh storage figures"></button>
					</section>
				</section>
			<section class="folder-notes markdown" aria-label="Folder notes" hidden></section>
			<section class="panel">
				<div class="selection-bar" hidden>
					<strong class="selection-count"></strong>
					<button class="button button-ghost selection-rename" type="button"><span class="button-label">Rename</span></button>
					<button class="button button-secondary selection-move" type="button"><span class="button-label">Move to…</span></button>
					<button class="button button-danger selection-delete" type="button"><span class="button-label">Delete</span></button>
					<button class="button button-ghost selection-clear" type="button"><span class="button-label">Clear</span></button>
				</div>
				<div class="panel-head">
					<h2 class="panel-title"></h2>
					<p class="count"></p>
				</div>
				<div class="drop-zone" hidden>Drop files or folders to upload them here</div>
				<input class="upload-input" type="file" multiple hidden>
				<input class="folder-input" type="file" multiple hidden>
				<p class="load-status" role="status" hidden></p>
				<div class="list-controls" hidden>
					<div class="filter-chips" role="group" aria-label="Filter by kind"></div>
					<button class="button button-ghost sort-button" type="button">Sort</button>
				</div>
				<div class="list-head"></div>
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
	</div>

	<div class="modal-backdrop signin-backdrop" hidden>
		<div class="modal signin" role="dialog" aria-modal="true" aria-labelledby="signin-title">
			<div class="modal-head">
				<h2 id="signin-title">Admin sign-in</h2>
				<span class="spacer"></span>
				<button class="icon-btn signin-close" type="button" data-close aria-label="Close"></button>
			</div>
			<form class="modal-body signin-form dialog-form">
				<p class="signin-note">The administrator pair from this index's settings unlocks uploads and file management.</p>
				<p class="signin-error" hidden></p>
				<div class="field">
					<label for="admin-user">Username</label>
					<input id="admin-user" name="user" autocomplete="username" required>
				</div>
				<div class="field">
					<label for="admin-pass">Password</label>
					<input id="admin-pass" name="pass" type="password" autocomplete="current-password" required>
				</div>
				<p class="signin-busy" hidden>Signing in…</p>
				<button class="button button-primary" type="submit">Sign in</button>
			</form>
		</div>
	</div>

	<div class="modal-backdrop mkdir-backdrop" hidden>
		<div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="mkdir-title">
			<div class="modal-head">
				<h2 id="mkdir-title">New folder</h2>
				<span class="spacer"></span>
				<button class="icon-btn mkdir-close" type="button" data-close aria-label="Close"></button>
			</div>
			<form class="modal-body dialog-form mkdir-form">
				<div class="field">
					<label for="mkdir-name">Folder name</label>
					<input id="mkdir-name" name="name" maxlength="500" autocomplete="off" spellcheck="false" required>
				</div>
				<p class="prompt-error" hidden></p>
				<div class="modal-foot">
					<button class="button button-secondary" type="button" data-close>Cancel</button>
					<button class="button button-primary" type="submit">Create folder</button>
				</div>
			</form>
		</div>
	</div>

	<div class="modal-backdrop rename-backdrop" hidden>
		<div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="rename-title">
			<div class="modal-head">
				<h2 id="rename-title">Rename</h2>
				<span class="spacer"></span>
				<button class="icon-btn rename-close" type="button" data-close aria-label="Close"></button>
			</div>
			<form class="modal-body dialog-form rename-form">
				<div class="field">
					<label for="rename-name">New name</label>
					<input id="rename-name" name="name" maxlength="500" autocomplete="off" spellcheck="false" required>
				</div>
				<p class="prompt-hint">The name must be unique in this folder; two items with one name could not both be opened.</p>
				<p class="prompt-error" hidden></p>
				<div class="modal-foot">
					<button class="button button-secondary" type="button" data-close>Cancel</button>
					<button class="button button-primary" type="submit">Rename</button>
				</div>
			</form>
		</div>
	</div>

	<div class="modal-backdrop delete-backdrop" hidden>
		<div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="delete-title">
			<div class="modal-head">
				<h2 id="delete-title">Delete</h2>
				<span class="spacer"></span>
				<button class="icon-btn delete-close" type="button" data-close aria-label="Close"></button>
			</div>
			<form class="modal-body dialog-form delete-form">
				<p class="prompt-text"></p>
				<ul class="prompt-list"></ul>
				<p class="prompt-hint">Items go to Google Drive's trash, where they can be restored for 30 days. Trashed files keep counting against the storage quota.</p>
				<p class="prompt-error" hidden></p>
				<div class="modal-foot">
					<button class="button button-secondary" type="button" data-close>Cancel</button>
					<button class="button button-danger-fill" type="submit">Delete</button>
				</div>
			</form>
		</div>
	</div>

	<div class="modal-backdrop move-backdrop" hidden>
		<div class="modal move-modal" role="dialog" aria-modal="true" aria-labelledby="move-title">
			<div class="modal-head">
				<h2 id="move-title">Move</h2>
				<span class="spacer"></span>
				<button class="icon-btn move-close" type="button" data-close aria-label="Close"></button>
			</div>
			<div class="move-bar">
				<nav class="move-crumbs" aria-label="Destination folder"></nav>
			</div>
			<form class="move-create">
				<input class="move-new" placeholder="New folder here" maxlength="500" autocomplete="off" spellcheck="false">
				<button class="icon-btn move-create-btn" type="submit" aria-label="Create this folder"></button>
			</form>
			<ul class="move-list" aria-label="Folders"></ul>
			<p class="move-status" role="status"></p>
			<div class="modal-foot">
				<button class="button button-secondary" type="button" data-close>Cancel</button>
				<button class="button button-primary move-here" type="button">Move here</button>
			</div>
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
		<div class="modal upload-panel" role="dialog" aria-modal="true" aria-labelledby="upload-title">
			<div class="upload-head">
				<h2 id="upload-title">Uploads</h2>
				<button class="icon-btn upload-minimize" type="button" data-close aria-label="Fold uploads away"></button>
				<button class="icon-btn upload-close" type="button" aria-label="Clear finished uploads"></button>
			</div>
			<div class="upload-body"></div>
		</div>
	</div>

	<button class="upload-dock" type="button" hidden></button>

	<div class="modal-backdrop recent-backdrop" hidden>
		<div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="recent-title">
			<div class="modal-head">
				<h2 id="recent-title">Recently opened</h2>
				<span class="spacer"></span>
				<button class="icon-btn recent-close" type="button" data-close aria-label="Close"></button>
			</div>
			<div class="modal-body">
				<ul class="recent-list"></ul>
				<p class="recent-empty" hidden>Files you open or download appear here, on this device only. Nothing is sent anywhere else.</p>
			</div>
			<div class="modal-foot">
				<button class="button button-ghost recent-clear" type="button">Clear history</button>
				<button class="button button-secondary" type="button" data-close>Close</button>
			</div>
		</div>
	</div>

	<div class="modal-backdrop shortcuts-backdrop" hidden>
		<div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
			<div class="modal-head">
				<h2 id="shortcuts-title">Keyboard shortcuts</h2>
				<span class="spacer"></span>
				<button class="icon-btn shortcuts-close" type="button" data-close aria-label="Close"></button>
			</div>
			<div class="modal-body">
				<div class="shortcut"><span class="shortcut-keys"><kbd>/</kbd></span><span>Focus the search field</span></div>
				<div class="shortcut"><span class="shortcut-keys"><kbd>↑</kbd><kbd>↓</kbd></span><span>Move through the file list</span></div>
				<div class="shortcut"><span class="shortcut-keys"><kbd>Enter</kbd></span><span>Open the highlighted item</span></div>
				<div class="shortcut"><span class="shortcut-keys"><kbd>Space</kbd></span><span>Select or deselect the highlighted item</span></div>
				<div class="shortcut"><span class="shortcut-keys"><kbd>Delete</kbd></span><span>Move the highlighted item to the trash</span></div>
				<div class="shortcut"><span class="shortcut-keys"><kbd>N</kbd></span><span>Open the New menu</span></div>
				<div class="shortcut"><span class="shortcut-keys"><kbd>Esc</kbd></span><span>Close a dialog or menu</span></div>
				<div class="shortcut"><span class="shortcut-keys"><kbd>?</kbd></span><span>Show this list again</span></div>
			</div>
			<div class="modal-foot">
				<button class="button button-secondary" type="button" data-close>Close</button>
			</div>
		</div>
	</div>
	<div class="toast" role="status" aria-live="polite"></div>
`;

for (const link of document.querySelectorAll('a[href="__ROOT__"]')) link.href = root;
document.querySelector('.source-link').append(icon('external'));
document.querySelector('.signin-close').append(icon('x'));
document.querySelector('.preview-copy').append(icon('link'));
document.querySelector('.preview-download').append(icon('download'));
document.querySelector('.preview-close').append(icon('x'));
document.querySelector('.upload-minimize').append(icon('collapse'));
document.querySelector('.upload-close').append(icon('x'));
document.querySelector('.storage-refresh').append(icon('refresh'));
document.querySelector('.mkdir-close').append(icon('x'));
document.querySelector('.rename-close').append(icon('x'));
document.querySelector('.delete-close').append(icon('x'));
document.querySelector('.move-close').append(icon('x'));
document.querySelector('.recent-close').append(icon('x'));
document.querySelector('.shortcuts-close').append(icon('x'));
document.querySelector('.recent-button').append(icon('clock'));
const railStorage = document.querySelector('.rail-storage');
document.querySelector('.rail-search').append(icon('search'));
railStorage.append(icon('cloud'));
document.querySelector('.sort-button').prepend(icon('sort'));
document.querySelector('.move-create-btn').append(icon('plus'));
document.querySelector('.download-files').prepend(icon('download'));
document.querySelector('.save-folder-links').prepend(icon('download'));
document.querySelector('.new-button').prepend(icon('plus'));
document.querySelector('.selection-rename').prepend(icon('edit'));
document.querySelector('.selection-move').prepend(icon('move'));
document.querySelector('.selection-delete').prepend(icon('trash'));
document.querySelector('.selection-clear').prepend(icon('x'));

function create(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function nameFromPath(segment) {
	try { return decodeURIComponent(segment); } catch { return segment; }
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
const searchChips = document.querySelector('.search-chips');
const searchHint = document.querySelector('.search-hint');
if (model.root_type < 2) {
	searchForm.hidden = false;
	searchForm.action = searchPath;
	searchForm.elements.q.value = isSearch ? model.q : '';
	searchHint.hidden = false;
}

// The rail's search icon lands on the field wherever the page is.
const railSearch = document.querySelector('.rail-search');
railSearch.hidden = searchForm.hidden;
railSearch.addEventListener('click', () => {
	if (searchForm.hidden) return;
	searchForm.scrollIntoView({ block: 'center', behavior: 'smooth' });
	searchForm.elements.q.focus();
});

/* ---------------------------------------------------------- search chips --- */

// The same tokens the Worker parses (type: and size:), read here only to
// show what is active; removing a chip re-runs the search without it.
const SEARCH_FILTER_RE = /^type:(video|image|audio|doc|pdf|folder)$/i;
const SEARCH_SIZE_RE = /^size:([<>])([\d.]+)(b|kb|mb|gb|tb)?$/i;

function parseSearchTokens(raw) {
	const filters = [];
	const words = [];
	for (const token of String(raw || '').split(/\s+/).filter(Boolean)) {
		if (SEARCH_FILTER_RE.test(token) || SEARCH_SIZE_RE.test(token)) filters.push(token.toLowerCase());
		else words.push(token);
	}
	return { filters, words };
}

function searchChipLabel(token) {
	const type = /^type:([a-z]+)$/i.exec(token);
	if (type) return type[1].toLowerCase();
	const size = SEARCH_SIZE_RE.exec(token);
	if (size) return (size[1] === '>' ? 'over ' : 'under ') + size[2] + (size[3] || 'mb').toUpperCase();
	return token;
}

function renderSearchChips(raw) {
	const { filters } = parseSearchTokens(raw);
	searchChips.replaceChildren();
	for (const token of filters) {
		const chip = create('button', 'search-chip');
		chip.type = 'button';
		chip.append(create('span', '', searchChipLabel(token)), icon('x'));
		chip.setAttribute('aria-label', 'Remove the filter ' + searchChipLabel(token));
		chip.title = 'Remove this filter and search again';
		chip.addEventListener('click', () => {
			const kept = String(searchForm.elements.q.value || '').split(/\s+/)
				.filter(part => part && part.toLowerCase() !== token).join(' ');
			searchForm.elements.q.value = kept;
			searchForm.submit();
		});
		searchChips.append(chip);
	}
	searchChips.hidden = !filters.length;
}
if (isSearch) renderSearchChips(model.q);

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

function downloadIconLink(filePath, file) {
	const link = create('a', 'icon-btn');
	link.href = filePath;
	link.download = file.name;
	link.title = 'Download ' + file.name;
	link.setAttribute('aria-label', 'Download ' + file.name);
	link.append(icon('download'));
	// A download is one of the two things that make a file "recent".
	link.addEventListener('click', () => recordRecent(file, filePath));
	return link;
}

// Row thumbnails load only as they approach the viewport, so a page full of
// images never fires a burst of requests at once.
const thumbObserver = 'IntersectionObserver' in window
	? new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const img = entry.target;
			thumbObserver.unobserve(img);
			if (img.dataset.src) {
				img.src = img.dataset.src;
				delete img.dataset.src;
			}
		}
	}, { rootMargin: '300px' })
	: null;

/* ------------------------------------------------------------- data load --- */

async function post(endpoint, fields = {}) {
	let response;
	try {
		response = await fetch(endpoint, {
			method: 'POST',
			headers: { 'X-Requested-With': CLIENT_MARKER },
			body: new URLSearchParams(fields)
		});
	} catch {
		// A refused or dropped connection reaches fetch() callers as a bare
		// TypeError whose message names no site; say what happened instead.
		throw new Error('Rin Index could not be reached. Check the connection and try again.');
	}
	if (!response.ok) throw new Error('Request failed. Try again in a moment.');
	return response;
}

// A JSON request to a management, storage or sign-in route. A 401 opens the
// sign-in dialog instead of surfacing as an error, and every other refusal
// arrives as an Error carrying the message the Worker wrote for it.
async function apiJson(url, body, method = 'POST') {
	const response = await fetch(url, {
		method,
		headers: {
			'Content-Type': 'application/json',
			'X-Requested-With': CLIENT_MARKER
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (response.status === 401) {
		promptSignin('Your admin session ended. Sign in again to continue.');
		const error = new Error('Admin sign-in required.');
		error.signin = true;
		throw error;
	}
	let data = null;
	try { data = await response.json(); } catch {}
	if (!response.ok) {
		const error = new Error(data?.error || 'The request did not go through. Try again in a moment.');
		if (data?.code) error.code = data.code;
		if (data?.retry === true) error.retry = true;
		throw error;
	}
	return data;
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
		location.assign(filePath + viewActionFor(kind));
	} catch (error) {
		showNotice(error.message);
		button.disabled = false;
	}
}

/* ------------------------------------------------------------- file rows --- */

const panel = document.querySelector('.panel');
const panelHead = document.querySelector('.panel-head');
const selectionBar = document.querySelector('.selection-bar');
const listHead = document.querySelector('.list-head');
const fileList = document.querySelector('.file-list');
const selectAllBox = create('input', 'checkbox');
const selected = new Map();

function row(file) {
	const kind = fileKind(file);
	const folder = kind.type === 'folder';
	const filePath = path + encodeURIComponent(file.name);
	const entry = create('li', 'row');
	entry._item = file;
	entry._kind = kind.type;

	if (selectable) {
		const box = create('input', 'checkbox');
		box.type = 'checkbox';
		box.setAttribute('aria-label', 'Select ' + file.name);
		box.addEventListener('change', () => setSelected(entry, box.checked));
		const wrap = create('label', 'row-select');
		wrap.append(box);
		entry.append(wrap);
	}

	const main = create(isSearch ? 'button' : 'a', 'row-main' + (folder ? ' is-folder' : ''));
	if (isSearch) {
		main.type = 'button';
		main.addEventListener('click', () => openResult(main, file, kind));
	} else {
		main.href = filePath + (folder ? '/' : viewActionFor(kind));
	}
	const name = create('span', 'row-name', file.name);
	name.title = file.name;
	// An image with a Drive render shows it in place of the kind icon; the
	// proxy URL keeps the request on this origin under the same access rules.
	let lead = kindIcon(kind.type);
	if (kind.type === 'image' && file.thumbnailLink) {
		const thumb = create('img', 'row-thumb');
		thumb.alt = '';
		thumb.decoding = 'async';
		thumb.width = 26;
		thumb.height = 26;
		thumb.dataset.src = filePath + '?thumb=1';
		thumb.addEventListener('error', () => {
			// Drive's render is unavailable; the kind icon still says what it is.
			thumb.replaceWith(kindIcon(kind.type));
		}, { once: true });
		if (thumbObserver) thumbObserver.observe(thumb);
		else thumb.src = thumb.dataset.src;
		lead = thumb;
	}
	main.append(lead, name);

	const side = create('div', 'row-side');
	side.append(
		create('span', 'row-date', modified(file)),
		create('span', 'row-size', formatSize(file.size))
	);
	const actions = create('div', 'row-actions');
	if (!isSearch && !folder) {
		actions.append(
			copyUrlButton(filePath, file.name),
			downloadIconLink(filePath, file)
		);
	}
	if (rowMenus) {
		const menuButton = create('button', 'icon-btn');
		menuButton.type = 'button';
		menuButton.title = 'Actions';
		menuButton.setAttribute('aria-label', 'Actions for ' + file.name);
		menuButton.append(icon('more'));
		menuButton.addEventListener('click', () => openRowMenu(menuButton, file, entry));
		actions.append(menuButton);
	}
	side.append(actions);
	entry.append(main, side);
	return entry;
}

function setSelected(entry, on) {
	const file = entry._item;
	if (on) selected.set(file.id, file);
	else selected.delete(file.id);
	entry.classList.toggle('is-selected', on);
	entry.querySelector('.checkbox').checked = on;
	updateSelection();
}

function updateSelection() {
	const size = selected.size;
	selectionBar.hidden = !size;
	panelHead.hidden = Boolean(size) && isFolder && !isSearch;
	panel.classList.toggle('has-selection', Boolean(size));
	selectionBar.querySelector('.selection-count').textContent = size + (size === 1 ? ' item selected' : ' items selected');
	selectionBar.querySelector('.selection-rename').disabled = size !== 1;
	selectionBar.querySelector('.selection-move').disabled = !size;
	selectionBar.querySelector('.selection-delete').disabled = !size;
	const boxes = fileList.querySelectorAll('.checkbox');
	const checked = fileList.querySelectorAll('.row.is-selected').length;
	selectAllBox.checked = boxes.length > 0 && checked === boxes.length;
	selectAllBox.indeterminate = checked > 0 && checked < boxes.length;
}

function clearSelection() {
	for (const entry of fileList.querySelectorAll('.row.is-selected')) {
		setSelected(entry, false);
	}
}

selectAllBox.type = 'checkbox';
selectAllBox.setAttribute('aria-label', 'Select every item in this folder');
selectAllBox.addEventListener('change', () => {
	const on = selectAllBox.checked;
	for (const entry of fileList.querySelectorAll('.row')) setSelected(entry, on);
});
if (selectable) {
	listHead.classList.add('is-managed');
	fileList.classList.add('is-managed');
}

/* --------------------------------------------------------- sort & filter --- */

// One token per ordering; the wire format is the key plus a direction, and
// the Worker maps that onto Drive's orderBy with the same defaults.
const SORTS = {
	name: { key: 'name', dir: 1, label: 'Name A→Z' },
	name_desc: { key: 'name', dir: -1, label: 'Name Z→A' },
	modifiedTime: { key: 'modifiedTime', dir: -1, label: 'Newest first' },
	modifiedTime_asc: { key: 'modifiedTime', dir: 1, label: 'Oldest first' },
	size: { key: 'size', dir: -1, label: 'Largest first' },
	size_asc: { key: 'size', dir: 1, label: 'Smallest first' }
};
const FILTERS = {
	all: 'All',
	folder: 'Folders',
	image: 'Images',
	video: 'Video',
	audio: 'Audio',
	doc: 'Docs'
};
// "Docs" gathers the reading kinds; the other filters are kinds outright.
const DOC_KINDS = ['text', 'pdf', 'code'];

const listControls = document.querySelector('.list-controls');
const filterChips = document.querySelector('.filter-chips');
const sortButton = document.querySelector('.sort-button');
let currentSort = 'name';
let currentFilter = 'all';

function buildListHead() {
	const cells = [];
	if (selectable) {
		const selectCell = create('span', 'row-select');
		selectCell.append(selectAllBox);
		cells.push(selectCell);
	}
	const nameButton = create('button', 'head-sort');
	nameButton.type = 'button';
	nameButton.dataset.key = 'name';
	nameButton.textContent = 'Name';
	nameButton.title = 'Sort by name';
	nameButton.addEventListener('click', () => setSort(nextSortToken('name')));
	cells.push(nameButton);
	// The side labels sit in a block that mirrors a row's own side, so the
	// columns line up over their values.
	const sideWrap = create('div', 'list-head-side');
	for (const spec of [
		{ key: 'modifiedTime', label: 'Last modified' },
		{ key: 'size', label: 'Size' }
	]) {
		const button = create('button', 'head-sort');
		button.type = 'button';
		button.dataset.key = spec.key;
		button.textContent = spec.label;
		button.title = 'Sort by ' + spec.label.toLowerCase();
		button.addEventListener('click', () => setSort(nextSortToken(spec.key)));
		sideWrap.append(button);
	}
	cells.push(sideWrap);
	listHead.replaceChildren(...cells);
}

function nextSortToken(key) {
	const current = SORTS[currentSort];
	if (current.key !== key) {
		// Each column's natural direction: names rise, dates and sizes fall.
		return key === 'name' ? 'name' : key;
	}
	return current.dir === 1 ? key + '_asc' : (key === 'name' ? 'name' : key);
}

function updateSortIndicators() {
	const spec = SORTS[currentSort];
	for (const button of listHead.querySelectorAll('.head-sort')) {
		const active = button.dataset.key === spec.key;
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-sort', active ? (spec.dir === 1 ? 'ascending' : 'descending') : 'none');
	}
	sortButton.textContent = '';
	sortButton.append(icon('sort'), create('span', '', spec.label));
}

function setSort(token) {
	if (!SORTS[token] || token === currentSort) return;
	currentSort = token;
	updateSortIndicators();
	// What is loaded re-sorts at once for the feel of it; the reload that
	// follows is the authoritative one, so pagination stays in order.
	applyClientSort();
	refreshListing();
}

function applyClientSort() {
	const spec = SORTS[currentSort];
	const entries = [...fileList.children];
	entries.sort((a, b) => {
		const folderFirst = Number(a._kind === 'folder') - Number(b._kind === 'folder');
		if (folderFirst) return -folderFirst;
		let result = 0;
		if (spec.key === 'name') {
			result = a._item.name.localeCompare(b._item.name, undefined, { numeric: true, sensitivity: 'base' });
		} else if (spec.key === 'size') {
			result = (Number(a._item.size) || 0) - (Number(b._item.size) || 0);
		} else {
			result = new Date(a._item.modifiedTime || 0) - new Date(b._item.modifiedTime || 0);
		}
		return result * spec.dir;
	});
	fileList.append(...entries);
	clearKeyRow();
}

function applyFilter() {
	for (const entry of fileList.children) {
		const keep = currentFilter === 'all'
			|| entry._kind === currentFilter
			|| (currentFilter === 'doc' && DOC_KINDS.includes(entry._kind));
		entry.hidden = !keep;
	}
	updateCount();
	clearKeyRow();
}

function setFilter(token) {
	if (currentFilter === token) return;
	currentFilter = token;
	for (const chip of filterChips.children) {
		const active = chip.dataset.filter === token;
		chip.classList.toggle('is-active', active);
		chip.setAttribute('aria-pressed', String(active));
	}
	applyFilter();
}

function buildFilterChips() {
	for (const [token, label] of Object.entries(FILTERS)) {
		const chip = create('button', 'filter-chip');
		chip.type = 'button';
		chip.textContent = label;
		chip.dataset.filter = token;
		chip.setAttribute('aria-pressed', String(token === 'all'));
		if (token === 'all') chip.classList.add('is-active');
		chip.addEventListener('click', () => setFilter(token));
		filterChips.append(chip);
	}
}

function updateCount() {
	const total = fileList.children.length;
	const visible = [...fileList.children].filter(entry => !entry.hidden).length;
	count.textContent = numbers.format(visible) + (visible === 1 ? ' item' : ' items')
		+ (visible !== total ? ' of ' + numbers.format(total) : '');
	showNotice(visible ? '' : total
		? 'No items match this filter.'
		: (isSearch ? 'No files matched your search.' : 'This folder is empty.'));
}

buildListHead();
buildFilterChips();
updateSortIndicators();
if (isFolder && !isSearch) {
	listControls.hidden = false;
	sortButton.addEventListener('click', () => {
		showMenu(sortButton, Object.entries(SORTS).map(([token, spec]) => ({
			icon: token === currentSort ? 'check' : null,
			label: spec.label,
			onPick: () => setSort(token)
		})));
	});
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

/* --------------------------------------------------------- listing & load --- */

const panelActions = document.querySelector('.panel-actions');
const loadButton = document.querySelector('.load-more');
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
		if (isFolder && !isSearch) {
			// The listing asks Drive for the page in the chosen order, so
			// every page that loads later lines up with the first.
			fields.sort = SORTS[currentSort].key;
			fields.dir = SORTS[currentSort].dir === 1 ? 'asc' : 'desc';
		}
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
		nextPageToken = data.nextPageToken || '';
		pageIndex += 1;
		panelActions.hidden = !nextPageToken;
		loadButton.textContent = 'Load more';
		applyFilter();
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
	selected.clear();
	updateSelection();
	clearKeyRow();
	for (const selector of ['.folder-notes', '.folder-readme']) {
		const section = document.querySelector(selector);
		section.replaceChildren();
		section.hidden = true;
	}
	pageIndex = 0;
	nextPageToken = '';
	loadPage();
}

/* --------------------------------------------------------- menus & layers --- */

// Overlays stack: Escape closes the top one, whether that is a menu, a
// dialog, the uploads dialog or the preview. A dialog that is waiting on an
// answer to a request that changes files refuses dismissal, so an important
// operation cannot be dismissed by accident while it runs.
const layers = [];
function pushLayer(close) { layers.push(close); }
function removeLayer(close) {
	const index = layers.indexOf(close);
	if (index >= 0) layers.splice(index, 1);
}
function closeLayer(close) {
	removeLayer(close);
	close();
}
document.addEventListener('keydown', event => {
	if (event.key !== 'Escape') return;
	const top = layers.at(-1);
	if (top) {
		event.preventDefault();
		if (top.busy) return;
		closeLayer(top);
	}
});

// One menu element serves every list: anchored under its button on wide
// screens, a bottom sheet on narrow ones. The backdrop only closes it.
const menuBackdrop = create('button', 'menu-backdrop');
menuBackdrop.type = 'button';
menuBackdrop.setAttribute('aria-label', 'Close menu');
menuBackdrop.hidden = true;
let menuCloser = null;

function closeMenu() {
	if (!menuCloser) return;
	menuBackdrop.hidden = true;
	menuBackdrop.classList.remove('is-sheet');
	menuBackdrop.remove();
	const popover = document.querySelector('.popover');
	if (popover) popover.remove();
	const close = menuCloser;
	menuCloser = null;
	closeLayer(close);
}

function showMenu(anchor, items) {
	closeMenu();
	const sheet = matchMedia('(max-width: 720px)').matches;
	const popover = create('div', 'popover ' + (sheet ? 'is-sheet' : 'is-menu'));
	popover.setAttribute('role', 'menu');
	for (const item of items) {
		if (item.sep) { popover.append(create('div', 'popover-sep')); continue; }
		if (item.heading) { popover.append(create('div', 'popover-label', item.heading)); continue; }
		const button = create('button', 'popover-item' + (item.danger ? ' is-danger' : ''));
		button.type = 'button';
		button.setAttribute('role', 'menuitem');
		if (item.icon) button.append(icon(item.icon));
		button.append(create('span', '', item.label));
		button.disabled = Boolean(item.disabled);
		if (item.disabled && item.reason) button.title = item.reason;
		button.addEventListener('click', () => {
			closeMenu();
			if (item.onPick) item.onPick();
		});
		popover.append(button);
	}
	menuBackdrop.classList.toggle('is-sheet', sheet);
	menuBackdrop.hidden = false;
	document.body.append(menuBackdrop, popover);
	menuBackdrop.addEventListener('click', closeMenu, { once: true });

	if (!sheet) {
		const rect = anchor.getBoundingClientRect();
		const width = popover.offsetWidth;
		const height = popover.offsetHeight;
		let left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
		let top = rect.bottom + 6;
		if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
		popover.style.left = left + 'px';
		popover.style.top = top + 'px';
	}
	popover.addEventListener('keydown', event => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const buttons = [...popover.querySelectorAll('.popover-item:not(:disabled)')];
		if (!buttons.length) return;
		const index = buttons.indexOf(document.activeElement);
		const next = event.key === 'ArrowDown'
			? buttons[(index + 1 + buttons.length) % buttons.length]
			: buttons[(index - 1 + buttons.length) % buttons.length];
		next.focus();
	});
	const close = () => {
		menuBackdrop.hidden = true;
		menuBackdrop.remove();
		popover.remove();
	};
	menuCloser = close;
	pushLayer(close);
	const first = popover.querySelector('.popover-item:not(:disabled)');
	if (first) first.focus();
	// A menu anchored to a row goes stale the moment the page moves.
	window.addEventListener('scroll', closeMenu, { once: true, capture: true });
	window.addEventListener('resize', closeMenu, { once: true });
}

// Every dialog shares one behaviour: it opens centered over a dimmed page,
// traps keyboard focus inside itself, puts focus on its first control, and
// hands focus back to the control that opened it. The head close button and
// every [data-close] button dismiss it, and so does a click on the backdrop
// while nothing is in flight: a dialog whose request is running keeps itself
// open (setBusy) so a stray click cannot dismiss an important operation.
function focusablesIn(modal) {
	return [...modal.querySelectorAll('button, [href], input, select, textarea')]
		.filter(element => !element.disabled && element.offsetParent !== null);
}

function bindDialog(backdrop, { onOpen, onClose } = {}) {
	const modal = backdrop.querySelector('.modal');
	let closer = null;
	let busy = false;
	let restoreFocus = null;
	const trap = event => {
		if (event.key !== 'Tab') return;
		const items = focusablesIn(modal);
		if (!items.length) return;
		const first = items[0];
		const last = items[items.length - 1];
		const inside = items.includes(document.activeElement);
		if (!inside) {
			event.preventDefault();
			first.focus();
		} else if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	const shut = () => { if (closer) closeLayer(closer); };
	// The busy flag travels on the layer closer itself, because that is what
	// the Escape handler and the stack look at; a dialog whose request is in
	// flight keeps every dismissal path off except a close by code.
	const setBusy = value => {
		busy = Boolean(value);
		if (closer) closer.busy = busy;
	};
	backdrop.addEventListener('click', event => {
		if (event.target === backdrop && !busy) shut();
	});
	for (const button of backdrop.querySelectorAll('[data-close]')) {
		button.addEventListener('click', () => { if (!busy) shut(); });
	}
	// The trap stays attached for the dialog's whole life: keydown events only
	// reach it from controls inside the backdrop, and a hidden dialog holds no
	// focus, so a closed one never intercepts the page's Tab key.
	backdrop.addEventListener('keydown', trap);
	return {
		open() {
			backdrop.hidden = false;
			restoreFocus = document.activeElement;
			closer = () => {
				backdrop.hidden = true;
				busy = false;
				if (onClose) onClose();
				if (restoreFocus && document.body.contains(restoreFocus)) restoreFocus.focus();
				restoreFocus = null;
			};
			busy = false;
			closer.busy = false;
			pushLayer(closer);
			if (onOpen) onOpen();
			// The opener usually focuses the field itself; otherwise a field
			// takes focus, or Cancel for confirmations — the safe choice — so
			// the dialog is operable from the keyboard right away.
			if (!modal.contains(document.activeElement)) {
				const target = modal.querySelector('input:not([type="hidden"])')
					|| modal.querySelector('button[data-close]')
					|| focusablesIn(modal)[0];
				if (target) target.focus();
			}
		},
		close: shut,
		setBusy,
		isOpen: () => !backdrop.hidden
	};
}

function showFormError(slot, message) {
	slot.textContent = message;
	slot.hidden = false;
}

// The same name rules the Worker enforces, checked before a request is made.
function cleanNameInput(value) {
	const name = String(value || '').trim();
	if (!name || name.length > 500 || /[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..') return '';
	return name;
}

/* ------------------------------------------------------- manage requests --- */

// Up to 12 ids per request, matching the Worker's batch limit; the answers
// are merged so a big selection behaves like one action.
async function runBatched(folderUrl, action, ids, to) {
	const merged = { changed: 0, failed: 0, results: [] };
	for (let offset = 0; offset < ids.length; offset += 12) {
		const idsPart = ids.slice(offset, offset + 12);
		const body = action === 'move' ? { ids: idsPart, to } : { ids: idsPart };
		const part = await apiJson(folderUrl + '?manage=' + action, body);
		merged.changed += part.changed || 0;
		merged.failed += part.failed || 0;
		merged.results.push(...(part.results || []));
	}
	return merged;
}

function reportResults(verb, merged) {
	if (merged.failed) {
		const bad = merged.results.filter(result => !result.ok);
		const shown = bad.slice(0, 3).map(result => result.name + (result.error ? ' — ' + result.error : '')).join('; ');
		showToast(merged.changed + ' ' + verb + '. ' + merged.failed + ' could not be: ' + shown + (bad.length > 3 ? '; …' : ''));
	} else if (merged.changed) {
		showToast(merged.changed + (merged.changed === 1 ? ' item ' : ' items ') + verb + '.');
	} else {
		showToast('Nothing changed — the items were already there.');
	}
}

// Search results were listed somewhere else, so the folder an item sits in is
// resolved through its Drive ID before any action runs.
async function rowFolderUrl(file) {
	if (!isSearch) return path;
	const result = await post('/' + order + ':id2path', { id: file.id });
	const target = await result.text();
	if (!target.startsWith('/')) throw new Error('This item is outside the indexed folder.');
	return root + target.slice(1, target.lastIndexOf('/') + 1);
}

async function prepareRowAction(file, run) {
	try {
		const folderUrl = await rowFolderUrl(file);
		await run(folderUrl);
	} catch (error) {
		showNotice(error.message);
	}
}

/* ------------------------------------------------------------ new folder --- */

const mkdirDialog = bindDialog(document.querySelector('.mkdir-backdrop'), {});
const mkdirForm = document.querySelector('.mkdir-form');
const mkdirError = mkdirForm.querySelector('.prompt-error');

function openMkdir() {
	mkdirForm.elements.name.value = '';
	mkdirError.hidden = true;
	mkdirDialog.open();
	mkdirForm.elements.name.focus();
}

mkdirForm.addEventListener('submit', async event => {
	event.preventDefault();
	mkdirError.hidden = true;
	const name = cleanNameInput(mkdirForm.elements.name.value);
	if (!name) return showFormError(mkdirError, 'Use a name without “/” or control characters.');
	const submit = mkdirForm.querySelector('[type="submit"]');
	submit.disabled = true;
	mkdirDialog.setBusy(true);
	try {
		const data = await apiJson(path + '?manage=mkdir', { name });
		mkdirDialog.close();
		refreshListing();
		loadStorage(true);
		showToast(data.existed ? 'A folder named “' + name + '” was already here.' : 'Folder “' + name + '” created.');
	} catch (error) {
		if (!error.signin) showFormError(mkdirError, error.message);
	} finally {
		submit.disabled = false;
		mkdirDialog.setBusy(false);
	}
});

/* ---------------------------------------------------------------- rename --- */

const renameDialog = bindDialog(document.querySelector('.rename-backdrop'), {});
const renameForm = document.querySelector('.rename-form');
const renameError = renameForm.querySelector('.prompt-error');
let renameTarget = null;

function openRename(file, folderUrl) {
	renameTarget = { file, folderUrl };
	renameForm.elements.name.value = file.name;
	renameError.hidden = true;
	renameDialog.open();
	const input = renameForm.elements.name;
	input.focus();
	const dot = file.name.lastIndexOf('.');
	input.setSelectionRange(0, dot > 0 ? dot : file.name.length);
}

renameForm.addEventListener('submit', async event => {
	event.preventDefault();
	if (!renameTarget) return;
	renameError.hidden = true;
	const name = cleanNameInput(renameForm.elements.name.value);
	if (!name) return showFormError(renameError, 'Use a name without “/” or control characters.');
	if (name === renameTarget.file.name) { renameDialog.close(); return; }
	const submit = renameForm.querySelector('[type="submit"]');
	submit.disabled = true;
	renameDialog.setBusy(true);
	try {
		const data = await apiJson(renameTarget.folderUrl + '?manage=rename', { id: renameTarget.file.id, to: name });
		renameDialog.close();
		refreshListing();
		if (data.changed) showToast('Renamed to “' + name + '”.');
	} catch (error) {
		if (!error.signin) showFormError(renameError, error.message);
	} finally {
		submit.disabled = false;
		renameDialog.setBusy(false);
	}
});

/* ---------------------------------------------------------------- delete --- */

const deleteDialog = bindDialog(document.querySelector('.delete-backdrop'), {});
const deleteForm = document.querySelector('.delete-form');
const deleteError = deleteForm.querySelector('.prompt-error');
const deleteText = deleteForm.querySelector('.prompt-text');
const deleteList = deleteForm.querySelector('.prompt-list');
let deletePlan = null;

function openDelete(items, folderUrl) {
	deletePlan = { items, folderUrl };
	deleteError.hidden = true;
	deleteText.textContent = items.length === 1
		? 'Move “' + items[0].name + '” to Google Drive\u2019s trash?'
		: 'Move ' + items.length + ' items to Google Drive\u2019s trash?';
	deleteList.replaceChildren(...items.map(item => create('li', '', item.name)));
	deleteDialog.open();
}

deleteForm.addEventListener('submit', async event => {
	event.preventDefault();
	if (!deletePlan) return;
	deleteError.hidden = true;
	const submit = deleteForm.querySelector('[type="submit"]');
	submit.disabled = true;
	deleteDialog.setBusy(true);
	try {
		const merged = await runBatched(deletePlan.folderUrl, 'delete', deletePlan.items.map(item => item.id));
		deleteDialog.close();
		if (merged.changed) {
			refreshListing();
			loadStorage(true);
		}
		reportResults('moved to the trash', merged);
	} catch (error) {
		if (!error.signin) showFormError(deleteError, error.message);
	} finally {
		submit.disabled = false;
		deleteDialog.setBusy(false);
	}
});

/* ------------------------------------------------------------------ move --- */

const moveDialog = bindDialog(document.querySelector('.move-backdrop'), { onClose() { moveState = null; } });
const moveTitle = document.querySelector('#move-title');
const moveCrumbs = document.querySelector('.move-crumbs');
const moveList = document.querySelector('.move-list');
const moveStatus = document.querySelector('.move-status');
const moveForm = document.querySelector('.move-create');
const moveInput = document.querySelector('.move-new');
const moveHere = document.querySelector('.move-here');
let moveState = null;

function openMove(items, folderUrl) {
	// The picker starts at the folder being viewed, so a common move is one
	// click away; from a search result it starts at the index root.
	const start = folderUrl === path && isFolder ? '/' + path.slice(root.length) : '/';
	const blockedPrefixes = folderUrl === path
		? items.filter(item => item.mimeType === folderMime).map(item => path + encodeURIComponent(item.name) + '/')
		: [];
	moveState = { items, folderUrl, pickerPath: start, blockedPrefixes, busy: false };
	moveTitle.textContent = items.length === 1 ? 'Move “' + items[0].name + '”' : 'Move ' + items.length + ' items';
	moveInput.value = '';
	moveDialog.open();
	loadMovePicker();
}

function renderMoveCrumbs(pickerPath) {
	moveCrumbs.replaceChildren();
	const parts = pickerPath.split('/').filter(Boolean);
	const rootButton = create('button', '', 'Drive');
	rootButton.type = 'button';
	if (!parts.length) rootButton.setAttribute('aria-current', 'true');
	else rootButton.addEventListener('click', () => {
		// A click can land after the dialog closed and cleared the state.
		if (!moveState) return;
		moveState.pickerPath = '/';
		loadMovePicker();
	});
	moveCrumbs.append(rootButton);
	let acc = '';
	parts.forEach((segment, index) => {
		acc += segment + '/';
		moveCrumbs.append(icon('chevron', 'sep'));
		const button = create('button', '', nameFromPath(segment));
		button.type = 'button';
		if (index === parts.length - 1) button.setAttribute('aria-current', 'true');
		else button.addEventListener('click', () => {
			if (!moveState) return;
			moveState.pickerPath = acc;
			loadMovePicker();
		});
		moveCrumbs.append(button);
	});
}

async function loadMovePicker() {
	if (!moveState) return;
	renderMoveCrumbs(moveState.pickerPath);
	moveList.replaceChildren();
	moveStatus.textContent = 'Loading folders…';
	try {
		const url = root + moveState.pickerPath.slice(1);
		let token = '';
		let index = 0;
		let folders = [];
		do {
			const response = await post(url, { page_index: index, page_token: token });
			const data = await response.json();
			if (data.data?.error) throw new Error('Google Drive could not list this folder.');
			folders.push(...(data.data?.files || []).filter(file => file.mimeType === folderMime));
			token = data.nextPageToken || '';
			index++;
		} while (token);
		for (const folder of folders) {
			const child = moveState.pickerPath + encodeURIComponent(folder.name) + '/';
			const blocked = moveState.blockedPrefixes.some(prefix => child === prefix || child.startsWith(prefix));
			const button = create('button', 'move-row');
			button.type = 'button';
			button.append(icon('folder'), create('span', '', folder.name), icon('chevron', 'chevron'));
			button.setAttribute('aria-label', 'Open folder ' + folder.name);
			if (blocked) {
				button.disabled = true;
				button.title = 'This folder is inside the selection.';
			} else {
				button.addEventListener('click', () => {
					if (!moveState) return;
					moveState.pickerPath = child;
					loadMovePicker();
				});
			}
			const wrap = create('li');
			wrap.append(button);
			moveList.append(wrap);
		}
		moveStatus.textContent = folders.length
			? folders.length + (folders.length === 1 ? ' folder in “' : ' folders in “') + nameFromPath(moveState.pickerPath.split('/').filter(Boolean).at(-1) || 'Drive') + '”'
			: 'No folders inside here';
	} catch (error) {
		moveStatus.textContent = error.message;
	}
}

moveForm.addEventListener('submit', async event => {
	event.preventDefault();
	if (!moveState) return;
	const folderName = cleanNameInput(moveInput.value);
	if (!folderName) {
		moveStatus.textContent = 'Use a name without “/” or control characters.';
		return;
	}
	moveForm.querySelector('.move-create-btn').disabled = true;
	try {
		await apiJson(root + moveState.pickerPath.slice(1) + '?manage=mkdir', { name: folderName });
		moveInput.value = '';
		loadStorage(true);
		await loadMovePicker();
		showToast('Folder “' + folderName + '” created.');
	} catch (error) {
		if (!error.signin) moveStatus.textContent = error.message;
	} finally {
		moveForm.querySelector('.move-create-btn').disabled = false;
	}
});

moveHere.addEventListener('click', async () => {
	if (!moveState || moveState.busy) return;
	moveState.busy = true;
	moveHere.disabled = true;
	moveDialog.setBusy(true);
	moveStatus.textContent = 'Moving…';
	try {
		const merged = await runBatched(moveState.folderUrl, 'move', moveState.items.map(item => item.id), moveState.pickerPath);
		moveDialog.close();
		if (merged.changed) {
			refreshListing();
			loadStorage(true);
		}
		reportResults('moved', merged);
	} catch (error) {
		if (!error.signin) moveStatus.textContent = error.message;
		if (moveState) moveState.busy = false;
	} finally {
		moveHere.disabled = false;
		moveDialog.setBusy(false);
	}
});

/* --------------------------------------------------------------- row menu --- */

function openRowMenu(anchor, file, entry) {
	const capabilities = file.capabilities || {};
	const items = [];
	if (selectable) {
		items.push({
			icon: 'check',
			label: selected.has(file.id) ? 'Deselect' : 'Select',
			onPick: () => setSelected(entry, !selected.has(file.id))
		});
	}
	items.push(
		{
			icon: 'edit',
			label: 'Rename',
			disabled: capabilities.canRename === false,
			reason: 'Google Drive does not allow renaming this item.',
			onPick: () => prepareRowAction(file, folderUrl => openRename(file, folderUrl))
		},
		{
			icon: 'move',
			label: 'Move to…',
			disabled: capabilities.canMoveItemWithinDrive === false,
			reason: 'Google Drive does not allow moving this item.',
			onPick: () => prepareRowAction(file, folderUrl => openMove([file], folderUrl))
		},
		{ sep: true },
		{
			icon: 'trash',
			label: 'Delete',
			danger: true,
			disabled: capabilities.canTrash === false && capabilities.canDelete !== true,
			reason: 'Google Drive does not allow deleting this item.',
			onPick: () => prepareRowAction(file, folderUrl => openDelete([file], folderUrl))
		}
	);
	showMenu(anchor, items);
}

/* --------------------------------------------------------- selection bar --- */

selectionBar.querySelector('.selection-rename').addEventListener('click', () => {
	const items = [...selected.values()];
	if (items.length === 1) openRename(items[0], path);
});
selectionBar.querySelector('.selection-move').addEventListener('click', () => {
	const items = [...selected.values()];
	if (items.length) openMove(items, path);
});
selectionBar.querySelector('.selection-delete').addEventListener('click', () => {
	const items = [...selected.values()];
	if (items.length) openDelete(items, path);
});
selectionBar.querySelector('.selection-clear').addEventListener('click', clearSelection);

/* --------------------------------------------------------------- storage --- */

const storageSection = document.querySelector('.storage');
const storagePercent = document.querySelector('.storage-percent');
const storageFill = document.querySelector('.storage .bar-fill');
const storageFigures = document.querySelector('.storage-figures');
const storageNote = document.querySelector('.storage-note');
const storageRefresh = document.querySelector('.storage-refresh');
let storageBusy = false;

function renderStorage(data) {
	const percent = data.total != null && data.used != null && data.total > 0
		? Math.min(100, data.used / data.total * 100)
		: null;
	storagePercent.textContent = percent == null ? '—' : Math.round(percent) + '%';
	storageSection.classList.toggle('is-full', percent != null && percent >= 90);
	storageFill.style.width = (percent ?? 0) + '%';
	const rows = [
		['Used', data.used],
		['Available', data.available],
		['Total', data.total],
		['In Drive', data.usedInDrive],
		['In trash', data.usedInTrash]
	].filter(([, value]) => value != null);
	storageFigures.replaceChildren(...rows.map(([label, value]) => {
		const wrap = create('div');
		wrap.append(create('dt', '', label), create('dd', '', formatSize(value)));
		return wrap;
	}));
	const at = data.fetchedAt ? dates.format(new Date(data.fetchedAt)) : '';
	storageNote.textContent = percent == null
		? 'Google Drive reported no storage limit for this account.'
		: (data.cached ? 'Cached' : 'Reported') + ' by Google Drive' + (at ? ' · ' + at : '');
}

async function loadStorage(refresh) {
	if (!isAdmin || !isFolder || isSearch || storageBusy) return;
	storageBusy = true;
	storageSection.hidden = false;
	storageRefresh.disabled = true;
	storageRefresh.replaceChildren(icon('refresh', refresh ? 'is-spinning' : ''));
	try {
		renderStorage(await apiJson(root + '?manage=storage' + (refresh ? '&refresh=1' : ''), undefined, 'GET'));
	} catch (error) {
		if (error.signin) storageSection.hidden = true;
		else {
			storagePercent.textContent = '—';
			storageFigures.replaceChildren();
			storageNote.textContent = error.message;
		}
	} finally {
		storageBusy = false;
		storageRefresh.disabled = false;
		storageRefresh.replaceChildren(icon('refresh'));
	}
}

storageRefresh.addEventListener('click', () => loadStorage(true));

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
	pushLayer(leavePreview);
	try {
		const response = await post(path);
		const file = await response.json();
		const kind = fileKind(file);
		// Opening a preview is the other thing that makes a file "recent".
		recordRecent(file, path);
		previewTitle.textContent = file.name;
		previewMeta.textContent = [kind.label, formatSize(file.size), modified(file)].join(' · ');
		previewDownload.href = path;
		previewDownload.download = file.name;
		previewDownload.addEventListener('click', () => recordRecent(file, path));
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

/* ---------------------------------------------------------- admin session --- */

const adminLock = document.querySelector('.admin-lock');
const signinDialog = bindDialog(document.querySelector('.signin-backdrop'), {});
const signinForm = document.querySelector('.signin-form');
const signinError = document.querySelector('.signin-error');
const signinNote = document.querySelector('.signin-note');
const signinBusy = document.querySelector('.signin-busy');
// Sign-in and sign-out always go to the index root: any index path answers
// them, and the root one works from a search or preview page too.
const sessionUrl = root + '?manage=';

function basicAuthValue(username, password) {
	const bytes = new TextEncoder().encode(username + ':' + password);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return 'Basic ' + btoa(binary);
}

function promptSignin(message) {
	if (!canAdmin) return;
	signinNote.textContent = message || 'The administrator pair from this index\u2019s settings unlocks uploads and file management.';
	signinError.hidden = true;
	signinDialog.open();
	signinForm.elements.user.focus();
}

signinForm.addEventListener('submit', async event => {
	event.preventDefault();
	signinError.hidden = true;
	const submit = signinForm.querySelector('[type="submit"]');
	submit.disabled = true;
	signinBusy.hidden = false;
	signinDialog.setBusy(true);
	try {
		const response = await fetch(sessionUrl + 'login', {
			method: 'POST',
			headers: {
				'Authorization': basicAuthValue(signinForm.elements.user.value, signinForm.elements.pass.value),
				'X-Requested-With': CLIENT_MARKER
			}
		});
		if (response.status === 401) throw new Error('That admin sign-in did not work. Check the username and password.');
		if (!response.ok) {
			let data = null;
			try { data = await response.json(); } catch {}
			throw new Error(data?.error || 'The sign-in did not go through. Try again.');
		}
		signinForm.reset();
		signinDialog.close();
		// The page model itself changes with the session, so reload.
		location.reload();
	} catch (error) {
		showFormError(signinError, error.message);
	} finally {
		submit.disabled = false;
		signinBusy.hidden = true;
		signinDialog.setBusy(false);
	}
});

async function signOut() {
	try {
		await fetch(sessionUrl + 'logout', { method: 'POST', headers: { 'X-Requested-With': CLIENT_MARKER } });
	} catch {}
	location.reload();
}

if (canAdmin) {
	adminLock.hidden = false;
	adminLock.replaceChildren(icon('user'));
	adminLock.classList.toggle('is-active', isAdmin);
	const lockLabel = isAdmin ? 'Admin session' : 'Admin sign-in';
	adminLock.title = lockLabel;
	adminLock.setAttribute('aria-label', lockLabel);
	adminLock.addEventListener('click', () => {
		if (isAdmin) {
			showMenu(adminLock, [
				{ heading: 'Signed in as admin' },
				{ sep: true },
				{ icon: 'signout', label: 'Sign out', danger: true, onPick: signOut }
			]);
		} else {
			promptSignin();
		}
	});
}

/* --------------------------------------------------------- recent files --- */

// The last files opened or downloaded, kept in this browser alone: the store
// holds only paths that browser already visited, and a private index still
// asks for its sign-in when one of them is opened again.
const RECENT_KEY = 'rin-recent';
const RECENT_CAP = 20;

const recentButton = document.querySelector('.recent-button');
const recentList = document.querySelector('.recent-list');
const recentEmpty = document.querySelector('.recent-empty');
const recentDialog = bindDialog(document.querySelector('.recent-backdrop'), { onOpen: renderRecent });

function loadRecent() {
	try {
		const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
		return Array.isArray(value)
			? value.filter(item => item && typeof item.path === 'string' && item.name)
			.slice(0, RECENT_CAP)
			: [];
	} catch {
		return [];
	}
}

function saveRecent(list) {
	try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

function recordRecent(file, filePath) {
	if (!file?.name || file.mimeType === folderMime || !filePath) return;
	const list = loadRecent().filter(item => item.path !== filePath);
	list.unshift({ path: filePath, name: file.name, kind: fileKind(file).type, at: Date.now() });
	saveRecent(list.slice(0, RECENT_CAP));
}

function timeAgo(at) {
	const minutes = Math.round((Date.now() - at) / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return minutes + ' min ago';
	const hours = Math.round(minutes / 60);
	if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
	const days = Math.round(hours / 24);
	return days + (days === 1 ? ' day ago' : ' days ago');
}

function renderRecent() {
	const list = loadRecent();
	recentList.replaceChildren(...list.map(entry => {
		const item = create('li', 'recent-row');
		const link = create('a', 'recent-link');
		// Media items keep opening on the player page, everything else on the
		// preview dialog.
		link.href = entry.path + ((entry.kind === 'video' || entry.kind === 'audio') ? '?a=player' : '?a=view');
		link.append(kindIcon(entry.kind), create('span', 'recent-name', entry.name));
		link.title = entry.name;
		const when = create('span', 'recent-when', timeAgo(entry.at));
		item.append(link, when);
		return item;
	}));
	recentEmpty.hidden = Boolean(list.length);
}

recentButton.hidden = false;
recentButton.title = 'Recently opened';
recentButton.addEventListener('click', () => recentDialog.open());
document.querySelector('.recent-clear').addEventListener('click', () => {
	saveRecent([]);
	renderRecent();
});

/* ------------------------------------------------------ keyboard shortcuts --- */

// Single-key operation of the listing: / focuses search, arrows walk the
// rows, Enter opens, Space selects, Delete trashes, N opens the New menu, ?
// shows the list. Typing in a field or having a dialog open hands the keys
// back; Escape is routed by the layer stack and stays untouched here.
const shortcutsDialog = bindDialog(document.querySelector('.shortcuts-backdrop'), {});
let keyRow = null;

function clearKeyRow() {
	if (keyRow) keyRow.classList.remove('is-keynav');
	keyRow = null;
}

function setKeyRow(entry) {
	clearKeyRow();
	keyRow = entry;
	entry.classList.add('is-keynav');
	entry.scrollIntoView({ block: 'nearest' });
}

function keyRows() {
	return [...fileList.children].filter(entry => !entry.hidden);
}

function moveKeyRow(delta) {
	const rows = keyRows();
	if (!rows.length) return;
	const index = keyRow ? rows.indexOf(keyRow) : (delta > 0 ? 0 : rows.length - 1);
	if (index === -1) return;
	const next = index + delta;
	if (next < 0 || next >= rows.length) return;
	setKeyRow(rows[next]);
}

document.addEventListener('keydown', event => {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	const active = document.activeElement;
	const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
		|| active.tagName === 'SELECT' || active.isContentEditable);
	if (typing || layers.length) return;
	// A focused link or button owns Space and Enter; the browser clicks it.
	if (active && (active.tagName === 'BUTTON' || active.tagName === 'A') && (event.key === ' ' || event.key === 'Enter')) return;
	switch (event.key) {
		case '/':
			if (!searchForm.hidden) {
				event.preventDefault();
				searchForm.elements.q.focus();
			}
			break;
		case '?':
			event.preventDefault();
			if (shortcutsDialog.isOpen()) shortcutsDialog.close();
			else shortcutsDialog.open();
			break;
		case 'ArrowDown':
			if (keyRows().length) {
				event.preventDefault();
				moveKeyRow(1);
			}
			break;
		case 'ArrowUp':
			if (keyRows().length) {
				event.preventDefault();
				moveKeyRow(-1);
			}
			break;
		case 'Enter':
			if (keyRow) {
				event.preventDefault();
				keyRow.querySelector('.row-main').click();
			}
			break;
		case ' ':
			if (keyRow && selectable) {
				event.preventDefault();
				setSelected(keyRow, !selected.has(keyRow._item.id));
			}
			break;
		case 'Delete':
			if (keyRow && rowMenus) {
				event.preventDefault();
				const file = keyRow._item;
				prepareRowAction(file, folderUrl => openDelete([file], folderUrl));
			}
			break;
		case 'n':
		case 'N':
			if (!newButton.hidden) {
				event.preventDefault();
				newButton.click();
			}
			break;
	}
});

/* ---------------------------------------------------------------- uploads --- */

// Admin uploads: the Worker seals the Drive session behind an opaque token,
// so credentials, tokens, and session URLs never appear in page responses.
// The engine (upload-engine.js) drives resumable chunks with live speed and
// ETA and exposes pause / resume / cancel; this layer keeps any number of
// batches in one centered dialog and refreshes the listing when they finish.
// The dialog is dismissable at any time — Escape, the fold button, or a click
// on the dimmed page folds it into the dock — because uploads keep running
// either way; only the clear button waits for every batch to settle.
const uploadBackdrop = document.querySelector('.upload-backdrop');
const uploadBody = document.querySelector('.upload-body');
const uploadCloseBtn = document.querySelector('.upload-close');
const uploadDock = document.querySelector('.upload-dock');
const newButton = document.querySelector('.new-button');
const uploadInput = document.querySelector('.upload-input');
const folderInput = document.querySelector('.folder-input');
let folderInputSupported = false;
if ('webkitdirectory' in folderInput) {
	folderInput.webkitdirectory = true;
	folderInputSupported = true;
}

const MAX_ATTEMPTS = window.RinUploadEngine.MAX_ATTEMPTS;
const PAUSABLE = { pending: true, queued: true, starting: true, uploading: true, retrying: true, resuming: true };
const FINAL_STATES = { done: true, cancelled: true, error: true };

const batches = [];
let batchCounter = 0;
let uploadRenderQueued = false;
let uploadsDismissed = false;
let uploadPanelCloser = null;

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
	// Kilobytes read honestly on slow lines, where "0.1 MB/s" hides how the
	// transfer is really doing; megabytes keep one decimal above that.
	if (bytesPerSecond < 1024 * 1024) return Math.max(1, Math.round(bytesPerSecond / 1024)) + ' KB/s';
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

function batchRow(batch, index) {
	if (batch.rows[index]) return batch.rows[index];
	const record = batch.states[index];
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
	// Both icons are built once and toggled, so a progress frame never has to
	// build SVG elements to redraw a row that is already on screen.
	const pauseIcon = icon('pause');
	const playIcon = icon('play');
	playIcon.hidden = true;
	pauseBtn.append(pauseIcon, playIcon);
	pauseBtn.addEventListener('click', () => {
		if (!batch.handle) return;
		const current = batch.states[index];
		if (!current) return;
		if (current.state === 'paused') {
			if (batch.handle.resume(index)) {
				current.state = 'resuming';
				scheduleUploadRender();
			}
		} else if (batch.handle.pause(index)) {
			current.state = 'pausing';
			scheduleUploadRender();
		}
	});
	const cancelBtn = create('button', 'icon-btn');
	cancelBtn.type = 'button';
	cancelBtn.title = 'Cancel';
	cancelBtn.setAttribute('aria-label', 'Cancel ' + (record ? record.name : 'file'));
	cancelBtn.addEventListener('click', () => {
		if (!batch.handle) return;
		if (batch.handle.cancel(index)) {
			batch.states[index].state = 'cancelling';
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
	batch.listEl.append(item);
	batch.rows[index] = { item, nameEl, stateEl, noteEl, fill, pauseBtn, cancelBtn, pauseIcon, playIcon };
	return batch.rows[index];
}

function buildBatchDom(batch) {
	const section = create('section', 'upload-batch');
	const overview = create('div', 'upload-overview');
	const topline = create('div', 'topline');
	const percentEl = create('span', 'upload-percent', '0%');
	const figuresEl = create('span', 'upload-figures', '');
	// Settled batches stay as history until they are dismissed here or with
	// the clear button; running batches keep it out of the way.
	const dismissBtn = create('button', 'icon-btn upload-dismiss');
	dismissBtn.type = 'button';
	dismissBtn.title = 'Dismiss';
	dismissBtn.setAttribute('aria-label', 'Dismiss this batch');
	dismissBtn.hidden = true;
	dismissBtn.append(icon('x'));
	dismissBtn.addEventListener('click', () => dismissBatch(batch));
	topline.append(percentEl, figuresEl, dismissBtn);
	const bar = create('div', 'bar');
	const fill = create('div', 'bar-fill');
	bar.append(fill);
	const subEl = create('p', 'upload-sub', '');
	overview.append(topline, bar, subEl);

	const listEl = create('ul', 'upload-list');
	const foot = create('div', 'upload-foot');
	const pauseAllBtn = create('button', 'button button-ghost', 'Pause all');
	pauseAllBtn.type = 'button';
	const resumeAllBtn = create('button', 'button button-ghost', 'Resume all');
	resumeAllBtn.type = 'button';
	const cancelRestBtn = create('button', 'button button-danger', 'Cancel remaining');
	cancelRestBtn.type = 'button';
	const retryFailedBtn = create('button', 'button button-secondary', 'Retry failed');
	retryFailedBtn.type = 'button';
	retryFailedBtn.hidden = true;
	const copyReportBtn = create('button', 'button button-secondary', 'Copy report');
	copyReportBtn.type = 'button';
	copyReportBtn.hidden = true;
	foot.append(pauseAllBtn, resumeAllBtn, cancelRestBtn, retryFailedBtn, copyReportBtn);

	pauseAllBtn.addEventListener('click', () => {
		if (!batch.handle) return;
		if (batch.handle.pause()) {
			for (const record of batch.states) if (record && PAUSABLE[record.state]) record.state = 'pausing';
			scheduleUploadRender();
		}
	});
	resumeAllBtn.addEventListener('click', () => {
		if (!batch.handle) return;
		if (batch.handle.resume()) {
			for (const record of batch.states) if (record && record.state === 'paused') record.state = 'resuming';
			scheduleUploadRender();
		}
	});
	cancelRestBtn.addEventListener('click', () => {
		if (!batch.handle) return;
		if (batch.handle.cancel()) {
			for (const record of batch.states) {
				if (record && !FINAL_STATES[record.state] && record.state !== 'cancelling') record.state = 'cancelling';
			}
			scheduleUploadRender();
		}
	});
	retryFailedBtn.addEventListener('click', () => {
		const failedFiles = batch.states.filter(record => record && record.state === 'error').map(record => record.file);
		if (!failedFiles.length) return;
		// The retried files move to the new batch; their failures leave the
		// history here, so the dock stops counting what was already retried.
		for (let index = 0; index < batch.states.length; index++) {
			const record = batch.states[index];
			if (!record || record.state !== 'error') continue;
			batch.states[index] = null;
			if (batch.rows[index]) batch.rows[index].item.remove();
		}
		if (!batch.states.some(Boolean)) dismissBatch(batch);
		startUpload(failedFiles, 'Retry');
	});
	copyReportBtn.addEventListener('click', async () => {
		const text = buildBatchReport(batch);
		showToast(await writeClipboard(text) ? 'Report copied to the clipboard' : 'Copy blocked');
	});

	section.append(overview, listEl, foot);
	uploadBody.append(section);
	Object.assign(batch, { section, percentEl, figuresEl, dismissBtn, fill, subEl, listEl, pauseAllBtn, resumeAllBtn, cancelRestBtn, retryFailedBtn, copyReportBtn });
}

function onBatchEvent(batch, event) {
	if (event.index !== undefined && batch.states[event.index]) {
		const record = batch.states[event.index];
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
		batch.batch = event;
		batch.done = false;
	} else if (event.type === 'batch-progress') {
		batch.batch = event;
	} else if (event.type === 'batch-done') {
		batch.done = true;
		batch.batch = Object.assign({}, batch.batch, event);
	}
	scheduleUploadRender();
}

function scheduleUploadRender() {
	if (uploadRenderQueued) return;
	uploadRenderQueued = true;
	requestAnimationFrame(() => {
		uploadRenderQueued = false;
		renderUploads();
	});
}

function renderUploads() {
	for (const batch of batches) renderBatch(batch);
	renderDock();
	renderPanelButtons();
}

function renderBatch(batch) {
	let unfinished = 0;
	let paused = 0;
	let pausable = 0;
	let failed = 0;
	for (let index = 0; index < batch.states.length; index++) {
		const record = batch.states[index];
		if (!record) continue;
		const row = batchRow(batch, index);
		row.item.className = 'upload-row'
			+ (record.state === 'done' ? ' is-done' : '')
			+ (record.state === 'paused' ? ' is-paused' : '')
			+ (record.state === 'error' ? ' is-error' : '');
		row.fill.className = 'bar-fill'
			+ (record.state === 'paused' ? ' is-paused' : '')
			+ (record.state === 'cancelled' ? ' is-cancelled' : '');
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
		row.pauseIcon.hidden = isPaused;
		row.playIcon.hidden = !isPaused;
		row.pauseBtn.title = isPaused ? 'Resume' : 'Pause';
		row.pauseBtn.setAttribute('aria-label', (isPaused ? 'Resume ' : 'Pause ') + record.name);
		row.pauseBtn.disabled = isPaused && record.reason === 'stalled' && navigator.onLine === false;
		row.cancelBtn.hidden = final || record.state === 'cancelling';

		if (!final) unfinished++;
		if (isPaused) paused++;
		if (!final && !isPaused && record.state !== 'cancelling' && record.state !== 'pausing') pausable++;
		if (record.state === 'error') failed++;
	}

	const summary = batch.batch;
	if (summary) {
		const percent = Math.max(0, Math.min(100, summary.percent || 0));
		batch.fill.style.width = percent.toFixed(1) + '%';
		batch.percentEl.textContent = percent.toFixed(0) + '%';
		const figures = [];
		if (summary.filesTotal > 1) figures.push((summary.filesDone || 0) + ' of ' + summary.filesTotal + ' files');
		figures.push(formatSize(summary.uploaded) + ' of ' + formatSize(summary.total));
		const speed = formatSpeed(summary.speed);
		if (speed) figures.push(speed);
		const eta = formatEta(summary.eta);
		if (eta) figures.push(eta);
		batch.figuresEl.textContent = figures.join(' · ');

		const sub = [];
		const split = formatSplit(summary.sendMs, summary.waitMs);
		if (split && !batch.done) sub.push(split);
		if (summary.paused) sub.push(summary.paused + (summary.paused === 1 ? ' file paused' : ' files paused'));
		if (summary.retries) sub.push(summary.retries + (summary.retries === 1 ? ' retry' : ' retries'));
		batch.subEl.textContent = sub.join(' · ');
	}

	batch.pauseAllBtn.disabled = !pausable;
	batch.pauseAllBtn.hidden = batch.done && !pausable;
	batch.resumeAllBtn.disabled = !paused;
	batch.resumeAllBtn.hidden = batch.done && !paused;
	batch.cancelRestBtn.disabled = !unfinished;
	batch.cancelRestBtn.hidden = batch.done && !unfinished;
	batch.retryFailedBtn.hidden = !(batch.done && failed);
	batch.copyReportBtn.hidden = !batch.done || !batch.batch;
	batch.dismissBtn.hidden = !batch.done;
}

function renderPanelButtons() {
	const active = batches.some(batch => !batch.done);
	uploadCloseBtn.disabled = active;
	uploadCloseBtn.title = active ? 'Uploads are still running' : 'Clear finished uploads';
}

// Settled batches are the transfer history: they keep their per-file outcomes
// and report until dismissed, and only the last few stay (the oldest goes
// when a new batch settles past the cap).
const HISTORY_CAP = 3;

function dismissBatch(batch) {
	batch.section.remove();
	const index = batches.indexOf(batch);
	if (index >= 0) batches.splice(index, 1);
	if (!batches.length) {
		uploadsDismissed = true;
		uploadBackdrop.hidden = true;
		if (uploadPanelCloser) {
			removeLayer(uploadPanelCloser);
			uploadPanelCloser = null;
		}
	}
	renderPanelButtons();
	renderDock();
}

function trimUploadHistory() {
	const settled = batches.filter(batch => batch.done);
	// Keep the newest HISTORY_CAP settled batches; drop older ones only when
	// the count actually exceeds the cap.
	const excess = Math.max(0, settled.length - HISTORY_CAP);
	for (const batch of settled.slice(0, excess)) dismissBatch(batch);
}

// The dock is one persistent set of nodes whose text and bar are updated in
// place, so a running upload never rebuilds it frame after frame.
const dockLabel = create('span');
const dockFill = create('div', 'bar-fill');
const dockBar = create('div', 'bar');
dockBar.append(dockFill);
uploadDock.replaceChildren(icon('upload'), dockLabel, dockBar);

function renderDock() {
	const show = uploadBackdrop.hidden && !uploadsDismissed && batches.length > 0;
	uploadDock.hidden = !show;
	if (!show) return;
	let total = 0;
	let uploaded = 0;
	let speed = 0;
	let running = false;
	let failures = 0;
	for (const batch of batches) {
		const summary = batch.batch;
		if (summary) {
			total += summary.total || 0;
			uploaded += summary.uploaded || 0;
			speed += summary.speed || 0;
		}
		if (!batch.done) running = true;
		for (const record of batch.states) if (record && record.state === 'error') failures++;
	}
	uploadDock.classList.toggle('has-failures', !running && failures > 0);
	const percent = total ? Math.min(100, uploaded / total * 100) : 0;
	dockFill.style.width = percent.toFixed(1) + '%';
	dockLabel.textContent = running
		? Math.round(percent) + '% · ' + (formatSpeed(speed) || 'starting')
		: (failures
			? failures + (failures === 1 ? ' file failed' : ' files failed')
			: 'Done · uploads');
}

function openUploadPanel() {
	uploadsDismissed = false;
	uploadBackdrop.hidden = false;
	uploadDock.hidden = true;
	if (!uploadPanelCloser) {
		uploadPanelCloser = minimizeUploads;
		pushLayer(uploadPanelCloser);
	}
	scheduleUploadRender();
}

function minimizeUploads() {
	uploadBackdrop.hidden = true;
	if (uploadPanelCloser) {
		removeLayer(uploadPanelCloser);
		uploadPanelCloser = null;
	}
	renderDock();
}

uploadBackdrop.addEventListener('click', event => {
	if (event.target === uploadBackdrop) minimizeUploads();
});
document.querySelector('.upload-minimize').addEventListener('click', minimizeUploads);
uploadCloseBtn.addEventListener('click', () => {
	if (batches.some(batch => !batch.done)) return;
	for (const batch of batches) batch.section.remove();
	batches.length = 0;
	uploadsDismissed = true;
	uploadBackdrop.hidden = true;
	if (uploadPanelCloser) {
		removeLayer(uploadPanelCloser);
		uploadPanelCloser = null;
	}
	renderDock();
});
uploadDock.addEventListener('click', openUploadPanel);

function buildBatchReport(batch) {
	const report = batch.handle ? batch.handle.report() : null;
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
	if (batches.some(batch => batch.handle && batch.handle.summary().unfinished > 0)) {
		event.preventDefault();
		event.returnValue = '';
	}
});

// Files parked by a connection drop resume by themselves once the browser
// is back online; user-paused files stay paused until Resume is pressed.
window.addEventListener('online', () => {
	for (const batch of batches) {
		if (!batch.handle) continue;
		for (let index = 0; index < batch.states.length; index++) {
			const record = batch.states[index];
			if (record && record.state === 'paused' && record.reason === 'stalled') {
				if (batch.handle.resume(index)) record.state = 'resuming';
			}
		}
	}
	scheduleUploadRender();
});

function startUpload(files, title) {
	if (!files.length) return;
	const batch = {
		id: ++batchCounter,
		title: title || (files.length === 1 ? files[0].name : files.length + ' files'),
		files,
		states: files.map(file => ({
			file, name: file.name, total: file.size, state: 'pending',
			uploaded: 0, committed: 0, percent: 0, speed: null, eta: null,
			reason: '', message: '', attempt: 0, closed: null
		})),
		rows: [],
		batch: null,
		done: false,
		handle: null
	};
	buildBatchDom(batch);
	batches.push(batch);
	openUploadPanel();
	const engine = new window.RinUploadEngine.Engine({ transport: xhrTransport });
	batch.handle = engine.start(files, {
		path,
		getHeaders: () => ({ 'X-Requested-With': CLIENT_MARKER }),
		concurrency: 2,
		onEvent: event => onBatchEvent(batch, event)
	});
	batch.handle.done.then(state => {
		batch.done = true;
		if (state.succeeded) refreshListing();
		loadStorage(true);
		trimUploadHistory();
		scheduleUploadRender();
	}).catch(() => {
		batch.done = true;
		trimUploadHistory();
		scheduleUploadRender();
	});
	scheduleUploadRender();
}

/* --------------------------------------------------------- folder uploads --- */

// Creates the folders a batch needs, level by level, then starts the engine
// with every file pointing at the folder it belongs to. `entries` hold a
// File plus the folder chain (relative to the current folder) it goes in.
async function uploadWithFolders(entries, title) {
	if (!entries.length) return;
	const dirs = new Set();
	for (const { segs } of entries) {
		for (let depth = 1; depth <= segs.length; depth++) dirs.add(segs.slice(0, depth).join('/'));
	}
	const failed = new Set();
	const problems = [];
	const ordered = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
	for (const dir of ordered) {
		if ([...failed].some(prefix => dir.startsWith(prefix + '/'))) {
			failed.add(dir);
			continue;
		}
		const segs = dir.split('/');
		const parent = segs.length === 1 ? path : path + segs.slice(0, -1).map(encodeURIComponent).join('/') + '/';
		try {
			await apiJson(parent + '?manage=mkdir', { name: segs.at(-1), reuse: true });
		} catch (error) {
			if (error.signin) return;
			failed.add(dir);
			problems.push(dir + ' — ' + error.message);
		}
	}
	const okFiles = [];
	const dropped = [];
	for (const entry of entries) {
		const dir = entry.segs.join('/');
		if ([...failed].some(prefix => dir === prefix || dir.startsWith(prefix + '/'))) dropped.push(entry.file.name);
		else {
			if (entry.segs.length) entry.file.targetPath = path + entry.segs.map(encodeURIComponent).join('/') + '/';
			okFiles.push(entry.file);
		}
	}
	if (problems.length) showToast('Some folders could not be created: ' + problems.slice(0, 2).join('; ') + (problems.length > 2 ? '; …' : ''));
	if (dropped.length) showToast(dropped.length + ' file(s) skipped because their folders could not be created.');
	if (!okFiles.length) return;
	startUpload(okFiles, title || (okFiles.length === 1 ? okFiles[0].name : okFiles.length + ' files'));
}

async function walkEntries(entries, segs, out) {
	for (const entry of entries) {
		if (entry.isFile) {
			const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
			out.push({ file, segs });
		} else if (entry.isDirectory) {
			const reader = entry.createReader();
			let group;
			do {
				group = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
				await walkEntries(group, segs.concat(entry.name), out);
			} while (group.length);
		}
	}
}

/* ---------------------------------------------------------- drag & drop --- */

function isFileDrag(event) {
	return [...(event.dataTransfer?.types || [])].includes('Files');
}

function setupDropZone() {
	const dropZone = document.querySelector('.drop-zone');
	let depth = 0;
	panel.addEventListener('dragenter', event => {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		depth++;
		dropZone.hidden = false;
	});
	panel.addEventListener('dragover', event => {
		if (!isFileDrag(event)) return;
		event.preventDefault();
	});
	panel.addEventListener('dragleave', () => {
		depth = Math.max(0, depth - 1);
		if (!depth) dropZone.hidden = true;
	});
	panel.addEventListener('drop', async event => {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		depth = 0;
		dropZone.hidden = true;
		const transfer = event.dataTransfer;
		// Entry objects must be collected before anything is awaited.
		const roots = transfer.items
			? [...transfer.items].map(item => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)).filter(Boolean)
			: [];
		if (roots.length) {
			const collected = [];
			try {
				await walkEntries(roots, [], collected);
			} catch {
				showToast('Some of what was dropped could not be read.');
				return;
			}
			const topName = roots.length === 1 && roots[0].isDirectory ? roots[0].name : '';
			uploadWithFolders(collected, topName);
		} else {
			const files = [...transfer.files].map(file => ({ file, segs: [] }));
			uploadWithFolders(files, '');
		}
	});
}

/* -------------------------------------------------------------- start up --- */

newButton.addEventListener('click', () => {
	const items = [
		{ icon: 'new-folder', label: 'New folder', onPick: openMkdir },
		{ icon: 'upload', label: 'Upload files', onPick: () => uploadInput.click() }
	];
	if (folderInputSupported) {
		items.splice(1, 0, { icon: 'folder', label: 'Upload folder', onPick: () => folderInput.click() });
	}
	showMenu(newButton, items);
});

uploadInput.addEventListener('change', () => {
	const files = [...uploadInput.files];
	uploadInput.value = '';
	if (files.length) startUpload(files);
});

folderInput.addEventListener('change', () => {
	const files = [...folderInput.files];
	folderInput.value = '';
	if (!files.length) return;
	// webkitRelativePath is "Top folder/sub/file.txt"; the top folder itself
	// is uploaded into the folder being viewed.
	const entries = files.map(file => {
		const parts = (file.webkitRelativePath || file.name).split('/');
		return { file, segs: parts.slice(0, -1) };
	});
	uploadWithFolders(entries, (files[0].webkitRelativePath || '').split('/')[0] || '');
});

/* ------------------------------------------------------------- player --- */

// Video and audio files open on a page of their own: a full-width stage with
// the site's controls, a subtitle menu that reads sidecar .srt/.vtt/.ass
// files from the same folder (browsers cannot read the subtitles embedded
// inside an .mkv), an audio-track menu that switches tracks whenever the
// browser exposes them, speed, PiP, fullscreen and keyboard control.

const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SUBTITLE_EXTS = ['srt', 'vtt', 'ass', 'ssa'];
const PLAYER_POS_KEY = 'rin-player-position:';

function fileStem(name) {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

function fileExt(name) {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// A media file opens on its own player page instead of the preview dialog;
// rows, search results and recent entries all compute the same URL.
function viewActionFor(kind) {
	if (kind.type === 'folder') return '';
	return (kind.type === 'video' || kind.type === 'audio') ? '?a=player' : '?a=view';
}

function kindFromName(name) {
	return fileKind({ name });
}

function formatClock(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const two = value => String(value).padStart(2, '0');
	return (hours ? hours + ':' + two(minutes) : String(minutes)) + ':' + two(total % 60);
}

// Cue clocks: SRT writes "0:00:01,500", VTT "0:00:01.500", ASS "0:00:01.50" —
// one lenient reader covers all three.
function parseCueClock(value) {
	const match = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(String(value).trim());
	if (!match) return null;
	return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
		+ Number(match[4].padEnd(3, '0')) / 1000;
}

function cleanCueText(lines) {
	// The overlay renders plain text: markup tags and ASS override blocks go,
	// hard line breaks stay.
	const text = lines.join('\n')
		.replace(/<[^>]*>/g, '')
		.replace(/\{[^}]*\}/g, '')
		.replace(/\\[Nn]/g, '\n')
		.trim();
	return text || null;
}

function parseSrtOrVtt(text) {
	const cues = [];
	for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
		const lines = block.split('\n').filter(Boolean);
		const cueLine = lines.findIndex(line => line.includes('-->'));
		if (cueLine === -1) continue;
		const [rawStart, rawEnd] = lines[cueLine].split('-->');
		const start = parseCueClock(rawStart);
		const end = parseCueClock(rawEnd);
		const body = cleanCueText(lines.slice(cueLine + 1));
		if (start !== null && end !== null && body) cues.push({ start, end, text: body });
	}
	return cues;
}

function parseAss(text) {
	const cues = [];
	// Default [Events] layout; the file's own Format line replaces it.
	const columns = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
	let inEvents = false;
	for (const rawLine of text.replace(/\r/g, '').split('\n')) {
		const section = /^\[(.+)\]$/.exec(rawLine.trim());
		if (section) {
			inEvents = section[1].trim().toLowerCase() === 'events';
			continue;
		}
		if (!inEvents) continue;
		if (/^format\s*:/i.test(rawLine)) {
			const fields = rawLine.replace(/^format\s*:/i, '').split(',').map(field => field.trim().toLowerCase());
			if (fields.length >= 3) columns.splice(0, columns.length, ...fields);
			continue;
		}
		if (!/^dialogue\s*:/i.test(rawLine)) continue;
		const fields = rawLine.replace(/^dialogue\s*:/i, '').split(',');
		const textIndex = columns.indexOf('text');
		const startIndex = columns.indexOf('start');
		const endIndex = columns.indexOf('end');
		if (textIndex < 1 || startIndex === -1 || endIndex === -1) continue;
		const head = fields.slice(0, textIndex);
		// The text column keeps its commas: only the leading columns split.
		const start = parseCueClock(head[startIndex]);
		const end = parseCueClock(head[endIndex]);
		const body = cleanCueText([fields.slice(textIndex).join(',')]);
		if (start !== null && end !== null && body) cues.push({ start, end, text: body });
	}
	return cues;
}

function subtitleLabel(fileName, stem) {
	// "Episode.en.srt" → "en", "Episode.English.ass" → "english";
	// a plain "Episode.srt" is just the file's own format.
	const ext = fileExt(fileName);
	const middle = fileName.slice(stem.length, fileName.length - ext.length - 1).replace(/^[.\s_-]+/, '');
	return middle || 'Subtitles';
}

async function playerPage() {
	const fileName = nameFromPath(path);
	const kind = kindFromName(fileName);
	const isVideo = kind.type === 'video';

	// The listing panel, its controls and the search field are not part of a
	// player page; the crumbs and the back button are the way out, and the
	// stage gets the room the search band would have taken.
	panel.hidden = true;
	searchForm.hidden = true;
	searchHint.hidden = true;
	railSearch.hidden = true;
	const pageTitle = document.querySelector('#heading');
	pageTitle.textContent = fileName;
	pageTitle.title = fileName;
	document.title = fileName + ' · ' + name;

	let file = null;
	try {
		const response = await post(path);
		file = await response.json();
	} catch {}
	if (!file) file = { name: fileName };
	// Opening the player is the same "recent" event as opening a preview.
	recordRecent(file, path);

	const player = create('section', 'player' + (isVideo ? '' : ' is-audio'));
	player.setAttribute('aria-label', 'Media player');

	const head = create('header', 'player-head');
	const back = create('button', 'icon-btn player-back');
	back.type = 'button';
	back.title = 'Back to the folder';
	back.setAttribute('aria-label', 'Back to the folder');
	back.append(icon('back'));
	const titleBox = create('div', 'player-title');
	const title = create('h2', 'player-name', file.name || fileName);
	title.title = file.name || fileName;
	const meta = create('p', 'player-meta', [
		kind.label,
		file.size !== undefined ? formatSize(file.size) : null,
		file.modifiedTime ? modified(file) : null
	].filter(Boolean).join(' · '));
	titleBox.append(title, meta);
	const headActions = create('div', 'player-head-actions');
	const copy = create('button', 'icon-btn');
	copy.type = 'button';
	copy.title = 'Copy direct URL';
	copy.setAttribute('aria-label', 'Copy direct URL');
	copy.append(icon('link'));
	const download = create('a', 'icon-btn');
	download.title = 'Download';
	download.setAttribute('aria-label', 'Download');
	download.href = path;
	download.download = file.name || fileName;
	download.append(icon('download'));
	headActions.append(copy, download);
	head.append(back, titleBox, headActions);

	const stage = create('div', 'player-stage');
	const media = create(isVideo ? 'video' : 'audio', 'player-media');
	if (isVideo) media.playsInline = true;
	media.preload = 'metadata';
	const subsBox = create('div', 'player-subs');
	subsBox.setAttribute('aria-live', 'polite');
	const status = create('p', 'player-status');
	status.setAttribute('role', 'status');
	const bigPlay = create('button', 'player-big');
	bigPlay.type = 'button';
	bigPlay.title = 'Play';
	bigPlay.setAttribute('aria-label', 'Play');
	bigPlay.append(icon('play'));
	const failed = create('div', 'player-failed');
	failed.hidden = true;

	const controls = create('div', 'player-controls');
	const bar = create('div', 'player-bar');
	const toggle = create('button', 'player-btn player-toggle');
	toggle.type = 'button';
	toggle.title = 'Play';
	toggle.setAttribute('aria-label', 'Play');
	toggle.append(icon('play'));
	const playPause = () => {
		if (media.paused) media.play().catch(() => {});
		else media.pause();
	};
	toggle.addEventListener('click', playPause);

	const currentTime = create('span', 'player-time', '0:00');
	const seek = create('div', 'player-seek');
	seek.setAttribute('role', 'slider');
	seek.setAttribute('aria-label', 'Seek');
	seek.tabIndex = 0;
	const track = create('div', 'seek-track');
	const buffered = create('div', 'seek-buffered');
	const played = create('div', 'seek-played');
	const thumb = create('div', 'seek-thumb');
	track.append(buffered, played, thumb);
	seek.append(track);
	const duration = create('span', 'player-time player-duration', '0:00');

	const volume = create('div', 'player-volume');
	const mute = create('button', 'player-btn player-mute');
	mute.type = 'button';
	mute.title = 'Mute';
	mute.setAttribute('aria-label', 'Mute');
	mute.append(icon('volume'));
	const volumeRange = create('input', 'player-volume-range');
	volumeRange.type = 'range';
	volumeRange.min = '0';
	volumeRange.max = '1';
	volumeRange.step = '0.05';
	volumeRange.value = '1';
	volumeRange.setAttribute('aria-label', 'Volume');
	volume.append(mute, volumeRange);

	const speed = create('button', 'player-btn player-speed');
	speed.type = 'button';
	speed.title = 'Playback speed';
	speed.setAttribute('aria-label', 'Playback speed');
	speed.textContent = '1×';

	const cc = create('button', 'player-btn player-cc');
	cc.type = 'button';
	cc.title = 'Subtitles';
	cc.setAttribute('aria-label', 'Subtitles');
	cc.append(icon('subtitles'));

	const audioButton = create('button', 'player-btn player-audio-btn');
	audioButton.type = 'button';
	audioButton.title = 'Audio track';
	audioButton.setAttribute('aria-label', 'Audio track');
	audioButton.append(icon('volume'));

	const pip = create('button', 'player-btn player-pip');
	pip.type = 'button';
	pip.title = 'Picture in picture';
	pip.setAttribute('aria-label', 'Picture in picture');
	pip.append(icon('pip'));

	const full = create('button', 'player-btn player-full');
	full.type = 'button';
	full.title = 'Fullscreen';
	full.setAttribute('aria-label', 'Fullscreen');
	full.append(icon('fullscreen'));

	bar.append(toggle, currentTime, seek, duration, volume, speed, cc, audioButton, pip, full);
	controls.append(bar);
	stage.append(media, subsBox, status, bigPlay, failed, controls);
	if (!isVideo) {
		const card = create('div', 'player-audio-card');
		const glyph = icon('audio');
		card.append(glyph, create('p', 'player-audio-name', file.name || fileName));
		stage.append(card);
		cc.hidden = true;
	}

	const note = create('p', 'player-note');
	note.setAttribute('role', 'status');
	let noteTimer = null;
	function setNote(message) {
		note.textContent = message || '';
		note.hidden = !message;
		if (noteTimer) clearTimeout(noteTimer);
		if (message) noteTimer = setTimeout(() => {
			note.hidden = true;
			note.textContent = '';
		}, 3500);
	}
	player.append(head, stage, note);

	const firstSection = document.querySelector('#main .pagehead');
	firstSection.after(player);

	function leavePlayer() {
		savePosition();
		const fallback = setTimeout(() => location.assign(parentPath() || root), 400);
		window.addEventListener('pagehide', () => clearTimeout(fallback), { once: true });
		history.back();
	}
	back.addEventListener('click', leavePlayer);
	pushLayer(leavePlayer);
	copy.onclick = () => copyDirectUrl(path, file.name || fileName);

	/* --- state --- */

	const subtitleTracks = [];
	let activeSubtitle = null;
	let subtitleOffset = 0;

	/* --- subtitle tracks --- */

	function collectNativeSubtitles() {
		// Some browsers surface container-embedded text tracks; they are
		// rendered by the media element itself instead of the overlay.
		const list = media.textTracks;
		if (!list) return 0;
		let added = 0;
		for (let i = 0; i < list.length; i++) {
			const native = list[i];
			if (native.kind !== 'subtitles' && native.kind !== 'captions') continue;
			const id = 'native:' + i;
			if (subtitleTracks.some(item => item.id === id)) continue;
			const label = native.label || native.language || 'Track ' + (i + 1);
			subtitleTracks.push({ id, label, source: 'native', native });
			added++;
		}
		return added;
	}

	async function discoverSubtitles() {
		try {
			const response = await post(parentPath());
			const listing = await response.json();
			const stem = fileStem(file.name || fileName);
			const found = (listing?.data?.files || []).filter(entry => {
				const ext = fileExt(entry.name || '');
				return SUBTITLE_EXTS.includes(ext)
					&& (entry.name === stem + '.' + ext || (entry.name || '').startsWith(stem + '.'));
			});
			for (const entry of found) {
				subtitleTracks.push({
					id: 'sidecar:' + entry.name,
					label: subtitleLabel(entry.name, stem),
					source: 'sidecar',
					path: parentPath() + encodeURIComponent(entry.name),
					format: fileExt(entry.name)
				});
			}
			// A lone sidecar carrying the video's own name is what local
			// players load automatically; tagged tracks wait for a choice.
			const sidecars = subtitleTracks.filter(item => item.source === 'sidecar');
			if (sidecars.length === 1 && sidecars[0].id === 'sidecar:' + stem + '.' + sidecars[0].format) {
				selectSubtitle(sidecars[0].id);
			}
		} catch {
			// No folder listing, no sidecar subtitles; the menu still works.
		}
	}

	async function loadSidecarCues(track) {
		if (track.cues || track.cues === null) return track.cues;
		const response = await fetch(track.path);
		if (!response.ok) throw new Error('Could not load ' + track.label + '.');
		const text = await response.text();
		track.cues = track.format === 'ass' || track.format === 'ssa'
			? parseAss(text)
			: parseSrtOrVtt(text);
		return track.cues;
	}

	async function selectSubtitle(id) {
		activeSubtitle = id || null;
		cc.classList.toggle('is-on', Boolean(activeSubtitle));
		const track = subtitleTracks.find(item => item.id === activeSubtitle);
		// Native tracks switch modes; only one shows at a time.
		for (const item of subtitleTracks) {
			if (item.native) item.native.mode = (item.id === activeSubtitle) ? 'showing' : 'disabled';
		}
		if (!track || track.source !== 'sidecar') {
			subsBox.replaceChildren();
			return;
		}
		try {
			const cues = await loadSidecarCues(track);
			if (activeSubtitle !== track.id) return;
			if (!cues.length) setNote(track.label + ' has no readable cues.');
			renderSubtitles();
		} catch (error) {
			activeSubtitle = null;
			cc.classList.remove('is-on');
			setNote(error.message || 'The subtitle file could not be read.');
		}
	}

	function renderSubtitles() {
		const track = subtitleTracks.find(item => item.id === activeSubtitle);
		if (!track || track.source !== 'sidecar' || !track.cues) {
			if (!track || track.source !== 'sidecar') subsBox.replaceChildren();
			return;
		}
		const time = media.currentTime - subtitleOffset;
		const cue = track.cues.find(item => time >= item.start && time <= item.end);
		if (!cue) {
			subsBox.replaceChildren();
			return;
		}
		if (subsBox.dataset.cue === cue.text) return;
		subsBox.dataset.cue = cue.text;
		subsBox.replaceChildren(...cue.text.split('\n').map(line => create('span', '', line)));
	}

	function cycleSubtitle() {
		const order = [null, ...subtitleTracks.map(item => item.id)];
		const index = order.indexOf(activeSubtitle);
		const next = order[(index + 1) % order.length];
		selectSubtitle(next);
		setNote(next
			? 'Subtitles: ' + subtitleTracks.find(item => item.id === next).label
			: 'Subtitles off.');
	}

	/* --- audio tracks --- */

	function audioMenuItems() {
		const items = [{ heading: 'Audio track' }];
		const list = media.audioTracks;
		if (list && list.length) {
			for (let i = 0; i < list.length; i++) {
				const track = list[i];
				items.push({
					label: track.label || track.language || 'Track ' + (i + 1),
					icon: track.enabled ? 'check' : null,
					onPick: () => {
						// AudioTrackList allows several enabled tracks; one at a
						// time is what a listener can follow.
						for (let j = 0; j < list.length; j++) list[j].enabled = (j === i);
						setNote('Audio: ' + (track.label || track.language || 'Track ' + (i + 1)));
					}
				});
			}
			return items;
		}
		items.push(
			{ label: 'Default track', icon: 'check', disabled: true },
			{ label: 'This file exposes one audio track in this browser', disabled: true }
		);
		return items;
	}

	/* --- menus --- */

	function speedMenuItems() {
		return [{ heading: 'Playback speed' },
			...PLAYER_SPEEDS.map(value => ({
				label: value === 1 ? 'Normal' : value + '×',
				icon: media.playbackRate === value ? 'check' : null,
				onPick: () => {
					media.playbackRate = value;
					speed.textContent = value === 1 ? '1×' : value + '×';
				}
			}))];
	}

	function subtitleMenuItems() {
		const items = [{ label: 'Off', icon: activeSubtitle ? null : 'check', onPick: () => selectSubtitle(null) }];
		for (const track of subtitleTracks) {
			items.push({
				label: track.label + (track.source === 'sidecar' ? ' · ' + track.format.toUpperCase() : ''),
				icon: activeSubtitle === track.id ? 'check' : null,
				onPick: () => selectSubtitle(track.id)
			});
		}
		if (!subtitleTracks.length) {
			items.push({ label: 'No subtitle files found next to this video', disabled: true });
		}
		items.push(
			{ sep: true, heading: 'Sync' },
			{
				label: 'Show earlier by 0.5s',
				onPick: () => {
					subtitleOffset -= 0.5;
					setNote('Subtitle sync: ' + (subtitleOffset > 0 ? '+' : '') + subtitleOffset + 's');
					renderSubtitles();
				}
			},
			{
				label: 'Show later by 0.5s',
				onPick: () => {
					subtitleOffset += 0.5;
					setNote('Subtitle sync: ' + (subtitleOffset > 0 ? '+' : '') + subtitleOffset + 's');
					renderSubtitles();
				}
			},
			{ label: 'Offset: ' + (subtitleOffset > 0 ? '+' : '') + subtitleOffset + 's', disabled: true }
		);
		return items;
	}

	cc.addEventListener('click', () => showMenu(cc, subtitleMenuItems()));
	audioButton.addEventListener('click', () => showMenu(audioButton, audioMenuItems()));
	speed.addEventListener('click', () => showMenu(speed, speedMenuItems()));

	/* --- transport --- */

	function mediaError() {
		const code = media.error ? media.error.code : 0;
		const cause = code === 4 ? 'its codec' : 'a network or decode error';
		failed.replaceChildren(
			create('p', '', 'This browser cannot play this file — ' + cause + ' is not supported here.'),
			create('p', '', 'Download it and open it in a local player, or try a Chromium-based browser.')
		);
		failed.hidden = false;
		controls.hidden = true;
		bigPlay.hidden = true;
		savePosition();
	}

	function renderTime() {
		currentTime.textContent = formatClock(media.currentTime);
		if (Number.isFinite(media.duration)) duration.textContent = formatClock(media.duration);
		if (Number.isFinite(media.duration) && !seeking) {
			const progress = media.currentTime / media.duration;
			played.style.width = (progress * 100) + '%';
			thumb.style.left = (progress * 100) + '%';
			seek.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
		}
	}

	function renderBuffered() {
		if (!Number.isFinite(media.duration) || !media.buffered.length) return;
		const end = media.buffered.end(media.buffered.length - 1);
		buffered.style.width = Math.min(100, end / media.duration * 100) + '%';
	}

	let seeking = false;
	function seekToRatio(clientX) {
		const rect = seek.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		if (Number.isFinite(media.duration)) media.currentTime = ratio * media.duration;
	}
	seek.addEventListener('pointerdown', event => {
		if (!Number.isFinite(media.duration)) return;
		seeking = true;
		seek.setPointerCapture(event.pointerId);
		seekToRatio(event.clientX);
	});
	seek.addEventListener('pointermove', event => {
		if (seeking) seekToRatio(event.clientX);
	});
	const stopSeek = () => { seeking = false; };
	seek.addEventListener('pointerup', stopSeek);
	seek.addEventListener('pointercancel', stopSeek);

	function setVolumeIcon() {
		mute.replaceChildren(icon(media.muted || media.volume === 0 ? 'mute' : 'volume'));
		mute.title = media.muted ? 'Unmute' : 'Mute';
	}
	mute.addEventListener('click', () => {
		media.muted = !media.muted;
		if (!media.muted && media.volume === 0) media.volume = 0.5;
		volumeRange.value = media.muted ? 0 : media.volume;
		setVolumeIcon();
	});
	volumeRange.addEventListener('input', () => {
		media.volume = Number(volumeRange.value);
		media.muted = media.volume === 0;
		setVolumeIcon();
	});
	setVolumeIcon();

	/* --- position memory --- */

	function savedPosition() {
		try {
			const value = Number(localStorage.getItem(PLAYER_POS_KEY + path));
			return Number.isFinite(value) && value > 15 ? value : 0;
		} catch {
			return 0;
		}
	}

	function savePosition() {
		try {
			if (!Number.isFinite(media.duration)
				|| media.currentTime < 15
				|| media.currentTime > media.duration - 10
				|| media.ended) {
				localStorage.removeItem(PLAYER_POS_KEY + path);
			} else {
				localStorage.setItem(PLAYER_POS_KEY + path, String(Math.floor(media.currentTime)));
			}
		} catch {}
	}

	let resume = null;
	function offerResume(at) {
		hideResume();
		resume = create('div', 'player-resume');
		resume.append(create('span', '', 'Resume at ' + formatClock(at) + '?'));
		const resumeButton = create('button', 'button button-primary', 'Resume');
		resumeButton.type = 'button';
		resumeButton.addEventListener('click', () => {
			media.currentTime = at;
			hideResume();
			media.play().catch(() => {});
		});
		const startOver = create('button', 'button button-secondary', 'Start over');
		startOver.type = 'button';
		startOver.addEventListener('click', () => {
			media.currentTime = 0;
			hideResume();
		});
		resume.append(resumeButton, startOver);
		controls.before(resume);
		setTimeout(hideResume, 8000);
	}
	function hideResume() {
		if (resume) {
			resume.remove();
			resume = null;
		}
	}

	/* --- events --- */

	media.addEventListener('error', mediaError);
	media.addEventListener('loadedmetadata', () => {
		renderTime();
		renderBuffered();
		const at = savedPosition();
		if (at && at < media.duration - 10) offerResume(at);
	});
	media.addEventListener('timeupdate', renderTime);
	// A seek (or a pause) redraws captions too: the frame loop only runs
	// while playing, and a paused frame must still show its cue.
	media.addEventListener('seeked', renderSubtitles);
	media.addEventListener('timeupdate', renderSubtitles);
	media.addEventListener('progress', renderBuffered);
	media.addEventListener('waiting', () => { status.textContent = 'Buffering…'; });
	media.addEventListener('playing', () => { status.textContent = ''; });
	media.addEventListener('ended', () => {
		bigPlay.hidden = !isVideo;
		toggle.replaceChildren(icon('play'));
		toggle.title = 'Play';
	});
	media.addEventListener('play', () => {
		bigPlay.hidden = true;
		toggle.replaceChildren(icon('pause'));
		toggle.title = 'Pause';
		scheduleIdle();
	});
	media.addEventListener('pause', () => {
		bigPlay.hidden = !isVideo;
		toggle.replaceChildren(icon('play'));
		toggle.title = 'Play';
		wakeControls();
	});
	media.addEventListener('volumechange', () => {
		volumeRange.value = media.muted ? 0 : media.volume;
		setVolumeIcon();
	});

	media.src = path + '?inline=true';

	bigPlay.addEventListener('click', () => media.play().catch(() => {}));
	if (isVideo) media.addEventListener('click', playPause);

	// The overlay redraws on the frame clock while playing; timeupdate alone
	// fires too rarely to switch cues on time.
	let running = false;
	function frame() {
		renderSubtitles();
		if (!media.paused && !media.ended) requestAnimationFrame(frame);
		else running = false;
	}
	media.addEventListener('play', () => {
		if (!running) {
			running = true;
			requestAnimationFrame(frame);
		}
	});

	/* --- idle auto-hide (video) --- */

	let idleTimer = null;
	function wakeControls() {
		if (idleTimer) clearTimeout(idleTimer);
		player.classList.remove('is-idle');
		if (isVideo && !media.paused) scheduleIdle();
	}
	function scheduleIdle() {
		if (!isVideo) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (!media.paused && !document.querySelector('.popover')) player.classList.add('is-idle');
		}, 2600);
	}
	const wake = () => wakeControls();
	stage.addEventListener('pointermove', wake);
	stage.addEventListener('pointerdown', wake);
	document.addEventListener('fullscreenchange', wakeControls);

	/* --- PiP and fullscreen --- */

	if (!isVideo || !document.pictureInPictureEnabled) pip.hidden = true;
	pip.addEventListener('click', () => {
		if (document.pictureInPictureElement) document.exitPictureInPicture();
		else media.requestPictureInPicture().catch(() => {
			setNote('Picture in picture is unavailable for this file.');
		});
	});
	if (!isVideo || !document.documentElement.requestFullscreen) full.hidden = true;
	full.addEventListener('click', () => {
		if (document.fullscreenElement) document.exitFullscreen();
		else stage.requestFullscreen().catch(() => {
			setNote('Fullscreen is unavailable here.');
		});
	});
	document.addEventListener('fullscreenchange', () => {
		full.replaceChildren(icon(document.fullscreenElement ? 'collapse' : 'fullscreen'));
		full.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
	});

	/* --- keyboard --- */

	function isTyping(target) {
		return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
			|| target instanceof HTMLSelectElement;
	}
	window.addEventListener('keydown', event => {
		if (event.defaultPrevented || isTyping(event.target) || document.querySelector('.popover')) return;
		const key = event.key.toLowerCase();
		let handled = true;
		switch (true) {
			case event.key === ' ' || key === 'k': playPause(); break;
			case event.key === 'ArrowLeft' || key === 'j': media.currentTime = Math.max(0, media.currentTime - 10); break;
			case event.key === 'ArrowRight' || key === 'l': media.currentTime = Math.min(media.duration || 0, media.currentTime + 10); break;
			case event.key === 'ArrowUp': media.volume = Math.min(1, media.volume + 0.1); media.muted = false; break;
			case event.key === 'ArrowDown': media.volume = Math.max(0, media.volume - 0.1); break;
			case key === 'm': media.muted = !media.muted; break;
			case key === 'f': if (!full.hidden) full.click(); break;
			case key === 'p': if (!pip.hidden) pip.click(); break;
			case key === 'c': cycleSubtitle(); break;
			case /^[0-9]$/.test(key): {
				if (!Number.isFinite(media.duration)) break;
				media.currentTime = media.duration * Number(key) / 10;
				break;
			}
			case event.key === 'Home': media.currentTime = 0; break;
			case event.key === 'End': if (Number.isFinite(media.duration)) media.currentTime = media.duration; break;
			default: handled = false;
		}
		if (handled) {
			event.preventDefault();
			wakeControls();
		}
	});
	window.addEventListener('pagehide', savePosition);

	/* --- boot --- */

	collectNativeSubtitles();
	if (media.textTracks) media.textTracks.addEventListener('addtrack', collectNativeSubtitles);
	discoverSubtitles();
}

if (isSearch || isFolder) {
	panel.querySelector('.panel-title').textContent = isSearch ? 'Matching files' : 'Files and folders';
	// The rail marks the section the page belongs to.
	if (isFolder && !isSearch) document.querySelector('.rail-home').classList.add('is-active');
	if (isFolder && !isSearch) {
		downloadFilesButton.hidden = false;
		saveLinksButton.href = path + '?download=links';
		saveLinksButton.hidden = false;
		downloadFilesButton.addEventListener('click', downloadFolderFiles);
		newButton.hidden = !isAdmin;
		if (isAdmin) {
			setupDropZone();
			loadStorage(false);
			// The rail's cloud icon folds the storage band away and back.
			railStorage.hidden = false;
			railStorage.addEventListener('click', () => {
				storageSection.hidden = !storageSection.hidden;
			});
		}
	}
	loadButton.addEventListener('click', loadPage);
	folderPassword.addEventListener('submit', event => {
		event.preventDefault();
		password = folderPassword.elements.password.value;
		loadPage();
	});
	loadPage();
} else {
	// Video and audio have a page of their own; anything else keeps the
	// preview dialog. Old ?a=view links to media forward to the player.
	const kind = kindFromName(nameFromPath(path));
	if (kind.type === 'video' || kind.type === 'audio') {
		if (new URLSearchParams(location.search).get('a') === 'player') playerPage();
		else location.replace(path + '?a=player');
	} else {
		previewFile();
	}
}


