'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto'),{Readable}=require('node:stream');
const {createArkProvider}=require('../server/generation-ark.cjs');
const {createArkVideoMediaProvider,arkVideoUploadConfiguration}=require('../server/generation-ark-video-media.cjs');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const arkKey='ark-synthetic-secret',falKey='fal-synthetic-secret';
const forbiddenBrowserUrls=['https://host.internal/x.mp4','https://host.local./x.mp4','https://localhost./x.mp4','https://node.localhost../x.mp4','https://10.1.2.3/x.mp4','https://100.64.0.1/x.mp4','https://100.127.255.254/x.mp4','https://0x7f000001/x.mp4','https://2130706433/x.mp4','https://0177.0.0.1/x.mp4','https://192.168.1.2./x.mp4','https://172.31.255.1/x.mp4','https://169.254.1.2/x.mp4','https://198.19.1.2/x.mp4','https://203.0.113.1/x.mp4','https://[::1]/x.mp4','https://[2606:4700::1111]/x.mp4','https://tapnow.ai./x.mp4','https://asset.tapnow.media../x.mp4','https://user:pass@media.test/x.mp4','https://media.test/x.mp4#private','https://media.test/ x.mp4'];
const profile={ratios:['adaptive'],resolutions:['720p'],durations:[5],audio:true,maxImages:0,maxVideos:2,maxAudios:0,videoDurationRange:{min:2,max:30,totalMax:30}};
const map={'seedance-2.5':{kind:'video.generate',model:'operator-video-model',modes:{REFERENCE_TO_VIDEO:profile}}};
function videoFixture(size){return (async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-ark-mp4-fixture-'));try{const result=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=orange:s='+size+':r=24:d=5','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',path.join(dir,'video.mp4')]);assert.equal(result.status,0,result.stderr?.toString());return await fs.readFile(path.join(dir,'video.mp4'));}finally{await fs.rm(dir,{recursive:true,force:true});}})();}
const sourcePromise=videoFixture('768x576');
const request=bytes=>({kind:'video.generate',nodeId:'source',prompt:'延续当前画面',inputs:[{type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),role:'reference_video',width:768,height:576,duration:5,durationMs:5000}],parameters:{modelId:'seedance-2.5',videoMode:'REFERENCE_TO_VIDEO',ratio:'adaptive',resolution:'720p',duration:5,count:1}});
async function setup(t,{fetchImpl,uploads,mediaTools,uploaderFactory,download,cleanup=true}={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-ark-publication-'));if(cleanup)t.after(()=>fs.rm(root,{recursive:true,force:true}));const calls=[],uploadsSent=[],states=[];
 const make=()=>createArkVideoMediaProvider({provider:createArkProvider({baseUrl:'https://ark.example.test/api/v3',apiKey:arkKey,modelMap:map,fetchImpl:fetchImpl||(async(url,options)=>{calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});return Response.json(options.method==='POST'?{id:'cgt-original'}:{id:'cgt-original',status:'succeeded',content:{video_url:'https://media.example.test/result.mp4'},duration:5});})}),uploads:uploads??{'seedance-2.5':{providerId:'fal',apiKey:falKey}},apiKey:arkKey,directory:path.join(root,'private'),mediaTools,uploaderFactory:uploaderFactory||(()=>({upload:async(file,{onStage})=>{uploadsSent.push(Buffer.from(file.bytes));const identity={fileUrl:'https://v3.fal.media/synthetic/source.mp4',mime:file.mime,bytes:file.bytes.length,sha256:hash(file.bytes)};for(const stage of ['initiating','initiated','uploading','uploaded'])await onStage({stage,status:stage==='uploaded'?'uploaded':'pending',identity:stage==='initiating'?null:identity,initiationDispatched:true,uploadDispatched:['uploading','uploaded'].includes(stage),retryable:false});return {status:'uploaded',...identity};}})),download:download||(async()=>{const bytes=await sourcePromise;return {mime:'video/mp4',expectedBytes:bytes.length,stream:Readable.from([bytes]),close(){}};})});
 return {make,root,calls,uploadsSent,states,options:{localTaskId:randomUUID(),onPreparationState:s=>states.push(structuredClone(s))}};
}

