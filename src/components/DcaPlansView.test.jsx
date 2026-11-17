import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DcaPlansView from './DcaPlansView';
import { api, AuthRequired } from '../api';
vi.mock('../api',async original=>({...await original(),api:{dcaPlans:vi.fn(),createDcaPlan:vi.fn(),updateDcaPlan:vi.fn(),addDcaBuy:vi.fn(),voidDcaRecord:vi.fn(),search:vi.fn()}}));
const plan={id:'p',name:'300计划',fundCode:'110020',fundName:'沪深300基金',indexCode:'000300.SH',metric:'pe',budgetCents:100000,parts:10,buyBelow:20,capitalCents:null,status:'active',revision:2,
 records:[{id:1,kind:'buy',date:'2026-11-10',navMicros:1000000,amountCents:10000,voidedAt:null}],
 quote:{nav:0.96,navDate:'2026-11-16'},valuation:{temperature:10,date:'2026-11-16',status:'ok'},
 summary:{state:'ready',reason:'估值与下跌4%条件均满足',spentCents:10000,remainingCents:90000,nextAmountCents:10000,triggerNav:0.96,anchor:{id:1,navMicros:1000000,kind:'buy'},lastBuy:{navMicros:1000000},concentrationWarning:false}};
const data=plans=>({plans,catalog:[{code:'000300.SH',name:'沪深300'}]});
beforeEach(()=>{vi.resetAllMocks();api.dcaPlans.mockResolvedValue(data([plan]));api.search.mockResolvedValue([]);});
afterEach(cleanup);
const change=(label,value)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});

test('创建独立计划、金额配置与服务端刷新',async()=>{
 api.dcaPlans.mockResolvedValue(data([]));api.createDcaPlan.mockResolvedValue(plan);
 render(<DcaPlansView active/>);await screen.findByText('还没有定投计划');
 fireEvent.click(screen.getByRole('button',{name:'新增计划'}));
 change('计划名称','我的300');change('基金名称或代码','110020');change('计划总预算（元）','1000');
 api.dcaPlans.mockResolvedValue(data([plan]));
 fireEvent.click(screen.getByRole('button',{name:'保存计划'}));
 await waitFor(()=>expect(api.createDcaPlan).toHaveBeenCalledWith(expect.objectContaining({name:'我的300',fundCode:'110020',budget:'1000',parts:10,buyBelow:20})));
 await screen.findByRole('button',{name:'查看300计划'});
});

test('实际成交字段必须手填，保存后带幂等请求标识，不修改持仓',async()=>{
 api.addDcaBuy.mockResolvedValue(plan);
 render(<DcaPlansView active/>);await screen.findByText('满足条件');
 fireEvent.click(screen.getByRole('button',{name:'查看300计划'}));
 fireEvent.click(screen.getByRole('button',{name:'记录实际买入'}));
 expect(screen.getByLabelText('实际成交净值').value).toBe('');expect(screen.getByLabelText('成交日期').value).toBe('');
 change('实际成交净值','0.95');change('成交日期','2026-11-16');
 fireEvent.click(screen.getByRole('button',{name:'保存买入记录'}));
 await waitFor(()=>expect(api.addDcaBuy).toHaveBeenCalledWith('p',expect.objectContaining({nav:'0.95',date:'2026-11-16',amount:'100.00',revision:2,requestId:expect.stringMatching(/^[a-f0-9-]{36}$/)})));
});

test('暂停、失败重试与401沿用登录失效处理',async()=>{
 const auth=vi.fn();api.updateDcaPlan.mockRejectedValueOnce(new Error('版本已更新'));
 render(<DcaPlansView active onAuthRequired={auth}/>);await screen.findByText('满足条件');
 fireEvent.click(screen.getByRole('button',{name:'暂停300计划'}));
 await screen.findByText('版本已更新');
 api.dcaPlans.mockRejectedValueOnce(new AuthRequired());fireEvent.click(screen.getByRole('button',{name:'重试'}));
 await waitFor(()=>expect(auth).toHaveBeenCalledTimes(1));
});

test('隐藏页面不拉取，旧请求不能覆盖再次进入后的结果',async()=>{
 let resolve;api.dcaPlans.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 const {rerender}=render(<DcaPlansView active={false}/>);expect(api.dcaPlans).not.toHaveBeenCalled();
 rerender(<DcaPlansView active/>);await waitFor(()=>expect(api.dcaPlans).toHaveBeenCalledTimes(1));
 rerender(<DcaPlansView active={false}/>);rerender(<DcaPlansView active/>);
 await screen.findByRole('button',{name:'查看300计划'});resolve(data([]));
 await waitFor(()=>expect(screen.queryByText('还没有定投计划')).toBeNull());
});

