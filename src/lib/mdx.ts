/**
 * MDX 预览的**安全静态解释器**（零依赖，自带小型解析器）。
 *
 * 为什么不用 `new Function` / 不引入 TypeScript 编译器：
 *   - MDX 来自用户项目，`export` / `{...}` 里可能引用任意模块、执行任意代码。
 *     管理器只应「看」文档，不应「跑」文档。这里把 MDX 当数据来读；
 *   - 引入 typescript 当 AST parser 会让产物多出近 10MB（gzip 1.6MB），
 *     且压缩阶段会把构建拖到 9 分钟以上。所以这里自带一个**只认确定语法**的
 *     小型解析器：字面量、标识符引用、模板字符串、数组/对象字面量、成员访问、
 *     数组 `.map(箭头函数)`、`.join`、少量纯字符串方法、简单三元/逻辑、JSX。
 *
 * 安全边界：
 *   - 只解释上述确定语法，其余一律不执行，并**显式提示**（不静默吞内容）；
 *   - 危险标签（script/style/iframe…）与所有事件处理器（onClick / onclick）一律不落地；
 *     复制按钮的 onclick 会被识别成 `data-copy`，由组件自己绑定安全的复制逻辑；
 *   - `import` 语句只移除，绝不加载/执行任何被导入模块；
 *   - 围栏代码块 / 行内代码原样保留，示例代码不会被当成 MDX 执行。
 */

/** 无法安全求值时的哨兵值 */
const UNKNOWN = Symbol('mdx-unknown')

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function escapeAttr(s: string): string {
	return escapeHtml(s).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
}

// ---------------------------------------------------------------------------
// 文本扫描工具（跳过代码围栏 / 行内代码 / 字符串 / 注释）
// ---------------------------------------------------------------------------

/** 受保护的代码区间（围栏代码块 + 行内代码） */
function codeRanges(s: string): [number, number][] {
	const ranges: [number, number][] = []
	let i = 0
	while (i < s.length) {
		const lineStart = i === 0 || s[i - 1] === '\n'
		if (lineStart && (s.startsWith('```', i) || s.startsWith('~~~', i))) {
			const marker = s.startsWith('```', i) ? '```' : '~~~'
			const closeIdx = s.indexOf(`\n${marker}`, i + 3)
			if (closeIdx !== -1) {
				const closeEnd = s.indexOf('\n', closeIdx + 1)
				const stop = closeEnd === -1 ? s.length : closeEnd + 1
				ranges.push([i, stop])
				i = stop
				continue
			}
		}
		if (s[i] === '`') {
			let j = i + 1
			while (j < s.length && s[j] !== '`' && s[j] !== '\n') j++
			if (j < s.length && s[j] === '`') {
				ranges.push([i, j + 1])
				i = j + 1
				continue
			}
		}
		i++
	}
	return ranges
}

function inRanges(ranges: [number, number][], i: number): [number, number] | undefined {
	for (const r of ranges) if (i >= r[0] && i < r[1]) return r
	return undefined
}

/** 找到与 start 处 { 配对的 }（跳过保护区间），找不到返回 -1 */
function findBracedSkipping(s: string, start: number, ranges: [number, number][]): number {
	let depth = 0
	let i = start
	while (i < s.length) {
		const r = inRanges(ranges, i)
		if (r) {
			i = r[1]
			continue
		}
		if (s[i] === '{') depth++
		else if (s[i] === '}') {
			depth--
			if (depth === 0) return i
		}
		i++
	}
	return -1
}

function scanQuoted(s: string, i: number): number {
	const q = s[i]
	i++
	while (i < s.length) {
		if (s[i] === '\\') {
			i += 2
			continue
		}
		if (s[i] === q) return i + 1
		i++
	}
	return i
}

function scanTemplate(s: string, i: number): number {
	i++
	while (i < s.length) {
		const c = s[i]
		if (c === '\\') {
			i += 2
			continue
		}
		if (c === '`') return i + 1
		if (c === '$' && s[i + 1] === '{') {
			let depth = 1
			i += 2
			while (i < s.length && depth > 0) {
				const d = s[i]
				if (d === '\\') {
					i += 2
					continue
				}
				if (d === '`') {
					i = scanTemplate(s, i)
					continue
				}
				if (d === '"' || d === "'") {
					i = scanQuoted(s, i)
					continue
				}
				if (d === '{') depth++
				else if (d === '}') depth--
				i++
			}
			continue
		}
		i++
	}
	return i
}

/** 从 from 起扫描到 depth 0 的 `;`，返回其下标（找不到 -1） */
function scanStatementEnd(s: string, from: number): number {
	let depth = 0
	let i = from
	while (i < s.length) {
		const c = s[i]
		if (c === '"' || c === "'") {
			i = scanQuoted(s, i)
			continue
		}
		if (c === '`') {
			i = scanTemplate(s, i)
			continue
		}
		if (c === '/' && s[i + 1] === '/') {
			const nl = s.indexOf('\n', i)
			i = nl === -1 ? s.length : nl + 1
			continue
		}
		if (c === '/' && s[i + 1] === '*') {
			const e = s.indexOf('*/', i + 2)
			i = e === -1 ? s.length : e + 2
			continue
		}
		if (c === '(' || c === '[' || c === '{') depth++
		else if (c === ')' || c === ']' || c === '}') depth--
		else if (c === ';' && depth === 0) return i
		i++
	}
	return -1
}

