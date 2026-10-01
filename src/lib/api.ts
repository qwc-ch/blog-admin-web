/**
 * window.api 的 Web 实现（Fireflux Tauri 版 src/renderer/src/lib/tauri-api.ts 的对应物）。
 *
 * 桌面版走 Tauri invoke 读写本地文件与图床；网页版是 Cloudflare Worker 后端的纯 fetch 封装，
 * 对外暴露**同名方法**（components/pages 基本零改动移植自桌面版）。
 *
 * 鉴权：OAuth 完成后后端跳到 FRONTEND_URL?token=...，这里收进 localStorage，
 * 之后每个请求带 Authorization: Bearer。401 → 清掉 token 回登录页。
 */
import type {
	ContentItem,
	ConfigExportData,
	ConfigReadResult,
	DiscoveredConfig,
	TrashEntry,
	AppearanceSettings
} from './shared-types'

export type {
	ContentItem,
	ConfigExportData,
	ConfigReadResult,
	DiscoveredConfig,
	TrashEntry,
	AppearanceSettings
} from './shared-types'

const API_BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const TOKEN_KEY = 'ff_admin_token'
const ACCENT_KEY = 'ff.accent'

/** 401 后回登录页（App 监听这个事件退回 login 界面） */
function notifyAuthFailed(): void {
	localStorage.removeItem(TOKEN_KEY)
	window.dispatchEvent(new CustomEvent('ff:auth-failed'))
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
	const token = localStorage.getItem(TOKEN_KEY) ?? ''
	const res = await fetch(`${API_BASE}/api${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	})
	if (res.status === 401) {
		notifyAuthFailed()
		throw new Error('登录已失效，请重新登录')
	}
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok) throw new Error(String(data.error ?? data.detail ?? `HTTP ${res.status}`))
	return data as T
}

const post = <T>(path: string, body?: unknown): Promise<T> => req<T>('POST', path, body)
const put = <T>(path: string, body?: unknown): Promise<T> => req<T>('PUT', path, body)
const del = <T>(path: string): Promise<T> => req<T>('DELETE', path)
const get = <T>(path: string): Promise<T> => req<T>('GET', path)

// ---------- .fireflux.yml 缓存：集合/配置的注册信息 ----------

interface AdminCollectionDef {
	label: string
	path: string
	filename: string
	fields: Record<string, { type: string }>
	features: string[]
}
interface AdminConfigDef { key: string; label: string; path: string; group: string | null; kind: 'ts' | 'html'; exports: string[] }

let collectionsCache: CollectionMeta[] | null = null
let configsCache: AdminConfigDef[] | null = null

interface CollectionMeta { name: string; label: string; path: string; filename: string; fields: Record<string, { type: string }> }
async function collections(): Promise<CollectionMeta[]> {
	if (!collectionsCache) {
		const r = await get<{ collections: CollectionMeta[] }>('/collections')
		collectionsCache = r.collections
	}
	return collectionsCache as CollectionMeta[]
}

async function configs(): Promise<AdminConfigDef[]> {
	if (!configsCache) {
		const r = await get<{ configs: AdminConfigDef[] }>('/configs')
		configsCache = r.configs
	}
	return configsCache
}

/** 目录（src/content/posts）→ 集合名 */
async function collectionByFolder(folder: string): Promise<string> {
	const list = await collections()
	const hit = list.find((c) => c.name === folder) ?? list.find((c) => c.path.endsWith(`/${folder}`))
	if (!hit) throw new Error(`后台未声明集合：${folder}（在 .fireflux.yml 里补 collections.${folder}）`)
	return hit.name
}

/** 完整仓库路径 → { collection, slug }（slug 可能为多级，如 guide/foo） */
async function locateByRel(rel: string): Promise<{ name: string; slug: string }> {
	const list = await collections()
	for (const c of list) {
		const prefix = c.path.endsWith('/') ? c.path : c.path + '/'
		if (rel.startsWith(prefix)) {
			let slug = rel.slice(prefix.length)
			for (const pat of ['{slug}.md', '{slug}/index.md', '{slug}/index.mdx', '{slug}.mdx']) {
				const suffix = pat.slice('{slug}'.length)
				if (c.filename === pat && rel.endsWith(suffix) && slug.endsWith(suffix)) {
					slug = slug.slice(0, slug.length - suffix.length)
					return { name: c.name, slug }
				}
			}
			// 宽松兜底：去掉扩展名 / 去掉 index.*
			slug = slug.replace(/\.mdx?$/, '').replace(/\/(index)$/, '')
			return { name: c.name, slug }
		}
	}
	throw new Error(`路径不在任何集合下：${rel}`)
}

async function relFor(name: string, slug: string): Promise<string> {
	const list = await collections()
	const c = list.find((x) => x.name === name)
	if (!c) throw new Error(`集合不存在：${name}`)
	return c.path.replace(/\/+$/, '') + '/' + c.filename.replace('{slug}', slug)
}

// ---------- 附件（网页版 = 图床直传） ----------

/** 图床上传后把「生成引用」用到的原始扩展名保住（粘贴图常见 png） */
async function uploadFile(file: File): Promise<string> {
	const token = localStorage.getItem(TOKEN_KEY) ?? ''
	const fd = new FormData()
	fd.append('file', file)
	const res = await fetch(`${API_BASE}/api/images/upload`, {
		method: 'POST',
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		body: fd
	})
	const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
	if (!res.ok || !data.url) throw new Error(data.error ?? '图床上传失败')
	return data.url
}

// ---------- window.api ----------

export interface WindowApiSubset {
	appInit: () => Promise<{ projectPath: string; valid: boolean; appearance: AppearanceSettings; wallpaperData: string | null; dataDir: string }>
	contentList: (folder: string) => Promise<ContentItem[]>
	fileRead: (rel: string) => Promise<string>
	fileWrite: (rel: string, content: string) => Promise<void>
	fileDelete: (rel: string) => Promise<string[]>
	contentCreate: (p: { folder: string; kind: 'post' | 'project' | 'dynamic'; title?: string; slug?: string; content?: string; pinned?: boolean; location?: string }) => Promise<string>
	contentClone: (rel: string) => Promise<string>
	contentRename: (rel: string, newSlug: string) => Promise<string>
	contentAddImage: (rel: string) => Promise<string[]>
	contentPasteImage: (rel: string, name: string, dataBase64: string) => Promise<string>
	fileDataUrl: (rel: string) => Promise<string>
	trashList: () => Promise<TrashEntry[]>
	trashRestore: (id: string) => Promise<string[]>
	trashPurge: (id: string) => Promise<void>
	trashEmpty: () => Promise<number>
	configDiscover: () => Promise<DiscoveredConfig[]>
	configRead: (payload: { rel: string; kind: 'ts' | 'html'; exports?: string[] }) => Promise<ConfigReadResult>
	configWrite: (payload: { rel: string; kind: 'ts' | 'html'; exportName?: string; values?: unknown; content?: string }) => Promise<{ ok: boolean; patches: number }>
	openExternal: (url: string) => Promise<void>
	plantumlUrl: (text: string) => Promise<string>
	assetImport: (target: string) => Promise<string[]>
	publishInfo: () => Promise<{ owner: string; repo: string; branch: string; blogUrl: string | null; commits: { sha: string; message: string; date: string; author: string }[] }>
	collectionsList: () => Promise<{ name: string; label: string; path: string; filename: string }[]>
	itemLog: (rel: string) => Promise<{ sha: string; message: string; date: string }[]>
	listImages: () => Promise<{ key: string; size: number; url: string }[]>
	uploadImage: (file: File) => Promise<string>
	deleteImage: (key: string) => Promise<void>
	adminConfigRaw: () => Promise<{ raw: string; source: string }>
	saveAdminConfigRaw: (raw: string) => Promise<void>
	logout: () => void
	isLoggedIn: () => boolean
	applyAccent: () => void
	appearanceSet: (patch: AppearanceSettings) => Promise<AppearanceSettings>
	/** D1 site_config 键值配置（登录后可用） */
	configGet: (key: string) => Promise<string | null>
	configSet: (key: string, value: string) => Promise<void>
}

// oauth 回跳收 token；成功就剥掉 query
export function captureTokenFromUrl(): boolean {
	const q = new URLSearchParams(window.location.search)
	const t = q.get('token')
	if (!t) return !!localStorage.getItem(TOKEN_KEY)
	localStorage.setItem(TOKEN_KEY, t)
	const url = new URL(window.location.href)
	url.searchParams.delete('token')
	window.history.replaceState(null, '', url.toString())
	return true
}

/* ============================================================================
 * DEV-BYPASS START —— 调试用密码登录（正式上线前删除本函数 + components/DevLogin.svelte
 * 以及 App.svelte / Settings.svelte 里对 <DevLogin /> 的引用；后端对应
 * src/routes/auth.ts 的 /dev-login。全仓库 `grep -rn "DEV-BYPASS"` 可定位全部残留。）
 * ========================================================================== */
/** 用后端调试密码换 token 存进 localStorage；后端未开启该端点时会抛错 */
export async function devLogin(password: string): Promise<void> {
	const res = await fetch(`${API_BASE}/api/auth/dev-login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ password })
	})
	const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
	if (!res.ok || !data.token) throw new Error(data.error ?? `HTTP ${res.status}`)
	localStorage.setItem(TOKEN_KEY, data.token)
}
/* ============================ DEV-BYPASS END ============================== */

