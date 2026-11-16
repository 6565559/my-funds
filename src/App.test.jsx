import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePortfolio } from "./usePortfolio";
import App from "./App";
vi.mock("./usePortfolio", () => ({ usePortfolio: vi.fn() }));
vi.mock("./components/PerformanceView", () => ({
  default: () => <div>历史走势</div>,
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
  };
  usePortfolio.mockImplementation(() => state);
});
afterEach(cleanup);
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
