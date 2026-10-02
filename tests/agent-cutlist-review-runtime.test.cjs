const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(overrides={}) {
  const m=await import('../src/features/agent-apps/cutlist-review.mjs'),{createCutlistReviewRuntime}=await import('../src/features/agent-apps/cutlist-review-runtime.mjs');let content='real-video-fixture',projectId='project',calls=0,decodes=0;
  const graph={nodes:[{id:'video-a',type:'video',video:'asset:source'}],edges:[]},options={app:{getState:()=>graph},localAssets:{url:async()=> 'blob:actual-source'},getProjectId:()=>projectId,fetchImpl:async()=>{calls++;return new Response(new Blob([content],{type:'video/mp4'}));},decode:async()=>{decodes++;return {duration:4,width:320,height:180};},createObjectURL:()=> 'blob:decode',revokeObjectURL:()=>{},...overrides},runtime=createCutlistReviewRuntime(options);
  const args={resource_uri:m.cutlistReviewUri,data:{shots:[{id:'video-a',label:'真实本地视频',media_duration_ms:4000,in_ms:0,out_ms:3000,default_keep:true}]}};
  async function prepare(){const prepared=await runtime.prepareAppArgs(args),trace={id:'trace',result:runtime.bindPreparedResult({response:m.prepareCutlistReview(prepared.data)},prepared)};return {prepared,trace,context:runtime.capture(trace.result.response,{trace,chat:{id:'chat'},isCurrent:()=>true})};}
  return {m,runtime,graph,options,args,prepare,setContent:value=>{content=value;},setProject:value=>{projectId=value;},counts:()=>({calls,decodes})};
}
test('real node binding decodes once and carries actual bounded bytes, source SHA and persisted restore',async()=>{
  const f=await fixture(),{prepared,trace,context}=await f.prepare();assert.match(prepared.data.shots[0].preview_url,/^data:video\/mp4;base64,/);assert.match(trace.result.cutlistSourceContext.sources[0].mediaSha256,/^[a-f0-9]{64}$/);assert.deepEqual(f.counts(),{calls:1,decodes:1});
  await context.guard();await context.guard();assert.deepEqual(f.counts(),{calls:1,decodes:1});await context.guard({verifyBytes:true});assert.deepEqual(f.counts(),{calls:2,decodes:1});
  const restored=structuredClone(trace),fresh=f.runtime.capture(restored.result.response,{trace:restored,chat:{id:'chat'},isCurrent:()=>true});await fresh.guard({verifyBytes:true});assert.deepEqual(f.counts(),{calls:3,decodes:1});
});
test('fake declared duration/preview, missing source and virtual clips are refused without fabricated preview',async()=>{
  const f=await fixture();await assert.rejects(f.runtime.prepareAppArgs({...f.args,data:{shots:[{...f.args.data.shots[0],media_duration_ms:4001}]}}),/解码/);
  await assert.rejects(f.runtime.prepareAppArgs({...f.args,data:{shots:[{...f.args.data.shots[0],preview_url:'https://fake.example/test.mp4'}]}}),/伪造/);
  f.graph.nodes[0].clip={start:1,end:3};await assert.rejects(f.runtime.prepareAppArgs(f.args),/完整/);delete f.graph.nodes[0].clip;f.graph.nodes.length=0;await assert.rejects(f.runtime.prepareAppArgs(f.args),/真实/);
});
test('same URL byte replacement, changed source/project and preview mutation fail all old receipts',async()=>{
  const f=await fixture(),{trace,context}=await f.prepare();await context.guard();f.setContent('replaced-same-url');await assert.rejects(context.guard({verifyBytes:true}),/实际字节已被替换/);f.setContent('real-video-fixture');trace.result.response.shots[0].preview_url='data:video/mp4;base64,AAAA';assert.equal(context.isCurrent(),false);await assert.rejects(context.guard(),/已变化/);
  const fresh=await f.prepare();f.setProject('other');assert.equal(fresh.context.isCurrent(),false);f.setProject('project');f.graph.nodes[0].video='asset:new';assert.equal(fresh.context.isCurrent(),false);
});
test('HTTP failure and actual/declaration byte limits cancel streams; oversized decode is refused',async()=>{
  let cancelled=0;const bad=await fixture({fetchImpl:async()=>({ok:false,body:{cancel:async()=>{cancelled++;}}})});await assert.rejects(bad.runtime.prepareAppArgs(bad.args),/读取失败/);assert.equal(cancelled,1);
  const large=await fixture({fetchImpl:async()=>({ok:true,headers:{get:()=>String(9*1024*1024)},body:{cancel:async()=>{cancelled++;}}})});await assert.rejects(large.runtime.prepareAppArgs(large.args),/8MiB/);assert.equal(cancelled,2);
  const streamed=await fixture({fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9*1024*1024));},cancel(){cancelled++;}}),{headers:{'content-type':'video/mp4'}})});await assert.rejects(streamed.runtime.prepareAppArgs(streamed.args),/实际字节/);assert.equal(cancelled,3);
  const dimensions=await fixture({decode:async()=>({duration:4,width:10000,height:10000})});await assert.rejects(dimensions.runtime.prepareAppArgs(dimensions.args),/实际解码无效/);
});
test('explicit abort, timeout and closed context cancel hanging read and do not decode late bytes',async()=>{
  let cancelled=0;const hanging=()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'video/mp4'}});
  const f=await fixture({fetchImpl:async()=>hanging(),timeoutMs:20});await assert.rejects(f.runtime.prepareAppArgs(f.args),/超时/);assert.equal(cancelled,1);
  const g=await fixture({fetchImpl:async()=>hanging()}),controller=new AbortController(),pending=g.runtime.prepareAppArgs(g.args,{signal:controller.signal});setTimeout(()=>controller.abort(Error('manual abort')),5);await assert.rejects(pending,/manual abort/);assert.equal(cancelled,2);
  const h=await fixture(),{context}=await h.prepare();h.options.fetchImpl=async()=>hanging(); // Closure uses initial fetch adapter; rebuild runtime for hanging live validation.
  let hangs=false;const j=await fixture({fetchImpl:async()=>hangs?hanging():new Response(new Blob(['real-video-fixture'],{type:'video/mp4'}))}),capture=await j.prepare();hangs=true;const checking=capture.context.guard({verifyBytes:true});setTimeout(()=>capture.context.dispose(),5);await assert.rejects(checking,/已关闭/);assert.equal(capture.context.isCurrent(),false);assert.equal(cancelled,3);
  context.dispose();assert.equal(context.isCurrent(),false);
});
test('assembly requires separate authorization, creates actual decoded result once and retry saves without reprocessing',async()=>{
  const f=await fixture(),{trace,context}=await f.prepare(),response=trace.result.response,state=f.m.initialCutlistReviewState(response),message='确认拼装计划：保留 1/1 段，总时长 3s — CR1 v=1;keep=video-a:0-3000;confirm=1',reply=await f.m.resolveCutlistReviewReply(message,response,state);
  const {createCutlistReviewExecutor}=await import('../src/features/agent-apps/cutlist-review-runtime.mjs');let posts=0,saves=0,saveFail=true;
  const app={getState:()=>f.graph,createConnected:(id,patches)=>{const nodes=patches.map(patch=>({...patch,id:'result',parent:id}));f.graph.nodes.push(...nodes);return nodes;}},executor=createCutlistReviewExecutor({app,localAssets:{put:async()=> 'asset:result',url:async()=> 'blob:result'},store:{save:async()=>{saves++;if(saveFail)throw Error('disk full');}},fetchImpl:async(url,options)=>{if(url==='/api/media/playlist'){posts++;const payload=JSON.parse(options.body);assert.equal(payload.clips[0].start,0);assert.equal(payload.clips[0].duration,3);}return new Response(new Blob(['actual-merged-output'],{type:'video/mp4'}));},decode:async()=>({duration:3,width:1280,height:720}),createObjectURL:()=> 'blob:decode',revokeObjectURL:()=>{}});
  const input={operationId:'assemble-1',message,response,state};await assert.rejects(executor.execute(input,{sourceContext:context}),/不是执行授权/);assert.equal(posts,0);
  input.authorization={kind:'local_cutlist_assembly',handoffId:reply.metadata.handoffId};await assert.rejects(executor.execute(input,{sourceContext:context}),error=>error.applied===true&&error.saved===false);assert.equal(posts,1);assert.equal(f.graph.nodes.length,2);saveFail=false;
  const result=await executor.retrySave('assemble-1');assert.equal(result.saved,true);assert.equal(result.applied,true);assert.equal(saves,2);assert.equal(posts,1);assert.match(result.mediaSha256,/^[a-f0-9]{64}$/);
  await executor.execute(input,{sourceContext:context});assert.equal(posts,1);f.graph.nodes.pop();await assert.rejects(executor.execute(input,{sourceContext:context}),/已被删除/);assert.equal(posts,1);
});

