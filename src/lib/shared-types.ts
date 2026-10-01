/**
 * 主进程 ↔ 预加载 ↔ 渲染层之间传递的数据结构。
 * 三方共用这一份定义：主进程负责产出，渲染层通过 window.api 消费，
 * 避免两边各写一份接口后悄悄跑偏（字段漂移编译器不会报错）。
 */

/**
 * 内容文件（文章 / 项目 / 动态 / spec）。
 *
 * rel 用来打开文件；其余字段是**列表卡片**要显示的元信息，由后端解析 frontmatter
 * 时顺带带出（不额外发请求）。后端没声明对应 fields 时就是空值，界面据此隐藏该行。
 */
export interface ContentItem {
	rel: string
	mtimeMs: number
	/** frontmatter 标题；缺省时后端回落成 slug */
	title: string
	/** 草稿标记 */
	draft: boolean
	/** 排序/显示用的兜底日期（updated 优先，其次 published） */
	date: string
	/** 发表日期 —— 列表排序**按它**（博客惯例）；可能为空 */
	published: string
	/** 最后更新日期；可能为空 */
	updated: string
	/** 分类 */
	category: string
	/** 标签 */
	tags: string[]
	/** 封面图直链 */
	image: string
	/** 摘要 */
	description: string
	/** 条目 slug（文件名，不含目录与扩展名） */
	slug: string
}

/** git status --porcelain 的结果；ok=false 时 error 是给用户看的原文 */
export interface GitStatus {
	ok: boolean
	branch?: string
	files: { flag: string; file: string }[]
	error?: string
}

export interface RemoteInfo {
	name: string
	fetch: string
	push: string
}

export interface BranchInfo {
	name: string
	current: boolean
}

/** 合并结果：ok=false 时看 log 里的 git 输出；conflicted 表示留下了冲突文件 */
export interface MergeResult {
	ok: boolean
	log: string
	conflicted: boolean
}

export interface LogEntry {
	hash: string
	author: string
	date: string
	subject: string
}

/** 客户端外观偏好，存 data/settings.json，保存后立即生效（无需重启） */
export interface AppearanceSettings {
	/** 主题色与它的深色变体（十六进制） */
	accent?: string
	accentDeep?: string
	/** 壁纸减淡程度 0~0.85，越大越淡 */
	wallpaperDim?: number
	/** 卡片不透明度 0.3~1（1 = 不透明；调低可露出后面的壁纸） */
	cardOpacity?: number
	/** 侧栏不透明度 0.3~1；不填时跟随 cardOpacity */
	sidebarOpacity?: number
	/** 已导入壁纸的文件路径；为空表示不使用壁纸 */
	wallpaper?: string
	/** 是否显示侧栏看板娘（关掉后拖拽/缩放更流畅） */
	live2dEnabled?: boolean
	/**
	 * 是否把侧栏的看板娘显示区**收起来**（看板娘的 🔙 按钮就是切这个）。
	 *
	 * 与 `live2dEnabled` 的区别：那个是「整个功能开关」（设置页里关掉后连「调整看板娘」
	 * 按钮一起消失）；这个只是把**显示区**收走，侧栏留一个「展开看板娘」按钮，
	 * 随手就能放回来 —— 用户点 🔙 时想的是「先让开地方」，不是「把功能关了」。
	 */
	live2dCollapsed?: boolean
	/** 全窗口鼠标跟随；未设置时默认开启 */
	live2dGlobalFollow?: boolean
	/** 看板娘缩放，1 = 原项目初始值 */
	live2dScale?: number
	/** 看板娘水平 / 垂直偏移（像素），叠加在原项目初始值之上 */
	live2dX?: number
	live2dY?: number
}

/** app:init 的返回值：项目是否已绑定，以及随窗口一起送出的外观与壁纸 */
export interface AppSettingsInfo {
	projectPath?: string
	valid: boolean
	appearance?: AppearanceSettings
	wallpaperData?: string | null
}

/** 单个导出对象的表单数据：values 是字段值，labels 是「注释当标签」的映射（键为字段路径） */
export interface ConfigExportData {
	name: string
	values: unknown
	labels: Record<string, string>
}

/** 主进程扫描 src/config/ 发现的配置文件 */
export interface DiscoveredConfig {
	rel: string
	kind: 'ts' | 'html'
	exports: string[]
}

