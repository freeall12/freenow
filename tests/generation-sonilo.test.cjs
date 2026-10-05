'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createSoniloProvider,parseSoniloModelMap,validateSoniloSegments,DEFAULT_SONILO_MODEL_MAP}=require('../server/generation-sonilo.cjs');
const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const {waveMetadata}=require('../server/generation-openai-speech.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const key='fixture-sonilo-key-only',smallVideo=fs.readFileSync(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4')),segmentVideo=fs.readFileSync(path.join(__dirname,'../qa/trim-scenes.mp4'));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function wave(seconds=8){const b=Buffer.alloc(44+seconds*16000*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
const downloadBytes=(bytes,mime='audio/wav')=>async()=>({mime,expectedBytes:bytes.length,stream:(async function*(){yield bytes.subarray(0,23);yield bytes.subarray(23);})(),close(){}});
const provider=(fetchImpl=()=>assert.fail('unexpected network'),options={})=>createSoniloProvider({apiKey:key,fetchImpl,download:downloadBytes(wave()),...options});
const request=(bytes=segmentVideo,duration=8)=>({kind:'audio.generate',nodeId:'music-target',prompt:'',inputs:[{id:'source',type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),duration,title:'source'}],parameters:{model:'sonilo-music',virtualModel:'sonilo-music',scene:'Music',duration}});
const textRequest=()=>({kind:'audio.generate',prompt:'铜管与弦乐，渐进到鼓点',inputs:[],parameters:{model:'sonilo-music',scene:'Music',duration:10,segments:[{start:0,label:'intro',prompt:'柔和弦乐'},{start:5,label:'chorus',prompt:'铜管与鼓点'}]}});
function complete(calls,seconds=8,overrides={}){return async(url,options)=>{calls.push({url:String(url),...options});return options.method==='POST'?json({task_id:'original-task',status:'processing'},202):json({task_id:'original-task',type:'video_to_music',status:'succeeded',duration_seconds:seconds,audio:[{stream_index:0,url:'https://media.sonilo.test/output.wav',content_type:'audio/wav',file_size:wave(seconds).length}],...overrides});};}

test('Sonilo independent native metadata, fixed endpoint, model mapping and Key rotation are honest',()=>{
 const ready=provider();assert.equal(ready.configured,true);assert.equal(ready.metadata.protocol,'sonilo-native');assert.deepEqual(parseSoniloModelMap(JSON.stringify(DEFAULT_SONILO_MODEL_MAP)),DEFAULT_SONILO_MODEL_MAP);
 const profile=ready.metadata.capabilities.videoAudio['sonilo-music'];assert.equal(profile.semantics,'native');assert.equal(profile.scene,'Music');assert.equal(profile.segments,true);assert.equal(profile.textOnly,true);assert.equal(profile.maxCount,10);assert.equal(profile.providerMaxVideoDuration,360);assert.equal(ready.metadata.capabilities.videoReferences.transport,'multipart-file');assert.equal(ready.metadata.capabilities.remoteCancellation,false);assert.equal(ready.metadata.capabilities.providerIdempotency,false);assert.ok(!JSON.stringify(ready.metadata).includes(key));
 assert.equal(provider(undefined,{apiKey:'rotated-fixture-key'}).fingerprint,ready.fingerprint);
 for(const options of [{apiKey:''},{modelMap:{}}])assert.equal(provider(undefined,options).configured,false);
 for(const options of [{baseUrl:'https://attacker.test'},{baseUrl:'https://api.sonilo.com/v1'},{baseUrl:'https://api.sonilo.com/?key=x'},{apiKey:key+'\n'},{modelMap:{'sonilo-sfx':{kind:'audio.generate',model:'sonilo-music'}}},{modelMap:{'sonilo-music':{kind:'audio.generate',model:'music_v1'}}},{timeoutMs:120001},{mediaTimeoutMs:0}])assert.equal(provider(undefined,options).metadata.configurationError,'configuration_invalid');
});

test('timed music segments retain exact starts, prompts and labels; invalid boundaries never POST',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});const valid=textRequest();assert.doesNotThrow(()=>p.prepare(valid));assert.deepEqual(validateSoniloSegments(valid.parameters.segments,10),valid.parameters.segments);
 const invalid=[[],[{start:1,prompt:'x'}],[{start:0,prompt:''}],[{start:0,prompt:'x',label:'drop'}],[{start:0,prompt:'x',end:5}],[{start:0,prompt:'x'},{start:4.999,prompt:'y'}],[{start:0,prompt:'x'},{start:6,prompt:'y'}],[{start:0,prompt:'x'.repeat(201)}],Array.from({length:31},(_,i)=>({start:i*5,prompt:'x'}))];
 for(const segments of invalid){const r=textRequest();r.parameters.segments=segments;await assert.rejects(p.submit(r),error=>error.providerDispatched===false);}
 assert.equal(posts,0);
});