async function assemblyFixture({put,save,flush,create,storedContent='actual-merged-output'}={}) {
  const f=await fixture(),{trace,context}=await f.prepare(),response=trace.result.response,state=f.m.initialCutlistReviewState(response),message='确认拼装计划：保留 1/1 段，总时长 3s — CR1 v=1;keep=video-a:0-3000;confirm=1',reply=await f.m.resolveCutlistReviewReply(message,response,state),{createCutlistReviewExecutor}=await import('../src/features/agent-apps/cutlist-review-runtime.mjs');let posts=0,saves=0,storedReads=0;
  const app={getState:()=>f.graph,createConnected:(id,patches)=>{const nodes=patches.map(patch=>({...patch,id:'result',source:id}));f.graph.nodes.push(...nodes);create?.(f.graph,nodes);return nodes;}},executor=createCutlistReviewExecutor({app,getProjectId:()=>projectId,localAssets:{put:async blob=>{if(put)await put(f);return 'asset:result';},url:async()=> 'blob:result'},store:{save:async()=>{saves++;return save?save(f):true;},flush:async()=>{if(flush)await flush(f);}},fetchImpl:async(url)=>{if(url==='/api/media/playlist'){posts++;return new Response(new Blob(['actual-merged-output'],{type:'video/mp4'}));}storedReads++;return new Response(new Blob([storedContent],{type:'video/mp4'}));},decode:async()=>({duration:3,width:1280,height:720}),createObjectURL:()=> 'blob:decode',revokeObjectURL:()=>{}});let projectId='project';
  const input={operationId:'real-assembly-1',message,response,state,authorization:{kind:'local_cutlist_assembly',handoffId:reply.metadata.handoffId}};
  return {...f,context,executor,input,counts:()=>({posts,saves,storedReads}),setExecutorProject:value=>{projectId=value;},setStoredContent:value=>{storedContent=value;}};
}
test('source switching during LocalAssets.put ignores late storage acknowledgement and never inserts result',async()=>{
  const f=await assemblyFixture({put:async f=>{f.graph.nodes[0].video='asset:replacement';}});await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),/真实来源已变化/);assert.equal(f.graph.nodes.length,1);assert.deepEqual(f.counts(),{posts:1,saves:0,storedReads:0});
});
test('initial LocalAssets storage must round-trip exact decoded bytes before canvas creation',async()=>{
  const f=await assemblyFixture({storedContent:'wrong-stored-video'});await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),/已存拼装素材实际字节/);assert.equal(f.graph.nodes.length,1);assert.deepEqual(f.counts(),{posts:1,saves:0,storedReads:1});
});
test('source switch during committed canvas save is a stale receipt, preserving actual saved result without recomposing',async()=>{
  const f=await assemblyFixture({save:async f=>{f.graph.nodes[0].video='asset:replacement';return true;}});await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),error=>error.applied===true&&error.saved===true&&error.currentMatches===false&&/来源已(?:切换|变化)/.test(error.message));assert.equal(f.graph.nodes.length,2);assert.equal(f.counts().posts,1);
  const retry=await f.executor.retrySave(f.input.operationId);assert.equal(retry.saved,true);assert.equal(retry.currentMatches,true);assert.equal(f.counts().posts,1);
});
test('canvas undo and provenance tamper during save cannot return success or silently rebuild',async()=>{
  const removed=await assemblyFixture({save:async f=>{f.graph.nodes.pop();return true;}});await assert.rejects(removed.executor.execute(removed.input,{sourceContext:removed.context}),error=>error.applied===false&&error.saved===true&&error.currentMatches===false&&error.nodeIds.length===0);await assert.rejects(removed.executor.execute(removed.input,{sourceContext:removed.context}),/删除或修改/);assert.equal(removed.counts().posts,1);
  const tampered=await assemblyFixture({flush:async f=>{f.graph.nodes[1].provenance.mediaSha256='f'.repeat(64);}});await assert.rejects(tampered.executor.execute(tampered.input,{sourceContext:tampered.context}),error=>error.applied===true&&error.saved===true&&error.currentMatches===false&&/provenance/.test(error.message));await assert.rejects(tampered.executor.retrySave(tampered.input.operationId),/provenance/);assert.equal(tampered.counts().posts,1);
});
test('mutation inside createConnected is checked against host-created provenance and cannot bless tampering',async()=>{
  const f=await assemblyFixture({create:(graph,nodes)=>{nodes[0].provenance.handoffId='cutlist_'+'0'.repeat(64);}});await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),/provenance/);assert.equal(f.counts().saves,0);assert.equal(f.counts().posts,1);await assert.rejects(f.executor.retrySave(f.input.operationId),/provenance/);
});

