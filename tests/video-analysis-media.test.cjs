const test=require('node:test'),assert=require('node:assert/strict');
const ready=Promise.all([import('../src/features/node-composer/video-analysis-media.mjs'),import('../src/features/agent-workflows/media-transport.mjs')]);
const nativeConfiguration={protocol:'openai-native',capabilities:{videoAnalysis:{'video.analyze':{kind:'video.analyze',transport:'inline'}}}};
const request={kind:'video.analyze',nodeId:'source',inputs:[{type:'video',url:'https://media.example/film.mp4',width:320,height:240,duration:10,clip:{start:2,end:8}}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:-30,y:80},width:320,height:240,duration:10}};
const serialize=async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
test('native video transport fetches full source with CORS boundary and retains absolute clip/geometry',async()=>{
 const [media,transport]=await ready,calls=[];let guards=0;
 const result=await media.prepareVideoAnalysisMedia(request,{nativeConfiguration,baseUrl:'http://localhost:4173/',validateSources:()=>guards++,transport:(r,opts)=>transport.prepareWorkflowInputs(r,{...opts,serialize,fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response(Buffer.from('full-video-bytes'),{headers:{'content-type':'video/mp4'}});}})});
 assert.equal(result.inputs[0].url,'data:video/mp4;base64,'+Buffer.from('full-video-bytes').toString('base64'));assert.deepEqual(result.inputs[0].clip,request.inputs[0].clip);assert.deepEqual(result.parameters,request.parameters);assert.equal(calls[0].opts.credentials,'omit');assert.equal(calls[0].opts.redirect,'error');assert.ok(guards>=4);assert.equal(request.inputs[0].url,'https://media.example/film.mp4');
});
test('tasks gateway unchanged and absent native mapping fails before source access',async()=>{
 const [media]=await ready;assert.equal(await media.prepareVideoAnalysisMedia(request,{nativeConfiguration:{protocol:'tasks-v1'}}),request);await assert.rejects(media.prepareVideoAnalysisMedia(request,{nativeConfiguration:{protocol:'openai-native'},transport:()=>assert.fail()}),/尚未配置/);
});
test('credential/private source blocked and mismatched media format rejected',async()=>{
 const [media,transport]=await ready;for(const url of ['https://user:pass@media.example/a.mp4','http://192.168.0.1/a.mp4'])await assert.rejects(media.prepareVideoAnalysisMedia({...request,inputs:[{...request.inputs[0],url}]},{nativeConfiguration,transport:(r,o)=>transport.prepareWorkflowInputs(r,{...o,baseUrl:'http://localhost:4173/',fetchImpl:()=>assert.fail()})}));
 for(const url of ['data:video/quicktime;base64,AAAA','data:video/mp4;base64,AAA'])await assert.rejects(media.prepareVideoAnalysisMedia({...request,inputs:[{...request.inputs[0],url}]},{nativeConfiguration}),/MP4/);
});
test('stream byte budget stops a lying or unbounded source and cancels its reader',async()=>{
 const [,transport]=await ready;let pulls=0,cancelled=false;
 const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
 await assert.rejects(transport.prepareWorkflowInputs(request,{baseUrl:'http://localhost:4173/',inlineVideos:true,maxMediaBytes:12,serialize,fetchImpl:async()=>new Response(stream,{headers:{'content-type':'video/mp4','content-length':'1'}})}),{code:'media_request_too_large'});assert.equal(cancelled,true);assert.ok(pulls<5);
});
test('cancelled native transfer cannot submit a delayed prepared source',async()=>{
 const [media]=await ready,controller=new AbortController();let release;
 const work=media.prepareVideoAnalysisMedia(request,{nativeConfiguration,signal:controller.signal,transport:()=>new Promise(r=>release=r)});controller.abort(new DOMException('cancelled','AbortError'));release({...request,inputs:[{...request.inputs[0],url:'data:video/mp4;base64,AAAA'}]});await assert.rejects(work,{name:'AbortError'});
});
test('oversized declared body cannot hang rejection in a nonsettling cancellation callback',async()=>{
 const [,transport]=await ready;let cancelled=false;const response={ok:true,headers:{get:()=>String(100)},body:{cancel(){cancelled=true;return new Promise(()=>{});}}};
 await assert.rejects(transport.prepareWorkflowInputs(request,{inlineVideos:true,maxMediaBytes:12,baseUrl:'http://localhost:4173/',fetchImpl:async()=>response,timeoutMs:20}),{code:'media_request_too_large'});assert.equal(cancelled,true);
});
