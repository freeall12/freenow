const {test}=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../src/features/generation-results/workflow.mjs'),import('../src/features/generation-results/plan.mjs')]);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function fixture({type='image',mode='spread',count=2,model='nano-banana-flash',commitGate}={}){
 const [module,core]=await modules,calls={commit:[],clear:[],apply:[]},controller=new AbortController();
 let graph={nodes:[{id:'source',type,x:10.25,y:-30.75,width:250,height:200,title:'Source',...(type==='image'?{image:'original.png'}:type==='video'?{video:'original.mp4'}:{content:'旧文本'}),generation:{model,prompt:'raw prompt',count}},{id:'reference',type:'image',image:'reference.png',x:1000,y:500,width:100,height:100}],edges:[{id:'input',source:'reference',target:'source',purpose:'generation-input',order:0}]};
 const app={getState:()=>graph,async commitGenerationPlan(plan,{isActive}){
  if(!isActive())throw Error('cancelled before commit');core.assertPlanCurrent(plan,graph.nodes,graph.edges);calls.commit.push(plan);graph={nodes:plan.nodes,edges:plan.edges};if(commitGate)await commitGate.promise;return {runId:plan.additionalParameters.batch_id,targetNodeIds:plan.targetNodeIds};
 },clearGenerationResults(id){calls.clear.push(id);for(const node of graph.nodes)if(node.generationRun?.runId===id){delete node.generationRun;delete node.pendingOperation;}},applyGenerationResults(id,patches){calls.apply.push({id,patches:structuredClone(patches)});for(const {id:target,patch} of patches){const node=graph.nodes.find(node=>node.id===target);Object.assign(node,patch);delete node.generationRun;delete node.pendingOperation;}return patches.map(patch=>patch.id);}};
 const workflow=module.createResultWorkflow(app),request={kind:`${type}.generate`,nodeId:'source',prompt:'expanded prompt',inputs:[{type:'image',nodeId:'reference',url:'https://example.test/reference.png'}],parameters:{model,count,prompt:'raw prompt'}};
 const submission=module.captureSubmission(request,graph,mode),prepare=()=>workflow.prepare(request,{jobId:'run',signal:controller.signal},submission);
 return {workflow,request,submission,prepare,controller,calls,state:()=>graph,source:()=>graph.nodes.find(node=>node.id==='source'),job:outputs=>({id:'run',request,outputs})};
}

