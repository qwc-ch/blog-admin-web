<script lang="ts">
	/**
	 * 图床管理（Web 版简化）：列出图床里的图片、上传、复制直链、删除。
	 * 桌面版是本地相册（相册目录 + 排序 + 封面），网页版没有项目磁盘，
	 * 统一走 .fireflux.yml 里 media.external_imgbed 声明的图床。
	 */
	import { getContext } from 'svelte'
	import { errMsg } from '../lib/err'
	import { confirmIrreversible } from '../lib/confirm.svelte'

	interface Img { key: string; size: number; url: string }

	let images = $state<Img[]>([])
	let loading = $state(true)
	let uploading = $state(false)
	let filter = $state('')
	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

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
		input.multiple = true
		input.onchange = async () => {
			const files = [...(input.files ?? [])]
			if (!files.length) return
			uploading = true
			try {
				for (const f of files) await window.api.uploadImage(f)
				notify(`已上传 ${files.length} 张图片`)
				await load()
			} catch (e) {
				notify(errMsg(e), false)
			} finally {
				uploading = false
			}
		}
		input.click()
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
	<h2 style="margin:0">🖼️ 图床管理</h2>
	<div class="row">
		<input placeholder="搜索文件名" bind:value={filter} style="max-width:200px" />
		<button class="btn" onclick={load} disabled={loading}>↻ 刷新</button>
		<button class="btn primary" onclick={pick} disabled={uploading}>{uploading ? '上传中…' : '＋ 上传图片'}</button>
	</div>
</div>
<p class="muted" style="margin-top:0">共 {images.length} 张（博客正文里的图片都走图床，插入时自动上传并写入直链）。</p>

{#if loading}
	<p class="muted">正在读取图床…</p>
{:else if !filtered.length}
	<div class="card"><p class="muted" style="margin:0">没有图片。点右上角「上传图片」添加。</p></div>
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
					<button class="btn small" onclick={() => copy(img.url)}>复制直链</button>
					<button class="btn small danger" onclick={() => remove(img)}>删除</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
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
