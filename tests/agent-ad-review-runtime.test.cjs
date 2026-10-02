const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(options={}){
 const m=await import('../src/features/agent-apps/ad-review.mjs'),{createAdReviewRuntime}=await import('../src/features/agent-apps/ad-review-runtime.mjs');let project='project-1',content='actual-local-unit-fixture',active=true,reads=0;
 const graph={nodes:[{id:'image-a',type:'image',image:'asset:real-image'},{id:'video-a',type:'video',video:'asset:real-video'}]},app={getState:()=>graph},args={resource_uri:m.adReviewUri,title:'真实素材审核',data:{stage:'final_review',locale:'zh-CN',batch:{label:'batch-1'},items:[{combo:'C1',node_ref:'node/image-a',media:'image'},{combo:'C2',node_ref:'node/video-a',media:'video'}]}};
 const runtime=createAdReviewRuntime({app,getProjectId:()=>project,localAssets:{url:async value=>'blob:'+value},decodeImage:async()=>({width:128,height:96}),decodeVideo:async()=>({duration:3,width:128,height:96}),createObjectURL:()=> 'blob:decode',revokeObjectURL:()=>{},fetchImpl:async url=>{reads++;return new Response(new Blob([content],{type:url.includes('video')?'video/mp4':'image/png'}));},...options});
 async function prepare(){const prepared=await runtime.prepareAppArgs(args,{isCurrent:()=>active}),result=runtime.bindPreparedResult({resource_uri:m.adReviewUri,response:m.prepareAdReview(prepared.data,prepared.title)},prepared),trace={id:'trace-1',result},chat={id:'chat-1'},context=runtime.capture(result.response,{trace,chat,isCurrent:()=>active});return {prepared,result,trace,chat,context};}
 return {m,args,graph,runtime,prepare,setProject:value=>project=value,setContent:value=>content=value,setActive:value=>active=value,reads:()=>reads};
}
test('real node_ref becomes local data preview; creative combo stays separate and sources are hashed outside official data',async()=>{
 const f=await fixture(),p=await f.prepare();assert.equal(p.prepared.data.items[0].combo,'C1');assert.equal(p.prepared.data.items[0].node_ref,undefined);assert.match(p.result.response.items[0].preview_url,/^data:image\/png;base64,/);assert.match(p.result.response.items[1].preview_url,/^data:video\/mp4;base64,/);assert.equal(p.result.adReviewSourceContext.sources[0].nodeId,'image-a');assert.match(p.result.adReviewSourceContext.sources[0].mediaSha256,/^[a-f0-9]{64}$/);assert.equal(await p.context.guard({verifyBytes:true}),true);
 f.setContent('replaced-at-same-url');await assert.rejects(p.context.guard({verifyBytes:true}),/实际字节已变化/);
});
test('remote source and model-selected URLs are rejected before any fetch',async()=>{
 let calls=0;const f=await fixture({localAssets:{url:async()=> 'https://files.tapnow.media/original.png'},fetchImpl:async()=>{calls++;throw Error('must not fetch');}});await assert.rejects(f.runtime.prepareAppArgs(f.args),/禁止请求原站/);assert.equal(calls,0);
 for(const field of ['preview_url','poster_url']){const g=await fixture();g.args.data.items[0][field]='https://evil.invalid/image';await assert.rejects(g.runtime.prepareAppArgs(g.args));assert.equal(g.reads(),0);}
});
test('project/source/response changes, no binding and video virtual trim cannot bless a handoff',async()=>{
 const f=await fixture(),p=await f.prepare();f.setProject('other');assert.equal(p.context.isCurrent(),false);await assert.rejects(p.context.guard(),/来源已变化/);
 const g=await fixture(),q=await g.prepare();g.graph.nodes[0].image='asset:replacement';await assert.rejects(q.context.guard(),/来源已变化/);
 const h=await fixture(),r=await h.prepare();r.result.response.items[0].preview_url='data:image/png;base64,Yg==';await assert.rejects(r.context.guard(),/来源已变化/);
 const i=await fixture();assert.throws(()=>i.runtime.bindPreparedResult({response:i.m.prepareAdReview({stage:'final_review',batch:{},items:[{combo:'C1',media:'image'}]})},i.args),/有效真实来源/);i.graph.nodes[1].trim={in:0,out:1};await assert.rejects(i.runtime.prepareAppArgs(i.args),/虚拟裁剪/);
});
test('decode failure, type mismatch, streamed overflow and missing stream stay explicit',async()=>{
 const cases=[{decodeImage:async()=>{throw Error('actual decode failure');}},{fetchImpl:async()=>new Response(new Blob(['x'],{type:'text/html'}))},{fetchImpl:async()=>new Response(new Blob(['x'],{type:'image/png'}),{headers:{'content-length':String(9*1024*1024)}})},{fetchImpl:async()=>({ok:true,headers:new Headers({'content-type':'image/png'}),body:null})}];
 for(const opts of cases){const f=await fixture(opts);await assert.rejects(f.runtime.prepareAppArgs(f.args));}
 const f=await fixture({fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));controller.close();}}),{headers:{'content-type':'image/png'}})});await assert.rejects(f.runtime.prepareAppArgs(f.args),/实际字节超过预算/);
});
test('cancel and changed source interrupt a stalled read without awaiting remote callbacks',async()=>{
 const f=await fixture({fetchImpl:()=>new Promise(()=>{})}),controller=new AbortController(),pending=f.runtime.prepareAppArgs(f.args,{signal:controller.signal});controller.abort(Error('user cancelled'));await assert.rejects(pending,/user cancelled/);
 const g=await fixture({fetchImpl:()=>new Promise(()=>{})}),stalled=g.runtime.prepareAppArgs(g.args);setTimeout(()=>g.setProject('other'),10);await assert.rejects(stalled,/来源已切换/);
});
test('one actual source can support different creative combos without repeated reads',async()=>{
 const f=await fixture();f.args.data.items[1]={combo:'C2',node_ref:'node/image-a',media:'image'};const p=await f.prepare();assert.equal(f.reads(),1);assert.equal(p.result.adReviewSourceContext.sources.length,2);assert.equal(await p.context.guard({verifyBytes:true}),true);assert.equal(f.reads(),2);
});
test('normal queue handoff carries trustworthy node refs and hashes without local media bytes',async()=>{
 const f=await fixture(),p=await f.prepare(),message='成片验收完成：收 2 · 回炉 0 — AR1 v=1;stage=final_review;batch=batch-1;keep=C1,C2;cull=',receipt=await p.context.reply(message,{marks:{},notes:{}});
 assert.equal(receipt.kind,'confirmed');assert.deepEqual(receipt.sources.map(source=>source.node_ref),['node/image-a','node/video-a']);assert.match(receipt.text,/"node_ref":"node\/image-a"/);assert.match(receipt.text,/"media_sha256":"[a-f0-9]{64}"/);assert.doesNotMatch(receipt.text,/data:(image|video)\//);assert.match(receipt.metadata.handoffId,/^ad_review_[a-f0-9]{64}$/);
 assert.equal((await p.context.reply(message,{marks:{},notes:{}})).metadata.handoffId,receipt.metadata.handoffId);
 f.setContent('changed source bytes');await assert.rejects(p.context.reply(message,{marks:{},notes:{}}),/实际字节已变化/);
});
