'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const vm=require('node:vm'),{execFileSync}=require('node:child_process'),core=require('../audio-core.js'),tools=require('../agent-tools.js');
const {waveMetadata}=require('../server/generation-openai-speech.cjs');
const {createHash}=require('node:crypto');
const {createSoniloProvider,parseSoniloModelMap,validateSoniloSfxSegments,DEFAULT_SONILO_MODEL_MAP}=require('../server/generation-sonilo.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const key='fixture-only-native-sfx-key',modelMap={'sonilo-sfx':{kind:'audio.generate',model:'sonilo-sfx'}};
const shortVideo=fs.readFileSync(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function wave(seconds=2){const b=Buffer.alloc(44+Math.round(seconds*16000)*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
const downloadBytes=(bytes,mime='audio/wav')=>async()=>({mime,expectedBytes:bytes.length,stream:(async function*(){yield bytes.subarray(0,21);yield bytes.subarray(21);})(),close(){}});
const provider=(fetchImpl=()=>assert.fail('unexpected network'),options={})=>createSoniloProvider({apiKey:key,modelMap,fetchImpl,download:downloadBytes(wave()),...options});
const textRequest=(duration=2)=>({kind:'audio.generate',prompt:'雨点敲击金属屋顶',inputs:[],parameters:{model:'sonilo-sfx',virtualModel:'sonilo-sfx',scene:'Sound',duration,count:1}});
const videoRequest=()=>({...textRequest(),prompt:'',inputs:[{id:'fixture-source',type:'video',url:'data:video/mp4;base64,'+shortVideo.toString('base64'),duration:2}],parameters:{...textRequest().parameters,segments:[{start:0,end:.375,prompt:'轻微脚步'},{start:.375,end:1.125,prompt:'玻璃触碰'},{start:1.125,end:2,prompt:'远处回响'}]}});
const descriptor=(bytes=wave())=>({url:'https://media.sonilo.test/original.wav',content_type:'audio/wav',file_size:bytes.length});
const accepted=()=>json({task_id:'original-sfx-task',status:'processing'},202);
const success=(type='text_to_sfx',bytes=wave())=>({task_id:'original-sfx-task',type,status:'succeeded',duration_seconds:(bytes.length-44)/32000,audio:descriptor(bytes)});
const unwrap=id=>JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));
const wrap=values=>'sn1.'+Buffer.from(JSON.stringify(values)).toString('base64url');

async function productionRequest(metadata,{video=false,overrides={}}={}){
 const [native,audio]=await Promise.all([import('../src/features/audio-generation/native-profile.mjs'),import('../src/features/agent-generation/audio.mjs')]);
 const config=core.transition({prompt:video?'':'玻璃轻响'},'sonilo-music','Sound'),source={id:'fixture-source',type:'video',title:'仓库2秒MP4',video:'asset:fixture-video'};
 config.references=video?[{id:source.id,type:'video'}]:[];if(video)config.params.segments=videoRequest().parameters.segments;
 const nodes=[{id:'fixture-audio',type:'audio',audioConfig:config},source],state={nodes,edges:[]},context={app:{getState:()=>state,projectIdentity:()=>({id:'isolated-production-boundary'})},core,nativeUnderTest:native,audioUnderTest:audio,drafts:new Map(),saveTimers:new Map(),structuredClone,setTimeout,clearTimeout,
  window:{GenerationAPI:{availability:async()=>({configured:true}),configuration:async()=>metadata},LocalAssets:{url:async()=> 'blob:fixture-video'}},
  document:{createElement:()=>({duration:2,set src(value){queueMicrotask(()=>this.onloadedmetadata());},removeAttribute(){},load(){}})},fetch:async()=>({blob:async()=>new Blob([shortVideo],{type:'video/mp4'})}),FileReader:class{readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result='data:video/mp4;base64,'+Buffer.from(bytes).toString('base64');this.onload();},error=>this.onerror(error));}}};
 const sourceCode=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=sourceCode.indexOf(' async function buildRequest('),end=sourceCode.indexOf(' async function generate()',start),body=sourceCode.slice(start,end).replace("await import('./src/features/audio-generation/native-profile.mjs')",'nativeUnderTest').replace("await import('./src/features/agent-generation/audio.mjs')",'audioUnderTest');
 vm.createContext(context);vm.runInContext(body+'\nglobalThis.buildUnderTest=buildRequest;',context);
 // GenerationAPI sends JSON. This preserves the real HTTP boundary, including
 // omission of optional undefined fields in the production request object.
 return JSON.parse(JSON.stringify(await context.buildUnderTest('fixture-audio',overrides)));
}

