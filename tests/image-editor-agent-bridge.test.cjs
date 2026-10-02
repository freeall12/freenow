const {test}=require('node:test');const assert=require('node:assert/strict');
async function setup(loadFont=async()=>{}){
 const {createImageEditorAgent,imageEditorSourceStamp}=await import('../src/features/image-editor/agent-bridge.mjs');
 const {Rect,Ellipse,Line,Path,util}=await import('fabric');const {DocumentHistory}=await import('../image-editor-core.mjs');
 const source={id:'editor',tool:'image-editor',editorDoc:{width:600,height:600,canvas:{objects:[]}}};const state={nodes:[source],view:{x:30,y:50,scale:2}};const objects=[];
 const canvas={getObjects:()=>objects,getActiveObject:()=>null,add:o=>objects.push(o),remove:o=>objects.splice(objects.indexOf(o),1),discardActiveObject(){},requestRenderAll(){},moveObjectTo(o,index){objects.splice(objects.indexOf(o),1);objects.splice(index,0,o);}};
 const editor={alive:true,sessionId:'session-1',nodeId:'editor',sourceNode:source,sourceStamp:imageEditorSourceStamp(source),revision:0,width:600,height:600,canvas,history:new DocumentHistory(),setMode(){},document:()=>({width:600,height:600,canvas:{objects:objects.map(o=>o.toObject(['id','selectable','evented','lockMovementX','lockMovementY','lockScalingX','lockScalingY','lockRotation']))}}),record(){if(this.history.push(this.document()))this.revision++;},close(){this.alive=false;}};
 editor.saved=JSON.stringify(editor.document());editor.history.reset(editor.document());
 const app={getState:()=>state};const bridge=createImageEditorAgent({getCurrent:()=>editor,app,fabric:{Rect,Ellipse,Line,Path,util},loadFont,fontCatalog:()=>({'open sans':'open.ttf'})});
 return {bridge,editor,state,source,objects,args:()=>({nodeId:'editor',sessionId:'session-1',expectedRevision:editor.revision})};
}
test('live Fabric edits keep fractional artboard coordinates and require session/revision, lock and source checks',async()=>{
 const {bridge,editor,source,objects,args}=await setup();
 const added=await bridge.execute('add',{...args(),kind:'rect',properties:{left:1.25,top:8.75,width:100,height:40}});
 assert.equal(added.revision,1);assert.equal(objects[0].left,1.25);assert.equal(objects[0].top,8.75);assert.ok(added.objectId);
 await assert.rejects(bridge.execute('remove',{...args(),sessionId:'old-session',objectId:added.objectId}),{code:'revision_conflict'});
 await bridge.execute('update',{...args(),objectId:added.objectId,properties:{locked:true}});
 await assert.rejects(bridge.execute('remove',{...args(),objectId:added.objectId}),{code:'locked_object'});
 source.editorDoc={changed:true};await assert.rejects(bridge.execute('update',{...args(),objectId:added.objectId,properties:{locked:false}}),{code:'source_changed'});
 assert.equal(editor.revision,2);assert.equal(objects.length,1);
});
test('async font work rejects stale documents and cancelled work without late writes',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);const {bridge,editor,objects,args}=await setup(()=>pending);
 const promise=bridge.execute('add',{...args(),kind:'text',properties:{text:'hello'}});editor.revision++;release();await assert.rejects(promise,{code:'revision_conflict'});assert.equal(objects.length,0);
 const controller=new AbortController();controller.abort();await assert.rejects(bridge.execute('add',{...args(),kind:'rect'},{signal:controller.signal}),{code:'cancelled'});assert.equal(objects.length,0);
});
test('save receipts survive editor disposal and unsaved close requires explicit discard',async()=>{
 const {bridge,editor,args}=await setup();await bridge.execute('add',{...args(),kind:'rect'});
 await assert.rejects(bridge.execute('close',args()),{code:'unsaved_editor'});
 editor.save=async()=>{editor.alive=false;editor.document=()=>{throw Error('disposed');};return {applied:true,saved:true,currentMatches:false,savedRevision:1};};
 const result=await bridge.execute('save',args());assert.equal(result.applied,true);assert.equal(result.saved,true);assert.equal(result.currentMatches,false);
});

test('ActiveSelection read reports artboard transforms without altering selection; applying same values does not drift',async()=>{
 const {Rect,ActiveSelection,util}=await import('fabric');const {bridge,editor,objects,args}=await setup();
 const a=new Rect({id:'a',left:5.25,top:7.75,width:100,height:40,angle:20,flipX:true}),b=new Rect({id:'b',left:300,top:100,width:20,height:30});objects.push(a,b);
 const selection=new ActiveSelection([a,b]);selection.set({left:123.25,top:10.75,angle:30,scaleX:1.2,scaleY:.7});
 const before=a.calcTransformMatrix().slice(),beforeLocal=util.saveObjectTransform(a);editor.canvas.getActiveObject=()=>selection;
 editor.canvas.discardActiveObject=()=>{selection.removeAll();editor.canvas.getActiveObject=()=>null;};
 const read=await bridge.execute('read',{nodeId:'editor'}),layer=read.layers.find(l=>l.objectId==='a');
 assert.equal(a.group,selection);assert.deepEqual(util.saveObjectTransform(a),beforeLocal);assert.deepEqual(a.calcTransformMatrix(),before);
 const names=['left','top','scaleX','scaleY','angle','flipX','flipY'];const patch=Object.fromEntries(names.map(name=>[name,layer[name]]));
 await bridge.execute('update',{...args(),objectId:'a',properties:patch});
 assert.equal(a.group,undefined);a.calcTransformMatrix().forEach((value,index)=>assert.ok(Math.abs(value-before[index])<1e-9,`matrix[${index}] drifted`));
 assert.ok(Math.abs(layer.skewX-a.skewX)<1e-9);assert.equal(layer.originX,a.originX);
 await bridge.execute('update',{...args(),objectId:'a',properties:{rx:0,ry:0}});assert.equal(a.rx,0);assert.equal(a.ry,0);
});
