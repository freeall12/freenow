const test=require('node:test'),assert=require('node:assert/strict');
const tools=require('../agent-tools.js');
async function fixture({configured=true}={}){
 const {startWorldGeneration,readWorld}=await import('../src/features/agent-generation/world.mjs');
 const node={id:'world',type:'world',worldConfig:{model:'tripo-h3',prompt:'a ceramic vessel',material:'pbr'}},state={nodes:[node],edges:[]};
 const app={getState:()=>state,updateNode:(id,patch)=>Object.assign(node,patch)};
 let calls=0,apply,guard,resolveJob,rejectJob,request;
 const api={getJobs:()=>[],availability:async()=>({configured}),runInPlace:(req,target,options)=>{
  calls++;request=req;apply=target.apply;guard=target.guard;
  const job={id:'real-local-job',request:req,status:'queued'};
  const completion=new Promise((resolve,reject)=>{resolveJob=resolve;rejectJob=reject;});
  Promise.resolve().then(()=>options.onSubmitted(job)).catch(rejectJob);
  return completion;
 }};
 const defaults={app,api,prepareMedia:async refs=>({inputs:refs.map(ref=>({id:ref.id,type:ref.type,url:ref.image,text:ref.content})),guard:()=>{}}),materialize:async()=>({worldResource:{format:'glb',url:'asset:actual-output'},outputType:'asset'})};
 return {start:args=>startWorldGeneration(args,defaults),read:()=>readWorld({nodeId:'world'},{app}),defaults,node,state,app,get calls(){return calls;},get request(){return request;},apply:output=>apply(output),guard:()=>guard(),finish:()=>resolveJob({status:'succeeded'}),fail:()=>rejectJob(Error('provider failed'))};
}
test('world tools use official model contract; missing key dispatches nothing',async()=>{
 tools.parse('canvas_add',{type:'world',title:'World',x:100,y:200});tools.parse('world_generate',{nodeId:'world'});
 const f=await fixture({configured:false});assert.equal(f.read().models.length,3);assert.equal(f.read().outputRenderer.gaussianSplat,false);
 assert.equal((await f.start({nodeId:'world'})).configurationRequired,true);assert.equal(f.calls,0);
});
test('world submission retains actual request, waits for persisted receipt and reuses materialized result',async()=>{
 const f=await fixture();let release;
 f.defaults.onSubmitted=()=>new Promise(resolve=>{release=resolve;});
 let returned=false;const pending=f.start({nodeId:'world',referenceIds:[]}).then(result=>{returned=true;return result;});
 while(!release)await new Promise(resolve=>setImmediate(resolve));assert.equal(returned,false);
 release();const result=await pending;assert.equal(result.job.id,'real-local-job');assert.equal(f.request.kind,'world.generate');assert.equal(f.request.parameters.model,'tripo-text-to-model-h3');assert.equal(f.request.parameters.tripoParams.pbr,true);
 await assert.rejects(f.start({nodeId:'world'}),{code:'world_generation_busy'});
 await f.apply({type:'model',url:'https://provider.example/generated.glb'});f.finish();await result.completion;
 assert.equal(f.node.worldResource.url,'asset:actual-output');
});
test('world reference mismatch and stale node block actual application',async()=>{
 const f=await fixture();f.state.nodes.push({id:'image',type:'image',image:'asset:photo'});
 await assert.rejects(f.start({nodeId:'world',referenceIds:['image']}),{code:'unsupported_world_prompt'});assert.equal(f.calls,0);
 const result=await f.start({nodeId:'world',referenceIds:['image'],prompt:''});assert.equal(f.request.inputs[0].nodeId,'image');assert.equal(f.request.parameters.model,'tripo-image-to-model-h3');
 f.node.worldConfig.prompt='user edited';await assert.rejects(f.apply({type:'model'}),{code:'world_source_changed'});assert.equal(f.node.worldResource,undefined);f.fail();await assert.rejects(result.completion);
});
test('cancellation or failed durable receipt cannot become acknowledged world submission',async()=>{
 const f=await fixture();f.defaults.onSubmitted=async()=>{throw Error('disk full');};await assert.rejects(f.start({nodeId:'world'}),/disk full/);assert.equal(f.node.worldResource,undefined);
 const other=await fixture();const controller=new AbortController();other.defaults.signal=controller.signal;
 other.defaults.api.availability=async()=>{controller.abort();return {configured:true};};
 await assert.rejects(other.start({nodeId:'world'}),{name:'AbortError'});assert.equal(other.calls,0);
});

