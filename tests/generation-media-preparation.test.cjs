const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService}=require('../generation-api.js');
const ready=Promise.all([
 import('../src/features/node-composer/generation-request.mjs'),import('../src/features/node-composer/generation-media.mjs'),
 import('../src/features/agent-workflows/media-transport.mjs'),import('../src/features/agent-workflows/media-resolver.mjs'),
 import('../src/features/subject-library/model.mjs'),import('../src/features/agent-generation/media-inputs.mjs')
]);
const terminal=(service,job)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('task timeout'));},2000);const off=service.subscribe(value=>{if(value.id===job.id&&['failed','cancelled','configuration_required','succeeded'].includes(value.status)){clearTimeout(timer);off();resolve(value);}});});
const serialize=async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
const baseUrl='http://localhost:4173/';

test('subjects expand once before shared transport; actual asset/blob bytes and audio metadata reach provider with stable labels',async()=>{
 const [preparation,media,transport,resolver,subjects]=await ready;
 const urls=Object.fromEntries(['image','video','audio'].map(type=>[type,URL.createObjectURL(new Blob(['actual-'+type+'-bytes'],{type:type+'/'+(type==='image'?'png':type==='video'?'mp4':'wav')}))]));
 // Browser metadata callbacks are explicit boundary doubles; transport uses native Blob/fetch bytes.
 const factory=type=>()=>({naturalWidth:640,naturalHeight:360,videoWidth:1280,videoHeight:720,duration:type==='audio'?2:4,decode:async()=>{},removeAttribute(){},load(){},set src(url){queueMicrotask(()=>type==='image'?this.onload?.():this.onloadedmetadata?.());}});
 const resolveMedia=resolver.createWorkflowMediaResolver({localAssets:{url:async id=>urls[id.slice(6)]},baseUrl,createImage:factory('image'),createVideo:factory('video'),createAudio:factory('audio')});
 const subject={id:'person',name:'主角',assets:[{id:'i',type:'image',url:'asset:image'},{id:'v',type:'video',url:'asset:video',durationMs:999999},{id:'a',type:'audio',url:urls.audio},{id:'words',type:'text',text:'红衣'}]};
 const request={kind:'video.generate',nodeId:'source',prompt:subjects.subjectToken(subject)+'走进镜头',inputs:[{id:'source',type:'image',url:urls.image,sourceUrl:'asset:image'},{id:'text',type:'text',text:'保留人物身份'}],parameters:{model:'seedance-2.0',videoMode:'REFERENCE_TO_VIDEO',subjects:[subject]}};
 const service=new TaskService({prepareRequest:preparation.prepareGenerationRequest,prepareInputs:(request,{signal})=>media.prepareGenerationMediaRequest(request,{signal,resolveMedia,baseUrl,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize})})});
 try{
  const first=service.submit(request);await terminal(service,first);assert.equal(first.status,'configuration_required');
  let sent;service.setProvider({generate:async value=>{sent=value;return {outputs:[{type:'video',url:'https://media.example/generated.mp4'}]};}});
  const retry=service.retry(first.id);await terminal(service,retry);assert.equal(retry.status,'succeeded');
  assert.deepEqual(sent.inputs.map(i=>i.type),['image','text','video','audio']);assert.match(sent.prompt,/\{\{Image 1\}\}/);assert.match(sent.prompt,/\{\{Video 1\}\}/);assert.match(sent.prompt,/\{\{Audio 1\}\}/);assert.ok(!sent.prompt.includes('ElementRef'));
  for(const input of sent.inputs.filter(i=>i.url)){assert.equal(Buffer.from(input.url.split(',')[1],'base64').toString(),'actual-'+input.type+'-bytes');assert.equal(input.sourceUrl,undefined);}
  assert.equal(sent.inputs[2].duration,4);assert.equal(sent.inputs[2].durationMs,4000);assert.equal(sent.inputs[3].duration,2);
  assert.equal(sent.parameters.subjects[0].assets[0].url,sent.inputs[0].url);assert.equal(sent.parameters.subjects[0].assets[1].url,sent.inputs[2].url);assert.equal(sent.parameters.subjects[0].assets[1].durationMs,4000);
  assert.equal(subject.assets[1].durationMs,999999);assert.equal(first.request.prompt,sent.prompt);
 }finally{Object.values(urls).forEach(url=>URL.revokeObjectURL(url));}
});

test('subject limits reject before media read, and cancel/source edits during shared preparation never dispatch',async()=>{
 const [preparation,media,,,subjects,agent]=await ready;
 let reads=0,calls=0;
 const subject={id:'too-many',name:'过多图片',assets:Array.from({length:10},(_,i)=>({id:String(i),type:'image',url:'asset:'+i}))};
 await assert.rejects(media.prepareGenerationMediaRequest({kind:'video.generate',prompt:subjects.subjectToken(subject),parameters:{model:'seedance-2.0',videoMode:'REFERENCE_TO_VIDEO',subjects:[subject]}},{resolveMedia:()=>{reads++;}}),/不支持当前参考/);assert.equal(reads,0);
 for(const cancel of [false,true]){
  const node={id:'source',type:'image',image:'asset:original'},prepared=await agent.prepareAgentMediaInputs([node],{getNode:()=>node,deferTransport:true,resolveMedia:async()=>({id:node.id,type:'image',url:'https://media.example/original.png'})});
  let release;const service=new TaskService({prepareRequest:preparation.prepareGenerationRequest,prepareInputs:request=>new Promise(resolve=>{release=()=>resolve(request);})});
  service.setProvider({generate:async()=>{calls++;return {outputs:[{type:'image',url:'https://media.example/out.png'}]};}});
  const job=service.submit({kind:'image.generate',inputs:prepared.inputs},{beforeDispatch:prepared.guard});const settled=terminal(service,job);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(Object.keys(job).includes('beforeDispatch'),false);assert.equal(JSON.stringify(job).includes('beforeDispatch'),false);
  if(cancel)service.cancel(job.id);else node.image='asset:edited';release();await settled;
  assert.equal(job.status,cancel?'cancelled':'failed');
 }
 assert.equal(calls,0);
 await assert.rejects(media.prepareGenerationMediaRequest({kind:'video.generate',prompt:'人物',inputs:[{id:'v',type:'video',url:'https://media.example/long.mp4'}],parameters:{model:'seedance-2.5',videoMode:'REFERENCE_TO_VIDEO'}},{resolveMedia:async()=>({url:'https://media.example/long.mp4',width:1920,height:1080,duration:31}),transport:()=>assert.fail('over-limit video must not transport')}),/时长超出模型限制/);
});

