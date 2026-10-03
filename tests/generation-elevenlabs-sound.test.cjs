'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createElevenLabsSoundProvider,parseElevenLabsSoundModelMap,MAX_AUDIO_BYTES}=require('../server/generation-elevenlabs-sound.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const key='synthetic-elevenlabs-sound-private-key',request={kind:'audio.generate',prompt:'海浪拍打礁石。',inputs:[],parameters:{model:'eleven_sound_effect',scene:'Sound',virtualModel:'elevenlabs-v3',loop:false,prompt_influence:.3}};
const mp3=require('node:fs').readFileSync(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3'));
const audio=(bytes=mp3,mime='audio/mpeg',headers={})=>new Response(bytes,{headers:{'content-type':mime,...headers}});
const provider=options=>createElevenLabsSoundProvider({apiKey:key,fetchImpl:async()=>audio(),...options});
const params=changes=>({...request,parameters:{...request.parameters,...changes}});
test('Sound v2 exact native POST returns complete real MP3 with no remote task identity',async()=>{
 let calls=0;const native=provider({fetchImpl:async(url,options)=>{calls++;assert.equal(String(url),'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');assert.equal(options.method,'POST');assert.equal(options.headers['xi-api-key'],key);assert.equal(options.headers.Accept,'audio/mpeg');assert.equal(options.headers['Accept-Encoding'],'identity');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{text:request.prompt,model_id:'eleven_text_to_sound_v2',loop:false,prompt_influence:.3});return audio();}});
 const result=await native.submit(request);assert.deepEqual(result,{status:'succeeded',outputs:[{type:'audio',url:'data:audio/mpeg;base64,'+mp3.toString('base64')}]});assert.equal(calls,1);assert.equal(native.metadata.protocol,'elevenlabs-sound-native');assert.equal(native.metadata.capabilities.remoteRecovery,false);assert.equal(native.metadata.capabilities.remoteCancellation,false);assert.equal(native.poll,undefined);assert.equal(native.cancel,undefined);assert.equal(native.isPollable(),false);assert.equal(JSON.stringify(native.metadata).includes(key),false);assert.equal(provider({apiKey:'rotated-key'}).fingerprint,native.fingerprint);
});
test('default map, empty map, invalid config and TTS/music model isolation are explicit',()=>{
 assert.equal(parseElevenLabsSoundModelMap().eleven_sound_effect.model,'eleven_text_to_sound_v2');
 for(const options of [{apiKey:''},{apiKey:'bad\nkey'},{modelMap:{}},{modelMap:'bad-json'},{baseUrl:'https://tapnow.media'},{baseUrl:'https://example.test/v1'},{modelMap:{eleven_sound_effect:{kind:'audio.generate',model:'eleven_v3'}}},{modelMap:{eleven_sound_effect:{kind:'audio.generate',model:'eleven_text_to_sound_v2',outputFormat:'wav_24000'}}},{modelMap:{eleven_sound_effect:{kind:'audio.generate',model:'eleven_text_to_sound_v2',voice:'other'}}}]){const native=provider(options);assert.equal(native.configured,false);assert.throws(()=>native.prepare(request),{code:'configuration_required'});}
});
test('automatic duration is omitted, exact decimal duration/loop/influence are preserved',async()=>{
 const bodies=[],native=provider({fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return audio();}});
 for(const duration of [undefined,null,.5,1.25,30])await native.submit(params({duration_seconds:duration,loop:true,prompt_influence:.37}));
 for(const value of bodies.slice(0,2))assert.equal(Object.hasOwn(value,'duration_seconds'),false);
 assert.deepEqual(bodies.slice(2).map(value=>value.duration_seconds),[.5,1.25,30]);assert.ok(bodies.every(value=>value.loop===true&&value.prompt_influence===.37));
 const defaults={...request,parameters:{model:'eleven_sound_effect',scene:'Sound'}};await native.submit(defaults);assert.equal(bodies.at(-1).loop,false);assert.equal(bodies.at(-1).prompt_influence,.3);
});
test('actual Node and Agent Sound request contracts retain defaults and text references once',async()=>{
 const core=require('../audio-core.js'),{audioRequestConfig}=await import('../src/features/agent-generation/audio.mjs'),bodies=[],native=provider({fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return audio();}});
 const node=core.transition({prompt:'节点音效'},'elevenlabs-v3','Sound');node.params.duration_seconds=.5;
 await native.submit({...request,prompt:node.prompt,parameters:{...node.params,model:node.model,scene:node.scene,virtualModel:node.virtualModel}});
 const draft=audioRequestConfig(core,{}, {kind:'audio.generate',model:'elevenlabs',audioScene:'Sound',prompt:'Agent音效',duration:5,loop:true,promptInfluence:.37});
 await native.submit({...request,prompt:draft.prompt,parameters:{...draft.params,model:draft.model,scene:draft.scene,virtualModel:draft.virtualModel}});
 assert.equal(bodies[0].duration_seconds,.5);assert.equal(bodies[1].duration_seconds,5);assert.equal(bodies[1].loop,true);assert.equal(bodies[1].prompt_influence,.37);
 for(const prompt of ['音效','场景参考\n音效'])await native.submit({...request,prompt,inputs:[{type:'text',text:'场景参考'}]});assert.equal(bodies[2].text,'场景参考\n音效');assert.equal(bodies[3].text,bodies[2].text);
});
test('unsupported or contradictory requests fail before any network call',async()=>{
 let calls=0;const native=provider({fetchImpl:()=>{calls++;throw Error();}});
 for(const change of [{scene:'Music'},{scene:'Text-to-Speech'},{model:'eleven_v3'},{modelId:'different'},{virtualModel:'other'},{loop:1},{loop:null},{loop:'true'},{prompt_influence:null},{prompt_influence:NaN},{prompt_influence:Infinity},{prompt_influence:-.1},{prompt_influence:1.01},{prompt_influence:'0.3'},{duration_seconds:0},{duration_seconds:.49},{duration_seconds:30.01},{duration_seconds:'5'},{duration_seconds:NaN},{duration_seconds:Infinity},{voice_id:'voice'},{stability:.5},{music_length_ms:1000},{duration:5},{format:'wav'},{response_format:'pcm'},{sample_rate:24000},{times:2},{count:2},{apiKey:key}])await assert.rejects(native.submit(params(change)));
 for(const change of [{prompt:''},{prompt:'x'.repeat(1001)},{kind:'audio.clone'},{count:2},{inputs:[{type:'audio',url:'data:audio/mpeg;base64,AAAA'}]},{inputs:[{type:'text',text:'x'.repeat(1000)}]},{references:[{type:'text',text:'unexpanded'}]}])await assert.rejects(native.submit({...request,...change}));
 assert.equal(calls,0);
});
test('wrong sampling/bitrate, renamed/truncated/oversized binary and upstream HTTP failures remain unknown',async()=>{
 const wrongRate=require('node:fs').readFileSync(path.join(__dirname,'fixtures/speech-tone.mp3')),wrongBitrate=Buffer.alloc(208*2);for(const offset of [0,208])wrongBitrate.writeUInt32BE(0xfffb5000,offset);
 const cases=[()=>audio(wrongRate),()=>audio(wrongBitrate),()=>audio(Buffer.from('ID3-not-audio')),()=>audio(mp3.subarray(0,mp3.length-3)),()=>audio(Buffer.alloc(0)),()=>audio(mp3,'application/json'),()=>audio(mp3,'audio/wav'),()=>audio(mp3,'audio/mpeg',{'content-length':String(mp3.length+1)}),()=>audio(mp3,'audio/mpeg',{'content-length':String(MAX_AUDIO_BYTES+1)}),()=>audio(mp3,'audio/mpeg',{'content-encoding':'gzip'}),()=>new Response(key,{status:429}),()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_AUDIO_BYTES+1));c.close();}}),{headers:{'content-type':'audio/mpeg'}})];
 for(const make of cases){let calls=0;const native=provider({fetchImpl:async()=>{calls++;return make();}});await assert.rejects(native.submit(request),e=>e.code==='unknown'&&!e.message.includes(key));assert.equal(calls,1);}
});
test('valid audio metadata cannot echo raw or percent-encoded credentials',async()=>{
 const start=mp3.toString('ascii',0,3)==='ID3'?10+mp3[6]*2097152+mp3[7]*16384+mp3[8]*128+mp3[9]:0;
 for(const credential of [key,[...key].map(v=>'%'+v.charCodeAt(0).toString(16)).join('')]){const tag=Buffer.alloc(10+credential.length);tag.write('ID3');tag[3]=3;tag[8]=credential.length>>7;tag[9]=credential.length&127;tag.write(credential,10);const bytes=Buffer.concat([tag,mp3.subarray(start)]);await assert.rejects(provider({fetchImpl:async()=>audio(bytes)}).submit(request),e=>e.code==='unknown'&&!e.message.includes(key));}
});
test('real HTTP redirects cannot forward credentials to another destination',async t=>{
 let secondary=0;const target=http.createServer((_req,res)=>{secondary++;res.end(mp3);});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));const source=http.createServer((_req,res)=>{res.writeHead(307,{Location:`http://127.0.0.1:${target.address().port}/audio`});res.end(key);});await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));t.after(()=>{source.closeAllConnections();target.closeAllConnections();source.close();target.close();});await assert.rejects(provider({baseUrl:`http://127.0.0.1:${source.address().port}`,fetchImpl:fetch}).submit(request),{code:'unknown'});assert.equal(secondary,0);
});
test('abort/timeout enforce no retry even if fetch or body ignores abort',async()=>{
 const before=new AbortController();before.abort(Error('cancel before'));await assert.rejects(provider({fetchImpl:()=>assert.fail()}).submit(request,{signal:before.signal}),/cancel before/);
 let started,cancelled=false;const begin=new Promise(resolve=>{started=resolve;}),abort=new AbortController();const pending=provider({fetchImpl:async()=>new Response(new ReadableStream({start(){started();},cancel(){cancelled=true;}}),{headers:{'content-type':'audio/mpeg'}})}).submit(request,{signal:abort.signal});await begin;await new Promise(resolve=>setImmediate(resolve));abort.abort(Error('cancel during'));await assert.rejects(pending,/cancel during/);assert.equal(cancelled,true);
 let release,calls=0,lateCancelled=false;await assert.rejects(provider({timeoutMs:10,fetchImpl:()=>{calls++;return new Promise(resolve=>{release=resolve;});}}).submit(request),{code:'unknown'});release(new Response(new ReadableStream({cancel(){lateCancelled=true;}}),{headers:{'content-type':'audio/mpeg'}}));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(lateCancelled,true);
 await assert.rejects(provider({timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'audio/mpeg'}})}).submit(request),{code:'unknown'});
});
test('durable original unknown receipt is restored without any new POST',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'eleven-sound-durable-'));let calls=0,service=createDurableGenerationService({directory,provider:provider({fetchImpl:async()=>{calls++;throw Error('lost after dispatch');}})});await service.ready;t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true});});const first=await service.submit(request,{idempotencyKey:'eleven-sound-unknown'});
 let settled;for(let i=0;i<100;i++){settled=await service.get(first.id);if(settled.status==='unknown')break;await new Promise(resolve=>setTimeout(resolve,5));}assert.equal(settled.status,'unknown');assert.equal(settled.recovery.retryableLookup,false);assert.equal(settled.outputs,undefined);await service.close();
 service=createDurableGenerationService({directory,provider:provider({fetchImpl:()=>assert.fail('no Sound POST after restart')})});await service.ready;const again=await service.submit(request,{idempotencyKey:'eleven-sound-unknown'});assert.equal(again.id,first.id);assert.equal(again.status,'unknown');assert.equal(calls,1);
});
test('actual Sound bytes archive through production materializer and survive offline restart',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eleven-sound-media-')),directory=path.join(root,'tasks'),mediaDirectory=path.join(root,'media');let calls=0,store=createGenerationMediaStore({directory:mediaDirectory});await store.ready;
 let service=createDurableGenerationService({directory,provider:provider({fetchImpl:async()=>{calls++;return audio();}}),mediaMaterializer:createGenerationMediaMaterializer({store})});await service.ready;
 t.after(async()=>{await service.close();await store.close();await fs.rm(root,{recursive:true,force:true});});
 const first=await service.submit(request,{idempotencyKey:'eleven-sound-real-bytes'});let done;
 for(let i=0;i<100;i++){done=await service.get(first.id);if(done.status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(done.status,'succeeded');assert.match(done.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);const id=done.outputs[0].url.split('/').at(-1);assert.deepEqual(await fs.readFile(path.join(mediaDirectory,id+'.bin')),mp3);assert.equal(calls,1);const url=done.outputs[0].url;
 await service.close();await store.close();store=createGenerationMediaStore({directory:mediaDirectory});await store.ready;
 service=createDurableGenerationService({directory,provider:provider({apiKey:'rotated-key',fetchImpl:()=>assert.fail('archived audio must not regenerate')}),mediaMaterializer:createGenerationMediaMaterializer({store})});await service.ready;const restored=await service.lookup('eleven-sound-real-bytes');assert.equal(restored.status,'succeeded');assert.equal(restored.outputs[0].url,url);assert.deepEqual(await fs.readFile(path.join(mediaDirectory,id+'.bin')),mp3);assert.equal(calls,1);
});
