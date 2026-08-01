import { useMemo } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { postsApi, type PostMeta } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate, getCats } from "../lib/utils";
import { useToast } from "../lib/toast";
import { Badge, Button, EmptyState, PageHeader } from "./ui";

interface Props {
  searchQuery: string;
  posts: PostMeta[] | null;
  loading: boolean;
  onEdit: (slug: string) => void;
  onNew: () => void;
  onDeleted: (slug: string) => void;
}

export default function PostList({
  searchQuery,
  posts,
  loading,
  onEdit,
  onNew,
  onDeleted,
}: Props) {
  const toast = useToast();
  const { requireLogin } = useAuth();

  const filtered = useMemo(() => {
    const list = posts ?? [];
    const q = searchQuery.toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [posts, searchQuery]);

  function handleDelete(slug: string) {
    if (!confirm(`确定要删除文章 "${slug}" 吗？`)) return;
    requireLogin(() => {
      void (async () => {
        try {
          await postsApi.delete(slug);
          toast("文章已删除");
          onDeleted(slug);
        } catch (err: unknown) {
          toast(err instanceof Error ? err.message : "删除失败", "error");
        }
      })();
    });
  }

  return (
    <div>
      <PageHeader title="文章列表" count={posts?.length ?? 0}>
        <Button onClick={onNew}>
          <Plus className="h-3.5 w-3.5" />
          新建文章
        </Button>
      </PageHeader>

      {loading ? (
        <EmptyState text="加载中..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-12 w-12" />}
          text={(posts?.length ?? 0) === 0 ? "暂无文章" : "没有匹配的文章"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((post) => (
            <div
              key={post.slug}
              role="button"
              tabIndex={0}
              onClick={() => onEdit(post.slug)}
              onKeyDown={(e) => e.key === "Enter" && onEdit(post.slug)}
              className="group cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors duration-75 hover:border-foreground/50"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <h3 className="truncate text-sm font-semibold group-hover:text-foreground">
                    {post.title || post.slug}
                  </h3>
                  <div className="flex shrink-0 gap-1.5">
                    {post.draft && <Badge>草稿</Badge>}
                    {post.pinned && <Badge variant="accent">置顶</Badge>}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDate(post.published)}
                </span>
              </div>

              {(post.category || post.tags?.length) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {getCats(post.category).map((cat) => (
                    <span
                      key={cat}
                      className="rounded-full border border-foreground/30 px-2 py-px font-mono text-[10px] text-foreground"
                    >
                      {cat}
                    </span>
                  ))}
                  {post.tags
                    ?.filter(
                      (t) =>
                        !getCats(post.category)
                          .map((c) => c.toLowerCase())
                          .includes(t.toLowerCase()),
                    )
                    .slice(0, 6)
                    .map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border px-2 py-px font-mono text-[10px] text-muted-foreground"
                      >
                        #{tag}
                      </span>
                    ))}
                </div>
              )}

              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(post.slug);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(post.slug);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
