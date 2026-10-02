const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=Promise.all([import('../src/features/image-editor/agent-export.mjs'),import('../image-editor-core.mjs')]);
async function fixture({wait=async()=>{},download,wrongCodec=false}={}){
 const [{createImageEditorExporter},{encodePSD}]=await load;
 const doc={width:16,height:16,canvas:{objects:[],background:'#ffffff'}},source={id:'source',editorDoc:doc},state={nodes:[source]};let current,downloads=0,ratioSeen;
 const context={save(){},restore(){},fillRect(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
 // Fabric canvas and PNG/JPEG browser codecs are boundary doubles. PSD encoding
 // and the exact production renderExport/exportPSD methods run without changes.
 class StaticCanvas{
  constructor(_,options){Object.assign(this,options);}
  async loadFromJSON(value){this.loaded=structuredClone(value);await wait();}
  toCanvasElement(scale){ratioSeen=scale;return {width:Math.floor(this.width*scale),height:Math.floor(this.height*scale),getContext:()=>context,toBlob:(callback,mime)=>{const bytes=new Uint8Array(32),view=new DataView(bytes.buffer);if(mime==='image/jpeg'&&!wrongCodec)bytes.set([255,216,255]);else{bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);view.setUint32(16,Math.floor(this.width*scale));view.setUint32(20,Math.floor(this.height*scale));}callback(new Blob([bytes],{type:mime}));}};}
  renderAll(){}add(){}async dispose(){}
 }
 const sourceCode=fs.readFileSync(require.resolve('../image-editor-entry.mjs'),'utf8');
 const renderMethod=sourceCode.slice(sourceCode.indexOf('  async renderExport('),sourceCode.indexOf('\n  download('));
 const psdMethod=sourceCode.slice(sourceCode.indexOf('  async exportPSD('),sourceCode.indexOf('\n  async export(type)'));
 const methods=Function('StaticCanvas','util','encodePSD',`return {${renderMethod},${psdMethod}}`)(StaticCanvas,{enlivenObjects:async()=>[]},encodePSD);
 const editor={...methods,alive:true,nodeId:'source',sessionId:'session',revision:1,width:16,height:16,exportRatio:3,sourceNode:source,sourceStamp:JSON.stringify([source.editorDoc,source.image,source.fullImage]),document:()=>structuredClone(doc),canvas:{getActiveObject:()=>null}};current=editor;
 const exporter=createImageEditorExporter({getCurrent:()=>current,app:{getState:()=>state},download:async(blob,name)=>{downloads++;if(download)await download(blob,name);}});
 return {exporter,editor,doc,source,state,setCurrent:value=>current=value,downloads:()=>downloads,ratioSeen:()=>ratioSeen,args:(format='png')=>({operationId:'export-'+format,nodeId:'source',sessionId:'session',expectedRevision:1,format,scale:2})};
}
test('export borrows production renderers with frozen scale; PNG/JPEG receipts and real PSD bytes request one download',async()=>{
 for(const format of ['png','jpeg','psd']){
  let received;
  const f=await fixture({download:async(blob,filename)=>{received={blob,filename};}}),args=f.args(format);
  const result=await f.exporter.execute(args);
  assert.equal(result.status,'download_requested');assert.equal(result.diskSaveVerified,false);assert.equal(result.width,32);assert.equal(result.height,32);assert.equal(result.bytes,received.blob.size);assert.equal(f.editor.exportRatio,3);assert.equal(f.ratioSeen(),2);
  if(format==='psd'){const bytes=Buffer.from(await received.blob.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'8BPS');assert.equal(bytes.readUInt32BE(14),32);assert.equal(bytes.readUInt32BE(18),32);}
  else assert.equal(received.blob.type,'image/'+format);
  f.editor.alive=false;
  const replay=await f.exporter.execute(args);assert.equal(replay.replayed,true);assert.equal(replay.status,'download_requested');assert.equal(f.downloads(),1);
  await assert.rejects(f.exporter.execute({...args,scale:1}),{code:'operation_conflict'});
 }
});
test('edits without revision, source replacement, session replacement and cancellation during rendering never download stale pixels',async()=>{
 for(const mutation of ['document','source','session','cancel']){
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({wait:()=>gate}),controller=new AbortController();
  const pending=f.exporter.execute(f.args(),{signal:controller.signal});
  if(mutation==='document')f.doc.canvas.background='#000000';
  if(mutation==='source')f.state.nodes=[{...f.source}];
  if(mutation==='session')f.setCurrent({...f.editor});
  if(mutation==='cancel')controller.abort();
  release();await assert.rejects(pending,{code:mutation==='cancel'?'cancelled':mutation==='source'?'source_changed':'revision_conflict'});assert.equal(f.downloads(),0);
 }
});
test('encoding failure can retry; uncertain download callback cannot re-trigger under same operation ID',async()=>{
 let rejectOnce=true;
 const f=await fixture({wait:async()=>{if(rejectOnce){rejectOnce=false;throw Error('temporary decode');}},download:async()=>{throw Error('download adapter interrupted');}}),args=f.args();
 await assert.rejects(f.exporter.execute(args),/temporary decode/);assert.equal(f.downloads(),0);
 const result=await f.exporter.execute(args);assert.equal(result.status,'download_unconfirmed');assert.equal(f.downloads(),1);
 const replay=await f.exporter.execute(args);assert.equal(replay.replayed,true);assert.equal(replay.status,'download_unconfirmed');assert.equal(f.downloads(),1);
 await f.exporter.execute({...args,operationId:'new-explicit-download'});assert.equal(f.downloads(),2);
});
test('parallel replay shares encoding and downloaded bytes; live ratio changes never affect frozen export scale',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({wait:()=>gate});
 const first=f.exporter.execute(f.args()),second=f.exporter.execute(f.args());f.editor.exportRatio=4;release();
 const [a,b]=await Promise.all([first,second]);assert.equal(a.status,'download_requested');assert.equal(b.replayed,true);assert.equal(f.downloads(),1);assert.equal(f.ratioSeen(),2);assert.equal(f.editor.exportRatio,4);
});


test('PNG bytes cannot be acknowledged as a JPEG download even with a JPEG MIME label',async()=>{
 const f=await fixture({wrongCodec:true});await assert.rejects(f.exporter.execute(f.args('jpeg')),{code:'invalid_export'});assert.equal(f.downloads(),0);
});