test('publication configuration references a separately declared fal provider and never guesses credentials or protocols',()=>{
 const providers={fal:{protocol:'fal-native',apiKey:falKey,modelMap:{}}},opted={...map,'seedance-2.5':{...map['seedance-2.5'],videoUploadProvider:'fal'}};
 const value=arkVideoUploadConfiguration(opted,providers);assert.deepEqual(value.modelMap,map);assert.equal(value.uploads['seedance-2.5'].apiKey,falKey);assert.notEqual(value.uploads['seedance-2.5'].apiKey,arkKey);
 for(const p of [{},{fal:{protocol:'tasks-v1',apiKey:falKey}},{fal:{protocol:'fal-native',apiKey:''}},{fal:{protocol:'fal-native',apiKey:falKey,baseUrl:'https://other.test'}}])assert.throws(()=>arkVideoUploadConfiguration(opted,p),{code:'configuration_invalid'});
 assert.deepEqual(arkVideoUploadConfiguration(map,providers).uploads,{});
});

test('pure preflight blocks missing opt-in, malformed inline or private sources without creating files, decoding, uploading or generating',async t=>{
 const bytes=await sourcePromise,f=await setup(t,{uploads:{},mediaTools:{inspectVideo:()=>assert.fail()},fetchImpl:()=>assert.fail(),uploaderFactory:()=>assert.fail()});
 assert.throws(()=>f.make().prepare(request(bytes)),{code:'configuration_required'});await assert.rejects(fs.access(path.join(f.root,'private')));
 const g=await setup(t,{mediaTools:{inspectVideo:()=>assert.fail()},fetchImpl:()=>assert.fail(),uploaderFactory:()=>assert.fail()});
 for(const url of ['data:video/mp4;base64,YQ==','https://127.0.0.1/private.mp4','https://tapnow.ai/media.mp4','https://user:pass@media.test/video.mp4','https://media.test/video.mp4#secret'])assert.throws(()=>g.make().prepare({...request(bytes),inputs:[{...request(bytes).inputs[0],url}]}));
 assert.equal(g.make().prepare(request(bytes)).kind,'video.generate');await assert.rejects(fs.access(path.join(g.root,'private')));
});

test('invalid task identities fail with a stable provider code before networking',async t=>{
 const f=await setup(t,{fetchImpl:()=>assert.fail('invalid identity must not fetch')}),p=f.make();
 for(const id of [null,undefined,42,{},'av1.invalid'])await assert.rejects(()=>p.poll(id),{code:'provider_identity_mismatch'});
 assert.equal(f.uploadsSent.length,0);await assert.rejects(fs.access(path.join(f.root,'private')));
});

test('generate preserves native public-source delegation and rejects a failed original local task without another dispatch',async t=>{
 const bytes=await sourcePromise,f=await setup(t,{fetchImpl:async(url,o)=>{f.calls.push({url,method:o.method});return Response.json(o.method==='POST'?{id:'cgt-original'}:{id:'cgt-original',status:'failed'});}}),p=f.make(),ids=[];
 await assert.rejects(()=>p.generate(request(bytes),{...f.options,pollInterval:1,timeout:30000,onTaskIdentity:id=>ids.push(id)}),{code:'failed'});
 assert.equal(ids.length,1);assert.match(ids[0],/^av1\./);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.uploadsSent.length,1);
 const original={kind:'video.generate',parameters:{modelId:'seedance-2.5'},inputs:[{type:'video',url:'https://media.example.test/source.mp4'}]},opts={pollInterval:123,timeout:456,onProgress:()=>{}},native=createArkVideoMediaProvider({provider:{metadata:{protocol:'ark-native'},prepare:()=>{},generate:(r,o)=>{assert.deepEqual(r,original);assert.deepEqual(o,opts);return {status:'native-sentinel'};}},directory:path.join(f.root,'delegated')});
 assert.deepEqual(await native.generate(original,opts),{status:'native-sentinel'});await assert.rejects(fs.access(path.join(f.root,'delegated')));
});

