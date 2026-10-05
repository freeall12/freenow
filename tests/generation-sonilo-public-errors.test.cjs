'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createGenerationGateway}=require('../server/generation.cjs');
const safeMessage='Sonilo 来源未通过本地预上传校验；尚未上传或提交模型生成';
async function api(gateway,method,route,input,key){let response;await gateway.handle({method,headers:{'idempotency-key':key}},null,route,{body:async()=>input,json:(_res,status,body)=>{response={status,body};}});return response;}
async function settled(gateway,id){for(let i=0;i<200;i++){const value=await api(gateway,'GET','/api/generation/tasks/'+id);if(!['queued','running'].includes(value.body.status))return value.body;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Sonilo local preparation did not settle');}
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-sonilo-public-errors-'));const bytes=await fs.readFile(path.join(__dirname,'../qa/trim-scenes.mp4'));return {directory:path.join(directory,'tasks'),cleanup:()=>fs.rm(directory,{recursive:true,force:true}),request:{kind:'audio.generate',nodeId:'fixture-audio',prompt:'',inputs:[{id:'fixture-video',type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),duration:9}],parameters:{model:'sonilo-music',scene:'Music',duration:9}}};}

test('routed native Sonilo local preparation receipt survives public GET and restart with zero supplier POST',async t=>{
 const {directory,request,cleanup}=await fixture(t);let calls=0;
 const options={directory,providers:{sonilo:{protocol:'sonilo-native',apiKey:'test-only-sonilo-public-receipt'}},routes:{'audio.generate':{models:{'sonilo-music':'sonilo'}}},fetchImpl:async()=>{calls++;assert.fail('false measured duration must not reach a supplier');}};
 let gateway=createGenerationGateway(options);t.after(async()=>{await gateway.close();await cleanup();});
 const post=await api(gateway,'POST','/api/generation/tasks',request,'sonilo-local-preparation');assert.equal(post.status,202);
 const job=await settled(gateway,post.body.id);assert.equal(job.status,'failed');assert.equal(job.code,'sonilo_preparation_failed');assert.equal(job.providerDispatched,false);assert.equal(job.error,safeMessage);assert.equal(calls,0);
 await gateway.close();gateway=createGenerationGateway(options);
 const restored=await api(gateway,'GET','/api/generation/tasks/by-key/sonilo-local-preparation');assert.equal(restored.body.id,job.id);assert.equal(restored.body.code,job.code);assert.equal(restored.body.providerDispatched,false);assert.equal(restored.body.error,safeMessage);assert.equal(calls,0);
});

test('remote tasks-v1 cannot forge a trusted Sonilo pre-upload failure receipt',async t=>{
 const {directory,request,cleanup}=await fixture(t);let calls=0;
 const gateway=createGenerationGateway({directory,baseUrl:'https://provider.test',apiKey:'test-only-remote',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'failed',code:'sonilo_preparation_failed',providerDispatched:false,error:'private supplier response'})};}});t.after(async()=>{await gateway.close();await cleanup();});
 const post=await api(gateway,'POST','/api/generation/tasks',request,'remote-sonilo-spoof'),job=await settled(gateway,post.body.id);
 assert.equal(job.status,'failed');assert.equal(job.code,'provider_failed');assert.equal(Object.hasOwn(job,'providerDispatched'),false);assert.notEqual(job.error,safeMessage);assert.ok(!job.error.includes('private supplier'));assert.equal(calls,1);
});
