import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, Terminal, X } from "lucide-react";
import { login } from "../lib/api";
import { Button, Input, Label, Message } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  onLogin: () => void;
}

export default function LoginModal({ open, onClose, onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setError("");
      setPassword("");
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      onLogin();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "连接失败，请检查网络");
      setLoading(false);
    }
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
              登录后即可进行保存 / 上传等操作
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">username</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              autoComplete="current-password"
              required
            />
          </div>

          {error && <Message type="error">{error}</Message>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "登录中..." : "登录"}
          </Button>

          <div className="flex items-center justify-center gap-1.5 pt-1 font-mono text-[10px] text-muted-foreground">
            <Terminal className="h-3 w-3" />
            <span>basic auth · bearer token</span>
          </div>
        </form>
      </div>
    </div>
  );
}
