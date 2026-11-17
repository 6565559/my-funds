import { useCallback, useEffect, useRef, useState } from "react";
import { api, AuthRequired } from "./api.js";

export function usePortfolio() {
  const [status, setStatus] = useState("loading");
  const [authRequired, setAuthRequired] = useState(false);
  const [portfolio, setPortfolio] = useState(null);
  const [quoteMap, setQuoteMap] = useState({});
  const [indices, setIndices] = useState([]);
  const [mairui, setMairui] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState("");
  const current = useRef(null),
    generation = useRef(0),
    refreshing = useRef(false),
    saving = useRef(false);
  const expire = useCallback((nextStatus = "login") => {
    generation.current++;
    current.current = null;
    refreshing.current = false;
    setPortfolio(null);
    setQuoteMap({});
    setIndices([]);
    setMairui(null);
    setRefreshedAt(null);
    setLoading(false);
    setStatus(nextStatus);
  }, []);
  const refresh = useCallback(
    async (p = current.current) => {
      if (!p || refreshing.current) return;
      const version = generation.current;
      refreshing.current = true;
      setLoading(true);
      const codes = [
        ...new Set(p.groups.flatMap((g) => g.funds.map((f) => f.code))),
      ];
      try {
        const [funds, market] = await Promise.allSettled([
          codes.length ? api.quotes(codes) : Promise.resolve({ quotes: [] }),
          api.indices(p.settings.indices || []),
        ]);
        if (version !== generation.current) return;
        if (
          [funds, market].some(
            (r) => r.status === "rejected" && r.reason instanceof AuthRequired,
          )
        ) {
          expire();
          return;
        }
        const errors = [];
        if (funds.status === "fulfilled") {
          const pack = funds.value,
            quotes = Array.isArray(pack) ? pack : pack.quotes;
          setQuoteMap(Object.fromEntries(quotes.map((q) => [q.code, q])));
          setMairui(pack.mairui || null);
          setRefreshedAt(new Date());
        } else errors.push(`基金行情：${funds.reason.message}`);
        if (market.status === "fulfilled") setIndices(market.value);
        else errors.push(`市场指数：${market.reason.message}`);
        setError(errors.join("；"));
      } catch (e) {
        if (version === generation.current) setError(e.message);
      } finally {
        if (version === generation.current) {
          refreshing.current = false;
          setLoading(false);
        }
      }
    },
    [expire],
  );
  const load = useCallback(async () => {
    const version = generation.current;
    setStatus("loading");
    try {
      const next = await api.getPortfolio();
      if (version !== generation.current) return;
      current.current = next;
      setPortfolio(next);
      await refresh(next);
      if (version === generation.current) setStatus("ready");
    } catch (e) {
      if (version !== generation.current) return;
      if (e instanceof AuthRequired) expire();
      else {
        setError(e.message);
        setStatus("error");
      }
    }
  }, [expire, refresh]);
  useEffect(() => {
    const version = generation.current;
    api
      .session()
      .then((session) => {
        if (version !== generation.current) return;
        setAuthRequired(session.required);
        if (session.required && !session.username) setStatus("login");
        else load();
      })
      .catch((e) => {
        if (version === generation.current) {
          setError(e.message);
          setStatus("error");
        }
      });
    return () => {
      generation.current++;
      refreshing.current = false;
      current.current = null;
    };
  }, [load]);
  useEffect(() => {
    if (status !== "ready" || !autoRefresh) return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(
      tick,
      Math.max(15, Number(portfolio?.settings.refreshSeconds) || 60) * 1000,
    );
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status, autoRefresh, portfolio?.settings.refreshSeconds, refresh]);
  const replace = useCallback(
    (next) => {
      if (!current.current) return;
      // 旧持仓的在途行情不得覆盖导入或编辑后的新持仓。
      generation.current++;
      refreshing.current = false;
      current.current = next;
      setPortfolio(next);
      refresh(next);
    },
    [refresh],
  );
  const save = useCallback(
    async (next) => {
      if (saving.current) throw new Error("上一笔修改仍在保存，请稍后再试。");
      saving.current = true;
      const version = generation.current;
      try {
        const saved = await api.savePortfolio(next);
        if (version !== generation.current)
          throw new Error("页面状态已变化，请重新打开后再编辑。");
        replace(saved);
        return saved;
      } catch (e) {
        if (version === generation.current && e instanceof AuthRequired)
          expire();
        throw e;
      } finally {
        saving.current = false;
      }
    },
    [replace, expire],
  );
  const logout = useCallback(async () => {
    expire("logging-out");
    const version = generation.current;
    try {
      await api.logout();
    } catch (e) {
      setError(`退出请求失败：${e.message}`);
    } finally {
      if (version === generation.current) setStatus("login");
    }
  }, [expire]);
  return {
    status,
    authRequired,
    portfolio,
    quoteMap,
    indices,
    mairui,
    loading,
    refreshedAt,
    autoRefresh,
    setAutoRefresh,
    error,
    refresh,
    load,
    save,
    replace,
    logout,
    expire,
  };
}
