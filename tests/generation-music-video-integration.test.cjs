'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {readGenerationRoutingConfig}=require('../server/generation-routing-config.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const mp3=require('node:fs').readFileSync(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3'));
const mp4=require('node:fs').readFileSync(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'));
const key='synthetic-music-video-private-key';
const videoMap={'prob-4':{kind:'video.upscale',model:'fal-ai/topaz/upscale/video',enhancementModel:'Proteus'}};
const music={kind:'audio.generate',prompt:'A quiet acoustic song',inputs:[],parameters:{model:'music-2.6',scene:'Music',virtualModel:'minimax-music-26',lyric_mode:false,force_instrumental:false,lyrics:''}};
const video={kind:'video.upscale',prompt:'',inputs:[{type:'video',role:'source_video',url:'data:video/mp4;base64,'+mp4.toString('base64')}],parameters:{provider:'topazlabs',model:'prob-4',resolution:'2k',originalWidth:1280,originalHeight:720,width:2560,height:1440,frameRate:'auto',slowMotion:1}};
const singleMusic={protocol:'minimax-music-native',apiKey:key};
const singleVideo={protocol:'fal-video-native',apiKey:key,modelMap:videoMap};
function routed(apiKey=key){return readGenerationRoutingConfig({
 GENERATION_PROVIDERS:JSON.stringify({music:{protocol:'minimax-music-native',apiKeyEnv:'TEST_MUSIC_KEY'},video:{protocol:'fal-video-native',apiKeyEnv:'TEST_FAL_KEY',modelMap:videoMap}}),
 GENERATION_ROUTES:JSON.stringify({'audio.generate':{models:{'music-2.6':'music'}},'video.upscale':{models:{'prob-4':'video'}}}),TEST_MUSIC_KEY:apiKey,TEST_FAL_KEY:apiKey,
});}
async function send(gateway,url,method='GET',input,idempotencyKey='music-video-integration'){
 let result;await gateway.handle({method,headers:{'idempotency-key':idempotencyKey}},{},url,{json:(_res,status,body)=>{result={status,body};},body:async()=>input});return result;
}
async function settle(gateway,id,predicate=value=>!['queued','running'].includes(value.status)){
 for(let i=0;i<100;i++){const {status,body}=await send(gateway,'/api/generation/tasks/'+id);assert.equal(status,200);if(predicate(body))return body;await new Promise(resolve=>setTimeout(resolve,3));}
 assert.fail('native integration task did not settle');
}
function fixtureDownload(calls){return(url,options,callback)=>{
 assert.equal(url.href,'https://cdn.example.test/actual-video.mp4');
 assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers['xi-api-key'],undefined);
 const outgoing=new EventEmitter();outgoing.destroy=()=>{};outgoing.end=()=>{calls.push(url.href);options.lookup(url.hostname,{all:true},(error,answers)=>{assert.ifError(error);assert.deepEqual(answers,[{address:'93.184.216.34',family:4}]);});queueMicrotask(()=>{const incoming=new PassThrough();incoming.socket={remoteAddress:'93.184.216.34'};incoming.statusCode=200;incoming.headers={'content-type':'video/mp4','content-length':String(mp4.length)};callback(incoming);incoming.end(mp4);});};return outgoing;
};}
async function local(t,config,fetchImpl){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'music-video-native-integration-')),mediaCalls=[];let gateway;
 async function open(next=config,transport=fetchImpl){const store=createGenerationMediaStore({directory:path.join(root,'media')}),downloader=createGenerationMediaDownloader({lookup:async()=>[{address:'93.184.216.34',family:4}],requestImpl:fixtureDownload(mediaCalls)}),materializer=createGenerationMediaMaterializer({store,download:downloader.download});gateway=createGenerationGateway({...next,directory:path.join(root,'tasks'),mediaStore:store,mediaMaterializer:materializer,fetchImpl:transport});await gateway.ready;}
 await open();t.after(async()=>{await gateway.close();await fs.rm(root,{recursive:true,force:true});});
 return {root,mediaCalls,get gateway(){return gateway;},async restart(next=config,transport=fetchImpl){await gateway.close();await open(next,transport);},async bytes(output){assert.match(output.url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);return fs.readFile(path.join(root,'media',output.url.split('/').at(-1)+'.bin'));}};
}

