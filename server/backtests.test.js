import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {installAuth} from './auth.js';
import {openBacktestDb, validateBacktest, createBacktestService, fetchNavRange,installBacktestRoutes} from './backtests.js';
const input=()=>({requestId:randomUUID(),fundCode:'110020',indexCode:'000300.SH',metric:'pe',windowYears:5,startDate:'2022-01-01',endDate:'2022-12-31',budget:10000,parts:10,buyBelow:20,feePct:0.15,drops:[4]});
test('严格校验参数，拒绝未来日期、脚本与无界参数',()=>{
 assert.equal(validateBacktest(input()).budgetCents,1000000);
 for(const change of [{budget:1.001},{parts:0},{drops:[0]},{feePct:Infinity},{windowYears:3},{startDate:'2022-02-30'},{endDate:'2999-01-01'},{fundCode:'../../x'}]) assert.throws(()=>validateBacktest({...input(),...change}));
});
test('回测路由只接受网页登录，外部持仓 API Key 不扩大权限',async t=>{
 const db=openBacktestDb(':memory:');t.after(()=>db.close());
 const service=createBacktestService({db,valuations:{},readValuations:()=>[],getFundTypes:async()=>({})});
 const app=express();app.use(express.json());installAuth(app,{enabled:true,username:'test',password:'test',secret:Buffer.alloc(32,3),apiKey:'z'.repeat(32)});installBacktestRoutes(app,service);
 const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/backtests')).status,401);
 assert.equal((await fetch(base+'/api/backtests',{headers:{'x-api-key':'z'.repeat(32)}})).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test',password:'test'})});
 const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const response=await fetch(base+'/api/backtests',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await fetch(base+'/api/backtests/missing',{headers})).status,404);
});
test('分页净值覆盖请求日期，源失败或无效涨幅不能默认为零',async()=>{
 const data={Success:true,TotalCount:2,Datas:[{FSRQ:'2022-01-04',DWJZ:'1.1',JZZZL:'10'},{FSRQ:'2021-12-31',DWJZ:'1',JZZZL:'0'}]};
 const fetcher=async()=>({ok:true,json:async()=>data});
 assert.equal((await fetchNavRange('110020','2022-01-01',fetcher)).length,2);
 data.Datas[0].JZZZL='--';assert.equal((await fetchNavRange('110020','2022-01-01',fetcher))[1].pct,null);
 data.Success=false;await assert.rejects(fetchNavRange('110020','2022-01-01',fetcher),/净值/);
});
test('任务入库幂等、快照失败保留失败状态、请求冲突与工作进程离线保护',async t=>{
 const db=openBacktestDb(':memory:');t.after(()=>db.close());
 db.prepare('INSERT INTO worker_health VALUES (1,?,?)').run(Date.now(),'1.2.1');
 const service=createBacktestService({db,valuations:{list:async()=>{}},readValuations:()=>[],getFundTypes:async()=>({'110020':{name:'测试基金',type:'指数型-股票'}})});
 const p=input();const run=service.create(p);assert.equal(run.status,'preparing');
 assert.equal(service.create(p).id,run.id);assert.throws(()=>service.create({...p,budget:9999}),/重复/);
 await service.idle();assert.equal(service.get(run.id).status,'failed');assert.match(service.get(run.id).error,/历史/);
 assert.equal(service.list().runs.length,1);
 db.prepare('UPDATE worker_health SET heartbeat=0').run();assert.throws(()=>service.create(input()),/工作进程/);
});