test('all actual local videos decode before the first upload; false dimensions and missing codecs fail with zero dispatch',async t=>{
 const bytes=await sourcePromise,f=await setup(t);
 const r=request(bytes);r.inputs.push({...r.inputs[0],width:769});
 await assert.rejects(()=>f.make().submit(r,f.options),{code:'ark_video_preparation_failed',providerDispatched:false});assert.equal(f.uploadsSent.length,0);assert.equal(f.calls.length,0);
 const missing=await setup(t,{mediaTools:require('../server/generation-video-mask-media.cjs').createVideoMaskMediaTools({ffprobePath:'/no/such/ffprobe'})});
 await assert.rejects(()=>missing.make().submit(request(bytes),missing.options),{code:'ark_video_preparation_failed',providerDispatched:false});assert.equal(missing.uploadsSent.length,0);
});

test('valid real MP4 publishes exact bytes, submits the native URL once, and saves the original task before returning',async t=>{
 const bytes=await sourcePromise,f=await setup(t),ids=[],r=request(bytes),p=f.make();
 assert.match(p.metadata.capabilities.videoUpload['seedance-2.5'].message,/fal.*公网/);assert.ok(!JSON.stringify(p.metadata).includes(falKey));assert.ok(!JSON.stringify(p.metadata).includes(arkKey));
 const value=await p.submit(r,{...f.options,onTaskIdentity:async id=>{ids.push(id);assert.equal(f.states.at(-1).stage,'generation-accepted');}});
 assert.match(value.id,/^av1\./);assert.deepEqual(ids,[value.id]);assert.deepEqual(f.uploadsSent,[bytes]);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls[0].body.content.find(c=>c.type==='video_url').video_url.url,'https://v3.fal.media/synthetic/source.mp4');assert.ok(r.inputs[0].url.startsWith('data:'));
 const stored=await fs.readFile(path.join(f.root,'private',f.states[0].preparationId,'manifest.json'),'utf8');assert.ok(!stored.includes(arkKey));assert.ok(!stored.includes(falKey));assert.ok(!stored.includes('upload_url'));assert.ok(stored.includes('cgt-original'));
 const recovered=await f.make().resumePreparation(f.states.at(-1),{request:r,localTaskId:f.options.localTaskId});assert.equal(recovered.id,value.id);assert.equal(f.calls.length,1);assert.equal(f.uploadsSent.length,1);
 const result=await f.make().poll(value.id,{request:r,localTaskId:f.options.localTaskId});assert.equal(result.status,'succeeded');assert.deepEqual(Buffer.from(result.outputs[0].url.split(',')[1],'base64'),bytes);assert.deepEqual([result.outputs[0].width,result.outputs[0].height,result.outputs[0].duration],[768,576,5]);
 const before=f.calls.length;assert.equal((await f.make().poll(value.id)).status,'succeeded');assert.equal(f.calls.length,before);assert.equal(f.uploadsSent.length,1);
});

test('lost upload or Ark receipt remains read-only across restart, never republishes or repeats generation',async t=>{
 const bytes=await sourcePromise;
 for(const lost of ['upload','generation']){
  let posts=0,uploads=0;const f=await setup(t,{fetchImpl:async()=>{posts++;throw Error('lost '+arkKey);},...lost==='upload'?{uploaderFactory:()=>({upload:async(_file,{onStage})=>{uploads++;await onStage({stage:'uploading',status:'pending',identity:null,initiationDispatched:true,uploadDispatched:true,retryable:false});throw Error('lost '+falKey);}})}:{}});
  await assert.rejects(()=>f.make().submit(request(bytes),f.options),error=>error.code==='unknown'&&!error.message.includes(arkKey)&&!error.message.includes(falKey));
  const recovered=await f.make().resumePreparation(f.states.at(-1),{request:request(bytes),localTaskId:f.options.localTaskId});assert.equal(recovered.status,'unknown');assert.equal(posts,lost==='generation'?1:0);assert.equal(lost==='upload'?uploads:f.uploadsSent.length,1);
 }
});

