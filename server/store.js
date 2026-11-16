import { mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.MY_FUNDS_DATA || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 50;

export const dataPath = (name) => path.join(DATA_DIR, name);

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

export const DEFAULT_INDICES = ['sh000001', 'sz399001', 'sz399006', 'sh000300', 'hkHSI', 'hkHSTECH', 'usNDX', 'usINX'];

export function emptyPortfolio() {
  return {
    version: 1,
    groups: [],
    settings: {
      rebalanceThreshold: 5,
      refreshSeconds: 60,
      indices: DEFAULT_INDICES,
    },
    extensionMeta: null,
    imports: {},
    updatedAt: null,
  };
}

export async function loadPortfolio() {
  const data = await readJson(PORTFOLIO_FILE, null);
  if (!data) return emptyPortfolio();
  const base = emptyPortfolio();
  const { lastImport, ...rest } = data;
  const imports = rest.imports || (lastImport ? { xueqiu: lastImport } : {});
  return { ...base, ...rest, imports, settings: { ...base.settings, ...data.settings } };
}

async function backupCurrent() {
  const current = await readJson(PORTFOLIO_FILE, null);
  if (!current) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeJson(path.join(BACKUP_DIR, `portfolio-${stamp}.json`), current);
  const files = (await readdir(BACKUP_DIR)).filter((f) => f.startsWith('portfolio-')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    await rm(path.join(BACKUP_DIR, f));
  }
}

export async function savePortfolio(portfolio) {
  await backupCurrent();
  const next = { ...portfolio, updatedAt: new Date().toISOString() };
  await writeJson(PORTFOLIO_FILE, next);
  return next;
}

export async function listBackups() {
  try {
    return (await readdir(BACKUP_DIR)).filter((f) => f.startsWith('portfolio-')).sort().reverse();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function readBackup(name) {
  if (!/^portfolio-[\w-]+\.json$/.test(name)) throw new Error('非法的备份文件名');
  return readJson(path.join(BACKUP_DIR, name), null);
}
