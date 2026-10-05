'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createVideoDepthProvider,parseVideoDepthModelMap,MODEL,ALIAS,PROTOCOL,MAX_VIDEO_BYTES}=require('../server/generation-video-depth.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const {createVideoMaskMediaTools}=require('../server/generation-video-mask-media.cjs');
const bytes=require('node:fs').readFileSync(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4')),video='data:video/mp4;base64,'+bytes.toString('base64'),key='fixture-video-depth-key';
const mapping={[ALIAS]:{kind:'video.depth',model:MODEL}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const request=()=>({kind:'video.depth',nodeId:'source',prompt:'Extract per-frame depth; preserve source movement, camera, duration and frame size.',inputs:[{id:'source',type:'video',url:video,width:64,height:48,duration:2}],parameters:{workflow:'depth-video-studio',protocol:'local-depth-v1',resolution:'source',duration:2,width:64,height:48,preserveDuration:true,promptUsed:false}});
const download=(data=bytes,extra={})=>async()=>({mime:'video/mp4',expectedBytes:data.length,stream:(async function*(){yield data.subarray(0,40);yield data.subarray(40);})(),close(){},...extra});
const provider=(fetchImpl=()=>assert.fail('unexpected network'),options={})=>createVideoDepthProvider({apiKey:key,modelMap:mapping,fetchImpl,download:download(),...options});
function completed(calls,result={video:{url:'https://v3.fal.media/depth.mp4',content_type:'video/mp4',file_size:bytes.length},raw_depths:null}){return async(url,options)=>{calls.push({url,...options});return response(options.method==='POST'?{request_id:'original',status:'IN_QUEUE'}:url.includes('/status')?{status:'COMPLETED',request_id:'original'}:result);};}
const actual={width:64,height:48,duration:2,fps:20,numFrames:40,pts:Array.from({length:40},(_,i)=>i/20),hasAudio:false};

test('exact published endpoint and schema are pinned; configuration is explicit and honest',()=>{
 const contract=require('../docs/research/video-depth-fal-contract-20261005.json');assert.equal(contract.info['x-fal-metadata'].endpointId,MODEL);assert.equal(contract.components.schemas.DepthAnythingVideoInput.properties.resolution.default,'auto');assert.equal(contract.components.schemas.DepthAnythingVideoInput.properties.colormap.default,'grayscale');
 assert.deepEqual(parseVideoDepthModelMap(JSON.stringify(mapping)),mapping);const p=provider();assert.equal(p.configured,true);assert.equal(p.metadata.protocol,PROTOCOL);const profile=p.metadata.capabilities.videoDepth[ALIAS];assert.equal(profile.maxSourceFrames,2400);assert.equal(profile.audioPolicy,'discard');assert.equal(profile.tapNowEquivalent,false);assert.deepEqual(profile.requiresMediaTools,['ffmpeg','ffprobe']);assert.equal(profile.maxInputBytes,MAX_VIDEO_BYTES);assert.ok(!JSON.stringify(p.metadata).includes(key));
 for(const map of [{wrong:mapping[ALIAS]},{[ALIAS]:{...mapping[ALIAS],model:'fal-ai/video-depth-anything'}},{[ALIAS]:{...mapping[ALIAS],kind:'video.generate'}},{[ALIAS]:{...mapping[ALIAS],colormap:'turbo'}},[]])assert.equal(provider(undefined,{modelMap:map}).metadata.configurationError,'configuration_invalid');
 for(const options of [{baseUrl:'https://attacker.test'},{baseUrl:'https://queue.fal.run:444'},{baseUrl:'https://queue.fal.run/?token=x'},{apiKey:key+'\n'},{mediaTimeoutMs:120001}])assert.equal(provider(undefined,options).configured,false);
 for(const options of [{},{apiKey:key},{modelMap:mapping}]){const p=createVideoDepthProvider(options);assert.equal(p.configured,false);assert.throws(()=>p.prepare(request()),{code:'configuration_required'});}
});

test('single kind mapping accepts omitted alias and preserves exact documented wire controls',async()=>{
 const calls=[],p=provider(completed(calls)),accepted=await p.submit(request());assert.equal(accepted.status,'queued');assert.match(accepted.id,/^vd1\./);assert.equal(calls[0].url,'https://queue.fal.run/'+MODEL);assert.equal(calls[0].redirect,'error');assert.equal(calls[0].headers.Authorization,'Key '+key);
 assert.deepEqual(JSON.parse(calls[0].body),{video_url:video,model:'VDA-Large',colormap:'grayscale',resolution:'auto',max_frames:40,output_fps:null,side_by_side:false,include_raw_depths:false});assert.ok(!calls[0].body.includes('prompt'));
});

test('unsupported text, references, raw depth, side-by-side, resizing, clips and conflicting alias fail before POST',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 const changes=[r=>r.kind='video.generate',r=>r.extra='x',r=>r.prompt='recast me',r=>r.parameters.protocol='other',r=>r.parameters.preserveDuration=false,r=>r.parameters.promptUsed=true,r=>r.parameters.resolution='720p',r=>r.parameters.model='other',r=>r.parameters.modelId='other',r=>r.parameters.providerParameters={model:ALIAS,max_frames:10},r=>r.parameters.side_by_side=false,r=>r.parameters.include_raw_depths=false,r=>r.parameters.output_fps=20,r=>r.parameters.colormap='grayscale',r=>r.parameters.times=2,r=>r.parameters.resultMode='storyboard',r=>{delete r.nodeId;delete r.inputs[0].id;},r=>r.parameters.duration=3,r=>r.references={},r=>r.references=[{type:'video',url:video}],r=>r.inputs.push({...r.inputs[0]}),r=>r.inputs[0].clip={start:0,end:1},r=>r.inputs[0].trim={start:0,end:1},r=>r.inputs[0].width=65,r=>r.inputs[0].height=1920,r=>r.inputs[0].mimeType='video/quicktime',r=>r.inputs[0].sizeBytes=bytes.length+1,r=>r.nodeId=' other'];
 for(const change of changes){const r=request();change(r);await assert.rejects(p.submit(r),error=>error.providerDispatched===false);}
 assert.equal(posts,0);const r=request();r.parameters.model=ALIAS;r.parameters.modelId=ALIAS;r.parameters.providerParameters={model:ALIAS};assert.doesNotThrow(()=>p.prepare(r));
});

test('target and upstream source have independent identities; single output supports all host layouts',async()=>{
 for(const mode of ['variants','spread','pile']){const calls=[],r=request();r.nodeId='empty-depth-target';r.parameters.resultMode=mode;r.parameters.layout=mode;const p=provider(completed(calls)),accepted=await p.submit(r);assert.match(accepted.id,/^vd1\./);assert.equal(calls.length,1);assert.ok(!calls[0].body.includes('empty-depth-target'));}
 const r=request();r.inputs[0].nodeId='other-source';assert.throws(()=>provider().prepare(r),error=>error.providerDispatched===false);
});

test('real decoding rejects truncated MP4 and actual source geometry/time mismatch before any network',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 for(const change of [r=>r.inputs[0].url='data:video/mp4;base64,'+bytes.subarray(0,bytes.length-20).toString('base64'),r=>{r.inputs[0].width=32;r.parameters.width=32;},r=>{r.inputs[0].duration=1;r.parameters.duration=1;}]){const r=request();change(r);await assert.rejects(p.submit(r),error=>error.providerDispatched===false);}
 for(const url of ['data:video/mp4;base64,bm90LXZpZGVv','data:image/png;base64,'+bytes.toString('base64'),'blob:source','https://127.0.0.1/a.mp4','https://tapnow.media/a.mp4','https://user:pass@public.test/a.mp4','http://public.test/a.mp4','https://public.test/a.mp4#clip'])assert.throws(()=>p.prepare({...request(),inputs:[{...request().inputs[0],url}]}));
 assert.equal(posts,0);
});

