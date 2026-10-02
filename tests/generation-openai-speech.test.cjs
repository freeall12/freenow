const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),OpenAI=require('openai');
const audio=require('../audio-core.js');
const {validateSpeechProfile,speechCapabilities,prepareSpeechRequest,submitSpeech,MAX_AUDIO_BYTES}=require('../server/generation-openai-speech.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const profile={kind:'audio.generate',scene:'Text-to-Speech',model:'gpt-4o-mini-tts',defaultVoice:'coral',voiceMap:{narrator:'coral',neutral:'alloy'},formatMap:{wav:'wav',mp3:'mp3'},defaultFormat:'wav',speedMap:{'-50':.5,0:1,25:1.25,100:2},defaultSpeed:1,wavSampleRate:24000,maxCount:1};
const seed=audio.transition({prompt:'你好'},'seed-audio-1-0','Text-to-Speech');
const request={kind:'audio.generate',prompt:audio.validate(seed),inputs:[],parameters:{...seed.params,model:seed.model,scene:seed.scene,virtualModel:seed.virtualModel}};
function wave({sampleRate=24000,samples=480,streaming=false}={}){const bytes=Buffer.alloc(44+samples*2);bytes.write('RIFF');bytes.writeUInt32LE(streaming?0xffffffff:bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(streaming?0xffffffff:samples*2,40);for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/sampleRate)*2000),44+i*2);return bytes;}
const wav=wave(),mp3=fs.readFileSync(path.join(__dirname,'fixtures/speech-tone.mp3'));
const output=(bytes=wav,type='audio/wav',headers={})=>new Response(bytes,{status:200,headers:{'content-type':type,...headers}});
const sdkFor=callback=>({audio:{speech:{create:callback}}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(service,id){for(let i=0;i<30;i++){const job=await service.get(id);if(!['queued','running'].includes(job.status))return job;await tick();}assert.fail('speech task did not settle');}
function memoryStore(){const records=new Map();return {readAll:async()=>[...records.values()],write:async value=>records.set(value.id,structuredClone(value))};}

test('real Seed UI and Agent neutral TTS contracts map only model, builtin voice, format and speed',async()=>{
 const {audioRequestConfig}=await import('../src/features/agent-generation/audio.mjs');
 const target=audioRequestConfig(audio,{}, {kind:'audio.generate',nodeId:'audio',model:'doubao-seed-audio',audioScene:'Text-to-Speech',prompt:'你好',speechRate:25});
 const prepared=prepareSpeechRequest({...request,parameters:{...target.params,model:target.model,scene:target.scene,virtualModel:target.virtualModel}},profile);
 assert.deepEqual(prepared,{kind:'audio.generate',body:{model:profile.model,input:'你好',voice:'coral',response_format:'wav',speed:1.25,stream_format:'audio'},expectedSampleRate:24000});
 assert.equal(Object.hasOwn(prepared.body,'sample_rate'),false);assert.equal(Object.hasOwn(prepared.body,'pitch_rate'),false);assert.equal(Object.hasOwn(prepared.body,'enable_subtitle'),false);
 const prefix={...request,prompt:'参考文字\n你好',inputs:[{type:'text',text:'参考文字'}]};assert.equal(prepareSpeechRequest(prefix,profile).body.input,prefix.prompt);assert.equal(prepareSpeechRequest({...prefix,prompt:'你好'},profile).body.input,prefix.prompt);
});

test('profile configuration is explicit and cannot claim custom voices, different formats or rate semantics',()=>{
 for(const changes of [{defaultVoice:undefined,voiceMap:{}},{defaultVoice:{id:'voice-clone'}},{defaultVoice:'unknown'},{model:'tts-1',defaultVoice:'cedar'},{voiceMap:{cloned:{id:'voice_123'}}},{scene:'Music'},{maxCount:2},{formatMap:{wav:'mp3'}},{formatMap:{ogg_opus:'mp3'},defaultFormat:'ogg_opus'},{defaultFormat:'pcm'},{speedMap:{25:1.5}},{speedMap:{0:5}},{defaultSpeed:0},{wavSampleRate:'24000'},{supportsImageReferences:true}])assert.throws(()=>validateSpeechProfile({...profile,...changes}),{code:'configuration_invalid'});
 const caps=speechCapabilities(profile);assert.deepEqual(caps.voiceAliases,['narrator','neutral']);assert.equal(caps.customVoices,false);assert.equal(caps.mediaReferences,false);assert.equal(caps.defaultVoiceConfigured,true);assert.ok(!JSON.stringify(caps).includes(profile.model));
 for(const defaultVoice of ['ash','coral','sage'])assert.doesNotThrow(()=>validateSpeechProfile({...profile,model:'tts-1',defaultVoice,voiceMap:{}}));
});

test('unsupported fields, scenes, media, cloning and contradictory parameters reject before SDK calls',()=>{
 for(const parameters of [{...request.parameters,scene:'Music'},{...request.parameters,scene:'Sound'},{...request.parameters,stability:.5},{...request.parameters,pitch_rate:1},{...request.parameters,loudness_rate:-1},{...request.parameters,enable_subtitle:true},{...request.parameters,lyrics:'sing'},{...request.parameters,duration:30},{...request.parameters,voice_id:{id:'voice_123'}},{...request.parameters,voice_id:'unmapped-clone'},{...request.parameters,voice_id:'narrator',voice:'neutral'},{...request.parameters,modelId:'other'},{...request.parameters,format:'pcm'},{...request.parameters,format:'mp3'},{...request.parameters,format:'wav',response_format:'mp3'},{...request.parameters,speech_rate:50},{...request.parameters,speech_rate:25,speed:1},{...request.parameters,speed:4.1},{...request.parameters,sample_rate:48000},{...request.parameters,count:2}])assert.throws(()=>prepareSpeechRequest({...request,parameters},profile));
 const eleven=audio.transition({prompt:'你好'},'elevenlabs-v3','Text-to-Speech');assert.throws(()=>prepareSpeechRequest({...request,parameters:{...eleven.params,model:eleven.model,scene:eleven.scene}},profile),/不支持的参数/);
 for(const type of ['image','audio','video'])assert.throws(()=>prepareSpeechRequest({...request,inputs:[{type,url:'https://public.test/media'}]},profile),/克隆声线/);
 for(const prompt of ['', ' '.repeat(5),'x'.repeat(4097)])assert.throws(()=>prepareSpeechRequest({...request,prompt},profile));
 assert.throws(()=>prepareSpeechRequest({...request,kind:'audio.speech'},profile));
 assert.doesNotThrow(()=>prepareSpeechRequest({...request,prompt:'x'.repeat(4096)},profile));
});

test('installed SDK sends one binary Speech request with zero retries and preserves real WAV bytes',async()=>{
 let calls=0;
 const sdk=new OpenAI({apiKey:'test-key-only',baseURL:'https://isolated-provider.test/v1',maxRetries:0,fetch:async(url,options)=>{
  calls++;assert.equal(String(url),'https://isolated-provider.test/v1/audio/speech');const headers=new Headers(options.headers);assert.equal(headers.get('authorization'),'Bearer test-key-only');assert.equal(headers.get('accept'),'application/octet-stream');assert.deepEqual(JSON.parse(options.body),prepareSpeechRequest(request,profile).body);assert.ok(options.signal instanceof AbortSignal);return output();
 }});
 const result=await submitSpeech(prepareSpeechRequest(request,profile),{sdk});assert.equal(calls,1);assert.equal(result.status,'succeeded');assert.deepEqual(result.outputs,[{type:'audio',url:'data:audio/wav;base64,'+wav.toString('base64'),duration:.02}]);
 const streamed=await submitSpeech(prepareSpeechRequest(request,profile),{sdk:sdkFor(async()=>output(wave({streaming:true})))});assert.equal(streamed.outputs[0].duration,.02);
});

test('MP3 retains real encoded bytes and does not invent duration or sampling metadata',async()=>{
 const mp3Request={...request,parameters:{model:seed.model,scene:'Text-to-Speech',voice_id:'neutral',format:'mp3',speed:.75}};
 const prepared=prepareSpeechRequest(mp3Request,profile);assert.equal(prepared.body.voice,'alloy');assert.equal(prepared.body.speed,.75);assert.equal(prepared.expectedSampleRate,undefined);
 const result=await submitSpeech(prepared,{sdk:sdkFor(async()=>output(mp3,'audio/mpeg'))});assert.deepEqual(result.outputs,[{type:'audio',url:'data:audio/mpeg;base64,'+mp3.toString('base64')}]);
 for(const bytes of [Buffer.from('not audio'),mp3.subarray(0,mp3.length-5),Buffer.from([255,251,144,0])])await assert.rejects(submitSpeech(prepared,{sdk:sdkFor(async()=>output(bytes,'audio/mpeg'))}),{code:'unknown'});
});

test('empty, oversized, truncated, wrong-format and wrong-sampling outputs stay unknown',async()=>{
 const prepared=prepareSpeechRequest(request,profile),badWave=Buffer.from(wav);badWave.writeUInt16LE(0,32);
 for(const make of [()=>output(Buffer.alloc(0)),()=>output(Buffer.from('json error')),()=>output(mp3),()=>output(wav,'application/json'),()=>output(wave({sampleRate:48000})),()=>output(wav.subarray(0,wav.length-2)),()=>output(badWave),()=>output(wav,'audio/wav',{'content-length':String(wav.length+1)}),()=>output(wav,'audio/wav',{'content-length':String(MAX_AUDIO_BYTES+1)}),()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES+1));controller.close();}}),{headers:{'content-type':'audio/wav'}})])await assert.rejects(submitSpeech(prepared,{sdk:sdkFor(async()=>make())}),{code:'unknown'});
});