test('unimplemented settings, extra references, source selections and wrong scenes remain zero POST',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 const mutations=[r=>r.parameters.scene='Sound',r=>r.parameters.virtualModel='elevenlabs-v3',r=>r.parameters.lyrics='唱词',r=>r.parameters.count=1.5,r=>r.parameters.duration=5,r=>r.parameters.format='m4a',r=>r.parameters.providerParameters={variants_num:2},r=>r.parameters.providerParameters={preserve_speech:true},r=>r.parameters.providerParameters={prompt_influence:1.1},r=>r.parameters.providerParameters={headers:{}},r=>r.inputs.push({...r.inputs[0]}),r=>r.inputs[0].clip={start:0,end:1},r=>r.inputs[0].mime='video/webm',r=>r.references=[{type:'video'}],r=>r.trim={start:0,end:1},r=>r.segments=[{start:0,prompt:'x'}],r=>r.inputs[0].url='https://127.0.0.1/source.mp4',r=>r.inputs[0].url='https://tapnow.media/source.mp4',r=>r.inputs[0].sizeBytes=1,r=>r.prompt=key];
 for(const mutate of mutations){const r=request();mutate(r);await assert.rejects(p.submit(r));}
 const text=textRequest();text.parameters.providerParameters={prompt_influence:.5};await assert.rejects(p.submit(text),error=>error.providerDispatched===false);
 assert.equal(posts,0);
});

test('native binary multipart upload preserves local MP4 bytes, video segments and actual soundtrack timing over HTTP',async t=>{
 const audit=[],bytes=segmentVideo,wav=wave(8);let origin;
 const server=http.createServer(async(req,res)=>{
  try{
   const incoming=new Request(origin+req.url,{method:req.method,headers:req.headers,...req.method==='POST'?{body:req,duplex:'half'}:{}});
   if(req.method==='POST'){
    const form=await incoming.formData(),video=form.get('video');
    audit.push({method:req.method,path:req.url,authorization:req.headers.authorization,fields:[...form.keys()],bytes:Buffer.from(await video.arrayBuffer()),fileName:video.name,mime:video.type,mode:form.get('mode'),format:form.get('output_format'),variants:form.get('variants_num'),segments:form.get('segments'),influence:form.get('prompt_influence')});
    res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({task_id:'original-task',status:'processing'}));
   }else{audit.push({method:req.method,path:req.url,authorization:req.headers.authorization});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({task_id:'original-task',type:'video_to_music',status:'succeeded',duration_seconds:8,audio:[{stream_index:0,url:'https://media.sonilo.test/output.wav',content_type:'audio/wav',file_size:wav.length}]}));}
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(resolve=>server.close(resolve)));
 const downloads=[],p=provider((url,options)=>{assert.ok(String(url).startsWith('https://api.sonilo.com/v1/'));assert.equal(options.redirect,'error');return fetch(origin+new URL(url).pathname,options);},{download:async(url,options)=>{downloads.push({url,options});return downloadBytes(wav)();}});
 const r=request(bytes,8);r.parameters.segments=[{start:0,label:'intro',prompt:'柔和弦乐'}];r.parameters.providerParameters={prompt_influence:.7};
 const ids=[],result=await p.generate(r,{pollInterval:1,onTaskIdentity:id=>ids.push(id)});
 assert.equal(ids.length,1);assert.equal(result.id,ids[0]);assert.equal(result.status,'succeeded');assert.equal(result.outputs[0].duration,8);assert.deepEqual(Buffer.from(result.outputs[0].url.split(',')[1],'base64'),wav);
 assert.equal(audit.length,2);assert.equal(audit[0].path,'/v1/video-to-music');assert.equal(audit[1].path,'/v1/tasks/original-task');assert.equal(audit[0].authorization,'Bearer '+key);assert.deepEqual(audit[0].bytes,bytes);assert.equal(audit[0].mime,'video/mp4');assert.equal(audit[0].fileName,'source.mp4');assert.equal(audit[0].mode,'async');assert.equal(audit[0].format,'wav');assert.equal(audit[0].variants,'1');assert.equal(audit[0].influence,'0.7');assert.deepEqual(JSON.parse(audit[0].segments),r.parameters.segments);assert.ok(!audit[0].fields.includes('duration'));assert.ok(!audit[0].fields.includes('video_url'));assert.ok(!audit[0].fields.includes('model'));
 assert.equal(downloads.length,1);assert.deepEqual(Object.keys(downloads[0].options).sort(),['kind','signal']);assert.equal(downloads[0].options.kind,'audio');
});

