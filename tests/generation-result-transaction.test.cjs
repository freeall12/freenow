const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const planner=import('../src/features/generation-results/plan.mjs'),source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function named(name){const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start);return source.slice(start,end);}
function method(name,next){const start=source.indexOf(`    ${name}(`),end=source.indexOf(`\n    ${next}(`,start+1);assert.ok(start>=0&&end>start);return source.slice(start,end).trim().replace(/,$/,'');}
async function harness({modulePromise,originalFullImage}={}){
 const core=await planner,saves=[];let serial=0;
 const fixture={nodes:[{id:'a',type:'image',title:'Source',image:'original.png',x:10.25,y:20.75,width:250,height:200,generation:{prompt:'draw',count:2}},{id:'b',type:'image',image:'ref.png',x:700,y:400,width:100,height:100}],edges:[{id:'e',source:'b',target:'a',purpose:'generation-input'}]};
 if(originalFullImage)fixture.nodes[0].fullImage=originalFullImage;
 const root={children:[],get firstElementChild(){return this.children[0]||null;},insertBefore(el,before){this.children=this.children.filter(item=>item!==el);const index=before?this.children.indexOf(before):-1;index<0?this.children.push(el):this.children.splice(index,0,el);}};
 const context=vm.createContext({fixture,root,modulePromise:modulePromise||Promise.resolve(core),structuredClone,localStorage:{setItem(){}},window:{CanvasStore:{save:state=>{saves.push(structuredClone(state));return Promise.resolve();}},CanvasPiles:require('../canvas-piles.js'),CanvasGroups:require('../canvas-groups.js'),CanvasConnections:{cancel(){},clearSelection(){}},PileMotion:{cancel(){}}}});
 vm.runInContext(`
 const clone=value=>structuredClone(value),original=new Map(fixture.nodes.map(node=>[node.id,clone(node)]));let nodes=clone(fixture.nodes),edges=clone(fixture.edges),selected=new Set(['b']),history=[],future=[],localChanges=0,graphLoaded=true,generationPlanModule=modulePromise;
 const generationRuns=new Map(),nodeElements=new Map(),nodeRecords=new Map(),pathElements=new Map(),$=selector=>selector==='#storage-notice'?null:root;
 const flushGesture=()=>{},storageError=()=>{},render=()=>{};let saveRevision=0,graphReadFailed=false;
 function syncNodeShell(){}
 function makeNode(node,before){const el={get nextElementSibling(){return root.children[root.children.indexOf(this)+1]||null;}};root.insertBefore(el,before);nodeElements.set(node.id,el);nodeRecords.set(node.id,{node,content:nodeContentKey(node)});}
 function removeNodeElement(id){const el=nodeElements.get(id);root.children=root.children.filter(item=>item!==el);nodeElements.delete(id);nodeRecords.delete(id);}
 ${['remember','persist','undo','nodeContentKey','rebuild','rebuildAndPersist','generationSignature','generationTargetMatches','clearOrphanGenerationState','removeSelected'].map(named).join('\n')}
 globalThis.api={${[method('async commitGenerationPlan','applyGenerationResults'),method('applyGenerationResults','clearGenerationResults'),method('clearGenerationResults','updateNode')].join(',\n')},undo};
 globalThis.probe={liveNode:id=>nodes.find(node=>node.id===id),state:()=>clone({nodes,edges,selected:[...selected]}),edit:(id,patch)=>Object.assign(nodes.find(node=>node.id===id),patch),add:node=>nodes.push(clone(node)),remember,history:()=>history.length,resetReload:()=>{nodes=clone(fixture.nodes);edges=clone(fixture.edges);history=[];future=[];localChanges=0;graphLoaded=false;generationRuns.clear();nodeRecords.clear();nodeElements.clear();root.children=[];rebuild();},replace:id=>{nodes=nodes.map(node=>node.id===id?clone(node):node);},drop:id=>{nodes=nodes.filter(node=>node.id!==id);},remove:id=>{selected=new Set([id]);removeSelected();}};
 rebuild();
 `,context);
 saves.length=0;
 const hydration=source.slice(source.indexOf('  window.CanvasStore.load().then'),source.lastIndexOf('\n})();')).trim();
 context.probe.reload=async saved=>{context.probe.resetReload();context.window.CanvasStore.load=()=>Promise.resolve(structuredClone(saved));await vm.runInContext(hydration,context);};
 return {api:context.api,probe:context.probe,saves,core,state:()=>structuredClone(context.probe.state()),plan(options={}){const graph=context.probe.state();return core.planGenerationResults({...graph,sourceNodeId:'a',resultCount:2,runId:`run-${++serial}`,idFactory:kind=>`${kind}-${++serial}`,...options});}};
}
const results=(ids)=>ids.map((id,index)=>({id,patch:{image:`result-${index}.png`,fullImage:`result-${index}.png`,pixelWidth:1000,pixelHeight:800}}));

