'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tools=require('../agent-tools.js');
async function fixture(){
 const {createDepthAgentHost}=await import('../src/features/agent-workflows/depth-agent.mjs');
 const {inspectCanvasMedia}=await import('../src/features/agent-vision/inspect.mjs');
 const nodes=[{id:'source',type:'video',video:'https://media.test/source.mp4'},{id:'actor',type:'image',image:'https://media.test/preview.png',fullImage:'https://media.test/actor.png'}],messages=[],requests=[],inspections=[];let saves=0,sequence=0;
 const host=createDepthAgentHost({getNodes:()=>nodes,getMessages:()=>messages,validateFormSubmission:tools.validateFormSubmission,localAssets:{url:value=>value},baseUrl:'http://localhost/',
  inspect:(ids,options)=>inspectCanvasMedia(ids,{...options,prepare:async uploads=>{inspections.push(uploads);return uploads.map(upload=>({name:upload.name,imageUrl:'data:image/jpeg;base64,/9j/4AAQ',...(upload.type==='video'?{time:0}:{})}));}}),
  resolveMedia:async node=>({id:node.id,type:node.type,url:node.clip?'https://media.test/exported-clip.mp4':node.video||node.fullImage||node.image,width:1280,height:720,...(node.type==='video'?{duration:node.clip?node.clip.end-node.clip.start:5}:{})}),
  getConfiguration:async()=>({configured:true,protocol:'tasks-v1'}),
  runInPlace:async(request,handlers,options)=>{requests.push(request);const job={id:'job-'+requests.length,status:'running'};options.onSubmitted?.(job);handlers.guard();const added=await handlers.apply({type:'video',url:'https://media.test/result-'+requests.length+'.mp4',width:1,height:1,duration:999});return {...job,status:'succeeded',resultIds:added.map(n=>n.id)};},
  createConnected:(source,outputs)=>{const added=outputs.map(output=>({...output,id:'output-'+(++sequence)}));nodes.push(...added);return added;},persist:async()=>{saves++;}});
 host.beginTurn('turn-one');return {host,nodes,messages,requests,inspections,saves:()=>saves};
}

test('real inspection transport receipts gate depth generation; prepare alone, changed media and new turns are not evidence',async()=>{
 const {host,nodes,requests}=await fixture(),args={sourceId:'source'},authorize=async()=>{};
 const prepared=await host.prepare({stage:'convert',sourceId:'source'});
 await assert.rejects(host.execute('depth_video_convert',args,{authorize}),/先用/);assert.equal(requests.length,0);
 host.acceptInspections([{result:prepared}],{limitReached:true});await assert.rejects(host.execute('depth_video_convert',args,{authorize}),/先用/);
 host.acceptInspections([{result:prepared}]);let submitted;
 const result=await host.execute('depth_video_convert',args,{authorize,onSubmitted:job=>submitted=job.id});assert.equal(result.applied,true);assert.equal(result.taskId,submitted);assert.equal(requests.length,1);assert.equal(nodes.at(-1).videoMetadata.duration,5);
 const reused=await host.execute('depth_video_convert',args,{authorize});assert.equal(reused.reused,true);assert.equal(requests.length,1);
 nodes[0].trim={start:1,end:3};await assert.rejects(host.execute('depth_video_convert',args,{authorize}),/先用/);delete nodes[0].trim;
 nodes[0].video='https://media.test/changed.mp4';await assert.rejects(host.execute('depth_video_convert',args,{authorize}),/先用/);
 host.beginTurn('turn-two');await assert.rejects(host.execute('depth_video_convert',args,{authorize}),/先用/);
});

test('recast binds actual submitted form values and returns real video plus reference map without trusting provider metadata',async()=>{
 const {host,nodes,messages,requests,saves}=await fixture();
 const prepare=await host.prepare({stage:'recast',sourceId:'source'}),form=prepare.form;
 messages.push({role:'tool',name:'show_form',callId:'form-call',status:'done',args:form});
 const {formSubmission}=await import('../src/features/agent-forms/model.mjs');
 const values={character_image:['actor'],character_description:'',setting_image:[],setting_description:'雨夜街道'};
 const args={depthNodeId:'source',formCallId:'form-call',model:'seedance-2.0'};
 await assert.rejects(host.execute('depth_video_recast',args,{authorize:async()=>{}}),/真实用户提交/);
 messages.push({role:'user',formSubmission:formSubmission(form,values,'form-call')});
 const ready=await host.prepare({stage:'recast',sourceId:'source',formCallId:'form-call'});host.acceptInspections([{result:ready}]);
 const result=await host.execute('depth_video_recast',args,{authorize:async()=>{}});
 assert.equal(result.nodeIds.length,2);assert.equal(nodes.at(-2).videoMetadata.duration,5);assert.equal(JSON.parse(nodes.at(-1).content).actualDuration,5);assert.equal(saves(),1);
 assert.deepEqual(requests[0].inputs.map(input=>input.id),['source','actor']);assert.match(requests[0].prompt,/grayscale/);
 await assert.rejects(host.execute('depth_video_recast',{...args,character:{description:'模型擅自替换'}},{authorize:async()=>{}}),/不一致/);
 messages.push({role:'user',formSubmission:formSubmission(form,{},'form-call',true)});
 await assert.rejects(host.execute('depth_video_recast',args,{authorize:async()=>{}}),/跳过/);assert.equal(requests.length,1);
});

