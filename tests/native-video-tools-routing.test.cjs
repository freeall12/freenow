'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const extendMap={'seedance-2.5':{kind:'video.extend',capabilityMode:'prompt_simulation',model:'operator-real-video-model',resolution:'720p',generateAudio:true,profile:{ratios:['adaptive'],resolutions:['720p','1080p'],durations:[4,8],audio:true,maxImages:4,maxVideos:1,maxAudios:0,videoDurationRange:{min:2,max:15,totalMax:15}}}};
const audioMap={'sonilo-sfx':{kind:'audio.generate',model:'fal-ai/thinksound/audio',semantics:'explicit-native-alternative'}};
const providers={extend:{protocol:'ark-video-extend-reference',apiKey:'synthetic-extend-key',baseUrl:'https://ark.test/api/v3',modelMap:extendMap},sound:{protocol:'fal-video-audio-native',apiKey:'synthetic-sound-key',modelMap:audioMap}};
const routes={'video.extend':{models:{'seedance-2.5':'extend'}},'audio.generate':{models:{'sonilo-sfx':'sound'}}};
const noNetwork=()=>assert.fail('configuration inspection must not access the network');
const request={kind:'video.extend',prompt:'继续拍摄',inputs:[{type:'video',role:'source_video',nodeId:'original',url:'https://media.test/scene.mp4',duration:4,width:1280,height:720}],parameters:{modelId:'seedance-2.5',capabilityMode:'prompt_simulation',direction:'片尾延长',extendDirection:'forward',duration:8,mode:'自然延续',ratio:'自适应',candidateCount:1,sourceClip:null,subjects:[],referenceIds:[],resolution:'1080p',generateAudio:false}};

test('direct and routed native video tool profiles are public, exact and credential-free',async()=>{
 const {providerConfigurationStatus,generationOperationReadiness}=await import('../src/features/node-composer/provider-configuration.mjs');
 for(const config of [providers.extend,providers.sound,{providers,routes}]){
  const gateway=createGenerationGateway({...config,fetchImpl:noNetwork});
  try{
   let result;await gateway.handle({method:'GET'},{},'/api/generation/config',{json:(_res,status,value)=>{assert.equal(status,200);result=value;}});
   assert.equal(result.configured,true);assert.equal(result.configurationError,null);
   for(const secret of Object.values(providers).map(value=>value.apiKey))assert.equal(JSON.stringify(result).includes(secret),false);
   const checks=config===providers.extend?[request]:config===providers.sound?[{kind:'audio.generate',parameters:{model:'sonilo-sfx'}}]:[request,{kind:'audio.generate',parameters:{model:'sonilo-sfx'}}];
   for(const check of checks)assert.equal(providerConfigurationStatus(result,check).configured,true);
   for(const kind of checks.map(value=>value.kind))assert.equal(generationOperationReadiness(result).find(value=>value.kind===kind).state,'ready');
   assert.equal(generationOperationReadiness(result).find(value=>value.kind==='video.reshoot').configured,false);
  }finally{await gateway.close();}
 }
});

test('routed extension sends the dedicated reference-generation body and restores only its accepted identity',async()=>{
 const calls=[],router=createGenerationRouter({providers,routes,fetchImpl:async(url,options)=>{
  calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body)});
  return Response.json(options.method==='POST'?{id:'accepted-extension'}:{id:'accepted-extension',status:'running'});
 }});
 const accepted=await router.submit(request);assert.match(accepted.id,/^rg1\./);assert.equal(router.protocolFor(request),'ark-video-extend-reference');
 assert.equal(calls[0].body.model,'operator-real-video-model');assert.equal(calls[0].body.resolution,'1080p');assert.equal(calls[0].body.generate_audio,false);
 assert.match(calls[0].body.content[0].text,/仅生成新增片段/);
 assert.equal((await router.poll(accepted.id)).id,accepted.id);assert.equal(calls[1].method,'GET');assert.match(calls[1].url,/accepted-extension$/);
 assert.equal(calls.filter(value=>value.method==='POST').length,1);
});

test('an unconfigured native video tool cannot fall through to the other provider or a model alias',async()=>{
 const {providerConfigurationStatus}=await import('../src/features/node-composer/provider-configuration.mjs');
 for(const change of [{apiKey:''},{modelMap:{}}]){
  const router=createGenerationRouter({providers:{...providers,extend:{...providers.extend,...change}},routes,fetchImpl:noNetwork});
  assert.equal(router.configured,true);assert.equal(providerConfigurationStatus(router.metadata,request).configured,false);
  assert.equal(providerConfigurationStatus(router.metadata,{kind:'audio.generate',parameters:{model:'sonilo-sfx'}}).configured,true);
  assert.throws(()=>router.prepare(request),{code:'configuration_required'});
 }
 const router=createGenerationRouter({providers,routes,fetchImpl:noNetwork});
 assert.throws(()=>router.prepare({...request,parameters:{...request.parameters,modelId:'seedance-2.0'}}),{code:'configuration_required'});
});
