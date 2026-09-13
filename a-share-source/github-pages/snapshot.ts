import { useSnapshot, reference, targetCalendar, matchStock, validateSample, universePage } from '../lib/pattern.ts';
import type { Bar, Security, Provider } from '../lib/pattern.ts';
export type PackedBar = [string, number, number, number, number, number, number | null, number | null];
export type Snapshot = { version: 1; testMode?: boolean; generatedAt: string; date: string; provider: Provider; source: string; stocks: Security[]; total: number; available: number; failed: number; minSampleDate: string; files: Record<string, string>; index: Bar[]; rankings: unknown };
export const securityKey = (s: Security) => `${s.market}.${s.code}`;
export function unpack(v: PackedBar): Bar { return {date:v[0],open:v[1],close:v[2],high:v[3],low:v[4],volume:v[5],amount:v[6],turnover:v[7]}; }
export function installSnapshot(meta: Snapshot, getRows: (key: string) => Promise<Bar[]>) {
  useSnapshot(async (stock, end) => {
    const index = stock.market === 1 && stock.code === '000001';
    if (!index) {
      const found = meta.stocks.find(s=>securityKey(s)===securityKey(stock));
      if (!found) throw new Error('该股票不在当前快照股票池中');
      stock.name = found.name;
    }
    const rows = index ? meta.index : await getRows(securityKey(stock));
    return rows.filter(b=>b.date<=end);
  }, async page => ({ stocks:meta.stocks.slice((page-1)*80,page*80),total:meta.total,pages:Math.ceil(meta.stocks.length/80) }));
  return async (path: string, body?: {stocks: Security[]}) => {
    const u = new URL(path, 'https://snapshot.invalid');
    if(u.pathname === '/api/stocks') return meta.rankings;
    if(u.pathname !== '/api/patterns') throw new Error('未知数据请求');
    const p=u.searchParams, sample={code:p.get('code')||'',start:p.get('start')||'',end:p.get('end')||''},date=p.get('date')||meta.date;
    validateSample(sample,date);
    if(date>meta.date || sample.end>meta.date) throw new Error(`快照最新交易日为 ${meta.date}，请将截止日调整到该日或更早`);
    if(sample.start<meta.minSampleDate) throw new Error(`当前快照可选样本开始日期为 ${meta.minSampleDate} 或更晚，个股还需满足60日预热`);
    if(p.get('mode')==='universe') return universePage(Number(p.get('page')||1));
    const ref=await reference(sample,meta.provider),calendar=await targetCalendar(date,ref.points.length,meta.provider);
    if(!body) return {reference:ref,calendar,date:calendar.at(-1)};
    if(!Array.isArray(body.stocks)||body.stocks.length>20) throw new Error('股票批次无效');
    const results=await Promise.all(body.stocks.map(s=>matchStock(s,ref,date,calendar)));
    return {matches:results.flatMap(r=>r.match?[r.match]:[]),failed:results.filter(r=>r.failed).length,skipped:results.filter(r=>r.skipped).length};
  };
}
export async function loadSnapshot(base: string) {
  const r=await fetch(new URL('data/manifest.json',base),{cache:'no-store'});
  if(!r.ok) throw new Error('每日快照尚未发布，请稍后刷新');
  const meta=await r.json() as Snapshot;
  if(meta.version!==1||!meta.index?.length||!meta.stocks?.length) throw new Error('快照格式无效');
  const cache = new Map<string, Promise<Record<string,PackedBar[]>>>();
  const handler=installSnapshot(meta,async key=>{
    const file=meta.files[key];
    if(!file) throw new Error('该股票本次采集失败');
    let pending=cache.get(file);
    if(!pending){
      pending=(async()=>{
        const response=await fetch(new URL(`data/${file}`,base));
        if(!response.ok || !response.body) throw new Error('快照分片读取失败');
        if(typeof DecompressionStream==='undefined') throw new Error('请使用支持解压数据的新版浏览器');
        return await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as Record<string,PackedBar[]>;
      })();
      cache.set(file,pending);
      if(cache.size>8) cache.delete(cache.keys().next().value!);
      pending.catch(()=>cache.delete(file));
    }
    const rows=(await pending)[key];
    if(!rows) throw new Error('快照缺少该股票日线');
    return rows.map(unpack);
  });
  return {meta,handler};
}
