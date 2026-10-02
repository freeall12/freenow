'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const png=()=>new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGmQAAAAASUVORK5CYII=','base64')],{type:'image/png'});
const video=()=>new Blob(['recorded-video'],{type:'video/webm'});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(overrides={}){
 const {createWidgetMediaHandoff}=await import('../src/features/agent-widgets/media-handoff.mjs');
 const state={nodes:[],edges:[],view:{x:30,y:-20,scale:2}},calls={put:0,save:0,process:[],decode:0,revoke:0,changes:[]},assets=new Map();let current=true,saveFails=false;
 const options={app:{getState:()=>state,createConnected:(source,outputs)=>{const added=outputs.map(output=>({...output,id:'out-'+state.nodes.length,sourceId:source}));state.nodes.push(...added);return added;},addNode:(type,point,image,title,patch)=>{const node={id:'out-'+state.nodes.length,type,x:(point.x-state.view.x)/state.view.scale,y:(point.y-state.view.y)/state.view.scale,image,title,...patch};state.nodes.push(node);return node;}},
  localAssets:{put:async blob=>{const id='asset:'+ ++calls.put;assets.set(id,blob);return id;},url:async id=>id},
  localMedia:{process:async(op,blob,args)=>{calls.process.push({op,args});return new Blob(['h264-output'],{type:'video/mp4'});}},
  store:{save:async()=>{calls.save++;if(saveFails)throw Error('disk full');}},fetchImpl:async id=>({ok:assets.has(id),blob:async()=>assets.get(id)}),
  decodeImage:async()=>{calls.decode++;return {width:1,height:1};},decodeVideo:async()=>{calls.decode++;return {width:64,height:32,duration:2,poster:'data:image/jpeg;base64,AA=='};},
  createObjectURL:()=> 'blob:preview',revokeObjectURL:()=>{calls.revoke++;},onChange:value=>calls.changes.push(value),...overrides};
 const config={chatId:'chat',traceId:'trace',version:'sha256-code',position:{x:250,y:100},allowedTypes:['image','video'],isCurrent:()=>current};
 const factory=createWidgetMediaHandoff(options),bound=factory.bind(config);
 return {bound,factory,config,options,state,calls,assets,newFactory:()=>createWidgetMediaHandoff(options),setCurrent:value=>{current=value;},setSaveFailure:value=>{saveFails=value;}};
}

test('one PNG creates one actual asset/node at host world coordinates using current view',async()=>{
 const f=await fixture();f.state.view={x:-500,y:600,scale:.5};
 const result=await f.bound.submit({operationId:'image-one',type:'image',blob:png()});
 assert.equal(result.saved,true);assert.equal(result.applied,true);assert.deepEqual(result.nodeIds,['out-0']);assert.deepEqual(result.dimensions,{width:1,height:1});assert.equal(f.state.nodes[0].x,250);assert.equal(f.state.nodes[0].y,100);assert.equal(f.calls.process.length,0);assert.equal(f.calls.save,1);
 assert.equal(f.calls.revoke,1);assert.ok(!JSON.stringify(result).includes('asset:'));assert.ok(!JSON.stringify(result).includes('data:'));
 assert.equal((await f.bound.submit({operationId:'image-one',type:'image',blob:png()})).saved,true);assert.equal(f.calls.put,1);assert.equal(f.state.nodes.length,1);
});

test('iframe payload cannot import URLs, mutate nodes or choose placement; forged PNG is rejected before decode',async()=>{
 const f=await fixture();
 for(const extra of [{url:'https://other.test/x'},{nodeId:'victim'},{position:{x:0,y:0}},{title:'unconfirmed'}])await assert.rejects(f.bound.submit({operationId:'bad',type:'image',blob:png(),...extra}),error=>error.code==='invalid_payload');
 await assert.rejects(f.bound.submit({operationId:'bad-type',type:'image',blob:new Blob(['<svg/>'],{type:'image/svg+xml'})}),error=>error.code==='invalid_type');
 await assert.rejects(f.bound.submit({operationId:'bad-png',type:'image',blob:new Blob(['not png'],{type:'image/png'})}),error=>error.code==='invalid_png');
 assert.equal(f.calls.decode,0);assert.equal(f.calls.put,0);
 const onlyImage=f.factory.bind({...f.config,allowedTypes:['image']});await assert.rejects(onlyImage.submit({operationId:'v',type:'video',blob:video()}),error=>error.code==='type_not_allowed');
});

