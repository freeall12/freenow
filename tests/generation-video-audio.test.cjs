'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createVideoAudioProvider,parseVideoAudioModelMap,VIDEO_AUDIO_MODEL}=require('../server/generation-video-audio.cjs');
const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const videoBytes=require('node:fs').readFileSync(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'));
const video='data:video/mp4;base64,'+videoBytes.toString('base64'),key='fixture-key-only';
const mapping={'sonilo-sfx':{kind:'audio.generate',model:VIDEO_AUDIO_MODEL,semantics:'explicit-native-alternative'}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function wave(seconds=2){const data=Buffer.alloc(seconds*16000*2),b=Buffer.alloc(44+data.length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data.length,40);data.copy(b,44);return b;}
const wav=wave();
function mediaDownload(bytes=wav,details={}){return async()=>({mime:'audio/wav',expectedBytes:bytes.length,stream:(async function*(){yield bytes.subarray(0,40);yield bytes.subarray(40);})(),close(){},...details});}
const provider=(fetchImpl=()=>assert.fail('unexpected network'),options={})=>createVideoAudioProvider({apiKey:key,modelMap:mapping,fetchImpl,download:mediaDownload(),...options});
const request=()=>({kind:'audio.generate',nodeId:'target',prompt:'',inputs:[{id:'source',type:'video',url:video,title:'source',duration:2}],parameters:{model:'sonilo-sfx',virtualModel:'sonilo-music',scene:'Sound',duration:2}});
function completedFetch(calls,result={audio:{url:'https://v3.fal.media/output.wav',content_type:'audio/wav',file_size:wav.length},prompt:'video sounds'}){return async(url,options)=>{calls.push({url,method:options.method,headers:options.headers,body:options.body});return response(options.method==='POST'?{request_id:'original',status:'IN_QUEUE'}:url.includes('/status')?{request_id:'original',status:'COMPLETED'}:result);};}

test('explicit alternative configuration is mandatory, honest and credential-free',()=>{
 const ready=provider();assert.equal(ready.configured,true);assert.equal(ready.metadata.protocol,'fal-video-audio-native');
 const profile=ready.metadata.capabilities.videoAudio['sonilo-sfx'];assert.equal(profile.model,VIDEO_AUDIO_MODEL);assert.equal(profile.label,'ThinkSound Video-to-Audio');assert.equal(profile.semantics,'explicit-native-alternative');assert.equal(profile.providerMaxVideoDuration,null);assert.equal(profile.textOnly,false);assert.equal(profile.segments,false);assert.deepEqual(profile.localVideoDuration,{min:1,max:180});
 assert.ok(!JSON.stringify(ready.metadata).includes(key));assert.deepEqual(parseVideoAudioModelMap(JSON.stringify(mapping)),mapping);
 for(const modelMap of [{...mapping,'sonilo-music':mapping['sonilo-sfx']},{'sonilo-sfx':{kind:'audio.generate',model:VIDEO_AUDIO_MODEL}},{'sonilo-sfx':{...mapping['sonilo-sfx'],model:'fal-ai/mmaudio-v2'}},{'sonilo-sfx':{...mapping['sonilo-sfx'],semantics:'sonilo-native'}},{custom:mapping['sonilo-sfx']},[]])assert.equal(provider(undefined,{modelMap}).metadata.configurationError,'configuration_invalid');
 for(const options of [{baseUrl:'https://attacker.test'},{baseUrl:'https://queue.fal.run:444'},{baseUrl:'https://queue.fal.run/?token=x'},{apiKey:key+'\n'},{mediaTimeoutMs:120001}])assert.equal(provider(undefined,options).configured,false);
 for(const options of [{},{apiKey:key},{modelMap:mapping}]){const unconfigured=createVideoAudioProvider(options);assert.equal(unconfigured.configured,false);assert.throws(()=>unconfigured.prepare(request()),{code:'configuration_required'});}
});

test('video-only optional prompt and actual fal controls preserve exact documented wire body',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return response({request_id:'original'});});
 const r=request();r.parameters.providerParameters={model:'sonilo-sfx',seed:0,num_inference_steps:2,cfg_scale:20};await p.submit(r);
 assert.equal(calls[0].url,'https://queue.fal.run/'+VIDEO_AUDIO_MODEL);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Key '+key);
 assert.deepEqual(JSON.parse(calls[0].options.body),{video_url:video,prompt:'',seed:0,num_inference_steps:2,cfg_scale:20});assert.ok(!calls[0].options.body.includes('duration'));
 r.prompt=' quiet footsteps ';r.parameters.providerParameters={seed:null,num_inference_steps:100,cfg_scale:1};await p.submit(r);assert.equal(JSON.parse(calls[1].options.body).prompt,r.prompt);
});

