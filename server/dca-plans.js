import { dateValid, units } from './dca-store.js';

export function summarizePlan(plan, quote, valuation, today) {
  const records = plan.records.filter(r => !r.voidedAt);
  const anchor = records.at(-1) || null;
  const spentCents = records.filter(r => r.kind === 'buy').reduce((n,r) => n + r.amountCents,0);
  const remainingCents = plan.budgetCents - spentCents;
  const amount = Math.floor(plan.budgetCents / plan.parts), tail = plan.budgetCents % plan.parts;
  const result = { spentCents, remainingCents, nextAmountCents:remainingCents <= amount + tail ? remainingCents : amount,
    anchor, lastBuy:records.filter(r => r.kind === 'buy').at(-1) || null,
    triggerNav:anchor ? anchor.navMicros * 96 / 100 / 1e6 : null,
    concentrationWarning:plan.capitalCents != null && plan.budgetCents * 100 > plan.capitalCents * 40 };
  const state = (id,reason) => ({...result,state:id,reason});
  if (plan.status === 'paused') return state('paused','计划已暂停');
  if (remainingCents <= 0) return state('exhausted','预算已用完');
  let navMicros;
  try { navMicros = units(quote?.nav,6,'净值'); } catch { return state('unavailable','暂无有效正式净值'); }
  const date = quote.navDate;
  if (quote.isMoney || !dateValid(date) || date > today || Date.parse(today)-Date.parse(date) > 7*86400000 ||
    !valuation || valuation.status !== 'ok' || !Number.isFinite(valuation.temperature) || valuation.temperature < 0 || valuation.temperature > 100) {
    return state('unavailable','净值或估值数据缺失、无效或过期');
  }
  if (date !== valuation.date) return state('unavailable','等待净值与估值更新到同一日期');
  if (anchor && date < anchor.date) return state('unavailable','行情早于已记录的基准日期');
  if (valuation.temperature >= 80) return state('high','参考指数进入高估区间');
  if (valuation.temperature > plan.buyBelow) return state('valuation',`估值高于${plan.buyBelow}%买入门槛`);
  if (!anchor) return state('first','满足估值条件，可开始首笔记录');
  // shortcut: 单位净值未自动复权；遇分红或份额折算需手动校正基准，接入复权数据后再自动处理。
  if (navMicros * 100 <= anchor.navMicros * 96) return state('ready','估值与下跌4%条件均满足');
  return state('waiting','尚未跌至下一次触发价');
}

import { fail, chinaDay, validatePlan, validatePatch } from './dca-store.js';
import { INDEX_CATALOG } from './index-valuations.js';

export function createDcaService({store, getQuotes, getFundTypes, valuations, now = Date.now}) {
  let cached = null, pending = null, pendingKey = null;
  async function market(plans, force) {
    if (!plans.length) return {quotes:[],values:[]};
    const codes = [...new Set(plans.map(p => p.fundCode))].sort(), key = codes.join(',');
    if (pending && pendingKey === key) return pending;
    if (!force && cached?.key === key && now() < cached.expires) return cached.data;
    const promise = (async () => {
      const [q,v] = await Promise.allSettled([getQuotes(codes),valuations.list({window:'10y',metric:'pe',refresh:force})]);
      const data = { quotes:q.status === 'fulfilled' && Array.isArray(q.value) ? q.value : [],
        values:v.status === 'fulfilled' ? v.value.rows || [] : [], source:v.status === 'fulfilled' ? v.value.source : null };
      cached = {key,data,expires:now() + (q.status === 'fulfilled' && v.status === 'fulfilled' ? 60000 : 15000)};
      return data;
    })();
    pending = promise; pendingKey = key;
    try { return await promise; } finally { if (pending === promise) { pending = null; pendingKey = null; } }
  }
  const decorate = (p, data) => {
    const q = data.quotes.find(q => q.code === p.fundCode);
    const quote = q ? {nav:q.nav,navDate:q.navDate,isMoney:q.isMoney,name:q.name} : null;
    const valuation = data.values.find(v => v.code === p.indexCode)?.[p.metric] || null;
    return {...p,quote,valuation,summary:summarizePlan(p,quote,valuation,chinaDay(now()))};
  };
  async function checkFund(code) {
    let info;
    try { info = (await getFundTypes([code]))[code]; } catch { fail('暂时无法验证基金，请稍后重试',503); }
    if (!info?.type || !info?.name) fail('未找到基金类型，请核对代码或稍后重试',400);
    if (info.type.startsWith('货币型')) fail('货币基金不支持4%定投计划');
    return info;
  }
  return {
    async list({refresh = false} = {}) {
      const plans = store.list(), data = await market(plans,refresh);
      return {plans:plans.map(p => decorate(p,data)),catalog:INDEX_CATALOG,source:data.source || null};
    },
    async get(id) {
      store.get(id);
      const plans = store.list(), data = await market(plans,false);
      return decorate(plans.find(p => p.id === id),data);
    },
    async create(input) {
      const parsed = validatePlan(input), info = await checkFund(parsed.fundCode);
      return store.create({...input,fundName:info.name});
    },
    async update(id,input) {
      const p = store.get(id);
      if (!input?.basis) {
        const next = validatePatch(p,input);
        if (next.fundCode !== p.fundCode) {
          const info = await checkFund(next.fundCode);
          input = {...input,fundName:info.name};
        }
      }
      return store.update(id,input);
    },
    buy: (id,input) => {
      if (input?.kind !== undefined) fail('买入接口不接受记录类型');
      return store.addRecord(id,{...input,kind:'buy'});
    },
    voidRecord: (id,recordId,input) => store.voidRecord(id,recordId,input),
  };
}

export function installDcaRoutes(app,service) {
  const route = fn => async (req,res) => {
    res.set('Cache-Control','no-store');
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({error:e.status ? e.message : '定投服务暂时不可用'}); }
  };
  app.get('/api/dca-plans',route(req => {
    if (Object.keys(req.query).some(k => k !== 'refresh') || req.query.refresh !== undefined && req.query.refresh !== '1') fail('无效的刷新参数');
    return service.list({refresh:req.query.refresh === '1'});
  }));
  app.post('/api/dca-plans',route(req => service.create(req.body)));
  app.get('/api/dca-plans/:id',route(req => service.get(req.params.id)));
  app.patch('/api/dca-plans/:id',route(req => service.update(req.params.id,req.body)));
  app.post('/api/dca-plans/:id/buys',route(req => service.buy(req.params.id,req.body)));
  app.post('/api/dca-plans/:id/records/:recordId/void',route(req => service.voidRecord(req.params.id,req.params.recordId,req.body)));
}