// ---------------------------------------------------------------------------
// 小型 AST
// ---------------------------------------------------------------------------

type Node =
	| { k: 'lit'; v: string | number | boolean | null | undefined }
	| { k: 'id'; name: string }
	| { k: 'member'; obj: Node; name: string }
	| { k: 'index'; obj: Node; key: Node }
	| { k: 'call'; callee: Node; args: Node[] }
	| { k: 'tmpl'; parts: (string | Node)[] }
	| { k: 'arr'; items: (Node | { k: 'spread'; e: Node })[] }
	| { k: 'obj'; props: { key: string; value: Node }[] }
	| { k: 'arrow'; params: string[]; body: Node }
	| { k: 'block'; ret?: Node }
	| { k: 'jsx'; el: JsxEl }
	| { k: 'cond'; c: Node; a: Node; b: Node }
	| { k: 'binary'; op: string; l: Node; r: Node }
	| { k: 'unary'; op: string; e: Node }
	| { k: 'regex'; pattern: string; flags: string }

type JsxEl = { k: 'el'; tag: string; attrs: JsxAttr[]; children: JsxChild[]; selfClosing: boolean } | { k: 'frag'; children: JsxChild[] }
type JsxAttr = { name: string; value: Node } | { spread: true }
type JsxChild = { k: 'text'; text: string } | { k: 'expr'; node?: Node; src?: string } | { k: 'jsx'; el: JsxEl }

class ParseError extends Error {}

function fail(): never {
	throw new ParseError('parse failed')
}

// ---------------------------------------------------------------------------
// 解析器（字符级递归下降）
// ---------------------------------------------------------------------------

const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[\w$]/
const NUMBER_RE = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)/

