import { useState } from "react";
import { ArrowRight, ChartNoAxesCombined, Loader2 } from "lucide-react";
import { api } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export default function LoginView({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(username.trim(), password);
      await onLoggedIn();
    } catch (e) {
      setError(e.status === 401 ? "账号或密码不正确" : e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-lg bg-primary p-2 text-primary-foreground">
            <ChartNoAxesCombined className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">
            我的基金
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              / Portfolio
            </span>
          </span>
        </div>
        <div className="panel p-7">
          <h1 className="text-2xl font-semibold tracking-tight">欢迎回来</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            登录后，查看你的资产与持仓。
          </p>
          <form onSubmit={submit} className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">账号</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}登录
              <ArrowRight className="ml-auto" />
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          你的持仓，你的长期视角。
        </p>
      </div>
    </main>
  );
}
