import { randomUUID } from 'node:crypto';
import { emptyPortfolio } from './store.js';

const UNGROUPED = '未分类';

export const ACCOUNTS = { xueqiu: '雪球基金', webank: '微众银行', manual: '手动记录' };
// 账户字段出现之前的持仓都来自雪球证明或插件配置，统一视为雪球账户
export const accountOf = (f) => (ACCOUNTS[f.account] ? f.account : 'xueqiu');

const newGroup = (name, extra = {}) => ({
  id: randomUUID(),
  name,
  kind: 'normal',
  target: null,
  collapsed: false,
  funds: [],
  ...extra,
});

const toShares = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function normalizePortfolio(input) {
  const base = emptyPortfolio();
  const portfolio = { ...base, ...input, settings: { ...base.settings, ...input?.settings } };
  if (!Array.isArray(portfolio.groups)) throw new Error('groups 必须是数组');
  portfolio.groups = portfolio.groups.map((g) => ({
    ...newGroup(String(g.name || UNGROUPED)),
    ...g,
    id: g.id || randomUUID(),
    funds: (g.funds || [])
      .filter((f) => /^\d{6}$/.test(String(f.code)))
      .map((f) => ({
        code: String(f.code),
        shares: toShares(f.shares),
        ...(f.cost ? { cost: Number(f.cost) } : {}),
        ...(ACCOUNTS[f.account] ? { account: f.account } : {}),
      })),
  }));
  return portfolio;
}

// 自选基金助手浏览器扩展导出的配置 -> 本应用组合
export function fromExtensionConfig(config, current) {
  const groups = Array.isArray(config.fundListGroup) && config.fundListGroup.length
    ? config.fundListGroup
    : [{ name: '默认分组', funds: config.fundListM || [] }];

  const next = normalizePortfolio({
    ...current,
    groups: groups.map((g) =>
      newGroup(g.name, {
        kind: /投顾/.test(g.name) ? 'advisor' : 'normal',
        funds: (g.funds || []).map((f) => ({ code: f.code, shares: f.num, cost: f.cost })),
      }),
    ),
  });
  const { fundListGroup, fundListM, fundList, ...rest } = config;
  next.extensionMeta = rest;
  return next;
}

// 本应用组合 -> 可被浏览器扩展「导入配置」的 JSON
export function toExtensionConfig(portfolio) {
  const meta = portfolio.extensionMeta || {};
  // 插件不区分账户，同一分组里多个账户持有的同一基金合并成一条；成本按份额加权
  const fundListGroup = portfolio.groups.map((g) => {
    const merged = new Map();
    for (const f of g.funds) {
      const m = merged.get(f.code) || { code: f.code, shares: 0, costAmount: 0, costShares: 0 };
      m.shares += f.shares;
      if (f.cost) {
        m.costAmount += f.cost * f.shares;
        m.costShares += f.shares;
      }
      merged.set(f.code, m);
    }
    return {
      name: g.name,
      funds: [...merged.values()].map((m) => ({
        code: m.code,
        num: String(Math.round(m.shares * 100) / 100),
        ...(m.costShares ? { cost: String(Math.round((m.costAmount / m.costShares) * 10000) / 10000) } : {}),
      })),
    };
  });
  const allCodes = new Set(fundListGroup.flatMap((g) => g.funds.map((f) => f.code)));
  const realtime = allCodes.has(meta.RealtimeFundcode) ? meta.RealtimeFundcode : fundListGroup[0]?.funds[0]?.code;
  return {
    ...meta,
    RealtimeFundcode: realtime,
    RealtimeFundcodeGroupIndex: Math.max(0, fundListGroup.findIndex((g) => g.funds.some((f) => f.code === realtime))),
    currentGroupIndex: 0,
    fundList: [],
    fundListGroup,
    version: meta.version || '3.4.4',
  };
}

// 分组绑在基金代码上：任意账户里出现过的代码，都记住它所在的非投顾分组
function groupByCode(portfolio) {
  const map = new Map();
  for (const g of portfolio.groups) {
    if (g.kind === 'advisor') continue;
    for (const f of g.funds) {
      if (!map.has(f.code)) map.set(f.code, { id: g.id, name: g.name });
    }
  }
  return map;
}

