import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import markedKatex from 'marked-katex-extension'
import hljs from 'highlight.js/lib/common'
// 副作用导入：给 KaTeX 注册 \ce{} 化学式语法（katex 的 exports 里没带它的类型声明，
// 见 lib/katex-contrib.d.ts）
import 'katex/contrib/mhchem'

/**
 * Markdown 预览渲染，对齐博客能力：
 * GFM + 代码高亮 + KaTeX 公式（含 mhchem 化学式）+ ::: 提示块 + ::github 仓库卡片
 * + [!NOTE] 引用块 + 本地图片路径重写为 asset URL + 表格横向滚动容器
 *
 * MDX 的静态还原（export 数据、JSX 布局、复制按钮）在 lib/mdx.ts，用 AST 安全解释，
 * 不执行任何用户代码；这里只负责把它们产出的 HTML 交给 marked。
 */
export { escapeHtml, transformMdx } from './mdx'

const marked = new Marked(
	markedHighlight({
		emptyLangClass: 'hljs',
		langPrefix: 'hljs language-',
		highlight(code, lang) {
			const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
			return hljs.highlight(code, { language }).value
		}
	}),
	markedKatex({ throwOnError: false })
)

interface Frontmatter {
	fm: Record<string, string>
	body: string
}

/** 剥离并极简解析 frontmatter（只取 key: 单行值，够预览头部用） */
export function splitFrontmatter(md: string): Frontmatter {
	const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md)
	if (!m) return { fm: {}, body: md }
	const fm: Record<string, string> = {}
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
		if (!kv) continue
		let v = kv[2].trim()
		if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1)
		if (v) fm[kv[1].toLowerCase()] = v
	}
	return { fm, body: md.slice(m[0].length) }
}

export function parseTags(raw: string | undefined): string[] {
	if (!raw) return []
	const inner = /^\[.*\]$/.test(raw) ? raw.slice(1, -1) : raw
	return inner
		.split(/[,，]/)
		.map((s) => s.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean)
}

/** ::github{repo="owner/name"} → 仓库卡片 */
function transformGithubDirective(md: string): string {
	return md.replace(/::github\{repo=["']([^"']+)["']\}/g, (_m, repo: string) => {
		const safe = repo.replace(/[<>"'`]/g, '')
		const [owner, name] = safe.split('/')
		return `<a class="gh-card" href="https://github.com/${safe}" target="_blank" rel="noreferrer"><span class="gh-icon">⭐</span><span class="gh-name">${owner ?? ''}<b>/${name ?? ''}</b></span><span class="gh-sub">GitHub 仓库</span></a>`
	})
}

/** :::type 标题 ... ::: 提示块 → 带样式的卡片（内部再走一遍 markdown 渲染） */
function transformCallouts(md: string): string {
	return md.replace(/^:::([\w-]+)(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n?:::[ \t]*(?:\n|$)/gm, (_m, type: string, title: string | undefined, inner: string) => {
		const bodyHtml = marked.parse(inner ?? '', { async: false })
		const t = (title ?? '').replace(/[<>]/g, '').trim() || type
		return `<div class="callout co-${type}"><div class="co-title">${t}</div><div class="co-body">${bodyHtml}</div></div>\n`
	})
}

/** 相对路径解析（相对于 md 文件所在目录，项目根为基准） */
function resolveRel(fromDir: string, rel: string): string {
	const parts = fromDir ? fromDir.split('/') : []
	for (const seg of rel.split('/')) {
		if (seg === '' || seg === '.') continue
		if (seg === '..') parts.pop()
		else parts.push(seg)
	}
	return parts.join('/')
}

/**
 * 把 markdown 里的本地资源引用算出项目内相对路径（外链返回 null）。
 * - 以 `/` 开头的按博客约定解析到 `public/`（如 `/gallery/a.jpg` → `public/gallery/a.jpg`）；
 * - 其余按相对 md 文件所在目录解析；
 * - 去掉查询串 / 锚点，并对百分号编码做解码（`%20` 等还原成真实文件名）。
 */
export function localMediaPath(src: string, mdRel: string): string | null {
	const raw = src.trim()
	if (!raw) return null
	// 带协议（http:、data:、mailto:…）、协议相对（//）、纯锚点的一律当外链
	if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) return null
	const clean = raw.split('#')[0].split('?')[0]
	let decoded = clean
	try {
		decoded = decodeURIComponent(clean)
	} catch {
		/* 非法编码，保持原样 */
	}
	if (decoded.startsWith('/')) return `public${decoded}`.replace(/\/{2,}/g, '/')
	const dir = mdRel.includes('/') ? mdRel.slice(0, mdRel.lastIndexOf('/')) : ''
	return resolveRel(dir, decoded)
}

/** 需要本地资源重写的标签（图片 + 常见媒体） */
const MEDIA_SELECTOR = 'img,video,audio,source,track'

/**
 * 给每个 <table> 包一层横向滚动容器（纯字符串处理，便于测试）。
 * markdown 表格不会嵌套，用非贪婪匹配即可。
 */
export function wrapTables(html: string): string {
	return html.replace(/<table\b[\s\S]*?<\/table>/gi, (m) => `<div class="table-scroll">${m}</div>`)
}

/** 渲染 markdown；本地媒体标记为 data-local，由组件异步填充 asset URL */
export function renderMarkdown(md: string, mdRel: string): string {
	const prepared = transformCallouts(transformGithubDirective(md))
	const html = wrapTables(marked.parse(prepared, { async: false }))
	const t = document.createElement('template')
	t.innerHTML = html
	t.content.querySelectorAll(MEDIA_SELECTOR).forEach((el) => {
		const src = el.getAttribute('src') ?? ''
		const local = src ? localMediaPath(src, mdRel) : null
		if (local) {
			el.setAttribute('data-local', local)
			el.removeAttribute('src')
		}
		if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy')
	})
	// <video poster> 也支持本地路径
	t.content.querySelectorAll('video[poster]').forEach((el) => {
		const poster = el.getAttribute('poster') ?? ''
		const local = poster ? localMediaPath(poster, mdRel) : null
		if (local) {
			el.setAttribute('data-local-poster', local)
			el.removeAttribute('poster')
		}
	})
	// GitHub 风格 [!NOTE] 引用块
	t.content.querySelectorAll('blockquote').forEach((bq) => {
		const first = bq.querySelector('p')
		const m = first && /^\[!(\w+)\][ \t]*(.*)/.exec(first.textContent ?? '')
		if (!m) return
		bq.classList.add('callout', `co-${m[1].toLowerCase()}`)
		const title = document.createElement('div')
		title.className = 'co-title'
		title.textContent = m[2].trim() || m[1]
		if (first) {
			const rest = (first.textContent ?? '').replace(/^\[!\w+\][ \t]*/, '')
			first.textContent = rest || ''
		}
		bq.prepend(title)
	})
	return t.innerHTML
}
