// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api, AuthRequired } from "./api.js";
import { usePortfolio } from "./usePortfolio.js";
vi.mock("./api.js", async (original) => ({
  ...(await original()),
  api: Object.fromEntries(
    [
      "session",
      "getPortfolio",
      "quotes",
      "indices",
      "savePortfolio",
      "logout",
    ].map((key) => [key, vi.fn()]),
  ),
}));
const portfolio = {
  groups: [{ id: "a", name: "权益", funds: [{ code: "001583", shares: 100 }] }],
  settings: { refreshSeconds: 60, indices: [] },
};
beforeEach(() => {
  vi.clearAllMocks();
  api.session.mockResolvedValue({ required: false });
  api.getPortfolio.mockResolvedValue(portfolio);
  api.quotes.mockResolvedValue({
    quotes: [{ code: "001583", nav: 1.2, navDate: "2026-11-12" }],
  });
  api.indices.mockResolvedValue([]);
  api.logout.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test("指数失败不阻止基金行情更新", async () => {
  api.indices.mockRejectedValue(new Error("指数不可用"));
  const { result } = renderHook(() => usePortfolio());
  await waitFor(() => expect(result.current.quoteMap["001583"]?.nav).toBe(1.2));
  expect(result.current.portfolio).toEqual(portfolio);
});
test("保存失败保留原持仓并向表单传递错误", async () => {
  api.savePortfolio.mockRejectedValue(new Error("保存失败"));
  const { result } = renderHook(() => usePortfolio());
  await waitFor(() => expect(result.current.portfolio).toEqual(portfolio));
  await act(async () => {
    await expect(
      result.current.save({ ...portfolio, groups: [] }),
    ).rejects.toThrow("保存失败");
  });
  expect(result.current.portfolio).toEqual(portfolio);
});
test("退出后丢弃仍在途中的行情响应", async () => {
  let resolveQuotes;
  api.quotes.mockReturnValue(
    new Promise((resolve) => {
      resolveQuotes = resolve;
    }),
  );
  const { result } = renderHook(() => usePortfolio());
  await waitFor(() => expect(api.quotes).toHaveBeenCalled());
  await act(() => result.current.logout());
  await act(async () =>
    resolveQuotes({ quotes: [{ code: "001583", nav: 99 }] }),
  );
  expect(result.current.status).toBe("login");
  expect(result.current.portfolio).toBeNull();
  expect(result.current.quoteMap).toEqual({});
});
test("收盘后可见页面继续刷新，手动模式停止轮询", async () => {
  const { result } = renderHook(() => usePortfolio());
  await waitFor(() => expect(result.current.quoteMap["001583"]).toBeTruthy());
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T20:00:00+08:00"));
  await act(async () => result.current.setAutoRefresh(false));
  await act(async () => result.current.setAutoRefresh(true));
  const initial = api.quotes.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(api.quotes.mock.calls.length).toBe(initial + 1);
  await act(async () => result.current.setAutoRefresh(false));
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(api.quotes.mock.calls.length).toBe(initial + 1);
});
test("退出请求结束前不开放重新登录", async () => {
  let finishLogout;
  api.logout.mockReturnValue(
    new Promise((resolve) => {
      finishLogout = resolve;
    }),
  );
  const { result } = renderHook(() => usePortfolio());
  await waitFor(() => expect(result.current.refreshedAt).toBeTruthy());
  let pending;
  act(() => {
    pending = result.current.logout();
  });
  expect(result.current.portfolio).toBeNull();
  expect(result.current.status).not.toBe("login");
  await act(async () => {
    finishLogout({ ok: true });
    await pending;
  });
  expect(result.current.status).toBe("login");
});
test("旧保存请求的登录失效响应不能清除新会话", async () => {
  let rejectSave;
  api.savePortfolio.mockReturnValue(
    new Promise((_, reject) => {
      rejectSave = reject;
    }),
  );
  const { result } = renderHook(() => usePortfolio());
  await waitFor(() => expect(result.current.refreshedAt).toBeTruthy());
  let pending;
  act(() => {
    pending = result.current.save(portfolio).catch((error) => error);
  });
  await act(() => result.current.logout());
  await act(() => result.current.load());
  await act(async () => {
    rejectSave(new AuthRequired());
    await pending;
  });
  expect(result.current.status).toBe("ready");
  expect(result.current.portfolio).toEqual(portfolio);
});
