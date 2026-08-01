import { useState, type FormEvent } from "react";
import { ShieldCheck, Terminal } from "lucide-react";
import { login } from "../lib/api";
import { Button, Input, Label, Message } from "./ui";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold tracking-tight">Firefly Admin</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            blog administration console
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
      >
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
          {loading ? "登录中..." : "登录系统"}
        </Button>

        <div className="flex items-center justify-center gap-1.5 pt-1 font-mono text-[10px] text-muted-foreground">
          <Terminal className="h-3 w-3" />
          <span>basic auth · bearer token</span>
        </div>
      </form>
    </div>
  );
}
