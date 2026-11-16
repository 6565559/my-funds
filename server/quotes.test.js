import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeFund } from '../src/calc.js';

const dir = await mkdtemp(path.join(tmpdir(), 'my-funds-quotes-'));
process.env.MY_FUNDS_DATA = dir;
process.env.MAIRUI_LICENCE = 'test-only';
process.env.TZ = 'Asia/Shanghai';
after(async () => {
  mock.restoreAll();
  mock.timers.reset();
  await rm(dir, { recursive: true, force: true });
});

test('行情选择有效的新估值，正式净值发布后切回正式净值', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-13T08:00:00Z') });
  const cases = [
    { code: '000001', name: '旧麦蕊缓存不能挡住今天的新浪估值', mairuiTime: '2026-11-06 16:04:00', source: 'sina', price: 1.1 },
    { code: '000002', name: '同日优先选择时间较新的估值', mairuiTime: '2026-11-13 14:00:00', source: 'sina', price: 1.1 },
    { code: '000003', name: '麦蕊更新时仍采用麦蕊', mairuiTime: '2026-11-13 15:32:00', source: 'mairui', price: 1.2 },
    { code: '000004', name: '较新估值基准不符时退回有效估值', mairuiTime: '2026-11-13 15:32:00', estBase: 0.9, source: 'sina', price: 1.1 },
    { code: '000005', name: '当天正式净值覆盖当天估值', mairuiTime: '2026-11-13 15:32:00', navDate: '2026-11-13', source: null, price: 1 },
    { code: '000006', name: '无估值时保留正式净值', noEstimate: true, source: null, price: 1 },
    { code: '000007', name: '货币基金不用估值计价', money: true, mairuiTime: '2026-11-13 15:32:00', source: null, price: 1 },
  ];
  await writeFile(path.join(dir, 'fund-meta.json'), JSON.stringify(Object.fromEntries(cases.map(c => [c.code, { name: c.code, type: c.money ? '货币型' : '股票型' }]))));
  await writeFile(path.join(dir, 'mairui-cache.json'), JSON.stringify({
    date: '2026-11-13', used: 0, unsupported: ['000006'],
    estimates: Object.fromEntries(cases.filter(c => !c.noEstimate).map(c => [c.code, {
      estNav: 1.2, estBase: c.estBase ?? 1, estChangePct: 20,
      estTime: c.mairuiTime, estSource: 'mairui', fetchedAt: '2026-11-13T08:00:00Z',
    }])),
  }));
  mock.method(globalThis, 'fetch', async (url) => {
    if (url.startsWith('https://fundmobapi.eastmoney.com/')) return Response.json({
      Datas: cases.map(c => ({ FCODE: c.code, SHORTNAME: c.code, NAV: '1', PDATE: c.navDate || '2026-11-12', NAVCHGRT: '0', GSZ: null, GSZZL: null, GZTIME: null })),
    });
    if (url.startsWith('https://hq.sinajs.cn/')) return new Response(cases.filter(c => !c.noEstimate).map(c =>
      `var hq_str_fu_${c.code}="Fund,15:31:00,1.1000,1.0000,1.0000,0,10,2026-11-13";`,
    ).join('\n'));
    throw new Error('Unexpected provider');
  });
  const { getQuotes } = await import('./quotes.js');
  const quotes = await getQuotes(cases.map(c => c.code));
  assert.equal(quotes.length, cases.length);
  for (const c of cases) await t.test(c.name, () => {
    const row = computeFund({ code: c.code, shares: 100 }, quotes.find(q => q.code === c.code));
    assert.equal(row.price, c.price);
    assert.equal(row.estSource ?? null, c.source);
    assert.equal(Boolean(row.estimated), Boolean(c.source));
    if (c.source === 'sina') assert.equal(row.dayGain, 10);
  });
});
