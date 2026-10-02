'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const {readGenerationRoutingConfig}=require('../server/generation-routing-config.cjs');

const specs={resolutions:['768P','2K'],durations:Array.from({length:12},(_,i)=>i+4)};
const minimaxMap={'MiniMax-H3':{kind:'video.generate',model:'MiniMax-H3',modes:{
 TEXT_TO_VIDEO:{...specs,ratios:['21:9','16:9','4:3','1:1','3:4','9:16']},
 IMAGE_TO_VIDEO:{...specs,ratios:['adaptive']},START_END_TO_VIDEO:{...specs,ratios:['adaptive']},
 REFERENCE_TO_VIDEO:{...specs,ratios:['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'],maxImages:9,maxVideos:3,maxAudios:3,maxMedia:12,videoDurationRange:{min:2,max:15,totalMax:15},audioDurationRange:{min:2,max:15,totalMax:15}},
}}};
const tripoMap={
 'tripo-text-to-model-h3':{kind:'world.generate',mode:'text-to-model',model:'v3.1-20260211',displayModel:'Tripo H3.1'},
 'tripo-image-to-model-h3':{kind:'world.generate',mode:'image-to-model',model:'v3.1-20260211',displayModel:'Tripo H3.1'},
};
function config(){return readGenerationRoutingConfig({
 GENERATION_PROVIDERS:JSON.stringify({
  minimax:{protocol:'minimax-native',baseUrlEnv:'MINIMAX_ORIGIN',apiKeyEnv:'MINIMAX_KEY',modelMapEnv:'MINIMAX_MAP'},
  tripo:{protocol:'tripo-native',apiKeyEnv:'TRIPO_KEY',modelMapEnv:'TRIPO_MAP'},
  tasks:{protocol:'tasks-v1',baseUrl:'https://task-provider.example.test',apiKeyEnv:'TASKS_KEY'},
 }),
 GENERATION_ROUTES:JSON.stringify({
  'video.generate':{default:'tasks',models:{'MiniMax-H3':'minimax'}},
  'world.generate':{default:'tasks',models:{'tripo-text-to-model-h3':'tripo','tripo-image-to-model-h3':'tripo'}},
 }),
 MINIMAX_ORIGIN:'https://minimax-provider.example.test',MINIMAX_KEY:'fixture-minimax-private-key',MINIMAX_MAP:JSON.stringify(minimaxMap),
 TRIPO_KEY:'fixture-tripo-private-key',TRIPO_MAP:JSON.stringify(tripoMap),TASKS_KEY:'fixture-tasks-private-key',
});}
async function modules(){return Promise.all([
 import('../src/features/video-generation/settings.mjs'),
 import('../src/features/video-generation/minimax-native.mjs'),
 import('../src/features/world-node/model.mjs'),
 import('../src/features/node-composer/provider-configuration.mjs'),
]);}
function noServerConfiguration(value){
 const publicData=JSON.stringify(value);
 for(const hidden of ['fixture-minimax-private-key','fixture-tripo-private-key','fixture-tasks-private-key','minimax-provider.example.test','openapi.tripo3d.ai','task-provider.example.test','v3.1-20260211'])assert.ok(!publicData.includes(hidden));
}
async function send(gateway,url,method='GET',input,key='native-integration-request'){
 let result;
 await gateway.handle({method,headers:{'idempotency-key':key}},{},url,{json:(_res,status,body)=>{result={status,body};},body:async()=>input});
 return result;
}
async function settled(gateway,id,predicate){
 for(let i=0;i<50;i++){
  const response=await send(gateway,'/api/generation/tasks/'+id);assert.equal(response.status,200);
  if(predicate(response.body))return response.body;
  if(['failed','configuration_required','unknown'].includes(response.body.status))assert.fail('Unexpected task state: '+JSON.stringify(response.body));
  await new Promise(resolve=>setTimeout(resolve,3));
 }
 assert.fail('native task did not settle');
}
function transport({complete=true}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const href=String(url),minimax=href.startsWith('https://minimax-provider.example.test/');
  assert.ok(minimax||href.startsWith('https://openapi.tripo3d.ai/v3/'),'native requests must use their selected provider');
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer '+(minimax?'fixture-minimax-private-key':'fixture-tripo-private-key'));
  assert.equal(options.redirect,'error');
  calls.push({url:href,method:options.method,body:options.body&&JSON.parse(options.body)});
  if(options.method==='POST')return Response.json(minimax?{task_id:'minimax-original-task'}:{code:0,data:{task_id:'task_tripo_original'}});
  if(minimax)return Response.json({task:{id:'minimax-original-task',model:'MiniMax-H3',task_type:'generation',modality:'video',status:complete?'succeeded':'running',...complete?{content:{url:'https://media.example.test/h3-result.mp4'}}:{}}});
  const mode=calls.find(call=>call.method==='POST'&&call.url.includes('/generation/')).url.endsWith('/image-to-model')?'image_to_model':'text_to_model';
  return Response.json({code:0,data:{task_id:'task_tripo_original',type:mode,status:complete?'success':'running',progress:complete?100:37,...complete?{output:{model_url:'https://media.example.test/tripo-result.glb',rendered_image_url:'https://media.example.test/tripo-poster.png'}}:{}}});
 };
 return {calls,fetchImpl,finish:()=>{complete=true;}};
}
async function durable(t,fetchImpl){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-native-creation-'));
 let gateway=createGenerationGateway({directory,...config(),fetchImpl});
 t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 return {directory,get gateway(){return gateway;},restart:async routes=>{await gateway.close();gateway=createGenerationGateway({directory,...config(),routes,fetchImpl});return gateway;}};
}