class Parser {
	s: string
	i = 0
	constructor(s: string) {
		this.s = s
	}
	eof(): boolean {
		return this.i >= this.s.length
	}
	peek(off = 0): string {
		return this.s[this.i + off] ?? ''
	}
	startsWith(t: string): boolean {
		return this.s.startsWith(t, this.i)
	}
	skipWs(): void {
		while (this.i < this.s.length) {
			const c = this.s[this.i]
			if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
				this.i++
				continue
			}
			if (c === '/' && this.s[this.i + 1] === '/') {
				const nl = this.s.indexOf('\n', this.i)
				this.i = nl === -1 ? this.s.length : nl + 1
				continue
			}
			if (c === '/' && this.s[this.i + 1] === '*') {
				const e = this.s.indexOf('*/', this.i + 2)
				this.i = e === -1 ? this.s.length : e + 2
				continue
			}
			break
		}
	}
	expect(t: string): void {
		this.skipWs()
		if (!this.startsWith(t)) fail()
		this.i += t.length
	}
	readIdentifier(): string {
		if (!IDENT_START.test(this.peek())) fail()
		let j = this.i + 1
		while (j < this.s.length && IDENT_PART.test(this.s[j])) j++
		const name = this.s.slice(this.i, j)
		this.i = j
		return name
	}
	readString(): string {
		const q = this.peek()
		if (q !== '"' && q !== "'") fail()
		this.i++
		let out = ''
		while (this.i < this.s.length) {
			const c = this.s[this.i]
			if (c === '\\') {
				out += unescapeChar(this.s[this.i + 1])
				this.i += 2
				continue
			}
			if (c === q) {
				this.i++
				return out
			}
			out += c
			this.i++
		}
		fail()
	}
	/** JSX 属性里的字符串：按 HTML 语义处理，不做反斜杠转义 */
	readJsxString(): string {
		const q = this.peek()
		if (q !== '"' && q !== "'") fail()
		this.i++
		const start = this.i
		while (this.i < this.s.length && this.s[this.i] !== q) this.i++
		if (this.i >= this.s.length) fail()
		const raw = this.s.slice(start, this.i)
		this.i++
		return raw
	}
	readNumber(): number {
		const m = NUMBER_RE.exec(this.s.slice(this.i))
		if (!m) fail()
		this.i += m[0].length
		const text = m[0].replace(/_/g, '')
		if (/^0[xXbBoO]/.test(text)) return Number.parseInt(text.replace(/^0[xX]/, ''), 16)
		return Number(text)
	}
	readTemplate(): Node {
		if (this.peek() !== '`') fail()
		this.i++
		const parts: (string | Node)[] = ['']
		while (this.i < this.s.length) {
			const c = this.s[this.i]
			if (c === '\\') {
				parts[parts.length - 1] += unescapeChar(this.s[this.i + 1])
				this.i += 2
				continue
			}
			if (c === '`') {
				this.i++
				return { k: 'tmpl', parts }
			}
			if (c === '$' && this.s[this.i + 1] === '{') {
				this.i += 2
				const e = this.parseExpression()
				this.skipWs()
				if (this.peek() !== '}') fail()
				this.i++
				parts.push(e)
				parts.push('')
				continue
			}
			parts[parts.length - 1] += c
			this.i++
		}
		fail()
	}
	readRegex(): Node {
		if (this.peek() !== '/') fail()
		this.i++
		let pattern = ''
		while (this.i < this.s.length && this.s[this.i] !== '/') {
			if (this.s[this.i] === '\\') {
				pattern += this.s[this.i] + (this.s[this.i + 1] ?? '')
				this.i += 2
				continue
			}
			if (this.s[this.i] === '\n') fail()
			pattern += this.s[this.i]
			this.i++
		}
		if (this.peek() !== '/') fail()
		this.i++
		let flags = ''
		while (/[a-z]/i.test(this.peek())) flags += this.s[this.i++]
		return { k: 'regex', pattern, flags }
	}

	// --- 表达式 ---

	parseExpression(): Node {
		this.skipWs()
		const c = this.parseConditional()
		return c
	}

	parseConditional(): Node {
		const cond = this.parseLogical()
		this.skipWs()
		if (this.peek() === '?' && this.peek(1) !== '.' && this.peek(1) !== '?') {
			this.i++
			const a = this.parseExpression()
			this.skipWs()
			if (this.peek() !== ':') fail()
			this.i++
			const b = this.parseExpression()
			return { k: 'cond', c: cond, a, b }
		}
		return cond
	}

	parseLogical(): Node {
		let l = this.parseUnary()
		for (;;) {
			this.skipWs()
			let op: string | undefined
			if (this.startsWith('&&')) op = '&&'
			else if (this.startsWith('||')) op = '||'
			else if (this.startsWith('??')) op = '??'
			if (!op) break
			this.i += 2
			const r = this.parseUnary()
			l = { k: 'binary', op, l, r }
		}
		return l
	}

	parseUnary(): Node {
		this.skipWs()
		if (this.peek() === '!' && this.peek(1) !== '=') {
			this.i++
			return { k: 'unary', op: '!', e: this.parseUnary() }
		}
		if (this.peek() === '-' && !/[\d]/.test(this.peek(1))) {
			this.i++
			return { k: 'unary', op: '-', e: this.parseUnary() }
		}
		return this.parsePostfix()
	}

	parsePostfix(): Node {
		let e = this.parsePrimary()
		for (;;) {
			this.skipWs()
			const c = this.peek()
			if (c === '.' && this.peek(1) !== '.' && IDENT_START.test(this.peek(1))) {
				this.i++
				const name = this.readIdentifier()
				e = { k: 'member', obj: e, name }
				continue
			}
			if (c === '[') {
				this.i++
				const key = this.parseExpression()
				this.skipWs()
				if (this.peek() !== ']') fail()
				this.i++
				e = { k: 'index', obj: e, key }
				continue
			}
			if (c === '(') {
				this.i++
				const args = this.parseArgs()
				e = { k: 'call', callee: e, args }
				continue
			}
			break
		}
		return e
	}

	parseArgs(): Node[] {
		const args: Node[] = []
		this.skipWs()
		if (this.peek() === ')') {
			this.i++
			return args
		}
		for (;;) {
			args.push(this.parseExpression())
			this.skipWs()
			if (this.peek() === ',') {
				this.i++
				this.skipWs()
				if (this.peek() === ')') {
					this.i++
					return args
				}
				continue
			}
			if (this.peek() === ')') {
				this.i++
				return args
			}
			fail()
		}
	}

	parsePrimary(): Node {
		this.skipWs()
		const c = this.peek()
		if (c === '(') {
			const arrow = this.tryParseArrow()
			if (arrow) return arrow
			this.i++
			const e = this.parseExpression()
			this.skipWs()
			if (this.peek() !== ')') fail()
			this.i++
			return e
		}
		if (c === '[') return this.parseArray()
		if (c === '{') return this.parseObject()
		if (c === '`') return this.readTemplate()
		if (c === '"' || c === "'") return { k: 'lit', v: this.readString() }
		if (c === '<') return { k: 'jsx', el: this.parseJsxElement() }
		if (c === '/') return this.readRegex()
		if (/[\d]/.test(c) || (c === '.' && /[\d]/.test(this.peek(1)))) return { k: 'lit', v: this.readNumber() }
		if (IDENT_START.test(c)) {
			const name = this.readIdentifier()
			this.skipWs()
			if (this.startsWith('=>')) {
				this.i += 2
				return { k: 'arrow', params: [name], body: this.parseArrowBody() }
			}
			if (name === 'true') return { k: 'lit', v: true }
			if (name === 'false') return { k: 'lit', v: false }
			if (name === 'null') return { k: 'lit', v: null }
			if (name === 'undefined') return { k: 'lit', v: undefined }
			return { k: 'id', name }
		}
		fail()
	}

	tryParseArrow(): Node | undefined {
		const save = this.i
		try {
			this.i++ // (
			this.skipWs()
			const params: string[] = []
			if (this.peek() !== ')') {
				for (;;) {
					this.skipWs()
					if (!IDENT_START.test(this.peek())) {
						this.i = save
						return undefined
					}
					params.push(this.readIdentifier())
					this.skipWs()
					if (this.peek() === ',') {
						this.i++
						continue
					}
					break
				}
			}
			if (this.peek() !== ')') {
				this.i = save
				return undefined
			}
			this.i++
			this.skipWs()
			if (!this.startsWith('=>')) {
				this.i = save
				return undefined
			}
			this.i += 2
			return { k: 'arrow', params, body: this.parseArrowBody() }
		} catch {
			this.i = save
			return undefined
		}
	}

	parseArrowBody(): Node {
		this.skipWs()
		if (this.peek() === '{') {
			this.i++
			this.skipWs()
			if (this.startsWith('return') && !IDENT_PART.test(this.peek(6))) {
				this.i += 6
				const ret = this.parseExpression()
				this.skipWs()
				if (this.peek() === ';') this.i++
				this.skipWs()
				if (this.peek() === '}') this.i++
				return { k: 'block', ret }
			}
			// 其它语句块：整体跳过（不支持，求值时不产出内容）
			this.skipBlock()
			return { k: 'block' }
		}
		return this.parseExpression()
	}

	skipBlock(): void {
		let depth = 1
		while (this.i < this.s.length && depth > 0) {
			const c = this.s[this.i]
			if (c === '"' || c === "'") {
				this.i = scanQuoted(this.s, this.i)
				continue
			}
			if (c === '`') {
				this.i = scanTemplate(this.s, this.i)
				continue
			}
			if (c === '{') depth++
			else if (c === '}') depth--
			this.i++
		}
	}

	parseArray(): Node {
		this.i++ // [
		const items: (Node | { k: 'spread'; e: Node })[] = []
		this.skipWs()
		if (this.peek() === ']') {
			this.i++
			return { k: 'arr', items }
		}
		for (;;) {
			this.skipWs()
			if (this.peek() === ']') {
				this.i++
				return { k: 'arr', items }
			}
			if (this.startsWith('...')) {
				this.i += 3
				items.push({ k: 'spread', e: this.parseExpression() })
			} else {
				items.push(this.parseExpression())
			}
			this.skipWs()
			if (this.peek() === ',') {
				this.i++
				continue
			}
			if (this.peek() === ']') {
				this.i++
				return { k: 'arr', items }
			}
			fail()
		}
	}

	parseObject(): Node {
		this.i++ // {
		const props: { key: string; value: Node }[] = []
		this.skipWs()
		if (this.peek() === '}') {
			this.i++
			return { k: 'obj', props }
		}
		for (;;) {
			this.skipWs()
			if (this.peek() === '}') {
				this.i++
				return { k: 'obj', props }
			}
			if (this.startsWith('...')) fail() // 展开不支持 → 整体判为不可求值
			let key: string
			if (this.peek() === '"' || this.peek() === "'") key = this.readString()
			else if (/[\d]/.test(this.peek())) key = String(this.readNumber())
			else key = this.readIdentifier()
			this.skipWs()
			if (this.peek() === ':') {
				this.i++
				props.push({ key, value: this.parseExpression() })
			} else {
				props.push({ key, value: { k: 'id', name: key } })
			}
			this.skipWs()
			if (this.peek() === ',') {
				this.i++
				continue
			}
			if (this.peek() === '}') {
				this.i++
				return { k: 'obj', props }
			}
			fail()
		}
	}

	// --- JSX ---

	readJsxTagName(): string {
		let j = this.i
		while (j < this.s.length && /[A-Za-z0-9_.$:-]/.test(this.s[j])) j++
		if (j === this.i) fail()
		const name = this.s.slice(this.i, j)
		this.i = j
		return name
	}

	parseJsxElement(): JsxEl {
		if (this.peek() !== '<') fail()
		this.i++
		if (this.peek() === '>') {
			// fragment <>
			this.i++
			const children = this.parseJsxChildren(undefined)
			return { k: 'frag', children }
		}
		if (this.peek() === '/') fail()
		const tag = this.readJsxTagName()
		const { attrs, selfClosing } = this.parseJsxAttributes()
		if (selfClosing || HTML_VOID.has(tag.toLowerCase())) return { k: 'el', tag, attrs, children: [], selfClosing: true }
		const children = this.parseJsxChildren(tag)
		return { k: 'el', tag, attrs, children, selfClosing: false }
	}

	parseJsxAttributes(): { attrs: JsxAttr[]; selfClosing: boolean } {
		const attrs: JsxAttr[] = []
		for (;;) {
			this.skipJsxWs()
			if (this.startsWith('/>')) {
				this.i += 2
				return { attrs, selfClosing: true }
			}
			if (this.peek() === '>') {
				this.i++
				return { attrs, selfClosing: false }
			}
			if (this.startsWith('{')) {
				// {...spread}
				const end = findBracedSkipping(this.s, this.i, [])
				if (end === -1) fail()
				this.i = end + 1
				attrs.push({ spread: true })
				continue
			}
			if (!/[A-Za-z_]/.test(this.peek())) fail()
			let j = this.i
			while (j < this.s.length && /[A-Za-z0-9_:.-]/.test(this.s[j])) j++
			const name = this.s.slice(this.i, j)
			this.i = j
			this.skipJsxWs()
			if (this.peek() === '=') {
				this.i++
				this.skipJsxWs()
				if (this.peek() === '"' || this.peek() === "'") {
					attrs.push({ name, value: { k: 'lit', v: this.readJsxString() } })
				} else if (this.peek() === '{') {
					this.i++
					const node = this.parseExpression()
					this.skipWs()
					if (this.peek() !== '}') fail()
					this.i++
					attrs.push({ name, value: node })
				} else {
					fail()
				}
			} else {
				attrs.push({ name, value: { k: 'lit', v: true } })
			}
		}
	}

	parseJsxChildren(closeTag: string | undefined): JsxChild[] {
		const children: JsxChild[] = []
		for (;;) {
			if (this.i >= this.s.length) fail()
			if (this.peek() === '<') {
				if (this.startsWith('<!--')) {
					const end = this.s.indexOf('-->', this.i + 4)
					if (end === -1) fail()
					children.push({ k: 'text', text: this.s.slice(this.i, end + 3) })
					this.i = end + 3
					continue
				}
				if (this.startsWith('</')) {
					this.i += 2
					let name = ''
					if (this.peek() !== '>') name = this.readJsxTagName()
					this.skipJsxWs()
					if (this.peek() !== '>') fail()
					this.i++
					if (closeTag === undefined) {
						if (name !== '') fail() // fragment 只能以 </> 结束
					} else if (name !== closeTag) {
						fail()
					}
					return children
				}
				children.push({ k: 'jsx', el: this.parseJsxElement() })
				continue
			}
			if (this.peek() === '{') {
				const start = this.i
				if (this.startsWith('{/*')) {
					const end = this.s.indexOf('*/}', this.i + 3)
					if (end === -1) fail()
					this.i = end + 3
					continue
				}
				this.i++
				this.skipWs()
				if (this.peek() === '}') {
					this.i++
					children.push({ k: 'expr' })
					continue
				}
				const node = this.parseExpression()
				this.skipWs()
				if (this.peek() !== '}') fail()
				this.i++
				children.push({ k: 'expr', node, src: this.s.slice(start, this.i) })
				continue
			}
			let text = ''
			while (this.i < this.s.length && this.s[this.i] !== '<' && this.s[this.i] !== '{') {
				text += this.s[this.i]
				this.i++
			}
			if (text) children.push({ k: 'text', text })
		}
	}

	skipJsxWs(): void {
		while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
	}
}

