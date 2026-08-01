import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { friendsConfigApi, siteConfigApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/utils";
import { useToast } from "../lib/toast";
import { Button, Card, Field, Input, PageHeader, Select, Textarea, Toggle } from "./ui";

interface Friend {
  title?: string;
  imgurl?: string;
  desc?: string;
  siteurl?: string;
  rss?: string;
  tags?: string[];
  weight?: number;
  enabled?: boolean;
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  const clone: Record<string, unknown> = { ...obj };
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/* 模块级组件: 组件类型稳定, 避免重渲染时整个表单子树被卸载重建
   (重建会让浏览器滚动锚定失效, 展开 Section 时页面回顶) */

function Section({
  id,
  title,
  count,
  children,
  isOpen,
  onToggle,
}: {
  id: string;
  title: string;
  count?: React.ReactNode;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3.5 text-left transition-colors duration-75 hover:bg-card-hover"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-foreground/80" />
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {count !== undefined && (
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {count}
          </span>
        )}
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="flex flex-col gap-4 border-t border-border p-5">
          {children}
        </div>
      )}
    </Card>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-foreground">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function RadioRow<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-center gap-2 font-mono text-xs text-muted-foreground"
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="h-3.5 w-3.5 accent-foreground"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

export default function ConfigEditor() {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsPage, setFriendsPage] = useState<Record<string, unknown>>({});
  const [sha, setSha] = useState("");
  const [friendsSha, setFriendsSha] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set(["main"]));
  const toast = useToast();
  const { requireLogin, loggedIn } = useAuth();

  useEffect(() => {
    if (!loggedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      siteConfigApi.get(),
      friendsConfigApi.get().catch(() => ({
        friends: [] as unknown[],
        friendsPage: {},
        sha: "",
      })),
    ])
      .then(([siteRes, friendsRes]) => {
        setConfig(siteRes.config || {});
        setFriends((friendsRes.friends as Friend[]) || []);
        setFriendsPage(friendsRes.friendsPage || {});
        setSha(siteRes.sha);
        setFriendsSha(friendsRes.sha);
      })
      .catch((err: unknown) => {
        toast(err instanceof Error ? err.message : "加载失败", "error");
      })
      .finally(() => setLoading(false));
  }, [toast, loggedIn]);

  const toggleSection = (id: string) => {
    const y = window.scrollY;
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // 展开/折叠会改变文档高度, 防止浏览器滚动锚定把视口拉回顶部
    requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    });
  };

  const set = (path: string, value: unknown) =>
    setConfig((c) => setNested(c, path, value));

  const get = (path: string) => getNested(config, path);

  const bool = (path: string, fallback = false) => Boolean(get(path) ?? fallback);
  const num = (path: string, fallback: number) => {
    const v = get(path);
    return typeof v === "number" ? v : fallback;
  };
  const str = (path: string, fallback = "") => String(get(path) ?? fallback);

  const themeHue = num("themeColor.hue", 330);

  function handleSave() {
    requireLogin(() => {
      void doSave();
    });
  }

  async function doSave() {
    setSaving(true);
    try {
      const { friends: _f, friendsPage: _fp, ...siteConfigData } = config;
      await Promise.all([
        siteConfigApi.save(siteConfigData, sha, "Update site config via admin"),
        friendsConfigApi.save(
          friends,
          friendsPage,
          friendsSha,
          "Update friends config via admin",
        ),
      ]);
      const [siteRes, friendsRes] = await Promise.all([
        siteConfigApi.get(),
        friendsConfigApi.get(),
      ]);
      setSha(siteRes.sha);
      setFriendsSha(friendsRes.sha);
      toast("配置已保存并提交到 GitHub");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "保存失败", "error");
      try {
        const [siteRes, friendsRes] = await Promise.all([
          siteConfigApi.get(),
          friendsConfigApi.get(),
        ]);
        setSha(siteRes.sha);
        setFriendsSha(friendsRes.sha);
      } catch {
        /* ignore refresh errors */
      }
    } finally {
      setSaving(false);
    }
  }

  function updateFriend(index: number, patch: Partial<Friend>) {
    setFriends((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }

  const pageToggles: [string, string][] = [
    ["friends", "友链"],
    ["sponsor", "打赏"],
    ["guestbook", "留言板"],
    ["bangumi", "番组计划"],
    ["gallery", "相册"],
    ["anime", "追番"],
  ];

  const friendsCount = useMemo(() => friends.length, [friends]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="站点配置">
        <Button onClick={handleSave} disabled={saving || loading}>
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中..." : "保存到 GitHub"}
        </Button>
      </PageHeader>

      {loading ? (
        <div className="py-24 text-center text-sm text-muted-foreground">
          加载配置中...
        </div>
      ) : (
        <div className="space-y-2">
          <Section id="main" title="主要设置" isOpen={open.has("main")} onToggle={toggleSection}>
            <Field label="站点标题">
              <Input value={str("title")} onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field label="副标题">
              <Input value={str("subtitle")} onChange={(e) => set("subtitle", e.target.value)} />
            </Field>
            <Field label="站点 URL">
              <Input value={str("site_url")} onChange={(e) => set("site_url", e.target.value)} />
            </Field>
            <Field label="站点描述">
              <Textarea
                rows={2}
                value={str("description")}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="站点语言">
                <Select
                  value={str("lang")}
                  onChange={(e) => set("lang", e.target.value)}
                >
                  <option value="">未设置</option>
                  {["zh_CN", "zh_TW", "en", "ja", "ru"].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="时区">
                <Input value={str("timezone")} onChange={(e) => set("timezone", e.target.value)} placeholder="如: Asia/Shanghai" />
              </Field>
            </div>
            <Field label="站点开始日期">
              <Input
                type="date"
                value={str("siteStartDate")}
                onChange={(e) => set("siteStartDate", e.target.value)}
              />
            </Field>
          </Section>

          <Section id="theme" title="主题色" isOpen={open.has("theme")} onToggle={toggleSection}>
            <Field label="色相值 (0-360)">
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={themeHue}
                  onChange={(e) => set("themeColor.hue", Number(e.target.value))}
                  className="flex-1 accent-foreground"
                />
                <span className="w-10 text-center font-mono text-sm text-foreground">
                  {themeHue}
                </span>
                <span
                  className="h-6 w-6 shrink-0 rounded-md border border-border"
                  style={{
                    background: `oklch(0.70 0.14 ${themeHue})`,
                  }}
                />
              </div>
            </Field>
            <Field label="默认模式">
              <RadioRow
                name="defaultMode"
                value={str("themeColor.defaultMode", "system") as "light" | "dark" | "system"}
                options={[
                  { value: "light", label: "亮色" },
                  { value: "dark", label: "暗色" },
                  { value: "system", label: "跟随系统" },
                ]}
                onChange={(v) => set("themeColor.defaultMode", v)}
              />
            </Field>
            <ToggleField
              label="固定主题色（隐藏选择器）"
              checked={bool("themeColor.fixed")}
              onChange={(v) => set("themeColor.fixed", v)}
            />
          </Section>

          <Section id="navbar" title="导航栏" isOpen={open.has("navbar")} onToggle={toggleSection}>
            <Field label="导航栏标题">
              <Input value={str("navbar.title")} onChange={(e) => set("navbar.title", e.target.value)} />
            </Field>
            <Field label="菜单对齐">
              <RadioRow
                name="menuAlign"
                value={str("navbar.menuAlign", "left") as "left" | "center"}
                options={[
                  { value: "left", label: "左对齐" },
                  { value: "center", label: "居中" },
                ]}
                onChange={(v) => set("navbar.menuAlign", v)}
              />
            </Field>
            <ToggleField
              label="固定导航栏"
              checked={bool("navbar.stickyNavbar", true)}
              onChange={(v) => set("navbar.stickyNavbar", v)}
            />
            <ToggleField
              label="全宽导航栏"
              checked={bool("navbar.widthFull")}
              onChange={(v) => set("navbar.widthFull", v)}
            />
          </Section>

          <Section id="card" title="卡片样式" isOpen={open.has("card")} onToggle={toggleSection}>
            <ToggleField
              label="卡片边框"
              checked={bool("card.border", true)}
              onChange={(v) => set("card.border", v)}
            />
            <ToggleField
              label="跟随主题色"
              checked={bool("card.followTheme", true)}
              onChange={(v) => set("card.followTheme", v)}
            />
            <Field label="页面宽度 (rem)">
              <Input
                type="number"
                value={num("pageWidth", 100)}
                onChange={(e) => set("pageWidth", Number(e.target.value))}
              />
            </Field>
          </Section>

          <Section id="pages" title="页面开关" isOpen={open.has("pages")} onToggle={toggleSection}>
            {pageToggles.map(([key, label]) => (
              <ToggleField
                key={key}
                label={label}
                checked={bool(`pages.${key}`, true)}
                onChange={(v) => set(`pages.${key}`, v)}
              />
            ))}
          </Section>

          <Section id="pagination" title="分页" isOpen={open.has("pagination")} onToggle={toggleSection}>
            <Field label="每页文章数">
              <Input
                type="number"
                min={1}
                max={50}
                value={num("pagination.postsPerPage", 10)}
                onChange={(e) => set("pagination.postsPerPage", Number(e.target.value))}
              />
            </Field>
          </Section>

          <Section id="bangumi" title="番组计划" isOpen={open.has("bangumi")} onToggle={toggleSection}>
            <Field label="用户 ID">
              <Input value={str("bangumi.userId")} onChange={(e) => set("bangumi.userId", e.target.value)} />
            </Field>
            <Field label="数据模式">
              <RadioRow
                name="bangumiMode"
                value={str("bangumi.mode", "static") as "static" | "dynamic"}
                options={[
                  { value: "static", label: "构建时" },
                  { value: "dynamic", label: "实时获取" },
                ]}
                onChange={(v) => set("bangumi.mode", v)}
              />
            </Field>
          </Section>

          <Section id="anime" title="Bilibili 追番" isOpen={open.has("anime")} onToggle={toggleSection}>
            <Field label="Bilibili UID">
              <Input value={str("anime.bilibili.uid")} onChange={(e) => set("anime.bilibili.uid", e.target.value)} />
            </Field>
          </Section>

          <Section id="friends" title="友链管理" count={`${friendsCount} 个友链`} isOpen={open.has("friends")} onToggle={toggleSection}>
            {friends.map((friend, i) => (
              <div
                key={i}
                className={cn(
                  "overflow-hidden rounded-lg border border-border bg-muted/40",
                  !friend.enabled && "opacity-50",
                )}
              >
                <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
                  <img
                    src={friend.imgurl || ""}
                    alt={friend.title || ""}
                    className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {friend.title || "(未命名)"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {friend.desc || "—"}
                    </p>
                  </div>
                  <Toggle
                    checked={!!friend.enabled}
                    onChange={(v) => updateFriend(i, { enabled: v })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                  <Field label="标题">
                    <Input value={friend.title || ""} onChange={(e) => updateFriend(i, { title: e.target.value })} />
                  </Field>
                  <Field label="权重">
                    <Input
                      type="number"
                      value={friend.weight ?? 10}
                      onChange={(e) => updateFriend(i, { weight: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="头像 URL" className="sm:col-span-2">
                    <Input value={friend.imgurl || ""} onChange={(e) => updateFriend(i, { imgurl: e.target.value })} />
                  </Field>
                  <Field label="站点 URL" className="sm:col-span-2">
                    <Input value={friend.siteurl || ""} onChange={(e) => updateFriend(i, { siteurl: e.target.value })} />
                  </Field>
                  <Field label="RSS 订阅">
                    <Input value={friend.rss || ""} onChange={(e) => updateFriend(i, { rss: e.target.value })} />
                  </Field>
                  <Field label="描述">
                    <Input value={friend.desc || ""} onChange={(e) => updateFriend(i, { desc: e.target.value })} />
                  </Field>
                  <Field label="标签（逗号分隔）" className="sm:col-span-2">
                    <Input
                      value={(friend.tags || []).join(", ")}
                      onChange={(e) =>
                        updateFriend(i, {
                          tags: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="flex justify-end border-t border-border px-3 py-2">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setFriends((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex justify-center py-1">
              <Button
                variant="outline"
                onClick={() =>
                  setFriends((prev) => [
                    ...prev,
                    { title: "", imgurl: "", desc: "", siteurl: "", rss: "", tags: [], weight: 10, enabled: true },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                添加友链
              </Button>
            </div>

            <div className="space-y-4 border-t border-border pt-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                友链页面配置
              </p>
              <Field label="页面标题（留空使用默认）">
                <Input
                  value={str2(friendsPage, "title")}
                  onChange={(e) => setFriendsPage((p) => ({ ...p, title: e.target.value }))}
                />
              </Field>
              <Field label="页面描述（留空使用默认）">
                <Input
                  value={str2(friendsPage, "description")}
                  onChange={(e) => setFriendsPage((p) => ({ ...p, description: e.target.value }))}
                />
              </Field>
              <ToggleField
                label="显示自定义内容"
                checked={bool2(friendsPage, "showCustomContent", true)}
                onChange={(v) => setFriendsPage((p) => ({ ...p, showCustomContent: v }))}
              />
              <ToggleField
                label="显示评论区"
                checked={bool2(friendsPage, "showComment", true)}
                onChange={(v) => setFriendsPage((p) => ({ ...p, showComment: v }))}
              />
              <ToggleField
                label="随机排序（忽略权重）"
                checked={bool2(friendsPage, "randomizeSort", false)}
                onChange={(v) => setFriendsPage((p) => ({ ...p, randomizeSort: v }))}
              />
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function str2(obj: Record<string, unknown>, key: string, fallback = "") {
  return String(obj[key] ?? fallback);
}
function bool2(obj: Record<string, unknown>, key: string, fallback: boolean) {
  return Boolean(obj[key] ?? fallback);
}