test('source frame and PTS limits are checked from inspection rather than caller labels',async()=>{
 let posts=0;for(const malformed of [{numFrames:2401},{fps:31},{pts:[0,.075,...actual.pts.slice(2)]},{duration:1},{width:64,height:48,pts:[]}]){const p=provider(async()=>{posts++;assert.fail();},{mediaTools:{inspectVideo:async()=>({...actual,...malformed})}});await assert.rejects(p.submit(request()),error=>error.providerDispatched===false);}
 const missing=provider(async()=>{posts++;assert.fail();},{mediaTools:createVideoMaskMediaTools({ffprobePath:'/nonexistent/freenow-probe'})});await assert.rejects(missing.submit(request()),error=>error.code==='media_tool_unavailable'&&error.providerDispatched===false);assert.equal(posts,0);
});

test('public source is safely downloaded and decoded into actual inline bytes before only POST',async()=>{
 const calls=[],reads=[],p=provider(completed(calls),{download:async(url,options)=>{reads.push([url,options.kind]);return download()();}}),r=request();r.inputs[0].url='https://public.test/source.mp4';r.inputs[0].sizeBytes=bytes.length;await p.submit(r);assert.deepEqual(reads,[['https://public.test/source.mp4','video']]);assert.equal(JSON.parse(calls[0].body).video_url,video);assert.equal(calls.length,1);
 let posts=0;const unsafe=createGenerationMediaDownloader({lookup:async()=>[{address:'10.0.0.1',family:4}],requestImpl:()=>assert.fail('private source must never connect')}).download;await assert.rejects(provider(async()=>{posts++;assert.fail();},{download:unsafe}).submit(r),error=>error.providerDispatched===false);assert.equal(posts,0);
});

