const app=window.CanvasApp,fixture=window.NodeAudioRepairMainFixture,bar=document.createElement('aside');
bar.style.cssText='position:fixed;left:190px;right:190px;top:54px;z-index:2200;padding:10px;background:#25282b;color:#eee;font:12px system-ui;border:1px solid #555';
const heading=document.createElement('strong');heading.textContent='音频人工修复主壳 QA · 正式 app.js/节点按钮/文件选择器；独立数据库与内存偏好';
const instruction=document.createElement('p');instruction.style.margin='5px 0';instruction.textContent='点击左侧节点「导入本地音频」，在原生文件选择器选择 qa/node-audio-repair-tone.wav，再导入。右侧旧节点及两节点连线应保持。';
const output=document.createElement('output');output.ariaLabel='主壳音频人工修复诊断';output.style.cssText='display:block;white-space:pre-wrap;overflow-wrap:anywhere;max-height:115px;overflow:auto;margin-top:6px';
const buttons=[];let saved=null,ready=false,lastError=null;
function row(node){
 const element=app.getNodeElement(node.id),audio=element?.querySelector('audio'),player=element?.querySelector('.audio-player'),wave=element?.querySelector('.audio-wave');
 return {id:node.id,audio:node.audio,audioMode:node.audioMode,audioDuration:node.audioDuration,durationMs:node.durationMs,width:node.width,height:node.height,title:node.title,provenance:node.provenance,sourceJournal:node.sourceJournal,repairButton:!!element?.querySelector('.audio-source-repair .audio-upload'),waveform:player?.dataset.waveform,waveDuration:wave?.getAttribute('aria-valuemax'),player:audio?{src:audio.getAttribute('src'),readyState:audio.readyState,duration:audio.duration,currentTime:audio.currentTime,paused:audio.paused,ended:audio.ended}:null};
}
function draw(){output.textContent=JSON.stringify({ready,namespace:fixture.namespace,projectId:app.projectIdentity().id,live:app.getState().nodes.map(row),saved:saved?.nodes?.map(({id,audio,audioMode,audioDuration,durationMs,provenance,sourceJournal})=>({id,audio,audioMode,audioDuration,durationMs,provenance,sourceJournal})),edges:app.getState().edges,savedEdges:saved?.edges,history:app.historyState(),externalAttempts:fixture.externalAttempts,blobReads:fixture.fetches.filter(ref=>ref==='blob:local-byte-read').length,lastError},null,2);}
function action(label,run){const button=document.createElement('button');button.textContent=label;button.style.margin='4px 6px 0 0';button.disabled=true;button.onclick=async()=>{try{lastError=null;await run();}catch(error){lastError=error.message;app.notify(error.message);}draw();};bar.append(button);buttons.push(button);}
bar.append(heading,instruction);
action('保存并实际回读',async()=>{await app.saveProject();saved=await window.CanvasStore.load();app.notify('实际 CanvasStore 记录已回读');});
action('只回读持久记录',async()=>{saved=await window.CanvasStore.load();});
action('撤销一次并保存',async()=>{app.undo();await app.saveProject();saved=await window.CanvasStore.load();});
action('重做一次并保存',async()=>{app.undo(true);await app.saveProject();saved=await window.CanvasStore.load();});
action('刷新复验',()=>location.reload());
const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='展开音频修复诊断';summary.style.cursor='pointer';details.append(summary,output);bar.append(details);document.body.append(bar);
document.addEventListener('canvas:render',()=>queueMicrotask(draw));
for(const event of ['loadedmetadata','loadeddata','timeupdate'])document.addEventListener(event,()=>draw(),true);
document.addEventListener('load',event=>{if(event.target instanceof HTMLImageElement)draw();},true);
window.NodeAudioRepairMainQA={app,snapshot:()=>app.projectSnapshot(),saved:()=>structuredClone(saved),diagnostics:()=>JSON.parse(output.textContent),read:async()=>{saved=await window.CanvasStore.load();draw();return structuredClone(saved);}};
await window.CanvasResourceDisplayReady;
for(let attempt=0;attempt<100;attempt++){
 try{saved=await window.CanvasStore.load();if(!saved)await app.saveProject();else if(app.getState().nodes.some(node=>node.audio?.startsWith('asset:'))||app.resourceMigrationStatus())break;saved=await window.CanvasStore.load();ready=true;break;}
 catch(error){if(!/尚未成功读取/.test(error.message)){lastError=error.message;break;}await new Promise(resolve=>setTimeout(resolve,100));}
}
if(saved&&!lastError)ready=true;
for(const button of buttons)button.disabled=!ready;
draw();
