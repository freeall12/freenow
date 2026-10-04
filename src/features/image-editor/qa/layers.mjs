const panel=document.createElement('section'),controls=document.createElement('div'),output=document.createElement('pre');
panel.style.cssText='position:fixed;z-index:11000;bottom:8px;left:8px;max-width:800px;background:#172129;color:#fff;padding:8px;font:12px system-ui;border:1px solid #71818b';
controls.style.cssText='display:flex;gap:5px;flex-wrap:wrap';output.style.cssText='max-height:115px;overflow:auto;margin:6px 0 0;white-space:pre-wrap';panel.append(controls,output);document.body.append(panel);
let editor,lastExport=null,lastRecord=null;const observed=new WeakSet();
function report(label){
 const node=window.CanvasApp.getState().nodes.find(n=>n.id==='layer-menu-editor');
 const data={label,worldNode:[node.x,node.y],history:editor?.history.past.length,revision:editor?.revision,lastRecord,bottomToTop:editor?.canvas.getObjects().map(o=>({id:o.id,name:o.name,fill:o.fill,left:o.left,top:o.top})),selected:editor?.canvas.getActiveObjects().map(o=>o.id),menu:editor?.popup?{width:editor.popup.offsetWidth,items:[...editor.popup.querySelectorAll('button')].map(b=>({label:b.textContent,disabled:b.disabled}))}:null,lastExport};
 output.textContent=JSON.stringify(data,null,2);window.LAYER_MENU_QA=data;
}
async function verifyPNG(){
 const raster=await editor.renderExport(1),blob=await new Promise(resolve=>raster.toBlob(resolve,'image/png')),decoded=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=decoded.width;canvas.height=decoded.height;const context=canvas.getContext('2d');context.drawImage(decoded,0,0);lastExport={pngBytes:blob.size,decoded:[decoded.width,decoded.height],centerPixel:[...context.getImageData(300,300,1,1).data],documentObjects:editor.document().canvas.objects.map(o=>o.id)};decoded.close();report('生产 PNG 字节解码完成');
}
function button(label,run){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{try{await run();}catch(error){output.textContent=error.message;}};controls.append(b);}
button('打开编辑器',async()=>{
 editor=window.CanvasImageEditor.open(window.CanvasApp.getState().nodes.find(n=>n.id==='layer-menu-editor'));await editor.ready;
 if(!observed.has(editor)){observed.add(editor);const record=editor.record.bind(editor);editor.record=()=>{const before=editor.history.past.length;record();lastRecord={historyAdded:editor.history.past.length-before};report('生产图层操作已记录');};}
 report('右键左侧图层缩略图；Shift+F10 可打开键盘菜单');
});
button('读取诊断',()=>report('当前菜单/层序/文档'));
button('导出 PNG 检查层序',verifyPNG);
button('延迟下一次琥珀复制',()=>{
 const target=editor.canvas.getObjects().find(o=>o.id==='amber'),clone=target.clone.bind(target);target.clone=async(...args)=>{target.clone=clone;await new Promise(resolve=>setTimeout(resolve,2000));return clone(...args);};report('下一次琥珀复制延迟2秒；期间可替换文档');
});
button('替换隔离文档',async()=>{const doc=structuredClone(window.LAYER_MENU_DOC);doc.canvas.objects[0].left+=100;await editor.restore(doc);editor.record();report('文档已替换，迟到副本必须拒绝');});
button('保存',async()=>{await editor.save();report('已走生产保存流程');});
button('收起诊断',()=>{output.hidden=!output.hidden;});
output.textContent='独立存储。顶部绿色→下移一层→中心 PNG 应蓝色；复制琥珀底层→中心 PNG 应琥珀色。操作上移/下移/复制/删除分别只有1笔历史。';