test('checkpoint failure, cancellation and request/configuration drift block later remote work',async t=>{
 const bytes=await sourcePromise;
 for(const rejected of ['media-preparing','uploaded','generation-dispatching','generation-accepted']){
  const f=await setup(t);await assert.rejects(()=>f.make().submit(request(bytes),{...f.options,onPreparationState:s=>{f.states.push(s);if(s.stage===rejected)throw Object.assign(Error('private storage'),{code:'storage_error'});}}),{code:'storage_error'});
  assert.equal(f.calls.filter(c=>c.method==='POST').length,rejected==='generation-accepted'?1:0);assert.equal(f.uploadsSent.length,rejected==='media-preparing'?0:1);
 }
 const f=await setup(t),controller=new AbortController();await assert.rejects(()=>f.make().submit(request(bytes),{...f.options,signal:controller.signal,onPreparationState:s=>{f.states.push(s);if(s.stage==='media-ready')controller.abort(Error('cancelled'));}}));assert.equal(f.uploadsSent.length,0);assert.equal(f.calls.length,0);
 const g=await setup(t),accepted=await g.make().submit(request(bytes),g.options);
 await assert.rejects(()=>g.make().poll(accepted.id,{request:{...request(bytes),prompt:'changed'}}),{code:'provider_identity_mismatch'});await assert.rejects(()=>g.make().resumePreparation(g.states.at(-1),{localTaskId:randomUUID()}),{code:'provider_identity_mismatch'});
});

test('result byte corruption or actual geometry mismatch never claims success or resubmits the original task',async t=>{
 const bytes=await sourcePromise,f=await setup(t,{download:async()=>({mime:'video/mp4',stream:Readable.from([Buffer.from('not-video')]),close(){}})}),accepted=await f.make().submit(request(bytes),f.options);
 await assert.rejects(()=>f.make().poll(accepted.id));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.uploadsSent.length,1);
 const g=await setup(t),done=await g.make().submit(request(bytes),g.options);await g.make().poll(done.id);const file=path.join(g.root,'private',g.states[0].preparationId,'result.bin');await fs.writeFile(file,Buffer.from('changed'),{mode:0o600});await assert.rejects(()=>g.make().poll(done.id),{code:'unknown'});assert.equal(g.calls.filter(c=>c.method==='POST').length,1);
});

test('a real 480p square output below the reference minimum area archives with its decoded dimensions',async t=>{
 const bytes=await sourcePromise,result=await videoFixture('480x480'),f=await setup(t,{download:async()=>({mime:'video/mp4',stream:Readable.from([result]),expectedBytes:result.length,close(){}})}),accepted=await f.make().submit(request(bytes),f.options);
 const done=await f.make().poll(accepted.id);assert.equal(done.status,'succeeded');assert.deepEqual([done.outputs[0].width,done.outputs[0].height],[480,480]);assert.deepEqual(Buffer.from(done.outputs[0].url.split(',')[1],'base64'),result);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});

