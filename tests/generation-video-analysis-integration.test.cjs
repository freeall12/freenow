'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {createOpenAINativeProvider}=require('../server/generation-openai.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const mapping={'video.analyze':{kind:'video.analyze',model:'injected-test-vision'}};
function store(){const rows=new Map();return {readAll:async()=>[...rows.values()].map(row=>structuredClone(row)),write:async row=>rows.set(row.id,structuredClone(row))};}
async function terminal(service,id){const end=Date.now()+20000;for(;;){const job=await service.get(id);if(!['running','queued'].includes(job.status))return job;if(Date.now()>end)throw Error('native analysis did not settle');await new Promise(r=>setTimeout(r,20));}}
const req=url=>({kind:'video.analyze',nodeId:'source',prompt:'',inputs:[{type:'video',url,width:320,height:180,duration:8,clip:null}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:40.25,y:240.75},width:320,height:180,duration:8}});
test('actual native video analysis preserves physical clips/provenance through durable restart without replay',async()=>{
 const bytes=await fs.readFile(new URL('../qa/trim-scenes.mp4','file://'+__filename)),data=store();let calls=0;
 const client={responses:{create:async(body,options)=>{calls++;assert.equal(options.maxRetries,0);assert.equal(body.store,false);assert.equal(body.input[0].content.filter(c=>c.type==='input_image').length,3);return {status:'completed',output:[{type:'message',status:'completed',content:[{type:'output_text',text:JSON.stringify({title:'固定描述测试 '+calls,description:'仅协议验证，未调用供应商'})}]}]};}}};
 const provider=createOpenAINativeProvider({modelMap:mapping,client});assert.equal(provider.metadata.capabilities.videoAnalysis['video.analyze'].transport,'inline');assert.ok(!JSON.stringify(provider.metadata).includes('injected-test-vision'));
 const request=req('data:video/mp4;base64,'+bytes.toString('base64'));assert.throws(()=>provider.prepare({...request,parameters:{...request.parameters,model:'unmapped'}}),{code:'configuration_required'});
 let service=createDurableGenerationService({store:data,provider}),job=await service.submit(request,{idempotencyKey:'native-video-durable'});job=await terminal(service,job.id);assert.equal(job.status,'succeeded');assert.equal(calls,3);assert.deepEqual(job.outputs.map(o=>o.sourceRange),[{start:0,end:2},{start:2,end:4},{start:4,end:8}]);assert.deepEqual(job.outputs.map(o=>o.duration),[2,2,4]);assert.ok(job.outputs.every(o=>o.url.startsWith('data:video/mp4')&&o.poster.startsWith('data:image/jpeg')&&!o.clip));await service.close();
 service=createDurableGenerationService({store:data,provider});await service.ready;assert.deepEqual((await service.get(job.id)).outputs,job.outputs);assert.equal((await service.submit(request,{idempotencyKey:'native-video-durable'})).id,job.id);assert.equal(calls,3);await service.close();
});
test('native local decode failure is terminal failed with no model call',async()=>{
 const bytes=Buffer.alloc(24);bytes.writeUInt32BE(24,0);bytes.write('ftyp',4);bytes.write('isom',8);let calls=0;
 const provider=createOpenAINativeProvider({modelMap:mapping,client:{responses:{create:()=>{calls++;assert.fail();}}}}),service=createDurableGenerationService({store:store(),provider});const job=await service.submit(req('data:video/mp4;base64,'+bytes.toString('base64')),{idempotencyKey:'native-broken-media'});assert.equal((await terminal(service,job.id)).status,'failed');assert.equal(calls,0);await service.close();
});
