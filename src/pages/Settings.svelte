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
	import { applyWallpaperFromConfig } from '../lib/api'
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
		onLive2dExpand
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
	} = $props()

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')
	const setAccent = getContext<(name: string, accent: string, deep: string) => Promise<void>>('setAccent')

	const API_BASE: string = (import.meta.env.VITE_API_URL ?? '(同源)').replace(/\/+$/, '')

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
	// 图床直链/任意图片 URL 都行；顺便复用图床上传选图
	let wpUrl = $state('')
	let wpDim = $state(0.45)
	let cardOp = $state(1)
	let wpLoading = $state(true)

	interface WallpaperCfg { url?: string; dim?: number; cardOpacity?: number }

	async function loadWallpaper(): Promise<void> {
		try {
			const raw = await window.api.configGet('wallpaper')
			const cfg = (raw ? JSON.parse(raw) : {}) as WallpaperCfg
			wpUrl = cfg.url ?? ''
			wpDim = cfg.dim ?? 0.45
			cardOp = cfg.cardOpacity ?? 1
		} catch {
			/* 未配置就保持默认 */
		} finally {
			wpLoading = false
		}
	}

	async function saveWallpaper(): Promise<void> {
		try {
			const cfg: WallpaperCfg = { url: wpUrl.trim(), dim: wpDim, cardOpacity: cardOp }
			await window.api.configSet('wallpaper', JSON.stringify(cfg))
			applyWallpaperFromConfig(JSON.stringify(cfg))
			notify('壁纸已保存')
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	/** 从图床上传选图 → 拿直链填进输入框（不自动保存，用户确认后再存） */
	async function pickFromImgBed(): Promise<void> {
		try {
			const refs = await window.api.assetImport('')
			if (!refs.length) return
			wpUrl = refs[0]
			notify('已填入图床直链，点「保存壁纸」生效')
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	function clearWallpaper(): void {
		wpUrl = ''
		applyWallpaperFromConfig(null)
		void saveWallpaper()
	}
</script>

<div class="card">
	<h3>🎨 主题色</h3>
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
	<h3>🖼️ 后台壁纸</h3>
	{#if wpLoading}
		<p class="muted">正在读取…</p>
	{:else}
		<div class="row" style="gap:8px; margin-bottom:8px">
			<input
				type="text"
				bind:value={wpUrl}
				placeholder="壁纸图片 URL（图床直链或任意图片地址）"
				style="flex:1; min-width:180px"
			/>
			<button class="btn small" onclick={pickFromImgBed}>📤 从图床选图</button>
		</div>
		<div class="row" style="margin-top:12px; gap:10px">
			<span class="muted" style="min-width:64px">壁纸减淡</span>
			<input
				type="range"
				min="0"
				max="0.85"
				step="0.05"
				value={wpDim}
				oninput={(e) => (wpDim = Number((e.target as HTMLInputElement).value))}
				style="flex:1; max-width:320px"
			/>
			<span class="muted">{Math.round(wpDim * 100)}%</span>
		</div>
		<div class="row" style="margin-top:12px; gap:10px">
			<span class="muted" style="min-width:64px">卡片不透明度</span>
			<input
				type="range"
				min="0.3"
				max="1"
				step="0.05"
				value={cardOp}
				oninput={(e) => (cardOp = Number((e.target as HTMLInputElement).value))}
				style="flex:1; max-width:320px"
			/>
			<span class="muted">{Math.round(cardOp * 100)}%</span>
		</div>
		<div class="row" style="margin-top:10px; justify-content:space-between; gap:10px">
			<p class="hint" style="margin:0; max-width:520px">
				壁纸路径存在后端 D1（key=<code>wallpaper</code>），登录后所有设备通用；
				图床选图会把图传到 <code>{API_BASE}</code> 的图床再取直链。调低卡片不透明度可透出壁纸。
			</p>
			<div class="row" style="gap:8px">
				{#if wpUrl}
					<button class="btn small danger" onclick={clearWallpaper}>清除</button>
				{/if}
				<button class="btn small primary" onclick={saveWallpaper}>保存壁纸</button>
			</div>
		</div>
	{/if}
</div>

<div class="card" style="margin-top:14px">
	<h3>👤 账号</h3>
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
		<h3 style="margin:0">🧩 后台配置（.fireflux.yml）</h3>
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
	<h3>🌸 看板娘</h3>
	<div class="row" style="justify-content:space-between; flex-wrap:wrap; gap:10px">
		<label class="row" style="gap:8px; cursor:pointer">
			<input type="checkbox" checked={live2dEnabled} onchange={(e) => onLive2dToggle?.((e.target as HTMLInputElement).checked)} />
			<span>显示看板娘（桌面端在侧栏底部，手机上在右下角悬浮）</span>
		</label>
		<div class="row" style="gap:8px">
			{#if live2dEnabled}
				<button class="btn small" onclick={onLive2dCollapse}>收起</button>
				<button class="btn small" onclick={onLive2dExpand}>展开</button>
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
		不显示时不会加载，也不再占用渲染资源。
	</p>
</div>

<div class="card" style="margin-top:14px">
	<h3>ℹ️ 关于</h3>
	<p class="muted" style="margin:0; line-height:1.7">
		Firefly 后台（Web 版）· 前端界面移植自 Fireflux 桌面端，后端为 Cloudflare Workers + GitHub API。<br />
		内容与配置文件都存在博客仓库里，后台不保存副本；每次保存 = 一次 git 提交（改动历史可在仓库里查到）。
	</p>
</div>

<style>
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
</style>
