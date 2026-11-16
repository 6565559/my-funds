import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import {
  ACCOUNTS,
  clone,
  holdingKey,
  money,
  signed,
  today,
  trendClass,
} from "../calc";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Choice, ConfirmAction, EmptyState, Modal } from "./shared";

export default function HoldingsView({ portfolio, result, onSave }) {
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("all");
  const [groupDialog, setGroupDialog] = useState(null);
  const [addGroup, setAddGroup] = useState(null);
  const [confirm, setConfirm] = useState(null);
  async function mutate(fn, message) {
    const next = clone(portfolio);
    fn(next);
    await onSave(next, message);
  }
  async function run(fn, message) {
    try {
      await mutate(fn, message);
    } catch (e) {
      toast.error(e.message);
    }
  }
  function command(group, index, cmd) {
    if (cmd === "edit") return setGroupDialog(group);
    if (cmd === "delete")
      return setConfirm({
        title: `删除「${group.name}」？`,
        description: `该分组的 ${group.funds.length} 条持仓会一并删除。保存前会自动备份。`,
        destructive: true,
        label: "删除分组",
        run: () =>
          mutate((p) => {
            p.groups = p.groups.filter((g) => g.id !== group.id);
          }, "分组已删除"),
      });
    const target = cmd === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= portfolio.groups.length) return;
    run((p) => {
      [p.groups[index], p.groups[target]] = [p.groups[target], p.groups[index]];
    });
  }
  const visible = result.groups.filter(
    (g) => groupId === "all" || g.id === groupId,
  );
  const match = (row) =>
    `${row.name} ${row.code} ${ACCOUNTS[row.account]}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const count = visible.reduce((n, g) => n + g.rows.filter(match).length, 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="搜索持仓"
              placeholder="搜索基金名称、代码或账户"
              className="bg-card pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Choice
            label="筛选分组"
            value={groupId}
            onChange={setGroupId}
            options={[
              ["all", "全部分组"],
              ...result.groups.map((g) => [g.id, g.name]),
            ]}
            className="min-w-36 bg-card"
          />
          <span className="text-xs text-muted-foreground">{count} 条持仓</span>
        </div>
        <Button
          onClick={() =>
            setGroupDialog({ name: "", kind: "normal", target: null })
          }
        >
          <Plus />
          新建分组
        </Button>
      </div>
      {!result.groups.length ? (
        <div className="panel">
          <EmptyState
            title="建立你的第一组持仓"
            description="手动添加基金，或到「导入 / 导出」上传账户资产证明。"
          >
            <Button
              onClick={() =>
                setGroupDialog({ name: "", kind: "normal", target: null })
              }
            >
              <Plus />
              新建分组
            </Button>
          </EmptyState>
        </div>
      ) : count === 0 && query ? (
        <div className="panel">
          <EmptyState
            title="没有找到匹配的持仓"
            description="试试基金代码、名称或账户名称。"
          />
        </div>
      ) : null}
      {result.groups.map((group) => (
        <div
          key={group.id}
          hidden={
            (groupId !== "all" && groupId !== group.id) ||
            (!!query.trim() && !group.rows.some(match))
          }
        >
          <GroupCard
            group={group}
            rows={group.rows.filter(match)}
            allGroups={result.groups}
            onAdd={() => setAddGroup(group)}
            onCommand={(cmd) =>
              command(
                group,
                portfolio.groups.findIndex((g) => g.id === group.id),
                cmd,
              )
            }
            onSaveFunds={(funds) =>
              mutate((p) => {
                p.groups.find((g) => g.id === group.id).funds = funds;
              }, "持仓已保存")
            }
            onRemove={(row) =>
              setConfirm({
                title: `删除 ${row.name}？`,
                description: `从「${group.name}」移除 ${row.code} 的${ACCOUNTS[row.account]}持仓。保存前会自动备份。`,
                destructive: true,
                label: "删除持仓",
                run: () =>
                  mutate((p) => {
                    const g = p.groups.find((g) => g.id === group.id);
                    g.funds = g.funds.filter((f) => holdingKey(f) !== row.key);
                  }, "持仓已删除"),
              })
            }
            onMove={(key, targetId) =>
              run((p) => {
                const from = p.groups.find((g) => g.id === group.id),
                  to = p.groups.find((g) => g.id === targetId);
                const fund = from.funds.find((f) => holdingKey(f) === key);
                const existing = to.funds.find((f) => holdingKey(f) === key);
                if (existing) {
                  existing.shares =
                    Number(existing.shares) + Number(fund.shares);
                } else to.funds.push(fund);
                from.funds = from.funds.filter((f) => holdingKey(f) !== key);
              }, "持仓已移动")
            }
          />
        </div>
      ))}
      {groupDialog && (
        <GroupDialog
          group={groupDialog}
          onClose={() => setGroupDialog(null)}
          onSave={(data) =>
            mutate(
              (p) => {
                if (groupDialog.id)
                  Object.assign(
                    p.groups.find((g) => g.id === groupDialog.id),
                    data,
                  );
                else p.groups.push({ ...data, funds: [] });
              },
              groupDialog.id ? "分组已更新" : "分组已创建",
            )
          }
        />
      )}
      {addGroup && (
        <AddFund
          group={portfolio.groups.find((g) => g.id === addGroup.id)}
          onClose={() => setAddGroup(null)}
          onSave={(fund) =>
            mutate(
              (p) =>
                p.groups.find((g) => g.id === addGroup.id).funds.push(fund),
              "基金已添加",
            )
          }
        />
      )}
      {confirm && (
        <ConfirmAction action={confirm} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

function GroupCard({
  group,
  rows,
  allGroups,
  onAdd,
  onCommand,
  onSaveFunds,
  onRemove,
  onMove,
}) {
  const [collapsed, setCollapsed] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState({}),
    [busy, setBusy] = useState(false);
  const [sort, setSort] = useState({ key: "value", direction: -1 });
  useEffect(() => setEditing(false), [group.funds]);
  const index = allGroups.findIndex((g) => g.id === group.id);
  const sorted = [...rows].sort(
    (a, b) =>
      sort.direction *
      (sort.key === "name"
        ? a.name.localeCompare(b.name, "zh-CN")
        : (a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity)),
  );
  function sortBy(key) {
    setSort((s) => ({ key, direction: s.key === key ? -s.direction : -1 }));
  }
  function edit() {
    setDraft(
      Object.fromEntries(
        group.rows.map((r) => [
          r.key,
          { shares: r.shares, cost: r.cost ?? "" },
        ]),
      ),
    );
    setEditing(true);
    setCollapsed(false);
  }
  function change(key, field, value) {
    setDraft((d) => ({ ...d, [key]: { ...d[key], [field]: value } }));
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSaveFunds(
        group.funds.map((f) => {
          const d = draft[holdingKey(f)],
            { cost, ...rest } = f;
          return {
            ...rest,
            shares: Number(d.shares),
            ...(Number(d.cost) > 0 ? { cost: Number(d.cost) } : {}),
          };
        }),
      );
      setEditing(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const heading = (label, key) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-mx-2 h-7 text-xs text-muted-foreground"
      onClick={() => sortBy(key)}
    >
      {label}
      <ArrowUpDown className="size-3" />
    </Button>
  );
  return (
    <section className="panel overflow-hidden">
      <form onSubmit={save}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${collapsed ? "展开" : "收起"}${group.name}`}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronRight /> : <ChevronDown />}
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="section-title">{group.name}</h2>
                {group.kind === "advisor" && (
                  <Badge variant="secondary">投顾</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {group.rows.length} 只
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                占总资产 {group.ratio}%
                {group.target != null && ` · 目标 ${group.target}%`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <div className="text-right">
              <div className="amount text-base font-medium">
                {money(group.value)}
              </div>
              <div className={`mt-1 text-xs ${trendClass(group.dayGain)}`}>
                日收益 {signed(group.dayGain)}
                <span className="ml-1">({signed(group.dayPct)}%)</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {editing ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    取消
                  </Button>
                  <Button size="sm" disabled={busy}>
                    {busy ? "保存中…" : "保存持仓"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onAdd}
                  >
                    <Plus />
                    添加基金
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`编辑${group.name}的份额与成本`}
                    disabled={!group.rows.length}
                    onClick={edit}
                  >
                    <SlidersHorizontal />
                  </Button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${group.name}分组操作`}
                    disabled={busy}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onCommand("edit")}>
                    分组设置
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() => onCommand("up")}
                  >
                    <ArrowUp />
                    上移
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === allGroups.length - 1}
                    onSelect={() => onCommand("down")}
                  >
                    <ArrowDown />
                    下移
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onCommand("delete")}
                  >
                    删除分组
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        {!collapsed &&
          (rows.length ? (
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow className="bg-muted/35 hover:bg-muted/35">
                  <TableHead className="pl-6">
                    {heading("基金", "name")}
                  </TableHead>
                  <TableHead className="text-right">
                    {heading("持有份额", "shares")}
                  </TableHead>
                  <TableHead className="text-right">净值 / 估值</TableHead>
                  <TableHead className="text-right">
                    {heading("涨跌幅", "dayPct")}
                  </TableHead>
                  <TableHead className="text-right">
                    {heading("持仓市值", "value")}
                  </TableHead>
                  <TableHead className="text-right">
                    {heading("日收益", "dayGain")}
                  </TableHead>
                  <TableHead className="text-right">
                    {editing ? "成本价" : heading("持有收益", "holdGain")}
                  </TableHead>
                  <TableHead className="w-14 pr-5">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="max-w-72 py-4 pl-6">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate text-[13px] font-medium"
                          title={row.name}
                        >
                          {row.name}
                        </span>
                        {!row.estimated && row.priceDate === today() && (
                          <Check
                            className="size-3.5 shrink-0 text-emerald-600"
                            aria-label="今日正式净值已更新"
                          />
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge
                          variant="outline"
                          className="rounded px-1.5 py-0 text-[10px] font-normal"
                        >
                          {ACCOUNTS[row.account]}
                        </Badge>
                        <span className="font-mono">{row.code}</span>
                        <span className="truncate">
                          {row.type || "类型待更新"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {editing ? (
                        <Input
                          aria-label={`${row.code}份额`}
                          className="ml-auto w-28 text-right font-mono"
                          type="number"
                          min="0"
                          step="any"
                          required
                          value={draft[row.key]?.shares ?? ""}
                          onChange={(e) =>
                            change(row.key, "shares", e.target.value)
                          }
                        />
                      ) : (
                        <>
                          <div className="num text-xs">{money(row.shares)}</div>
                          {row.cost != null && (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              成本 {row.cost.toFixed(4)}
                            </div>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="num text-xs">
                        {row.price?.toFixed(4) ?? "--"}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {row.estimated ? "估值 · " : ""}
                        {row.priceDate?.slice(5, 16) || "待更新"}
                      </div>
                    </TableCell>
                    <TableCell
                      className={`num text-right text-xs ${trendClass(row.dayPct)}`}
                    >
                      {row.dayPct == null ? "--" : `${signed(row.dayPct)}%`}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="num text-[13px] font-medium">
                        {money(row.value)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        组内{" "}
                        {group.value
                          ? ((row.value / group.value) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </div>
                    </TableCell>
                    <TableCell
                      className={`num text-right text-xs ${trendClass(row.dayGain)}`}
                    >
                      {signed(row.dayGain)}
                    </TableCell>
                    <TableCell className="text-right">
                      {editing ? (
                        <Input
                          aria-label={`${row.code}成本价`}
                          className="ml-auto w-24 text-right font-mono"
                          type="number"
                          min="0"
                          step="any"
                          placeholder="选填"
                          value={draft[row.key]?.cost ?? ""}
                          onChange={(e) =>
                            change(row.key, "cost", e.target.value)
                          }
                        />
                      ) : (
                        <>
                          <div
                            className={`num text-xs ${trendClass(row.holdGain)}`}
                          >
                            {signed(row.holdGain)}
                          </div>
                          {row.holdPct != null && (
                            <div
                              className={`mt-1 text-[10px] ${trendClass(row.holdPct)}`}
                            >
                              {signed(row.holdPct)}%
                            </div>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="pr-5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${row.code}持仓操作`}
                            disabled={editing}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {allGroups.length > 1 && (
                            <>
                              <DropdownMenuLabel>移动到分组</DropdownMenuLabel>
                              {allGroups
                                .filter((g) => g.id !== group.id)
                                .map((g) => (
                                  <DropdownMenuItem
                                    key={g.id}
                                    onSelect={() => onMove(row.key, g.id)}
                                  >
                                    {g.name}
                                  </DropdownMenuItem>
                                ))}
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onRemove(row)}
                          >
                            删除持仓
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="这个分组还没有基金">
              <Button type="button" variant="outline" onClick={onAdd}>
                <Plus />
                添加基金
              </Button>
            </EmptyState>
          ))}
      </form>
    </section>
  );
}

