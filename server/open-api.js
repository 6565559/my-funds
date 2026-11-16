import { computePortfolio } from '../shared/calc.js';
import { loadPortfolio } from './store.js';
import { getQuotes } from './quotes.js';

export async function readOpenPortfolio() {
  const portfolio = await loadPortfolio();
  const codes = [...new Set(portfolio.groups.flatMap(group => group.funds.map(fund => fund.code)))];
  const quotes = await getQuotes(codes);
  const result = computePortfolio(portfolio, Object.fromEntries(quotes.map(quote => [quote.code, quote])));
  const rows = result.groups.flatMap(group => group.rows);
  return {
    asOf: new Date().toISOString(),
    portfolioUpdatedAt: portfolio.updatedAt ?? null,
    currency: 'CNY',
    summary: {
      total: result.total,
      dayGain: result.dayGain,
      dayPct: result.dayPct,
      holdGain: result.holdGain,
      groupCount: result.groups.length,
      holdingCount: rows.length,
      pricedCount: rows.filter(row => row.priceDate).length,
      estimatedCount: rows.filter(row => row.estimated).length,
    },
    groups: result.groups.map(({ funds, rows, ...group }) => ({ ...group, funds: rows })),
  };
}
