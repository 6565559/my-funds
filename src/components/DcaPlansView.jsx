import { useCallback, useEffect, useRef, useState } from 'react';
import { Info, Plus, RefreshCw, Pause, Play, ArrowUpRight } from 'lucide-react';
import { api, AuthRequired } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from './ui/table';
import { Choice, Modal, EmptyState, PageSkeleton, ConfirmAction } from './shared';

const STATES = {ready:'满足条件',first:'可开始首笔',waiting:'等待下跌',valuation:'等待低估',high:'高估区间',unavailable:'等待数据',paused:'已暂停',exhausted:'预算用完'};
const cash = cents => (cents / 100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const navText = value => value == null ? '—' : value.toLocaleString('zh-CN',{maximumFractionDigits:8});
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes,b => b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function Status({summary}) {
  const color = ['ready','first'].includes(summary.state) ? 'bg-emerald-100 text-emerald-800' : summary.state === 'high' ? 'bg-rose-100 text-rose-800' : '';
  return <Badge variant="secondary" className={`font-normal ${color}`}>{STATES[summary.state]}</Badge>;
}
function Field({label,id,children,...props}) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children || <Input id={id} name={id} {...props}/>}</div>;
}

function PlanEditor({plan,catalog,onClose,onSave,onAuthRequired}) {
  const [query,setQuery] = useState(plan?.fundCode || ''), [picked,setPicked] = useState(null), [matches,setMatches] = useState([]);
  const [indexCode,setIndexCode] = useState(plan?.indexCode || catalog[0]?.code), [metric,setMetric] = useState(plan?.metric || 'pe');
  const [buyBelow,setBuyBelow] = useState(plan?.buyBelow || 20), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const locked = Boolean(plan?.records.length);
  useEffect(() => {
    if (locked || picked || !query.trim()) { setMatches([]); return; }
    let active = true;
    const timer = setTimeout(() => api.search(query.trim()).then(rows => {if(active)setMatches(rows.slice(0,8));}).catch(e => {
      if (!active) return;
      if (e instanceof AuthRequired) onAuthRequired?.(); else setError('基金搜索暂不可用，也可直接输入六位代码');
    }),300);
    return () => {active=false;clearTimeout(timer);};
  },[query,picked,locked,onAuthRequired]);
  async function submit(event) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    const fundCode = picked?.code || query.trim();
    if (!/^\d{6}$/.test(fundCode)) return setError('请选择基金或输入六位基金代码');
    setBusy(true);setError('');
    const payload = {name:f.get('name'),fundCode,indexCode,metric,budget:f.get('budget'),parts:Number(f.get('parts')),buyBelow:Number(buyBelow),capital:f.get('capital') || null};
    try {await onSave(payload);} catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  return <Modal open onOpenChange={open => !open && !busy && onClose()} title={plan ? '编辑定投计划' : '创建定投计划'} description="计划独立记账，不会更改持仓，也不会自动下单。" className="sm:max-w-xl">
    <form className="space-y-5" onSubmit={submit}>
      <Field label="计划名称" id="name" defaultValue={plan?.name || ''} required maxLength={100}/>
      <div className="space-y-2"><Label htmlFor="fund-search">基金名称或代码</Label><Input id="fund-search" value={query} disabled={locked} onChange={e=>{setQuery(e.target.value);setPicked(null);}} placeholder="输入名称或六位代码" required/>
        {locked && <p className="field-help">已有记录，基金绑定不可更换。</p>}
        {!!matches.length && <div className="max-h-40 overflow-y-auto rounded-md border p-1">{matches.map(f=><button type="button" key={f.code} className="block w-full rounded p-2 text-left text-sm hover:bg-muted" onClick={()=>{setPicked(f);setQuery(`${f.code} ${f.name}`);setMatches([]);}}>{f.code} · {f.name}</button>)}</div>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="参考指数" id="index"><Choice label="参考指数" value={indexCode} onChange={setIndexCode} options={catalog.map(i=>[i.code,i.name])} className="w-full"/></Field>
        <Field label="估值指标 · 近10年" id="metric"><Choice label="估值指标" value={metric} onChange={setMetric} options={[["pe","PE-TTM"],["pb","PB-LF"]]} className="w-full"/></Field>
        <Field label="计划总预算（元）" id="budget" type="number" min="0.01" step="0.01" defaultValue={plan ? (plan.budgetCents/100).toFixed(2) : ''} required/>
        <Field label="预算份数" id="parts" type="number" min="1" max="100" step="1" defaultValue={plan?.parts || 10} required/>
        <Field label="买入估值门槛" id="buyBelow"><Choice label="买入估值门槛" value={buyBelow} onChange={setBuyBelow} options={[[20,'不高于20%'],[50,'不高于50%']]} className="w-full"/></Field>
        <Field label="可投资总资金（选填，元）" id="capital" type="number" min="0.01" step="0.01" defaultValue={plan?.capitalCents ? (plan.capitalCents/100).toFixed(2) : ''}/>
      </div>
      <p className="field-help">份数决定标准投入金额，不限制实际记账笔数。单个计划超过可投资总资金40%时会提示集中度。</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy}>{busy?'保存中…':'保存计划'}</Button></div>
    </form>
  </Modal>;
}

