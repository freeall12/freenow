const panel=document.createElement('section'),controls=document.createElement('div'),output=document.createElement('pre');
panel.style.cssText='position:fixed;z-index:11000;bottom:8px;left:8px;max-width:760px;background:#172129;color:#fff;padding:8px;font:12px system-ui;border:1px solid #71818b';
controls.style.cssText='display:flex;gap:5px;flex-wrap:wrap';output.style.cssText='max-height:112px;overflow:auto;margin:6px 0 0;white-space:pre-wrap';panel.append(controls,output);document.body.append(panel);
const observed=new WeakSet();
let editor,dragBaseline,exportRunning=false,lastExport=null,lastMove=null,lastDrag=null;
const report=(label)=>{
 const node=window.CanvasApp.getState().nodes.find(n=>n.id==='alignment-editor'),target=editor?.canvas.getObjects().find(o=>o.id==='snap-target'),board=editor?.root.querySelector('.ie-artboard'),rect=board?.getBoundingClientRect();
 const snapshot={label,zoom:editor?.zoom,pan:editor?.pan,worldNode:[node.x,node.y],history:editor?.history.past.length,object:target?{left:target.left,top:target.top,angle:target.angle,scaleX:target.scaleX,scaleY:target.scaleY}:null,artboardScreen:rect?{left:rect.left,top:rect.top,width:rect.width,height:rect.height}:null,guides:editor?.root.querySelectorAll('[data-alignment-guide]').length,lastMove,lastDrag,lastExport};
 output.textContent=JSON.stringify(snapshot,null,2);window.ALIGNMENT_QA=snapshot;
};
async function exportCheck(){
 if(exportRunning)return;exportRunning=true;
 try{
  const guidesAtSnapshot=editor.root.querySelectorAll('[data-alignment-guide]').length,doc=editor.document(),raster=await editor.renderExport(1),pixels=raster.getContext('2d').getImageData(0,0,raster.width,raster.height).data;
  let bluePixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]>pixels[i]+30)bluePixels++;
  const blob=await new Promise(resolve=>raster.toBlob(resolve,'image/png')),bitmap=await createImageBitmap(blob);lastExport={guidesAtSnapshot,documentObjects:doc.canvas.objects.map(o=>o.id),bluePixels,pngBytes:blob.size,decoded:[bitmap.width,bitmap.height]};bitmap.close();report('真实 PNG 已解码，辅助线不进入图层或输出');
 }finally{exportRunning=false;}
}
function observe(){
 if(observed.has(editor))return;observed.add(editor);
 editor.canvas.on('mouse:down',()=>{dragBaseline=editor.history.past.length;lastExport=null;});
 editor.canvas.on('object:moving',({target})=>{
  lastMove={left:target.left,top:target.top,guides:[...editor.root.querySelectorAll('[data-alignment-guide]')].map(n=>n.dataset.alignmentGuide)};
  if(lastMove.guides.length&&!lastExport&&!exportRunning)exportCheck().catch(error=>{lastExport={error:error.message};report('导出检查失败');});
  report('正在真实 Fabric 拖动');
 });
 editor.canvas.on('mouse:up',()=>{lastDrag={historyAdded:editor.history.past.length-dragBaseline,guidesAfterRelease:editor.root.querySelectorAll('[data-alignment-guide]').length};report('拖动结束');});
}
function button(label,run){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{try{await run();}catch(error){output.textContent=error.message;}};controls.append(b);}
button('打开编辑器',async()=>{const node=window.CanvasApp.getState().nodes.find(n=>n.id==='alignment-editor');editor=window.CanvasImageEditor.open(node);await editor.ready;observe();report('拖动琥珀色对象到画板边缘/中心');});
button('重置隔离图层',async()=>{await editor.restore(structuredClone(window.ALIGNMENT_DOC));editor.record();lastMove=lastDrag=lastExport=null;report('重置完成');});
button('缩放至 0.5',()=>{editor.zoom=.5;editor.pan={x:0,y:0};editor.place();report('0.5 倍：10逻辑像素对应5屏幕像素');});
button('缩放至 1.0',()=>{editor.zoom=1;editor.pan={x:0,y:0};editor.place();report('1倍：10逻辑像素对应10屏幕像素');});
button('读取诊断',()=>report('当前生产编辑器状态'));
button('导出 PNG 检查',exportCheck);
button('保存',async()=>{await editor.save();report('已走生产保存流程');});
button('收起诊断',()=>{output.hidden=!output.hidden;});
output.textContent='独立 QA 存储。打开后用真实鼠标拖动琥珀对象；命中辅助线时自动生成并解码实际 PNG，记录最后一次拖动历史数和世界坐标。';
