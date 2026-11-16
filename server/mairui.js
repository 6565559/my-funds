import { readFileSync } from 'node:fs';
import { readJson, writeJson, dataPath } from './store.js';

const API = 'https://api.mairuiapi.com';
const FILE = dataPath('mairui-cache.json');
const DAILY_LIMIT = Number(process.env.MAIRUI_DAILY_LIMIT || 500);
// 留一点余量给当天新加入的基金，其余额度摊到 4 小时交易时段
const RESERVE = 40;
const TRADING_MINUTES = 240;
const MIN_INTERVAL_MIN = 10;
const MAX_INTERVAL_MIN = 30;

function licence() {
  if (process.env.MAIRUI_LICENCE) return process.env.MAIRUI_LICENCE;
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('MAIRUI_LICENCE='));
    const value = line?.slice('MAIRUI_LICENCE='.length).trim();
    if (value) process.env.MAIRUI_LICENCE = value;
    return value || '';
  } catch {
    return '';
  }
}

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? null : n;
};

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isTrading(d = new Date()) {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return (m >= 9 * 60 + 25 && m <= 11 * 60 + 35) || (m >= 13 * 60 && m <= 15 * 60 + 5);
}

const emptyState = () => ({ date: today(), used: 0, unsupported: [], estimates: {} });

let state = null;
let chain = Promise.resolve();

async function loadState() {
  if (!state) state = { ...emptyState(), ...(await readJson(FILE, {})) };
  if (state.date !== today()) {
    state.date = today();
    state.used = 0;
    await writeJson(FILE, state);
  }
  return state;
}

function intervalMinutes(supportedCount) {
  const rounds = Math.max(1, Math.floor((DAILY_LIMIT - RESERVE) / Math.max(supportedCount, 1)));
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.ceil(TRADING_MINUTES / rounds)));
}

export function mairuiStatus() {
  const supported = Object.keys(state?.estimates || {}).length;
  return {
    used: state?.used || 0,
    limit: DAILY_LIMIT,
    intervalMinutes: intervalMinutes(supported),
    supported,
    trading: isTrading(),
  };
}

async function estimateOne(code, key) {
  const res = await fetch(`${API}/jj/pzzzgz/${code}/${key}`, { signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return { unsupported: true };
  if (!res.ok) throw new Error(`麦蕊估值请求失败 ${res.status}`);
  const data = await res.json();
  const estNav = num(data.zxgz);
  const estBase = num(data.zxjz);
  if (!estNav || !data.gxsj) return { unsupported: true };
  return {
    estNav,
    estBase,
    estChangePct: estBase ? Math.round(((estNav - estBase) / estBase) * 10000) / 100 : null,
    estTime: data.gxsj,
    estSource: 'mairui',
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchNeeded(codes) {
  const key = licence();
  const current = await loadState();
  const unsupported = new Set(current.unsupported || []);
  const estimates = current.estimates || {};
  const supportedCount = Math.max(Object.keys(estimates).length, 1);
  const intervalMs = intervalMinutes(supportedCount) * 60 * 1000;
  const now = Date.now();
  const day = new Date(now).getDay();
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const close = new Date(now).setHours(15, 5, 0, 0);
  const refreshSince = day > 0 && day < 6 && now >= close ? close : dayStart;

  const result = {};
  const pending = [];
  for (const code of codes) {
    if (unsupported.has(code)) continue;
    const cached = estimates[code];
    if (cached) result[code] = cached;
    const fetchedAt = Date.parse(cached?.fetchedAt) || 0;
    const fresh = now - fetchedAt < intervalMs;
    // 休市只补当天缺失的数据和收盘快照，避免沿用跨日缓存或反复消耗额度。
    if (!fresh && (isTrading() || fetchedAt < refreshSince) && current.used < DAILY_LIMIT) pending.push(code);
  }

  if (key && pending.length) {
    const queue = [...pending];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length && current.used < DAILY_LIMIT) {
        const code = queue.shift();
        try {
          const est = await estimateOne(code, key);
          current.used += 1;
          if (est.unsupported) unsupported.add(code);
          else {
            estimates[code] = est;
            result[code] = est;
          }
        } catch {
          // 请求没成功，不记额度，留给新浪
        }
      }
    });
    await Promise.all(workers);
    current.unsupported = [...unsupported];
    current.estimates = estimates;
    await writeJson(FILE, current);
  }

  return result;
}

export function getMairuiEstimates(codes) {
  const run = chain.then(() => fetchNeeded(codes));
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}