test('production AudioAPI requests and parsed subsecond Agent instructions reach the actual SFX provider contract',async()=>{
 for(const mode of ['video','text-half','text-three-quarters','prompt-limit']){
  const calls=[],seconds=mode==='video'?2:mode==='text-half'?.5:.75,wav=wave(seconds),p=provider(async(url,options)=>{calls.push({url,options});return options.method==='POST'?accepted():json(success(mode==='video'?'video_to_sfx':'text_to_sfx',wav));},{download:downloadBytes(wav)});
  const metadata={protocol:'routed',configured:true,providers:{sfx:p.metadata},routes:{'audio.generate':{models:{'sonilo-sfx':'sfx'}}}},overrides=mode==='video'?{}:tools.parse('generation_submit',{kind:'audio.generate',nodeId:'fixture-audio',model:'sonilo',audioScene:'Sound',prompt:mode==='prompt-limit'?'声'.repeat(2000):'玻璃轻响',duration:seconds,referenceIds:[],count:1}).args;
  const request=await productionRequest(metadata,{video:mode==='video',overrides});assert.equal(request.parameters.virtualModel,'sonilo-music');assert.equal(request.parameters.model,'sonilo-sfx');assert.equal(request.parameters.scene,'Sound');
  assert.deepEqual(p.prepare(request),request);const aliasRequest=structuredClone(request);aliasRequest.parameters.virtualModel='sonilo-sfx';assert.deepEqual(p.prepare(aliasRequest),aliasRequest);
  const result=await p.generate(request,{pollInterval:1});assert.equal(result.status,'succeeded');assert.equal(result.outputs[0].duration,seconds);const form=calls[0].options.body;
  assert.equal(calls[0].url,'https://api.sonilo.com/v1/'+(mode==='video'?'video-to-sfx':'text-to-sfx'));assert.equal(form.get('audio_format'),'wav');
  if(mode==='video'){assert.deepEqual(JSON.parse(form.get('segments')),videoRequest().parameters.segments);assert.deepEqual(Buffer.from(await form.get('video').arrayBuffer()),shortVideo);}else{assert.equal(form.get('duration'),String(seconds));assert.equal(form.get('prompt'),request.prompt);}
  for(const key of ['mode','output_format','variants_num','model','virtualModel'])assert.equal(form.has(key),false,key);
  if(mode==='prompt-limit'){await assert.rejects(productionRequest(metadata,{overrides:{...overrides,prompt:'声'.repeat(2001)}}));const invalid=structuredClone(request);invalid.prompt='声'.repeat(2001);assert.throws(()=>p.prepare(invalid),error=>error.providerDispatched===false);assert.equal(calls.filter(value=>value.options.method==='POST').length,1);}
 }
});

test('SFX decodes genuine PCM24, PCM32 and floating WAV without changing duration or substituting its samples',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sonilo-sfx-wav-fixtures-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const pcm=wave(.75);for(let at=44;at<pcm.length;at+=2)pcm.writeInt16LE(Math.round(Math.sin((at-44)/2*2*Math.PI*440/16000)*4000),at);
 const samples=bytes=>{let at=12;while(bytes.toString('ascii',at,at+4)!=='data')at+=8+bytes.readUInt32LE(at+4)+bytes.readUInt32LE(at+4)%2;return bytes.subarray(at+8,at+8+bytes.readUInt32LE(at+4));};
 for(const codec of ['pcm_s24le','pcm_s32le','pcm_f32le']){
  const file=path.join(directory,codec+'.wav');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','wav','-i','pipe:0','-c:a',codec,'-f','wav',file],{input:pcm,maxBuffer:1024*1024,timeout:10000});const encoded=fs.readFileSync(file);assert.throws(()=>waveMetadata(encoded));let posts=0,gets=0;
  const p=provider(async(_url,options)=>{if(options.method==='POST'){posts++;return accepted();}gets++;return json({...success(),duration_seconds:.75,audio:descriptor(encoded)});},{download:downloadBytes(encoded)}),result=await p.generate(textRequest(.75),{pollInterval:1}),decoded=Buffer.from(result.outputs[0].url.split(',')[1],'base64');
  assert.equal(result.status,'succeeded');assert.equal(result.outputs[0].duration,.75);assert.deepEqual(waveMetadata(decoded),{duration:.75,sampleRate:16000});assert.deepEqual(samples(decoded),samples(pcm),codec);assert.equal(posts,1);assert.equal(gets,1);
  const unavailable=provider(async()=>json({...success(),duration_seconds:.75,audio:descriptor(encoded)}),{download:downloadBytes(encoded),ffmpegPath:'/missing/sfx-fixture-ffmpeg'});await assert.rejects(unavailable.poll(result.id),{code:'unknown'});
 }
});

