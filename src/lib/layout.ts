/**
 * 布局偏好（Web 版简化：只落 localStorage，没有桌面版的布局编辑器）。
 * 保留与桌面版相同的函数签名，组件零改动移植。
 */

const KEY = 'ff.layout'

function readAll(): Record<string, unknown> {
	try {
		return (JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}) as Record<string, unknown>
	} catch {
		return {}
	}
}

export function readLayoutNumber(key: string, fallback: number): number {
	const v = readAll()[key]
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function readLayoutText(key: string, fallback: string): string {
	const v = readAll()[key]
	return typeof v === 'string' && v ? v : fallback
}

export function readLayoutFlag(key: string, fallback: boolean): boolean {
	const v = readAll()[key]
	return typeof v === 'boolean' ? v : fallback
}

export function saveLayoutUi(patch: Record<string, number | string | boolean>): void {
	localStorage.setItem(KEY, JSON.stringify({ ...readAll(), ...patch }))
}

/** 桌面版在这会拉一次远端布局；网页版无需做什么事，但保留入口以免调用处特判 */
export async function loadLayout(): Promise<void> {}
