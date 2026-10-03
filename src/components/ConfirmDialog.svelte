<script lang="ts">
	/**
	 * 危险操作的确认弹窗（自绘）。
	 *
	 * 为什么不用 `window.confirm`：见 `lib/confirm.svelte.ts` 的文件头 ——
	 * 那个函数被 `tauri-plugin-dialog` 换成了返回 Promise 的异步版本，
	 * 同步守卫对它取反恒为 false，等于没有确认。
	 *
	 * 挂载一次即可（`App.svelte` 顶部），由 `confirmState` 驱动显隐。
	 */
	import { confirmState, settleConfirm } from '../lib/confirm.svelte'

	/** 「不可恢复」的第二次确认：每次换请求都要退回第一步 */
	let step = $state(1)
	/** 取消按钮（第一步）/ 确定按钮（第二步）—— 打开时焦点落在这里 */
	let primaryBtn = $state<HTMLButtonElement | null>(null)
	let boxEl = $state<HTMLElement | null>(null)

	const req = $derived(confirmState.current)

	// 换请求就把步骤复位，并把焦点放到**取消**上：
	// 危险操作不该让一个误按的回车就执行。
	$effect(() => {
		if (req) {
			step = 1
			requestAnimationFrame(() => primaryBtn?.focus())
		}
	})

	function confirmNow(): void {
		if (!req) return
		// 不可恢复的操作要点两次：第一次只是把后果再说一遍
		if (req.double && step === 1) {
			step = 2
			requestAnimationFrame(() => primaryBtn?.focus())
			return
		}
		settleConfirm(true)
	}

	function onKeydown(e: KeyboardEvent): void {
		if (!req) return
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			settleConfirm(false)
			return
		}
		if (e.key === 'Enter') {
			e.preventDefault()
			e.stopPropagation()
			confirmNow()
			return
		}
		if (e.key === 'Tab') {
			// 焦点循环限制在弹窗内：不然 Tab 会跑到被遮住的页面上
			const focusables = boxEl?.querySelectorAll<HTMLElement>('button')
			if (!focusables || focusables.length === 0) return
			const list = [...focusables]
			const i = list.indexOf(document.activeElement as HTMLElement)
			e.preventDefault()
			const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1
			list[next]?.focus()
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if req}
	<!-- 遮罩点击 = 取消。用 div + role 而不是 <button>：按钮会把整块遮罩算成可点控件，
	     读屏会念成「取消按钮」两遍（弹窗里本来就有取消） -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="cf-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby="cf-title"
		tabindex="-1"
		onclick={() => settleConfirm(false)}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="cf-box" bind:this={boxEl} onclick={(e) => e.stopPropagation()}>
			<h3 id="cf-title" class="cf-title">{req.title}</h3>
			{#if req.detail}
				<p class="cf-line">{req.detail}</p>
			{/if}
			{#if req.extra}
				<p class="cf-line cf-extra">{req.extra}</p>
			{/if}
			{#if req.double}
				{#if step === 1}
					<p class="cf-step">这是不可恢复的操作，下一步会让你再确认一次。</p>
				{:else}
					<p class="cf-step cf-step-2">再确认一次：{req.title}<br />此操作不可恢复，确认继续？</p>
				{/if}
			{/if}
			<div class="cf-actions">
				<button class="btn" bind:this={primaryBtn} onclick={() => settleConfirm(false)}>取消</button>
				<button class="btn danger" onclick={confirmNow}>
					{req.double && step === 1 ? '继续' : '确定'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.cf-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: rgba(12, 28, 26, 0.55);
	}
	.cf-box {
		position: relative;
		width: min(520px, 100%);
		max-height: 80vh;
		overflow: auto;
		background: #fff;
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 18px 20px;
		box-shadow: 0 18px 48px rgba(12, 28, 26, 0.32);
		user-select: text;
	}
	.cf-title {
		margin: 0 0 8px;
		font-size: 16px;
		line-height: 1.5;
		color: var(--text);
	}
	.cf-line {
		margin: 0 0 8px;
		font-size: 13px;
		line-height: 1.65;
		color: var(--text);
	}
	.cf-extra {
		color: var(--muted);
	}
	.cf-step {
		margin: 10px 0 0;
		padding: 8px 10px;
		border-radius: 8px;
		font-size: 13px;
		line-height: 1.6;
		background: var(--warn-bg);
		color: #8a6d3b;
	}
	.cf-step-2 {
		font-weight: 600;
		color: var(--danger);
		background: #fdecea;
	}
	.cf-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 14px;
	}
</style>
