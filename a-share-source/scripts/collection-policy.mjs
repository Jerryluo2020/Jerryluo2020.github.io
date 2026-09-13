export const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
export async function retryRead(fn,{attempts=3,wait=sleep}={}){
  let error;
  for(let i=0;i<attempts;i++){
    try{return await fn();}catch(e){
      error=e;
      // Authorization failures require configuration, not another request.
      if(/HTTP (401|403)/.test(String(e.message)))throw e;
      if(i+1<attempts){
        const retryAfter=String(e.message).match(/Retry-After=(\d+)/);
        await wait(Math.max(3000*2**i,retryAfter?Number(retryAfter[1])*1000:0));
      }
    }
  }
  throw error;
}
export async function collectGroup(stocks,{read,onSuccess,onFailure,wait=sleep,now=Date.now}){
  let consecutiveFailures=0;
  for(let i=0;i<stocks.length;i+=4){
    const batch=stocks.slice(i,i+4),start=now();
    const results=await Promise.all(batch.map(async stock=>{
      try{const rows=await retryRead(()=>read(stock),{attempts:2,wait});await onSuccess(stock,rows);return true;}
      catch(e){await onFailure(stock,e);return false;}
    }));
    consecutiveFailures=results.every(v=>!v)?consecutiveFailures+1:0;
    if(consecutiveFailures>=6)throw new Error('连续24只股票采集失败，已停止请求并保存进度，请检查失败日志');
    if(consecutiveFailures>=3)await wait(30_000);
    await wait(Math.max(0,1000-(now()-start)));
  }
}
