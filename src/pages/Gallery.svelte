<script lang="ts">
	/**
	 * 图床管理（Web 版简化）：列出图床里的图片、上传、复制直链、删除。
	 * 桌面版是本地相册（相册目录 + 排序 + 封面），网页版没有项目磁盘，
	 * 统一走 .fireflux.yml 里 media.external_imgbed 声明的图床。
	 */
	import { getContext } from 'svelte'
	import { errMsg } from '../lib/err'
	import { confirmIrreversible } from '../lib/confirm.svelte'
	import { cancelPick, deliverPick, PICK_LABELS, pickSlot } from '../lib/pick-image'

	interface Img { key: string; size: number; url: string }

	let images = $state<Img[]>([])
	let loading = $state(true)
	let uploading = $state(false)
	let filter = $state('')
	const notify = getContext<(m: string, ok?: boolean) => void>('notify')
	const gotoPage = getContext<(id: string) => void>('gotoPage')

	/**
	 * 「选图回填」模式：从设置页点「去图床选图」跳过来时为真。
	 * 这时每张图多一个「用作壁纸」按钮，上传完也会把第一张直接填回去，
	 * 不用再手动挑一次。回填后立刻回设置页并清掉模式。
	 *
	 * 用 $state 而不是 $derived(pickSlot())：pickSlot() 读的是模块级普通变量，
	 * Svelte 追踪不到，模式切换后不会重算。这里在每次状态变化时显式写回。
	 */
	let picking = $state(pickSlot() !== null)
	/** 正在为哪一项挑图（设置页那个输入框的名字，用于按钮与提示文案） */
	const labelOf = (): string => {
		const s = pickSlot()
		return s ? PICK_LABELS[s] : ''
	}
	let pickingLabel = $state(labelOf())

	async function load(): Promise<void> {
		loading = true
		try {
			images = (await window.api.listImages()).sort((a, b) => a.key.localeCompare(b.key))
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			loading = false
		}
	}
	$effect(() => {
		void load()
	})

	const filtered = $derived(images.filter((i) => !filter || i.key.toLowerCase().includes(filter.toLowerCase())))

	function human(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`
	}

	async function pick(): Promise<void> {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = 'image/*'
		input.multiple = !picking
		input.onchange = async () => {
			const files = [...(input.files ?? [])]
			if (!files.length) return
			uploading = true
			try {
				const urls: string[] = []
				for (const f of files) urls.push(await window.api.uploadImage(f))
				notify(`已上传 ${files.length} 张图片`)
				await load()
				// 选图模式：上传就是为了这张图，第一张直接交回去，不用再点一次
				if (picking && urls[0]) useAs(urls[0])
			} catch (e) {
				notify(errMsg(e), false)
			} finally {
				uploading = false
			}
		}
		input.click()
	}

	/** 把这张图交回设置页，并跳回去（交回即退出选图模式） */
	function useAs(url: string): void {
		// 标签要在 deliverPick **之前**取：交回完成时 slot 已被清空
		const label = pickingLabel
		if (!deliverPick(url)) {
			picking = false
			pickingLabel = ''
			notify('没有待填的目标（可能已退出选图模式）', false)
			return
		}
		picking = false
		pickingLabel = ''
		notify(`已选中「${label}」的图床直链，正在回设置页…`)
		gotoPage('settings')
	}

	/** 放弃这次选择：清掉待填目标并回设置页 */
	function abortPick(): void {
		cancelPick()
		picking = false
		pickingLabel = ''
		gotoPage('settings')
	}

	async function copy(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url)
			notify('直链已复制')
		} catch {
			notify('复制失败，请手动选择链接', false)
		}
	}

	async function remove(img: Img): Promise<void> {
		if (!(await confirmIrreversible(`永久删除图片 ${img.key}？`, '图床上的文件会立即删除，正文里已引用的图片会变成裂图。'))) return
		try {
			await window.api.deleteImage(img.key)
			notify('已删除')
			await load()
		} catch (e) {
			notify(errMsg(e), false)
		}
	}
</script>

<div class="row" style="justify-content:space-between; margin-bottom:10px">
	<h2 style="margin:0">图床管理</h2>
	<div class="row">
		<input placeholder="搜索文件名" bind:value={filter} style="max-width:200px" />
		<button class="btn" onclick={load} disabled={loading}>↻ 刷新</button>
		<button class="btn primary" onclick={pick} disabled={uploading}>
			{uploading ? '上传中…' : picking ? '从相册中选择' : '＋ 上传图片'}
		</button>
	</div>
</div>

{#if picking}
	<!-- 选图模式提示条：两端（手机 / 电脑）都走这一条路，把「点哪会发生什么」讲清楚 -->
	<div class="card pick-banner" data-ff-block="gallery/pick">
		<div class="row" style="justify-content:space-between; gap:10px">
			<p style="margin:0; line-height:1.7">
				正在为<b>「{pickingLabel}」</b>选图：<br />
				① 点右上角<b>「从相册中选择」</b>上传新图（手机上会打开相册，电脑上打开文件选择器），传完自动填回；<br />
				② 或者直接点下面任意一张图的<b>「用作{pickingLabel}」</b>，图床里的现成图也能用。
			</p>
			<button class="btn small" onclick={abortPick}>取消，返回设置页</button>
		</div>
	</div>
{/if}
<p class="muted" style="margin-top:0">共 {images.length} 张（博客正文里的图片都走图床，插入时自动上传并写入直链）。</p>

{#if loading}
	<p class="muted">正在读取图床…</p>
{:else if !filtered.length}
	<div class="card">
		<p class="muted" style="margin:0">
			没有图片。点右上角{uploading ? '「上传中…」' : picking ? `「上传并用作${pickingLabel}」` : '「上传图片」'}添加。
		</p>
	</div>
{:else}
	<div class="img-grid">
		{#each filtered as img (img.key)}
			<div class="img-cell">
				<img src={img.url} alt={img.key} loading="lazy" />
				<div class="img-meta" title={img.key}>
					<div class="img-name">{img.key.split('/').pop()}</div>
					<div class="muted">{human(img.size)}</div>
				</div>
				<div class="row" style="gap:6px">
					{#if picking}
						<button class="btn small primary" onclick={() => useAs(img.url)}>用作{pickingLabel}</button>
					{/if}
					<button class="btn small" onclick={() => copy(img.url)}>复制直链</button>
					<button class="btn small danger" onclick={() => remove(img)}>删除</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	/* 选图模式提示条：浅强调色底 + 左边框，让人一眼看出自己正处在「挑图回填」流程里 */
	.pick-banner {
		background: var(--accent-soft);
		border-color: var(--accent);
		border-left-width: 4px;
		margin-bottom: 12px;
	}
	.img-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 12px;
	}
	.img-cell {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: rgba(255, 255, 255, var(--panel-alpha));
	}
	.img-cell img {
		width: 100%;
		height: 130px;
		object-fit: cover;
		border-radius: 8px;
		background: #f1f5f5;
	}
	.img-meta {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 12px;
	}
	.img-name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
</style>
