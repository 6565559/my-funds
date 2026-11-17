import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {INDEX_CATALOG} from './index-valuations.js';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const validDate=x=>typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10)===x;
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
export function openBacktestDb(file) {
 if(file!==':memory:')mkdirSync(path.dirname(file),{recursive:true});
 const db=new DatabaseSync(file);db.exec(readFileSync(new URL('../backtest/schema.sql',import.meta.url),'utf8'));return db;
}
export function validateBacktest(p) {
 if(!p || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(p.requestId||''))fail('请求标识无效');
 if(!/^\d{6}$/.test(p.fundCode||'') || !INDEX_CATALOG.some(x=>x.code===p.indexCode))fail('基金或参考指数无效');
 if(!['pe','pb'].includes(p.metric) || ![5,10].includes(p.windowYears))fail('估值指标或窗口无效');
 if(!validDate(p.startDate)||!validDate(p.endDate)||p.startDate<'2010-01-01'||p.startDate>=p.endDate||p.endDate>today())fail('日期无效或超出范围');
 if(typeof p.budget!=='number'||!Number.isFinite(p.budget)||p.budget<1||p.budget>1e8||Math.abs(p.budget*100-Math.round(p.budget*100))>1e-6)fail('预算应为 1 至 1 亿的金额，最多两位小数');
 if(!Number.isInteger(p.parts)||p.parts<1||p.parts>100)fail('份数应为 1–100');
 if(![20,50].includes(p.buyBelow))fail('买入分位上限应为 20 或 50');
 if(typeof p.feePct!=='number'||!Number.isFinite(p.feePct)||p.feePct<0||p.feePct>5)fail('费率应为 0–5%');
 if(!Array.isArray(p.drops)||!p.drops.length||p.drops.length>5||p.drops.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<1||x>20))fail('跌幅参数应为 1–20%，最多 5 个');
 return {fundCode:p.fundCode,indexCode:p.indexCode,metric:p.metric,windowYears:p.windowYears,startDate:p.startDate,endDate:p.endDate,budgetCents:Math.round(p.budget*100),parts:p.parts,buyBelow:p.buyBelow,feePct:p.feePct,drops:[...new Set(p.drops)].sort((a,b)=>a-b)};
}

