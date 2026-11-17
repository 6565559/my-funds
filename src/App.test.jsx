import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePortfolio } from "./usePortfolio";
import App from "./App";
vi.mock("./usePortfolio", () => ({ usePortfolio: vi.fn() }));
vi.mock("./components/PerformanceView", () => ({
  default: () => <div>历史走势</div>,
}));
vi.mock("./api", async importOriginal => ({
  ...await importOriginal(), api: { indexValuations: vi.fn().mockResolvedValue({ rows: [], covered: 0, excluded: 0,
    distribution: { low: 0, cool: 0, warm: 0, high: 0 }, source: { name: '韭圈', url: 'https://www.jiucaishuo.com', methodology: '' } }),
    dcaPlans: vi.fn().mockResolvedValue({plans:[],catalog:[]}),
    backtests: vi.fn().mockResolvedValue({runs:[],catalog:[],worker:{online:false}}),
  },
}));
let state;
beforeEach(() => {
  state = {
    status: "ready",
    portfolio: {
      groups: [
        { id: "a", name: "权益组", funds: [{ code: "001583", shares: 100 }] },
      ],
      settings: {},
    },
    quoteMap: {},
    indices: [],
    loading: false,
    autoRefresh: true,
    save: vi.fn(),
  };
  usePortfolio.mockImplementation(() => state);
});
afterEach(cleanup);
test('回测页面独立于持仓加载，并保留持仓编辑',async()=>{
 render(<App/>);editShares();fireEvent.click(screen.getByRole('button',{name:'策略回测'}));
 await screen.findByText('暂无回测记录');fireEvent.click(screen.getByRole('button',{name:'持仓概览'}));
 expect(screen.getByRole('spinbutton',{name:'001583份额'}).value).toBe('123');
});
function editShares() {
  fireEvent.click(
    screen.getByRole("button", { name: "编辑权益组的份额与成本" }),
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "001583份额" }), {
    target: { value: "123" },
  });
}
test("切换页面保留未保存的持仓输入", async () => {
  render(<App />);
  editShares();
  fireEvent.click(screen.getByRole("button", { name: "收益统计" }));
  await screen.findByText("历史走势");
  fireEvent.click(screen.getByRole("button", { name: "持仓概览" }));
  expect(screen.getByRole("spinbutton", { name: "001583份额" }).value).toBe(
    "123",
  );
});
test("首次行情失败后重试不卸载编辑中的内容", () => {
  const { rerender } = render(<App />);
  editShares();
  state = { ...state, loading: true };
  rerender(<App />);
  expect(screen.getByRole("spinbutton", { name: "001583份额" }).value).toBe(
    "123",
  );
});

test('温度计有独立更新入口，切换后持仓输入不丢失', async () => {
  render(<App />);
  editShares();
  fireEvent.click(screen.getByRole('button', { name: '指数温度计' }));
  await screen.findByText('已覆盖指数估值分布');
  expect(screen.queryByRole('button', { name: '刷新行情' })).toBeNull();
  expect(screen.queryByText('总资产 / CNY')).toBeNull();
  expect(screen.getByRole('button', { name: '更新估值' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '持仓概览' }));
  expect(screen.getByRole('spinbutton', { name: '001583份额' }).value).toBe('123');
});

test('定投页独立加载，切回持仓保留编辑且不保存持仓', async () => {
  render(<App />);
  editShares();
  fireEvent.click(screen.getByRole('button', { name: '4% 定投计划' }));
  await screen.findByText('还没有定投计划');
  expect(screen.queryByRole('button', { name: '刷新行情' })).toBeNull();
  expect(screen.queryByText('总资产 / CNY')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '持仓概览' }));
  expect(screen.getByRole('spinbutton', { name: '001583份额' }).value).toBe('123');
  expect(state.save).not.toHaveBeenCalled();
});

test('持仓读取失败时仍可打开独立定投账本', async () => {
  state = {...state,portfolio:null,status:'error',error:'持仓读取失败'};
  render(<App />);
  fireEvent.click(screen.getByRole('button',{name:'4% 定投计划'}));
  await screen.findByText('还没有定投计划');
  expect(screen.getByText('持仓读取失败')).toBeTruthy();
});