test('router opts existing Ark generation into publication without changing default contracts or exposing credentials',()=>{
 const providers={video:{protocol:'ark-native',baseUrl:'https://ark.example.test/api/v3',apiKey:arkKey,modelMap:{'seedance-2.5':{...map['seedance-2.5'],videoUploadProvider:'fal'}}},fal:{protocol:'fal-native',apiKey:falKey,modelMap:{}}},router=createGenerationRouter({providers,routes:{'video.generate':'video'},fetchImpl:()=>assert.fail()});
 assert.equal(router.configured,true);assert.equal(router.metadata.providers.video.capabilities.videoUpload['seedance-2.5'].providerId,'fal');assert.ok(!JSON.stringify(router.metadata).includes(falKey));assert.ok(!JSON.stringify(router.metadata).includes(arkKey));
 assert.equal(createGenerationRouter({providers:{...providers,fal:{...providers.fal,apiKey:''}},routes:{'video.generate':'video'}}).configured,false);
});

test('browser generation preflight fails before source reads without opt-in and recognizes imported local asset identities',async t=>{
 const bytes=await sourcePromise,f=await setup(t),p=f.make(),{prepareGenerationMediaRequest}=await import('../src/features/node-composer/generation-media.mjs');
 let reads=0;const selected={...p.metadata,capabilities:{...p.metadata.capabilities,videoUpload:{}}};
 await assert.rejects(()=>prepareGenerationMediaRequest(request(bytes),{nativeConfiguration:selected,resolveMedia:()=>{reads++;assert.fail();},transport:()=>assert.fail()}),{code:'configuration_required'});assert.equal(reads,0);
 const {arkVideoPublication,arkLocalVideo}=await import('../src/features/video-generation/ark-upload.mjs');assert.equal(arkVideoPublication(p.metadata,request(bytes)).enabled,true);assert.match(arkVideoPublication(p.metadata,request(bytes)).hint,/fal.*公网 HTTPS/);assert.equal(arkLocalVideo('asset:'+randomUUID()),true);assert.equal(arkLocalVideo('asset://vendor-asset'),false);
 const order=[];await prepareGenerationMediaRequest(request(bytes),{nativeConfiguration:p.metadata,onVideoPublication:hint=>{order.push('notice');assert.match(hint,/fal.*公网 HTTPS/);},resolveMedia:async()=>{order.push('read');return {url:request(bytes).inputs[0].url,width:768,height:576,duration:5};},transport:async value=>{order.push('transport');return value;}});assert.deepEqual(order,['notice','read','transport']);
});

test('shared browser public-video preflight blocks private, normalized and original hosts before ordinary media reads even with publication enabled',async t=>{
 const bytes=await sourcePromise,f=await setup(t),p=f.make(),{prepareGenerationMediaRequest}=await import('../src/features/node-composer/generation-media.mjs'),{arkPublicVideo}=await import('../src/features/video-generation/ark-upload.mjs');
 for(const url of forbiddenBrowserUrls){
  assert.equal(arkPublicVideo(url),false,url);let reads=0,transports=0;
  const r={...request(bytes),inputs:[{...request(bytes).inputs[0],url}]};
  await assert.rejects(()=>prepareGenerationMediaRequest(r,{nativeConfiguration:p.metadata,resolveMedia:()=>{reads++;throw Error('unexpected read');},transport:()=>{transports++;throw Error('unexpected transport');}}),/独立公网 HTTPS/);
  assert.equal(reads,0,url);assert.equal(transports,0,url);
 }
 for(const url of ['https://media.example.test/x.mp4','https://media.example.test./x.mp4','https://8.8.8.8/x.mp4','https://100.128.0.1/x.mp4'])assert.equal(arkPublicVideo(url),true,url);
});

