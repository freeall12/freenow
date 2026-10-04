const audit=[],observed=new WeakSet(),sessionKey='qa-native-video-audio';let saved;
try{saved=JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch{}
let audioId=saved?.audioId,videoId=saved?.videoId;
const panel=document.createElement('aside');panel.style.cssText='position:fixed;z-index:2147483000;top:8px;left:105px;width:690px;max-width:75vw;background:#202020;color:#eee;border:1px solid #888;padding:10px;font:12px system-ui;max-height:26vh;overflow:auto';
panel.innerHTML='<strong>ThinkSound 视频拟音原生 HTTP 合同 fixture · 固定音频非模型效果</strong><p>正式画布 + AudioAPI + 持久 gateway。真实 MP4 与同长 PCM16 正弦波；验收调用、播放、本地归档与恢复，不证明模型音质。实际后端标签必须显示 ThinkSound。请点击正式“生成音频”按钮。</p><button id="qa-create">创建视频→音效节点</button> <button id="qa-view">查看音频节点</button> <button id="qa-empty">空提示词（视频推导）</button> <button id="qa-prompt">拟音提示词</button><br><button data-mode="unconfigured">缺Key（零提交）</button> <button data-mode="unmapped">缺路由（零提交）</button> <button data-mode="ready">恢复配置</button><br><button id="qa-agent-follow">Agent默认跟随8秒</button> <button id="qa-agent-explicit">Agent明确5秒（冲突）</button> <button id="qa-agent-close">关闭Agent卡片</button> <details><summary>回执 / 原生播放事件</summary><pre></pre></details>';
document.body.append(panel);
const log=(event,data={})=>{audit.push({at:new Date().toISOString(),event,...data});panel.querySelector('pre').textContent=JSON.stringify(audit,null,2);};
const observe=()=>{for(const audio of document.querySelectorAll('audio'))if(!observed.has(audio)){observed.add(audio);for(const event of ['loadedmetadata','playing','timeupdate','ended','pause','error'])audio.addEventListener(event,()=>log('native-audio-'+event,{duration:Number.isFinite(audio.duration)?audio.duration:null,currentTime:audio.currentTime,paused:audio.paused,readyState:audio.readyState,errorCode:audio.error?.code}));}};
new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});observe();
for(let i=0;i<200&&(!window.CanvasApp||!window.AudioAPI||!window.GenerationAPI||!window.LocalAssets);i++)await new Promise(resolve=>setTimeout(resolve,100));
if(!window.CanvasApp||!window.AudioAPI||!window.GenerationAPI||!window.LocalAssets)throw Error('生产画布加载超时');
const current=()=>window.CanvasApp.getState().nodes.find(node=>node.id===audioId);
let agentCard=null,agentTrace=null,agentJobId=null;
const agentHost=document.createElement('aside');agentHost.setAttribute('aria-label','正式Agent音频确认fixture');agentHost.style.cssText='position:fixed;z-index:2147482999;right:16px;top:28vh;width:580px;max-width:58vw;max-height:68vh;overflow:auto;padding:12px;border:1px solid #777;background:#1d1d1d;color:#eee;font:13px system-ui';agentHost.hidden=true;document.body.append(agentHost);
window.videoAudioNativeQA={audit,getAudioId:()=>audioId,getVideoId:()=>videoId,getState:()=>window.CanvasApp.getState(),getJobs:()=>window.GenerationAPI.getJobs(),getAgentTrace:()=>agentTrace};
panel.querySelector('#qa-create').onclick=async()=>{
 try{
  const fixture=await fetch('/api/qa/video-audio-native-audit').then(response=>response.json()),blob=await fetch(fixture.video.path).then(response=>response.blob()),video=await window.LocalAssets.put(blob);
  const source=window.CanvasApp.addNode('video',{x:innerWidth*.16,y:innerHeight*.48},null,'QA 真实 '+fixture.video.duration+' 秒 MP4',{video,videoDuration:fixture.video.duration});videoId=source.id;
  const audioConfig=window.AudioCore.transition({prompt:''},'sonilo-music','Sound');audioConfig.params.duration=fixture.video.duration;audioConfig.references=[{id:videoId,type:'video'}];
  const target=window.CanvasApp.addNode('audio',{x:innerWidth*.5,y:innerHeight*.48},null,'QA ThinkSound 视频拟音 · 固定音频fixture',{audioConfig});audioId=target.id;window.CanvasApp.connect(videoId,audioId);window.CanvasApp.focusNode(audioId);sessionStorage.setItem(sessionKey,JSON.stringify({audioId,videoId}));window.AudioAPI.refreshAvailability();log('source-created',{audioId,videoId,sourceDuration:fixture.video.duration,model:audioConfig.model,scene:audioConfig.scene,realSupplier:false,fixedTone:true});
 }catch(error){log('fixture-error',{message:error.message});}
};
panel.querySelector('#qa-view').onclick=()=>{if(current())window.CanvasApp.focusNode(audioId);};
const prompt=value=>{const node=current();if(!node)return;const audioConfig=structuredClone(node.audioConfig);audioConfig.prompt=value;window.CanvasApp.updateNode(audioId,{audioConfig});window.CanvasApp.focusNode(audioId);window.AudioAPI.refreshAvailability();log('prompt-changed',{promptLength:value.length});};
panel.querySelector('#qa-empty').onclick=()=>prompt('');panel.querySelector('#qa-prompt').onclick=()=>prompt('轻柔脚步声，与参考视频动作同步。');
for(const button of panel.querySelectorAll('[data-mode]'))button.onclick=async()=>{const value=await fetch('/api/qa/video-audio-native-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:button.dataset.mode})}).then(response=>response.json());window.AudioAPI.refreshAvailability();log('fixture-mode',value);};
const closeAgent=()=>{agentCard?.destroy();agentCard=null;agentTrace=null;agentJobId=null;agentHost.replaceChildren();agentHost.hidden=true;};
panel.querySelector('#qa-agent-close').onclick=closeAgent;
async function openAgent(explicit){
 try{
  const node=current(),source=window.CanvasApp.getState().nodes.find(value=>value.id===videoId);if(!node||!source)throw Error('请先创建视频→音效节点');
  closeAgent();
  if(!document.querySelector('link[data-agent-generation]')){const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('../../agent-generation/styles.css',import.meta.url).href;css.dataset.agentGeneration='';document.head.append(css);}
  const [{createGenerationCard},{createAudioDraft}]=await Promise.all([import('../../agent-generation/card.mjs'),import('../../agent-generation/audio.mjs')]);
  const args={kind:'audio.generate',nodeId:audioId,model:'sonilo',audioScene:'Sound',prompt:'',referenceIds:[videoId],...(explicit?{duration:5}:{})};
  const draft=createAudioDraft(args,window.CanvasApp.getState().nodes);agentTrace={id:crypto.randomUUID(),name:'generation_submit',status:'pending',args};const trace=agentTrace;
  agentCard=createGenerationCard(trace,{
   getNodes:()=>window.CanvasApp.getState().nodes,getEdges:()=>window.CanvasApp.getState().edges,getAudioConfiguration:()=>window.GenerationAPI.configuration(),getMode:()=> 'ask',resolveAsset:url=>window.LocalAssets.url(url),onOpenNode:id=>window.CanvasApp.focusNode(id),
   onChange:value=>log('agent-draft-changed',{traceId:value.id,duration:value.confirmationDraft?.duration,explicitDuration:!!value.confirmationDraft?.audioDurationExplicit}),
   onConfirm:async(value,allowed,confirmed)=>{
    if(value!==agentTrace)return;
    if(!allowed){value.status='denied';agentCard?.update(value);log('agent-confirmation-cancelled',{traceId:value.id});return;}
    log('agent-confirmed',{traceId:value.id,explicitRequested:explicit,confirmedDurationPresent:Object.hasOwn(confirmed,'duration'),confirmedDuration:confirmed.duration,referenceCount:confirmed.referenceIds?.length});
    let stage='prepare';try{
     const prepared=await window.AudioAPI.buildRequest(confirmed.nodeId,confirmed);log('agent-production-request',{traceId:value.id,model:prepared.parameters.model,scene:prepared.parameters.scene,duration:prepared.parameters.duration,inputDuration:prepared.inputs[0]?.duration,inputType:prepared.inputs[0]?.type});
     stage='submit';const job=await window.GenerationAPI.submit(prepared);agentJobId=job.id;value.status='running';value.generationJob=job;agentCard?.update(value);log('agent-task-accepted',{traceId:value.id,jobId:job.id,status:job.status,fixture:true,realSupplier:false});
    }catch(error){value.status='error';value.result={error:error.message};agentCard?.update(value);log('agent-production-rejected',{traceId:value.id,explicitRequested:explicit,message:error.message,stage,providerSubmitted:stage==='prepare'?false:'unknown'});}
   }
  });
  agentHost.hidden=false;agentHost.replaceChildren(agentCard.element);log('agent-card-opened',{traceId:trace.id,explicitRequested:explicit,rawDurationPresent:Object.hasOwn(args,'duration'),rawDuration:args.duration,draftDuration:draft.duration,draftDurationExplicit:!!draft.audioDurationExplicit,sourceDuration:source.videoDuration,fixture:true,realSupplier:false});
 }catch(error){log('fixture-error',{message:error.message});}
}
panel.querySelector('#qa-agent-follow').onclick=()=>openAgent(false);panel.querySelector('#qa-agent-explicit').onclick=()=>openAgent(true);
window.GenerationAPI.subscribe(job=>{if(job.request?.nodeId!==audioId)return;log('production-job',{jobId:job.id,status:job.status,model:job.request.parameters?.model,scene:job.request.parameters?.scene,duration:job.request.parameters?.duration,applied:job.applied,applying:job.applying,applicationError:job.applicationError,resultIds:job.resultIds,outputs:job.outputs?.map(value=>({type:value.type,url:value.url,duration:value.duration,mime:value.mime}))});if(agentTrace&&job.id===agentJobId){agentTrace.generationJob=job;agentTrace.status=['succeeded','failed','cancelled','configuration_required'].includes(job.status)?job.status==='succeeded'?'done':job.status==='cancelled'?'cancelled':'error':'running';agentCard?.update(agentTrace);log('agent-production-job',{traceId:agentTrace.id,jobId:job.id,status:job.status,applied:job.applied,duration:job.request.parameters?.duration});}if(job.resultIds?.length){const node=current();log('applied-audio-node',{audioId,nodeId:node?.id,audio:node?.audio,audioMode:node?.audioMode,resultIds:job.resultIds});}observe();});
log('production-ready',{fixture:true,realSupplier:false,fixedTone:true,restoredAudioId:audioId,restoredVideoId:videoId});
