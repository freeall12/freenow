const fixture=window.CanvasLayoutFixture,app=()=>window.CanvasApp;
const panel=document.createElement('aside');panel.setAttribute('aria-label','生产画布布局验收');
panel.style.cssText='position:fixed;right:12px;top:12px;z-index:3000;width:350px;max-height:80vh;overflow:auto;background:#202523;color:#e5e9e7;padding:12px;font:12px/1.5 monospace;box-shadow:0 2px 12px #0006';
const heading=document.createElement('strong');heading.textContent='1000 级生产布局 / 撤销 QA';
const status=document.createElement('p'),output=document.createElement('pre');output.setAttribute('aria-label','布局动作与坐标诊断');output.style.whiteSpace='pre-wrap';
panel.append(heading,status);document.body.append(panel);
const geometry=state=>state.nodes.map(({id,x,y,width,height,parentId,memberIds})=>({id,x,y,width,height,parentId,memberIds}));
let lastBefore=null,lastAfter=null,ready=false;
const dimensions=()=>({width:document.querySelector('#canvas').clientWidth,height:document.querySelector('#canvas').clientHeight});
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function draw(extra={}){
  const state=app()?.getState();if(!state)return;
  const values=state.nodes.flatMap(node=>[node.x,node.y,node.width,node.height]);
  output.textContent=JSON.stringify({projectId:fixture.projectId,nodeCount:state.nodes.length,selectedCount:state.selected.length,finiteCoordinates:values.every(Number.isFinite),view:state.view,viewport:dimensions(),head:geometry(state).slice(0,3),tail:geometry(state).slice(-2),externalAttempts:fixture.externalAttempts,events:fixture.events.slice(-8),...extra},null,2);
}
function button(label,run){
  const element=document.createElement('button');element.textContent=label;element.style.cssText='margin:3px;padding:5px';element.disabled=true;
  element.onclick=async()=>{element.disabled=true;try{if(!ready)throw Error('生产画布尚未就绪');await run();status.textContent='动作完成；下方为实时坐标与耗时';}catch(error){status.textContent=error.message;fixture.events.push({action:label,error:error.message});}finally{element.disabled=!ready;draw();}};
  panel.append(element);return element;
}
const select=()=>app().selectMany(app().getState().nodes.map(node=>node.id));
const buttons=[];
buttons.push(button('全选全部 QA 节点',async()=>{const start=performance.now();select();fixture.events.push({action:'select',syncMs:Number((performance.now()-start).toFixed(2))});await paint();}));
buttons.push(button('宫格布局并核对坐标',async()=>{
  select();lastBefore=structuredClone(app().getState());const start=performance.now(),result=app().layoutNodes('grid');const syncMs=performance.now()-start;
  await paint();const paintMs=performance.now()-start;lastAfter=structuredClone(app().getState());
  const nodes=lastBefore.nodes,origin={x:Math.min(...nodes.map(node=>node.x)),y:Math.min(...nodes.map(node=>node.y))},rows=Math.ceil(Math.sqrt(nodes.length)),columns=Math.ceil(nodes.length/rows),width=Math.max(...nodes.map(node=>node.width)),height=Math.max(...nodes.map(node=>node.height));
  const errors=lastAfter.nodes.map((node,index)=>Math.max(Math.abs(node.x-(origin.x+(index%columns)*(width+200)+(width-node.width)/2)),Math.abs(node.y-(origin.y+Math.floor(index/columns)*(height+200)+(height-node.height)/2))));
  fixture.events.push({action:'grid',syncMs:Number(syncMs.toFixed(2)),twoPaintFramesMs:Number(paintMs.toFixed(2)),count:result.ids.length,maxCoordinateError:Math.max(...errors),viewUnchanged:JSON.stringify(lastBefore.view)===JSON.stringify(lastAfter.view)});
}));
buttons.push(button('单次撤销核对原坐标',async()=>{
  if(!lastBefore)throw Error('请先运行一次宫格布局');const start=performance.now();app().undo();await paint();
  const exact=JSON.stringify(geometry(app().getState()))===JSON.stringify(geometry(lastBefore));fixture.events.push({action:'undo',exactOriginalCoordinates:exact,twoPaintFramesMs:Number((performance.now()-start).toFixed(2))});if(!exact)throw Error('撤销后坐标与原快照不一致');
}));
buttons.push(button('重做核对布局坐标',async()=>{
  if(!lastAfter)throw Error('请先运行布局并撤销');const start=performance.now();app().undo(true);await paint();
  const exact=JSON.stringify(geometry(app().getState()))===JSON.stringify(geometry(lastAfter));fixture.events.push({action:'redo',exactLayoutCoordinates:exact,twoPaintFramesMs:Number((performance.now()-start).toFixed(2))});if(!exact)throw Error('重做后坐标与布局快照不一致');
}));
buttons.push(button('保存并回读生产 CanvasStore',async()=>{
  await app().saveProject();const saved=await window.CanvasStore.load(fixture.projectId),exact=JSON.stringify(geometry(saved))===JSON.stringify(geometry(app().getState()));fixture.events.push({action:'save-readback',storageRevision:saved.storageRevision,exactSavedCoordinates:exact});if(!exact)throw Error('保存后回读坐标不一致');
}));
buttons.push(button('刷新当前隔离画布',async()=>{await app().saveProject();location.reload();}));
buttons.push(button('打开新的隔离 session',async()=>{const url=new URL(location.href);url.searchParams.set('session','layout-'+Date.now());url.searchParams.delete('project');location.href=url;}));
panel.append(output);
for(let attempt=0;attempt<200;attempt++){
  if(app()?.getState().nodes.length===fixture.count){try{await app().saveProject();ready=true;break;}catch{}}
  await new Promise(resolve=>setTimeout(resolve,50));
}
status.textContent=ready?'生产画布与隔离 IndexedDB 已就绪':'生产画布读取失败；请查看存储提示';for(const element of buttons)element.disabled=!ready;draw();
