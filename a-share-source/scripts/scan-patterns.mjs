import { writeFile } from 'node:fs/promises';
import { reference, validateSample, universePage, targetCalendar, matchStock, completeDate } from '../lib/pattern.ts';
const [code,start,end] = process.argv.slice(2,5), requestedDate = process.argv[5] || completeDate();
if (!code || !start || !end) throw new Error('用法: node scripts/scan-patterns.mjs 股票代码 样本开始YYYY-MM-DD 样本结束YYYY-MM-DD [筛选截止YYYY-MM-DD]');
const sample = {code,start,end};
validateSample(sample,requestedDate);
const ref = await reference(sample);
console.log(JSON.stringify({stage:'reference', sample, provider:ref.provider}));
const calendar = await targetCalendar(requestedDate, ref.points.length, ref.provider);
const first = await universePage(1), all = [...first.stocks];
for (let page = 2; page <= first.pages; page += 5) {
  const pages = await Promise.all(Array.from({length: Math.min(5, first.pages - page + 1)}, (_, i) => universePage(page + i)));
  pages.forEach(p => all.push(...p.stocks));
  console.log(JSON.stringify({stage:'universe',page:Math.min(page+4,first.pages),pages:first.pages}));
}
const stocks = [...new Map(all.map(s => [s.code, s])).values()];
let top = [], failed = 0, skipped = 0, evaluated = 0;
console.log(JSON.stringify({ reference: ref.points, total: first.total, unique: stocks.length, date: calendar.at(-1) }));
for (let i = 0; i < stocks.length; i += 80) {
  const results = await Promise.all(stocks.slice(i, i + 80).map(s => matchStock(s, ref, requestedDate, calendar)));
  failed += results.filter(r => r.failed).length; skipped += results.filter(r => r.skipped).length;
  const matches = results.flatMap(r => r.match ? [r.match] : []); evaluated += matches.length;
  top = [...top, ...matches].sort((a,b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0,5);
  await writeFile(new URL('../public/pattern-latest.json', import.meta.url), JSON.stringify({ reference: ref, calendar, date: calendar.at(-1), requestedDate, sample, matches: top, failed, skipped, evaluated, processed: Math.min(i+80,stocks.length), total:first.total, generatedAt:new Date().toISOString(), complete:false }));
  if (i % 80 === 0) console.log(JSON.stringify({ processed: Math.min(i + 80, stocks.length), evaluated, failed, skipped }));
}
const result = { reference: ref, calendar, date: calendar.at(-1), requestedDate, sample, matches: top, failed, skipped, evaluated, processed: stocks.length, total: first.total, generatedAt: new Date().toISOString(), complete: stocks.length === first.total && failed === 0 };
await writeFile(new URL('../public/pattern-latest.json', import.meta.url), JSON.stringify(result));
console.log(JSON.stringify({ ...result, reference: undefined, matches: top.map(({points, ...s}) => s) }));
