import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import sql from "highlight.js/lib/languages/sql";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import plaintext from "highlight.js/lib/languages/plaintext";
import { Marked, Renderer } from "marked";
import { markedHighlight } from "marked-highlight";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("docker", dockerfile);
hljs.registerLanguage("plaintext", plaintext);
import {
  ArrowLeft,
  Bold,
  ChevronDown,
  ChevronRight,
  Code2,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Save,
  SplitSquareHorizontal,
  Table,
  Trash2,
} from "lucide-react";
import { postsApi, uploadImageWithProgress, type PostContent, type PostMeta } from "../lib/api";
import { slugify } from "../lib/utils";
import { useToast } from "../lib/toast";
import { Button, Card, Field, Input, Label, Toggle } from "./ui";

/**
 * 预览时图片不加载真实文件, 渲染为占位块 (仅显示图片路径)
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

function createMarkdownRenderer(): Marked {
  const marked = new Marked(
    markedHighlight({
      langPrefix: "hljs language-",
      highlight(code: string, lang: string) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    }),
  );
  const renderer = new Renderer();
  renderer.image = (token) => {
    const src = escapeHtml(token.href || "");
    const alt = escapeHtml(token.text || "");
    return `<div class="preview-img-placeholder"><span>IMG</span>${src}${alt ? ` — ${alt}` : ""}</div>`;
  };
  marked.use({ renderer });
  return marked;
}

type ViewMode = "split" | "edit" | "preview";

interface Props {
  slug: string | null;
  onBack: () => void;
  /** 保存/更新成功: 传回文章元数据; 删除成功: 传 null。前端本地更新列表, 不重新请求 */
  onSaved: (meta: PostMeta | null) => void;
}