test('commit applies only planned changes once, preserves selection, and undo restores graph',async()=>{
 const f=await harness(),plan=f.plan(),before=f.state();f.probe.edit('b',{title:'unrelated reference rename'});
 // Re-plan after a reference content edit; unrelated nodes introduced after planning remain intact.
 const fresh=f.plan();f.probe.add({id:'unrelated',type:'text',content:'keep me',x:100,y:100,width:100,height:100});const committed=await f.api.commitGenerationPlan(fresh,{isActive:()=>true});assert.deepEqual(structuredClone(committed),{runId:fresh.additionalParameters.batch_id,targetNodeIds:fresh.targetNodeIds});assert.equal(f.saves.length,1);assert.deepEqual(f.state().selected,before.selected);assert.equal(f.state().nodes.find(node=>node.id==='b').title,'unrelated reference rename');assert.equal(f.state().nodes.find(node=>node.id==='unrelated').content,'keep me');
 f.api.undo();assert.equal(f.state().nodes.length,before.nodes.length+1);assert.deepEqual(f.state().edges,before.edges);assert.equal(f.state().nodes.find(node=>node.id==='a').image,'original.png');
});
test('commit checks cancellation and stale source only after awaited module readiness',async()=>{
 let resolve;const modulePromise=new Promise(done=>{resolve=done;}),f=await harness({modulePromise}),plan=f.plan();let active=true;const committing=f.api.commitGenerationPlan(plan,{isActive:()=>active});active=false;resolve(f.core);await assert.rejects(committing,/取消/);assert.equal(f.saves.length,0);assert.equal(f.probe.history(),0);
 let release;const second=await harness({modulePromise:new Promise(done=>{release=done;})}),next=second.plan(),pending=second.api.commitGenerationPlan(next);second.probe.edit('a',{image:'edited.png'});release(second.core);await assert.rejects(pending,/变化/);assert.equal(second.saves.length,0);assert.equal(second.probe.history(),0);
});
test('invalid planned edge is rejected before any node or history mutation',async()=>{
 const f=await harness(),plan=f.plan(),before=f.state();plan.edgeChanges[0].item.source='missing';await assert.rejects(f.api.commitGenerationPlan(plan),/连线/);assert.deepEqual(f.state(),before);assert.equal(f.saves.length,0);assert.equal(f.probe.history(),0);
});
test('all results apply atomically after source edits and target movement, then clear task fields',async()=>{
 const f=await harness(),plan=f.plan(),{runId,targetNodeIds}=await f.api.commitGenerationPlan(plan);f.probe.edit('a',{image:'source-new.png'});f.probe.edit(targetNodeIds[0],{x:999.125,y:-12.75});
 const selection=f.state().selected,applied=f.api.applyGenerationResults(runId,results(targetNodeIds));assert.deepEqual([...applied],[...targetNodeIds]);assert.equal(f.saves.length,2);assert.deepEqual(f.state().selected,selection);
 const targets=f.state().nodes.filter(node=>targetNodeIds.includes(node.id));assert.ok(targets.every(node=>!Object.hasOwn(node,'generationRun')&&!Object.hasOwn(node,'pendingOperation')));assert.equal(targets[0].x,999.125);assert.equal(targets[0].y,-12.75);assert.equal(f.state().nodes.find(node=>node.id==='a').image,'source-new.png');
 f.api.undo();assert.ok(f.state().nodes.filter(node=>targetNodeIds.includes(node.id)).every(node=>!node.pendingOperation&&!node.generationRun));assert.throws(()=>f.api.applyGenerationResults(runId,results(targetNodeIds)),/完整/);
 const again=f.plan({sourceNodeId:targetNodeIds[0],resultCount:1}),next=await f.api.commitGenerationPlan(again);assert.deepEqual([...f.api.applyGenerationResults(next.runId,results(next.targetNodeIds))],[...next.targetNodeIds]);
});
test('partial, duplicate, edited or deleted targets never receive partial result patches',async()=>{
 for(const scenario of ['partial','duplicate','edited','deleted-restored','identity-patch']){
  const f=await harness(),{runId,targetNodeIds:ids}=await f.api.commitGenerationPlan(f.plan());let patches=results(ids);
  if(scenario==='partial')patches.pop();if(scenario==='duplicate')patches[1].id=ids[0];if(scenario==='edited')f.probe.edit(ids[1],{title:'user edit'});if(scenario==='deleted-restored'){f.probe.remove(ids[1]);f.api.undo();}if(scenario==='identity-patch')patches[0].patch.id='replacement';
  const before=f.state(),saved=f.saves.length,history=f.probe.history();assert.throws(()=>f.api.applyGenerationResults(runId,patches));assert.deepEqual(f.state(),before);assert.equal(f.saves.length,saved);assert.equal(f.probe.history(),history);
 }
});
test('clear preserves edited placeholders and source, skipping deleted-and-restored identities',async()=>{
 const f=await harness(),{runId,targetNodeIds:ids}=await f.api.commitGenerationPlan(f.plan());f.probe.edit('a',{title:'source edited'});f.probe.edit(ids[0],{title:'keep me',image:'user.png'});f.probe.remove(ids[1]);f.api.undo();const saved=f.saves.length;
 assert.deepEqual([...f.api.clearGenerationResults(runId)],[ids[0]]);assert.equal(f.saves.length,saved+1);const kept=f.state().nodes.find(node=>node.id===ids[0]),restored=f.state().nodes.find(node=>node.id===ids[1]);assert.equal(kept.title,'keep me');assert.equal(kept.image,'user.png');assert.equal(kept.pendingOperation,undefined);assert.equal(restored.generationRun,undefined);assert.equal(restored.pendingOperation,undefined);assert.equal(f.state().nodes.find(node=>node.id==='a').title,'source edited');
 assert.deepEqual([...f.api.clearGenerationResults(runId)],[]);assert.equal(f.saves.length,saved+1);
});
test('clear does not clear a different task token or mutate selection',async()=>{
 const f=await harness(),{runId,targetNodeIds:ids}=await f.api.commitGenerationPlan(f.plan());f.probe.edit(ids[0],{generationRun:{runId:'different',requestId:'other',resultIndex:0}});const selection=f.state().selected;assert.deepEqual([...f.api.clearGenerationResults(runId)],[ids[1]]);assert.equal(f.state().nodes.find(node=>node.id===ids[0]).generationRun.runId,'different');assert.deepEqual(f.state().selected,selection);
});
test('reused source targets and pile members apply through reconciled live node identities',async()=>{
 for(const mode of ['empty-image','text','pile']){
  const f=await harness();if(mode==='empty-image')f.probe.edit('a',{image:''});if(mode==='text')f.probe.edit('a',{type:'text',content:'old text'});
  const plan=f.plan({resultLayout:mode==='pile'?'pile':mode==='text'?'variants':'spread'}),{runId,targetNodeIds:ids}=await f.api.commitGenerationPlan(plan);
  if(mode!=='pile')assert.equal(ids[0],'a');else assert.deepEqual(f.state().nodes.find(node=>node.type==='pile').memberIds,plan.layoutNodeIds);
  const patches=mode==='text'?ids.map((id,index)=>({id,patch:{content:`new text ${index}`}})):results(ids);assert.deepEqual([...f.api.applyGenerationResults(runId,patches)],[...ids]);assert.equal(f.saves.length,2);
  if(mode==='text')assert.equal(f.state().nodes.find(node=>node.id==='a').content,'new text 0');
 }
});
test('undoing source or target movement retains live ownership and accepts valid late results',async()=>{
 for(const moveSource of [true,false]){
  const f=await harness(),{runId,targetNodeIds:ids}=await f.api.commitGenerationPlan(f.plan()),id=moveSource?'a':ids[0],before=f.state().nodes.find(node=>node.id===id);
  f.probe.remember();f.probe.edit(id,{x:before.x+125.375,y:before.y-80.625});f.api.undo();
  assert.equal(f.state().nodes.find(node=>node.id===id).x,before.x);assert.ok(f.state().nodes.filter(node=>ids.includes(node.id)).every(node=>node.generationRun?.runId===runId));
  assert.deepEqual([...f.api.applyGenerationResults(runId,results(ids))],[...ids]);
 }
});
test('deleting then undoing a target immediately removes its stale marker and blocks late apply',async()=>{
 const f=await harness(),{runId,targetNodeIds:ids}=await f.api.commitGenerationPlan(f.plan());f.probe.remove(ids[0]);f.api.undo();const restored=f.state().nodes.find(node=>node.id===ids[0]);
 assert.equal(restored.generationRun,undefined);assert.equal(restored.pendingOperation,undefined);assert.equal(f.state().nodes.find(node=>node.id===ids[1]).generationRun.runId,runId);
 const before=f.state();assert.throws(()=>f.api.applyGenerationResults(runId,results(ids)),/目标/);assert.deepEqual(f.state(),before);assert.deepEqual([...f.api.clearGenerationResults(runId)],[ids[1]]);
});

