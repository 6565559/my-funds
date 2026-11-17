import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openValuationDb, saveSeries, readSeries, readSync } from './valuation-db.js';
import { normalizeHistory, summarizeHistory, valuationBand, createValuationService } from './index-valuations.js';

// A weekday series with hand-chosen ranks: 50% lower, 50% equal to the current value.
function history() {
  const rows = [];
  for (let date = new Date('2016-11-16T00:00:00Z'); date <= new Date('2026-11-16T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1)) {
    if (![0, 6].includes(date.getUTCDay())) rows.push({ date: date.toISOString().slice(0, 10), value: rows.length % 2 ? 10 : 20 });
  }
  rows.at(-1).value = 20;
  return rows;
}

test('分位按≤计入并列值，用原始数值划分20/50/80边界', () => {
  assert.equal(summarizeHistory(history(), '10y').temperature, 100);
  for (const [value, band] of [[0, 'low'], [20, 'low'], [20.001, 'cool'], [50, 'cool'], [50.001, 'warm'], [79.999, 'warm'], [80, 'high'], [100, 'high']]) {
    assert.equal(valuationBand(value), band);
  }
});

test('短历史不得冒充十年，最新无效值不得回退成旧日低估值', () => {
  const rows = history();
  assert.equal(summarizeHistory(rows.slice(-1200), '10y').status, 'insufficient');
  const invalid = [...rows.slice(0, -1), { date: '2026-11-16', value: null }];
  assert.equal(summarizeHistory(invalid, '10y').temperature, null);
  assert.equal(summarizeHistory(invalid, '10y').status, 'invalid');
  const five = summarizeHistory(rows, '5y');
  assert.equal(five.windowStart, '2021-11-16');
  assert.equal(five.status, 'ok');
  assert.equal(summarizeHistory([], '10y').value, null);
});

test('源数据校验代码、指标、日期和冲突，负估值只保留日期不评级', () => {
  const payload = { code: '000300.SH', metric: 'pe', years2: 10, series: [
    { date: '2026-11-16', value: -1 }, { date: '2026-11-13', value: 10 }, { date: '2026-11-13', value: 10 },
  ] };
  assert.deepEqual(normalizeHistory(payload, '000300.SH', 'pe', '2026-11-16'), [
    { date: '2026-11-13', value: 10 }, { date: '2026-11-16', value: null },
  ]);
  for (const bad of [
    { ...payload, code: '000905.SH' }, { ...payload, metric: 'pb' }, { ...payload, series: [] },
    { ...payload, series: [{ date: '2026-02-30', value: 10 }] },
    { ...payload, series: [{ date: '2026-11-17', value: 10 }] },
    { ...payload, series: [{ date: '2026-11-13', value: 1 }, { date: '2026-11-13', value: 2 }] },
  ]) assert.throws(() => normalizeHistory(bad, '000300.SH', 'pe', '2026-11-16'));
});

test('SQLite按关系行持久化，重开保留数据，非法批次事务回滚', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'valuations-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'values.sqlite');
  let db = openValuationDb(file);
  const rows = [{ date: '2026-11-13', value: 10 }];
  saveSeries(db, '000300.SH', 'pe', rows, { at: 100, nextRefresh: 200, expectedDate: '2026-11-13' });
  db.close();
  db = openValuationDb(file);
  t.after(() => db.close());
  assert.deepEqual(readSeries(db, '000300.SH', 'pe'), rows);
  assert.equal(readSync(db, '000300.SH', 'pe').lastSuccess, 100);
  assert.throws(() => saveSeries(db, '000300.SH', 'pe', [
    { date: '2026-11-13', value: 20 }, { date: '2026-11-16', value: -5 },
  ], { at: 200, nextRefresh: 300, expectedDate: '2026-11-16' }));
  assert.deepEqual(readSeries(db, '000300.SH', 'pe'), rows);
  assert.equal(readSync(db, '000300.SH', 'pe').lastSuccess, 100);
});

function sourceResponse(url, rows = history(), sourceDate = '2026-11-16') {
  const request = new URL(url);
  if (request.pathname.endsWith('/history')) return Response.json({
    code: request.searchParams.get('code'), metric: request.searchParams.get('metric'), years2: 10, series: rows,
  });
  return Response.json({ new_update_time: sourceDate });
}

