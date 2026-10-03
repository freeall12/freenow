'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createFalVideoProvider,FAL_VIDEO_ENDPOINTS}=require('../server/generation-fal-video.cjs');
const mapping={'flux-video-upscale':{kind:'video.upscale',model:FAL_VIDEO_ENDPOINTS.flux},'prob-4':{kind:'video.upscale',model:FAL_VIDEO_ENDPOINTS.topaz,enhancementModel:'Proteus'}};
const videoBytes=fs.readFileSync(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'));
const video='data:video/mp4;base64,'+videoBytes.toString('base64');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const provider=(fetchImpl=()=>assert.fail('unexpected network'),options={})=>createFalVideoProvider({apiKey:'fixture-key-only',modelMap:mapping,fetchImpl,...options});
const request=(flux=true)=>({kind:'video.upscale',nodeId:'target',prompt:'',inputs:[{type:'video',nodeId:'source',role:'source_video',url:video}],parameters:flux?{provider:'bfl',model:'flux-video-upscale',resolution:'2k',originalWidth:1280,originalHeight:720,mode:'precise',creativity:0,upscaleFactor:2,durationSeconds:2,duration:2}:{provider:'topazlabs',model:'prob-4',resolution:'2k',originalWidth:1280,originalHeight:720,width:2560,height:1440,frameRate:'auto',slowMotion:1}});

test('native map requires verified endpoints and explicit Topaz Proteus selection without key leakage',()=>{
 const ready=provider();assert.equal(ready.configured,true);assert.equal(ready.metadata.protocol,'fal-video-native');assert.deepEqual(ready.metadata.capabilities.kinds,['video.upscale']);assert.equal(ready.metadata.capabilities.models['prob-4'].label,'Topaz Proteus');
 for(const modelMap of [{fake:{kind:'video.erase',model:FAL_VIDEO_ENDPOINTS.flux}},{'prob-4':{kind:'video.upscale',model:FAL_VIDEO_ENDPOINTS.topaz}},{'prob-4':{kind:'video.upscale',model:FAL_VIDEO_ENDPOINTS.topaz,enhancementModel:'prob-4'}},{x:{kind:'video.upscale',model:'fal-ai/flashvsr/upscale/video'}},{x:{kind:'video.upscale',model:FAL_VIDEO_ENDPOINTS.flux,enhancementModel:'Proteus'}}]){
  const p=provider(undefined,{modelMap});assert.equal(p.configured,false);assert.equal(p.metadata.configurationError,'configuration_invalid');
 }
 for(const options of [{baseUrl:'https://attacker.test'},{baseUrl:'https://queue.fal.run:444'},{baseUrl:'https://queue.fal.run/?secret=fixture-key-only'},{apiKey:'fixture-key-only\n'},{modelMap:'[]'}]){const p=provider(undefined,options);assert.equal(p.configured,false);assert.ok(!JSON.stringify(p.metadata).includes('fixture-key-only'));}
 assert.ok(!JSON.stringify(ready.metadata).includes('fixture-key-only'));assert.ok(!JSON.stringify(ready.metadata).includes('fal-ai/topaz'));assert.equal(createFalVideoProvider({modelMap:mapping}).configured,false);
});

test('FLUX precise and creative use exact official semantics for all supported target long edges',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response({request_id:'original',status:'IN_QUEUE'});});
 for(const [resolution,factor]of [['1080p',1.5],['2k',2],['4k',3]])for(const creative of [false,true]){
  const r=request();Object.assign(r.parameters,{resolution,upscaleFactor:factor,mode:creative?'creative':'precise',creativity:creative?1:0});if(creative)r.prompt=' restore detail ';
  assert.equal((await p.submit(r)).status,'queued');assert.equal(calls.at(-1).url,'https://queue.fal.run/fal-ai/flux-video-upscale');
  assert.deepEqual(calls.at(-1).body,{video_url:video,upscale_factor:factor,creativity:creative?1:0,...creative?{prompt:'restore detail'}:{}});
 }
});

test('Topaz preserves aspect, sends H264 explicitly and omits interpolation for auto',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response({request_id:'original',status:'IN_QUEUE'});});
 for(const rate of ['auto',30,60]){const r=request(false);r.parameters.frameRate=rate;await p.submit(r);assert.equal(calls.at(-1).url,'https://queue.fal.run/fal-ai/topaz/upscale/video');assert.deepEqual(calls.at(-1).body,{video_url:video,model:'Proteus',upscale_factor:2,H264_output:true,...rate!=='auto'?{target_fps:rate}:{}});}
});

