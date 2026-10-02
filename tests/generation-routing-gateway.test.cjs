const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createGenerationGateway}=require('../server/generation.cjs');
const {readGenerationRoutingConfig}=require('../server/generation-routing-config.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const video={kind:'video.generate',prompt:'测试',parameters:{model:'Seedance 2.0',mode:'首尾帧',videoMode:'TEXT_TO_VIDEO',ratio:'16:9',quality:'720p',duration:5,audio:true,count:1}};
const image={kind:'image.generate',prompt:'树',parameters:{model:'image'}};
const providers={images:{protocol:'openai-native',baseUrl:'https://images.example.test/v1',apiKey:'test-image-key',modelMap:{image:{kind:'image.generate',model:'operator-image',maxCount:1}}},video:{protocol:'ark-native',baseUrl:'https://video.example.test/api/v3',apiKey:'test-video-key',modelMap:{'seedance-2.0':{kind:'video.generate',model:'operator-video',modes:{TEXT_TO_VIDEO:{ratios:['16:9'],resolutions:['720p'],durations:[5],audio:true}}}}},custom:{protocol:'tasks-v1',baseUrl:'https://custom.example.test/api',apiKey:'test-custom-key'}};
const routes={'image.generate':'images','video.generate':{models:{'seedance-2.0':'video'}},'panorama.edit':'custom'};
async function send(gateway,url,method='GET',input,key='routed-integration-operation'){let response;await gateway.handle({method,headers:{'idempotency-key':key}},{},url,{json:(_,status,value)=>{response={status,value};},body:async()=>input});return response;}
async function waitFor(gateway,id,status){for(let i=0;i<100;i++){const {value}=await send(gateway,'/api/generation/tasks/'+id);if(status.includes(value.status))return value;await new Promise(r=>setTimeout(r,5));}throw Error('task did not settle');}
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'freenow-routing-gateway-'));
test('gateway routes prepared canonical video, native image and custom operation using separate keys',async t=>{
 const directory=await temp(),calls=[];
 const gateway=createGenerationGateway({directory,providers,routes,baseUrl:'invalid legacy URL',apiKey:'unused-legacy-key',fetchImpl:async(url,options)=>{
  calls.push({url:String(url),method:options.method,authorization:new Headers(options.headers).get('authorization'),body:options.body&&JSON.parse(options.body)});
  if(String(url).includes('images.example.test'))return Response.json({data:[{b64_json:png}]});
  if(String(url).includes('video.example.test'))return Response.json(options.method==='POST'?{id:'cgt-original'}:{id:'cgt-original',status:'succeeded',content:{video_url:'https://media.example.test/result.mp4'}});
  return Response.json({id:'custom-1',status:'succeeded',outputs:[{type:'image',url:'https://media.example.test/pano.png'}]});
 }});t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 const config=(await send(gateway,'/api/generation/config')).value;assert.equal(config.protocol,'routed');assert.equal(config.configured,true);
 for(const secret of ['test-image-key','operator-image','images.example.test','test-video-key','operator-video'])assert.ok(!JSON.stringify(config).includes(secret));
 for(const [request,key]of [[image,'route-image-1'],[video,'route-video-1'],[{kind:'panorama.edit',prompt:'全景'},'route-custom-1']]){
  const {value}=await send(gateway,'/api/generation/tasks','POST',request,key);const done=await waitFor(gateway,value.id,['succeeded']);if(request.kind==='video.generate')assert.equal(done.outputs[0].sourceFileId,'cgt-original');
 }
 assert.deepEqual(calls.filter(x=>x.method==='POST').map(x=>[x.url,x.authorization]),[['https://images.example.test/v1/images/generations','Bearer test-image-key'],['https://video.example.test/api/v3/contents/generations/tasks','Bearer test-video-key'],['https://custom.example.test/api/tasks','Bearer test-custom-key']]);
 assert.equal(calls.find(x=>x.url.includes('video.example.test')&&x.method==='POST').body.model,'operator-video');
 const before=calls.length;
 for(const [request,key]of [[{kind:'audio.generate'},'missing-audio-1'],[{...video,parameters:{...video.parameters,duration:31}},'invalid-video-1']]){const {value}=await send(gateway,'/api/generation/tasks','POST',request,key);await waitFor(gateway,value.id,['configuration_required','failed']);}
 assert.equal(calls.length,before);
});
test('partial and invalid environment routing cannot borrow a legacy or sibling key',async()=>{
 for(const routing of [readGenerationRoutingConfig({GENERATION_ROUTES:'{}'}),{providers:{...providers,video:{...providers.video,apiKey:''}},routes}]){
  const gateway=createGenerationGateway({...routing,baseUrl:'https://legacy.example.test',apiKey:'legacy-key',fetchImpl:()=>assert.fail('must not dispatch')});
  const {value}=await send(gateway,'/api/generation/tasks','POST',video);assert.equal((await waitFor(gateway,value.id,['configuration_required'])).status,'configuration_required');await gateway.close();
 }
});
test('gateway restart uses original provider after route changes and blocks changed destination',async t=>{
 const directory=await temp(),calls=[];let phase='running';
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),method:options.method});return Response.json(options.method==='POST'?{id:'cgt-original'}:{id:'cgt-original',status:phase,...phase==='succeeded'?{content:{video_url:'https://media.example.test/result.mp4'}}:{}});};
 let gateway=createGenerationGateway({directory,providers,routes,fetchImpl});t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 const {value}=await send(gateway,'/api/generation/tasks','POST',video);await waitFor(gateway,value.id,['running']);await gateway.close();
 gateway=createGenerationGateway({directory,providers:{...providers,video:{...providers.video,baseUrl:'https://replacement.example.test'}},routes,fetchImpl});const before=calls.length;
 assert.equal((await send(gateway,'/api/generation/tasks/'+value.id)).value.status,'unknown');assert.equal(calls.length,before);await gateway.close();
 phase='succeeded';gateway=createGenerationGateway({directory,providers,routes:{},fetchImpl});
 assert.equal((await send(gateway,'/api/generation/tasks/by-key/routed-integration-operation')).value.status,'succeeded');assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.ok(calls.every(x=>x.url.includes('video.example.test')));
});
test('contradictory explicit video aliases cannot normalize into another routed provider',async()=>{
 const gateway=createGenerationGateway({providers:{a:providers.custom,b:{...providers.custom,baseUrl:'https://other.example.test'}},routes:{'video.generate':{models:{'seedance-1.5-pro':'a','seedance-2.0':'b'}}},fetchImpl:()=>assert.fail('explicit wire identity must not switch providers')});
 for(const explicit of [{modelId:'seedance-1.5-pro'},{providerParameters:{model:'seedance-1.5-pro'}}]){
  const {value}=await send(gateway,'/api/generation/tasks','POST',{...video,parameters:{...video.parameters,...explicit}});assert.equal((await waitFor(gateway,value.id,['failed'])).status,'failed');
 }
 await gateway.close();
});
test('custom tasks-v1 video aliases outside the UI catalog remain routable',async()=>{
 let calls=0;const gateway=createGenerationGateway({providers:{custom:providers.custom},routes:{'video.generate':{models:{'custom-video':'custom'}}},fetchImpl:async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).parameters.modelId,'custom-video');return Response.json({id:'custom-1',status:'succeeded',outputs:[{type:'video',url:'https://media.example.test/custom.mp4'}]});}});
 const {value}=await send(gateway,'/api/generation/tasks','POST',{kind:'video.generate',prompt:'custom',parameters:{modelId:'custom-video'}});assert.equal((await waitFor(gateway,value.id,['succeeded'])).status,'succeeded');assert.equal(calls,1);await gateway.close();
});