function unescapeChar(c: string | undefined): string {
	if (c === undefined) return ''
	switch (c) {
		case 'n':
			return '\n'
		case 't':
			return '\t'
		case 'r':
			return '\r'
		case '0':
			return '\0'
		case '\\':
		case "'":
		case '"':
		case '`':
		case '$':
			return c
		default:
			return c
	}
}

/** 解析一段表达式文本；失败返回 undefined */
function parseExpressionText(code: string): Node | undefined {
	try {
		const p = new Parser(code)
		p.skipWs()
		const node = p.parseExpression()
		p.skipWs()
		if (!p.eof()) return undefined
		return node
	} catch {
		return undefined
	}
}

// ---------------------------------------------------------------------------
// 安全求值
// ---------------------------------------------------------------------------

class Env {
	private readonly vars: Map<string, unknown>
	constructor(vars: Map<string, unknown> = new Map()) {
		this.vars = vars
	}
	get(name: string): unknown {
		if (name === 'undefined') return undefined
		if (this.vars.has(name)) return this.vars.get(name)
		return UNKNOWN
	}
	set(name: string, value: unknown): void {
		this.vars.set(name, value)
	}
	with(name: string, value: unknown): Env {
		const next = new Map(this.vars)
		next.set(name, value)
		return new Env(next)
	}
}

