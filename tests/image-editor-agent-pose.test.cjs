const {test}=require('node:test'),assert=require('node:assert/strict');

async function setup(){
 const {FabricImage,util}=await import('fabric');
 const {DocumentHistory}=await import('../image-editor-core.mjs');
 const {createImageEditorAgent,imageEditorSourceStamp}=await import('../src/features/image-editor/agent-bridge.mjs');
 let release,decodeError=false,disposed=0;const strokes=[];
 const ctx={clearRect(){strokes.push('clear');},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push(this.strokeStyle);},arc(){},fill(){strokes.push(this.fillStyle);}};
 const previous=global.document;global.document={createElement:()=>({getContext:()=>ctx,toDataURL:()=>`data:image/png;base64,${Buffer.from(JSON.stringify(strokes)).toString('base64')}`})};
 class PoseImage extends FabricImage{
  static async fromURL(src){if(release)await release;if(decodeError)throw Error('decode failed');return new PoseImage({width:600,height:440,naturalWidth:600,naturalHeight:440,src});}
  dispose(){disposed++;}
 }
 const source={id:'editor',tool:'image-editor',editorDoc:{width:300,height:300,canvas:{objects:[]}}},objects=[],history=new DocumentHistory();
 const canvas={getObjects:()=>objects,getActiveObject:()=>null,discardActiveObject(){},add:o=>objects.push(o),requestRenderAll(){}};
 const editor={nodeId:'editor',sourceNode:source,sourceStamp:imageEditorSourceStamp(source),sessionId:'session',revision:0,alive:true,width:300,height:300,canvas,history,setMode(){},document:()=>({canvas:{objects:objects.map(o=>o.toObject(['id','agentPose']))}}),record(){if(history.push(this.document()))this.revision++;}};
 editor.saved=JSON.stringify(editor.document());history.reset(editor.document());
 const bridge=createImageEditorAgent({getCurrent:()=>editor,app:{getState:()=>({nodes:[source]})},fabric:{FabricImage:PoseImage,util},fontCatalog:()=>({})});
 return {bridge,editor,objects,strokes,args:()=>({nodeId:'editor',sessionId:'session',expectedRevision:editor.revision}),block:promise=>{release=promise;},fail:()=>{decodeError=true;},disposed:()=>disposed,restore:()=>{global.document=previous;}};
}
test('pose creation and patch use actual Fabric raster layers, official draw path and preserved geometry',async()=>{
 const {normalizePose,readLayerPose,poseSourceStamp}=await import('../src/features/image-editor/agent-pose.mjs');
 const s=await setup();try{
  const made=await s.bridge.execute('pose',{...s.args(),pose:{color:'blue',joints:{leftHand:[210.125,80.5]}}});
  assert.equal(made.capabilities.pose,true);assert.equal(made.poseGenerator.coordinateSpace,'pose-source-pixels');
  const layer=s.objects[0];assert.equal(layer.width,600);assert.equal(layer.height,440);assert.equal(layer.scaleX,.5);assert.equal(layer.left,150);assert.equal(layer.top,150);assert.equal(made.dirty,true);assert.equal(made.revision,1);
  assert.deepEqual(readLayerPose(layer).joints.leftHand,[210.125,80.5]);assert.ok(s.strokes.includes('blue'));assert.ok(!s.strokes.includes('black'));assert.ok(!s.strokes.includes('#4CAF50'));
  layer.set({left:1.25,top:8.75,angle:30,scaleX:.73,scaleY:1.3,flipX:true});const matrix=layer.calcTransformMatrix().slice();
  await s.bridge.execute('pose',{...s.args(),objectId:made.objectId,pose:{color:'green',joints:{rightHand:[410.125,70.25]}}});
  assert.equal(s.objects.length,1);assert.equal(layer.id,made.objectId);assert.deepEqual(layer.calcTransformMatrix(),matrix);assert.deepEqual(layer.agentPose.joints.leftHand,[210.125,80.5]);assert.equal(layer.agentPose.color,'green');assert.equal(s.editor.revision,2);assert.equal(s.disposed(),0);
  const doc=s.editor.document();assert.deepEqual(doc.canvas.objects[0].agentPose.joints.rightHand,[410.125,70.25]);
  const isolated=normalizePose({},readLayerPose(layer));isolated.joints.head[0]=1;assert.equal(layer.agentPose.joints.head[0],300);
  layer.setElement({...layer.getElement(),src:'data:image/png;base64,replacement'});assert.equal(readLayerPose(layer),null);
  await assert.rejects(s.bridge.execute('pose',{...s.args(),objectId:layer.id,pose:{color:'red'}}),{code:'unsupported_pose'});
  assert.notEqual(poseSourceStamp('abc'),poseSourceStamp('abd'));
 }finally{s.restore();}
});
test('pose refuses locked/masked layers, stale asynchronous writes, cancelled decoding and raster failures',async()=>{
 const s=await setup();try{
  s.editor.poseDialog={isConnected:true};await assert.rejects(s.bridge.execute('pose',{...s.args(),pose:{color:'red'}}),{code:'editor_busy'});s.editor.poseDialog=null;
  const first=await s.bridge.execute('pose',{...s.args(),pose:{}}),layer=s.objects[0];
  layer.selectable=false;await assert.rejects(s.bridge.execute('pose',{...s.args(),objectId:first.objectId,pose:{color:'red'}}),{code:'locked_object'});layer.selectable=true;
  layer.clipPath=new (await import('fabric')).Rect({width:10,height:10});await assert.rejects(s.bridge.execute('pose',{...s.args(),objectId:first.objectId,pose:{color:'red'}}),{code:'unsupported_pose'});layer.clipPath=undefined;
  const read=await s.bridge.execute('read',{nodeId:'editor'});assert.equal(read.layers[0].canRegeneratePose,true);
  let release;s.block(new Promise(resolve=>release=resolve));const pending=s.bridge.execute('pose',{...s.args(),pose:{color:'green'}});s.editor.revision++;release();await assert.rejects(pending,{code:'revision_conflict'});assert.equal(s.objects.length,1);assert.equal(s.disposed(),1);
  s.block(null);const abort=new AbortController();let unblock;s.block(new Promise(resolve=>unblock=resolve));const cancelled=s.bridge.execute('pose',{...s.args(),pose:{color:'yellow'}},{signal:abort.signal});abort.abort();unblock();await assert.rejects(cancelled,{code:'cancelled'});assert.equal(s.objects.length,1);assert.equal(s.disposed(),2);
  s.block(null);s.fail();await assert.rejects(s.bridge.execute('pose',{...s.args(),pose:{color:'red'}}),/decode failed/);assert.equal(s.objects.length,1);
 }finally{s.restore();}
});
test('isolated pose fixture still boots under full localStorage without deleting any stored data',()=>{
 const vm=require('node:vm'),fs=require('node:fs');let deletes=0;
 const storage={getItem:()=>null,setItem:()=>{throw Object.assign(Error('full'),{name:'QuotaExceededError'});},removeItem:()=>deletes++};
 const window={localStorage:storage},context={window,location:{search:'?agentPose&session=quota-check'},URLSearchParams,indexedDB:{deleteDatabase:()=>deletes++},console:{warn(){}}};
 Object.defineProperty(context,'localStorage',{get:()=>window.localStorage});vm.runInNewContext(fs.readFileSync(require.resolve('../qa/image-editor-fixture.js'),'utf8'),context);
 assert.equal(window.CANVAS_DATA.nodes[0].id,'editor-fixture');assert.equal(window.CANVAS_DB_NAME,'tapnow-qa-image-editor-quota-check');assert.equal(deletes,0);
});