test('durably saved original identity recovers after reconstruction and key rotation through GET only',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-depth-recovery-'));try{
  const calls=[],p=provider(completed(calls)),accepted=await p.submit(request());await fs.writeFile(path.join(dir,'task.json'),JSON.stringify({remoteTaskId:accepted.id}));const saved=JSON.parse(await fs.readFile(path.join(dir,'task.json'),'utf8'));
  const recreated=provider(completed(calls),{apiKey:'rotated-fixture-key'});assert.equal(recreated.fingerprint,p.fingerprint);const result=await recreated.poll(saved.remoteTaskId);assert.equal(result.id,accepted.id);assert.equal(result.status,'succeeded');assert.equal(result.outputs[0].url,video);assert.deepEqual([result.outputs[0].width,result.outputs[0].height,result.outputs[0].duration],[64,48,2]);assert.deepEqual(JSON.parse(Buffer.from(accepted.id.slice(4),'base64url').toString())[3],[64,48,2,20,40]);assert.equal(result.outputs[0].sourceFileId,'original');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.ok(calls.slice(1).every(c=>c.method==='GET'));
  assert.equal(calls[1].url,'https://queue.fal.run/'+MODEL+'/requests/original/status?logs=0');assert.equal(calls[2].url,'https://queue.fal.run/'+MODEL+'/requests/original');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('complete real video materializes locally and remains verifiable without a new task',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-depth-local-'));try{const calls=[],p=provider(completed(calls)),accepted=await p.submit(request()),result=await p.poll(accepted.id),store=createGenerationMediaStore({directory:dir});await store.ready;const materializer=createGenerationMediaMaterializer({store}),taskId='11111111-1111-4111-8111-111111111111';const local=await materializer.localize(result.outputs,{taskId});assert.match(local.outputs[0].url,/^\/api\/generation\/media\//);assert.equal(local.outputs[0].duration,2);assert.equal((await materializer.verify(local.outputs,{taskId})).resources.length,1);assert.equal(calls.filter(c=>c.method==='POST').length,1);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('malformed or mismatched results stay unknown without re-submitting',async()=>{
 const malformed=[{video:{url:'https://v3.fal.media/depth.mp4',file_size:bytes.length+1}},{video:{url:'https://127.0.0.1/depth.mp4'}},{video:{url:'https://v3.fal.media/depth.mp4',content_type:'video/webm'}},{video:{url:'https://v3.fal.media/depth.mp4'},raw_depths:{url:'https://v3.fal.media/raw.npz'}},{video:{url:'https://v3.fal.media/depth.mp4'},unused:{secret:key}},{video:{url:'https://v3.fal.media/depth.mp4',extra:'x'}}];
 for(const result of malformed){const calls=[],p=provider(completed(calls,result),{mediaTools:{inspectVideo:async()=>actual}}),accepted=await p.submit(request());await assert.rejects(p.poll(accepted.id),{code:'unknown'});assert.equal(calls.filter(c=>c.method==='POST').length,1);}
 for(const changed of [{width:32},{duration:1,numFrames:20,pts:actual.pts.slice(0,20)},{hasAudio:true}]){let reads=0;const calls=[],p=provider(completed(calls),{mediaTools:{inspectVideo:async()=>({...actual,...++reads===1?{}:changed})}}),accepted=await p.submit(request());await assert.rejects(p.poll(accepted.id),{code:'unknown'});assert.equal(calls.filter(c=>c.method==='POST').length,1);}
 const calls=[],p=provider(completed(calls),{download:download(bytes.subarray(0,bytes.length-20))}),accepted=await p.submit(request());await assert.rejects(p.poll(accepted.id),{code:'unknown'});
});