test('new single and routed protocols expose truthful readiness without leaking credentials or dispatching',async t=>{
 const ui=await import('../src/features/node-composer/provider-configuration.mjs'),router=createGenerationRouter({...routed(),fetchImpl:()=>assert.fail('readiness must not dispatch')});
 assert.equal(router.configured,true);
 for(const [request,config,providerId]of [[music,singleMusic,'music'],[video,singleVideo,'video']]){
  assert.equal(ui.providerConfigured(router.metadata,request),true);assert.equal(ui.selectedProviderId(router.metadata,request),providerId);assert.equal(router.protocolFor(request),config.protocol);
  const gateway=createGenerationGateway({...config,fetchImpl:()=>assert.fail('metadata must not dispatch')});t.after(()=>gateway.close());const state=(await send(gateway,'/api/generation/config')).body;
  assert.equal(state.protocol,config.protocol);assert.equal(ui.providerConfigured(state,request),true);assert.equal(ui.providerConfigured(state,{...request,parameters:{...request.parameters,model:'unavailable'}}),false);
  assert.ok(!JSON.stringify(state).includes(key));
 }
 assert.equal(router.metadata.providers.music.capabilities.accountEligibility,'existing-paid-music-api-user');
});

test('missing keys in single and routed native configurations never dispatch a task',async t=>{
 for(const [config,request]of [[{...singleMusic,apiKey:''},music],[{...singleVideo,apiKey:''},video],[routed(''),music],[routed(''),video]]){
  let calls=0;const current=await local(t,config,()=>{calls++;assert.fail('missing key must never dispatch');});const state=(await send(current.gateway,'/api/generation/config')).body;assert.equal(state.configured,false);
  const created=await send(current.gateway,'/api/generation/tasks','POST',request);assert.equal(created.status,202);assert.equal((await settle(current.gateway,created.body.id)).status,'configuration_required');assert.equal(calls,0);assert.equal(current.mediaCalls.length,0);
 }
});

test('synchronous MiniMax MP3 localizes exact bytes in single and routed gateways and restart does not POST',async t=>{
 for(const config of [singleMusic,routed()]){
  let posts=0;const current=await local(t,config,async(url,options)=>{posts++;assert.equal(String(url),'https://api.minimax.io/v1/music_generation');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+key);const body=JSON.parse(options.body);assert.equal(body.output_format,'hex');assert.equal(body.stream,false);return Response.json({base_resp:{status_code:0},data:{status:2,audio:mp3.toString('hex')},extra_info:{music_size:mp3.length,music_sample_rate:44100}});});
  const created=(await send(current.gateway,'/api/generation/tasks','POST',music)).body,done=await settle(current.gateway,created.id);assert.equal(done.status,'succeeded');assert.deepEqual(await current.bytes(done.outputs[0]),mp3);assert.equal(posts,1);
  const record=JSON.parse(await fs.readFile(path.join(current.root,'tasks',created.id+'.json'),'utf8'));assert.equal(record.providerTaskId,undefined);assert.ok(!JSON.stringify(record).includes(key));
  await current.restart(config,()=>assert.fail('completed synchronous task must not regenerate'));const restored=(await send(current.gateway,'/api/generation/tasks/by-key/music-video-integration')).body;assert.equal(restored.status,'succeeded');assert.deepEqual(restored.outputs,done.outputs);assert.deepEqual(await current.bytes(restored.outputs[0]),mp3);assert.equal((await send(current.gateway,'/api/generation/tasks','POST',music)).body.id,created.id);assert.equal(posts,1);
 }
});

