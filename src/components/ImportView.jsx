import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FileJson,
  FileText,
  History,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { accountOf, money, signed, trendClass } from "../calc";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Choice, ConfirmAction } from "./shared";
const ACCOUNTS = [
  ["xueqiu", "雪球基金"],
  ["webank", "微众银行"],
];
function backupTime(name) {
  const m = name.match(/portfolio-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m
    ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`).toLocaleString("zh-CN", {
        hour12: false,
      })
    : name;
}
function PreviewTable({ title, rows, columns }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">
        {title}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {rows.length}
        </span>
      </h3>
      {rows.length ? (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                {columns.map(([label]) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={`${row.code || row.name}-${i}`}>
                  {columns.map(([label, render]) => (
                    <TableCell key={label} className="text-xs">
                      {render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">无</p>
      )}
    </section>
  );
}
export default function ImportView({ portfolio, quoteMap, onReplaced }) {
  const [account, setAccount] = useState("xueqiu"),
    [preview, setPreview] = useState(null),
    [parsing, setParsing] = useState(false),
    [newGroup, setNewGroup] = useState("none"),
    [backups, setBackups] = useState([]),
    [backupError, setBackupError] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(null);
  const pdfInput = useRef(null),
    jsonInput = useRef(null),
    active = useRef(true);
  const name = ACCOUNTS.find(([id]) => id === account)[1];
  const groups = portfolio.groups.filter((g) => g.kind !== "advisor");
  const groupName = groups.find((g) => g.id === newGroup)?.name || "未分类";
  const unbound = (preview?.diff.added || []).filter((f) => !f.group);
  const fundName = (code) =>
    preview?.diff.funds?.[code]?.name || quoteMap[code]?.name || "";
  async function loadBackups() {
    try {
      const data = await api.backups();
      if (active.current) {
        setBackups(data);
        setBackupError("");
      }
    } catch (e) {
      if (active.current) setBackupError(e.message);
    }
  }
  useEffect(() => {
    active.current = true;
    loadBackups();
    return () => {
      active.current = false;
    };
  }, []);
  async function onPdf(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf"))
      return setError("请选择 PDF 文件。");
    if (file.size > 20 * 1024 * 1024) return setError("PDF 不能超过 20 MB。");
    setParsing(true);
    setPreview(null);
    setError("");
    try {
      const data = await api.previewCertificate(file);
      if (!active.current) return;
      if (data.cert.source !== account)
        throw new Error(
          `这份是${ACCOUNTS.find(([id]) => id === data.cert.source)?.[1] || data.cert.source}的资产证明，当前选择的是${name}。`,
        );
      setPreview(data);
      setNewGroup("none");
    } catch (e) {
      if (active.current) setError(`解析失败：${e.message}`);
    } finally {
      if (active.current) setParsing(false);
    }
  }
  function applyPdf() {
    setConfirm({
      title: `确认覆盖${name}持仓？`,
      description: `将使用 ${preview.cert.asOf} 的证明更新该账户，新增 ${preview.diff.added.length} 只、删除 ${preview.diff.missing.length} 只基金。其他账户的 ${preview.diff.untouched} 条持仓保持不变。当前数据会先自动备份。`,
      label: "确认全量覆盖",
      run: async () => {
        const next = await api.applyCertificate(
          preview.cert,
          unbound.length && newGroup !== "none" ? newGroup : null,
        );
        if (!active.current) return;
        onReplaced(next);
        setPreview(null);
        toast.success(`${name}持仓已更新`);
        loadBackups();
      },
    });
  }
  async function onJson(file) {
    if (!file) return;
    setError("");
    try {
      const config = JSON.parse(await file.text());
      if (!config || typeof config !== "object" || Array.isArray(config))
        throw new Error("不是有效的插件配置");
      const entries = config.fundListGroup?.length
        ? config.fundListGroup
        : [{ funds: config.fundListM || [] }];
      if (!Array.isArray(entries)) throw new Error("插件配置的分组格式不正确");
      const count = entries.reduce((n, g) => n + (g.funds?.length || 0), 0);
      setConfirm({
        title: "导入插件配置？",
        description: `配置包含 ${entries.length} 个分组、${count} 只基金。导入会替换全部分组和持仓，目标占比会丢失。当前数据会先自动备份。`,
        destructive: true,
        label: "确认导入",
        run: async () => {
          const next = await api.importExtension(config);
          if (!active.current) return;
          onReplaced(next);
          toast.success("插件配置已导入");
          loadBackups();
        },
      });
    } catch (e) {
      setError(`读取配置失败：${e.message}`);
    }
  }
  function restore(file) {
    setConfirm({
      title: "恢复这份备份？",
      description: `恢复到 ${backupTime(file)}。当前全部持仓会被替换，操作前会自动备份当前数据。`,
      label: "恢复备份",
      run: async () => {
        const next = await api.restoreBackup({ name: file });
        if (!active.current) return;
        onReplaced(next);
        toast.success("备份已恢复");
        loadBackups();
      },
    });
  }
  return (
    <div className="space-y-5">
      <section className="panel p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="section-title">从资产证明同步持仓</h2>
          <p className="mt-2 max-w-3xl text-xs leading-6 text-muted-foreground">
            选择账户，上传资产证明，核对变化后确认。基金按代码回到原分组；投顾组合单独成组。该账户以证明为准全量替换，其他账户保持不变。
          </p>
        </div>
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {ACCOUNTS.map(([id, label]) => {
            const count = portfolio.groups.reduce(
              (n, g) =>
                n +
                g.funds.filter((f) =>
                  g.kind === "advisor" ? id === "xueqiu" : accountOf(f) === id,
                ).length,
              0,
            );
            return (
              <button
                type="button"
                key={id}
                disabled={parsing}
                aria-pressed={id === account}
                onClick={() => {
                  setAccount(id);
                  setPreview(null);
                  setError("");
                }}
                className={`flex items-center justify-between rounded-lg border p-4 text-left transition-colors ${id === account ? "border-foreground bg-muted/50" : "hover:bg-muted/40"} disabled:opacity-50`}
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md border bg-card p-2">
                    <FileText className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {count} 条持仓 ·{" "}
                      {portfolio.imports?.[id]?.asOf
                        ? `上次证明 ${portfolio.imports[id].asOf}`
                        : "尚未导入证明"}
                    </div>
                  </div>
                </div>
                {id === account && <Check className="size-4" />}
              </button>
            );
          })}
        </div>
        <input
          type="file"
          ref={pdfInput}
          accept=".pdf,application/pdf"
          className="hidden"
          aria-label="上传资产证明 PDF"
          disabled={parsing}
          onChange={(e) => {
            onPdf(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={parsing}
          onClick={() => pdfInput.current.click()}
          className="flex min-h-40 w-full flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-5 py-7 text-center transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          {parsing ? (
            <Loader2 className="mb-3 size-6 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="mb-3 size-6 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {parsing ? "正在解析资产证明…" : `选择${name}资产证明`}
          </span>
          <span className="mt-2 text-xs text-muted-foreground">
            PDF，最大 20 MB ·{" "}
            {account === "xueqiu"
              ? "雪球《资产证明书》"
              : "微众《个人资产证明》"}
          </span>
        </button>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          微众证明只有金额，会按证明日期当天或之前的最近净值折算为份额，确认前可查看明细。
        </p>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {preview && (
          <div className="mt-6 space-y-5 border-t pt-6">
            <div className="flex items-center justify-between">
              <h2 className="section-title">导入预览</h2>
              <Badge variant="outline">尚未写入</Badge>
            </div>
            <div className="grid gap-4 rounded-lg bg-muted/50 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">证明日期</p>
                <p className="mt-2 text-sm font-medium">{preview.cert.asOf}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">证明总额</p>
                <p className="amount mt-2 text-sm">
                  {money(preview.cert.total)} 元
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">解析合计</p>
                <p className="amount mt-2 text-sm">
                  {money(preview.cert.computedTotal)} 元
                </p>
                <Badge
                  className="mt-1"
                  variant={
                    Math.abs(preview.cert.computedTotal - preview.cert.total) <
                    1
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {Math.abs(preview.cert.computedTotal - preview.cert.total) < 1
                    ? "金额一致"
                    : "金额不一致，请核对"}
                </Badge>
              </div>
            </div>
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">
              将全量覆盖「{preview.diff.accountName}
              」，证明中没有的基金会从该账户删除。其他账户的{" "}
              {preview.diff.untouched} 条持仓保持不变。
            </p>
            <PreviewTable
              title="份额变化"
              rows={preview.diff.updated}
              columns={[
                ["基金", (r) => `${r.code} ${fundName(r.code)}`],
                ["分组", (r) => r.group],
                ["原份额", (r) => money(r.from)],
                ["新份额", (r) => money(r.to)],
                [
                  "变化",
                  (r) => (
                    <span className={trendClass(r.to - r.from)}>
                      {signed(r.to - r.from)}
                    </span>
                  ),
                ],
              ]}
            />
            {unbound.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {unbound.length} 只新增基金没有分组记录，放入
                <Choice
                  label="新增基金写入分组"
                  value={newGroup}
                  onChange={setNewGroup}
                  options={[
                    ["none", "未分类（自动创建）"],
                    ...groups.map((g) => [g.id, g.name]),
                  ]}
                />
              </div>
            )}
            <PreviewTable
              title="新增基金"
              rows={preview.diff.added}
              columns={[
                ["基金", (r) => `${r.code} ${fundName(r.code)}`],
                ["分组", (r) => r.group || groupName],
                ["份额", (r) => money(r.shares)],
                ["市值", (r) => money(r.value)],
              ]}
            />
            <PreviewTable
              title="将从该账户删除"
              rows={preview.diff.missing}
              columns={[
                ["基金", (r) => `${r.code} ${fundName(r.code)}`],
                ["原分组", (r) => r.group],
                ["当前份额", (r) => money(r.shares)],
              ]}
            />
            {preview.cert.source === "webank" && (
              <PreviewTable
                title="金额折算份额"
                rows={preview.cert.funds}
                columns={[
                  ["基金", (r) => `${r.code} ${r.name}`],
                  ["证明金额", (r) => money(r.amount)],
                  ["折算净值", (r) => `${r.nav.toFixed(4)} (${r.navDate})`],
                  ["折算份额", (r) => money(r.shares)],
                ]}
              />
            )}
            {preview.diff.advisors?.length > 0 && (
              <PreviewTable
                title="投顾组合"
                rows={preview.diff.advisors}
                columns={[
                  ["组合", (r) => `${r.name} (${r.code})`],
                  ["写入分组", (r) => r.group || `新建「投顾-${r.name}」`],
                  ["成分基金", (r) => r.fundCount],
                  ["市值", (r) => money(r.value)],
                ]}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>
                取消
              </Button>
              <Button onClick={applyPdf}>确认全量覆盖</Button>
            </div>
          </div>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5 sm:p-6">
          <FileJson className="mb-4 size-5 text-muted-foreground" />
          <h2 className="section-title">插件配置互通</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            与浏览器插件「自选基金助手」交换配置，保留分组与份额。
          </p>
          <input
            type="file"
            ref={jsonInput}
            accept=".json,application/json"
            className="hidden"
            aria-label="导入插件配置 JSON"
            onChange={(e) => {
              onJson(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => jsonInput.current.click()}>
              <Upload />
              导入插件配置
            </Button>
            <Button asChild variant="outline">
              <a href="/api/export/extension" download>
                <Download />
                导出插件配置
              </a>
            </Button>
          </div>
        </section>
        <section className="panel p-5 sm:p-6">
          <History className="mb-4 size-5 text-muted-foreground" />
          <h2 className="section-title">备份与恢复</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            每次保存前自动备份，保留最近 50 份。下面展示最近 10 份。
          </p>
          <Button asChild variant="outline" className="mt-5">
            <a href="/api/export/backup" download>
              <Download />
              下载完整备份
            </a>
          </Button>
          {backupError ? (
            <div role="alert" className="mt-4 text-xs text-destructive">
              {backupError}
              <Button variant="link" size="sm" onClick={loadBackups}>
                重试
              </Button>
            </div>
          ) : (
            <div className="mt-5 max-h-64 overflow-y-auto">
              {backups.length ? (
                backups.slice(0, 10).map((file) => (
                  <div
                    key={file}
                    className="flex items-center justify-between gap-3 border-t py-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      {backupTime(file)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => restore(file)}
                    >
                      恢复
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">暂无备份</p>
              )}
            </div>
          )}
        </section>
      </div>
      {confirm && (
        <ConfirmAction action={confirm} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}
