const round2 = (n) => Math.round(n * 100) / 100;

export const clone = (v) => JSON.parse(JSON.stringify(v));

export const ACCOUNTS = { xueqiu: '雪球', webank: '微众', manual: '手动' };
// 与服务端一致：没有账户字段的旧持仓视为雪球账户
export const accountOf = (f) => (ACCOUNTS[f.account] ? f.account : 'xueqiu');
// 同一分组里可能有多个账户持有同一基金，持仓身份是 代码 + 账户
export const holdingKey = (f) => `${f.code}@${accountOf(f)}`;

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 单只持仓的市值与收益。估值可用且比最新净值新时优先用估值，否则用最新净值和当日涨跌幅。
export function computeFund(holding, quote) {
  const shares = Number(holding.shares) || 0;
  const cost = holding.cost ? Number(holding.cost) : null;
  const base = {
    key: holdingKey(holding),
    account: accountOf(holding),
    code: holding.code,
    name: quote?.name || holding.code,
    type: quote?.type || '',
    shares,
    cost,
    price: null,
    priceDate: null,
    estimated: false,
    value: 0,
    dayPct: null,
    dayGain: 0,
    holdGain: null,
    holdPct: null,
  };
  if (!quote) return base;

  if (quote.isMoney) {
    const y = quote.moneyYieldPer10k || 0;
    return {
      ...base,
      price: 1,
      priceDate: quote.navDate,
      value: round2(shares),
      dayPct: y / 100,
      dayGain: round2((shares / 10000) * y),
    };
  }

  // 估值必须晚于最新净值日期，且以当前最新净值为基准；否则正式净值已覆盖这次估值
  const useEst =
    quote.estNav != null &&
    quote.estTime &&
    (!quote.navDate || quote.estTime.slice(0, 10) > quote.navDate) &&
    (quote.estBase == null || Math.abs(quote.estBase - quote.nav) < 1e-6);
  const price = useEst ? quote.estNav : quote.nav;
  const dayPct = useEst ? quote.estChangePct : quote.changePct;
  const value = round2(shares * (price || 0));
  const dayGain = useEst
    ? round2((quote.estNav - quote.nav) * shares)
    : dayPct != null && quote.nav
      ? round2((quote.nav - quote.nav / (1 + dayPct / 100)) * shares)
      : 0;
  const holdGain = cost ? round2(value - cost * shares) : null;

  return {
    ...base,
    price,
    priceDate: useEst ? quote.estTime : quote.navDate,
    estimated: useEst,
    estSource: useEst ? quote.estSource : null,
    value,
    dayPct,
    dayGain,
    holdGain,
    holdPct: cost ? round2(((price - cost) / cost) * 100) : null,
  };
}

export function computePortfolio(portfolio, quoteMap) {
  const groups = portfolio.groups.map((g) => {
    const funds = g.funds.map((f) => computeFund(f, quoteMap[f.code]));
    const value = round2(funds.reduce((s, f) => s + f.value, 0));
    const dayGain = round2(funds.reduce((s, f) => s + f.dayGain, 0));
    const withCost = funds.filter((f) => f.holdGain != null);
    return {
      ...g,
      rows: funds,
      value,
      dayGain,
      dayPct: value - dayGain ? round2((dayGain / (value - dayGain)) * 100) : 0,
      holdGain: withCost.length ? round2(withCost.reduce((s, f) => s + f.holdGain, 0)) : null,
    };
  });

  const total = round2(groups.reduce((s, g) => s + g.value, 0));
  const dayGain = round2(groups.reduce((s, g) => s + g.dayGain, 0));
  const threshold = portfolio.settings?.rebalanceThreshold ?? 5;

  for (const g of groups) {
    g.ratio = total ? round2((g.value / total) * 100) : 0;
    if (g.target != null && g.target !== '') {
      g.deviation = round2(g.ratio - g.target);
      g.adjust = round2((g.target / 100) * total - g.value);
      g.alert = Math.abs(g.deviation) > threshold;
    } else {
      g.deviation = null;
      g.adjust = null;
      g.alert = false;
    }
  }

  const targets = groups.filter((g) => g.target != null && g.target !== '');
  const targetSum = round2(targets.reduce((s, g) => s + Number(g.target), 0));
  const holdGroups = groups.filter((g) => g.holdGain != null);

  return {
    groups,
    total,
    dayGain,
    dayPct: total - dayGain ? round2((dayGain / (total - dayGain)) * 100) : 0,
    holdGain: holdGroups.length ? round2(holdGroups.reduce((s, g) => s + g.holdGain, 0)) : null,
    targetSum: targets.length ? targetSum : null,
    alerts: groups.filter((g) => g.alert),
  };
}

export const money = (n, digits = 2) =>
  n == null || Number.isNaN(n)
    ? '--'
    : Number(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const signed = (n, digits = 2) => (n == null ? '--' : `${n > 0 ? '+' : ''}${money(n, digits)}`);

export const trendClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