test('uncertain 429 never retries and abort/timeout interrupt binary consumption without late success',async()=>{
 let attempts=0;const prepared=prepareSpeechRequest(request,profile);
 const sdk=new OpenAI({apiKey:'test-key-only',baseURL:'https://isolated-provider.test/v1',fetch:async()=>{attempts++;return new Response(JSON.stringify({error:{message:'private failure'}}),{status:429,headers:{'content-type':'application/json'}});}});
 await assert.rejects(submitSpeech(prepared,{sdk}),{code:'unknown'});assert.equal(attempts,1);
 const before=new AbortController();before.abort(Error('cancel before speech'));await assert.rejects(submitSpeech(prepared,{sdk:sdkFor(()=>assert.fail()),signal:before.signal}),/cancel before/);
 let started,controller,cancelled=false;const began=new Promise(resolve=>started=resolve),abort=new AbortController();
 const binary=new Response(new ReadableStream({start(value){controller=value;started();},cancel(){cancelled=true;}}),{headers:{'content-type':'audio/wav'}});
 const pending=submitSpeech(prepared,{sdk:sdkFor(async()=>binary),signal:abort.signal});await began;await tick();abort.abort(Error('cancel binary'));await assert.rejects(pending,/cancel binary/);assert.equal(cancelled,true);assert.throws(()=>controller.enqueue(wav));
 let release;const timeout=submitSpeech(prepared,{sdk:sdkFor(()=>new Promise(resolve=>release=resolve)),timeoutMs:10});await assert.rejects(timeout,{code:'unknown'});release(output());
});

