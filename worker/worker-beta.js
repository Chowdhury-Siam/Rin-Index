/**
* A Script Redesigned by Parveen Bhadoo from GOIndex at https://github.com/ParveenBhadooOfficial/Bhadoo-Drive-Index
*/
import { folderMimeType, readSettings, refreshGoogleToken } from './settings.mjs';
import { folderArchive } from './folder-archive.mjs';

const driveOptions = {
	/**
	 * The number displayed on each page of the file list page. [Recommended setting value is between 100 and 1000];
	 * If the setting is greater than 1000, it will cause an error when requesting drive api;
	 * If the set value is too small, it will cause the incremental loading (page loading) of the scroll bar of the file list page to fail;
	 * Another effect of this value is that if the number of files in the directory is greater than this setting value (that is, multiple pages need to be displayed), the results of the first listing directory will be cached.
	 */
	"files_list_page_size": 50,
	/**
	 * The number displayed on each page of the search results page. [Recommended setting value is between 50 and 1000];
	 * If the setting is greater than 1000, it will cause an error when requesting drive api;
	 * If the set value is too small, it will cause the incremental loading (page loading) of the scroll bar of the search results page to fail;
	 * The size of this value affects the response speed of the search operation.
	 */
	"search_result_list_page_size": 50,
	// Confirm that cors can be opened
	"enable_cors_file_down": false,
	/**
	 * The basic auth above already contains the function of global protection in the disk. So by default, the password in the .password file is no longer authenticated;
	 * If you still need to verify the password in the .password file for certain directories based on global authentication, set this option to true;
	 * [Note] If the password verification of the .password file is turned on, each time the directory is listed, the overhead of querying the directory for the existence of the .password file is additionally added.
	 */
	"enable_password_file_verify": false
};


/**
 * global functions
 */
