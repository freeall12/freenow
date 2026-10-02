const {test}=require('node:test');const assert=require('node:assert/strict');
const load=()=>import('../src/features/agent-apps/platform-resize.mjs');
const specs=[{platform:'portrait',label_zh:'竖屏',label_en:'Portrait',ratio_id:'r_9_16'},{platform:'square',label_zh:'方图',label_en:'Square',ratio_id:'r_1_1'},{platform:'other_square',label_zh:'另一方图',label_en:'Other square',ratio_id:'r_1_1'},{platform:'landscape',label_zh:'横屏',label_en:'Landscape',ratio_id:'r_16_9'}];
const media=(width=1200,height=800,value='source')=>new Blob([JSON.stringify({width,height,value})],{type:'image/png'});
async function fixture(config={}) {
 const m=await load(),{createPlatformResizeRuntime}=await import('../src/features/agent-apps/platform-resize-runtime.mjs');
 const assets=new Map([['asset:original',media()]]),nodes=[{id:'source',type:'image',image:'asset:original',fullImage:'asset:original',x:0,y:0,width:320,height:213}],edges=[];
 let project='p1',live=true,undo=0,saves=0,persists=0,rendered=[],counter=0;
 const app={getState:()=>({nodes,edges}),createConnected:(id,patches)=>{undo++;const batch=patches.map((p,i)=>({...structuredClone(p),id:'crop-'+(++counter),x:500+i*400,y:0}));nodes.push(...batch);edges.push(...batch.map(n=>({id:'edge-'+n.id,source:id,target:n.id})));config.insert?.(batch);return batch;}};
 const localAssets={url:async ref=>{if(!assets.has(ref))throw Error('missing asset');return 'blob:https://fixture.test/'+ref;},put:async blob=>{const id='asset:output-'+(assets.size+1);assets.set(id,blob);return id;}};
 const fetchImpl=async(url,{signal}={})=>{url=url.replace('blob:https://fixture.test/','');config.fetch?.(url,assets);const custom=config.response?.(url);if(custom)return custom;if(signal?.aborted)throw signal.reason;const blob=assets.get(url);return new Response(blob,{status:blob?200:404,headers:{'content-type':blob?.type||'text/plain'}});};
 const decodeImage=async blob=>{const data=JSON.parse(await blob.text());config.decode?.(data);return data;};
 const renderCrop=async(blob,rect,options)=>{const source=JSON.parse(await blob.text());rendered.push({source,rect,options});if(config.render)await config.render(rect,options);return {blob:media(rect.width,rect.height,{source:source.value,rect}),width:rect.width,height:rect.height};};
 const runtime=createPlatformResizeRuntime({app,localAssets,getProjectId:()=>project,fetchImpl,decodeImage,renderCrop,store:{save:async()=>{saves++;return config.save?await config.save(nodes):true;}},persistConversation:async()=>{persists++;return config.persist?await config.persist(nodes):true;}});
 const raw={resource_uri:m.platformResizeUri,data:{image_id:'node/source',platforms:specs},title:'适配测试'},prepared=await runtime.prepareAppArgs(raw,{isCurrent:()=>live});
 const response=m.preparePlatformResize(prepared.data),trace={id:'trace',result:runtime.bindPreparedResult({response},prepared)},chat={id:'chat'};
 const ctx=runtime.capture(response,{trace,chat,isCurrent:()=>live});const request={image_id:response.node_ref,project_id:response.project_id,crops:response.platforms.filter(p=>['portrait','square'].includes(p.platform)).map(p=>({platform:p.platform,x:p.x,y:p.y,w:p.w,h:p.h}))};
 return {m,runtime,raw,prepared,response,trace,ctx,request,assets,nodes,rendered,setProject:v=>project=v,setLive:v=>live=v,stats:()=>({undo,saves,persists}),apply:(callId='resize-call-0001',args=request)=>ctx.apply(args,{callId,userAction:true})};
}
test('official input geometry, one format per ratio and exact crop protocol',async()=>{
 const m=await load(),platforms=m.buildPlatformResizeFormats(specs,1200,800);
 assert.deepEqual(platforms[0],{...specs[0],x:313,y:0,w:375,h:1000});assert.deepEqual(platforms[1],{...specs[1],x:167,y:0,w:667,h:1000});
 const response=m.preparePlatformResize({node_ref:'node/source',project_id:'p1',preview:{data_uri:'data:image/png;base64,aGk=',width:1200,height:800},platforms});
 const crop=p=>({platform:p.platform,x:p.x,y:p.y,w:p.w,h:p.h}),request={image_id:'node/source',project_id:'p1',crops:[crop(platforms[0]),crop(platforms[1])]};assert.deepEqual(m.validatePlatformResizeApply(request,response),request);
 assert.deepEqual(m.platformResizePixels(request.crops[0],1200,800,'r_9_16'),{x:376,y:0,width:450,height:800});
 for(const bad of [{...request,image_id:'node/other'},{...request,project_id:'other'},{...request,crops:[]},{...request,crops:[crop(platforms[1]),crop(platforms[2])]},{...request,crops:[crop(platforms[1]),crop(platforms[0])]},{...request,crops:[{...crop(platforms[0]),w:374}]},{...request,crops:[{...crop(platforms[0]),x:626}]},{...request,source_url:'https://evil.test'}])assert.throws(()=>m.validatePlatformResizeApply(bad,response));
 for(const bad of [[{...specs[0],ratio_id:'9:16'}],[{...specs[0],platform:'evil/name'}],[],[specs[0],specs[0]],[{...specs[0],width:1080}]])assert.throws(()=>m.buildPlatformResizeFormats(bad,1200,800));
});
test('host prepares real source, rejects model previews and video source',async()=>{
 const f=await fixture();assert.equal(f.response.preview.width,1200);assert.equal(f.response.preview.height,800);assert.match(f.trace.result.platformResizeSourceContext.source_sha256,/^[a-f0-9]{64}$/);
 for(const extra of [{preview:{}},{node_ref:'node/source'},{source_sha256:'fake'},{project_id:'other'}])await assert.rejects(f.runtime.prepareAppArgs({...f.raw,data:{...f.raw.data,...extra}}));
 f.nodes[0].type='video';await assert.rejects(f.runtime.prepareAppArgs(f.raw),/仅支持真实图片/);
 const g=await fixture();g.nodes[0].pixelWidth=999;assert.throws(()=>g.runtime.capture(g.response,{trace:g.trace,chat:{id:'chat'},isCurrent:()=>true}),/来源或参考已变化/);
});
test('actual batch pixels, one graph undo, committed receipt and retry dedupe',async()=>{
 const f=await fixture(),receipt=await f.apply();assert.equal(receipt.count,2);assert.deepEqual(receipt.node_refs,['node/crop-1','node/crop-2']);assert.deepEqual(f.stats(),{undo:1,saves:1,persists:1});assert.equal(f.trace.platformResizePlacements.length,1);
 assert.deepEqual(f.rendered.slice(1).map(x=>x.rect),[{x:376,y:0,width:450,height:800},{x:200,y:0,width:800,height:800}]);
 const actual=JSON.parse(await f.assets.get(f.nodes[1].fullImage).text());assert.equal(actual.width,450);assert.equal(actual.value.source,'source');
 assert.deepEqual(await f.apply(),receipt);assert.equal(f.nodes.length,3);assert.equal(f.stats().undo,1);
 const again=await f.apply('resize-call-0002');assert.deepEqual(again.node_refs,receipt.node_refs);assert.equal(f.stats().undo,1);
 const changed={...f.request,crops:[{...f.request.crops[0],x:0},f.request.crops[1]]};await assert.rejects(f.apply('resize-call-0001',changed),/同一.*更换/);
});
test('action, source/project/frame and media-byte changes never mutate graph',async()=>{
 const f=await fixture();await assert.rejects(f.ctx.apply(f.request,{callId:'resize-call-0001'}),/用户动作/);assert.equal(f.nodes.length,1);
 await assert.rejects(f.ctx.apply(f.request,{callId:'resize-call-0001',userAction:true,isCurrent:()=>false}),/已重载/);
 f.assets.set('asset:original',media(1200,800,'changed'));await assert.rejects(f.apply(),/字节或尺寸已变化/);assert.equal(f.nodes.length,1);
 const g=await fixture();g.setProject('other');await assert.rejects(g.apply(),/会话已切换/);const h=await fixture();h.setLive(false);await assert.rejects(h.apply(),/会话已切换/);
 const j=await fixture();j.response.preview.data_uri='data:image/png;base64,bmV3';await assert.rejects(j.apply(),/预览或规格.*绑定/);
 const k=await fixture();k.ctx.dispose();await assert.rejects(k.apply(),/应用已关闭/);
});
test('graph save failure retains visible batch, retry commits without duplicate undo',async()=>{
 let failed=true;const f=await fixture({save:async()=>!failed});await assert.rejects(f.apply(),/画布保存失败/);assert.equal(f.nodes.length,3);assert.equal(f.trace.platformResizePlacements,undefined);failed=false;await f.apply();assert.equal(f.nodes.length,3);assert.equal(f.stats().undo,1);
});
test('deleted output during graph save and conversation commit rejects success',async()=>{
 for(const phase of ['save','persist']){
 let count=0;const config={[phase]:async nodes=>{if(!count++){nodes.splice(1,1);}return true;}},f=await fixture(config);
 await assert.rejects(f.apply(),/裁切节点已撤销/);assert.equal(f.trace.platformResizePlacements,undefined);
 if(phase==='persist')assert.equal(f.stats().persists,2);
 }
});
test('output media, provenance and pixels are checked after save',async()=>{
 for(const change of [nodes=>nodes[1].fullImage='asset:wrong',nodes=>nodes[1].provenance.crop.x=0,nodes=>nodes[1].pixelWidth=1,nodes=>nodes[1].id='changed']){
 const f=await fixture({save:async nodes=>{change(nodes);return true;}});await assert.rejects(f.apply(),/裁切节点已撤销/);assert.equal(f.trace.platformResizePlacements,undefined);
 }
 const f=await fixture({save:async()=>{f.assets.set(f.nodes[1].fullImage,media(450,800,'tampered'));return true;}});await assert.rejects(f.apply(),/实际字节与回执不符/);
});
test('source bytes changed during save invalidates even unchanged node identity',async()=>{
 const f=await fixture({save:async()=>{f.assets.set('asset:original',media(1200,800,'changed'));return true;}});await assert.rejects(f.apply(),/保存期间源图实际字节已变化/);assert.equal(f.trace.platformResizePlacements,undefined);
});
test('conversation failure compensates receipt and never announces complete',async()=>{
 let count=0;const f=await fixture({persist:async()=>++count>1});await assert.rejects(f.apply(),/会话回执保存失败/);assert.equal(f.nodes.length,3);assert.equal(f.trace.platformResizePlacements,undefined);assert.equal(f.stats().persists,2);
 const g=await fixture({persist:async()=>false});await assert.rejects(g.apply(),error=>error.code==='conversation_rollback_failed');assert.equal(g.trace.platformResizePlacements,undefined);
});
test('saved receipt dedupe survives runtime capture, deleted or edited results reject',async()=>{
 const f=await fixture();await f.apply();const ctx=f.runtime.capture(f.response,{trace:f.trace,chat:{id:'chat'},isCurrent:()=>true});await ctx.apply(f.request,{callId:'resize-new-0001',userAction:true});assert.equal(f.stats().undo,1);
 f.nodes[1].provenance.output_sha256='a'.repeat(64);await assert.rejects(ctx.apply(f.request,{callId:'resize-new-0002',userAction:true}),/已保存裁切结果被删除或修改/);
 const g=await fixture();await g.apply();g.nodes.splice(1);await assert.rejects(g.apply(),/被撤销或删除/);
});
test('abort or frame switch while actual pixel encoder waits prevents graph insertion',async()=>{
 let unblock,entered;const start=new Promise(r=>entered=r),wait=new Promise(r=>unblock=r);let pause=false;
 const f=await fixture({render:async(_,options)=>{if(!options.preview&&pause){entered();await wait;}}});pause=true;
 const pending=f.apply();await start;f.ctx.dispose();unblock();await assert.rejects(pending,/应用已关闭/);assert.equal(f.nodes.length,1);
});