// 计算导入资产证明会带来的变化。该账户会被证明全量覆盖，分组按基金代码回到原分组。
export function diffCertificate(portfolio, cert) {
  const account = cert.source;
  const directGroups = portfolio.groups.filter((g) => g.kind !== 'advisor');
  const binding = groupByCode(portfolio);
  const held = new Map();
  for (const g of directGroups) {
    for (const f of g.funds) {
      if (accountOf(f) === account && !held.has(f.code)) held.set(f.code, { group: g.name, shares: f.shares });
    }
  }

  const certCodes = new Set(cert.funds.map((f) => f.code));
  const updated = [];
  const added = [];
  for (const f of cert.funds) {
    const old = held.get(f.code);
    const bound = binding.get(f.code);
    if (!old) {
      added.push({ code: f.code, shares: f.shares, value: f.value, group: bound?.name || null, groupId: bound?.id || null });
    } else if (Math.abs(old.shares - f.shares) > 0.001) {
      updated.push({ code: f.code, group: bound?.name || old.group, from: old.shares, to: f.shares, value: f.value });
    }
  }
  const missing = [...held.entries()]
    .filter(([code]) => !certCodes.has(code))
    .map(([code, v]) => ({ code, group: v.group, shares: v.shares }));

  const advisors = cert.advisors.map((a) => {
    const g = findAdvisorGroup(portfolio, a);
    return {
      code: a.code,
      name: a.name,
      group: g?.name || null,
      fundCount: a.funds.length,
      value: Math.round(a.funds.reduce((s, f) => s + f.value, 0) * 100) / 100,
    };
  });

  const otherAccounts = directGroups.reduce(
    (n, g) => n + g.funds.filter((f) => accountOf(f) !== account).length,
    0,
  );

  return { account, accountName: ACCOUNTS[account], updated, added, missing, advisors, untouched: otherAccounts };
}

function findAdvisorGroup(portfolio, advisor) {
  const advisorGroups = portfolio.groups.filter((g) => g.kind === 'advisor');
  return (
    advisorGroups.find((g) => g.advisorCode === advisor.code) ||
    advisorGroups.find((g) => g.name.includes(advisor.name)) ||
    (advisorGroups.length === 1 && !advisorGroups[0].advisorCode ? advisorGroups[0] : null)
  );
}

function groupFor(portfolio, bound, newGroupId) {
  return (
    (bound && portfolio.groups.find((g) => g.id === bound.id && g.kind !== 'advisor')) ||
    portfolio.groups.find((g) => g.kind !== 'advisor' && g.id === newGroupId) ||
    portfolio.groups.find((g) => g.kind !== 'advisor' && g.name === UNGROUPED) ||
    null
  );
}

// 用证明全量覆盖该账户：先删掉这个账户的自持基金，再按基金代码放回原来的分组。
// 投顾组合不参与代码分组，整组替换。其他账户和手动记录不动，已填的成本价保留。
export function applyCertificate(portfolio, cert, { newGroupId = null } = {}) {
  const account = cert.source;
  if (!ACCOUNTS[account]) throw new Error('未知的资产证明来源');
  const next = structuredClone(portfolio);
  const binding = groupByCode(next);
  const costs = new Map();
  for (const g of next.groups) {
    if (g.kind === 'advisor') continue;
    for (const f of g.funds) {
      if (accountOf(f) === account && f.cost) costs.set(f.code, f.cost);
    }
  }

  for (const g of next.groups) {
    if (g.kind === 'advisor') continue;
    g.funds = g.funds.filter((f) => accountOf(f) !== account);
  }

  for (const f of cert.funds) {
    let bucket = groupFor(next, binding.get(f.code), newGroupId);
    if (!bucket) {
      bucket = newGroup(UNGROUPED);
      next.groups.push(bucket);
    }
    const cost = costs.get(f.code);
    bucket.funds.push({ code: f.code, shares: f.shares, account, ...(cost ? { cost } : {}) });
  }

  for (const a of cert.advisors) {
    let g = findAdvisorGroup(next, a);
    if (!g) {
      g = newGroup(`投顾-${a.name}`, { kind: 'advisor', advisorCode: a.code, advisorName: a.name });
      next.groups.push(g);
    }
    g.kind = 'advisor';
    g.advisorCode = a.code;
    g.advisorName = a.name;
    g.funds = a.funds.map((f) => ({ code: f.code, shares: f.shares, account }));
  }

  next.imports = {
    ...(next.imports || {}),
    [account]: { asOf: cert.asOf, total: cert.total, at: new Date().toISOString() },
  };
  return next;
}
