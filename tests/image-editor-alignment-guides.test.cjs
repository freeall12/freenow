const {test}=require('node:test');
const assert=require('node:assert/strict');
const moduleReady=import('../src/features/image-editor/alignment-guides.mjs');
test('strict logical threshold, fractional alignment and official center-last priority',async()=>{
 const {alignmentPlan}=await moduleReady;
 const board={width:600,height:600};
 assert.deepEqual(alignmentPlan({left:10,top:20,width:100,height:100},board),{dx:0,dy:0,guides:[]});
 const plan=alignmentPlan({left:9.999,top:497.625,width:100.25,height:100.5},board);
 assert.equal(plan.dx,-9.999);assert.equal(plan.dy,1.875);
 assert.deepEqual(plan.guides.map(g=>g.id),['vertical-left','horizontal-bottom']);
 const overlap=alignmentPlan({left:4,top:4,width:592,height:592},board);
 assert.equal(overlap.dx,0);assert.equal(overlap.dy,0);
 assert.deepEqual(overlap.guides.map(g=>g.id),['vertical-left','horizontal-top','vertical-right','horizontal-bottom','vertical-center','horizontal-center']);
});
test('Fabric center and left origins share logical edges and rotation does not change reference arithmetic',async()=>{
 const {objectAlignmentBox,alignmentPlan}=await moduleReady;
 const {Rect}=await import('fabric');
 const centered=new Rect({originX:'center',originY:'center',left:57.125,top:300,width:100,height:80,scaleX:1.125,scaleY:.75,angle:37});
 assert.deepEqual(objectAlignmentBox(centered),{left:.875,top:270,width:112.5,height:60});
 assert.equal(alignmentPlan(objectAlignmentBox(centered),{width:600,height:600}).dx,-.875);
 centered.set({originX:'left',originY:'top',left:.875,top:270});
 assert.deepEqual(objectAlignmentBox(centered),{left:.875,top:270,width:112.5,height:60});
 // Official ||1 fallback is intentional; flips/angle are not helper inputs.
 assert.deepEqual(objectAlignmentBox({left:3,top:5,width:12.5,height:20,scaleX:0,scaleY:0,originX:'left',originY:'top'}),{left:3,top:5,width:12.5,height:20});
 assert.deepEqual(objectAlignmentBox({left:3,top:5,width:12.5,height:20,scaleX:-2,scaleY:1,flipX:true,originX:'center',originY:'center'}),{left:15.5,top:-5,width:-25,height:20});
 assert.deepEqual(alignmentPlan({left:0,top:0,width:Infinity,height:20},{width:600,height:600}),{dx:0,dy:0,guides:[]});
});
function harness(enabled=()=>true){
 const handlers=new Map(),canvas={width:600,height:600,on(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);},off(event,fn){handlers.get(event).delete(fn);},fire(event,data={}){for(const fn of handlers.get(event)||[])fn(data);}};
 const container={children:[],ownerDocument:{createElement(){return {style:{},dataset:{}};}},replaceChildren(){this.children=[];},append(line){this.children.push(line);}};
 return {canvas,container,enabled,handlers};
}
test('real Fabric transforms snap without artwork/history mutations; end, selection and disposal clear owned DOM',async()=>{
 const {createAlignmentGuides}=await moduleReady,{Rect}=await import('fabric');
 const h=harness(),guides=createAlignmentGuides(h),target=new Rect({originX:'center',originY:'center',left:58.625,top:300,width:100,height:80,scaleX:1.125,scaleY:.75,id:'vertical-user-artwork'});
 const original=target.toObject();h.canvas.fire('object:moving',{target});
 assert.equal(target.left,56.25);assert.equal(target.top,300);assert.equal(h.container.children.length,2);
 assert.equal(target.id,'vertical-user-artwork');assert.equal(target.angle,original.angle);assert.equal(target.scaleX,original.scaleX);
 for(const event of ['object:modified','mouse:up','selection:created','selection:updated','selection:cleared']){
  h.canvas.fire('object:moving',{target});assert.ok(h.container.children.length);h.canvas.fire(event);assert.equal(h.container.children.length,0);
 }
 guides.dispose();assert.ok([...h.handlers.values()].every(items=>items.size===0));
});
test('crop, drawing, loading gates and helper objects cannot activate snapping',async()=>{
 const {createAlignmentGuides}=await moduleReady;
 let enabled=true;const h=harness(()=>enabled),guides=createAlignmentGuides(h);
 const target={left:4,top:4,width:100,height:100,set(patch){Object.assign(this,patch);},setCoords(){}};
 h.canvas.fire('object:moving',{target});assert.ok(h.container.children.length);
 enabled=false;target.left=4;h.canvas.fire('object:moving',{target});assert.equal(target.left,4);assert.equal(h.container.children.length,0);
 enabled=true;target.excludeFromExport=true;h.canvas.fire('object:moving',{target});assert.equal(target.left,4);assert.equal(h.container.children.length,0);guides.dispose();
});