test('direct and routed gateways honor fixture FFMPEG_PATH and FFPROBE_PATH for Sonilo upload and WAV decoding',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sonilo-sfx-tool-path-fixture-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const log=path.join(directory,'tools.log'),paths={};
 for(const tool of ['ffmpeg','ffprobe']){
  const binary=execFileSync('which',[tool],{encoding:'utf8'}).trim(),wrapper=path.join(directory,'fixture-'+tool);
  fs.writeFileSync(wrapper,'#!'+process.execPath+'\n'+"const fs=require('node:fs'),{spawnSync}=require('node:child_process');\n"+'fs.appendFileSync('+JSON.stringify(log)+','+JSON.stringify(tool+'\n')+');\n'+'const result=spawnSync('+JSON.stringify(binary)+",process.argv.slice(2),{stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);\n",{mode:0o700});paths[tool]=wrapper;
 }
 const encodedFile=path.join(directory,'supplier-pcm24.wav');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','wav','-i','pipe:0','-c:a','pcm_s24le','-f','wav',encodedFile],{input:wave(),timeout:10000});
 const source=String.raw`
  const assert=require('node:assert/strict'),fs=require('node:fs'),{createGenerationGateway}=require(process.argv[1]),{waveMetadata}=require(process.argv[2]);
  const video=fs.readFileSync(process.argv[3]),wav=fs.readFileSync(process.argv[4]),map={'sonilo-sfx':{kind:'audio.generate',model:'sonilo-sfx'}};
  const json=value=>new Response(JSON.stringify(value),{status:value.status==='processing'?202:200,headers:{'Content-Type':'application/json'}});
  async function check(routed){
   let posts=0,gets=0,response;const options={fetchImpl:async(_url,settings)=>{if(settings.method==='POST'){posts++;return json({task_id:'fixture-path-task',status:'processing'});}gets++;return json({task_id:'fixture-path-task',type:'video_to_sfx',status:'succeeded',duration_seconds:2,audio:{url:'https://fixture-media.test/audio.wav',content_type:'audio/wav',file_size:wav.length}});},soniloDownloadImpl:async()=>({mime:'audio/wav',expectedBytes:wav.length,stream:(async function*(){yield wav;})(),close(){}})},provider={protocol:'sonilo-native',apiKey:'fixture-only-path-key',modelMap:map};
   const gateway=createGenerationGateway({...options,...routed?{providers:{sonilo:provider},routes:{'audio.generate':{models:{'sonilo-sfx':'sonilo'}}}}:provider});
   try{
    await gateway.handle({method:'POST',headers:{}},null,'/api/generation/tasks',{body:async()=>({kind:'audio.generate',prompt:'',inputs:[{id:'fixture-video',type:'video',url:'data:video/mp4;base64,'+video.toString('base64'),duration:2}],parameters:{model:'sonilo-sfx',virtualModel:'sonilo-music',scene:'Sound',duration:2,count:1}}),json:(_res,status,body)=>response={status,body}});
    assert.equal(response.status,202);const id=response.body.id;
    for(let at=0;at<500;at++){await gateway.handle({method:'GET',headers:{}},null,'/api/generation/tasks/'+id,{json:(_res,status,body)=>response={status,body}});if(!['queued','running'].includes(response.body.status))break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(response.body.status,'succeeded');assert.deepEqual(waveMetadata(Buffer.from(response.body.outputs[0].url.split(',')[1],'base64')),{duration:2,sampleRate:16000});assert.equal(posts,1);assert.equal(gets,1);
   }finally{await gateway.close();}
  }
  Promise.all([check(false),check(true)]).then(()=>process.stdout.write(JSON.stringify({direct:true,routed:true})),error=>{console.error(error);process.exitCode=1;});
 `;
 const result=execFileSync(process.execPath,['-e',source,require.resolve('../server/generation.cjs'),require.resolve('../server/generation-openai-speech.cjs'),path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'),encodedFile],{encoding:'utf8',timeout:15000,env:{PATH:'/usr/bin:/bin',TMPDIR:directory,FFMPEG_PATH:paths.ffmpeg,FFPROBE_PATH:paths.ffprobe,NODE_NO_WARNINGS:'1'}});
 assert.deepEqual(JSON.parse(result),{direct:true,routed:true});const calls=fs.readFileSync(log,'utf8').trim().split('\n');assert.equal(calls.filter(tool=>tool==='ffmpeg').length,4);assert.equal(calls.filter(tool=>tool==='ffprobe').length,4);
});

test('SFX requires an explicit independent mapping and exposes its actual contract without changing Music default identity',()=>{
 const music=createSoniloProvider({apiKey:key});
 assert.deepEqual(DEFAULT_SONILO_MODEL_MAP,{'sonilo-music':{kind:'audio.generate',model:'sonilo-music'}});
 const originalFingerprint=createHash('sha256').update(JSON.stringify({protocol:'sonilo-native',origin:'https://api.sonilo.com',mapping:DEFAULT_SONILO_MODEL_MAP})).digest('hex');
 assert.equal(music.fingerprint,originalFingerprint);assert.equal(music.metadata.capabilities.videoAudio['sonilo-sfx'],undefined);
 assert.throws(()=>music.prepare(textRequest()),{code:'configuration_required'});
 const sfx=provider(),profile=sfx.metadata.capabilities.videoAudio['sonilo-sfx'];
 assert.deepEqual(parseSoniloModelMap(modelMap),modelMap);assert.equal(profile.scene,'Sound');assert.equal(profile.textOnly,true);assert.equal(profile.semantics,'native');assert.equal(profile.maxCount,1);assert.deepEqual(profile.duration,{min:.5,max:180,automatic:false});assert.deepEqual(profile.localVideoDuration,{min:.5,max:480});assert.equal(profile.providerMaxVideoDuration,480);assert.deepEqual(profile.segmentContract,{maxSegments:30,maxPromptCharacters:200,fields:['start','end','prompt'],firstStart:0,contiguous:true,videoOnly:true});
 assert.equal(sfx.metadata.capabilities.music['sonilo-sfx'],undefined);assert.deepEqual(sfx.metadata.capabilities.sound['sonilo-sfx'],profile);assert.equal(sfx.metadata.capabilities.remoteCancellation,false);assert.equal(sfx.metadata.capabilities.providerIdempotency,false);assert.equal(sfx.cancel,undefined);assert.equal(sfx.fingerprint,provider(undefined,{apiKey:'rotated-fixture-key'}).fingerprint);assert.ok(!JSON.stringify(sfx.metadata).includes(key));
 const combined={...DEFAULT_SONILO_MODEL_MAP,...modelMap};assert.equal(provider(undefined,{modelMap:combined}).configured,true);assert.notEqual(provider(undefined,{modelMap:combined}).fingerprint,music.fingerprint);
 for(const map of [{'sonilo-sfx':{kind:'audio.generate',model:'sonilo-music'}},{'sonilo-music':{kind:'audio.generate',model:'sonilo-sfx'}},{'sonilo-v2':{kind:'audio.generate',model:'sonilo-v2'}}])assert.equal(provider(undefined,{modelMap:map}).configured,false);
});

test('video SFX contiguous decimal intervals retain exact values and reject ambiguity before any POST',async()=>{
 const valid=videoRequest();assert.deepEqual(validateSoniloSfxSegments(valid.parameters.segments,2),valid.parameters.segments);
 const partial=[{start:0,end:.25,prompt:'短促敲击'}];assert.deepEqual(validateSoniloSfxSegments(partial,2),partial);
 const invalid=[[],[{start:.001,end:2,prompt:'x'}],[{start:0,end:0,prompt:'x'}],[{start:0,end:2.001,prompt:'x'}],[{start:0,end:1,prompt:'x'},{start:1.001,end:2,prompt:'y'}],[{start:0,end:1,prompt:'x'},{start:.999,end:2,prompt:'y'}],[{start:0,end:2,prompt:'x',label:'none'}],[{start:0,end:2,prompt:''}],[{start:0,end:2,prompt:'x'.repeat(201)}],[{start:0,prompt:'x'}],Array.from({length:31},(_,i)=>({start:i/20,end:(i+1)/20,prompt:'x'}))];
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 for(const segments of invalid){const r=videoRequest();r.parameters.segments=segments;await assert.rejects(p.submit(r),error=>error.providerDispatched===false);}
 const text=textRequest();text.parameters.segments=partial;await assert.rejects(p.submit(text),error=>error.providerDispatched===false);assert.equal(posts,0);
});

test('native video SFX uses actual MP4 bytes over HTTP, SFX-only form fields, and a single WAV object',async t=>{
 const audit=[],wav=wave();let origin,saved=false;
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method==='POST'){
    const incoming=new Request(origin+req.url,{method:'POST',headers:req.headers,body:req,duplex:'half'}),form=await incoming.formData(),video=form.get('video');
    audit.push({path:req.url,authorization:req.headers.authorization,fields:[...form.keys()],video:Buffer.from(await video.arrayBuffer()),name:video.name,mime:video.type,segments:JSON.parse(form.get('segments')),format:form.get('audio_format')});
    res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({task_id:'original-sfx-task',status:'processing'}));
   }else{assert.equal(saved,true);audit.push({path:req.url});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(success('video_to_sfx',wav)));}
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(resolve=>server.close(resolve)));
 const downloads=[],p=provider((url,options)=>{assert.equal(new URL(url).origin,'https://api.sonilo.com');assert.equal(options.redirect,'error');return fetch(origin+new URL(url).pathname,options);},{download:async(url,options)=>{downloads.push({url,options});return downloadBytes(wav)();}}),r=videoRequest();
 let identities=0;const result=await p.generate(r,{pollInterval:1,onTaskIdentity:async id=>{identities++;assert.deepEqual(unwrap(id).slice(1,6),['sonilo-sfx','video_to_sfx','original-sfx-task',2,1]);await new Promise(resolve=>setTimeout(resolve,5));saved=true;}});
 assert.equal(identities,1);assert.equal(result.status,'succeeded');assert.equal(result.outputs.length,1);assert.equal(result.outputs[0].duration,2);assert.deepEqual(Buffer.from(result.outputs[0].url.split(',')[1],'base64'),wav);
 assert.equal(audit.length,2);assert.equal(audit[0].path,'/v1/video-to-sfx');assert.equal(audit[1].path,'/v1/tasks/original-sfx-task');assert.equal(audit[0].authorization,'Bearer '+key);assert.deepEqual(audit[0].video,shortVideo);assert.equal(audit[0].mime,'video/mp4');assert.equal(audit[0].name,'source.mp4');assert.equal(audit[0].format,'wav');assert.deepEqual(audit[0].fields.sort(),['audio_format','segments','video']);assert.deepEqual(audit[0].segments,r.parameters.segments);assert.deepEqual(Object.keys(downloads[0].options).sort(),['kind','signal']);
});

