import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { installAuth } from './auth.js';
import { openDcaDb, createDcaStore } from './dca-store.js';
import { createDcaService, installDcaRoutes } from './dca-plans.js';
const input={name:'计划',fundCode:'110020',indexCode:'000300.SH',metric:'pe',budget:'1000',parts:10,buyBelow:20};
function setup(t,overrides={}) {
 const db=openDcaDb(':memory:');t.after(()=>db.close());let time=Date.parse('2026-11-16T13:00:00Z');
 const store=createDcaStore(db,{now:()=>time});const calls={quotes:0,types:0,values:0};
 const service=createDcaService({store,now:()=>time,
  getFundTypes:async codes=>{calls.types++;return Object.fromEntries(codes.map(code=>[code,{name:'基金',type:'指数型-股票'}]));},
  getQuotes:async codes=>{calls.quotes++;return codes.map(code=>({code,nav:1,navDate:'2026-11-16',isMoney:false}));},
  valuations:{list:async()=>{calls.values++;return{rows:[{code:'000300.SH',pe:{status:'ok',temperature:10,date:'2026-11-16'}}]};}},...overrides});
 return {service,store,calls,advance:n=>time+=n};
}
test('空计划不联网，批量行情缓存合并，强制刷新失败不复用旧触发',async t=>{
 let broken=false,quotesCalls=0;const {service,calls,advance}=setup(t,{getQuotes:async codes=>{quotesCalls++;if(broken)throw Error('offline');return codes.map(code=>({code,nav:1,navDate:'2026-11-16'}));}});
 assert.equal((await service.list()).plans.length,0);assert.equal(quotesCalls,0);
 const p=await service.create(input);
 assert.equal(p.fundName,'基金');
 const [a,b]=await Promise.all([service.list(),service.list()]);
 assert.equal(a.plans[0].summary.state,'first');assert.equal(b.plans.length,1);assert.equal(quotesCalls,1);
 await service.list();assert.equal(quotesCalls,1);
 broken=true;const c=await service.list({refresh:true});
 assert.equal(c.plans[0].summary.state,'unavailable');assert.equal(c.plans[0].budgetCents,100000);
 advance(61000);await service.list();assert.equal(quotesCalls,3);
 assert.equal(calls.types,1);
});
test('非法参数先拒绝，货币基金不可创建，错误不会写库',async t=>{
 const {service,calls}=setup(t);
 await assert.rejects(service.create({...input,fundCode:'invalid'}));assert.equal(calls.types,0);
 const p=await service.create(input);
 await assert.rejects(service.update(p.id,{revision:p.revision,fundCode:'bad'}));assert.equal(calls.types,1);
 const money=setup(t,{getFundTypes:async()=>({'110020':{name:'货币',type:'货币型-普通货币'}})});
 await assert.rejects(money.service.create(input),/货币/);assert.equal(money.store.list().length,0);
});
test('真实路由鉴权、记录幂等、版本冲突、404及基准校正',async t=>{
 const {service}=setup(t);const app=express();app.use(express.json());
 installAuth(app,{enabled:true,username:'tester',password:'test',secret:Buffer.alloc(32,2),apiKey:'x'.repeat(32)});
 installDcaRoutes(app,service);
 const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,headers={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 assert.equal((await request('/api/dca-plans')).status,401);
 assert.equal((await request('/api/dca-plans','POST',input,{'x-api-key':'x'.repeat(32)})).status,401);
 const login=await request('/api/login','POST',{username:'tester',password:'test'});
 const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const created=await request('/api/dca-plans','POST',input,headers);assert.equal(created.status,200);const p=await created.json();
 assert.equal((await request('/api/dca-plans/missing','GET',null,headers)).status,404);
 const payload={revision:p.revision,requestId:randomUUID(),date:'2026-11-16',nav:'1',amount:'100'};
 const url=`/api/dca-plans/${p.id}/buys`;
 assert.equal((await request(url,'POST',payload,headers)).status,200);
 const duplicate=await(await request(url,'POST',payload,headers)).json();assert.equal(duplicate.records.length,1);
 assert.equal((await request(url,'POST',{...payload,requestId:randomUUID()},headers)).status,409);
 const changed=await(await request(`/api/dca-plans/${p.id}`,'PATCH',{revision:2,basis:{requestId:randomUUID(),date:'2026-11-16',nav:'0.9',reason:'分红'}},headers)).json();
 assert.equal(changed.records.length,2);
 const listed=await request('/api/dca-plans','GET',null,headers);assert.equal(listed.headers.get('cache-control'),'no-store');
 assert.equal((await listed.json()).plans[0].summary.triggerNav,0.864);
});
