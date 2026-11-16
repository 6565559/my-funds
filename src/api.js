export class AuthRequired extends Error {
  constructor() {
    super('需要登录');
    this.status = 401;
  }
}

async function request(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthRequired();
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  session: () => request('/api/session'),
  login: (username, password) => request('/api/login', json('POST', { username, password })),
  logout: () => request('/api/logout', json('POST', {})),
  getPortfolio: () => request('/api/portfolio'),
  savePortfolio: (p) => request('/api/portfolio', json('PUT', p)),
  quotes: (codes) => request(`/api/quotes?codes=${codes.join(',')}`),
  performance: (range) => request(`/api/performance?range=${encodeURIComponent(range)}`),
  indices: (symbols) => request(`/api/indices?symbols=${symbols.join(',')}`),
  search: (key) => request(`/api/search?key=${encodeURIComponent(key)}`),
  previewCertificate: (file) =>
    request('/api/import/certificate/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    }),
  applyCertificate: (cert, newGroupId) =>
    request('/api/import/certificate/apply', json('POST', { cert, newGroupId })),
  importExtension: (config) => request('/api/import/extension', json('POST', config)),
  backups: () => request('/api/backups'),
  restoreBackup: (payload) => request('/api/backups/restore', json('POST', payload)),
};