test('host authority cannot be supplied by model fields; real image inspection uses fullImage',async()=>{
 const {host,requests}=await fixture();const prepared=await host.prepare({stage:'convert',sourceId:'source'});host.acceptInspections([{result:prepared}]);
 await assert.rejects(host.execute('depth_video_convert',{sourceId:'source',confirmed:true}),/宿主确认/);assert.equal(requests.length,0);
 assert.throws(()=>tools.parse('depth_video_convert',{sourceId:'source',confirmed:true}));
 const {inspectCanvasMedia}=await import('../src/features/agent-vision/inspect.mjs');let seen;
 await inspectCanvasMedia(['image'],{getNodes:()=>[{id:'image',type:'image',image:'old',fullImage:'current'}],prepare:async inputs=>{seen=inputs;return [{name:'image',imageUrl:'data:image/jpeg;base64,/9j/4AAQ'}];}});assert.equal(seen[0].asset,'current');
});

function runtimeFor(args){
 const {AgentRuntime}=require('../server/agent.cjs');const requests=[];
 const agent=new AgentRuntime({model:'test-model',client:{responses:{create:async request=>{
  requests.push(structuredClone(request));
  return requests.length===1?{output:[{type:'function_call',name:'depth_video_prepare',arguments:JSON.stringify(args),call_id:'prepare'}]}:{output:[],output_text:'已查看实际参考'};
 }}}});return {agent,requests};
}
test('actual host pixels survive depth preparation through Responses continuation; rejected batches leave session intact',async()=>{
 const {host,requests:generation}=await fixture(),args={stage:'convert',sourceId:'source'};
 const {agent,requests}=runtimeFor(args),first=await agent.start({message:'制作深度视频'});
 const {withInspectionMedia}=await import('../src/features/agent-vision/inspect.mjs');
 const result=await host.prepare(first.calls[0].args),entry=withInspectionMedia({callId:'prepare',result});
 const session=agent.sessions.get(first.sessionId),length=session.input.length;
 await assert.rejects(agent.resume(first.sessionId,[{callId:'prepare',result}]),/缺少实际画面/);
 await assert.rejects(agent.resume(first.sessionId,[{...entry,mediaInputs:[{...entry.mediaInputs[0],nodeId:'another'}]}]),/不匹配/);
 assert.equal(session.input.length,length);assert.equal(session.pending.length,1);
 await assert.rejects(host.execute('depth_video_convert',{sourceId:'source'},{authorize:async()=>{}}),/先用/);
 const response=await agent.resume(first.sessionId,[entry]);host.acceptInspections([{result}],response);
 const output=requests[1].input.find(item=>item.type==='function_call_output');
 assert.equal(output.output.filter(item=>item.type==='input_image').length,1);
 assert.equal(output.output.at(-1).image_url,entry.mediaInputs[0].imageUrl);
 await host.execute('depth_video_convert',{sourceId:'source'},{authorize:async()=>{}});assert.equal(generation.length,1);
});

test('form-derived depth pixels bind to validated host submissions and reject mismatched current-turn choices',async()=>{
 const {withDepthFormEvidence}=await import('../src/features/agent-workflows/depth-agent.mjs');
 const {withInspectionMedia}=await import('../src/features/agent-vision/inspect.mjs');
 const {formSubmission}=await import('../src/features/agent-forms/model.mjs');
 for(const historical of [false,true]){
  const {host,messages}=await fixture(),form=(await host.prepare({stage:'recast',sourceId:'source'})).form;
  const submission=formSubmission(form,{character_image:['actor'],character_description:'',setting_image:[],setting_description:'雨夜街道'},'form-call');
  messages.push({role:'tool',name:'show_form',callId:'form-call',status:'done',args:form},{role:'user',formSubmission:submission});
  const args={stage:'recast',sourceId:'source',formCallId:'form-call'},result=await host.prepare(args);
  const entry=withDepthFormEvidence(withInspectionMedia({callId:'prepare',result}));
  assert.equal(JSON.stringify(result).includes('formSubmission'),false);
  const {agent,requests}=runtimeFor(args),first=await agent.start({message:'继续重演',...(!historical?{formSubmission:{form,result:submission}}:{})});
  const session=agent.sessions.get(first.sessionId),length=session.input.length;
  const missing={...entry};delete missing.formSubmission;
  await assert.rejects(agent.resume(first.sessionId,[missing]),/缺少真实表单/);
  const wrong=structuredClone(entry);wrong.formSubmission.result.tool_call_id='other-form';
  await assert.rejects(agent.resume(first.sessionId,[wrong]));
  if(!historical){
   const changed=structuredClone(entry);changed.formSubmission.result.values.find(item=>item.field_id==='setting_description').value='修改答案';
   await assert.rejects(agent.resume(first.sessionId,[changed]),/本轮用户提交不一致/);
  }
  const skipped=structuredClone(entry);skipped.formSubmission.result=formSubmission(form,{},'form-call',true);
  await assert.rejects(agent.resume(first.sessionId,[skipped]),/跳过/);
  await assert.rejects(agent.resume(first.sessionId,[{...entry,mediaInputs:entry.mediaInputs.filter(frame=>frame.nodeId==='source')}]),/缺少待查看节点/);
  assert.equal(session.input.length,length);
  await agent.resume(first.sessionId,[entry]);
  const output=requests[1].input.find(item=>item.type==='function_call_output');assert.equal(output.output.filter(item=>item.type==='input_image').length,2);
 }
});

 test('depth preparation samples the materialized clip while guarding the original canvas source',async()=>{
 const {host,nodes,inspections}=await fixture();nodes[0].clip={start:1,end:3};
 const result=await host.prepare({stage:'convert',sourceId:'source'});
 assert.equal(result.source.duration,2);assert.equal(inspections[0][0].asset,'https://media.test/exported-clip.mp4');assert.equal(nodes[0].video,'https://media.test/source.mp4');
 host.acceptInspections([{result}]);nodes[0]={...nodes[0]};
 await assert.rejects(host.execute('depth_video_convert',{sourceId:'source'},{authorize:async()=>{}}),/先用/);
});
