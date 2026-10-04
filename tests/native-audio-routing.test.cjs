'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const music={kind:'audio.generate',prompt:'一首关于骑行的原创歌曲',inputs:[],parameters:{model:'mureka-8',virtualModel:'mureka-v8',scene:'Music',lyric_mode:false,lyrics:''}};
const speech={kind:'audio.generate',prompt:'温柔地说：你好。',inputs:[],parameters:{model:'doubao-seed-audio-1-0',virtualModel:'seed-audio-1-0',scene:'Text-to-Speech',format:'ogg_opus',sample_rate:48000,speech_rate:0,pitch_rate:0,loudness_rate:0,enable_subtitle:false}};
const providers={music:{protocol:'mureka-native',apiKey:'synthetic-music-key'},speech:{protocol:'seed-audio-native',apiKey:'synthetic-speech-key'}};
const routes={'audio.generate':{models:{'mureka-8':'music','mureka-o2':'music','doubao-seed-audio-1-0':'speech'}}};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('audio routing keeps exact default maps and dispatches each native wire contract',async()=>{
 const calls=[],ogg=fs.readFileSync(path.join(__dirname,'fixtures/seed-tone-48000.ogg'));
 const router=createGenerationRouter({providers,routes,fetchImpl:async(url,options)=>{
  calls.push({url:String(url),options});
  return json(String(url).endsWith('/tts/create')?{audio:ogg.toString('base64')}:{id:'accepted-music',model:'mureka-8',status:'queued'});
 }});
 const {providerConfigurationStatus}=await import('../src/features/node-composer/provider-configuration.mjs');
 for(const request of [music,speech])assert.equal(providerConfigurationStatus(router.metadata,request).configured,true);
 assert.deepEqual(Object.keys(router.metadata.providers.music.capabilities.models),['mureka-8','mureka-o2']);
 assert.equal(router.isPollable(music),true);assert.equal(router.isPollable(speech),false);
 const accepted=await router.submit(music),output=await router.submit(speech);
 assert.match(accepted.id,/^rg1\./);assert.equal(output.status,'succeeded');assert.match(output.outputs[0].url,/^data:audio\/ogg;base64,/);
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,'https://api.mureka.ai/v1/song/easy-generate');
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+providers.music.apiKey);
 assert.equal(JSON.parse(calls[0].options.body).model,'mureka-8');
 assert.equal(calls[1].url,'https://openspeech.bytedance.com/api/v3/tts/create');
 assert.equal(calls[1].options.headers['X-Api-Key'],providers.speech.apiKey);
 assert.equal(JSON.parse(calls[1].options.body).audio_config.sample_rate,48000);
 for(const secret of Object.values(providers).map(p=>p.apiKey))assert.equal(JSON.stringify(router.metadata).includes(secret),false);
});

test('missing key, explicit empty map, and absent alias cannot fall through to another audio route',async()=>{
 const {providerConfigurationStatus}=await import('../src/features/node-composer/provider-configuration.mjs');
 for(const change of [{apiKey:''},{modelMap:{}}]){
  const router=createGenerationRouter({providers:{...providers,music:{...providers.music,...change}},routes,fetchImpl:()=>assert.fail('preflight must not dispatch')});
  assert.equal(router.configured,true);
  assert.equal(providerConfigurationStatus(router.metadata,music).configured,false);
  assert.equal(providerConfigurationStatus(router.metadata,speech).configured,true);
  assert.throws(()=>router.prepare(music),{code:'configuration_required'});
 }
 const router=createGenerationRouter({providers,routes,fetchImpl:()=>assert.fail('missing alias must not dispatch')});
 assert.throws(()=>router.prepare({...music,parameters:{...music.parameters,model:'mureka-other'}}),{code:'configuration_required'});
});

test('direct and routed gateway configuration expose new protocols without network access',async()=>{
 for(const config of [providers.music,providers.speech,{providers,routes}]){
  const gateway=createGenerationGateway({...config,fetchImpl:()=>assert.fail('reading configuration must be local')});
  try{
   let status,metadata;
   await gateway.handle({method:'GET'},{},'/api/generation/config',{json:(_res,code,value)=>{status=code;metadata=value;}});
   assert.equal(status,200);assert.equal(metadata.configured,true);assert.equal(metadata.protocol,config.protocol||'routed');
   assert.equal(metadata.configurationError,null);
  }finally{await gateway.close();}
 }
});
