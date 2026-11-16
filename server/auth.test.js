import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { installAuth, loadAuth } from './auth.js';

const key = 'test-only-api-key-with-at-least-32-characters';
const dir = await mkdtemp(path.join(tmpdir(), 'my-funds-auth-'));
process.env.CONFIG_PATH = path.join(dir, 'config.json');
after(() => rm(dir, { recursive: true, force: true }));

async function serve(t, apiKey = key, enabled = true) {
  const app = express();
  app.use(express.json());
  installAuth(app, { enabled, username: 'test-user', password: 'test-password', secret: Buffer.alloc(32, 7), apiKey });
  app.get('/api/open/portfolio', (_, res) => res.json({ ok: true }));
  app.all('/api/portfolio', (_, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('从登录配置读取独立 API Key，未配置时保持关闭', async () => {
  await writeFile(process.env.CONFIG_PATH, JSON.stringify({ apiKey: key }));
  assert.equal(loadAuth('127.0.0.1').apiKey, key);
  await writeFile(process.env.CONFIG_PATH, '{}');
  assert.equal(loadAuth('127.0.0.1').apiKey, '');
});

test('Bearer、X-API-Key 和 URL key 均可免网页登录查询', async t => {
  const base = await serve(t);
  for (const [suffix, headers] of [
    ['', { Authorization: `Bearer ${key}` }],
    ['', { 'X-API-Key': key }],
    [`?key=${encodeURIComponent(key)}`, {}],
  ]) {
    const response = await fetch(base + '/api/open/portfolio' + suffix, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
});

test('空 Key、错误 Key 和重复 key 参数不能访问持仓', async t => {
  const base = await serve(t);
  for (const suffix of ['', '?key=wrong', `?key=${key}&key=${key}`]) {
    assert.equal((await fetch(base + '/api/open/portfolio' + suffix)).status, 401);
  }
  const disabled = await serve(t, '', false);
  assert.equal((await fetch(disabled + '/api/open/portfolio')).status, 401);
  const weak = await serve(t, 'short-key', false);
  assert.equal((await fetch(weak + '/api/open/portfolio?key=short-key')).status, 401);
  assert.equal((await fetch(base + '/api/OPEN/portfolio/')).status, 401);
});

test('API Key 不能调用写接口或绕过原有登录鉴权', async t => {
  const base = await serve(t);
  const headers = { 'X-API-Key': key };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base + '/api/open/portfolio', { method, headers });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
  for (const method of ['GET', 'PUT']) {
    assert.equal((await fetch(base + '/api/portfolio', { method, headers })).status, 401);
  }
  assert.equal((await fetch(base + '/api/open/not-found', { headers })).status, 404);
});

test('网页账号登录保持可用，Cookie 不替代外部接口 Key', async t => {
  const base = await serve(t);
  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-user', password: 'test-password' }),
  });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  assert.equal((await fetch(base + '/api/portfolio', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/open/portfolio', { headers })).status, 401);
});