test('90fps, slow motion, altered settings, masks, clip and multiple sources never POST',async()=>{
 let calls=0;const p=provider(async()=>{calls++;assert.fail();});
 const bad=[];
 for(const change of [r=>r.parameters.frameRate=90,r=>r.parameters.slowMotion=2,r=>r.parameters.width=1920,r=>r.prompt='change scene',r=>r.parameters.noise=.5,r=>r.parameters.model='missing',r=>r.parameters.provider='bfl',r=>r.parameters.originalWidth=3840]){const r=request(false);change(r);bad.push(r);}
 for(const change of [r=>r.inputs[0].clip={start:0,end:1},r=>r.inputs[0].trim={start:0,end:1},r=>r.inputs[0].sourceClip={start:0,end:1},r=>r.sourceClip={start:0,end:1},r=>r.parameters.sourceClip={start:0,end:1},r=>r.references=[{type:'video',url:video}],r=>r.inputs.push({type:'image',url:'https://public.test/image.png'}),r=>r.parameters.count=2,r=>r.kind='video.erase',r=>r.inputs[0].role='replacement_video',r=>r.parameters.providerParameters={model:'flux-video-upscale',noise:.5}]){const r=request();change(r);bad.push(r);}
 for(const r of bad)await assert.rejects(p.submit(r));assert.equal(calls,0);
 assert.throws(()=>p.prepare(bad[0]),error=>error.providerDispatched===false&&/90fps/.test(error.message));
});

test('FLUX validates actual inline size, duration, scale and prompt-mode consistency',()=>{
 const p=provider();
 for(const change of [r=>r.parameters.durationSeconds=20.01,r=>r.parameters.duration=3,r=>r.parameters.upscaleFactor=3,r=>r.parameters.creativity=1,r=>r.prompt='not precise',r=>r.parameters.mode='guess',r=>r.inputs[0].sizeBytes=videoBytes.length+1,r=>r.inputs[0].sizeBytes=50000001,r=>r.prompt='x'.repeat(2001)]){const r=request();change(r);assert.throws(()=>p.prepare(r));}
 const boundary=request();Object.assign(boundary.parameters,{durationSeconds:20,duration:20});boundary.inputs[0].sizeBytes=videoBytes.length;assert.doesNotThrow(()=>p.prepare(boundary));
});

test('valid MP4 data and public HTTPS pass; malformed containers, credentials and private media fail',()=>{
 const p=provider();
 for(const url of ['data:video/mp4;base64,bm90LXZpZGVv','data:video/quicktime;base64,'+videoBytes.toString('base64'),'data:image/png;base64,'+videoBytes.toString('base64'),'blob:https://public.test/id','asset:private','http://public.test/v.mp4','https://127.0.0.1/v.mp4','https://0x7f000001/v.mp4','https://[::1]/v.mp4','https://user:password@public.test/v.mp4','https://tapnow.media/source.mp4'])assert.throws(()=>p.prepare({...request(),inputs:[{type:'video',url}]}));
 assert.doesNotThrow(()=>p.prepare({...request(),inputs:[{type:'video',url:'https://public.test/source.mp4'}]}));
 const truncated=videoBytes.subarray(0,24);assert.throws(()=>p.prepare({...request(),inputs:[{type:'video',url:'data:video/mp4;base64,'+truncated.toString('base64')}]}));
 const credentialed=request();credentialed.parameters.apiKey='must-not-send';assert.throws(()=>p.prepare(credentialed),{code:'credentials_forbidden'});
});

test('map alias precedence is explicit and contradictory model aliases are rejected',()=>{
 const p=provider(undefined,{modelMap:{custom:mapping['flux-video-upscale']}}),r=request();r.parameters.model='custom';assert.doesNotThrow(()=>p.prepare(r));
 r.parameters.modelId='different';assert.throws(()=>p.prepare(r));const unmapped=request();assert.throws(()=>p.prepare(unmapped),{code:'configuration_required'});
});

