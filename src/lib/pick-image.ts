/**
 * 「去图床挑一张图，回填到某个输入框」的一次性约定。
 *
 * 为什么不直接用 <input type="file">：手机上点它会跳出**系统相册**（另一个应用），
 * 用户选完还得再自己来后台的图床页把图传一遍。于是改成后台内部的流程 ——
 * 设置页点「去图床选图」→ 跳到「图床管理」→ 在那儿上传或直接点现成的图
 * → 拿到的直链自动填回原来那个输入框。
 *
 * 为什么用模块级单例而不是 context：设置页与图床页是 App 里两个互斥的 `{#if}` 分支，
 * 切页时设置页会被**销毁**，context 里的回调随之消失。模块级状态不随组件卸载而丢。
 */

/** 回填目标：设置页的哪个输入框 */
export type PickSlot = 'wallpaper-desktop' | 'wallpaper-mobile'

export const PICK_LABELS: Record<PickSlot, string> = {
	'wallpaper-desktop': '电脑壁纸',
	'wallpaper-mobile': '手机壁纸'
}

const PICK_KEY = 'ff.picked'
/** 待消费的记录最多留 5 分钟：再久就当是上一次遗留的残留，别填错地方 */
const PICK_TTL = 300_000

let slot: PickSlot | null = null

/** 图床页当前是不是处于「选图回填」模式（决定是否显示提示条与「用作壁纸」按钮） */
export function pickSlot(): PickSlot | null {
	return slot
}

/** 设置页点按钮：记下要填哪里，随后由它自己跳到图床页 */
export function startPick(target: PickSlot): void {
	slot = target
}

/** 用户在图床页放弃选择（返回 / 取消）：清掉待填目标，别把下一张图误填进来 */
export function cancelPick(): void {
	slot = null
}

/**
 * 图床页交回一张图：返回 true 表示这次点击确实完成了一次回填。
 * 目标 slot 随结果一起送出 —— 派发完就清空，**先**清空会让消费方读不到该填哪里。
 */
export function deliverPick(url: string): boolean {
	if (!slot || !url) return false
	const target = slot
	slot = null
	try {
		localStorage.setItem(PICK_KEY, JSON.stringify({ url, target, at: Date.now() }))
	} catch {
		/* 存不下就只靠下面的事件（设置页还挂着时有效） */
	}
	window.dispatchEvent(new CustomEvent('ff:picked', { detail: { url, target } }))
	return true
}

/**
 * 读一条待消费的回填结果并清掉记录。
 *
 * 走 localStorage 而不只是事件：设置页可能**在图床页交回之后才重新挂载**
 * （切页会销毁它），那时事件早已发过去，没人接。
 */
export function takePicked(): { url: string; target: PickSlot } | null {
	try {
		const raw = localStorage.getItem(PICK_KEY)
		if (!raw) return null
		const d = JSON.parse(raw) as { url?: string; target?: PickSlot; at?: number }
		localStorage.removeItem(PICK_KEY)
		if (!d.url || !d.target) return null
		if (typeof d.at === 'number' && Date.now() - d.at > PICK_TTL) return null
		return { url: d.url, target: d.target }
	} catch {
		return null
	}
}

/** 监听图床页的即时回填（设置页当前还挂着的场景，不用等重新挂载） */
export function onPicked(fn: (url: string, target: PickSlot) => void): () => void {
	const h = (e: Event): void => {
		const d = (e as CustomEvent<{ url?: string; target?: PickSlot }>).detail
		if (!d?.url || !d.target) return
		try {
			localStorage.removeItem(PICK_KEY)
		} catch {
			/* 忽略 */
		}
		fn(d.url, d.target)
	}
	window.addEventListener('ff:picked', h)
	return () => window.removeEventListener('ff:picked', h)
}