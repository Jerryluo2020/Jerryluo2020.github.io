import { mkdir, writeFile, readFile, copyFile }  from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { history, universePage, completeDate } from '../lib/pattern.ts';
import { allRankings } from '../lib/rankings.ts';
import { retryRead, collectGroup } from './collection-policy.mjs';
const out=process.argv[2], cache=process.argv[3] || `${out}/checkpoint`;
await mkdir(cache,{recursive:true});
if(!out)throw new Error('Usage: node scripts/collect-snapshot.mjs OUTPUT_DIRECTORY');
await mkdir(out,{recursive:true});
const end=completeDate();
// One provider per snapshot: never compare differently adjusted price series.
const provider='tencent',indexStock={code:'000001',name:'上证指数',market:1};
const retry=retryRead;
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
let available=0,resumed=0;
const checkpointPath=`${cache}/state.json`;
let state={date,provider,files:{}};
try{const saved=JSON.parse(await readFile(checkpointPath,'utf8'));if(saved.date===date&&saved.provider===provider)state=saved;}catch{}
async function checkpoint(){
  await writeFile(checkpointPath,JSON.stringify(state));
  await writeFile(`${out}/failures.json`,JSON.stringify(failures));
  const report={date,total:stocks.length,available,resumed,failed:failures.length,lastFailures:failures.slice(-10)};
  await writeFile(`${out}/progress.json`,JSON.stringify(report));
  console.log(JSON.stringify(report));
}
for(let offset=0;offset<stocks.length;offset+=80){
  const group=stocks.slice(offset,offset+80),packed={};
  const savedChunks=new Map();
  for(const stock of group){
    const key=`${stock.market}.${stock.code}`,file=state.files[key];
    if(!file)continue;
    try{
      if(!savedChunks.has(file))savedChunks.set(file,JSON.parse(gunzipSync(await readFile(`${cache}/${file}`)).toString()));
      const rows=savedChunks.get(file)[key];
      if(!Array.isArray(rows)||!rows.length)continue;
      packed[key]=rows;available++;resumed++;
    }catch{delete state.files[key];}
  }
  let fatal;
  try{
    await collectGroup(group.filter(s=>!packed[`${s.market}.${s.code}`]),{
      read:async stock=>{const bars=await history(stock,date,provider,1100);if(!bars.length)throw new Error('empty history');return bars;},
      onSuccess:(stock,bars)=>{packed[`${stock.market}.${stock.code}`]=bars.map(b=>[b.date,b.open,b.close,b.high,b.low,b.volume,b.amount,b.turnover]);available++;},
      onFailure:(stock,e)=>{const failure={code:stock.code,market:stock.market,error:String(e.message).slice(0,250)};failures.push(failure);console.error(JSON.stringify({stage:'stock-failure',...failure}));},
    });
  }catch(e){fatal=e;}
  const gzip=gzipSync(JSON.stringify(packed));
  const hash=createHash('sha256').update(gzip).digest('hex').slice(0,16);
  const file=`bars-${offset/80}-${hash}.json.gz`;
  await writeFile(`${out}/${file}`,gzip);
  await copyFile(`${out}/${file}`,`${cache}/${file}`);
  for(const key of Object.keys(packed)){files[key]=file;state.files[key]=file;}
  await checkpoint();
  if(fatal)throw fatal;
}
// Never replace a usable site with an almost empty collection.
if(available/stocks.length<0.9)throw new Error(`日线覆盖率 ${(available/stocks.length*100).toFixed(1)}% 低于90%，保留上一次发布`);
const generatedAt=new Date().toISOString();
const manifest={version:1,date,generatedAt,provider,source,stocks,total:stocks.length,available,failed:failures.length,minSampleDate:index[60].date,index,files,rankings:{...rankings,updatedAt:generatedAt,source:`${rankingSource} · ${date} 收盘快照`}};
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest));
console.log(JSON.stringify({date,available,total:stocks.length,generatedAt}));
