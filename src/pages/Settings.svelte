<script lang="ts">
	/**
	 * 设置页（Web 版简化）：
	 * - 主题色（与桌面版同一组预设，写 localStorage 立即生效）
	 * - 账号：后端地址、退出登录
	 * - 后台配置：.fireflux.yml 原文编辑（声明集合 / 字段 / 特性 / 配置文件清单的地方）
	 * - 关于
	 *
	 * 桌面版的项目文件夹绑定、壁纸、看板娘、即时预览、窗口尺寸、克隆设置都在网页版不适用，已移除。
	 */
	import { getContext, onMount } from 'svelte'
	import { errMsg } from '../lib/err'
	import { confirmDanger } from '../lib/confirm.svelte'
	import type { AppearanceSettings } from '../lib/api'
	import {
		applyWallpaperFromConfig,
		currentWallpaperUrl,
		isNarrowViewport,
		type WallpaperCfg
	} from '../lib/api'
	import {
		onPicked,
		startPick,
		takePicked,
		PICK_LABELS,
		type PickSlot
	} from '../lib/pick-image'
	// DEV-BYPASS: 调试用密码登录入口（上线前删除）
	import DevLogin from '../components/DevLogin.svelte'

	let {
		appearance,
		ACCENT_PRESETS,
		loggedIn = true,
		live2dEnabled = true,
		live2dScale = 1,
		onLive2dToggle,
		onLive2dScale,
		onLive2dCollapse,
		onLive2dExpand,
		onLive2dResetPos
	}: {
		appearance: AppearanceSettings
		ACCENT_PRESETS: { name: string; accent: string; deep: string }[]
		loggedIn?: boolean
		live2dEnabled?: boolean
		live2dScale?: number
		onLive2dToggle?: (v: boolean) => void
		onLive2dScale?: (v: number) => void
		onLive2dCollapse?: () => void
		onLive2dExpand?: () => void
		onLive2dResetPos?: () => void
	} = $props()

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')
	const setAccent = getContext<(name: string, accent: string, deep: string) => Promise<void>>('setAccent')

	const API_BASE: string = (import.meta.env.VITE_API_URL ?? '(同源)').replace(/\/+$/, '')
	const gotoPage = getContext<(id: string) => void>('gotoPage')

	let raw = $state('')
	let original = $state('')
	let source = $state('')
	let loading = $state(true)
	let saving = $state(false)
	const dirty = $derived(raw !== original)

	onMount(async () => {
		if (!loggedIn) {
			loading = false
			wpLoading = false
			return
		}
		try {
			const r = await window.api.adminConfigRaw()
			raw = r.raw
			original = r.raw
			source = r.source
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			loading = false
		}
		void loadWallpaper()
	})

	function currentAccent(): string {
		return appearance.accent ?? '#14B8A6'
	}

	async function save(): Promise<void> {
		saving = true
		try {
			await window.api.saveAdminConfigRaw(raw)
			original = raw
			notify('后台配置已保存并推送（配置中心与侧栏会随之更新）')
			setTimeout(() => window.location.reload(), 800)
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			saving = false
		}
	}

	/** 直接跳 GitHub 授权（成功后回跳本页并带上 token，整页重新加载） */
	function login(): void {
		window.location.href = `${API_BASE.replace(/\/$/, '')}/api/auth/github`
	}

	async function logout(): Promise<void> {
		if (!(await confirmDanger('退出登录？', '退出后需要重新用 GitHub 授权登录。'))) return
		window.api.logout()
	}

	// ---------- 后台壁纸（路径存后端 D1 site_config，key=wallpaper） ----------
	// 桌面 / 手机两张图分开设；减淡与卡片不透明度是全局一套，不分端
	let wpUrl = $state('')
	let wpMobileUrl = $state('')
	let wpDim = $state(0.45)
	let cardOp = $state(1)
	let wpLoading = $state(true)

	async function loadWallpaper(): Promise<void> {
		try {
			const raw = await window.api.configGet('wallpaper')
			const cfg = (raw ? JSON.parse(raw) : {}) as WallpaperCfg
			wpUrl = cfg.url ?? ''
			wpMobileUrl = cfg.mobileUrl ?? ''
			wpDim = cfg.dim ?? 0.45
			cardOp = cfg.cardOpacity ?? 1
		} catch {
			/* 未配置就保持默认 */
		} finally {
			wpLoading = false
		}
	}

	function wallpaperConfig(): WallpaperCfg {
		return { url: wpUrl.trim(), mobileUrl: wpMobileUrl.trim(), dim: wpDim, cardOpacity: cardOp }
	}

	async function saveWallpaper(): Promise<void> {
		try {
			const cfg = wallpaperConfig()
			await window.api.configSet('wallpaper', JSON.stringify(cfg))
			applyWallpaperFromConfig(JSON.stringify(cfg))
			notify('壁纸已保存')
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	/** 从图床上传选图 → 拿直链填进指定那栏（手机端填 mobileUrl，桌面端填 url） */
	/**
	 * 「从相册选择」：两端统一走后台内部流程 —— 跳到图床管理页，在那儿**上传**（系统相册
	 * / 文件选择器）或**点一张图床里现成的图**，直链自动填回这里。
	 *
	 * 为什么不用直接 `<input type="file">`：手机上点它会跳出**系统相册**（另一个应用），
	 * 选完图还得自己再回后台传一遍图床 —— 两步变三步。走图床页则一步到位。
	 *
	 * 电脑端同样走这条路（不是给手机开的后门）：两端行为一致，用户不需要记两套操作。
	 * 约定细节见 lib/pick-image.ts（模块级单例，因为切页会销毁本组件）。
	 */
	function gotoImgBed(target: PickSlot): void {
		startPick(target)
		gotoPage('gallery')
	}

	/** 图床页交回来的直链 → 填进对应那一栏 */
	function acceptPicked(url: string, target: PickSlot): void {
		if (target === 'wallpaper-mobile') wpMobileUrl = url
		else wpUrl = url
		notify(`已填入图床直链，点「保存壁纸」生效`)
	}

	// 两种到达路径都要接住：① 图床页用 CustomEvent 推过来（本页还没被销毁）；
	//                       ② 本页是被切页销毁后重新挂载的，那就去读 localStorage 里的待消费记录。
	$effect(() => onPicked(acceptPicked))
	$effect(() => {
		const got = takePicked()
		if (got) acceptPicked(got.url, got.target)
	})

	function clearWallpaper(): void {
		wpUrl = ''
		wpMobileUrl = ''
		applyWallpaperFromConfig(null)
		void saveWallpaper()
	}
</script>

<div class="card">
	<h3>主题色</h3>
	<div class="row" style="gap:14px; flex-wrap:wrap">
		{#each ACCENT_PRESETS as a (a.name)}
			<button
				class="swatch-btn"
				class:current={currentAccent().toLowerCase() === a.accent.toLowerCase()}
				onclick={() => void setAccent(a.name, a.accent, a.deep)}
				title={a.name}
			>
				<span class="swatch" style="background: linear-gradient(135deg, {a.accent}, {a.deep})"></span>
				<span class="swatch-name">{a.name}</span>
			</button>
		{/each}
	</div>
	<p class="hint">点击即换，全局即时生效并记住选择。</p>
</div>

<div class="card" style="margin-top:14px">
	<h3>后台壁纸</h3>
	{#if wpLoading}
		<p class="muted">正在读取…</p>
	{:else}
		<!-- 桌面 / 手机两张壁纸分开设：窄屏（≤900px）用「手机壁纸」，留空则沿用桌面那张。
		     每端一格：标签在上、输入框整行、按钮整行 —— 挤成「标签+输入框+按钮」一行时
		     手机上必然换行错位。 -->
		<div class="wp-grid">
			<div class="wp-slot">
				<label class="flabel" for="wp-desktop">电脑壁纸</label>
				<input id="wp-desktop" type="text" bind:value={wpUrl} placeholder="图片 URL（图床直链或任意图片地址）" />
				<button class="btn small" onclick={() => gotoImgBed('wallpaper-desktop')}>从相册中选择</button>
			</div>
			<div class="wp-slot">
				<label class="flabel" for="wp-mobile">手机壁纸</label>
				<input id="wp-mobile" type="text" bind:value={wpMobileUrl} placeholder="留空 = 沿用电脑那张" />
				<button class="btn small" onclick={() => gotoImgBed('wallpaper-mobile')}>从相册中选择</button>
			</div>
		</div>
		<div class="wp-grid" style="margin-top:14px">
			<div class="wp-slot">
				<span class="flabel">壁纸减淡</span>
				<div class="row" style="gap:10px; flex-wrap:nowrap">
					<input
						type="range"
						min="0"
						max="0.85"
						step="0.05"
						value={wpDim}
						oninput={(e) => (wpDim = Number((e.target as HTMLInputElement).value))}
					/>
					<span class="muted wp-pct">{Math.round(wpDim * 100)}%</span>
				</div>
			</div>
			<div class="wp-slot">
				<span class="flabel">卡片不透明度</span>
				<div class="row" style="gap:10px; flex-wrap:nowrap">
					<input
						type="range"
						min="0.3"
						max="1"
						step="0.05"
						value={cardOp}
						oninput={(e) => (cardOp = Number((e.target as HTMLInputElement).value))}
					/>
					<span class="muted wp-pct">{Math.round(cardOp * 100)}%</span>
				</div>
			</div>
		</div>
		<div class="row" style="margin-top:14px; justify-content:space-between; gap:10px">
			<p class="hint" style="margin:0; max-width:520px">
				壁纸路径存在后端 D1（key=<code>wallpaper</code>），登录后所有设备通用；
				图床选图会把图传到 <code>{API_BASE}</code> 的图床再取直链。<br />
				页面宽度 ≤900px 自动用「手机壁纸」，留空则沿用电脑那张；减淡与卡片不透明度两端通用。
			</p>
			<div class="row" style="gap:8px">
				{#if wpUrl || wpMobileUrl}
					<button class="btn small danger" onclick={clearWallpaper}>清除</button>
				{/if}
				<button class="btn small primary" onclick={saveWallpaper}>保存壁纸</button>
			</div>
		</div>
		<!-- 当前这台设备实际生效的那张图：分端设置最容易被「我明明填了怎么没变」绕晕 -->
		<p class="hint wp-now">
			<span class="tag">{isNarrowViewport() ? '手机壁纸' : '电脑壁纸'}</span>
			<span class="wp-now-url">{currentWallpaperUrl(wallpaperConfig()) || '（未设置壁纸）'}</span>
		</p>
	{/if}
</div>

<div class="card" style="margin-top:14px">
	<h3>账号</h3>
	<div class="row" style="justify-content:space-between; flex-wrap:wrap; gap:10px">
		<div>
			<div>后端 API：<code>{API_BASE}</code></div>
			<div class="muted" style="margin-top:4px">
				登录方式：GitHub OAuth（能读写本博客仓库的账号）
				{#if !loggedIn}
					<br /><b style="color:var(--danger)">当前未登录</b>：内容与配置都读不出来。
				{/if}
			</div>
		</div>
		{#if loggedIn}
			<button class="btn danger" onclick={logout}>退出登录</button>
		{:else}
			<button class="btn primary" onclick={login}>使用 GitHub 登录</button>
		{/if}
	</div>
	{#if !loggedIn}
		<!-- DEV-BYPASS: 调试用密码登录；上线前删除这一段 -->
		<DevLogin compact onSuccess={() => window.location.reload()} />
	{/if}
</div>

<div class="card" style="margin-top:14px">
	<div class="row" style="justify-content:space-between; margin-bottom:8px">
		<h3 style="margin:0">后台配置（.fireflux.yml）</h3>
		<div class="row">
			{#if source}<span class="muted">来源：{source}</span>{/if}
			<button class="btn" onclick={() => (raw = original)} disabled={!dirty}>还原</button>
			<button class="btn primary" onclick={save} disabled={!dirty || saving}>{saving ? '保存中…' : '保存并推送'}</button>
		</div>
	</div>
	<p class="muted" style="margin-top:0; line-height:1.7">
		这里声明集合（collections）、字段、特性（clone / rename_id / soft_delete / git_log）与配置文件清单。
		改完保存后，左侧导航与「配置中心」会按新配置重建。字段说明见仓库根目录的 <code>.fireflux.yml</code> 注释。
	</p>
	{#if loading}
		<p class="muted" style="margin:0">正在读取…</p>
	{:else}
		<textarea class="code" rows="22" bind:value={raw} spellcheck="false"></textarea>
	{/if}
</div>

<div class="card" style="margin-top:14px">
	<h3>看板娘</h3>
	<div class="row" style="justify-content:space-between; flex-wrap:wrap; gap:10px">
		<!-- 勾选框：全局 input{width:100%} 会把这个勾拉成一条莫名其妙的横条，
		     这里显式改回 auto，并且让文字跟着勾一起换行而不是掉到下一行 -->
		<label class="l2d-toggle">
			<input
				type="checkbox"
				checked={live2dEnabled}
				onchange={(e) => onLive2dToggle?.((e.target as HTMLInputElement).checked)}
			/>
			<span>
				显示看板娘
				<span class="muted">（电脑端在侧栏底部，手机上在右下角悬浮；关掉就不再加载模型）</span>
			</span>
		</label>
		<div class="row" style="gap:8px">
			{#if live2dEnabled}
				<button class="btn small" onclick={onLive2dCollapse}>收起</button>
				<button class="btn small" onclick={onLive2dExpand}>展开</button>
				<button class="btn small" onclick={onLive2dResetPos}>重置位置</button>
			{/if}
		</div>
	</div>
	<div class="row" style="margin-top:12px; gap:10px">
		<span class="muted" style="min-width:64px">模型大小</span>
		<input
			type="range"
			min="0.4"
			max="1.6"
			step="0.05"
			value={live2dScale}
			oninput={(e) => onLive2dScale?.(Number((e.target as HTMLInputElement).value))}
			style="flex:1; max-width:320px"
		/>
		<span class="muted">{Math.round(live2dScale * 100)}%</span>
	</div>
	<p class="hint">
		看板娘用的是 Firefly 官方 Live2D 资源（与主题同一套 v6.6.2），由 <code>public/live2d/</code> 直出；
		不显示时不会加载，也不再占用渲染资源。<br />
		手机上换位置：<b>长按模型 0.35 秒</b>直接拖动，或抓住左上角那颗把手拖；
		拖完的位置记在这台设备上（localStorage），换设备各拖各的。短按模型仍然是摸头 / 点表情。
	</p>
</div>

<div class="card" style="margin-top:14px">
	<h3>关于</h3>
	<p class="muted" style="margin:0; line-height:1.7">
		Firefly 后台（Web 版）· 前端界面移植自 Fireflux 桌面端，后端为 Cloudflare Workers + GitHub API。<br />
		内容与配置文件都存在博客仓库里，后台不保存副本；每次保存 = 一次 git 提交（改动历史可在仓库里查到）。
	</p>
</div>

<style>
	/* 壁纸两栏：≥560px 时电脑/手机并排，窄一点就各占一整行（标签-输入框-按钮竖排） */
	.wp-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 12px;
	}
	.wp-slot {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
		min-width: 0;
	}
	.wp-slot .flabel {
		margin-bottom: 0;
	}
	.wp-slot .btn {
		align-self: flex-start;
	}
	.wp-slot input[type='range'] {
		flex: 1;
		/* 全局 input{width:100%} 会给滑块一个 100% 的 flex-basis，和百分比间距一起溢出容器 */
		width: auto;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
	}
	.wp-pct {
		flex-shrink: 0;
		min-width: 38px;
		text-align: right;
	}
	.wp-now {
		margin: 10px 0 0;
		display: flex;
		align-items: flex-start;
		gap: 6px;
	}
	.wp-now .tag {
		flex-shrink: 0;
	}
	.wp-now-url {
		min-width: 0;
		/* 图床直链很长：不打断就撑破卡片，打断才不会顶出边框 */
		word-break: break-all;
		line-height: 1.5;
	}

	.swatch-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: rgba(255, 255, 255, var(--panel-alpha));
		cursor: pointer;
	}
	.swatch-btn.current {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent-soft);
	}
	.swatch {
		width: 40px;
		height: 40px;
		border-radius: 10px;
	}
	.swatch-name {
		font-size: 12px;
	}
	/* 看板娘开关：勾 + 说明文字同一行基线对齐，文字内部正常换行 */
	.l2d-toggle {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		cursor: pointer;
		flex-wrap: nowrap;
		min-width: 0;
		flex: 1 1 260px;
		line-height: 1.6;
	}
	.l2d-toggle input[type='checkbox'] {
		flex: none;
		width: auto;
		margin: 4px 0 0;
	}
</style>