export default function PostEditor({ slug, onBack, onSaved }: Props) {
  const isEditing = !!slug;

  const [title, setTitle] = useState("");
  const [postSlug, setPostSlug] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("");
  const [author, setAuthor] = useState("Admin");
  const [published, setPublished] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [updated, setUpdated] = useState(new Date().toISOString().split("T")[0]);
  const [draft, setDraft] = useState(true);
  const [comment, setComment] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [lang, setLang] = useState("");
  const [licenseName, setLicenseName] = useState("");
  const [licenseUrl, setLicenseUrl] = useState("");
  const [sourceLink, setSourceLink] = useState("");
  const [password, setPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const toast = useToast();
  const showMessage = useCallback(
    (text: string, type: "success" | "error") => toast(text, type),
    [toast],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slugManuallyEdited = useRef(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    postsApi
      .get(slug)
      .then((post: PostContent) => {
        setPostSlug(post.slug);
        setTitle(post.title || "");
        setDescription(post.description || "");
        setImage(post.image || "");
        setTags((post.tags || []).join(", "));
        setCategory(post.category || "");
        setAuthor(post.author || "Admin");
        setPublished(post.published ? post.published.split("T")[0] : "");
        setUpdated(post.updated ? post.updated.split("T")[0] : "");
        setDraft(post.draft ?? true);
        setComment(post.comment ?? true);
        setPinned(post.pinned ?? false);
        setLang(post.lang || "");
        setLicenseName(post.licenseName || "");
        setLicenseUrl(post.licenseUrl || "");
        setSourceLink(post.sourceLink || "");
        setPassword(post.password || "");
        setPasswordHint(post.passwordHint || "");
        setContent(post.content || "");
      })
      .catch((err: unknown) =>
        showMessage(
          err instanceof Error ? err.message : "加载失败",
          "error",
        ),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const previewHtml = useMemo(() => {
    if (!content.trim()) {
      return '<p style="color:#8b8b93;opacity:0.6">预览区域</p>';
    }
    try {
      return createMarkdownRenderer().parse(
        content,
        { breaks: true },
      ) as string;
    } catch {
      return `<pre>${content}</pre>`;
    }
  }, [content, postSlug, slug]);

  const advancedCount = useMemo(
    () =>
      [lang, licenseName, licenseUrl, sourceLink, password, passwordHint].filter(
        Boolean,
      ).length,
    [lang, licenseName, licenseUrl, sourceLink, password, passwordHint],
  );

  function handleTitleInput(value: string) {
    setTitle(value);
    if (!slugManuallyEdited.current && !isEditing) {
      setPostSlug(slugify(value));
    }
  }

  function wrapSelection(before: string, after: string, placeholder: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.substring(start, end) || placeholder;
    const newText =
      content.substring(0, start) + before + selected + after + content.substring(end);
    setContent(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  }

  function handleLink() {
    const url = prompt("输入链接地址:", "https://");
    if (url) wrapSelection("[", `](${url})`, "链接文字");
  }

  function handleTable() {
    const rows = prompt("行数:", "3");
    const cols = prompt("列数:", "3");
    if (!rows || !cols) return;
    const r = Math.max(2, Number.parseInt(rows, 10));
    const c = Math.max(1, Number.parseInt(cols, 10));
    let table = "";
    for (let i = 0; i < r; i++) {
      table += "|";
      for (let j = 0; j < c; j++) {
        table += ` ${i === 1 ? "---" : "cell"} |`;
      }
      table += "\n";
    }
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    setContent(content.substring(0, start) + table + content.substring(ta.selectionEnd));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + table.length, start + table.length);
    });
  }

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      showMessage("仅支持上传图片文件", "error");
      return;
    }
    try {
      const url = await uploadImageWithProgress(file, setUploadProgress);
      setUploadProgress(null);
      const alt = file.name.replace(/\.[^.]+$/, "");
      const ta = textareaRef.current;
      const md = `![${alt}](${url})`;
      if (ta) {
        const start = ta.selectionStart;
        setContent(
          content.substring(0, start) + md + content.substring(ta.selectionEnd),
        );
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(start + md.length, start + md.length);
        });
      } else {
        setContent((c) => c + `\n${md}\n`);
      }
      showMessage("图片上传成功", "success");
    } catch (err: unknown) {
      setUploadProgress(null);
      showMessage(
        err instanceof Error ? err.message : "图片上传失败",
        "error",
      );
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFileUpload(file);
        break;
      }
    }
  }

  const toolbar = useCallback(() => {
    const btns: { icon: React.ReactNode; title: string; onClick: () => void }[] = [
      { icon: <Bold className="h-4 w-4" />, title: "粗体", onClick: () => wrapSelection("**", "**", "粗体文字") },
      { icon: <Italic className="h-4 w-4" />, title: "斜体", onClick: () => wrapSelection("*", "*", "斜体文字") },
      { icon: <Heading2 className="h-4 w-4" />, title: "标题", onClick: () => wrapSelection("## ", "", "标题") },
      { icon: <Link2 className="h-4 w-4" />, title: "链接", onClick: handleLink },
      { icon: <Quote className="h-4 w-4" />, title: "引用", onClick: () => wrapSelection("> ", "", "引用文字") },
      { icon: <List className="h-4 w-4" />, title: "无序列表", onClick: () => wrapSelection("\n- ", "", "列表项") },
      { icon: <ListOrdered className="h-4 w-4" />, title: "有序列表", onClick: () => wrapSelection("\n1. ", "", "列表项") },
      { icon: <Code2 className="h-4 w-4" />, title: "代码块", onClick: () => wrapSelection("\n```\n", "\n```\n", "代码") },
      { icon: <Table className="h-4 w-4" />, title: "表格", onClick: handleTable },
      { icon: <ImageIcon className="h-4 w-4" />, title: "上传图片", onClick: () => fileInputRef.current?.click() },
    ];
    return btns;
  }, [content]);

  async function handleSave() {
    if (!postSlug.trim()) {
      showMessage("请输入 Slug", "error");
      return;
    }
    if (!title.trim()) {
      showMessage("请输入标题", "error");
      return;
    }
    setSaving(true);
    try {
      const frontmatter: Record<string, unknown> = {
        title: title.trim(),
        published,
        draft,
        description: description.trim(),
        image: image.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        category: category.trim(),
        lang: lang.trim(),
        pinned,
        author: author.trim(),
        comment,
        licenseName: licenseName.trim() || undefined,
        licenseUrl: licenseUrl.trim() || undefined,
        sourceLink: sourceLink.trim() || undefined,
        password: password.trim() || undefined,
        passwordHint: passwordHint.trim() || undefined,
      };
      if (updated) frontmatter.updated = updated;
      if (isEditing && slug) {
        await postsApi.update(slug, { frontmatter, content });
        showMessage("文章已更新", "success");
      } else {
        await postsApi.create({ slug: postSlug.trim(), frontmatter, content });
        showMessage("文章已创建", "success");
      }
      const meta: PostMeta = {
        slug: postSlug.trim(),
        title: title.trim(),
        published,
        updated: updated || undefined,
        draft,
        description: description.trim(),
        image: image.trim(),
        tags: (frontmatter.tags as string[]) || [],
        category: category.trim(),
        lang: lang.trim(),
        pinned,
        author: author.trim(),
        comment,
        licenseName: licenseName.trim() || undefined,
        licenseUrl: licenseUrl.trim() || undefined,
        sourceLink: sourceLink.trim() || undefined,
        password: password.trim() || undefined,
        passwordHint: passwordHint.trim() || undefined,
      };
      setTimeout(() => onSaved(meta), 800);
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!slug) return;
    if (!confirm("确定要删除这篇文章吗？")) return;
    try {
      await postsApi.delete(slug);
      showMessage("文章已删除", "success");
      setTimeout(() => onSaved(null), 800);
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : "删除失败", "error");
    }
  }

  const modes: ViewMode[] = ["split", "edit", "preview"];
  const viewIcon =
    viewMode === "split" ? (
      <SplitSquareHorizontal className="h-4 w-4" />
    ) : viewMode === "edit" ? (
      <Pencil className="h-4 w-4" />
    ) : (
      <ImageIcon className="h-4 w-4" />
    );

  return (
    <div className="mx-auto max-w-4xl">
      {loading ? (
        <div className="py-24 text-center text-sm text-muted-foreground">加载中...</div>
      ) : (
        <div className="space-y-4">
          {/* 元信息 */}
          <Card className="space-y-4 p-5">
            <div className="flex flex-col gap-4 sm:flex-row">
              <Field label="标题" className="flex-1">
                <Input
                  value={title}
                  onChange={(e) => handleTitleInput(e.target.value)}
                  placeholder="文章标题"
                  className="h-10 text-base font-semibold"
                />
              </Field>
              <Field label="slug" className="w-full sm:w-56">
                <Input
                  value={postSlug}
                  onChange={(e) => {
                    slugManuallyEdited.current = true;
                    setPostSlug(e.target.value);
                  }}
                  disabled={isEditing}
                  placeholder="my-post-slug"
                />
              </Field>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Field label="分类" className="flex-1">
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="如: 技术"
                />
              </Field>
              <Field label="标签 (逗号分隔)" className="flex-1">
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="如: 教程, React"
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div className="flex items-center gap-3">
                <Label className="normal-case tracking-normal">状态</Label>
                <Toggle
                  checked={!draft}
                  onChange={(v) => setDraft(!v)}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {draft ? "草稿" : "发布"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={pinned} onChange={setPinned} />
                <Label className="normal-case tracking-normal">置顶</Label>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={comment} onChange={setComment} />
                <Label className="normal-case tracking-normal">评论</Label>
              </div>
            </div>
          </Card>

          {/* 高级选项 */}
          <Card className="overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors duration-75 hover:bg-card-hover"
            >
              {advancedOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                高级选项
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                {advancedCount} 项已设置
              </span>
            </button>
            {advancedOpen && (
              <div className="grid grid-cols-1 gap-4 border-t border-border p-5 sm:grid-cols-2">
                <Field label="语言代码">
                  <Input value={lang} onChange={(e) => setLang(e.target.value)} placeholder="如: zh-CN" />
                </Field>
                <Field label="作者">
                  <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Admin" />
                </Field>
                <Field label="许可证名称">
                  <Input value={licenseName} onChange={(e) => setLicenseName(e.target.value)} placeholder="如: CC BY 4.0" />
                </Field>
                <Field label="许可证链接">
                  <Input value={licenseUrl} onChange={(e) => setLicenseUrl(e.target.value)} placeholder="https://creativecommons.org/..." />
                </Field>
                <Field label="来源链接" className="sm:col-span-2">
                  <Input value={sourceLink} onChange={(e) => setSourceLink(e.target.value)} placeholder="https://..." />
                </Field>
                <Field label="文章密码">
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="留空则不加密" />
                </Field>
                <Field label="密码提示">
                  <Input value={passwordHint} onChange={(e) => setPasswordHint(e.target.value)} placeholder="如: 我的生日" />
                </Field>
              </div>
            )}
          </Card>

          {/* 编辑器 */}
          <Card
            className="overflow-hidden"
          >
            <div
              className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/50 p-1.5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              {toolbar().map((b) => (
                <button
                  key={b.title}
                  type="button"
                  title={b.title}
                  onClick={b.onClick}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-card-hover hover:text-foreground"
                >
                  {b.icon}
                </button>
              ))}
              <div className="mx-1.5 h-5 w-px bg-border" />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                title="切换视图"
                onClick={() => {
                  const idx = modes.indexOf(viewMode);
                  setViewMode(modes[(idx + 1) % modes.length]);
                }}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-card-hover hover:text-foreground"
              >
                {viewIcon}
              </button>
              <span className="ml-auto pr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {viewMode === "split" ? "split" : viewMode === "edit" ? "编辑" : "预览"}
              </span>
            </div>

            <div
              className={
                viewMode === "split"
                  ? "grid min-h-[480px] grid-cols-1 md:grid-cols-2"
                  : "grid min-h-[480px] grid-cols-1"
              }
            >
              {viewMode !== "preview" && (
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="在此输入 Markdown 内容..."
                  spellCheck
                  className="h-96 min-h-[480px] w-full resize-y border-0 bg-transparent p-4 font-mono text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground/40 md:h-auto"
                />
              )}
              {viewMode !== "edit" && (
                <div
                  className={
                    "min-h-[480px] overflow-y-auto border-t border-border p-4 md:border-l md:border-t-0"
                  }
                >
                  <div
                    className="prose-admin"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </div>

            {uploadProgress !== null && (
              <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-4 py-2.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full bg-foreground transition-[width] duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  上传中 {uploadProgress}%
                </span>
              </div>
            )}
          </Card>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? "保存中..." : isEditing ? "更新文章" : "发布文章"}
            </Button>
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              返回列表
            </Button>
            {isEditing && (
              <Button variant="danger" onClick={handleDelete} className="ml-auto">
                <Trash2 className="h-3.5 w-3.5" />
                删除文章
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
