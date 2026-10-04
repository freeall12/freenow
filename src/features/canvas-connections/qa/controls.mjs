import {isFinalNode} from '../../video-generation/draft-final.mjs';

const fixture=window.CanvasFinalDropFixture,app=()=>window.CanvasApp;
const panel=document.createElement('aside');panel.setAttribute('aria-label','正式片连线落点验收');
panel.style.cssText='position:fixed;left:100px;top:70px;z-index:3000;width:760px;max-width:calc(100vw - 130px);max-height:160px;overflow:auto;background:#202523;color:#e5e9e7;padding:10px;font:12px/1.4 monospace';
const heading=document.createElement('strong');heading.textContent='生产连线手势 QA · 本地视频夹具，不派发生成';
const instruction=document.createElement('p'),output=document.createElement('pre');output.setAttribute('aria-label','连线落点诊断');output.style.whiteSpace='pre-wrap';
instruction.textContent=fixture.mode==='reverse'?'从右侧正式片的左加号拖到左侧图片主体。其余用例从左侧节点右加号拖到右侧主体；Escape用例拖动中按Esc再松开。':fixture.mode==='escape'?'从左侧图片右加号开始拖动，中途按Esc，再在右侧正式片上松开鼠标。':'从左侧节点右加号拖到右侧节点主体。普通节点应保留菜单；合法样片应新增draft-reference边；其余不弹菜单、不修改图。';
panel.append(heading,instruction);document.body.append(panel);
const graph=()=>JSON.stringify({nodes:app().getState().nodes,edges:app().getState().edges});
let baseline=null,ready=false,gestureStart=null;
function report(){
  const state=app()?.getState();if(!state)return;
  output.textContent=JSON.stringify({ready,case:fixture.mode,graphUnchanged:baseline===graph(),finalNodeIds:state.nodes.filter(isFinalNode).map(node=>node.id),edges:state.edges.map(({id,source,target,purpose})=>({id,source,target,purpose})),menuOpen:!!document.querySelector('.connection-menu'),preview:!!document.querySelector('.connection-preview'),gestureActive:document.querySelector('#canvas').dataset.connectionActive||false,lastGestureUnchanged:fixture.events.at(-1)?.unchanged,events:fixture.events,blockedAPIs:fixture.blockedAPIs,externalAttempts:fixture.externalAttempts});
}
for(const [mode,label]of [['invalid','无效正式片'],['reverse','反向无效正式片'],['ordinary','普通不兼容'],['compatible','合法样片'],['occupied','已占用正式片'],['escape','Escape取消']]){
  const button=document.createElement('button');button.textContent=label;button.onclick=()=>{const url=new URL(location.href);url.searchParams.set('case',mode);url.searchParams.set('session',fixture.session+'-'+Date.now());url.searchParams.delete('project');location.href=url;};panel.append(button);
}
const read=document.createElement('button');read.textContent='读取状态';read.onclick=report;panel.append(read,output);
// Observe before production document/canvas handlers consume the owned gesture.
window.addEventListener('pointerdown',event=>{if(ready&&event.target.closest('.connection-port'))gestureStart=graph();},true);
window.addEventListener('pointerup',event=>{if(gestureStart===null)return;const before=gestureStart;gestureStart=null;setTimeout(()=>{fixture.events.push({action:'pointerup',unchanged:before===graph(),menuOpen:!!document.querySelector('.connection-menu')});report();},50);},true);
window.addEventListener('keydown',event=>{if(event.key==='Escape')setTimeout(report,50);},true);
// Menu state must be readable while open: clicking a QA button is an outside
// pointer and correctly dismisses the production menu before its click handler.
new MutationObserver(records=>{
  if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.matches('.connection-menu')||node.querySelector('.connection-menu')))))report();
}).observe(document.body,{childList:true,subtree:true});
for(let attempt=0;attempt<200;attempt++){
  if(window.CanvasConnections&&app()?.getState().nodes.some(node=>node.id==='qa-drop-target')){
    try{await app().saveProject();ready=true;baseline=graph();break;}catch{}
  }
  await new Promise(resolve=>setTimeout(resolve,50));
}
if(!ready)instruction.textContent='生产画布尚未就绪，请查看存储提示。';
fixture.report=report;report();