/** 配置读取结果：html 走源码编辑器，ts 走表单 */
export type ConfigReadResult =
	| { kind: 'html'; rel: string; content: string }
	| { kind: 'ts'; rel: string; exports: ConfigExportData[] }

/** 数据目录状态：dataDir 为当前生效目录，isCustom 表示用户换过位置 */
export interface DataDirInfo {
	dataDir: string
	isCustom: boolean
}

/**
 * 相册元信息（对应 src/config/galleryConfig.ts 里 albums 数组的一项）。
 * id 同时是 public/gallery/<id> 的目录名与站点路由段；索引签名保留未知扩展字段，
 * 后端读写时会原样透传，前端不要把它们丢掉。
 */
export interface GalleryAlbum {
	id: string
	name: string
	description?: string
	date?: string
	location?: string
	tags?: string[]
	/** 手动指定的封面（可留空，自动取 cover.* 或第一张） */
	cover?: string
	password?: string
	passwordHint?: string
	[key: string]: unknown
}

/** 相册里的一张图：本地图给 rel（项目内相对路径），urls.txt 远程图给 url */
export interface GalleryPhoto {
	name: string
	rel: string
	url?: string
	/** 用户设置的别名（显示用；为空表示没设，界面回落到 name / url） */
	alias?: string
}

/**
 * 相册的「管理器侧」配置（存数据目录的 `gallery.json`）。
 *
 * 刻意**不写进主题的 `galleryConfig.ts`**：别名与加密默认值是管理器自己的显示 / 便利设置，
 * 主题既没有对应字段（多写一个键会被 `GalleryConfig` 类型挡下来、构建直接报错），
 * 也不该把管理器的偏好混进博客内容。
 */
export interface GalleryPrefs {
	/** 「设为加密」用的默认密码 */
	defaultPassword: string
	/** 「设为加密」用的默认密码提示 */
	defaultPasswordHint: string
	/**
	 * 图片别名：`albumId → (key → 别名)`。
	 *
	 * key 由后端统一计算：本地图是**去掉编号前缀**的文件名
	 * （排序会把文件改名成 `000001-原名`，拿整个文件名当键一排序就失效），
	 * 远程图是完整 URL。
	 */
	aliases: Record<string, Record<string, string>>
}

/** 相册快照：相册列表 + 瀑布流最小列宽（默认 240） */
export interface GallerySnapshot {
	albums: GalleryAlbum[]
	columnWidth: number
}

/**
 * 克隆后缀配置（存数据目录的 `clone.json`）。
 *
 * 四类内容各一份：文章（posts，spec 复用这一档）、项目（projects）、动态（dynamic）、
 * 相册（gallery）。同样**不写进主题配置**：它是管理器自己的命名偏好。
 * 清洗后允许为空串（表示不加后缀，靠自动避让的序号区分）。
 */
export interface ClonePrefs {
	post: string
	project: string
	dynamic: string
	gallery: string
}

/**
 * 导入结果。
 *
 * `id` 为空串表示**用户在选择框里取消了**——取消不产生任何副作用，也不会建出空相册，
 * 前端据此提示「已取消导入」即可，不需要走异常分支。
 */
export interface GalleryImportResult {
	id: string
	photos: GalleryPhoto[]
	snapshot: GallerySnapshot
}

// ---------------- 布局配置（data/layout.json） ----------------

/**
 * 窗口几何。宽高是**逻辑像素**，与窗口构建时的单位一致。
 * `x` / `y` 缺省表示「让系统摆放」（首次启动）。
 */
export interface WindowLayout {
	width: number
	height: number
	x?: number
	y?: number
	maximized: boolean
}

/**
 * 布局配置：窗口尺寸/位置 + 各面板宽度。
 *
 * `ui` 是前端自己定义的面板宽度集合（sidebarWidth / editorWidth / configListWidth /
 * galleryListWidth / page…），后端只做浅合并与持久化，不认识具体键名 ——
 * 这样加一个新面板不用改 Rust。
 */
export interface LayoutConfig {
	window: WindowLayout
	/** 预览窗口尺寸（只有尺寸，位置固定居中） */
	previewWindow: WinSize
	ui: Record<string, unknown>
}

/** 一组窗口尺寸（逻辑像素） */
export interface WinSize {
	width: number
	height: number
}