test('segmented text music uses a separate native endpoint and never implies video conditioning',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url:String(url),options});return json({task_id:'text-task',status:'processing'},202);});
 const r=textRequest(),accepted=await p.submit(r);assert.equal(accepted.status,'running');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.sonilo.com/v1/text-to-music');
 const form=calls[0].options.body;assert.equal(form.get('duration'),'10');assert.equal(form.get('prompt'),r.prompt);assert.equal(form.get('video'),null);assert.deepEqual(JSON.parse(form.get('segments')),r.parameters.segments);
});

test('explicit variant count stays in one native task, awaits identity persistence, sorts all distinct streams and validates every WAV',async()=>{
 const calls=[],downloads=[],r=textRequest();r.count=r.parameters.count=r.parameters.times=3;
 const wavs=[wave(10),wave(10),wave(10)];wavs[1][44]=1;wavs[2][44]=2;
 let identitySaved=false;
 const p=provider(async(url,options)=>{
  calls.push(options.method);
  if(options.method==='POST'){assert.equal(options.body.get('variants_num'),'3');return json({task_id:'variants',status:'processing'},202);}
  assert.equal(identitySaved,true);
  return json({task_id:'variants',type:'text_to_music',status:'succeeded',audio:[2,0,1].map(index=>({stream_index:index,url:'https://media.sonilo.test/'+index+'.wav',content_type:'audio/wav',file_size:wavs[index].length}))});
 },{download:async(url,options)=>{downloads.push(url);return downloadBytes(wavs[Number(new URL(url).pathname[1])])();}});
 const result=await p.generate(r,{pollInterval:1,onTaskIdentity:async id=>{assert.match(id,/^sn1\./);await new Promise(resolve=>setTimeout(resolve,5));identitySaved=true;}});
 assert.equal(result.outputs.length,3);assert.deepEqual(calls,['POST','GET']);assert.deepEqual(downloads,['https://media.sonilo.test/0.wav','https://media.sonilo.test/1.wav','https://media.sonilo.test/2.wav']);
 for(let i=0;i<3;i++)assert.deepEqual(Buffer.from(result.outputs[i].url.split(',')[1],'base64'),wavs[i]);
 const accepted=await provider(async()=>json({task_id:'variants',status:'processing'},202)).submit(r);
 const base=[0,1,2].map(index=>({stream_index:index,url:'https://media.sonilo.test/'+index+'.wav',content_type:'audio/wav',file_size:wavs[index].length}));
 const invalid=[base.slice(1),[base[0],base[0],base[2]],[base[0],base[1],{...base[2],stream_index:3}],[base[0],base[1],{...base[2],url:base[0].url}],[base[0],base[1],{...base[2],content_type:'audio/mp4'}],base.map(value=>({...value,file_size:50*1024*1024}))];
 for(const audio of invalid){let reads=0;const bad=provider(async()=>json({task_id:'variants',status:'succeeded',audio}),{download:()=>{reads++;assert.fail();}});await assert.rejects(bad.poll(accepted.id),{code:'unknown'});assert.equal(reads,0);}
 let posts=0;const reject=provider(async()=>{posts++;assert.fail();});
 for(const counts of [[0,0,0],[11,11,11],[2,3,2],[1.5,1.5,1.5]]){const bad=textRequest();[bad.count,bad.parameters.count,bad.parameters.times]=counts;await assert.rejects(reject.submit(bad),error=>error.providerDispatched===false);}assert.equal(posts,0);
 const ten=textRequest();ten.parameters.count=10;const max=provider(async(url,options)=>{assert.equal(options.body.get('variants_num'),'10');return json({task_id:'ten',status:'processing'},202);});assert.equal((await max.submit(ten)).status,'running');
});