test('standalone and routed readiness selects the exact native operation without exposing server configuration',async t=>{
 const [video,,world,ui]=await modules(),router=createGenerationRouter({...config(),fetchImpl:()=>assert.fail('readiness never dispatches')});
 const videoRequest=video.prepareVideoRequest({kind:'video.generate',prompt:'狐狸跑过森林',inputs:[],parameters:{model:'MiniMax H3'}});
 const worldRequest=world.prepare({id:'world',worldConfig:{prompt:'a ceramic vessel'}},[]).request;
 assert.equal(router.configured,true);
 for(const [request,id,protocol]of [[videoRequest,'minimax','minimax-native'],[worldRequest,'tripo','tripo-native']]){
  assert.equal(ui.providerConfigured(router.metadata,request),true);
  assert.equal(ui.selectedProviderId(router.metadata,request),id);assert.equal(router.protocolFor(request),protocol);
  const gateway=createGenerationGateway({protocol,...config().providers[id],fetchImpl:()=>assert.fail('metadata does not dispatch')});
  t.after(()=>gateway.close());
  const standalone=(await send(gateway,'/api/generation/config')).body;
  noServerConfiguration(standalone);
  assert.equal(ui.providerConfigured(standalone,request),true);
  assert.equal(ui.providerConfigured(standalone,{...request,kind:request.kind==='video.generate'?'world.generate':'video.generate'}),false);
  assert.equal(ui.providerConfigured(standalone,{...request,parameters:{model:'missing-model'}}),false);
 }
 const narrow=createGenerationRouter({...config(),routes:{'video.generate':{models:{'MiniMax-H3':'minimax'}},'world.generate':{models:{'tripo-text-to-model-h3':'tripo'}}}});
 assert.equal(ui.providerConfigured(narrow.metadata,{kind:'video.generate',parameters:{modelId:'MiniMax-H3-Max'}}),false);
 assert.equal(ui.providerConfigured(narrow.metadata,{kind:'world.generate',parameters:{model:'MiniMax-H3'}}),false);
 assert.throws(()=>narrow.prepare({kind:'world.generate',parameters:{model:'MiniMax-H3'}}),{code:'configuration_required'});
 assert.ok(ui.configurationReadiness(router.metadata).some(row=>row.operation==='视频生成'&&row.provider==='minimax'&&row.configured));
 assert.ok(ui.configurationReadiness(router.metadata).some(row=>row.operation==='3D 资源生成'&&row.provider==='tripo'&&row.configured));
 noServerConfiguration(router.metadata);
 assert.equal(router.metadata.providers.tripo.capabilities.models['tripo-text-to-model-h3'].label,'Tripo H3.1');
});

test('default H3 frontend settings create native text video through mixed gateway without empty reference mode',async t=>{
 const [video]=await modules(),stub=transport(),fixture=await durable(t,stub.fetchImpl);
 const request=video.prepareVideoRequest({kind:'video.generate',prompt:'狐狸跑过森林',inputs:[],parameters:{model:'MiniMax H3'}});
 assert.equal(request.parameters.videoMode,'TEXT_TO_VIDEO');
 assert.equal(request.parameters.providerParameters.model,'MiniMax-H3');
 const created=await send(fixture.gateway,'/api/generation/tasks','POST',request);assert.equal(created.status,202);
 const done=await settled(fixture.gateway,created.body.id,job=>job.status==='succeeded');
 assert.deepEqual(done.outputs,[{type:'video',url:'https://media.example.test/h3-result.mp4',sourceFileId:'minimax-original-task'}]);
 assert.deepEqual(stub.calls.filter(call=>call.method==='POST'),[{url:'https://minimax-provider.example.test/v2/video_generation',method:'POST',body:{model:'MiniMax-H3',content:[{type:'text',text:request.prompt}],resolution:'2K',duration:5,ratio:'16:9'}}]);
});

