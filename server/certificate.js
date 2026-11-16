import { extractText, getDocumentProxy } from 'unpdf';
import { isXueqiuText, parseCertificateText } from './xueqiuPdf.js';
import { isWebankText, parseWebankText } from './webankPdf.js';
import { getNavsOnOrBefore } from './quotes.js';

const round2 = (n) => Math.round(n * 100) / 100;

// 微众证明只有金额，按证明日期当天或之前最近的净值折算成份额；
// 银行估值用的也是当时已公布的最新净值，所以折算结果与 App 内份额基本一致。
async function fillWebankShares(cert) {
  const navs = await getNavsOnOrBefore(
    cert.funds.map((f) => f.code),
    cert.asOf,
  );
  const missing = cert.funds.filter((f) => !navs[f.code]).map((f) => f.code);
  if (missing.length) throw new Error(`以下基金查不到 ${cert.asOf} 前的净值，无法折算份额：${missing.join(', ')}`);
  cert.funds = cert.funds.map((f) => {
    const { nav, navDate } = navs[f.code];
    return { ...f, nav, navDate, shares: round2(f.amount / nav), value: f.amount };
  });
  cert.computedTotal = round2(cert.funds.reduce((s, f) => s + f.amount, 0));
  return cert;
}

export async function parseCertificatePdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  if (isWebankText(text)) return fillWebankShares(parseWebankText(text));
  if (isXueqiuText(text)) return parseCertificateText(text);
  throw new Error('无法识别的资产证明，目前支持雪球基金《资产证明书》和微众银行《个人资产证明》');
}