interface JsxValue {
	__jsx: JsxEl
	/** 该 JSX 求值时的作用域（map 回调里的 item 等），渲染时必须用它 */
	__env: Env
}
interface FnValue {
	__fn: { k: 'arrow'; params: string[]; body: Node }
}
interface RegexValue {
	__regex: { pattern: string; flags: string }
}

function isJsxValue(v: unknown): v is JsxValue {
	return !!v && typeof v === 'object' && '__jsx' in (v as object)
}
function isFnValue(v: unknown): v is FnValue {
	return !!v && typeof v === 'object' && '__fn' in (v as object)
}
function isRegexValue(v: unknown): v is RegexValue {
	return !!v && typeof v === 'object' && '__regex' in (v as object)
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v) && !isJsxValue(v) && !isFnValue(v) && !isRegexValue(v)
}
function isPrimitive(v: unknown): boolean {
	return v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function getMember(obj: unknown, name: string): unknown {
	if (name === '__proto__' || name === 'constructor' || name === 'prototype') return UNKNOWN
	if (Array.isArray(obj)) {
		if (name === 'length') return obj.length
		const idx = Number(name)
		if (Number.isInteger(idx) && idx >= 0 && idx < obj.length) return obj[idx]
		return UNKNOWN
	}
	if (typeof obj === 'string') {
		if (name === 'length') return obj.length
		return UNKNOWN
	}
	if (isPlainObject(obj)) {
		return Object.prototype.hasOwnProperty.call(obj, name) ? obj[name] : UNKNOWN
	}
	return UNKNOWN
}

function evaluate(n: Node | undefined, env: Env): unknown {
	if (!n) return UNKNOWN
	switch (n.k) {
		case 'lit':
			return n.v
		case 'id':
			return env.get(n.name)
		case 'member':
			return getMember(evaluate(n.obj, env), n.name)
		case 'index': {
			const base = evaluate(n.obj, env)
			const key = evaluate(n.key, env)
			if (typeof key === 'string' || typeof key === 'number') return getMember(base, String(key))
			return UNKNOWN
		}
		case 'call':
			return evaluateCall(n, env)
		case 'tmpl': {
			let s = ''
			for (const part of n.parts) {
				if (typeof part === 'string') {
					s += part
					continue
				}
				const v = evaluate(part, env)
				if (!isPrimitive(v)) return UNKNOWN
				s += String(v)
			}
			return s
		}
		case 'arr': {
			const out: unknown[] = []
			for (const item of n.items) {
				if (item.k === 'spread') {
					const v = evaluate(item.e, env)
					if (!Array.isArray(v)) return UNKNOWN
					out.push(...v)
				} else {
					out.push(evaluate(item, env))
				}
			}
			return out
		}
		case 'obj': {
			const obj: Record<string, unknown> = Object.create(null)
			for (const p of n.props) obj[p.key] = evaluate(p.value, env)
			return obj
		}
		case 'arrow':
			return { __fn: n }
		case 'block':
			return n.ret ? evaluate(n.ret, env) : UNKNOWN
		case 'jsx':
			return { __jsx: n.el, __env: env }
		case 'cond': {
			const c = evaluate(n.c, env)
			if (typeof c === 'boolean') return evaluate(c ? n.a : n.b, env)
			return UNKNOWN
		}
		case 'binary': {
			const l = evaluate(n.l, env)
			if (n.op === '&&') return l ? evaluate(n.r, env) : l
			if (n.op === '||') return l ? l : evaluate(n.r, env)
			if (n.op === '??') return l === null || l === undefined ? evaluate(n.r, env) : l
			const r = evaluate(n.r, env)
			if (n.op === '+') {
				if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r)
				if (typeof l === 'number' && typeof r === 'number') return l + r
			}
			return UNKNOWN
		}
		case 'unary': {
			const v = evaluate(n.e, env)
			if (n.op === '!') return !v
			if (n.op === '-' && typeof v === 'number') return -v
			return UNKNOWN
		}
		case 'regex':
			return { __regex: { pattern: n.pattern, flags: n.flags } }
		default:
			return UNKNOWN
	}
}

