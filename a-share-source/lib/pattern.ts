export type Bar = { date: string; open: number; close: number; high: number; low: number; volume: number; amount: number | null; turnover: number | null };
export type Security = { code: string; name: string; market: number };
export type Point = Bar & { ma5: number; ma10: number; ma20: number; dif: number; dea: number; macd: number; rsi: number; volumeRatio: number };
export type Sample = { code: string; start: string; end: string };
export type Reference = { stock: Security; start: string; end: string; points: Point[]; source: string; provider: Provider };
export type Match = Security & { score: number; parts: (number | null)[]; points: Point[]; change: number };
export type Provider = 'eastmoney' | 'tencent';
export const SOURCE = '东方财富 · 前复权日线';
export const FACTORS = ['价格路径', '量能', '均线', 'MACD', 'RSI', '换手率'];
export const WEIGHTS = [0.4, 0.15, 0.15, 0.1, 0.1, 0.1];
type HistoryReader = (stock: Security, end: string, provider: Provider, lookback: number) => Promise<Bar[]>;
let snapshotHistory: HistoryReader | undefined;
let snapshotUniverse: ((page: number) => Promise<{ stocks: Security[]; total: number; pages: number }>) | undefined;
export function useSnapshot(readHistory: HistoryReader, readUniverse: NonNullable<typeof snapshotUniverse>) {
  snapshotHistory = readHistory; snapshotUniverse = readUniverse;
}
const memo = new Map<string, { at: number; value: unknown }>();
async function json(url: URL) {
  const key = url.toString(), hit = memo.get(key);
  if (hit && Date.now() - hit.at < 900_000) return hit.value as any;
  const response = await fetch(key, { headers: { Referer: 'https://quote.eastmoney.com/', Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`行情源 HTTP ${response.status}${response.headers.get('retry-after') ? ' Retry-After='+response.headers.get('retry-after') : ''}`);
  const body: any = await response.json();
  if (body && typeof body === 'object' && typeof body.code === 'number' && body.code !== 0) throw new Error(`行情源 code=${body.code}: ${String(body.msg || body.message || '请求失败').slice(0,160)}`);
  if (memo.size > 100) memo.delete(memo.keys().next().value!);
  memo.set(key, { at: Date.now(), value: body });
  return body;
}
export function shiftDate(date: string, days: number) {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function completeDate() {
  const now = new Date(Date.now() + 8 * 3600_000);
  let date = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < 16) date = shiftDate(date, -1);
  while ([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())) date = shiftDate(date,-1);
  return date;
}
export async function history(stock: Security, end: string, provider: Provider = 'eastmoney', lookback = 250): Promise<Bar[]> {
  if (snapshotHistory) return snapshotHistory(stock, end, provider, lookback);
  if (provider === 'tencent') {
    const symbol = `${stock.market === 1 ? 'sh' : /^[489]/.test(stock.code) ? 'bj' : 'sz'}${stock.code}`;
    const url = new URL('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get');
    url.search = new URLSearchParams({ param: `${symbol},day,${shiftDate(end,-lookback)},${end},640,qfq` }).toString();
    const payload = await json(url);
    const data = payload.data?.[symbol];
    const rows = data?.qfqday || data?.day;
    const quote = data?.qt?.[symbol];
    if (Array.isArray(quote) && typeof quote[1] === 'string') stock.name = quote[1];
    if (!Array.isArray(rows)) throw new Error('备用行情源未提供日线');
    return rows.map((v: string[]) => ({date: v[0], open: Number(v[1]), close: Number(v[2]), high: Number(v[3]), low: Number(v[4]), volume: Number(v[5]), amount: null, turnover: null})).filter((b: Bar) => b.date <= end && [b.open,b.close,b.high,b.low,b.volume].every(Number.isFinite) && b.close > 0 && b.volume > 0).sort((a: Bar,b: Bar)=>a.date.localeCompare(b.date));
  }
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.search = new URLSearchParams({ secid: `${stock.market}.${stock.code}`, klt: '101', fqt: '1', beg: shiftDate(end, -lookback).replaceAll('-', ''), end: end.replaceAll('-', ''), fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' }).toString();
  const data = await json(url);
  if (typeof data.data?.name === 'string') stock.name = data.data.name;
  if (!Array.isArray(data.data?.klines)) throw new Error('未获取到日线');
  return data.data.klines.map((line: string) => {
    const v = line.split(',');
    return { date: v[0], open: Number(v[1]), close: Number(v[2]), high: Number(v[3]), low: Number(v[4]), volume: Number(v[5]), amount: Number(v[6]), turnover: Number(v[10]) };
  }).filter((b: Bar) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.date <= end && Object.values(b).slice(1).every(Number.isFinite) && b.close > 0 && b.volume > 0).sort((a: Bar, b: Bar) => a.date.localeCompare(b.date));
}
export function indicators(bars: Bar[]): Point[] {
  let e12 = bars[0]?.close || 0, e26 = e12, dea = 0, gain = 0, loss = 0;
  return bars.map((bar, i) => {
    const ma = (n: number) => bars.slice(Math.max(0, i - n + 1), i + 1).reduce((s, b) => s + b.close, 0) / Math.min(i + 1, n);
    e12 += (bar.close - e12) * 2 / 13; e26 += (bar.close - e26) * 2 / 27;
    const dif = e12 - e26; dea += (dif - dea) * 2 / 10;
    const delta = i ? bar.close - bars[i - 1].close : 0;
    if (i > 0 && i <= 14) { gain += Math.max(delta, 0) / 14; loss += Math.max(-delta, 0) / 14; }
    else if (i > 14) { gain = (gain * 13 + Math.max(delta, 0)) / 14; loss = (loss * 13 + Math.max(-delta, 0)) / 14; }
    const priorVolume = bars.slice(Math.max(0, i - 5), i).reduce((s, b) => s + b.volume, 0) / Math.min(i || 1, 5);
    return { ...bar, ma5: ma(5), ma10: ma(10), ma20: ma(20), dif, dea, macd: 2 * (dif - dea), rsi: loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss), volumeRatio: priorVolume ? bar.volume / priorVolume : 1 };
  });
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validateSample(sample: Sample, date = sample.end) {
  if (!/^(000|001|002|003|300|301|600|601|603|605|688|689|4\d{2}|8\d{2}|920)\d{3}$/.test(sample.code)) throw new Error('请输入沪深京A股的6位股票代码');
  if (![sample.start,sample.end,date].every(validDate) || sample.start < '1990-12-19' || sample.start > sample.end || sample.end > completeDate() || date > completeDate() || date < sample.end) throw new Error('请选择有效的已收盘日期；样本开始不能晚于结束，筛选截止日不能早于样本结束');
  if ((Date.parse(sample.end)-Date.parse(sample.start))/86400000 > 366) throw new Error('单次样本区间最多366个自然日，请缩短区间');
}
export async function reference(sample: Sample, provider?: Provider): Promise<Reference> {
  validateSample(sample);
  const {start,end,code} = sample;
  const stock: Security = {code, market: code.startsWith('6') ? 1 : 0, name: code};
  const lookback = Math.ceil((Date.parse(end)-Date.parse(start))/86400000) + 250;
  let bars: Bar[];
  let selected: Provider = provider || 'eastmoney';
  try { bars = await history(stock, end, selected, lookback); }
  catch(e) { if(provider) throw e; selected = 'tencent'; bars = await history(stock, end, selected, lookback); }
  const first = bars.findIndex(b => b.date >= start);
  if (first < 60) throw new Error('该股票的样本或60个交易日预热数据不足，请检查代码和区间');
  const points = indicators(bars).filter(b => b.date >= start && b.date <= end);
  const trading = (await history({code:'000001',market:1,name:'上证指数'},end,selected,lookback)).filter(b=>b.date>=start).map(b=>b.date);
  if (points.length < 5) throw new Error('样本区间至少需要5个完整交易日');
  if (points.length !== trading.length || points.some((p,i)=>p.date!==trading[i])) throw new Error('样本区间存在停牌或缺失日线，请调整日期');
  return { stock, start, end, points, provider: selected, source: selected === 'eastmoney' ? SOURCE : '腾讯财经 · 前复权日线（缺成交额、换手率）' };
}
export async function universePage(page: number): Promise<{ stocks: Security[]; total: number; pages: number }> {
  if (snapshotUniverse) return snapshotUniverse(page);
  const root = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/';
  const count = Number(await json(new URL(root + 'Market_Center.getHQNodeStockCount?node=hs_a')));
  const url = new URL(root + 'Market_Center.getHQNodeData');
  url.search = new URLSearchParams({ page: String(page), num: '80', sort: 'code', asc: '1', node: 'hs_a', symbol: '' }).toString();
  const body = await json(url);
  if (!Array.isArray(body) || !Number.isInteger(count) || count < 1000 || count > 15000) throw new Error('无法读取A股股票池');
  return { stocks: body.map((s: any) => ({ code: String(s.code), market: s.symbol?.startsWith('sh') ? 1 : 0, name: String(s.name) })).filter((s: Security) => /^\d{6}$/.test(s.code)), total: count, pages: Math.ceil(count / 80) };
}
const rmse = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
export function compare(sample: Point[], points: Point[]) {
  const base = (p: Point[]) => p.map(b => Math.log(b.close / p[0].close));
  const distance = [
    rmse(base(sample), base(points)) / 0.10,
    rmse(sample.map(p => Math.log(p.volumeRatio)), points.map(p => Math.log(p.volumeRatio))) / 0.8,
    rmse(sample.flatMap(p => [p.close / p.ma5 - 1, p.close / p.ma10 - 1, p.close / p.ma20 - 1]), points.flatMap(p => [p.close / p.ma5 - 1, p.close / p.ma10 - 1, p.close / p.ma20 - 1])) / 0.05,
    rmse(sample.map(p => p.macd / p.close), points.map(p => p.macd / p.close)) / 0.02,
    rmse(sample.map(p => p.rsi), points.map(p => p.rsi)) / 25,
    sample.every(p=>p.turnover !== null) && points.every(p=>p.turnover !== null) ? rmse(sample.map(p => Math.log1p(p.turnover!)), points.map(p => Math.log1p(p.turnover!))) / 1 : null,
  ];
  const weight = distance.reduce<number>((s,d,i)=>s+(d === null ? 0 : WEIGHTS[i]),0);
  return { score: 100 * Math.exp(-distance.reduce<number>((s, d, i) => s + (d ?? 0) * WEIGHTS[i], 0) / weight), parts: distance.map(d => d === null ? null : 100 * Math.exp(-d)) };
}
export async function matchStock(stock: Security, ref: Reference, date: string, calendar: string[]): Promise<{ match?: Match; skipped?: boolean; failed?: boolean }> {
  if (stock.code === ref.stock.code && stock.market === ref.stock.market || /ST|退/.test(stock.name)) return { skipped: true };
  try {
    const bars = await history({...stock}, date, ref.provider, Math.max(250, ref.points.length * 2 + 250));
    if (bars.length < 60 + ref.points.length) return { skipped: true };
    const points = indicators(bars).slice(-ref.points.length);
    if (points.some((p, i) => p.date !== calendar[i])) return { skipped: true };
    return { match: { ...stock, ...compare(ref.points, points), points, change: (points.at(-1)!.close / points[0].close - 1) * 100 } };
  } catch { return { failed: true }; }
}
export async function targetCalendar(date: string, count: number, provider: Provider = 'eastmoney') {
  const bars = await history({ code: '000001', name: '上证指数', market: 1 }, date, provider, Math.max(250, count * 2 + 250));
  const dates = bars.slice(-count).map(b => b.date);
  if (dates.length !== count) throw new Error('无法确定交易日历');
  return dates;
}