const FUNCS = {
	/**
	 * Transform into relatively safe search keywords for Google search morphology
	 */
	formatSearchKeyword: function (keyword) {
		let nothing = "";
		let space = " ";
		if (!keyword) return nothing;
		return keyword.replace(/(!=)|['"=<>/\\:]/g, nothing)
			.replace(/[,，|(){}]/g, space)
			.trim()
	}

};

/**
 * global consts
 * @type {{folder_mime_type: string, default_file_fields: string, gd_root_type: {share_drive: number, user_drive: number, sub_folder: number}}}
 */
const CONSTS = new(class {
	default_file_fields = 'parents,id,name,mimeType,modifiedTime,createdTime,fileExtension,size,trashed,capabilities(canDownload)';
	gd_root_type = {
		user_drive: 0,
		share_drive: 1,
		sub_folder: 2
	};
	folder_mime_type = folderMimeType;
})();


let authConfig;
let gds;

function configure(env) {
	const settings = readSettings(env);
	authConfig = {
		...driveOptions,
		settings,
		roots: [{
			id: settings.DRIVE_ROOT_ID,
			name: settings.SITE_NAME,
			user: settings.INDEX_USERNAME,
			pass: settings.INDEX_PASSWORD,
			protect_file_link: settings.PROTECT_FILE_LINK === 'true'
		}]
	};
	gds = authConfig.roots.map((root, index) => new googleDrive(authConfig, index));
}

function scriptJson(value) {
	return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function driveQueryValue(value) {
	return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function html(order, model) {
	const name = authConfig.roots[order].name;
	const title = name === 'Rin Index' ? name : name + ' · Rin Index';
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="theme-color" content="#0b120f">
	<meta name="robots" content="noindex">
	<title>${title.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</title>
	<link rel="icon" href="/assets/rin-mark.png" type="image/png">
	<link rel="stylesheet" href="/assets/css/rin-index.css">
	<script>window.RIN_INDEX = ${scriptJson({ order, name, model })};</script>
	<script src="/assets/vendor/markdown-it.min.js" defer></script>
	<script type="module" src="/assets/js/app.js"></script>
</head>
<body><noscript>Enable JavaScript to browse Rin Index.</noscript></body>
</html>`;
}

export default {
	async fetch(request, env) {
		try {
			if (!gds) configure(env);
		} catch (error) {
			console.error(error.message);
			return new Response('Drive index configuration is incomplete.', { status: 503 });
		}
		try {
			const response = await handleRequest(request);
			response.headers.set('Cache-Control', 'private, no-store');
			response.headers.set('X-Content-Type-Options', 'nosniff');
			return response;
		} catch (error) {
			console.error(error.message);
			return new Response('Could not load the Drive index.', { status: 502 });
		}
	}
};

/**
 * Fetch and log a request
 * @param {Request} request
 */
async function handleRequest(request) {
	// From path extract from drive order
	// 并根据 drive order 获取对应的 gd instance
	let gd;
	let url = new URL(request.url);
	let path = url.pathname;

	/**
	 * Redirect to start page
	 * @returns {Response}
	 */
	function redirectToIndexPage() {
		return new Response('', {
			status: 301,
			headers: {
				'Location': `${url.origin}/0:/`
			}
		});
	}

	if (path == '/') return redirectToIndexPage();
	if (path === '/_rin-folder.zip') return new Response('Open the folder and try Download folder again.', { status: 503 });
	if (path.toLowerCase() == '/favicon.ico') {
		// You can find a favicon later
		return new Response('', {
			status: 404
		})
	}

	// Special command format
	const command_reg = /^\/(?<num>\d+):(?<command>[a-zA-Z0-9]+)$/g;
	const match = command_reg.exec(path);
	if (match) {
		const num = match.groups.num;
		const order = Number(num);
		if (order >= 0 && order < gds.length) {
			gd = gds[order];
		} else {
			return redirectToIndexPage()
		}
		// basic auth
		const denied = gd.basicAuthResponse(request);
		if (denied) return denied;
		await gd.initRootType();
		const command = match.groups.command;
		// search for
		if (command === 'search') {
			if (request.method === 'POST') {
				// search results
				return handleSearch(request, gd);
			} else {
				const params = url.searchParams;
				// Search page
				return new Response(html(gd.order, {
					q: params.get("q") || '',
					is_search_page: true,
					root_type: gd.root_type
				}), {
					status: 200,
					headers: {
						'Content-Type': 'text/html; charset=utf-8'
					}
				});
			}
		} else if (command === 'id2path' && request.method === 'POST') {
			return handleId2Path(request, gd)
		}
	}

	// Desired path format
	const common_reg = /^\/\d+:\/.*$/g;
	try {
		if (!path.match(common_reg)) {
			return redirectToIndexPage();
		}
		let split = path.split("/");
		let order = Number(split[1].slice(0, -1));
		if (order >= 0 && order < gds.length) {
			gd = gds[order];
		} else {
			return redirectToIndexPage()
		}
	} catch (e) {
		return redirectToIndexPage()
	}

	path = path.replace(gd.url_path_prefix, '') || '/';
	const servesIndex = request.method === 'POST' || path.endsWith('/') || url.searchParams.has('a');
	if (servesIndex || gd.root.protect_file_link) {
		const denied = gd.basicAuthResponse(request);
		if (denied) return denied;
	}

	const fileName = decodeURIComponent(path.split('/').pop());
	if (fileName.toLowerCase() === '.password') {
		return new Response('Not found', { status: 404 });
	}

	await gd.initRootType();
	if (request.method === 'POST' && path.endsWith('/') && url.searchParams.get('archive') === '1') {
		if (authConfig.enable_password_file_verify) return new Response('Folder ZIP downloads are unavailable with per-folder passwords.', { status: 403 });
		return folderArchive(request, gd, path);
	}
	if (request.method === 'POST') return apiRequest(request, gd);
	if (servesIndex) {
		return new Response(html(gd.order, { root_type: gd.root_type }), {
			headers: { 'Content-Type': 'text/html; charset=utf-8' }
		});
	}

	const file = await gd.file(path);
	if (!file) return new Response('Not found', { status: 404 });
	return gd.down(file, request.headers.get('Range'), url.searchParams.get('inline') === 'true');
}


async function apiRequest(request, gd) {
	let url = new URL(request.url);
	let path = url.pathname;
	path = path.replace(gd.url_path_prefix, '') || '/';

	let option = {
		status: 200,
		headers: {
			'Access-Control-Allow-Origin': '*'
		}
	}

	if (path.substr(-1) == '/') {
		let form = await request.formData();
		// This can increase the speed when listing directories for the first time. The disadvantage is that if the password verification fails, the overhead of listing directories will still be incurred
		let deferred_list_result = gd.list(path, form.get('page_token'), Number(form.get('page_index')));

		// check .password file, if `enable_password_file_verify` is true
		if (authConfig['enable_password_file_verify']) {
			let password = await gd.password(path);
			// console.log("dir password", password);
			if (password && password.replace("\n", "") !== form.get('password')) {
				let html = `{"error": {"code": 401,"message": "password error."}}`;
				return new Response(html, option);
			}
		}

		let list_result = await deferred_list_result;
		return new Response(JSON.stringify(list_result), option);
	} else {
		let file = await gd.file(path);
		if (!file) return new Response('Not found', { status: 404 });
		return new Response(JSON.stringify(file));
	}
}

// deal with search
async function handleSearch(request, gd) {
	const option = {
		status: 200,
		headers: {
			'Access-Control-Allow-Origin': '*'
		}
	};
	let form = await request.formData();
	let search_result = await
	gd.search(form.get('q') || '', form.get('page_token'), Number(form.get('page_index')));
	return new Response(JSON.stringify(search_result), option);
}

/**
 * deal with id2path
 * @param request Id parameter required
 * @param gd
 * @returns {Promise<Response>} [Note] If the item represented by the id received from the front desk is not under the target gd disk, then the response will be returned to the front desk with an empty string ""
 */
async function handleId2Path(request, gd) {
	const option = {
		status: 200,
		headers: {
			'Access-Control-Allow-Origin': '*'
		}
	};
	let form = await request.formData();
	const id = form.get('id');
	if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) {
		return new Response('Invalid file ID', { status: 400 });
	}
	const path = await gd.findPathById(id);
	return new Response(path || '', option);
}

class googleDrive {
	constructor(authConfig, order) {
		// Each disk corresponds to an order, corresponding to a gd instance
		this.order = order;
		this.root = authConfig.roots[order];
		this.url_path_prefix = `/${order}:`;
		this.authConfig = authConfig;
		// TODO: The invalid refresh strategy of these caches can be formulated later
		// path id
		this.paths = [];
		// path file
		this.files = [];
		// path pass
		this.passwords = [];
		// id <-> path
		this.id_path_cache = Object.create(null);
		this.id_path_cache[this.root['id']] = '/';
		this.paths["/"] = this.root['id'];
		/*if (this.root['pass'] != "") {
		  this.passwords['/'] = this.root['pass'];
		}*/
		// this.init();
	}

	/**
	 * Get the root directory type, set to root_type
	 * @returns {Promise<void>}
	 */
	async initRootType() {
		if (this.root_type !== undefined) return;
		if (!authConfig.user_drive_real_root_id) {
			const root = await this.findItemById('root');
			if (!root.id) throw new Error('Google Drive could not resolve My Drive.');
			authConfig.user_drive_real_root_id = root.id;
		}
		const root_id = this.root['id'];
		const types = CONSTS.gd_root_type;
		if (root_id === 'root' || root_id === authConfig.user_drive_real_root_id) {
			this.root_type = types.user_drive;
		} else {
			const obj = await this.getShareDriveObjById(root_id);
			this.root_type = obj ? types.share_drive : types.sub_folder;
		}
	}

	/**
	 * Returns a response that requires authorization, or null
	 * @param request
	 * @returns {Response|null}
	 */
	basicAuthResponse(request) {
		if (authConfig.settings.INDEX_PUBLIC === 'true') return null;

		const { user, pass } = this.root;
		const match = /^Basic +([A-Za-z0-9+/=]+)$/i.exec(request.headers.get('Authorization') || '');
		if (match) {
			try {
				const bytes = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0));
				if (new TextDecoder().decode(bytes) === `${user}:${pass}`) return null;
			} catch {}
		}
		return new Response('Unauthorized', {
			headers: { 'WWW-Authenticate': 'Basic realm="Drive Index", charset="UTF-8"' },
			status: 401
		});
	}

	async down(file, range, inline, signal) {
		const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
		const options = await this.requestOption(range ? { Range: range } : {});
		const upstream = await fetch(url, { ...options, signal });
		const response = new Response(upstream.body, upstream);
		const { headers } = response;
		if (this.authConfig.enable_cors_file_down) headers.append('Access-Control-Allow-Origin', '*');
		const mimeType = headers.get('Content-Type')?.split(';')[0].toLowerCase() || '';
		const canPreview = /^(audio\/|video\/|image\/(png|jpeg|gif|bmp|webp|avif)$|application\/pdf$)/.test(mimeType);
		const showInline = inline && canPreview;
		const filename = encodeURIComponent(file.name).replace(/[!'()*]/g, char =>
			'%' + char.charCodeAt(0).toString(16).toUpperCase()
		);
		headers.set('Content-Disposition', `${showInline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`);
		if (!showInline) headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
		return response;
	}

	async file(path) {
		if (typeof this.files[path] == 'undefined') {
			this.files[path] = await this._file(path);
		}
		return this.files[path];
	}

	async _file(path) {
		let arr = path.split('/');
		let name = arr.pop();
		name = driveQueryValue(decodeURIComponent(name));
		let dir = arr.join('/') + '/';
		// console.log(name, dir);
		let parent = await this.findPathId(dir);
		if (!parent) return undefined;
		// console.log(parent);
		let url = 'https://www.googleapis.com/drive/v3/files';
		let params = {
			'includeItemsFromAllDrives': true,
			'supportsAllDrives': true
		};
		params.q = `'${parent}' in parents and name = '${name}' and trashed = false`;
		params.fields = "files(id, name, mimeType, size ,createdTime, modifiedTime, iconLink, thumbnailLink)";
		url += '?' + this.enQuery(params);
		let requestOption = await this.requestOption();
		let response = await fetch(url, requestOption);
		let obj = await response.json();
		// console.log(obj);
		if (!response.ok) throw new Error(`Drive file lookup failed (HTTP ${response.status}).`);
		return obj.files[0];
	}

	// Cache through reqeust cache
	async list(path, page_token = null, page_index = 0) {
		if (this.path_children_cache == undefined) {
			// { <path> :[ {nextPageToken:'',data:{}}, {nextPageToken:'',data:{}} ...], ...}
			this.path_children_cache = {};
		}

		if (this.path_children_cache[path] &&
			this.path_children_cache[path][page_index] &&
			this.path_children_cache[path][page_index].data
		) {
			let child_obj = this.path_children_cache[path][page_index];
			return {
				nextPageToken: child_obj.nextPageToken || null,
				curPageIndex: page_index,
				data: child_obj.data
			};
		}

		let id = await this.findPathId(path);
		if (!id) return { nextPageToken: null, curPageIndex: page_index, data: { files: [] } };
		let result = await this._ls(id, page_token, page_index);
		let data = result.data;
		// Cache multiple pages
		if (result.nextPageToken && data.files) {
			if (!Array.isArray(this.path_children_cache[path])) {
				this.path_children_cache[path] = []
			}
			this.path_children_cache[path][Number(result.curPageIndex)] = {
				nextPageToken: result.nextPageToken,
				data: data
			};
		}

		return result
	}


	async _ls(parent, page_token = null, page_index = 0) {
		// console.log("_ls", parent);

		if (parent == undefined) {
			return null;
		}
		let obj;
		let params = {
			'includeItemsFromAllDrives': true,
			'supportsAllDrives': true
		};
		params.q = `'${parent}' in parents and trashed = false AND name !='.password'`;
		params.orderBy = 'folder,name,modifiedTime desc';
		params.fields = "nextPageToken, files(id, name, mimeType, size , modifiedTime)";
		params.pageSize = this.authConfig.files_list_page_size;

		if (page_token) {
			params.pageToken = page_token;
		}
		let url = 'https://www.googleapis.com/drive/v3/files';
		url += '?' + this.enQuery(params);
		let requestOption = await this.requestOption();
		let response = await fetch(url, requestOption);
		obj = await response.json();

		return {
			nextPageToken: obj.nextPageToken || null,
			curPageIndex: page_index,
			data: obj
		};

		/*do {
		    if (pageToken) {
		        params.pageToken = pageToken;
		    }
		    let url = 'https://www.googleapis.com/drive/v3/files';
		    url += '?' + this.enQuery(params);
		    let requestOption = await this.requestOption();
		    let response = await fetch(url, requestOption);
		    obj = await response.json();
		    files.push(...obj.files);
		    pageToken = obj.nextPageToken;
		} while (pageToken);*/

	}

	async password(path) {
		if (this.passwords[path] !== undefined) {
			return this.passwords[path];
		}

		// console.log("load", path, ".password", this.passwords[path]);

		let file = await this.file(path + '.password');
		if (file == undefined) {
			this.passwords[path] = null;
		} else {
			let url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
			let requestOption = await this.requestOption();
			let response = await this.fetch200(url, requestOption);
			this.passwords[path] = await response.text();
		}

		return this.passwords[path];
	}


	/**
	 * Get share drive information by id
	 * @param any_id
	 * @returns {Promise<null|{id}|any>} Any abnormal conditions are returned null
	 */
	async getShareDriveObjById(any_id) {
		if (!any_id) return null;
		if ('string' !== typeof any_id) return null;

		let url = `https://www.googleapis.com/drive/v3/drives/${any_id}`;
		let requestOption = await this.requestOption();
		let res = await fetch(url, requestOption);
		if (!res.ok && res.status !== 404 && res.status !== 403) {
			throw new Error(`Shared Drive lookup failed (HTTP ${res.status}).`);
		}
		let obj = await res.json();
		if (obj && obj.id) return obj;

		return null
	}


	/**
	 * search for
	 * @returns {Promise<{data: null, nextPageToken: null, curPageIndex: number}>}
	 */
	async search(origin_keyword, page_token = null, page_index = 0) {
		const types = CONSTS.gd_root_type;
		const is_user_drive = this.root_type === types.user_drive;
		const is_share_drive = this.root_type === types.share_drive;

		const empty_result = {
			nextPageToken: null,
			curPageIndex: page_index,
			data: null
		};

		if (!is_user_drive && !is_share_drive) {
			return empty_result;
		}
		let keyword = FUNCS.formatSearchKeyword(origin_keyword);
		if (!keyword) {
			// The keyword is empty, return
			return empty_result;
		}
		let words = keyword.split(/\s+/);
		let name_search_str = `name contains '${words.join("' AND name contains '")}'`;

		// corpora is a personal drive for user and a team drive for drive. With driveId
		let params = {};
		if (is_user_drive) {
			params.corpora = 'user'
		}
		if (is_share_drive) {
			params.corpora = 'drive';
			params.driveId = this.root.id;
			// This parameter will only be effective until June 1, 2020. Afterwards shared drive items will be included in the results.
			params.includeItemsFromAllDrives = true;
			params.supportsAllDrives = true;
		}
		if (page_token) {
			params.pageToken = page_token;
		}
		params.q = `trashed = false AND name !='.password' AND (${name_search_str})`;
		params.fields = "nextPageToken, files(id, name, mimeType, size , modifiedTime)";
		params.pageSize = this.authConfig.search_result_list_page_size;
		// params.orderBy = 'folder,name,modifiedTime desc';

		let url = 'https://www.googleapis.com/drive/v3/files';
		url += '?' + this.enQuery(params);
		// console.log(params)
		let requestOption = await this.requestOption();
		let response = await fetch(url, requestOption);
		let res_obj = await response.json();

		return {
			nextPageToken: res_obj.nextPageToken || null,
			curPageIndex: page_index,
			data: res_obj
		};
	}


	/**
	 * Get the file object of the upper folder of this file or folder layer by layer. Note: It will be very slow! ! !
	 * Up to find the root directory (root id) of the current gd object
	 * Only consider a single upward chain.
	 * [Note] If the item represented by this id is not under the target gd disk, then this function will return null
	 *
	 * @param child_id
	 * @param contain_myself
	 * @returns {Promise<[]>}
	 */
	async findParentFilesRecursion(child_id, contain_myself = true) {
		const gd = this;
		const gd_root_id = gd.root.id;
		const user_drive_real_root_id = authConfig.user_drive_real_root_id;
		const is_user_drive = gd.root_type === CONSTS.gd_root_type.user_drive;

		// End point query id from bottom to top
		const target_top_id = is_user_drive ? user_drive_real_root_id : gd_root_id;
		const fields = CONSTS.default_file_fields;

		// [{},{},...]
		const parent_files = [];
		let meet_top = false;

		async function addItsFirstParent(file_obj) {
			if (!file_obj) return;
			if (!file_obj.parents) return;
			if (file_obj.parents.length < 1) return;

			// ['','',...]
			let p_ids = file_obj.parents;
			if (p_ids && p_ids.length > 0) {
				// its first parent
				const first_p_id = p_ids[0];
				if (first_p_id === target_top_id) {
					meet_top = true;
					return;
				}
				const p_file_obj = await gd.findItemById(first_p_id);
				if (p_file_obj && p_file_obj.id) {
					parent_files.push(p_file_obj);
					await addItsFirstParent(p_file_obj);
				}
			}
		}

		const child_obj = await gd.findItemById(child_id);
		if (contain_myself) {
			parent_files.push(child_obj);
		}
		await addItsFirstParent(child_obj);

		return meet_top ? parent_files : null
	}

	/**
	 * Get the path relative to the root directory of this disk
	 * @param child_id
	 * @returns {Promise<string>} [Note] If the item represented by this id is not in the target gd disk, then this method will return an empty string ""
	 */
	async findPathById(child_id) {
		if (this.id_path_cache[child_id]) {
			return this.id_path_cache[child_id];
		}

		const p_files = await this.findParentFilesRecursion(child_id);
		if (!p_files || p_files.length < 1) return '';

		let cache = [];
		// Cache the path and id of each level found
		p_files.forEach((value, idx) => {
			const is_folder = idx === 0 ? (p_files[idx].mimeType === CONSTS.folder_mime_type) : true;
			let path = '/' + p_files.slice(idx).map(it => encodeURIComponent(it.name)).reverse().join('/');
			if (is_folder) path += '/';
			cache.push({
				id: p_files[idx].id,
				path: path
			})
		});

		cache.forEach((obj) => {
			this.id_path_cache[obj.id] = obj.path;
			this.paths[obj.path] = obj.id
		});

		/*const is_folder = p_files[0].mimeType === CONSTS.folder_mime_type;
		let path = '/' + p_files.map(it => it.name).reverse().join('/');
		if (is_folder) path += '/';*/

		return cache[0].path;
	}


	// Get file item based on id
	async findItemById(id) {
		const is_user_drive = this.root_type === CONSTS.gd_root_type.user_drive;
		let url = `https://www.googleapis.com/drive/v3/files/${id}?fields=${CONSTS.default_file_fields}${is_user_drive ? '' : '&supportsAllDrives=true'}`;
		let requestOption = await this.requestOption();
		let res = await fetch(url, requestOption);
		return await res.json()
	}

	async findPathId(path) {
		let c_path = '/';
		let c_id = this.paths[c_path];

		let arr = path.trim('/').split('/');
		for (let name of arr) {
			c_path += name + '/';

			if (typeof this.paths[c_path] == 'undefined') {
				let id = await this._findDirId(c_id, name);
				this.paths[c_path] = id;
			}

			c_id = this.paths[c_path];
			if (c_id == undefined || c_id == null) {
				break;
			}
		}
		// console.log(this.paths);
		return this.paths[path];
	}

	async _findDirId(parent, name) {
		name = driveQueryValue(decodeURIComponent(name));

		// console.log("_findDirId", parent, name);

		if (parent == undefined) {
			return null;
		}

		let url = 'https://www.googleapis.com/drive/v3/files';
		let params = {
			'includeItemsFromAllDrives': true,
			'supportsAllDrives': true
		};
		params.q = `'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${name}'  and trashed = false`;
		params.fields = "nextPageToken, files(id, name, mimeType)";
		url += '?' + this.enQuery(params);
		let requestOption = await this.requestOption();
		let response = await fetch(url, requestOption);
		let obj = await response.json();
		if (obj.files[0] == undefined) {
			return null;
		}
		return obj.files[0].id;
	}

	async accessToken() {
		if (!this.authConfig.accessToken || this.authConfig.expires <= Date.now()) {
			const token = await refreshGoogleToken(this.authConfig.settings);
			this.authConfig.accessToken = token.access_token;
			this.authConfig.expires = Date.now() + Math.max(0, (token.expires_in || 3600) - 60) * 1000;
		}
		return this.authConfig.accessToken;
	}


	async fetch200(url, requestOption) {
		let response;
		for (let i = 0; i < 3; i++) {
			response = await fetch(url, requestOption);
			console.log(response.status);
			if (response.status != 403) {
				break;
			}
			await this.sleep(800 * (i + 1));
		}
		return response;
	}

	async requestOption(headers = {}, method = 'GET') {
		const accessToken = await this.accessToken();
		headers['authorization'] = 'Bearer ' + accessToken;
		return {
			'method': method,
			'headers': headers
		};
	}

	enQuery(data) {
		const ret = [];
		for (let d in data) {
			ret.push(encodeURIComponent(d) + '=' + encodeURIComponent(data[d]));
		}
		return ret.join('&');
	}

	sleep(ms) {
		return new Promise(function (resolve, reject) {
			let i = 0;
			setTimeout(function () {
				console.log('sleep' + ms);
				i++;
				if (i >= 2) reject(new Error('i>=2'));
				else resolve(i);
			}, ms);
		})
	}
}

String.prototype.trim = function (char) {
	if (char) {
		return this.replace(new RegExp('^\\' + char + '+|\\' + char + '+$', 'g'), '');
	}
	return this.replace(/^\s+|\s+$/g, '');
};
