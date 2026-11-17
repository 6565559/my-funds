PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('preparing','queued','running','completed','failed')),
 fund_code TEXT NOT NULL, fund_name TEXT, index_code TEXT NOT NULL, metric TEXT NOT NULL,
 window_years INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
 budget_cents INTEGER NOT NULL, parts INTEGER NOT NULL, buy_below REAL NOT NULL, fee_pct REAL NOT NULL,
 input_hash TEXT, engine_version TEXT, method_version TEXT, error TEXT, finished_at INTEGER,
 actual_start TEXT, actual_end TEXT, skipped_days INTEGER
) STRICT;
CREATE TABLE IF NOT EXISTS variants (
 run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, mode TEXT NOT NULL, drop_pct REAL NOT NULL,
 PRIMARY KEY(run_id,name)
) STRICT;
CREATE TABLE IF NOT EXISTS nav_cache (
 code TEXT NOT NULL, date TEXT NOT NULL, nav REAL NOT NULL, pct REAL, PRIMARY KEY(code,date)
) STRICT;
CREATE TABLE IF NOT EXISTS nav_sync (code TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, start_date TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS input_prices (
 run_id TEXT NOT NULL REFERENCES runs(id), date TEXT NOT NULL, nav REAL NOT NULL, pct REAL,
 PRIMARY KEY(run_id,date)
) STRICT;
CREATE TABLE IF NOT EXISTS input_valuations (
 run_id TEXT NOT NULL REFERENCES runs(id), date TEXT NOT NULL, value REAL,
 PRIMARY KEY(run_id,date)
) STRICT;
CREATE TABLE IF NOT EXISTS summaries (
 run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, final_value REAL NOT NULL,
 return_pct REAL NOT NULL, annualized_pct REAL NOT NULL, drawdown_pct REAL NOT NULL,
 spent REAL NOT NULL, cash REAL NOT NULL, fees REAL NOT NULL, buys INTEGER NOT NULL,
 PRIMARY KEY(run_id,name)
) STRICT;
CREATE TABLE IF NOT EXISTS equity (
 run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, date TEXT NOT NULL,
 value REAL NOT NULL, cash REAL NOT NULL, PRIMARY KEY(run_id,name,date)
) STRICT;
CREATE TABLE IF NOT EXISTS orders (
 run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, date TEXT NOT NULL,
 signal_date TEXT, temperature REAL, price REAL NOT NULL, units REAL NOT NULL, amount REAL NOT NULL, fees REAL NOT NULL,
 PRIMARY KEY(run_id,name,date)
) STRICT;
CREATE TABLE IF NOT EXISTS worker_health (id INTEGER PRIMARY KEY CHECK(id=1),heartbeat INTEGER NOT NULL,version TEXT NOT NULL) STRICT;
PRAGMA user_version=1;
