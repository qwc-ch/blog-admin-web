import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Images,
  LogOut,
  Menu,
  Pencil,
  Search,
  Settings,
  X,
} from "lucide-react";
import { clearAuth, isAuthenticated, postsApi, type PostMeta } from "./lib/api";
import { cn } from "./lib/utils";
import { BackToTop, toHash, useHashRoute, type View } from "./lib/router";
import { useToast } from "./lib/toast";
import ConfigEditor from "./components/ConfigEditor";
import ImageManager from "./components/ImageManager";
import Login from "./components/Login";
import PostList from "./components/PostList";

const PostEditor = lazy(() => import("./components/PostEditor"));

const BLOG_URL = "https://blog.amamo.top";

const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "list", label: "文章管理", icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "editor", label: "写文章", icon: <Pencil className="h-3.5 w-3.5" /> },
  { id: "images", label: "图片管理", icon: <Images className="h-3.5 w-3.5" /> },
  { id: "config", label: "站点配置", icon: <Settings className="h-3.5 w-3.5" /> },
];

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isAuthenticated());
  const route = useHashRoute();
  const view = route.view;
  const editingSlug = route.view === "editor" ? (route.slug ?? null) : null;
  const [searchQuery, setSearchQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [posts, setPosts] = useState<PostMeta[] | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const toast = useToast();
  const pendingRestoreRef = useRef(0);
  const scrollPositionsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    // 视图切换完成后恢复滚动位置 (DOM 已更新, scroll 不会被 clamp)
    if (pendingRestoreRef.current > 0) {
      window.scrollTo(0, pendingRestoreRef.current);
    }
    pendingRestoreRef.current = 0;
  }, [view]);

  const loadPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      setPosts(await postsApi.list());
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    } finally {
      setPostsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (loggedIn && posts === null) loadPosts();
  }, [loggedIn, posts, loadPosts]);

  function navigate(next: View, slug?: string) {
    const prev = view;
    if (prev !== next) {
      // 记住离开视图的滚动位置
      scrollPositionsRef.current[prev] = window.scrollY;
      if (next === "editor") {
        // 编辑器始终从顶部开始
        pendingRestoreRef.current = 0;
        window.scrollTo(0, 0);
      } else if (scrollPositionsRef.current[next] !== undefined) {
        // 返回之前的视图: 标记待恢复 (切完视图再滚)
        pendingRestoreRef.current = scrollPositionsRef.current[next];
      } else {
        pendingRestoreRef.current = 0;
        window.scrollTo(0, 0);
      }
    }
    window.location.hash = toHash({ view: next, slug });
    setMenuOpen(false);
  }

  function handleLogout() {
    clearAuth();
    setPosts(null);
    setLoggedIn(false);
  }

  /** 保存/更新文章: 前端本地更新列表, 不重新请求 */
  function handlePostSaved(meta: PostMeta | null) {
    if (meta) {
      setPosts((prev) => {
        if (!prev) return [meta];
        const exists = prev.some((p) => p.slug === meta.slug);
        return exists
          ? prev.map((p) => (p.slug === meta.slug ? meta : p))
          : [meta, ...prev];
      });
    } else {
      // 编辑器内删除文章
      setPosts((prev) => (prev ? prev.filter((p) => p.slug !== editingSlug) : prev));
    }
    navigate("list");
  }

  /** 列表页删除文章: 前端本地移除, 不重新请求 */
  function handlePostDeleted(slug: string) {
    setPosts((prev) => (prev ? prev.filter((p) => p.slug !== slug) : prev));
  }

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  const navItem = (item: (typeof NAV)[number], isMobile = false) => {
    const active =
      item.id === "list"
        ? view === "list"
        : item.id === "editor"
          ? view === "editor"
          : view === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => navigate(item.id)}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 font-mono text-sm transition-colors duration-75",
          isMobile && "w-full px-4 py-2.5",
          active
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
        )}
      >
        {item.icon}
        {item.label}
      </button>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <a
            href={BLOG_URL}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-2.5 font-mono"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-foreground/30 text-[10px] font-bold">
              F
            </span>
            <span className="text-sm font-bold tracking-tight">Firefly Admin</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => navItem(item))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {view === "list" && (
              <div className="relative hidden items-center md:flex">
                <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索文章..."
                  className="h-8 w-40 rounded-md border border-border bg-card pl-8 pr-2 text-sm text-foreground outline-none transition-all duration-75 placeholder:text-muted-foreground/60 focus:w-56 focus:border-foreground/60"
                />
              </div>
            )}
            <a
              href={BLOG_URL}
              target="_blank"
              rel="noreferrer"
              title="返回首页"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-card-hover hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={handleLogout}
              title="退出登录"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-card-hover hover:text-accent"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-card-hover hover:text-foreground md:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile search */}
        {view === "list" && (
          <div className="border-t border-border/60 px-4 py-2 md:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索文章..."
                className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/60"
              />
            </div>
          </div>
        )}
      </header>

      {/* Mobile nav drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
          />
          <nav className="absolute right-0 top-0 flex h-full w-64 flex-col gap-1 border-l border-border bg-card p-3 pt-16">
            {NAV.map((item) => navItem(item, true))}
            <div className="my-2 h-px bg-border" />
            <a
              href={BLOG_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md px-4 py-2.5 font-mono text-sm text-muted-foreground transition-colors duration-75 hover:bg-card-hover hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              返回首页
            </a>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-4 py-2.5 font-mono text-sm text-accent transition-colors duration-75 hover:bg-accent hover:text-background"
            >
              <LogOut className="h-3.5 w-3.5" />
              退出登录
            </button>
          </nav>
        </div>
      )}

      {/* Content: 视图常驻挂载, 列表数据由 App 本地维护, 操作后前端直接更新, 不重新请求 */}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8">
          <div className={view === "list" ? "" : "hidden"}>
            <PostList
              searchQuery={searchQuery}
              posts={posts}
              loading={postsLoading}
              onEdit={(slug) => navigate("editor", slug)}
              onNew={() => navigate("editor")}
              onDeleted={handlePostDeleted}
            />
          </div>
          <div className={view === "editor" ? "" : "hidden"}>
            <Suspense
              fallback={
                <div className="py-24 text-center text-sm text-muted-foreground">
                  加载编辑器...
                </div>
              }
            >
              <PostEditor
                key={editingSlug ?? "new"}
                slug={editingSlug}
                onBack={() => navigate("list")}
                onSaved={handlePostSaved}
              />
            </Suspense>
          </div>
          <div className={view === "images" ? "" : "hidden"}>
            <ImageManager />
          </div>
          <div className={view === "config" ? "" : "hidden"}>
            <ConfigEditor />
          </div>
        </div>
      </main>

      <BackToTop />
    </div>
  );
}