test('host duration finalizes H264 and reports temporal normalization instead of pretending exact wall-clock timing',async()=>{
 let n=0;const f=await fixture({decodeVideo:async()=>({width:64,height:32,duration:++n===1?3:2,poster:'data:image/jpeg;base64,AA=='})});
 const bound=f.factory.bind({...f.config,title:'白模运镜',expectedDuration:2,fps:24});
 const result=await bound.submit({operationId:'video-one',type:'video',blob:video()});
 assert.equal(f.calls.process[0].op,'finalize');assert.equal(f.calls.process[0].args.duration,2);assert.equal(result.inputDuration,3);assert.equal(result.duration,2);assert.equal(result.durationAdjusted,true);assert.equal(result.durationNormalized,true);assert.equal(result.requestedFps,24);assert.equal(result.outputFps,30);assert.equal(f.state.nodes[0].title,'白模运镜');
});

test('unknown recorded duration needs host confirmation; transformed output is decoded and duration checked',async()=>{
 const f=await fixture({decodeVideo:async()=>({width:64,height:32,duration:Infinity})});
 await assert.rejects(f.bound.submit({operationId:'unknown',type:'video',blob:video()}),error=>error.code==='invalid_duration');assert.equal(f.calls.process.length,0);
 let n=0;const g=await fixture({decodeVideo:async()=>({width:64,height:32,duration:++n===1?Infinity:2})});
 const result=await g.factory.bind({...g.config,expectedDuration:2}).submit({operationId:'confirmed',type:'video',blob:video()});assert.equal(result.inputDuration,null);assert.equal(result.durationAdjusted,null);assert.equal(result.saved,true);
 let k=0;const h=await fixture({decodeVideo:async()=>({width:64,height:32,duration:++k===1?2:30})});await assert.rejects(h.bound.submit({operationId:'wrong',type:'video',blob:video()}),error=>error.code==='invalid_output');assert.equal(h.calls.put,0);
});

test('save failure carries applied receipt and retry only saves existing output',async()=>{
 const f=await fixture();f.setSaveFailure(true);
 await assert.rejects(f.bound.submit({operationId:'save',type:'image',blob:png()}),error=>error.code==='save_failed'&&error.receipt.applied&&!error.receipt.saved&&error.receipt.nodeIds.length===1);
 f.setSaveFailure(false);const result=await f.bound.retrySave('save');assert.equal(result.saved,true);assert.equal(f.calls.put,1);assert.equal(f.calls.decode,1);assert.equal(f.calls.save,2);assert.equal(f.state.nodes.length,1);
});

test('refresh verifies saved bytes, actual media and code binding before reusing receipt',async()=>{
 const f=await fixture();await f.bound.submit({operationId:'refresh',type:'image',blob:png()});
 const refreshed=f.newFactory().bind(f.config);assert.equal((await refreshed.retrySave('refresh')).saved,true);assert.equal(f.calls.put,1);assert.equal(f.calls.decode,2);assert.equal(f.state.nodes.length,1);
 const wrong=f.newFactory().bind({...f.config,version:'changed-code'});await assert.rejects(wrong.submit({operationId:'refresh',type:'image',blob:png()}),error=>error.code==='operation_conflict');
 f.assets.set('asset:1',new Blob(['mutated bytes'],{type:'image/png'}));await assert.rejects(f.newFactory().bind(f.config).retrySave('refresh'),error=>error.code==='output_changed');assert.equal(f.calls.put,1);
});

test('same operation cannot change payload bytes or media kind',async()=>{
 const f=await fixture();await f.bound.submit({operationId:'same',type:'image',blob:png()});
 await assert.rejects(f.bound.submit({operationId:'same',type:'video',blob:video()}),error=>error.code==='operation_conflict');
 const original=await png().arrayBuffer(),bytes=new Uint8Array(original);bytes[bytes.length-1]^=1;
 await assert.rejects(f.bound.submit({operationId:'same',type:'image',blob:new Blob([bytes],{type:'image/png'})}),error=>error.code==='operation_conflict');assert.equal(f.calls.put,1);
});

