import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'my-funds-open-api-'));
process.env.MY_FUNDS_DATA = dir;
process.env.MAIRUI_LICENCE = 'test-only';
after(async () => {
  mock.restoreAll();
  await rm(dir, { recursive: true, force: true });
});

test('外部查询返回与持仓份额一致的汇总，并标明缺失行情', async () => {
  await writeFile(path.join(dir, 'portfolio.json'), JSON.stringify({
    updatedAt: '2026-11-13T00:00:00.000Z',
    groups: [{ id: 'a', name: '测试分组', target: 100, funds: [
      { code: '000001', account: 'xueqiu', shares: 100, cost: 1.5 },
      { code: '000001', account: 'manual', shares: 50 },
      { code: '000002', shares: 10 },
    ] }],
    settings: {}, extensionMeta: { privateSetting: 'not-for-open-api' }, imports: { privateSetting: true },
  }));
  await writeFile(path.join(dir, 'fund-meta.json'), JSON.stringify({
    '000001': { name: '测试基金', type: '股票型' }, '000002': { name: '缺失行情', type: '股票型' },
  }));
  mock.method(globalThis, 'fetch', async url => {
    if (url.startsWith('https://fundmobapi.eastmoney.com/')) return Response.json({
      Datas: [{ FCODE: '000001', SHORTNAME: '测试基金', NAV: '2', PDATE: '2026-11-12', NAVCHGRT: '25' }],
    });
    if (url.startsWith('https://hq.sinajs.cn/')) return new Response('');
    throw new Error('Unexpected provider');
  });
  const { readOpenPortfolio } = await import('./open-api.js');
  const response = await readOpenPortfolio();
  assert.equal(response.currency, 'CNY');
  assert.equal(response.portfolioUpdatedAt, '2026-11-13T00:00:00.000Z');
  assert.ok(Number.isFinite(Date.parse(response.asOf)));
  assert.deepEqual(response.summary, { total: 300, dayGain: 60, dayPct: 25, holdGain: 50, groupCount: 1, holdingCount: 3, pricedCount: 2, estimatedCount: 0 });
  assert.equal(response.groups[0].funds[0].price, 2);
  assert.equal(response.groups[0].funds[0].value, 200);
  assert.equal(response.groups[0].funds[1].account, 'manual');
  assert.equal(response.groups[0].funds[1].value, 100);
  assert.equal(response.groups[0].funds[2].priceDate, null);
  assert.equal('rows' in response.groups[0], false);
  assert.equal('extensionMeta' in response, false);
  assert.equal('imports' in response, false);
});

test('没有持仓时仍返回合法的空汇总', async () => {
  await writeFile(path.join(dir, 'portfolio.json'), JSON.stringify({ groups: [], settings: {} }));
  const { readOpenPortfolio } = await import('./open-api.js');
  const response = await readOpenPortfolio();
  assert.deepEqual(response.groups, []);
  assert.equal(response.summary.total, 0);
  assert.equal(response.summary.holdingCount, 0);
  assert.equal(response.summary.holdGain, null);
});