test('text SFX keeps fractional duration, permits documented boundaries, and never sends Music fields or video segments',async()=>{
 for(const seconds of [.5,2.375,180]){
  const calls=[],wav=wave(seconds),p=provider(async(url,options)=>{calls.push({url,options});return options.method==='POST'?accepted():json(success('text_to_sfx',wav));},{download:downloadBytes(wav)});
  const result=await p.generate(textRequest(seconds),{pollInterval:1});assert.equal(result.outputs[0].duration,seconds);assert.equal(calls[0].url,'https://api.sonilo.com/v1/text-to-sfx');const form=calls[0].options.body;assert.equal(form.get('duration'),String(seconds));assert.equal(form.get('audio_format'),'wav');assert.deepEqual([...form.keys()].sort(),['audio_format','duration','prompt']);
 }
});

test('unsupported SFX settings, scenes, counts and source claims are rejected without billable submission',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 const mutations=[r=>r.parameters.scene='Music',r=>r.parameters.virtualModel='other-selector',r=>r.parameters.modelId='sonilo-music',r=>r.parameters.count=2,r=>r.count=2,r=>r.parameters.times=2,r=>r.parameters.duration=.499,r=>r.parameters.duration=180.001,r=>r.parameters.duration='2',r=>r.prompt='',r=>r.prompt='x'.repeat(2001),r=>r.parameters.providerParameters={prompt_influence:.5},r=>r.parameters.providerParameters={audio_format:'wav'},r=>r.parameters.providerParameters={variants_num:1},r=>r.parameters.providerParameters={mode:'async'},r=>r.parameters.providerParameters={preserve_speech:false},r=>r.parameters.providerParameters={ducking:false},r=>r.parameters.providerParameters={stems:false},r=>r.parameters.providerParameters={model:'sonilo-music'},r=>r.parameters.format='mp3',r=>r.inputs=[{type:'image',url:'https://example.test/a.png'}],r=>r.clip={start:0,end:2},r=>r.references=[{type:'video'}]];
 for(const mutate of mutations){const r=textRequest();mutate(r);await assert.rejects(p.submit(r),error=>error.providerDispatched===false||error.code==='configuration_required');}
 const video=videoRequest();video.parameters.duration=video.inputs[0].duration=480.001;await assert.rejects(p.submit(video),error=>error.providerDispatched===false);
 const valid=textRequest();valid.count=valid.parameters.times=1;valid.parameters.providerParameters={model:'sonilo-sfx'};assert.doesNotThrow(()=>p.prepare(valid));
 assert.equal(posts,0);
});