test('stale widget after asynchronous decode cannot store or add late output',async()=>{
 const gate=deferred(),started=deferred(),f=await fixture({decodeImage:async()=>{started.resolve();return gate.promise;}});
 const pending=f.bound.submit({operationId:'late',type:'image',blob:png()});await started.promise;f.setCurrent(false);gate.resolve({width:1,height:1});
 await assert.rejects(pending,error=>error.code==='stale_widget');assert.equal(f.calls.put,0);assert.equal(f.state.nodes.length,0);assert.equal(f.calls.revoke,1);
});

test('cancelled uncooperative finalize and late asset writes never create nodes',async()=>{
 const gate=deferred(),started=deferred(),f=await fixture({localMedia:{process:async()=>{started.resolve();return gate.promise;}}}),controller=new AbortController();
 const pending=f.bound.submit({operationId:'cancel-video',type:'video',blob:video()},{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');gate.resolve(new Blob(['late'],{type:'video/mp4'}));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.nodes.length,0);assert.equal(f.calls.put,0);
 const asset=deferred(),writing=deferred(),g=await fixture({localAssets:{url:async value=>value,put:async()=>{writing.resolve();return asset.promise;}}}),signal=new AbortController();
 const other=g.bound.submit({operationId:'cancel-asset',type:'image',blob:png()},{signal:signal.signal});await writing.promise;signal.abort();await assert.rejects(other,error=>error.name==='AbortError');asset.resolve('asset:late');await new Promise(resolve=>setImmediate(resolve));assert.equal(g.state.nodes.length,0);
});

test('already aborted signal blocks cached receipt and save retry; source replacement blocks connected insertion',async()=>{
 const f=await fixture();await f.bound.submit({operationId:'cached',type:'image',blob:png()});const controller=new AbortController();controller.abort();
 await assert.rejects(f.bound.submit({operationId:'cached',type:'image',blob:png()},{signal:controller.signal}),error=>error.name==='AbortError');await assert.rejects(f.bound.retrySave('cached',{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(f.calls.save,1);
 const gate=deferred(),started=deferred(),g=await fixture({decodeImage:async()=>{started.resolve();return gate.promise;}}),source={id:'source',type:'text'};g.state.nodes.push(source);
 const bound=g.factory.bind({...g.config,sourceNodeId:'source'}),pending=bound.submit({operationId:'connected',type:'image',blob:png()});await started.promise;g.state.nodes[0]={...source};gate.resolve({width:1,height:1});await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(g.state.nodes.length,1);
});

test('new host submit retries unapplied failure with identical operation and bytes after dependency recovery',async()=>{
 let ready=false,attempts=0;const signals=[];
 const f=await fixture({decodeImage:async(_url,{signal})=>{attempts++;signals.push(signal);if(!ready)throw Error('decoder temporarily unavailable');return {width:1,height:1};}});
 const payload={operationId:'retry-add',type:'image',blob:png()};
 await assert.rejects(f.bound.submit(payload),/temporarily unavailable/);assert.equal(f.bound.get(payload.operationId).applied,false);assert.equal(f.state.nodes.length,0);assert.equal(f.calls.put,0);
 ready=true;const result=await f.bound.submit(payload);assert.equal(result.saved,true);assert.equal(result.applied,true);assert.equal(attempts,2);assert.notEqual(signals[0],signals[1]);assert.equal(f.calls.put,1);assert.equal(f.state.nodes.length,1);
 await f.bound.submit(payload);assert.equal(attempts,2);assert.equal(f.state.nodes.length,1);
});

test('retry reconciles a node inserted before adapter error without reprocessing or duplicating it',async()=>{
 const f=await fixture(),nativeAdd=f.options.app.addNode;let failOnce=true;
 f.options.app.addNode=(...args)=>{const node=nativeAdd(...args);if(failOnce){failOnce=false;throw Error('post-insert renderer failure');}return node;};
 const payload={operationId:'partial-add',type:'image',blob:png()};
 await assert.rejects(f.bound.submit(payload),/post-insert/);assert.equal(f.state.nodes.length,1);assert.equal(f.calls.put,1);
 const result=await f.bound.submit(payload);assert.equal(result.saved,true);assert.equal(result.nodeIds[0],f.state.nodes[0].id);assert.equal(f.state.nodes.length,1);assert.equal(f.calls.put,1);assert.equal(f.calls.save,1);
});
