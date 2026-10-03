const test=require('node:test'),assert=require('node:assert/strict');
const moduleReady=import('../src/features/video-trim/result-transaction.mjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(){
 const module=await moduleReady,node={id:'source',type:'video',video:'asset:source',clip:{start:1,end:8},x:1,y:2},state={nodes:[node],edges:[]};
 let project='one',creates=0,saves=0,saveHook=async()=>{};
 const app={projectIdentity:()=>({id:project}),getState:()=>state,createConnected:(id,outputs)=>{creates++;const added=outputs.map((output,index)=>({...output,id:'result-'+index,x:100,y:index*200}));state.nodes.push(...added);state.edges.push(...added.map(node=>({id:'edge-'+node.id,source:id,target:node.id})));return added;},saveProject:async()=>{saves++;return saveHook();}};
 const owner=module.captureTrimOwner(app,node,node=>node.video),controller=new AbortController(),transaction=module.createTrimResultTransaction({app,owner,sourceId:node.id,signal:controller.signal});
 return {module,node,state,app,owner,controller,transaction,outputs:[{type:'video',video:'data:video/mp4;base64,YQ==',title:'剪辑结果',clipParams:{start:2,end:4}}],setProject:value=>{project=value;},setSave:fn=>{saveHook=fn;},counts:()=>({creates,saves})};
}

test('captured ownership rejects same ID/media in another project and undo replacement; movement stays valid',async()=>{
 for(const mode of ['project','replacement','clip','source','remove']){
  const f=await fixture();if(mode==='project')f.setProject('two');if(mode==='replacement')f.state.nodes[0]={...f.node};if(mode==='clip')f.node.clip.end=9;if(mode==='source')f.node.video='asset:changed';if(mode==='remove')f.state.nodes=[];
  assert.throws(()=>f.owner.assertCurrent(),error=>error.code==='trim_source_changed');assert.throws(()=>f.transaction.apply(f.outputs),error=>error.code==='trim_source_changed');assert.equal(f.counts().creates,0);
 }
 const f=await fixture();f.node.x=100;f.node.y=200;assert.equal(f.owner.assertCurrent(),f.node);await f.transaction.apply(f.outputs);assert.deepEqual(f.counts(),{creates:1,saves:1});
});

test('cancelled operation never inserts late outputs',async()=>{
 const f=await fixture();f.controller.abort();assert.throws(()=>f.transaction.apply(f.outputs),error=>error.name==='AbortError');assert.equal(f.state.nodes.length,1);
});

test('save acknowledgement gates success and concurrent retry reuses one insertion',async()=>{
 const f=await fixture(),gate=deferred();f.setSave(()=>gate.promise);const pending=f.transaction.apply(f.outputs);assert.equal(f.transaction.status().applied,true);assert.equal(f.transaction.status().persisted,false);
 const retry=f.transaction.retrySave();assert.equal(pending,retry);gate.resolve();assert.equal((await pending).persisted,true);await f.transaction.apply(f.outputs);assert.deepEqual(f.counts(),{creates:1,saves:1});
});

test('failed save keeps complete batch and retry only saves exact results and edges',async()=>{
 const f=await fixture();f.outputs.push({...f.outputs[0],title:'第二个真实剪辑结果'});f.setSave(async()=>{throw Error('disk full');});
 await assert.rejects(f.transaction.apply(f.outputs),error=>error.code==='trim_save_failed'&&error.applied&&error.nodeIds.length===2);
 assert.equal(f.state.nodes.length,3);assert.equal(f.state.edges.length,2);f.setSave(async()=>{});f.state.nodes[1].x=450;
 const [a,b]=await Promise.all([f.transaction.retrySave(),f.transaction.apply(f.outputs)]);assert.deepEqual(a,b);assert.deepEqual(f.counts(),{creates:1,saves:2});
});

test('saving cannot acknowledge a different project or results changed during the write',async()=>{
 for(const mode of ['project','result','edge','replacement']){
  const f=await fixture(),gate=deferred();f.setSave(()=>gate.promise);const pending=f.transaction.apply(f.outputs);
  if(mode==='project')f.setProject('two');if(mode==='result')f.state.nodes[1].video='asset:other';if(mode==='edge')f.state.edges[0].target='elsewhere';if(mode==='replacement')f.state.nodes[1]={...f.state.nodes[1]};
  gate.resolve();await assert.rejects(pending,error=>error.code==='trim_result_changed');assert.equal(f.transaction.status().persisted,false);
 }
});

test('undo, edits, edge changes, and project switches refuse retry without rebuilding outputs',async()=>{
 for(const mode of ['undo','edited','project','edge','replacement']){
  const f=await fixture();f.setSave(async()=>{throw Error('disk full');});await assert.rejects(f.transaction.apply(f.outputs));f.setSave(async()=>{});
  if(mode==='undo')f.state.nodes.pop();if(mode==='edited')f.state.nodes[1].title='user edit';if(mode==='project')f.setProject('two');if(mode==='edge')f.state.edges=[];if(mode==='replacement')f.state.nodes[1]={...f.state.nodes[1]};
  await assert.rejects(f.transaction.retrySave(),error=>error.code==='trim_result_changed');assert.deepEqual(f.counts(),{creates:1,saves:1});
 }
});

test('stopping after visible insertion preserves the result and still confirms its save',async()=>{
 const f=await fixture(),gate=deferred();f.setSave(()=>gate.promise);const pending=f.transaction.apply(f.outputs);f.controller.abort();gate.resolve();assert.equal((await pending).persisted,true);assert.equal(f.state.nodes.length,2);
});