test('task and response identity, credential echoes, bounded reads and late stream timeouts are rejected',async()=>{
 const calls=[],p=provider(completed(calls),{mediaTools:{inspectVideo:async()=>actual}}),accepted=await p.submit(request());for(const id of ['vd1.bad','other',accepted.id+'A'])await assert.rejects(p.poll(id),{code:'provider_identity_mismatch'});
 for(const extra of [{status_url:'https://public.test/?token='+key},{unused:key}]){let posts=0;const bad=provider(async()=>{posts++;return response({request_id:'original',...extra});},{mediaTools:{inspectVideo:async()=>actual}});await assert.rejects(bad.submit(request()),{code:'unknown'});assert.equal(posts,1);}
 let closed=0;const hanging=provider(completed([]),{mediaTools:{inspectVideo:async()=>actual},mediaTimeoutMs:10,download:async()=>({mime:'video/mp4',stream:{[Symbol.asyncIterator](){return {next:()=>new Promise(()=>{}),return:async()=>({done:true})};}},close(){closed++;}})});await assert.rejects(hanging.poll((await hanging.submit(request())).id),{code:'unknown'});assert.equal(closed,1);
 const secret=request();secret.parameters.apiKey='no';assert.throws(()=>p.prepare(secret),{code:'credentials_forbidden'});const echo=request();echo.prompt=key;assert.throws(()=>p.prepare(echo),{code:'provider_response_rejected'});
});

test('lost POST and cancellation preserve unknown task boundary; persistence callback is awaited before GET',async()=>{
 let posts=0;const lost=provider(async()=>{posts++;throw Error('secret-network-error');},{mediaTools:{inspectVideo:async()=>actual}});await assert.rejects(lost.generate(request()),error=>error.code==='unknown'&&!error.message.includes('secret-network-error'));assert.equal(posts,1);
 const calls=[],p=provider(async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?{request_id:'original'}:{status:'CANCELLATION_REQUESTED'},options.method==='PUT'?202:200);},{mediaTools:{inspectVideo:async()=>actual}}),accepted=await p.submit(request());assert.deepEqual(await p.cancel(accepted.id),{id:accepted.id,status:'unknown'});assert.equal(calls[1].method,'PUT');assert.equal(calls[1].url,'https://queue.fal.run/'+MODEL+'/requests/original/cancel');
 const persistCalls=[],saveBlocked=provider(completed(persistCalls),{mediaTools:{inspectVideo:async()=>actual}});await assert.rejects(saveBlocked.generate(request(),{onTaskIdentity:async()=>{await Promise.resolve();throw Object.assign(Error('fixture storage failure'),{code:'storage_error'});}}),{code:'storage_error'});assert.equal(persistCalls.length,1);
 const pollCalls=[],pending=provider(async(_url,options)=>{pollCalls.push(options.method);return response(options.method==='POST'?{request_id:'original'}:{status:'IN_PROGRESS'});},{mediaTools:{inspectVideo:async()=>actual}});const ids=[];await assert.rejects(pending.generate(request(),{timeout:12,pollInterval:2,onTaskIdentity:id=>ids.push(id)}),{code:'unknown'});assert.equal(pollCalls.filter(method=>method==='POST').length,1);assert.equal(ids.length,1);
});
