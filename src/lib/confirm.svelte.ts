/**
 * 危险操作的统一确认（自绘弹窗版）。
 *
 * 为什么不能用 `window.confirm`：这个模块以前直接调它，理由是「原生模态、键盘可达」。
 * 那个前提是错的。`tauri-plugin-dialog` 会给每个 webview 注入一段初始化脚本，
 * 把 `window.confirm` 换成
 *
 * ```js
 * window.confirm = async (i) => await invoke("plugin:dialog|confirm", { message: i.toString() })
 * ```
 *
 * 返回值变成了 Promise。于是 `if (!window.confirm(...)) return` 这道守卫对 Promise
 * 取反恒为 false，永远放行：高危按钮点下去不弹窗、直接执行。
 *
 * 更糟的是那条命令根本不存在。插件 Rust 侧只注册了 `open` / `save` / `message`，
 * 权限集 `dialog:default` 也只含 `allow-message` / `allow-save` / `allow-open`
 * （`allow-confirm` 是 `allow-message` 的废弃别名）。所以那个 Promise 既不会
 * resolve 成 true 也不会 resolve 成 false。这个坑的完整记录见
 * docs/开发笔记.md「确认框：必须用 lib/confirm.svelte.ts，且必须 await」一节。
 *
 * 因此本模块的接口是异步的：`confirmDanger` / `confirmIrreversible` 返回
 * `Promise<boolean>`，调用方必须 await。不 await 拿到的是 Promise，`if (!p)` 仍然
 * 恒真，也就是说漏掉一个 await，那个按钮的确认就又变回静默放行。新增高危操作时
 * 请照抄现有写法。
 *
 * 原生模态自带的那套键盘行为要自己补：Esc 取消、Enter 确认、打开时焦点落在取消上
 * （危险操作不该让一个回车就直接确认）、Tab 在弹窗内循环。这些都实现在
 * `components/ConfirmDialog.svelte` 里。
 */

interface ConfirmRequest {
	/** 一句话说清「要做什么」 */
	title: string
	/** 删的是什么 / 影响范围 */
	detail?: string
	/** 能不能恢复、恢复在哪、什么时候生效 */
	extra?: string
	/** 不可恢复：要点两次「确定」 */
	double: boolean
	resolve: (ok: boolean) => void
}

/** 当前正在展示的确认请求（`null` = 没有）。弹窗组件读它来渲染。 */
export const confirmState = $state<{ current: ConfirmRequest | null }>({ current: null })

/** 排队：万一两处同时要求确认，不能把前一个的 Promise 丢掉（那会永远挂住） */
const queue: ConfirmRequest[] = []

function ask(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const full: ConfirmRequest = { ...req, resolve }
		if (confirmState.current) {
			queue.push(full)
			return
		}
		confirmState.current = full
	})
}

/** 单次确认：用户点「确定」才返回 true */
export function confirmDanger(title: string, detail?: string, extra?: string): Promise<boolean> {
	return ask({ title, detail, extra, double: false })
}

/**
 * 不可恢复操作的确认：连续问两遍。
 *
 * 第二遍刻意换一句更直白的话（「再确认一次」），而不是把同一段文案弹两次 ——
 * 用户连点两次「确定」时应该能意识到自己在做什么。
 */
export function confirmIrreversible(title: string, detail?: string, extra?: string): Promise<boolean> {
	return ask({ title, detail, extra, double: true })
}

/** 弹窗组件专用：结束当前确认，并把队列里的下一个顶上来 */
export function settleConfirm(ok: boolean): void {
	const cur = confirmState.current
	confirmState.current = null
	cur?.resolve(ok)
	const next = queue.shift()
	if (next) confirmState.current = next
}