test('decoded video mismatch, unavailable tools and unsafe public source all fail before upload',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 const mismatch=videoRequest();mismatch.inputs[0].duration=mismatch.parameters.duration=2.5;await assert.rejects(p.submit(mismatch),error=>error.code==='sonilo_preparation_failed'&&error.providerDispatched===false);
 await assert.rejects(provider(async()=>{posts++;assert.fail();},{ffprobePath:'/missing/sfx-fixture-ffprobe'}).submit(videoRequest()),error=>error.code==='sonilo_preparation_failed'&&error.providerDispatched===false);
 const unsafe=createGenerationMediaDownloader({lookup:async()=>[{address:'10.0.0.1',family:4}],requestImpl:()=>assert.fail('private peer must not connect')}).download;
 const r=videoRequest();r.inputs[0].url='https://public.fixture.test/source.mp4';await assert.rejects(provider(async()=>{posts++;assert.fail();},{download:unsafe}).submit(r),error=>error.providerDispatched===false);assert.equal(posts,0);
});

test('safe public SFX source is downloaded without credentials and uploaded as the validated original file',async()=>{
 const calls=[],downloads=[],p=provider(async(url,options)=>{calls.push(options);return options.method==='POST'?accepted():json(success('video_to_sfx'));},{download:async(url,options)=>{downloads.push({url,keys:Object.keys(options),kind:options.kind});return downloadBytes(options.kind==='video'?shortVideo:wave(),options.kind==='video'?'video/mp4':'audio/wav')();}});
 const r=videoRequest();r.inputs[0].url='https://public.fixture.test/source.mp4';r.inputs[0].sizeBytes=shortVideo.length;const result=await p.generate(r,{pollInterval:1});assert.equal(result.status,'succeeded');assert.deepEqual(downloads.map(value=>value.kind),['video','audio']);assert.ok(downloads.every(value=>!value.keys.includes('headers')));assert.deepEqual(Buffer.from(await calls[0].body.get('video').arrayBuffer()),shortVideo);assert.equal(calls[0].body.get('video_url'),null);
});