test('Music, text-only, segments, clips, extra references, duration changes and unsupported settings never POST',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 const changes=[r=>r.parameters.scene='Music',r=>r.parameters.model='sonilo-music',r=>r.parameters.virtualModel='other',r=>r.parameters.duration=3,r=>r.inputs[0].duration=181,r=>r.inputs[0].duration=0.5,r=>delete r.inputs[0].duration,r=>r.inputs=[],r=>r.inputs.push({type:'text',text:'reference'}),r=>r.references=[{type:'video',url:video}],r=>r.references={},r=>r.parameters.segments=[],r=>r.parameters.loop=false,r=>r.parameters.format='wav',r=>r.inputs[0].clip={start:0,end:1},r=>r.inputs[0].trim={start:0,end:1},r=>r.inputs[0].sourceClip={start:0,end:1},r=>r.inputs[0].segments=[],r=>r.sourceRange={start:0,end:1},r=>r.parameters.sourceClip={},r=>r.inputs[0].role='replacement',r=>r.parameters.times=2,r=>r.parameters.canvasResults={targetNodeIds:['a','b']},r=>r.parameters.providerParameters={duration:2},r=>r.parameters.providerParameters={seed:1.1},r=>r.parameters.providerParameters={cfg_scale:0},r=>r.parameters.providerParameters={num_inference_steps:101},r=>r.parameters.modelId='conflicting',r=>r.prompt='x'.repeat(2001)];
 for(const change of changes){const r=request();change(r);await assert.rejects(p.submit(r));}
 assert.equal(posts,0);assert.throws(()=>p.prepare({...request(),parameters:{...request().parameters,segments:[]}}),error=>error.providerDispatched===false);
});

test('MP4 actual envelope, size and mvhd duration are checked; private/original URLs and credential inputs fail',()=>{
 const p=provider();assert.doesNotThrow(()=>p.prepare(request()));
 for(const url of ['data:video/mp4;base64,bm90LXZpZGVv','data:video/mp4;base64,'+videoBytes.subarray(0,24).toString('base64'),'data:image/png;base64,'+videoBytes.toString('base64'),'http://public.test/source.mp4','https://127.0.0.1/v.mp4','https://0x7f000001/v.mp4','https://[::1]/v.mp4','https://user:password@public.test/v.mp4','https://tapnow.media/v.mp4','blob:private','asset:source'])assert.throws(()=>p.prepare({...request(),inputs:[{type:'video',url,duration:2}]}));
 const mismatch=request();mismatch.inputs[0].duration=3;mismatch.parameters.duration=3;assert.throws(()=>p.prepare(mismatch));
 const size=request();size.inputs[0].sizeBytes=videoBytes.length+1;assert.throws(()=>p.prepare(size));
 const bad=request();bad.parameters.apiKey='request-key';assert.throws(()=>p.prepare(bad),{code:'credentials_forbidden'});
 const echoed=request();echoed.prompt=key;assert.throws(()=>p.prepare(echoed),{code:'provider_response_rejected'});
 const remote=request();remote.inputs[0].url='https://public.test/source.mp4';assert.doesNotThrow(()=>p.prepare(remote));remote.inputs[0].duration=180;remote.parameters.duration=180;assert.doesNotThrow(()=>p.prepare(remote));
});

