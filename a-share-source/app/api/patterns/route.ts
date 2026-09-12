import { cors, preflight } from '@/lib/api-cors';
import { NextResponse } from 'next/server';
import { completeDate, validateSample, matchStock, reference, targetCalendar, universePage } from '@/lib/pattern';
import type { Security, Provider } from '@/lib/pattern';
export const dynamic = 'force-dynamic';
function parameters(url: string) {
  const p = new URL(url).searchParams;
  const sample = { code: p.get('code') || '', start: p.get('start') || '', end: p.get('end') || '' }, date = p.get('date') || completeDate();
  validateSample(sample,date);
  const rawProvider = p.get('provider');
  if (rawProvider && !['eastmoney','tencent'].includes(rawProvider)) throw new Error('行情源无效');
  return { sample, date, p, provider: (rawProvider || undefined) as Provider | undefined };
}
async function handleGet(request: Request) {
  try {
    const { sample, date, p, provider } = parameters(request.url);
    if (p.get('mode') === 'universe') {
      const page = Number(p.get('page') || 1);
      if (!Number.isInteger(page) || page < 1 || page > 200) throw new Error('页码无效');
      return NextResponse.json(await universePage(page));
    }
    const ref = await reference(sample, provider), calendar = await targetCalendar(date, ref.points.length, ref.provider);
    return NextResponse.json({ reference: ref, calendar, date: calendar.at(-1) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '数据暂不可用' }, { status: 502 }); }
}
async function handlePost(request: Request) {
  try {
    const { sample, date, provider } = parameters(request.url);
    const { stocks } = await request.json() as { stocks: Security[] };
    if (!Array.isArray(stocks) || stocks.length > 20 || stocks.some(s => !/^\d{6}$/.test(s.code) || ![0,1].includes(s.market) || typeof s.name !== 'string' || s.name.length > 30)) throw new Error('股票批次无效');
    const ref = await reference(sample, provider), calendar = await targetCalendar(date, ref.points.length, ref.provider);
    const results = await Promise.all(stocks.map(s => matchStock(s, ref, date, calendar)));
    return NextResponse.json({ matches: results.flatMap(r => r.match ? [r.match] : []), failed: results.filter(r => r.failed).length, skipped: results.filter(r => r.skipped).length });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '筛选暂不可用' }, { status: 502 }); }
}

export function OPTIONS(request: Request) { return preflight(request); }
export async function GET(request: Request) { return cors(request, await handleGet(request)); }
export async function POST(request: Request) { return cors(request, await handlePost(request)); }
