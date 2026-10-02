const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createGenerationGateway}=require('../server/generation.cjs');
const map={'seedance-2.0':{kind:'video.generate',model:'operator-selected-video-model',modes:{TEXT_TO_VIDEO:{ratios:['16:9'],resolutions:['720p'],durations:[5],audio:true}}}};
const request={kind:'video.generate',nodeId:'source',prompt:'测试合成视频',parameters:{model:'Seedance 2.0',mode:'首尾帧',videoMode:'TEXT_TO_VIDEO',ratio:'16:9',quality:'720p',duration:5,audio:true,count:1}};
async function send(gateway,url,method='GET',input,key='ark-integration-operation'){let response;await gateway.handle({method,headers:{'idempotency-key':key}},{},url,{json:(_,status,value)=>{response={status,value};},body:async()=>input});return response;}
async function waitFor(gateway,id,status){for(let i=0;i<100;i++){const {value}=await send(gateway,'/api/generation/tasks/'+id);if(status.includes(value.status))return value;await new Promise(r=>setTimeout(r,5));}throw Error('task did not settle');}
test('Ark gateway exposes no credentials and remains honestly unconfigured without its own key',async()=>{
 const gateway=createGenerationGateway({protocol:'ark-native',modelMap:map,fetchImpl:()=>assert.fail('no external request')});
 const config=(await send(gateway,'/api/generation/config')).value;
 assert.equal(config.protocol,'ark-native');assert.equal(config.configured,false);assert.ok(config.missing.includes('GENERATION_API_KEY'));
 assert.ok(!JSON.stringify(config).includes('operator-selected-video-model'));
 const {value}=await send(gateway,'/api/generation/tasks','POST',request);assert.equal((await waitFor(gateway,value.id,['configuration_required'])).status,'configuration_required');
 await gateway.close();
});
test('real gateway preparation and durable restart poll the original Ark task without a second POST',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-ark-gateway-')),calls=[];let phase='running';
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body)});return Response.json(options.method==='POST'?{id:'cgt-original'}:{id:'cgt-original',status:phase,...phase==='succeeded'?{content:{video_url:'https://media.example.test/result.mp4'},duration:5}:{}});};
 const options={directory,protocol:'ark-native',baseUrl:'https://provider.example.test/api/v3',apiKey:'test-key-not-real',modelMap:map,fetchImpl};let gateway=createGenerationGateway(options);
 t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 const {value:created}=await send(gateway,'/api/generation/tasks','POST',request);await waitFor(gateway,created.id,['running']);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls[0].url,'https://provider.example.test/api/v3/contents/generations/tasks');
 assert.equal(calls[0].body.model,'operator-selected-video-model');assert.equal(calls[0].body.duration,5);assert.equal(calls[0].body.generate_audio,true);
 await gateway.close();phase='succeeded';gateway=createGenerationGateway(options);await gateway.ready;
 const recovered=(await send(gateway,'/api/generation/tasks/by-key/ark-integration-operation')).value;
 assert.equal(recovered.id,created.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.outputs[0].sourceFileId,'cgt-original');
 assert.equal(recovered.outputs[0].url,'https://media.example.test/result.mp4');assert.equal(recovered.outputs[0].width,undefined);
 assert.equal((await send(gateway,'/api/generation/tasks','POST',request)).value.id,created.id);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 const stored=await fs.readFile(path.join(directory,created.id+'.json'),'utf8');assert.ok(!stored.includes('test-key-not-real'));
});
test('unknown Ark POST survives gateway restart without replay',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-ark-unknown-'));let posts=0;
 const options={directory,protocol:'ark-native',baseUrl:'https://provider.example.test/api/v3',apiKey:'test-key-not-real',modelMap:map,fetchImpl:async()=>{posts++;throw Error('private upstream failure');}};let gateway=createGenerationGateway(options);
 t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 const {value:created}=await send(gateway,'/api/generation/tasks','POST',request);
 const unknown=await waitFor(gateway,created.id,['unknown']);assert.ok(!JSON.stringify(unknown).includes('private upstream failure'));
 await gateway.close();gateway=createGenerationGateway(options);await gateway.ready;
 assert.equal((await send(gateway,'/api/generation/tasks/by-key/ark-integration-operation')).value.status,'unknown');
 assert.equal((await send(gateway,'/api/generation/tasks','POST',request)).value.id,created.id);assert.equal(posts,1);
});

test('Ark gateway rejects explicitly unsupported options instead of substituting catalog defaults',async()=>{
 const gateway=createGenerationGateway({protocol:'ark-native',baseUrl:'https://provider.example.test/api/v3',apiKey:'test-key-not-real',modelMap:map,fetchImpl:()=>assert.fail('invalid options must not dispatch')});
 for(const patch of [{duration:31},{ratio:'invalid'},{quality:'invalid'},{videoMode:'INVALID'},{providerParameters:{model:'seedance-2.0',duration:31}},{providerParameters:{model:'seedance-2.0',extra:true}}]){
   const {value:created}=await send(gateway,'/api/generation/tasks','POST',{...request,parameters:{...request.parameters,...patch}});
   assert.equal((await waitFor(gateway,created.id,['failed'])).status,'failed');
 }
 await gateway.close();
});
