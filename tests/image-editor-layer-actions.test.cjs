const {test}=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const fabric=await import('fabric'),{DocumentHistory}=await import('../image-editor-core.mjs'),actions=await import('../src/features/image-editor/layer-actions.mjs'),{ensureArtworkIds}=await import('../src/features/image-editor/group-objects.mjs'),{imageEditorSourceStamp}=await import('../src/features/image-editor/agent-bridge.mjs');
 fabric.config.NUM_FRACTION_DIGITS=16;fabric.FabricObject.customProperties=['id','name','agentSourceNodeId'];
 const a=new fabric.Rect({id:'a',name:'first',left:10.25,top:20.375,width:50,height:40,angle:17,flipX:true,scaleX:.85}),b=new fabric.Rect({id:'b',left:80,top:90,width:50,height:40}),c=new fabric.Rect({id:'c',left:150,top:160,width:50,height:40});
 const objects=[a,b,c];let active=b;
 const canvas={getObjects:()=>objects,getActiveObject:()=>active,getActiveObjects:()=>active?[active]:[],discardActiveObject(){active=null;},setActiveObject(object){active=object;},add(object){objects.push(object);},remove(object){objects.splice(objects.indexOf(object),1);},requestRenderAll(){},bringObjectForward(object){const i=objects.indexOf(object);objects.splice(i,1);objects.splice(i+1,0,object);},sendObjectBackwards(object){const i=objects.indexOf(object);objects.splice(i,1);objects.splice(i-1,0,object);}};
 const source={id:'editor',editorDoc:{width:600,height:600,canvas:{objects:[]}}},app={projectIdentity:()=>({id:fixture.project}),getState:()=>({nodes:[source]})};fixture.project='qa';
 const editor={alive:true,revision:0,nodeId:'editor',sourceNode:source,sourceStamp:imageEditorSourceStamp(source),canvas,history:new DocumentHistory(),document(){return {canvas:{objects:objects.map(o=>o.toObject())}};},record(){ensureArtworkIds(objects);if(this.history.push(this.document()))this.revision++;}};editor.history.reset(editor.document());
 return {fabric,actions,app,editor,objects,a,b,c};
}
test('context layer move is one position with exact geometry, boundaries and one undo each',async()=>{
 const f=await fixture(),before=f.a.calcTransformMatrix().slice(),opts={app:f.app,util:f.fabric.util};
 assert.deepEqual(f.actions.layerActionState(f.editor.canvas,f.a),{copy:true,up:true,down:false,delete:true});
 assert.equal(await f.actions.applyLayerAction(f.editor,f.a,'down',opts),false);assert.equal(f.editor.history.past.length,1);
 await f.actions.applyLayerAction(f.editor,f.a,'up',opts);assert.deepEqual(f.objects.map(o=>o.id),['b','a','c']);assert.equal(f.editor.history.past.length,2);assert.deepEqual(f.a.calcTransformMatrix(),before);assert.equal(f.editor.canvas.getActiveObject(),f.b);
 await f.actions.applyLayerAction(f.editor,f.a,'down',opts);assert.deepEqual(f.objects.map(o=>o.id),['a','b','c']);assert.equal(f.editor.history.past.length,3);
 assert.deepEqual(f.editor.history.undo().canvas.objects.map(o=>o.id),['b','a','c']);assert.deepEqual(f.editor.history.redo().canvas.objects.map(o=>o.id),['a','b','c']);
});
test('real Fabric clone preserves artwork and provenance with new id, +10 logical offset and one history',async()=>{
 const f=await fixture();f.a.agentSourceNodeId='original-asset';const before=f.a.toObject();
 await f.actions.applyLayerAction(f.editor,f.a,'copy',{app:f.app,util:f.fabric.util,id:()=> 'copy'});
 const copy=f.objects.at(-1);assert.equal(copy.id,'copy');assert.equal(copy.left,f.a.left+10);assert.equal(copy.top,f.a.top+10);assert.equal(copy.agentSourceNodeId,'original-asset');assert.equal(copy.angle,f.a.angle);assert.equal(copy.flipX,f.a.flipX);assert.equal(copy.scaleX,f.a.scaleX);assert.deepEqual(f.a.toObject(),before);assert.equal(f.editor.canvas.getActiveObject(),copy);assert.equal(f.editor.history.past.length,2);
});
test('delete targets the unselected thumbnail and preserves the other active layer',async()=>{
 const f=await fixture();await f.actions.applyLayerAction(f.editor,f.a,'delete',{app:f.app,util:f.fabric.util});assert.deepEqual(f.objects.map(o=>o.id),['b','c']);assert.equal(f.editor.canvas.getActiveObject(),f.b);assert.equal(f.editor.history.past.length,2);
});
test('nested Group clone receives fresh descendant IDs while preserving matrices and source provenance',async()=>{
 const f=await fixture(),child=new f.fabric.Rect({id:'leaf',agentSourceNodeId:'asset-source',left:12.125,top:18.375,width:40,height:50}),inner=new f.fabric.Group([child],{id:'inner',angle:23}),group=new f.fabric.Group([inner],{id:'group',left:91.125,top:73.75,scaleX:.7,scaleY:1.2,flipX:true});
 f.objects.push(group);const before=child.calcTransformMatrix().slice();
 await f.actions.applyLayerAction(f.editor,group,'copy',{app:f.app,util:f.fabric.util,id:()=> 'copied-group'});
 const copy=f.objects.at(-1),copiedInner=copy.getObjects()[0],copiedLeaf=copiedInner.getObjects()[0];
 assert.notEqual(copiedInner.id,inner.id);assert.notEqual(copiedLeaf.id,child.id);assert.equal(copiedLeaf.agentSourceNodeId,'asset-source');
 const matrix=copiedLeaf.calcTransformMatrix();matrix.forEach((value,i)=>assert.ok(Math.abs(value-before[i]-(i>3?10:0))<1e-8));assert.equal(child.id,'leaf');
});
test('selectability does not invent an official menu restriction',async()=>{
 const f=await fixture();f.a.selectable=false;assert.equal(f.actions.layerActionState(f.editor.canvas,f.a).copy,true);
});
test('copy from real ActiveSelection retains the artboard matrix rather than wrapper-local coordinates',async()=>{
 const f=await fixture(),selection=new f.fabric.ActiveSelection([f.a,f.b],{angle:14,scaleX:1.1,scaleY:.85});
 const matrix=f.a.calcTransformMatrix().slice();f.editor.canvas.setActiveObject(selection);
 await f.actions.applyLayerAction(f.editor,f.a,'copy',{app:f.app,util:f.fabric.util});
 f.objects.at(-1).calcTransformMatrix().forEach((value,i)=>assert.ok(Math.abs(value-matrix[i]-(i>3?10:0))<1e-8));
});
for(const change of ['revision','moving','project','source','replacement','closed'])test(`late clone after ${change} never inserts or records`,async()=>{
 const f=await fixture(),clone=f.a.clone.bind(f.a);let release;f.a.clone=async()=>{await new Promise(resolve=>release=resolve);return clone();};
 const pending=f.actions.applyLayerAction(f.editor,f.a,'copy',{app:f.app,util:f.fabric.util});
 if(change==='revision')f.editor.revision++;if(change==='moving')f.a.left+=.125;if(change==='project')fixture.project='elsewhere';if(change==='source')f.editor.sourceNode.editorDoc.width=800;if(change==='replacement')f.objects[0]=new f.fabric.Rect({id:'a'});if(change==='closed')f.editor.alive=false;
 release();await assert.rejects(pending,/已变化/);assert.equal(f.objects.length,3);assert.equal(f.editor.history.past.length,1);
});
test('all layer menu keys stay outside editor shortcuts without suppressing native Space/Enter/Tab',async()=>{
 const {openLayerMenu}=await import('../src/features/image-editor/layer-actions.mjs');
 const events={};
 const popup={children:[],setAttribute(){},ownerDocument:{createElement(){return {setAttribute(){}};}},append(item){this.children.push(item);},addEventListener(name,fn){events[name]=fn;},querySelector(){return this.children.find(item=>item.focus&&!item.disabled);}};
 const editor={canvas:{getObjects:()=>[target]},safe:fn=>fn,menu(anchor,build){this.popup=popup;build(popup);popup.onkeydown=event=>{if(['ArrowUp','ArrowDown','Home','End'].includes(event.key))event.preventDefault();};}};
 const target={id:'layer'},button=()=>({dataset:{},setAttribute(){},classList:{toggle(){}},focus(){}});
 openLayerMenu(editor,target,{},null,{button});
 for(const key of [' ','Enter','Tab','ArrowLeft','ArrowRight','Delete','Backspace','z','ArrowUp','ArrowDown','Home','End','Escape']){
  let stopped=0,prevented=0;popup.onkeydown({key,stopPropagation(){stopped++;},preventDefault(){prevented++;}});
  assert.equal(stopped,1,key);if([' ','Enter','Tab'].includes(key))assert.equal(prevented,0,key);
  stopped=0;prevented=0;events.keyup({key,stopPropagation(){stopped++;},preventDefault(){prevented++;}});assert.equal(stopped,1,key);assert.equal(prevented,0,key);
 }
});
