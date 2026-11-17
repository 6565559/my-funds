import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { INDEX_CATALOG } from './index-valuations.js';

export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export const chinaDay = at => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
export function dateValid(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) fail('参数包含不支持的字段');
}
export function units(value, decimals, label) {
  if (!['string', 'number'].includes(typeof value) || !new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${decimals}})?$`).test(String(value))) fail(`${label}格式或精度无效`);
  const [whole, fraction = ''] = String(value).split('.');
  const result = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(result) || result <= 0 || result > 1e12) fail(`${label}必须为有效正数且不超过上限`);
  return result;
}
const planFields = ['name','fundCode','fundName','indexCode','metric','budget','parts','buyBelow','capital','status'];
export function validatePlan(input) {
  fields(input, planFields);
  const { name, fundCode, fundName = fundCode, indexCode, metric = 'pe', parts = 10, buyBelow = 20, status = 'active' } = input;
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof fundName !== 'string' || fundName.length > 160) fail('请输入有效计划名称');
  if (typeof fundCode !== 'string' || !/^\d{6}$/.test(fundCode)) fail('基金代码必须为六位数字');
  if (!INDEX_CATALOG.some(i => i.code === indexCode) || !['pe','pb'].includes(metric)) fail('不支持的参考指数或指标');
  if (!Number.isInteger(parts) || parts < 1 || parts > 100 || ![20,50].includes(buyBelow) || !['active','paused'].includes(status)) fail('份数、估值门槛或状态无效');
  const budgetCents = units(input.budget, 2, '预算');
  if (budgetCents < parts) fail('每份预算不能小于一分');
  const capitalCents = input.capital == null || input.capital === '' ? null : units(input.capital, 2, '可投资资金');
  return { name: name.trim(), fundCode, fundName: fundName.trim() || fundCode, indexCode, metric, budgetCents, parts, buyBelow, capitalCents, status };
}

export function validatePatch(plan, input) {
  fields(input, [...planFields, 'revision']);
  const base = Object.fromEntries(planFields.filter(k => k in plan).map(k => [k, plan[k]]));
  const { revision: _, ...patch } = input;
  const next = validatePlan({...base, budget:(plan.budgetCents/100).toFixed(2), capital:plan.capitalCents == null ? null : (plan.capitalCents/100).toFixed(2), ...patch});
  if (plan.records.length && next.fundCode !== plan.fundCode) fail('已有记录的计划不能更换基金',409);
  return next;
}

export function openDcaDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS dca_plans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, fundCode TEXT NOT NULL, fundName TEXT NOT NULL,
      indexCode TEXT NOT NULL, metric TEXT NOT NULL CHECK(metric IN ('pe','pb')),
      budgetCents INTEGER NOT NULL CHECK(budgetCents>0), parts INTEGER NOT NULL CHECK(parts BETWEEN 1 AND 100),
      buyBelow INTEGER NOT NULL CHECK(buyBelow IN (20,50)), capitalCents INTEGER CHECK(capitalCents>0),
      status TEXT NOT NULL CHECK(status IN ('active','paused')), revision INTEGER NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS dca_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT NOT NULL UNIQUE,
      planId TEXT NOT NULL REFERENCES dca_plans(id), kind TEXT NOT NULL CHECK(kind IN ('buy','basis')),
      date TEXT NOT NULL, navMicros INTEGER NOT NULL CHECK(navMicros>0), amountCents INTEGER,
      reason TEXT NOT NULL, createdAt TEXT NOT NULL, voidedAt TEXT,
      CHECK((kind='buy' AND amountCents>0) OR (kind='basis' AND amountCents IS NULL))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS dca_records_plan ON dca_records(planId,date,id);
    PRAGMA user_version=1;`);
  return db;
}