test('actual decoding rejects forged containers, missing video tracks, false durations and unavailable media tools before POST',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 const wrong=request();wrong.parameters.duration=wrong.inputs[0].duration=9;await assert.rejects(p.submit(wrong),error=>error.providerDispatched===false);
 const atom=(type,content)=>{const b=Buffer.alloc(content.length+8);b.writeUInt32BE(b.length);b.write(type,4);content.copy(b,8);return b;};
 const fake=Buffer.concat([atom('ftyp',Buffer.from('isom\0\0\0\0isom')),atom('moov',atom('mvhd',Buffer.alloc(24))),atom('mdat',Buffer.alloc(4))]);
 await assert.rejects(p.submit(request(fake)),error=>error.providerDispatched===false);
 const unavailable=provider(async()=>{posts++;assert.fail();},{ffprobePath:'/missing/sonilo-fixture-ffprobe'});await assert.rejects(unavailable.submit(request()),error=>error.providerDispatched===false&&error.code==='sonilo_preparation_failed');assert.equal(posts,0);
 const underFive=request(smallVideo,2);await assert.rejects(p.submit(underFive),error=>error.providerDispatched===false);
});

test('public video is downloaded safely then uploaded as validated file bytes, with private DNS blocked before POST',async()=>{
 const calls=[],downloads=[],p=provider(complete(calls),{download:async(url,options)=>{downloads.push({url,kind:options.kind,keys:Object.keys(options)});return downloadBytes(options.kind==='video'?segmentVideo:wave(),options.kind==='video'?'video/mp4':'audio/wav')();}});
 const r=request();r.inputs[0].url='https://media.public.test/source.mp4';r.inputs[0].sizeBytes=segmentVideo.length;const result=await p.generate(r,{pollInterval:1});assert.equal(result.status,'succeeded');assert.deepEqual(downloads.map(value=>value.kind),['video','audio']);assert.deepEqual(Buffer.from(await calls[0].body.get('video').arrayBuffer()),segmentVideo);assert.equal(calls[0].body.get('video_url'),null);assert.ok(downloads.every(value=>!value.keys.includes('headers')));
 let posts=0;const unsafe=createGenerationMediaDownloader({lookup:async()=>[{address:'10.0.0.1',family:4}],requestImpl:()=>assert.fail('private DNS must not connect')}).download;
 await assert.rejects(provider(async()=>{posts++;assert.fail();},{download:unsafe}).submit(r),error=>error.providerDispatched===false);assert.equal(posts,0);
});

test('restart and Key rotation recover only the original task; result failures never regenerate',async()=>{
 let posts=0;const accepted=await provider(async()=>{posts++;return json({task_id:'original-task',status:'processing'},202);}).submit(textRequest());
 const calls=[],recover=provider(complete(calls,10,{type:'text_to_music'}),{apiKey:'rotated-fixture-key',download:downloadBytes(wave(10))});const result=await recover.poll(accepted.id);assert.equal(result.status,'succeeded');assert.equal(posts,1);assert.deepEqual(calls.map(value=>value.method),['GET']);assert.ok(calls[0].url.endsWith('/v1/tasks/original-task'));
 for(const overrides of [{task_id:'other'},{type:'video_to_music'},{audio:[]},{audio:[{stream_index:0,url:'https://media.sonilo.test/output.wav',content_type:'audio/wav',file_size:wave(10).length},{stream_index:1}]},{duration_seconds:9},{error:{code:'error',message:'bad'}},{extra:{authorization:'echo'}},{extra:{url:'https://media.test/'+encodeURIComponent(key)}}]){
  const badCalls=[],bad=provider(complete(badCalls,10,{type:'text_to_music',...overrides}),{download:downloadBytes(wave(10))});await assert.rejects(bad.poll(accepted.id));assert.equal(badCalls.filter(value=>value.method==='POST').length,0);
 }
 for(const [bytes,mime]of [[wave(9),'audio/wav'],[wave(10).subarray(0,44),'audio/wav'],[wave(10),'audio/mpeg']]){const onlyGets=[],bad=provider(complete(onlyGets,10,{type:'text_to_music'}),{download:downloadBytes(bytes,mime)});await assert.rejects(bad.poll(accepted.id),{code:'unknown'});assert.equal(onlyGets.filter(value=>value.method==='POST').length,0);}
 assert.equal(recover.cancel,undefined);await assert.rejects(provider(undefined,{modelMap:{}}).poll(accepted.id));
});

