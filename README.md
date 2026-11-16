# 我的基金 · My Funds

可自行部署的个人基金看板，用于集中管理不同账户的持仓、查看净值与收益、按分组跟踪资产配置。页面使用 React 和官方 shadcn/ui，数据保存在自己的电脑或 NAS 上，支持 Docker 部署。

## 功能

- **持仓管理**：按账户和分组管理基金，维护份额、成本及投顾组合，支持搜索、筛选和移动持仓。
- **资产与收益**：查看持仓市值、日收益、持有收益，以及每只基金使用的正式净值或盘中估值。
- **资产配置**：设置分组目标占比和再平衡阈值，查看当前占比、偏离和调整金额。
- **历史表现**：按当前持仓份额回看历史净值，展示收益走势、回撤和分组贡献。
- **数据导入**：支持雪球基金、微众银行资产证明 PDF，以及「自选基金助手」插件配置 JSON。
- **备份与导出**：保存前自动备份，支持恢复历史备份、导出完整持仓和插件配置。
- **只读 API**：通过独立 API Key 查询持仓、资产和收益，便于接入自己的脚本或其他应用。

这是单用户应用：网页登录使用一组账号密码，所有登录者访问同一份持仓。

## 准备配置

```bash
git clone https://github.com/6565559/my-funds.git
cd my-funds
cp config.example.json config.json
```

编辑 `config.json`，再选择下面任一种启动方式：

| 配置项 | 说明 |
| --- | --- |
| `username` | 网页登录用户名，请自行设置 |
| `password` | 网页登录密码，必须替换示例占位密码 |
| `mairuiLicence` | 可选，麦蕊行情服务的授权码，用于补充盘中估值；没有可留空 |
| `apiKey` | 可选，外部只读接口的独立 Key，至少 32 个字符；留空时接口关闭 |

配置在服务启动时加载，修改后需要重启。Docker 默认对外监听；未设置有效登录账号和密码时，服务会拒绝启动。

## Docker / 飞牛 NAS 部署

需要 Docker 和 Docker Compose。飞牛可将项目放在自己的 `docker/my-funds` 目录中，在 Docker 的 Compose 项目中使用仓库自带的 `docker-compose.yml`；项目目录下应先准备好 `config.json` 文件。

在项目目录执行：

```bash
docker compose up -d --build
docker compose logs -f my-funds
```

浏览器访问 `http://你的服务器或NAS地址:5288`，使用配置中的账号密码登录。

Compose 会将宿主机的 `./data` 挂载到容器 `/data`，将 `./config.json` 只读挂载到 `/config/config.json`。重新构建容器会继续使用这些文件；迁移设备时应一并复制。

如果使用麦蕊估值，在 `docker-compose.yml` 的 `environment` 中添加 `TZ: Asia/Shanghai`，让交易时段判断使用中国时区。

更新代码后重新构建：

```bash
git pull --ff-only
docker compose up -d --build
```

修改登录配置或 API Key 后，可执行 `docker compose restart my-funds`。如果通过网页文件管理器替换了整个配置文件，可执行 `docker compose up -d --force-recreate` 重新挂载。

## 本地运行

使用 Node.js 22.x（至少 22.22.2）和 npm，以满足当前构建及测试依赖；项目已在 Node.js 22.23.1 下验证。

完成配置后执行：

```bash
npm ci
npm start
```

`npm start` 会先构建页面再启动服务，访问 [http://127.0.0.1:5288](http://127.0.0.1:5288)。本地服务默认只监听本机。

需要局域网访问时，先设置有效登录账号和密码，再运行：

```bash
HOST=0.0.0.0 npm start
```

## 开始使用与备份

首次启动没有预置持仓。登录后可新建分组、搜索并添加基金，或到「导入 / 导出」页面导入数据。

- **PDF 导入**：支持最大 20 MB 的资产证明，先预览变化再确认；确认后全量替换对应账户的持仓，其他账户保持不变。
- **插件配置导入**：会替换全部分组和持仓，原目标占比不会保留，请先核对预览和备份。
- **本地存储**：默认保存在 `data/portfolio.json`；修改前的持仓保存在 `data/backups/`，最多保留最近 50 份。
- **迁移与备份**：可在页面导出完整持仓 JSON；完整迁移还应保留 `data/` 目录和 `config.json`。自动备份与主数据位于同一设备，重要数据请另外保存副本。

`config.json`、`.env` 和 `data/` 已加入 Git 忽略列表，不要将真实密码、Key、资产证明或持仓备份上传到公开仓库。

## API Key 查询

生成随机 Key，将结果填入 `config.json` 的 `apiKey`，然后重启服务：

```bash
openssl rand -hex 32
```

接口为 `GET /api/open/portfolio`，无需网页登录。推荐通过请求头传递 Key：

```bash
curl -H "X-API-Key: 你的API_Key" \
  http://127.0.0.1:5288/api/open/portfolio
```

也支持 `Authorization: Bearer 你的API_Key`。需要直接打开链接时，可使用 `http://你的服务器地址:5288/api/open/portfolio?key=你的API_Key`；链接中的 Key 可能进入浏览器历史和代理日志，日常集成优先使用请求头。

响应包含资产与收益汇总、分组及基金明细。Key 仅能查询该接口，不能修改持仓或访问其他受网页登录保护的接口。修改 Key 并重启服务即可撤销旧 Key。

完整字段、权限和状态码见 [API 文档](docs/api.md)。公网访问应通过 HTTPS 反向代理；项目本身不会配置公网入口。

## 行情与计算口径

- 行情通过第三方服务获取，需服务器能够访问对应网络；部分基金可能缺少行情或估值。页面刷新不代表基金公司已经公布当天净值，请核对每只基金的日期。
- 只有晚于最新正式净值、且基准净值匹配的估值才会用于计算；正式净值覆盖后切回正式数据。盘中估值仅供参考。
- 历史表现按**当前份额**回看正式净值，不包含历史申购、赎回和费用；货币基金在该统计中只计本金，不计万份收益。
- API 的 `asOf` 是查询完成时间，不是净值日期；若 `summary.pricedCount < summary.holdingCount`，资产汇总尚未覆盖全部持仓。

## 开发

```bash
npm run dev    # 前端 5287，后端 5288；开发时访问 http://localhost:5287
npm test       # 后端 Node 测试与前端 Vitest 测试
npm run build # 构建前端到 dist/
npm run serve # 启动后端；提供页面前需先完成构建
```

前端使用 React、shadcn/ui、Tailwind CSS、Vite 和 ECharts；后端使用 Node.js、Express，使用 JSON 文件存储，无需单独安装数据库。

| 目录 | 内容 |
| --- | --- |
| `src/` | 页面、组件和前端数据交互 |
| `server/` | 登录鉴权、持仓、行情、PDF 解析和 API |
| `shared/` | 前后端共用的资产与收益计算 |
| `docs/` | 接口等项目文档 |
| `data/` | 运行时数据、缓存和备份，不纳入版本管理 |

## 许可证

项目使用 [GNU GPL v3](LICENSE)。
