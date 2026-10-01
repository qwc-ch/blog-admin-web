/**
 * ANSI 终端转义序列 → 彩色 HTML（自研解析，覆盖 SGR 全部常用码）：
 * 16 基本色、90-97/100-107 亮色、38;5;N（256 色）、38;2;R;G;B（24 位 RGB）、
 * 粗体/暗淡/斜体/下划线/反转。
 */
import { escapeHtml } from './preview'

/** 深色终端配色（对齐 Firefly 主题 .frame.is-terminal 的暗色终端观感） */
const BASIC_FG = ['#D4D4D4', '#F44747', '#608B4E', '#DCDAAA', '#569CD6', '#C586C0', '#9CDCFE', '#808080']
const BRIGHT_FG = ['#9E9E9E', '#FF6B6B', '#B5CEA8', '#D7BA7D', '#79C0FF', '#D670D6', '#7EE7F7', '#F5F5F5']
const BASIC_BG = ['#1E1E1E', '#6B2E2E', '#2E4B32', '#5C5022', '#2C4A6B', '#4E2C4E', '#2C5C6B', '#404040']
const BRIGHT_BG = ['#2D4F66', '#7E2D33', '#3F6B47', '#6E5C2C', '#3D5A7E', '#5E3D5E', '#3D6B7E', '#5A5A5A']

function xterm256(n: number): string {
	if (n < 16) return n < 8 ? BASIC_FG[n] : BRIGHT_FG[n - 8]
	if (n < 232) {
		const v = (x: number): number => (x === 0 ? 0 : 55 + x * 40)
		const r = v(Math.floor(n / 36))
		const g = v(Math.floor(n / 6) % 6)
		const b = v(n % 6)
		return `rgb(${r},${g},${b})`
	}
	const gray = 8 + (n - 232) * 10
	return `rgb(${gray},${gray},${gray})`
}

interface SgrState {
	fg: string | null
	bg: string | null
	bold: boolean
	dim: boolean
	italic: boolean
	underline: boolean
	reversed: boolean
}

function applySgr(codes: number[], st: SgrState): void {
	let i = 0
	while (i < codes.length) {
		const c = codes[i] ?? 0
		if (c === 0) {
			st.fg = null
			st.bg = null
			st.bold = st.dim = st.italic = st.underline = st.reversed = false
		} else if (c === 1) st.bold = true
		else if (c === 2) st.dim = true
		else if (c === 3) st.italic = true
		else if (c === 4) st.underline = true
		else if (c === 7) st.reversed = true
		else if (c === 22) st.bold = st.dim = false
		else if (c === 23) st.italic = false
		else if (c === 24) st.underline = false
		else if (c === 27) st.reversed = false
		else if (c === 39) st.fg = null
		else if (c === 49) st.bg = null
		else if (c === 38 || c === 48) {
			const isBg = c === 48
			if (codes[i + 1] === 5) {
				const col = xterm256(codes[i + 2] ?? 0)
				if (isBg) st.bg = col
				else st.fg = col
				i += 2
			} else if (codes[i + 1] === 2) {
				const col = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
				if (isBg) st.bg = col
				else st.fg = col
				i += 4
			}
		} else if (c >= 30 && c <= 37) st.fg = BASIC_FG[c - 30]
		else if (c >= 90 && c <= 97) st.fg = BRIGHT_FG[c - 90]
		else if (c >= 40 && c <= 47) st.bg = BASIC_BG[c - 40]
		else if (c >= 100 && c <= 107) st.bg = BRIGHT_BG[c - 100]
		i++
	}
}

/** ANSI 文本 → 带内联样式的 HTML */
export function ansiToHtml(text: string): string {
	let out = ''
	const st: SgrState = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, reversed: false }
	const parts = text.split(/(\x1b\[[0-9;]*[A-Za-z])/)
	for (const part of parts) {
		if (!part) continue
		const m = /^\x1b\[([0-9;]*)m$/.exec(part)
		if (m) {
			applySgr((m[1] || '0').split(';').map((x) => Number(x) || 0), st)
			continue
		}
		// 非 SGR 转义序列（光标移动等）直接丢弃
		if (part.startsWith('\x1b')) continue
		let f = st.fg
		let b = st.bg
		if (st.reversed) {
			const t = f
			f = b
			b = t
		}
		const css: string[] = []
		if (f) css.push(`color:${f}`)
		if (b) css.push(`background-color:${b}`)
		if (st.bold) css.push('font-weight:700')
		if (st.dim) css.push('opacity:0.6')
		if (st.italic) css.push('font-style:italic')
		if (st.underline) css.push('text-decoration:underline')
		const style = css.length ? ` style="${css.join(';')}"` : ''
		out += `<span${style}>${escapeHtml(part)}</span>`
	}
	return out
}
