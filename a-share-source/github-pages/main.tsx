import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';
import { setApiTransport } from '../lib/api-client';
import type { Snapshot } from './snapshot';
const worker=new Worker(new URL('./analysis.worker.ts',import.meta.url),{type:'module'});
let serial=0;
const pending=new Map<number,{resolve:(data:unknown)=>void;reject:(e:Error)=>void;cleanup:()=>void}>();
worker.onmessage=({data})=>{
  const task=pending.get(data.id); if(!task)return;
  pending.delete(data.id);task.cleanup();
  if(data.error)task.reject(new Error(data.error));else task.resolve(data.data);
};
worker.onerror=()=>{ for(const p of pending.values()){p.cleanup();p.reject(new Error('分析线程启动失败，请刷新页面'));}pending.clear(); };
function call(path:string,body?:unknown,signal?:AbortSignal|null):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('已停止','AbortError'));return;}
    const id=++serial;
    const abort=()=>{pending.delete(id);reject(new DOMException('已停止','AbortError'));};
    pending.set(id,{resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});
    signal?.addEventListener('abort',abort,{once:true});
    worker.postMessage({id,path,body,base:new URL('./',document.baseURI).href});
  });
}
setApiTransport(async(path,init)=>{
  try {return Response.json(await call(path,typeof init?.body==='string'?JSON.parse(init.body):undefined,init?.signal));}
  catch(e){if(init?.signal?.aborted)throw e;return Response.json({error:e instanceof Error?e.message:'快照读取失败'},{status:503});}
});
function App(){
  const [meta,setMeta]=useState<Snapshot|null>(null),[error,setError]=useState('');
  useEffect(()=>{call('/meta').then(v=>setMeta(v as Snapshot)).catch(e=>setError(e.message));},[]);
  return <>
    <div className="pattern-source-note" role="status" style={{margin:16}}>
      {error || (meta ? `收盘数据：${meta.date} · 日线采集 ${meta.available}/${meta.total} 只（${(meta.available/meta.total*100).toFixed(1)}%），失败 ${meta.failed} 只 · 样本最早 ${meta.minSampleDate}（个股以实际数据为准）` : '正在加载每日数据快照…')}
      <p>每个工作日北京时间16:23启动更新，可能延迟；行情日期以实际快照为准。首次全市场筛选需下载压缩日线，计算在本设备完成。刷新页面可载入新快照。</p>
      {meta&&<p>{meta.source} · 采集时间：{new Date(meta.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）</p>}
    </div>
    {meta&&<Home snapshotDate={meta.date} minSampleDate={meta.minSampleDate}/>}
  </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
