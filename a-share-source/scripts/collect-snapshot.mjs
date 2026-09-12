import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { history, universePage, completeDate } from '../lib/pattern.ts';
import { allRankings } from '../lib/rankings.ts';
const out=process.argv[2];
if(!out)throw new Error('Usage: node scripts/collect-snapshot.mjs OUTPUT_DIRECTORY');
await mkdir(out,{recursive:true});
const end=completeDate();
// One provider per snapshot: never compare differently adjusted price series.
const provider='tencent',indexStock={code:'000001',name:'上证指数',market:1};
async function retry(fn,attempts=3){
  let error;
  for(let i=0;i<attempts;i++){try{return await fn();}catch(e){error=e;await new Promise(r=>setTimeout(r,1000*(i+1)));}}
  throw error;
}
const index=await retry(()=>history(indexStock,end,provider,1100));
if(index.length<300)throw new Error('交易日历数据不足，不发布');
const date=index.at(-1).date;
// Refuse a stale calendar on trading weekdays instead of labelling it today's data.
if((Date.parse(end)-Date.parse(date))/86400000>12)throw new Error('交易日历过旧，不发布');
const first=await retry(()=>universePage(1)),pool=[...first.stocks];
for(let page=2;page<=first.pages;page++)pool.push(...(await retry(()=>universePage(page))).stocks);
const stocks=[...new Map(pool.map(s=>[`${s.market}.${s.code}`,s])).values()];
if(stocks.length!==first.total)throw new Error(`股票池不完整 ${stocks.length}/${first.total}，不发布`);
const source='腾讯财经前复权日线（缺成交额、换手率）；新浪/东方财富收盘热力榜';
let rankings,rankingSource;
try{rankings=await retry(()=>allRankings('sina'));rankingSource='新浪财经';}
catch{rankings=await retry(()=>allRankings('eastmoney'));rankingSource='东方财富';}
const files={},failures=[];
let available=0;
for(let offset=0;offset<stocks.length;offset+=80){
  const group=stocks.slice(offset,offset+80),packed={};
  // Modest concurrency and retry to reduce public-provider throttling.
  for(let i=0;i<group.length;i+=8){
    await Promise.all(group.slice(i,i+8).map(async stock=>{
      const key=`${stock.market}.${stock.code}`;
      try{
        const bars=await retry(()=>history(stock,date,provider,1100));
        if(!bars.length)throw new Error('empty history');
        packed[key]=bars.map(b=>[b.date,b.open,b.close,b.high,b.low,b.volume,b.amount,b.turnover]);
        available++;
      }catch(e){failures.push({code:stock.code,error:String(e.message).slice(0,100)});}
    }));
  }
  const gzip=gzipSync(JSON.stringify(packed));
  const hash=createHash('sha256').update(gzip).digest('hex').slice(0,16);
  const file=`bars-${offset/80}-${hash}.json.gz`;
  await writeFile(`${out}/${file}`,gzip);
  for(const key of Object.keys(packed))files[key]=file;
  console.log(JSON.stringify({processed:Math.min(offset+80,stocks.length),total:stocks.length,available,failed:failures.length}));
}
await writeFile(`${out}/failures.json`,JSON.stringify(failures));
// Never replace a usable site with an almost empty collection.
if(available/stocks.length<0.9)throw new Error(`日线覆盖率 ${(available/stocks.length*100).toFixed(1)}% 低于90%，保留上一次发布`);
const generatedAt=new Date().toISOString();
const manifest={version:1,date,generatedAt,provider,source,stocks,total:stocks.length,available,failed:failures.length,minSampleDate:index[60].date,index,files,rankings:{...rankings,updatedAt:generatedAt,source:`${rankingSource} · ${date} 收盘快照`}};
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest));
console.log(JSON.stringify({date,available,total:stocks.length,generatedAt}));