test('extension and reshoot use the same explicit publication profile; local clip preflight, real upload and original task restoration retain their native operations',async t=>{
 const bytes=await sourcePromise,f=await setup(t),{extensionRequestState}=await import('../src/features/video-creation/native-profile.mjs'),{reshootRequestState}=await import('../src/features/video-reshoot/native-profile.mjs');
 for(const kind of ['video.extend','video.reshoot']){
  const entry=kind==='video.extend'?{kind,model:'operator-extension',capabilityMode:'prompt_simulation',resolution:'720p',profile}:{kind,model:'operator-reshoot',capabilityMode:'prompt_simulation',resolution:'720p',profile:{...profile,durations:[-1],maxVideos:1,omniReferenceTaskType:'edit',videoDurationRange:{min:4,max:30,totalMax:30}}};
  const r={kind,nodeId:'source',prompt:'保持主体连续',inputs:[{...request(bytes).inputs[0],role:'source_video'}],parameters:kind==='video.extend'?{modelId:'seedance-2.5',capabilityMode:'prompt_simulation',direction:'片尾延长',extendDirection:'forward',mode:'自然延续',duration:5,ratio:'自适应',sourceClip:null,referenceIds:[],subjects:[],candidateCount:1,resolution:'720p'}:{modelId:'seedance-2.5',schemaVersion:1,intent:'video_multi_view',capabilityMode:'prompt_simulation',aspectRatio:'adaptive',duration:5,candidateCount:1,sourceClip:null,resolution:'720p',tracks:[{segmentId:'shot-1',startTime:0,endTime:5,mode:'static',pointA:{azimuth:0,distance:.5,elevation:0},instruction:'低机位'}]}};
  const factory=kind==='video.extend'?require('../server/generation-video-extend.cjs').createVideoExtendProvider:require('../server/generation-video-reshoot.cjs').createVideoReshootProvider;
  const prepared=arkVideoUploadConfiguration({'seedance-2.5':{...entry,videoUploadProvider:'fal'}},{fal:{protocol:'fal-native',apiKey:falKey}}),calls=[],make=()=>createArkVideoMediaProvider({provider:factory({baseUrl:'https://ark.example.test/api/v3',apiKey:arkKey,modelMap:prepared.modelMap,fetchImpl:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return Response.json({id:'original-'+kind.replace('.','-')});}}),uploads:prepared.uploads,apiKey:arkKey,directory:path.join(f.root,kind),uploaderFactory:()=>({upload:async(file,{onStage})=>{const identity={fileUrl:'https://v3.fal.media/synthetic/'+kind+'.mp4',mime:file.mime,bytes:file.bytes.length,sha256:hash(file.bytes)};await onStage({stage:'uploaded',status:'uploaded',identity,initiationDispatched:true,uploadDispatched:true,retryable:false});return {status:'uploaded',...identity};}})});
  const state=(kind==='video.extend'?extensionRequestState:reshootRequestState)(make().metadata,{...r,parameters:{...r.parameters,sourceClip:{start:0,end:5}}});assert.equal(state.ready,true,state.reason);assert.match(state.hint,/fal.*公网 HTTPS/);
  const plain={...make().metadata,capabilities:{...make().metadata.capabilities,videoUpload:{}}};assert.equal((kind==='video.extend'?extensionRequestState:reshootRequestState)(plain,r).ready,false);
  const readiness=kind==='video.extend'?extensionRequestState:reshootRequestState,prepareMedia=kind==='video.extend'?(await import('../src/features/video-creation/media.mjs')).prepareExtensionMedia:(await import('../src/features/video-reshoot/media.mjs')).prepareReshootMedia;
  for(const url of forbiddenBrowserUrls){
   const invalid={...r,inputs:[{...r.inputs[0],url}]},state=readiness(make().metadata,invalid);assert.equal(state.ready,false,url);assert.match(state.hint,/fal.*公网 HTTPS/);let reads=0;
   await assert.rejects(()=>prepareMedia(invalid,{nativeConfiguration:make().metadata,resolveMedia:()=>{reads++;throw Error('unexpected read');},transport:()=>assert.fail('must not transport')}),{code:'unsupported_generation',providerDispatched:false});assert.equal(reads,0,url);
  }
  const states=[],accepted=await make().submit(r,{localTaskId:f.options.localTaskId,onPreparationState:s=>states.push(s)});assert.equal(calls.length,1);assert.equal(calls[0].body.duration,kind==='video.extend'?5:-1);assert.equal(calls[0].body.content.find(c=>c.type==='video_url').video_url.url,'https://v3.fal.media/synthetic/'+kind+'.mp4');
  assert.equal((await make().resumePreparation(states.at(-1),{request:r,localTaskId:f.options.localTaskId})).id,accepted.id);assert.equal(calls.length,1);
 }
});

