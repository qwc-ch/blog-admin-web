<script lang="ts">
	import 'katex/dist/katex.min.css'
	import 'highlight.js/styles/github.css'
	import { ansiToHtml } from '../lib/ansi'
	import { parseTags, renderMarkdown, splitFrontmatter, transformMdx } from '../lib/preview'

	let { content, rel = '', isMdx = false }: { content: string; rel?: string; isMdx?: boolean } = $props()

	let wrap = $state<HTMLElement | undefined>(undefined)

	const imgCache = new Map<string, string>()

	/**
	 * 渲染防抖。
	 *
	 * 原来 `view` 直接派生于 `content`，于是**每敲一个字**都要跑一遍完整管线
	 * （marked 解析 + 代码高亮 + KaTeX），再把整篇文档的 innerHTML 换掉。
	 * 实测解析本身中位数 4.3ms、p95 8.7ms（最长的教程文），
	 * 但真正的大头是后面的 DOM 替换 —— 合起来已经越过一帧的预算。
	 *
	 * 这里做的是：同一篇文档内连续输入时按 200ms 防抖；**切换文件时立即渲染**，
	 * 不让你换到新文章还要等一下才出内容。
	 */
	const RENDER_DEBOUNCE_MS = 200
	// 初始化时不读 props（在 $state 初值里读响应式值会只捕获到初始值），
	// 用 undefined 起步，交给下面的 effect 填上
	let rendered = $state<{ content: string; key: string } | undefined>(undefined)

	$effect(() => {
		const c = content
		const k = rel
		if (!rendered || k !== rendered.key) {
			// 首次渲染 / 换文件：立即出内容
			rendered = { content: c, key: k }
			return
		}
		if (c === rendered.content) return
		const timer = setTimeout(() => {
			rendered = { content: c, key: k }
		}, RENDER_DEBOUNCE_MS)
		return () => clearTimeout(timer)
	})

	// 渲染结果用状态而不是 $derived：MDX 需要先懒加载 TypeScript AST 解析器（异步），
	// 解析器没就绪时会走显式降级（不会执行任何脚本）。
	let view = $state<{ title: string; tags: string[]; date: string; html: string }>({
		title: '',
		tags: [],
		date: '',
		html: ''
	})

	$effect(() => {
		const src = rendered?.content ?? ''
		const relKey = rendered?.key ?? ''
		const mdx = isMdx
		let cancelled = false
		void (async () => {
			const { fm, body: rawBody } = splitFrontmatter(src)
			const body = mdx ? await transformMdx(rawBody) : rawBody
			if (cancelled) return
			const title = typeof fm['title'] === 'string' && fm['title'] ? fm['title'] : ''
			const tags = parseTags(fm['tags'])
			const date = typeof fm['published'] === 'string' ? fm['published'] : ''
			view = { title, tags, date, html: renderMarkdown(body, relKey) }
		})()
		return () => {
			cancelled = true
		}
	})

	/** 内容已改动但还没渲染（用于界面上给一点"正在更新"的暗示） */
	const pending = $derived(rendered?.content !== content)

	/** 本地资源路径 → asset URL（带缓存） */
	async function resolveLocal(path: string): Promise<string> {
		const cached = imgCache.get(path)
		if (cached) return cached
		const url = await window.api.fileDataUrl(path)
		imgCache.set(path, url)
		return url
	}

	/** 单个本地媒体元素：src / video poster → asset URL（带缓存） */
	function fillOne(el: Element): void {
		const srcPath = el.getAttribute('data-local')
		const posterPath = el.getAttribute('data-local-poster')
		if (srcPath) {
			void resolveLocal(srcPath)
				.then((url) => {
					// async 回调执行时元素可能已被 {@html} 重渲染换掉，用 data-local 比对确保
					// 只给「当前还活着、且仍是同一资源」的元素赋值，避免写给脱离文档的死节点。
					if (el.getAttribute('data-local') === srcPath) el.setAttribute('src', url)
				})
				.catch(() => {
					el.setAttribute('alt', `${el.getAttribute('alt') || '媒体'}（缺失：${srcPath}）`)
					el.removeAttribute('data-local')
				})
		}
		if (posterPath) {
			void resolveLocal(posterPath)
				.then((url) => {
					if (el.getAttribute('data-local-poster') === posterPath) el.setAttribute('poster', url)
				})
				.catch(() => el.removeAttribute('data-local-poster'))
		}
	}

	/** 容器内所有本地媒体 → asset URL */
	function fillImages(el: HTMLElement): void {
		el.querySelectorAll('[data-local], [data-local-poster]').forEach(fillOne)
	}

	/** 复制文本到剪贴板（Clipboard API 不可用时退回 execCommand） */
	async function copyToClipboard(text: string): Promise<boolean> {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text)
				return true
			}
		} catch {
			/* 退回下面的兜底方案 */
		}
		try {
			const ta = document.createElement('textarea')
			ta.value = text
			ta.setAttribute('readonly', '')
			ta.style.position = 'fixed'
			ta.style.opacity = '0'
			document.body.appendChild(ta)
			ta.select()
			const ok = document.execCommand('copy')
			ta.remove()
			return ok
		} catch {
			return false
		}
	}

	/** 复制成功反馈：把第一个 svg 藏起来、第二个（对勾）露出来，1.5s 后还原 */
	function flashCopied(btn: Element): void {
		const svgs = btn.querySelectorAll('svg')
		if (svgs.length < 2) return
		svgs[0].classList.add('hidden')
		svgs[1].classList.remove('hidden')
		setTimeout(() => {
			svgs[0].classList.remove('hidden')
			svgs[1].classList.add('hidden')
		}, 1500)
	}

	/**
	 * MDX 复制按钮：事件委托绑定，安全复制 data-copy 里的文本。
	 * 模板里的 `onclick` 不会被执行（渲染时已剥离），这里只读 data-copy 属性。
	 */
	function onCopyClick(ev: MouseEvent): void {
		const target = ev.target
		if (!(target instanceof Element)) return
		const btn = target.closest('button[data-copy]')
		if (!btn) return
		const text = btn.getAttribute('data-copy') ?? ''
		void copyToClipboard(text).then((ok) => {
			if (ok) flashCopied(btn)
		})
	}

	/** PlantUML 代码块 → 服务器渲染图 */
	async function renderPlantuml(el: HTMLElement): Promise<void> {
		const blocks = Array.from(el.querySelectorAll('pre code.language-plantuml'))
		for (const code of blocks) {
			const pre = code.parentElement
			if (!pre) continue
			const text = code.textContent ?? ''
			const holder = document.createElement('div')
			holder.className = 'puml-box'
			pre.replaceWith(holder)
			try {
				const url = await window.api.plantumlUrl(text)
				const img = document.createElement('img')
				img.src = url
				img.alt = 'PlantUML 图'
				img.loading = 'lazy'
				holder.append(img)
			} catch {
				holder.textContent = text
			}
		}
	}

	/** Mermaid 代码块 → 渲染成图 */
	async function renderMermaid(el: HTMLElement): Promise<void> {
		const blocks = Array.from(el.querySelectorAll('pre code.language-mermaid'))
		if (!blocks.length) return
		try {
			const mermaid = (await import('mermaid')).default
			mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral' })
			for (const code of blocks) {
				const pre = code.parentElement
				if (!pre) continue
				const holder = document.createElement('div')
				holder.className = 'mermaid-box'
				holder.textContent = code.textContent ?? ''
				pre.replaceWith(holder)
			}
			await mermaid.run({ nodes: Array.from(el.querySelectorAll('.mermaid-box')) as HTMLElement[] })
		} catch (err) {
			console.warn('mermaid 渲染失败', err)
		}
	}

	/** ANSI 终端代码块 → 彩色 HTML */
	function renderAnsi(el: HTMLElement): void {
		el.querySelectorAll('pre code.language-ansi').forEach((code) => {
			const pre = code.parentElement
			if (!pre || pre.dataset.ansiDone === '1') return
			pre.dataset.ansiDone = '1'
			pre.classList.add('ansi-box')
			pre.innerHTML = ansiToHtml(code.textContent ?? '')
		})
	}

	// 本地图片填充 + ANSI 终端代码块 → 彩色 HTML：
	// 用同一个 MutationObserver 监控 md-body 的 DOM 变化。
	//
	// 为什么不直接在「内容变化」的 effect 里做：marked 渲染结果通过 {@html view.html}
	// 整体写入 DOM，而依赖 view.html 的 effect 在某些时序下会在 {@html} 真正落到 DOM 之前
	// 就执行，此时 querySelectorAll 一个都抓不到 —— 于是图片 src 永远 null、ANSI 代码块
	// 永远显示成原始转义序列（这正是之前「本地图片和 ANSI 都不渲染」的根因）。MutationObserver
	// 在子节点实际插入后才回调，彻底绕开时序问题，且对 {@html} 的整体替换、增量插入都覆盖。
	let domObserver: MutationObserver | undefined
	$effect(() => {
		const el = wrap
		if (!el) return
		domObserver?.disconnect()
		fillImages(el)
		renderAnsi(el)
		el.addEventListener('click', onCopyClick)
		domObserver = new MutationObserver(() => {
			fillImages(el)
			renderAnsi(el)
		})
		domObserver.observe(el, { childList: true, subtree: true })
		return () => {
			domObserver?.disconnect()
			el.removeEventListener('click', onCopyClick)
		}
	})

	// 图表（PlantUML / Mermaid）：按内容变化触发，async 渲染；图片与 ANSI 已由上面的 observer 处理
	$effect(() => {
		void view.html
		const el = wrap
		if (!el) return
		const timer = setTimeout(() => {
			void renderPlantuml(el).then(() => renderMermaid(el))
		}, 250)
		return () => clearTimeout(timer)
	})