test('lost synchronous music POST remains unknown across restart and same-key submission',async t=>{
 let posts=0;const current=await local(t,singleMusic,async()=>{posts++;throw Error('response lost after possible acceptance');});const created=(await send(current.gateway,'/api/generation/tasks','POST',music)).body;assert.equal((await settle(current.gateway,created.id)).status,'unknown');
 await current.restart(singleMusic,()=>assert.fail('ambiguous task must not POST again'));const restored=(await send(current.gateway,'/api/generation/tasks/by-key/music-video-integration')).body;assert.equal(restored.status,'unknown');assert.equal(restored.recovery.pollable,false);assert.equal((await send(current.gateway,'/api/generation/tasks','POST',music)).body.id,created.id);assert.equal(posts,1);assert.equal(current.mediaCalls.length,0);
});

test('explicit MiniMax account rejection is terminal failed rather than ambiguous and is not resubmitted',async t=>{
 let posts=0;const current=await local(t,routed(),async()=>{posts++;return Response.json({base_resp:{status_code:1008,status_msg:'insufficient balance'}});});
 const created=(await send(current.gateway,'/api/generation/tasks','POST',music)).body,failed=await settle(current.gateway,created.id);assert.equal(failed.status,'failed');assert.equal(failed.code,'provider_failed');assert.equal(failed.outputs,undefined);
 await current.restart(routed(),()=>assert.fail('confirmed rejection must remain terminal'));assert.equal((await send(current.gateway,'/api/generation/tasks/by-key/music-video-integration')).body.status,'failed');assert.equal((await send(current.gateway,'/api/generation/tasks','POST',music)).body.id,created.id);assert.equal(posts,1);assert.equal(current.mediaCalls.length,0);
});

test('routed Fal recovers the original nested endpoint identity after route replacement and localizes real MP4',async t=>{
 let complete=false;const calls=[],transport=async(url,options)=>{const href=String(url);calls.push({url:href,method:options.method});assert.equal(options.headers.Authorization,'Key '+key);if(options.method==='POST'){assert.equal(href,'https://queue.fal.run/fal-ai/topaz/upscale/video');assert.equal(JSON.parse(options.body).H264_output,true);return Response.json({request_id:'original-video',status:'IN_QUEUE'});}assert.ok(href.startsWith('https://queue.fal.run/fal-ai/topaz/requests/original-video'));return Response.json(href.includes('/status')?{request_id:'original-video',status:complete?'COMPLETED':'IN_PROGRESS'}:{video:{url:'https://cdn.example.test/actual-video.mp4',content_type:'video/mp4',file_size:mp4.length}});};
 const initial=routed(),current=await local(t,initial,transport),created=(await send(current.gateway,'/api/generation/tasks','POST',video)).body;
 const running=await settle(current.gateway,created.id,value=>value.status==='running'&&value.recovery.pollable);assert.equal(running.status,'running');await current.gateway.close();complete=true;
 const changed={providers:{...initial.providers,replacement:{protocol:'tasks-v1',apiKey:'synthetic-replacement-key',baseUrl:'https://replacement.example.test'}},routes:{...initial.routes,'video.upscale':{models:{'prob-4':'replacement'}}}};
 await current.restart(changed,transport);const restored=(await send(current.gateway,'/api/generation/tasks/by-key/music-video-integration')).body;assert.equal(restored.status,'succeeded');assert.deepEqual(await current.bytes(restored.outputs[0]),mp4);assert.equal(current.mediaCalls.length,1);assert.equal(calls.filter(value=>value.method==='POST').length,1);assert.ok(calls.slice(1).every(value=>value.method==='GET'&&value.url.startsWith('https://queue.fal.run/fal-ai/topaz/requests/original-video')));
 await current.restart(changed,()=>assert.fail('local video recovery must not contact any provider'));assert.equal((await send(current.gateway,'/api/generation/tasks/by-key/music-video-integration')).body.status,'succeeded');assert.equal((await send(current.gateway,'/api/generation/tasks','POST',video)).body.id,created.id);assert.equal(calls.filter(value=>value.method==='POST').length,1);
});
