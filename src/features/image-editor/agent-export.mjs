// Export through the editor's existing encoders, using detached immutable input.
// A download receipt acknowledges a browser request, never a file saved to disk.
const fail=(code,message)=>Object.assign(new Error(message),{code});
const checkSignal=signal=>{if(signal?.aborted)throw fail('cancelled','图片导出已取消');};
const sourceStamp=node=>JSON.stringify([node?.editorDoc,node?.image,node?.fullImage]);
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}
function request(input){
  for(const key of ['operationId','nodeId','sessionId'])if(typeof input?.[key]!=='string'||!input[key].trim()||input[key].length>180)throw fail('invalid_argument',`${key} 无效`);
  if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0||!['png','jpeg','psd'].includes(input.format)||typeof input.scale!=='number'||!Number.isFinite(input.scale)||input.scale<1||input.scale>4)throw fail('invalid_argument','导出格式、比例或版本无效');
  return Object.fromEntries(['operationId','nodeId','sessionId','expectedRevision','format','scale'].map(key=>[key,input[key]]));
}
async function validateBlob(blob,format,width,height){
  const mime={png:'image/png',jpeg:'image/jpeg',psd:'image/vnd.adobe.photoshop'}[format];
  if(!(blob instanceof Blob)||!blob.size||blob.type!==mime)throw fail('invalid_export','导出媒体格式与请求不一致');
  const bytes=new Uint8Array(await blob.slice(0,32).arrayBuffer()),view=new DataView(bytes.buffer);
  const starts=values=>values.every((value,index)=>bytes[index]===value);
  if(format==='png'){
    if(bytes.length<24||!starts([137,80,78,71,13,10,26,10])||String.fromCharCode(...bytes.slice(12,16))!=='IHDR'||view.getUint32(16)!==width||view.getUint32(20)!==height)throw fail('invalid_export','PNG 文件标识或尺寸与导出不一致');
  }else if(format==='jpeg'){
    if(bytes.length<3||!starts([255,216,255]))throw fail('invalid_export','JPG 文件标识与导出不一致');
  }else if(bytes.length<26||!starts([56,66,80,83,0,1])||view.getUint32(14)!==height||view.getUint32(18)!==width)throw fail('invalid_export','PSD 文件标识或尺寸与导出不一致');
}
function idle(editor){
  if(editor.loading||editor.saving||editor.crop||editor.drawing||editor.penPoints?.length||editor.canvas?.getActiveObject?.()?.isEditing||editor.pendingObjects?.size||editor.canvas?._currentTransform||editor.resizing)throw fail('editor_busy','编辑器正在加载、拖动、裁剪或编辑，请完成当前操作');
}
export function createImageEditorExporter({getCurrent,app,download=(blob,filename)=>globalThis.LocalMedia.download(blob,filename)}={}){
  const operations=new Map();
  const nodeFor=id=>app.getState().nodes.find(node=>node.id===id);
  function capture(args,signal){
    checkSignal(signal);
    const editor=getCurrent();if(!editor?.alive||editor.nodeId!==args.nodeId)throw fail('editor_not_open','请先打开指定图片编辑器');
    idle(editor);
    if(editor.sessionId!==args.sessionId||editor.revision!==args.expectedRevision)throw fail('revision_conflict','编辑器会话或版本已变化，请重新读取');
    const source=nodeFor(args.nodeId),stamp=sourceStamp(source);
    if(!source||source!==editor.sourceNode||stamp!==editor.sourceStamp)throw fail('source_changed','来源图片节点已变化，请重新打开编辑器');
    const doc=freeze(structuredClone(editor.document())),baseline=JSON.stringify(doc),width=editor.width,height=editor.height;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>4096||height>4096)throw fail('invalid_document','图片画板尺寸无效');
    const outputWidth=width*args.scale,outputHeight=height*args.scale;
    if(args.format==='psd'){
      if(!Number.isInteger(outputWidth)||!Number.isInteger(outputHeight)||outputWidth>4096||outputHeight>4096)throw fail('invalid_size','PSD 输出宽高须为不超过 4096 的整数，请调整导出比例');
      if(outputWidth*outputHeight*Math.max(1,doc.canvas?.objects?.length||0)>32*1024*1024)throw fail('invalid_size','PSD 图层像素过多，请减少图层或尺寸');
    }else if(outputWidth*outputHeight>32*1024*1024)throw fail('invalid_size','导出尺寸过大，请降低导出比例');
    if(typeof editor.renderExport!=='function'||args.format==='psd'&&typeof editor.exportPSD!=='function')throw fail('export_unavailable','图片编辑器导出能力尚未就绪');
    const guard=()=>{
      checkSignal(signal);
      if(getCurrent()!==editor||!editor.alive||editor.sessionId!==args.sessionId||editor.revision!==args.expectedRevision||editor.width!==width||editor.height!==height||JSON.stringify(editor.document())!==baseline)throw fail('revision_conflict','图片在导出期间发生变化，请重新读取后导出');
      if(nodeFor(args.nodeId)!==source||editor.sourceNode!==source||sourceStamp(source)!==stamp||editor.sourceStamp!==stamp)throw fail('source_changed','来源图片节点在导出期间发生变化');
      idle(editor);
    };
    // Methods resolve Fabric/PSD encoders from their existing module closure. The
    // facade has no live canvas, UI state or crop mutator and never changes ratio.
    const facade=Object.freeze({width,height,exportRatio:args.scale,crop:false,document:()=>structuredClone(doc),renderExport:editor.renderExport});
    return {editor,facade,guard,outputWidth,outputHeight};
  }
  async function run(op,signal){
    const args=op.request,{editor,facade,guard,outputWidth,outputHeight}=capture(args,signal);
    let blob,width=outputWidth,height=outputHeight;
    if(args.format==='psd'){blob=await editor.exportPSD.call(facade);guard();}
    else{
      const canvas=await facade.renderExport(args.scale);guard();
      width=canvas.width;height=canvas.height;
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)throw fail('invalid_export','图片导出没有有效尺寸');
      if(args.format==='jpeg'){
        const context=canvas.getContext('2d');context.save();context.globalCompositeOperation='destination-over';context.fillStyle='#ffffff';context.fillRect(0,0,width,height);context.restore();
      }
      blob=await new Promise((resolve,reject)=>{try{canvas.toBlob(resolve,'image/'+args.format,.95);}catch(error){reject(error);}});guard();
    }
    await validateBlob(blob,args.format,width,height);guard();
    const filename='Image Editor.'+(args.format==='jpeg'?'jpg':args.format);
    const receipt={...args,width,height,bytes:blob.size,filename,status:'download_requested',diskSaveVerified:false};
    guard();
    // Claim the attempt before entering an external adapter: an adapter can start
    // downloading and then throw, so replay must never silently request it twice.
    op.receipt=receipt;
    try{await download(blob,filename);}
    catch(error){op.receipt={...receipt,status:'download_unconfirmed',error:String(error?.message||'浏览器下载请求未能确认')};}
    return {...op.receipt};
  }
  async function execute(input,{signal}={}){
    checkSignal(signal);const args=request(input),fingerprint=JSON.stringify(args);let op=operations.get(args.operationId);
    if(op&&op.fingerprint!==fingerprint)throw fail('operation_conflict','相同 operationId 不能用于不同导出请求');
    if(op?.promise)return {...await op.promise,replayed:true};
    if(op?.receipt)return {...op.receipt,replayed:true};
    if(!op){op={request:args,fingerprint};operations.set(args.operationId,op);}
    op.promise=run(op,signal);
    try{return await op.promise;}finally{op.promise=null;}
  }
  return {execute};
}
