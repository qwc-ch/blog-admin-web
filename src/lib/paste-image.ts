/**
 * 编辑框「粘贴图片」的公共实现。
 *
 * 用户从截图工具、网页、微信里复制一张图，直接在编辑框里按 Ctrl+V，这是最自然的
 * 插图片方式。浏览器确实把图片放进了 `ClipboardEvent.clipboardData`，但编辑器只是个
 * `<textarea>`，它只会把文本粘进去；纯图片的剪贴板里没有文本，于是按下去毫无反应。
 *
 * 所以这里接管 `paste` 事件：从剪贴板取出图片 Blob，交给后端写进附件目录，再把返回的
 * Markdown 引用插到光标处。插光标处而不是文末，因为用户往往是写到一半想起来配图。
 *
 * 插入位置要在粘贴那一刻就记下来。写附件目录是异步的（要唤醒后端、复制文件），
 * 等它回来时用户可能已经又敲了几个字，甚至把光标挪到别处。所以先存下
 * `selectionStart/End`，图片写完回来后用当时记下的位置插入，并修正光标（`+插入长度`）。
 *
 * 有些软件（Word、部分网页）复制图片时会同时带上文字或 HTML。为了让两样都不丢，
 * 走「有文件就处理文件 + 把文本一起粘回来」的路径，而不是二选一。
 */

/** 从剪贴板里挑出图片文件（一个事件里可能同时有文字和图片） */
function imageFilesFrom(items: DataTransferItemList | null): File[] {
	if (!items) return []
	const out: File[] = []
	for (const it of items) {
		if (it.kind === 'file' && it.type.startsWith('image/')) {
			const f = it.getAsFile()
			if (f) out.push(f)
		}
	}
	return out
}

/** 图片 MIME → 扩展名（后端按扩展名判格式，写错了会被拒） */
export function extForMime(mime: string): string {
	const map: Record<string, string> = {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/webp': 'webp',
		'image/avif': 'avif',
		'image/gif': 'gif',
		'image/bmp': 'bmp',
		'image/svg+xml': 'svg',
		'image/x-icon': 'ico',
		'image/vnd.microsoft.icon': 'ico'
	}
	return map[mime.toLowerCase()] ?? 'png'
}

/** 本地时间戳，用作剪贴板图片的文件名（`pasted-20260926-015700`） */
export function pastedStamp(d = new Date()): string {
	const p = (n: number): string => String(n).padStart(2, '0')
	return `pasted-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** `File` → 纯 base64（去掉 data URL 前缀，后端只收数据部分） */
export async function fileToBase64(file: File): Promise<string> {
	const buf = await file.arrayBuffer()
	let bin = ''
	const bytes = new Uint8Array(buf)
	// 分块转字符串：一次性 apply 几十万参数会爆栈
	const CHUNK = 0x8000
	for (let i = 0; i < bytes.length; i += CHUNK) {
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
	}
	return btoa(bin)
}

/** 剪贴板里所有图片（去重后）—— 同一个事件里 `items` 与 `files` 可能重复同一张图 */
export function allImageFiles(dt: DataTransfer | null): File[] {
	if (!dt) return []
	const seen = new Set<string>()
	const out: File[] = []
	for (const f of [...imageFilesFrom(dt.items), ...Array.from(dt.files).filter((f) => f.type.startsWith('image/'))]) {
		const key = `${f.name}|${f.size}|${f.type}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push(f)
	}
	return out
}