test('SFX recovery uses exact original identity and rejects result contamination, shape changes and invalid PCM',async()=>{
 let posts=0;const receipt=await provider(async()=>{posts++;return accepted();}).submit(textRequest());
 const calls=[],rotated=provider(async(url,options)=>{calls.push({url,method:options.method});return json(success());},{apiKey:'rotated-sfx-fixture-key'});assert.equal((await rotated.poll(receipt.id)).status,'succeeded');assert.equal(posts,1);assert.deepEqual(calls,[{url:'https://api.sonilo.com/v1/tasks/original-sfx-task',method:'GET'}]);
 const invalid=[{task_id:'other-task'},{type:'video_to_sfx'},{audio:[descriptor()]},{audio:{...descriptor(),stream_index:0}},{audio:{...descriptor(),content_type:'audio/mpeg'}},{audio:{...descriptor(),url:'https://127.0.0.1/a.wav'}},{duration_seconds:3},{sfx:descriptor()},{music:descriptor()},{outputs:[]},{title:{title:'unexpected music'}},{error:{code:'x',message:'x'}},{status:'completed'},{status:'processing',audio:descriptor()}];
 for(const patch of invalid){let reads=0;const bad=provider(async()=>json({...success(),...patch}),{download:()=>{reads++;assert.fail();}});await assert.rejects(bad.poll(receipt.id));assert.equal(reads,0);}
 await assert.rejects(provider(async()=>json({...success(),audio:{...descriptor(),file_size:wave().length-1}})).poll(receipt.id),{code:'unknown'});
 const floatingPcm=wave();floatingPcm.writeUInt16LE(3,20);
 for(const bytes of [wave(3),wave().subarray(0,44),floatingPcm]){
  await assert.rejects(provider(async()=>json({...success(),audio:descriptor(bytes)}),{download:downloadBytes(bytes)}).poll(receipt.id),{code:'unknown'});
 }
 for(const patch of [{at:1,value:'sonilo-music'},{at:2,value:'video_to_music'},{at:4,value:180.001},{at:5,value:2}]){const values=unwrap(receipt.id);values[patch.at]=patch.value;await assert.rejects(rotated.poll(wrap(values)),{code:'provider_identity_mismatch'});}
 await assert.rejects(provider(undefined,{modelMap:DEFAULT_SONILO_MODEL_MAP}).poll(receipt.id),{code:'provider_identity_mismatch'});
});

