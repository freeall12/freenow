'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createVideoExtendProvider,parseVideoExtendModelMap}=require('../server/generation-video-extend.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Readable}=require('node:stream');
const profile={ratios:['adaptive'],resolutions:['720p'],durations:Array.from({length:27},(_,index)=>index+4),audio:true,maxImages:4,maxVideos:4,maxAudios:2,videoDurationRange:{min:2,max:30,totalMax:30},audioDurationRange:{min:2,max:30,totalMax:30}};
const modelMap={'operator-extension':{kind:'video.extend',capabilityMode:'prompt_simulation',model:'operator-actual-seedance-model',resolution:'720p',generateAudio:true,profile}};
const source={type:'video',role:'source_video',url:'https://media.test/selected.mp4',nodeId:'source',duration:4,durationMs:4000,width:1280,height:720,sourceRange:{start:2,end:6}};
const request={kind:'video.extend',nodeId:'source',prompt:'小狐狸走进树林',inputs:[source],parameters:{modelId:'operator-extension',capabilityMode:'prompt_simulation',direction:'片尾延长',extendDirection:'forward',mode:'自然延续',duration:8,ratio:'自适应',sourceClip:null,referenceIds:[],subjects:[],candidateCount:1,resolution:'720p',generateAudio:true}};
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const provider=fetchImpl=>createVideoExtendProvider({baseUrl:'https://ark.test/api/v3',apiKey:'fake-test-key',modelMap,fetchImpl});
const clone=()=>structuredClone(request);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function store(){const data=new Map();return {data,readAll:async()=>[...data.values()].map(value=>structuredClone(value)),write:async job=>{data.set(job.id,structuredClone(job));return job;}};}

test('mapping explicitly selects prompt simulation and rejects native edit/extend or unsupported settings',()=>{
 const p=provider(()=>assert.fail());assert.equal(p.configured,true);assert.equal(p.metadata.protocol,'ark-video-extend-reference');
 assert.deepEqual(p.metadata.capabilities.kinds,['video.extend']);assert.equal(p.metadata.capabilities.videoExtend.capabilityMode,'prompt_simulation');assert.equal(p.metadata.capabilities.videoExtend.concatenatesSource,false);assert.equal(p.cancel,undefined);
 assert.ok(!JSON.stringify(p.metadata).includes('operator-actual-seedance-model'));
 const entry=modelMap['operator-extension'];
 for(const broken of [{...entry,capabilityMode:'native_extend'},{...entry,kind:'video.generate'},{...entry,arbitrary:true},{...entry,profile:{...profile,omniReferenceTaskType:'extend'}},{...entry,profile:{...profile,omniReferenceTaskType:'edit'}},{...entry,profile:{...profile,omniReferenceTaskType:'reference'}},{...entry,profile:{...profile,durations:[31]}},{...entry,profile:{...profile,ratios:['16:9']}}])assert.throws(()=>parseVideoExtendModelMap({alias:broken}),{code:'configuration_invalid'});
 assert.equal(createVideoExtendProvider({baseUrl:'https://ark.test/api/v3',apiKey:'fake',modelMap:{alias:{...entry,capabilityMode:'native'}}}).configured,false);
 assert.doesNotThrow(()=>parseVideoExtendModelMap({alias:{...entry,profile:{...profile,omniReferenceTaskType:'auto'}}}));
});

