<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import DragBar from '../components/DragBar.svelte'
	import FormKit from '../components/FormKit.svelte'
	import type { ConfigExportData, ConfigReadResult, DiscoveredConfig } from '../lib/api'
	import { errMsg, plain } from '../lib/err'
	import { confirmDanger } from '../lib/confirm.svelte'
	import { readLayoutNumber, saveLayoutUi } from '../lib/layout'
	import { SCHEMAS } from '../lib/schemas/configs'
	import type { FieldDef } from '../lib/schema-types'
	import { CONFIG_REGISTRY } from '../lib/registry'

	interface DisplayEntry {
		rel: string
		kind: 'ts' | 'html'
		exports: string[]
		title: string
		desc: string
		group: string
	}

	let discovered = $state<DiscoveredConfig[]>([])
	let selectedRel = $state('')
	let rel = $state('')
	let isHtml = $state(false)
	let htmlContent = $state('')
	let exportsData = $state<ConfigExportData[]>([])
	let activeExport = $state(0)
	let originalJson = $state('')
	let busy = $state(false)
	let search = $state('')
	let ccW = $state(readLayoutNumber('configListWidth', 280))
	function setCcW(w: number): void {
		ccW = w
	}
	function persistCcW(w: number): void {
		saveLayoutUi({ configListWidth: Math.round(w) })
	}

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	// ===== 窄屏：整屏列表 ↔ 整屏表单 =====
	//
	// 原来窄屏是「列表 + 表单」上下堆在一页里，两边各占半屏（一屏 800px 高时每边只有
	// 300 多像素，字段多的一屏根本点不完）。改成两屏：列表铺满整屏，点一个配置
	// 才切到整屏表单页，左上角返回。宽屏仍是左列表 + 右表单两栏。
	let isNarrow = $state(false)
	let screen = $state<'list' | 'form'>('list')

	$effect(() => {
		const mq = window.matchMedia('(max-width: 900px)')
		const sync = (): void => {
			isNarrow = mq.matches
			if (!mq.matches) screen = 'list'
		}
		sync()
		mq.addEventListener('change', sync)
		return () => mq.removeEventListener('change', sync)
	})

	const GROUP_ORDER = ['基础', '外观', '功能', '内容', '其他']
	const registryByRel = new Map(CONFIG_REGISTRY.map((e) => [e.rel, e]))
	const relToId = new Map(CONFIG_REGISTRY.map((e) => [e.rel, e.id]))

	/** 项目文件动态发现 + 注册表别名合并：新配置文件自动出现，删除的自动消失 */
	const entries = $derived.by(() => {
		const out: DisplayEntry[] = []
		for (const d of discovered) {
			// 函数导出（如 friendsConfig 的 getEnabledFriends）已由服务端 exportedNames 过滤，
			// 这里不再重复判断。
			const reg = registryByRel.get(d.rel)
			if (reg) {
				out.push({ rel: d.rel, kind: d.kind, exports: d.exports, title: reg.title, desc: reg.desc, group: reg.group })
			} else {
				const base = (d.rel.split('/').pop() ?? d.rel).replace(/\.(ts|html)$/i, '')
				out.push({ rel: d.rel, kind: d.kind, exports: d.exports, title: base, desc: d.rel, group: '其他' })
			}
		}
		return out
	})
	const filtered = $derived(entries.filter((e) => !search || e.title.includes(search) || e.desc.includes(search) || e.rel.includes(search)))
	// 分组标题按「搜索结果里还剩哪些组」生成，避免搜索时留下一堆空标题
	const groups = $derived.by(() => {
		const set = [...new Set(filtered.map((e) => e.group))]
		return set.sort((a, b) => {
			const ia = GROUP_ORDER.indexOf(a)
			const ib = GROUP_ORDER.indexOf(b)
			return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
		})
	})

	const selected = $derived(entries.find((e) => e.rel === selectedRel))
	const dirty = $derived(isHtml ? htmlContent !== originalJson : JSON.stringify(exportsData) !== originalJson)
	const currentSchema = $derived.by(() => {
		if (!selected || isHtml || !exportsData[activeExport]) return {}
		const id = relToId.get(selected.rel) ?? ''
		return SCHEMAS[id]?.[exportsData[activeExport].name] ?? {}
	})
	const rootDef = $derived<FieldDef | undefined>(buildRootDef(currentSchema, exportsData[activeExport]?.values))

	interface EntrySchemaView {
		fields?: FieldDef[]
		rootItem?: FieldDef[]
		rootTitleKey?: string
	}

	/** 一个导出对象对应一个表单：根是数组就渲染成列表，否则渲染成字段组 */
	function buildRootDef(schema: EntrySchemaView, values: unknown): FieldDef | undefined {
		if (Array.isArray(values)) return { k: '__root', w: 'list', item: schema.rootItem, titleKey: schema.rootTitleKey }
		return { k: '__root', w: 'group', fields: schema.fields }
	}

	/**
	 * 配置引擎在 Rust 侧（`engine::config`）：自研字面量解析器加 span 文本补丁，
	 * 只替换被改字段的字面量，注释、as const、其余代码原样保留，
	 * 写盘前重新解析逐项复核，不过就整份不写。
	 */
	onMount(async () => {
		try {
			discovered = await window.api.configDiscover()
		} catch (e) {
			notify(errMsg(e), false)
		}
	})

	async function open(entry: DisplayEntry): Promise<void> {
		try {
			// entry 来自响应式状态，参数必须在调用前转纯（contextBridge 无法克隆代理）
			const res: ConfigReadResult = await window.api.configRead(plain({ rel: entry.rel, kind: entry.kind, exports: entry.exports }))
			selectedRel = entry.rel
			rel = res.rel
			if (res.kind === 'html') {
				isHtml = true
				htmlContent = res.content
				originalJson = res.content
				exportsData = []
			} else {
				isHtml = false
				exportsData = res.exports
				originalJson = JSON.stringify(res.exports)
				activeExport = 0
			}
			// 窄屏点完直接进表单屏（列表屏只在没选中任何配置时显示）
			if (isNarrow) screen = 'form'
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function save(): Promise<void> {
		busy = true
		try {
			if (isHtml) {
				await window.api.configWrite(plain({ rel, kind: 'html', content: htmlContent }))
			} else {
				const current = exportsData[activeExport]
				await window.api.configWrite(plain({ rel, kind: 'ts', exportName: current.name, values: current.values }))
			}
			originalJson = isHtml ? htmlContent : JSON.stringify(exportsData)
			notify('已保存并推送（博客等云端构建后生效；改动前的版本在 git 里）')
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	function resetValues(): void {
		if (isHtml) htmlContent = originalJson
		else exportsData = JSON.parse(originalJson) as ConfigExportData[]
	}

	async function refreshDiscovery(): Promise<void> {
		try {
			discovered = await window.api.configDiscover()
		} catch {
			/* 忽略 */
		}
	}

	/**
	 * 详情页的刷新：重新扫描配置文件清单，并把**当前选中的文件重新从磁盘读一遍**。
	 * 有未保存修改时会先问一句，避免把用户的编辑冲掉。
	 */
	async function refreshCurrent(): Promise<void> {
		if (busy) return
		if (dirty && !await confirmDanger('当前配置有未保存的修改，刷新会丢弃这些改动。\n仍要刷新吗？')) return
		await refreshDiscovery()
		const entry = selected
		if (!entry) {
			notify('已重新扫描配置文件')
			return
		}
		busy = true
		try {
			await open(entry)
			notify(`已重新从仓库读取 ${entry.rel}`)
		} finally {
			busy = false
		}
	}
</script>

<div class="cc-page">
<!-- 配置项列表：窄屏整屏列表屏 / 宽屏左栏，两边共用同一段 -->
{#snippet list()}
	{#each groups as grp}
		<div class="muted cc-group">{grp}</div>
		{#each filtered.filter((e) => e.group === grp) as e (e.rel)}
			<button class="cc-item" class:active={selectedRel === e.rel} onclick={() => open(e)}>
				<div><b>{e.title}</b></div>
				<div class="muted">{e.desc}</div>
			</button>
		{/each}
	{/each}
	{#if !entries.length}
		<p class="muted">未发现配置文件，请先绑定项目文件夹。</p>
	{/if}
{/snippet}

<!-- 表单：窄屏整屏表单屏 / 宽屏右栏，两边共用同一段 -->
{#snippet form()}
	{#if !selected}
		<div class="card" data-ff-block="configs/empty"><p class="muted">从左侧选择一个配置文件开始编辑。所有改动保存即推送（自动构建发布后生效）。</p></div>
	{:else}
		<div class="row cc-editor-head">
			<div class="row">
				<h3 style="margin:0">{selected.title}</h3>
				<span class="muted">{selected.rel}</span>
			</div>
			<div class="row">
				{#if dirty}<span class="tag" style="background:#fff3cd; color:#8a6d3b">有未保存修改</span>{/if}
				<button class="btn" onclick={refreshCurrent} disabled={busy} title="重新扫描配置清单，并从磁盘重新读取当前配置">
					↻ 刷新
				</button>
				<button class="btn" onclick={resetValues} disabled={!dirty || busy}>放弃修改</button>
				<button class="btn primary" onclick={save} disabled={!dirty || busy}>保存</button>
			</div>
		</div>

		{#if !isHtml && exportsData.length > 1}
			<div class="row" style="margin-bottom:8px">
				{#each exportsData as ex, i}
					<button class="btn small" class:primary={activeExport === i} onclick={() => (activeExport = i)}>{ex.name}</button>
				{/each}
			</div>
		{/if}

		<div class="card" data-ff-block="configs/form">
			{#if isHtml}
				<textarea class="code" rows="16" bind:value={htmlContent}></textarea>
				<p class="hint">自定义 HTML 会注入到页脚（需在「页脚开关」里启用）。</p>
			{:else if exportsData[activeExport]}
				<FormKit
					def={rootDef}
					value={exportsData[activeExport].values}
					path=""
					labels={exportsData[activeExport].labels}
					oninput={() => {}}
					bare
				/>
			{/if}
		</div>
	{/if}
{/snippet}

{#if isNarrow}
	<!-- 窄屏两屏：列表铺满整屏 → 点一个配置 → 表单铺满整屏（带返回） -->
	{#if screen === 'form' && selected}
		<div class="cc-mbar">
			<button class="btn" onclick={() => (screen = 'list')}>← 配置列表</button>
			<b>{selected.title}</b>
			<button class="btn small" onclick={refreshDiscovery}>🔄</button>
		</div>
		<div class="cc-mform">
			{@render form()}
		</div>
	{:else}
		<div class="cc-mbar">
			<b>🎛️ 配置中心</b>
			<button class="btn small" onclick={refreshDiscovery}>🔄 重新扫描</button>
		</div>
		<input class="cc-msearch" placeholder="搜索配置…" bind:value={search} />
		<div class="cc-mlist">
			{@render list()}
		</div>
	{/if}
{:else}
	<div class="row" style="justify-content:space-between; margin-bottom:14px">
		<h2 style="margin:0">🎛️ 配置中心</h2>
		<div class="row">
			<input placeholder="搜索配置…" bind:value={search} style="max-width:200px" />
			<button class="btn" onclick={refreshDiscovery}>🔄 重新扫描</button>
		</div>
	</div>

	<div class="cc-layout">
		<div class="cc-list" style="width:{ccW}px">
			{@render list()}
		</div>

		<DragBar side="right" width={ccW} onresize={setCcW} onfinish={persistCcW} />

		<div class="cc-editor">
			{@render form()}
		</div>
	</div>
{/if}
</div>

<style>
	.cc-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-sizing: border-box;
	}
	.cc-layout {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 16px;
		align-items: stretch;
	}
	.cc-list {
		/* 宽度由内联 style 给（拖拽改写）；min-width 是拖拽下界，窗口变窄时也允许被压缩 */
		flex-shrink: 1;
		min-width: 180px;
		height: 100%;
		overflow: auto;
		box-sizing: border-box;
	}
	.cc-item {
		display: block;
		width: 100%;
		text-align: left;
		border: 1px solid var(--line);
		background: rgba(255, 255, 255, var(--panel-alpha));
		border-radius: 10px;
		padding: 8px 12px;
		margin-bottom: 6px;
	}
	.cc-item:hover {
		border-color: var(--accent);
	}
	.cc-item.active {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.cc-item .muted {
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cc-editor {
		flex: 1;
		/* 拖拽上界由它推导：右侧编辑区不能被压得比这更窄 */
		min-width: 260px;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.cc-editor > .card {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.cc-group {
		margin: 10px 4px 4px;
		font-weight: 600;
	}
	.cc-editor-head {
		justify-content: space-between;
		margin-bottom: 10px;
	}

	/* ===== 窄屏专属（只在 isNarrow 时渲染）：整屏列表 / 整屏表单 ===== */
	.cc-mbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		min-height: 40px;
	}
	.cc-mbar .btn {
		flex-shrink: 0;
	}
	.cc-mbar b {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.cc-msearch {
		flex-shrink: 0;
	}
	.cc-mlist {
		flex: 1;
		min-height: 220px;
		overflow: auto;
	}
	.cc-mlist .cc-item {
		padding: 11px 12px;
	}
	.cc-mform {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.cc-mform > .card {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
</style>
