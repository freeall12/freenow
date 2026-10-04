'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const reshootMap={'seedance-2.5':{kind:'video.reshoot',model:'operator-video-edit-model',capabilityMode:'prompt_simulation',resolution:'720p',generateAudio:true,profile:{ratios:['adaptive'],resolutions:['720p','1080p'],durations:[-1],audio:true,maxImages:0,maxVideos:1,maxAudios:0,videoDurationRange:{min:4,max:30,totalMax:30},omniReferenceTaskType:'edit'}}};
const panoramaMap={'hunyuan-world-panorama':{kind:'image.generate',model:'fal-ai/hunyuan_world'}};
const providers={reshoot:{protocol:'ark-video-reshoot-edit',apiKey:'synthetic-reshoot-key',baseUrl:'https://ark.test/api/v3',modelMap:reshootMap},panorama:{protocol:'fal-panorama-native',apiKey:'synthetic-panorama-key',modelMap:panoramaMap}};
const routes={'video.reshoot':{models:{'seedance-2.5':'reshoot'}},'image.generate':{models:{'hunyuan-world-panorama':'panorama'}}};
const reshoot={kind:'video.reshoot',prompt:'保留主体',inputs:[{type:'video',role:'source_video',url:'https://media.test/source.mp4',duration:8,width:1280,height:720}],parameters:{modelId:'seedance-2.5',schemaVersion:1,intent:'video_multi_view',capabilityMode:'prompt_simulation',sourceClip:null,aspectRatio:'adaptive',duration:8,candidateCount:1,resolution:'1080p',generateAudio:false,tracks:[{segmentId:'shot-1',name:'近景',startTime:0,endTime:8,mode:'static',pointA:{azimuth:90,elevation:15,distance:.3},instruction:'保持连续动作'}]}};
const panorama={kind:'image.generate',prompt:'把房间扩展为360度全景',inputs:[{type:'image',url:'https://media.test/room.png'}],parameters:{modelId:'hunyuan-world-panorama',ratio:'2:1',count:1,isPanoramaPrompt:true}};
const noNetwork=()=>assert.fail('metadata and unsupported routes must not access a supplier');

test('direct and routed native panorama/reshoot metadata declares exact capabilities without credentials',async()=>{
 const {providerConfigurationStatus,generationOperationReadiness}=await import('../src/features/node-composer/provider-configuration.mjs');
 for(const [config,requests]of [[providers.reshoot,[reshoot]],[providers.panorama,[panorama]],[{providers,routes},[reshoot,panorama]]]){
  const gateway=createGenerationGateway({...config,fetchImpl:noNetwork});
  try{
   let metadata;await gateway.handle({method:'GET'},{},'/api/generation/config',{json:(_res,status,value)=>{assert.equal(status,200);metadata=value;}});
   assert.equal(metadata.configured,true);assert.equal(metadata.configurationError,null);
   for(const secret of ['synthetic-reshoot-key','synthetic-panorama-key','operator-video-edit-model'])assert.equal(JSON.stringify(metadata).includes(secret),false);
   for(const request of requests){assert.equal(providerConfigurationStatus(metadata,request).configured,true);assert.equal(generationOperationReadiness(metadata).find(row=>row.kind===request.kind).state,'ready');}
   assert.equal(generationOperationReadiness(metadata).find(row=>row.kind==='panorama.edit').configured,false);
   assert.equal(generationOperationReadiness(metadata).find(row=>row.kind==='video.generate').configured,false);
  }finally{await gateway.close();}
 }
});

test('routed reshoot preserves VIDEO_EDIT, automatic source duration and original task identity',async()=>{
 const calls=[],router=createGenerationRouter({providers,routes,fetchImpl:async(url,options)=>{
  calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body)});
  return Response.json(options.method==='POST'?{id:'accepted-reshoot'}:{id:'accepted-reshoot',status:'running'});
 }});
 const accepted=await router.submit(reshoot);assert.match(accepted.id,/^rg1\./);
 assert.equal(router.protocolFor(reshoot),'ark-video-reshoot-edit');
 assert.equal(calls[0].body.omni_reference_task_type,'edit');assert.equal(calls[0].body.duration,-1);
 assert.equal(calls[0].body.resolution,'1080p');assert.equal(calls[0].body.generate_audio,false);
 assert.match(calls[0].body.content[0].text,/近景/);assert.match(calls[0].body.content[0].text,/保持连续动作/);
 assert.equal((await router.poll(accepted.id)).id,accepted.id);assert.equal(calls[1].method,'GET');assert.match(calls[1].url,/accepted-reshoot$/);
 assert.equal(calls.filter(call=>call.method==='POST').length,1);
});

test('an explicit panorama model cannot silently route an ordinary image alias or another operation',async()=>{
 const router=createGenerationRouter({providers,routes,fetchImpl:noNetwork});
 for(const request of [{...panorama,parameters:{...panorama.parameters,modelId:'nano-banana-pro'}},{...panorama,kind:'panorama.edit'},{...reshoot,parameters:{...reshoot.parameters,modelId:'seedance-2.0'}}])assert.throws(()=>router.prepare(request),{code:'configuration_required'});
});

test('one configured supplier never makes a missing sibling route ready',async()=>{
 const {providerConfigurationStatus}=await import('../src/features/node-composer/provider-configuration.mjs');
 for(const [id,request,other]of [['panorama',panorama,reshoot],['reshoot',reshoot,panorama]]){
  const router=createGenerationRouter({providers:{...providers,[id]:{...providers[id],apiKey:''}},routes,fetchImpl:noNetwork});
  assert.equal(router.configured,true);assert.equal(providerConfigurationStatus(router.metadata,request).configured,false);
  assert.equal(providerConfigurationStatus(router.metadata,other).configured,true);assert.throws(()=>router.prepare(request),{code:'configuration_required'});
 }
});
