import { lazy, Suspense, useMemo, useState } from "react";
import {
  ChartNoAxesCombined,
  CircleAlert,
  LogOut,
  RefreshCw,
  Settings2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { computePortfolio, money, signed, today, trendClass } from "./calc";
import { usePortfolio } from "./usePortfolio";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Switch } from "./components/ui/switch";
import { Label } from "./components/ui/label";
import { Toaster } from "./components/ui/sonner";
import HoldingsView from "./components/HoldingsView";
import LoginView from "./components/LoginView";
import SettingsDialog from "./components/SettingsDialog";
import { PageSkeleton } from "./components/shared";
const PerformanceView = lazy(() => import("./components/PerformanceView"));
const AllocationView = lazy(() => import("./components/AllocationView"));
const ImportView = lazy(() => import("./components/ImportView"));
const VIEWS = {
  holdings: HoldingsView,
  performance: PerformanceView,
  allocation: AllocationView,
  import: ImportView,
};
const PAGES = [
  ["holdings", "持仓概览"],
  ["performance", "收益统计"],
  ["allocation", "资产配置"],
  ["import", "导入 / 导出"],
];
const DESCRIPTIONS = {
  holdings: "集中查看持仓、收益与各账户的资产分布。",
  performance: "用历史净值，回看当前持仓的表现。",
  allocation: "了解资产分布，让持仓回到你的目标配置。",
  import: "同步账户持仓，管理数据备份。",
};

