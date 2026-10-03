<script lang="ts">
	/**
	 * DEV-BYPASS: 调试用密码登录组件（正式上线前删除整个文件，
	 * 以及 App.svelte / Settings.svelte 里的 <DevLogin /> 引用和 api.ts 的 devLogin）。
	 *
	 * 后端 /api/auth/dev-login 只有在设置了 DEV_LOGIN_PASSWORD 时才存在；
	 * 线上没配这个 secret 时，点登录会提示 404 / Not Found，属预期。
	 */
	import { devLogin } from '../lib/api'
	import { errMsg } from '../lib/err'

	let { onSuccess, compact = false }: { onSuccess?: () => void; compact?: boolean } = $props()

	let password = $state('')
	let busy = $state(false)
	let error = $state('')

	async function submit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		if (!password || busy) return
		busy = true
		error = ''
		try {
			await devLogin(password)
			password = ''
			onSuccess?.()
		} catch (err) {
			error = errMsg(err)
		} finally {
			busy = false
		}
	}
</script>

<div class="dev-login" class:compact>
	<span class="dev-tag" title="仅调试环境可用，上线前删除">调试登录</span>
	<form class="row" onsubmit={submit}>
		<input
			type="password"
			bind:value={password}
			placeholder="调试密码"
			autocomplete="off"
			aria-label="调试密码"
		/>
		<button class="btn small" type="submit" disabled={!password || busy}>
			{busy ? '登录中…' : '密码登录'}
		</button>
	</form>
	{#if error}<span class="dev-err">{error}</span>{/if}
</div>

<style>
	.dev-login {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px dashed var(--line);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.dev-login.compact {
		margin-top: 8px;
	}
	.dev-tag {
		font-size: 12px;
		font-weight: 600;
		color: var(--amber);
	}
	.dev-login input {
		min-width: 130px;
	}
	.dev-err {
		color: var(--danger);
		font-size: 12.5px;
	}
</style>
