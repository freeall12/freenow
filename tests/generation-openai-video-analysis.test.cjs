'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),OpenAI=require('openai');
const {validateVideoAnalysisProfile,videoAnalysisCapabilities,prepareVideoAnalysisRequest,submitVideoAnalysis,MAX_VIDEO_BYTES,MAX_SCENES}=require('../server/generation-openai-video-analysis.cjs');
// This synthetic envelope checks provider plumbing. Real decoding/cuts are tested
// independently by video-scene-media.test.cjs, never inferred from this fixture.
const video=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');
const image=fs.readFileSync(path.join(__dirname,'fixtures/red.jpg'));
const profile={kind:'video.analyze',model:'operator-selected-vision-model',detail:'high',maxOutputTokens:1500};
const request={kind:'video.analyze',label:'分镜头解析',nodeId:'source',prompt:'',inputs:[{type:'video',url:'data:video/mp4;base64,'+video.toString('base64'),clip:null,width:320,height:180,duration:6}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:10.25,y:-20.75},width:320,height:180,duration:6}};
const scene=(start,end)=>({start,end,duration:end-start,width:320,height:180,video:Buffer.from(video),poster:Buffer.from(image),frames:[.1,.5,.9].map(f=>({time:start+(end-start)*f,image:Buffer.from(image)}))});
const media=()=>({duration:6,width:320,height:180,range:{start:0,end:6},scenes:[scene(0,2),scene(2,6)]});
const response=value=>({id:'response-test',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}]});
const description={title:'测试镜头',description:'测试供应商回应，仅用于接口验收。'};
const sdkFor=create=>({responses:{create}}),prepare=()=>prepareVideoAnalysisRequest(request,profile);

test('explicit profile reports bounded full-scene capability without exposing actual model',()=>{
 assert.deepEqual(validateVideoAnalysisProfile({kind:'video.analyze',model:'selected'}),{kind:'video.analyze',model:'selected',detail:'high',maxOutputTokens:1500});
 for(const extra of [{kind:'image.recognize'},{model:''},{detail:'original'},{maxOutputTokens:511},{maxOutputTokens:16001},{maxOutputTokens:1.2},{maxCount:2},{threshold:.3},{sceneCount:2}])assert.throws(()=>validateVideoAnalysisProfile({...profile,...extra}),{code:'configuration_invalid'});
 const caps=videoAnalysisCapabilities(profile);assert.equal(caps.operation,'film_scene_breakdown');assert.equal(caps.maxVideoBytes,MAX_VIDEO_BYTES);assert.equal(caps.maxScenes,MAX_SCENES);assert.equal(caps.sceneDetection,'ffmpeg-scdet');assert.ok(!JSON.stringify(caps).includes(profile.model));
});

test('sync prepare accepts one inline video and existing contract with absolute non-destructive clip',()=>{
 const prepared=prepare();assert.deepEqual(prepared.media.bytes,video);assert.equal(prepared.media.mimeType,'video/mp4');assert.deepEqual(prepared.source,{width:320,height:180,duration:6});assert.equal(prepared.body,undefined);
 const clipped=prepareVideoAnalysisRequest({...request,inputs:[{...request.inputs[0],clip:{start:1,end:5}}]},profile);assert.deepEqual(clipped.media.clip,{start:1,end:5});
 const webm=Buffer.from([26,69,223,163,1,2,3,4]);assert.equal(prepareVideoAnalysisRequest({...request,inputs:[{...request.inputs[0],url:'data:video/webm;base64,'+webm.toString('base64')}]},profile).media.mimeType,'video/webm');
});

test('invalid input URLs, envelopes, metadata, extra semantics and clips fail before media or SDK',()=>{
 for(const url of ['https://source.test/video.mp4','asset:id','blob:https://app.test/video','data:video/quicktime;base64,AAAA','data:video/mp4;base64,AAAA','data:video/webm;base64,'+video.toString('base64'),'data:video/mp4;base64,'+video.toString('base64')+'=','data:video/mp4;base64,'+'A'.repeat(4*Math.ceil(MAX_VIDEO_BYTES/3)+4)])assert.throws(()=>prepareVideoAnalysisRequest({...request,inputs:[{...request.inputs[0],url}]},profile));
 for(const change of [{kind:'image.recognize'},{prompt:'请只看人物'},{inputs:[]},{inputs:[request.inputs[0],request.inputs[0]]},{inputs:[{...request.inputs[0],width:321}]},{inputs:[{...request.inputs[0],duration:Infinity}]},{inputs:[{...request.inputs[0],clip:{start:1,end:7}}]},{inputs:[{...request.inputs[0],clip:{start:2,end:1}}]},{inputs:[{...request.inputs[0],clip:{start:0,end:1,mode:'crop'}}]},{inputs:[{...request.inputs[0],role:'reference'}]},{parameters:{...request.parameters,operation:'overview'}},{parameters:{...request.parameters,nodePosition:{x:0,y:Infinity}}},{parameters:{...request.parameters,count:3}},{parameters:{...request.parameters,model:'a',modelId:'b'}}])assert.throws(()=>prepareVideoAnalysisRequest({...request,...change},profile));
});