test('trusted real result plans rebase empty targets and existing media sources; unrelated replacement and changed input stay blocked',async()=>{
 const [,,,,,agent]=await ready;const {createResultWorkflow,captureSubmission}=await import('../src/features/generation-results/workflow.mjs');const {assertPlanCurrent}=await import('../src/features/generation-results/plan.mjs');
 for(const hasMedia of [false,true]){
  const source={id:'source',type:'image',x:0,y:0,width:200,height:120,generation:{model:'nano-banana-flash',prompt:'原始提示',count:2},...(hasMedia?{image:'asset:original'}:{})};
  let state={nodes:[source],edges:[]};
  const prepared=await agent.prepareAgentMediaInputs([source],{guardNodes:[source],getNode:id=>state.nodes.find(node=>node.id===id),deferTransport:true,resolveMedia:async()=>({id:source.id,type:'image',url:'https://media.example/original.png'})});
  const app={getState:()=>state,commitGenerationPlan:async(plan,{isActive})=>{
   assert.ok(isActive());assertPlanCurrent(plan,state.nodes,state.edges);const replacements=[];
   for(const change of plan.nodeChanges){const after=structuredClone(change.item);if(change.type==='add')state.nodes.push(after);else{const index=state.nodes.findIndex(node=>node.id===change.id);replacements.push({before:state.nodes[index],after});state.nodes[index]=after;}}
   state.edges.push(...plan.edgeChanges.map(change=>structuredClone(change.item)));return {replacements};
  },clearGenerationResults:()=>{}};
  const workflow=createResultWorkflow(app),request={kind:'image.generate',nodeId:'source',prompt:'新提示',inputs:prepared.inputs,parameters:{model:'nano-banana-flash',count:2}};
  const submission=captureSubmission(request,state,'pile');
  await workflow.prepare(request,{jobId:'plan',signal:new AbortController().signal,validateSources:prepared.guard,acceptSourceReplacements:prepared.guard.acceptReplacements},submission);
  assert.doesNotThrow(prepared.guard);if(!hasMedia)assert.notEqual(state.nodes.find(node=>node.id==='source'),source);else assert.equal(state.nodes.find(node=>node.id==='source').image,'asset:original');
  const current=state.nodes.find(node=>node.id==='source'),replacement={...current};state.nodes[state.nodes.indexOf(current)]=replacement;
  assert.throws(prepared.guard,/替换/);
  if(hasMedia){replacement.image='asset:other';assert.throws(()=>prepared.guard.acceptReplacements([{before:current,after:replacement}]),/原始参考不一致/);}
 }
});


test('explicit missing configuration validates parameters without decoding media or planning results, and retry uses newly selected provider',async()=>{
 const [preparation]=await ready;let reads=0,dispatched=0;
 const service=new TaskService({prepareRequest:preparation.prepareGenerationRequest,prepareInputs:request=>{reads++;return request;}});
 service.setProvider({isConfigured:async()=>false,generate:()=>assert.fail('unconfigured provider must not dispatch')});
 const invalid=service.submit({kind:'image.generate',inputs:[{type:'image',url:'https://unavailable.test/ref.png'}],parameters:{model:'RC V4'}});
 await terminal(service,invalid);assert.equal(invalid.status,'failed');assert.match(invalid.error,/不支持图生图/);
 const job=service.submit({kind:'image.generate',inputs:[{type:'image',url:'https://unavailable.test/ref.png'}],parameters:{model:'nano-banana-flash'}});
 await terminal(service,job);assert.equal(job.status,'configuration_required');assert.equal(reads,0);assert.equal(job.providerDispatched,undefined);
 service.setProvider({generate:async()=>{dispatched++;return {outputs:[{type:'image',url:'https://media.example/out.png'}]};}});
 const retry=service.retry(job.id);await terminal(service,retry);assert.equal(retry.status,'succeeded');assert.equal(reads,1);assert.equal(dispatched,1);
});

test('provider selection is fixed before asynchronous configuration and media preparation',async()=>{
 for(const configured of [false,true,null]){
  let release,reads=0,originalCalls=0,newCalls=0;
  const service=new TaskService({prepareInputs:request=>{reads++;return request;}});
  service.setProvider({isConfigured:()=>new Promise(resolve=>release=resolve),generate:async()=>{originalCalls++;return {outputs:[{type:'image',url:'https://media.example/original.png'}]};}});
  const job=service.submit({kind:'image.generate'}),settled=terminal(service,job);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  service.setProvider({generate:async()=>{newCalls++;return {outputs:[{type:'image',url:'https://media.example/new.png'}]};}});
  release(configured);await settled;
  assert.equal(job.status,configured===false?'configuration_required':'succeeded');assert.equal(reads,configured===false?0:1);assert.equal(originalCalls,configured===false?0:1);assert.equal(newCalls,0);
 }
});
