import {openExtend} from '/src/features/video-creation/ui.mjs';
const app=window.CanvasApp,fixture=window.ExtensionFixture,panel=document.createElement('aside');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;color:white;padding:10px;font:12px sans-serif;max-width:390px;max-height:85vh;overflow:auto';panel.setAttribute('aria-label','延长隔离验收控制');
const label=document.createElement('strong');label.textContent='延长隔离验收 · 生产面板 · 无模型调用';panel.append(label);
const source=()=>app.getState().nodes.find(node=>node.id==='extension-source'),text=document.createElement('p'),output=document.createElement('pre');
text.textContent=['normal','delayed'].includes(fixture.mode)?'tasks-v1配置、任务回执与不同素材输出均为合成。检查取消、源参数保护、原任务结果与隔离IndexedDB保存；不能证明模型延长效果。保存故障仅注入显式save Promise拒绝，不证明真实磁盘故障。':'缺Key / Ark已配置＋本地视频：生成禁用；不产生任务或媒体准备。';panel.append(text);
const add=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(e=>{fixture.lastError=e.message;write();});panel.append(b);return b;};
add('打开生产视频延长',()=>{openExtend(source());write();});
if(fixture.mode==='delayed'){add('延迟下一次配置',()=>{fixture.armDelay=true;write();});add('释放迟到配置',()=>{fixture.release();write();});}
if(['normal','delayed'].includes(fixture.mode)){
 add('改变来源分辨率与声音',()=>{const n=source();n.generation.resolution='720p';n.generation.generateAudio=true;write();});
 add('恢复来源1080p无声',()=>{const n=source();n.generation.resolution='1080p';n.generation.generateAudio=false;write();});
 add('保留下一任务为运行中',()=>{fixture.holdResult=true;fixture.resultReady=false;write();});
 add('释放合成结果',()=>{fixture.releaseResult();write();});
 const createConnected=app.createConnected.bind(app);app.createConnected=(...args)=>{if(fixture.failApply){fixture.failApply=false;fixture.applyFailures++;throw Error('合成应用故障：插入节点前拒绝；不是IndexedDB保存失败');}return createConnected(...args);};
 add('下一次应用在插入前失败',()=>{fixture.failApply=true;write();});
 const save=window.CanvasStore.save.bind(window.CanvasStore);window.CanvasStore.save=(snapshot,id,options={})=>{if(options.beforeCommit){fixture.explicitSaves++;if(fixture.failSave){fixture.failSave=false;fixture.saveFailures++;return Promise.reject(Error('合成显式保存Promise拒绝；重试原任务，不再插入节点'));}}return save(snapshot,id,options);};
 add('下一次显式保存失败',()=>{fixture.failSave=true;write();});
 add('重试原任务应用结果',async()=>{const job=window.GenerationAPI.getJobs().findLast(j=>j.request.kind==='video.extend'&&j.applicationError);if(!job)throw Error('没有待重试的原任务应用');await window.GenerationAPI.retryApplication(job.id);write();});
}
panel.append(output);document.body.append(panel);
function write(){output.textContent=JSON.stringify({mode:fixture.mode,session:fixture.session,posts:fixture.posts,mediaPrepares:fixture.mediaPrepares,trimCalls:fixture.trimCalls,localMediaReads:fixture.localMediaReads,configCalls:fixture.configCalls,configResolved:fixture.configResolved,pendingConfigs:fixture.pendingConfigs,delayArmed:fixture.armDelay,holdResult:fixture.holdResult,resultReady:fixture.resultReady,taskGets:fixture.taskGets,applyFailures:fixture.applyFailures,saveFailures:fixture.saveFailures,explicitSaves:fixture.explicitSaves,blockedAPI:fixture.blockedAPI,blockedExternal:fixture.blockedExternal,databases:fixture.dbNames(),source:source()?.generation,jobs:window.GenerationAPI.getJobs().map(j=>({id:j.id,remoteTaskId:j.remoteTaskId,kind:j.request.kind,status:j.status,providerDispatched:j.providerDispatched,resolution:j.request.parameters?.resolution,generateAudio:j.request.parameters?.generateAudio,outputs:j.outputs?.length??0,applicationStatus:j.applicationStatus,applicationAttempts:j.applicationAttempts,resultIds:j.resultIds,applicationError:j.applicationError})),nodes:app.getState().nodes.length,lastError:fixture.lastError??null},null,2);}
window.GenerationAPI.subscribe(write);const timer=setInterval(write,250);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});write();
