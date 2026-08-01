import { useEffect, useState } from "react";
import { Github, ShieldCheck, X } from "lucide-react";
import { githubLoginUrl } from "../lib/api";
import { Button, Message } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  /** OAuth 回调返回的错误 key, 在打开弹窗时显示 */
  initialError?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_params: "登录请求参数不完整，请重试",
  invalid_state: "登录状态已失效，请重新发起登录",
  not_authorized: "该 GitHub 账号无权访问管理后台",
  bad_code: "GitHub 授权失败，请重试",
  github_api: "GitHub 服务异常，请稍后重试",
  network_error: "网络异常，请稍后重试",
};

export default function LoginModal({ open, onClose, initialError }: Props) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setError(
        initialError ? (ERROR_MESSAGES[initialError] ?? "登录失败，请重试") : "",
      );
      setLoading(false);
    }
  }, [open, initialError]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleGithubLogin() {
    setError("");
    setLoading(true);
    window.location.href = githubLoginUrl();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm animate-[toast-in_0.2s_ease-out] rounded-lg border border-border bg-card p-6 shadow-lg">
        <button
          type="button"
          onClick={onClose}
          title="关闭"
          className="absolute right-3 top-3 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-card-hover hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-6 flex flex-col items-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted/50">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="text-center">
            <h2 className="text-base font-bold tracking-tight">登录</h2>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              使用 GitHub 账号登录后即可进行保存 / 上传等操作
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4">
            <Message type="error">{error}</Message>
          </div>
        )}

        <Button
          type="button"
          onClick={handleGithubLogin}
          disabled={loading}
          className="w-full"
        >
          <Github className="h-4 w-4" />
          {loading ? "正在跳转 GitHub..." : "使用 GitHub 登录"}
        </Button>

        <div className="mt-4 flex items-center justify-center gap-1.5 pt-1 font-mono text-[10px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" />
          <span>仅允许授权账号 · oauth</span>
        </div>
      </div>
    </div>
  );
}
