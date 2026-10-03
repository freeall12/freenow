import {classes as c} from '../classes.mjs';
import {exportGlb,disposeModel} from '../model-io.mjs';
import {createScenePanelModel} from './scene-panel-model.mjs';

const fixture=window.StudioScenePanelFixture,panel=document.createElement('aside'),heading=document.createElement('h2'),instructions=document.createElement('p'),buttons=document.createElement('div'),output=document.createElement('pre');
panel.ariaLabel='片场目录与分页 QA';panel.style.cssText='position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:3000;background:#202226;color:#eee;padding:12px;width:360px;max-height:48vh;overflow:auto;font:12px system-ui;border:1px solid #666';heading.textContent='合成大场景 · 正式片场面板';instructions.textContent='准备后保留正式 WebGL 场景与控件。目录包装只记录真实调用，不改返回值。拍摄刷新应有一次面板目录调用。展开模型组后点正式“显示更多”：50→100→150→151；焦点自动报告。耗时仅目录元数据和同步控件动作，不是 FPS。';output.ariaLabel='真实目录调用和 DOM 焦点诊断';output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';panel.append(heading,instructions,buttons,output);document.body.append(panel);
const active=()=>window.StudioAPI?.active?.runtime;
let nodeId=null,prepared=false,assetBytes=null,error='',lastAction=null,lastPanelFocus=null,observer=null;
const counts={allCalls:0,panelCalls:0,allCatalogMs:0,panelCatalogMs:0};
const section=()=>document.querySelector('.studio-v2-root section[aria-label="片场设置"]');
function focusData(element){return element?{tag:element.tagName,label:element.getAttribute('aria-label')||element.textContent?.trim().slice(0,70)||'',className:element.className,objectId:element.dataset.objectId||null,parentId:element.dataset.parentId||null,expanded:element.getAttribute('aria-expanded')}:null;}
function read(){
  const runtime=active(),setting=section(),focused=document.activeElement;
  if(setting?.contains(focused)||focused===runtime?.renderer.domElement)lastPanelFocus=focusData(focused);
  return {namespace:fixture.namespace,synthetic:true,prepared,nodeId,assetBytes,loadStatus:runtime?.loadStatus,catalog:{...counts},lastAction,dom:{shotRows:setting?.querySelectorAll('.'+c.shotRow).length||0,motionRows:setting?.querySelectorAll('.'+c.clipRow).length||0,modelRows:setting?.querySelectorAll('.'+c.treeSelect+'[data-parent-id="qa-panel-models"]').length||0,modelMore:!!setting?.querySelector('.'+c.moreObjects+'[data-parent-id="qa-panel-models"]'),modelExpanded:setting?.querySelector('.'+c.treeExpand+'[data-object-id="qa-panel-models"]')?.getAttribute('aria-expanded')},activeElement:focusData(focused),lastPanelFocus,shotId:runtime?.shotId,motionIndex:runtime?.motionIndex,selectedId:runtime?.selected?.userData.studioId||null,externalAttempts:fixture.externalAttempts,blockedAPIs:fixture.blockedAPIs,error};
}
function refresh(){output.textContent=JSON.stringify(read(),null,2);}
function reset(){Object.assign(counts,{allCalls:0,panelCalls:0,allCatalogMs:0,panelCatalogMs:0});}
function button(label,action){const button=document.createElement('button');button.textContent=label;button.style.cssText='margin:3px;padding:5px';button.onclick=async()=>{button.disabled=true;error='';try{await action();}catch(cause){error=cause.message;}finally{button.disabled=false;refresh();}};buttons.append(button);return button;}
function instrument(runtime){
  if(runtime.scenePanelQAInstrumented)return;
  const original=runtime.playback.catalog.bind(runtime.playback);
  runtime.playback.catalog=()=>{
    const fromPanel=new Error().stack?.includes('/scene-panel.mjs:'),start=performance.now();counts.allCalls++;if(fromPanel)counts.panelCalls++;
    try{return original();}finally{const duration=performance.now()-start;counts.allCatalogMs+=duration;if(fromPanel)counts.panelCatalogMs+=duration;}
  };runtime.scenePanelQAInstrumented=true;
  observer?.disconnect();observer=new MutationObserver(()=>refresh());observer.observe(runtime.renderer.domElement.closest('.studio-v2-root'),{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed','aria-expanded']});
}
function formalTab(label){const tab=[...(section()?.querySelectorAll('button.'+c.panelTab)||[])].find(button=>button.textContent===label);if(!tab)throw Error('请先准备真实片场');tab.click();}
function formalAction(label,selector){const target=section()?.querySelector(selector);if(!target)throw Error('没有找到正式控件：'+label);const start=performance.now();target.focus({preventScroll:true});target.click();lastAction={label,scope:'正式控件同步 click；不含 GPU 帧或异步保存',synchronousMs:performance.now()-start};}
button('准备并打开真实大场景',async()=>{
  const app=window.CanvasApp;await app.saveProject();let node=app.getState().nodes.find(node=>node.id===nodeId)||app.getState().nodes.find(node=>node.title==='QA 目录与分页布景');
  if(!node){const model=createScenePanelModel();let blob;try{blob=await exportGlb(model.scene,model.animations);}finally{disposeModel(model.scene);}assetBytes=blob.size;const asset=await window.LocalAssets.put(blob);node=app.addNode('studio',{x:480,y:180},null,'QA 目录与分页布景',{studioV2:{version:2,asset,shotId:'qa-panel-camera-0',motionIndex:-1,grid:true}});await app.saveProject();}
  nodeId=node.id;await window.StudioAPI.open(node.id);const runtime=active();if(!runtime||runtime.loadStatus!=='ready')throw Error('公开 StudioAPI.active 未加载真实片场');instrument(runtime);prepared=true;reset();
});
button('测一次正式拍摄页刷新',()=>{reset();const start=performance.now();formalTab('拍摄');lastAction={label:'正式拍摄页刷新',scope:'正式 tab 同步 click；不含 GPU 帧',synchronousMs:performance.now()-start};});
button('打开正式场景页',()=>formalTab('场景'));
button('展开/收起正式模型组',()=>formalAction('模型组展开/收起','.'+c.treeExpand+'[data-object-id="qa-panel-models"]'));
button('正式模型组显示更多一次',()=>formalAction('模型组显示更多','.'+c.moreObjects+'[data-parent-id="qa-panel-models"]'));
button('选择正式镜头120',()=>formalAction('选择镜头120','.'+c.shotRow+'[aria-label="选择镜头 QA 镜头 120 · 1 段运镜"]'));
button('重置目录计数',reset);button('刷新可见诊断',refresh);
button('收起QA检查器',()=>{for(const node of [heading,instructions,buttons,output])node.hidden=true;show.hidden=false;panel.style.width='auto';});
const show=document.createElement('button');show.textContent='展开目录QA';show.hidden=true;show.onclick=()=>{for(const node of [heading,instructions,buttons,output])node.hidden=false;show.hidden=true;panel.style.width='360px';refresh();};panel.append(show);
document.addEventListener('focusin',event=>{if(event.target.closest('.studio-v2-root'))queueMicrotask(refresh);});
document.addEventListener('click',event=>{if(event.target.closest('.studio-v2-root'))queueMicrotask(refresh);});
window.StudioScenePanelQA={refresh,read};window.addEventListener('pagehide',()=>observer?.disconnect(),{once:true});refresh();
