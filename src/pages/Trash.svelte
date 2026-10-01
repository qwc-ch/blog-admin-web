<script lang="ts">
	import { getContext } from 'svelte'
	import type { TrashEntry } from '../lib/api'
	import { errMsg } from '../lib/err'
	import { confirmDanger, confirmIrreversible } from '../lib/confirm.svelte'

	/**
	 * 回收站页面。
	 *
	 * 管理器里的删除一律是**软删除**：内容文件（连同同名附件目录）、相册目录、相册图片
	 * 都被搬到项目根的 `.fireflux-trash/`，在这里可以一键还原。
	 *
	 * 三个刻意的设计：
	 *
	 * - 回收站放在 `public/` 之外，并且被写进 `.git/info/exclude`，所以它既不会被
	 *   Astro 发布出去（避免已删除的私密图片泄露），也不会被 `git add -A` 推到远端；
	 * - 恢复也要确认：恢复是「把文件搬回原位置」，同样会改动项目，且目标已存在时会整批失败，
	 *   所以先把要搬的路径列清楚再动手；
	 * - 永久删除分两档：单条「永久删除」连续确认两次（一次一条，值得多问一句）；
	 *   批量「清空回收站」只确认一次，但文案里必须写明「不可恢复」——
	 *   条目一多，两次确认只是消耗耐心，挡不住误操作的反而是那句警告。
	 */
	let entries = $state<TrashEntry[]>([])
	let busy = $state(false)
	let loading = $state(true)

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	const KIND_LABEL: Record<string, string> = {
		post: '文章',
		project: '项目',
		dynamic: '动态',
		spec: 'Spec 页面',
		content: '内容',
		album: '相册',
		photo: '相册图片',
		file: '文件',
		unknown: '旧版本记录'
	}

	async function load(): Promise<void> {
		loading = true
		try {
			entries = await window.api.trashList()
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			loading = false
		}
	}
	$effect(() => {
		void load()
	})

	async function restore(entry: TrashEntry): Promise<void> {
		if (busy) return
		if (
			!await confirmDanger(
				`确定恢复「${entry.label}」吗？`,
				`会把下列内容搬回删除前的位置：\n${entry.items.map((i) => `  · ${i.rel}`).join('\n')}`,
				'如果原位置已经有了同名文件，恢复会整批取消（不会覆盖你现在的内容）。'
			)
		)
			return
		busy = true
		try {
			const rels = await window.api.trashRestore(entry.id)
			notify(`已恢复 ${rels.length} 项：${rels.join('、')}`)
			await load()
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	async function purge(entry: TrashEntry): Promise<void> {
		if (busy) return
		if (
			!await confirmIrreversible(
				`永久删除「${entry.label}」？`,
				'不可恢复：这会直接从 .fireflux-trash 里删掉内容，之后无法再还原。',
				`涉及 ${entry.items.length} 项：\n${entry.items.map((i) => `  · ${i.rel}`).join('\n')}`
			)
		)
			return
		busy = true
		try {
			await window.api.trashPurge(entry.id)
			notify('已永久删除该记录')
			await load()
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	async function emptyAll(): Promise<void> {
		if (busy || !entries.length) return
		// 需求：清空回收站**只确认一次**，但必须在这次里把「不可逆」说清楚。
		// （单条「永久删除」仍走 confirmIrreversible 两次确认 —— 清空是批量操作，
		//   条目多的时候两次确认纯属消耗耐心，用户已经知道自己在做什么。）
		if (
			!await confirmDanger(
				`清空回收站？共 ${entries.length} 条记录。`,
				'⚠️ 不可恢复：所有已删除的内容（含相册目录与图片）会被永久删除，之后无法再还原。',
				'如果只是想腾地方，建议先逐条看一眼里面有没有还要用的东西；\n误删之后请先「恢复」，再回原位置删除。'
			)
		)
			return
		busy = true
		try {
			const n = await window.api.trashEmpty()
			notify(`回收站已清空（${n} 条记录）`)
			await load()
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}
</script>

<div class="tr-page">
	<div class="row" style="justify-content:space-between; margin-bottom:10px">
		<h2 style="margin:0">🗑️ 回收站</h2>
		<div class="row">
			<button class="btn" onclick={load} disabled={busy || loading}>↻ 刷新</button>
			<button class="btn danger" onclick={emptyAll} disabled={busy || !entries.length}>清空回收站</button>
		</div>
	</div>
	<p class="muted" style="margin-top:0">
		管理器里的删除都是<b>软删除</b>：内容文件（连同同名附件目录）、相册目录、相册图片会先搬到这里，
		误删后可以一键恢复。回收站位于项目根目录的 <code>.fireflux-trash/</code>，
		不会被网站发布、也不会被推送到远端仓库。
	</p>

	{#if loading}
		<div class="card"><p class="muted">正在读取回收站…</p></div>
	{:else if !entries.length}
		<div class="card"><p class="muted">回收站是空的。</p></div>
	{:else}
		{#each entries as e (e.id)}
			<div class="card tr-item">
				<div class="row" style="justify-content:space-between">
					<div class="row" style="gap:8px">
						<span class="tag">{KIND_LABEL[e.kind] ?? e.kind}</span>
						<b>{e.label}</b>
						{#if e.at}<span class="muted">删除于 {e.at}</span>{/if}
					</div>
					<div class="row">
						{#if e.restorable}
							<button class="btn small primary" onclick={() => restore(e)} disabled={busy}>↩ 恢复</button>
						{/if}
						<button class="btn small danger" onclick={() => purge(e)} disabled={busy}>永久删除</button>
					</div>
				</div>
				{#if e.restorable}
					<div class="tr-paths">
						{#each e.items as it}
							<div class="tr-path">
								<span class="tr-kind">{it.dir ? '目录' : '文件'}</span>
								<code>{it.rel}</code>
							</div>
						{/each}
						{#if !e.items.length}
							<p class="hint" style="margin:4px 0 0">
								这条记录只备份了信息（删除时磁盘上已经没有对应文件），没有可直接恢复的内容；
								备份文件在 <code>.fireflux-trash/{e.id}/</code> 里，可人工取回。
							</p>
						{/if}
					</div>
				{:else}
					<p class="hint" style="margin:6px 0 0">
						旧版本删除的记录缺少恢复信息，无法一键还原；内容仍在
						<code>.fireflux-trash/{e.id}/</code> 里，可手动拷回项目。
					</p>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.tr-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
	}
	.tr-item {
		margin-bottom: 10px;
	}
	.tr-paths {
		margin-top: 8px;
		border-top: 1px dashed var(--line);
		padding-top: 8px;
	}
	.tr-path {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
		font-size: 12.5px;
	}
	.tr-path code {
		font-family: var(--mono);
		color: var(--text);
		word-break: break-all;
	}
	.tr-kind {
		flex-shrink: 0;
		font-size: 11.5px;
		color: var(--muted);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0 6px;
	}
</style>
