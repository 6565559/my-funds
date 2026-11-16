import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'my-funds-mairui-'));
process.env.MY_FUNDS_DATA = dir;
process.env.MAIRUI_LICENCE = 'test-only';
process.env.MAIRUI_DAILY_LIMIT = '500';
process.env.TZ = 'Asia/Shanghai';
after(() => rm(dir, { recursive: true, force: true }));

const cases = [
  { name: '收盘后首次打开能补取跨日缓存', now: '2026-11-13T08:00:00Z', fetchedAt: '2026-11-09T01:30:00Z', refresh: true },
  { name: '收盘后补取最后一次盘中抓取的快照', now: '2026-11-13T08:00:00Z', fetchedAt: '2026-11-13T06:50:00Z', refresh: true },
  { name: '已补取收盘快照则不重复消耗额度', now: '2026-11-13T12:00:00Z', fetchedAt: '2026-11-13T08:00:00Z', refresh: false },
  { name: '交易时段过期缓存继续刷新', now: '2026-11-13T06:00:00Z', fetchedAt: '2026-11-13T05:00:00Z', refresh: true },
  { name: '缓存有效期内不重复请求', now: '2026-11-13T06:00:00Z', fetchedAt: '2026-11-13T05:59:00Z', refresh: false },
  { name: '午休保留当天已抓取的缓存', now: '2026-11-13T04:00:00Z', fetchedAt: '2026-11-13T03:00:00Z', refresh: false },
  { name: '额度耗尽时保留缓存', now: '2026-11-13T08:00:00Z', fetchedAt: '2026-11-09T01:30:00Z', used: 500, refresh: false },
  { name: '供应商失败时仍保留旧缓存', now: '2026-11-13T08:00:00Z', fetchedAt: '2026-11-09T01:30:00Z', failure: true, refresh: false },
];
for (const [index, c] of cases.entries()) test(c.name, async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(c.now) });
  await writeFile(path.join(dir, 'mairui-cache.json'), JSON.stringify({
    date: '2026-11-13', used: c.used || 0, unsupported: [],
    estimates: { '001583': { estNav: 1, estBase: 1, estChangePct: 0, estTime: '2026-11-06 16:04:00', estSource: 'mairui', fetchedAt: c.fetchedAt } },
  }));
  t.mock.method(globalThis, 'fetch', async () => {
    if (c.failure) throw new Error('Provider unavailable');
    return Response.json({ zxgz: 1.2, zxjz: 1, gxsj: '2026-11-13 14:57:00' });
  });
  const { getMairuiEstimates, mairuiStatus } = await import(`./mairui.js?case=${index}`);
  const result = await getMairuiEstimates(['001583']);
  assert.equal(result['001583'].estNav, c.refresh ? 1.2 : 1);
  assert.equal(mairuiStatus().used, (c.used || 0) + (c.refresh ? 1 : 0));
  const again = await getMairuiEstimates(['001583']);
  assert.deepEqual(again, result);
  assert.equal(mairuiStatus().used, (c.used || 0) + (c.refresh ? 1 : 0));
});