export default function App() {
  const state = usePortfolio();
  const { portfolio, quoteMap, status, indices, mairui } = state;
  const [tab, setTab] = useState("holdings"),
    [visited, setVisited] = useState(["holdings"]),
    [settings, setSettings] = useState(false);
  function navigate(id) {
    setTab(id);
    setVisited((pages) => (pages.includes(id) ? pages : [...pages, id]));
  }
  const result = useMemo(
    () => (portfolio ? computePortfolio(portfolio, quoteMap) : null),
    [portfolio, quoteMap],
  );
  const rows = result?.groups.flatMap((g) => g.rows) || [];
  const available = rows.filter((r) => r.priceDate);
  const estimated = available.filter((r) => r.estimated).length;
  const published = available.filter(
    (r) => !r.estimated && r.priceDate === today(),
  ).length;
  const mainDate = [...new Set(available.map((r) => r.priceDate.slice(0, 10)))]
    .sort()
    .reverse();
  const title = PAGES.find(([id]) => id === tab)[1];
  async function save(next, message) {
    await state.save(next);
    if (message) toast.success(message);
  }
  const toaster = (
    <Toaster theme="light" richColors closeButton position="bottom-right" />
  );
  if (status === "login")
    return (
      <>
        <LoginView onLoggedIn={state.load} />
        {toaster}
      </>
    );
  return (
    <>
      <a
        className="sr-only z-50 rounded bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main"
      >
        跳转到主要内容
      </a>
      <header className="border-b bg-card">
        <div className="page-width flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
          <a href="#main" className="flex items-center gap-2.5">
            <span className="rounded-lg bg-primary p-1.5 text-primary-foreground">
              <ChartNoAxesCombined className="size-5" />
            </span>
            <span className="font-semibold tracking-tight">我的基金</span>
            <span className="ml-1 hidden border-l pl-3 text-xs text-muted-foreground sm:inline">
              Personal portfolio
            </span>
          </a>
          <div className="flex items-center gap-1">
            <Badge
              variant="outline"
              className="mr-2 hidden font-normal text-muted-foreground sm:inline-flex"
            >
              {today().replaceAll("-", " / ")}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="行情设置"
              disabled={!portfolio}
              onClick={() => setSettings(true)}
            >
              <Settings2 />
            </Button>
            {state.authRequired && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="退出登录"
                onClick={state.logout}
              >
                <LogOut />
              </Button>
            )}
          </div>
        </div>
        <nav
          aria-label="主要导航"
          className="page-width flex gap-6 overflow-x-auto"
        >
          {PAGES.map(([id, label]) => (
            <button
              key={id}
              aria-current={id === tab ? "page" : undefined}
              onClick={() => navigate(id)}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-sm transition-colors ${id === tab ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main id="main" className="page-width pb-12 pt-7 sm:pt-9">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {DESCRIPTIONS[tab]}
            </p>
          </div>
          {portfolio && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-refresh"
                  checked={state.autoRefresh}
                  onCheckedChange={state.setAutoRefresh}
                />
                <Label
                  htmlFor="auto-refresh"
                  className="text-xs text-muted-foreground"
                >
                  自动刷新
                </Label>
              </div>
              <Button
                variant="outline"
                className="bg-card"
                aria-label="刷新行情"
                disabled={state.loading}
                onClick={() => state.refresh()}
              >
                <RefreshCw className={state.loading ? "animate-spin" : ""} />
                <span className="hidden sm:inline">刷新行情</span>
              </Button>
            </div>
          )}
        </div>
        {state.error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{state.error}</span>
            {status === "error" && (
              <Button size="sm" variant="outline" onClick={state.load}>
                重试
              </Button>
            )}
          </div>
        )}
        {!result || status === "loading" ? (
          status !== "error" && <PageSkeleton />
        ) : (
          <>
            <div
              className={`mb-5 grid gap-4 ${result.holdGain == null ? "md:grid-cols-[1.15fr_1fr_1fr]" : "md:grid-cols-2 xl:grid-cols-4"}`}
            >
              <section className="panel p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    总资产 / CNY
                  </span>
                  <Wallet className="size-4 text-muted-foreground" />
                </div>
                <div className="amount mt-4 text-3xl font-medium sm:text-[34px]">
                  {available.length ? money(result.total) : "--"}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {result.groups.length} 个分组
                  <span className="mx-2 text-border">/</span>
                  {rows.length} 条持仓记录
                </p>
              </section>
              <section className="panel p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {estimated ? "估算与最新净值收益" : "最新净值日收益"}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    {estimated ? "含盘中估值" : "正式净值"}
                  </Badge>
                </div>
                <div
                  className={`amount mt-4 text-3xl font-medium ${trendClass(result.dayGain)}`}
                >
                  {available.length ? signed(result.dayGain) : "--"}
                  <span className="ml-2 text-sm">
                    {available.length ? `${signed(result.dayPct)}%` : ""}
                  </span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {estimated} 条估值 · {available.length - estimated} 条正式净值
                </p>
              </section>
              <section className="panel p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    今日正式净值更新
                  </span>
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                </div>
                <div className="amount mt-4 text-3xl font-medium">
                  {published}
                  <span className="ml-2 text-lg text-muted-foreground">
                    / {rows.length}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    陆续公布后自动替换估值
                  </p>
                  <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-foreground"
                      style={{
                        width: `${rows.length ? (published / rows.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </section>
              {result.holdGain != null && (
                <section className="panel p-5 sm:p-6">
                  <p className="text-xs text-muted-foreground">持有收益</p>
                  <div
                    className={`amount mt-4 text-3xl font-medium ${trendClass(result.holdGain)}`}
                  >
                    {signed(result.holdGain)}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    仅计算已填写成本的持仓
                  </p>
                </section>
              )}
            </div>
            {indices.length > 0 && (
              <div className="mb-7 flex divide-x overflow-x-auto rounded-lg border bg-card py-3">
                {indices.map((i) => (
                  <div key={i.symbol} className="min-w-36 flex-1 px-5">
                    <div className="mb-1.5 truncate text-[11px] text-muted-foreground">
                      {i.name}
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="amount text-sm font-medium">
                        {money(i.price)}
                      </span>
                      <span
                        className={`amount text-[10px] ${trendClass(i.changePct)}`}
                      >
                        {signed(i.changePct)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {available.length === rows.length && result.alerts.length > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900">
                <CircleAlert className="size-4" />
                <span>
                  {result.alerts.map((g) => g.name).join("、")} 偏离目标配置
                </span>
                <Button
                  variant="link"
                  size="sm"
                  className="ml-auto h-auto p-0 text-amber-900"
                  onClick={() => navigate("allocation")}
                >
                  查看再平衡
                </Button>
              </div>
            )}
            {visited.map((id) => {
              const View = VIEWS[id];
              return (
                <div key={id} hidden={tab !== id}>
                  <Suspense fallback={<PageSkeleton />}>
                    <View
                      portfolio={portfolio}
                      result={result}
                      quoteMap={quoteMap}
                      onSave={save}
                      onReplaced={state.replace}
                    />
                  </Suspense>
                </div>
              );
            })}
            <footer className="mt-7 flex flex-wrap items-center justify-between gap-2 border-t pt-5 text-[11px] text-muted-foreground">
              <span>
                行情更新{" "}
                {state.refreshedAt?.toLocaleTimeString("zh-CN", {
                  hour12: false,
                }) || "--"}{" "}
                · 数据日期 {mainDate.map((d) => d.slice(5)).join(" / ") || "--"}
              </span>
              <span>
                {mairui ? `麦蕊今日 ${mairui.used}/${mairui.limit} 次 · ` : ""}
                估值仅供参考，以公布净值为准
              </span>
            </footer>
          </>
        )}
        {settings && portfolio && (
          <SettingsDialog
            portfolio={portfolio}
            onClose={() => setSettings(false)}
            onSave={save}
          />
        )}
      </main>
      {toaster}
    </>
  );
}