test('H3 multimodal frontend request retains reference order, mentions, duration and selected specs through gateway',async t=>{
 const [video,minimax]=await modules(),stub=transport(),fixture=await durable(t,stub.fetchImpl);
 const router=createGenerationRouter(config());
 const request=minimax.prepareMinimaxNativeInputs(video.prepareVideoRequest({kind:'video.generate',prompt:'{{Image 1}} 的角色，{{Video 1}} 的运镜，{{Audio 1}} 的音色',
  inputs:[{type:'text',text:'黄昏时'},{type:'video',url:'https://media.example.test/ref.mp4',duration:7},{type:'image',url:'https://media.example.test/ref.png'},{type:'audio',url:'https://media.example.test/ref.mp3',duration:4}],
  parameters:{model:'MiniMax H3',mode:'全能参考',quality:'768P',ratio:'9:16',duration:8,count:1}}),router.metadata.providers.minimax);
 const snapshot=structuredClone(request),created=await send(fixture.gateway,'/api/generation/tasks','POST',request);assert.equal(created.status,202);
 await settled(fixture.gateway,created.body.id,job=>job.status==='succeeded');assert.deepEqual(request,snapshot);
 const body=stub.calls.find(call=>call.method==='POST').body;
 assert.deepEqual(body,{model:'MiniMax-H3',content:[{type:'text',text:'黄昏时\nreference image 1 的角色，reference video 1 的运镜，reference audio 1 的音色'},
  {type:'video_url',video_url:{url:'https://media.example.test/ref.mp4'},role:'reference_video'},
  {type:'image_url',image_url:{url:'https://media.example.test/ref.png'},role:'reference_image'},
  {type:'audio_url',audio_url:{url:'https://media.example.test/ref.mp3'},role:'reference_audio'}],resolution:'768P',duration:8,ratio:'9:16'});
 assert.equal(stub.calls.filter(call=>call.method==='POST').length,1);
});

for(const image of [false,true])test('Tripo frontend '+(image?'image':'text')+' world plan preserves material controls through mixed gateway',async t=>{
 const [,,world]=await modules(),stub=transport(),fixture=await durable(t,stub.fetchImpl);
 const plan=world.prepare({id:'world',worldConfig:{model:'tripo-h3',prompt:image?'':'a ceramic vessel',material:image?'pbr':'geometry'}},image?[{nodeId:'image',type:'image',url:'https://media.example.test/input.png'}]:[]);
 assert.equal(plan.error,null);const request=plan.request,snapshot=structuredClone(request);
 const created=await send(fixture.gateway,'/api/generation/tasks','POST',request);assert.equal(created.status,202);
 const done=await settled(fixture.gateway,created.body.id,job=>job.status==='succeeded');assert.deepEqual(request,snapshot);
 assert.deepEqual(done.outputs,[{type:'model',url:'https://media.example.test/tripo-result.glb',sourceFileId:'task_tripo_original',poster:'https://media.example.test/tripo-poster.png'}]);
 assert.deepEqual(stub.calls.filter(call=>call.method==='POST'),[{url:'https://openapi.tripo3d.ai/v3/generation/'+(image?'image':'text')+'-to-model',method:'POST',body:{model:'v3.1-20260211',...request.parameters.tripoParams,...image?{input:request.inputs[0].url}:{prompt:request.prompt}}}]);
});

for(const kind of ['video','world'])test('durable '+kind+' recovery queries original native provider after route removal with one POST',async t=>{
 const [video,,world]=await modules(),stub=transport({complete:false}),fixture=await durable(t,stub.fetchImpl),key='native-recovery-'+kind;
 const request=kind==='video'?video.prepareVideoRequest({kind:'video.generate',prompt:'狐狸跑过森林',inputs:[],parameters:{model:'MiniMax H3',mode:'首尾帧'}}):world.prepare({id:'world',worldConfig:{prompt:'a ceramic vessel'}},[]).request;
 const created=await send(fixture.gateway,'/api/generation/tasks','POST',request,key);assert.equal(created.status,202);
 const accepted=await settled(fixture.gateway,created.body.id,job=>job.recovery?.submissionState==='accepted');assert.equal(accepted.recovery.pollable,true);
 await fixture.restart({});stub.finish();
 const configResponse=await send(fixture.gateway,'/api/generation/config');assert.equal(configResponse.body.configured,false);
 const recovered=await send(fixture.gateway,'/api/generation/tasks/by-key/'+key);assert.equal(recovered.status,200);assert.equal(recovered.body.id,created.body.id);assert.equal(recovered.body.status,'succeeded');
 assert.deepEqual(recovered.body.request,request);assert.equal(recovered.body.outputs[0].type,kind==='video'?'video':'model');
 const repeated=await send(fixture.gateway,'/api/generation/tasks','POST',request,key);assert.equal(repeated.body.id,created.body.id);assert.equal(repeated.body.status,'succeeded');
 assert.equal(stub.calls.filter(call=>call.method==='POST').length,1);
 const query=kind==='video'?'https://minimax-provider.example.test/v2/query/video_generation/minimax-original-task':'https://openapi.tripo3d.ai/v3/tasks/task_tripo_original';
 assert.ok(stub.calls.some(call=>call.method==='GET'));assert.ok(stub.calls.filter(call=>call.method==='GET').every(call=>call.url===query&&call.body===undefined));
 noServerConfiguration(recovered.body);
});
