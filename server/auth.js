import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COOKIE = 'mf_session';
const MAX_AGE_SEC = 30 * 24 * 60 * 60;
const PLACEHOLDERS = new Set(['', 'change-me', '请改成你自己的密码']);

function readConfig() {
  const file = process.env.CONFIG_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config.json');
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return {
      file,
      username: String(data.username || '').trim(),
      password: String(data.password || ''),
      mairuiLicence: String(data.mairuiLicence || '').trim(),
      apiKey: typeof data.apiKey === 'string' ? data.apiKey.trim() : '',
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { file, username: '', password: '', mairuiLicence: '', apiKey: '' };
    throw new Error(`配置文件无法读取：${file}`);
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function loadAuth(host) {
  const config = readConfig();
  if (config.mairuiLicence && !process.env.MAIRUI_LICENCE) process.env.MAIRUI_LICENCE = config.mairuiLicence;
  const exposed = host === '0.0.0.0' || host === '::';
  const enabled = Boolean(config.username) && !PLACEHOLDERS.has(config.password);
  if (exposed && !enabled) {
    throw new Error(`对外监听必须在 ${config.file} 里设置 username 和 password`);
  }
  const secret = crypto.createHash('sha256').update(`my-funds:${config.password}`).digest();
  return { enabled, username: config.username, password: config.password, secret, apiKey: config.apiKey };
}

function sign(username, secret) {
  const body = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_SEC * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readSession(cookieHeader, secret) {
  const raw = String(cookieHeader || '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice(COOKIE.length + 1));
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data?.u || data.exp < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}

function setCookie(res, value) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${value ? MAX_AGE_SEC : 0}`];
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function installAuth(app, auth) {
  app.post('/api/login', (req, res) => {
    if (!auth.enabled) return res.json({ username: null, required: false });
    const { username, password } = req.body || {};
    if (!safeEqual(username, auth.username) || !safeEqual(password, auth.password)) {
      return res.status(401).json({ error: '账号或密码不正确' });
    }
    setCookie(res, sign(auth.username, auth.secret));
    res.json({ username: auth.username, required: true });
  });

  app.post('/api/logout', (req, res) => {
    setCookie(res, '');
    res.json({ ok: true });
  });

  app.get('/api/session', (req, res) => {
    const username = auth.enabled ? readSession(req.headers.cookie, auth.secret) : null;
    res.json({ required: auth.enabled, username: username && username === auth.username ? username : null });
  });

  app.use('/api', (req, res, next) => {
    const openPath = req.path.toLowerCase().replace(/\/$/, '');
    if (openPath === '/open' || openPath.startsWith('/open/')) {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '')?.[1];
      const key = bearer || req.get('x-api-key') || (typeof req.query.key === 'string' ? req.query.key : '');
      if (!auth.apiKey || auth.apiKey.length < 32 || !safeEqual(key, auth.apiKey)) {
        return res.status(401).json({ error: 'API Key 无效或未配置' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.set('Allow', 'GET, HEAD').status(405).json({ error: '外部 API 只支持查询' });
      }
      if (openPath !== '/open/portfolio') return res.status(404).json({ error: '接口不存在' });
      return next();
    }
    if (!auth.enabled || req.path === '/login' || req.path === '/session' || req.path === '/logout') return next();
    const username = readSession(req.headers.cookie, auth.secret);
    if (username !== auth.username) return res.status(401).json({ error: '需要登录' });
    next();
  });
}