test('real routed gateway persists preparation, archives validated MP4, and resumes the original task after restart without another upload or POST',async t=>{
 const bytes=await sourcePromise,f=await setup(t,{cleanup:false});let phase='running',uploads=0,posts=0,gets=0;
 const providers={video:{protocol:'ark-native',baseUrl:'https://ark.example.test/api/v3',apiKey:arkKey,modelMap:{'seedance-2.5':{...map['seedance-2.5'],videoUploadProvider:'fal'}}},fal:{protocol:'fal-native',apiKey:falKey,modelMap:{}}};
 const options={directory:path.join(f.root,'tasks'),mediaDirectory:path.join(f.root,'media'),providers,routes:{'video.generate':'video'},fetchImpl:async(_url,o)=>{if(o.method==='POST'){posts++;return Response.json({id:'cgt-original'});}gets++;return Response.json({id:'cgt-original',status:phase,...phase==='succeeded'?{content:{video_url:'https://media.example.test/result.mp4'},duration:5}:{}});},arkVideoMediaOptions:{uploaderFactory:()=>({upload:async(file,{onStage})=>{uploads++;const identity={fileUrl:'https://v3.fal.media/synthetic/source.mp4',mime:file.mime,bytes:file.bytes.length,sha256:hash(file.bytes)};await onStage({stage:'uploading',status:'pending',identity,initiationDispatched:true,uploadDispatched:true,retryable:false});await onStage({stage:'uploaded',status:'uploaded',identity,initiationDispatched:true,uploadDispatched:true,retryable:false});return {status:'uploaded',...identity};}}),download:async()=>({mime:'video/mp4',stream:Readable.from([bytes]),expectedBytes:bytes.length,close(){}})}};
 let gateway=createGenerationGateway(options);t.after(async()=>{await gateway.close();await fs.rm(f.root,{recursive:true,force:true});});
 const send=async(url,method='GET',input)=>{let result;await gateway.handle({method,headers:{'idempotency-key':'ark-local-mp4-durable-operation'}},{},url,{json:(_r,status,value)=>{result={status,value};},body:async()=>input});return result;};
 const created=(await send('/api/generation/tasks','POST',request(bytes))).value;
 const wait=async statuses=>{for(let i=0;i<150;i++){const value=(await send('/api/generation/tasks/'+created.id)).value;if(statuses.includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('gateway task did not settle');};
 const running=await wait(['running','failed','unknown','configuration_required']);assert.equal(running.status,'running',JSON.stringify(running));assert.equal(uploads,1);assert.equal(posts,1);await gateway.close();phase='succeeded';gateway=createGenerationGateway(options);await gateway.ready;
 const done=await wait(['succeeded','failed','unknown']);assert.equal(done.status,'succeeded',JSON.stringify(done));assert.match(done.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);assert.deepEqual(await fs.readFile(path.join(f.root,'media',done.outputs[0].url.split('/').at(-1)+'.bin')),bytes);assert.equal(uploads,1);assert.equal(posts,1);assert.ok(gets>=1);
 await gateway.close();const previousGets=gets;gateway=createGenerationGateway(options);await gateway.ready;assert.equal((await send('/api/generation/tasks/'+created.id)).value.status,'succeeded');assert.equal(gets,previousGets);assert.equal(posts,1);assert.equal(uploads,1);
 const saved=await fs.readFile(path.join(f.root,'tasks',created.id+'.json'),'utf8');assert.ok(saved.includes('generation-accepted'));assert.ok(!saved.includes(arkKey));assert.ok(!saved.includes(falKey));
});