test('original task survives restart and key rotation; SDK app routes recover measured WAV without POST',async()=>{
 const calls=[],p=provider(completedFetch(calls)),accepted=await p.submit(request()),recreated=provider(completedFetch(calls),{apiKey:'rotated-fixture-key'}),result=await recreated.poll(accepted.id);
 assert.equal(recreated.fingerprint,p.fingerprint);assert.equal(result.id,accepted.id);assert.equal(result.status,'succeeded');assert.equal(result.outputs[0].url,'data:audio/wav;base64,'+wav.toString('base64'));assert.equal(result.outputs[0].duration,2);assert.equal(result.outputs[0].mime,'audio/wav');assert.equal(result.outputs[0].sourceFileId,'original');
 assert.deepEqual(calls.map(c=>c.url),['https://queue.fal.run/fal-ai/thinksound/audio','https://queue.fal.run/fal-ai/thinksound/requests/original/status?logs=0','https://queue.fal.run/fal-ai/thinksound/requests/original']);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 await assert.rejects(provider(undefined,{modelMap:{}}).poll(accepted.id),{code:'configuration_required'});await assert.rejects(p.poll('va1.invalid'),{code:'provider_identity_mismatch'});
});

test('wrong task identity is rejected before receiving media',async()=>{
 let downloads=0;const p=provider(async(_url,options)=>response(options.method==='POST'?{request_id:'original'}:{request_id:'different',status:'COMPLETED'}),{download:async()=>{downloads++;assert.fail();}});
 await assert.rejects(p.poll((await p.submit(request())).id),{code:'provider_identity_mismatch'});assert.equal(downloads,0);
});

test('JSON receipt, status and output contamination cannot leak credentials or trigger a second POST',async()=>{
 for(const stage of ['post','status','result'])for(const secret of [key,encodeURIComponent(key),key.split('').map(c=>'%'+c.charCodeAt(0).toString(16)).join('')]){
  let posts=0,downloads=0;const p=provider(async(url,options)=>{if(options.method==='POST'){posts++;return response(stage==='post'?{request_id:'original',leak:secret}:{request_id:'original'});}if(url.includes('/status'))return response(stage==='status'?{status:'COMPLETED',logs:[{message:secret}]}:{status:'COMPLETED'});return response({audio:{url:'https://v3.fal.media/output.wav?echo='+secret},prompt:'sounds'});},{download:async()=>{downloads++;assert.fail();}});
  if(stage==='post')await assert.rejects(p.submit(request()),{code:'unknown'});else await assert.rejects(p.poll((await p.submit(request())).id),{code:'unknown'});assert.equal(posts,1);assert.equal(downloads,0);
 }
});

test('bad audio descriptor or misleading video output remains unknown and never downloads',async()=>{
 for(const result of [{video:{url:'https://v3.fal.media/result.mp4'},prompt:''},{audio:{url:'https://127.0.0.1/a.wav'},prompt:''},{audio:{url:'https://tapnow.media/a.wav'},prompt:''},{audio:{url:'https://v3.fal.media/a.wav',content_type:'video/mp4'},prompt:''},{audio:{url:'https://v3.fal.media/a.wav',file_size:0},prompt:''},{audio:{url:'https://v3.fal.media/a.wav'}}]){
  const calls=[];let downloads=0;const p=provider(completedFetch(calls,result),{download:async()=>{downloads++;assert.fail();}});await assert.rejects(p.poll((await p.submit(request())).id),{code:'unknown'});assert.equal(downloads,0);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 }
});