function evaluateCall(n: { k: 'call'; callee: Node; args: Node[] }, env: Env): unknown {
	if (n.callee.k !== 'member') return UNKNOWN
	const method = n.callee.name
	const base = evaluate(n.callee.obj, env)
	if (method === 'map' && Array.isArray(base) && n.args.length >= 1) {
		const fnArg = n.args[0]
		if (fnArg.k === 'arrow') return base.map((item, idx) => callArrow(fnArg, [item, idx, base], env))
	}
	if (method === 'join' && Array.isArray(base) && base.every(isPrimitive)) {
		const sep = n.args.length ? evaluate(n.args[0], env) : ','
		return base.map((x) => String(x)).join(typeof sep === 'string' ? sep : ',')
	}
	if (typeof base === 'string') {
		if (method === 'trim') return base.trim()
		if (method === 'toUpperCase') return base.toUpperCase()
		if (method === 'toLowerCase') return base.toLowerCase()
		if (method === 'replace' && n.args.length >= 2) return safeReplace(base, n.args[0], n.args[1], env)
		if (method === 'slice') {
			const a = n.args.length ? evaluate(n.args[0], env) : 0
			const b = n.args.length >= 2 ? evaluate(n.args[1], env) : undefined
			if ((typeof a === 'number' || a === undefined) && (typeof b === 'number' || b === undefined)) return base.slice(a, b)
		}
	}
	return UNKNOWN
}

/** 受控的 String.prototype.replace：查找模式只接受字符串/正则字面量，替换值必须是字符串 */
function safeReplace(base: string, patArg: Node, replArg: Node, env: Env): unknown {
	const repl = evaluate(replArg, env)
	if (typeof repl !== 'string') return UNKNOWN
	if (patArg.k === 'lit' && typeof patArg.v === 'string') return base.replace(patArg.v, repl)
	if (patArg.k === 'regex') {
		try {
			return base.replace(new RegExp(patArg.pattern, patArg.flags), repl)
		} catch {
			return UNKNOWN
		}
	}
	return UNKNOWN
}

function callArrow(fn: { k: 'arrow'; params: string[]; body: Node }, args: unknown[], env: Env): unknown {
	let scoped = env
	for (let i = 0; i < fn.params.length; i++) scoped = scoped.with(fn.params[i], args[i])
	if (fn.body.k === 'block') return fn.body.ret ? evaluate(fn.body.ret, scoped) : UNKNOWN
	return evaluate(fn.body, scoped)
}

// ---------------------------------------------------------------------------
// JSX → HTML
// ---------------------------------------------------------------------------

const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const SVG_SELF = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'stop', 'image', 'animate'])
/** 这些标签一律不落地（可执行 / 可加载外部内容 / 表单） */
const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'textarea', 'select', 'option', 'noscript', 'template', 'portal'])
/** 事件属性（onClick / onclick 两种写法都拦） */
const EVENT_ATTR = /^on(click|dblclick|change|input|submit|reset|focus|blur|load|error|copy|cut|paste|mouse\w+|key\w+|pointer\w+|touch\w+|drag\w*|drop|scroll|wheel|contextmenu)$/i

function unknownHint(original: string): string {
	const src = original.length > 200 ? `${original.slice(0, 200)}…` : original
	return `<span class="mdx-unknown" title="该表达式无法安全求值（预览不会执行脚本），已原样保留">${escapeHtml(src)}</span>`
}

/** 从 onclick 里识别出要复制的内容（只做文本提取，绝不执行脚本） */
function extractCopyText(handler: string): string | undefined {
	const m = /clipboard\.writeText\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(handler)
	if (!m) return undefined
	return m[2].replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1')
}

function arrayToTable(arr: Record<string, unknown>[]): string {
	const cols = [...new Set(arr.flatMap((o) => Object.keys(o)))]
	const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`
	const rows = arr
		.map((o) => `<tr>${cols.map((c) => `<td>${escapeHtml(stringifyCell(o[c]))}</td>`).join('')}</tr>`)
		.join('')
	return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`
}

