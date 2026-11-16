import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { money, signed, trendClass } from "../calc";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { EmptyState, PageSkeleton } from "./shared";
import Chart from "./Chart";
const RANGES = [
  ["1m", "近 1 月"],
  ["3m", "近 3 月"],
  ["6m", "近 6 月"],
  ["1y", "近 1 年"],
  ["ytd", "今年以来"],
];
export default function PerformanceView({ portfolio }) {
  const [range, setRange] = useState("3m"),
    [stats, setStats] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api
      .performance(range)
      .then((data) => {
        if (active) setStats(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range, portfolio.updatedAt, retry]);
  const option = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        formatter: (items) => {
          const r = stats.series[items[0]?.dataIndex];
          return r
            ? `${r.date}\n回推市值 ${money(r.value)}\n当日 ${signed(r.pnl)} (${signed(r.pct)}%)\n回撤 ${signed(r.drawdown)}%`
            : "";
        },
      },
      grid: { left: 16, right: 24, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: stats?.series?.map((r) => r.date.slice(5)) || [],
        axisLabel: { color: "#71717a", fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: {
          color: "#71717a",
          fontSize: 10,
          formatter: (v) => `${(v / 10000).toFixed(1)}万`,
        },
        splitLine: { lineStyle: { color: "#f0f0f2", type: "dashed" } },
      },
      series: [
        {
          type: "line",
          showSymbol: false,
          data: stats?.series?.map((r) => r.value) || [],
          lineStyle: { width: 2, color: "#18181b" },
          areaStyle: { color: "rgba(24,24,27,0.05)" },
        },
      ],
    }),
    [stats],
  );
  const metrics =
    stats?.days > 1
      ? [
          ["区间收益额", signed(stats.pnl), trendClass(stats.pnl)],
          ["区间收益率", `${signed(stats.pct)}%`, trendClass(stats.pct)],
          [
            "年化收益率",
            `${signed(stats.annualizedPct)}%`,
            trendClass(stats.annualizedPct),
          ],
          [
            "最大回撤",
            `${signed(stats.maxDrawdown)}%`,
            "",
            stats.maxDrawdownDate,
          ],
          ["当前回撤", `${signed(stats.currentDrawdown)}%`],
          ["年化波动", `${money(stats.volatility)}%`],
          ["上涨 / 下跌", `${stats.upDays} / ${stats.downDays}`],
          [
            "最好的一天",
            signed(stats.best.pnl),
            "up",
            `${stats.best.date} · ${signed(stats.best.pct)}%`,
          ],
          [
            "最差的一天",
            signed(stats.worst.pnl),
            "down",
            `${stats.worst.date} · ${signed(stats.worst.pct)}%`,
          ],
        ]
      : [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border bg-card p-1">
          {RANGES.map(([id, label]) => (
            <Button
              key={id}
              variant={id === range ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={id === range}
              onClick={() => setRange(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        {!loading && stats?.startDate && (
          <span className="text-xs text-muted-foreground">
            {stats.startDate} — {stats.endDate} · {stats.days} 个净值日
          </span>
        )}
      </div>
      {error ? (
        <div
          role="alert"
          className="panel flex items-center justify-between p-5 text-sm text-destructive"
        >
          {error}
          <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
            重试
          </Button>
        </div>
      ) : loading ? (
        <PageSkeleton />
      ) : stats?.days > 1 ? (
        <>
          <div className="panel grid grid-cols-2 divide-x divide-y sm:grid-cols-3 xl:grid-cols-5">
            {metrics.map(([label, value, trend, note]) => (
              <div key={label} className="min-h-28 p-5">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`amount mt-3 text-xl font-medium ${trend || ""}`}>
                  {value}
                </p>
                {note && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {note}
                  </p>
                )}
              </div>
            ))}
          </div>
          <section className="panel p-5 sm:p-6">
            <h2 className="section-title">回推市值</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              按当前持仓份额回看，不含区间内申购与赎回。
            </p>
            <Chart
              className="mt-5 h-80"
              option={option}
              label="当前持仓历史回推市值曲线"
            />
          </section>
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="panel overflow-hidden">
              <h2 className="section-title p-5">分组贡献</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">分组</TableHead>
                    <TableHead className="text-right">收益额</TableHead>
                    <TableHead className="text-right">收益率</TableHead>
                    <TableHead className="pr-5 text-right">最大回撤</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.groups.map((g) => (
                    <TableRow key={g.name}>
                      <TableCell className="pl-5 font-medium">
                        {g.name}
                      </TableCell>
                      <TableCell
                        className={`num text-right text-xs ${trendClass(g.pnl)}`}
                      >
                        {signed(g.pnl)}
                      </TableCell>
                      <TableCell
                        className={`num text-right text-xs ${trendClass(g.pct)}`}
                      >
                        {signed(g.pct)}%
                      </TableCell>
                      <TableCell className="num pr-5 text-right text-xs">
                        {signed(g.maxDrawdown)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <section className="panel overflow-hidden">
              <h2 className="section-title p-5">最近净值日</h2>
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">日期</TableHead>
                      <TableHead className="text-right">收益额</TableHead>
                      <TableHead className="text-right">收益率</TableHead>
                      <TableHead className="pr-5 text-right">回撤</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...stats.series]
                      .reverse()
                      .slice(0, 20)
                      .map((r) => (
                        <TableRow key={r.date}>
                          <TableCell className="pl-5 text-xs">
                            {r.date}
                          </TableCell>
                          <TableCell
                            className={`num text-right text-xs ${trendClass(r.pnl)}`}
                          >
                            {signed(r.pnl)}
                          </TableCell>
                          <TableCell
                            className={`num text-right text-xs ${trendClass(r.pct)}`}
                          >
                            {signed(r.pct)}%
                          </TableCell>
                          <TableCell className="num pr-5 text-right text-xs">
                            {signed(r.drawdown)}%
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="panel">
          <EmptyState
            title="净值历史还不足以计算收益"
            description="添加持仓后，至少需要两个有效净值日才能展示统计。"
          />
        </div>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        统计使用正式净值，不含盘中估值及中途申赎；货币基金只计本金，不计万份收益。
        {!loading &&
          stats?.covered != null &&
          `已覆盖 ${stats.covered} / ${stats.totalFunds} 只基金的净值历史。`}
      </p>
    </div>
  );
}
