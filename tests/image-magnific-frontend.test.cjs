'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ready=Promise.all([import('../src/features/image-upscale/native-profile.mjs'),import('../src/features/image-upscale/media.mjs'),import('../image-enhance-core.mjs'),import('../src/features/image-skin/operation.mjs')]);
const request=()=>({kind:'image.upscale',nodeId:'target',sourceNodeId:'source',label:'高清放大',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'source',url:'asset:original'}],parameters:{provider:'magnific',scaleFactor:2,sharpen:7,smartGrain:7,ultraDetail:30}});
const metadata=profile=>({protocol:'magnific-native',configured:true,capabilities:{kinds:['image.upscale'],models:{'image.upscale:magnific':{kind:'image.upscale',model:'magnific-v2'}},upscaleMagnific:structuredClone(profile)}});

test('Magnific request preserves original panel four values and rejects unexpressed intent',async()=>{
 const [p,,core]=await ready,parent={id:'source',image:'asset:thumbnail',fullImage:'asset:original'},node={id:'target',params:core.parameters({upscaleProvider:'magnific',magnificScaleFactor:8,magnificSharpen:0,magnificSmartGrain:100,magnificUltraDetail:39})},r=core.buildRequest(node,parent,core.mediaSource(parent));
 assert.equal(r.inputs[0].url,'asset:original');assert.equal(r.inputs[0].role,'source_image');assert.equal(p.assertMagnificRequest(r),r);assert.deepEqual(r.parameters,{provider:'magnific',scaleFactor:8,sharpen:0,smartGrain:100,ultraDetail:39});
 for(const mutate of [r=>delete r.parameters.sharpen,r=>r.parameters.smartGrain=null,r=>r.parameters.scaleFactor=17,r=>r.parameters.ultraDetail=.5,r=>r.parameters.flavor='sublime',r=>r.prompt='change',r=>r.count=2,r=>r.inputs[0].sourceClip={},r=>r.inputs[0].role='mask',r=>r.inputs.push({...r.inputs[0]}),r=>r.sourceNodeId='other']){const invalid=request();mutate(invalid);assert.throws(()=>p.assertMagnificRequest(invalid),{code:'unsupported_generation',providerDispatched:false});}
});

test('Magnific native readiness requires exact declared contract while configured task gateways remain explicit',async()=>{
 const [p]=await ready,native=metadata(p.magnificProfile),r=request();assert.equal(p.magnificRequestState(native,r).ready,true);
 assert.equal(p.magnificRequestState(native,{kind:'image.upscale',parameters:{provider:'magnific'}}).ready,true);
 for(const mutate of [m=>m.capabilities.upscaleMagnific.parameters.smartGrain.max=99,m=>m.capabilities.upscaleMagnific.tapNowEquivalent=true,m=>delete m.capabilities.upscaleMagnific,m=>m.capabilities.models['image.upscale:magnific'].model='generic',m=>m.configured=false]){const invalid=structuredClone(native);mutate(invalid);assert.equal(p.magnificRequestState(invalid,r).ready,false);}
 const gateway=p.magnificRequestState({protocol:'tasks-v1',configured:true},r);assert.equal(gateway.ready,true);assert.match(gateway.label,/任务网关/);assert.match(gateway.hint,/四项/);
 const invalidGateway=request();delete invalidGateway.parameters.sharpen;assert.equal(p.magnificRequestState({protocol:'tasks-v1',configured:true},invalidGateway).ready,false);
 const routed={protocol:'routed',routes:{'image.upscale':{models:{'image.upscale:magnific':'native','image.upscale:topazlabs':'other'}}},providers:{native,other:{protocol:'tasks-v1',configured:true}}};assert.equal(p.magnificRequestState(routed,r).ready,true);delete routed.routes['image.upscale'].models['image.upscale:magnific'];assert.equal(p.magnificRequestState(routed,r).ready,false);
});

test('Magnific configuration and strict settings are checked before any source I/O',async()=>{
 const [p,m]=await ready;let reads=0;
 for(const scenario of ['missing','profile','parameter']){const config=metadata(p.magnificProfile),r=request();if(scenario==='missing')config.configured=false;if(scenario==='profile')delete config.capabilities.upscaleMagnific;if(scenario==='parameter')r.parameters.scaleFactor=1;
  await assert.rejects(()=>m.prepareMagnificMedia(r,{nativeConfiguration:config,resolveMedia:()=>{reads++;assert.fail('unsupported requests must not read source');}}),{code:'unsupported_generation'});
 }assert.equal(reads,0);
});

