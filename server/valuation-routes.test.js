import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { installAuth } from './auth.js';
import { openValuationDb } from './valuation-db.js';
import { createValuationService, installValuationRoutes } from './index-valuations.js';

test('真实估值路由受登录保护，重复参数及非法代码返回400且不采集', async t => {
  const db = openValuationDb(':memory:');
  t.after(() => db.close());
  let calls = 0;
  const service = createValuationService({ db, fetcher: async () => { calls++; throw new Error('offline'); } });
  const app = express();
  app.use(express.json());
  installAuth(app, { enabled: true, username: 'tester', password: 'test-password', secret: Buffer.alloc(32, 4) });
  installValuationRoutes(app, service);
  const server = await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [endpoint, method] of [['', 'GET'], ['/refresh', 'POST'], ['/000300.SH/history', 'GET']]) {
    assert.equal((await fetch(base + '/api/index-valuations' + endpoint, { method })).status, 401);
  }
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'test-password' }) });
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  for (const endpoint of ['?window=1y', '?metric=pe&metric=pb', '/bad/history']) {
    assert.equal((await fetch(base + '/api/index-valuations' + endpoint, { headers })).status, 400);
  }
  assert.equal(calls, 0);
  const result = await fetch(base + '/api/index-valuations', { headers });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).rows[0].pe.status, 'error');
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