test('official optional sample rate, channels and title are accepted, measured and guarded',async()=>{
 const accepted=await provider(async()=>json({task_id:'original-task',status:'processing'},202)).submit(textRequest());
 const descriptor={stream_index:0,url:'https://media.sonilo.test/output.wav',content_type:'audio/wav',file_size:wave(10).length,sample_rate:16000,channels:1,title:{title:'Ethereal Pulse'}};
 const transport=audio=>async()=>json({task_id:'original-task',type:'text_to_music',status:'succeeded',title:{title:'Ethereal Pulse'},duration_seconds:10,audio:[audio]});
 const value=await provider(transport(descriptor),{download:downloadBytes(wave(10))}).poll(accepted.id);assert.equal(value.outputs[0].title,'Ethereal Pulse');
 for(const patch of [{sample_rate:44100},{channels:2},{sample_rate:16000.5},{channels:3},{title:'Wrong shape'},{title:{title:''}},{title:{title:key}},{title:{title:'Pulse',headers:{}}},{headers:{}}])await assert.rejects(provider(transport({...descriptor,...patch}),{download:downloadBytes(wave(10))}).poll(accepted.id),{code:'unknown'});
});

test('provider rejection is terminal; lost acceptance or poll timeout never resubmits',async()=>{
 let posts=0;const rejected=provider(async()=>{posts++;return json({error:{code:'payment_required',message:'insufficient balance'}},402);});assert.equal((await rejected.submit(textRequest())).status,'failed');assert.equal(posts,1);
 const lost=provider(async()=>{posts++;throw Error('socket lost');});await assert.rejects(lost.submit(textRequest()),{code:'unknown'});assert.equal(posts,2);
 const wrong=provider(async()=>json({task_id:'task',status:'processing'},200));await assert.rejects(wrong.submit(textRequest()),{code:'unknown'});
 const calls=[],ids=[],pending=provider(async(url,options)=>{calls.push(options.method);return options.method==='POST'?json({task_id:'task',status:'processing'},202):json({task_id:'task',type:'text_to_music',status:'processing'});});
 await assert.rejects(pending.generate(textRequest(),{timeout:30,pollInterval:1,onTaskIdentity:id=>ids.push(id)}),{code:'unknown'});assert.equal(calls.filter(method=>method==='POST').length,1);assert.equal(ids.length,1);
});

test('truncated JSON, wrong MIME, credentials in binary media and hanging downloads preserve the original task',async()=>{
 const accepted=await provider(async()=>json({task_id:'original-task',status:'processing'},202)).submit(textRequest());
 const raw=JSON.stringify({task_id:'original-task',status:'processing'});
 for(const response of [new Response(raw,{headers:{'content-type':'text/html'}}),new Response(raw,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(raw)+1)}}),new Response('{',{headers:{'content-type':'application/json'}}),new Response(raw,{headers:{'content-type':'application/json','content-encoding':'gzip'}})])await assert.rejects(provider(async()=>response).poll(accepted.id),{code:'unknown'});
 for(const encoding of ['utf8','utf16le']){const bytes=wave(10);Buffer.from(key,encoding).copy(bytes,44);const bad=provider(complete([],10,{type:'text_to_music'}),{download:downloadBytes(bytes)});await assert.rejects(bad.poll(accepted.id),{code:'unknown'});}
 let closed=0;const pending=provider(complete([],10,{type:'text_to_music'}),{mediaTimeoutMs:10,download:async()=>({mime:'audio/wav',expectedBytes:wave(10).length,stream:{[Symbol.asyncIterator](){return {next:()=>new Promise(()=>{}),return:async()=>({done:true})};}},close(){closed++;}})});
 await assert.rejects(pending.poll(accepted.id),{code:'unknown'});assert.equal(closed,1);
 let posts=0;const lost=provider(async()=>{posts++;return new Promise(()=>{});},{timeoutMs:10});await assert.rejects(lost.submit(textRequest()),{code:'unknown'});assert.equal(posts,1);
});

