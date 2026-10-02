const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
const form={title:'创作参数',fields:[{id:'brief',type:'text',label:'描述',required:true}]};
const answer=(text='光影')=>({tool_call_id:'form',form_title:form.title,values:[{field_id:'brief',field_label:'描述',value:text,display:text}],skipped:false});
function harness(){
 const trace={id:'trace',name:'show_form',callId:'form',args:form,status:'done',result:{form,awaiting_submission:true}};
 const chat={id:'chat',messages:[trace],uploads:[{id:'unrelated'}],refs:['unrelated'],queuedMessages:[],queuePauseReason:'old'};let saved=0,drained=0,rendered=0;
 const context={window:{AgentTools:require('../agent-tools.js')},draft:()=>chat,pageLeaving:false,panel:{},busy:false,clone:structuredClone,queueModule:{captureSubmission:input=>({...input,id:'submission'})},queueRunner:{drain:async()=>{drained++;}},modelModule:{prepareSessionSelection:()=>({})},composerModule:{textDocument:text=>text},validateSubmission:()=>{},persistQueue:()=>{saved++;},render:()=>{rendered++;},save:()=>true};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' function currentFormChat('),source.indexOf(' function focusComposer(')),context);
 return {context,trace,chat,counts:()=>({saved,drained,rendered})};
}
test('first submit is a new structured user turn, isolates composer attachments, and binds retries to exact answers',async()=>{
 const {context,trace,chat,counts}=harness();await context.submitForm(trace,answer(),{submissionId:'receipt'});
 const item=chat.queuedMessages[0];assert.deepEqual(item.formSubmission,answer());assert.match(item.text,/我提交了表单/);assert.equal(item.uploads.length,0);assert.equal(item.refs.length,0);assert.equal(item.formRevisionOf,trace.id);
 context.busy=true;await context.submitForm(trace,answer(),{submissionId:'receipt'});assert.equal(chat.queuedMessages.length,1);assert.deepEqual(counts(),{saved:1,drained:1,rendered:1});await assert.rejects(()=>context.submitForm(trace,answer('变化'),{submissionId:'receipt'}),/不同答案/);
 context.busy=false;await context.submitForm(trace,answer('变化'),{submissionId:'revision'});assert.equal(chat.queuedMessages.length,2);assert.match(chat.queuedMessages[1].text,/我修改了表单/);assert.equal(trace.formSubmissionReceipts.length,2);
});
test('persistence failure rolls back queue, latest summary, and receipt so an unchanged retry is safe',async()=>{
 const {context,trace,chat,counts}=harness(),originalQueue=chat.queuedMessages;context.persistQueue=()=>{throw Error('storage full');};await assert.rejects(()=>context.submitForm(trace,answer(),{submissionId:'receipt'}),/storage full/);
 assert.equal(chat.queuedMessages,originalQueue);assert.equal(chat.queuePauseReason,'old');assert.equal(trace.formLatestSubmission,undefined);assert.equal(trace.formSubmissionReceipts,undefined);assert.deepEqual(counts(),{saved:0,drained:0,rendered:0});context.persistQueue=()=>{};await context.submitForm(trace,answer(),{submissionId:'receipt'});assert.equal(chat.queuedMessages.length,1);
});
test('closed, switched, stopped, busy and invalid submissions cannot queue work or forge tool receipts',async()=>{
 for(const mutate of [({context})=>context.panel=null,({context})=>context.pageLeaving=true,({context})=>context.busy=true,({chat})=>chat.messages=[],({trace})=>trace.status='cancelled']){const h=harness();mutate(h);await assert.rejects(()=>h.context.submitForm(h.trace,answer(),{submissionId:'receipt'}));assert.equal(h.chat.queuedMessages.length,0);}
 const {context,trace,chat}=harness();await assert.rejects(()=>context.submitForm(trace,{...answer(),tool_call_id:'wrong'},{submissionId:'receipt'}));await assert.rejects(()=>context.submitForm(trace,answer(),{}));assert.equal(chat.queuedMessages.length,0);assert.equal(trace.result.awaiting_submission,true);
});