test('failure receipts expose only unchanged live owned targets without editing history or markers',async()=>{
 const f=await harness(),{runId,targetNodeIds:ids}=await f.api.commitGenerationPlan(f.plan());const saves=f.saves.length,history=f.probe.history();
 assert.deepEqual([...f.api.getGenerationFailureTargets(runId)].map(n=>n.id),[...ids]);
 f.probe.edit(ids[0],{x:900.125,y:-5.75});assert.equal(f.api.getGenerationFailureTargets(runId).length,2);
 f.probe.edit(ids[1],{title:'user edit'});assert.deepEqual([...f.api.getGenerationFailureTargets(runId)].map(n=>n.id),[ids[0]]);
 assert.equal(f.saves.length,saves);assert.equal(f.probe.history(),history);assert.equal(f.state().nodes.find(n=>n.id===ids[0]).generationRun.runId,runId);
 f.api.clearGenerationResults(runId);assert.equal(f.api.getGenerationFailureTargets(runId).length,0);
});

const recoveryWorkflow=import('../src/features/generation-results/workflow.mjs');
async function recoveryFixture(status='succeeded',{type='image',mode='spread'}={}){
 const f=await harness();if(type==='text')f.probe.edit('a',{type,content:'old text'});if(type==='video')f.probe.edit('a',{type,video:'old.mp4'});
 const plan=f.plan({resultLayout:mode}),committed=await f.api.commitGenerationPlan(plan);
 const job={id:committed.runId,status,request:{kind:`${type}.generate`,parameters:{canvasResults:{runId:committed.runId,targetNodeIds:plan.targetNodeIds,requestPlans:plan.requestPlans}}},outputs:plan.targetNodeIds.map((_,i)=>({type:'image',url:`https://example.test/result-${i}.png`}))};
 assert.ok(f.saves[0].nodes.filter(node=>plan.targetNodeIds.includes(node.id)).every(node=>node.generationRecovery?.version===1));
 await f.probe.reload(f.saves[0]);
 return {...f,job,ids:plan.targetNodeIds,workflow:(await recoveryWorkflow).createResultWorkflow(f.api)};
}
test('persisted baselines restore exact existing targets after load without graph or history mutations',async()=>{
 const f=await recoveryFixture(),before=f.state(),saved=f.saves.length,history=f.probe.history();
 const restored=f.workflow.restore(f.job);assert.equal(restored.restored,true);assert.deepEqual([...restored.targetNodeIds],[...f.ids]);assert.deepEqual(f.state(),before);assert.equal(f.saves.length,saved);assert.equal(f.probe.history(),history);
 assert.equal(f.workflow.restore(f.job).restored,false);
 f.probe.edit(f.ids[0],{x:999.125,y:-333.75});
 const applied=await f.workflow.apply(f.job,async output=>Object.assign(output,{width:1920,height:1080}));assert.deepEqual([...applied],[...f.ids]);assert.equal(f.state().nodes.length,before.nodes.length);assert.deepEqual(f.state().edges,before.edges);
 for(const [index,id]of f.ids.entries()){const node=f.state().nodes.find(node=>node.id===id);assert.equal(node.image,f.job.outputs[index].url);assert.equal(node.pixelWidth,1920);assert.equal(node.generationRecovery,undefined);assert.equal(node.generationRun,undefined);assert.equal(node.pendingOperation,undefined);}
 assert.equal(f.state().nodes.find(node=>node.id===f.ids[0]).x,999.125);assert.equal(f.state().nodes.find(node=>node.id===f.ids[0]).y,-333.75);
});
test('recovery rejects absent baseline, edits, missing or duplicate targets and mismatched request mapping atomically',async()=>{
 for(const scenario of ['baseline','title','media','config','missing','duplicate','run','request','index','batch','live-request']){
  const f=await recoveryFixture(),id=f.ids[0],node=f.state().nodes.find(node=>node.id===id);
  if(scenario==='baseline')f.probe.edit(id,{generationRecovery:undefined});
  if(scenario==='title')f.probe.edit(id,{title:'edited'});
  if(scenario==='media')f.probe.edit(id,{image:'user.png'});
  if(scenario==='config')f.probe.edit(id,{generation:{...node.generation,prompt:'edited'}});
  if(scenario==='missing')f.probe.drop(id);
  if(scenario==='duplicate')f.probe.add(node);
  if(scenario==='run')f.job.id='another-run';
  if(scenario==='live-request')f.workflow.restore(f.job);
  if(['request','live-request'].includes(scenario))f.job.request.parameters.canvasResults.requestPlans[0].requestId='wrong-request';
  if(scenario==='index')f.job.request.parameters.canvasResults.requestPlans[0].targets[0].resultIndex=9;
  if(scenario==='batch')f.job.request.parameters.canvasResults.targetNodeIds.reverse();
  const before=f.state(),saved=f.saves.length,history=f.probe.history();assert.throws(()=>f.workflow.restore(f.job),undefined,scenario);assert.deepEqual(f.state(),before,scenario);assert.equal(f.saves.length,saved);assert.equal(f.probe.history(),history);
 }
});
test('late edits or identity replacement after restoration prevent all decoded result application',async()=>{
 for(const scenario of ['edit','identity']){
  const f=await recoveryFixture();f.workflow.restore(f.job);let release;const gate=new Promise(resolve=>{release=resolve;}),pending=f.workflow.apply(f.job,()=>gate);
  if(scenario==='edit')f.probe.edit(f.ids[1],{title:'edited during decode'});else f.probe.replace(f.ids[1]);
  const before=f.state(),saved=f.saves.length,history=f.probe.history();release();await assert.rejects(pending,/目标/);assert.deepEqual(f.state(),before);assert.equal(f.saves.length,saved);assert.equal(f.probe.history(),history);
 }
});
test('cancelled and failed reloaded jobs are cleanup only and never clear edited recovered targets',async()=>{
 for(const status of ['cancelled','failed','configuration_required']){
  const f=await recoveryFixture(status);f.workflow.restore(f.job);await assert.rejects(f.workflow.apply(f.job,()=>assert.fail('must not decode')),/取消/);
  f.probe.edit(f.ids[0],{title:'keep edited target'});const edited=f.state().nodes.find(node=>node.id===f.ids[0]),count=f.state().nodes.length;
  f.workflow.clear(f.job.id);assert.deepEqual(f.state().nodes.find(node=>node.id===f.ids[0]),edited);assert.equal(f.state().nodes.length,count);
  const cleared=f.state().nodes.find(node=>node.id===f.ids[1]);assert.equal(cleared.pendingOperation,undefined);assert.equal(cleared.generationRecovery,undefined);assert.equal(cleared.generationRun,undefined);
  const saved=f.saves.length;f.workflow.clear(f.job.id);assert.equal(f.saves.length,saved);await assert.rejects(f.workflow.apply(f.job,()=>{}),/取消/);
 }
});

