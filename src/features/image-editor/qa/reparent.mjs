import {artworkEntries} from '../group-objects.mjs';
const panel=document.createElement('section'),controls=document.createElement('div'),output=document.createElement('pre');
panel.style.cssText='position:fixed;z-index:11000;bottom:8px;left:8px;max-width:680px;background:#172129;color:#fff;padding:8px;font:12px system-ui;border:1px solid #71818b';
controls.style.cssText='display:flex;gap:5px;flex-wrap:wrap';output.style.cssText='max-height:135px;overflow:auto;margin:6px 0 0;white-space:pre-wrap';panel.append(controls,output);document.body.append(panel);
const nodeId='reparent-editor',api=()=>window.CanvasImageEditor.agent;
let current;const baseline=window.REPARENT_FIXTURE_MATRICES;
const report=(label,data)=>{output.textContent=label+'\n'+JSON.stringify(data,null,2);window.REPARENT_QA={label,...data};};
const execute=async(action,args={})=>{if(!current&&action!=='open')throw Error('先打开图片编辑器');current=await api().execute(action,{nodeId,...(current?{sessionId:current.sessionId,expectedRevision:current.revision}:{}),...args});return current;};
function diagnostics(label,extra={}){
  const editor=window.CanvasImageEditor.current,entries=artworkEntries(editor.canvas.getObjects());
  const matrices=Object.fromEntries(entries.filter(({object})=>object.type!=='group').map(({object})=>[object.id,object.calcTransformMatrix().slice()]));
  const maxMatrixError=Math.max(0,...Object.entries(matrices).flatMap(([id,matrix])=>matrix.map((value,i)=>Math.abs(value-(baseline[id]?.[i]??value)))));
  const node=window.CanvasApp.getState().nodes.find(node=>node.id===nodeId);
  report(label,{revision:current.revision,dirty:current.dirty,history:editor.history.past.length,maxMatrixError,worldNodePosition:[node.x,node.y],layers:current.layers.map(layer=>({id:layer.objectId,parent:layer.parentObjectId,index:layer.index})),...extra});
}
function button(label,run){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{for(const item of controls.children)item.disabled=true;try{await run();}catch(error){report('操作拒绝',{code:error.code,error:error.message});}finally{for(const item of controls.children)item.disabled=false;}};controls.append(b);}
button('打开 / 读取',async()=>{await execute('open');diagnostics('已打开真实 Fabric 文档');});
button('琥珀层 → 目标组',async()=>{const before=window.CanvasImageEditor.current?.history.past.length;await execute('reparent',{objectId:'amber',parentObjectId:'target-group',index:1});diagnostics('已跨组移动',{undoEntriesAdded:window.CanvasImageEditor.current.history.past.length-before});});
button('撤销',async()=>{await execute('undo');diagnostics('已撤销');});
button('重做',async()=>{await execute('redo');diagnostics('已重做');});
button('保存',async()=>{const result=await execute('save');diagnostics('生产保存完成',{saved:result.saved,currentMatches:result.currentMatches});});
button('关闭重开',async()=>{await execute('close');current=null;await execute('open');diagnostics('已从保存文档重开');});
button('隐藏诊断',()=>{output.hidden=!output.hidden;});
report('隔离画布已准备',{note:'打开→移动→撤销→重做→保存→关闭重开。使用现有生产编辑器与桥接，不调用模型；刷新同session可复验持久化。'});
