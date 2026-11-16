import { readJson, writeJson, dataPath } from './store.js';
import { getFundTypes, getNavHistory } from './quotes.js';

const CACHE_FILE = dataPath('nav-history.json');
const CACHE_TTL = 12 * 60 * 60 * 1000;
const RANGES = { '1m': 21, '3m': 63, '6m': 126, '1y': 252, ytd: 'ytd' };

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

function prevNav(point) {
  if (point.pct == null || point.pct <= -100) return null;
  return point.nav / (1 + point.pct / 100);
}

// 按当前份额回看正式净值。某一天没有净值的基金沿用上一笔，不把新基金的本金算成收益。
export function computePerformance(positions, histories, range) {
  const days = RANGES[range] ? range : '3m';
  const funds = [];
  const byCode = new Map();
  for (const p of positions) {
    if (!p.shares) continue;
    const item = byCode.get(p.code) || { code: p.code, name: p.name || p.code, shares: 0, isMoney: p.isMoney, groups: [] };
    item.shares += p.shares;
    item.isMoney = item.isMoney || p.isMoney;
    item.groups.push({ name: p.group, shares: p.shares });
    byCode.set(p.code, item);
  }
  for (const item of byCode.values()) {
    const points = new Map((histories[item.code] || []).map((h) => [h.date, h]));
    funds.push({ ...item, points });
  }

  const dates = [...new Set(funds.flatMap((f) => [...f.points.keys()]))].sort();
  const lastNav = new Map();
  const all = [];
  for (const date of dates) {
    let base = 0;
    let pnl = 0;
    const groupPnl = new Map();
    for (const fund of funds) {
      if (fund.isMoney) {
        base += fund.shares;
        continue;
      }
      const point = fund.points.get(date);
      if (point) {
        const prev = prevNav(point);
        if (prev != null) {
          const gain = (point.nav - prev) * fund.shares;
          pnl += gain;
          base += prev * fund.shares;
          for (const g of fund.groups) {
            groupPnl.set(g.name, (groupPnl.get(g.name) || 0) + (point.nav - prev) * g.shares);
          }
        }
        lastNav.set(fund.code, point.nav);
      } else if (lastNav.has(fund.code)) {
        base += lastNav.get(fund.code) * fund.shares;
      }
    }
    if (base <= 0) continue;
    all.push({ date, base, pnl, pct: (pnl / base) * 100, groupPnl });
  }

  const year = dates.at(-1)?.slice(0, 4);
  const count = RANGES[days];
  const series = days === 'ytd' ? all.filter((d) => d.date >= `${year}-01-01`) : all.slice(-count);
  if (series.length < 2) {
    return { range: days, days: series.length, series: [], groups: [] };
  }

  let value = series[0].base;
  let peak = series[0].base;
  let maxDrawdown = 0;
  let troughDate = series[0].date;
  let peakAtTrough = value;
  const points = [];
  for (const day of series) {
    value += day.pnl;
    if (value > peak) peak = value;
    const dd = peak > 0 ? value / peak - 1 : 0;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      troughDate = day.date;
      peakAtTrough = peak;
    }
    points.push({
      date: day.date,
      value: round2(value),
      pnl: round2(day.pnl),
      pct: round4(day.pct),
      drawdown: round4(dd * 100),
    });
  }

  const start = series[0].base;
  const end = value;
  const pcts = series.map((d) => d.pct);
  const mean = pcts.reduce((s, n) => s + n, 0) / pcts.length;
  const variance = pcts.reduce((s, n) => s + (n - mean) ** 2, 0) / Math.max(1, pcts.length - 1);
  const up = points.filter((d) => d.pnl > 0.005);
  const down = points.filter((d) => d.pnl < -0.005);
  const best = points.reduce((a, b) => (b.pnl > a.pnl ? b : a));
  const worst = points.reduce((a, b) => (b.pnl < a.pnl ? b : a));
  const totalPct = start > 0 ? end / start - 1 : 0;

  const groups = [...new Set(positions.map((p) => p.group))].map((name) => {
    const gBase = groupStart(name, funds, series[0].date);
    let gValue = gBase;
    let gPeak = gBase;
    let gPnl = 0;
    let gMaxDd = 0;
    for (const day of series) {
      const gain = day.groupPnl.get(name) || 0;
      gValue += gain;
      gPnl += gain;
      if (gValue > gPeak) gPeak = gValue;
      const dd = gPeak > 0 ? gValue / gPeak - 1 : 0;
      if (dd < gMaxDd) gMaxDd = dd;
    }
    return {
      name,
      pnl: round2(gPnl),
      pct: gBase > 0 ? round4((gPnl / gBase) * 100) : 0,
      maxDrawdown: round4(gMaxDd * 100),
      value: round2(gValue),
    };
  });
  groups.sort((a, b) => b.value - a.value);

  return {
    range: days,
    startDate: points[0].date,
    endDate: points.at(-1).date,
    days: points.length,
    startValue: round2(start),
    endValue: round2(end),
    pnl: round2(end - start),
    pct: round4(totalPct * 100),
    annualizedPct: round4((Math.pow(1 + totalPct, 252 / points.length) - 1) * 100),
    maxDrawdown: round4(maxDrawdown * 100),
    maxDrawdownDate: troughDate,
    maxDrawdownPeak: round2(peakAtTrough),
    currentDrawdown: round4((peak > 0 ? end / peak - 1 : 0) * 100),
    volatility: round4(Math.sqrt(variance) * Math.sqrt(252)),
    upDays: up.length,
    downDays: down.length,
    best: { date: best.date, pnl: best.pnl, pct: best.pct },
    worst: { date: worst.date, pnl: worst.pnl, pct: worst.pct },
    series: points,
    groups,
  };
}

