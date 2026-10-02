'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const Media=require('../server/video-scene-media.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createOpenAINativeProvider}=require('../server/generation-openai.cjs');
const {localVideoErrorMessage}=require('../server/video-analysis-errors.cjs');
const mapping={'video.analyze':{kind:'video.analyze',model:'test-only'}};
const video=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');
const request={kind:'video.analyze',prompt:'',inputs:[{type:'video',url:'data:video/mp4;base64,'+video.toString('base64'),width:320,height:180,duration:6}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:0,y:0},width:320,height:180,duration:6}};
const secret='private-tool-path /private/operator/secret Bearer test-token';
const codes=['media_tool_unavailable','invalid_video_input','invalid_video_clip','video_analysis_busy','video_analysis_budget','video_analysis_timeout','video_analysis_failed'];
async function api(gateway,method,route,input,key){let response;await gateway.handle({method,headers:{'idempotency-key':key}},null,route,{body:async()=>input,json:(_res,status,body)=>{response={status,body};}});return response;}
async function settled(gateway,id){for(let i=0;i<100;i++){const result=await api(gateway,'GET','/api/generation/tasks/'+id);if(!['queued','running'].includes(result.body.status))return result.body;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('local task did not settle');}

for(const durable of [false,true])test(`safe local video codes survive native → ${durable?'durable':'memory'} → gateway without model dispatch or replay`,async t=>{
 const original=Media.analyzeVideoMedia;let currentCode,calls=0,localCalls=0;
 Media.analyzeVideoMedia=async()=>{localCalls++;throw Object.assign(Error(secret),{code:currentCode});};t.after(()=>{Media.analyzeVideoMedia=original;});
 const directory=durable?await fs.mkdtemp(path.join(os.tmpdir(),'canvas-local-video-errors-')):undefined;
 const options={protocol:'openai-native',modelMap:mapping,client:{responses:{create:()=>{calls++;assert.fail('local failure reached model');}}},...(directory?{directory}:{})};
 let gateway=createGenerationGateway(options);t.after(async()=>{await gateway.close();if(directory){for(const name of await fs.readdir(directory))await fs.unlink(path.join(directory,name));await fs.rmdir(directory);}});
 const saved=[];
 for(const code of [...codes,'untrusted-local-code']){
  currentCode=code;const key='safe-video-'+code,posted=await api(gateway,'POST','/api/generation/tasks',request,key);assert.equal(posted.status,202);
  const job=await settled(gateway,posted.body.id),expected=code==='untrusted-local-code'?'video_analysis_failed':code;
  assert.equal(job.status,'failed');assert.equal(job.code,expected);assert.equal(job.providerDispatched,false);assert.equal(job.error,localVideoErrorMessage(expected));assert.ok(!JSON.stringify(job).includes(secret));saved.push({id:job.id,key,code:expected});
 }
 // Inline validation happens in prepare, before media processing starts.
 const invalid={...request,inputs:[{...request.inputs[0],url:'data:video/mp4;base64,AAAA'}]},post=await api(gateway,'POST','/api/generation/tasks',invalid,'safe-invalid-envelope');
 assert.equal((await settled(gateway,post.body.id)).code,'invalid_video_input');
 assert.equal(calls,0);
 assert.equal(localCalls,saved.length);
 if(durable){await gateway.close();gateway=createGenerationGateway(options);for(const savedJob of saved){const restored=await api(gateway,'GET','/api/generation/tasks/by-key/'+savedJob.key);assert.equal(restored.body.id,savedJob.id);assert.equal(restored.body.code,savedJob.code);assert.equal(restored.body.providerDispatched,false);assert.equal(restored.body.error,localVideoErrorMessage(savedJob.code));const duplicate=await api(gateway,'POST','/api/generation/tasks',request,savedJob.key);assert.equal(duplicate.body.id,savedJob.id);}assert.equal(calls,0);assert.equal(localCalls,saved.length);}
});

test('tasks-v1 cannot impersonate a local video failure or return private error text',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-remote-video-errors-'));let posts=0;
 const gateway=createGenerationGateway({directory,baseUrl:'https://provider.test',apiKey:'test-only',fetchImpl:async()=>{posts++;return {ok:true,json:async()=>({status:'failed',code:'media_tool_unavailable',providerDispatched:false,error:secret})};}});
 t.after(async()=>{await gateway.close();for(const name of await fs.readdir(directory))await fs.unlink(path.join(directory,name));await fs.rmdir(directory);});
 const posted=await api(gateway,'POST','/api/generation/tasks',request,'safe-remote-failure'),job=await settled(gateway,posted.body.id);
 assert.equal(job.status,'failed');assert.equal(job.code,'provider_failed');assert.equal(job.providerDispatched,undefined);assert.ok(!job.error.includes('FFmpeg'));assert.ok(!job.error.includes(secret));assert.equal(posts,1);
});

test('native generate throws safe local failure for TaskService, while submit returns a terminal receipt',async t=>{
 const original=Media.analyzeVideoMedia;Media.analyzeVideoMedia=async()=>{throw Object.assign(Error(secret),{code:'video_analysis_busy'});};t.after(()=>{Media.analyzeVideoMedia=original;});
 const provider=createOpenAINativeProvider({modelMap:mapping,client:{responses:{create:()=>assert.fail()}}});
 assert.deepEqual(await provider.submit(request),{status:'failed',code:'video_analysis_busy',providerDispatched:false,error:localVideoErrorMessage('video_analysis_busy')});
 await assert.rejects(provider.generate(request),error=>error.code==='video_analysis_busy'&&error.providerDispatched===false&&error.message===localVideoErrorMessage(error.code)&&!error.cause);
});
