import { loadSnapshot } from './snapshot';
let snapshot: ReturnType<typeof loadSnapshot> | undefined;
self.onmessage = async (event: MessageEvent) => {
  const {id,path,body,base}=event.data;
  try {
    snapshot ||= loadSnapshot(base);
    const {meta,handler}=await snapshot;
    const data=path==='/meta'?meta:await handler(path,body);
    self.postMessage({id,data});
  } catch(e) { self.postMessage({id,error:e instanceof Error?e.message:'计算失败'}); }
};
