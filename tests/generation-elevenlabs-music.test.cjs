'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createElevenLabsMusicProvider,parseElevenLabsMusicModelMap,MAX_AUDIO_BYTES}=require('../server/generation-elevenlabs-music.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const {createGenerationMediaHttp}=require('../server/generation-media-http.cjs');
const key='synthetic-elevenlabs-music-private-key',request={kind:'audio.generate',prompt:'温暖的中文民谣，吉他伴奏。',inputs:[],parameters:{model:'music_v1',scene:'Music',virtualModel:'elevenlabs-v3',lyric_mode:false,force_instrumental:false,lyrics:''}};
const mp3=require('node:fs').readFileSync(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3'));
const audio=(bytes=mp3,mime='audio/mpeg',headers={})=>new Response(bytes,{headers:{'content-type':mime,...headers}});
const provider=options=>createElevenLabsMusicProvider({apiKey:key,fetchImpl:async()=>audio(),...options});
const params=changes=>({...request,parameters:{...request.parameters,...changes}});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};
async function settled(service,id){for(let i=0;i<200;i++){const value=await service.get(id);if(['succeeded','failed','unknown'].includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('task did not settle');}
test('native Music v1 exact POST returns complete MP3 and exposes independent capabilities',async()=>{
 let calls=0;const native=provider({fetchImpl:async(url,options)=>{calls++;assert.equal(String(url),'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128');assert.equal(options.method,'POST');assert.equal(options.headers['xi-api-key'],key);assert.equal(options.headers.Accept,'audio/mpeg');assert.equal(options.headers['Accept-Encoding'],'identity');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{prompt:request.prompt,model_id:'music_v1',force_instrumental:false});return audio();}});
 const result=await native.submit(request);assert.deepEqual(result,{status:'succeeded',outputs:[{type:'audio',url:'data:audio/mpeg;base64,'+mp3.toString('base64')}]});assert.equal(calls,1);assert.equal(native.metadata.protocol,'elevenlabs-music-native');assert.equal(native.metadata.capabilities.music.music_v1.scene,'Music');assert.deepEqual(native.metadata.capabilities.music.music_v1.duration,{min:3,max:600,automatic:true});assert.equal(native.metadata.capabilities.remoteRecovery,false);assert.equal(native.metadata.capabilities.remoteCancellation,false);assert.equal(native.poll,undefined);assert.equal(native.cancel,undefined);assert.equal(native.isPollable(),false);assert.equal(JSON.stringify(native.metadata).includes(key),false);assert.equal(provider({apiKey:'rotated-key'}).fingerprint,native.fingerprint);
});
test('default mapping, missing Key, invalid configs and TTS/SFX/model v2 isolation fail closed',()=>{
 assert.equal(parseElevenLabsMusicModelMap().music_v1.model,'music_v1');
 for(const options of [{apiKey:''},{apiKey:'bad\nkey'},{modelMap:{}},{modelMap:'bad-json'},{baseUrl:'https://tapnow.media'},{baseUrl:'https://example.test/v1'},{modelMap:{music_v1:{kind:'audio.generate',model:'eleven_v3'}}},{modelMap:{music_v1:{kind:'audio.generate',model:'eleven_text_to_sound_v2'}}},{modelMap:{music_v1:{kind:'audio.generate',model:'music_v2'}}},{modelMap:{music_v1:{kind:'audio.generate',model:'music_v1',outputFormat:'wav_24000'}}},{modelMap:{music_v1:{kind:'audio.generate',model:'music_v1',voice:'other'}}}]){const native=provider(options);assert.equal(native.configured,false);assert.throws(()=>native.prepare(request),{code:'configuration_required'});}
});
test('auto duration omitted, exact millisecond bounds and force-instrumental preserved',async()=>{
 const bodies=[],native=provider({fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return audio();}});
 for(const duration of [undefined,null,3000,3125,300000,600000])await native.submit(params({music_length_ms:duration,force_instrumental:true}));
 for(const value of bodies.slice(0,2))assert.equal(Object.hasOwn(value,'music_length_ms'),false);
 assert.deepEqual(bodies.slice(2).map(value=>value.music_length_ms),[3000,3125,300000,600000]);assert.ok(bodies.every(value=>value.force_instrumental===true&&!Object.hasOwn(value,'composition_plan')));
});
test('custom lyrics map only to public composition plan with exact lines and explicit section duration',async()=>{
 let body;const native=provider({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return audio();}}),lyrics='第一行歌词\r\n\r\n最后一行歌词';
 await native.submit(params({lyric_mode:true,lyrics,music_length_ms:47000}));
 assert.deepEqual(body,{model_id:'music_v1',respect_sections_durations:true,composition_plan:{positive_global_styles:[request.prompt],negative_global_styles:[],sections:[{section_name:'Song',positive_local_styles:[],negative_local_styles:[],duration_ms:47000,lines:['第一行歌词','','最后一行歌词']}]}});
 for(const name of ['prompt','music_length_ms','force_instrumental','lyrics','lyrics_text','lyric_mode'])assert.equal(Object.hasOwn(body,name),false);
 await native.submit(params({lyric_mode:true,lyrics:'😀'.repeat(200),music_length_ms:120000}));assert.equal(body.composition_plan.sections[0].lines[0],'😀'.repeat(200));
});
test('actual node and Agent Music requests preserve auto/instrumental/custom and text references once',async()=>{
 const core=require('../audio-core.js'),{audioRequestConfig}=await import('../src/features/agent-generation/audio.mjs'),bodies=[],native=provider({fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return audio();}});
 const node=core.transition({prompt:'节点音乐'},'elevenlabs-v3','Music');node.params.music_length_ms=30000;node.params.force_instrumental=true;
 await native.submit({...request,prompt:node.prompt,parameters:{...node.params,model:node.model,scene:node.scene,virtualModel:node.virtualModel}});
 const draft=audioRequestConfig(core,{}, {kind:'audio.generate',model:'elevenlabs',audioScene:'Music',prompt:'Agent音乐',duration:47,lyricsMode:'custom',lyrics:'清晨的阳光\n照亮我的窗'});
 await native.submit({...request,prompt:draft.prompt,parameters:{...draft.params,model:draft.model,scene:draft.scene,virtualModel:draft.virtualModel}});
 assert.equal(bodies[0].music_length_ms,30000);assert.equal(bodies[0].force_instrumental,true);assert.equal(bodies[1].composition_plan.sections[0].duration_ms,47000);
 for(const prompt of ['音乐','场景参考\n音乐'])await native.submit({...request,prompt,inputs:[{type:'text',text:'场景参考'}]});assert.equal(bodies[2].prompt,'场景参考\n音乐');assert.equal(bodies[3].prompt,bodies[2].prompt);
});
test('unsupported, contradictory, unbounded and custom automatic/long sections fail before any network',async()=>{
 let calls=0;const native=provider({fetchImpl:()=>{calls++;throw Error();}});
 for(const change of [{scene:'Sound'},{scene:'Text-to-Speech'},{model:'eleven_v3'},{modelId:'different'},{virtualModel:'other'},{lyric_mode:null},{force_instrumental:null},{lyrics:null},{lyrics:42},{lyric_mode:1},{force_instrumental:'true'},{lyrics:'residual'},{lyric_mode:true,force_instrumental:true,lyrics:'歌词',music_length_ms:30000},{lyric_mode:true,lyrics:'歌词'},{lyric_mode:true,lyrics:'歌词',music_length_ms:120001},{lyric_mode:true,lyrics:' ',music_length_ms:3000},{lyric_mode:true,lyrics:'x'.repeat(201),music_length_ms:3000},{lyric_mode:true,lyrics:Array(31).fill('line').join('\n'),music_length_ms:3000},{music_length_ms:2999},{music_length_ms:600001},{music_length_ms:3000.5},{music_length_ms:'3000'},{music_length_ms:NaN},{music_length_ms:Infinity},{duration:30},{loop:false},{voice_id:'voice'},{seed:2},{composition_plan:{}},{lyrics_text:'lyrics'},{format:'wav'},{response_format:'pcm'},{sample_rate:24000},{times:2},{count:2},{apiKey:key}])await assert.rejects(native.submit(params(change)));
 for(const change of [{prompt:''},{prompt:'x'.repeat(4101)},{kind:'audio.clone'},{count:2},{inputs:[{type:'audio',url:'data:audio/mpeg;base64,AAAA'}]},{inputs:[{type:'text',text:'x'.repeat(4100)}]},{references:[{type:'text',text:'unexpanded'}]},{inputs:Array(31).fill({type:'text',text:'bounded'})}])await assert.rejects(native.submit({...request,...change}));
 assert.equal(calls,0);
});
test('renamed, truncated, empty, oversized and wrong-format output or HTTP failures remain unknown',async()=>{
 const wrongRate=require('node:fs').readFileSync(path.join(__dirname,'fixtures/speech-tone.mp3')),wrongBitrate=Buffer.alloc(208*2);for(const offset of [0,208])wrongBitrate.writeUInt32BE(0xfffb5000,offset);
 const cases=[()=>audio(wrongRate),()=>audio(wrongBitrate),()=>audio(Buffer.from('ID3-not-audio')),()=>audio(mp3.subarray(0,mp3.length-3)),()=>audio(Buffer.alloc(0)),()=>audio(mp3,'application/json'),()=>audio(mp3,'audio/wav'),()=>audio(mp3,'audio/mpeg',{'content-length':String(mp3.length+1)}),()=>audio(mp3,'audio/mpeg',{'content-length':String(MAX_AUDIO_BYTES+1)}),()=>audio(mp3,'audio/mpeg',{'content-encoding':'gzip'}),()=>new Response(key,{status:429}),()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_AUDIO_BYTES+1));c.close();}}),{headers:{'content-type':'audio/mpeg'}})];
 for(const make of cases){let calls=0;await assert.rejects(provider({fetchImpl:async()=>{calls++;return make();}}).submit(request),e=>e.code==='unknown'&&!e.message.includes(key));assert.equal(calls,1);}
});
test('validated MP3 tags cannot echo raw or percent-encoded credentials',async()=>{
 const start=mp3.toString('ascii',0,3)==='ID3'?10+mp3[6]*2097152+mp3[7]*16384+mp3[8]*128+mp3[9]:0;
 for(const credential of [key,[...key].map(v=>'%'+v.charCodeAt(0).toString(16)).join('')]){const tag=Buffer.alloc(10+credential.length);tag.write('ID3');tag[3]=3;tag[8]=credential.length>>7;tag[9]=credential.length&127;tag.write(credential,10);await assert.rejects(provider({fetchImpl:async()=>audio(Buffer.concat([tag,mp3.subarray(start)]))}).submit(request),e=>e.code==='unknown'&&!e.message.includes(key));}
});
test('valid ID3 UTF-16LE/BE TXXX frames cannot publish raw or encoded credentials',async()=>{
 const start=mp3.toString('ascii',0,3)==='ID3'?10+mp3[6]*2097152+mp3[7]*16384+mp3[8]*128+mp3[9]:0;
 for(const endian of ['le','be'])for(const credential of [key,[...key].map(v=>'%'+v.charCodeAt(0).toString(16)).join('')])for(const padding of [0,1]){
  const text=Buffer.from(credential,'utf16le');if(endian==='be')text.swap16();const body=Buffer.concat([Buffer.from([1,...(endian==='le'?[255,254]:[254,255])]),Buffer.alloc(padding),text]),frame=Buffer.alloc(10);frame.write('TXXX');frame.writeUInt32BE(body.length,4);const size=frame.length+body.length,header=Buffer.alloc(10);header.write('ID3');header[3]=3;header[6]=(size>>>21)&127;header[7]=(size>>>14)&127;header[8]=(size>>>7)&127;header[9]=size&127;
  await assert.rejects(provider({fetchImpl:async()=>audio(Buffer.concat([header,frame,body,mp3.subarray(start)]))}).submit(request),e=>e.code==='unknown'&&!e.message.includes(key));
 }
});
test('real HTTP Music redirects cannot forward Key to another destination',async t=>{
 let secondary=0;const target=http.createServer((_req,res)=>{secondary++;res.end(mp3);}),targetUrl=await listen(target),source=http.createServer((_req,res)=>{res.writeHead(307,{Location:targetUrl+'/audio'});res.end(key);}),sourceUrl=await listen(source);t.after(async()=>{await close(source);await close(target);});await assert.rejects(provider({baseUrl:sourceUrl,fetchImpl:fetch}).submit(request),{code:'unknown'});assert.equal(secondary,0);
});
test('abort and timeout stop wait/body including noncooperative transport, without retry',async()=>{
 const before=new AbortController();before.abort(Error('cancel before'));await assert.rejects(provider({fetchImpl:()=>assert.fail()}).submit(request,{signal:before.signal}),/cancel before/);
 let started,cancelled=false;const begin=new Promise(resolve=>{started=resolve;}),abort=new AbortController();const pending=provider({fetchImpl:async()=>new Response(new ReadableStream({start(){started();},cancel(){cancelled=true;}}),{headers:{'content-type':'audio/mpeg'}})}).submit(request,{signal:abort.signal});await begin;await new Promise(resolve=>setImmediate(resolve));abort.abort(Error('cancel during'));await assert.rejects(pending,/cancel during/);assert.equal(cancelled,true);
 let release,calls=0,lateCancelled=false;await assert.rejects(provider({timeoutMs:10,fetchImpl:()=>{calls++;return new Promise(resolve=>{release=resolve;});}}).submit(request),{code:'unknown'});release(new Response(new ReadableStream({cancel(){lateCancelled=true;}}),{headers:{'content-type':'audio/mpeg'}}));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(lateCancelled,true);
 await assert.rejects(provider({timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'audio/mpeg'}})}).submit(request),{code:'unknown'});
});
test('real HTTP lost Music response remains durable unknown after restart and same-idempotency resubmit',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'eleven-music-unknown-'));let calls=0;const upstream=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;res.destroy();}),baseUrl=await listen(upstream);
 let service=createDurableGenerationService({directory,provider:provider({baseUrl,fetchImpl:fetch})});await service.ready;t.after(async()=>{await service.close();await close(upstream);await fs.rm(directory,{recursive:true,force:true});});const first=await service.submit(request,{idempotencyKey:'eleven-music-unknown'}),done=await settled(service,first.id);assert.equal(done.status,'unknown');assert.equal(done.recovery.retryableLookup,false);assert.equal(done.outputs,undefined);await service.close();
 service=createDurableGenerationService({directory,provider:provider({baseUrl,fetchImpl:()=>assert.fail('no Music POST after restart')})});await service.ready;const again=await service.submit(request,{idempotencyKey:'eleven-music-unknown'});assert.equal(again.id,first.id);assert.equal(again.status,'unknown');assert.equal(calls,1);
});
test('real loopback Music POST -> production materializer -> owned HTTP GET/range -> offline restart preserves bytes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eleven-music-http-')),directory=path.join(root,'tasks'),mediaDirectory=path.join(root,'media');let calls=0;
 const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/v1/music?output_format=mp3_44100_128');assert.equal(req.headers['xi-api-key'],key);assert.deepEqual(JSON.parse(Buffer.concat(chunks)),{prompt:request.prompt,model_id:'music_v1',force_instrumental:true,music_length_ms:30000});res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':mp3.length,'song-id':'fixture-song-not-a-pollable-job'});res.write(mp3.subarray(0,123));res.end(mp3.subarray(123));}),baseUrl=await listen(upstream);
 let store=createGenerationMediaStore({directory:mediaDirectory});await store.ready;let service=createDurableGenerationService({directory,provider:provider({baseUrl,fetchImpl:fetch}),mediaMaterializer:createGenerationMediaMaterializer({store})});await service.ready;
 const ownsResource=async(taskId,id)=>{const task=await service.get(taskId);return task?.status==='succeeded'&&task.outputs.some(value=>value.url==='/api/generation/media/'+id);};
 let media=createGenerationMediaHttp({store,ownsResource});const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));},local=http.createServer((req,res)=>media.handle(req,res,req.url.split('/').at(-1),{json})),localUrl=await listen(local);
 t.after(async()=>{await close(local);await media.close();await service.close();await store.close();await close(upstream);await fs.rm(root,{recursive:true,force:true});});
 const first=await service.submit(params({force_instrumental:true,music_length_ms:30000}),{idempotencyKey:'eleven-music-real-http-bytes'}),done=await settled(service,first.id);assert.equal(done.status,'succeeded');const url=done.outputs[0].url;assert.match(url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);assert.equal(done.remoteId,undefined);
 const response=await fetch(localUrl+url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.deepEqual(Buffer.from(await response.arrayBuffer()),mp3);
 const range=await fetch(localUrl+url,{headers:{Range:'bytes=100-199'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),mp3.subarray(100,200));assert.equal(calls,1);
 await media.close();await service.close();await store.close();await close(upstream);store=createGenerationMediaStore({directory:mediaDirectory});await store.ready;service=createDurableGenerationService({directory,provider:provider({baseUrl,apiKey:'rotated-key',fetchImpl:()=>assert.fail('offline archives do not regenerate')}),mediaMaterializer:createGenerationMediaMaterializer({store})});await service.ready;media=createGenerationMediaHttp({store,ownsResource});const restored=await service.lookup('eleven-music-real-http-bytes');assert.equal(restored.status,'succeeded');assert.equal(restored.outputs[0].url,url);const offline=await fetch(localUrl+url);assert.equal(offline.status,200);assert.deepEqual(Buffer.from(await offline.arrayBuffer()),mp3);assert.equal(calls,1);
});
test('production direct+routed gateway HTTP defaults archive MP3; empty maps and TTS/SFX aliases never dispatch',async t=>{
 const {createGenerationGateway}=require('../server/generation.cjs'),root=await fs.mkdtemp(path.join(os.tmpdir(),'eleven-music-gateway-'));let calls=0;
 const upstream=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;assert.equal(req.url,'/v1/music?output_format=mp3_44100_128');assert.equal(req.headers['xi-api-key'],key);res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':mp3.length});res.end(mp3);}),baseUrl=await listen(upstream),gateways=[],servers=[];
 t.after(async()=>{for(const server of servers)await close(server);for(const gateway of gateways)await gateway.close();await close(upstream);await fs.rm(root,{recursive:true,force:true});});
 for(const [name,configuration]of Object.entries({direct:{protocol:'elevenlabs-music-native',apiKey:key,baseUrl},routed:{providers:{music:{protocol:'elevenlabs-music-native',apiKey:key,baseUrl}},routes:{'audio.generate':{models:{music_v1:'music'}}}},emptyDirect:{protocol:'elevenlabs-music-native',apiKey:key,baseUrl,modelMap:{}},emptyRouted:{providers:{music:{protocol:'elevenlabs-music-native',apiKey:key,baseUrl,modelMap:{}}},routes:{'audio.generate':{models:{music_v1:'music'}}}}})){
  const gateway=createGenerationGateway({...configuration,directory:path.join(root,name,'tasks'),mediaDirectory:path.join(root,name,'media')});gateways.push(gateway);await gateway.ready;
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));},body=async req=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));},server=http.createServer((req,res)=>gateway.handle(req,res,new URL(req.url,'http://fixture').pathname,{json,body}));servers.push(server);const url=await listen(server),config=await fetch(url+'/api/generation/config').then(res=>res.json());assert.equal(config.configured,!name.startsWith('empty'));
  for(const alias of ['music_v1','eleven_v3','eleven_sound_effect']){const before=calls,response=await fetch(url+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':name+'-'+alias},body:JSON.stringify(params({model:alias}))}),created=await response.json();assert.equal(response.status,202);let task;for(let i=0;i<100;i++){task=await fetch(url+'/api/generation/tasks/'+created.id).then(res=>res.json());if(!['queued','running'].includes(task.status))break;await new Promise(resolve=>setTimeout(resolve,5));}
   if(alias==='music_v1'&&!name.startsWith('empty')){assert.equal(task.status,'succeeded');const media=await fetch(url+task.outputs[0].url);assert.equal(media.status,200);assert.deepEqual(Buffer.from(await media.arrayBuffer()),mp3);assert.equal(calls,before+1);}else{assert.equal(task.status,'configuration_required');assert.equal(calls,before);}
  }
 }
 assert.equal(calls,2);
});
