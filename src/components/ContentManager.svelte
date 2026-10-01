<script lang="ts">
	import { getContext } from 'svelte'
	// pinyin-pro 不在顶层引入：它压缩后约 850KB，只在「新建文件时生成 slug」用得上，
	// 改成在 makeSlug() 里动态载入（见下方说明）
	import DragBar from './DragBar.svelte'
	import MarkdownPreview from './MarkdownPreview.svelte'
	import type { ContentItem } from '../lib/api'
	import { errMsg } from '../lib/err'
	import { confirmDanger } from '../lib/confirm.svelte'
	import { readLayoutNumber, saveLayoutUi } from '../lib/layout'
	import { allImageFiles, extForMime, fileToBase64, pastedStamp } from '../lib/paste-image'
	import type { FieldDef } from '../lib/schema-types'

	interface Props {
		/** 集合名（.fireflux.yml 里的 collections 键，如 posts / dynamic）；不再写死 */
		folder: string
		title: string
		icon?: string
		canCreate?: boolean
		createKind?: 'post' | 'project' | 'dynamic'
		createLabel?: string
		canImage?: boolean
		hint?: string
		/**
		 * 嵌到别的页面里用（例如「动态发布 → 本地发布」的文件列表）：
		 * 隐藏自带的大标题与顶部按钮，只保留「列表 + 编辑器」两栏。
		 */
		embedded?: boolean
		/** 集合声明的特性（clone / rename_id / git_log 等），缺省全开 */
		features?: string[]
	}
	let {
		folder,
		title,
		icon = '📄',
		canCreate = false,
		createKind,
		createLabel = '新建',
		canImage = false,
		hint = '',
		embedded = false,
		features
	}: Props = $props()
	const hasFeat = (f: string): boolean => !features || features.includes(f)

	/**
	 * 这条内容是不是「动态」。
	 *
	 * 动态与文章 / 项目有三处结构性差异，全部由这一个标志分流：
	 * 1. **文件名由后端按时间戳生成**（`2026-09-26-015700.md`），前端拿不到，
	 *    所以不能像文章那样先填标题 / slug 再创建；
	 * 2. 正文的 frontmatter 多两个字段 `pinned` / `location`，得在编辑器顶部直接改；
	 * 3. **未落盘也要能插图** —— 见下面 `ensureDraft()`。
	 *
	 * 这里是 `$derived` 而不是普通 const：`folder` 是 prop，虽然实际用起来不会变，
	 * 但用 `$derived` 才符合 runes 的语义（普通 const 在 props 变化时不会跟着更新）。
	 */
	const isDynamic = $derived(folder === 'dynamic')

	let items = $state<ContentItem[]>([])
	let active = $state('')
	let text = $state('')
	let dirty = $state(false)
	let busy = $state(false)
	let refreshing = $state(false)
	let showNew = $state(false)
	let newTitle = $state('')
	let newSlug = $state('')
	let filter = $state('')
	let viewMode = $state<'edit' | 'split' | 'preview'>('preview')
	// 中间那条分隔条调的是「编辑器宽度」，列表吃掉剩下的空间（列表 flex:1、编辑器定宽）。
	// 这样两条分隔条互不干扰：拖侧栏那条只动列表的左边界，编辑器右对齐、宽度不变，
	// 于是中间那条分界线纹丝不动；拖中间那条只动分界线，侧栏那条也不动
	let editorW = $state(readLayoutNumber('editorWidth', 560))
	function setEditorW(w: number): void {
		editorW = w
	}
	function persistEditorW(w: number): void {
		saveLayoutUi({ editorWidth: Math.round(w) })
	}

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	/**
	 * 「这条动态还没落盘」时的**草稿路径**（只有动态会用，其它类型恒为空）。
	 *
	 * 动态的 md 文件名由后端按时间戳生成，前端在 `contentCreate` 返回之前拿不到它。
	 * 但「插入 / 粘贴图片」必须知道图片该进哪个附件目录（= 与 md 同名的目录），
	 * 所以采用**先落盘再插图**：第一次插图 / 粘贴时先把当前正文存成一条真动态，
	 * 之后的插图、粘贴、保存全部作用在这个文件上。
	 *
	 * ⚠️ 落盘之后再保存**必须覆盖同一个文件**（`fileWrite`），不能再 `contentCreate` ——
	 * 否则图片留在旧文件旁边的附件目录里，正文却跑到了新文件里，附件立刻变成孤儿。
	 */
	let draftRel = $state('')

	/** 动态专用的三个 frontmatter 字段（打开时从正文里解析出来，保存时再拼回去） */
	let dynPinned = $state(false)
	let dynLocation = $state('')
	/**
	 * 原来的 `published`（`2026-07-15 16:15:29` 这种）。
	 *
	 * **保存时原样写回**，绝不刷新成「现在」—— 主题按它倒序排动态、又拿它当发布时间显示，
	 * 改了它等于把这条动态移到列表最上面并篡改日期（见 `withDynFrontmatter()` 的说明）。
	 * 空串 = 读不到（新建的草稿），此时才用当前时间。
	 */
	let dynPublished = $state('')

	async function load(): Promise<void> {
		try {
			items = await window.api.contentList(folder)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}
	$effect(() => {
		void load()
	})

	/**
	 * 刷新：重新从磁盘同步文件列表；如果当前打开的文件没有未保存改动，
	 * 连正文一起重新读一遍（在编辑器/其它工具里改了文件时很有用）。
	 */
	async function refresh(): Promise<void> {
		if (refreshing) return
		refreshing = true
		try {
			await load()
			if (active && !dirty) {
				text = await window.api.fileRead(active)
				if (isDynamic) parseDynFrontmatter(text)
				notify('已刷新：文件列表与当前内容都已同步')
			} else if (active) {
				notify('文件列表已刷新（当前内容有未保存修改，正文未重新读取）')
			} else {
				notify('文件列表已刷新')
			}
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			refreshing = false
		}
	}

	async function open(rel: string): Promise<void> {
		if (dirty && !await confirmDanger('当前内容未保存，确定切换？')) return
		try {
			text = await window.api.fileRead(rel)
			active = rel
			dirty = false
			// 打开的就是那条动态本身，此前攒的草稿路径作废
			draftRel = ''
			// 先清空，再按这份文件重新解析 —— 否则上一条动态的 published 会漏给这一条
			dynPublished = ''
			if (isDynamic) parseDynFrontmatter(text)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	/**
	 * 从动态正文的 frontmatter 里读出 `published` / `pinned` / `location`。
	 * 前两个字段进顶部控件，`published` 只用于保存时原样保留。
	 *
	 * 只认文件开头那一段 `---…---`，正文里出现的 `---` 分隔线不受影响。
	 * 读不到就当默认值，不算错误：主题里老动态的 frontmatter 形态不完全一致。
	 * 实测 `2026-07-15-*.md` 的 `location: 皮诺康尼` 不带引号，而且没有 `pinned` 行。
	 */
	function parseDynFrontmatter(src: string): void {
		const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)
		const head = m?.[1] ?? ''
		const pin = /^\s*pinned:\s*(true|false)\s*$/m.exec(head)
		const loc = /^\s*location:\s*"?(.*?)"?\s*$/m.exec(head)
		const pub = /^\s*published:\s*(.+?)\s*$/m.exec(head)
		dynPinned = pin?.[1] === 'true'
		dynLocation = loc?.[1] ?? ''
		// 没读到就留空：`withDynFrontmatter()` 才补一个「现在」
		dynPublished = pub?.[1] ?? ''
	}

	/**
	 * 把正文换成「带上下三个字段的 frontmatter」的版本。
	 *
	 * 打开已有文件时正文里本来就带 frontmatter（`contentList` 列出来的是整份文件），
	 * 这里把它整段替换掉；新建的草稿（`draftRel` 为空时）正文是纯文本，直接拼一段上去。
	 *
	 * `published` 必须保留原值，不能在每次保存时改成「现在」。主题的
	 * `dynamic-utils.ts` 按 `published` 倒序排列动态，`DynamicItem.astro` 又把它当
	 * 发布时间显示。一旦改写成「现在」，编辑一条旧动态就会让它跳到列表最上面、
	 * 日期也变成今天，等于悄悄篡改了发布时间。只有新建（原值读不到）时才用当前时间。
	 */
	function withDynFrontmatter(src: string): string {
		const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\s+/, '')
		const q = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
		const published = dynPublished || nowStamp()
		return `---\npublished: ${published}\npinned: ${dynPinned}\nlocation: "${q(dynLocation)}"\n---\n\n${body.replace(/\s+$/, '')}\n`
	}

	/** `2026-09-26 01:57:00`（与后端 `datetime::now()` 同格式，本地时区） */
	function nowStamp(): string {
		const d = new Date()
		const p = (n: number): string => String(n).padStart(2, '0')
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
	}

	/**
	 * 确保当前编辑的动态已经落盘，返回它的项目内相对路径。
	 *
	 * 三种情况：
	 * - 已经打开了一个文件（`active`）→ 就是它；
	 * - 已经在这次编辑里落过盘（`draftRel`）→ 复用，避免插图散成好几个附件目录；
	 * - 都还没有 → 按当前正文新建一条动态，`contentCreate` 返回真实路径。
	 */
	async function ensureDraft(): Promise<string> {
		if (active) return active
		if (draftRel) return draftRel
		const rel = await window.api.contentCreate({
			folder: 'dynamic',
			kind: 'dynamic',
			content: text,
			pinned: dynPinned,
			location: dynLocation
		})
		draftRel = rel
		// 新文件已经落盘：把列表重新列一遍，让这条动态立刻出现在左侧
		await load()
		return rel
	}

	async function save(): Promise<void> {
		if (!active && !isDynamic) return
		busy = true
		try {
			if (isDynamic) {
				// 动态保存 = 「把正文（连同 pinned / location）写回同一个文件」。
				// 还没落盘的草稿要先它变成真文件，否则正文没地方写。
				const rel = await ensureDraft()
				await window.api.fileWrite(rel, withDynFrontmatter(text))
				// 正文里的 frontmatter 也被换成了新的，回读一次让两边一致
				text = await window.api.fileRead(rel)
				active = rel
				draftRel = ''
				dirty = false
				parseDynFrontmatter(text)
				notify('动态已保存并推送（云端构建后生效）！')
				await load()
				return
			}
			await window.api.fileWrite(active, text)
			dirty = false
			notify('已保存并推送（云端构建后生效）')
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}


	/** 改名：把当前文件 slug 改成新值（后端一次原子提交完成，正文里的图片路径同步改） */
	let showRename = $state(false)
	let renameTo = $state('')
	async function rename(): Promise<void> {
		renameTo = active.replace(`src/content/${folder}/`, '').replace(/\.mdx?$/, '').replace(/\/index$/, '')
		showRename = true
	}
	async function doRename(): Promise<void> {
		const ns = renameTo.trim()
		if (!ns || ns === active || busy) return
		busy = true
		try {
			const rel = await window.api.contentRename(active, ns)
			showRename = false
			renameTo = ''
			await load()
			await open(rel)
			notify(`已改名为 ${ns}`)
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	let showLogPanel = $state(false)
	let logItems = $state<{ sha: string; message: string; date: string }[]>([])
	async function showLog(): Promise<void> {
		if (!active) return
		showLogPanel = true
		logItems = []
		try {
			logItems = await window.api.itemLog(active)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function remove(): Promise<void> {
		if (!active) return
		if (
			!await confirmDanger(
				`确定删除 ${active} 吗？`,
				'这是软删除：文件会连同与它同名的附件目录一起移到项目回收站。',
				'误删可以在左侧「回收站」页一键恢复；推送后网站上才会消失。'
			)
		)
			return
		try {
			const moved = await window.api.fileDelete(active)
			active = ''
			text = ''
			dirty = false
			await load()
			notify(
				moved.length > 1
					? `已移入回收站（共 ${moved.length} 项，含附件目录）；可在「回收站」页恢复`
					: '已移入回收站；可在「回收站」页恢复'
			)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	/**
	 * 中文标题 → 拼音 slug。
	 *
	 * pinyin-pro 的词典压缩后约 850KB，是整个初始包里最大的一块。
	 * 但它**只在新建文件时**才用得上（给中文标题自动生成 slug），
	 * 启动时就把它加载进来太亏了 —— 这里改成按需动态载入。
	 */
	async function makeSlug(t: string): Promise<string> {
		const { pinyin } = await import('pinyin-pro')
		const s = pinyin(t, { toneType: 'none', type: 'array' })
			.join('-')
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-+|-+$/g, '')
		return s || 'untitled'
	}

	/**
	 * 新建。
	 *
	 * 文章 / 项目：先弹一个小表单填标题与 slug（slug 由中文标题转拼音）。
	 * 动态：**没有表单** —— 文件名由后端按时间戳生成，标题 / slug 对它毫无意义，
	 * 所以点一下就直接建好一条空动态并打开，用户接着写正文即可。
	 */
	async function create(): Promise<void> {
		if (!createKind) return
		busy = true
		try {
			if (createKind === 'dynamic') {
				// 全新的一条：published 留给后端模板/首次保存生成（不能用上一条动态的值）
				dynPublished = ''
				dynPinned = false
				dynLocation = ''
				const rel = await window.api.contentCreate({
					folder,
					kind: 'dynamic',
					content: '',
					pinned: false,
					location: ''
				})
				await load()
				await open(rel)
				notify('已新建一条动态，写完记得保存')
				return
			}
			const rel = await window.api.contentCreate({
				folder,
				kind: createKind,
				title: newTitle || '未命名',
				slug: newSlug.trim() || (await makeSlug(newTitle || 'untitled'))
			})
			showNew = false
			newTitle = ''
			newSlug = ''
			await load()
			await open(rel)
			notify('已创建，写完记得「发布上线」推送')
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	/**
	 * 克隆当前打开的文件：后端复制文件本体（连同同名附件目录，并改写正文引用），
	 * 文件名 = 原名 + 「设置 → 克隆设置」里该类型的后缀。克隆完直接打开副本，
	 * 用户可以马上改内容，而原文件一个字节都没动。
	 */
	async function clone(): Promise<void> {
		if (!active || busy) return
		busy = true
		try {
			const rel = await window.api.contentClone(active)
			await load()
			await open(rel)
			notify(`已克隆为 ${rel.replace(`src/content/${folder}/`, '')}（标题已加「（副本）」），可以接着改这一份`)
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	/**
	 * 插入本地图片：复制到**与当前 Markdown 同名**的附件目录（`a.md` → `a/`），
	 * 引用是相对当前文件的 `./a/xxx.jpg`。
	 *
	 * 旧实现统一放进 `posts/images/` 并写 `../images/xxx.jpg` —— 那个路径既解析不到
	 * （主题按同名附件目录解析），删除 / 克隆时也不会被一起带走。详见
	 * `src-tauri/src/engine/attachments.rs` 的文件头。
	 */
	async function addImage(): Promise<void> {
		// 动态允许「先插图再落盘」（见 ensureDraft）；其它类型必须先在左侧打开一个文件
		if (!active && !isDynamic) {
			notify('先从左侧打开一篇内容，再插入图片', false)
			return
		}
		try {
			const rel = isDynamic ? await ensureDraft() : active
			const refs = await window.api.contentAddImage(rel)
			if (!refs.length) return
			insertAtCursor(refs.map((r) => `![](${r})`).join('\n'))
			notify(`图片已传到图床，引用已插入（${refs.length} 张）`)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	/** 编辑框元素与「把一段文本插入光标处」 */
	let box = $state<HTMLTextAreaElement | undefined>(undefined)
	/**
	 * 在光标处插入文本（没有焦点 / 没打开文件时退化为追加到文末）。
	 *
	 * 插入后把光标放到插入内容**之后**，这样连续插入多张图时顺序不会反过来。
	 */
	function insertAtCursor(snippet: string): void {
		const el = box
		if (!el || active === '') {
			text = text.replace(/\s*$/, '') + `\n\n${snippet}`
			dirty = true
			return
		}
		const pos = el.selectionStart ?? text.length
		const before = text.slice(0, pos)
		const after = text.slice(pos)
		// 前后各补一个换行，避免图片挤进上一行的文字里
		const pad = before.endsWith('\n') || before === '' ? '' : '\n'
		const insert = `${pad}${snippet}\n`
		text = before + insert + after
		dirty = true
		const next = before.length + insert.length
		// 等 Svelte 把新值写回 DOM 之后再定位光标，否则会被重置到末尾
		requestAnimationFrame(() => {
			el.focus()
			el.setSelectionRange(next, next)
		})
	}

	/**
	 * 粘贴图片：从剪贴板取图片写进附件目录，并把引用插到**光标处**。
	 *
	 * 剪贴板里同时有文字时（Word / 部分网页会这样），文字照常粘进来（不拦），
	 * 图片另外追加 —— 两边都不丢。
	 */
	async function onPaste(e: ClipboardEvent): Promise<void> {
		// 动态没有打开文件也能粘：先按当前正文落一条草稿，图片进它的附件目录
		if (!active && !isDynamic) return
		const files = allImageFiles(e.clipboardData)
		if (!files.length) return
		// 纯图片剪贴板没有文本：拦下默认行为，否则会粘出一个空行
		if (!e.clipboardData?.getData('text/plain')) e.preventDefault()
		const stamp = pastedStamp()
		const refs: string[] = []
		try {
			const rel = isDynamic ? await ensureDraft() : active
			for (const [i, f] of files.entries()) {
				const ext = extForMime(f.type)
				const suffix = files.length > 1 ? `-${i + 1}` : ''
				const name = `${stamp}${suffix}.${ext}`
				const ref = await window.api.contentPasteImage(rel, name, await fileToBase64(f))
				refs.push(`![](${ref})`)
			}
			if (refs.length) {
				insertAtCursor(refs.join('\n'))
				notify(`已粘贴 ${refs.length} 张图片到图床`)
			}
		} catch (err) {
			notify(errMsg(err), false)
		}
	}

	const filtered = $derived(items.filter((i) => !filter || i.rel.toLowerCase().includes(filter.toLowerCase())))
</script>

<div class="cm-page">
<div class="row" style="justify-content:space-between; margin-bottom:10px">
	{#if embedded}
		<div class="row">
			<h3 style="margin:0">{icon} {title}</h3>
			<span class="muted">共 {items.length} 个文件</span>
		</div>
	{:else}
		<h2 style="margin:0">{icon} {title}</h2>
	{/if}
	<div class="row">
		<button class="btn" onclick={refresh} disabled={refreshing} title="重新从磁盘同步文件列表与当前内容">
			↻ 刷新
		</button>
		{#if canImage}
			<button class="btn" onclick={addImage}>🖼️ 插图（传图床）</button>
		{/if}

		{#if canCreate}
			<!-- 动态没有「标题 / slug」要填，点一下直接建一条空动态并打开 -->
			<button
				class="btn primary"
				onclick={createKind === 'dynamic' ? create : () => (showNew = !showNew)}
				disabled={busy}
			>
				＋ {createLabel}
			</button>
		{/if}
	</div>
</div>
{#if hint && !embedded}<p class="muted" style="margin-top:0">{hint}</p>{/if}

<!-- 三个视图模式里重复出现的两个块（编辑框 / 预览），抽成 snippet 保持一致 -->
{#snippet editor()}
	<textarea
		class="code"
		rows="22"
		bind:this={box}
		bind:value={text}
		oninput={() => (dirty = true)}
		onpaste={onPaste}
		placeholder="支持直接粘贴截图：Ctrl+V 会把图片存进本篇的附件目录并插入引用"
	></textarea>
{/snippet}
{#snippet preview()}
	<MarkdownPreview content={text} rel={active} isMdx={active.toLowerCase().endsWith('.mdx')} />
{/snippet}

{#if showRename && active}
	<div class="card" style="margin-bottom:12px">
		<h3>文件改名</h3>
		<div class="row">
			<input placeholder="新 slug（可含子路径，如 guide/new-name）" bind:value={renameTo} style="max-width:340px" />
			<button class="btn primary" onclick={doRename} disabled={busy || !renameTo.trim()}>改名</button>
			<button class="btn" onclick={() => (showRename = false)}>取消</button>
		</div>
		<p class="hint">目录式条目（{`{slug}`}/index.md）会同步改目录名与正文里的图片相对路径；这一次改动作为一个 git 提交。</p>
	</div>
{/if}

{#if showNew && canCreate && createKind !== 'dynamic'}
	<div class="card" style="margin-bottom:12px" data-ff-block="content/new">
		<h3>{createLabel}</h3>
		<div class="row">
			<input placeholder="标题" bind:value={newTitle} style="max-width:300px" oninput={async () => (newSlug = await makeSlug(newTitle))} />
			<input placeholder="文件名 / slug（自动生成，可改）" bind:value={newSlug} style="max-width:300px" />
			<button class="btn primary" onclick={create} disabled={busy}>创建</button>
		</div>
		<p class="hint">标题中文会自动转拼音作为文件名和 slug（与博客 new-post 脚本行为一致）。</p>
	</div>
{/if}

<div class="cm-layout">
	<div class="card cm-list">
		<input placeholder="搜索文件…" bind:value={filter} style="margin-bottom:8px" />
		<div class="cm-chips">
			{#each filtered as it}
				<button class="cm-item" class:active={active === it.rel} onclick={() => open(it.rel)} title={it.rel}>
					{it.rel.replace(`src/content/${folder}/`, '')}
				</button>
			{/each}
		</div>
		{#if !filtered.length}<p class="muted">（空）</p>{/if}
	</div>
	<!-- side="left"：手柄在编辑器左侧，往左拖才是把编辑器拖宽（分界线始终跟手） -->
	<DragBar side="left" width={editorW} onresize={setEditorW} onfinish={persistEditorW} />
	<div class="card cm-editor" style="width:{editorW}px">
		{#if !active && !isDynamic}
			<p class="muted">从左侧选择文件开始编辑；或导入/新建。</p>
		{:else}
			<div class="row" style="justify-content:space-between; margin-bottom:8px">
				<code style="font-size:12.5px">{active || '（未保存的新动态）'}</code>
				<div class="row">
					<div class="row seg">
						<button class="btn small" class:primary={viewMode === 'edit'} onclick={() => (viewMode = 'edit')}>✏️ 编辑</button>
						<button class="btn small" class:primary={viewMode === 'split'} onclick={() => (viewMode = 'split')}>⬒ 分屏</button>
						<button class="btn small" class:primary={viewMode === 'preview'} onclick={() => (viewMode = 'preview')}>👁 预览</button>
					</div>
					{#if dirty}<span class="tag" style="background:#fff3cd; color:#8a6d3b">未保存</span>{/if}
					{#if active}
						{#if hasFeat('clone')}
							<button
								class="btn cm-clone"
								onclick={clone}
								disabled={busy}
								title="复制一份（文件名加「-副本」后缀；正文的图片引用会一起改）"
							>
								🧬 克隆
							</button>
						{/if}
						{#if hasFeat('rename_id')}
							<button class="btn" onclick={rename} disabled={busy} title="重命名当前文件 slug（目录式条目会同步改目录和正文引用）">
								✏️ 改名
							</button>
						{/if}
						{#if hasFeat('git_log')}
							<button class="btn" onclick={showLog} disabled={busy} title="这个文件的提交历史">🕘 历史</button>
						{/if}
						<button class="btn" onclick={remove}>删除</button>
					{/if}
					<button class="btn primary" onclick={save} disabled={(!dirty && !!active) || busy}>保存</button>
				</div>
			</div>
			{#if isDynamic}
				<!-- 动态专属的两个 frontmatter 字段：跟正文一起保存 -->
				<div class="row cm-dyn-meta">
					<label class="row" style="gap:6px">
						<input type="checkbox" bind:checked={dynPinned} onchange={() => (dirty = true)} style="width:auto" /> 置顶
					</label>
					<input
						placeholder="位置（可选，如：皮诺康尼）"
						bind:value={dynLocation}
						oninput={() => (dirty = true)}
						style="max-width:220px"
					/>
					<span class="muted">文件名按保存时间自动生成，无需填写</span>
				</div>
			{/if}
			{#if viewMode === 'edit'}
				{@render editor()}
			{:else if viewMode === 'split'}
				<div class="split">
					{@render editor()}
					{@render preview()}
				</div>
			{:else}
				<div class="solo-preview">
					{@render preview()}
				</div>
			{/if}
		{/if}
	</div>
</div>

{#if showLogPanel}
	<div class="card" style="margin-top:12px">
		<div class="row" style="justify-content:space-between; margin-bottom:8px">
			<h3 style="margin:0">🕘 提交历史</h3>
			<button class="btn small" onclick={() => (showLogPanel = false)}>关闭</button>
		</div>
		{#if !logItems.length}
			<p class="muted">{active ? '暂无，或此文件还没有提交记录。' : '先打开一个文件。'}</p>
		{:else}
			{#each logItems as l}
				<div class="row" style="gap:10px; padding:4px 0; border-bottom:1px dashed var(--line)">
					<code style="font-size:12px">{l.sha}</code>
					<span style="flex:1">{l.message}</span>
					<span class="muted">{l.date.slice(0, 16).replace('T', ' ')}</span>
				</div>
			{/each}
		{/if}
	</div>
{/if}
</div>

<style>
	.cm-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-sizing: border-box;
	}
	.cm-layout {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 14px;
		align-items: stretch;
	}
	.cm-list {
		/* 列表吃掉剩余宽度：拖侧栏那条分隔条时只有它的宽度变化，
		   右边界（也就是中间分界线）跟着编辑器一起钉在右边不动。
		   flex-basis 必须是 0：写成 220px 会让列表和「定宽的编辑器」一起参与收缩，
		   结果编辑器被挤得比拖出来的宽度还窄（拖到 720 只渲染 649）。
		   min-width 是拖拽下界（DragBar 从 CSS 读，不再写死像素上限） */
		flex: 1 1 0;
		min-width: 130px;
		height: 100%;
		overflow: auto;
		box-sizing: border-box;
	}
	.cm-item {
		display: block;
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		border-radius: 8px;
		padding: 7px 10px;
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
	}
	.cm-item:hover {
		background: #f3f8f8;
		color: var(--accent);
	}
	.cm-item.active {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}
	.cm-editor {
		/* 宽度由中间那条分隔条控制（width 内联）；min-width 是拖拽下界 */
		flex-shrink: 1;
		min-width: 230px;
		min-height: 0;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		overflow: hidden;
	}
	.cm-editor > .row {
		flex-shrink: 0;
	}
	/* 动态的「置顶 / 位置」一行：跟着标题行一起固定在编辑器顶部 */
	.cm-dyn-meta {
		flex-shrink: 0;
		margin-bottom: 8px;
		gap: 10px;
	}
	.cm-editor textarea.code {
		flex: 1;
		min-height: 0;
	}
	.split {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 12px;
	}
	.split textarea {
		flex: 1;
		min-width: 0;
		height: 100%;
		resize: none;
	}
	.split :global(.md-preview) {
		flex: 1;
		min-width: 0;
		border-left: 1px dashed var(--line);
		padding-left: 14px;
	}
	.solo-preview {
		flex: 1;
		min-height: 0;
	}
	.seg {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 2px;
		gap: 2px;
	}
	.seg .btn {
		border: none;
	}
</style>
