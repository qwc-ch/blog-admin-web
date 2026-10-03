<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import ContentManager from '../components/ContentManager.svelte'
	import type { ConfigReadResult } from '../lib/api'
	import { errMsg } from '../lib/err'
	import { confirmDanger } from '../lib/confirm.svelte'

	let tab = $state<'remote' | 'local'>('remote')
	let memosUrl = $state('')
	let memosEnabled = $state(true)
	let loaded = $state(false)
	/** 本地文件列表的刷新键：自增即重新挂载 ContentManager，重新从磁盘列文件 */
	let localKey = $state(0)
	let refreshing = $state(false)

	// ===== 直接发布（Memos API，token 在 CF 环境变量，前端不接触） =====
	interface MemoItem {
		id: string
		content: string
		createTime: string
		visibility: string
		pinned: boolean
		tags: string[]
		/** Memos 原生附件（图片就存在 Memos 那边，不是博客图床） */
		attachments?: { name: string; filename: string; type: string; url: string }[]
	}
	/**
	 * 待发布图片。`preview` 是本地 object URL：
	 * Memos 对**还没挂到动态上**的附件匿名返回 403，直接拿附件地址当 `<img src>` 会裂，
	 * 所以发布前用本地预览图，发布后改用动态自带附件的地址。
	 */
	interface PendingImage {
		name: string
		id?: string | number
		uid?: string
		filename: string
		preview: string
	}
	let memos = $state<MemoItem[]>([])
	let memosLoading = $state(false)
	let composing = $state('')
	let visibility = $state<'PUBLIC' | 'PROTECTED' | 'PRIVATE'>('PUBLIC')
	let publishing = $state(false)
	let uploading = $state(false)
	/** 已传进 Memos 附件库、等着随这条动态一起挂上去的图片 */
	let pending = $state<PendingImage[]>([])
	/** 附件图匿名读不到（私密/保护动态）时按 url 记一笔，显示占位而不是裂图 */
	let imgFailed = $state<Record<string, boolean>>({})
	/** 发布成功后自动滚动到最新一条 */
	let memoListEl = $state<HTMLElement | null>(null)
	/** 站点预览 iframe：默认折叠，点开才加载（省流量，也避免手机端白屏） */
	let previewOpen = $state(false)
	let wvEl = $state<HTMLIFrameElement | null>(null)
	let wvState = $state<'idle' | 'loading' | 'loaded'>('idle')

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	const VIS_LABEL: Record<string, string> = {
		PUBLIC: '公开',
		PROTECTED: '保护',
		PRIVATE: '私密'
	}

	function visLabel(v: string): string {
		return VIS_LABEL[v] ?? v
	}

	/** 只读主题配置里的 memos.apiUrl / enable；拿不到就按「没有远端」处理 */
	async function loadConfig(applyDefaultTab = false): Promise<void> {
		try {
			const res: ConfigReadResult = await window.api.configRead({
				rel: 'src/config/dynamicConfig.ts',
				kind: 'ts',
				exports: ['dynamicConfig']
			})
			if (res.kind !== 'ts') return
			const dyn = res.exports.find((x) => x.name === 'dynamicConfig')?.values as
				| { memos?: { enable?: boolean; apiUrl?: string } }
				| undefined
			if (dyn?.memos?.apiUrl) memosUrl = String(dyn.memos.apiUrl)
			memosEnabled = !!dyn?.memos?.enable
			if (applyDefaultTab) tab = memosEnabled ? 'remote' : 'local'
		} catch {
			// 配置读不到（未绑定项目等）：按「没有远端数据源」处理，别让横幅出现没有依据的说明
			memosEnabled = false
			if (applyDefaultTab) tab = 'remote'
		} finally {
			loaded = true
		}
	}

	/** 拉最近动态列表 */
	async function loadMemos(): Promise<void> {
		memosLoading = true
		try {
			memos = await window.api.memosList(20)
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			memosLoading = false
		}
	}

	/** 发布：正文 + 待发图片一起发；图片作为 Memos 原生附件挂上去 */
	async function publishMemo(): Promise<void> {
		const content = composing.trim()
		// 只发图不写字也是合法动态（Memos 自己就支持）
		if ((!content && !pending.length) || publishing) return
		publishing = true
		try {
			const r = await window.api.memosPublish(
				content,
				visibility,
				pending.map((p) => ({ id: p.id, uid: p.uid, name: p.name }))
			)
			if (r.warning) {
				// 动态已经发出去了，只是附件没挂上：照实说，别让人以为整条失败
				notify(r.warning, false)
			} else {
				notify(pending.length ? `已发布到 Memos（附 ${r.attached} 张图）` : '已发布到 Memos')
			}
			composing = ''
			clearPending()
			await loadMemos()
			if (r.id && memoListEl) {
				memoListEl.scrollTop = 0
			}
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			publishing = false
		}
	}

	/** 把文件逐张传进 Memos 附件库，加入待发布列表；返回成功张数 */
	async function uploadToPending(files: File[]): Promise<number> {
		let ok = 0
		for (const f of files) {
			const a = await window.api.memosUpload(f)
			pending = [
				...pending,
				{ name: a.name, id: a.id, uid: a.uid, filename: a.filename, preview: URL.createObjectURL(f) }
			]
			ok++
		}
		return ok
	}

	/** 插图：选本地图片 → 传 Memos 附件库 → 进待发布列表（发布时挂到这条动态上） */
	async function insertImages(): Promise<void> {
		if (uploading) return
		const files = await pickImageFiles()
		if (!files.length) return
		uploading = true
		try {
			const n = await uploadToPending(files)
			notify(`已上传 ${n} 张图片，发布会作为动态附件显示`)
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			uploading = false
		}
	}

	/** 从待发布列表里拿掉一张（顺手释放本地预览，别漏内存） */
	function removePending(i: number): void {
		const it = pending[i]
		if (it) URL.revokeObjectURL(it.preview)
		pending = pending.filter((_, idx) => idx !== i)
	}

	/** 清空待发布列表并释放所有本地预览 */
	function clearPending(): void {
		for (const p of pending) URL.revokeObjectURL(p.preview)
		pending = []
	}

	/** 弹文件选择器，只选图片，可多选；取消返回空数组 */
	function pickImageFiles(): Promise<File[]> {
		return new Promise((resolve) => {
			const input = document.createElement('input')
			input.type = 'file'
			input.accept = 'image/*'
			input.multiple = true
			input.onchange = () => resolve([...(input.files ?? [])])
			input.click()
		})
	}

	/** 粘贴图片到发布框：拦下默认行为，直接进 Memos 附件库 */
	async function onPaste(e: ClipboardEvent): Promise<void> {
		const files = [...(e.clipboardData?.items ?? [])]
			.filter((it) => it.type.startsWith('image/'))
			.map((it) => it.getAsFile())
			.filter((f): f is File => !!f)
		if (!files.length) return
		e.preventDefault()
		uploading = true
		try {
			const n = await uploadToPending(files)
			notify(`已粘贴 ${n} 张图片到 Memos 附件库`)
		} catch (err) {
			notify(errMsg(err), false)
		} finally {
			uploading = false
		}
	}

	/** 从 memo 内容里提取 markdown 图片（与主题端展示一致），供列表渲染缩略图 */
	function memoImages(content: string): string[] {
		const urls: string[] = []
		const re = /!\[[^\]]*\]\(([^)]+)\)/g
		let m: RegExpExecArray | null
		while ((m = re.exec(content)) !== null) {
			const src = m[1].trim()
			if (src && /^(https?:)?\/\//.test(src)) urls.push(src)
		}
		return urls
	}

	async function deleteMemo(m: MemoItem): Promise<void> {
		if (!(await confirmDanger(`删除这条动态？`, m.content.slice(0, 60), 'Memos 上的这条会被删除，不可恢复。'))) return
		try {
			await window.api.memosDelete(m.id)
			notify('已删除')
			await loadMemos()
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	onMount(async () => {
		await loadConfig(true)
		if (tab === 'remote') await loadMemos()
	})

	/** 刷新：重新读主题的动态配置（Memos 地址 / 是否启用），重挂本地文件列表 */
	async function refreshAll(): Promise<void> {
		if (refreshing) return
		refreshing = true
		try {
			await loadConfig()
			if (tab === 'remote') await loadMemos()
			localKey += 1
			notify('已刷新：动态配置与本地文件列表都已重新同步')
		} finally {
			refreshing = false
		}
	}

	function reloadWebview(): void {
		const el = wvEl
		wvState = 'loading'
		if (el) el.src = memosUrl
	}

	function openPreview(): void {
		previewOpen = true
		wvState = 'loading'
	}

	function timeStr(t: string): string {
		const d = new Date(t)
		if (isNaN(d.getTime())) return t
		const p = (n: number): string => String(n).padStart(2, '0')
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
	}
</script>

<div class="dyn-page">
	<div class="dyn-head">
		<div class="row" style="justify-content:space-between">
			<h2 style="margin:0">动态发布</h2>
			<button class="btn" onclick={refreshAll} disabled={refreshing} title="重新读取动态配置并刷新本地文件列表">
				↻ 刷新
			</button>
		</div>
		{#if loaded && memosEnabled}
			<div class="card" style="background: var(--warn-bg); border-color: #f0dcb4" data-ff-block="dynamics/memos-note">
				<p class="muted" style="margin:0">
					当前博客配置启用了 <b>Memos 远端数据源</b>，网页端发布的动态会实时显示；<b>本地动态文件默认不会显示在网站上</b>。
					想改用本地文件作为数据源，请到「配置中心 → 动态页面」关闭 memos.enable。
				</p>
			</div>
		{/if}
	</div>

	<div class="row" style="margin-bottom:12px">
		<button class="btn" class:primary={tab === 'remote'} onclick={() => (tab = 'remote')}>远端发布（Memos）</button>
		<button class="btn" class:primary={tab === 'local'} onclick={() => (tab = 'local')}>本地发布（文件）</button>
	</div>

	{#if tab === 'remote'}
		<!-- 远端发布：原生发布框（不再只靠 iframe 嵌入 Memos 网页） -->
		<div class="dyn-remote">
			<div class="card dyn-compose" data-ff-block="dynamics/compose">
				<div class="row" style="justify-content:space-between; margin-bottom:8px">
					<b>直接发布</b>
					<span class="muted">发布到 Memos，网站实时可见</span>
				</div>
				<textarea
					class="code dyn-compose-input"
					rows="3"
					placeholder="写点什么…（支持 Markdown；可直接粘贴图片）"
					bind:value={composing}
					onkeydown={(e) => {
						if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void publishMemo()
					}}
					onpaste={onPaste}
				></textarea>
				{#if pending.length}
					<div class="dyn-pending">
						{#each pending as p, i (p.name)}
							<div class="dyn-pending-item">
								<img src={p.preview} alt={p.filename} title={p.filename} />
								<button class="dyn-pending-x" onclick={() => removePending(i)} title="移除这张">✕</button>
							</div>
						{/each}
					</div>
				{/if}
				<div class="row" style="justify-content:space-between; margin-top:8px">
					<div class="row" style="gap:6px">
						<label class="row" style="gap:4px">
							<select bind:value={visibility} style="width:auto">
								<option value="PUBLIC">公开</option>
								<option value="PROTECTED">保护</option>
								<option value="PRIVATE">私密</option>
							</select>
						</label>
					</div>
					<button class="btn" onclick={insertImages} disabled={uploading} title="选图片上传到 Memos，作为这条动态的附件">
						{uploading ? '上传中…' : '＋ 图片'}
					</button>
					<button class="btn primary" onclick={publishMemo} disabled={publishing || (!composing.trim() && !pending.length)}>
						{publishing ? '发布中…' : '发布'}
					</button>
				</div>
			</div>

			<div class="card dyn-list" data-ff-block="dynamics/list" bind:this={memoListEl}>
				<div class="row" style="justify-content:space-between; margin-bottom:8px">
					<b>最近动态</b>
					<div class="row" style="gap:6px">
						{#if memosLoading}<span class="muted">加载中…</span>{/if}
						<button class="btn small" onclick={loadMemos} disabled={memosLoading}>↻</button>
					</div>
				</div>
				{#if !memosLoading && !memos.length}
					<p class="muted">还没有动态。用上面的发布框发第一条吧。</p>
				{:else}
					{#each memos as m (m.id)}
						<div class="dyn-item">
							<div class="dyn-item-body">{m.content}</div>
							{#if memoImages(m.content).length || m.attachments?.length}
								<div class="dyn-item-imgs">
									{#each memoImages(m.content) as src}
										<a href={src} target="_blank" rel="noopener noreferrer">
											<img src={src} alt="动态图片" loading="lazy" />
										</a>
									{/each}
									{#each m.attachments ?? [] as a}
										{#if imgFailed[a.url]}
											<span class="dyn-img-na" title="非公开动态的图片需要登录 Memos 才能查看">
												{a.filename || '图片'}
											</span>
										{:else}
											<a href={a.url} target="_blank" rel="noopener noreferrer" title={a.filename}>
												<img
													src={a.url}
													alt={a.filename}
													loading="lazy"
													onerror={() => (imgFailed[a.url] = true)}
												/>
											</a>
										{/if}
									{/each}
								</div>
							{/if}
							<div class="row" style="justify-content:space-between; gap:6px">
								<div class="row" style="gap:6px">
									<span class="tag">{visLabel(m.visibility)}</span>
									{#if m.pinned}<span class="tag">置顶</span>{/if}
									<span class="muted">{timeStr(m.createTime)}</span>
								</div>
								<button class="btn small danger" onclick={() => deleteMemo(m)} disabled={publishing}>删除</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			{#if memosUrl}
				<!-- 站点预览：默认折叠，点开才加载 iframe（避免手机端整屏白/卡） -->
				<div class="card dyn-preview" data-ff-block="dynamics/preview">
					<button class="row" style="justify-content:space-between; width:100%; background:none; border:none; cursor:pointer; padding:0" onclick={() => (previewOpen ? (previewOpen = false) : openPreview())}>
						<b>站点预览</b>
						<span class="muted">{previewOpen ? '收起 ▲' : '展开 ▼'}</span>
					</button>
					{#if previewOpen}
						<div class="row" style="justify-content:space-between; margin:10px 0 8px">
							<code style="font-size:12.5px">{memosUrl}</code>
							<div class="row" style="gap:8px">
								{#if wvState === 'loading'}<span class="muted">加载中…</span>{/if}
								<button class="btn small" onclick={reloadWebview}>↻ 重新加载</button>
								<button class="btn small" onclick={() => window.api.openExternal(memosUrl)}>↗ 在浏览器打开</button>
							</div>
						</div>
						<iframe
							bind:this={wvEl}
							src={memosUrl}
							title="Memos 站点预览"
							onload={() => {
								wvState = 'loaded'
							}}
						></iframe>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<!-- 本地发布：**一张卡**，左边目录、右边编辑 —— 与「文章管理 / 项目展示」同一套 ContentManager。
		     这里以前是上下两张卡（「新建本地动态」+「本地动态文件」），两套编辑框、
		     两套插图逻辑，用户要先在上面写完再自己去找下面的文件改，很笨。
		     现在统一由 ContentManager 承担：新建 / 打开 / 编辑 / 保存 / 删除 / 克隆 / 插图 / 粘贴 /
		     预览（含分屏）都在右边，左侧是 src/content/dynamic/ 的真实文件列表。
		     `data-ff-block` 只留一个：合并之后这一页的本地页签就一个块，不再有「上下拖」的问题 -->
		<div class="card dyn-files" data-ff-block="dynamics/local-files">
			{#key localKey}
				<ContentManager
					folder="dynamic"
					title="本地动态文件"
					canCreate
					createKind="dynamic"
					createLabel="新建动态"
					canImage
					embedded
				/>
			{/key}
		</div>
	{/if}
</div>

<style>
	.dyn-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-sizing: border-box;
	}
	.dyn-head {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.dyn-head h2 {
		margin: 0;
	}
	.dyn-remote {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow: auto;
		box-sizing: border-box;
	}
	.dyn-compose {
		flex-shrink: 0;
	}
	.dyn-compose-input {
		min-height: 84px;
		resize: vertical;
	}
	.dyn-list {
		flex: 1;
		min-height: 120px;
		overflow: auto;
		display: flex;
		flex-direction: column;
	}
	.dyn-list > :not(.row) {
		flex-shrink: 0;
	}
	.dyn-item {
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 8px 12px;
		margin-bottom: 8px;
		background: #f8fdfb;
	}
	.dyn-item-body {
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 13.5px;
		line-height: 1.6;
		margin-bottom: 6px;
		max-height: 120px;
		overflow: hidden;
	}
	.dyn-item-imgs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 6px;
	}
	.dyn-item-imgs a {
		display: block;
		width: 72px;
		height: 72px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--line);
		background: #fff;
		flex-shrink: 0;
	}
	.dyn-item-imgs img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	/* 附件匿名读不到（私密 / 保护动态）时的占位 */
	.dyn-img-na {
		display: flex;
		align-items: center;
		justify-content: center;
		max-width: 96px;
		height: 72px;
		padding: 0 6px;
		border-radius: 8px;
		border: 1px dashed var(--line);
		background: #fff;
		color: var(--muted);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* 发布框里的待发布图片（本地预览，可单张移除） */
	.dyn-pending {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.dyn-pending-item {
		position: relative;
		width: 72px;
		height: 72px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--line);
		background: #fff;
	}
	.dyn-pending-item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.dyn-pending-x {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 18px;
		height: 18px;
		padding: 0;
		line-height: 1;
		border: none;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		font-size: 11px;
		cursor: pointer;
	}
	.dyn-preview {
		flex-shrink: 0;
	}
	.dyn-preview iframe {
		flex: 1;
		width: 100%;
		height: 52vh;
		min-height: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
	}
	/* 本地发布：这一张卡就是「左目录 + 右编辑」，给它一个明确高度
	   （内嵌的 ContentManager 自己负责两栏与分隔条） */
	.dyn-files {
		flex: 1;
		min-height: 340px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.dyn-files :global(.cm-page) {
		height: 100%;
	}
</style>