const fixture=window.CanvasContextMenuFixture,app=()=>window.CanvasApp;
let ready=false,baseline=null,frame=0,lastAction='ready';
const snapshot=()=>JSON.stringify({nodes:app().getState().nodes,edges:app().getState().edges,view:app().getState().view});
function report(){
  const menu=document.querySelector('#menu'),active=document.activeElement,rect=menu.getBoundingClientRect(),item=menu.contains(active)?active.getBoundingClientRect():null;
  const open=window.CanvasMenus&&menu.dataset.replicaPhase!=='closed'&&menu.dataset.replicaPhase!=='closing'&&!menu.hidden;
  parent.postMessage({type:'canvas-context-menu-qa',report:{ready,lastAction,viewport:{width:innerWidth,height:innerHeight},menuOpen:!!open,scrollTop:menu.scrollTop,activeLabel:active?.textContent?.trim()||active?.getAttribute('aria-label')||active?.id,focusedRowVisible:!!item&&item.top>=rect.top-1&&item.bottom<=rect.bottom+1,menuFitsViewport:rect.left>=7&&rect.top>=7&&rect.right<=innerWidth-7&&rect.bottom<=innerHeight-7,graphAndViewUnchanged:baseline===snapshot(),canvasScroll:{left:document.querySelector('#canvas').scrollLeft,top:document.querySelector('#canvas').scrollTop},blockedAPIs:fixture.blockedAPIs,externalAttempts:fixture.externalAttempts}},location.origin);
}
function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;if(ready)report();});}
fixture.openLongMenu=()=>{if(!ready)return;lastAction='公开长中文菜单';window.CanvasMenus.show(innerWidth-20,innerHeight-20,Array.from({length:12},(_,i)=>({label:'公开长中文菜单项 '+(i+1)+'：检查完整键盘焦点与视口内部滚动',...i===10?{}:{run:()=>app().notify('仅执行公开QA菜单动作')}})));schedule();};
for(const type of ['contextmenu','keydown','pointerup','focusin'])window.addEventListener(type,event=>{lastAction=type+(event.key?':'+event.key:'');schedule();},true);
window.addEventListener('scroll',event=>{if(event.target.id==='menu'){lastAction='menu-scroll';schedule();}},true);
window.addEventListener('resize',()=>{lastAction='resize';schedule();});
new MutationObserver(records=>{if(records.some(record=>record.target.id==='menu'))schedule();}).observe(document.body,{attributes:true,childList:true,subtree:true,attributeFilter:['data-replica-phase','hidden']});
for(let attempt=0;attempt<200;attempt++){
  if(window.CanvasMenus&&app()?.getState().nodes.some(node=>node.id==='qa-context-image')){try{await app().saveProject();ready=true;baseline=snapshot();break;}catch{}}
  await new Promise(resolve=>setTimeout(resolve,50));
}
fixture.report=report;report();