</script>

<div class="md-preview" bind:this={wrap}>
	{#if isMdx}
		<div class="mdx-hint">
			MDX 安全预览：export 数据与 JSX 布局按 AST 静态还原，复制按钮由预览安全接管；
			自定义组件与无法安全求值的表达式会显式标注，脚本一律不执行。
		</div>
	{/if}
	{#if view.title}
		<h1 class="md-title">{view.title}</h1>
	{/if}
	{#if pending}
		<!-- 防抖期间给个明确反馈，否则用户会以为预览卡住了 -->
		<div class="md-pending" aria-live="polite">正在更新预览…</div>
	{/if}
	{#if view.tags.length}
		<div class="md-meta">
			{#each view.tags as t}
				<span class="tag">{t}</span>
			{/each}
			{#if view.date}
				<span class="muted">{view.date}</span>
			{/if}
		</div>
	{/if}
	<!-- HTML 由 lib/preview.ts 渲染（marked），内容来自用户自己的本地文档，等价于博客的渲染结果 -->
	<div class="md-body">{@html view.html}</div>
</div>

<style>
	.md-preview {
		height: 100%;
		overflow: auto;
		padding: 2px 4px;
	}
	.mdx-hint {
		background: var(--warn-bg);
		border: 1px solid #f0dcb4;
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 12.5px;
		color: #8a6d3b;
		margin-bottom: 10px;
	}
	.md-title {
		font-size: 22px;
		margin: 0 0 8px;
		line-height: 1.3;
	}
	/* 防抖期间的提示：低调一点，别抢内容的注意力 */
	.md-pending {
		font-size: 12px;
		color: var(--muted);
		margin: 0 0 8px;
	}
	.md-meta {
		display: flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.md-body {
		line-height: 1.8;
		font-size: 14.5px;
		/* 只在「一个词放不下」时才断，不用 word-break 硬断词（表格里另有更严格的处理） */
		overflow-wrap: break-word;
		/* MDX 模板来自博客主题，会引用这些主题变量；映射到管理器的调色板，
		   只在预览区内生效，不影响其他页面 */
		--primary: var(--accent);
		--line-divider: var(--line);
		--btn-content: var(--text);
		--deep-text: var(--text);
		--card-bg: #fff;
	}
	.md-body :global(h1),
	.md-body :global(h2),
	.md-body :global(h3),
	.md-body :global(h4) {
		margin: 22px 0 10px;
		line-height: 1.4;
	}
	.md-body :global(h1) {
		font-size: 21px;
	}
	.md-body :global(h2) {
		font-size: 18px;
		border-bottom: 1px solid var(--line);
		padding-bottom: 6px;
	}
	.md-body :global(h3) {
		font-size: 16px;
	}
	.md-body :global(p) {
		margin: 10px 0;
	}
	.md-body :global(a) {
		color: var(--accent);
	}
	.md-body :global(img) {
		max-width: 100%;
		border-radius: 8px;
	}
	.md-body :global(blockquote) {
		margin: 12px 0;
		padding: 6px 14px;
		border-left: 3px solid var(--accent);
		background: #f4faf9;
		color: #4a5568;
		border-radius: 0 8px 8px 0;
	}
	.md-body :global(code) {
		font-family: var(--mono);
		font-size: 13px;
		background: #eef1f5;
		border-radius: 5px;
		padding: 2px 6px;
	}
	.md-body :global(pre) {
		background: #f9fafb;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 14px 16px;
		overflow: auto;
		line-height: 1.6;
	}
	.md-body :global(pre code) {
		background: transparent;
		padding: 0;
		color: #383a42;
		font-size: 13px;
	}
	/* 表格：外层滚动容器承载横向滚动，表格本身按内容撑开（至少占满容器），
	   内容超宽时滚动容器内部滚动，不会把整个预览外层撑宽 */
	.md-body :global(.table-scroll) {
		overflow-x: auto;
		max-width: 100%;
		margin: 12px 0;
	}
	.md-body :global(.table-scroll > table) {
		width: max-content;
		min-width: 100%;
		margin: 0;
	}
	.md-body :global(table) {
		border-collapse: collapse;
		margin: 12px 0;
	}
	.md-body :global(th),
	.md-body :global(td) {
		border: 1px solid var(--line);
		padding: 6px 12px;
		text-align: left;
		min-width: 120px;
		/* 单元格内不做硬断词，保持字段完整；超宽交给外层横向滚动 */
		word-break: normal;
		overflow-wrap: normal;
	}
	/* 字段里的行内代码不折行，避免路径/命令被截断 */
	.md-body :global(td code),
	.md-body :global(th code) {
		white-space: nowrap;
	}
	.md-body :global(th) {
		background: #f3f6fa;
	}
	.md-body :global(hr) {
		border: none;
		border-top: 1px solid var(--line);
		margin: 18px 0;
	}
	.md-body :global(ul),
	.md-body :global(ol) {
		padding-left: 24px;
		margin: 10px 0;
	}
	.md-body :global(li) {
		margin: 4px 0;
	}
	/* 提示块（::: 与 [!NOTE]） */
	.md-body :global(.callout) {
		margin: 14px 0;
		border: 1px solid var(--line);
		border-left: 4px solid #4488f0;
		border-radius: 10px;
		padding: 10px 14px;
		background: #f5f9ff;
	}
	.md-body :global(.callout .co-title) {
		font-weight: 700;
		margin-bottom: 4px;
		text-transform: capitalize;
	}
	.md-body :global(.callout .co-body p) {
		margin: 6px 0;
	}
	.md-body :global(.co-note),
	.md-body :global(.co-info),
	.md-body :global(.co-abstract),
	.md-body :global(.co-quote) {
		border-left-color: #4488f0;
		background: #f5f9ff;
	}
	.md-body :global(.co-tip),
	.md-body :global(.co-success),
	.md-body :global(.co-check) {
		border-left-color: #2da44e;
		background: #f2fbf5;
	}
	.md-body :global(.co-warning),
	.md-body :global(.co-caution) {
		border-left-color: #e8a30c;
		background: #fffaf0;
	}
	.md-body :global(.co-danger),
	.md-body :global(.co-error),
	.md-body :global(.co-bug) {
		border-left-color: #d94b4b;
		background: #fff5f5;
	}
	.md-body :global(.co-important),
	.md-body :global(.co-example) {
		border-left-color: #9a63e8;
		background: #faf6ff;
	}
	/* ::github 仓库卡片 */
	.md-body :global(a.gh-card) {
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 14px;
		margin: 12px 0;
		text-decoration: none;
		color: var(--text);
		background: #fbfcfe;
	}
	.md-body :global(a.gh-card:hover) {
		border-color: var(--accent);
	}
	.md-body :global(.gh-card .gh-name) {
		font-weight: 600;
	}
	.md-body :global(.gh-card .gh-sub) {
		margin-left: auto;
		color: var(--muted);
		font-size: 12.5px;
	}
	/* ANSI 终端代码块（对齐 Firefly 主题 .frame.is-terminal 的深色终端风）*/
	.md-body :global(pre.ansi-box) {
		background: #1e1e1e;
		color: #d4d4d4;
		border: 1px solid #2d2d2d;
		line-height: 1.7;
	}
	.md-body :global(pre.ansi-box span) {
		font-family: var(--mono);
		font-size: 13px;
	}
	/* ansi 内部的 span 已经自带 inline style（color/background/font-weight 等），
	   这里只保证终端基底颜色，不覆盖 span 自身的 color。*/
	/* 图表容器 */
	.md-body :global(.mermaid-box),
	.md-body :global(.puml-box) {
		margin: 14px 0;
		text-align: center;
		overflow: auto;
		background: #fff;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 12px;
	}
	.md-body :global(.mermaid-box svg),
	.md-body :global(.puml-box img) {
		max-width: 100%;
	}
	/* KaTeX 展示公式横向滚动 */
	.md-body :global(.katex-display) {
		overflow-x: auto;
		overflow-y: hidden;
		padding: 4px 0;
	}

	/* ===== MDX 静态还原的降级提示 =====
	   只有 mdx.ts 真正产出的三个类：无法求值的表达式 / 未渲染的自定义组件 / 被安全策略拦下的标签 */
	.md-body :global(.mdx-unknown),
	.md-body :global(.mdx-component),
	.md-body :global(.mdx-blocked) {
		display: inline-block;
		font-size: 12px;
		color: #8a6d3b;
		background: var(--warn-bg);
		border: 1px dashed #f0dcb4;
		border-radius: 6px;
		padding: 1px 6px;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	/* ===== Tailwind utility 兼容层 =====
	   MDX 模板（如 friends.mdx）用 Tailwind 类名排版，而管理器不带 Tailwind。
	   这里只补模板实际用到的一组 utility，且全部限定在 .md-body 内，不污染其他页面。 */
	.md-body :global(.not-prose) {
		margin: 0;
	}
	/* 布局 */
	.md-body :global(.flex) {
		display: flex;
	}
	.md-body :global(.grid) {
		display: grid;
	}
	.md-body :global(.hidden) {
		display: none;
	}
	.md-body :global(.block) {
		display: block;
	}
	.md-body :global(.flex-1) {
		flex: 1 1 0%;
	}
	.md-body :global(.flex-col) {
		flex-direction: column;
	}
	.md-body :global(.shrink-0) {
		flex-shrink: 0;
	}
	.md-body :global(.grid-cols-1) {
		grid-template-columns: repeat(1, minmax(0, 1fr));
	}
	.md-body :global(.items-center) {
		align-items: center;
	}
	.md-body :global(.items-baseline) {
		align-items: baseline;
	}
	.md-body :global(.justify-between) {
		justify-content: space-between;
	}
	.md-body :global(.justify-center) {
		justify-content: center;
	}
	.md-body :global(.relative) {
		position: relative;
	}
	.md-body :global(.absolute) {
		position: absolute;
	}
	.md-body :global(.overflow-hidden) {
		overflow: hidden;
	}
	.md-body :global(.overflow-x-auto) {
		overflow-x: auto;
	}
	.md-body :global(.min-w-0) {
		min-width: 0;
	}
	.md-body :global(.object-cover) {
		object-fit: cover;
	}
	.md-body :global(.truncate) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.md-body :global(.whitespace-pre) {
		white-space: pre;
	}
	.md-body :global(.top-2) {
		top: 0.5rem;
	}
	.md-body :global(.right-2) {
		right: 0.5rem;
	}
	.md-body :global(.-bottom-1) {
		bottom: -0.25rem;
	}
	.md-body :global(.-right-1) {
		right: -0.25rem;
	}
	.md-body :global(.translate-y-\[-2px\]) {
		transform: translateY(-2px);
	}
	/* 尺寸 */
	.md-body :global(.w-full) {
		width: 100%;
	}
	.md-body :global(.h-full) {
		height: 100%;
	}
	.md-body :global(.w-0\.5) {
		width: 0.125rem;
	}
	.md-body :global(.w-1\.5) {
		width: 0.375rem;
	}
	.md-body :global(.w-3) {
		width: 0.75rem;
	}
	.md-body :global(.w-3\.5) {
		width: 0.875rem;
	}
	.md-body :global(.w-4) {
		width: 1rem;
	}
	.md-body :global(.w-4\.5) {
		width: 1.125rem;
	}
	.md-body :global(.w-5) {
		width: 1.25rem;
	}
	.md-body :global(.w-7) {
		width: 1.75rem;
	}
	.md-body :global(.w-16) {
		width: 4rem;
	}
	.md-body :global(.h-0\.5) {
		height: 0.125rem;
	}
	.md-body :global(.h-1\.5) {
		height: 0.375rem;
	}
	.md-body :global(.h-3) {
		height: 0.75rem;
	}
	.md-body :global(.h-3\.5) {
		height: 0.875rem;
	}
	.md-body :global(.h-4) {
		height: 1rem;
	}
	.md-body :global(.h-4\.5) {
		height: 1.125rem;
	}
	.md-body :global(.h-5) {
		height: 1.25rem;
	}
	.md-body :global(.h-7) {
		height: 1.75rem;
	}
	.md-body :global(.h-16) {
		height: 4rem;
	}
	/* 间距 */
	.md-body :global(.p-4) {
		padding: 1rem;
	}
	.md-body :global(.p-5) {
		padding: 1.25rem;
	}
	.md-body :global(.px-1\.5) {
		padding-left: 0.375rem;
		padding-right: 0.375rem;
	}
	.md-body :global(.px-3) {
		padding-left: 0.75rem;
		padding-right: 0.75rem;
	}
	.md-body :global(.py-0\.5) {
		padding-top: 0.125rem;
		padding-bottom: 0.125rem;
	}
	.md-body :global(.py-2) {
		padding-top: 0.5rem;
		padding-bottom: 0.5rem;
	}
	.md-body :global(.pr-10) {
		padding-right: 2.5rem;
	}
	.md-body :global(.pb-4) {
		padding-bottom: 1rem;
	}
	.md-body :global(.gap-2) {
		gap: 0.5rem;
	}
	.md-body :global(.gap-2\.5) {
		gap: 0.625rem;
	}
	.md-body :global(.gap-3\.5) {
		gap: 0.875rem;
	}
	.md-body :global(.gap-4) {
		gap: 1rem;
	}
	.md-body :global(.mb-0\.5) {
		margin-bottom: 0.125rem;
	}
	.md-body :global(.mb-1) {
		margin-bottom: 0.25rem;
	}
	.md-body :global(.mb-4) {
		margin-bottom: 1rem;
	}
	.md-body :global(.mb-5) {
		margin-bottom: 1.25rem;
	}
	.md-body :global(.mt-0\.5) {
		margin-top: 0.125rem;
	}
	.md-body :global(.mt-4) {
		margin-top: 1rem;
	}
	.md-body :global(.my-1\.5) {
		margin-top: 0.375rem;
		margin-bottom: 0.375rem;
	}
	.md-body :global(.my-4) {
		margin-top: 1rem;
		margin-bottom: 1rem;
	}
	.md-body :global(.space-y-2\.5 > * + *) {
		margin-top: 0.625rem;
	}
	.md-body :global(.space-y-3 > * + *) {
		margin-top: 0.75rem;
	}
	.md-body :global(.space-y-0 > * + *) {
		margin-top: 0;
	}
	/* 边框 / 圆角 */
	.md-body :global(.border) {
		border-width: 1px;
		border-style: solid;
		border-color: var(--line-divider);
	}
	.md-body :global(.border-\(--line-divider\)) {
		border-color: var(--line-divider);
	}
	.md-body :global(.rounded) {
		border-radius: 0.25rem;
	}
	.md-body :global(.rounded-md) {
		border-radius: 0.375rem;
	}
	.md-body :global(.rounded-lg) {
		border-radius: 0.5rem;
	}
	.md-body :global(.rounded-xl) {
		border-radius: 0.75rem;
	}
	.md-body :global(.rounded-2xl) {
		border-radius: 1rem;
	}
	.md-body :global(.rounded-full) {
		border-radius: 9999px;
	}
	/* 颜色 */
	.md-body :global(.bg-\(--primary\)) {
		background-color: var(--primary);
	}
	.md-body :global(.bg-\(--primary\)\/10) {
		background-color: color-mix(in srgb, var(--primary) 10%, transparent);
	}
	.md-body :global(.bg-\(--line-divider\)) {
		background-color: var(--line-divider);
	}
	.md-body :global(.bg-black\/5) {
		background-color: rgba(0, 0, 0, 0.05);
	}
	.md-body :global(.bg-black\/10) {
		background-color: rgba(0, 0, 0, 0.1);
	}
	.md-body :global(.bg-white\/5) {
		background-color: rgba(255, 255, 255, 0.05);
	}
	.md-body :global(.bg-white\/10) {
		background-color: rgba(255, 255, 255, 0.1);
	}
	.md-body :global(.text-\(--primary\)) {
		color: var(--primary);
	}
	.md-body :global(.text-\(--btn-content\)) {
		color: var(--btn-content);
	}
	.md-body :global(.text-white) {
		color: #fff;
	}
	.md-body :global(.text-green-500) {
		color: #22c55e;
	}
	.md-body :global(.text-neutral-200) {
		color: #e5e5e5;
	}
	.md-body :global(.text-neutral-400) {
		color: #a3a3a3;
	}
	.md-body :global(.text-neutral-500) {
		color: #737373;
	}
	.md-body :global(.text-neutral-600) {
		color: #525252;
	}
	.md-body :global(.text-neutral-800) {
		color: #262626;
	}
	/* 阴影 / 描边 */
	.md-body :global(.ring-2) {
		box-shadow: 0 0 0 2px var(--tw-ring-color, color-mix(in srgb, var(--primary) 20%, transparent));
	}
	.md-body :global(.ring-\(--primary\)\/20) {
		--tw-ring-color: color-mix(in srgb, var(--primary) 20%, transparent);
	}
	.md-body :global(.shadow) {
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
	}
	/* 文字 */
	.md-body :global(.text-xs) {
		font-size: 0.75rem;
		line-height: 1rem;
	}
	.md-body :global(.text-sm) {
		font-size: 0.875rem;
		line-height: 1.25rem;
	}
	.md-body :global(.text-base) {
		font-size: 1rem;
		line-height: 1.5rem;
	}
	.md-body :global(.text-lg) {
		font-size: 1.125rem;
		line-height: 1.75rem;
	}
	.md-body :global(.text-\[0\.65rem\]) {
		font-size: 0.65rem;
	}
	.md-body :global(.text-\[0\.7rem\]) {
		font-size: 0.7rem;
	}
	.md-body :global(.font-medium) {
		font-weight: 500;
	}
	.md-body :global(.font-semibold) {
		font-weight: 600;
	}
	.md-body :global(.font-bold) {
		font-weight: 700;
	}
	.md-body :global(.leading-relaxed) {
		line-height: 1.625;
	}
	/* 交互 */
	.md-body :global(.transition-opacity) {
		transition: opacity 0.15s ease;
	}
	.md-body :global(.cursor-pointer) {
		cursor: pointer;
	}
	.md-body :global(.hover\:opacity-80:hover) {
		opacity: 0.8;
	}
	/* 断点（与 Tailwind 默认一致） */
	@media (min-width: 640px) {
		.md-body :global(.sm\:p-6) {
			padding: 1.5rem;
		}
	}
	@media (min-width: 1024px) {
		.md-body :global(.lg\:grid-cols-2) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
