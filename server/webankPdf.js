// 微众银行《个人资产证明》解析。
// 每页重复页眉，页眉里的日期和总额在模板文字之后单独成行；明细行形如
// 「大成纳斯达克100ETF联接A(000834) CNY 237.26 / /」，只有金额没有份额。

const AS_OF = /^(\d{4}) (\d{2}) (\d{2}) (\d{2}:\d{2}:\d{2})$/m;
const ITEM = /^(.+?)\((\d{6})\)\s+CNY\s+([\d,]+\.\d{2})\s/gm;

const toNumber = (s) => Number(s.replace(/,/g, ''));

export const isWebankText = (text) => /微众银行|WeBank/.test(text) && /个人资产证明/.test(text);

export function parseWebankText(text) {
  const asOfMatch = text.match(AS_OF);
  if (!asOfMatch) throw new Error('未识别为微众银行个人资产证明');
  const totalMatch = text.slice(asOfMatch.index + asOfMatch[0].length).match(/^\s*([\d,]+\.\d{2})\s*$/m);
  if (!totalMatch) throw new Error('未找到资产证明总额');

  // 同一基金可能因分页重复出现在多页页眉附近，按代码去重
  const seen = new Map();
  for (const m of text.matchAll(ITEM)) {
    const code = m[2];
    if (!seen.has(code)) seen.set(code, { code, name: m[1].trim(), amount: toNumber(m[3]) });
  }
  const funds = [...seen.values()];
  if (!funds.length) throw new Error('资产证明里没有识别到基金明细');

  return {
    source: 'webank',
    asOf: `${asOfMatch[1]}-${asOfMatch[2]}-${asOfMatch[3]}`,
    total: toNumber(totalMatch[1]),
    funds,
    advisors: [],
  };
}
