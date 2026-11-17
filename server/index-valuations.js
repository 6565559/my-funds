export const INDEX_CATALOG = [
  { code: '000300.SH', name: '沪深300' },
  { code: '000905.SH', name: '中证500' },
  { code: '000852.SH', name: '中证1000' },
  { code: '000906.SH', name: '中证800' },
  { code: '000016.SH', name: '上证50' },
  { code: '399673.SZ', name: '创业板50' },
];
export const SOURCE = {
  name: '韭圈', url: 'https://www.jiucaishuo.com/indicators?tab=index',
  methodVersion: 'jiu-daily-ecdf-v1',
  methodology: 'PE-TTM：成分股市值合计 / 近12个月净利润合计；PB-LF：最新财报口径。分位按有效日样本≤当前值自算，包含当天。',
};

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeHistory(payload, code, metric, today) {
  if (payload?.code !== code || payload?.metric !== metric || payload?.years2 !== 10 ||
    !Array.isArray(payload.series) || !payload.series.length || payload.series.length > 10000) {
    throw new Error('上游估值数据格式不符或历史为空');
  }
  const days = new Map();
  for (const row of payload.series) {
    if (!validDate(row.date) || row.date > today) throw new Error('上游估值日期无效');
    const value = typeof row.value === 'number' && Number.isFinite(row.value) && row.value > 0 ? row.value : null;
    if (days.has(row.date) && days.get(row.date) !== value) throw new Error('同一日期存在冲突估值');
    days.set(row.date, value);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export function valuationBand(temperature) {
  return temperature <= 20 ? 'low' : temperature <= 50 ? 'cool' : temperature < 80 ? 'warm' : 'high';
}

export function summarizeHistory(rows, window) {
  const latest = rows.at(-1);
  const result = { value: latest?.value ?? null, date: latest?.date ?? null, temperature: null, band: null,
    status: 'missing', sampleCount: 0, windowStart: null, historyStart: null, historyEnd: latest?.date ?? null };
  if (!latest) return result;
  const years = window === '5y' ? 5 : 10;
  const start = new Date(`${latest.date}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  result.windowStart = start.toISOString().slice(0, 10);
  const valid = rows.filter(row => row.date >= result.windowStart && row.value != null && row.value > 0);
  result.sampleCount = valid.length;
  result.historyStart = valid[0]?.date ?? null;
  if (latest.value == null) return { ...result, status: 'invalid' };
  if (valid.length < (years === 5 ? 1000 : 2000) ||
    new Date(`${valid[0].date}T00:00:00Z`).getTime() - start.getTime() > 31 * 86400000) {
    return { ...result, status: 'insufficient' };
  }
  const temperature = valid.filter(row => row.value <= latest.value).length / valid.length * 100;
  return { ...result, status: 'ok', temperature, band: valuationBand(temperature) };
}
import { readSeries, readSync, saveSeries, saveFailure } from './valuation-db.js';


function queryOptions(options = {}) {
  const window = options.window ?? '10y', metric = options.metric ?? 'pe';
  if (!['5y', '10y'].includes(window) || !['pe', 'pb'].includes(metric)) throw new Error('仅支持5y/10y窗口和pe/pb指标');
  return { window, metric };
}

function chinaDate(at) {
  return new Date(at + 8 * 3600000).toISOString().slice(0, 10);
}

function nextCheck(at) {
  let evening = Date.parse(`${chinaDate(at)}T18:00:00+08:00`);
  if (evening <= at) evening += 86400000;
  // 18时是主动检查时点，不代表上游承诺的发布时间。
  return Math.min(at + 6 * 3600000, evening);
}

export function createValuationService({ db, fetcher = fetch, now = Date.now }) {
  let pending = null;
  async function request(url) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`估值来源请求失败（HTTP ${response.status}）`);
    return response.json();
  }
  async function update(force = false) {
    if (pending) return pending;
    const at = now();
    const retryAt = Math.min(at + 3600000, nextCheck(at));
    const jobs = INDEX_CATALOG.flatMap(({ code }) => ['pe', 'pb'].map(metric => ({ code, metric })))
      .filter(({ code, metric }) => {
        const state = readSync(db, code, metric);
        return !state || at >= state.nextRefresh || (force && at - state.lastAttempt >= 3600000);
      });
    if (!jobs.length) return;
    pending = (async () => {
      let expectedDate;
      try {
        const market = await request('https://ai2.jiucaishuo.com/api/index-valuation?category=jx');
        expectedDate = market.new_update_time;
        if (!validDate(expectedDate) || expectedDate > chinaDate(at)) throw new Error('上游估值更新日期无效');
      } catch {
        for (const { code, metric } of jobs) saveFailure(db, code, metric, at, '无法确认来源更新日期，已保留原数据', retryAt);
        return;
      }
      const queue = [...jobs];
      await Promise.all(Array.from({ length: 2 }, async () => {
        while (queue.length) {
          const { code, metric } = queue.shift();
          try {
            const params = new URLSearchParams({ code, metric, years2: '10' });
            const payload = await request(`https://ai2.jiucaishuo.com/api/index-valuation/history?${params}`);
            const rows = normalizeHistory(payload, code, metric, chinaDate(at));
            saveSeries(db, code, metric, rows, { at, expectedDate,
              nextRefresh: rows.at(-1).date < expectedDate ? retryAt : nextCheck(at) });
          } catch {
            saveFailure(db, code, metric, at, '来源访问失败或数据未通过校验，已保留原数据', retryAt);
          }
        }
      }));
    })().finally(() => { pending = null; });
    return pending;
  }
  function metricResult(code, metric, window) {
    const summary = summarizeHistory(readSeries(db, code, metric), window);
    const state = readSync(db, code, metric);
    const result = { ...summary, fetchedAt: state?.lastSuccess ? new Date(state.lastSuccess).toISOString() : null,
      nextRefreshAt: state ? new Date(state.nextRefresh).toISOString() : null, error: state?.error ?? null };
    if (!summary.date) return { ...result, status: state?.error ? 'error' : 'missing' };
    const old = summary.date < state?.expectedDate ||
      Date.parse(`${chinaDate(now())}T00:00:00Z`) - Date.parse(`${summary.date}T00:00:00Z`) > 7 * 86400000;
    if (old) return { ...result, status: 'stale', temperature: null, band: null };
    if (state?.error) return { ...result, status: 'cached' };
    return result;
  }
  return {
    async list(options = {}) {
      const { window, metric } = queryOptions(options);
      await update(options.refresh === true);
      const rows = INDEX_CATALOG.map(index => ({ ...index,
        pe: metricResult(index.code, 'pe', window), pb: metricResult(index.code, 'pb', window) }));
      const distribution = { low: 0, cool: 0, warm: 0, high: 0 };
      for (const row of rows) if (row[metric].status === 'ok') distribution[row[metric].band]++;
      const covered = Object.values(distribution).reduce((a, b) => a + b, 0);
      return { window, metric, source: SOURCE, rows, distribution, covered, excluded: rows.length - covered };
    },
    async history(code, options = {}) {
      const { window, metric } = queryOptions(options);
      const index = INDEX_CATALOG.find(row => row.code === code);
      if (!index) throw new Error('不支持的指数代码');
      await update();
      const summary = metricResult(code, metric, window);
      const series = readSeries(db, code, metric).filter(row => row.date >= summary.windowStart);
      return { ...index, window, metric, source: SOURCE, ...summary, series };
    },
  };
}

export function installValuationRoutes(app, service) {
  const route = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await fn(req)); }
    catch (error) { res.status(400).json({ error: error.message }); }
  };
  app.get('/api/index-valuations', route(req => service.list(req.query)));
  app.post('/api/index-valuations/refresh', route(req => service.list({ ...req.query, refresh: true })));
  app.get('/api/index-valuations/:code/history', route(req => service.history(req.params.code, req.query)));
}