function groupStart(name, funds, date) {
  let value = 0;
  for (const fund of funds) {
    for (const g of fund.groups) {
      if (g.name !== name) continue;
      if (fund.isMoney) {
        value += g.shares;
        continue;
      }
      const point = [...fund.points.values()].filter((p) => p.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!point) continue;
      const prev = prevNav(point);
      value += (point.date === date && prev != null ? prev : point.nav) * g.shares;
    }
  }
  return value;
}

let cache = null;

async function loadCache() {
  if (!cache) cache = await readJson(CACHE_FILE, {});
  return cache;
}

async function historyFor(codes) {
  const stored = await loadCache();
  const now = Date.now();
  const result = {};
  const pending = [];
  for (const code of codes) {
    const hit = stored[code];
    if (hit && now - hit.at < CACHE_TTL) result[code] = hit.rows;
    else pending.push(code);
  }
  const queue = [...pending];
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        const rows = await getNavHistory(code);
        stored[code] = { at: now, rows };
        result[code] = rows;
      } catch {
        result[code] = [];
      }
    }
  });
  await Promise.all(workers);
  if (pending.length) await writeJson(CACHE_FILE, stored);
  return result;
}

export async function portfolioPerformance(portfolio, range) {
  const positions = portfolio.groups.flatMap((g) => g.funds.map((f) => ({ code: f.code, shares: Number(f.shares) || 0, group: g.name })));
  const codes = [...new Set(positions.map((p) => p.code))];
  const types = codes.length ? await getFundTypes(codes).catch(() => ({})) : {};
  for (const p of positions) {
    p.name = types[p.code]?.name || p.code;
    p.isMoney = String(types[p.code]?.type || '').startsWith('货币型');
  }
  const histories = await historyFor(codes.filter((c) => !positions.find((p) => p.code === c && p.isMoney)));
  const stats = computePerformance(positions, histories, range);
  stats.covered = codes.filter((c) => histories[c]?.length).length;
  stats.totalFunds = codes.length;
  return stats;
}
