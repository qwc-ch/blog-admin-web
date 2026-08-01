import { useEffect, useRef, useState } from "react";
import { Copy, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { imagesApi, type ImageItem } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatSize } from "../lib/utils";
import { useToast } from "../lib/toast";
import { Button, EmptyState, PageHeader } from "./ui";

export default function ImageManager() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<File[]>([]);
  const toast = useToast();
  const { requireLogin } = useAuth();

  useEffect(() => {
    loadImages();
  }, []);

  async function loadImages() {
    setLoading(true);
    try {
      setImages(await imagesApi.list());
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    pendingFilesRef.current = files;
    requireLogin(() => {
      void doUpload();
    });
  }

  async function doUpload() {
    const files = pendingFilesRef.current;
    if (!files.length) return;
    setUploading(true);
    let success = 0;
    let failed = 0;
    for (const file of files) {
      try {
        await imagesApi.upload(file);
        success++;
      } catch {
        failed++;
      }
    }
    setUploading(false);
    toast(
      failed > 0
        ? `上传完成: ${success} 成功, ${failed} 失败`
        : `成功上传 ${success} 张图片`,
      failed > 0 ? "error" : "success",
    );
    await loadImages();
  }

  function handleDelete(key: string) {
    if (!confirm(`确定要删除图片 "${key}" 吗？`)) return;
    requireLogin(() => {
      void (async () => {
        try {
          await imagesApi.delete(key);
          toast("图片已删除");
          await loadImages();
        } catch (err: unknown) {
          toast(err instanceof Error ? err.message : "删除失败", "error");
        }
      })();
    });
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    toast("链接已复制");
  }

  return (
    <div>
      <PageHeader title="图片管理" count={images.length}>
        <Button
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {uploading ? "上传中..." : "上传图片"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </PageHeader>

      {loading ? (
        <EmptyState text="加载中..." />
      ) : images.length === 0 ? (
        <EmptyState
          icon={<ImageIcon className="h-12 w-12" />}
          text="暂无图片，点击上方按钮上传"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {images.map((img) => (
            <div
              key={img.key}
              className="group overflow-hidden rounded-lg border border-border bg-card transition-colors duration-75 hover:border-foreground/50"
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img
                  src={img.url}
                  alt={img.key}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity duration-75 group-hover:opacity-100">
                  <button
                    type="button"
                    title="复制链接"
                    onClick={() => copyUrl(img.url)}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground transition-colors duration-75 hover:bg-accent"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={() => handleDelete(img.key)}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground transition-colors duration-75 hover:bg-accent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="px-2.5 py-2">
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={img.key}
                >
                  {img.key.split("/").pop()}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                  {formatSize(img.size)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