test('保存失败后重试复用请求标识，避免重复买入',async()=>{
 api.addDcaBuy.mockRejectedValueOnce(new Error('网络暂时中断')).mockResolvedValue(plan);
 render(<DcaPlansView active/>);await screen.findByText('满足条件');
 fireEvent.click(screen.getByRole('button',{name:'查看300计划'}));
 fireEvent.click(screen.getByRole('button',{name:'记录实际买入'}));
 change('实际成交净值','0.95');change('成交日期','2026-11-16');
 fireEvent.click(screen.getByRole('button',{name:'保存买入记录'}));
 await screen.findByText('网络暂时中断');
 fireEvent.click(screen.getByRole('button',{name:'保存买入记录'}));
 await waitFor(()=>expect(api.addDcaBuy).toHaveBeenCalledTimes(2));
 expect(api.addDcaBuy.mock.calls[1]).toEqual(api.addDcaBuy.mock.calls[0]);
});

test('基准校正独立保存，撤销末条需要明确确认',async()=>{
 api.updateDcaPlan.mockResolvedValue(plan);api.voidDcaRecord.mockResolvedValue(plan);
 render(<DcaPlansView active/>);await screen.findByText('满足条件');
 fireEvent.click(screen.getByRole('button',{name:'查看300计划'}));
 fireEvent.click(screen.getByRole('button',{name:'重设触发基准'}));
 change('生效日期','2026-11-16');change('校正后基准净值','0.9');change('校正原因','现金分红');
 fireEvent.click(screen.getByRole('button',{name:'保存基准校正'}));
 await waitFor(()=>expect(api.updateDcaPlan).toHaveBeenCalledWith('p',expect.objectContaining({revision:2,basis:expect.objectContaining({nav:'0.9',reason:'现金分红',date:'2026-11-16'})})));
 fireEvent.click(await screen.findByRole('button',{name:'撤销'}));
 expect(api.voidDcaRecord).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'确认撤销'}));
 await waitFor(()=>expect(api.voidDcaRecord).toHaveBeenCalledWith('p',1,2));
});

test('写入成功后读取失败，不重新打开含过时预算和触发提示的详情',async()=>{
 api.addDcaBuy.mockResolvedValue(plan);
 render(<DcaPlansView active/>);await screen.findByText('满足条件');
 fireEvent.click(screen.getByRole('button',{name:'查看300计划'}));
 fireEvent.click(screen.getByRole('button',{name:'记录实际买入'}));
 change('实际成交净值','0.95');change('成交日期','2026-11-16');
 api.dcaPlans.mockRejectedValueOnce(new Error('读取暂时失败'));
 fireEvent.click(screen.getByRole('button',{name:'保存买入记录'}));
 await screen.findByText('读取暂时失败');
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.queryByText('满足条件')).toBeNull();
 expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
});

test('并发冲突刷新修订号但保留输入，用户确认后重试',async()=>{
 api.addDcaBuy.mockRejectedValueOnce(Object.assign(new Error('计划已更新，请刷新后重试'),{status:409})).mockResolvedValue(plan);
 render(<DcaPlansView active/>);await screen.findByText('满足条件');
 fireEvent.click(screen.getByRole('button',{name:'查看300计划'}));
 fireEvent.click(screen.getByRole('button',{name:'记录实际买入'}));
 change('实际成交净值','0.95');change('成交日期','2026-11-16');
 api.dcaPlans.mockResolvedValue(data([{...plan,revision:3}]));
 fireEvent.click(screen.getByRole('button',{name:'保存买入记录'}));
 await screen.findByText(/计划已更新，请刷新后重试/);
 expect(screen.getByLabelText('实际成交净值').value).toBe('0.95');
 fireEvent.click(screen.getByRole('button',{name:'保存买入记录'}));
 await waitFor(()=>expect(api.addDcaBuy).toHaveBeenCalledTimes(2));
 expect(api.addDcaBuy.mock.calls[1][1]).toMatchObject({revision:3,requestId:api.addDcaBuy.mock.calls[0][1].requestId});
});

test('撤销冲突后重新确认使用最新修订号',async()=>{
 api.voidDcaRecord.mockRejectedValueOnce(Object.assign(new Error('计划已更新'),{status:409})).mockResolvedValue(plan);
 render(<DcaPlansView active/>);await screen.findByText('满足条件');
 fireEvent.click(screen.getByRole('button',{name:'查看300计划'}));
 fireEvent.click(screen.getByRole('button',{name:'撤销'}));
 api.dcaPlans.mockResolvedValue(data([{...plan,revision:3}]));
 fireEvent.click(screen.getByRole('button',{name:'确认撤销'}));
 await screen.findByText(/计划已更新/);
 fireEvent.click(screen.getByRole('button',{name:'确认撤销'}));
 await waitFor(()=>expect(api.voidDcaRecord).toHaveBeenCalledTimes(2));
 expect(api.voidDcaRecord.mock.calls[1]).toEqual(['p',1,3]);
});
