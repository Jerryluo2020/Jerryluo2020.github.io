'use client';
import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiUrl } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FACTORS, WEIGHTS, completeDate, validateSample } from '@/lib/pattern';
import type { Reference, Match, Security, Point, Sample } from '@/lib/pattern';

type Result = { reference: Reference; calendar: string[]; date: string; matches: Match[]; total: number; processed: number; evaluated: number; skipped: number; failed: number; complete: boolean; generatedAt?: string };
const fmt = (n: number | null) => n === null ? '—' : n.toFixed(2);
type Pool = {stocks: Security[]; total: number; pages: number};
type Batch = {matches: Match[]; failed: number; skipped: number};
async function read<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const r = await fetch(apiUrl(url), { signal, cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await r.json() as T & {error?: string};
  if (!r.ok) throw new Error(data.error || '行情读取失败，请重试');
  return data;
}
function DailyTable({ points }: { points: Point[] }) {
  return <div className="pattern-table"><Table><TableHeader><TableRow>{['日期','开盘','收盘','最高','最低','成交量(万手)','成交额(亿元)','换手率','MA5','MA10','MA20','DIF','DEA','MACD','RSI14','量能比'].map(t => <TableHead key={t}>{t}</TableHead>)}</TableRow></TableHeader><TableBody>{points.map(p => <TableRow key={p.date}><TableCell>{p.date}</TableCell>{[p.open,p.close,p.high,p.low,p.volume/10000,p.amount === null ? null : p.amount/1e8,p.turnover,p.ma5,p.ma10,p.ma20,p.dif,p.dea,p.macd,p.rsi,p.volumeRatio].map((v,i) => <TableCell key={i}>{fmt(v)}{i === 6 && v !== null ? '%' : ''}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
export default function PatternMatcher() {
  const [code, setCode] = useState(''), [start, setStart] = useState(''), [finish, setFinish] = useState(''), [date, setDate] = useState(completeDate());
  const [data, setData] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [phase, setPhase] = useState('选择股票代码和样本区间，开始比较走势。');
  const [selected, setSelected] = useState(''), [display, setDisplay] = useState<'reference'|'candidate'>('reference');
  const request = useRef<AbortController | null>(null);
  async function scan(sample: Sample, targetDate: string, previewOnly = false) {
    try { validateSample(sample,targetDate); } catch(e) { setError(e instanceof Error ? e.message : '样本参数无效'); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const signal = controller.signal, query = new URLSearchParams({...sample,date:targetDate}).toString();
    setBusy(true); setError(''); setData(null); setSelected(''); setPhase(`正在读取 ${sample.code} 样本日线…`);
    try {
      const base = await read<Pick<Result, 'reference'|'calendar'|'date'>>(`/api/patterns?${query}`, signal);
      try { localStorage.setItem('pattern-selection-v2', JSON.stringify(sample)); } catch { /* Device preference storage may be disabled. */ }
      let result: Result = { ...base, matches: [], total: 0, processed: 0, evaluated: 0, skipped: 0, failed: 0, complete: false };
      setData(result);
      if (previewOnly) { setPhase(`${base.reference.stock.name} · 样本已载入，可开始筛选五只相似股票`); return; }
      setPhase('正在读取沪深京A股股票池…');
      const first = await read<Pool>(`/api/patterns?${query}&mode=universe&page=1`, signal);
      const all: Security[] = [...first.stocks];
      for (let page = 2; page <= first.pages; page += 5) {
        const pages = await Promise.all(Array.from({length: Math.min(5, first.pages - page + 1)}, (_, i) => read<Pool>(`/api/patterns?${query}&mode=universe&page=${page+i}`, signal)));
        pages.forEach(p => all.push(...p.stocks));
      }
      const stocks = [...new Map(all.map(s => [s.code, s])).values()];
      result = { ...result, total: first.total }; setData(result);
      for (let i = 0; i < stocks.length; i += 80) {
        setPhase(`正在比较 ${Math.min(i+80,stocks.length)} / ${stocks.length} 只股票…`);
        const chunks = Array.from({length:4},(_,n)=>stocks.slice(i+n*20,i+(n+1)*20)).filter(s => s.length);
        const batches = await Promise.all(chunks.map(async chunk => {
          try { return await read<Batch>(`/api/patterns?${query}&provider=${base.reference.provider}`, signal, { stocks: chunk }); }
          catch (e) { if (signal.aborted) throw e; return { matches: [], skipped: 0, failed: chunk.length }; }
        }));
        const matches: Match[] = batches.flatMap(b => b.matches);
        result = { ...result, matches: [...result.matches,...matches].sort((a,b) => b.score-a.score || a.code.localeCompare(b.code)).slice(0,5), processed: Math.min(i+80,stocks.length), evaluated: result.evaluated + matches.length, skipped: result.skipped + batches.reduce((s,b) => s+b.skipped,0), failed: result.failed + batches.reduce((s,b) => s+b.failed,0) };
        setData(result);
      }
      result = { ...result, complete: stocks.length === first.total && result.failed === 0, generatedAt: new Date().toISOString() };
      setData(result); setPhase(result.complete ? '筛选完成' : '筛选结束 · 仅展示成功读取的股票');
    } catch (e) { if (!signal.aborted) { setError(e instanceof Error ? e.message : '筛选失败'); setPhase('筛选未完成'); } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pattern-selection-v2') || 'null');
      if (saved && typeof saved.code === 'string' && typeof saved.start === 'string' && typeof saved.end === 'string') {
        validateSample(saved); setCode(saved.code); setStart(saved.start); setFinish(saved.end);
      }
    } catch { /* Ignore invalid or unavailable device preferences. */ }
    return () => request.current?.abort();
  }, []);
  function edit(setter: (value: string)=>void, value: string) {
    request.current?.abort(); setBusy(false); setter(value); setData(null); setSelected(''); setError(''); setPhase('样本条件已修改，请重新载入或筛选。');
  }
  const sampleName = data?.reference.stock.name || '所选股票';
  const sampleSymbol = data ? `${data.reference.stock.market === 1 ? 'sh' : /^[489]/.test(data.reference.stock.code) ? 'bj' : 'sz'}${data.reference.stock.code}` : '';

  const chosen = data?.matches.find(s => s.code === selected) || data?.matches[0];
  const sample = data?.reference.points || [], end = sample.at(-1);
  const chart = sample.map((p,i) => ({ day: i+1, date: p.date, candidateDate: chosen?.points[i]?.date, sample: (p.close/sample[0].close-1)*100, match: chosen ? (chosen.points[i].close/chosen.points[0].close-1)*100 : undefined }));
  return <section className="pattern-panel" aria-label="自选样本相似走势筛选">
    <div className="pattern-heading"><div><div className="eyebrow">PATTERN MATCH</div><h2>自选样本 · 相似走势</h2><p>{data ? `${sampleName}（${data.reference.stock.code}） · ${data.reference.start}—${data.reference.end}` : '选择一只A股及一段历史走势，寻找最接近的5只股票'}</p></div><span className="pattern-badge">{data?.reference.provider === 'tencent' ? '五因子 · 备用数据' : '六因子评分'}</span></div>
    <form className="pattern-controls" onSubmit={e => { e.preventDefault(); void scan({code:code.trim(),start,end:finish},date); }}>
      <label>样本股票代码<Input aria-label="样本股票代码" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="输入6位A股代码" required value={code} onChange={e=>edit(setCode,e.target.value)} disabled={busy}/></label>
      <label>样本开始日期<Input aria-label="样本开始日期" type="date" required value={start} max={finish || completeDate()} min="1990-12-19" onChange={e=>edit(setStart,e.target.value)} disabled={busy}/></label>
      <label>样本结束日期<Input aria-label="样本结束日期" type="date" required value={finish} max={completeDate()} min={start || '1990-12-19'} onChange={e=>edit(setFinish,e.target.value)} disabled={busy}/></label>
      <label>筛选截止日<Input aria-label="筛选截止日" type="date" required value={date} max={completeDate()} min={finish} onChange={e=>edit(setDate,e.target.value)} disabled={busy}/></label>
      <Button disabled={busy} variant="outline" type="button" onClick={()=>void scan({code:code.trim(),start,end:finish},date,true)}>查看样本走势</Button>
      <Button disabled={busy} type="submit">{busy ? '处理中…' : '筛选五只相似股票'}</Button>
      {busy && <Button variant="outline" type="button" onClick={()=>{request.current?.abort();setBusy(false);setPhase('已停止 · 当前为部分结果');}}>停止</Button>}
      <p>样本至少5个交易日、最多366个自然日。休市日按实际交易日对齐；记住所选样本仅限当前浏览器。</p>
    </form>
    {error && <div className="error-banner" role="alert">{error}。未生成完整排名，可重新筛选。</div>}
    <div className="pattern-status" role="status"><span>{phase}</span>{data && <span>已处理 {data.processed}/{data.total || '—'} · 有效 {data.evaluated} · 剔除 {data.skipped} · 失败 {data.failed}</span>}</div>
    {busy && <progress className="pattern-progress" value={data?.processed || 0} max={data?.total || 1} aria-label="全市场筛选进度"/>}
    {data && <>
      {data.reference.provider === 'tencent' && <div className="pattern-source-note">本次使用腾讯财经备用日线。成交额、换手率缺失，换手率不参与评分，其余五项权重按比例归一化。</div>}
      <div className="pattern-grid"><div className="pattern-chart">
        <div className="pattern-chart-head"><div><h3>走势对比</h3><p>{data.reference.start}—{data.reference.end} · {sample.length}个交易日 · 首日收盘归零</p></div>{end && <strong className={(end.close/sample[0].close-1)>=0?'rise':'fall'}>{((end.close/sample[0].close-1)*100).toFixed(2)}%<small>样本区间涨跌</small></strong>}</div>
        <div className="pattern-chart-canvas"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:12,right:18,bottom:6,left:0}}><CartesianGrid stroke="#20313d" vertical={false}/><XAxis dataKey="day" tick={{fill:'#99afba',fontSize:12}} tickFormatter={v=>`第${v}日`} minTickGap={20}/><YAxis tick={{fill:'#99afba',fontSize:12}} tickFormatter={v=>`${v}%`}/><Tooltip contentStyle={{background:'#101f29',borderColor:'#35505d',color:'#eaf2f5'}} labelFormatter={(_,payload)=>{const p=payload?.[0]?.payload;return p ? `样本 ${p.date}${p.candidateDate ? ' / 对比 '+p.candidateDate : ''}` : '';}} formatter={(v)=>`${Number(v).toFixed(2)}%`}/><Legend/><Line type="linear" name={`${sampleName}样本`} dataKey="sample" stroke="#39d2c0" strokeWidth={3} dot={false}/>{chosen && <Line type="linear" name={chosen.name} dataKey="match" stroke="#ffb547" strokeWidth={2} dot={false}/>}</LineChart></ResponsiveContainer></div>
        {end && <div className="pattern-metrics"><span>收盘 <b>¥{fmt(end.close)}</b></span><span>RSI14 <b>{fmt(end.rsi)}</b></span><span>MACD <b>{fmt(end.macd)}</b></span><span>换手率 <b>{end.turnover === null ? '—' : fmt(end.turnover)+'%'}</b></span></div>}
      </div><div className="pattern-results"><h3>{data.date} · {data.total === 0 ? '候选待筛选' : data.complete ? '相似度前5' : '暂列前5'}</h3><p>分数为形态相似程度，不代表上涨概率。</p>
        {!data.matches.length && <div className="pattern-empty">{busy ? '日线比较完成后，结果将逐步出现。' : data.total === 0 ? '样本已载入，点击“筛选五只相似股票”开始比较。' : '暂无有效候选，请重试或调整日期。'}</div>}
        {data.matches.map((s,i)=><button key={s.code} className={`pattern-result ${chosen?.code===s.code?'selected':''}`} onClick={()=>setSelected(s.code)} aria-pressed={chosen?.code===s.code}><span className="pattern-rank">0{i+1}</span><span><b>{s.name}</b><small>{s.code} · 区间 {fmt(s.change)}%</small></span><strong>{s.score.toFixed(1)}<small>/ 100</small></strong></button>)}
        {data.matches.length>0 && data.matches.length<5 && <p>有效候选不足5只，按实际数量展示。</p>}
      </div></div>
      {chosen && <div className="pattern-factors" aria-label={`${chosen.name}匹配依据`}>{FACTORS.map((label,i)=><div key={label}><span>{label} <small>{(data.reference.provider === 'tencent' ? (i === 5 ? 0 : WEIGHTS[i]/0.9*100) : WEIGHTS[i]*100).toFixed(1)}%权重</small></span><strong>{chosen.parts[i] === null ? '缺数据' : chosen.parts[i]!.toFixed(1)}</strong><progress value={chosen.parts[i] ?? 0} max={100}/></div>)}</div>}
      <details className="pattern-details"><summary>查看每日行情与技术指标</summary><div className="pattern-data-switch"><Button variant={display==='reference'?'default':'outline'} onClick={()=>setDisplay('reference')}>{sampleName}样本</Button><Button disabled={!chosen} variant={display==='candidate'?'default':'outline'} onClick={()=>setDisplay('candidate')}>{chosen?.name || '候选股票'}</Button></div><DailyTable points={display==='candidate'&&chosen ? chosen.points : sample}/></details>
      <details className="pattern-details"><summary>筛选口径与数据来源</summary><p>从新浪财经当前沪深京A股股票池中，取截至 {data.date} 的最近 {sample.length} 个交易日，与样本逐日对齐。剔除样本股票自身、ST、退市标记、区间停牌及预热数据不足的股票。历史日期筛选使用当前股票池，存在存续偏差，不能作为严格历史回测。</p><p>价格使用首日收盘归一化对数路径；量能为当日成交量/此前5日均量；均线为收盘价相对MA5/10/20的偏离；MACD(12,26,9)按股价归一化；RSI使用14日Wilder平滑；换手率使用log(1+x)。各项距离为均方根差，固定尺度分别为0.10、0.8、0.05、0.02、25、1。综合分=100×exp(-加权距离)，至少60根日线预热。权重未经收益回测，不预示后续收益。</p><p><a href={data.reference.provider === 'tencent' ? `https://gu.qq.com/${sampleSymbol}` : `https://quote.eastmoney.com/${sampleSymbol}.html`} target="_blank" rel="noreferrer">{data.reference.source}</a> · 前复权价格会随后续公司行动修订；每天16:00（北京时间）后纳入当日数据。{data.generatedAt && `本次计算：${new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）。`}选择筛选截止日后点击筛选，将重新读取行情；关闭页面会停止进行中的扫描。</p></details>
    </>}
  </section>;
}