function stringifyCell(v: unknown): string {
	if (v === null || v === undefined) return ''
	if (typeof v === 'object') return JSON.stringify(v)
	return String(v)
}

function renderValue(v: unknown, env: Env, original: string): string {
	if (v === UNKNOWN) return unknownHint(original)
	if (v === null || v === undefined) return ''
	if (typeof v === 'string') return escapeHtml(v)
	if (typeof v === 'number' || typeof v === 'boolean') return escapeHtml(String(v))
	if (isJsxValue(v)) return renderJsx(v.__jsx, v.__env)
	if (Array.isArray(v)) {
		if (v.length > 0 && v.every(isPlainObject)) return arrayToTable(v as Record<string, unknown>[])
		return v.map((item) => renderValue(item, env, original)).join('')
	}
	if (isPlainObject(v)) return escapeHtml(JSON.stringify(v, null, 2))
	return unknownHint(original)
}

function renderJsx(el: JsxEl, env: Env): string {
	if (el.k === 'frag') return renderChildren(el.children, env)
	const name = el.tag
	if (!/^[a-z]/.test(name)) {
		return `<div class="mdx-component" title="预览不加载自定义组件">[组件 ${escapeHtml(name)} 未渲染]</div>`
	}
	if (BLOCKED_TAGS.has(name.toLowerCase())) {
		return `<div class="mdx-blocked" title="出于安全考虑已阻止">[已阻止 &lt;${escapeHtml(name)}&gt;]</div>`
	}
	const { attrs, copyText } = renderAttributes(el.attrs, env)
	const copy = copyText !== undefined ? ` data-copy="${escapeAttr(copyText)}"` : ''
	const open = `<${name}${attrs}${copy}`
	if (HTML_VOID.has(name.toLowerCase())) return `${open}>`
	if (el.selfClosing) return SVG_SELF.has(name.toLowerCase()) ? `${open}/>` : `${open}></${name}>`
	return `${open}>${renderChildren(el.children, env)}</${name}>`
}

function renderAttributes(attrs: JsxAttr[], env: Env): { attrs: string; copyText?: string } {
	let out = ''
	let copyText: string | undefined
	for (const attr of attrs) {
		if ('spread' in attr) continue
		let value: string | number | boolean | undefined
		const v = evaluate(attr.value, env)
		if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') value = v
		else continue
		// 事件处理器：绝不落地；能识别成复制就转成 data-copy，交给组件安全绑定
		if (EVENT_ATTR.test(attr.name)) {
			if (typeof value === 'string') {
				const t = extractCopyText(value)
				if (t !== undefined) copyText = t
			}
			continue
		}
		let name = attr.name
		if (name === 'className') name = 'class'
		else if (name === 'htmlFor') name = 'for'
		else if (name === 'style') continue
		if (!/^[a-zA-Z][\w-]*$/.test(name)) continue
		if (value === true) {
			out += ` ${name}`
			continue
		}
		out += ` ${name}="${escapeAttr(String(value))}"`
	}
	return { attrs: out, copyText }
}

function renderChildren(children: JsxChild[], env: Env): string {
	let out = ''
	for (const child of children) {
		if (child.k === 'text') {
			if (/^\s*$/.test(child.text)) continue
			out += escapeHtml(child.text)
		} else if (child.k === 'expr') {
			if (!child.node) continue
			out += renderValue(evaluate(child.node, env), env, child.src ?? nodeSource(child.node))
		} else if (child.k === 'jsx') {
			out += renderJsx(child.el, env)
		}
	}
	return out
}

/** 给降级提示用的「原始文本」——这里用节点类型粗略还原即可 */
function nodeSource(n: Node): string {
	switch (n.k) {
		case 'id':
			return n.name
		case 'member':
			return `${nodeSource(n.obj)}.${n.name}`
		case 'call':
			return `${nodeSource(n.callee)}(…)`
		case 'tmpl':
			return '`…`'
		case 'lit':
			return typeof n.v === 'string' ? JSON.stringify(n.v) : String(n.v)
		default:
			return n.k
	}
}

// ---------------------------------------------------------------------------
// 顶层：MDX 正文 → HTML（JSX 还原，其余交给 marked）
// ---------------------------------------------------------------------------

function isLineStart(s: string, i: number): boolean {
	const lineStart = s.lastIndexOf('\n', i - 1) + 1
	return /^\s*$/.test(s.slice(lineStart, i))
}

/** 解析失败时的兜底：用字符扫描找出元素范围（原样输出，显式降级） */
function scanElement(s: string, start: number, ranges: [number, number][]): number {
	const stack: string[] = []
	let i = start
	while (i < s.length) {
		const r = inRanges(ranges, i)
		if (r) {
			i = r[1]
			continue
		}
		const c = s[i]
		if (c === '{') {
			const e = findBracedSkipping(s, i, ranges)
			if (e === -1) return -1
			i = e + 1
			continue
		}
		if (c !== '<') {
			i++
			continue
		}
		if (s.startsWith('<!--', i)) {
			const end = s.indexOf('-->', i + 4)
			if (end === -1) return -1
			i = end + 3
			continue
		}
		const tag = scanTagExtent(s, i, ranges)
		if (!tag) return -1
		i = tag.end
		if (tag.closing) {
			stack.pop()
			if (stack.length === 0) return i
		} else if (!tag.selfClosing && !HTML_VOID.has(tag.name.toLowerCase())) {
			stack.push(tag.name)
		} else if (stack.length === 0) {
			return i
		}
	}
	return -1
}

