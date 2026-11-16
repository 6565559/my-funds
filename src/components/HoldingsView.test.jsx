import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import HoldingsView from "./HoldingsView";
import { computePortfolio } from "../calc";
afterEach(cleanup);
const portfolio = {
  groups: [
    {
      id: "a",
      name: "权益组",
      kind: "normal",
      target: 0,
      funds: [{ code: "001583", shares: 100, account: "manual" }],
    },
    {
      id: "b",
      name: "债券组",
      kind: "normal",
      funds: [{ code: "004010", shares: 50, account: "manual" }],
    },
  ],
  settings: {},
};
const result = computePortfolio(portfolio, {
  "001583": { code: "001583", name: "安信股票", nav: 1, navDate: "2026-11-12" },
  "004010": { code: "004010", name: "债券基金", nav: 1, navDate: "2026-11-12" },
});
test("搜索只展示匹配分组，不把被过滤的持仓说成空分组", () => {
  render(
    <HoldingsView portfolio={portfolio} result={result} onSave={vi.fn()} />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "搜索持仓" }), {
    target: { value: "001583" },
  });
  expect(screen.getByRole("heading", { name: "权益组" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "债券组" })).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "这个分组还没有基金" }),
  ).toBeNull();
});
test("筛选隐藏分组后恢复未保存的份额", () => {
  render(
    <HoldingsView portfolio={portfolio} result={result} onSave={vi.fn()} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "编辑权益组的份额与成本" }),
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "001583份额" }), {
    target: { value: "123" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索持仓" }), {
    target: { value: "不匹配" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索持仓" }), {
    target: { value: "" },
  });
  expect(screen.getByRole("spinbutton", { name: "001583份额" }).value).toBe(
    "123",
  );
});
test("新建分组保存失败时保留弹窗和输入", async () => {
  const onSave = vi.fn().mockRejectedValue(new Error("磁盘写入失败"));
  render(
    <HoldingsView portfolio={portfolio} result={result} onSave={onSave} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "新建分组" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("分组名称"), {
    target: { value: "测试分组" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存分组" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("alert").textContent).toBe("磁盘写入失败"),
  );
  expect(within(dialog).getByLabelText("分组名称").value).toBe("测试分组");
});
