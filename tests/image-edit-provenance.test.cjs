const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const provenance=import('../src/features/media-preview/provenance.mjs'),results=import('../src/features/image-editor/generated-results.mjs');
const preview=import('../media-preview-core.mjs'),versions=import('../image-versions-core.mjs');
const reload=value=>JSON.parse(JSON.stringify(value));

// Exercise the production application callbacks with decoded media and canvas
// mutations, without starting unrelated editor UI or making provider requests.
async function callback(file,marker,context){
 const source=fs.readFileSync(require.resolve('../'+file),'utf8'),start=source.indexOf(marker);
 assert.ok(start>=0,`Missing ${marker} in ${file}`);
 const body=start+marker.length;let end=body,depth=0;
 do{const char=source[end++];if(char==='{')depth++;if(char==='}')depth--;}while(depth&&end<source.length);
 const Image=class {set src(value){this._src=new URL(value,'https://local.test/').href;}get src(){return this._src;}async decode(){this.naturalWidth=768;this.naturalHeight=512;}};
 return vm.runInNewContext('('+source.slice(start+marker.indexOf(':')+1,end)+')',{...await results,structuredClone,Image,Date,...context});
}
async function generated(kind,index=0,withModel=true){
 const {resultProvenance}=await provenance,output={type:'image',image:`https://provider.test/thumb-${index}.png`,fullImage:`https://provider.test/full-${index}.png`,...(withModel?{model:'actual-provider-model'}:{})};
 return {...output,...resultProvenance({id:'original-task',request:{kind,prompt:'dispatched edit prompt',parameters:withModel?{model:'requested-model'}:{}}},output)};
}
function canvas(context){
 context.app={updateNode:(id,patch)=>Object.assign(context.target||context.n||context.source,patch),createConnected:(id,outputs)=>{context.target={id:'new-result',...outputs[0]};return [context.target];}};
 context.guard=()=>{};context.nodeSize=()=>({width:375,height:250});context.id='source';return context;
}

for(const [name,kind] of [['erase','image.erase'],['redraw','image.redraw'],['outpaint','image.outpaint']]){
 test(`${name} custom batch retains each dispatched origin in existing and late-created results`,async()=>{
  const outputs=[await generated(kind,0),await generated(kind,1)],providerSnapshot=reload(outputs),p=await preview,v=await versions;
  for(const existing of [false,true]){
   const context=canvas({target:existing?{id:'pending',type:'image',image:null}:null,values:{count:2},text:'composer draft'});
   const apply=await callback(`image-${name}-ui.mjs`,'applyBatch:async outputs=>',context);
   const [node]=await apply(outputs),stored=reload({...node,generation:{model:'next-composer-model',prompt:'next prompt'}});
   assert.equal(stored.fullImage,outputs[0].fullImage);assert.equal(stored.provenance.mediaSource,outputs[0].fullImage);assert.equal(stored.provenance.taskId,'original-task');assert.equal(stored.provenance.requestKind,kind);
   assert.deepEqual(p.resources(stored).map(r=>[r.model,r.prompt]),[['actual-provider-model','dispatched edit prompt'],['actual-provider-model','dispatched edit prompt']]);
   const selected=reload({...stored,...v.mainPatch(stored,stored.versions[1],stored.versions)});
   assert.equal(selected.fullImage,outputs[1].fullImage);assert.equal(selected.provenance.taskId,'original-task');assert.equal(p.resources(selected)[0].model,'actual-provider-model');assert.equal(p.resources(selected)[0].prompt,'dispatched edit prompt');
   await assert.rejects(()=>apply([outputs[0]]),/数量/);
  }
  assert.deepEqual(outputs,providerSnapshot);
 });
}