test('returned complete WAV bytes enter the shared local archive without a second authenticated CDN fetch',async t=>{
 const calls=[],p=provider(complete(calls)),result=await p.generate(request(),{pollInterval:1}),root=await fsp.mkdtemp(path.join(os.tmpdir(),'freenow-sonilo-store-'));
 const store=createGenerationMediaStore({directory:root});await store.ready;t.after(async()=>{await store.close();await fsp.rm(root,{recursive:true,force:true});});const materializer=createGenerationMediaMaterializer({store,download:createGenerationMediaDownloader({requestImpl:()=>assert.fail('no second CDN download')}).download}),taskId='11111111-1111-4111-8111-111111111111';
 const localized=await materializer.localize(result.outputs,{taskId}),outputs=localized.outputs;assert.match(outputs[0].url,/^\/api\/generation\/media\//);assert.equal((await materializer.verify(outputs,{taskId})).resources.length,1);const opened=await store.open(outputs[0].url.split('/').at(-1)),bytes=await opened.handle.readFile();await opened.handle.close();assert.equal(waveMetadata(bytes).duration,8);assert.equal(calls.filter(value=>value.method==='POST').length,1);
});

test('real native pre-upload decode failure persists as failed across durable restart with zero provider POST',async t=>{
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'freenow-sonilo-durable-'));let posts=0,service;
 t.after(async()=>{await service?.close();await fsp.rm(directory,{recursive:true,force:true});});
 const native=provider(async()=>{posts++;assert.fail('false duration must never POST');}),r=request();r.parameters.duration=r.inputs[0].duration=9;
 service=createDurableGenerationService({directory,provider:native});const job=await service.submit(r,{idempotencyKey:'sonilo-native-zero-post'}),failed=await service.get(job.id);
 assert.equal(failed.status,'failed');assert.equal(failed.code,'sonilo_preparation_failed');assert.equal(failed.providerDispatched,false);assert.equal(failed.providerTaskId,undefined);assert.equal(failed.recovery.retryableLookup,false);assert.equal(posts,0);assert.match(failed.error,/尚未上传或提交/);
 await service.close();service=createDurableGenerationService({directory,provider:native});await service.ready;const restored=await service.get(job.id);assert.equal(restored.status,'failed');assert.equal(restored.providerDispatched,false);assert.equal((await service.submit(r,{idempotencyKey:'sonilo-native-zero-post'})).id,job.id);assert.equal(posts,0);
});

test('durable trusted failure code cannot classify remote gateway bodies or accepted task errors as zero submission',async()=>{
 const memory=()=>{const data=new Map();return {readAll:async()=>[...data.values()].map(value=>structuredClone(value)),write:async value=>data.set(value.id,structuredClone(value))};};
 for(const scenario of ['post-unknown','accepted','remote-body']){
  let calls=0;const fake={configured:true,fingerprint:'trusted-sonilo-test',metadata:{protocol:'sonilo-native'},prepare:value=>value,submit:async(_r,{onTaskIdentity})=>{calls++;if(scenario==='accepted')await onTaskIdentity('original-task');throw Object.assign(Error('private https://secret.invalid/?credential=fixture'),scenario==='accepted'?{code:'sonilo_preparation_failed',providerDispatched:false}:{code:'unknown'});},poll:()=>assert.fail('unknown task must not poll automatically')};
  const service=scenario==='remote-body'?createDurableGenerationService({store:memory(),baseUrl:'https://gateway.fixture.test',apiKey:key,fetchImpl:async()=>{calls++;return json({status:'failed',code:'sonilo_preparation_failed',providerDispatched:false});}}):createDurableGenerationService({store:memory(),provider:fake});
  try{const job=await service.submit(textRequest(),{idempotencyKey:'sonilo-'+scenario+'-boundary'}),value=await service.get(job.id);assert.equal(value.status,scenario==='remote-body'?'failed':'unknown');assert.equal(value.providerDispatched,undefined);assert.notEqual(value.error.includes('secret.invalid'),true);assert.equal(value.recovery.retryableLookup,scenario==='accepted');assert.equal(calls,1);if(scenario==='accepted')assert.equal(value.providerTaskId,'original-task');}finally{await service.close();}
 }
});
