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
