'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const request={operationId:'trim-one',nodeId:'source',start:1,end:3,timeBasis:'node'};
async function fixture(overrides={}){
 const {createAgentVideoTrim}=await import('../src/features/agent-media/video-trim.mjs');
 const source={id:'source',type:'video',video:'asset:source',width:400,height:225,clip:{start:10,end:20}},state={nodes:[source],edges:[]};
 const calls={process:[],put:0,save:0,decode:0,revoke:0};let saveFails=false;
 const options={app:{getState:()=>state,createConnected:(id,outputs)=>{const added=outputs.map((node,i)=>({...node,id:'output-'+(state.nodes.length+i),sourceId:id}));state.nodes.push(...added);state.edges.push(...added.map(node=>({source:id,target:node.id})));return added;}},
  localMedia:{process:async(op,blob,args)=>{calls.process.push({op,args});return new Blob(['real-output'],{type:'video/mp4'});}},
  localAssets:{url:async value=>'https://media.test/'+value,put:async()=>{calls.put++;return 'asset:result';}},
  store:{save:async()=>{calls.save++;if(saveFails)throw Error('disk full');}},
  fetchImpl:async()=>({ok:true,headers:{get:()=>null},blob:async()=>new Blob(['input'],{type:'video/mp4'})}),
  resolveMedia:async()=>({duration:30,width:1280,height:720}),decode:async()=>{calls.decode++;return {duration:2,width:1280,height:720,poster:'data:image/jpeg;base64,AA=='};},
  createObjectURL:()=> 'blob:output',revokeObjectURL:()=>{calls.revoke++;},...overrides};
 return {host:createAgentVideoTrim(options),newHost:()=>createAgentVideoTrim(options),state,source,calls,options,setSaveFailure:value=>{saveFails=value;}};
}

test('node-relative trim uses absolute source seconds, decoded output metadata and one persisted connected node',async()=>{
 const f=await fixture(),result=await f.host.execute(request);
 assert.deepEqual(f.calls.process.map(({op,args})=>[op,args.start,args.end]),[['trim',11,13]]);
 assert.equal(result.status,'succeeded');assert.equal(result.saved,true);assert.equal(result.applied,true);assert.deepEqual(result.sourceRange,{start:11,end:13});assert.equal(result.duration,2);assert.deepEqual(result.dimensions,{width:1280,height:720});
 assert.equal(f.state.nodes[1].clip,undefined);assert.equal(f.state.nodes[1].video,'asset:result');assert.equal(f.state.nodes[1].width,400);assert.equal(f.calls.save,1);assert.equal(f.calls.revoke,1);
 assert.ok(!JSON.stringify(result).includes('asset:'));assert.ok(!JSON.stringify(result).includes('data:'));
 assert.deepEqual(await f.host.execute(request),result);assert.equal(f.calls.process.length,1);
 await assert.rejects(f.host.execute({...request,end:4}),error=>error.code==='operation_conflict');
});

test('source-absolute ranges do not add node clip offset; invalid ranges never run FFmpeg',async()=>{
 const {absoluteTrimRange}=await import('../src/features/agent-media/video-trim.mjs');
 const f=await fixture();await f.host.execute({...request,timeBasis:'source'});assert.equal(f.calls.process[0].args.start,1);
 assert.throws(()=>absoluteTrimRange({...request,end:11},f.source,30),/超出/);
 assert.throws(()=>absoluteTrimRange({...request,timeBasis:'source',end:31},f.source,30),/超出/);
 assert.throws(()=>absoluteTrimRange(request,{...f.source,trim:{}},30),/格式/);
 assert.throws(()=>f.host.execute({...request,operationId:'invalid',timeBasis:undefined}),/时间基准/);
});

test('save failure preserves result; concurrent retry only saves and never reprocesses or reinserts',async()=>{
 const f=await fixture();f.setSaveFailure(true);
 await assert.rejects(f.host.execute(request),error=>error.code==='save_failed'&&error.applied&&error.nodeIds.length===1);
 assert.equal(f.host.get(request.operationId).status,'save_failed');assert.equal(f.state.nodes.length,2);
 f.setSaveFailure(false);const [a,b]=await Promise.all([f.host.retrySave(request.operationId),f.host.execute(request)]);
 assert.deepEqual(a,b);assert.equal(a.saved,true);assert.equal(f.calls.process.length,1);assert.equal(f.calls.put,1);assert.equal(f.calls.save,2);assert.equal(f.state.nodes.length,2);
});