test('accepted Topaz identity survives restart and GET uses original SDK queue app without another POST',async()=>{
 const calls=[],fetchImpl=async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?{request_id:'accepted',status:'IN_QUEUE'}:url.includes('/status')?{request_id:'accepted',status:'COMPLETED'}:{video:{url:'https://v3.fal.media/result.mp4',content_type:'video/mp4',file_size:5000}});};
 const p=provider(fetchImpl),accepted=await p.submit(request(false)),recreated=provider(fetchImpl),result=await recreated.poll(accepted.id);
 assert.equal(result.id,accepted.id);assert.deepEqual(result.outputs,[{type:'video',url:'https://v3.fal.media/result.mp4',mime:'video/mp4',sourceFileId:'accepted'}]);
 assert.deepEqual(calls.map(call=>call.url),['https://queue.fal.run/fal-ai/topaz/upscale/video','https://queue.fal.run/fal-ai/topaz/requests/accepted/status?logs=0','https://queue.fal.run/fal-ai/topaz/requests/accepted']);assert.equal(calls.filter(call=>call.method==='POST').length,1);
 assert.equal(provider(undefined,{apiKey:'rotated-key'}).fingerprint,p.fingerprint);
 const changed=provider(undefined,{modelMap:{'flux-video-upscale':mapping['flux-video-upscale']}});await assert.rejects(changed.poll(accepted.id),{code:'provider_configuration_changed'});
});

test('FLUX identity GET returns actual video and invents neither dimensions nor poster',async()=>{
 const p=provider(async(url,options)=>response(options.method==='POST'?{request_id:'accepted',status:'IN_QUEUE'}:url.includes('/status')?{status:'COMPLETED'}:{video:{url:'https://v3.fal.media/result.mp4',content_type:null}}));
 const result=await p.poll((await p.submit(request())).id);assert.deepEqual(result.outputs,[{type:'video',url:'https://v3.fal.media/result.mp4',sourceFileId:'accepted'}]);
 assert.equal(result.outputs[0].width,undefined);assert.equal(result.outputs[0].poster,undefined);
});

test('wrong identities and malformed completed video stay unknown with no retry',async()=>{
 for(const video of [{url:'blob:fake'},{url:'https://v3.fal.media/result.mp4',content_type:'image/png'},{url:'https://user:password@v3.fal.media/result.mp4'},{url:'https://v3.fal.media/result.mp4',file_size:0},null]){
  let posts=0;const p=provider(async(url,options)=>{if(options.method==='POST'){posts++;return response({request_id:'accepted',status:'IN_QUEUE'});}return response(url.includes('/status')?{status:'COMPLETED'}:{video});});
  const accepted=await p.submit(request());await assert.rejects(p.poll(accepted.id),{code:'unknown'});assert.equal(posts,1);
 }
 const p=provider(async(_url,options)=>response(options.method==='POST'?{request_id:'original',status:'IN_QUEUE'}:{request_id:'different',status:'IN_PROGRESS'}));await assert.rejects(p.poll((await p.submit(request())).id),{code:'provider_identity_mismatch'});await assert.rejects(p.poll('fv1.invalid'),{code:'provider_identity_mismatch'});
});

test('lost POST is not repeated and cancellation acknowledgement never promises computation stopped',async()=>{
 let posts=0;const lost=provider(async()=>{posts++;throw Error('private-provider-error');});await assert.rejects(lost.generate(request()),error=>error.code==='unknown'&&!error.message.includes('private-provider-error'));assert.equal(posts,1);
 const calls=[],p=provider(async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?{request_id:'accepted',status:'IN_QUEUE'}:{status:'CANCELLATION_REQUESTED'},options.method==='PUT'?202:200);});
 const accepted=await p.submit(request());assert.deepEqual(await p.cancel(accepted.id),{id:accepted.id,status:'unknown'});assert.equal(calls[1].method,'PUT');assert.ok(calls[1].url.endsWith('/fal-ai/flux-video-upscale/requests/accepted/cancel'));
});

test('generate polls the one accepted task until actual output retrieval',async()=>{
 const identities=[];let posts=0,gets=0;
 const p=provider(async(url,options)=>{if(options.method==='POST'){posts++;return response({request_id:'accepted',status:'IN_QUEUE'});}return response(url.includes('/status')?{status:++gets===1?'IN_PROGRESS':'COMPLETED'}:{video:{url:'https://v3.fal.media/output.mp4',content_type:'video/mp4'}});});
 const result=await p.generate(request(),{pollInterval:1,onTaskIdentity:id=>identities.push(id)});
 assert.equal(posts,1);assert.equal(identities.length,1);assert.equal(result.id,identities[0]);assert.equal(result.status,'succeeded');
});
