<script lang="ts">
	/**
	 * 资源选择器（Web 版）：本机文件选择 → 传图床 → 返回直链。
	 *
	 * 桌面版是「复制到项目 assets 目录并返回相对路径」，网页版无法落到项目目录，
	 * 统一改成图床上传——这也是后台 media.external_imgbed 声明的通道。
	 */
	import { getContext } from 'svelte'
	import { errMsg } from '../lib/err'

	let {
		target,
		onimported,
		label = '导入本地文件'
	}: {
		target: string
		onimported: (refs: string[]) => void
		label?: string
	} = $props()
	void target // 网页版的「目标目录」概念由图床接管，形参保留以兼容桌面版调用处

	let busy = $state(false)
	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	async function pick(): Promise<void> {
		busy = true
		try {
			const refs = await window.api.assetImport(target)
			if (refs.length) onimported(refs)
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}
</script>

<button class="btn small" onclick={pick} disabled={busy}>{busy ? '上传中…' : `📂 ${label}`}</button>