test('Agent probes the selected world alias and leaves full media preparation to TaskService',async()=>{
 const f=await fixture();f.state.nodes.push({id:'image',type:'image',image:'asset:thumbnail',fullImage:'asset:full-source'});
 f.defaults.prepareMedia=()=>assert.fail('Agent must not read media before shared TaskService');
 f.defaults.api.availability=async({request})=>{assert.equal(request.kind,'world.generate');assert.equal(request.parameters.model,'tripo-image-to-model-h3');assert.equal(request.inputs[0].url,'asset:full-source');return {configured:true};};
 const result=await f.start({nodeId:'world',referenceIds:['image'],prompt:''});
 assert.equal(f.request.inputs[0].url,'asset:full-source');f.finish();await result.completion;
 const changed=await fixture();changed.state.nodes.push({id:'image',type:'image',fullImage:'asset:full-source'});
 changed.defaults.api.availability=async()=>{changed.state.nodes[1]={...changed.state.nodes[1]};return {configured:true};};
 await assert.rejects(changed.start({nodeId:'world',referenceIds:['image'],prompt:''}),{code:'world_source_changed'});assert.equal(changed.calls,0);
});

function canvasAddFixture(){
 const fs=require('node:fs'),source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
 const prefix="case 'canvas_add':{",start=source.indexOf(prefix),end=source.indexOf("case 'canvas_update':",start);
 assert(start>=0&&end>start,'production canvas_add case must exist');
 const block=source.slice(start+prefix.length,end).trim();assert(block.endsWith('}'));
 const original=block.slice(0,-1),body=original.replace("await import('./src/features/world-node/model.mjs')",'await loadModel()');
 assert.notEqual(body,original,'the production dynamic import must be controllable');
 // Run the production case unchanged except for its module loader. The host
 // inverse matches CanvasApp.newNode's screen-to-world coordinate conversion.
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('app','a','signal','loadModel',body),nodes=[];
 let view={scale:1,x:0,y:0},release;
 const app={getState:()=>({view}),addNode(type,point,image,title,initial){
  const node={...initial,id:'created-world',type,title,x:(point.x-view.x)/view.scale,y:(point.y-view.y)/view.scale};nodes.push(node);return node;
 },updateNode(){}};
 return {nodes,setView:next=>{view=next;},release:module=>release(module),start:signal=>execute(app,{type:'world',title:'World',x:100,y:200},signal,()=>new Promise(resolve=>{release=resolve;}))};
}
test('world canvas_add preserves requested world coordinates when view changes during module loading',async()=>{
 const model=await import('../src/features/world-node/model.mjs'),f=canvasAddFixture(),pending=f.start();
 assert.equal(f.nodes.length,0);f.setView({scale:2,x:300,y:400});f.release(model);
 const result=await pending;assert.deepEqual(result,{id:'created-world',x:100,y:200});
 assert.equal(f.nodes.length,1);assert.equal(f.nodes[0].type,'world');assert.equal(f.nodes[0].width,375);assert.equal(f.nodes[0].worldConfig.model,'tripo-h3');
});
test('world canvas_add creates no late node when cancelled during module loading',async()=>{
 const model=await import('../src/features/world-node/model.mjs'),f=canvasAddFixture(),controller=new AbortController(),pending=f.start(controller.signal);
 controller.abort();f.release(model);await assert.rejects(pending,{name:'AbortError'});assert.equal(f.nodes.length,0);
});
