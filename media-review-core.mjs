export const pending = status => ['checking', 'pending', 'processing'].includes(status);
const resumable = row => !!row?.requestId && (pending(row.status) || row.interrupted);
const persistable = row => ['approved','rejected','rejected_invalid','pending','processing'].includes(row.status) || resumable(row);
const remoteStates = {ASSET_REVIEW_STATUS_PENDING:'pending', ASSET_REVIEW_STATUS_PROCESSING:'processing', ASSET_REVIEW_STATUS_APPROVED:'approved', ASSET_REVIEW_STATUS_REJECTED:'rejected'};
export function result(value) {
  if (!value || typeof value !== 'object') throw Error('验证服务返回了无效结果');
  let status = remoteStates[value.status] || value.status;
  if (status === 'rejected' && value.reject_reason === 'ASSET_REJECT_REASON_INVALID_PARAMETER') status = 'rejected_invalid';
  if (!['pending','processing','approved','rejected','rejected_invalid'].includes(status)) throw Error('验证服务返回了未知状态');
  const requestId = value.requestId || value.id;
  if (pending(status) && (typeof requestId !== 'string' || !requestId)) throw Error('验证服务未返回审核任务 ID');
  return {status, ...(requestId ? {requestId:String(requestId)} : {}), message:typeof value.message === 'string' ? value.message.slice(0,1000) : ''};
}
const canonicalURLs = new Map();
function canonicalMediaURL(url) {
  // Relative/local asset paths cannot have a hostname without a scheme. Avoid
  // constructing and throwing a URL for every node on every canvas drag frame.
  if (!url.includes(':')) return url;
  if (canonicalURLs.has(url)) return canonicalURLs.get(url);
  let canonical = url;
  try {
    const parsed = new URL(url);
    // Only TapNow's known thumbnail parameter is irrelevant to file identity.
    if (parsed.hostname === 'files.tapnow.media') { parsed.searchParams.delete('variant_name'); canonical = parsed.href; }
  } catch {}
  // Cache only URL normalization, never mutable node identity or clip metadata.
  // Bound retention across documents while fitting a 500-node canvas working set.
  if (canonicalURLs.size >= 1024) canonicalURLs.delete(canonicalURLs.keys().next().value);
  canonicalURLs.set(url,canonical);
  return canonical;
}
export function media(node, defaults = {}) {
  const type = node?.type;
  const url = type === 'video' ? node.video || defaults.video : type === 'audio' ? node.audio || defaults.audio : type === 'image' ? node.fullImage || node.image : null;
  if (!url || typeof url !== 'string') return null;
  const canonical = canonicalMediaURL(url);
  const clip = type === 'video' && node.clip ? structuredClone(node.clip) : null;
  return {key:JSON.stringify([type,canonical,clip]), type, url, clip, fileId:node.currentSourceFileId || node.sourceFileId || null, nodeId:node.id};
}
export class ReviewService {
  constructor({adapter=null, read=()=>[], write=()=>{}, change=()=>{}, interval=2000, timeout=120000} = {}) {
    this.adapter=adapter; this.write=write; this.change=change; this.interval=interval; this.timeout=timeout;
    this.entries=new Map(); this.running=new Map(); this.trace=[];
    try { for (const row of read()) if (row && typeof row.key==='string' && persistable(row)) this.entries.set(row.key,{...row,interrupted:resumable(row)}); } catch {}
  }
  get(input) { return this.entries.get(input?.key) || {status:'unknown'}; }
  setAdapter(adapter) {
    if (adapter && (typeof adapter.submit!=='function' || typeof adapter.poll!=='function')) throw Error('审核适配器需要 submit 和 poll 方法');
    for (const key of this.running.keys()) this.cancel({key});
    this.adapter=adapter;
  }
  save(input, patch) {
    const entry={...this.get(input),...patch,key:input.key,updatedAt:Date.now()}; this.entries.set(input.key,entry);
    this.trace.push({at:entry.updatedAt,requestId:entry.requestId || null,status:entry.status,nodeId:input.nodeId || null});
    if(this.trace.length>200)this.trace.shift();
    // Sources and credentials are not included in the trace. Quota failures remain visible.
    try { this.write([...this.entries.values()].filter(persistable).slice(-300)); } catch { entry.persistenceError=true; }
    this.change(input,entry); return entry;
  }
  cancel(input) {
    const task=this.running.get(input?.key); if(!task)return false;
    this.running.delete(input.key); task.controller.abort();
    this.save(input,{status:task.previous.status,requestId:task.previous.requestId,message:'验证已取消',interrupted:resumable(task.previous)});
    return true;
  }
  submit(input) {
    if(!input) return Promise.reject(Error('请先添加需要验证的素材'));
    if(this.running.has(input.key))return this.running.get(input.key).promise;
    const previous=this.get(input);
    if(previous.status==='approved')return Promise.resolve(previous);
    if(!this.adapter)return Promise.resolve(this.save(input,{status:'configuration_required',interrupted:resumable(previous),message:'待连接合规验证 API，尚未提交审核'}));
    const task={controller:new AbortController(),previous,adapter:this.adapter};
    this.running.set(input.key,task);
    task.promise=this.execute(input,task); return task.promise;
  }
  async execute(input,task) {
    const {signal}=task.controller, adapter=task.adapter;
    let timer, abortListener;
    const stale=()=>this.running.get(input.key)!==task;
    const aborted=new Promise((_,reject)=>{abortListener=()=>reject(new DOMException('已取消','AbortError'));signal.addEventListener('abort',abortListener,{once:true});});
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('验证超时，请重试获取审核结果'));task.controller.abort();},this.timeout);});
    const call=fn=>Promise.race([Promise.resolve().then(fn),aborted,deadline]);
    try {
      this.save(input,{status:'checking',message:'',requestId:resumable(task.previous)?task.previous.requestId:undefined,interrupted:false});
      if(adapter.eligibility){const eligibility=await call(()=>adapter.eligibility(structuredClone(input),{signal}));if(eligibility?.allowed!==true) return stale()?this.get(input):this.save(input,{status:eligibility?.configurationRequired?'configuration_required':'unavailable',interrupted:resumable(task.previous),message:eligibility?.message || '当前素材暂不可提交验证'});}
      if(stale())return this.get(input);
      this.save(input,{status:'processing'});
      let review=result(await call(()=>resumable(task.previous) ? adapter.poll(task.previous.requestId,{signal,input:structuredClone(input)}) : adapter.submit(structuredClone(input),{signal}))); 
      while(!stale()) {
        this.save(input,{...review,interrupted:false});
        if(!pending(review.status))return this.get(input);
        await call(()=>new Promise(resolve=>{const id=setTimeout(done,this.interval);function done(){clearTimeout(id);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});}));
        review=result(await call(()=>adapter.poll(review.requestId,{signal,input:structuredClone(input)})));
      }
    } catch(error) {
      if(!stale())return this.save(input,{status:'failed',message:error?.name==='AbortError'?'验证已中断，请重试':error.message || '验证失败，请重试',interrupted:!!this.get(input).requestId});
    } finally {clearTimeout(timer);signal.removeEventListener('abort',abortListener);if(!stale())this.running.delete(input.key);}
    return this.get(input);
  }
}

// Provider gateway contract; credentials and vendor-specific mapping stay on the server.
export function httpAdapter({base='/api/media-reviews',fetcher=globalThis.fetch}={}) {
  async function request(path,options){const response=await fetcher(base+path,{...options,headers:{'Content-Type':'application/json'},credentials:'same-origin'});const body=await response.json();if(!response.ok){const error=Error(body.message || body.error || '验证服务请求失败');error.code=body.code;throw error;}return body;}
  return {
    eligibility:async(input,{signal})=>{const config=await request('/config',{signal});return {allowed:config.configured===true,configurationRequired:config.configured!==true,message:config.message || '待连接合规验证 API，尚未提交审核'};},
    submit:(input,{signal})=>request('',{method:'POST',signal,body:JSON.stringify({fileId:input.fileId,source:{type:input.type,url:input.url,clip:input.clip},clientRequestId:crypto.randomUUID()})}),
    poll:(id,{signal})=>request('/'+encodeURIComponent(id),{signal})
  };
}
