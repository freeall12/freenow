const panel=document.createElement('aside');
panel.style.cssText='position:fixed;right:12px;bottom:12px;width:320px;max-height:35vh;overflow:auto;z-index:2200;background:#24282b;border:1px solid #666;padding:10px;color:#eee;font:12px system-ui';
const title=document.createElement('strong');title.textContent='画布菜单正式主壳 QA · 独立数据库 / 内存偏好 / 禁止生成';
const guide=document.createElement('p');guide.textContent='用左侧 + 打开菜单，悬停其他行后按方向键；Tab 离开、Escape、点击外部、切换窗口均应关闭。hover 视频后 Enter/Space 应创建视频；先聚焦空白画布再撤销/重做；空白双击菜单不应标记 + 展开。';
const output=document.createElement('output');output.style.cssText='display:block;white-space:pre-wrap;max-height:110px;overflow:auto;overflow-wrap:anywhere';output.setAttribute('aria-label','画布菜单诊断');panel.append(title,guide,output);document.body.append(panel);
function diagnostics(){
 const app=window.CanvasApp,menu=document.querySelector('.canvas-command-menu'),canvas=document.querySelector('#canvas'),focus=document.activeElement,rect=menu?.getBoundingClientRect();
 return {namespace:window.CanvasCommandMenuFixture.namespace,open:!!menu,mode:menu?.className,focus:focus?.dataset.nodeType||focus?.getAttribute('aria-label')||focus?.id||focus?.tagName,focusedRowVisible:menu?.contains(focus)?(()=>{const r=focus.getBoundingClientRect();return r.top>=rect.top&&r.bottom<=rect.bottom;})():null,selectedRow:menu?.querySelector('[aria-selected=true]')?.dataset.nodeType,addExpanded:document.querySelector('#add').getAttribute('aria-expanded'),canvasScroll:[canvas.scrollLeft,canvas.scrollTop],menuScroll:menu?.scrollTop,nodes:app?.getState().nodes.map(node=>({id:node.id,type:node.type,title:node.title})),history:app?.historyState(),externalAttempts:window.CanvasCommandMenuFixture.externalAttempts};
}
let previous='';const timer=setInterval(()=>{const value=JSON.stringify(diagnostics(),null,2);if(value!==previous){previous=value;output.textContent=value;}},200);
window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});window.CanvasCommandMenuQA={diagnostics};
