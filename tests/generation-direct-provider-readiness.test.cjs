'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {TaskService}=require('../generation-api.js');
const {createOpenAINativeProvider}=require('../server/generation-openai.cjs');
const {createArkProvider}=require('../server/generation-ark.cjs');
const readiness=import('../src/features/node-composer/provider-configuration.mjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const videoProfile={kind:'video.generate',model:'operator-private-video',modes:{TEXT_TO_VIDEO:{ratios:['16:9'],resolutions:['720p'],durations:[5],audio:true}}};
const ark=()=>createArkProvider({baseUrl:'https://operator-private.invalid',apiKey:'test-only-secret',modelMap:{'seedance-2.0':videoProfile}});
const openai=()=>createOpenAINativeProvider({client:{},modelMap:{
  text:{kind:'text.generate',model:'operator-private-text'},
  image:{kind:'image.generate',model:'operator-private-image'},
  speech:{kind:'audio.generate',scene:'Text-to-Speech',model:'gpt-4o-mini-tts',defaultVoice:'coral',formatMap:{wav:'wav'},defaultFormat:'wav'},
  'image.recognize':{kind:'image.recognize',model:'operator-private-analysis'},
  'video.analyze':{kind:'video.analyze',model:'operator-private-analysis'}
}});

test('direct Ark validates actual public video aliases and accepts its prepared default mode',async()=>{
  const {providerConfigurationStatus:status,providerConfigured}=await readiness,provider=ark();
  assert.equal(provider.configured,true);
  const request={kind:'video.generate',prompt:'local contract',inputs:[],parameters:{model:'seedance-2.0'}};
  assert.equal(providerConfigured(provider.metadata,request),true);
  assert.doesNotThrow(()=>provider.prepare(request));
  assert.equal(status(provider.metadata,{kind:'video.generate',parameters:{model:'unmapped'}}).reason,'model_unmapped');
  assert.deepEqual(status(provider.metadata,request).availableModels,['seedance-2.0']);
  assert.equal(status(provider.metadata,{kind:'video.generate'}).reason,'model_required');
  assert.equal(status(provider.metadata,{kind:'image.generate',parameters:{model:'seedance-2.0'}}).reason,'operation_unsupported');
  assert.equal(providerConfigured(provider.metadata),true);
});

test('direct OpenAI checks exhaustive speech/analysis profiles without inventing an image/text alias inventory',async()=>{
  const {providerConfigurationStatus:status,providerConfigured}=await readiness,provider=openai();
  assert.equal(provider.configured,true);
  for(const [kind,alias]of [['audio.generate','speech'],['image.recognize','image.recognize'],['video.analyze','video.analyze']]){
    assert.equal(providerConfigured(provider.metadata,{kind,parameters:{model:alias}}),true);
    assert.equal(status(provider.metadata,{kind,parameters:{model:'missing'}}).reason,'model_unmapped');
  }
  assert.equal(providerConfigured(provider.metadata,{kind:'image.recognize'}),true);
  assert.equal(providerConfigured(provider.metadata,{kind:'video.analyze'}),true);
  for(const [kind,alias]of [['image.generate','image'],['text.generate','text']]){
    const request={kind,prompt:'local contract',inputs:[],parameters:{model:alias}};
    assert.equal(providerConfigured(provider.metadata,request),true);
    assert.doesNotThrow(()=>provider.prepare(request));
    assert.equal(status(provider.metadata,request).modelAliasesKnown,false);
    assert.deepEqual(status(provider.metadata,request).availableModels,[]);
    // Their complete aliases are not public. The actual backend still rejects
    // unmapped aliases, rather than treating this client preflight as authority.
    const unmapped={...request,parameters:{model:'missing'}};
    assert.equal(providerConfigured(provider.metadata,unmapped),true);
    assert.throws(()=>provider.prepare(unmapped),{code:'configuration_required'});
  }
  assert.equal(status(provider.metadata,{kind:'video.generate',parameters:{model:'video'}}).reason,'operation_unsupported');
  const textOnly=createOpenAINativeProvider({client:{},modelMap:{text:{kind:'text.generate',model:'private'}}});
  assert.equal(status(textOnly.metadata,{kind:'audio.generate',parameters:{model:'speech'}}).reason,'operation_unmapped');
});

test('routed diagnostic names exact chosen provider and mapping without sibling fallback or secret metadata',async()=>{
  const {providerConfigurationStatus:status}=await readiness;
  const provider=ark().metadata;
  provider.apiKey='never-render-secret';provider.baseUrl='https://never-render.invalid';provider.modelMap={alias:{model:'never-render-native'}};
  const metadata={protocol:'routed',configured:true,providers:{video:{...provider,capabilities:{...provider.capabilities,models:{'seedance-2.0':{kind:'video.generate'}}}},disabled:{configured:false,missing:['ARK_API_KEY','never-render-secret','https://never-render.invalid']}},routes:{'video.generate':{default:'video',models:{blocked:'disabled'}}}};
  const missing=status(metadata,{kind:'video.generate',parameters:{model:'blocked'}});
  assert.equal(missing.configured,false);assert.equal(missing.provider,'disabled');assert.equal(missing.reason,'configuration_missing');assert.deepEqual(missing.missing,['ARK_API_KEY']);
  const unmapped=status(metadata,{kind:'video.generate',parameters:{model:'other'}});
  assert.equal(unmapped.provider,'video');assert.equal(unmapped.reason,'model_unmapped');assert.match(unmapped.message,/modelMapEnv/);assert.match(unmapped.message,/seedance-2\.0/);
  assert.equal(status(metadata,{kind:'audio.generate',parameters:{model:'speech'}}).reason,'route_missing');
  assert.match(status(metadata,{kind:'audio.generate'}).message,/GENERATION_ROUTES.*audio\.generate/);
  assert.ok(!JSON.stringify([missing,unmapped]).includes('never-render'));
  assert.equal(status({...metadata,configurationError:'configuration_invalid'},{kind:'video.generate'}).reason,'configuration_invalid');
});

test('tasks-v1 and old direct metadata retain compatibility while unknown metadata remains unknown',async()=>{
  const {providerConfigurationStatus:status,providerConfigured}=await readiness;
  for(const protocol of ['tasks-v1','openai-native','ark-native']){
    assert.equal(providerConfigured({configured:true,protocol},{kind:'custom.operation',parameters:{model:'custom'}}),true);
  }
  assert.equal(providerConfigured(null,{kind:'video.generate'}),null);
  assert.equal(status(null,{kind:'video.generate'}).reason,'unknown');
  const metadata=ark().metadata;
  for(const model of ['toString','constructor','__proto__','',42])assert.equal(providerConfigured(metadata,{kind:'video.generate',parameters:{model}}),false);
  assert.equal(providerConfigured(metadata,{kind:'video.generate',parameters:{model:'missing',modelId:'seedance-2.0'}}),true);
  assert.equal(providerConfigured(metadata,{kind:'video.generate',parameters:{model:'seedance-2.0',providerParameters:{model:'missing'}}}),false);
});

test('operation-only queries find usable alias routes but cannot waive an explicit or submitted model',async()=>{
  const {providerConfigurationStatus:status}=await readiness;
  const provider=ark().metadata;
  assert.equal(status(provider,{kind:'video.generate'},{operationOnly:true}).configured,true);
  assert.equal(status(provider,{kind:'video.generate'}).reason,'model_required');
  assert.equal(status(provider,{kind:'video.generate',parameters:{model:'missing'}},{operationOnly:true}).configured,false);
  const routed={protocol:'routed',configured:true,providers:{ark:{...provider,capabilities:{...provider.capabilities,models:{'seedance-2.0':{kind:'video.generate'}}}}},routes:{'video.generate':{models:{'seedance-2.0':'ark'}}}};
  const scoped=status(routed,{kind:'video.generate'},{operationOnly:true});
  assert.equal(scoped.configured,true);assert.equal(scoped.provider,'ark');
  assert.equal(status(routed,{kind:'video.generate'}).configured,false);
  assert.equal(status(routed,{kind:'audio.generate'},{operationOnly:true}).reason,'route_missing');
  routed.routes['video.generate'].models={notMapped:'ark'};
  assert.equal(status(routed,{kind:'video.generate'},{operationOnly:true}).configured,false);
  const custom={protocol:'routed',configured:true,providers:{tasks:{protocol:'tasks-v1',configured:true}},routes:{'studio.generate':{models:{custom:'tasks'}}}};
  assert.equal(status(custom,{kind:'studio.generate'},{operationOnly:true}).configured,true);
  assert.equal(status(custom,{kind:'studio.generate'}).configured,false);
  assert.equal(status(custom,{kind:'studio.generate',parameters:{model:'custom'}}).configured,true);
  const open=openai().metadata;
  assert.equal(status(open,{kind:'image.generate'},{operationOnly:true}).configured,true);
  assert.equal(status(open,{kind:'image.generate'}).reason,'model_required');
});

test('specific preflight failure reaches task error before media reads, result reservations or dispatch',async()=>{
  const {providerConfigurationStatus:status}=await readiness,metadata=ark().metadata;
  let reads=0,reservations=0,dispatch=0;
  const service=new TaskService({prepareInputs:request=>{reads++;reservations++;return request;}});
  service.setProvider({isConfigured:({request})=>{
    const current=status(metadata,request);
    if(current.configured===false)throw Object.assign(Error(current.message),{code:'configuration_required',providerDispatched:false});
    return current.configured;
  },generate:async()=>{dispatch++;return {outputs:[{type:'text',text:'local fixture only'}]};}});
  const job=service.submit({kind:'video.generate',inputs:[{type:'image',url:'asset:must-not-read'}],parameters:{model:'unmapped'}});
  for(let i=0;i<30&&['queued','running'].includes(job.status);i++)await tick();
  assert.equal(job.status,'configuration_required');assert.equal(job.providerDispatched,false);
  assert.match(job.error,/GENERATION_MODEL_MAP/);assert.match(job.error,/seedance-2\.0/);
  assert.equal(reads,0);assert.equal(reservations,0);assert.equal(dispatch,0);
});

test('existing real-app QA fixture changes only public metadata and counts even forbidden submission attempts',async()=>{
  let network=0,oldStorage=0;
  const window={fetch:async()=>{network++;throw Error('unexpected real fetch');},localStorage:{getItem(){oldStorage++;throw Error('origin storage unavailable');},setItem(){oldStorage++;throw Error('quota full');}},dispatchEvent(){}};
  const context={window,location:new URL('http://localhost:4173/qa/provider-routing-app.html?session=readiness-contract'),URL,URLSearchParams,Event,Response};
  vm.runInNewContext(fs.readFileSync(require.resolve('../qa/provider-routing-fixture.js'),'utf8'),context);
  window.localStorage.setItem('view','test');assert.equal(window.localStorage.getItem('view'),'test');assert.equal(oldStorage,0);
  const routed=await (await window.fetch('/api/generation/config')).json();assert.equal(routed.protocol,'routed');
  window.ProviderRoutingFixtureSetMode('direct-ark');
  const direct=await (await window.fetch('/api/generation/config')).json();
  assert.equal(direct.protocol,'ark-native');assert.equal(direct.configured,true);assert.deepEqual(Object.keys(direct.capabilities.video),['seedance-2.5']);
  assert.ok(!JSON.stringify(direct).includes('apiKey'));assert.ok(!JSON.stringify(direct).includes('baseUrl'));
  assert.equal((await readiness).providerConfigured(direct,{kind:'video.generate',parameters:{model:'seedance-2.0'}}),false);
  await assert.rejects(window.fetch('/api/generation/tasks',{method:'POST',body:JSON.stringify({kind:'video.generate'})}),/不得派发/);
  assert.equal(window.ProviderRoutingFixture.posts,1);assert.equal(window.ProviderRoutingFixture.mediaReads,0);assert.equal(network,0);
  window.ProviderRoutingFixtureSetMode('routed');assert.equal((await (await window.fetch('/api/generation/config')).json()).protocol,'routed');
});