test('project switch after insertion refuses saving into a different project and never recreates the output',async()=>{
  let switched;const f=await assemblyFixture({create:()=>switched()});switched=()=>f.setExecutorProject('another-project');await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),error=>error.applied===true&&error.saved===false&&error.currentMatches===false&&/所属项目已切换/.test(error.message));assert.equal(f.counts().saves,0);assert.equal(f.counts().posts,1);await assert.rejects(f.executor.retrySave(f.input.operationId),/所属项目已切换/);assert.equal(f.counts().posts,1);
});

test('persisted host ledger rejects mismatched media identity/hash and removed old operation before any write',async()=>{
  const f=await assemblyFixture(),receipt=await f.executor.execute(f.input,{sourceContext:f.context});assert.equal(receipt.currentMatches,true);const before=f.counts();
  for(const expectedReceipt of [{...receipt,mediaSha256:'0'.repeat(64)},{...receipt,nodeIds:['different-node']},{...receipt,duration:receipt.duration+1}])await assert.rejects(f.executor.execute({...f.input,expectedReceipt},{sourceContext:f.context}),/宿主持久操作回执不符/);
  assert.deepEqual(f.counts(),before);
  const g=await assemblyFixture();await assert.rejects(g.executor.execute({...g.input,expectedReceipt:{...receipt,operationId:g.input.operationId}},{sourceContext:g.context}),/结果已删除/);assert.equal(g.counts().posts,0);assert.equal(g.counts().saves,0);
});