/** 设置页「窗口」卡片要显示的两组尺寸 */
export interface WindowSizes {
	/** 主界面尺寸（取自 layout.json，最大化时是「还原后」的尺寸） */
	main: WinSize
	/** 预览窗口尺寸（下次打开时生效） */
	preview: WinSize
	/** 主窗口当前是否最大化（此时上面的 main 不是屏幕上看到的尺寸） */
	mainMaximized: boolean
}

// ---------------- 回收站 ----------------

/** 回收站里的一个条目：`rel` 是它**删除前**的项目内相对路径 */
export interface TrashItem {
	rel: string
	dir: boolean
}

export interface TrashEntry {
	/** 条目目录名，作为恢复 / 永久删除的句柄 */
	id: string
	/** post / project / dynamic / spec / content / album / photo / file / unknown */
	kind: string
	label: string
	/** 删除时间 `YYYY-MM-DD HH:MM:SS`（旧版本条目可能为空串） */
	at: string
	items: TrashItem[]
	/** 是否能一键恢复；旧版本条目缺元数据时为 false，只能手动取文件 */
	restorable: boolean
}

// ---------------- 附件 ----------------

/**
 * 附件目录里「正文没有引用」的文件。
 *
 * `rel` 是项目内相对路径，可以直接交给「打开文件 / 打开所在目录」两个命令。
 */
export interface UnusedAttachment {
	rel: string
	/** 文件大小（字节）—— 界面上给用户一个「值不值得留」的参考 */
	size: number
}

// ---------------- 即时预览（可配置命令的本地预览） ----------------

export interface DevServerStatus {
	/** 「我们自己起的」服务是否在跑 */
	running: boolean
	/** 本地预览地址，未就绪时为 null */
	url: string | null
	port: number
	/** 输出行；行数由用户的 `logLimit` 决定（0 = 不限制，一直显示） */
	log: string[]
	/** url 是否来自「项目里已经有一个预览服务在运行」（多半是用户自己在终端开的） */
	external: boolean
	/** 启动失败 / 被外部服务挡住 / 命令跑完没起服务时的说明（可直接显示给用户） */
	error?: string
	/** 当前档位：`dev` 开发预览 / `build` 构建后预览 */
	profile: DevProfile
	/** 当前跑的是「立即执行」里临时输入的命令（不属于档位配置） */
	adhoc: boolean
	/** 实际执行的命令行（`{dir}` 已展开），界面上原样显示便于核对 */
	command?: string
	/** 日志显示上限；0 = 不限制 */
	logLimit: number
	/** 命令已结束且不是我们主动停的时的退出码 */
	exitCode?: number
	/** 命令已结束（跑完 / 失败退出），用于区分「还在启动中」和「已经结束了」 */
	finished: boolean
}

/** 即时预览的档位：开发服务器 / 构建后预览 */
export type DevProfile = 'dev' | 'build'

/**
 * 「即时预览」的用户配置（存在数据目录的 `dev.json`）。
 *
 * 命令里用 `{dir}` 代表博客项目目录，执行时替换成**带引号的绝对路径** ——
 * 默认命令 `pnpm --dir {dir} dev` 因此不依赖工作目录，也不会跑到别的项目上。
 */
export interface DevPrefs {
	/** 功能总开关：关掉后侧栏不显示开关、启动时也不自动开启 */
	enabled: boolean
	/** 启动管理器时自动开启预览 */
	autoStart: boolean
	profile: DevProfile
	/** 开发预览命令 */
	devCommand: string
	/** 构建后预览命令 */
	buildCommand: string
	/** 日志显示最近多少行；0 = 不限制 */
	logLimit: number
}

/** 内置的预设命令（界面上点一下填进输入框） */
export interface DevPreset {
	id: string
	label: string
	profile: DevProfile
	command: string
	note: string
}

/** 预览配置页需要的一次性数据：配置 + 预设 + 环境信息 */
export interface DevConfigView {
	prefs: DevPrefs
	presets: DevPreset[]
	/** 绑定项目的绝对路径；未绑定时为 null */
	projectDir: string | null
	/** 本机能否找到 pnpm（找不到时界面提示改用 npm 预设） */
	pnpmAvailable: boolean
}

/**
 * 打开预览的结果。
 *
 * `mode` 说明预览开在了哪里：
 * - `window`：管理器内的独立窗口，直接加载开发服务器地址
 * - `browser`：退化成系统默认浏览器（管理器内无法显示窗口时）
 */
export interface PreviewOpenResult {
	url: string
	mode: 'window' | 'browser'
	note?: string
}