test('enhance and skin callbacks preserve new origin and real previous origins without inventing an imported model',async()=>{
 const p=await preview,v=await versions;
 for(const kind of ['image.upscale','image.skin'])for(const imported of [false,true])for(const existingVersion of [false,true]){
  const previous=await generated('image.generate',2),oldImage=previous.fullImage;
  const n={id:'enhance',type:'image',image:oldImage,fullImage:oldImage,generation:{model:'next-composer-model'},...(imported?{}:{provenance:previous.provenance}),versions:existingVersion?[{image:oldImage}]:[]};
  const output=await generated(kind,3),snapshot=reload(output),context=canvas({n,id:n.id,oldImage,request:{label:'增强',parameters:{provider:'configured-provider'}},window:{}});
  await (await callback('image-enhance-ui.mjs','apply:output=>',context))(output);
  const stored=reload(n),resources=p.resources(stored);
  assert.equal(stored.provenance.requestKind,kind);assert.equal(stored.provenance.taskId,'original-task');assert.equal(stored.provenance.mediaSource,output.fullImage);
  assert.deepEqual(resources.map(r=>r.model),['actual-provider-model',imported?null:'actual-provider-model']);assert.equal(resources[1].prompt,imported?'':'dispatched edit prompt');
  const old=stored.versions.find(item=>item.image===oldImage),selected={...stored,...v.mainPatch(stored,old,stored.versions)};
  assert.equal(p.resources(selected,{model:'default-model'})[0].model,imported?null:'actual-provider-model');assert.deepEqual(output,snapshot);
 }
});

test('cutout callback binds real task identity on every application branch and leaves missing model empty',async()=>{
 const p=await preview;
 for(const inPlace of [false,true])for(const existing of [false,true]){
  const source={id:'source',type:'image',image:'imported.png',generation:{model:'next-composer-model'}},output=await generated('image.remove-background',4,false);
  const context=canvas({source,inPlace,target:existing?(inPlace?source:{id:'pending',type:'image'}):null});
  const [node]=await (await callback('image-cutout-ui.mjs','apply:async output=>',context))(output),stored=reload(node);
  assert.equal(stored.fullImage,output.fullImage);assert.equal(stored.provenance.mediaSource,output.fullImage);assert.equal(stored.provenance.taskId,'original-task');assert.equal(stored.provenance.requestKind,'image.remove-background');
  assert.equal(stored.provenance.model,null);assert.equal(p.resources(stored,{model:'default-model'})[0].model,null);
 }
});

test('enhance retains a legacy version own saved model and prompt when the current node has no origin',async()=>{
 const n={id:'enhance',type:'image',image:'legacy.png',generation:{model:'next-model'},versions:[{image:'legacy.png',generation:{model:'saved-legacy-model',prompt:'saved legacy prompt'}}]},context=canvas({n,id:n.id,oldImage:n.image,request:{label:'增强',parameters:{}},window:{}});
 await (await callback('image-enhance-ui.mjs','apply:output=>',context))(await generated('image.upscale',6));
 const resources=(await preview).resources(reload(n));assert.equal(resources[1].model,'saved-legacy-model');assert.equal(resources[1].prompt,'saved legacy prompt');
});

test('angle and relight shared history retain dispatched origin, while legacy local versions stay model-free',async()=>{
 const history=await import('../image-history-core.mjs'),p=await preview,v=await versions;
 for(const kind of ['image.multiAngle','image.relight']){
  const output=await generated(kind,5),node={id:'source',type:'image',image:'imported.png',width:250,height:250,x:0,y:0,generation:{model:'next-composer-model'}};
  const job={id:'original-task',request:{kind,prompt:'dispatched edit prompt',parameters:{model:'requested-model'}},outputs:[output]};
  const stored=reload({...node,...history.record(node,job)});assert.equal(p.resources(stored)[0].model,'actual-provider-model');assert.equal(stored.provenance.requestKind,kind);
 }
 const local={type:'image',image:'local-edit.png',generation:{model:'composer-default'}},selected={...local,...v.mainPatch(local,{image:'imported-version.png'},[])};
 assert.equal(selected.provenance.kind,'imported');assert.equal(p.resources(selected,{model:'default'})[0].model,null);
 const {imageResultPatch}=await results;assert.equal(imageResultPatch({type:'image',image:'local.png'}).provenance.kind,'imported');
});