test('Magnific native media preserves full source identity and exact settings through original-size normalization',async()=>{
 const [p,m]=await ready,r=request(),before=structuredClone(r);let guards=0,resolves=0,normalizes=0;
 const result=await m.prepareMagnificMedia(r,{nativeConfiguration:metadata(p.magnificProfile),baseUrl:'http://localhost:4173/',validateSources:()=>guards++,resolveMedia:async(value,options)=>{resolves++;assert.equal(value.fullImage,'asset:original');assert.equal(options.decodeImage,false);return {url:'blob:http://localhost:4173/original'};},transport:async(value,options)=>{assert.equal(options.inlineImages,true);assert.equal(options.maxMediaBytes,p.magnificLimits.maxInputBytes);options.validateSources();return {...value,inputs:[{...value.inputs[0],url:'data:image/png;base64,c291cmNl'}]};},normalizePng:async(input,options)=>{normalizes++;options.validateSources();return {...input,width:4096,height:2048};}});
 assert.deepEqual(result.parameters,r.parameters);assert.equal(result.inputs[0].width,4096);assert.equal(result.inputs[0].height,2048);assert.equal(result.inputs[0].nodeId,'source');assert.deepEqual(r,before);assert.equal(resolves,1);assert.equal(normalizes,1);assert.ok(guards>=5);
});

test('Magnific media refuses original-site and credentialed URLs or changed source before normalization',async()=>{
 const [p,m]=await ready;let reads=0;
 for(const url of ['https://tapnow.ai/source.png','https://user:secret@public.test/source.png']){const r=request();r.inputs[0].url=url;await assert.rejects(()=>m.prepareMagnificMedia(r,{nativeConfiguration:metadata(p.magnificProfile),resolveMedia:()=>{reads++;assert.fail('forbidden source read');}}));}assert.equal(reads,0);
 let changed=false;await assert.rejects(()=>m.prepareMagnificMedia(request(),{nativeConfiguration:metadata(p.magnificProfile),validateSources:()=>{if(changed)throw Error('source changed');},resolveMedia:async()=>{changed=true;return {url:'data:image/png;base64,c291cmNl'};},normalizePng:()=>assert.fail('changed source must not normalize')}),/source changed/);
});

test('Magnific normalizer retains decoded dimensions without shrinking and rejects local budgets before conversion',async()=>{
 const [,m]=await ready;let closes=0,drawn,canvas;
 const result=await m.normalizeMagnificPng({url:'data:image/jpeg;base64,c291cmNl'},{fetchImpl:async()=>({ok:true,blob:async()=>({type:'image/jpeg',size:12})}),decode:async()=>({width:1234,height:987,close:()=>closes++}),canvasFactory:()=>canvas={getContext:()=>({drawImage:(...args)=>drawn=args}),toBlob:callback=>callback({type:'image/png',size:40})},serialize:async()=> 'data:image/png;base64,bm9ybWFsaXplZA=='});
 assert.deepEqual([canvas.width,canvas.height,result.width,result.height],[1234,987,1234,987]);assert.deepEqual(drawn.slice(1),[0,0]);assert.equal(closes,1);
 await assert.rejects(()=>m.normalizeMagnificPng({url:'source'},{fetchImpl:async()=>({ok:true,blob:async()=>({type:'image/jpeg',size:33*1024*1024})}),decode:()=>assert.fail('oversized source must not decode')}),/不超过 32 MiB/);
 await assert.rejects(()=>m.normalizeMagnificPng({url:'source'},{fetchImpl:async()=>({ok:true,blob:async()=>({type:'image/jpeg',size:12})}),decode:async()=>({width:8192,height:8192,close:()=>closes++}),canvasFactory:()=>assert.fail('oversized dimensions must not allocate canvas')}),/未缩小图片/);
 assert.equal(closes,2);
});

test('Magnific operation rejects sourceClip before availability or model preparation',async()=>{
 const [p,,,operation]=await ready,parent={id:'source',type:'image',image:'asset:original',sourceClip:{x:1}},node={id:'target',type:'image',tool:'enhance',params:{upscaleProvider:'magnific'}},state={nodes:[parent,node],edges:[{source:'source',target:'target'}],selected:['target']},app={projectIdentity:()=>({id:'project'}),getState:()=>state};
 const op=operation.createEnhanceOperation({app,node,parent,request:request(),requestState:p.magnificRequestState,api:{availability:()=>assert.fail('cropped source must not preflight'),getJobs:()=>[]}});await op.run();assert.equal(op.status,'failed');assert.match(op.error,/完整图片/);assert.equal(op.dispatched,false);
});
