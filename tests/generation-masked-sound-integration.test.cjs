'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {encodeRGBA,decodePNG}=require('../server/generation-png-alpha.cjs');
const {REDRAW_PREFIX,FIRST_PREFIX}=require('../server/generation-openai-masked-edit.cjs');
const kinds=['image.erase','image.redraw','image.outpaint'],alias='gpt-image-2';
const keys={erase:'synthetic-mask-erase-key',redraw:'synthetic-mask-redraw-key',outpaint:'synthetic-mask-outpaint-key',sound:'synthetic-sound-key'};
const rgba=Buffer.from([250,10,20,255, 25,240,35,0, 40,55,230,128, 200,150,20,255]);
const main=encodeRGBA(2,2,rgba),reference=encodeRGBA(2,2,Buffer.from([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]));
const output=encodeRGBA(1024,1024,Buffer.alloc(1024*1024*4,255));
const mp3=require('node:fs').readFileSync(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3'));
const data=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const suffix='Add a red hat. Preserve this user text: The last image is the main image.';
function request(kind){return {kind,sourceNodeId:'main-source',prompt:kind==='image.redraw'?REDRAW_PREFIX+suffix:'Fill only the transparent region',inputs:[...(kind==='image.redraw'?[{type:'image',nodeId:'reference',url:data(reference)}]:[]),{type:'image',nodeId:'main-source',url:data(main)}],parameters:{model:alias,aspectRatio:'auto',imageSize:'1K',quality:'low',targetWidth:1024,targetHeight:1024,times:1,...(kind==='image.outpaint'?{canvas:{width:2,height:2,x:0,y:0}}:{})}};}
const sound={kind:'audio.generate',prompt:'A wooden door opening',inputs:[],parameters:{model:'eleven_sound_effect',scene:'Sound',virtualModel:'elevenlabs-v3'}};
function config(missing=false){const providers={},routes={};for(const kind of kinds){const id=kind.split('.')[1];providers[id]={protocol:'openai-masked-edit-native',apiKey:missing?'':keys[id],modelMap:{[alias]:{kind,model:alias,allowDynamicSize:true,qualityMap:{low:'low',medium:'medium',high:'high'}}}};routes[kind]={models:{[alias]:id}};}providers.sound={protocol:'elevenlabs-sound-native',apiKey:missing?'':keys.sound};routes['audio.generate']={models:{eleven_sound_effect:'sound'}};return {providers,routes};}
async function send(gateway,url,method='GET',input,key='native-integration'){
 let result;await gateway.handle({method,headers:{'idempotency-key':key}},{},url,{json:(_res,status,body)=>{result={status,body};},body:async()=>input});return result;
}
async function settle(gateway,id){for(let i=0;i<100;i++){const response=await send(gateway,'/api/generation/tasks/'+id);assert.equal(response.status,200);if(!['queued','running'].includes(response.body.status))return response.body;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('shared native integration did not settle');}
async function local(t,configuration,fetchImpl){const root=await fs.mkdtemp(path.join(os.tmpdir(),'masked-sound-integration-'));let gateway;async function open(next=configuration,transport=fetchImpl){gateway=createGenerationGateway({...next,directory:path.join(root,'tasks'),fetchImpl:transport});await gateway.ready;}await open();t.after(async()=>{await gateway.close();await fs.rm(root,{recursive:true,force:true});});return {root,get gateway(){return gateway;},async restart(next=configuration,transport=fetchImpl){await gateway.close();await open(next,transport);},async bytes(value){assert.match(value.url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);return fs.readFile(path.join(root,'tasks-media',value.url.split('/').at(-1)+'.bin'));}};}

test('shared registry routes the same masked model alias by operation and exposes key-only Sound defaults',async t=>{
 const ui=await import('../src/features/node-composer/provider-configuration.mjs'),router=createGenerationRouter({...config(),fetchImpl:()=>assert.fail('readiness must not dispatch')});assert.equal(router.configured,true);
 for(const kind of kinds){const r=request(kind);assert.equal(router.protocolFor(r),'openai-masked-edit-native');assert.equal(ui.providerConfigured(router.metadata,r),true);assert.equal(ui.selectedProviderId(router.metadata,r),kind.split('.')[1]);}
 assert.equal(router.protocolFor(sound),'elevenlabs-sound-native');assert.equal(ui.providerConfigured(router.metadata,sound),true);assert.equal(ui.providerConfigured(router.metadata,{...sound,parameters:{...sound.parameters,model:'music_v1'}}),false);
 const direct=createGenerationGateway({protocol:'elevenlabs-sound-native',apiKey:keys.sound,fetchImpl:()=>assert.fail('configuration must not dispatch')});t.after(()=>direct.close());const metadata=(await send(direct,'/api/generation/config')).body;assert.equal(ui.providerConfigured(metadata,sound),true);assert.equal(metadata.capabilities.sound.eleven_sound_effect.outputFormat,'mp3_44100_128');assert.equal(metadata.capabilities.remoteRecovery,false);
 for(const key of Object.values(keys))assert.ok(!JSON.stringify(router.metadata).includes(key));
});

test('actual SDK multipart reaches three exact masked routes, pairs main-first with alpha mask, and archives PNG without restart POST',async t=>{
 const calls=[],current=await local(t,config(),async(url,options)=>{
  assert.equal(String(url),'https://api.openai.com/v1/images/edits');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(new Headers(options.headers).get('accept-encoding'),'identity');assert.ok(options.body instanceof FormData);
  const form=options.body,images=form.getAll('image[]'),mask=form.get('mask'),authorization=new Headers(options.headers).get('authorization'),id=Object.entries(keys).find(([,key])=>authorization==='Bearer '+key)?.[0];assert.ok(['erase','redraw','outpaint'].includes(id));
  assert.equal(form.get('model'),alias);assert.equal(form.get('size'),'1024x1024');assert.equal(form.get('quality'),'low');assert.equal(form.get('n'),'1');assert.equal(form.get('stream'),'false');assert.equal(form.get('output_format'),'png');
  assert.equal(images.length,id==='redraw'?2:1);assert.equal(images[0].name,'main.png');assert.deepEqual(Buffer.from(await images[0].arrayBuffer()),main);assert.equal(mask.type,'image/png');const decoded=decodePNG(Buffer.from(await mask.arrayBuffer()));assert.deepEqual([decoded.width,decoded.height],[2,2]);assert.deepEqual(decoded.pixels,Buffer.from([0,0,0,255,0,0,0,0,0,0,0,255,0,0,0,255]));
  if(id==='redraw'){assert.deepEqual(Buffer.from(await images[1].arrayBuffer()),reference);assert.equal(form.get('prompt'),FIRST_PREFIX+suffix);}calls.push(id);return Response.json({created:1,data:[{b64_json:output.toString('base64')}]});
 });
 const completed=[];for(const kind of kinds){const key='masked-'+kind,created=(await send(current.gateway,'/api/generation/tasks','POST',request(kind),key)).body,done=await settle(current.gateway,created.id);assert.equal(done.status,'succeeded');assert.deepEqual(await current.bytes(done.outputs[0]),output);assert.deepEqual([done.outputs[0].width,done.outputs[0].height],[1024,1024]);completed.push({kind,key,created,done});}
 assert.deepEqual(calls,['erase','redraw','outpaint']);await current.restart(config(),()=>assert.fail('archived PNG must not trigger another provider call'));
 for(const {kind,key,created,done}of completed){const restored=(await send(current.gateway,'/api/generation/tasks/by-key/'+key)).body;assert.equal(restored.status,'succeeded');assert.deepEqual(restored.outputs,done.outputs);assert.deepEqual(await current.bytes(restored.outputs[0]),output);assert.equal((await send(current.gateway,'/api/generation/tasks','POST',request(kind),key)).body.id,created.id);}assert.equal(calls.length,3);
});

test('routed Sound uses native default parameters and archives actual MP3 for offline restart recovery',async t=>{
 let posts=0;const current=await local(t,config(),async(url,options)=>{posts++;assert.equal(String(url),'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(new Headers(options.headers).get('xi-api-key'),keys.sound);assert.deepEqual(JSON.parse(options.body),{text:sound.prompt,model_id:'eleven_text_to_sound_v2',loop:false,prompt_influence:.3});return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
 const created=(await send(current.gateway,'/api/generation/tasks','POST',sound,'sound-defaults')).body,done=await settle(current.gateway,created.id);assert.equal(done.status,'succeeded');assert.deepEqual(await current.bytes(done.outputs[0]),mp3);assert.equal(posts,1);await current.restart(config(),()=>assert.fail('saved synchronous MP3 must recover locally'));const restored=(await send(current.gateway,'/api/generation/tasks/by-key/sound-defaults')).body;assert.equal(restored.status,'succeeded');assert.deepEqual(restored.outputs,done.outputs);assert.equal((await send(current.gateway,'/api/generation/tasks','POST',sound,'sound-defaults')).body.id,created.id);assert.equal(posts,1);
});

test('missing keys across masked kinds and Sound stop before any SDK multipart or binary dispatch',async t=>{
 let calls=0;const current=await local(t,config(true),()=>{calls++;assert.fail('unconfigured native task must not dispatch');});assert.equal((await send(current.gateway,'/api/generation/config')).body.configured,false);
 for(const r of [...kinds.map(request),sound]){const created=(await send(current.gateway,'/api/generation/tasks','POST',r,'missing-'+r.kind)).body;assert.equal((await settle(current.gateway,created.id)).status,'configuration_required');}assert.equal(calls,0);
});

test('shared routed synchronous transport loss keeps original unknown receipts across restart without another POST',async t=>{
 let calls=0;const current=await local(t,config(),async()=>{calls++;throw Error('response lost after dispatch');});const receipts=[];
 for(const r of [request('image.redraw'),sound]){const key='lost-'+r.kind,created=(await send(current.gateway,'/api/generation/tasks','POST',r,key)).body,unknown=await settle(current.gateway,created.id);assert.equal(unknown.status,'unknown');assert.equal(unknown.outputs,undefined);assert.equal(unknown.recovery.pollable,false);receipts.push({r,key,created});}
 assert.equal(calls,2);await current.restart(config(),()=>assert.fail('unknown receipt must not be resubmitted or polled'));
 for(const {r,key,created}of receipts){assert.equal((await send(current.gateway,'/api/generation/tasks/by-key/'+key)).body.status,'unknown');assert.equal((await send(current.gateway,'/api/generation/tasks','POST',r,key)).body.id,created.id);}assert.equal(calls,2);
});
