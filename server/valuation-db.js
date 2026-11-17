import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openValuationDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS valuation_history (
      code TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('pe', 'pb')),
      date TEXT NOT NULL,
      value REAL CHECK (value > 0),
      PRIMARY KEY (code, metric, date)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS valuation_sync (
      code TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('pe', 'pb')),
      last_attempt INTEGER NOT NULL,
      last_success INTEGER,
      next_refresh INTEGER NOT NULL,
      expected_date TEXT,
      error TEXT,
      PRIMARY KEY (code, metric)
    ) STRICT;
    PRAGMA user_version = 1;
  `);
  return db;
}

export function readSeries(db, code, metric) {
  return db.prepare('SELECT date, value FROM valuation_history WHERE code = ? AND metric = ? ORDER BY date')
    .all(code, metric).map(row => ({ ...row }));
}

export function readSync(db, code, metric) {
  return db.prepare(`SELECT last_attempt AS lastAttempt, last_success AS lastSuccess,
    next_refresh AS nextRefresh, expected_date AS expectedDate, error
    FROM valuation_sync WHERE code = ? AND metric = ?`).get(code, metric) || null;
}

export function saveSeries(db, code, metric, rows, { at, nextRefresh, expectedDate }) {
  const latest = db.prepare('SELECT MAX(date) AS date FROM valuation_history WHERE code = ? AND metric = ?').get(code, metric).date;
  if (!rows.length || (latest && rows.at(-1).date < latest)) throw new Error('上游历史为空或日期倒退，已保留原数据');
  const insert = db.prepare(`INSERT INTO valuation_history (code, metric, date, value) VALUES (?, ?, ?, ?)
    ON CONFLICT (code, metric, date) DO UPDATE SET value = excluded.value`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) insert.run(code, metric, row.date, row.value);
    db.prepare(`INSERT INTO valuation_sync (code, metric, last_attempt, last_success, next_refresh, expected_date, error)
      VALUES (?, ?, ?, ?, ?, ?, NULL) ON CONFLICT (code, metric) DO UPDATE SET
      last_attempt = excluded.last_attempt, last_success = excluded.last_success,
      next_refresh = excluded.next_refresh, expected_date = excluded.expected_date, error = NULL`)
      .run(code, metric, at, at, nextRefresh, expectedDate);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function saveFailure(db, code, metric, at, error, nextRefresh = at + 3600000) {
  db.prepare(`INSERT INTO valuation_sync (code, metric, last_attempt, next_refresh, error) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (code, metric) DO UPDATE SET last_attempt = excluded.last_attempt,
    next_refresh = excluded.next_refresh, error = excluded.error`)
    .run(code, metric, at, nextRefresh, error);
}
