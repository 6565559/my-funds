import { readJson, writeJson, dataPath } from './store.js';
import { getMairuiEstimates, mairuiStatus } from './mairui.js';

export { mairuiStatus };

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const META_FILE = dataPath('fund-meta.json');

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://fund.eastmoney.com/' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`请求失败 ${res.status}: ${url}`);
  return res.json();
}

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? null : n;
};

let metaCache = null;

async function loadMeta() {
  if (!metaCache) metaCache = await readJson(META_FILE, {});
  return metaCache;
}

export async function searchFunds(key) {
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=9&key=${encodeURIComponent(key)}`;
  const data = await getJson(url);
  return (data.Datas || [])
    .filter((d) => d.CATEGORYDESC === '基金')
    .map((d) => ({
      code: d.CODE,
      name: d.NAME,
      type: d.FundBaseInfo?.FTYPE || '',
    }));
}

// 基金类型几乎不变，首次查询后落盘缓存；货币基金的 NAV 字段实际是万份收益，必须依赖类型区分。
async function ensureMeta(codes) {
  const meta = await loadMeta();
  const missing = codes.filter((c) => !meta[c]);
  const queue = [...missing];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        const hit = (await searchFunds(code)).find((f) => f.code === code);
        if (hit) meta[code] = { name: hit.name, type: hit.type };
      } catch {
        // 单只失败不影响整体，下次刷新会重试
      }
    }
  });
  await Promise.all(workers);
  if (missing.length) await writeJson(META_FILE, meta);
  return meta;
}

export async function getFundTypes(codes) {
  const meta = await ensureMeta(codes);
  return Object.fromEntries(codes.map((c) => [c, meta[c] || { name: c, type: '' }]));
}

// 东方财富已停止提供盘中估值，改用新浪 fu_ 接口。
// 字段：名称,估值时间,估算净值,估值基准净值,累计净值,?,估算涨幅%,估值日期,...
async function getSinaEstimates(codes) {
  const result = {};
  for (let i = 0; i < codes.length; i += 50) {
    const batch = codes.slice(i, i + 50);
    const res = await fetch(`https://hq.sinajs.cn/list=${batch.map((c) => `fu_${c}`).join(',')}`, {
      headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`新浪估值请求失败 ${res.status}`);
    const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
    for (const [, code, body] of text.matchAll(/hq_str_fu_(\d{6})="([^"]*)"/g)) {
      const p = body.split(',');
      const estNav = num(p[2]);
      if (!estNav || !/^\d{4}-\d{2}-\d{2}$/.test(p[7] || '')) continue;
      result[code] = {
        estNav,
        estBase: num(p[3]),
        estChangePct: num(p[6]),
        estTime: `${p[7]} ${String(p[1]).slice(0, 5)}`,
        estSource: 'sina',
      };
    }
  }
  return result;
}

export async function getQuotes(codes) {
  if (!codes.length) return [];
  const url =
    'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=200&plat=Android' +
    `&appType=ttjj&product=EFund&Version=1&deviceid=my-funds&Fcodes=${codes.join(',')}`;
  const [data, meta, mairui, sina] = await Promise.all([
    getJson(url),
    ensureMeta(codes),
    // 两路同时查询，避免旧缓存遮住另一通道的新估值
    getMairuiEstimates(codes).catch(() => ({})),
    getSinaEstimates(codes).catch(() => ({})),
  ]);

  return (data.Datas || []).map((d) => {
    const type = meta[d.FCODE]?.type || '';
    const isMoney = type.startsWith('货币型');
    const nav = isMoney ? 1 : num(d.NAV);
    const navDate = d.PDATE && d.PDATE !== '--' ? d.PDATE : null;
    const est = isMoney ? null : [mairui[d.FCODE], sina[d.FCODE]]
      .filter((e) => e?.estNav > 0 && e.estTime &&
        (!navDate || e.estTime.slice(0, 10) > navDate) &&
        (e.estBase == null || (nav != null && Math.abs(e.estBase - nav) < 1e-6)))
      .sort((a, b) => b.estTime.localeCompare(a.estTime))[0];
    return {
      code: d.FCODE,
      name: d.SHORTNAME || meta[d.FCODE]?.name || d.FCODE,
      type,
      isMoney,
      nav,
      navDate,
      changePct: isMoney ? null : num(d.NAVCHGRT),
      moneyYieldPer10k: isMoney ? num(d.NAV) : null,
      estNav: est?.estNav ?? num(d.GSZ),
      estBase: est?.estBase ?? null,
      estChangePct: est?.estChangePct ?? num(d.GSZZL),
      estTime: est?.estTime ?? d.GZTIME ?? null,
      estSource: est?.estSource ?? null,
    };
  });
}

// 取不晚于 date 的最近一个单位净值。QDII 净值通常晚一到两个交易日，取 30 条足够覆盖长假。
export async function getNavOnOrBefore(code, date) {
  const url =
    `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=${code}&IsShareNet=true` +
    '&pageIndex=1&pageSize=30&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=my-funds';
  const data = await getJson(url);
  const hit = (data.Datas || []).find((d) => d.FSRQ <= date && num(d.DWJZ) != null);
  return hit ? { nav: num(hit.DWJZ), navDate: hit.FSRQ } : null;
}

// 正式净值历史，约覆盖近一年。接口按日期倒序返回。
export async function getNavHistory(code) {
  const url =
    `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=${code}&IsShareNet=true` +
    '&pageIndex=1&pageSize=400&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=my-funds';
  const data = await getJson(url);
  return (data.Datas || [])
    .map((d) => ({ date: d.FSRQ, nav: num(d.DWJZ), pct: num(d.JZZZL) }))
    .filter((d) => d.date && d.nav != null);
}

export async function getNavsOnOrBefore(codes, date) {
  const result = {};
  const queue = [...codes];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      result[code] = await getNavOnOrBefore(code, date).catch(() => null);
    }
  });
  await Promise.all(workers);
  return result;
}

// 指数行情走腾讯接口：东方财富 push2 系列域名会间歇性直接断开连接。
// 代码格式如 sh000001、sz399006、hkHSI、usNDX、usINX。
export async function getIndices(symbols) {
  const valid = symbols.filter((s) => /^(sh|sz|hk|us)[A-Za-z0-9.]+$/.test(s));
  if (!valid.length) return [];
  const res = await fetch(`https://qt.gtimg.cn/q=${valid.join(',')}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`指数行情请求失败 ${res.status}`);
  const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
  return text
    .split(';')
    .map((line) => line.match(/v_([^=]+)="([^"]*)"/))
    .filter((m) => m && m[2])
    .map(([, symbol, body]) => {
      const p = body.split('~');
      return {
        symbol,
        name: p[1],
        price: num(p[3]),
        change: num(p[31]),
        changePct: num(p[32]),
        time: p[30],
      };
    });
}