test('one real prepared source is submitted as reference generation with added duration and every continuity control in the prompt',async()=>{
 const bodies=[],p=provider(async(url,options)=>{assert.equal(url,'https://ark.test/api/v3/contents/generations/tasks');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');bodies.push(JSON.parse(options.body));return response({id:'accepted-task'});});
 for(const [direction,label]of [['forward','片尾延长'],['backward','片头延长']])for(const mode of ['自然延续','动作接续','延续运镜','推进场景']){
  const req=clone();Object.assign(req.parameters,{extendDirection:direction,direction:label,mode,duration:direction==='forward'?4:30});
  assert.deepEqual(await p.submit(req),{id:'accepted-task',status:'queued',progress:0});
  const body=bodies.at(-1),prompt=body.content[0].text;
  assert.equal(body.model,'operator-actual-seedance-model');assert.equal(body.ratio,'adaptive');assert.equal(body.resolution,'720p');assert.equal(body.duration,req.parameters.duration);assert.equal(body.generate_audio,true);assert.equal(body.omni_reference_task_type,undefined);
  assert.match(prompt,/这不是视频编辑任务/);assert.match(prompt,/剪辑片段 2–6（@video1）/);assert.ok(prompt.includes(`向${direction==='forward'?'后':'前'}延长${req.parameters.duration}秒`));assert.ok(prompt.includes(mode));assert.ok(prompt.includes(req.prompt));assert.match(prompt,/主体、场景、风格、动作、声音/);assert.match(prompt,/仅生成新增片段/);assert.match(prompt,/不要在结果中重复或拼接原片/);
  assert.deepEqual(body.content[1],{type:'video_url',video_url:{url:source.url},role:'reference_video'});assert.equal(req.inputs[0].role,'source_video');assert.equal(req.parameters.sourceClip,null);
 }
 assert.equal(bodies.length,8);
});

test('references and subject descriptions retain actual media, stable tokens and text in the submitted content',async()=>{
 let body;const p=provider(async(_url,options)=>{body=JSON.parse(options.body);return response({id:'accepted-task'});}),req=clone();
 req.prompt='{{Image 1}} 中的角色继续前进';req.inputs.push({type:'image',role:'reference',nodeId:'ref-image',url:'https://media.test/ref.png'},{...source,nodeId:'ref-video',role:'reference',url:'https://media.test/ref.mp4',sourceRange:{start:10,end:14}},{type:'image',role:'subject_reference',subjectId:'actor',url:'https://media.test/actor.png'},{type:'text',role:'subject_reference',subjectId:'actor',text:'蓝色雨衣'});
 req.parameters.referenceIds=['ref-image','ref-video'];req.parameters.subjects=[{id:'actor',name:'小狐狸',description:'红色尾巴，蓝色雨衣'}];
 await p.submit(req);assert.equal(body.content.length,5);assert.ok(body.content[0].text.includes('画布参考 ref-image：@image1'));assert.ok(body.content[0].text.includes('画布参考 ref-video：@video2'));assert.ok(body.content[0].text.includes('主体 小狐狸：红色尾巴，蓝色雨衣。素材：@image2'));assert.match(body.content[0].text,/@image1 中的角色/);assert.match(body.content[0].text,/蓝色雨衣/);
 assert.deepEqual(body.content.slice(1).map(item=>item[item.type].url),req.inputs.filter(input=>input.type!=='text').map(input=>input.url));
});

test('explicit inherited output resolution is preserved when the model profile supports it, without reverting to the default',async()=>{
 const map=structuredClone(modelMap);map['operator-extension'].profile.resolutions=['720p','1080p'];let body;
 const p=createVideoExtendProvider({baseUrl:'https://ark.test/api/v3',apiKey:'fake',modelMap:map,fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return response({id:'explicit-spec'});}}),req=clone();req.parameters.resolution='1080p';req.inputs[0].width=1920;req.inputs[0].height=1080;
 await p.submit(req);assert.equal(body.resolution,'1080p');assert.equal(p.metadata.capabilities.videoExtend.models['operator-extension'].resolution,'720p');
 req.parameters.resolution='4k';await assert.rejects(()=>p.submit(req),{code:'unsupported_generation'});
});

test('explicit inherited silent/audio settings override configured defaults only when the model supports audio control',async()=>{
 const bodies=[],p=provider(async(_url,options)=>{bodies.push(JSON.parse(options.body));return response({id:'explicit-audio'});}),req=clone();req.parameters.generateAudio=false;
 await p.submit(req);assert.equal(bodies[0].generate_audio,false);delete req.parameters.generateAudio;await p.submit(req);assert.equal(bodies[1].generate_audio,true);
 const map=structuredClone(modelMap);delete map['operator-extension'].generateAudio;map['operator-extension'].profile.audio=false;const unsupported=createVideoExtendProvider({baseUrl:'https://ark.test/api/v3',apiKey:'fake',modelMap:map,fetchImpl:()=>assert.fail()});req.parameters.generateAudio=false;await assert.rejects(()=>unsupported.submit(req),{code:'unsupported_generation'});
});

test('missing, contradictory, unprepared and unsupported inputs reject before a provider POST',async()=>{
 let calls=0;const p=provider(()=>{calls++;assert.fail();}),mutations=[
  req=>{req.parameters.capabilityMode='native_extend';},req=>{delete req.parameters.capabilityMode;},req=>{req.parameters.direction='片头延长';},req=>{req.parameters.duration=31;},req=>{req.parameters.duration=4.5;},req=>{req.parameters.mode='invented';},req=>{req.parameters.ratio='16:9';},req=>{req.parameters.candidateCount=2;},req=>{req.parameters.resolution='1080p';},req=>{req.parameters.generateAudio='false';},req=>{req.parameters.newSetting='ignored';},req=>{req.parameters.providerParameters={model:'other'};},req=>{req.parameters.providerParameters={model:'operator-extension',generateAudio:false};},req=>{req.parameters.sourceClip={start:2,end:6};},req=>{req.inputs[0].clip={start:2,end:6};},req=>{req.inputs[0].url='data:video/mp4;base64,AAAA';},req=>{req.inputs[0].url='/api/generation/media/local';},req=>{req.inputs[0].width=undefined;},req=>{req.inputs[0].durationMs=9000;},req=>{req.inputs[0].sourceRange={start:5,end:2};},req=>{req.inputs.push({...source});},req=>{req.inputs[0].role='reference';},req=>{req.parameters.referenceIds=['missing'];},req=>{req.parameters.subjects=[{id:'missing',name:'missing'}];},req=>{req.inputs.push({type:'image',role:'subject_reference',subjectId:'missing',url:'https://media.test/ref.png'});},req=>{req.parameters.apiKey='secret';},req=>{req.kind='video.generate';},req=>{req.references=['not-expanded'];}
 ];
 for(const change of mutations){const req=clone();change(req);await assert.rejects(()=>p.submit(req),error=>['unsupported_generation','configuration_required','credentials_forbidden'].includes(error.code)&&error.providerDispatched!==true);}
 assert.equal(calls,0);
});

test('operator model capability limits reject media or durations without changing the request',async()=>{
 const limited=structuredClone(modelMap);limited['operator-extension'].profile.durations=[4];limited['operator-extension'].profile.maxVideos=1;
 const p=createVideoExtendProvider({baseUrl:'https://ark.test/api/v3',apiKey:'fake',modelMap:limited,fetchImpl:()=>assert.fail()});assert.throws(()=>p.prepare(request),error=>error.code==='configuration_required'&&error.providerDispatched===false);
 const req=clone();req.parameters.duration=4;req.inputs.push({...source,nodeId:'ref',role:'reference'});req.parameters.referenceIds=['ref'];assert.throws(()=>p.prepare(req),error=>error.code==='unsupported_generation'&&error.providerDispatched===false);
 const whole=clone();whole.inputs[0].duration=10;whole.inputs[0].durationMs=10000;assert.throws(()=>provider(()=>assert.fail()).prepare(whole),/实际片段时长/);
});

test('query keeps original identity and exposes actual result without copying source or inventing output duration',async()=>{
 const urls=[],p=provider(async(url,options)=>{urls.push([url,options.method]);return response({id:'original-task',status:'succeeded',content:{video_url:'https://media.test/new-segment.mp4'},duration:30});});
 assert.deepEqual(await p.poll('original-task'),{id:'original-task',status:'succeeded',outputs:[{type:'video',url:'https://media.test/new-segment.mp4',sourceFileId:'original-task'}]});
 assert.deepEqual(urls,[['https://ark.test/api/v3/contents/generations/tasks/original-task','GET']]);
 await assert.rejects(()=>provider(async()=>response({id:'other-task',status:'succeeded',content:{video_url:'https://media.test/other.mp4'}})).poll('original-task'),{code:'unknown'});
});

test('unknown creation cannot re-POST on durable restart and timeout retains an accepted original task ID',async()=>{
 let calls=0;const disk=store(),p=provider(async()=>{calls++;return new Response('not-json');});let service=createDurableGenerationService({store:disk,provider:p}),job=await service.submit(request,{idempotencyKey:'extend-unknown-1'});await tick();await tick();job=await service.get(job.id);assert.equal(job.status,'unknown');await service.close();
 service=createDurableGenerationService({store:disk,provider:p});await service.ready;assert.equal((await service.lookup('extend-unknown-1')).status,'unknown');assert.equal((await service.submit(request,{idempotencyKey:'extend-unknown-1'})).id,job.id);assert.equal(calls,1);await service.close();
 const identities=[],methods=[],pending=provider(async(_url,options)=>{methods.push(options.method);return response(options.method==='POST'?{id:'accepted-original'}:{id:'accepted-original',status:'running'});});
 await assert.rejects(()=>pending.generate(request,{timeout:10,pollInterval:1,onTaskIdentity:id=>identities.push(id)}),{code:'unknown'});assert.deepEqual(identities,['accepted-original']);assert.equal(methods.filter(method=>method==='POST').length,1);
});

test('provider success remains private until the shared materializer saves result media',async()=>{
 const disk=store(),methods=[];let complete=false;
 const p=provider(async(_url,options)=>{methods.push(options.method);return response(options.method==='POST'?{id:'accepted-original'}:{id:'accepted-original',status:complete?'succeeded':'running',...complete?{content:{video_url:'https://media.test/new-segment.mp4'}}:{}});});
 let service=createDurableGenerationService({store:disk,provider:p}),job=await service.submit(request,{idempotencyKey:'extend-recovery-1'});await tick();await tick();assert.equal(disk.data.get(job.id).providerTaskId,'accepted-original');await service.close();
 complete=true;service=createDurableGenerationService({store:disk,provider:p});await service.ready;job=await service.lookup('extend-recovery-1');assert.equal(job.status,'unknown');assert.equal(job.providerStatus,'succeeded');assert.equal(job.outputs,undefined);assert.equal(job.providerResult.outputs[0].url,'https://media.test/new-segment.mp4');assert.equal(methods.filter(method=>method==='POST').length,1);await service.close();
});

test('unconfigured adapter never accesses source media or network',async()=>{
 const p=createVideoExtendProvider({baseUrl:'https://ark.test/api/v3',modelMap,fetchImpl:()=>assert.fail()});assert.equal(p.configured,false);await assert.rejects(()=>p.submit(request),{code:'configuration_required'});await assert.rejects(()=>p.poll('task-1'),{code:'configuration_required'});
});

test('recovery archives actual result MP4 bytes through the shared materializer and a second restart performs no provider or download call',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-extend-archive-')),taskStore=store(),methods=[];
 const mp4=await fs.readFile(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'));let complete=false,downloads=0,mediaStore,service;
 const p=provider(async(_url,options)=>{methods.push(options.method);return response(options.method==='POST'?{id:'archive-original'}:{id:'archive-original',status:complete?'succeeded':'running',...complete?{content:{video_url:'https://media.test/new-segment.mp4'}}:{}});});
 function open(){mediaStore=createGenerationMediaStore({directory});const materializer=createGenerationMediaMaterializer({store:mediaStore,download:async(url,{kind,onBytes})=>{assert.equal(url,'https://media.test/new-segment.mp4');assert.equal(kind,'video');downloads++;onBytes(mp4.length);return {stream:Readable.from([mp4]),mime:'video/mp4',maxBytes:mp4.length,expectedBytes:mp4.length};}});service=createDurableGenerationService({store:taskStore,provider:p,mediaMaterializer:materializer});}
 t.after(async()=>{await service?.close();await mediaStore?.close();await fs.rm(directory,{recursive:true,force:true});});
 open();let job=await service.submit(request,{idempotencyKey:'extend-archive-1'});await tick();await tick();await service.close();await mediaStore.close();
 complete=true;open();await service.ready;job=await service.lookup('extend-archive-1');assert.equal(job.status,'succeeded');assert.match(job.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);assert.equal(job.outputs[0].sourceFileId,'archive-original');assert.equal(job.outputs[0].duration,undefined);assert.equal(downloads,1);assert.equal(methods.filter(method=>method==='POST').length,1);
 assert.deepEqual(await fs.readFile(path.join(directory,job.outputs[0].url.split('/').at(-1)+'.bin')),mp4);
 const settled=structuredClone(job.outputs),before=methods.length;await service.close();await mediaStore.close();open();await service.ready;assert.deepEqual((await service.lookup('extend-archive-1')).outputs,settled);assert.equal(methods.length,before);assert.equal(downloads,1);
});