test('submit awaits durable identity storage; failed storage, lost POST and unknown polls never resubmit',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push(options.method);return options.method==='POST'?accepted():json(success());});let saved=false,callbacks=0;
 const receipt=await p.submit(textRequest(),{onTaskIdentity:async()=>{callbacks++;await new Promise(resolve=>setTimeout(resolve,5));saved=true;}});assert.equal(saved,true);assert.equal(callbacks,1);assert.equal(receipt.status,'running');assert.deepEqual(calls,['POST']);
 await assert.rejects(p.generate(textRequest(),{pollInterval:1,onTaskIdentity:async()=>{throw Error('fixture storage failed');}}),{code:'unknown'});assert.deepEqual(calls,['POST','POST']);
 let lost=0;await assert.rejects(provider(async()=>{lost++;throw Error('fixture network lost');}).submit(textRequest()),{code:'unknown'});assert.equal(lost,1);
 const bad=provider(async(_url,options)=>{assert.equal(options.method,'GET');return json({task_id:'original-sfx-task',type:'text_to_sfx',status:'unrecognized'});});await assert.rejects(bad.poll(receipt.id),{code:'unknown'});
 const reject=await provider(async()=>json({error:{code:'payment_required',message:'fixture insufficient balance'}},402)).submit(textRequest());assert.equal(reject.status,'failed');
});

test('SFX durable restart and Key rotation preserve original task identity and never issue a second POST',async()=>{
 const snapshots=new Map(),store={readAll:async()=>[...snapshots.values()].map(value=>structuredClone(value)),write:async value=>snapshots.set(value.id,structuredClone(value))};let posts=0,gets=0;
 const transport=async(_url,options)=>{if(options.method==='POST'){posts++;return accepted();}gets++;return json({task_id:'original-sfx-task',type:'text_to_sfx',status:'processing'});};
 let service=createDurableGenerationService({store,provider:provider(transport)});
 try{
  const job=await service.submit(textRequest(),{idempotencyKey:'native-sfx-original'}),running=await service.get(job.id);assert.equal(running.status,'running');assert.match(running.providerTaskId,/^sn1\./);assert.equal(snapshots.get(job.id).providerTaskId,running.providerTaskId);assert.equal(posts,1);
  await service.close();service=createDurableGenerationService({store,provider:provider(transport,{apiKey:'rotated-durable-fixture-key'})});await service.ready;
  const restored=await service.get(job.id);assert.equal(restored.providerTaskId,running.providerTaskId);assert.equal(restored.status,'running');assert.equal(gets,1);assert.equal(posts,1);assert.equal((await service.submit(textRequest(),{idempotencyKey:'native-sfx-original'})).id,job.id);
 }finally{await service.close();}
});

test('original seven-slot Music sn1 identity remains accepted under the unchanged default map',async()=>{
 const music=createSoniloProvider({apiKey:key,fetchImpl:async(_url,options)=>{assert.equal(options.method,'GET');return json({task_id:'old-music-task',type:'text_to_music',status:'processing'});}});
 const original=wrap([music.fingerprint,'sonilo-music','text_to_music','old-music-task',10,3,'a'.repeat(64)]);
 assert.deepEqual(await music.poll(original),{id:original,status:'running'});
});