test('complete WAV bytes, actual length, PCM format, original duration and secret metadata are required',async()=>{
 const bytesWithSecret=Buffer.from(wav);bytesWithSecret.write(key,44);
 for(const [bytes,details]of [[Buffer.from('not audio'),{}],[wav.subarray(0,wav.length-2),{}],[wave(1),{}],[bytesWithSecret,{}],[wav,{expectedBytes:wav.length+1}],[wav,{mime:'video/mp4'}]]){
  const calls=[],p=provider(completedFetch(calls),{download:mediaDownload(bytes,details)});await assert.rejects(p.poll((await p.submit(request())).id),{code:'unknown'});assert.equal(calls.filter(c=>c.method==='POST').length,1);
 }
 const float=Buffer.from(wav);float.writeUInt16LE(3,20);const calls=[],p=provider(completedFetch(calls),{download:mediaDownload(float)});await assert.rejects(p.poll((await p.submit(request())).id),{code:'unknown'});
});

test('safe media downloader pins public DNS, verifies connected peer and sends no model auth',async()=>{
 for(const peer of ['8.8.8.8','127.0.0.1']){
  const requests=[],download=createGenerationMediaDownloader({lookup:async()=>[{address:'8.8.8.8',family:4}],requestImpl:(url,options,callback)=>{
   requests.push({url,options});const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=200;res.socket={remoteAddress:peer};res.headers={'content-type':'audio/wav','content-length':String(wav.length)};callback(res);res.end(wav);});return req;
  }}).download;
  const calls=[],p=provider(completedFetch(calls),{download}),accepted=await p.submit(request());
  if(peer==='8.8.8.8')assert.equal((await p.poll(accepted.id)).status,'succeeded');else await assert.rejects(p.poll(accepted.id),{code:'unknown'});
  assert.equal(requests.length,1);assert.equal(requests[0].options.headers.Authorization,undefined);assert.equal(requests[0].options.agent,false);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 }
 let network=0;const blocked=createGenerationMediaDownloader({lookup:async()=>[{address:'10.0.0.1',family:4}],requestImpl:()=>{network++;assert.fail();}}).download,calls=[],p=provider(completedFetch(calls),{download:blocked});await assert.rejects(p.poll((await p.submit(request())).id),{code:'unknown'});assert.equal(network,0);
});

test('validated provider WAV materializes locally and can be rechecked without another CDN read',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-video-audio-'));let reads=0;
 try{
  const calls=[],p=provider(completedFetch(calls),{download:async(...args)=>{reads++;return mediaDownload()(...args);}}),result=await p.poll((await p.submit(request())).id);
  const store=createGenerationMediaStore({directory:dir});await store.ready;const materializer=createGenerationMediaMaterializer({store}),taskId='11111111-1111-4111-8111-111111111111';
  const local=await materializer.localize(result.outputs,{taskId});assert.match(local.outputs[0].url,/^\/api\/generation\/media\//);assert.equal(local.outputs[0].duration,2);assert.equal((await materializer.verify(local.outputs,{taskId})).resources.length,1);assert.equal(reads,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('lost POST, terminal failure, cancellation and timeout keep the original task boundary',async()=>{
 let posts=0;const lost=provider(async()=>{posts++;throw Error('private-error');});await assert.rejects(lost.generate(request()),error=>error.code==='unknown'&&!error.message.includes('private-error'));assert.equal(posts,1);
 const calls=[],p=provider(async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?{request_id:'original'}:{status:'CANCELLATION_REQUESTED'},options.method==='PUT'?202:200);});
 const accepted=await p.submit(request());assert.deepEqual(await p.cancel(accepted.id),{id:accepted.id,status:'unknown'});assert.equal(calls[1].url,'https://queue.fal.run/fal-ai/thinksound/requests/original/cancel');assert.equal(calls[1].method,'PUT');
 const failed=provider(async(_url,options)=>response(options.method==='POST'?{request_id:'original'}:{status:'COMPLETED',error:'failed'}));assert.equal((await failed.poll((await failed.submit(request())).id)).status,'failed');
 const ids=[];let timeoutPosts=0;const pending=provider(async(_url,options)=>{if(options.method==='POST'){timeoutPosts++;return response({request_id:'original'});}return response({status:'IN_PROGRESS'});});await assert.rejects(pending.generate(request(),{timeout:10,pollInterval:2,onTaskIdentity:id=>ids.push(id)}),{code:'unknown'});assert.equal(timeoutPosts,1);assert.equal(ids.length,1);
});

