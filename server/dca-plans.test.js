import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDcaDb, createDcaStore } from './dca-store.js';
import { summarizePlan } from './dca-plans.js';
const now = () => Date.parse('2026-11-16T13:00:00Z');
const input = (extra={}) => ({name:'300计划',fundCode:'110020',fundName:'沪深300联接',indexCode:'000300.SH',metric:'pe',budget:'1000.01',parts:10,buyBelow:20,...extra});
function setup(t) { const db=openDcaDb(':memory:');t.after(()=>db.close());return createDcaStore(db,{now}); }
const buy = (revision, extra={}) => ({requestId:randomUUID(),revision,kind:'buy',date:'2026-11-16',nav:'1',amount:'100',...extra});
const quote = {nav:0.96,navDate:'2026-11-16',isMoney:false};
const value = {status:'ok',temperature:20,date:'2026-11-16'};
const summary = (p,q=quote,v=value) => summarizePlan(p,q,v,'2026-11-16');

test('4%以实际成交基准计算且精确边界不误触发', t=>{
 const s=setup(t);let p=s.create(input());
 assert.equal(summary(p).state,'first');
 p=s.addRecord(p.id,buy(p.revision));
 assert.equal(summary(p).triggerNav,0.96);
 assert.equal(summary(p).state,'ready');
 assert.equal(summary(p,{...quote,nav:0.960001}).state,'waiting');
 p=s.addRecord(p.id,buy(p.revision,{nav:'0.95'}));
 assert.equal(summary(p).triggerNav,0.912);
 p=s.addRecord(p.id,buy(p.revision,{nav:'0.96'}));
 assert.equal(summary(p).triggerNav,0.9216);
 assert.equal(summary(p,{...quote,nav:0.5}).nextAmountCents,10000);
 assert.equal(summary(p).spentCents,30000);
});

test('估值门槛、暂停、无效/过期/不同日数据均阻止触发',t=>{
 const s=setup(t);let p=s.create(input({buyBelow:50}));
 for(const temp of [20,50]) assert.equal(summary(p,quote,{...value,temperature:temp}).state,'first');
 assert.equal(summary(p,quote,{...value,temperature:50.00001}).state,'valuation');
 for(const temp of [80,100]) assert.equal(summary(p,quote,{...value,temperature:temp}).state,'high');
 for(const q of [null,{...quote,nav:NaN},{...quote,nav:Infinity},{...quote,nav:0},{...quote,navDate:'2026-11-15'},{...quote,navDate:'2026-11-17'}]) assert.equal(summary(p,q).state,'unavailable');
 for(const status of ['error','cached','insufficient','stale']) assert.equal(summary(p,quote,{...value,status}).state,'unavailable');
 assert.equal(summary(p,{...quote,navDate:'2026-11-01'},{...value,date:'2026-11-01'}).state,'unavailable');
 p=s.update(p.id,{revision:p.revision,status:'paused'});assert.equal(summary(p).state,'paused');
});

test('金额尾差、部分成交笔数与预算上限',t=>{
 const s=setup(t);let p=s.create(input());
 for(let n=0;n<9;n++) p=s.addRecord(p.id,buy(p.revision,{amount:'50'}));
 assert.equal(summary(p).nextAmountCents,10000);
 assert.equal(summary(p).remainingCents,55001);
 assert.throws(()=>s.addRecord(p.id,buy(p.revision,{amount:'550.02'})),e=>e.status===409);
 assert.throws(()=>s.update(p.id,{revision:p.revision,budget:'449'}),e=>e.status===409);
 p=s.addRecord(p.id,buy(p.revision,{amount:'450'}));
 assert.equal(summary(p).nextAmountCents,10001);
 p=s.addRecord(p.id,buy(p.revision,{amount:'100.01'}));
 assert.equal(summary(p).state,'exhausted');assert.equal(summary(p).remainingCents,0);
});

test('重试幂等、载荷冲突、修订冲突及基金归属冻结',t=>{
 const s=setup(t);let p=s.create(input());const request=buy(p.revision);
 p=s.addRecord(p.id,request);
 assert.equal(s.addRecord(p.id,request).records.length,1);
 assert.throws(()=>s.addRecord(p.id,{...request,nav:'0.9'}),e=>e.status===409);
 assert.throws(()=>s.addRecord(p.id,buy(1)),e=>e.status===409);
 assert.throws(()=>s.update(p.id,{revision:p.revision,fundCode:'000001'}),e=>e.status===409);
 assert.equal(s.get(p.id).records.length,1);
});

test('历史补记不会覆盖晚基准，撤销新买入恢复分红校正',t=>{
 const s=setup(t);let p=s.create(input());
 p=s.addRecord(p.id,buy(p.revision,{date:'2026-11-10'}));
 p=s.addRecord(p.id,buy(p.revision,{kind:'basis',date:'2026-11-12',nav:'0.9',amount:undefined,reason:'现金分红'}));
 p=s.addRecord(p.id,buy(p.revision,{date:'2026-11-11',nav:'0.98'}));
 assert.equal(summary(p).anchor.navMicros,900000);assert.equal(summary(p).spentCents,20000);
 p=s.addRecord(p.id,buy(p.revision,{nav:'0.86'}));const latest=summary(p).anchor.id;
 assert.equal(summary(p).triggerNav,0.8256);
 assert.throws(()=>s.voidRecord(p.id,p.records[0].id,{revision:p.revision}),e=>e.status===409);
 p=s.voidRecord(p.id,latest,{revision:p.revision});
 assert.equal(summary(p).anchor.navMicros,900000);assert.equal(summary(p).spentCents,20000);
 assert.equal(p.records.filter(r=>r.voidedAt).length,1);
});

test('日期、精度、金额和未知字段严格校验，事务失败后保留记录',t=>{
 const s=setup(t);let p=s.create(input());
 for(const x of [{budget:'NaN'},{budget:'1.001'},{budget:Infinity},{budget:'0'},{parts:101},{parts:1.5},{budget:'0.01',parts:10},{buyBelow:80},{indexCode:'bad'},{metric:'ps'},{fundCode:'../x'},{spentCents:0}]) assert.throws(()=>s.create(input(x)));
 for(const x of [{date:'2026-02-30'},{date:'2026-11-17'},{nav:'0'},{nav:'0.1234567'},{amount:'-1'},{nav:Infinity},{requestId:'bad'},{kind:'basis',reason:''},{hacked:true}]) assert.throws(()=>s.addRecord(p.id,buy(p.revision,x)));
 assert.equal(s.get(p.id).records.length,0);
 p=s.addRecord(p.id,buy(p.revision));assert.equal(p.revision,2);
 assert.throws(()=>s.get('missing'),e=>e.status===404);
});

test('SQLite重开仍保留计划和记录，旧修订不可覆盖',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'funds-dca-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'plans.sqlite');let db=openDcaDb(file),s=createDcaStore(db,{now});
 let p=s.create(input());p=s.addRecord(p.id,buy(p.revision));db.close();
 db=openDcaDb(file);t.after(()=>db.close());s=createDcaStore(db,{now});
 assert.equal(s.get(p.id).records.length,1);assert.equal(s.list().length,1);
 assert.equal(summary(s.get(p.id)).remainingCents,90001);
});