test('stalled image stream is cancelled on dispose, including adapters ignoring fetch abort',async()=>{
 let stalled=false,cancels=0,entered;const start=new Promise(r=>entered=r);
 const f=await fixture({response:url=>stalled&&url==='asset:original'?new Response(new ReadableStream({start(){entered();},cancel(){cancels++;}}),{headers:{'content-type':'image/png'}}):null});
 stalled=true;const pending=f.apply();await start;f.ctx.dispose();await assert.rejects(pending,/应用已关闭/);await new Promise(r=>setImmediate(r));assert.equal(cancels,1);assert.equal(f.nodes.length,1);
});
test('concurrent retry with a new callId shares the same batch instead of adding twice',async()=>{
 let unblock,entered,pause=false;const start=new Promise(r=>entered=r),wait=new Promise(r=>unblock=r);
 const f=await fixture({render:async(_,options)=>{if(!options.preview&&pause){entered();await wait;}}});pause=true;
 const first=f.apply();await start;const second=f.apply('resize-call-0002');unblock();const [a,b]=await Promise.all([first,second]);assert.deepEqual(a.node_refs,b.node_refs);assert.equal(f.stats().undo,1);assert.equal(f.nodes.length,3);
});

test('output ratio uses exact native pixels despite official thousandths quantization',async()=>{
 const m=await load(),formats=m.buildPlatformResizeFormats(specs,1200,800),crop=p=>({platform:p.platform,x:p.x,y:p.y,w:p.w,h:p.h});
 assert.deepEqual(m.platformResizePixels(crop(formats[1]),1200,800,'r_1_1'),{x:200,y:0,width:800,height:800});
 assert.deepEqual(m.platformResizePixels(crop(formats[3]),1200,800,'r_16_9'),{x:0,y:62,width:1200,height:675});
 const square={...crop(formats[1]),x:333};assert.deepEqual(m.platformResizePixels(square,1200,800,'r_1_1'),{x:400,y:0,width:800,height:800});
 const bottom={...crop(formats[3]),y:156};assert.deepEqual(m.platformResizePixels(bottom,1200,800,'r_16_9'),{x:0,y:125,width:1200,height:675});
 const unreduced={...crop(formats[1])};assert.deepEqual(m.platformResizePixels(unreduced,1200,800,'r_20_20'),m.platformResizePixels(unreduced,1200,800,'r_1_1'));
 assert.throws(()=>m.platformResizePixels({platform:'tiny',x:0,y:0,w:1000,h:1000},5,5,'r_16_9'),/像素不足/);
});
test('legacy rounded crop is refused without rewriting its pixels or persisted receipt',async()=>{
 const f=await fixture();await f.apply();const legacy=f.nodes[2],blob=media(801,800,'legacy-square');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
 f.assets.set(legacy.fullImage,blob);legacy.pixelWidth=801;legacy.provenance.rect.width=801;legacy.provenance.output_sha256=hash;f.trace.platformResizePlacements[0].output_sha256[1]=hash;
 const before=structuredClone({nodes:f.nodes,receipt:f.trace.platformResizePlacements}),ctx=f.runtime.capture(f.response,{trace:f.trace,chat:{id:'chat'},isCurrent:()=>true});
 await assert.rejects(ctx.apply(f.request,{callId:'resize-new-0001',userAction:true}),error=>error.code==='output_changed');
 assert.deepEqual({nodes:f.nodes,receipt:f.trace.platformResizePlacements},before);assert.equal(f.stats().undo,1);
});
