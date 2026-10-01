<script lang="ts">
	/**
	 * 后台外壳：左侧导航 + 右侧内容区 + 全局 toast + 危险操作确认弹窗。
	 *
	 * 移植自 Fireflux 桌面版 App.svelte，砍掉了桌面专属的看板娘 / 壁纸 / 布局编辑器 /
	 * 即时预览 / 窗口尺寸等模块，只保留「侧栏 + 页面切换 + 通知」这条主干，
	 * 并加上网页版必须的登录态判断（OAuth 回跳带 token）。
	 *
	 * 页面**由配置驱动**：集合类入口（文章 / 动态 / …）来自 /api/collections，
	 * 也就是 .fireflux.yml 里的 collections，不再写死列表。
	 */
	import { onMount, setContext } from 'svelte'
	import { errMsg } from './lib/err'
	import { readLayoutFlag, readLayoutNumber, readLayoutText, saveLayoutUi } from './lib/layout'
	import ContentManager from './components/ContentManager.svelte'
	import ConfirmDialog from './components/ConfirmDialog.svelte'
	import DragBar from './components/DragBar.svelte'
	// DEV-BYPASS: 调试用密码登录入口（上线前删除）
	import DevLogin from './components/DevLogin.svelte'
	import ConfigCenter from './pages/ConfigCenter.svelte'
	import Gallery from './pages/Gallery.svelte'
	import Trash from './pages/Trash.svelte'
	import Dynamics from './pages/Dynamics.svelte'
	import Publish from './pages/Publish.svelte'
	import Settings from './pages/Settings.svelte'
	import type { AppearanceSettings } from './lib/api'
	import { applyWallpaperFromConfig, refreshWallpaperForViewport } from './lib/api'

	interface CollectionMeta {
		name: string
		label: string
		path: string
		filename: string
		fields: Record<string, { type: string }>
		features: string[]
	}

	let phase = $state<'loading' | 'ready'>('loading')
	/** 登录态：未登录也进主界面（数据为空），只用 toast 提示，登录入口在设置页 */
	let loggedIn = $state(true)
	const API_BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
	let page = $state(readLayoutText('page', ''))
	let appearance = $state<AppearanceSettings>({})
	let collections = $state<CollectionMeta[]>([])
	let fatal = $state('')
	let sidebarW = $state(readLayoutNumber('sidebarWidth', 216))

	// ===== 移动端 =====
	// 窄屏时侧栏收成抽屉（顶栏汉堡键唤出），内容区整宽；看板娘改成右下角悬浮
	let isMobile = $state(false)
	let drawerOpen = $state(false)

	// ===== 看板娘 =====
	// 为什么网页版也留着它：它不是桌面专属能力 —— Fireflux 的 live2d 是一套
	// 自包含的 Web 资源（public/live2d/，与 Firefly 官方 Live2D v6.6.2 逐字节一致），
	// 桌面端只是把它塞进 iframe。这里同样塞 iframe，只是容器从「侧栏格子」换成
	// 「侧栏格子（桌面）/ 右下角悬浮（移动端）」。
	let live2dEnabled = $state(readLayoutFlag('live2dEnabled', true))
	let live2dCollapsed = $state(readLayoutFlag('live2dCollapsed', false))
	let live2dScale = $state(readLayoutNumber('live2dScale', 1))
	/** 模型内容宽高比，由 iframe 用 ff-art 消息报来（决定容器高度） */
	let live2dRatio = $state(1.54)
	/** 模型当前说的话（ff-say），画在容器上方 */
	let live2dSay = $state('')
	let live2dFrame = $state<HTMLIFrameElement | undefined>(undefined)
	/** 与 embed.html 的 controlsGutter 一致：右侧留一条放交互按钮的带子 */
	const MENU_BAND = 40
	let live2dIdleTimer: ReturnType<typeof setTimeout> | undefined
	/** 移动端悬浮位置（屏幕坐标，左上角为原点）；拖完存 localStorage */
	let live2dPos = $state<{ x: number; y: number } | null>(null)
	const live2dPosKey = 'ff.live2d.pos'

	// 拖动浮动看板娘：只有移动端悬浮才可拖（桌面端在侧栏格子内，拖了会乱布局）
	//
	// 两种起手：
	// - 抓住把手（.live2d-handle）→ 立刻开始拖；
	// - 直接按在模型上 → 停顿 0.35s 进入拖动（长按）。中途挪动超过 10px 就取消长按，
	//   松手时按「点一下」处理。短按仍然是摸头 / 点表情。
	//
	// 为什么需要一层 .live2d-grab 铺在 iframe 上：页面上的监听**收不到 iframe 内部**的
	// 指针事件（事件被 iframe 边界截断），不铺这层就永远收不到「用户在模型上按住」这件事。
	// 代价是模型收不到真实按压，所以这里把坐标换算成 iframe 内坐标 postMessage 回去：
	// 松手 → ff-tap-at（iframe 内合成一次 pointerdown/up，走它已有的命中区判定），
	// 移动 → ff-pointer（光标跟随）。embed.html 里对应两个 handler。
	const L2D_HOLD_MS = 350
	/** 长按判定期间手指挪动超过这么多像素就算「想互动」，不算拖动 */
	const L2D_MOVE_TOL = 10
	let l2dDragging = $state(false)
	let l2dDragState: { px: number; py: number; x: number; y: number; w: number; h: number } | null = null
	let l2dPressTimer: ReturnType<typeof setTimeout> | undefined
	let l2dPress: { x: number; y: number; slot: HTMLElement; el: HTMLElement } | null = null
	/** 上次转发给 iframe 的光标坐标，避免同一位置重复发消息 */
	let l2dLastSent = ''

	/** 浮动容器当前的实际位置与尺寸（未拖过时 = 右下角默认位置） */
	function l2dGeometry(slot: HTMLElement): { x: number; y: number; w: number; h: number } {
		const r = slot.getBoundingClientRect()
		return {
			x: live2dPos?.x ?? r.left,
			y: live2dPos?.y ?? r.top,
			w: slot.offsetWidth,
			h: slot.offsetHeight
		}
	}

	/** 屏幕坐标 → iframe 内坐标（iframe 左上角为原点） */
	function l2dToFrame(clientX: number, clientY: number): { x: number; y: number } | null {
		const r = live2dFrame?.getBoundingClientRect()
		if (!r) return null
		return { x: clientX - r.left, y: clientY - r.top }
	}

	function forwardL2dPointer(e: PointerEvent): void {
		const p = l2dToFrame(e.clientX, e.clientY)
		if (!p) return
		const key = `${Math.round(p.x)},${Math.round(p.y)}`
		if (key === l2dLastSent) return
		l2dLastSent = key
		live2dFrame?.contentWindow?.postMessage({ type: 'ff-pointer', x: p.x, y: p.y }, '*')
	}

	function onL2dDown(e: PointerEvent): void {
		if (!isMobile) return
		const el = e.currentTarget as HTMLElement
		const slot = el.closest('.live2d-slot') as HTMLElement | null
		if (!slot) return
		// 把手：按到就拖，不等长按
		if (el.hasAttribute('data-l2d-grip')) {
			startL2dDrag(e, el, slot)
			return
		}
		l2dPress = { x: e.clientX, y: e.clientY, slot, el }
		clearTimeout(l2dPressTimer)
		l2dPressTimer = setTimeout(() => {
			l2dPressTimer = undefined
			const p = l2dPress
			l2dPress = null
			if (p) startL2dDrag(e, p.el, p.slot)
		}, L2D_HOLD_MS)
	}

	function startL2dDrag(e: PointerEvent, el: HTMLElement, slot: HTMLElement): void {
		clearTimeout(l2dPressTimer)
		l2dPressTimer = undefined
		l2dPress = null
		l2dDragging = true
		l2dDragState = { px: e.clientX, py: e.clientY, ...l2dGeometry(slot) }
		// 指针捕获：手指滑出容器甚至滑出屏幕，后续事件也还跟着走
		el.setPointerCapture?.(e.pointerId)
		document.body.classList.add('ff-l2d-dragging')
		window.addEventListener('pointermove', onL2dMove)
		window.addEventListener('pointerup', onL2dUp)
		window.addEventListener('pointercancel', onL2dUp)
		e.preventDefault()
	}

	function onL2dMove(e: PointerEvent): void {
		if (l2dDragState) {
			const x = Math.min(window.innerWidth - l2dDragState.w - 4, Math.max(4, l2dDragState.x + (e.clientX - l2dDragState.px)))
			const y = Math.min(window.innerHeight - l2dDragState.h - 4, Math.max(4, l2dDragState.y + (e.clientY - l2dDragState.py)))
			live2dPos = { x, y }
			return
		}
		if (l2dPress && Math.hypot(e.clientX - l2dPress.x, e.clientY - l2dPress.y) > L2D_MOVE_TOL) {
			// 手指挪开了 → 这次按压不是长按，别抢人家的「摸头」
			clearTimeout(l2dPressTimer)
			l2dPressTimer = undefined
		}
		// 没在拖：把坐标转给 iframe，让模型的视线跟手
		forwardL2dPointer(e)
	}

	function onL2dUp(e: PointerEvent): void {
		clearTimeout(l2dPressTimer)
		l2dPressTimer = undefined
		// 没有进入拖动 = 这次是一次「点模型」：转发给 iframe 走命中区互动
		if (!l2dDragState && l2dPress) {
			const p = l2dToFrame(e.clientX, e.clientY)
			if (p) live2dFrame?.contentWindow?.postMessage({ type: 'ff-tap-at', x: p.x, y: p.y }, '*')
		}
		l2dPress = null
		if (!l2dDragState) return
		l2dDragging = false
		l2dDragState = null
		document.body.classList.remove('ff-l2d-dragging')
		window.removeEventListener('pointermove', onL2dMove)
		window.removeEventListener('pointerup', onL2dUp)
		window.removeEventListener('pointercancel', onL2dUp)
		if (live2dPos) {
			try {
				localStorage.setItem(live2dPosKey, JSON.stringify(live2dPos))
			} catch {
				/* 存不下就拉倒，不影响本次会话 */
			}
		}
	}

	/** 把看板娘放回右下角默认位置（设置页的「重置位置」） */
	function resetLive2dPos(): void {
		live2dPos = null
		try {
			localStorage.removeItem(live2dPosKey)
		} catch {
			/* 忽略 */
		}
		notify('看板娘已放回右下角')
	}

	const showLive2d = $derived(live2dEnabled && !live2dCollapsed)
	const live2dSrc = $derived(`live2d/embed.html?s=${Math.round(live2dScale * 100) / 100}&x=0&y=0&hw=1`)

	function saveLive2d(patch: { enabled?: boolean; collapsed?: boolean; scale?: number }): void {
		if (patch.enabled !== undefined) {
			live2dEnabled = patch.enabled
			saveLayoutUi({ live2dEnabled: patch.enabled })
		}
		if (patch.collapsed !== undefined) {
			live2dCollapsed = patch.collapsed
			saveLayoutUi({ live2dCollapsed: patch.collapsed })
		}
		if (patch.scale !== undefined) {
			live2dScale = patch.scale
			saveLayoutUi({ live2dScale: patch.scale })
		}
	}

	/**
	 * 模型是否已加载就绪（iframe 报过 ff-art = 能量到模型内容并按它摆好容器）。
	 *
	 * 这个标志只给「节能切换」用：加载器的静止肖像（ff-static）是**停在最后一帧**，
	 * 而 iframe 刚 onload 时画面还什么都没有（Live2D 模型 + 纹理还在下载/解析）。
	 * 那时若按 1.5s 无操作倒计时切进静止，就等于把「空白的一帧」永久定格 ——
	 * 表现正是「点开/展开后看板娘不出现，非得在模型上点一下才出来」
	 * （手机上没有 hover，只有那次点击才会把渲染循环重新启动）。
	 */
	let live2dReady = $state(false)

	/**
	 * 节能：加载器有「流畅 / 静止肖像」两档，靠父页发 ff-live / ff-static 切换。
	 * 鼠标动 → ff-live，停 1.5s → ff-static（停渲染、保留最后一帧，CPU 归零）。
	 * 桌面端还有 ff-pause（拖拽/失焦），这里只在标签页隐藏时用。
	 */
	function pokeLive2d(): void {
		if (!showLive2d) return
		live2dFrame?.contentWindow?.postMessage({ type: 'ff-live' }, '*')
		clearTimeout(live2dIdleTimer)
		// 模型还没就绪就不进静止（见 live2dReady 的说明）：宁可多渲染几秒，
		// 也不能把空白帧定格成「看不到看板娘」
		if (!live2dReady) return
		live2dIdleTimer = setTimeout(() => live2dFrame?.contentWindow?.postMessage({ type: 'ff-static' }, '*'), 1500)
	}

	/** iframe → 父页：模型宽高比 / 说的话 / 点「收起」按钮 */
	function onLive2dMessage(e: MessageEvent): void {
		const frame = live2dFrame?.contentWindow
		if (!frame || e.source !== frame) return
		const d = e.data as { type?: string; ratio?: number; text?: string } | null
		if (!d || typeof d.type !== 'string') return
		if (d.type === 'ff-art' && typeof d.ratio === 'number' && d.ratio > 0.2) {
			live2dRatio = d.ratio
			// 模型就绪：从这一刻起才允许进入「静止肖像」节能（见 live2dReady）
			if (!live2dReady) {
				live2dReady = true
				pokeLive2d()
			}
		} else if (d.type === 'ff-say') live2dSay = typeof d.text === 'string' ? d.text : ''
		else if (d.type === 'ff-open-url' && typeof d.url === 'string') {
			// 看板娘要开外链（🔗 了解流萤）：开新标签，绝不让它在那个小 iframe 里导航
			void window.api.openExternal(d.url).catch((err) => notify(errMsg(err), false))
		} else if (d.type === 'ff-hover' || d.type === 'ff-interact') {
			// 鼠标停在模型上 / 刚互动过：回到流畅渲染
			pokeLive2d()
		} else if (d.type === 'ff-collapse') {
			live2dSay = ''
			saveLive2d({ collapsed: true })
			notify('看板娘已收起（在「设置」里可以放回来）')
		}
	}

	let toastMsg = $state('')
	let toastOk = $state(true)
	let toastTimer: ReturnType<typeof setTimeout> | undefined
	function notify(msg: string, ok = true): void {
		toastMsg = msg
		toastOk = ok
		clearTimeout(toastTimer)
		toastTimer = setTimeout(() => (toastMsg = ''), ok ? 2600 : 5200)
	}
	setContext('notify', notify)
	setContext('setAccent', setAccent)
	setContext('appearance', () => appearance)
	// 设置页要跳去图床页挑图（见 lib/pick-image.ts），页面跳转只能由 App 改状态
	setContext('gotoPage', gotoPage)

	const ICONS: Record<string, string> = {
		posts: '📄',
		dynamic: '💬',
		projects: '🧩',
		spec: '📚',
		pages: '📚',
		notes: '📝'
	}

	/** 集合 → 侧栏标题：常见集合给惯用名，其余用配置里的 label */
	function collectionLabel(c: CollectionMeta): string {
		if (c.name === 'posts') return '文章管理'
		if (c.name === 'dynamic') return '动态发布'
		if (c.name === 'projects') return '项目展示'
		return `${c.label || c.name}管理`
	}

	const nav = $derived.by(() => {
		const out: { id: string; label: string; icon: string }[] = []
		// 动态有专用页（memos 输入框 + 本地发布两栏），走 Dynamics 而不是裸 ContentManager
		if (collections.some((c) => c.name === 'dynamic')) out.push({ id: 'dynamics', label: '动态发布', icon: '💬' })
		for (const c of collections) {
			if (c.name === 'dynamic' || c.name === 'gallery') continue
			out.push({ id: `c:${c.name}`, label: collectionLabel(c), icon: ICONS[c.name] ?? '🧩' })
		}
		out.push(
			{ id: 'gallery', label: '图床管理', icon: '🖼️' },
			{ id: 'configs', label: '配置中心', icon: '🎛️' },
			{ id: 'publish', label: '发布上线', icon: '🚀' },
			{ id: 'trash', label: '回收站', icon: '🗑️' },
			{ id: 'settings', label: '设置', icon: '⚙️' }
		)
		return out
	})

	const currentCollection = $derived(collections.find((c) => `c:${c.name}` === page) ?? null)

	function gotoPage(id: string): void {
		page = id
		drawerOpen = false
		saveLayoutUi({ page: id })
	}

	function setSidebarW(w: number): void {
		sidebarW = w
	}
	function persistSidebarW(w: number): void {
		saveLayoutUi({ sidebarWidth: Math.round(w) })
	}

	const ACCENT_PRESETS = [
		{ name: '流萤·薄荷', accent: '#14B8A6', deep: '#0D9488' },
		{ name: '琥珀·余烬', accent: '#F59E0B', deep: '#D97706' },
		{ name: '樱粉·梦境', accent: '#EC7FA9', deep: '#DB5A8C' },
		{ name: '星穹·蓝', accent: '#5B8DEF', deep: '#3B6FD1' },
		{ name: '极光·紫', accent: '#8B7CF6', deep: '#6D5BD8' }
	]

	/** 主题色：写 localStorage 并立刻改 CSS 变量（刷新后由 applyAccent 恢复） */
	async function setAccent(name: string, accent: string, deep: string): Promise<void> {
		try {
			appearance = await window.api.appearanceSet({ accent, accentDeep: deep })
			document.documentElement.style.setProperty('--accent', accent)
			document.documentElement.style.setProperty('--accent-deep', deep)
			notify(`主题色已切换为「${name}」`)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function boot(): Promise<void> {
		window.api.applyAccent()
		loggedIn = window.api.isLoggedIn()
		try {
			const init = await window.api.appInit()
			appearance = init.appearance ?? {}
		} catch {
			/* 外观读取失败不影响使用 */
		}
		if (!loggedIn) {
			// 未登录：不跳登录页、也不报错，进主界面（列表为空）并弹一条提示
			collections = []
			fatal = ''
			phase = 'ready'
			notify('未登录：读取内容需要 GitHub 授权，请到「设置 → 账号」登录', false)
			return
		}
		try {
			collections = await window.api.collectionsList()
			const names = new Set(nav.map((n) => n.id))
			if (!names.has(page)) page = nav[0]?.id ?? 'configs'
			phase = 'ready'
			// 后台壁纸：D1 配置（key=wallpaper）→ 应用到全屏壁纸层
			try {
				applyWallpaperFromConfig(await window.api.configGet('wallpaper'))
			} catch {
				/* 壁纸配置读不到不影响主流程 */
			}
		} catch (e) {
			fatal = errMsg(e)
			phase = 'ready'
			notify(fatal, false)
		}
	}

	/** 直接跳 GitHub 授权（成功后回跳本页并带上 token） */
	function login(): void {
		window.location.href = `${API_BASE}/api/auth/github`
	}

	onMount(() => {
		void boot()
		// 读回上次拖动保存的看板娘位置
		try {
			const raw = localStorage.getItem(live2dPosKey)
			if (raw) {
				const p = JSON.parse(raw) as { x?: number; y?: number }
				if (typeof p.x === 'number' && typeof p.y === 'number') live2dPos = { x: p.x, y: p.y }
			}
		} catch {
			/* 坏缓存忽略 */
		}
		const mq = window.matchMedia('(max-width: 900px)')
		isMobile = mq.matches
		const onMq = (): void => {
			isMobile = mq.matches
			if (!mq.matches) drawerOpen = false
			// 跨过 900px（转屏 / 改窗口宽度）：按新视口重挑一张壁纸（手机壁纸 ↔ 电脑壁纸）
			refreshWallpaperForViewport()
		}
		mq.addEventListener('change', onMq)

		window.addEventListener('message', onLive2dMessage)
		window.addEventListener('pointermove', pokeLive2d, { passive: true })
		// 标签页切到后台：整帧停掉（手机上这条最省电）
		const onVis = (): void => live2dFrame?.contentWindow?.postMessage({ type: document.hidden ? 'ff-pause' : 'ff-resume' }, '*')
		document.addEventListener('visibilitychange', onVis)
		// token 失效（任意请求 401）：留在主界面，弹提示让人去设置页重新登录
		const onAuthFailed = (): void => {
			if (!loggedIn) return
			loggedIn = false
			collections = []
			notify('登录已失效：请到「设置 → 账号」重新登录', false)
		}
		window.addEventListener('ff:auth-failed', onAuthFailed)
		return () => {
			window.removeEventListener('ff:auth-failed', onAuthFailed)
			mq.removeEventListener('change', onMq)
			window.removeEventListener('message', onLive2dMessage)
			window.removeEventListener('pointermove', pokeLive2d)
			document.removeEventListener('visibilitychange', onVis)
			clearTimeout(live2dIdleTimer)
		}
	})
</script>

{#if phase === 'loading'}
	<div class="ff-boot">
		<div class="ff-boot-inner">
			<div class="ff-boot-logo">✨</div>
			<div class="ff-boot-title">Firefly 后台</div>
			<div class="ff-boot-sub">正在读取仓库配置…</div>
		</div>
	</div>
{:else}
{#snippet l2dSlot(floating: boolean)}
	<!-- 看板娘：容器 = 模型 + 右侧 MENU_BAND 宽的按钮带子（与 embed.html 的 controlsGutter 一致）。
	     悬浮（手机）时的尺寸也跟「模型大小」联动：以前这个滑块只作用于桌面侧栏，
	     手机上拖了滑块什么都没发生。基准 150px，随滑块 0.4×~1.6× 缩放。 -->
	{@const mw = `clamp(calc(96px * ${live2dScale}), calc(150px * ${live2dScale}), calc(200px * ${live2dScale}))`}
	<div
		class="live2d-slot"
		class:floating
		style={floating
			? `${live2dPos ? `left: ${live2dPos.x}px; top: ${live2dPos.y}px;` : 'right: 6px; bottom: 8px;'} width: ${mw}; height: max(2px, calc((${mw} - ${MENU_BAND}px) / ${live2dRatio} + 2px))`
			: `--slot-w: max(1px, calc(100cqw * ${live2dScale})); width: var(--slot-w); height: max(2px, calc((var(--slot-w) - ${MENU_BAND}px) / ${live2dRatio} + 2px))`}
	>
		{#if floating}
			<!-- 把手：浮动时显示在容器左上角，抓它立刻可拖。
			     抓不住也没关系 —— 直接长按模型 0.35s 同样是拖动（见 onL2dDown）。 -->
			<div
				class="live2d-handle"
				class:active={l2dDragging}
				data-l2d-grip="1"
				onpointerdown={onL2dDown}
				aria-label="拖动看板娘位置"
				role="button"
				tabindex="0"
			>
				<span aria-hidden="true">⠿</span>
			</div>
		{/if}
		<!-- 接压层：铺在 iframe 之上，负责「按住模型」这件事。
		     页面上的监听收不到 iframe 内部的指针事件，不铺这层就永远不知道用户
		     按住了模型，长按拖动无从谈起。代价是模型收不到真实按压，所以按压结束
		     时把坐标 postMessage 回 iframe（ff-tap-at），由它合成一次点击，
		     命中区互动（摸头 / 点表情）照旧生效。
		     只在悬浮（移动端）铺：桌面端模型在侧栏格子里直接可点，加这层反而挡了它。 -->
		{#if floating}
			<div
				class="live2d-grab"
				class:dragging={l2dDragging}
				onpointerdown={onL2dDown}
				onpointermove={onL2dMove}
				onpointerup={onL2dUp}
				onpointercancel={onL2dUp}
			></div>
		{/if}
		<iframe
			bind:this={live2dFrame}
			src={live2dSrc}
			title="流萤看板娘"
			onload={() => {
				// 新挂载的 iframe（首次进入 / 收起后再展开）还没加载模型，先清掉就绪标记
				live2dReady = false
				pokeLive2d()
			}}
		></iframe>
		<div class="live2d-above" style="left: calc((100% - {MENU_BAND}px) / 2); width: max(1px, calc(100% - {MENU_BAND}px))">
			{#if live2dSay}
				<div class="live2d-say">{live2dSay}</div>
			{/if}
		</div>
	</div>
{/snippet}

	<div class="layout" class:mobile={isMobile}>
		<!-- 移动端顶栏：只留汉堡键（开抽屉）+ 刷新键。
		     中间**不显示页面标题**：标题与抽屉里选中的那一项本来就是同一个名字，
		     占掉窄屏最值钱的一行却不说新信息（设置页更是只剩「设置」两个字）。
		     桌面端由 CSS 隐藏这一整条。 -->
		<header class="ff-mobile-bar">
			<button class="ff-burger" aria-label="打开菜单" onclick={() => (drawerOpen = true)}>☰</button>
			<button class="ff-burger" aria-label="刷新" onclick={() => void boot()}>↻</button>
		</header>
		<!-- 抽屉打开时的遮罩：点一下关掉 -->
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		{#if isMobile && drawerOpen}
			<div class="ff-drawer-mask" onclick={() => (drawerOpen = false)}></div>
		{/if}
		<aside class="sidebar" class:mobile-open={drawerOpen} style={isMobile ? '' : `width:${sidebarW}px`}>
			<div class="brand">✨ Firefly 后台</div>
			{#each nav as item (item.id)}
				<button class="nav-item" class:active={page === item.id} onclick={() => gotoPage(item.id)}>
					<span>{item.icon}</span>
					<span>{item.label}</span>
				</button>
			{/each}
			{#if showLive2d && !isMobile}
				{@render l2dSlot(false)}
			{/if}
			<div class="sidebar-foot muted">
				{#if collections.length}共 {collections.length} 个内容集合{/if}
			</div>
		</aside>
		{#if !isMobile}
			<DragBar side="right" width={sidebarW} onresize={setSidebarW} onfinish={persistSidebarW} gapLeft={14} />
		{/if}
		<!-- 移动端的看板娘必须渲染在抽屉**外面**：.sidebar 有 transform，
		     transform 会让它成为 fixed 后代的包含块 —— 放在里面的话，
		     抽屉一收起，右下角的看板娘会跟着一起被平移出屏幕。 -->
		{#if showLive2d && isMobile}
			{@render l2dSlot(true)}
		{/if}
		<main class="content">
			{#if !loggedIn && page !== 'settings'}
				<div class="card login-hint">
					<h3>🔒 尚未登录</h3>
					<p class="muted" style="line-height:1.8; margin-top:0">
						内容和配置都存在你的博客仓库里，读取与保存需要 GitHub 授权。<br />
						登录后左侧的集合菜单会按 <code>.fireflux.yml</code> 自动出现。
					</p>
					<div class="row">
						<button class="btn primary" onclick={login}>使用 GitHub 登录</button>
						<button class="btn" onclick={() => gotoPage('settings')}>去设置页</button>
					</div>
					<!-- DEV-BYPASS: 调试用密码登录；上线前删除这一行 -->
					<DevLogin onSuccess={() => window.location.reload()} />
				</div>
			{:else if fatal}
				<div class="card">
					<h3>⚠️ 读取配置失败</h3>
					<p class="muted">{fatal}</p>
					<p class="muted">检查 .fireflux.yml 是否已推送到仓库，以及后端 API 地址（VITE_API_URL）是否正确。</p>
					<button class="btn primary" onclick={() => void boot()}>重试</button>
				</div>
			{:else if page === 'dynamics'}
				<Dynamics />
			{:else if currentCollection}
				<ContentManager
					folder={currentCollection.name}
					title={collectionLabel(currentCollection)}
					icon={ICONS[currentCollection.name] ?? '🧩'}
					canCreate
					createKind={currentCollection.name === 'projects' ? 'project' : 'post'}
					createLabel={`新建${currentCollection.label || '内容'}`}
					canImage
					features={currentCollection.features}
					hint={`内容存放在 ${currentCollection.path}/；编辑保存即提交推送，云端构建后生效。`}
				/>
			{:else if page === 'gallery'}
				<Gallery />
			{:else if page === 'configs'}
				<ConfigCenter />
			{:else if page === 'publish'}
				<Publish />
			{:else if page === 'trash'}
				<Trash />
			{:else}
				<Settings
					{appearance}
					{ACCENT_PRESETS}
					{loggedIn}
					{live2dEnabled}
					{live2dScale}
					onLive2dToggle={(v) => saveLive2d({ enabled: v, collapsed: false })}
					onLive2dScale={(v) => saveLive2d({ scale: v })}
					onLive2dCollapse={() => saveLive2d({ collapsed: true })}
					onLive2dExpand={() => saveLive2d({ collapsed: false })}
					onLive2dResetPos={resetLive2dPos}
				/>
			{/if}
		</main>
	</div>
{/if}

{#if toastMsg}
	<div class="toast" class:err={!toastOk}>{toastMsg}</div>
{/if}

<ConfirmDialog />

<style>
	.ff-boot {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: linear-gradient(140deg, #eafaf6 0%, #fdf8ef 100%);
	}
	.ff-boot-inner {
		text-align: center;
		color: #0f766e;
	}
	.ff-boot-logo {
		font-size: 42px;
		animation: ff-pulse 1.6s ease-in-out infinite;
	}
	.ff-boot-title {
		margin-top: 10px;
		font-size: 20px;
		font-weight: 700;
	}
	.ff-boot-sub {
		margin-top: 6px;
		font-size: 13px;
		opacity: 0.7;
	}
	@keyframes ff-pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.85;
		}
		50% {
			transform: scale(1.12);
			opacity: 1;
		}
	}
	.login-hint {
		max-width: 560px;
	}

	/* ===== 看板娘 ===== */
	/* 样式与桌面端 App.svelte 一致：容器 = 模型 + 右侧 MENU_BAND 宽的按钮带子 */
	.live2d-slot {
		flex: none;
		/* margin-top:auto 把它顶到侧栏左下角，横向居中 */
		margin: auto auto 0;
		position: relative;
		z-index: 1;
	}
	.live2d-slot iframe {
		width: 100%;
		height: 100%;
		border: none;
		background: transparent;
		display: block;
	}
	/* 移动端：右下角悬浮（宽度取 clamp，高度仍按模型宽高比算） */
	.live2d-slot.floating {
		position: fixed;
		right: 6px;
		bottom: 8px;
		z-index: 40;
		margin: 0;
		--l2d-mw: clamp(120px, 40vw, 180px);
		filter: drop-shadow(0 6px 16px rgba(12, 28, 26, 0.18));
		/* 关掉浏览器的长按手势（选中菜单 / 放大镜），否则长按拖动会先弹出那个菜单 */
		-webkit-touch-callout: none;
	}
	/* 长按拖动层：铺满容器、盖在 iframe 之上 —— 页面收不到 iframe 里的 pointer 事件，
	   所以由它接住按压，拖动时把坐标送回父页（见 embed.html 的桥接）。
	   这层只铺在移动端悬浮态上，桌面端的模型互动不能被它挡住。 */
	.live2d-grab {
		position: absolute;
		inset: 0;
		z-index: 2;
		touch-action: none;
		-webkit-tap-highlight-color: transparent;
		cursor: grab;
	}
	.live2d-grab.dragging {
		cursor: grabbing;
	}
	/* 拖动把手：模型左上角一颗 34px 的圆钮（原来 26px，手指按不准） */
	.live2d-handle {
		position: absolute;
		left: -8px;
		top: -8px;
		width: 34px;
		height: 34px;
		z-index: 4;
		cursor: grab;
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.92);
		border: 1px solid var(--line);
		box-shadow: 0 2px 10px rgba(12, 28, 26, 0.22);
		transition: background 0.15s, transform 0.15s;
	}
	.live2d-handle > span {
		color: rgba(13, 110, 100, 0.65);
		font-size: 16px;
		line-height: 1;
		pointer-events: none;
	}
	.live2d-handle:active,
	.live2d-handle.active {
		background: var(--accent-soft);
		transform: scale(1.08);
	}
	body.ff-dragging .live2d-handle {
		cursor: grabbing;
	}
	.live2d-above {
		position: absolute;
		bottom: calc(100% + 6px); /* 容器上沿再往上 6px：正好在流萤头顶之上，不压头发 */
		transform: translateX(-50%);
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 6px;
		pointer-events: none; /* 只是提示，别挡其他操作的点击 */
	}
	.live2d-above > * {
		width: max-content;
		max-width: 100%;
		text-align: center;
		border-radius: 8px;
		padding: 6px 10px;
		color: #fff;
	}
	.live2d-say {
		background: rgba(20, 28, 32, 0.86);
		border: 1px solid rgba(255, 255, 255, 0.3);
		font-size: 13px;
		line-height: 1.5;
	}

	.sidebar-foot {
		margin-top: auto;
		padding: 10px 6px 4px;
		font-size: 12px;
	}
</style>