test('durable Speech receipts preserve success/unknown idempotency and cancelled late outputs',async()=>{
 for(const uncertain of [false,true]){
  let attempts=0;const store=memoryStore(),sdk=sdkFor(async()=>{attempts++;if(uncertain)throw Error('lost');return output();}),provider={configured:true,fingerprint:'speech-profile-only',prepare:value=>{prepareSpeechRequest(value,profile);return value;},submit:(value,{signal})=>submitSpeech(prepareSpeechRequest(value,profile),{sdk,signal})};
  let service=createDurableGenerationService({store,provider});const first=await service.submit(request,{idempotencyKey:'speech-idempotency'}),job=await settled(service,first.id);assert.equal(job.status,uncertain?'unknown':'succeeded');await service.close();service=createDurableGenerationService({store,provider});assert.equal((await service.lookup('speech-idempotency')).status,job.status);assert.equal((await service.submit(request,{idempotencyKey:'speech-idempotency'})).id,first.id);assert.equal(attempts,1);await service.close();
 }
 let release,started;const began=new Promise(resolve=>started=resolve),sdk=sdkFor(()=>{started();return new Promise(resolve=>release=resolve);}),provider={configured:true,fingerprint:'speech-cancel',prepare:value=>{prepareSpeechRequest(value,profile);return value;},submit:(value,{signal})=>submitSpeech(prepareSpeechRequest(value,profile),{sdk,signal})};
 const service=createDurableGenerationService({store:memoryStore(),provider}),first=await service.submit(request,{idempotencyKey:'speech-cancel'});await began;assert.equal((await service.cancel(first.id)).cancellation.providerCancellation,'unconfirmed');release(output());await tick();await tick();const last=await service.get(first.id);assert.equal(last.status,'cancelled');assert.equal(last.outputs,undefined);await service.close();
});
