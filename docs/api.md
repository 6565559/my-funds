# 外部只读查询 API

`GET /api/open/portfolio` 返回与页面相同口径的资产、收益、分组和基金持仓。无需网页登录。

在 `config.json` 中设置独立的 `apiKey` 字符串（至少 32 个字符），然后重启服务。留空或少于 32 个字符时接口关闭。建议用 `openssl rand -hex 32` 生成随机 Key。修改 Key 并重启即可撤销旧 Key。

优先通过请求头传递 Key：

```bash
curl -H "Authorization: Bearer $MY_FUNDS_API_KEY" \
  http://127.0.0.1:5288/api/open/portfolio
```

也支持 `X-API-Key: <Key>`。需要直接打开链接时可用 `/api/open/portfolio?key=<Key>`；URL 中的 Key 可能留在浏览器历史和代理日志，常规集成优先使用请求头。请求头优先于 URL 参数。

## 响应字段

| 字段 | 含义 |
| --- | --- |
| `asOf` | 本次查询完成时间（ISO 8601），不是净值日期 |
| `portfolioUpdatedAt` | 持仓最后修改时间 |
| `currency` | `CNY` |
| `summary.total` | 持仓市值，元 |
| `summary.dayGain` / `dayPct` | 最新净值或估值对应的日收益额 / 百分比，`1.5` 代表 `1.5%` |
| `summary.holdGain` | 已录入成本的持仓收益；均未录入时为 `null` |
| `summary.groupCount` / `holdingCount` | 分组数 / 持仓记录数，同一基金不同账户分别统计 |
| `summary.pricedCount` / `estimatedCount` | 有行情日期的持仓数 / 使用盘中估值的持仓数 |
| `groups[]` | 分组、目标占比、市值、收益和再平衡偏离 |
| `groups[].funds[]` | 基金代码、名称、账户、份额、成本、市值及收益 |
| `groups[].funds[].price` / `priceDate` | 计算使用的净值或估值及其日期/时间 |
| `groups[].funds[].estimated` / `estSource` | 是否使用盘中估值及估值来源 |

若 `pricedCount < holdingCount`，汇总尚未覆盖全部持仓，不能当作完整总资产。不同基金的净值日期可能不同；以每条 `priceDate` 为准。货币基金与缺失成本的计算口径沿用页面。

## 权限与状态

- 只支持此接口的 `GET` / `HEAD`，写请求返回 `405`。
- Key 缺失、错误、重复 URL 参数或未配置时返回 `401`。
- 其他 `/api/open/*` 路径返回 `404`。
- Key 不授予现有 `/api/portfolio`、导入、删除、备份恢复等接口权限；它们继续使用网页登录。
- 响应设置 `Cache-Control: no-store` 和 `Referrer-Policy: no-referrer`，不包含登录配置或 Key。
- 本接口用于服务端调用或直接访问，未开放跨域 CORS。对公网提供服务时应使用 HTTPS；本次功能不修改路由器端口转发或公网入口。

# 指数估值网页登录接口

以下接口沿用网页登录 Cookie 鉴权，不接受外部持仓 API Key 代替登录。

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| GET | `/api/index-valuations?window=10y&metric=pe` | 六个指数的 PE/PB 快照、所选指标温度和分布 |
| POST | `/api/index-valuations/refresh?window=10y&metric=pe` | 请求更新并返回列表，受一小时冷却限制 |
| GET | `/api/index-valuations/000300.SH/history?window=5y&metric=pb` | 指定指数、指标、窗口内原始日估值序列 |

`window` 只接受 `5y` / `10y`（默认 `10y`），`metric` 只接受 `pe` / `pb`（默认 `pe`）。代码仅接受首版目录中的六个指数。非法及重复参数返回400，未登录返回401。

