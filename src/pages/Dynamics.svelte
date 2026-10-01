<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import ContentManager from '../components/ContentManager.svelte'
	import type { ConfigReadResult } from '../lib/api'
	import { errMsg } from '../lib/err'

	let tab = $state<'remote' | 'local'>('remote')
	let memosUrl = $state('')
	let memosEnabled = $state(true)
	let loaded = $state(false)
	/** 本地文件列表的刷新键：自增即重新挂载 ContentManager，重新从磁盘列文件 */
	let localKey = $state(0)
	let refreshing = $state(false)

	// 内嵌网页的加载状态（只能区分「加载中 / 已加载」：
	// iframe 的 onerror 对 HTTP 错误不可靠，拿不到错误码，见 docs/参数说明.md）
	let wvEl = $state<HTMLElement | null>(null)
	let wvState = $state<'idle' | 'loading' | 'loaded'>('idle')

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	/** 地址变化时把内嵌页面标成「加载中」；真正完成由 iframe 的 onload 给出 */
	$effect(() => {
		void memosUrl
		if (!memosUrl) return
		wvState = 'loading'
	})

	function reloadWebview(): void {
		const el = wvEl as HTMLIFrameElement | null
		wvState = 'loading'
		// iframe 没有 reload()：重新赋一次 src 才会真正重新加载
		if (el) el.src = memosUrl
	}

	// 默认 Tab 跟着博客配置走：开了 Memos 就默认远端，否则本地
	// （只在首次加载时切换 Tab；点刷新时保留用户当前选的页签）
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

	onMount(async () => {
		await loadConfig(true)
	})

	/**
	 * 刷新：重新读主题的动态配置（Memos 地址 / 是否启用），重挂本地文件列表。
	 */
	async function refreshAll(): Promise<void> {
		if (refreshing) return
		refreshing = true
		try {
			await loadConfig()
			localKey += 1
			notify('已刷新：动态配置与本地文件列表都已重新同步')
		} finally {
			refreshing = false
		}
	}

</script>

<div class="dyn-page">
	<div class="dyn-head">
		<div class="row" style="justify-content:space-between">
			<h2 style="margin:0">💬 动态发布</h2>
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
		<button class="btn" class:primary={tab === 'remote'} onclick={() => (tab = 'remote')}>🌐 远端发布（Memos）</button>
		<button class="btn" class:primary={tab === 'local'} onclick={() => (tab = 'local')}>📝 本地发布（文件）</button>
	</div>

	{#if tab === 'remote'}
		{#if memosUrl}
			<div class="card web-card" data-ff-block="dynamics/web">
				<div class="row" style="justify-content:space-between; margin-bottom:8px">
					<code style="font-size:12.5px">{memosUrl}</code>
					<div class="row" style="gap:8px">
						{#if wvState === 'loading'}<span class="muted">加载中…</span>{/if}
						{#if wvState === 'loaded'}<span class="muted">已加载</span>{/if}
						<button class="btn small" onclick={reloadWebview}>↻ 重新加载</button>
						<button class="btn small" onclick={() => window.api.openExternal(memosUrl)}>↗ 在浏览器打开</button>
					</div>
				</div>
				<!-- 直接在窗口内以网页方式加载远端 Memos（不另开窗口）。
				     代价是：若该站点设了 X-Frame-Options / frame-ancestors 会被拒绝嵌入而白屏，
				     这时用「↗ 在浏览器打开」即可。 -->
				<iframe
					bind:this={wvEl}
					src={memosUrl}
					title="Memos"
					onload={() => {
						wvState = 'loaded'
					}}
				></iframe>
				<p class="hint" style="margin:8px 0 0">首次使用请在页面里登录 Memos；登录状态会被记住。在这里发的动态网站实时可见。</p>
			</div>
		{:else}
			<div class="card" style="background: var(--warn-bg); border-color: #f0dcb4" data-ff-block="dynamics/no-remote">
				<b>主题配置里没读到远端动态地址</b>
				<p class="muted">
					本页在加载项目时会直接读主题的 <code>src/config/dynamicConfig.ts</code> 里的
					<code>memos.apiUrl</code>，不需要再去配置中心单独设置。读不到一般是这个文件不存在、
					里面没有 <code>memos</code> 字段，或者当前绑定的项目不对。
				</p>
			</div>
		{/if}
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
					icon="📝"
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
	.web-card {
		flex: 1;
		min-height: 320px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-sizing: border-box;
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
	iframe {
		flex: 1;
		width: 100%;
		min-height: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
	}
</style>
