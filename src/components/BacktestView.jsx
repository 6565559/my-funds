import {useEffect,useMemo,useRef,useState} from 'react';
import {api,AuthRequired} from '../api';
import {today,money} from '../calc';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Badge} from './ui/badge';
import Chart from './Chart';

const states={preparing:'准备历史数据',queued:'等待计算',running:'正在回测',completed:'已完成',failed:'未完成'};
const pending=r=>r && ['preparing','queued','running'].includes(r.status);
const percent=x=>Number.isFinite(x)?`${x.toFixed(2)}%`:'—';
const defaults=()=>({fundCode:'110020',indexCode:'000300.SH',metric:'pe',windowYears:'5',startDate:'2022-01-01',endDate:today(),budget:'100000',parts:'10',buyBelow:'20',feePct:'0.15',drops:'4'});
function Field({label,children}) {return <label className="grid gap-2 text-xs text-muted-foreground">{label}{children}</label>;}
const selectClass='h-9 min-w-0 rounded-md border bg-background px-2 text-sm text-foreground';

export default function BacktestView({active,onAuthRequired}) {
 const [form,setForm]=useState(defaults),[data,setData]=useState(null),[selected,setSelected]=useState(null),[run,setRun]=useState(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[tradeName,setTradeName]=useState('');
 const requestId=useRef(null),auth=useRef(onAuthRequired);auth.current=onAuthRequired;
 useEffect(()=>{
  if(!active)return;
  let live=true,timer;
  async function load() {
   try {
    const next=await api.backtests();if(!live)return;setData(next);
    const id=selected||next.runs[0]?.id;
    if(id){const detail=await api.backtest(id);if(!live)return;setRun(detail);}
    else setRun(null);
    if(next.runs.some(pending)||!next.worker.online)timer=setTimeout(load,3000);
   }catch(e){if(live){if(e instanceof AuthRequired)auth.current?.();else setError(e.message);}}
  }
  setRun(null);load();return()=>{live=false;clearTimeout(timer);};
 },[active,selected,refresh]);
 const change=(key,value)=>{setForm(f=>({...f,[key]:value}));requestId.current=null;};
 async function submit(e) {
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  requestId.current ||= crypto.randomUUID();
  try {
   const result=await api.createBacktest({...form,requestId:requestId.current,budget:Number(form.budget),parts:Number(form.parts),windowYears:Number(form.windowYears),buyBelow:Number(form.buyBelow),feePct:Number(form.feePct),drops:form.drops.split(/[,，]/).map(x=>Number(x.trim()))});
   setSelected(result.id);setRun(result);setRefresh(x=>x+1);requestId.current=null;
  }catch(e){if(e instanceof AuthRequired)auth.current?.();else setError(e.message);}
  finally{setBusy(false);}
 }
 const option=useMemo(()=>{
  const dates=[...new Set(run?.equity?.map(r=>r.date)||[])];
  return {tooltip:{trigger:'axis',valueFormatter:money},legend:{top:0},grid:{left:65,right:20,top:55,bottom:35},
   xAxis:{type:'category',data:dates},yAxis:{type:'value',scale:true,axisLabel:{formatter:v=>`${(v/10000).toFixed(1)}万`}},
   series:(run?.summaries||[]).map(s=>({name:s.name,type:'line',showSymbol:false,data:run.equity.filter(r=>r.name===s.name).map(r=>r.value)}))};
 },[run]);
 const activeName=run?.summaries?.some(s=>s.name===tradeName)?tradeName:run?.summaries?.[0]?.name;
 const trades=run?.orders?.filter(o=>o.name===activeName)||[];
 const coverage=data?.coverage?.find(x=>x.code===form.indexCode&&x.metric===form.metric);
 let earliest=null;
 if(coverage?.first){const date=new Date(`${coverage.first}T00:00:00Z`);date.setUTCFullYear(date.getUTCFullYear()+Number(form.windowYears));date.setUTCDate(date.getUTCDate()+1);earliest=date.toISOString().slice(0,10);}
 return <div className="space-y-6">
  <section className="panel p-5 sm:p-6">
   <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">设置一次回测</h2><Badge variant="outline">VectorBT {data?.worker?.version||'1.2.1'}</Badge></div>
   <form onSubmit={submit} className="space-y-5">
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
     <Field label="基金代码"><Input aria-label="基金代码" value={form.fundCode} onChange={e=>change('fundCode',e.target.value)} pattern="[0-9]{6}" required/></Field>
     <Field label="参考指数"><select aria-label="参考指数" className={selectClass} value={form.indexCode} onChange={e=>change('indexCode',e.target.value)}>{(data?.catalog||[{code:'000300.SH',name:'沪深300'}]).map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
     <Field label="估值指标"><select aria-label="估值指标" className={selectClass} value={form.metric} onChange={e=>change('metric',e.target.value)}><option value="pe">PE · 市盈率</option><option value="pb">PB · 市净率</option></select></Field>
     <Field label="滚动估值窗口"><select aria-label="滚动估值窗口" className={selectClass} value={form.windowYears} onChange={e=>change('windowYears',e.target.value)}><option value="5">5 年</option><option value="10">10 年（需要更早历史）</option></select></Field>
     {[['startDate','开始日期','date'],['endDate','结束日期','date'],['budget','总预算（元，含费用）','number'],['parts','预算份数','number'],['feePct','申购费率（%）','number'],['drops','加仓跌幅（%，逗号分隔可对比）','text']].map(([key,label,type])=><Field key={key} label={label}><Input aria-label={label} type={type} step={key==='parts'?'1':'any'} required value={form[key]} onChange={e=>change(key,e.target.value)}/></Field>)}
     <Field label="买入分位上限"><select aria-label="买入分位上限" className={selectClass} value={form.buyBelow} onChange={e=>change('buyBelow',e.target.value)}><option value="20">20% · 低估</option><option value="50">50% · 含合理偏低</option></select></Field>
    </fieldset>
    <p className="text-xs leading-6 text-muted-foreground">默认使用 5 年滚动分位，与定投计划的 10 年窗口不同。免费估值约从 2016 年开始，回测前需完整预热。参考指数由你选择，基金与指数的对应关系需自行确认；首版不支持货币和 QDII 基金。</p>
    {coverage?.first&&<p className="text-xs text-muted-foreground">当前估值覆盖 {coverage.first} 至 {coverage.last}；{form.windowYears} 年窗口最早约从 {earliest} 回测，还需基金净值及同日信号齐全。</p>}
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy||!data?.worker.online}>{busy?'提交中…':'运行回测'}</Button><span className="text-xs text-muted-foreground">同时对比普通月定投与一次买入，结果存入数据库。</span></div>
   </form>
   {data&&!data.worker.online&&<p role="status" className="mt-3 text-sm text-amber-700">工作进程未就绪，正在等待连接。</p>}
   {error&&<div role="alert" className="mt-4 flex items-center gap-3 text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={()=>{setError('');setRefresh(x=>x+1);}}>刷新状态</Button></div>}
  </section>
  <section className="panel p-5 sm:p-6">
   <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto font-medium">回测记录</h2>{data?.runs.length>0&&<select aria-label="选择回测记录" className={`${selectClass} max-w-full`} value={selected||data.runs[0]?.id||''} onChange={e=>setSelected(e.target.value)}>{data.runs.map(r=><option key={r.id} value={r.id}>{r.fund_name||r.fund_code} · {new Date(r.created_at).toLocaleString('zh-CN')} · {states[r.status]}</option>)}</select>}<Button variant="outline" size="sm" onClick={()=>setRefresh(x=>x+1)}>刷新记录</Button></div>
   {!data?<p className="mt-5 text-sm text-muted-foreground">读取回测记录…</p>:!data.runs.length?<p className="mt-5 text-sm text-muted-foreground">暂无回测记录</p>:!run?<p className="mt-5 text-sm text-muted-foreground">读取结果…</p>:<>
    <div className="mt-5 flex flex-wrap items-center gap-3"><Badge variant="secondary">{states[run.status]}</Badge><span className="text-sm">{run.fund_name||run.fund_code} · {run.start_date} 至 {run.end_date}</span></div>
    <p className="mt-3 text-xs text-muted-foreground">预算 ¥{money(run.budget_cents/100)} · {run.parts} 份 · {run.metric.toUpperCase()} / {run.window_years} 年 · 分位 ≤ {run.buy_below}% · 费率 {run.fee_pct}%</p>
    {pending(run)&&<p role="status" className="mt-5 text-sm text-muted-foreground">{run.status==='preparing'?'正在下载历史数据并保存快照，首次可能需要几分钟。':'正在计算，完成后自动显示结果。'}你可以切换页面，任务会继续。</p>}
    {run.error&&<p role="alert" className="mt-5 text-sm text-destructive">{run.error}</p>}
    {run.status==='completed'&&<>
     <div className="mt-5 overflow-x-auto"><table className="w-full whitespace-nowrap text-right text-sm"><thead className="border-b text-xs text-muted-foreground"><tr>{['策略','期末总资产','总收益','年化收益','最大回撤','累计投入','剩余现金','买入次数'].map(x=><th key={x} className="px-3 py-3 first:text-left">{x}</th>)}</tr></thead><tbody>{run.summaries.map(s=><tr key={s.name} className="border-b"><td className="px-3 py-4 text-left font-medium">{s.name}</td>{[money(s.final_value),percent(s.return_pct),percent(s.annualized_pct),percent(s.drawdown_pct),money(s.spent),money(s.cash),s.buys].map((v,i)=><td key={i} className="amount px-3 py-4">{v}</td>)}</tr>)}</tbody></table></div>
     <p className="my-4 text-xs text-muted-foreground">实际净值区间 {run.actual_start} 至 {run.actual_end} · {run.skipped_days} 天缺少有效估值信号，跌幅策略跳过买入 · 年化按实际日历天计算，短期年化可能失真。</p>
     <Chart label="各策略含现金的总资产曲线" option={option}/>
     <details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm font-medium">买入明细 · 复权净值口径</summary><select aria-label="明细策略" className={`${selectClass} my-4`} value={activeName} onChange={e=>setTradeName(e.target.value)}>{run.summaries.map(s=><option key={s.name}>{s.name}</option>)}</select>
      {!trades.length?<p className="text-sm text-muted-foreground">区间内未触发买入，资金保持现金。</p>:<div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-right text-xs"><thead><tr>{['信号日','成交日','分位','复权净值','投入（含费）','费用'].map(x=><th key={x} className="px-3 py-2">{x}</th>)}</tr></thead><tbody>{trades.map(o=><tr key={o.date} className="border-t">{[o.signal_date,o.date,percent(o.temperature),o.price.toFixed(6),money(o.amount),money(o.fees)].map((v,i)=><td key={i} className="amount px-3 py-3">{v}</td>)}</tr>)}</tbody></table></div>}
     </details>
     <p className="mt-5 break-all text-[11px] text-muted-foreground">引擎 {run.engine_version} · 规则 {run.method_version} · 输入快照 {run.input_hash}</p>
    </>}
   </>}
  </section>
  <section className="rounded-lg border bg-muted/30 p-5 text-xs leading-6 text-muted-foreground"><h2 className="mb-2 font-medium text-foreground">回测口径</h2><p>前一净值日的同日估值分位满足门槛，且复权净值较上次实际模拟成交下跌指定比例后，于下一净值日投入一份；一日最多一份，信号超过 7 天则跳过。月定投在每月首个净值日投入一份，预算用尽即停止。全部预算从起始日可用，闲置现金不计息，期末持有不卖出。</p><p className="mt-2">正式净值与涨幅来自东方财富，估值来自韭圈儿。用日涨幅构造红利再投复权净值，模拟份额不等于实际基金份额；日涨幅精度会带来误差。不模拟限购、暂停申购、确认延迟和个别费率优惠。历史数据可能被来源修订，已完成回测保留独立快照。结果仅用于检验规则，不写入持仓或真实交易。</p></section>
 </div>;
}
