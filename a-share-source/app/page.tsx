"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from '@/lib/api-client';
import PatternMatcher from '@/components/pattern-matcher';

type Stock = {
  code: string; name: string; price: number; changePct: number; change: number;
  volume: number; amount: number; turnover: number;
};
type Payload = { volume: Stock[]; amount: Stock[]; gainers: Stock[]; turnover: Stock[]; updatedAt: string; source: string };

const tabMeta = {
  volume: { label: "成交量", accent: "#39d2c0" },
  amount: { label: "成交额", accent: "#ffb547" },
  gainers: { label: "涨幅", accent: "#ff5f6d" },
  turnover: { label: "换手率", accent: "#9b8cff" },
} as const;
type TabKey = keyof typeof tabMeta;
const REFRESH_INTERVAL_MS = 300_000;

function compactNumber(value: number, type: "volume" | "amount") {
  if (type === "amount") {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  }
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN");
}
function signed(value: number, suffix = "") { return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`; }

function StockTable({ stocks, metric }: { stocks: Stock[]; metric: TabKey }) {
  const metricValue = (stock: Stock) => metric === "volume" ? stock.volume : metric === "amount" ? stock.amount : metric === "turnover" ? stock.turnover : stock.changePct;
  const max = Math.max(...stocks.map(metricValue), 1);
  const meta = tabMeta[metric];
  return (
    <div className="table-shell">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-14">排名</TableHead><TableHead>股票</TableHead>
            <TableHead className="text-right">收盘价</TableHead><TableHead className="text-right">涨跌幅</TableHead>
            <TableHead className="hidden text-right md:table-cell">成交量</TableHead>
            <TableHead className="hidden text-right lg:table-cell">成交额</TableHead>
            <TableHead className="hidden text-right xl:table-cell">换手率</TableHead>
            <TableHead className="w-[22%] min-w-32">{meta.label}强度</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.map((stock, index) => {
            const value = metricValue(stock);
            const positive = stock.changePct >= 0;
            return (
              <TableRow key={`${metric}-${stock.code}`}>
                <TableCell><span className={`rank ${index < 3 ? "rank-top" : ""}`}>{String(index + 1).padStart(2, "0")}</span></TableCell>
                <TableCell><div className="font-semibold text-slate-100">{stock.name}</div><div className="code">{stock.code}</div></TableCell>
                <TableCell className="text-right font-mono font-semibold">{stock.price.toFixed(2)}</TableCell>
                <TableCell className={`text-right font-mono font-semibold ${positive ? "rise" : "fall"}`}>
                  <span className="inline-flex items-center gap-1">{positive ? <ArrowUpRight /> : <ArrowDownRight />}{signed(stock.changePct, "%")}</span>
                </TableCell>
                <TableCell className="hidden text-right font-mono text-slate-300 md:table-cell">{compactNumber(stock.volume, "volume")}</TableCell>
                <TableCell className="hidden text-right font-mono text-slate-300 lg:table-cell">{compactNumber(stock.amount, "amount")}</TableCell>
                <TableCell className="hidden text-right font-mono text-slate-300 xl:table-cell">{stock.turnover.toFixed(2)}%</TableCell>
                <TableCell>
                  <div className="metric-line"><span className="metric-bar" style={{ width: `${Math.max(4, Math.min(100, value / max * 100))}%`, backgroundColor: meta.accent }} /></div>
                  <div className="mt-1 text-right font-mono text-xs text-slate-400">{metric === "volume" ? compactNumber(stock.volume, "volume") : metric === "amount" ? compactNumber(stock.amount, "amount") : metric === "turnover" ? `${stock.turnover.toFixed(2)}%` : signed(stock.changePct, "%")}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Home({ snapshotDate, minSampleDate }: { snapshotDate?: string; minSampleDate?: string } = {}) {
  const [data, setData] = useState<Payload | null>(null);
  const [active, setActive] = useState<TabKey>("volume");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);
  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true); setError("");
    try {
      const response = await apiFetch("/api/stocks", { cache: "no-store" });
      if (!response.ok) throw new Error("行情服务暂不可用");
      setData(await response.json());
    } catch (err) { setError(err instanceof Error ? err.message : "行情服务暂不可用"); }
    finally { setRefreshing(false); requestInFlight.current = false; }
  }, []);
  useEffect(() => {
    void load();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [load]);
  const leaders = useMemo(() => data ? [data.volume[0], data.amount[0], data.gainers[0], data.turnover[0]] : [], [data]);
  const updateTime = data ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(data.updatedAt)) : "--";

  return (
    <main className="min-h-screen">
      <header className="topbar">
        <div className="brand-mark"><BarChart3 /></div>
        <div><h1>A股热力榜</h1><p>每日活跃股票 Top 50</p></div>
        <div className="ml-auto flex items-center gap-3">
          <div className="market-status"><span />A 股 · 每日收盘数据</div>
          <Button onClick={() => void load()} disabled={refreshing} variant="outline" className="refresh-button" aria-label="立即刷新行情">
            <RefreshCw className={refreshing ? "animate-spin" : ""} /><span className="hidden sm:inline">刷新</span>
          </Button>
        </div>
      </header>
      <section className="dashboard">
        <PatternMatcher snapshotDate={snapshotDate} minSampleDate={minSampleDate} />
        <div className="intro-row">
          <div><div className="eyebrow"><Activity /> MARKET PULSE</div><h2>收盘后，回看市场热度</h2></div>
          <div className="update-meta" aria-live="polite"><span>{data?.source || "公开行情数据"}</span><strong>{updateTime}（北京时间）采集{refreshing && data ? " · 同步中" : ""}</strong></div>
        </div>
        {error && <div className="error-banner" role="alert">{error}，请稍后刷新。</div>}
        <div className="leader-grid" aria-label="今日榜首">
          {leaders.length ? leaders.map((stock, index) => {
            const key = (["volume", "amount", "gainers", "turnover"] as TabKey[])[index];
            const label = key === "volume" ? compactNumber(stock.volume, "volume") : key === "amount" ? compactNumber(stock.amount, "amount") : key === "turnover" ? `${stock.turnover.toFixed(2)}%` : signed(stock.changePct, "%");
            return (
              <button key={key} className={`leader-card ${active === key ? "active" : ""}`} onClick={() => setActive(key)}>
                <div className="leader-label"><span style={{ backgroundColor: tabMeta[key].accent }} />{tabMeta[key].label}榜首</div>
                <div className="leader-main"><strong>{stock.name}</strong><em>{label}</em></div>
                <div className="leader-sub"><span>{stock.code}</span><span className={stock.changePct >= 0 ? "rise" : "fall"}>{signed(stock.changePct, "%")}</span></div>
              </button>
            );
          }) : [0, 1, 2, 3].map((item) => <div key={item} className="leader-card skeleton-card" />)}
        </div>
        <Tabs value={active} onValueChange={(value) => setActive(value as TabKey)} className="ranking-panel">
          <div className="panel-head">
            <div><h3>活跃排行</h3><p>按最近一次收盘快照排序，共 50 只</p></div>
            <TabsList aria-label="排行指标"><TabsTrigger value="volume">成交量</TabsTrigger><TabsTrigger value="amount">成交额</TabsTrigger><TabsTrigger value="gainers">涨幅</TabsTrigger><TabsTrigger value="turnover">换手率</TabsTrigger></TabsList>
          </div>
          {(["volume", "amount", "gainers", "turnover"] as TabKey[]).map((key) => (
            <TabsContent value={key} key={key}>{data ? <StockTable stocks={data[key]} metric={key} /> : <div className="loading-table">正在读取收盘快照…</div>}</TabsContent>
          ))}
        </Tabs>
        <footer>行情数据仅供信息浏览，不构成任何投资建议。</footer>
      </section>
    </main>
  );
}