test('actual saved graph hydration preserves recoverable text, video and pile baselines without a write',async()=>{
 for(const options of [{type:'text',mode:'variants'},{type:'video'},{type:'image',mode:'pile'}]){
  const f=await recoveryFixture('succeeded',options);assert.equal(f.saves.length,1);assert.equal(f.probe.history(),0);
  assert.ok(f.state().nodes.filter(node=>f.ids.includes(node.id)).every(node=>node.generationRun?.runId===f.job.id));
  assert.equal(f.workflow.restore(f.job).restored,true);assert.equal(f.saves.length,1);assert.equal(f.probe.history(),0);
 }
});

test('hydration never backfills seed media into a verifiable pending empty source',async()=>{
 const f=await harness({originalFullImage:'seed-original.png'});f.probe.edit('a',{image:'',fullImage:''});
 const plan=f.plan(),committed=await f.api.commitGenerationPlan(plan);assert.equal(committed.targetNodeIds[0],'a');
 await f.probe.reload(f.saves[0]);assert.equal(f.state().nodes.find(node=>node.id==='a').fullImage,'');
 const restored=f.api.restoreGenerationResults({runId:committed.runId,kind:'image.generate',targetNodeIds:plan.targetNodeIds,requestPlans:plan.requestPlans});assert.equal(restored.restored,true);assert.equal(f.saves.length,1);assert.equal(f.probe.history(),0);
});

