(() => {
  'use strict';
  const app=window.CanvasApp;
  let generationRequests,generationMedia,recognitionMedia,videoAnalysisMedia,draftWorkflow,resultModules,resultWorkflow,failureBridge;
  const failureSources=new Map();
  const resultSubmissions=new Map();
  const draftGuards=new Map();
  const applicationListeners=new Set();
  const historyReadinessOriginals=new WeakMap();
  const applicationReady=import('./src/features/generation-results/application.mjs').then(module=>module.createApplicationRunner({getJob:id=>service.jobs.get(id),apply:applyResults,changed:applicationChanged}));
  const service=new GenerationCore.TaskService({prepareRequest:async(request,{jobId,signal})=>{
    if(!['image.generate','video.generate','text.generate'].includes(request.kind))return request;
    failureBridge||=await import('./src/features/generation-results/failure-bridge.mjs');
    generationRequests||=import('./src/features/node-composer/generation-request.mjs');
    if(request.kind==='video.generate'){
      draftWorkflow||=import('./src/features/video-generation/draft-final-workflow.mjs');
      const prepared=(await draftWorkflow).prepareDraftFinalRequest(request,app);request=prepared.request;
      if(prepared.guard)draftGuards.set(jobId,prepared.guard);
    }
    return (await generationRequests).prepareGenerationRequest(request);
  },prepareInputs:async(request,{jobId,signal,validateSources,acceptSourceReplacements})=>{
    if(request.kind==='video.analyze'){
      videoAnalysisMedia||=import('./src/features/node-composer/video-analysis-media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?serverMetadata:null;
      return (await videoAnalysisMedia).prepareVideoAnalysisMedia(request,{signal,baseUrl:document.baseURI,nativeConfiguration,validateSources});
    }
    if(request.kind==='image.recognize'){
      recognitionMedia||=import('./src/features/node-composer/recognition-media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?serverMetadata:null;
      return (await recognitionMedia).prepareRecognitionMedia(request,{signal,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration,validateSources});
    }
    if(!['image.generate','video.generate','text.generate'].includes(request.kind))return request;
    validateSources();
    generationMedia||=import('./src/features/node-composer/generation-media.mjs');
    const media=await generationMedia;
    // The task captures its transport before async work; a later provider switch
    // must not apply native upload rules to a direct tasks-v1 submission.
    const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?serverMetadata:null;
    request=await media.prepareGenerationMediaRequest(request,{signal,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration,validateSources});
    validateSources();
    const submission=resultSubmissions.get(jobId);
    if(submission&&!draftGuards.has(jobId)){
      resultModules||=import('./src/features/generation-results/workflow.mjs');
      const module=await resultModules;
      resultWorkflow||=module.createResultWorkflow(app);
      const snapshot=module.captureSubmission(submission.request,submission.state,submission.mode);
      request=await resultWorkflow.prepare(request,{jobId,signal,validateSources,acceptSourceReplacements},snapshot);
    }
    media.assertWorkflowRequestBudget(request);validateSources();return request;
  }});
  const localProvider=GenerationCore.httpProvider({baseUrl:new URL('/api/generation',location.href).href,cancelRemote:true,recoverable:true});
  let serverConfigured=false;
  service.setProvider(localProvider);
  let serverMetadata=null;
  function refreshServerConfiguration(){return fetch('/api/generation/config',{signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():null).then(value=>{if(typeof value?.configured!=='boolean')return null;serverMetadata=value;serverConfigured=value.configured;return value.configured;}).catch(()=>null);}
  let serverConfiguration=refreshServerConfiguration();
  localProvider.isConfigured=()=>serverConfiguration;
  async function availability({signal}={}){
    for(;;){
      if(signal?.aborted)throw signal.reason;
      const provider=service.provider;
      const configured=provider?(typeof provider.isConfigured==='function'?await provider.isConfigured({signal}):true):false;
      if(signal?.aborted)throw signal.reason;
      // Configuration belongs to a provider, so a switch during its asynchronous
      // lookup must be re-evaluated before reporting availability to an Agent.
      if(provider===service.provider)return {configured:typeof configured==='boolean'?configured:null};
    }
  }
  function submitJob(request,options){
    if(request.kind==='image.generate'){
      const node=app.getState().nodes.find(node=>node.id===request.nodeId);
      const defaults=node&&window.NodeEditor?window.NodeEditor.getConfig(node):{};
      const overrides=Object.fromEntries(Object.entries(request.parameters||{}).filter(([,value])=>value!==undefined));
      const parameters={...defaults,...overrides};
      parameters.ratio=overrides.ratio??overrides.aspectRatio??overrides.aspect??parameters.ratio;
      if(overrides.modelId&&!overrides.model)parameters.model=overrides.modelId;
      if(overrides.cameraControl){
        if(overrides.cameraControl.enabled!==undefined)parameters.cameraEnabled=overrides.cameraControl.enabled;
        for(const field of ['camera','lens','focal','aperture'])if(overrides.cameraControl[field+'Key']&&!Object.hasOwn(overrides,field))delete parameters[field];
      }
      request={...request,prompt:request.prompt??defaults.prompt??'',inputs:request.inputs??(defaults.refs||[]).map(url=>({type:'image',url})),parameters};
    }
    const previous=historyReadinessOriginals.has(options?.beforeDispatchReady)?historyReadinessOriginals.get(options.beforeDispatchReady):options?.beforeDispatchReady;
    const beforeDispatchReady=async context=>{
      const gate=await historyDispatchReady;
      return gate({beforeDispatchReady:previous}).beforeDispatchReady(context);
    };
    historyReadinessOriginals.set(beforeDispatchReady,previous);
    return service.submit(request,{...options,beforeDispatchReady});
  }
  const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
  const button=(text,fn)=>{const b=el('button','',text);b.onclick=fn;return b;};
  const tray=el('section','task-tray');tray.setAttribute('aria-label','生成任务');tray.hidden=true;document.body.append(tray);
  const labels={unknown:'状态待确认',queued:'排队中',running:'生成中',configuration_required:'待连接 API',failed:'生成失败',cancelled:'已取消',succeeded:'生成完成'};
  const recognitionLabels={...labels,running:'识别中',succeeded:'识别完成',failed:'识别失败'};
  const analysisLabels={...labels,running:'解析中',failed:'解析失败',cancelled:'已取消解析',succeeded:'解析完成'};
  const inPlace=new Map(),videoTargets=new Map(),imageTargets=new Map(),derivedTargets=new Map();
  let collapsed=false;
  function render(){tray.classList.toggle('is-collapsed',collapsed);tray.replaceChildren();if(!service.jobs.size)return;tray.hidden=false;const header=el('header');header.append(el('span','','生成任务'),button(collapsed?'展开':'收起',()=>{collapsed=!collapsed;render();}));tray.append(header);if(collapsed)return;for(const job of [...service.jobs.values()].reverse().slice(0,8)){const row=el('div','task-item');row.dataset.status=job.status;row.append(el('strong','',job.request.label||job.request.kind),el('span','task-status',(job.applicationError?'结果应用失败':job.applying?'正在应用结果…':(job.request.kind==='image.recognize'?recognitionLabels:job.request.kind==='video.analyze'?analysisLabels:labels)[job.status])+(job.status==='running'?' '+Math.round(job.progress)+'%':'')));if(job.error)row.append(el('p','',job.error));if(job.recovered&&job.status==='succeeded'&&!job.applied&&job.request.kind==='image.recognize')row.append(el('p','','识别记录已取回；原焦点会话已结束，请重新进入焦点编辑选择目标。'));if(job.recovered&&job.status==='succeeded'&&!job.applied&&job.request.kind!=='image.recognize'){if(job.request.parameters?.canvasResults)row.append(button('恢复到原占位',()=>applyRecovered(job.id,'existing').catch(error=>app.notify(error.message))));row.append(button('作为新节点取回',()=>applyRecovered(job.id,'new_nodes').catch(error=>app.notify(error.message))));}if(job.recovered&&['failed','cancelled','configuration_required'].includes(job.status)&&job.request.parameters?.canvasResults)row.append(button('清理原占位',()=>cancel(job.id)));if(job.status==='unknown'){row.append(button('查询恢复',()=>recover(job.id).catch(error=>app.notify(error.message))));if(job.recovery?.pollable===false)row.append(el('p','','暂无可查询的供应商任务标识；查询仅核对本机记录，不会重新发起任务。'));}if(job.applicationError){row.append(el('p','',job.applicationError));if(!job.recovered)row.append(button('重试应用结果',()=>retryApplication(job.id).catch(error=>app.notify(error.message))));}if(job.applying)row.append(el('p','','正在应用结果…'));const progress=el('progress');progress.max=100;progress.value=job.progress;row.append(progress);if(['running','queued','unknown'].includes(job.status))row.append(button('取消',()=>cancel(job.id)));if(!inPlace.has(job.id)&&['failed','cancelled','configuration_required'].includes(job.status))row.append(button('重试',()=>retry(job.id)));if(job.status==='configuration_required')row.append(button('连接 API',configure));tray.append(row);}}
  async function validateOutputMedia(output){
    if(!['image','video'].includes(output.type))return;
    const source=output.url||output[output.type],media=output.type==='image'?new Image():document.createElement('video');
    try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('生成媒体读取超时')),20000),finish=fn=>()=>{clearTimeout(timer);fn();};media.onerror=finish(()=>reject(Error('生成媒体无法读取')));if(output.type==='image')media.onload=finish(()=>media.naturalWidth>0?resolve():reject(Error('图片内容为空')));else{media.preload='metadata';media.onloadedmetadata=finish(()=>media.videoWidth>0&&Number.isFinite(media.duration)?resolve():reject(Error('视频内容无效')));}Promise.resolve(window.LocalAssets?.url(source)||source).then(url=>{media.src=url;},reject);});if(output.type==='video')Object.assign(output,{width:media.videoWidth,height:media.videoHeight,duration:media.duration});else Object.assign(output,{width:media.naturalWidth,height:media.naturalHeight});}
    finally{media.onload=null;media.onerror=null;media.onloadedmetadata=null;if(output.type==='video'){media.removeAttribute('src');media.load();}}
  }
  async function applyResults(job){
    const stored=service.jobs.get(job.id);
    if(stored.recovered){
      if(stored.recoveryMode==='existing'){const {applyRecoveredPlan}=await import('./src/features/generation-results/recovery.mjs');await applyRecoveredPlan(stored,{app,workflow:resultWorkflow,validateMedia:validateOutputMedia,persist:()=>{const state=app.getState();return window.CanvasStore.save({version:1,nodes:state.nodes,edges:state.edges});}});}
      else if(stored.recoveryMode==='new_nodes'){const {importRecoveredOutputs}=await import('./src/features/generation-results/recovery.mjs');await importRecoveredOutputs(stored,{app,sourceId:stored.recoverySourceId,validateMedia:validateOutputMedia,localizeAudio:url=>window.AudioAPI.localize(url),persist:()=>{const state=app.getState();return window.CanvasStore.save({version:1,nodes:state.nodes,edges:state.edges});}});}
      else throw Error('任务已取回，请明确选择原占位或新节点应用方式');
      return;
    }
    {
      draftGuards.get(job.id)?.();
      const originalTarget=inPlace.get(job.id),target=originalTarget&&{...originalTarget,guard(){originalTarget.guard();draftGuards.get(job.id)?.();}};
      if(target&&!stored.resultIds){
        target.guard();
        if(target.applyBatch){if(job.outputs.some(o=>o.type!==target.type))throw Error('批次结果类型与节点类型不一致');await Promise.all(job.outputs.map(validateOutputMedia));target.guard();const applied=await target.applyBatch(job.outputs);stored.resultIds=Array.isArray(applied)?applied.map(n=>n.id):[job.request.nodeId];target.didApply?.();}
        else{if(job.outputs.length!==1||job.outputs[0].type!==target.type)throw Error('工作流需要一个与节点类型一致的结果');
        const o=job.outputs[0];await validateOutputMedia(o);let patch;
        if(o.type==='audio')patch={audio:await window.AudioAPI.localize(o.audio||o.url)};
        else if(o.type==='text')patch={content:o.text};
        else if(o.type==='video')patch={video:o.video||o.url,...(o.poster?{image:o.poster}:{} )};
        else patch={image:o.image||o.url,fullImage:o.image||o.url};
        target.guard();
        if(o.type==='video'&&!target.apply){const history=await import('./video-history-core.mjs'),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);target.guard();patch=history.record({...n,video:n.video||window.EDITOR_DATA?.nodes[n.id]?.video},job,window.NodeEditor.getConfig(n));window.NodeEditor.invalidate();}
        if(o.type==='image'&&!target.apply){const history=await import('./image-history-core.mjs'),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);target.guard();patch=history.record(n,job,window.NodeEditor.getConfig(n),window.VERSION_DATA?.[n.id]);window.NodeEditor.invalidate();}
        if(!target.apply&&patch.generation&&target.patch?.generation)patch.generation={...patch.generation,...target.patch.generation};
        const applied=target.apply?await target.apply(o):app.updateNode(job.request.nodeId,{...target.patch,...patch});
        stored.resultIds=Array.isArray(applied)?applied.map(n=>n.id):[job.request.nodeId];target.didApply?.();}
      }
      if(!stored.resultIds&&resultWorkflow?.has(job.id))stored.resultIds=await resultWorkflow.apply(job,validateOutputMedia);
      if(!stored.resultIds&&videoTargets.has(job.id)){
        const expected=videoTargets.get(job.id),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);
        const guard=()=>{if(!n||!app.getState().nodes.includes(n)||videoSignature(n)!==expected)throw Error('视频或生成参数已变化，请重新生成');draftGuards.get(job.id)?.();};guard();
        if(job.outputs.some(o=>o.type!=='video'))throw Error('视频节点需要视频生成结果');
        await Promise.all(job.outputs.map(validateOutputMedia));const history=await import('./video-history-core.mjs');guard();
        window.NodeEditor.invalidate();app.updateNode(n.id,history.record({...n,video:n.video||window.EDITOR_DATA?.nodes[n.id]?.video},job,window.NodeEditor.getConfig(n)));stored.resultIds=[n.id];
      }
      if(!stored.resultIds&&imageTargets.has(job.id)){
        const expected=imageTargets.get(job.id),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);
        const guard=()=>{if(!n||!app.getState().nodes.includes(n)||imageSignature(n)!==expected)throw Error('图片或生成参数已变化，请重新生成');};guard();
        if(job.outputs.some(o=>o.type!=='image'))throw Error('图片节点需要图片生成结果');
        await Promise.all(job.outputs.map(validateOutputMedia));const history=await import('./image-history-core.mjs');guard();
        window.NodeEditor.invalidate();app.updateNode(n.id,history.record(n,job,window.NodeEditor.getConfig(n),window.VERSION_DATA?.[n.id]));stored.resultIds=[n.id];
      }
      if(!stored.resultIds&&derivedTargets.has(job.id)){
        const target=derivedTargets.get(job.id);target.guard();
        await Promise.all(job.outputs.map(validateOutputMedia));target.guard();
        const outputs=job.outputs.map(o=>({...o,image:o.image||(o.type==='image'?o.url:o.poster),video:o.video||(o.type==='video'?o.url:null),content:o.text,...(o.type==='text'?{textMode:'pure'}:{}),title:o.title||job.request.label}));
        stored.resultIds=app.createConnected(job.request.nodeId,outputs,target.options).map(n=>n.id);target.didApply?.();
      }
      if(!stored.resultIds){
        if(!stored.materializedOutputs)stored.materializedOutputs=await Promise.all(job.outputs.map(async o=>o.type==='audio'?{...o,audio:await window.AudioAPI.localize(o.audio||o.url),audioMode:'upload'}:o));
        const results=app.createConnected(job.request.nodeId,stored.materializedOutputs.map(o=>({...o,image:o.image||(o.type==='image'?o.url:o.poster),video:o.video||(o.type==='video'?o.url:null),audio:o.audio||(o.type==='audio'?o.url:null),content:o.text,...(o.type==='text'?{textMode:'pure'}:{}),title:o.title||job.request.label||'生成结果'})));
        stored.resultIds=results.map(n=>n.id);
      }
      if(job.request.kind==='model.generate'&&app.getState().nodes.some(n=>n.id===job.request.nodeId&&n.type==='studio')){
        if(!window.StudioAPI)throw Error('片场仍在加载，请稍后重试放置');
        stored.sceneResult=await window.StudioAPI.acceptGeneration(job);
      }
      if(job.request.kind==='panorama.edit'){
        if(!window.StudioAPI)throw Error('片场仍在加载，请稍后重试应用全景');
        stored.sceneResult=await window.StudioAPI.acceptPanoramaGeneration(job);
        if(!stored.sceneResult.applied)throw Error(stored.sceneResult.reason||'全景结果尚未应用');
      }
    }
  }
  function applicationChanged(stored){
    if(!stored.applying){const target=inPlace.get(stored.id);if(target){if(stored.applicationError)target.reject(Error(stored.applicationError));else target.resolve(stored);}if(stored.applicationError&&stored.request.kind==='panorama.edit')window.StudioAPI?.reportPanoramaIssue?.(stored,stored.applicationError);}
    render();for(const listener of applicationListeners)listener({...stored,controller:undefined});if(stored.request.kind==='image.generate')app.render();
  }
  function cancel(id){
    const job=service.jobs.get(id),receipt=service.cancel(id);
    if(job?.recovered&&(receipt.outcome==='cancel_requested'||receipt.outcome==='already_terminal'&&['failed','cancelled','configuration_required'].includes(job.status))&&job.request.parameters?.canvasResults){
      void (async()=>{resultModules||=import('./src/features/generation-results/workflow.mjs');resultWorkflow||=(await resultModules).createResultWorkflow(app);if(!['failed','cancelled','configuration_required'].includes(job.status))return;resultWorkflow.restore(job);resultWorkflow.clear(id);})().catch(error=>app.notify('任务已取消，原占位未自动清理：'+error.message));
    }
    return receipt;
  }
  async function recover(id,{signal}={}){return service.recover(id,{signal,beforeRestore:async job=>{if(job.recovered){job.applicationStatus='awaiting_recovery_application';job.applied=false;}}});}
  async function applyRecovered(id,mode,sourceId){
    const job=service.jobs.get(id);if(!job?.recovered)throw Error('请先恢复页面刷新前的任务');
    if(job.request.kind==='image.recognize')throw Error('原焦点识别会话已结束，不能恢复标签或创建普通节点，请重新选择目标');
    if(job.applying)throw Error('结果正在应用，请等待完成');
    if(job.applied)return retryApplication(id);
    if(!['existing','new_nodes'].includes(mode))throw Error('未知的恢复应用方式');
    if(job.recoveryMode&&job.recoveryMode!==mode&&job.resultIds?.length)throw Error('结果已部分应用，请继续原方式，避免重复节点');
    if(mode==='existing'&&!job.resultIds?.length){resultModules||=import('./src/features/generation-results/workflow.mjs');resultWorkflow||=(await resultModules).createResultWorkflow(app);await resultWorkflow.restore(job);}
    job.recoveryMode=mode;job.recoverySourceId=sourceId;return retryApplication(id);
  }
  async function retryApplication(id){return (await applicationReady).run(id);}
  service.subscribe(job=>{if(job.status==='succeeded'){failureSources.delete(job.id);if(!job.recovered)void retryApplication(job.id).catch(error=>app.notify(error.message));}else if(['failed','cancelled','configuration_required'].includes(job.status)){
    const stored=service.jobs.get(job.id);
    stored.nodeFailures=failureBridge?.captureFailureReceipts({job,app,original:failureSources.get(job.id),planned:!!resultWorkflow?.has(job.id)})||[];
    failureSources.delete(job.id);
    resultWorkflow?.clear(job.id);inPlace.get(job.id)?.reject(Error(job.error||'生成任务已取消'));}else if(job.status==='unknown'){inPlace.get(job.id)?.reject(Error(job.error||'生成状态待确认，请查询恢复'));}render();if(job.request.kind==='image.generate')app.render();});
  function configure(){
    const existing=document.querySelector('dialog.api-dialog');if(existing){existing.focus();return;}
    const d=el('dialog','api-dialog'),header=el('div','dialog-heading');header.append(el('h2','','连接生成 API'),button('×',()=>d.close()));
    const status=el('p','','正在读取本机配置…'),error=el('p','api-error');error.setAttribute('role','alert');
    d.append(header,status,button('使用本机服务',async()=>{serverConfiguration=refreshServerConfiguration();const configured=await serverConfiguration;if(configured===null){error.textContent='无法读取本机配置，请检查本地服务是否正在运行';return;}service.setProvider(localProvider);if(!configured){error.textContent=serverMetadata?.configurationError?'本机生成配置无效，请检查协议、地址与模型映射后重启服务':'本机尚未配置生成服务：'+(serverMetadata?.missing||[]).join('、');return;}d.close();}));
    d.append(el('p','','直接连接仅支持 tasks-v1 网关（POST /tasks、GET /tasks/:id）。官方厂商 Key 需要对应适配器。服务端支持的原生协议请在本机配置；直接连接要求服务允许浏览器 CORS，Key 仅保留在当前页面内存。'));
    const url=el('input');url.type='url';url.placeholder='https://your-task-gateway.example/api';url.setAttribute('aria-label','API 基础地址');
    const key=el('input');key.type='password';key.autocomplete='off';key.placeholder='任务网关 API Key（可选）';key.setAttribute('aria-label','API Key');
    d.append(url,key,error,button('保存配置',()=>{try{service.setProvider(GenerationCore.httpProvider({baseUrl:url.value.trim(),apiKey:key.value,cancelRemote:true}));key.value='';d.close();}catch(e){error.textContent=e.message;}}));
    document.body.append(d);d.onclose=()=>{key.value='';d.remove();};d.showModal();
    serverConfiguration=refreshServerConfiguration();serverConfiguration.then(configured=>{if(!d.isConnected)return;status.textContent=configured===null?'本机服务不可访问':serverMetadata?.configurationError?'本机生成配置无效':configured?'本机生成服务已配置 · '+serverMetadata.protocol:'本机生成服务待配置 · '+(serverMetadata?.missing||[]).join('、');});
  }
  function runInPlace(request,{guard,type,didApply,patch,apply,applyBatch},{signal,onSubmitted}={}){
    let abort;const checkedGuard=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');guard();};
    return new Promise((resolve,reject)=>{
      checkedGuard();
      let acknowledge,failAcknowledgement;
      const receipt=new Promise((ready,failed)=>{acknowledge=ready;failAcknowledgement=failed;});receipt.catch(()=>{});
      const job=submitJob(request,{beforeDispatch:checkedGuard,beforeDispatchReady:()=>receipt});inPlace.set(job.id,{guard:checkedGuard,type,didApply,patch,apply,applyBatch,resolve,reject});
      const failed=error=>{failAcknowledgement(error);reject(error);service.cancel(job.id);};
      try{Promise.resolve(onSubmitted?.(job)).then(acknowledge,failed);}catch(error){failed(error);return;}
      abort=()=>service.cancel(job.id);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    }).finally(()=>{if(abort)signal?.removeEventListener('abort',abort);});
  }
  function videoSignature(n){return JSON.stringify([n.video||window.EDITOR_DATA?.nodes[n.id]?.video,n.clip,window.NodeEditor.getConfig(n),n.videoHistory]);}
  function imageSignature(n){return JSON.stringify([n.fullImage||n.image,n.imageHistory,n.versions,window.NodeEditor.getConfig(n),n.params]);}
  function submit(request,options){
    const state=app.getState(),n=state.nodes.find(n=>n.id===request.nodeId);
    let submission;
    if(['image.generate','video.generate','text.generate'].includes(request.kind)){
      let mode='variants';try{const saved=localStorage.getItem('tapnow.canvas.generation-result-mode');if(['pile','variants','spread'].includes(saved))mode=saved;}catch{}
      request={...request,parameters:{...request.parameters,resultMode:mode}};
      const incoming=state.edges.filter(edge=>edge.target===request.nodeId),ids=new Set([request.nodeId,...incoming.map(edge=>edge.source)]);
      submission={mode,request:structuredClone(request),state:structuredClone({nodes:state.nodes.filter(node=>ids.has(node.id)||node.type==='pile'&&node.memberIds?.includes(request.nodeId)),edges:incoming})};
    }
    const expected=request.kind==='video.generate'&&n?.type==='video'?videoSignature(n):null;
    const job=submitJob(request,options);
    if(submission)resultSubmissions.set(job.id,submission);
    if(submission&&n)failureSources.set(job.id,{node:n,snapshot:structuredClone(n)});
    if(expected!==null)videoTargets.set(job.id,expected);
    if(request.kind==='image.generate'&&n?.type==='image')imageTargets.set(job.id,imageSignature(n));
    return job;
  }
  function retry(id){if(inPlace.has(id))throw Error('请通过整组执行重新启动工作流');const old=service.jobs.get(id);if(!old)return null;if(['unknown','queued','running'].includes(old.status))throw Error('请查询已有任务，不能重复生成');if(old.status==='succeeded'&&!old.applied)throw Error('生成已完成，请使用重试应用结果，避免重复调用生成服务');const target=derivedTargets.get(id);if(target){try{return submitDerived(old.request,target);}catch(error){app.notify(error.message);return null;}}return submit(old.request,{beforeDispatch:old.beforeDispatch,beforeDispatchReady:old.beforeDispatchReady});}
  function submitDerived(request,target){target.guard();const job=submitJob(request,{beforeDispatch:target.guard,beforeDispatchReady:target.beforeDispatchReady});derivedTargets.set(job.id,target);return job;}
  window.GenerationAPI={submitDerived,runInPlace,availability,isConfigured:()=>service.provider===localProvider?serverConfigured:!!service.provider,submit,setProvider:p=>service.setProvider(p),configure,cancel,retry,retryApplication,recover,applyRecovered,subscribe:fn=>{const unsubscribe=service.subscribe(fn);applicationListeners.add(fn);return()=>{unsubscribe();applicationListeners.delete(fn);};},getJobs:()=>[...service.jobs.values()].map(({controller,...job})=>job)};
  const generationHistoryReady=import('./src/features/generation-history/entry.mjs').then(module=>module.install());
  const historyDispatchReady=import('./src/features/generation-history/dispatch.mjs').then(({createHistoryDispatchGate})=>createHistoryDispatchGate({
    ready:()=>generationHistoryReady,getJob:id=>service.jobs.get(id),captureOptions:job=>({recoverable:job.transport===localProvider})
  }));
  generationHistoryReady.catch(error=>app.notify('生成历史读取失败：'+error.message));
  historyDispatchReady.catch(error=>app.notify('生成历史保存入口加载失败：'+error.message));
  import('./src/features/generation-results/pending-ui.mjs').then(module=>module.install()).catch(error=>app.notify('生成状态加载失败：'+error.message));
  import('./src/features/generation-results/error-ui.mjs').then(module=>module.install()).catch(error=>app.notify('生成错误提示加载失败：'+error.message));
})();