test('save-time output-byte replacement rejects actual saved receipt and retry never recomposes',async()=>{
  let change;const f=await assemblyFixture({save:async()=>{change();return true;}});change=()=>f.setStoredContent('replaced-output-same-asset');await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),error=>error.saved===true&&error.currentMatches===false&&/产物实际字节已变化/.test(error.message));assert.equal(f.counts().posts,1);assert.equal(f.graph.nodes.length,2);await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),/产物实际字节已变化/);assert.equal(f.counts().posts,1);
});
test('save-time same-URL source-byte replacement and live retry revalidate real bytes after actual commit',async()=>{
  const f=await assemblyFixture({save:async f=>{f.setContent('replaced-same-url-after-save');return true;}});await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),error=>error.saved===true&&error.currentMatches===false&&/来源视频实际字节/.test(error.message));assert.equal(f.counts().posts,1);assert.equal(f.graph.nodes.length,2);await assert.rejects(f.executor.execute(f.input,{sourceContext:f.context}),/来源视频实际字节/);assert.equal(f.counts().posts,1);
});

test('read-only final receipt validation detects chat-save window deletion, metadata/provenance and byte changes without mutation',async()=>{
  for(const change of [f=>f.graph.nodes.pop(),f=>{f.graph.nodes[1].videoMetadata.width=640;},f=>{f.graph.nodes[1].provenance.handoffId='cutlist_'+'0'.repeat(64);},f=>f.setStoredContent('same-asset-replaced-after-chat-save'),f=>f.setContent('same-source-replaced-after-chat-save')]){
    const f=await assemblyFixture(),receipt=await f.executor.execute(f.input,{sourceContext:f.context}),before=f.counts();change(f);await assert.rejects(f.executor.validateReceiptCurrent(receipt,{sourceContext:f.context}));const after=f.counts();assert.equal(after.posts,before.posts);assert.equal(after.saves,before.saves);
  }
  const f=await assemblyFixture(),receipt=await f.executor.execute(f.input,{sourceContext:f.context}),before=f.counts(),nodes=f.graph.nodes.length;assert.deepEqual(await f.executor.validateReceiptCurrent(receipt,{sourceContext:f.context,expectedReceipt:receipt}),receipt);assert.equal(f.graph.nodes.length,nodes);assert.equal(f.counts().posts,before.posts);assert.equal(f.counts().saves,before.saves);assert.equal(f.counts().storedReads,before.storedReads+1);
});
