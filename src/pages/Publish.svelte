<script lang="ts">
	/**
	 * 发布上线（Web 版）：后台的每次保存都是一个 git 提交（Worker 直接调 GitHub API 推送），
	 * 所以这里没有桌面版的暂存 / 提交 / 推送 / 分支 / 冲突处理 —— 只展示
	 * 「仓库 / 分支 / 博客地址 / 最近提交」，让人确认改动确实推上去了。
	 */
	import { errMsg } from '../lib/err'

	interface Commit { sha: string; message: string; date: string; author: string }
	interface PublishInfo {
		owner: string
		repo: string
		branch: string
		blogUrl: string | null
		commits: Commit[]
		/** 后端带上来的失败原因（读取失败时非空） */
		error?: string
	}
	let info = $state<PublishInfo | null>(null)
	let loading = $state(true)
	/** 读取失败的原因：空串 = 没失败。单独存一份，不靠 info 是否为 null 去猜 ——
	 *  以前失败时 info 留 null，页面就显示「0 条 / 还没有提交记录」，
	 *  把「读取失败」说成了「没有提交」，把人往错误方向带。 */
	let error = $state('')

	async function load(): Promise<void> {
		loading = true
		error = ''
		try {
			const r = await window.api.publishInfo()
			info = r
			// 后端可能在返回 200 的同时用 error 字段说明失败（部分信息仍可用）
			error = r.error ?? ''
		} catch (e) {
			info = null
			error = errMsg(e)
		} finally {
			loading = false
		}
	}
	$effect(() => {
		void load()
	})

	function when(iso: string): string {
		if (!iso) return ''
		const d = new Date(iso)
		const diff = (Date.now() - d.getTime()) / 1000
		if (diff < 60) return '刚刚'
		if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
		if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
		if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
		return d.toLocaleDateString('zh-CN')
	}
</script>

<div class="row" style="justify-content:space-between; margin-bottom:10px">
	<h2 style="margin:0">🚀 发布上线</h2>
	<button class="btn" onclick={load} disabled={loading}>↻ 刷新</button>
</div>

<div class="card" style="margin-bottom:14px">
	<h3>保存即发布</h3>
	<p class="muted" style="line-height:1.8; margin:0">
		这个后台的每次「保存」都会直接提交并推送到
		<code>{info?.owner || '（未读取到）'}/{info?.repo || '—'}</code> 的
		<code>{info?.branch || '—'}</code> 分支，云端（Cloudflare Pages / GitHub Actions）随后自动构建。
		所以这里不需要再点推送：<b>改完保存，等一两分钟博客就会更新</b>。
	</p>
	<div class="row" style="margin-top:12px">
		{#if info?.blogUrl}
			<button class="btn primary" onclick={() => window.open(info!.blogUrl!, '_blank', 'noopener')}>↗ 打开博客</button>
		{/if}
		{#if info?.owner && info?.repo && info?.branch}
			<button class="btn" onclick={() => window.open(`https://github.com/${info!.owner}/${info!.repo}/commits/${info!.branch}`, '_blank', 'noopener')}>
				↗ 在 GitHub 看提交
			</button>
		{/if}
	</div>
</div>

<div class="card">
	<div class="row" style="justify-content:space-between; margin-bottom:8px">
		<h3 style="margin:0">最近提交</h3>
		{#if !loading && !error}
			<span class="muted">{info?.commits.length ?? 0} 条</span>
		{/if}
	</div>
	{#if loading}
		<p class="muted" style="margin:0">正在读取提交记录…</p>
	{:else if error}
		<!-- 读取失败 ≠ 没有提交：这两件事必须分开说，否则会让人以为博客还没提交过 -->
		<div class="pub-err">
			<b>⚠️ 读取提交记录失败</b>
			<p class="muted" style="margin:6px 0 0; line-height:1.7; word-break:break-all">{error}</p>
			<p class="hint" style="margin:8px 0 0">
				常见原因：Worker 的 <code>GITHUB_TOKEN</code> secret 没配或已失效；
				或者仓库是私有的而该 token 没有它的读权限。
				博客内容能正常读写的话，token 大概率是好的，重点查这页接口返回的原文错误。
			</p>
			<button class="btn small" style="margin-top:10px" onclick={load} disabled={loading}>↻ 重试</button>
		</div>
	{:else if !info?.commits.length}
		<p class="muted" style="margin:0">
			{info?.repo
				? `${info.owner}/${info.repo} 的 ${info.branch} 分支上还没有提交记录。`
				: '还没有提交记录。'}
		</p>
	{:else}
		{#each info.commits as c (c.sha)}
			<div class="pub-row">
				<code class="pub-sha">{c.sha}</code>
				<span class="pub-msg" title={c.message}>{c.message}</span>
				<span class="muted pub-when">{when(c.date)}</span>
			</div>
		{/each}
	{/if}
</div>

<style>
	.pub-err {
		background: var(--warn-bg);
		border: 1px solid #f0dcb4;
		border-radius: 10px;
		padding: 11px 12px;
	}
	.pub-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 0;
		border-bottom: 1px dashed var(--line);
		font-size: 13px;
	}
	.pub-row:last-child {
		border-bottom: none;
	}
	.pub-sha {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--accent);
	}
	.pub-msg {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.pub-when {
		flex-shrink: 0;
	}
</style>
