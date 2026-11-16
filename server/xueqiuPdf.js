// 雪球基金《资产证明书》解析。
// 表格跨页、投顾表在 PDF 中按列排布，文本顺序不可靠，因此不依赖行结构：
// 分别按出现顺序提取基金代码与「份额 净值 日期」三元组，再按顺序配对，
// 并用 份额 × 净值 ≈ 市值 做校验。

const ADVISOR_MARKER = /投顾资产明细/;
const FUND_CODE = /(?<![\dA-Za-z.,\-])\d{6}(?![\dA-Za-z.,\-])/g;
const TRIPLE = /([\d,]+\.\d{2})\s*(\d+\.\d{4})\s*(\d{4}-\d{2}-\d{2})/g;
const ADVISOR_CODE = /TIAA\d+/g;

const toNumber = (s) => Number(s.replace(/,/g, ''));

function parseSection(text) {
  const codes = [...text.matchAll(FUND_CODE)].map((m) => m[0]);
  const triples = [...text.matchAll(TRIPLE)].map((m) => ({
    shares: toNumber(m[1]),
    nav: Number(m[2]),
    navDate: m[3],
  }));
  if (codes.length !== triples.length) {
    throw new Error(`基金代码数量(${codes.length})与持仓记录数量(${triples.length})不一致，无法可靠解析`);
  }
  return codes.map((code, i) => ({
    code,
    ...triples[i],
    value: Math.round(triples[i].shares * triples[i].nav * 100) / 100,
  }));
}

function parseAdvisorName(text, advisorCode) {
  const start = text.indexOf(advisorCode) + advisorCode.length;
  const rest = text.slice(start);
  const next = rest.search(FUND_CODE);
  const name = (next >= 0 ? rest.slice(0, next) : rest).replace(/\s+/g, '');
  return name || advisorCode;
}

export const isXueqiuText = (text) => /雪球基金/.test(text) && /资产证明书/.test(text);

export function parseCertificateText(text) {
  const asOfMatch = text.match(/截止到(\d{4})年(\d{2})月(\d{2})日/);
  const totalMatch = text.match(/人民币\s*([\d,]+\.\d{2})\s*元/);
  if (!asOfMatch || !totalMatch) {
    throw new Error('未识别为雪球基金资产证明书');
  }

  const markerIndex = text.search(ADVISOR_MARKER);
  const detailStart = text.search(/基金资产明细/);
  const directText = text.slice(detailStart, markerIndex >= 0 ? markerIndex : undefined);
  const advisorText = markerIndex >= 0 ? text.slice(markerIndex) : '';

  const funds = parseSection(directText);

  const advisors = [];
  if (advisorText) {
    const advisorCodes = [...new Set([...advisorText.matchAll(ADVISOR_CODE)].map((m) => m[0]))];
    if (advisorCodes.length > 1) {
      throw new Error(`暂不支持多个投顾组合(${advisorCodes.join(', ')})`);
    }
    const advisorFunds = parseSection(advisorText.replace(ADVISOR_CODE, ' '));
    if (advisorCodes.length === 1) {
      advisors.push({
        code: advisorCodes[0],
        name: parseAdvisorName(advisorText, advisorCodes[0]),
        funds: advisorFunds,
      });
    }
  }

  const total = toNumber(totalMatch[1]);
  const computed = [...funds, ...advisors.flatMap((a) => a.funds)].reduce((s, f) => s + f.value, 0);

  return {
    source: 'xueqiu',
    asOf: `${asOfMatch[1]}-${asOfMatch[2]}-${asOfMatch[3]}`,
    total,
    computedTotal: Math.round(computed * 100) / 100,
    funds,
    advisors,
  };
}