function applyAccent(): void {
	try {
		const raw = localStorage.getItem(ACCENT_KEY)
		if (!raw) return
		const a = JSON.parse(raw) as AppearanceSettings
		const { accent, accentDeep } = a
		if (accent) {
			document.documentElement.style.setProperty('--accent', accent)
			document.documentElement.style.setProperty('--accent-deep', accentDeep ?? accent)
			document.documentElement.style.setProperty('--accent-soft', accent + '26')
		}
	} catch {
		/* 忽略坏缓存 */
	}
}

/** 应用 D1 壁纸配置（url + 减淡 + 卡片透明度）到全屏壁纸层；没有配置则移除 */
export function applyWallpaperFromConfig(raw: string | null): void {
	try {
		const cfg = raw ? JSON.parse(raw) as { url?: string; dim?: number; cardOpacity?: number } : null
		const url = cfg?.url?.trim()
		let el = document.querySelector<HTMLElement>('.ff-wallpaper')
		if (url) {
			if (!el) {
				el = document.createElement('div')
				el.className = 'ff-wallpaper'
				document.body.prepend(el)
			}
			el.style.backgroundImage = `url(${JSON.stringify(url)})`
			el.style.opacity = String(1 - (cfg?.dim ?? 0.45))
		} else if (el) {
			el.remove()
		}
		// 卡片/侧栏不透明度（1 = 不透明；调低露出壁纸）
		const cardAlpha = cfg?.cardOpacity ?? 1
		document.documentElement.style.setProperty('--panel-alpha', String(cardAlpha))
		document.documentElement.style.setProperty('--sidebar-alpha', String(cardAlpha))
	} catch {
		/* 配置损坏就当作没有壁纸 */
	}
}

