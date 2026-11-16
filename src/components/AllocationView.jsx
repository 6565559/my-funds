import { useEffect, useMemo, useState } from "react";
import { clone, money, signed } from "../calc";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { EmptyState } from "./shared";
import Chart from "./Chart";
const RULES = [
  [/^货币/, "现金类（货币）"],
  [/^债券|^理财|^指数型-固收/, "债券固收"],
  [/^QDII|海外/, "海外（QDII）"],
  [/黄金|白银|商品|有色金属期货/, "商品（黄金等）"],
  [/^指数型|^股票|^混合|^FOF/, "国内权益"],
];
const pie = (data) => ({
  color: ["#27272a", "#64748b", "#a1a1aa", "#d4d4d8", "#6b8578", "#b8c5bd"],
  tooltip: {
    trigger: "item",
    renderMode: "richText",
    formatter: (p) => `${p.name}\n${money(p.value)} 元 (${p.percent}%)`,
  },
  legend: {
    bottom: 0,
    type: "scroll",
    icon: "circle",
    itemWidth: 7,
    itemHeight: 7,
    textStyle: { color: "#71717a", fontSize: 11 },
  },
  series: [
    {
      type: "pie",
      radius: ["50%", "73%"],
      center: ["50%", "43%"],
      padAngle: 2,
      itemStyle: { borderRadius: 3 },
      label: { show: false },
      emphasis: { label: { show: true, formatter: "{b}\n{d}%", fontSize: 13 } },
      data,
    },
  ],
});
export default function AllocationView({ portfolio, result, onSave }) {
  const [targets, setTargets] = useState({}),
    [threshold, setThreshold] = useState(5),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reset = () => {
    setTargets(
      Object.fromEntries(portfolio.groups.map((g) => [g.id, g.target ?? ""])),
    );
    setThreshold(portfolio.settings.rebalanceThreshold ?? 5);
    setError("");
  };
  useEffect(reset, [portfolio]);
  const sum = Object.values(targets).reduce((n, v) => n + Number(v || 0), 0);
  const dirty =
    Number(threshold) !== (portfolio.settings.rebalanceThreshold ?? 5) ||
    portfolio.groups.some(
      (g) =>
        (targets[g.id] === "" ? null : Number(targets[g.id])) !==
        (g.target ?? null),
    );
  const categories = useMemo(() => {
    const map = new Map();
    for (const g of result.groups)
      for (const r of g.rows) {
        const category =
          RULES.find(([re]) =>
            re.test(`${r.type || ""} ${r.name || ""}`),
          )?.[1] || "其他 / 未知";
        map.set(category, (map.get(category) || 0) + r.value);
      }
    return [...map]
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);
  }, [result]);
  const groupPie = useMemo(
    () => pie(result.groups.map((g) => ({ name: g.name, value: g.value }))),
    [result],
  );
  const categoryPie = useMemo(() => pie(categories), [categories]);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const next = clone(portfolio);
    next.groups.forEach((g) => {
      g.target = targets[g.id] === "" ? null : Number(targets[g.id]);
    });
    next.settings.rebalanceThreshold = Number(threshold);
    try {
      await onSave(next, "目标配置已保存");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!result.groups.length)
    return (
      <div className="panel">
        <EmptyState
          title="先添加一些持仓"
          description="建立分组后，可以在这里查看资产分布并设置目标占比。"
        />
      </div>
    );
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel p-6">
          <h2 className="section-title">按持仓分组</h2>
          <p className="mt-1 text-xs text-muted-foreground">当前市值占比</p>
          <Chart
            option={groupPie}
            label="按分组统计的资产占比"
            className="mt-2 h-72"
          />
        </section>
        <section className="panel p-6">
          <h2 className="section-title">按底层资产</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            按基金类型穿透统计，投顾拆分至成分基金
          </p>
          <Chart
            option={categoryPie}
            label="按底层资产类别统计的资产占比"
            className="mt-2 h-72"
          />
        </section>
      </div>
      <form onSubmit={save} className="panel overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b p-5">
          <div>
            <h2 className="section-title">目标配置与再平衡</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Label
                htmlFor="threshold"
                className="text-xs font-normal text-muted-foreground"
              >
                偏离超过
              </Label>
              <Input
                id="threshold"
                type="number"
                min="0.5"
                max="50"
                step="0.5"
                required
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="h-8 w-20 text-right"
              />
              <span className="text-xs text-muted-foreground">
                个百分点时提醒
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                Math.abs(sum - 100) < 0.01
                  ? "text-emerald-700"
                  : "text-amber-700"
              }
            >
              目标合计 {sum.toFixed(1)}%
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dirty || busy}
              onClick={reset}
            >
              还原
            </Button>
            <Button size="sm" disabled={!dirty || busy}>
              {busy ? "保存中…" : "保存目标"}
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="pl-5">分组</TableHead>
              <TableHead className="text-right">持仓市值</TableHead>
              <TableHead className="text-right">当前占比</TableHead>
              <TableHead className="text-right">目标占比（%）</TableHead>
              <TableHead className="text-right">偏离</TableHead>
              <TableHead className="pr-5 text-right">调到目标需要</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.groups.map((g) => {
              const has = targets[g.id] !== "" && targets[g.id] != null;
              const deviation = has ? g.ratio - Number(targets[g.id]) : null,
                adjust = has
                  ? (Number(targets[g.id]) / 100) * result.total - g.value
                  : null;
              const warn = has && Math.abs(deviation) > Number(threshold);
              return (
                <TableRow key={g.id}>
                  <TableCell className="py-4 pl-5 font-medium">
                    {g.name}
                  </TableCell>
                  <TableCell className="num text-right text-xs">
                    {money(g.value)}
                  </TableCell>
                  <TableCell className="num text-right text-xs">
                    {g.ratio}%
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${g.name}目标占比`}
                      className="ml-auto w-24 text-right font-mono"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="未设置"
                      value={targets[g.id] ?? ""}
                      onChange={(e) =>
                        setTargets((t) => ({ ...t, [g.id]: e.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell
                    className={`num text-right text-xs ${warn ? "text-amber-700" : ""}`}
                  >
                    {has ? `${signed(deviation, 1)} pp` : "--"}
                  </TableCell>
                  <TableCell
                    className={`pr-5 text-right text-xs ${warn ? "font-medium text-amber-700" : "text-muted-foreground"}`}
                  >
                    {has
                      ? `${adjust >= 0 ? "买入" : "卖出"} ${money(Math.abs(adjust), 0)} 元`
                      : "未设置目标"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </form>
    </div>
  );
}