function RecordEditor({plan,kind,onClose,onSave}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[id]=useState(requestId);
  const basis=kind==='basis';
  async function submit(event) {
    event.preventDefault();const f=new FormData(event.currentTarget);setBusy(true);setError('');
    const record={requestId:id,date:f.get('date'),nav:f.get('nav')};
    if(basis) record.reason=f.get('reason');else record.amount=f.get('amount');
    try {await onSave(record);}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <Modal open onOpenChange={open=>!open&&!busy&&onClose()} title={basis?'重设触发基准':'记录实际买入'} description={basis?'用于分红或份额折算后的净值校正，原买入记录和已投入金额保持不变。':'请按已确认的实际成交填写。这只是记账，不会发起申购或修改持仓。'}>
    <form className="space-y-5" onSubmit={submit}>
      <p className="text-sm">{plan.fundName} <span className="num text-muted-foreground">{plan.fundCode}</span></p>
      <div className="grid grid-cols-2 gap-4">
        <Field label={basis?'生效日期':'成交日期'} id="date" type="date" required/>
        <Field label={basis?'校正后基准净值':'实际成交净值'} id="nav" type="number" min="0.000001" step="0.000001" required/>
      </div>
      {basis?<Field label="校正原因" id="reason" required maxLength={300} placeholder="例如现金分红、份额折算"/>:<><Field label="实际投入金额（元）" id="amount" type="number" step="0.01" min="0.01" max={plan.summary.remainingCents/100} defaultValue={(plan.summary.nextAmountCents/100).toFixed(2)} required/><p className="field-help">剩余预算 ¥{cash(plan.summary.remainingCents)}。以实际扣款填写，含申购费。</p></>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy}>{busy?'保存中…':basis?'保存基准校正':'保存买入记录'}</Button></div>
    </form>
  </Modal>;
}

function PlanDetails({plan,onClose,onRecord,onEdit,onVoid}) {
  const last=plan.records.filter(r=>!r.voidedAt).at(-1);
  return <Modal open onOpenChange={open=>!open&&onClose()} title={plan.name} description={`${plan.fundCode} · ${plan.fundName} · 买入与基准校正记录`} className="sm:max-w-3xl">
    <div className="flex flex-wrap items-center gap-2"><Status summary={plan.summary}/><span className="text-sm text-muted-foreground">{plan.summary.reason}</span></div>
    <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-4 text-xs">
      <div>已投入<p className="num mt-2 text-base">¥{cash(plan.summary.spentCents)}</p></div>
      <div>剩余预算<p className="num mt-2 text-base">¥{cash(plan.summary.remainingCents)}</p></div>
      <div>下一触发价<p className="num mt-2 text-base">{navText(plan.summary.triggerNav)}</p></div>
    </div>
    <div className="flex flex-wrap gap-2"><Button onClick={()=>onRecord('buy')} disabled={plan.summary.remainingCents<=0}>记录实际买入</Button><Button variant="outline" onClick={()=>onRecord('basis')}>重设触发基准</Button><Button variant="ghost" onClick={onEdit}>编辑计划</Button></div>
    {!plan.records.length?<EmptyState title="尚未记录买入" description="实际成交后记录净值，下一次触发价会以该净值重新计算。"/>:<Table>
      <TableHeader><TableRow>{['生效日期','记录','净值','金额','状态'].map(text=><TableHead key={text} className="whitespace-nowrap text-xs">{text}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{[...plan.records].reverse().map(r=><TableRow key={r.id} className={r.voidedAt?'opacity-45':''}><TableCell className="num whitespace-nowrap text-xs">{r.date}</TableCell><TableCell className="text-xs"><span>{r.kind==='buy'?'实际买入':'基准校正'}</span>{r.reason&&<p className="mt-1 max-w-44 break-words text-muted-foreground">{r.reason}</p>}</TableCell><TableCell className="num text-xs">{navText(r.navMicros/1e6)}</TableCell><TableCell className="num whitespace-nowrap text-xs">{r.amountCents==null?'—':`¥${cash(r.amountCents)}`}</TableCell><TableCell>{r.voidedAt?<span className="text-xs">已撤销</span>:r.id===last?.id?<Button variant="ghost" size="sm" onClick={()=>onVoid(r)}>撤销</Button>:<span className="text-xs text-muted-foreground">已记录</span>}</TableCell></TableRow>)}</TableBody>
    </Table>}
    <p className="field-help">按生效日期和记录顺序确定基准。补记较早交易不会覆盖较晚基准，撤销末条后恢复上一条有效基准。</p>
  </Modal>;
}

export default function DcaPlansView({active,onAuthRequired}) {
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState(null),[selected,setSelected]=useState(null),[confirm,setConfirm]=useState(null);
  const generation=useRef(0), activeRef=useRef(active);activeRef.current=active;
  const reload=useCallback(async(force=false)=>{
    if(!activeRef.current)return;
    const serial=++generation.current;setLoading(true);setError('');
    try {const result=await api.dcaPlans(force);if(serial===generation.current){setData(result);return true;}}
    catch(e){if(serial!==generation.current)return;if(e instanceof AuthRequired)onAuthRequired?.();else setError(e.message);}
    finally{if(serial===generation.current)setLoading(false);}
  },[onAuthRequired]);
  useEffect(()=>{if(active)reload();return()=>{generation.current++;};},[active,reload]);
  async function mutate(operation) {
    try {await operation();setForm(null);await reload();}
    catch(e){
      if(e instanceof AuthRequired)onAuthRequired?.();
      else if(e.status===409&&await reload()) e.message+='；已刷新计划，输入已保留，请核对后再次确认';
      throw e;
    }
  }
  const plans=data?.plans || [], chosen=plans.find(p=>p.id===selected), edited=plans.find(p=>p.id===form?.id);
  const total=plans.reduce((r,p)=>({budget:r.budget+p.budgetCents,spent:r.spent+p.summary.spentCents,ready:r.ready+Number(['ready','first'].includes(p.summary.state))}),{budget:0,spent:0,ready:0});
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">低估时分份投入，每次从实际成交净值再跌 4%。</p><div className="flex gap-2"><Button variant="outline" disabled={loading} onClick={()=>reload(true)}><RefreshCw className={loading?'animate-spin':''}/>更新数据</Button><Button disabled={loading||!data} onClick={()=>setForm({type:'plan'})}><Plus/>新增计划</Button></div></div>
    {error?<div className="panel flex items-center justify-between gap-3 p-5" role="alert"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={()=>reload()}>重试</Button></div>:loading||!data?<PageSkeleton/>:<>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[['计划总预算',`¥${cash(total.budget)}`],['已投入',`¥${cash(total.spent)}`],['本次满足条件',`${total.ready} 个计划`]].map(([label,value])=><section className="panel p-5" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="num mt-3 text-2xl font-medium">{value}</p></section>)}</div>
      {!plans.length?<section className="panel"><EmptyState title="还没有定投计划" description="选择基金和参考指数，设置预算；确认实际买入后才开始计算下一次4%触发价。"/></section>:plans.map(p=><article key={p.id} className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><button className="flex items-center gap-2 text-left font-medium hover:underline" aria-label={`查看${p.name}`} onClick={()=>setSelected(p.id)}>{p.name}<ArrowUpRight className="size-4 text-muted-foreground"/></button><p className="mt-1.5 text-xs text-muted-foreground">{p.fundCode} · {p.fundName}</p><p className="mt-1 text-xs text-muted-foreground">参考 {data.catalog.find(i=>i.code===p.indexCode)?.name} · {p.metric.toUpperCase()}近10年 · 门槛≤{p.buyBelow}%</p></div><div className="flex items-center gap-2"><Status summary={p.summary}/><Button variant="ghost" size="icon" aria-label={`${p.status==='paused'?'恢复':'暂停'}${p.name}`} onClick={()=>mutate(()=>api.updateDcaPlan(p.id,{revision:p.revision,status:p.status==='paused'?'active':'paused'})).catch(e=>setError(e.message))}>{p.status==='paused'?<Play/>:<Pause/>}</Button></div></div>
        <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5 lg:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">正式净值</p><p className="num mt-2 text-lg">{navText(p.quote?.nav)}</p><p className="mt-1 text-[11px] text-muted-foreground">{p.quote?.navDate || '暂无日期'}</p></div>
          <div><p className="text-xs text-muted-foreground">下一触发价 · 跌4%</p><p className="num mt-2 text-lg">{navText(p.summary.triggerNav)}</p><p className="mt-1 text-[11px] text-muted-foreground">{p.summary.anchor?`${p.summary.anchor.kind==='basis'?'校正基准':'成交基准'} ${navText(p.summary.anchor.navMicros/1e6)}`:'等待首笔实际买入'}</p></div>
          <div><p className="text-xs text-muted-foreground">参考估值分位</p><p className="num mt-2 text-lg">{p.valuation?.temperature==null?'—':`${p.valuation.temperature.toFixed(1)}%`}</p><p className="mt-1 text-[11px] text-muted-foreground">{p.valuation?.date || '暂无日期'}{p.valuation?.status&&p.valuation.status!=='ok'?' · 暂不可用于触发':''}</p></div>
          <div><p className="text-xs text-muted-foreground">剩余预算</p><p className="num mt-2 text-lg">¥{cash(p.summary.remainingCents)}</p><p className="mt-1 text-[11px] text-muted-foreground">本次计划 ¥{cash(p.summary.nextAmountCents)}</p></div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4"><p className="text-xs text-muted-foreground">{p.summary.reason}</p><Button variant="outline" size="sm" onClick={()=>setSelected(p.id)}>查看记录</Button></div>
        {p.summary.concentrationWarning&&<p className="mt-3 text-xs text-amber-700">该计划预算超过所填可投资总资金的40%。</p>}
      </article>)}
    </>}
    <div className="flex gap-2 px-1 text-xs leading-6 text-muted-foreground"><Info className="mt-1 size-4 shrink-0"/><div><p>按所填规则展示条件，不代表收益保证。参考指数不等于基金真实估值，正式净值也不是场内ETF成交价。</p><p>分红或份额折算需手动校正触发基准；只有同日且有效的净值与估值才产生提示。不会自动下单，也不会自动修改持仓。</p><p>计划和记录独立保存在数据库，原持仓JSON导出不包含它们。请按部署说明备份整个data目录。</p></div></div>
    {active&&!loading&&!error&&chosen&&!form&&!confirm&&<PlanDetails plan={chosen} onClose={()=>setSelected(null)} onEdit={()=>setForm({type:'plan',id:chosen.id})} onRecord={kind=>setForm({type:kind,id:chosen.id})} onVoid={r=>setConfirm(r.id)}/>}
    {active&&form?.type==='plan'&&<PlanEditor key={form.id||'new'} plan={edited} catalog={data?.catalog||[]} onClose={()=>setForm(null)} onAuthRequired={onAuthRequired} onSave={payload=>mutate(()=>edited?api.updateDcaPlan(edited.id,{...payload,revision:edited.revision}):api.createDcaPlan(payload))}/>}
    {active&&['buy','basis'].includes(form?.type)&&edited&&<RecordEditor plan={edited} kind={form.type} onClose={()=>setForm(null)} onSave={record=>mutate(()=>form.type==='buy'?api.addDcaBuy(edited.id,{...record,revision:edited.revision}):api.updateDcaPlan(edited.id,{revision:edited.revision,basis:record}))}/>}
    {active&&confirm&&chosen&&<ConfirmAction action={{title:'撤销最后一条记录',description:'这条记录将标记为已撤销，预算和触发基准会重新计算。原始记录仍保留，持仓不变。',label:'确认撤销',run:()=>mutate(()=>api.voidDcaRecord(chosen.id,confirm,chosen.revision))}} onClose={()=>setConfirm(null)}/>}
  </div>;
}