test('public video sources are read with safe media transport and real MP4 validation before the only POST',async()=>{
 const calls=[],downloads=[],p=provider(completedFetch(calls),{download:async(url,options)=>{downloads.push({url,kind:options.kind});return mediaDownload(options.kind==='video'?videoBytes:wav,{mime:options.kind==='video'?'video/mp4':'audio/wav'})();}}),r=request();r.inputs[0].url='https://media.public.test/source.mp4';r.inputs[0].sizeBytes=videoBytes.length;
 const value=await p.generate(r,{pollInterval:1});assert.equal(value.status,'succeeded');assert.deepEqual(downloads,[{url:'https://media.public.test/source.mp4',kind:'video'},{url:'https://v3.fal.media/output.wav',kind:'audio'}]);assert.equal(JSON.parse(calls[0].body).video_url,video);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 for(const [bytes,details]of [[wav,{mime:'video/mp4'}],[videoBytes,{mime:'audio/wav'}],[videoBytes.subarray(0,24),{mime:'video/mp4'}]]){let posts=0;const bad=provider(async()=>{posts++;assert.fail();},{download:mediaDownload(bytes,details)});await assert.rejects(bad.submit(r),error=>error.code==='unsupported_generation'&&error.providerDispatched===false);assert.equal(posts,0);}
 const unsafe=createGenerationMediaDownloader({lookup:async()=>[{address:'10.0.0.1',family:4}],requestImpl:()=>assert.fail('must not connect to private source')}).download;let posts=0;const blocked=provider(async()=>{posts++;assert.fail();},{download:unsafe});await assert.rejects(blocked.submit(r),error=>error.providerDispatched===false);assert.equal(posts,0);
});

test('header-only, absent visual track, empty mdat and invalid video sample indexes never POST',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 function atom(type,bytes){const b=Buffer.alloc(8+bytes.length);b.writeUInt32BE(b.length);b.write(type,4);bytes.copy(b,8);return b;}
 const header=Buffer.alloc(24);header.writeUInt32BE(1000,12);header.writeUInt32BE(2000,16);
 const ftyp=atom('ftyp',Buffer.from('isom\0\0\0\0')),moov=atom('moov',atom('mvhd',header));
 const fake=[Buffer.concat([ftyp,moov,atom('mdat',Buffer.alloc(0))]),Buffer.concat([ftyp,moov,atom('mdat',Buffer.alloc(4))])];
 for(const mutate of [b=>b.write('soun',b.indexOf(Buffer.from('hdlr'))+12),b=>b.writeUInt32BE(0,b.indexOf(Buffer.from('stsz'))+12),b=>b.writeUInt32BE(1,b.indexOf(Buffer.from('stco'))+12),b=>b.writeUInt32BE(0,b.indexOf(Buffer.from('stts'))+16),b=>b.writeUInt32BE(0,b.indexOf(Buffer.from('stsc'))+16),b=>b.write('xxxx',b.indexOf(Buffer.from('avc1'),40))]){const b=Buffer.from(videoBytes);mutate(b);fake.push(b);}
 for(const bytes of fake){const r=request();r.inputs[0].url='data:video/mp4;base64,'+bytes.toString('base64');await assert.rejects(p.submit(r),error=>error.providerDispatched===false);}
 assert.equal(posts,0);assert.doesNotThrow(()=>p.prepare(request()));
});
