const app=window.CanvasApp,fixture=window.AgentSegmentationFixture;
if(!fixture?.ready)throw Error('Agent SAM2 storage isolation did not initialize.');
const panel=document.createElement('aside');panel.setAttribute('aria-label','Agent SAM2 原生隔离验收');panel.style.cssText='position:fixed;left:12px;top:70px;z-index:2100;display:flex;flex-direction:column;gap:5px;width:220px;max-height:calc(100dvh - 85px);overflow:auto;background:#171717;border:1px solid #555;color:#eee;padding:10px;font:12px sans-serif';panel.onpointerdown=event=>event.stopPropagation();
const title=document.createElement('strong');title.textContent='Agent真实审批 / 保存 / SAM2任务；LLM及云端为固定fixture';panel.append(title);
const output=document.createElement('pre');output.style.cssText='max-height:32vh;overflow:auto;font-size:10px';panel.append(output);
const node=()=>app.getState().nodes.find(node=>node.id==='agent-segmentation-source');
const receipt=()=>{try{return JSON.parse(localStorage.getItem('freenow:video-segmentation:v1:'+encodeURIComponent(app.projectIdentity().id)+':agent-segmentation-source')||'null');}catch{return null;}};
const action=(label,fn)=>{const button=document.createElement('button');button.textContent=label;button.onclick=()=>Promise.resolve().then(fn).catch(error=>{fixture.errors.push({control:label,error:error.message});write();});panel.append(button);return button;};
const save=window.CanvasStore.save.bind(window.CanvasStore);window.CanvasStore.save=(snapshot,...args)=>{if(fixture.failSave&&snapshot?.nodes?.some(node=>node.videoMask?.taskId))return Promise.reject(Error('QA full-mask canvas save failure; retry same asset.'));return save(snapshot,...args);};
const put=window.LocalAssets.put.bind(window.LocalAssets);window.LocalAssets.put=async(blob,...args)=>{const asset=await put(blob,...args);if(blob.type==='application/json')fixture.assetPuts.push({asset,bytes:blob.size});return asset;};
const ready=(async()=>{for(let attempt=0;;attempt++)try{await app.saveProject();break;}catch(error){if(attempt>=99||!error.message.includes('尚未成功读取'))throw error;await new Promise(resolve=>setTimeout(resolve,20));}window.AgentUI.open();document.querySelector('#reset').click();})();
async function prepare(tool){
 if(fixture.sendState==='preparing')throw Error('QA正在准备输入，请等待。');fixture.sendState='preparing';write();
 try{
  await ready;const taskId=receipt()?.taskId;if(tool!=='video_segment_target'&&!taskId)throw Error('No original UUID; create/approve the first recognition first.');
  const result=await fetch('/qa/agent-segmentation-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,...taskId?{taskId}:{}})});if(!result.ok)throw Error('Fixed LLM plan rejected.');
  window.AgentUI.open();const input=document.querySelector('.agent-input[contenteditable="true"],.agent-input [contenteditable="true"]');if(!input)throw Error('Actual Agent composer is not ready.');
  input.focus();document.execCommand('selectAll');document.execCommand('insertText',false,tool==='video_segment_target'?'请识别源视频2.5秒的移动矩形，源像素矩形120/60/40/50，只保存完整蒙层。':`请执行 ${tool} 查询/处理原 UUID ${taskId}，不得新建识别任务。`);
  for(let i=0;i<100;i++){const send=document.querySelector('.agent-send[aria-label="发送"]');if(send&&!send.disabled){fixture.sendState='prepared: 点击右侧正式发送一次';write();return;}await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error('生产发送按钮尚未可用；没有自动发送，请检查输入和队列。');
 }catch(error){fixture.sendState='prepare_failed';throw error;}
}
action('准备首次识别（再点正式发送）',()=>prepare('video_segment_target'));
action('准备查询原UUID',()=>prepare('video_segmentation_recover'));
action('准备显式续发原UUID',()=>prepare('video_segmentation_resume'));
action('准备重存同一asset',()=>prepare('video_segmentation_retry_save'));
action('准备取消原UUID',()=>prepare('video_segmentation_cancel'));
action('切换画布保存失败',()=>{fixture.failSave=!fixture.failSave;write();});
action('切换auto / ask（仍需SAM2确认）',()=>{const auto=localStorage.getItem('tapnow-agent-confirm-mode')==='auto';localStorage.setItem('tapnow-agent-confirm-mode',auto?'ask':'auto');write();});
action('改变来源clip（审批漂移）',()=>{app.updateNode(node().id,{clip:{start:2,end:4}});write();});
action('撤销clip修改',()=>app.undo());
for(const mode of ['success','delay','unknown-receipt','needs-resume'])action('供应商fixture：'+mode,async()=>{await fetch('/qa/sam2-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});});
action('重启native同store',async()=>{await fetch('/qa/sam2-restart',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});});
action('查看只读后端审计',async()=>{fixture.serverAudit=await(await fetch('/qa/agent-segmentation-audit')).json();write();});
action('同session刷新',()=>location.reload());document.body.append(panel);
function write(){const value=receipt();output.textContent=JSON.stringify({sendState:fixture.sendState,agentTurnPosts:fixture.agentTurnPosts,projectId:app.projectIdentity().id,confirmMode:localStorage.getItem('tapnow-agent-confirm-mode'),clip:node()?.clip,source:{video:node()?.video,image:node()?.image,poster:node()?.poster,imported:fixture.sourceAsset},sourceReads:fixture.sourceReads,dispatches:fixture.dispatches,failSave:fixture.failSave,receipt:value?{taskId:value.taskId,status:value.status,dispatched:value.dispatched,maskAsset:value.maskAsset}:null,mask:node()?.videoMask,assetPuts:fixture.assetPuts,backendCounts:fixture.serverAudit?.supplier?.counts,errors:fixture.errors},null,2);}
const timer=setInterval(write,400);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});write();await ready;
