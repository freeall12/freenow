import {install} from './entry.mjs';
import {resources} from '../../../media-preview-core.mjs';

const url=new URL(location.href),prefix='qa-generation-history:'+encodeURIComponent(url.searchParams.get('session')||'manual')+':';
if(url.pathname!=='/qa/generation-history-app.html'||window.CANVAS_DB_NAME!==prefix+'canvas'||window.LOCAL_ASSETS_DB_NAME!==prefix+'assets')throw Error('来源夹具仅允许写入隔离的历史 QA 页面');
const app=window.CanvasApp,panel=document.createElement('aside'),report=document.createElement('pre');
panel.setAttribute('aria-label','高清历史来源隔离 QA');
panel.style.cssText='position:fixed;right:12px;top:70px;z-index:80;background:#222;color:#eee;padding:12px;width:320px;max-height:70vh;overflow:auto;font:12px system-ui';
const note=document.createElement('p');note.textContent='本地合成 PNG：1200×800 原图 / 300×200 缩图。未调用模型。刷新保持相同 session，使用左侧历史的预览与应用。';panel.append(note);
report.setAttribute('aria-label','高清历史来源检查器');report.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';
const kind='image.history-provenance-qa';let failure='';
async function activeHistory(){return install();}
async function currentRow(){return (await activeHistory()).list().find(row=>row.kind===kind);}
async function write(){
 const history=await activeHistory();await history.flush();const projectId=window.CanvasProjectContext.resolve().id;
 const saved=await window.CanvasStore.readRecord('agent-generation-history:'+projectId),rows=(saved?.rows||[]).filter(row=>row.kind===kind);
 const nodes=app.getState().nodes.filter(node=>rows.some(row=>row.taskId===node.generationHistory?.taskId));
 report.textContent=JSON.stringify({projectId,namespace:window.CANVAS_DB_NAME,modelCalls:0,error:failure,
  history:rows.map(row=>({id:row.id,model:row.model,requestModel:row.parameters.model,prompt:row.prompt,createdAt:row.createdAt,archiveStatus:row.archiveStatus,archiveError:row.archiveError,width:row.width,height:row.height,mediaRef:row.mediaRef})),
  nodes:nodes.map(node=>{const media=resources(node,node.generation)[0];return {id:node.id,width:node.pixelWidth,height:node.pixelHeight,nextModel:node.generation?.model,nextPrompt:node.generation?.prompt,sourceBound:node.provenance?.mediaSource===node.fullImage,previewModel:media?.model,previewPrompt:media?.prompt,previewCreatedAt:media?.createdAt};})},null,2);
}
function button(label,run){const node=document.createElement('button');node.type='button';node.textContent=label;node.style.cssText='margin:3px;padding:6px;background:#333;color:#eee;border:1px solid #777';node.onclick=async()=>{node.disabled=true;failure='';try{await run();}catch(error){failure=error.message;}finally{node.disabled=false;try{await write();}catch(error){report.textContent=error.message;}}};panel.append(node);}
function syntheticImage(){
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const context=canvas.getContext('2d');
 for(const [color,x,y]of [['#ca4638',0,0],['#dfbd40',600,0],['#3b7d65',0,400],['#345a89',600,400]]){context.fillStyle=color;context.fillRect(x,y,600,400);}
 context.strokeStyle='#111';context.lineWidth=8;context.strokeRect(40,40,1120,720);context.fillStyle='#fff';context.font='bold 74px sans-serif';context.fillText('LOCAL PNG 1200 × 800',90,390);context.font='40px sans-serif';context.fillText('Synthetic pixels · no AI model call',90,455);
 const thumbnail=document.createElement('canvas');thumbnail.width=300;thumbnail.height=200;thumbnail.getContext('2d').drawImage(canvas,0,0,300,200);
 return {type:'image',image:thumbnail.toDataURL('image/png'),url:thumbnail.toDataURL('image/png'),fullImage:canvas.toDataURL('image/png'),model:'QA 返回模型标记',title:'合成高清图片来源验收'};
}
button('保存合成高清历史',async()=>{
 if(await currentRow())return;
 const history=await activeHistory(),output=syntheticImage(),job={id:'qa-image-provenance-'+crypto.randomUUID(),status:'succeeded',createdAt:Date.now(),request:{kind,prompt:'本地合成四彩图案 · 1200×800 · 未调用模型',parameters:{model:'QA 请求模型标记'}},outputs:[output]};
 await history.captureSubmission(job);await history.observe(job);await history.flush();
 // Persist the actual active project as well as its history index before refresh.
 await window.CanvasStore.save(app.projectSnapshot(),window.CanvasProjectContext.resolve().id);await window.CanvasStore.flush();
});
button('读取持久历史与节点来源',write);
button('重试原图片归档',async()=>{
 const row=await currentRow();if(!row)throw Error('未找到原图片历史，请先保存合成高清历史');
 const history=await activeHistory();await history.retry(row.taskId);await history.flush();
});
button('修改已插入节点的下次参数',async()=>{
 const row=await currentRow();if(!row)throw Error('请先保存合成高清历史');
 const nodes=app.getState().nodes.filter(node=>node.generationHistory?.taskId===row.taskId);if(!nodes.length)throw Error('请先通过历史应用到画布');
 for(const node of nodes)app.updateNode(node.id,{generation:{...node.generation,model:'QA 下一次模型选择',prompt:'QA 下一次提示词草稿'}});
 window.NodeEditor?.invalidate();await window.CanvasStore.save(app.projectSnapshot(),window.CanvasProjectContext.resolve().id);await window.CanvasStore.flush();
});
panel.append(report);document.body.append(panel);report.textContent='请选择“保存合成高清历史”；刷新后使用“读取持久历史与节点来源”。';
