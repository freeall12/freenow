'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMarbleProvider,parseMarbleModelMap}=require('../server/generation-marble.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const modes=['TEXT_TO_WORLD','IMAGE_TO_WORLD','PANORAMA_TO_WORLD','MULTI_IMAGE_TO_WORLD','VIDEO_TO_WORLD'];
const modelMap={'worldlabs-marble-1.1':{kind:'world.generate',model:'marble-1.1',displayModel:'Marble 1.1',modes},'worldlabs-marble-1.1-plus':{kind:'world.generate',model:'marble-1.1-plus',displayModel:'Marble 1.1 Plus',modes}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const accepted=()=>({operation_id:'op_original',done:false,error:null,response:null,metadata:{progress:{status:'IN_PROGRESS'}}});
const complete=()=>({operation_id:'op_original',done:true,error:null,metadata:{world_id:'world_original'},response:{world_id:'world_original',model:'marble-1.1',world_marble_url:'https://marble.worldlabs.ai/world/world_original',world_prompt:{type:'text'},assets:{thumbnail_url:'https://cdn.worldlabs.ai/preview.jpg',splats:{spz_urls:{'500k':'https://cdn.worldlabs.ai/world_500k.spz','100k':'https://cdn.worldlabs.ai/world_100k.spz',full_res:'https://cdn.worldlabs.ai/world.spz'},semantics_metadata:{metric_scale_factor:1.23,ground_plane_offset:-0.42}},mesh:{collider_mesh_url:'https://cdn.worldlabs.ai/collider.glb',full_res_mesh_url:'https://cdn.worldlabs.ai/mesh.glb',hq_mesh_url:null},imagery:{pano_url:'https://cdn.worldlabs.ai/pano.jpg'}}}});
const request=(mode='TEXT_TO_WORLD',inputs=[],marbleParams={})=>({kind:'world.generate',prompt:'a sunlit courtyard',inputs,parameters:{model:'worldlabs-marble-1.1',provider:'worldlabs',modelType:mode,outputType:'world',representation:'gaussianSplat',isPano:mode==='PANORAMA_TO_WORLD',count:1,marbleParams}});
const provider=fetchImpl=>createMarbleProvider({apiKey:'test-key',modelMap,fetchImpl});
const image=url=>({type:'image',url});
const upload=(kind='image',extension='png')=>({media_asset:{media_asset_id:'media_original',kind,extension},upload_info:{upload_url:'https://storage.googleapis.com/world/upload?signature=redacted',upload_method:'PUT',required_headers:{'Content-Type':kind==='image'?'image/'+extension:'video/'+extension,'x-goog-meta-example':'safe'}}});

test('configuration requires exact model labels and explicit modes; missing keys never dispatch',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return response(accepted());};
 for(const config of [{},{apiKey:'test-key'},{modelMap}]){const p=createMarbleProvider({...config,fetchImpl});assert.equal(p.configured,false);await assert.rejects(()=>p.submit(request()),{code:'configuration_required'});}
 for(const baseUrl of ['http://api.worldlabs.ai/marble/v1','https://private.test/marble/v1','https://api.worldlabs.ai','https://user:secret@api.worldlabs.ai/marble/v1','https://api.worldlabs.ai/marble/v1?'])assert.equal(createMarbleProvider({baseUrl,apiKey:'test-key',modelMap}).configured,false);
 for(const changes of [{model:'Marble 1.1-plus'},{displayModel:'Marble'},{modes:[]},{modes:['INPAINT_TO_WORLD']},{modes:['TEXT_TO_WORLD','TEXT_TO_WORLD']},{extra:true}])assert.throws(()=>parseMarbleModelMap({alias:{...modelMap['worldlabs-marble-1.1'],...changes}}));
 assert.equal(calls,0);const p=provider(fetchImpl);assert.equal(p.metadata.protocol,'marble-native');assert.equal(p.metadata.capabilities.remoteCancellation,false);assert.equal(p.cancel,undefined);assert.ok(!JSON.stringify(p.metadata).includes('test-key'));
});
test('text maps explicit model; pure prepare makes no calls and does not forward presentation fields',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return response(accepted());});const r=request();r.parameters.layout='auto';p.prepare(r);assert.equal(calls.length,0);await p.submit(r);
 assert.equal(calls[0].url,'https://api.worldlabs.ai/marble/v1/worlds:generate');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers['WLT-Api-Key'],'test-key');assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.deepEqual(JSON.parse(calls[0].options.body),{model:'marble-1.1',world_prompt:{type:'text',text_prompt:'a sunlit courtyard'}});
 const plus=request('TEXT_TO_WORLD',[],{disable_recaption:true});plus.parameters.model='worldlabs-marble-1.1-plus';await p.submit(plus);assert.equal(JSON.parse(calls[1].options.body).model,'marble-1.1-plus');assert.equal(JSON.parse(calls[1].options.body).world_prompt.disable_recaption,true);
});
test('image and pano preserve explicit boolean/auto treatment and optional text without uploading HTTPS',async()=>{
 for(const isPano of [false,true,'auto']){
  const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return response(accepted());});const r=request(isPano===true?'PANORAMA_TO_WORLD':'IMAGE_TO_WORLD',[image('https://public.test/photo.webp')],{disable_recaption:true,seed:42,display_name:'Courtyard'});r.parameters.isPano=isPano;await p.submit(r);
  assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].options.body),{model:'marble-1.1',seed:42,display_name:'Courtyard',world_prompt:{type:'image',text_prompt:r.prompt,disable_recaption:true,is_pano:isPano,image_prompt:{source:'uri',uri:'https://public.test/photo.webp'}}});
 }
});
test('multi-image default four and explicit reconstruction eight; azimuth order is exact',async()=>{
 const calls=[],p=provider(async(_url,options)=>{calls.push(JSON.parse(options.body));return response(accepted());});const inputs=[image('https://public.test/front.png'),image('https://public.test/back.png')];await p.submit(request('MULTI_IMAGE_TO_WORLD',inputs,{azimuths:[0,180]}));
 assert.deepEqual(calls[0].world_prompt.multi_image_prompt,[{content:{source:'uri',uri:inputs[0].url},azimuth:0},{content:{source:'uri',uri:inputs[1].url},azimuth:180}]);assert.equal(calls[0].world_prompt.reconstruct_images,false);
 const many=Array.from({length:8},()=>image('https://public.test/photo.png'));await assert.rejects(()=>p.submit(request('MULTI_IMAGE_TO_WORLD',many)),/reconstruct_images/);assert.equal(calls.length,1);await p.submit(request('MULTI_IMAGE_TO_WORLD',many,{reconstruct_images:true}));assert.equal(calls[1].world_prompt.multi_image_prompt.length,8);
});
test('signed local upload PUT forwards only returned storage headers; generation references original asset',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return url.includes('prepare_upload')?response(upload()):options.method==='PUT'?new Response(null,{status:200}):response(accepted());});const r=request('IMAGE_TO_WORLD',[image(png)]);p.prepare(r);assert.equal(calls.length,0);await p.submit(r);assert.equal(calls.length,3);
 assert.deepEqual(JSON.parse(calls[0].options.body),{file_name:'reference-1.png',kind:'image',extension:'png'});assert.equal(calls[1].options.method,'PUT');assert.equal(calls[1].options.headers['WLT-Api-Key'],undefined);assert.equal(calls[1].options.headers.Authorization,undefined);assert.equal(calls[1].options.redirect,'error');assert.deepEqual(calls[1].options.body,Buffer.from(png.split(',')[1],'base64'));
 assert.deepEqual(JSON.parse(calls[2].options.body).world_prompt.image_prompt,{source:'media_asset',media_asset_id:'media_original'});
});
test('local MP4 upload and public video map video_prompt; unmaterialized clips reject before upload',async()=>{
 const bytes=Buffer.alloc(20);bytes.writeUInt32BE(20);bytes.write('ftyp',4);bytes.write('isom',8);const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return url.includes('prepare_upload')?response(upload('video','mp4')):options.method==='PUT'?new Response(null):response(accepted());});
 const r=request('VIDEO_TO_WORLD',[{type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64')}]);await p.submit(r);assert.deepEqual(JSON.parse(calls[2].options.body).world_prompt.video_prompt,{source:'media_asset',media_asset_id:'media_original'});
 await p.submit(request('VIDEO_TO_WORLD',[{type:'video',url:'https://public.test/clip.mp4',sourceRange:{start:1,end:3}}]));assert.equal(JSON.parse(calls[3].options.body).world_prompt.video_prompt.uri,'https://public.test/clip.mp4');
 await assert.rejects(()=>p.submit(request('VIDEO_TO_WORLD',[{type:'video',url:'https://public.test/clip.mp4',clip:{start:1,end:3}}])),/裁切/);assert.equal(calls.length,4);
});
test('unsupported combinations/options reject without any upload or model dispatch',async()=>{
 let calls=0;const p=provider(async()=>{calls++;return response(accepted());});const invalid=[request('TEXT_TO_WORLD',[image(png)]),request('IMAGE_TO_WORLD',[]),request('MULTI_IMAGE_TO_WORLD',[image(png),{type:'video',url:'https://public.test/a.mp4'}]),request('VIDEO_TO_WORLD',[{type:'audio',url:'https://public.test/a.mp3'}]),request('MULTI_IMAGE_TO_WORLD',[image(png),image(png)],{azimuths:[360,0]}),request('TEXT_TO_WORLD',[],{reconstruct_images:false}),request('TEXT_TO_WORLD',[],{disable_recaption:'false'}),request('IMAGE_TO_WORLD',[image(png)],{texture:true})];
 for(const [key,value]of [['count',2],['provider','tripo'],['representation','mesh'],['outputType','asset'],['isPano',true],['modelType','DEPTH_TO_WORLD'],['tripoParams',{}],['providerParameters',{unknown:true}]])invalid.push({...request(),parameters:{...request().parameters,[key]:value}});
 invalid.push({...request(),prompt:''},{...request(),references:[image(png)]},{...request(),parameters:{...request().parameters,apiKey:'private'}});
 for(const r of invalid)await assert.rejects(()=>p.submit(r));assert.equal(calls,0);
 const limited=structuredClone(modelMap);limited['worldlabs-marble-1.1'].modes=['TEXT_TO_WORLD'];await assert.rejects(()=>createMarbleProvider({apiKey:'test-key',modelMap:limited,fetchImpl:()=>assert.fail()}).submit(request('IMAGE_TO_WORLD',[image(png)])));
});
test('bad local bytes, local URLs and credential-bearing remote URLs never dispatch',async()=>{
 let calls=0;const p=provider(async()=>{calls++;return response(accepted());});for(const url of ['asset:local','blob:local','http://public.test/a.png','https://127.0.0.1/a.png','https://0x7f000001/a.png','https://user:secret@public.test/a.png','data:image/png;base64,bm90LWltYWdl'])await assert.rejects(()=>p.submit(request('IMAGE_TO_WORLD',[image(url)])));
 await assert.rejects(()=>p.submit(request('VIDEO_TO_WORLD',[{type:'video',url:'data:video/mp4;base64,bm90LXZpZGVv'}])));assert.equal(calls,0);
});
test('lost or malformed upload does not create billable world or replay upload',async()=>{
 const values=[null,{...upload(),media_asset:{...upload().media_asset,kind:'video'}},{...upload(),upload_info:{...upload().upload_info,upload_method:'POST'}},{...upload(),upload_info:{...upload().upload_info,upload_url:'https://127.0.0.1/upload'}},{...upload(),upload_info:{...upload().upload_info,required_headers:{Authorization:'private'}}}];
 for(const value of values){const calls=[],p=provider(async(url)=>{calls.push(url);if(value===null)throw Error('private details');return response(value);});await assert.rejects(()=>p.submit(request('IMAGE_TO_WORLD',[image(png)])),{code:'unknown'});assert.deepEqual(calls,['https://api.worldlabs.ai/marble/v1/media-assets:prepare_upload']);}
 const calls=[],p=provider(async(url,options)=>{calls.push(options.method);if(options.method==='PUT')throw Error('lost upload');return response(upload());});await assert.rejects(()=>p.submit(request('IMAGE_TO_WORLD',[image(png)])),{code:'unknown'});assert.deepEqual(calls,['POST','PUT']);
});
test('original operation survives provider recreation and key rotation, only polling GET original identity',async()=>{
 const calls=[],fetchImpl=async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?accepted():complete());};const first=provider(fetchImpl),task=await first.submit(request()),restarted=createMarbleProvider({apiKey:'rotated',modelMap,fetchImpl});const result=await restarted.poll(task.id),out=result.outputs[0];
 assert.equal(first.fingerprint,restarted.fingerprint);assert.equal(result.status,'succeeded');assert.equal(out.type,'model');assert.equal(out.format,'spz');assert.equal(out.representation,'gaussianSplat');assert.equal(out.sourceFileId,'world_original');assert.equal(out.url,complete().response.assets.splats.spz_urls['500k']);assert.deepEqual(out.world.assets.splats.semanticsMetadata,{metricScaleFactor:1.23,groundPlaneOffset:-0.42});assert.equal(out.world.coordinateSystem,'marble_raw_opencv');assert.equal(out.world.assets.mesh.colliderMeshUrl,'https://cdn.worldlabs.ai/collider.glb');assert.equal(out.world.assets.mesh.hqMeshUrl,undefined);assert.equal(out.world.assets.imagery.panoUrl,'https://cdn.worldlabs.ai/pano.jpg');
 assert.deepEqual(calls,[{url:'https://api.worldlabs.ai/marble/v1/worlds:generate',method:'POST'},{url:'https://api.worldlabs.ai/marble/v1/operations/op_original',method:'GET'}]);
 const changed=structuredClone(modelMap);changed['worldlabs-marble-1.1'].modes=['IMAGE_TO_WORLD'];await assert.rejects(()=>createMarbleProvider({apiKey:'test-key',modelMap:changed,fetchImpl:()=>assert.fail()}).poll(task.id),{code:'provider_configuration_changed'});await assert.rejects(()=>first.poll('mb1.bad'),{code:'provider_identity_mismatch'});
});
test('explicit SPZ resolution is persisted in original identity; no unavailable LOD fallback',async()=>{
 const p=provider(async(_url,options)=>response(options.method==='POST'?accepted():complete()));const task=await p.submit(request('TEXT_TO_WORLD',[],{splatResolution:'full_res'}));assert.equal((await p.poll(task.id)).outputs[0].url,'https://cdn.worldlabs.ai/world.spz');
 const absent=await p.submit(request('TEXT_TO_WORLD',[],{splatResolution:'150k'}));await assert.rejects(()=>p.poll(absent.id),{code:'unknown'});
});
test('documented incomplete operation snapshot hydrates only original world via GET and confirms exact model',async()=>{
 const snapshot=complete();snapshot.response.id=snapshot.response.world_id;delete snapshot.response.world_id;snapshot.response.model=null;snapshot.response.world_prompt=null;
 const calls=[],p=provider(async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?accepted():url.includes('/operations/')?snapshot:complete().response);});const task=await p.submit(request()),out=(await p.poll(task.id)).outputs[0];assert.equal(out.sourceFileId,'world_original');assert.equal(out.world.model,'marble-1.1');
 assert.deepEqual(calls.map(call=>call.method),['POST','GET','GET']);assert.equal(calls[2].url,'https://api.worldlabs.ai/marble/v1/worlds/world_original');
 for(const wrong of [{...complete().response,world_id:'world_other'},{...complete().response,model:'marble-1.0'},{...complete().response,model:null},{world:complete().response}]){
  const p=provider(async(url,options)=>response(options.method==='POST'?accepted():url.includes('/operations/')?snapshot:wrong)),task=await p.submit(request());await assert.rejects(()=>p.poll(task.id),{code:'provider_identity_mismatch'});
 }
 const contradictory=complete();contradictory.response.id='world_other';contradictory.response.model=null;let gets=0;const blocked=provider(async(_url,options)=>{if(options.method==='GET')gets++;return response(options.method==='POST'?accepted():contradictory);}),original=await blocked.submit(request());await assert.rejects(()=>blocked.poll(original.id),{code:'provider_identity_mismatch'});assert.equal(gets,1);
});
test('GLB proxy, missing metric scale, wrong world model and mismatched world identity cannot claim success',async()=>{
 const edits=[value=>{value.operation_id='op_other';},value=>{value.response.model='marble-1.0';},value=>{value.metadata.world_id='world_other';},value=>{delete value.response.assets.splats;},value=>{value.response.assets.splats.spz_urls['500k']='https://cdn.worldlabs.ai/proxy.glb';},value=>{value.response.assets.splats.semantics_metadata.metric_scale_factor=0;},value=>{delete value.response.assets.splats.semantics_metadata;},value=>{value.response.assets.mesh.collider_mesh_url='https://user:secret@cdn.worldlabs.ai/collider.glb';},value=>{value.done=false;},value=>{value.response.world_prompt.type='video';}];
 for(const edit of edits){const value=complete();edit(value);let posts=0;const p=provider(async(_url,options)=>{if(options.method==='POST'){posts++;return response(accepted());}return response(value);});const task=await p.submit(request());await assert.rejects(()=>p.poll(task.id));assert.equal(posts,1);}
});
test('documented structured progress does not invent percentages; confirmed failures redact supplier text',async()=>{
 for(const value of [{...accepted(),metadata:{progress:{status:'IN_PROGRESS',description:'private description'}}},{...accepted(),done:true,error:{code:'BAD_REQUEST',message:'private key'},response:null}]){const p=provider(async(_url,options)=>response(options.method==='POST'?accepted():value)),task=await p.submit(request()),result=await p.poll(task.id);assert.ok(!JSON.stringify(result).includes('private'));assert.equal(result.outputs,undefined);assert.equal(result.progress,undefined);assert.equal(result.status,value.done?'failed':'running');}
});
test('generate uses one task; unknown POST, timeout, abort and oversized responses never replay',async()=>{
 let posts=0,gets=0;const ids=[],progress=[],p=provider(async(_url,options)=>{if(options.method==='POST'){posts++;return response(accepted());}return response(++gets===1?accepted():complete());});const value=await p.generate(request(),{pollInterval:1,onTaskIdentity:id=>ids.push(id),onProgress:value=>progress.push(value)});assert.equal(posts,1);assert.equal(gets,2);assert.deepEqual(ids,[value.id]);assert.deepEqual(progress,[0]);
 let attempts=0;await assert.rejects(()=>provider(async()=>{attempts++;throw Error('test-key private');}).submit(request()),error=>error.code==='unknown'&&!error.message.includes('test-key'));assert.equal(attempts,1);
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{})}))]){const p=provider(fetchImpl),controller=new AbortController(),reason=Error('cancelled');const running=p.submit(request(),{signal:controller.signal});setTimeout(()=>controller.abort(reason),5);await assert.rejects(()=>running,error=>error===reason);}
 for(const fetchImpl of [async()=>new Response('{}',{headers:{'content-length':String(1024*1024+1)}}),async()=>new Response('x'.repeat(1024*1024+1))])await assert.rejects(()=>provider(fetchImpl).submit(request()),{code:'unknown'});
 await assert.rejects(()=>provider(()=>new Promise(()=>{})).generate(request(),{timeout:5,pollInterval:1}),{code:'unknown'});
});