test('commit exposes exact host replacement identities only in memory, without serializing callbacks or graph receipts',async()=>{
 const f=await harness();f.probe.edit('a',{image:''});const before=f.probe.liveNode('a'),receipt=await f.api.commitGenerationPlan(f.plan());
 const pair=receipt.replacements.find(value=>value.before===before);assert.ok(pair);assert.equal(pair.after,f.probe.liveNode('a'));assert.notEqual(pair.before,pair.after);
 assert.equal(pair.before.pendingOperation,undefined);assert.equal(pair.before.generation.count,2);assert.equal(pair.after.pendingOperation,'image.generate');
 assert.equal(Object.keys(receipt).includes('replacements'),false);assert.equal(structuredClone(receipt).replacements,undefined);
});

test('actual host replacement receipt rebases Agent dispatch guard without rewriting its original source',async()=>{
 const {prepareAgentMediaInputs}=await import('../src/features/agent-generation/media-inputs.mjs');
 const {createResultWorkflow,captureSubmission}=await recoveryWorkflow;
 const f=await harness();f.probe.edit('a',{image:''});const source=f.probe.liveNode('a'),reference=f.probe.liveNode('b'),original=structuredClone(source);
 const prepared=await prepareAgentMediaInputs([reference],{guardNodes:[source],getNode:id=>f.probe.liveNode(id),deferTransport:true,resolveMedia:async node=>({id:node.id,type:'image',url:'https://media.example/reference.png'})});
 f.api.getState=f.state;
 const workflow=createResultWorkflow(f.api),request={kind:'image.generate',nodeId:'a',prompt:'new prompt',inputs:prepared.inputs,parameters:{model:'nano-banana-flash',count:2}};
 const submission=captureSubmission(request,f.state(),'spread');
 await workflow.prepare(request,{jobId:'actual-host',signal:new AbortController().signal,validateSources:prepared.guard,acceptSourceReplacements:prepared.guard.acceptReplacements},submission);
 assert.deepEqual(source,original);assert.notEqual(f.probe.liveNode('a'),source);assert.doesNotThrow(prepared.guard);
 assert.equal(f.probe.liveNode('a').generation.prompt,'new prompt');
 f.probe.replace('a');assert.throws(prepared.guard,/替换/);
});