test('并发读取合并采集、SQLite命中不再请求，来源失败保留历史并限制重试', async t => {
  const db = openValuationDb(':memory:');
  t.after(() => db.close());
  let time = Date.parse('2026-11-16T12:00:00Z'), calls = 0, failed = false;
  const service = createValuationService({ db, now: () => time, fetcher: async url => {
    calls++;
    if (failed) throw new Error('test offline');
    return sourceResponse(url);
  } });
  const [first] = await Promise.all([service.list({}), service.list({ metric: 'pb' })]);
  assert.equal(first.rows.length, 6);
  assert.equal(first.distribution.high, 6);
  assert.equal(calls, 13);
  await service.list({});
  assert.equal(calls, 13);
  failed = true;
  time += 7 * 3600000;
  const cached = await service.list({});
  assert.equal(cached.rows[0].pe.status, 'cached');
  assert.equal(cached.rows[0].pe.value, 20);
  assert.equal(cached.covered, 0);
  const count = calls;
  await service.list({ refresh: true });
  assert.equal(calls, count);
  assert.equal(readSeries(db, '000300.SH', 'pe').length, history().length);
});

test('早晨命中昨日数据，18点检查到期，不把不同日期PE/PB合并成同日快照', async t => {
  const db = openValuationDb(':memory:');
  t.after(() => db.close());
  let time = Date.parse('2026-11-16T09:00:00+08:00');
  let sourceDate = '2026-11-13';
  const service = createValuationService({ db, now: () => time, fetcher: async url => {
    const rows = url.includes('metric=pb') ? history().slice(0, -1) : history().filter(row => row.date <= sourceDate);
    return sourceResponse(url, rows, sourceDate);
  } });
  const morning = await service.list({});
  assert.equal(morning.rows[0].pe.date, '2026-11-13');
  time = Date.parse('2026-11-16T17:30:00+08:00');
  await service.list({});
  sourceDate = '2026-11-16';
  time = Date.parse('2026-11-16T18:01:00+08:00');
  const evening = await service.list({});
  assert.equal(evening.rows[0].pe.date, '2026-11-16');
  assert.equal(evening.rows[0].pb.date, '2026-11-13');
  assert.equal(evening.rows[0].pb.status, 'stale');
  assert.equal(evening.rows[0].pb.temperature, null);
});

test('非法查询在采集之前拒绝，历史响应裁剪窗口且返回口径', async t => {
  const db = openValuationDb(':memory:');
  t.after(() => db.close());
  let calls = 0;
  const service = createValuationService({ db, now: () => Date.parse('2026-11-16T12:00:00Z'), fetcher: async url => {
    calls++;
    return sourceResponse(url);
  } });
  for (const options of [{ window: '1y' }, { metric: 'xx' }, { metric: ['pe', 'pb'] }]) {
    await assert.rejects(() => service.list(options));
  }
  await assert.rejects(() => service.history('https://bad.test', {}));
  assert.equal(calls, 0);
  const result = await service.history('000300.SH', { window: '5y', metric: 'pe' });
  assert.equal(result.series[0].date, '2021-11-16');
  assert.equal(result.series.at(-1).value, 20);
  assert.equal(result.source.methodVersion, 'jiu-daily-ecdf-v1');
});

test('失败或源数据落后的冷却在跨18点后允许重新采集', async t => {
  for (const reason of ['offline', 'lagging']) {
    const db = openValuationDb(':memory:');
    t.after(() => db.close());
    let time = Date.parse('2026-11-16T17:30:00+08:00'), recovered = false, calls = 0;
    const service = createValuationService({ db, now: () => time, fetcher: async url => {
      calls++;
      if (!recovered && reason === 'offline') throw new Error('offline');
      return sourceResponse(url, recovered ? history() : history().slice(0, -1));
    } });
    await service.list({});
    const before = calls;
    recovered = true;
    time = Date.parse('2026-11-16T18:01:00+08:00');
    const result = await service.list({ refresh: true });
    assert.ok(calls > before, reason);
    assert.equal(result.rows[0].pe.status, 'ok', reason);
  }
});
