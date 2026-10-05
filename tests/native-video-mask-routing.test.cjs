'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createVideoMaskProvider}=require('../server/generation-video-mask.cjs');
const protocol='fal-video-mask-native';
const entry=kind=>({kind,model:'fal-ai/wan-vace-14b/inpainting',semantics:'explicit-native-alternative'});
const config={protocol,apiKey:'fixture-only-secret',modelMap:{'video.erase':entry('video.erase'),'video.replace':entry('video.replace')}};
const request={kind:'video.erase',nodeId:'source',prompt:'',inputs:[{type:'video',role:'source_video',url:'data:video/mp4;base64,YQ=='}],parameters:{action:'remove',sourceClip:null,mask:{encoding:'rle-zero-based-row-major',width:2,height:2,fps:30,frames:Array(120).fill('0 1')},aspectRatio:'adaptive',resolution:'720p',candidateCount:1}};
test('toolbar kind-only selection resolves only the explicit masked adapter and rejects a wrong alias',async()=>{
 const router=createGenerationRouter({providers:{mask:config},routes:{'video.erase':'mask','video.replace':'mask'},fetchImpl:()=>assert.fail('pure preparation must not access network')});
 assert.equal(router.configured,true);assert.equal(router.protocolFor(request),protocol);assert.doesNotThrow(()=>router.prepare(request));
 const {providerConfigurationStatus:status}=await import('../src/features/node-composer/provider-configuration.mjs');
 assert.equal(status(router.metadata,request).configured,true);
 assert.equal(status(createVideoMaskProvider(config).metadata,request).configured,true);
 const wrong={...request,parameters:{...request.parameters,model:'unmapped'}};
 assert.throws(()=>router.prepare(wrong),{code:'configuration_required'});assert.equal(status(router.metadata,wrong).reason,'model_unmapped');
 const ordinary=createGenerationRouter({providers:{mask:config},routes:{'video.generate':'mask'}});
 assert.equal(ordinary.configured,false);assert.throws(()=>ordinary.prepare({...request,kind:'video.generate'}),{code:'configuration_required'});
});

function controlledRouter(events){
 const filename=path.resolve(__dirname,'../server/generation-router.cjs'),nativeRequire=createRequire(filename),module={exports:{}};
 const createProvider=options=>({configured:true,fingerprint:options.apiKey==='changed'?'b'.repeat(64):'a'.repeat(64),metadata:{configured:true,protocol,capabilities:{kinds:['video.erase'],models:{'video.erase':{kind:'video.erase'}}}},prepare:()=>{},
  async submit(input,context){events.push(['start',options.directory]);await context.onPreparationState(preparation);events.push(['upload']);await context.onTaskIdentity('wm1.fixture');events.push(['accepted']);return {id:'wm1.fixture',status:'queued'};},
  async resumePreparation(state,context){events.push(['resume',state,context.preparationState,context.request]);return {id:'wm1.fixture',status:'queued'};},
  async poll(id,context){events.push(['poll',id,context.preparationState]);return {id,status:'queued'};}
 });
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:id=>id==='./generation-video-mask.cjs'?{createVideoMaskProvider:createProvider}:nativeRequire(id),Buffer,URL,structuredClone,fetch,AbortSignal,setTimeout,clearTimeout},{filename});
 return module.exports.createGenerationRouter;
}
const preparation={version:1,protocol,preparationId:'12345678-1234-4123-8123-123456789012',kind:'video.erase',stage:'media-ready',status:'ready',requestHash:'c'.repeat(64)};
test('router awaits private checkpoints and wraps accepted identities before later provider work',async()=>{
 const events=[],factory=controlledRouter(events),router=factory({providers:{mask:config},routes:{'video.erase':'mask'},preparationDirectory:'/tmp/freenow-router-only-fixture'});
 let saved,identity;
 const result=await router.submit(request,{onPreparationState:async state=>{await new Promise(setImmediate);saved=state;events.push(['saved']);},onTaskIdentity:async id=>{await new Promise(setImmediate);identity=id;events.push(['identity']);}});
 assert.deepEqual(events.map(e=>e[0]),['start','saved','upload','identity','accepted']);
 assert.equal(events[0][1],'/tmp/freenow-router-only-fixture/mask');assert.equal(result.id,identity);
 assert.equal(saved.routing.providerId,'mask');assert.equal(saved.routing.providerFingerprint,'a'.repeat(64));
 await router.poll(identity,{request,preparationState:saved});
 assert.equal(events.at(-1)[2].routing,undefined);assert.equal(events.at(-1)[2].preparationId,preparation.preparationId);
});
test('checkpoint failure stops later work and recovery stays with the original provider after a route edit',async()=>{
 const events=[],factory=controlledRouter(events),router=factory({providers:{mask:config},routes:{'video.erase':'mask'}});
 await assert.rejects(()=>router.submit(request,{onPreparationState:async()=>{throw Object.assign(Error('private store failed'),{code:'storage_error'});}}),{code:'storage_error'});
 assert.deepEqual(events.map(e=>e[0]),['start']);
 const state={...preparation,routing:{providerId:'mask',providerFingerprint:'a'.repeat(64)}};
 const moved=factory({providers:{mask:config,new:{...config,apiKey:'changed'}},routes:{'video.erase':'new'}});
 const recovered=await moved.resumePreparation(state,{request,preparationState:state});
 const providerId=JSON.parse(Buffer.from(recovered.id.slice(4),'base64url'))[0];
 assert.equal(providerId,'mask');assert.equal(events.at(-1)[0],'resume');assert.equal(events.at(-1)[1].routing,undefined);assert.equal(events.at(-1)[2].routing,undefined);
 const changed=factory({providers:{mask:{...config,apiKey:'changed'}},routes:{'video.erase':'mask'}});
 await assert.rejects(()=>changed.resumePreparation(state,{request}),{code:'provider_configuration_changed'});
});