test('each actual scene gets three timestamped JPEGs; outputs physical clips plus title/text and source provenance',async()=>{
 let attempts=0,active=0,maxActive=0;
 const result=await submitVideoAnalysis(prepare(),{analyzeMedia:async(input,{signal})=>{assert.deepEqual(input.bytes,video);assert.equal(input.clip,null);assert.ok(signal instanceof AbortSignal);return media();},sdk:sdkFor(async(body,options)=>{
  active++;maxActive=Math.max(maxActive,active);attempts++;
  assert.equal(body.model,profile.model);assert.equal(body.store,false);assert.equal(body.max_output_tokens,1500);assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);assert.equal(options.maxRetries,0);assert.ok(options.signal instanceof AbortSignal);assert.ok(options.timeout>0&&options.timeout<=600000);assert.equal(body.tools,undefined);
  const content=body.input[0].content,info=JSON.parse(content[0].text);assert.equal(info.frameTimes.length,3);assert.equal(info.frameTimeBasis,'source-range-mapped-output-presentation-approximate');assert.ok(content.filter(c=>c.type==='input_text').slice(1).every(c=>c.text.includes('近似时间')));assert.equal(info.sceneNumber,attempts);assert.deepEqual(info.sourceRange,attempts===1?{start:0,end:2}:{start:2,end:6});
  assert.equal(content.filter(c=>c.type==='input_image').length,3);assert.ok(content.filter(c=>c.type==='input_image').every(c=>c.image_url.startsWith('data:image/jpeg;base64,')&&c.detail==='high'));assert.ok(!JSON.stringify(body).includes('data:video'));await new Promise(resolve=>setImmediate(resolve));active--;return response({...description,title:'镜头'+attempts});
 })});
 assert.equal(attempts,2);assert.equal(maxActive,1);assert.equal(result.status,'succeeded');assert.equal(result.outputs.length,2);
 for(const [index,out]of result.outputs.entries()){assert.equal(out.type,'video');assert.deepEqual(Buffer.from(out.url.split(',')[1],'base64'),video);assert.deepEqual(Buffer.from(out.poster.split(',')[1],'base64'),image);assert.equal(out.text,description.description);assert.equal(out.title,'镜头'+(index+1));assert.equal(out.width,320);assert.equal(out.height,180);assert.equal(out.clip,undefined);assert.equal(out.sourceUrl,undefined);}
 assert.deepEqual(result.outputs[1].sourceRange,{start:2,end:6});
});

test('clipped source ranges stay absolute while generated physical media has no repeated clip offset',async()=>{
 const prepared=prepareVideoAnalysisRequest({...request,inputs:[{...request.inputs[0],clip:{start:1,end:5}}]},profile),m={...media(),range:{start:1,end:5},scenes:[scene(1,2),scene(2,5)]};
 const result=await submitVideoAnalysis(prepared,{analyzeMedia:async()=>m,sdk:sdkFor(async()=>response(description))});assert.deepEqual(result.outputs.map(out=>out.sourceRange),[{start:1,end:2},{start:2,end:5}]);assert.deepEqual(result.outputs.map(out=>out.duration),[1,3]);assert.ok(result.outputs.every(out=>!Object.hasOwn(out,'clip')));
});

test('invalid scene media, gaps, wrong real metadata and omitted frames never call the vision SDK',async()=>{
 const variants=[()=>({...media(),width:999}),()=>({...media(),duration:8}),()=>({...media(),scenes:[]}),()=>({...media(),scenes:Array.from({length:33},()=>scene(0,6))}),()=>({...media(),scenes:[scene(0,1),scene(2,6)]}),()=>({...media(),scenes:[scene(0,5)]}),()=>({...media(),scenes:[{...scene(0,6),video:Buffer.from('fake video')}]}),()=>({...media(),scenes:[{...scene(0,6),poster:Buffer.from('fake image')}]}),()=>({...media(),scenes:[{...scene(0,6),frames:[scene(0,6).frames[0]]}]}),()=>({...media(),scenes:[{...scene(0,6),frames:scene(0,6).frames.map(f=>({...f,time:8}))}]})];
 for(const get of variants)await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:async()=>get(),sdk:sdkFor(()=>assert.fail('invalid media reached SDK'))}),{code:'unsupported_generation'});
});