test('refresh revalidates provenance and real output frames before reusing existing node',async()=>{
 const f=await fixture();await f.host.execute(request);f.state.nodes.shift();
 const refreshed=f.newHost(),result=await refreshed.execute(request);
 assert.equal(result.saved,true);assert.equal(result.nodeIds[0],f.state.nodes[0].id);assert.equal(f.calls.process.length,1);assert.equal(f.calls.put,1);assert.equal(f.calls.decode,2);
 const other=f.newHost();await assert.rejects(other.execute({...request,end:4}),error=>error.code==='operation_conflict');
 const retry=f.newHost();assert.equal((await retry.retrySave(request.operationId)).saved,true);assert.equal(f.calls.process.length,1);
});

test('refresh rejects changed output and never silently regenerates',async()=>{
 const f=await fixture();await f.host.execute(request);f.state.nodes[1].video='asset:replacement';
 await assert.rejects(f.newHost().execute(request),error=>error.code==='output_changed');assert.equal(f.calls.process.length,1);
 await assert.rejects(f.host.retrySave(request.operationId),error=>error.code==='output_changed');
});

test('cancel during uncooperative processing rejects promptly and ignores late output',async()=>{
 const gate=deferred(),started=deferred(),f=await fixture({localMedia:{process:async()=>{started.resolve();return gate.promise;}}}),controller=new AbortController();
 const pending=f.host.execute(request,{signal:controller.signal});await started.promise;controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');gate.resolve(new Blob(['late'],{type:'video/mp4'}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.nodes.length,1);assert.equal(f.calls.put,0);assert.equal(f.calls.save,0);
});

test('source replacement during decode blocks late insertion and revokes preview URL',async()=>{
 const gate=deferred(),started=deferred(),f=await fixture({decode:async()=>{started.resolve();return gate.promise;}}),pending=f.host.execute(request);
 await started.promise;f.state.nodes[0]={...f.source};gate.resolve({duration:2,width:1280,height:720});
 await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(f.state.nodes.length,1);assert.equal(f.calls.put,0);assert.equal(f.calls.revoke,1);
});

test('actual output duration mismatch fails before storing asset or creating node',async()=>{
 const f=await fixture({decode:async()=>({duration:30,width:1280,height:720})});
 await assert.rejects(f.host.execute(request),error=>error.code==='invalid_output');assert.equal(f.calls.put,0);assert.equal(f.state.nodes.length,1);assert.equal(f.calls.revoke,1);
});

test('cancellation while asset write is pending cannot add a late node',async()=>{
 const gate=deferred(),started=deferred(),f=await fixture({localAssets:{url:async()=> 'https://media.test/input',put:async()=>{started.resolve();return gate.promise;}}}),controller=new AbortController();
 const pending=f.host.execute(request,{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');gate.resolve('asset:late');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.nodes.length,1);assert.equal(f.calls.save,0);
});

test('already cancelled callers cannot consume cached success or retry a failed save',async()=>{
 const f=await fixture(),controller=new AbortController();await f.host.execute(request);controller.abort();
 await assert.rejects(f.host.execute(request,{signal:controller.signal}),error=>error.name==='AbortError');
 await assert.rejects(f.host.retrySave(request.operationId,{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(f.calls.save,1);
 const g=await fixture();g.setSaveFailure(true);await assert.rejects(g.host.execute(request));g.setSaveFailure(false);
 await assert.rejects(g.host.execute(request,{signal:controller.signal}),error=>error.name==='AbortError');
 await assert.rejects(g.host.retrySave(request.operationId,{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(g.calls.save,1);
 assert.equal(f.state.nodes[1].provenance.sourceMedia,undefined);assert.equal(f.state.nodes[1].provenance.sourceNodeId,'source');
});
