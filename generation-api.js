/* Provider-neutral task lifecycle. No credentials are persisted. */
(function(root){
  'use strict';
  const isGenerationMediaRef = value => typeof value === 'string' && /^\/api\/generation\/media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const isLocalMediaSource = value => isGenerationMediaRef(value) || typeof value === 'string' && /^(?:asset:[^\s]+$|data:(?:image|video|audio)\/|data:(?:model\/gltf-binary|application\/octet-stream);base64,)/.test(value);
  function taskMediaState(value){
    const result={}, status=value?.providerStatus;
    if(['queued','running','succeeded','failed','cancelled','unknown'].includes(status))result.providerStatus=status;
    const source=value?.localization;
    if(source&&typeof source==='object'&&!Array.isArray(source)){
      const localization={};
      if(['pending','downloading','ready','failed','cancelled'].includes(source.state))localization.state=source.state;
      if(Number.isSafeInteger(source.revision)&&source.revision>=0)localization.revision=source.revision;
      if(typeof source.errorCode==='string'&&/^[a-zA-Z0-9_]{1,80}$/.test(source.errorCode))localization.errorCode=source.errorCode;
      if(typeof source.retryable==='boolean')localization.retryable=source.retryable;
      if(Object.keys(localization).length)result.localization=localization;
    }
    return result;
  }
  class TaskService {
    constructor({prepareRequest,prepareInputs}={}){this.provider=null;this.prepareRequest=prepareRequest;this.prepareInputs=prepareInputs;this.jobs=new Map();this.listeners=new Set();this.recoveries=new Map();}
    setProvider(provider){if(provider&&typeof provider.generate!=='function')throw new TypeError('Provider.generate is required');this.provider=provider;}
    subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
    emit(job){for(const fn of this.listeners)fn({...job,controller:undefined});}
    submit(request,{beforeDispatch,beforeDispatchReady,beforeTransportReady}={}){
      if(!request?.kind)throw new TypeError('Task kind is required');
      if(beforeDispatch!==undefined&&typeof beforeDispatch!=='function')throw new TypeError('beforeDispatch must be a host function');
      if(beforeDispatchReady!==undefined&&typeof beforeDispatchReady!=='function')throw new TypeError('beforeDispatchReady must be a host function');
      if(beforeTransportReady!==undefined&&typeof beforeTransportReady!=='function')throw new TypeError('beforeTransportReady must be a host function');
      const job={id:crypto.randomUUID(),request:structuredClone(request),status:'queued',progress:0,createdAt:Date.now(),controller:new AbortController()};
      // Closures are host-only: never serialize them into task requests or public snapshots.
      Object.defineProperty(job,'beforeDispatch',{value:beforeDispatch});
      Object.defineProperty(job,'beforeDispatchReady',{value:beforeDispatchReady});
      Object.defineProperty(job,'beforeTransportReady',{value:beforeTransportReady});
      Object.defineProperty(job,'transport',{value:this.provider,writable:true,configurable:true});
      this.jobs.set(job.id,job);this.emit(job);queueMicrotask(()=>this.run(job));return job;
    }
    async run(job){
      if(job.controller.signal.aborted)return;
      // A durable host receipt must commit before preparing media or contacting a provider.
      try{await job.beforeDispatchReady?.({jobId:job.id,signal:job.controller.signal});}
      catch(error){if(job.controller.signal.aborted)return;job.status='failed';job.error=error.message||'生成执行记录未能保存';this.emit(job);return;}
      if(job.controller.signal.aborted)return;
      {
        const validateSources=()=>{if(job.controller.signal.aborted)throw job.controller.signal.reason;job.beforeDispatch?.();};
        const context={jobId:job.id,signal:job.controller.signal,validateSources,acceptSourceReplacements:receipts=>job.beforeDispatch?.acceptReplacements?.(receipts)};
        try{
          validateSources();
          const prepare=async fn=>{
            if(!fn)return;
            const prepared=await fn(structuredClone(job.request),context);if(job.controller.signal.aborted)return;
            if(!prepared?.kind||prepared.kind!==job.request.kind)throw Error('生成请求准备失败');job.request=prepared;validateSources();
          };
          await prepare(this.prepareRequest);if(job.controller.signal.aborted)return;
          // Validate parameters first, but avoid decoding/uploading media or reserving
          // result nodes when this task's captured provider is explicitly unconfigured.
          const configured=job.transport?await job.transport.isConfigured?.({request:structuredClone(job.request),signal:job.controller.signal}):false;
          if(job.controller.signal.aborted)return;validateSources();
          if(configured===false){job.status='configuration_required';job.error='尚未配置生成服务，请连接 API 后重试';this.emit(job);return;}
          await prepare(this.prepareInputs);if(job.controller.signal.aborted)return;
          // The final materialized request needs its own durable fingerprint;
          // an earlier receipt cannot authorize a different transport body.
          await job.beforeTransportReady?.({jobId:job.id,signal:job.controller.signal});
          if(job.controller.signal.aborted)return;
          validateSources();
        }
        catch(error){if(job.controller.signal.aborted)return;job.status=error.code==='configuration_required'?'configuration_required':'failed';job.code=error.code;if(error.providerDispatched===false)job.providerDispatched=false;job.error=error.message||'生成参数无效';this.emit(job);return;}
      }
      job.status='running';this.emit(job);
      if(job.controller.signal.aborted)return;
      try{job.beforeDispatch?.();}catch(error){job.status='failed';job.error=error.message||'生成来源已变化';this.emit(job);return;}
      return this.consume(job,()=>job.transport.generate(job.request,{jobId:job.id,signal:job.controller.signal,onTaskIdentity:id=>{job.remoteTaskId=id;},onProgress:(value,metadata)=>{if(job.status!=='running')return;Object.assign(job,taskMediaState(metadata));job.progress=Math.max(job.progress,Math.min(99,Math.max(0,Number(value)||0)));this.emit(job);}}));
    }
    async consume(job,execute){
      try{
        job.providerDispatched=true;job.providerActive=true;
        const result=await execute();
        if(job.controller.signal.aborted)return;
        this.validateResult(result);
        Object.assign(job,taskMediaState(result));job.outputs=result.outputs;job.progress=100;job.status='succeeded';
      }catch(error){if(job.controller.signal.aborted)return;job.status=error.code==='configuration_required'?'configuration_required':error.code==='unknown'?'unknown':'failed';job.code=error.code;if(error.providerDispatched===false&&['failed','configuration_required'].includes(job.status))job.providerDispatched=false;job.recovery=error.recovery;Object.assign(job,taskMediaState(error));job.error=error.message||'生成失败';}finally{job.providerActive=false;}
      this.emit(job);
    }
    validateResult(result){
        if(!Array.isArray(result?.outputs)||!result.outputs.length)throw new Error('服务未返回生成结果');
        const valid = source => typeof source==='string' && (isLocalMediaSource(source) || /^(https?:|blob:)/.test(source));
        for(const output of result.outputs){
          const source=output.url||output[output.type]||(output.type==='image'?output.fullImage:null);
          if(!['image','video','audio','text','model'].includes(output.type)||(output.type==='text'?!output.text?.trim():typeof source!=='string'||!source))throw new Error('生成结果格式错误');
          if(output.type==='text')continue;
          const resources=[source,...['url','image','fullImage','video','audio','poster','sourceUrl'].filter(key=>output[key]!=null).map(key=>output[key])];
          if(output.world?.assets){const assets=output.world.assets;resources.push(...Object.values(assets.splats?.spzUrls||{}),...Object.values(assets.mesh||{}));if(assets.imagery?.panoUrl!=null)resources.push(assets.imagery.panoUrl);}
          if(resources.some(value=>!valid(value)))throw new Error('生成结果地址无效');
        }
    }
    recover(id,{beforeRestore,signal}={}){
      if(this.recoveries.has(id))return this.recoveries.get(id).promise;
      const provider=this.jobs.get(id)?.transport||this.provider,controller=new AbortController();
      const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const check=()=>{if(controller.signal.aborted)throw Object.assign(Error('恢复已取消'),{name:'AbortError'});};
      const promise=Promise.resolve().then(async()=>{
        check();if(typeof provider?.lookup!=='function')throw Error('当前生成适配器不支持任务恢复');
        const existing=this.jobs.get(id);
        if(existing&&['queued','running','succeeded','cancelled'].includes(existing.status)){await beforeRestore?.(existing);check();return existing;}
        const remote=await provider.lookup(id,{signal:controller.signal});check();
        if(!remote?.request?.kind||!remote.id||!['queued','running','unknown','succeeded','failed','cancelled','configuration_required'].includes(remote.status))throw Error('恢复记录缺少有效的原始请求或状态');
        if(remote.status==='succeeded')this.validateResult(remote);
        let job=existing?{...existing}:{id,request:structuredClone(remote.request),createdAt:remote.createdAt,controller:new AbortController(),recovered:true};
        if(job.controller.signal.aborted)throw Object.assign(Error('任务已取消'),{name:'AbortError'});
        // Validate the actual persisted transport request, including for an
        // existing unknown job; retaining its older body would mask corruption.
        Object.assign(job,{request:structuredClone(remote.request),status:remote.status,progress:remote.progress||0,remoteTaskId:remote.id,recovery:remote.recovery,error:remote.error,outputs:remote.outputs,providerDispatched:true},taskMediaState(remote));
        Object.defineProperty(job,'transport',{value:provider,writable:true,configurable:true});
        await beforeRestore?.(job);check();
        if(job.controller.signal.aborted)throw Object.assign(Error('任务已取消'),{name:'AbortError'});
        if(existing){Object.assign(existing,job);Object.defineProperty(existing,'transport',{value:provider,writable:true,configurable:true});job=existing;}
        this.jobs.set(id,job);this.emit(job);
        if(['queued','running'].includes(job.status))queueMicrotask(()=>{if(job.controller.signal.aborted)return;void this.consume(job,()=>provider.resume(remote.id,{signal:job.controller.signal,onProgress:(value,metadata)=>{if(job.status==='cancelled')return;Object.assign(job,taskMediaState(metadata));job.progress=Math.max(job.progress,Math.min(99,Number(value)||0));this.emit(job);}}));});
        return job;
      }).finally(()=>{signal?.removeEventListener('abort',abort);this.recoveries.delete(id);});
      this.recoveries.set(id,{promise,controller});return promise;
    }
    cancel(id){
      const recovering=this.recoveries.get(id);recovering?.controller.abort();
      const job=this.jobs.get(id);
      if(!job&&recovering)return {id,outcome:'cancel_requested',status:'cancelled',localCancellationRequested:true,lateResultBlocked:true,providerCancellation:'not_requested'};
      if(!job)return {id,outcome:'not_found',status:null,localCancellationRequested:false,lateResultBlocked:false,providerCancellation:'not_requested'};
      if(!['queued','running','unknown'].includes(job.status))return {id,outcome:'already_terminal',status:job.status,localCancellationRequested:false,lateResultBlocked:!!job.cancellation?.lateResultBlocked,providerCancellation:job.cancellation?.providerCancellation||'not_requested'};
      // This receipt acknowledges only this task service's cancellation. Aborting
      // transport cannot prove that an upstream provider has stopped computing.
      const receipt={id,outcome:'cancel_requested',status:'cancelled',localCancellationRequested:true,lateResultBlocked:true,providerCancellation:job.providerDispatched?'unconfirmed':'not_requested'};
      job.cancellation={...receipt,requestedAt:Date.now()};job.status='cancelled';job.controller.abort();if(!job.providerActive&&job.remoteTaskId&&job.transport?.cancel)void job.transport.cancel(job.remoteTaskId).catch(()=>{});this.emit(job);return receipt;
    }
    retry(id){const job=this.jobs.get(id);if(job&&['queued','running','unknown','succeeded'].includes(job.status))throw Error('请先查询或应用已有任务，不能重复生成');return job?this.submit(job.request,{beforeDispatch:job.beforeDispatch,beforeDispatchReady:job.beforeDispatchReady,beforeTransportReady:job.beforeTransportReady}):null;}
  }
  function normalizeApiBaseUrl(baseUrl){
    let base;try{base=new URL(baseUrl);}catch{throw new Error('请输入完整的 HTTP API 基础地址');}
    if(!['http:','https:'].includes(base.protocol))throw new Error('请输入 HTTP API 地址');
    if(base.username||base.password||base.search||base.hash)throw new Error('API 地址不能包含凭据、查询参数或片段；请单独填写 Key');
    return base.href.replace(/\/$/,'');
  }
  function httpProvider({baseUrl,apiKey='',pollInterval=1500,timeout=600000,fetchImpl=fetch,cancelRemote=false,recoverable=false}){
    const endpoint=normalizeApiBaseUrl(baseUrl),headers={'Content-Type':'application/json',...(apiKey?{Authorization:'Bearer '+apiKey}:{})};
    const cancel=id=>fetchImpl(endpoint+'/tasks/'+encodeURIComponent(id),{method:'DELETE',headers,signal:AbortSignal.timeout(5000)});
    async function read(url,options={}){const response=await fetchImpl(url,{headers,...options});if(!response.ok){let value;try{value=await response.json();}catch{}throw Object.assign(Error(value?.error||'API 请求失败（'+response.status+'）'),{code:value?.code,status:response.status});}return response.json();}
    async function execute(request,{signal,onProgress=()=>{},onTaskIdentity=()=>{},jobId,resumeId}={}){
      const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const timer=setTimeout(()=>controller.abort(new Error('生成任务超时')),timeout);
      const pause=()=>new Promise((resolve,reject)=>{if(controller.signal.aborted){reject(controller.signal.reason);return;}const end=()=>{clearTimeout(wait);reject(controller.signal.reason);};const wait=setTimeout(()=>{controller.signal.removeEventListener('abort',end);resolve();},pollInterval);controller.signal.addEventListener('abort',end,{once:true});});
      let id=resumeId;
      try{
        let value=resumeId?await read(endpoint+'/tasks/'+encodeURIComponent(resumeId),{signal:controller.signal}):await read(endpoint+'/tasks',{method:'POST',body:JSON.stringify(request),signal:controller.signal,headers:{...headers,...(recoverable&&jobId?{'Idempotency-Key':jobId}:{})}});
        id=value.id||id;if(id)onTaskIdentity(id);
        while(true){
          if(['failed','cancelled','configuration_required','unknown'].includes(value.status))throw Object.assign(new Error(value.error||'任务失败'),{code:value.status,recovery:value.recovery,...taskMediaState(value),terminal:true});
          if(value.outputs)return value;
          if(value.status==='succeeded')throw Object.assign(Error('生成服务声称完成但没有实际输出'),{code:'unknown',terminal:true});
          if(!id)throw Error('API 未返回任务 ID');onProgress(value.progress||0,taskMediaState(value));await pause();value=await read(endpoint+'/tasks/'+encodeURIComponent(id),{signal:controller.signal});
        }
      }catch(error){if(recoverable&&!error.terminal&&!signal?.aborted)throw Object.assign(Error('生成状态未确认，请查询恢复；未重新提交'),{code:'unknown',recovery:{reason:error.code||'transport_interrupted',pollable:!!id}});throw error;}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(cancelRemote&&id&&signal?.aborted){try{await cancel(id);}catch{/* A transport abort is not proof of remote cancellation. */}}}
    }
    return {generate:(request,options)=>execute(request,options),...(recoverable?{lookup:(key,{signal}={})=>read(endpoint+'/tasks/by-key/'+encodeURIComponent(key),{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)}),resume:(id,options)=>execute(null,{...options,resumeId:id}),cancel}:{} )};
  }
  root.GenerationCore={TaskService,httpProvider,normalizeApiBaseUrl,isGenerationMediaRef,isLocalMediaSource};
  if(typeof module!=='undefined')module.exports=root.GenerationCore;
})(typeof window!=='undefined'?window:globalThis);
