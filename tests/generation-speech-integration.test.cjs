const test=require('node:test'),assert=require('node:assert/strict');
const AudioCore=require('../audio-core.js');
const {createOpenAINativeProvider}=require('../server/generation-openai.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const profile={kind:'audio.generate',scene:'Text-to-Speech',model:'configured-speech-model',defaultVoice:'alloy',formatMap:{wav:'wav',mp3:'mp3'},defaultFormat:'wav',speedMap:{'0':1},wavSampleRate:24000,maxCount:1};
const modelMap={'doubao-seed-audio-1-0':profile,text:{kind:'text.generate',model:'configured-text-model'},'gpt-image-2':{kind:'image.generate',model:'configured-image-model',sizeMap:{'auto|':'auto'},qualityMap:{low:'low'}}};
function request(){const config=AudioCore.transition({prompt:'这是实际音频接口契约测试'},'seed-audio-1-0','Text-to-Speech');return JSON.parse(JSON.stringify({kind:'audio.generate',prompt:AudioCore.validate(config),inputs:[],parameters:{...config.params,model:config.model,scene:config.scene,virtualModel:config.virtualModel}}));}
function wave(){const b=Buffer.alloc(4844);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4800,40);for(let i=0;i<2400;i++)b.writeInt16LE(Math.round(3000*Math.sin(i*2*Math.PI*440/24000)),44+i*2);return b;}
const response=()=>new Response(wave(),{headers:{'content-type':'audio/wav'}});
function provider(fetchImpl){return createOpenAINativeProvider({apiKey:'test-only',baseUrl:'https://isolated-provider.test/v1',modelMap,fetchImpl});}
function memoryStore(){const records=new Map();return {readAll:async()=>[...records.values()],write:async value=>records.set(value.id,structuredClone(value))};}
async function settle(service,id){for(let i=0;i<60;i++){const job=await service.get(id);if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setImmediate(r));}assert.fail('task did not settle');}
test('real Seed defaults pass installed SDK speech route and return validated binary audio',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return response();});
 const output=await p.submit(request());assert.equal(output.status,'succeeded');assert.equal(output.outputs[0].type,'audio');assert.equal(output.outputs[0].duration,.1);assert.deepEqual(Buffer.from(output.outputs[0].url.split(',')[1],'base64'),wave());
 assert.deepEqual(calls,[{url:'https://isolated-provider.test/v1/audio/speech',body:{model:profile.model,input:request().prompt,voice:'alloy',response_format:'wav',speed:1,stream_format:'audio'}}]);
 assert.deepEqual(p.metadata.capabilities.kinds,['audio.generate','text.generate','image.generate']);assert.equal(p.metadata.capabilities.speech['doubao-seed-audio-1-0'].scene,'Text-to-Speech');assert.ok(!JSON.stringify(p.metadata).includes(profile.model));
});
test('unsupported speech options reject before dispatch and mixed invalid profiles report configuration errors',async()=>{
 const p=provider(()=>assert.fail('must not dispatch'));
 for(const patch of [{scene:'Music'},{stability:.5},{pitch_rate:1},{sample_rate:48000},{format:'mp3'},{speech_rate:50},{voice_id:'unmapped'},{count:2},{providerParameters:{}}])assert.throws(()=>p.prepare({...request(),parameters:{...request().parameters,...patch}}));
 assert.throws(()=>p.prepare({...request(),inputs:[{type:'audio',url:'data:audio/wav;base64,AAAA'}]}));
 const broken=createOpenAINativeProvider({apiKey:'test',modelMap:{...modelMap,'doubao-seed-audio-1-0':{...profile,stability:.5}}});assert.equal(broken.configured,false);assert.equal(broken.metadata.configurationError,'configuration_invalid');
});
test('speech success and uncertain errors persist without a second SDK submit across restart',async()=>{
 for(const success of [true,false]){let calls=0;const p=provider(async()=>{calls++;return success?response():new Response('limited',{status:429});}),store=memoryStore();let service=createDurableGenerationService({provider:p,store});const first=await service.submit(request(),{idempotencyKey:'speech-'+success}),terminal=await settle(service,first.id);assert.equal(terminal.status,success?'succeeded':'unknown');await service.close();service=createDurableGenerationService({provider:p,store});const next=await service.submit(request(),{idempotencyKey:'speech-'+success});assert.equal(next.id,first.id);assert.equal(next.status,terminal.status);assert.equal(calls,1);await service.close();}
});
test('real image preparation with auto dimensions accepts only the inactive legacy empty quality',async()=>{
 const {prepareGenerationRequest}=await import('../src/features/node-composer/generation-request.mjs');
 const prepared=JSON.parse(JSON.stringify(prepareGenerationRequest({kind:'image.generate',prompt:'树',inputs:[],parameters:{model:'gpt-image-2',ratio:'auto',quality:'',outputQuality:'low'}})));
 const p=provider(()=>assert.fail());assert.doesNotThrow(()=>p.prepare(prepared));assert.throws(()=>p.prepare({...prepared,parameters:{...prepared.parameters,quality:'high'}}));
});
