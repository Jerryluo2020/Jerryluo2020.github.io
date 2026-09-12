import { cors, preflight } from '@/lib/api-cors';
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Stock = {
  code: string;
  name: string;
  price: number;
  changePct: number;
  change: number;
  volume: number;
  amount: number;
  turnover: number;
};

type SinaStock = {
  code?: string;
  name?: string;
  trade?: string | number;
  pricechange?: string | number;
  changepercent?: string | number;
  volume?: string | number;
  amount?: string | number;
  turnoverratio?: string | number;
};

type EastMoneyStock = {
  f2?: number;
  f3?: number;
  f4?: number;
  f5?: number;
  f6?: number;
  f8?: number;
  f12?: string;
  f14?: string;
};

const sinaSort = {
  volume: "volume",
  amount: "amount",
  gainers: "changepercent",
  turnover: "turnoverratio",
} as const;

const eastMoneySort = {
  volume: "f5",
  amount: "f6",
  gainers: "f3",
  turnover: "f8",
} as const;

function number(value: string | number | undefined) {
  const parsed = Number(String(value ?? 0).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function valid(rows: Stock[]) {
  const filtered = rows.filter((row) => row.code.length === 6 && row.name && row.price > 0);
  if (filtered.length < 50) throw new Error("insufficient market rows");
  return filtered.slice(0, 50);
}

async function sinaRanking(sort: (typeof sinaSort)[keyof typeof sinaSort]) {
  const url = new URL("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData");
  url.search = new URLSearchParams({ page: "1", num: "80", sort, asc: "0", node: "hs_a", symbol: "" }).toString();
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: "https://vip.stock.finance.sina.com.cn/mkt/",
      "User-Agent": "Mozilla/5.0 (compatible; ASharePulse/1.0)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`sina ${response.status}`);
  const rows = await response.json() as SinaStock[];
  if (!Array.isArray(rows)) throw new Error("invalid sina response");
  return valid(rows.map((row) => ({
    code: String(row.code || ""),
    name: String(row.name || ""),
    price: number(row.trade),
    changePct: number(row.changepercent),
    change: number(row.pricechange),
    volume: number(row.volume),
    amount: number(row.amount),
    turnover: number(row.turnoverratio),
  })));
}

const eastMoneyFields = "f2,f3,f4,f5,f6,f8,f12,f14";
const eastMoneyMarket = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";

async function eastMoneyRanking(fid: (typeof eastMoneySort)[keyof typeof eastMoneySort]) {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  url.search = new URLSearchParams({ pn: "1", pz: "80", po: "1", np: "1", fltt: "2", invt: "2", fid, fs: eastMoneyMarket, fields: eastMoneyFields }).toString();
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 (compatible; ASharePulse/1.0)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`eastmoney ${response.status}`);
  const payload = await response.json() as { data?: { diff?: EastMoneyStock[] } };
  const rows = payload.data?.diff;
  if (!Array.isArray(rows)) throw new Error("invalid eastmoney response");
  return valid(rows.map((row) => ({
    code: String(row.f12 || ""),
    name: String(row.f14 || ""),
    price: number(row.f2),
    changePct: number(row.f3),
    change: number(row.f4),
    volume: number(row.f5),
    amount: number(row.f6),
    turnover: number(row.f8),
  })));
}

async function allRankings(source: "sina" | "eastmoney") {
  if (source === "sina") {
    const [volume, amount, gainers, turnover] = await Promise.all([
      sinaRanking(sinaSort.volume),
      sinaRanking(sinaSort.amount),
      sinaRanking(sinaSort.gainers),
      sinaRanking(sinaSort.turnover),
    ]);
    return { volume, amount, gainers, turnover };
  }
  const [volume, amount, gainers, turnover] = await Promise.all([
    eastMoneyRanking(eastMoneySort.volume),
    eastMoneyRanking(eastMoneySort.amount),
    eastMoneyRanking(eastMoneySort.gainers),
    eastMoneyRanking(eastMoneySort.turnover),
  ]);
  return { volume, amount, gainers, turnover };
}

async function handleGet() {
  try {
    const rankings = await allRankings("sina");
    return NextResponse.json(
      { ...rankings, updatedAt: new Date().toISOString(), source: "新浪财经公开行情" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    try {
      const rankings = await allRankings("eastmoney");
      return NextResponse.json(
        { ...rankings, updatedAt: new Date().toISOString(), source: "东方财富公开行情" },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    } catch {
      return NextResponse.json(
        { error: "实时行情源暂时不可用" },
        { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }
  }
}

export function OPTIONS(request: Request) { return preflight(request); }
export async function GET(request: Request) { return cors(request, await handleGet()); }