test('async request preparation rejects changed source media, parameters, references and input edges',async()=>{
 for(const mutate of [f=>{f.source().image='changed.png';},f=>{f.source().generation.prompt='edited';},f=>{f.state().nodes.find(node=>node.id==='reference').image='new-reference.png';},f=>{f.state().edges[0].order=1;}]){
  const f=await fixture(),ready=deferred(),pending=(async()=>{await ready.promise;return f.prepare();})();mutate(f);ready.resolve();await assert.rejects(pending,/变化/);assert.equal(f.calls.commit.length,0);assert.equal(f.calls.apply.length,0);
 }
});
test('preparation permits source movement and retains raw prompt while keeping prepared request text',async()=>{
 const f=await fixture();f.source().x=99.125;f.source().y=-88.75;const prepared=await f.prepare(),plan=f.calls.commit[0];assert.equal(prepared.prompt,'expanded prompt');assert.ok(plan.pendingTargetNodes.every(node=>node.generation.prompt==='raw prompt'));assert.equal(plan.pendingTargetNodes[0].x,99.125+250+64);assert.equal(plan.pendingTargetNodes[0].y,-88.75);
});
test('captured direct-submit prompt wins old node defaults while expanded request text remains intact',async()=>{
 const [module]=await modules;
 for(const type of ['image','text']){
  const f=await fixture({type});f.request.prompt='本次 Agent 新提示词';delete f.request.parameters.prompt;
  const submission=module.captureSubmission(f.request,f.state(),'spread'),prepared={...f.request,prompt:'上游文本 + 展开后的本次提示词',parameters:{...f.request.parameters,prompt:'旧编辑器默认提示词'}};
  const result=await f.workflow.prepare(prepared,{jobId:'run',signal:f.controller.signal},submission);assert.equal(result.prompt,prepared.prompt);assert.ok(f.calls.commit[0].pendingTargetNodes.every(node=>node.generation.prompt==='本次 Agent 新提示词'));assert.equal(f.calls.commit[0].preservesSourceNode,type==='image');
 }
});
test('cancellation between graph commit and promise resolution clears committed placeholders once',async()=>{
 const gate=deferred(),f=await fixture({commitGate:gate}),pending=f.prepare();assert.equal(f.calls.commit.length,1);assert.ok(f.state().nodes.some(node=>node.pendingOperation));
 f.controller.abort();f.workflow.clear('run');assert.equal(f.calls.clear.length,0,'commit has not resolved yet');gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(f.calls.clear,['run']);assert.ok(f.state().nodes.every(node=>!node.pendingOperation&&!node.generationRun));f.workflow.clear('run');assert.equal(f.calls.clear.length,1);
});
test('cancellation during media validation prevents every result patch',async()=>{
 const f=await fixture();await f.prepare();const gate=deferred(),outputs=[0,1].map(i=>({type:'image',url:`https://example.test/${i}.png`}));let validations=0;
 const pending=f.workflow.apply(f.job(outputs),async()=>{validations++;await gate.promise;});assert.equal(validations,2);f.workflow.clear('run');gate.resolve();await assert.rejects(pending,/取消/);assert.equal(f.calls.apply.length,0);assert.equal(f.calls.clear.length,1);
});
test('wrong count, wrong type and failed media validation never partially apply',async()=>{
 for(const scenario of ['count','type','decode']){
  const f=await fixture();await f.prepare();const outputs=[{type:'image',url:'https://example.test/0.png'},{type:'image',url:'https://example.test/1.png'}];if(scenario==='count')outputs.pop();if(scenario==='type')outputs[1].type='video';let validated=0;
  await assert.rejects(f.workflow.apply(f.job(outputs),async()=>{validated++;if(scenario==='decode')throw Error('decode failed');}));assert.equal(f.calls.apply.length,0);if(scenario!=='decode')assert.equal(validated,0);
  f.workflow.clear('run');assert.equal(f.calls.clear.length,1);assert.ok(f.state().nodes.every(node=>!node.pendingOperation));
 }
});
test('image and video variants bypass result planning and remain on existing history path',async()=>{
 for(const type of ['image','video']){const f=await fixture({type,mode:'variants'}),prepared=await f.prepare();assert.equal(prepared,f.request);assert.equal(f.calls.commit.length,0);assert.equal(f.workflow.has('run'),false);assert.equal(await f.workflow.apply(f.job([]),()=>assert.fail('must not validate')),null);}
});
test('text variants replace first content and map every ordered output to a distinct planned target',async()=>{
 const f=await fixture({type:'text',mode:'variants',count:3}),prepared=await f.prepare(),plan=f.calls.commit[0];assert.equal(plan.targetNodeIds[0],'source');assert.equal(plan.pendingTargetNodes[0].content,'旧文本');assert.ok(plan.pendingTargetNodes.slice(1).every(node=>node.content===''));
 const outputs=['甲','乙','丙'].map(text=>({type:'text',text})),ids=await f.workflow.apply({...f.job(outputs),request:prepared},async()=>{});assert.deepEqual(ids,plan.targetNodeIds);assert.equal(f.calls.apply.length,1);assert.deepEqual(ids.map(id=>f.state().nodes.find(node=>node.id===id).content),['甲','乙','丙']);assert.ok(ids.every(id=>f.state().nodes.find(node=>node.id===id).textMode==='generate'));
});
test('MJ eight results retain two provider requests with four ordered targets each',async()=>{
 const f=await fixture({count:2,model:'midjourney-v8.2'}),prepared=await f.prepare(),results=prepared.parameters.canvasResults;assert.equal(results.targetNodeIds.length,8);assert.equal(prepared.parameters.count,2);assert.equal(prepared.parameters.batch_count,2);assert.deepEqual(results.requestPlans.map(plan=>plan.targets.map(target=>target.resultIndex)),[[0,1,2,3],[0,1,2,3]]);assert.deepEqual(results.requestPlans.flatMap(plan=>plan.targets.map(target=>target.nodeId)),results.targetNodeIds);
 const outputs=Array.from({length:8},(_,i)=>({type:'image',url:`https://example.test/${i}.png`}));await f.workflow.apply(f.job(outputs),async()=>{});assert.deepEqual(f.calls.apply[0].patches.map(patch=>patch.id),results.targetNodeIds);assert.deepEqual(f.calls.apply[0].patches.map(patch=>patch.patch.image),outputs.map(output=>output.url));
});
test('decoded media dimensions and real provider file identity survive result mapping',async()=>{
 for(const type of ['image','video']){
  const f=await fixture({type,count:1});await f.prepare();const output={type,url:`https://example.test/result.${type==='image'?'png':'mp4'}`,sourceFileId:'provider-file-123'};
  await f.workflow.apply(f.job([output]),async value=>Object.assign(value,{width:1920,height:1080,...(type==='video'?{duration:8.5}:{})}));const patch=f.calls.apply[0].patches[0].patch;assert.equal(patch.pixelWidth,1920);assert.equal(patch.pixelHeight,1080);assert.equal(patch.currentSourceFileId,'provider-file-123');if(type==='video')assert.deepEqual(patch.videoMetadata,{width:1920,height:1080,duration:8.5});
 }
});
test('missing provider file identity becomes null instead of an invented or inherited identifier',async()=>{
 for(const type of ['image','video']){
  const f=await fixture({type,count:1});await f.prepare();await f.workflow.apply(f.job([{type,url:'https://example.test/result'}]),async()=>{});assert.equal(f.calls.apply[0].patches[0].patch.currentSourceFileId,null);
 }
});
