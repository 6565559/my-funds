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
  if (!res.ok) throw Object.assign(new Error(data.error || `请求失败 ${res.status}`), {status:res.status});
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
  indexValuations: (window, metric, refresh = false) => request(
    `/api/index-valuations${refresh ? '/refresh' : ''}?${new URLSearchParams({ window, metric })}`,
    refresh ? json('POST', {}) : {},
  ),
  indexValuationHistory: (code, window, metric) => request(
    `/api/index-valuations/${encodeURIComponent(code)}/history?${new URLSearchParams({ window, metric })}`,
  ),
  search: (key) => request(`/api/search?key=${encodeURIComponent(key)}`),
  backtests: () => request('/api/backtests'),
  backtest: (id) => request(`/api/backtests/${encodeURIComponent(id)}`),
  createBacktest: (data) => request('/api/backtests', json('POST', data)),
  dcaPlans: (refresh = false) => request(`/api/dca-plans${refresh ? '?refresh=1' : ''}`),
  createDcaPlan: (data) => request('/api/dca-plans', json('POST', data)),
  updateDcaPlan: (id, data) => request(`/api/dca-plans/${encodeURIComponent(id)}`, json('PATCH', data)),
  addDcaBuy: (id, data) => request(`/api/dca-plans/${encodeURIComponent(id)}/buys`, json('POST', data)),
  voidDcaRecord: (id, recordId, revision) => request(`/api/dca-plans/${encodeURIComponent(id)}/records/${recordId}/void`, json('POST', {revision})),
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