function GroupDialog({ group, onClose, onSave }) {
  const [kind, setKind] = useState(group.kind),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSave({
        name: data.get("name").trim(),
        kind,
        target: data.get("target") === "" ? null : Number(data.get("target")),
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={group.id ? "编辑分组" : "新建分组"}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="group-name">分组名称</Label>
          <Input
            id="group-name"
            name="name"
            required
            pattern=".*\S.*"
            maxLength={30}
            defaultValue={group.name}
            placeholder="如 A股权益、海外指数"
          />
        </div>
        <div className="space-y-2">
          <Label>分组类型</Label>
          <Choice
            label="分组类型"
            value={kind}
            onChange={setKind}
            options={[
              ["normal", "自持基金"],
              ["advisor", "投顾组合"],
            ]}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="group-target">目标占比（%）</Label>
          <Input
            id="group-target"
            name="target"
            type="number"
            min="0"
            max="100"
            step="0.1"
            defaultValue={group.target ?? ""}
            placeholder="选填"
          />
          <p className="field-help">
            设置后可在资产配置中查看偏离与再平衡提醒。
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button disabled={busy}>{busy ? "保存中…" : "保存分组"}</Button>
        </div>
      </form>
    </Modal>
  );
}
function AddFund({ group, onClose, onSave }) {
  const [query, setQuery] = useState(""),
    [picked, setPicked] = useState(null),
    [matches, setMatches] = useState([]),
    [searching, setSearching] = useState(false),
    [account, setAccount] = useState("manual"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!query.trim() || picked) {
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(
      () =>
        api
          .search(query.trim())
          .then((rows) => {
            if (active) setMatches(rows.slice(0, 12));
          })
          .catch((e) => {
            if (active) setError(`搜索失败：${e.message}`);
          })
          .finally(() => {
            if (active) setSearching(false);
          }),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, picked]);
  async function submit(e) {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget),
      code = picked?.code || query.trim();
    if (!/^\d{6}$/.test(code))
      return setError("请选择搜索结果，或输入六位基金代码。");
    const fund = {
      code,
      account,
      shares: Number(data.get("shares")),
      ...(Number(data.get("cost")) > 0
        ? { cost: Number(data.get("cost")) }
        : {}),
    };
    if (group.funds.some((f) => holdingKey(f) === holdingKey(fund)))
      return setError("该基金在此分组的这个账户中已存在，请编辑已有持仓。");
    setBusy(true);
    try {
      await onSave(fund);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="添加基金"
      description={`添加到「${group.name}」，按账户分别记录持仓。`}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="fund-search">基金名称或代码</Label>
          <Input
            id="fund-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
              setError("");
            }}
            placeholder="输入基金名称、代码或拼音"
            required
          />
          {searching && (
            <p className="field-help" role="status">
              正在搜索…
            </p>
          )}
          {!!matches.length && (
            <div className="max-h-48 overflow-y-auto rounded-md border p-1">
              {matches.map((f) => (
                <button
                  type="button"
                  key={f.code}
                  className="flex w-full gap-3 rounded px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setPicked(f);
                    setQuery(`${f.code} ${f.name}`);
                  }}
                >
                  <span className="font-mono text-muted-foreground">
                    {f.code}
                  </span>
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>所属账户</Label>
          <Choice
            label="所属账户"
            value={account}
            onChange={setAccount}
            options={Object.entries(ACCOUNTS)}
            className="w-full"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fund-shares">持有份额</Label>
            <Input
              id="fund-shares"
              name="shares"
              type="number"
              min="0"
              step="any"
              required
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fund-cost">成本价（选填）</Label>
            <Input
              id="fund-cost"
              name="cost"
              type="number"
              min="0"
              step="any"
              placeholder="单位持仓成本"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button disabled={busy}>{busy ? "添加中…" : "添加基金"}</Button>
        </div>
      </form>
    </Modal>
  );
}