列表返回 `rows`、`source`、`window`、`metric`、`distribution`、`covered`、`excluded`。每行包含 `code`、`name`、`pe`、`pb`；每项指标包含 `value`（倍）、`date`（原始估值日期）、`temperature`（0–100，未四舍五入）、`band`、`status`、`windowStart`、`historyStart`、`historyEnd`、`sampleCount`、`fetchedAt`、`nextRefreshAt`、`error`。

`source` 包含来源名称、链接、指标口径及 `methodVersion`。历史接口还返回 `series: [{date,value}]`，无效值用 null，不跨缺失值填充曲线。

状态包括 `ok`、`insufficient`（历史不足）、`invalid`（当前估值无效）、`stale`（落后于来源更新日或超过7天）、`cached`（采集失败但保留旧值）、`error`、`missing`。仅 `ok` 纳入分布；缓存中的温度仅对应其原始估值日期。来源失败时列表可部分成功并返回200，调用方必须读取逐项状态。

分位使用同来源有效日样本的经验分布，`≤ 当前值` 计入分子，包含当天。四档区间为 `[0,20]`、`(20,50]`、`(50,80)`、`[80,100]`。窗口不足不返回温度。数据持久化到 `data/index-valuations.sqlite`，与持仓 JSON 导出分开。

# 4%定投网页登录接口

VectorBT 回测接口另见 [回测 API 与运行说明](backtesting.md#网页登录接口)。

同样使用网页登录 Cookie，外部持仓API Key不授予权限。所有响应设置 `Cache-Control: no-store`，不会写入持仓文件。

| 方法 | 地址 | 请求 / 响应 |
| --- | --- | --- |
| GET | `/api/dca-plans` | 返回 `{plans,catalog,source}`；可选 `?refresh=1` 更新行情，估值仍遵守上游冷却限制 |
| POST | `/api/dca-plans` | 创建计划，返回持久化计划 |
| GET | `/api/dca-plans/:id` | 计划、事件、行情和计算结果 |
| PATCH | `/api/dca-plans/:id` | 修改配置或提交 `basis` 基准校正 |
| POST | `/api/dca-plans/:id/buys` | 提交实际买入 |
| POST | `/api/dca-plans/:id/records/:recordId/void` | 撤销最后有效事件 |

创建字段：`name`、`fundCode`（六位）、`indexCode`、`metric`（pe/pb）、`budget`（元）、`parts`（默认10，1–100）、`buyBelow`（20或50）、可选 `capital`（元）、`status`（active/paused）。金额建议使用十进制字符串，最多两位小数；基金名称由服务器验证后保存。

修改、买入、撤销均携带当前 `revision`。买入例：`{"revision":1,"requestId":"UUID","date":"2026-11-16","nav":"0.95","amount":"100.00"}`。基准校正使用PATCH：`{"revision":2,"basis":{"requestId":"UUID","date":"2026-11-16","nav":"0.90","reason":"现金分红"}}`。日期不得晚于北京时间今天，净值最多六位小数。撤销请求为 `{"revision":3}`。

买入和校正的 `requestId` 必须为UUID；同一请求重试返回已有结果，不重复记账，同一标识不同内容返回409。并发修订冲突或超预算返回409，非法输入返回400，计划/记录不存在返回404，未登录返回401。前端保留HTTP状态，冲突后刷新计划并保留表单输入，用户核对后再次提交。写请求成功不依赖行情查询；写后重新GET计算结果。

读响应含 `records`（保留 `voidedAt`）、整数分的预算/投入金额、整数百万分之一的净值，以及 `summary`：`spentCents`、`remainingCents`、`nextAmountCents`、`anchor`、`lastBuy`、`triggerNav`、`concentrationWarning`、`state`、`reason`。状态为 `first`、`ready`、`waiting`、`valuation`、`high`、`unavailable`、`paused`、`exhausted`。只有有效同日正式净值和估值才可能返回first/ready，行情失败仍返回计划账本及unavailable状态。批量行情缓存60秒，失败缓存15秒，无计划时不发起行情请求。
