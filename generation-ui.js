(() => {
  'use strict';
  const app=window.CanvasApp;
  let generationRequests,generationMedia,recognitionMedia,videoAnalysisMedia,extensionMedia,reshootMedia,videoMaskMedia,panoramaMedia,panoramaValidation,imageToolMedia,maskedEditMedia,relightMedia,worldMedia,draftWorkflow,resultModules,resultWorkflow,failureBridge;
  const failureSources=new Map();
  const resultSubmissions=new Map();
  const draftGuards=new Map();
  const applicationListeners=new Set();
  const historyReadinessOriginals=new WeakMap();
  const providerConfigurationReady=import('./src/features/node-composer/provider-configuration.mjs');
  const taskNativeConfigurations=new WeakMap();
  const taskConfigurationIds=new WeakMap();
  const configurationClientReady=import('./src/features/generation-config/client.mjs');
  const provenanceReady=import('./src/features/media-preview/provenance.mjs');
  const audioSubtitleReady=import('./src/features/audio-subtitles/core.mjs');
  const ordinaryAudioReady=import('./src/features/audio-generation/application.mjs');
  const audioSubtitleReceipts=new Map(),audioSubtitleBindings=new Map(),audioSubtitleMedia=new Map(),latestAudioSubmissions=new WeakMap();let audioSubtitlePageEpoch=0;
  window.addEventListener('pagehide',()=>{audioSubtitlePageEpoch++;});
  const audioSourceSignature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));
  function audioReceipt(request,source){const candidates=app.getState().nodes.filter(node=>node.type==='text'&&node.sourceAudioNodeId===source?.id);return {request:structuredClone(request),source,signature:source&&audioSourceSignature(source),projectId:app.projectIdentity().id,pageEpoch:audioSubtitlePageEpoch,subtitleSnapshot:{count:candidates.length,node:candidates[0]||null,content:candidates[0]?.content??null},audioApplied:null};}
  function audioReceiptCurrent(receipt,id,content=false){return !!receipt?.source&&receipt.projectId===app.projectIdentity().id&&receipt.pageEpoch===audioSubtitlePageEpoch&&app.getState().nodes.includes(receipt.source)&&latestAudioSubmissions.get(receipt.source)===id&&(!content||audioSourceSignature(receipt.source)===receipt.signature);}
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
    return (await generationRequests).prepareGenerationRequestReady(request);
  },prepareInputs:async(request,{jobId,signal,validateSources,acceptSourceReplacements})=>{
    if(request.kind==='world.generate'){
      worldMedia||=import('./src/features/world-node/media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await worldMedia).prepareWorldMediaRequest(request,{signal,validateSources,localAssets:window.LocalAssets,localMedia:window.LocalMedia,baseUrl:document.baseURI,nativeConfiguration});
    }
    if(['image.upscale','image.skin','image.remove-background','image.multiAngle'].includes(request.kind)){
      imageToolMedia||=import('./src/features/image-editor/task-media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await imageToolMedia).prepareImageToolMedia(request,{signal,validateSources,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration});
    }
    if(['image.erase','image.redraw','image.outpaint'].includes(request.kind)){
      maskedEditMedia||=import('./src/features/image-editor/masked-edit-media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await maskedEditMedia).prepareMaskedEditMedia(request,{signal,validateSources,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration});
    }
    if(request.kind==='image.relight'){
      relightMedia||=import('./src/features/image-relight/media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await relightMedia).prepareRelightMedia(request,{signal,validateSources,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration});
    }
    if(request.kind==='video.extend'){
      extensionMedia||=import('./src/features/video-creation/media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await extensionMedia).prepareExtensionMedia(request,{signal,validateSources,localAssets:window.LocalAssets,localMedia:window.LocalMedia,baseUrl:document.baseURI,nativeConfiguration});
    }
    if(request.kind==='video.reshoot'){
      reshootMedia||=import('./src/features/video-reshoot/media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await reshootMedia).prepareReshootMedia(request,{signal,validateSources,localAssets:window.LocalAssets,localMedia:window.LocalMedia,baseUrl:document.baseURI,nativeConfiguration});
    }
    if(['video.erase','video.replace'].includes(request.kind)){
      videoMaskMedia||=import('./src/features/video-mask/media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await videoMaskMedia).prepareMaskedVideoMedia(request,{signal,validateSources,localAssets:window.LocalAssets,localMedia:window.LocalMedia,baseUrl:document.baseURI,nativeConfiguration});
    }
    if(request.kind==='video.analyze'){
      videoAnalysisMedia||=import('./src/features/node-composer/video-analysis-media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await videoAnalysisMedia).prepareVideoAnalysisMedia(request,{signal,baseUrl:document.baseURI,nativeConfiguration,validateSources});
    }
    if(request.kind==='image.recognize'){
      recognitionMedia||=import('./src/features/node-composer/recognition-media.mjs');
      const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
      return (await recognitionMedia).prepareRecognitionMedia(request,{signal,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration,validateSources});
    }
    if(!['image.generate','video.generate','text.generate'].includes(request.kind))return request;
    validateSources();
    generationMedia||=import('./src/features/node-composer/generation-media.mjs');
    const media=await generationMedia;
    // The task captures its transport before async work; a later provider switch
    // must not apply native upload rules to a direct tasks-v1 submission.
    const nativeConfiguration=service.jobs.get(jobId)?.transport===localProvider?taskNativeConfigurations.get(signal):null;
    const panorama=request.kind==='image.generate'?await (panoramaValidation||=import('./src/features/image-generation/panorama-native.mjs')):null;
    if(panorama?.isNativePanoramaRequest(request)){
      panoramaMedia||=import('./src/features/image-generation/panorama-media.mjs');
      request=await (await panoramaMedia).preparePanoramaMedia(request,{signal,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration,validateSources});
    }else request=await media.prepareGenerationMediaRequest(request,{signal,localAssets:window.LocalAssets,baseUrl:document.baseURI,nativeConfiguration,validateSources});
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
  localProvider.generate=async(request,options)=>{
    const {configurationBoundProvider}=await configurationClientReady;
    const transport=configurationBoundProvider(GenerationCore.httpProvider,{baseUrl:new URL('/api/generation',location.href).href,getConfigurationId:signal=>taskConfigurationIds.get(signal)});
    return transport.generate(request,options);
  };
  let serverConfigured=false,serverConfigurationRevision=0,serverConfigurationSnapshot=null;
  service.setProvider(localProvider);
  function refreshServerConfiguration(){const revision=++serverConfigurationRevision;return fetch('/api/generation/config',{signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():null).then(value=>{const valid=typeof value?.configured==='boolean';if(revision===serverConfigurationRevision){serverConfigured=valid&&value.configured;serverConfigurationSnapshot=valid?structuredClone(value):null;}return valid?value:null;}).catch(()=>{if(revision===serverConfigurationRevision){serverConfigured=false;serverConfigurationSnapshot=null;}return null;});}
  let serverConfiguration=refreshServerConfiguration();
  localProvider.isConfigured=async({request,signal,operationOnly=false}={})=>{
    const configuration=serverConfiguration=refreshServerConfiguration(),revision=serverConfigurationRevision;
    const [metadata,routing]=await Promise.all([configuration,providerConfigurationReady]);
    if(signal?.aborted)throw signal.reason;
    // Parallel tasks can resolve the same public configuration out of order.
    // Only a stale value that differs from the current snapshot loses authority.
    if(revision!==serverConfigurationRevision&&(!serverConfigurationSnapshot||JSON.stringify(metadata)!==JSON.stringify(serverConfigurationSnapshot)))throw Object.assign(new Error('生成配置查询期间已变化，请重新确认提交'),{code:'configuration_required',providerDispatched:false});
    const selected=routing.resolveProviderConfiguration(metadata,request);
    if(signal&&request?.kind){taskNativeConfigurations.set(signal,selected);if(typeof metadata?.configurationId==='string')taskConfigurationIds.set(signal,metadata.configurationId);}
    const status=routing.providerConfigurationStatus(metadata,request,{operationOnly});
    if(status.configured===false)throw Object.assign(new Error(status.message),{code:'configuration_required',providerDispatched:false});
    return status.configured;
  };
  async function availability({signal,kind,request}={}){
    const scopedRequest=request?structuredClone(request):kind?{kind}:undefined;
    for(;;){
      if(signal?.aborted)throw signal.reason;
      const provider=service.provider;
      let configured,reason;
      try{configured=provider?(typeof provider.isConfigured==='function'?await provider.isConfigured({request:scopedRequest,signal,...(provider===localProvider?{operationOnly:!request&&!!kind}:{})}):true):false;}
      catch(error){if(error?.code!=='configuration_required')throw error;configured=false;reason=error.message;}
      if(signal?.aborted)throw signal.reason;
      // Configuration belongs to a provider, so a switch during its asynchronous
      // lookup must be re-evaluated before reporting availability to an Agent.
      if(provider===service.provider)return {configured:typeof configured==='boolean'?configured:null,...(reason?{reason}:{})};
    }
  }
  async function configuration(){
    for(;;){
      const provider=service.provider;
      if(provider!==localProvider)return null;
      const configuration=serverConfiguration,value=await configuration;
      if(provider===service.provider&&configuration===serverConfiguration)return value?structuredClone(value):null;
    }
  }
  // Synchronous dispatch guards must retain the configuration actually approved
  // before any asynchronous readiness refresh or media preparation.
  function configurationSnapshot(){return service.provider===localProvider&&serverConfigurationSnapshot?structuredClone(serverConfigurationSnapshot):null;}
  function submitJob(request,options){
    if(request.kind==='image.generate'){
      const node=app.getState().nodes.find(node=>node.id===request.nodeId);
      const defaults=node&&window.NodeEditor?window.NodeEditor.getConfig(node):{};
      const overrides=Object.fromEntries(Object.entries(request.parameters||{}).filter(([,value])=>value!==undefined));
      const panoramaAliases=['hunyuan-world-panorama','Hunyuan World Panorama'];
      const explicitModel=overrides.providerParameters?.model??overrides.modelId??overrides.model;
      // An explicitly selected native panorama has no generic quality/video
      // defaults. Keep active source intent so the strict contract can reject it.
      const nativePanorama=panoramaAliases.includes(explicitModel);
      const sourceIntent=Object.fromEntries(['cameraEnabled','cameraControl','camera','lens','focal','aperture','style','omni','mask','region','crop','sourceClip','editing','cameraPath'].filter(key=>defaults[key]!==undefined).map(key=>[key,defaults[key]]));
      const parameters={...(nativePanorama?sourceIntent:defaults),...overrides};
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
    const receipt=request.kind==='audio.generate'?audioReceipt(request,app.getState().nodes.find(node=>node.id===request.nodeId)):null;
    const job=service.submit(request,{...options,beforeDispatchReady});
    if(receipt){audioSubtitleReceipts.set(job.id,receipt);if(receipt.source)latestAudioSubmissions.set(receipt.source,job.id);}
    return job;
  }
  const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
  const button=(text,fn)=>{const b=el('button','',text);b.onclick=fn;return b;};
  const tray=el('section','task-tray');tray.setAttribute('aria-label','生成任务');tray.hidden=true;document.body.append(tray);
  const labels={unknown:'状态待确认',queued:'排队中',running:'生成中',configuration_required:'待连接 API',failed:'生成失败',cancelled:'已取消',succeeded:'生成完成'};
  const recognitionLabels={...labels,running:'识别中',succeeded:'识别完成',failed:'识别失败'};
  const analysisLabels={...labels,running:'解析中',failed:'解析失败',cancelled:'已取消解析',succeeded:'解析完成'};
  const inPlace=new Map(),inPlaceRecoveries=new Map(),videoTargets=new Map(),imageTargets=new Map(),derivedTargets=new Map();
  let collapsed=false;
  function render(){tray.classList.toggle('is-collapsed',collapsed);tray.replaceChildren();if(!service.jobs.size)return;tray.hidden=false;const header=el('header');header.append(el('span','','生成任务'),button(collapsed?'展开':'收起',()=>{collapsed=!collapsed;render();}));tray.append(header);if(collapsed)return;for(const job of [...service.jobs.values()].reverse().slice(0,8)){const row=el('div','task-item');row.dataset.status=job.status;row.append(el('strong','',job.request.label||job.request.kind),el('span','task-status',(job.applicationError?'结果应用失败':job.applying?'正在应用结果…':job.providerStatus==='succeeded'&&job.localization?.state==='failed'?'素材保存失败':job.providerStatus==='succeeded'&&['pending','downloading'].includes(job.localization?.state)?'正在保存素材':(job.request.kind==='image.recognize'?recognitionLabels:job.request.kind==='video.analyze'?analysisLabels:labels)[job.status])+(job.status==='running'&&job.providerStatus!=='succeeded'?' '+Math.round(job.progress)+'%':'')));if(job.error)row.append(el('p','',job.error));if(job.recovered&&job.status==='succeeded'&&!job.applied&&job.request.kind==='image.recognize')row.append(el('p','','识别记录已取回；原焦点会话已结束，请重新进入焦点编辑选择目标。'));if(job.recovered&&!job.request.parameters?.workflowRecovery&&job.status==='succeeded'&&!job.applied&&job.request.kind!=='image.recognize'){if(job.request.parameters?.canvasResults)row.append(button('恢复到原占位',()=>applyRecovered(job.id,'existing').catch(error=>app.notify(error.message))));row.append(button('作为新节点取回',()=>applyRecovered(job.id,'new_nodes').catch(error=>app.notify(error.message))));}if(job.recovered&&['failed','cancelled','configuration_required'].includes(job.status)&&job.request.parameters?.canvasResults)row.append(button('清理原占位',()=>cancel(job.id)));if(job.status==='unknown'){row.append(button(job.providerStatus==='succeeded'?'重新取回素材':'查询恢复',()=>recover(job.id).catch(error=>app.notify(error.message))));if(job.recovery?.pollable===false&&job.providerStatus!=='succeeded')row.append(el('p','','暂无可查询的供应商任务标识；查询仅核对本机记录，不会重新发起任务。'));}if(job.applicationError){row.append(el('p','',job.applicationError));if(!job.recovered)row.append(button('重试应用结果',()=>retryApplication(job.id).catch(error=>app.notify(error.message))));}if(job.applying)row.append(el('p','','正在应用结果…'));const progress=el('progress');progress.max=100;progress.value=job.progress;row.append(progress);if(['running','queued','unknown'].includes(job.status))row.append(button('取消',()=>cancel(job.id)));if(!inPlace.has(job.id)&&!job.request.parameters?.workflowRecovery&&['failed','cancelled','configuration_required'].includes(job.status))row.append(button('重试',()=>retry(job.id)));if(job.status==='configuration_required')row.append(button('连接 API',configure));tray.append(row);}}
  const mediaValidationReady=import('./src/features/generation-results/validate-media.mjs');
  async function validateOutputMedia(output){return (await mediaValidationReady).validateResultMedia(output);}
  async function validateWorkflowProposal(node,validateMedia=validateOutputMedia){
    if(node?.type==='text'){if(typeof node.content!=='string'||!node.content.trim())throw Error('工作流文本结果为空');return;}
    const source=node?.type==='image'?node.fullImage||node.image:node?.type==='video'?node.video:node?.type==='audio'?node.audio:null;
    if(!source||!GenerationCore.isLocalMediaSource(source))throw Error('工作流结果尚未保存为本地素材');
    if(node.type==='audio'){
      // Decode current bytes rather than trusting AudioAPI's session cache.
      const url=await window.LocalAssets.url(source),response=await fetch(url,{signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('工作流音频素材无法读取');
      const context=new window.AudioContext();
      try{const buffer=await context.decodeAudioData(await response.arrayBuffer());if(!Number.isFinite(buffer.duration)||buffer.duration<=0)throw Error('工作流音频结果为空');}
      finally{await context.close();}
    }else await validateMedia({type:node.type,url:source,...(node.type==='image'?{fullImage:node.fullImage,image:node.image}:{video:source})});
  }
  async function applyResults(job){
    const stored=service.jobs.get(job.id);
    const panorama=job.request.kind==='image.generate'?await (panoramaValidation||=import('./src/features/image-generation/panorama-native.mjs')):null;
    const isPanorama=panorama?.isNativePanoramaRequest(job.request);
    if(isPanorama&&(!Array.isArray(job.outputs)||job.outputs.length!==1))throw Error('全景任务必须返回一个真实图片结果');
    async function validateJobMedia(output){
      if(!isPanorama){
        await validateOutputMedia(output);
        if(['video.erase','video.replace'].includes(job.request.kind)){
          videoMaskMedia||=import('./src/features/video-mask/media.mjs');
          await (await videoMaskMedia).captureMaskedVideoPoster(output,{signal:stored.controller?.signal});
        }
        return;
      }
      const measured=await panorama.validateNativePanoramaOutputs([output],{decode:async()=>{
        const probe={...output};await validateOutputMedia(probe);return probe;
      }});
      Object.assign(output,measured[0]);
    }

    const workflowOutputSnapshot=job.request.parameters?.workflowRecovery?structuredClone(job.outputs):null;
    const workflowOutputs=workflowOutputSnapshot?JSON.stringify(workflowOutputSnapshot):null;
    if(workflowOutputs!==null)job={...job,request:structuredClone(job.request),outputs:structuredClone(workflowOutputSnapshot)};
    if(stored.recovered&&stored.request.kind==='audio.generate'&&!audioSubtitleReceipts.has(stored.id)){
      const receipt=audioReceipt(stored.request,app.getState().nodes.find(node=>node.id===(stored.recoverySourceId||stored.request.nodeId)));
      audioSubtitleReceipts.set(stored.id,receipt);if(receipt.source)latestAudioSubmissions.set(receipt.source,stored.id);
    }
    const receipt=audioSubtitleReceipts.get(stored.id),subtitles=stored.request.kind==='audio.generate'?await audioSubtitleReady:null;
    const subtitlesEnabled=subtitles?.audioSubtitleEnabled(receipt?.request);
    const ordinaryAudio=!stored.recovered&&!inPlace.has(stored.id)&&!derivedTargets.has(stored.id)&&stored.request.kind==='audio.generate'&&receipt?.source?.type==='audio';
    const subtitleJob=()=>ordinaryAudio?{...stored,request:receipt.request,outputs:stored.outputs.slice(0,1),resultIds:stored.resultIds}:{...stored,request:receipt.request};
    const audioGuard=()=>{if(subtitlesEnabled&&!audioReceiptCurrent(receipt,stored.id,true))throw Error('音频字幕来源或任务版本已变化，旧结果未应用');};
    if(!stored.resultIds)audioGuard();
    let retainedWithoutSubtitleReceipt=false;
    const captureSubtitleBindings=()=>{
      if(!subtitlesEnabled)return;
      if(!audioSubtitleBindings.has(stored.id)){
        if(!audioReceiptCurrent(receipt,stored.id))throw Error('音频字幕来源或画布已变化');
        const nodes=app.getState().nodes;
        audioSubtitleBindings.set(stored.id,subtitleJob().outputs.map((output,index)=>{
          if(subtitles.subtitleText(output)===null)return null;
          const accepted=audioSubtitleMedia.get(stored.id)?.[index],source=nodes.find(node=>node.id===stored.resultIds?.[index]);
          if(!accepted||accepted.node!==source)throw Error('无法验证字幕对应的实际音频结果');
          return subtitles.captureSubtitleBinding(source,nodes,accepted.audio);
        }));
      }
    };
    const recordSubtitleMedia=media=>{if(!subtitlesEnabled)return;audioSubtitleMedia.set(stored.id,media);captureSubtitleBindings();};
    const applySubtitles=async()=>{
      if(!subtitlesEnabled)return;
      if(retainedWithoutSubtitleReceipt){app.notify('音频结果已保留；缺少原字幕绑定收据，保留现有字幕，不自动重新绑定。');return;}
      captureSubtitleBindings();
      await subtitles.applyAudioSubtitles({job:subtitleJob(),app,bindings:audioSubtitleBindings.get(stored.id),isCurrent:()=>audioReceiptCurrent(receipt,stored.id)});
    };
    const {resultProvenance}=await provenanceReady;
    if(stored.recovered&&stored.recoveryMode!=='workflow_existing'){
      if(stored.recoveryMode==='existing'){const {applyRecoveredPlan}=await import('./src/features/generation-results/recovery.mjs');await applyRecoveredPlan(stored,{app,workflow:resultWorkflow,validateMedia:validateJobMedia,persist:()=>{const state=app.getState();return window.CanvasStore.save({version:1,nodes:state.nodes,edges:state.edges});}});}
      else if(stored.recoveryMode==='new_nodes'){const {importRecoveredOutputs}=await import('./src/features/generation-results/recovery.mjs');await importRecoveredOutputs(stored,{app,sourceId:stored.recoverySourceId,validateMedia:validateJobMedia,localizeAudio:url=>window.AudioAPI.localize(url),onApplied:(ids,{created,audioRefs})=>{if(!subtitlesEnabled)return;if(created)recordSubtitleMedia(ids.map((id,index)=>({node:app.getState().nodes.find(node=>node.id===id),audio:audioRefs[index]})));else if(!audioSubtitleBindings.has(stored.id))retainedWithoutSubtitleReceipt=true;},persist:()=>{const state=app.getState();return window.CanvasStore.save({version:1,nodes:state.nodes,edges:state.edges});}});}
      else throw Error('任务已取回，请明确选择原占位或新节点应用方式');
      await applySubtitles();return;
    }
    {
      draftGuards.get(job.id)?.();
      const originalTarget=inPlace.get(job.id),target=originalTarget&&{...originalTarget,guard(){originalTarget.guard();draftGuards.get(job.id)?.();if(workflowOutputs!==null&&JSON.stringify(stored.outputs)!==workflowOutputs)throw Error('工作流结果在应用期间已变化');}};
      if(stored.recoveryMode==='workflow_existing'&&!target)throw Error('工作流恢复缺少原节点应用权限');
      if(target&&!stored.resultIds){
        target.guard();audioGuard();
        if((target.beforeApply||target.onApplied)&&(target.apply||target.applyBatch))throw Error('持久工作流必须应用到原节点，不能改用自定义批次目标');
        if(target.applyBatch){if(job.outputs.some(o=>o.type!==target.type))throw Error('批次结果类型与节点类型不一致');await Promise.all(job.outputs.map(validateJobMedia));target.guard();audioGuard();const applied=await target.applyBatch(job.outputs.map(o=>({...o,...resultProvenance(job,o)})));stored.resultIds=Array.isArray(applied)?applied.map(n=>n.id):[job.request.nodeId];recordSubtitleMedia(stored.resultIds.map((id,index)=>({node:app.getState().nodes.find(node=>node.id===id),audio:applied?.[index]?.audio})));target.didApply?.();}
        else{if(job.outputs.length!==1||job.outputs[0].type!==target.type)throw Error('工作流需要一个与节点类型一致的结果');
        const o=job.outputs[0];await validateJobMedia(o);let patch;
        const restored=target.restoredProposal;
        if(restored){
          if(restored.taskId!==job.id||restored.proposedNode?.id!==job.request.nodeId||restored.proposedNode.type!==target.type||!Number.isFinite(restored.createdAt))throw Error('工作流原应用意图缺少完整结果节点');
          patch=structuredClone(restored.proposedNode);job={...job,createdAt:restored.createdAt};
          await validateWorkflowProposal(patch,validateJobMedia);target.guard();
        }
        else if(o.type==='audio')patch={audio:await window.AudioAPI.localize(o.audio||o.url)};
        else if(o.type==='text')patch={content:o.text};
        else if(o.type==='video')patch={video:o.video||o.url,...(o.poster?{image:o.poster}:{} )};
        else patch={image:o.image||o.url||o.fullImage,fullImage:o.fullImage||o.image||o.url};
        target.guard();audioGuard();
        if(!restored&&o.type==='video'&&!target.apply){const history=await import('./src/features/video-history/core.mjs'),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);target.guard();patch=history.record({...n,video:n.video||window.EDITOR_DATA?.nodes[n.id]?.video},job,window.NodeEditor.getConfig(n));window.NodeEditor.invalidate();}
        if(!restored&&o.type==='image'&&!target.apply){const history=await import('./image-history-core.mjs'),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);target.guard();patch=history.record(n,job,window.NodeEditor.getConfig(n),window.VERSION_DATA?.[n.id]);window.NodeEditor.invalidate();}
        if(!restored&&!target.apply&&patch.generation&&target.patch?.generation)patch.generation={...patch.generation,...target.patch.generation};
        let proposed;
        if(!target.apply&&target.beforeApply){
          const current=app.getState().nodes.find(n=>n.id===job.request.nodeId);
          if(!current)throw Error('工作流原节点已不存在');
          proposed=restored?structuredClone(restored.proposedNode):structuredClone({...current,...target.patch,...patch});
          if(job.request.parameters?.workflowRecovery&&!restored){await validateWorkflowProposal(proposed,validateJobMedia);target.guard();}
          // Decoding may enrich the application copy with dimensions. The
          // result digest must still describe the original provider response.
          const receipt=await target.beforeApply(proposed,workflowOutputSnapshot?{...job,outputs:structuredClone(workflowOutputSnapshot)}:job);target.guard();audioGuard();
          if(proposed.id!==current.id||proposed.type!==current.type)throw Error('工作流应用意图改变了原节点身份');
          if(job.request.parameters?.workflowRecovery){
            const identity=job.request.parameters.workflowRecovery,marker=proposed.workflowRecoveryResult;
            if(receipt?.taskId!==job.id||typeof receipt.afterVersion!=='string'||!receipt.afterVersion||typeof receipt.resultVersion!=='string'||!receipt.resultVersion||!marker||marker.taskId!==job.id||marker.resultVersion!==receipt.resultVersion||Object.entries(identity).some(([key,value])=>marker[key]!==value))throw Error('工作流应用意图缺少原任务结果收据');
          }
          stored.workflowApplicationReceipt=receipt;
          // Geometry is intentionally outside workflow ownership. A user may
          // move or resize the node while the durable intent is being written.
          const latest=app.getState().nodes.find(n=>n.id===current.id);
          for(const key of ['x','y','width','height','title','selected']){if(Object.hasOwn(latest,key))proposed[key]=latest[key];else delete proposed[key];}
        }
        const applied=target.apply?await target.apply({...o,...resultProvenance(job,o)}):app.updateNode(job.request.nodeId,proposed||{...target.patch,...patch});
        stored.resultIds=Array.isArray(applied)?applied.map(n=>n.id):[job.request.nodeId];recordSubtitleMedia(stored.resultIds.map((id,index)=>({node:app.getState().nodes.find(node=>node.id===id),audio:target.apply?(Array.isArray(applied)?applied[index]?.audio:applied?.audio):patch.audio})));target.didApply?.();}
      }
      if(!stored.resultIds&&resultWorkflow?.has(job.id))stored.resultIds=await resultWorkflow.apply(job,validateJobMedia);
      if(!stored.resultIds&&videoTargets.has(job.id)){
        const expected=videoTargets.get(job.id),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);
        const guard=()=>{if(!n||!app.getState().nodes.includes(n)||videoSignature(n)!==expected)throw Error('视频或生成参数已变化，请重新生成');draftGuards.get(job.id)?.();};guard();
        if(job.outputs.some(o=>o.type!=='video'))throw Error('视频节点需要视频生成结果');
        await Promise.all(job.outputs.map(validateJobMedia));const history=await import('./src/features/video-history/core.mjs');guard();
        window.NodeEditor.invalidate();app.updateNode(n.id,history.record({...n,video:n.video||window.EDITOR_DATA?.nodes[n.id]?.video},job,window.NodeEditor.getConfig(n)));stored.resultIds=[n.id];
      }
      if(!stored.resultIds&&imageTargets.has(job.id)){
        const expected=imageTargets.get(job.id),n=app.getState().nodes.find(n=>n.id===job.request.nodeId);
        const guard=()=>{if(!n||!app.getState().nodes.includes(n)||imageSignature(n)!==expected)throw Error('图片或生成参数已变化，请重新生成');};guard();
        if(job.outputs.some(o=>o.type!=='image'))throw Error('图片节点需要图片生成结果');
        await Promise.all(job.outputs.map(validateJobMedia));const history=await import('./image-history-core.mjs');guard();
        window.NodeEditor.invalidate();app.updateNode(n.id,history.record(n,job,window.NodeEditor.getConfig(n),window.VERSION_DATA?.[n.id]));stored.resultIds=[n.id];
      }
      if(!stored.resultIds&&derivedTargets.has(job.id)){
        const target=derivedTargets.get(job.id);target.guard();
        await Promise.all(job.outputs.map(validateJobMedia));target.guard();
        audioGuard();const outputs=await Promise.all(job.outputs.map(async o=>({...o,...resultProvenance(job,o),image:o.image||(o.type==='image'?o.url:o.poster),video:o.video||(o.type==='video'?o.url:null),audio:o.type==='audio'?await window.AudioAPI.localize(o.audio||o.url):undefined,content:o.text,...(o.type==='text'?{textMode:'pure'}:{}),title:o.title||job.request.label})));target.guard();audioGuard();
        const results=app.createConnected(job.request.nodeId,outputs,target.options);stored.resultIds=results.map(n=>n.id);recordSubtitleMedia(results.map((node,index)=>({node,audio:outputs[index].audio||outputs[index].url})));target.didApply?.();
      }
      if(ordinaryAudio){
        const {applyOrdinaryAudioResult}=await ordinaryAudioReady;
        await applyOrdinaryAudioResult({job:stored,receipt,app,isCurrent:()=>audioReceiptCurrent(receipt,stored.id),localize:source=>window.AudioAPI.localize(source),inspect:source=>window.AudioAPI.inspectAudio(source),hasPendingEdits:id=>window.AudioAPI.hasPendingEdits(id),onApplied:applied=>{stored.resultIds=[applied.source.id];recordSubtitleMedia([{node:applied.source,audio:applied.audio}]);}});
      }
      if(!stored.resultIds){
        await Promise.all(job.outputs.map(validateJobMedia));
        if(!stored.materializedOutputs)stored.materializedOutputs=await Promise.all(job.outputs.map(async o=>o.type==='audio'?{...o,audio:await window.AudioAPI.localize(o.audio||o.url),audioMode:'upload'}:o));
        audioGuard();const results=app.createConnected(job.request.nodeId,stored.materializedOutputs.map(o=>({...o,...resultProvenance(job,o),image:o.image||(o.type==='image'?o.url:o.poster),video:o.video||(o.type==='video'?o.url:null),audio:o.audio||(o.type==='audio'?o.url:null),content:o.text,...(o.type==='text'?{textMode:'pure'}:{}),title:o.title||job.request.label||'生成结果'})));
        stored.resultIds=results.map(n=>n.id);
        recordSubtitleMedia(results.map((node,index)=>({node,audio:stored.materializedOutputs[index].audio})));
      }
      await applySubtitles();
      if(job.request.kind==='model.generate'&&app.getState().nodes.some(n=>n.id===job.request.nodeId&&n.type==='studio')){
        if(!window.StudioAPI)throw Error('片场仍在加载，请稍后重试放置');
        stored.sceneResult=await window.StudioAPI.acceptGeneration(job);
      }
      if(job.request.kind==='panorama.edit'){
        if(!window.StudioAPI)throw Error('片场仍在加载，请稍后重试应用全景');
        stored.sceneResult=await window.StudioAPI.acceptPanoramaGeneration(job);
        if(!stored.sceneResult.applied)throw Error(stored.sceneResult.reason||'全景结果尚未应用');
      }
      if(target&&(target.beforeApply||target.onApplied)){
        target.guard();
        const state=app.getState();
        // Explicit transaction completion is the layer barrier. updateNode's
        // asynchronous autosave alone does not prove the graph was persisted.
        await window.CanvasStore.save({version:1,nodes:state.nodes,edges:state.edges},target.projectId,{beforeCommit:()=>{target.guard();return true;}});
        target.guard();
        await target.onApplied?.(stored,stored.workflowApplicationReceipt);
        target.guard();
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
  async function recover(id,{signal}={}){return service.recover(id,{signal,beforeRestore:async job=>{if(job.recovered||job.request.parameters?.workflowRecovery){job.recovered=true;if(job.recoveryMode!=='workflow_existing'){job.applicationStatus='awaiting_recovery_application';job.applied=false;}}}});}
  async function applyRecovered(id,mode,sourceId){
    const job=service.jobs.get(id);if(!job?.recovered)throw Error('请先恢复页面刷新前的任务');
    if(job.request.parameters?.workflowRecovery)throw Error('持久工作流结果只能由原分组恢复到原节点');
    if(job.request.kind==='image.recognize')throw Error('原焦点识别会话已结束，不能恢复标签或创建普通节点，请重新选择目标');
    if(job.applying)throw Error('结果正在应用，请等待完成');
    if(job.applied)return retryApplication(id);
    if(!['existing','new_nodes'].includes(mode))throw Error('未知的恢复应用方式');
    if(job.recoveryMode&&job.recoveryMode!==mode&&job.resultIds?.length)throw Error('结果已部分应用，请继续原方式，避免重复节点');
    if(mode==='existing'&&!job.resultIds?.length){resultModules||=import('./src/features/generation-results/workflow.mjs');resultWorkflow||=(await resultModules).createResultWorkflow(app);await resultWorkflow.restore(job);}
    job.recoveryMode=mode;job.recoverySourceId=sourceId;return retryApplication(id);
  }
  async function retryApplication(id){return (await applicationReady).run(id);}
  service.subscribe(job=>{if(job.status==='succeeded'){failureSources.delete(job.id);if(!job.recovered||job.recoveryMode==='workflow_existing'&&inPlace.has(job.id))void retryApplication(job.id).catch(error=>app.notify(error.message));}else if(['failed','cancelled','configuration_required'].includes(job.status)){
    const stored=service.jobs.get(job.id);
    stored.nodeFailures=failureBridge?.captureFailureReceipts({job,app,original:failureSources.get(job.id),planned:!!resultWorkflow?.has(job.id)})||[];
    failureSources.delete(job.id);
    resultWorkflow?.clear(job.id);inPlace.get(job.id)?.reject(Error(job.error||'生成任务已取消'));}else if(job.status==='unknown'){inPlace.get(job.id)?.reject(Error(job.error||'生成状态待确认，请查询恢复'));}render();if(job.request.kind==='image.generate')app.render();});
  function configure(){
    const existing=document.querySelector('dialog.api-dialog');if(existing){existing.focus();return;}
    const returnFocus=document.activeElement,d=el('dialog','api-dialog'),header=el('div','dialog-heading');d.setAttribute('aria-label','连接生成 API');
    let saving=false,viewRevision=0;
    const close=button('×',()=>{if(!saving)d.close();});close.setAttribute('aria-label','关闭 API 配置');
    header.append(el('h2','','连接生成 API'),close);
    const status=el('p','','正在读取本机配置…'),readiness=el('details','api-readiness'),summary=el('summary','','查看各项能力配置'),list=el('div','api-readiness-list'),error=el('p','api-error');error.setAttribute('role','alert');
    readiness.append(summary,list);
    const showConfiguration=async(metadata,revision)=>{
      const routing=await providerConfigurationReady;if(!d.isConnected||revision!==viewRevision)return;
      list.replaceChildren();
      if(metadata?.protocol==='routed'){
        status.textContent=metadata.configurationError?'本机生成路由配置无效':metadata.configured?'本机生成服务已配置 · 按操作路由':'本机生成服务待配置 · 按操作路由';
      }else status.textContent=metadata===null?'本机服务不可访问':metadata.configurationError?'本机生成配置无效':metadata.source==='session'?'本机任务网关已配置 · 当前服务进程内有效':metadata.configured?'本机生成服务已配置 · '+metadata.protocol:'本机生成服务待配置 · '+(metadata.missing||[]).join('、');
      const rows=routing.generationOperationReadiness(metadata),labels={ready:'配置就绪 · 待实测',gateway:'网关已配置 · 功能待核验',pending:'待配置',invalid:'配置无效',unknown:'状态未确认'};
      const operations=new Set(rows.map(row=>row.kind)),ready=new Set(rows.filter(row=>row.configured).map(row=>row.kind));
      summary.textContent='查看各项能力配置 · '+ready.size+'/'+operations.size+' 项配置就绪';
      for(const row of rows)list.append(el('p','',row.operation+(metadata?.protocol==='routed'?' · '+(row.provider||'未选择服务商'):'')+' · '+labels[row.state]+(row.missing.length?' · 缺少 '+row.missing.join('、'):'')));
      list.append(el('p','api-readiness-note','配置就绪表示已设置路由、模型与 Key。真实模型权限、参数限制及生成结果仍须实测；通用任务网关需实现相应功能。'));
    };
    const url=el('input');url.type='url';url.placeholder='https://your-task-gateway.example/api';url.setAttribute('aria-label','API 基础地址');
    const key=el('input');key.type='password';key.autocomplete='off';key.placeholder='任务网关 API Key（可选）';key.setAttribute('aria-label','API Key');
    const commit=async input=>{
      if(saving)return;const revision=++viewRevision;saving=true;error.textContent='';for(const control of [close,environment,save,url,key])control.disabled=true;
      try{
        const [client,metadata]=await Promise.all([configurationClientReady,serverConfiguration=refreshServerConfiguration()]);
        if(!metadata)throw Error('无法读取本机配置，请检查本地服务是否正在运行');
        const result=await client.saveLocalGenerationConfiguration(input,{token:metadata.csrfToken,signal:AbortSignal.timeout(10000)});
        serverConfigurationRevision++;serverConfigured=result.configured;serverConfigurationSnapshot=structuredClone(result);serverConfiguration=Promise.resolve(result);service.setProvider(localProvider);key.value='';
        await showConfiguration(result,revision);
        if(!result.configured){error.textContent='已切换为本机环境配置，但仍缺少相应协议、模型或 Key；请配置后刷新。';return;}
        d.close();
      }catch(e){if(d.isConnected)error.textContent=e.message;}
      finally{saving=false;for(const control of [close,environment,save,url,key])control.disabled=false;}
    };
    const environment=button('使用本机服务',()=>commit({mode:'environment'}));
    const save=button('保存配置',()=>commit({baseUrl:url.value,apiKey:key.value}));
    d.append(header,status,readiness,environment,el('p','','任务网关支持 tasks-v1（POST /tasks、GET /tasks/:id）。请求和结果保存由本机服务处理，无需浏览器 CORS。Key 仅保留在本机服务进程内存，重启后需重新输入；现有任务始终使用原配置。官方厂商 Key 请使用对应的本机原生适配器。'),url,key,error,save);
    document.body.append(d);d.oncancel=event=>{if(saving)event.preventDefault();};d.onclose=()=>{key.value='';d.remove();if(returnFocus?.isConnected)returnFocus.focus?.();};d.showModal();
    const revision=++viewRevision;serverConfiguration=refreshServerConfiguration();serverConfiguration.then(metadata=>showConfiguration(metadata,revision));
  }
  function runInPlace(request,{guard,dispatchGuard,type,didApply,patch,apply,applyBatch,beforeApply,onApplied,restoredProposal},{signal,onSubmitted,onPrepared}={}){
    const projectId=(beforeApply||onApplied)?app.projectIdentity().id:undefined;
    let abort;const checkedGuard=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(projectId!==undefined&&app.projectIdentity().id!==projectId)throw Error('工作流项目已变化');guard();};
    const checkedDispatchGuard=()=>{checkedGuard();dispatchGuard?.();};
    return new Promise((resolve,reject)=>{
      checkedDispatchGuard();
      let acknowledge,failAcknowledgement;
      const receipt=new Promise((ready,failed)=>{acknowledge=ready;failAcknowledgement=failed;});receipt.catch(()=>{});
      const job=submitJob(request,{beforeDispatch:checkedDispatchGuard,beforeDispatchReady:()=>receipt,beforeTransportReady:async()=>{checkedDispatchGuard();await onPrepared?.(job);checkedDispatchGuard();}});inPlace.set(job.id,{guard:checkedGuard,type,didApply,patch,apply,applyBatch,beforeApply,onApplied,restoredProposal,projectId,resolve,reject});
      const failed=error=>{failAcknowledgement(error);reject(error);service.cancel(job.id);};
      try{Promise.resolve(onSubmitted?.(job)).then(acknowledge,failed);}catch(error){failed(error);return;}
      abort=()=>service.cancel(job.id);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    }).finally(()=>{if(abort)signal?.removeEventListener('abort',abort);});
  }
  function recoverInPlace(id,targetOptions,{signal,verifyRequest}={}){
    if(inPlaceRecoveries.has(id))return inPlaceRecoveries.get(id);
    if(typeof verifyRequest!=='function')return Promise.reject(Error('工作流恢复必须验证原任务请求'));
    if(typeof targetOptions?.guard!=='function'||typeof targetOptions.beforeApply!=='function'||typeof targetOptions.onApplied!=='function')return Promise.reject(Error('工作流恢复缺少原节点持久应用入口'));
    let abort,installed;
    const projectId=app.projectIdentity().id;
    const checkedGuard=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(app.projectIdentity().id!==projectId)throw Error('工作流项目已变化');targetOptions.guard();};
    const validate=async job=>{
      checkedGuard();
      const request=job.request,identity=request?.parameters?.workflowRecovery;
      if(job.id!==id||!identity||Object.keys(identity).sort().join(',')!=='groupId,nodeId,projectId,runId,version'||identity.version!==1||identity.projectId!==projectId||typeof identity.runId!=='string'||!identity.runId||request.nodeId!==identity.nodeId||request.workflowId!==identity.groupId||request.parameters.count!==1)throw Error('原任务不属于当前持久工作流');
      const nodes=app.getState().nodes,source=nodes.find(node=>node.id===identity.nodeId);
      if(!source||source.type!==targetOptions.type||source.parentId!==identity.groupId||!nodes.some(node=>node.id===identity.groupId&&node.type==='group')||request.kind!==targetOptions.type+'.generate')throw Error('工作流原节点或分组归属已变化');
      const version=JSON.stringify(request);
      if(await verifyRequest(request,job)!==true)throw Error('工作流原请求验证未通过');
      checkedGuard();if(JSON.stringify(job.request)!==version)throw Error('工作流原请求在验证期间已变化');
      return job;
    };
    const pending=Promise.resolve().then(async()=>{
      checkedGuard();
      // Register ownership before the restored succeeded event can notify any
      // subscriber. Query-only recovery retains an explicit awaiting state.
      const completion=new Promise((resolve,reject)=>{
        installed={...targetOptions,projectId,guard:checkedGuard,resolve,reject,beforeApply:async(proposed,job)=>{await validate(job);return targetOptions.beforeApply?.(proposed,job);}};
      });completion.catch(()=>{});
      const restore=async job=>{await validate(job);if(targetOptions.originalCreatedAt!==undefined){if(!Number.isFinite(targetOptions.originalCreatedAt))throw Error('原任务创建时间无效');job.createdAt=targetOptions.originalCreatedAt;}job.recovered=true;job.recoveryMode='workflow_existing';inPlace.set(id,installed);};
      const existing=service.jobs.get(id);
      if(existing?.request.parameters?.workflowRecovery){existing.recovered=true;if(existing.recoveryMode!=='workflow_existing')existing.applicationStatus='awaiting_recovery_application';}
      const job=await service.recover(id,{signal,beforeRestore:restore});
      // A concurrent generic query may already own TaskService's recovery
      // promise; independently verify its result and register our target.
      await restore(job);
      abort=()=>installed.reject(new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      if(job.status==='succeeded'){
        if(job.applied){if(job.workflowApplicationReceipt?.taskId!==id)installed.reject(Error('原任务缺少已持久应用收据'));else installed.resolve(job);}
        else void retryApplication(id).catch(installed.reject);
      }else if(!['queued','running'].includes(job.status))installed.reject(Error(job.error||'原工作流任务状态待确认，未重新提交'));
      return completion;
    }).finally(()=>{if(abort)signal?.removeEventListener('abort',abort);if(inPlace.get(id)===installed)inPlace.delete(id);inPlaceRecoveries.delete(id);});
    inPlaceRecoveries.set(id,pending);return pending;
  }
  function videoSignature(n){return JSON.stringify([n.video||window.EDITOR_DATA?.nodes[n.id]?.video,n.clip,window.NodeEditor.getConfig(n),n.videoHistory]);}
  function imageSignature(n){return JSON.stringify([n.fullImage||n.image,n.imageHistory,n.versions,window.NodeEditor.getConfig(n),n.params]);}
  function submit(request,options){
    const state=app.getState(),n=state.nodes.find(n=>n.id===request.nodeId);
    let submission;
    if(['image.generate','video.generate','text.generate'].includes(request.kind)){
      let mode='variants';try{const saved=localStorage.getItem('tapnow.canvas.generation-result-mode');if(['pile','variants','spread'].includes(saved))mode=saved;}catch{}
      // Host workflows own their result targets independently of the canvas menu preference.
      if(options?.resultMode!==undefined){if(!['pile','variants','spread'].includes(options.resultMode))throw Error('生成结果布局无效');mode=options.resultMode;}
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
  function retry(id){if(inPlace.has(id))throw Error('请通过整组执行重新启动工作流');const old=service.jobs.get(id);if(!old)return null;if(old.request.parameters?.workflowRecovery)throw Error('持久工作流只能查询原任务，不能重发');if(['unknown','queued','running'].includes(old.status))throw Error('请查询已有任务，不能重复生成');if(old.status==='succeeded'&&!old.applied)throw Error('生成已完成，请使用重试应用结果，避免重复调用生成服务');const target=derivedTargets.get(id);if(target){try{return submitDerived(old.request,target);}catch(error){app.notify(error.message);return null;}}return submit(old.request,{beforeDispatch:old.beforeDispatch,beforeDispatchReady:old.beforeDispatchReady});}
  function submitDerived(request,target){target.guard();const job=submitJob(request,{beforeDispatch:target.guard,beforeDispatchReady:target.beforeDispatchReady});derivedTargets.set(job.id,target);return job;}
  window.GenerationAPI={submitDerived,runInPlace,recoverInPlace,validateWorkflowProposal,availability,configuration,configurationSnapshot,isConfigured:()=>service.provider===localProvider?serverConfigured:!!service.provider,submit,setProvider:p=>service.setProvider(p),configure,cancel,retry,retryApplication,recover,applyRecovered,subscribe:fn=>{const unsubscribe=service.subscribe(fn);applicationListeners.add(fn);return()=>{unsubscribe();applicationListeners.delete(fn);};},getJobs:()=>[...service.jobs.values()].map(({controller,...job})=>job)};
  const generationHistoryReady=import('./src/features/generation-history/entry.mjs').then(module=>module.install());
  const historyDispatchReady=import('./src/features/generation-history/dispatch.mjs').then(({createHistoryDispatchGate})=>createHistoryDispatchGate({
    ready:()=>generationHistoryReady,getJob:id=>service.jobs.get(id),captureOptions:job=>({recoverable:job.transport===localProvider})
  }));
  generationHistoryReady.catch(error=>app.notify('生成历史读取失败：'+error.message));
  historyDispatchReady.catch(error=>app.notify('生成历史保存入口加载失败：'+error.message));
  import('./src/features/generation-results/pending-ui.mjs').then(module=>module.install()).catch(error=>app.notify('生成状态加载失败：'+error.message));
  import('./src/features/generation-results/error-ui.mjs').then(module=>module.install()).catch(error=>app.notify('生成错误提示加载失败：'+error.message));
})();
