import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadPortfolio, savePortfolio, listBackups, readBackup, dataPath } from './store.js';
import { getQuotes, getIndices, getFundTypes, searchFunds, mairuiStatus } from './quotes.js';
import { parseCertificatePdf } from './certificate.js';
import {
  normalizePortfolio,
  fromExtensionConfig,
  toExtensionConfig,
  diffCertificate,
  applyCertificate,
} from './portfolio.js';
import { installAuth, loadAuth } from './auth.js';
import { portfolioPerformance } from './performance.js';
import { readOpenPortfolio } from './open-api.js';
import { openValuationDb, readSeries } from './valuation-db.js';
import { createValuationService, installValuationRoutes } from './index-valuations.js';
import { openDcaDb, createDcaStore } from './dca-store.js';
import { createDcaService, installDcaRoutes } from './dca-plans.js';
import { openBacktestDb, createBacktestService, installBacktestRoutes } from './backtests.js';

const PORT = Number(process.env.PORT || 5288);
const HOST = process.env.HOST || '127.0.0.1';
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

const app = express();
app.use(express.json({ limit: '5mb' }));
installAuth(app, loadAuth(HOST));
const valuationDb = openValuationDb(dataPath('index-valuations.sqlite'));
const valuations = createValuationService({ db: valuationDb });
installValuationRoutes(app, valuations);
const dcaDb = openDcaDb(dataPath('investment-plans.sqlite'));
installDcaRoutes(app, createDcaService({store:createDcaStore(dcaDb),getQuotes,getFundTypes,valuations}));
const backtestDb = openBacktestDb(dataPath('backtests/backtests.sqlite'));
installBacktestRoutes(app, createBacktestService({db:backtestDb,valuations,getFundTypes,
  readValuations:(code,metric)=>readSeries(valuationDb,code,metric)}));
process.on('exit', () => { valuationDb.close(); dcaDb.close(); backtestDb.close(); });

const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

app.get('/api/open/portfolio', route(readOpenPortfolio));
app.get('/api/portfolio', route(() => loadPortfolio()));
app.put('/api/portfolio', route((req) => savePortfolio(normalizePortfolio(req.body))));

app.get(
  '/api/quotes',
  route(async (req) => ({
    quotes: await getQuotes([...new Set(splitList(req.query.codes))]),
    mairui: mairuiStatus(),
  })),
);
app.get('/api/indices', route((req) => getIndices(splitList(req.query.symbols))));
app.get(
  '/api/performance',
  route(async (req) =>
    portfolioPerformance(await loadPortfolio(), ['1m', '3m', '6m', '1y', 'ytd'].includes(req.query.range) ? req.query.range : '3m'),
  ),
);
app.get('/api/search', route((req) => (req.query.key ? searchFunds(req.query.key) : [])));

app.post(
  '/api/import/certificate/preview',
  express.raw({ type: 'application/pdf', limit: '20mb' }),
  route(async (req) => {
    if (!req.body?.length) throw new Error('请上传 PDF 文件');
    const cert = await parseCertificatePdf(req.body);
    const diff = diffCertificate(await loadPortfolio(), cert);
    const codes = [...new Set([...cert.funds.map((f) => f.code), ...diff.missing.map((f) => f.code)])];
    const info = await getQuotes(codes).catch(() => []);
    diff.funds = Object.fromEntries(info.map((q) => [q.code, { name: q.name, type: q.type }]));
    return { cert, diff };
  }),
);

app.post(
  '/api/import/certificate/apply',
  route(async (req) => {
    const { cert, newGroupId } = req.body;
    return savePortfolio(applyCertificate(await loadPortfolio(), cert, { newGroupId }));
  }),
);

app.post(
  '/api/import/extension',
  route(async (req) => savePortfolio(fromExtensionConfig(req.body, await loadPortfolio()))),
);

app.get('/api/export/extension', async (req, res) => {
  const config = toExtensionConfig(await loadPortfolio());
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('自选基金助手配置文件.json')}`);
  res.json(config);
});

app.get('/api/export/backup', async (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="my-funds-backup-${stamp}.json"`);
  res.json(await loadPortfolio());
});

app.get('/api/backups', route(() => listBackups()));
app.post(
  '/api/backups/restore',
  route(async (req) => {
    const data = req.body.name ? await readBackup(req.body.name) : req.body.portfolio;
    if (!data) throw new Error('备份不存在');
    return savePortfolio(normalizePortfolio(data));
  }),
);

if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`my-funds 服务已启动: http://${HOST}:${PORT}`);
});