export function installApi(): void {
	;(window as unknown as { api: WindowApiSubset }).api = {
		appInit: async () => {
			const raw = localStorage.getItem(ACCENT_KEY)
			const appearance = (raw ? JSON.parse(raw) : {}) as AppearanceSettings
			return { projectPath: API_BASE || '(未配置)', valid: true, appearance, wallpaperData: null, dataDir: '' }
		},

		// ---------- 内容 ----------
		contentList: async (folder) => {
			const name = await collectionByFolder(folder)
			const r = await get<{ items: Array<{ slug: string; path: string; date: string }> }>(`/collections/${encodeURIComponent(name)}/items`)
			if (!configsCache) await configs().catch(() => undefined) // 预热，fileWrite 等要用
			return r.items.map((it) => ({ rel: it.path, mtimeMs: it.date ? Date.parse(it.date.replace(' ', 'T')) || 0 : 0 }))
		},
		fileRead: async (rel) => {
			const { name, slug } = await locateByRel(rel)
			const item = await get<{ raw: string }>(`/collections/${encodeURIComponent(name)}/items/${encodeURIComponent(slug)}`)
			return item.raw
		},
		fileWrite: async (rel, content) => {
			const { name, slug } = await locateByRel(rel)
			await put(`/collections/${encodeURIComponent(name)}/items/${encodeURIComponent(slug)}`, { raw: content })
		},
		fileDelete: async (rel) => {
			const { name, slug } = await locateByRel(rel)
			await del(`/collections/${encodeURIComponent(name)}/items/${encodeURIComponent(slug)}`)
			return [rel]
		},
		contentCreate: async (p) => {
			const name = await collectionByFolder(p.folder)
			if (p.kind === 'dynamic') {
				const d = new Date()
				const pad = (n: number) => String(n).padStart(2, '0')
				const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
				const pub = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
				const raw = `---\npublished: ${pub}\npinned: ${p.pinned ? 'true' : 'false'}\nlocation: "${(p.location ?? '').replace(/"/g, '\\"')}"\n---\n\n${p.content ?? ''}\n`
				await post(`/collections/${encodeURIComponent(name)}/items`, { slug: stamp, raw })
				return relFor(name, stamp)
			}
			const slug = p.slug || p.title || 'untitled'
			const c = (await collections()).find((x) => x.name === name)!
			const dsc = c.fields.description ? `\ndescription: ""` : ''
			const tags = c.fields.tags ? '\ntags: []' : ''
			const cat = c.fields.category ? '\ncategory: ""' : ''
			const img = c.fields.image ? '\nimage: ""' : ''
			const draft = c.fields.draft ? '\ndraft: false' : ''
			const pub = c.fields.published ? `\npublished: ${new Date().toISOString().slice(0, 10)}` : ''
			const raw = `---\ntitle: ${JSON.stringify(p.title ?? slug)}${dsc}${pub}${img}${tags}${cat}${draft}\n---\n\n${p.content ?? ''}\n`
			await post(`/collections/${encodeURIComponent(name)}/items`, { slug, raw })
			return relFor(name, slug)
		},
		contentClone: async (rel) => {
			const { name, slug } = await locateByRel(rel)
			const r = await post<{ slug: string }>(`/collections/${encodeURIComponent(name)}/items/${encodeURIComponent(slug)}/clone`, { slug: `${slug}-副本` })
			return relFor(name, r.slug ?? `${slug}-副本`)
		},
		contentRename: async (rel, newSlug) => {
			const { name, slug } = await locateByRel(rel)
			const r = await post<{ slug: string }>(`/collections/${encodeURIComponent(name)}/items/${encodeURIComponent(slug)}/rename`, { newSlug })
			return relFor(name, r.slug ?? newSlug)
		},
		contentAddImage: async (rel) => {
			void rel
			const refs = await pickAndUpload()
			return refs
		},
		contentPasteImage: async (_rel, name, dataBase64) => {
			const mime = name.split('.').pop() === 'jpg' || name.split('.').pop() === 'jpeg' ? 'image/jpeg' : 'image/png'
			const bin = atob(dataBase64)
			const bytes = new Uint8Array(bin.length)
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
			const url = await uploadFile(new File([bytes], name, { type: mime }))
			return url
		},
		fileDataUrl: async (rel) => {
			const r = await get<{ url: string }>(`/publish/raw-url?path=${encodeURIComponent(rel)}`)
			return r.url
		},

		// ---------- 回收站 ----------
		trashList: async () => {
			const r = await get<{ entries: Array<{ id: string; collection: string; slug: string; path: string; deletedAt: string }> }>('/trash')
			const kindMap: Record<string, string> = { posts: 'post', dynamic: 'dynamic', projects: 'project', spec: 'spec' }
			return r.entries.map((e) => ({
				id: e.id,
				kind: kindMap[e.collection] ?? 'content',
				label: e.slug,
				at: e.deletedAt,
				restorable: true,
				items: [{ rel: e.path, dir: false }]
			}))
		},
		trashRestore: async (id) => {
			const r = await post<{ path?: string }>(`/trash/${encodeURIComponent(id)}/restore`, {})
			return r.path ? [r.path] : []
		},
		trashPurge: async (id) => {
			await del(`/trash/${encodeURIComponent(id)}`)
		},
		trashEmpty: async () => {
			const r = await post<{ message: string }>('/trash/empty', {})
			void r
			return 0
		},

		// ---------- 配置 ----------
		configDiscover: async () => {
			configsCache = null
			const list = await configs()
			return list.map((c) => ({ rel: c.path, kind: c.kind, exports: c.exports }))
		},
		configRead: async (payload) => {
			const list = await configs()
			const def = list.find((d) => d.path === payload.rel)
			if (!def) throw new Error(`未注册的配置：${payload.rel}`)
			if (payload.kind === 'html') {
				const r = await get<{ content: string }>(`/configs/${encodeURIComponent(def.key)}`)
				return { kind: 'html', rel: payload.rel, content: r.content }
			}
			const r = await get<{ exports: ConfigExportData[] }>(`/configs/${encodeURIComponent(def.key)}`)
			return { kind: 'ts', rel: payload.rel, exports: r.exports }
		},
		configWrite: async (payload) => {
			const list = await configs()
			const def = list.find((d) => d.path === payload.rel)
			if (!def) throw new Error(`未注册的配置：${payload.rel}`)
			if (payload.kind === 'html') {
				await put(`/configs/${encodeURIComponent(def.key)}`, { content: payload.content })
				return { ok: true, patches: 1 }
			}
			const r = await put<{ message: string }>(`/configs/${encodeURIComponent(def.key)}`, { exportName: payload.exportName, values: payload.values })
			void r
			return { ok: true, patches: 1 }
		},

		// ---------- 杂项 ----------
		openExternal: async (url) => {
			window.open(url, '_blank', 'noopener')
		},
		plantumlUrl: async (text) => {
			// plantuml 配置里只取 server 地址；编码用 deflate（与主题端约定一致）
			const list = await configs()
			const def = list.find((d) => d.key === 'plantuml')
			let server = 'https://www.plantuml.com/plantuml'
			if (def) {
				try {
					const r = await get<{ exports: ConfigExportData[] }>(`/configs/${encodeURIComponent(def.key)}`)
					const v = r.exports[0]?.values as Record<string, unknown> | undefined
					const s = v && typeof v.server === 'string' ? v.server : ''
					if (s) server = s
				} catch {
					/* 配置读取失败就用默认服务器 */
				}
			}
			const ds = new CompressionStream('deflate-raw')
			const raw = new TextEncoder().encode(text)
			const stream = new Blob([raw]).stream().pipeThrough(ds)
			const buf = await new Response(stream).arrayBuffer()
			const bytes = new Uint8Array(buf)
			const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
			let out = ''
			function append3(b1: number, b2: number, b3: number): void {
				const c1 = b1 >> 2
				const c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
				const c3 = ((b2 & 0xf) << 2) | (b3 >> 6)
				const c4 = b3 & 0x3f
				out += alphabet[c1] + alphabet[c2] + alphabet[c3] + alphabet[c4]
			}
			for (let i = 0; i < bytes.length; i += 3) {
				if (i + 2 === bytes.length) append3(bytes[i], bytes[i + 1], 0)
				else if (i + 1 === bytes.length) append3(bytes[i], 0, 0)
				else append3(bytes[i], bytes[i + 1], bytes[i + 2])
			}
			return `${server.replace(/\/+$/, '')}/png/~1${out}`
		},
		assetImport: async (_target) => pickAndUpload(),

		publishInfo: () => get('/publish'),
		collectionsList: () => collections(),
		itemLog: async (rel) => {
			const { name, slug } = await locateByRel(rel)
			const r = await get<{ commits: { sha: string; message: string; date: string }[] }>(`/collections/${encodeURIComponent(name)}/items/${encodeURIComponent(slug)}/log`)
			return r.commits
		},
		listImages: () => get('/images'),
		uploadImage: (file) => uploadFile(file),
		deleteImage: async (key) => {
			await del(`/images/${encodeURIComponent(key)}`)
		},
		adminConfigRaw: async () => {
			const r = await get<{ raw: string; source?: string }>('/admin-config')
			return { raw: r.raw ?? '', source: r.source ?? '' }
		},
		saveAdminConfigRaw: async (raw) => {
			await put('/admin-config', { content: raw })
		},

		logout: () => {
			localStorage.removeItem(TOKEN_KEY)
			window.location.href = window.location.pathname
		},
		isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),
		applyAccent,
		appearanceSet: async (patch) => {
			const cur = (localStorage.getItem(ACCENT_KEY) ? JSON.parse(localStorage.getItem(ACCENT_KEY)!) : {}) as AppearanceSettings
			const next = { ...cur, ...patch }
			localStorage.setItem(ACCENT_KEY, JSON.stringify(next))
			applyAccent()
			return next
		},
		// D1 site_config 键值配置：GET 全部返回 {key: value}，单 key 取值/写值
		configGet: async (key) => {
			const all = await get<Record<string, string>>('/config')
			return key in all ? all[key] : null
		},
		configSet: async (key, value) => {
			await post<{ message: string }>('/config', { key, value })
		}
	}
}

/** 弹文件选择器 → 逐张传图床 → 返回直链引用（用户取消返回空） */
function pickAndUpload(): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = 'image/*'
		input.multiple = true
		input.onchange = async () => {
			const files = [...(input.files ?? [])]
			if (!files.length) return resolve([])
			try {
				const refs: string[] = []
				for (const f of files) refs.push(await uploadFile(f))
				resolve(refs)
			} catch (e) {
				reject(e instanceof Error ? e : new Error(String(e)))
			}
		}
		input.click()
	})
}
