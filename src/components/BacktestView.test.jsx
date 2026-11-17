import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import BacktestView from './BacktestView';
import {api,AuthRequired} from '../api';
vi.mock('../api',async original=>({...await original(),api:{backtests:vi.fn(),backtest:vi.fn(),createBacktest:vi.fn()}}));
vi.mock('./Chart',()=>({default:()=> <div>净值曲线</div>}));
const listed={catalog:[{code:'000300.SH',name:'沪深300'}],runs:[],worker:{online:true,version:'1.2.1'}};
beforeEach(()=>{vi.resetAllMocks();api.backtests.mockResolvedValue(listed);});afterEach(cleanup);
test('隐藏不请求，独立表单提交参数且网络重试不重复创建',async()=>{
 const {rerender}=render(<BacktestView active={false}/>);expect(api.backtests).not.toHaveBeenCalled();
 rerender(<BacktestView active/>);await screen.findByText('暂无回测记录');
 api.createBacktest.mockRejectedValue(new Error('网络中断'));
 fireEvent.click(screen.getByRole('button',{name:'运行回测'}));await screen.findByText('网络中断');
 fireEvent.click(screen.getByRole('button',{name:'运行回测'}));await waitFor(()=>expect(api.createBacktest).toHaveBeenCalledTimes(2));
 expect(api.createBacktest.mock.calls[0][0]).toEqual(api.createBacktest.mock.calls[1][0]);
 expect(api.createBacktest.mock.calls[0][0]).toMatchObject({drops:[4],windowYears:5,parts:10});
});
test('认证失效交回登录，工作进程离线禁止提交',async()=>{
 const auth=vi.fn();api.backtests.mockRejectedValueOnce(new AuthRequired());
 const {unmount}=render(<BacktestView active onAuthRequired={auth}/>);await waitFor(()=>expect(auth).toHaveBeenCalled());unmount();
 api.backtests.mockResolvedValue({...listed,worker:{online:false}});render(<BacktestView active/>);
 await screen.findByText(/工作进程未就绪/);expect(screen.getByRole('button',{name:'运行回测'}).disabled).toBe(true);
});
