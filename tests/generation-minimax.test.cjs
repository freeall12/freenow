'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMiniMaxProvider,parseMiniMaxModelMap}=require('../server/generation-minimax.cjs');
const common={resolutions:['768P','2K'],durations:Array.from({length:12},(_,i)=>i+4)};
const entry={kind:'video.generate',model:'MiniMax-H3',modes:{TEXT_TO_VIDEO:{...common,ratios:['16:9','9:16','1:1']},IMAGE_TO_VIDEO:{...common,ratios:['adaptive']},START_END_TO_VIDEO:{...common,ratios:['adaptive']},REFERENCE_TO_VIDEO:{...common,ratios:['16:9','adaptive'],maxImages:9,maxVideos:3,maxAudios:3,maxMedia:12,videoDurationRange:{min:2,max:15,totalMax:15},audioDurationRange:{min:2,max:15,totalMax:15}}}};
const map={'MiniMax-H3':entry};
const request={kind:'video.generate',prompt:'森林里的狐狸',inputs:[],parameters:{modelId:'MiniMax-H3',model:'MiniMax H3',count:1,ratio:'16:9',quality:'2K',duration:5,videoMode:'TEXT_TO_VIDEO',providerParameters:{model:'MiniMax-H3',modelType:'TEXT_TO_VIDEO',aspectRatio:'16:9',resolution:'2K',duration:5,times:1}}};
const response=value=>new Response(JSON.stringify(value));
const provider=fetchImpl=>createMiniMaxProvider({baseUrl:'https://minimax.test',apiKey:'private-key',modelMap:map,fetchImpl});
const change=(patch={},inputs=request.inputs)=>({...request,inputs,parameters:{...request.parameters,...patch,providerParameters:{...request.parameters.providerParameters,...patch.providerParameters}}});
const image={type:'image',url:'https://media.test/image.png'};
const video={type:'video',url:'https://media.test/video.mp4',duration:5};
const audio={type:'audio',url:'https://media.test/audio.mp3',duration:2};
const reference=(inputs,patch={})=>change({videoMode:'REFERENCE_TO_VIDEO',...patch,providerParameters:{modelType:'REFERENCE_TO_VIDEO',...patch.providerParameters}},inputs);
const frames=inputs=>change({videoMode:'START_END_TO_VIDEO',ratio:undefined,providerParameters:{modelType:'START_END_TO_VIDEO',aspectRatio:undefined}},inputs);
function png(width=300,height=300){const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=','base64');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return 'data:image/png;base64,'+bytes.toString('base64');}
function container(mime='video/mp4'){return 'data:'+mime+';base64,'+Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]).toString('base64');}
test('MiniMax configuration is explicit, validated and metadata contains no secrets or origin',()=>{
 for(const modelMap of ['bad','[]',{}, {a:{kind:'video.generate',model:'MiniMax-H3'}},{a:{...entry,model:'Hailuo-02'}},{a:{...entry,modes:{TEXT_TO_VIDEO:{...common,ratios:['adaptive']}}}},{a:{...entry,modes:{IMAGE_TO_VIDEO:{...common,ratios:['16:9']}}}},{a:{...entry,modes:{TEXT_TO_VIDEO:{...common,ratios:['16:9'],audio:true}}}}])assert.equal(createMiniMaxProvider({baseUrl:'https://minimax.test',apiKey:'private-key',modelMap}).configured,false);
 for(const baseUrl of ['http://minimax.test','https://u:p@minimax.test','https://minimax.test/v2','https://minimax.test?key=secret'])assert.equal(createMiniMaxProvider({baseUrl,apiKey:'private-key',modelMap:map}).configured,false);
 const p=provider(()=>assert.fail());assert.equal(p.configured,true);assert.equal(p.metadata.protocol,'minimax-native');assert.deepEqual(p.metadata.capabilities.models,{'MiniMax-H3':{kind:'video.generate'}});assert.equal(p.cancel,undefined);assert.equal(p.metadata.capabilities.remoteCancellation,false);assert.ok(!JSON.stringify(p.metadata).includes('private-key'));assert.ok(!JSON.stringify(p.metadata).includes('https://minimax.test'));
 const custom=createMiniMaxProvider({baseUrl:'https://minimax.test',apiKey:'private-key',modelMap:{publicAlias:entry}});assert.ok(!JSON.stringify(custom.metadata).includes('MiniMax-H3'));
 assert.equal(createMiniMaxProvider({baseUrl:'https://minimax.test',modelMap:map}).configured,false);
 assert.notEqual(p.fingerprint,createMiniMaxProvider({baseUrl:'https://different.test',apiKey:'private-key',modelMap:map}).fingerprint);
});
test('UI contract submits exactly one official V2 task and preserves task_id',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return response({task_id:'h3-task-1'});});
 assert.deepEqual(await p.submit(request),{id:'h3-task-1',status:'queued',progress:0});assert.equal(calls.length,1);assert.equal(calls[0].url,'https://minimax.test/v2/video_generation');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Bearer private-key');
 assert.deepEqual(JSON.parse(calls[0].options.body),{model:'MiniMax-H3',content:[{type:'text',text:request.prompt}],resolution:'2K',duration:5,ratio:'16:9'});
 assert.equal(p.prepare(request),request);
});
test('frames preserve source order and explicit last-only role without inferred ratio',async()=>{
 const bodies=[],p=provider(async(_url,options)=>{bodies.push(JSON.parse(options.body));return response({task_id:'frames'});});
 await p.submit(frames([image,{...image,url:'https://media.test/end.png'}]));assert.deepEqual(bodies[0].content.slice(1).map(item=>item.role),['first_frame','last_frame']);assert.equal(bodies[0].ratio,undefined);
 await p.submit(frames([{...image,role:'last_frame'}]));assert.equal(bodies[1].content[1].role,'last_frame');
 assert.throws(()=>p.prepare(frames([{...image,role:'last_frame'},{...image,role:'last_frame'}])));
 assert.throws(()=>p.prepare(frames([image,{...image,role:'reference_image'}])));
 assert.throws(()=>p.prepare(change({ratio:'16:9',videoMode:'IMAGE_TO_VIDEO',providerParameters:{modelType:'IMAGE_TO_VIDEO'}},[image])));
});
test('multimodal reference binding uses official roles and natural reference mentions',async()=>{
 let body;const p=provider(async(_url,options)=>{body=JSON.parse(options.body);return response({task_id:'refs'});}),req=reference([image,video,audio,{type:'text',text:'黄昏时'}]);req.prompt='{{Image 1}}角色，{{Video 1}}运镜，{{Audio 1}}音色';
 await p.submit(req);assert.equal(body.content[0].text,'黄昏时\nreference image 1角色，reference video 1运镜，reference audio 1音色');assert.deepEqual(body.content.slice(1).map(item=>item.role),['reference_image','reference_video','reference_audio']);
 assert.throws(()=>p.prepare({...req,prompt:'{{Image 2}}'}));assert.throws(()=>p.prepare(reference([])));
 // The native API allows audio-only reference; operators can narrow their map.
 assert.doesNotThrow(()=>p.prepare(reference([audio])));
});
test('direct inline PNG/MP4/MP3 is preserved and MPEG MIME canonicalized without upload',async()=>{
 let body;const p=provider(async(url,options)=>{assert.equal(url,'https://minimax.test/v2/video_generation');body=JSON.parse(options.body);return response({task_id:'inline'});});
 const inputs=[{type:'image',url:png()},{...video,url:container()},{...audio,url:'data:audio/mpeg;base64,'+Buffer.from('ID3sample-audio').toString('base64')}];
 await p.submit(reference(inputs));assert.equal(body.content[1].image_url.url,inputs[0].url);assert.equal(body.content[2].video_url.url,inputs[1].url);assert.match(body.content[3].audio_url.url,/^data:audio\/mp3;base64,/);
 await p.submit(reference([{...image,url:'mm_file://424010985738629'}]));assert.equal(body.content[1].image_url.url,'mm_file://424010985738629');
});
test('MOV uploads through official purpose then generation refers to exact mm_file receipt',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});if(calls.length===1)return response({file:{file_id:'424010985738629'},base_resp:{status_code:0}});return response({task_id:'mov-task'});});
 await p.submit(reference([{...video,url:container('video/quicktime')}]));assert.equal(calls.length,2);assert.equal(calls[0].url,'https://minimax.test/v1/files/upload');assert.equal(calls[0].options.body.get('purpose'),'video_generation_input');assert.equal(calls[0].options.body.get('file').name,'reference-1.mov');assert.equal(calls[0].options.headers['Content-Type'],undefined);assert.equal(JSON.parse(calls[1].options.body).content[1].video_url.url,'mm_file://424010985738629');
});
test('unknown upload outcome or unsafe int64 prevents create and is never retried',async()=>{
 for(const payload of [{file:{file_id:9007199254740992},base_resp:{status_code:0}},{file:{file_id:'123'},base_resp:{status_code:1004}}]){let calls=0;const p=provider(async()=>{calls++;return response(payload);});await assert.rejects(()=>p.submit(reference([{...video,url:container('video/quicktime')}])),{code:'unknown'});assert.equal(calls,1);}
});
test('invalid or ignored parameters are rejected before any HTTP',async()=>{
 const p=provider(()=>assert.fail('should not submit'));
 for(const patch of [{count:2},{duration:3},{quality:'480P'},{audio:false},{generateAudio:true},{providerParameters:{generateAudio:false}},{draft:true},{draftVideoId:'x'},{generateMode:'pro'},{camera:'Other'},{thinking:'max'},{variant:'arbitrary'},{providerParameters:{seed:1}},{modelId:'other'},{batch_count:2},{canvasResults:{targetNodeIds:['one','two']}},{extra:{prompt_expansion_mode:'quality'}}])assert.throws(()=>p.prepare(change(patch)));
 for(const inputs of [[{...image,url:'http://media.test/image.png'}],[{...image,url:'https://127.0.0.1/a.png'}],[{...image,url:'https://u:key@media.test/a.png'}],[{...image,url:'data:image/png;base64,YmFk'}],[{...image,url:png(100,300)}],[{...video,clip:{start:1,end:4}}],[{...video,trim:{start:1,end:4}}],[{...video,duration:undefined}],[{...audio,duration:1}],[{...video,fps:90}]])assert.throws(()=>p.prepare(reference(inputs)));
 await assert.rejects(()=>p.poll('..'),{code:'provider_identity_mismatch'});
});
test('native reference aggregate count and duration budgets never truncate or remap inputs',()=>{
 const p=provider(()=>assert.fail());assert.throws(()=>p.prepare(reference(Array.from({length:10},()=>image))));
 assert.throws(()=>p.prepare(reference([...Array.from({length:9},()=>image),...Array.from({length:2},()=>({...video,duration:5})),...Array.from({length:2},()=>audio)])));
 assert.throws(()=>p.prepare(reference([{...video,duration:8},{...video,duration:8}])));
 assert.throws(()=>p.prepare({...request,prompt:'x'.repeat(7001)}));assert.throws(()=>p.prepare({...request,prompt:''}));
 const restricted={...entry,mediaTransport:{image:[]}};const pp=createMiniMaxProvider({baseUrl:'https://minimax.test',apiKey:'key',modelMap:{'MiniMax-H3':restricted}});assert.throws(()=>pp.prepare(reference([{...image,url:png()}])));
});
test('H3 Max remains distinct and only accepts its official output specs and extra enum',async()=>{
 const maxCommon={resolutions:['480P','768P'],durations:[5,6,7,8,9,10,11,12,13,14,15]},maxEntry={...entry,model:'MiniMax-H3-Max',modes:{TEXT_TO_VIDEO:{...maxCommon,ratios:['16:9']}}};
 assert.throws(()=>parseMiniMaxModelMap({max:{...maxEntry,modes:{TEXT_TO_VIDEO:{...common,ratios:['16:9']}}}}));
 let body;const p=createMiniMaxProvider({baseUrl:'https://minimax.test',apiKey:'key',modelMap:{'MiniMax-H3-Max':maxEntry},fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return response({task_id:'max'});}}),req=change({model:'MiniMax H3 Max',modelId:'MiniMax-H3-Max',quality:'768P',providerParameters:{model:'MiniMax-H3-Max',resolution:'768P',extra:{prompt_expansion_mode:'quality'}}});
 await p.submit(req);assert.equal(body.model,'MiniMax-H3-Max');assert.deepEqual(body.extra,{prompt_expansion_mode:'quality'});
 assert.throws(()=>p.prepare({...req,parameters:{...req.parameters,providerParameters:{...req.parameters.providerParameters,extra:{prompt_expansion_mode:'balance'}}}}));
});
test('query preserves original task and accepts success output only after official confirmation',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return response({task:{id:'accepted',model:'MiniMax-H3',status:'succeeded',task_type:'generation',modality:'video',content:{url:'https://cdn.test/output.mp4'}}});});
 assert.deepEqual(await p.poll('accepted'),{id:'accepted',status:'succeeded',outputs:[{type:'video',url:'https://cdn.test/output.mp4',sourceFileId:'accepted'}]});assert.equal(calls[0].url,'https://minimax.test/v2/query/video_generation/accepted');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.body,undefined);
});
test('query rejects identity/status/modality drift and missing or contradictory outputs',async()=>{
 for(const task of [{id:'wrong',status:'succeeded',content:{url:'https://cdn.test/x.mp4'}},{id:'accepted',status:'Success'},{id:'accepted',status:'running',content:{url:'https://cdn.test/x.mp4'}},{id:'accepted',status:'succeeded',content:{}},{id:'accepted',status:'succeeded',modality:'text',content:{url:'https://cdn.test/x.mp4'}},{id:'accepted',status:'queued',task_type:'h3_context_ir'},{id:'accepted',status:'queued',model:'Hailuo-02'}])await assert.rejects(()=>provider(async()=>response({task})).poll('accepted'),{code:'unknown'});
 for(const status of ['queued','running','failed','cancelled'])assert.equal((await provider(async()=>response({task:{id:'accepted',status}})).poll('accepted')).status,status);
});
test('create network/HTTP/body failures are unknown and never retried',async()=>{
 for(const reply of [()=>{throw Error('secret');},()=>new Response('oops',{status:500}),()=>new Response('{bad'),()=>response({task_id:2}),()=>new Response('x'.repeat(1024*1024+1)),()=>new Response('{}',{headers:{'content-length':String(1024*1024+1)}})]){let calls=0;const p=provider(async()=>{calls++;return reply();});await assert.rejects(()=>p.submit(request),{code:'unknown'});assert.equal(calls,1);}
});
test('abort bounds fetch/body wait even when transport ignores signal',async()=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}))]){
  const controller=new AbortController(),reason=Error('local abort');const pending=provider(fetchImpl).submit(request,{signal:controller.signal});setTimeout(()=>controller.abort(reason),5);await assert.rejects(pending,error=>error===reason);
 }
});
test('generate persists accepted identity before polling and resumes only original GET',async()=>{
 const calls=[],identities=[],p=provider(async(url,options)=>{calls.push({url,options});return response(options.method==='POST'?{task_id:'accepted'}:{task:{id:'accepted',status:'succeeded',content:{url:'https://cdn.test/output.mp4'}}});});
 const result=await p.generate(request,{pollInterval:1,onTaskIdentity:id=>identities.push(id)});assert.equal(result.status,'succeeded');assert.deepEqual(identities,['accepted']);assert.deepEqual(calls.map(call=>call.options.method),['POST','GET']);
});
test('accepted task remains recoverable after interrupted generation without a second POST',async()=>{
 const calls=[],p=provider(async(_url,options)=>{calls.push(options.method);return response(options.method==='POST'?{task_id:'accepted'}:{task:{id:'accepted',status:'queued'}});}),controller=new AbortController();let id;
 await assert.rejects(()=>p.generate(request,{signal:controller.signal,pollInterval:1,onTaskIdentity:value=>{id=value;controller.abort(Error('stop'));}}));assert.equal(id,'accepted');assert.deepEqual(calls,['POST']);await p.poll(id);assert.deepEqual(calls,['POST','GET']);
});