export async function fetchNavRange(code,start,fetcher=fetch) {
 const rows=new Map();let previousOldest=null;
 for(let page=1;page<=20;page++) {
  const url=`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=${code}&IsShareNet=true&pageIndex=${page}&pageSize=400&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=my-funds`;
  const response=await fetcher(url,{headers:{Referer:'https://fund.eastmoney.com/'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)fail('基金历史净值暂时不可用');
  const data=await response.json();
  if(data.Success!==true||!Array.isArray(data.Datas)||!data.Datas.length)fail('基金历史净值返回异常');
  for(const d of data.Datas) {
   const nav=Number(d.DWJZ),pct=d.JZZZL==null||d.JZZZL===''||d.JZZZL==='--'?null:Number(d.JZZZL);
   if(!validDate(d.FSRQ)||!Number.isFinite(nav)||nav<=0)fail('基金历史净值含无效记录');
   rows.set(d.FSRQ,{date:d.FSRQ,nav,pct:Number.isFinite(pct)?pct:null});
  }
  const sorted=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const oldest=sorted[0].date;
  if(oldest<start || rows.size>=Number(data.TotalCount))return sorted;
  if(previousOldest && oldest>=previousOldest)fail('基金历史分页没有前进');
  previousOldest=oldest;
 }
 fail('基金历史超过分页上限，请缩短回测区间');
}

export function createBacktestService({db,valuations,readValuations,getFundTypes,fetcher=fetch}) {
 const pending=new Set();
 db.prepare("UPDATE runs SET status='failed',error='服务重启中断了数据准备，请重新运行',finished_at=? WHERE status='preparing'").run(Date.now());
 function worker() {const w=db.prepare('SELECT * FROM worker_health WHERE id=1').get();return {online:!!w && Date.now()-w.heartbeat<30000,version:w?.version||null};}
 function get(id) {
  const row=db.prepare('SELECT * FROM runs WHERE id=?').get(id);if(!row)fail('回测不存在',404);
  return {...row,variants:db.prepare('SELECT name,mode,drop_pct FROM variants WHERE run_id=? ORDER BY rowid').all(id),summaries:db.prepare('SELECT * FROM summaries WHERE run_id=? ORDER BY rowid').all(id),equity:db.prepare('SELECT name,date,value,cash FROM equity WHERE run_id=? ORDER BY date,name').all(id),orders:db.prepare('SELECT name,date,signal_date,temperature,price,units,amount,fees FROM orders WHERE run_id=? ORDER BY date,name').all(id)};
 }
 async function prepare(id,p) {
  try {
   const meta=(await getFundTypes([p.fundCode]))[p.fundCode];
   if(!meta?.type||/货币|QDII/i.test(meta.type))fail('首版仅支持有明确类型的国内非货币基金，不支持 QDII');
   await valuations.list({window:'10y',metric:p.metric});
   const values=readValuations(p.indexCode,p.metric).filter(x=>x.date<=p.endDate);
   const warmStart=new Date(`${p.startDate}T00:00:00Z`);warmStart.setUTCFullYear(warmStart.getUTCFullYear()-p.windowYears);
   if(!values.length || values[0].date>warmStart.toISOString().slice(0,10)||values.length<200*p.windowYears)fail(`估值历史不足 ${p.windowYears} 年预热；请将开始日后移或明确改用 5 年窗口`);
   let prices;const sync=db.prepare('SELECT * FROM nav_sync WHERE code=?').get(p.fundCode);
   if(sync && Date.now()-sync.fetched_at<6*3600000 && sync.start_date<p.startDate)prices=db.prepare('SELECT date,nav,pct FROM nav_cache WHERE code=? ORDER BY date').all(p.fundCode);
   else {
    prices=await fetchNavRange(p.fundCode,p.startDate,fetcher);
    db.exec('BEGIN IMMEDIATE');
    try {
     const save=db.prepare('INSERT INTO nav_cache VALUES (?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET nav=excluded.nav,pct=excluded.pct');
     for(const r of prices)save.run(p.fundCode,r.date,r.nav,r.pct);
     db.prepare('INSERT INTO nav_sync VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET fetched_at=excluded.fetched_at,start_date=excluded.start_date').run(p.fundCode,Date.now(),prices[0].date);db.exec('COMMIT');
    } catch(e){db.exec('ROLLBACK');throw e;}
   }
   const before=prices.filter(x=>x.date<p.startDate).at(-1);
   prices=prices.filter(x=>x.date>=p.startDate && x.date<=p.endDate);
   if(!before||prices.length<2||Date.parse(prices[0].date)-Date.parse(p.startDate)>7*864e5||Date.parse(p.endDate)-Date.parse(prices.at(-1).date)>7*864e5)fail('基金净值不能覆盖请求区间，请调整日期');
   if(prices.some(x=>x.pct==null||x.pct<=-100||Math.abs(x.pct)>50))fail('区间内日收益率缺失或异常，无法可靠复权');
   prices.unshift(before);
   db.exec('BEGIN IMMEDIATE');
   try {
    const saveP=db.prepare('INSERT INTO input_prices VALUES (?,?,?,?)'),saveV=db.prepare('INSERT INTO input_valuations VALUES (?,?,?)');
    for(const r of prices)saveP.run(id,r.date,r.nav,r.pct);
    for(const r of values)saveV.run(id,r.date,r.value);
    db.prepare("UPDATE runs SET status='queued',fund_name=?,input_hash=? WHERE id=?").run(meta.name,hash({p,prices,values}),id);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  }catch(e){db.prepare("UPDATE runs SET status='failed',error=?,finished_at=? WHERE id=?").run(e.message.slice(0,400),Date.now(),id);}
 }
 return {
  list(){return {runs:db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 50').all(),catalog:INDEX_CATALOG,worker:worker(),coverage:INDEX_CATALOG.flatMap(index=>['pe','pb'].map(metric=>{
   const rows=readValuations(index.code,metric);return {code:index.code,metric,first:rows[0]?.date||null,last:rows.at(-1)?.date||null};
  }))};},get,
  idle:()=>Promise.all([...pending]),
  create(body) {
   const p=validateBacktest(body),requestHash=hash(p),id=body.requestId;
   const old=db.prepare('SELECT request_hash FROM runs WHERE id=?').get(id);
   if(old){if(old.request_hash!==requestHash)fail('重复请求标识对应了不同参数',409);return get(id);}
   if(!worker().online)fail('回测工作进程未就绪，请稍后重试',503);
   if(db.prepare("SELECT COUNT(*) n FROM runs WHERE status IN ('preparing','queued','running')").get().n>=3)fail('已有 3 个待完成任务，请稍后再试',429);
   db.exec('BEGIN IMMEDIATE');
   try {
    db.prepare(`INSERT INTO runs(id,request_hash,created_at,status,fund_code,index_code,metric,window_years,start_date,end_date,budget_cents,parts,buy_below,fee_pct)
     VALUES (?,?,?,'preparing',?,?,?,?,?,?,?,?,?,?)`).run(id,requestHash,Date.now(),p.fundCode,p.indexCode,p.metric,p.windowYears,p.startDate,p.endDate,p.budgetCents,p.parts,p.buyBelow,p.feePct);
    const add=db.prepare('INSERT INTO variants VALUES (?,?,?,?)');
    for(const drop of p.drops)add.run(id,`下跌 ${drop}% 定投`,'dip',drop);
    add.run(id,'普通月定投','monthly',0);add.run(id,'一次买入','lump',0);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   const task=prepare(id,p).finally(()=>pending.delete(task));pending.add(task);return get(id);
  },
 };
}
export function installBacktestRoutes(app,service) {
 const route=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{res.json(await fn(req));}catch(e){res.status(e.status||400).json({error:e.message});}};
 app.get('/api/backtests',route(()=>service.list()));
 app.post('/api/backtests',route(req=>service.create(req.body)));
 app.get('/api/backtests/:id',route(req=>service.get(req.params.id)));
}
