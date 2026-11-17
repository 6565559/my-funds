# VectorBT 策略回测

「策略回测」支持自定义预算、份数、估值指标/窗口/门槛、申购费和 1–5 个加仓跌幅参数，并与月定投、一次买入比较。首版只买不卖，全部预算起始可用，闲置资金不计息；原文没有明确的卖出比例，因此没有擅自添加止盈。不会改动真实持仓和定投账本。

数据存入 `data/backtests/backtests.sqlite`，含任务参数、原始历史快照、输入哈希、引擎/规则版本、逐日资产与模拟成交。免费估值约从 2016 年开始；5 年窗口通常只能回测 2021 年末以后，10 年窗口需等待/补充更长历史，不会自动降级。滚动分位只用当时已有历史，前一净值日的同日信号于下一净值日成交。基金日收益率连乘构造红利再投复权净值，模拟份额不等于实际份额；日涨幅的四舍五入会带来累计误差。不模拟限购、暂停申购、确认延迟，暂不支持 QDII、货币基金。来源的历史修订仍可能带来事后数据偏差。

Node API 与 Python 3.12 工作进程通过 SQLite 队列连接，不暴露 Python HTTP 端口。Docker Compose 会同时构建两者；本地开发额外运行：

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backtest/requirements.txt
BACKTEST_DB="$PWD/data/backtests/backtests.sqlite" .venv/bin/python backtest/worker.py
```

每个数据库只启动一个 worker。最多 3 个未完成任务，单次计算最多 180 秒，重启中断的任务会标记失败。历史列表展示最近 50 次，数据库保留全部记录。完整备份需停止 Node **及 worker** 后复制整个 `data/`；持仓 JSON 导出不包含回测或定投数据库。测试：`npm test` 和 `.venv/bin/python -m unittest discover -s backtest -p 'test_*.py'`。

引擎固定 [VectorBT 1.2.1](https://github.com/polakowo/vectorbt)，它使用 Apache 2.0 + Commons Clause 条款；个人使用免费，向第三方出售包含该能力的服务前需另行核对许可。依赖锁定于 `backtest/requirements.txt`。

## 网页登录接口

全部要求网页登录 Cookie，外部持仓 API Key 无权访问，返回 `Cache-Control: no-store`。

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| GET | `/api/backtests` | 最近 50 次任务、指数目录、worker 心跳、估值历史覆盖 |
| POST | `/api/backtests` | 校验参数并入库，异步准备数据并排队 |
| GET | `/api/backtests/:id` | 参数、状态、错误、比较结果、逐日资产及成交明细 |

创建示例：

```json
{"requestId":"UUIDv4","fundCode":"110020","indexCode":"000300.SH","metric":"pe","windowYears":5,"startDate":"2022-01-01","endDate":"2026-11-16","budget":100000,"parts":10,"buyBelow":20,"feePct":0.15,"drops":[2,4,6]}
```

日期不得晚于北京时间今天，开始日期不早于 2010；预算 1 至 1 亿元且最多两位小数，份数 1–100，门槛 20/50，费率 0–5%，跌幅 1–20% 最多 5 个。相同 UUID/参数返回同一任务，相同 UUID 不同参数 409；离线 worker 返回 503，未完成任务过多 429。准备/计算错误存入任务并显示，不覆盖以往结果。状态 `preparing → queued → running → completed/failed`。参数或输入变更必须创建新任务。

## NAS 部署

原 Node 服务继续使用既有挂载。Python worker 只挂载 `data/backtests` 为可写数据目录和程序为只读目录，不挂载持仓、定投或登录配置，不开端口。现有 NAS 如采用预装依赖虚拟环境，必须使用与安装时一致的 Python 镜像、绝对挂载路径；升级时创建新环境，运行测试后切换。备份 app/data/config 后再替换程序，部署后核对持仓内容和定投表记录。
