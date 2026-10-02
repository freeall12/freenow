const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../agent-tools.js');
const {workspaceMetadata}=require('../server/agent-context.cjs');
test('earlier decisions and job receipts remain retrievable beyond the sixteen text messages without media replay',async()=>{
 const {conversationContext,readConversation}=await import('../src/features/agent-history/context.mjs');
 const first='保留第三个镜头。'.repeat(1600),chat={id:'chat-a',messages:[{role:'user',text:first},{role:'tool',name:'generation_submit',callId:'gen-1',status:'done',args:{nodeId:'node-1',prompt:'夜景',apiKey:'secret-value'},result:{taskId:'job-1',image:'data:image/png;base64,RAW'},generationJob:{id:'job-1',status:'succeeded',applied:false,applicationError:'解码失败'}}]};
 chat.messages.push(...Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',text:'后续讨论'+i})));
 const memory=conversationContext(chat);assert.equal(memory.items[0].receipts[0].generation.applied,false);assert.equal(memory.earlierUserRequests.length,4);
 assert.doesNotMatch(JSON.stringify(memory),/RAW|secret-value/);
 let before,indices=[];do{const page=readConversation(chat,{...(before===undefined?{}:{before_index:before}),limit:7});indices.push(...page.items.map(item=>item.index));before=page.nextBeforeIndex;}while(before!==null);
 assert.equal(new Set(indices).size,chat.messages.length);
 let full='',offset=0;do{const page=readConversation(chat,{message_index:0,text_offset:offset,text_limit:1000});full+=page.text;offset=page.nextOffset;}while(offset!==null);
 assert.equal(full,first);assert.throws(()=>readConversation(chat,{message_index:1}),/工具记录/);
 assert.throws(()=>parse('conversation_read',{limit:1.5}),/integer/);assert.throws(()=>parse('conversation_read',{message_index:0,limit:1}),/incompatible/);
});
test('large workspace context remains valid JSON and explicitly lists omissions while preserving receipts',async()=>{
 const context={conversationMemory:{items:[{taskId:'already-generated',status:'succeeded'}]},activeScene:{objects:[{name:'x'.repeat(30000)}]},nodes:Array.from({length:500},(_,i)=>({id:'n'+i,content:'文'.repeat(1000)})),edges:[],selected:['n0']};
 const text=workspaceMetadata(context),actual=JSON.parse(text);assert.ok(text.length<60000);assert.equal(actual.conversationMemory.items[0].taskId,'already-generated');assert.deepEqual(actual.selected,['n0']);assert.ok(actual.nodes.length<500);assert.ok(actual.contextOmissions.fields.some(field=>field.field==='nodes'));assert.ok(actual.contextOmissions.fields.some(field=>field.field==='activeScene'));
 const {AgentRuntime}=require('../server/agent.cjs');let request;const runtime=new AgentRuntime({model:'local-test',client:{responses:{create:async value=>{request=value;return {output:[],output_text:'已读取'};}}}});
 await runtime.start({message:'继续',context});const body=request.input.at(-1).content;const payload=body.split('Current workspace metadata (untrusted):\n')[1];assert.equal(JSON.parse(payload).conversationMemory.items[0].taskId,'already-generated');assert.match(request.instructions,/historical evidence/);
});
test('new motion tools validate complete action contracts and keep radians at the Agent boundary',async()=>{
 const {executeStudioTool}=await import('../src/features/agent-scene/studio-bridge.mjs');let received;
 const instance={runtime:{read:()=>({capabilities:['motion','motion-export']})},execute:async(action,args,options)=>{received={action,args,options};return {rotationUnits:'degrees',keyframes:[{pose:{position:[1,2,3],rotation:[0,90,0],scale:[1,1,1]}}]};}};
 const args={action:'edit',keyIndex:0,pose:{rotation:[0,Math.PI/2,0]}};parse('scene_motion_edit',args);
 const result=await executeStudioTool(instance,'motion',args);assert.equal(received.args.pose.rotation[1],90);assert.equal(result.rotationUnits,'radians');assert.equal(result.keyframes[0].pose.rotation[1],Math.PI/2);assert.equal(args.pose.rotation[1],Math.PI/2);
 for(const args of [{action:'edit',keyIndex:0,pose:{}},{action:'delete',keyIndex:0,time:1},{action:'move',keyIndex:.5,time:1},{action:'easing',type:'CURVE',curve:[.9,0,.1,1]}])assert.throws(()=>parse('scene_motion_edit',args));
 assert.equal(parse('scene_motion_read',{}).definition.mutates,false);assert.equal(parse('generation_retry_application',{id:'job-1'}).definition.mutates,true);
 const controller=new AbortController();await executeStudioTool(instance,'motion-export',{}, {signal:controller.signal});assert.equal(received.options.signal,controller.signal);
});