test('local media failures explicitly prove no provider dispatch, while caption errors never do',async()=>{
 for(const code of ['media_tool_unavailable','video_analysis_budget','invalid_video_clip'])await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:async()=>{throw Object.assign(Error('本地媒体错误'),{code});},sdk:sdkFor(()=>assert.fail())}),error=>error.providerDispatched===false&&error.code!=='unknown');
 await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:async()=>{throw Error('private detail');},sdk:sdkFor(()=>assert.fail())}),error=>error.providerDispatched===false&&!error.message.includes('private'));
 await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:async()=>media(),sdk:sdkFor(async()=>{throw Error('private detail');})}),error=>error.code==='unknown'&&error.providerDispatched===undefined&&!error.message.includes('private'));
});

test('installed SDK POST /responses sends frames exactly once per scene and never retries 429',async()=>{
 let attempts=0;
 const sdk=new OpenAI({apiKey:'test-only',baseURL:'https://isolated-provider.test/v1',fetch:async(url,options)=>{attempts++;assert.equal(String(url),'https://isolated-provider.test/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.input[0].content.filter(item=>item.type==='input_image').length,3);return new Response(JSON.stringify(response(description)),{headers:{'content-type':'application/json'}});}});
 assert.equal((await submitVideoAnalysis(prepare(),{analyzeMedia:async()=>media(),sdk})).outputs.length,2);assert.equal(attempts,2);
 let retries=0;const limited=new OpenAI({apiKey:'test-only',baseURL:'https://isolated-provider.test/v1',fetch:async()=>{retries++;return new Response(JSON.stringify({error:{message:'private detail'}}),{status:429,headers:{'content-type':'application/json'}});}});
 await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:async()=>media(),sdk:limited}),error=>error.code==='unknown'&&!error.message.includes('private'));assert.equal(retries,1);
});

test('second-scene refusal, incomplete or malformed response rejects the whole batch without partial success',async()=>{
 const invalid=[response({title:'',description:'x'}),response({...description,extra:1}),response({title:'x',description:''}),{...response(description),status:'incomplete'},{...response(description),output:[{type:'function_call',name:'run',arguments:'{}'}]},{...response(description),output:[{type:'message',status:'completed',content:[{type:'refusal',refusal:'no'}]}]},{...response(description),output:[{type:'message',status:'incomplete',content:[{type:'output_text',text:JSON.stringify(description)}]}]},{...response(description),output:[{type:'message',status:'completed',content:[{type:'output_text',text:'```json\n{}\n```'}]}]}];
 for(const value of invalid){let calls=0;await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:async()=>media(),sdk:sdkFor(async()=>++calls===1?response(description):value)}),{code:'unknown'});assert.equal(calls,2);}
});

test('abort and timeout stop waiting even when media/SDK ignore signal; no late success or next scene',async()=>{
 const before=new AbortController();before.abort(Error('cancel before video'));await assert.rejects(submitVideoAnalysis(prepare(),{signal:before.signal,sdk:sdkFor(()=>assert.fail())}),/cancel before/);
 let releaseMedia;await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:()=>new Promise(resolve=>releaseMedia=resolve),sdk:sdkFor(()=>assert.fail()),timeoutMs:10}),error=>error.providerDispatched===false&&error.code==='unsupported_generation');releaseMedia(media());
 let release,started,calls=0;const began=new Promise(resolve=>started=resolve),controller=new AbortController();
 const pending=submitVideoAnalysis(prepare(),{analyzeMedia:async()=>media(),signal:controller.signal,sdk:sdkFor(()=>{calls++;started();return new Promise(resolve=>release=resolve);})});await began;controller.abort(Error('cancel caption'));await assert.rejects(pending,/cancel caption/);release(response(description));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 let late;await assert.rejects(submitVideoAnalysis(prepare(),{analyzeMedia:async()=>media(),sdk:sdkFor(()=>new Promise(resolve=>late=resolve)),timeoutMs:10}),{code:'unknown'});late(response(description));
});