/** 从 < 起扫描一个标签的结束位置（跳过引号与 {}，忽略其中的 >） */
function scanTagExtent(s: string, i: number, ranges: [number, number][]): { name: string; closing: boolean; selfClosing: boolean; end: number } | undefined {
	let j = i + 1
	const closing = s[j] === '/'
	if (closing) j++
	if (s[j] === '>') return { name: '', closing, selfClosing: false, end: j + 1 }
	let k = j
	while (k < s.length && /[A-Za-z0-9_.$:-]/.test(s[k])) k++
	const name = s.slice(j, k)
	if (!name) return undefined
	j = k
	let depth = 0
	while (j < s.length) {
		const r = inRanges(ranges, j)
		if (r) {
			j = r[1]
			continue
		}
		const c = s[j]
		if (c === '"' || c === "'") {
			j = scanQuoted(s, j)
			continue
		}
		if (c === '{') {
			depth++
			j++
			continue
		}
		if (c === '}') {
			depth--
			j++
			continue
		}
		if (depth === 0 && c === '/') {
			if (s[j + 1] === '>') return { name, closing, selfClosing: true, end: j + 2 }
			j++
			continue
		}
		if (depth === 0 && c === '>') return { name, closing, selfClosing: false, end: j + 1 }
		j++
	}
	return undefined
}

function renderExpression(inner: string, original: string, env: Env): string {
	const node = parseExpressionText(inner)
	if (!node) return unknownHint(original)
	return renderValue(evaluate(node, env), env, original)
}

function renderJsxSource(ts: string, env: Env): string {
	const p = new Parser(ts)
	try {
		p.skipWs()
		const el = p.parseJsxElement()
		p.skipWs()
		if (!p.eof()) throw new ParseError('trailing')
		return renderJsx(el, env)
	} catch {
		const src = ts.length > 400 ? `${ts.slice(0, 400)}…` : ts
		return `<div class="mdx-unknown" title="该 JSX 块无法解析，已原样保留">${escapeHtml(src)}</div>`
	}
}

interface ExportStmt {
	name: string
	init: string
	start: number
	end: number
}

function extractExports(md: string, ranges: [number, number][]): ExportStmt[] {
	const out: ExportStmt[] = []
	const re = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+?)?\s*=/gm
	let m: RegExpExecArray | null
	while ((m = re.exec(md)) !== null) {
		if (inRanges(ranges, m.index)) continue
		const eqIndex = m.index + m[0].length - 1
		const semi = scanStatementEnd(md, eqIndex + 1)
		if (semi === -1) continue
		out.push({ name: m[1], init: md.slice(eqIndex + 1, semi).trim(), start: m.index, end: semi + 1 })
		re.lastIndex = semi + 1
	}
	return out
}

function renderBody(md: string, ranges: [number, number][], exports: ExportStmt[], env: Env): string {
	const skip = new Map<number, number>()
	for (const ex of exports) skip.set(ex.start, ex.end)
	const hasExports = exports.length > 0
	let out = ''
	let i = 0
	while (i < md.length) {
		const r = inRanges(ranges, i)
		if (r) {
			out += md.slice(i, r[1])
			i = r[1]
			continue
		}
		const sk = skip.get(i)
		if (sk !== undefined) {
			i = sk
			continue
		}
		const c = md[i]
		// 顶层 import 语句：只移除，绝不加载/执行任何被导入的模块
		if (c === 'i' && isLineStart(md, i) && /^import[\s{*]/.test(md.slice(i, i + 8))) {
			const semi = scanStatementEnd(md, i)
			if (semi !== -1) {
				i = semi + 1
				continue
			}
		}
		if (c === '{') {
			if (md.startsWith('{/*', i)) {
				const close = md.indexOf('*/}', i + 3)
				if (close !== -1) {
					i = close + 3
					continue
				}
			}
			if (!hasExports) {
				out += c
				i++
				continue
			}
			const end = findBracedSkipping(md, i, ranges)
			if (end === -1) {
				out += c
				i++
				continue
			}
			const inner = md.slice(i + 1, end).trim()
			if (!inner) {
				i = end + 1
				continue
			}
			out += renderExpression(inner, md.slice(i, end + 1), env)
			i = end + 1
			continue
		}
		if (c === '<' && /[A-Za-z/>]/.test(md[i + 1] ?? '') && isLineStart(md, i)) {
			const save = i
			const p = new Parser(md)
			p.i = i
			try {
				const el = p.parseJsxElement()
				out += renderJsx(el, env)
				i = p.i
				continue
			} catch {
				i = save
			}
			const end = scanElement(md, i, ranges)
			if (end !== -1) {
				out += renderJsxSource(md.slice(i, end), env)
				i = end
				continue
			}
		}
		out += c
		i++
	}
	return out
}

/**
 * 把 MDX 正文安全地转成 HTML。
 * 只做静态还原，不执行任何用户代码（保留 async 签名以兼容调用方）。
 */
export async function transformMdx(md: string): Promise<string> {
	const ranges = codeRanges(md)
	const exports = extractExports(md, ranges)
	const env = new Env()
	for (const ex of exports) {
		const node = parseExpressionText(ex.init)
		env.set(ex.name, node ? evaluate(node, env) : UNKNOWN)
	}
	return renderBody(md, ranges, exports, env)
}
