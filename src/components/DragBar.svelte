<script lang="ts">
	import { onDestroy } from 'svelte'

	interface Props {
		width: number
		min?: number
		max?: number
		side?: 'left' | 'right'
		gapLeft?: number
		onresize: (w: number) => void
		onfinish?: (w: number) => void
	}
	let { width, min = 0, max = Infinity, side = 'right', gapLeft = 0, onresize, onfinish }: Props = $props()
	let bar: HTMLDivElement
	let dragging = $state(false)
	let stopDrag: (() => void) | undefined

	// 从当前实际宽度起拖：窗口缩放/flex 压缩后，持久化的 width 不一定等于可见宽度。
	// 不再使用固定像素上限；仅保留容器边界，防止把相邻面板和手柄拖出窗口。
	function geometry(): { start: number; lower: number; upper: number } {
		const target = (side === 'right' ? bar.previousElementSibling : bar.nextElementSibling) as HTMLElement | null
		const peer = (side === 'right' ? bar.nextElementSibling : bar.previousElementSibling) as HTMLElement | null
		const floor = (el: HTMLElement | null): number => {
			if (!el) return 0
			const css = getComputedStyle(el)
			const px = (s: string): number => Number.parseFloat(s) || 0
			return Math.max(px(css.minWidth), px(css.paddingLeft) + px(css.paddingRight) + px(css.borderLeftWidth) + px(css.borderRightWidth))
		}
		const start = target?.getBoundingClientRect().width ?? width
		const lower = Math.max(min, floor(target))
		const upper = Math.max(lower, Math.min(max, start + (peer?.getBoundingClientRect().width ?? 0) - floor(peer)))
		return { start, lower, upper }
	}

	function down(e: MouseEvent): void {
		if (e.button !== 0) return
		e.preventDefault()
		stopDrag?.()
		const { start, lower, upper } = geometry()
		const startX = e.clientX
		const dir = side === 'right' ? 1 : -1
		let lastW = start
		let raf: number | undefined
		let ended = false
		const oldCursor = document.body.style.cursor
		dragging = true
		document.body.style.cursor = 'col-resize'
		document.body.classList.add('ff-dragging')
		document.body.dispatchEvent(new CustomEvent('ff-dragstart'))

		const move = (ev: MouseEvent): void => {
			if (!(ev.buttons & 1)) { finish(); return }
			lastW = Math.min(upper, Math.max(lower, start + (ev.clientX - startX) * dir))
			if (raf !== undefined) return
			raf = requestAnimationFrame(() => {
				raf = undefined
				onresize(lastW)
			})
		}
		const finish = (): void => {
			if (ended) return
			ended = true
			if (raf !== undefined) cancelAnimationFrame(raf)
			onresize(lastW)
			onfinish?.(lastW)
			dragging = false
			document.body.style.cursor = oldCursor
			document.body.classList.remove('ff-dragging')
			document.body.dispatchEvent(new CustomEvent('ff-dragend'))
			window.removeEventListener('mousemove', move)
			window.removeEventListener('mouseup', finish)
			window.removeEventListener('blur', finish)
			stopDrag = undefined
		}
		stopDrag = finish
		window.addEventListener('mousemove', move)
		window.addEventListener('mouseup', finish)
		window.addEventListener('blur', finish)
	}
	function keydown(e: KeyboardEvent): void {
		if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
		e.preventDefault()
		const { start, lower, upper } = geometry()
		const delta = (e.key === 'ArrowRight' ? 1 : -1) * (side === 'right' ? 1 : -1) * (e.shiftKey ? 40 : 10)
		const next = Math.min(upper, Math.max(lower, start + delta))
		onresize(next)
		onfinish?.(next)
	}
	onDestroy(() => stopDrag?.())
</script>

<!-- 分隔条用的是 WAI-ARIA 的 window splitter 模式：role=separator + tabindex + aria-valuenow，
     可以聚焦后用左右方向键调整，所以这里的 tabindex 是有意为之 -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={bar}
	class="dragbar"
	class:dragging
	role="separator"
	aria-label="调整面板宽度"
	aria-orientation="vertical"
	aria-valuenow={Math.round(width)}
	tabindex="0"
	title="拖动调整宽度，也可使用左右方向键"
	style="margin-left: {2 + gapLeft}px"
	data-ff-nodrag
	onmousedown={down}
	onkeydown={keydown}
></div>

<style>
	.dragbar {
		width: 9px;
		margin: 0 2px;
		border-radius: 5px;
		cursor: col-resize;
		flex-shrink: 0;
		position: relative;
		z-index: 5;
		touch-action: none;
	}
	.dragbar::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 4px;
		height: 40px;
		border-radius: 3px;
		background: #bfd9d2;
		transition: background 0.15s, height 0.15s;
	}
	.dragbar:hover::after,
	.dragbar:focus-visible::after,
	.dragbar.dragging::after {
		background: var(--accent);
		height: 64px;
		box-shadow: 0 0 8px rgba(20, 184, 166, 0.45);
	}
</style>