export function createDcaStore(db, { now = Date.now } = {}) {
  const timestamp = () => new Date(now()).toISOString();
  function get(id) {
    const p = db.prepare('SELECT * FROM dca_plans WHERE id=?').get(id);
    if (!p) fail('计划不存在', 404);
    return { ...p, records: db.prepare('SELECT * FROM dca_records WHERE planId=? ORDER BY date,id').all(id).map(r => ({...r})) };
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const spent = p => p.records.filter(r => !r.voidedAt && r.kind === 'buy').reduce((n,r) => n + r.amountCents, 0);
  function revision(p, value) { if (!Number.isInteger(value) || value !== p.revision) fail('计划已更新，请刷新后重试', 409); }
  function bump(id) { db.prepare('UPDATE dca_plans SET revision=revision+1,updatedAt=? WHERE id=?').run(timestamp(),id); }
  function addRecord(id, input) {
    fields(input, ['requestId','revision','kind','date','nav','amount','reason']);
    const { requestId, kind, date, reason = '' } = input;
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) fail('记录请求标识无效');
    if (!['buy','basis'].includes(kind) || !dateValid(date) || date > chinaDay(now())) fail('记录类型或日期无效，不能记录未来成交');
    if (typeof reason !== 'string' || reason.length > 300 || (kind === 'basis' && !reason.trim())) fail('基准校正需要填写原因');
    const navMicros = units(input.nav, 6, '净值');
    const amountCents = kind === 'buy' ? units(input.amount, 2, '买入金额') : null;
    if (kind === 'basis' && input.amount !== undefined && input.amount !== null) fail('校正不能带有买入金额');
    return transaction(() => {
      const p = get(id);
      const previous = db.prepare('SELECT * FROM dca_records WHERE requestId=?').get(requestId);
      if (previous) {
        if (previous.planId !== id || previous.kind !== kind || previous.date !== date || previous.navMicros !== navMicros || previous.amountCents !== amountCents || previous.reason !== reason.trim()) fail('同一请求标识的内容不同',409);
        return p;
      }
      revision(p, input.revision);
      if (kind === 'buy' && spent(p) + amountCents > p.budgetCents) fail('实际投入超过剩余预算',409);
      db.prepare('INSERT INTO dca_records(requestId,planId,kind,date,navMicros,amountCents,reason,createdAt) VALUES(?,?,?,?,?,?,?,?)')
        .run(requestId,id,kind,date,navMicros,amountCents,reason.trim(),timestamp());
      bump(id); return get(id);
    });
  }
  return {
    get, addRecord,
    list: () => db.prepare('SELECT id FROM dca_plans ORDER BY createdAt DESC,id').all().map(p => get(p.id)),
    create(input) {
      const data = { id: randomUUID(), ...validatePlan(input), revision: 1, createdAt: timestamp(), updatedAt: timestamp() };
      const keys = Object.keys(data);
      db.prepare(`INSERT INTO dca_plans(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(data));
      return get(data.id);
    },
    update(id, input) {
      fields(input, [...planFields, 'revision', 'basis']);
      if (input.basis) {
        if (Object.keys(input).some(k => !['revision','basis'].includes(k))) fail('基准校正不能同时修改计划配置');
        fields(input.basis, ['requestId','date','nav','reason']);
        return addRecord(id, {...input.basis, revision:input.revision, kind:'basis'});
      }
      return transaction(() => {
        const p = get(id); revision(p,input.revision);
        const next = validatePatch(p, input);
        if (next.budgetCents < spent(p)) fail('预算不能低于已投入金额',409);
        const keys = Object.keys(next);
        db.prepare(`UPDATE dca_plans SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...Object.values(next),id);
        bump(id); return get(id);
      });
    },
    voidRecord(id, recordId, input) {
      fields(input, ['revision']);
      return transaction(() => {
        const p = get(id), record = p.records.find(r => String(r.id) === String(recordId));
        if (!record) fail('记录不存在',404);
        if (record.voidedAt) return p;
        revision(p,input.revision);
        if (p.records.filter(r => !r.voidedAt).at(-1)?.id !== record.id) fail('只能撤销最后一条有效记录',409);
        db.prepare('UPDATE dca_records SET voidedAt=? WHERE id=?').run(timestamp(),record.id);
        bump(id); return get(id);
      });
    },
  };
}
