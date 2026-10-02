'use strict';
const {createHash}=require('node:crypto');
const {parse}=require('../agent-tools.js');
const {mediaContent}=require('./agent-media.cjs');
const statuses=new Set(['planned','request_in_flight','compacting','receipts_saved','waiting_tools','completed','cancelled','failed','unknown','blocked']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function bindingValue(binding){
 if(binding===undefined)return undefined;
 if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).length!==3||Object.keys(binding).some(key=>!['projectId','conversationId','submissionId'].includes(key))||['projectId','conversationId','submissionId'].some(key=>typeof binding[key]!=='string'||!binding[key].trim()||binding[key].length>200))throw Object.assign(Error('Agent 运行绑定无效'),{code:'agent_binding_invalid',status:400});
 return {projectId:binding.projectId,conversationId:binding.conversationId,submissionId:binding.submissionId};
}
function assertBinding(session,binding){if(canonical(session.binding)!==canonical(bindingValue(binding)))throw Object.assign(Error('Agent 运行不属于当前项目或会话'),{code:'agent_binding_mismatch',status:409});}
function configuration(runtime){return digest({providerIdentity:runtime.providerIdentity??'',model:runtime.model??null,models:runtime.models,reasoning:runtime.reasoning,defaultReasoning:runtime.defaultReasoning??null,maxRounds:runtime.maxRounds,maxOutputTokens:runtime.maxOutputTokens,maxContextChars:runtime.maxContextChars,tools:runtime.tools,instructions:runtime.instructions});}
// SDK output is JSON protocol data. Omit absent optional fields while retaining
// the exact request strings and media payloads; never serialize controllers.
function snapshot(session,config){
 const record={version:1,id:session.id,updated:session.updated,config,startHash:session.startHash,status:session.status,input:session.input,pending:session.pending,seenCallIds:[...session.seenCallIds],rounds:session.rounds,responseBoundaries:session.responseBoundaries,initialHistoryCount:session.initialHistoryCount,workspaceContext:session.workspaceContext,userMessage:session.userMessage,model:session.model,reasoning:session.reasoning,submittedForm:session.submittedForm,binding:session.binding,contextCompaction:session.contextCompaction,done:!!session.done,lastResponse:session.lastResponse,receiptLedger:session.receiptLedger||[],requestIntent:session.requestIntent,reason:session.reason,delegationCheckpoint:session.delegationCheckpoint};
 return JSON.parse(JSON.stringify(record));
}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function invalid(){throw Object.assign(Error('Agent 检查点结构无效，未恢复任何执行'),{code:'agent_checkpoint_invalid',status:503});}
function validToolContent(output){
 if(typeof output==='string')return true;
 if(!Array.isArray(output)||!output.length)return false;
 return output.every(part=>{if(!object(part))return false;if(part.type==='input_text')return typeof part.text==='string';if(part.type!=='input_image'||typeof part.image_url!=='string'||part.detail!==undefined&&!['auto','low','high'].includes(part.detail))return false;try{mediaContent([{name:'checkpoint inspection',imageUrl:part.image_url}]);return true;}catch(_error){return false;}});
}
function validateResponse(response,record){
 if(!object(response)||response.sessionId!==record.id||typeof response.done!=='boolean'||typeof response.text!=='string'||!Number.isSafeInteger(response.round)||response.round<0||response.round>record.rounds+(response.limitReached===true?1:0)||!Array.isArray(response.calls))invalid();
 const ids=new Set();for(const call of response.calls){if(!object(call)||typeof call.callId!=='string'||!call.callId||ids.has(call.callId)||!record.seenCallIds.includes(call.callId)||typeof call.name!=='string'||!call.name||!object(call.args)||typeof call.mutates!=='boolean')invalid();ids.add(call.callId);}
 if(response.done&&response.calls.length)invalid();
 if(response.segments!==undefined&&(!Array.isArray(response.segments)||response.segments.some(segment=>!object(segment)||!Number.isSafeInteger(segment.round)||segment.round<0||segment.round>response.round||typeof segment.text!=='string')))invalid();
}
function restore(record,config){
 if(!object(record)||record.version!==1||!uuid.test(record.id)||!Number.isSafeInteger(record.updated)||record.updated<0||typeof record.config!=='string'||!/^[0-9a-f]{64}$/.test(record.config)||typeof record.startHash!=='string'||!/^[0-9a-f]{64}$/.test(record.startHash)||!statuses.has(record.status)||!Array.isArray(record.input)||!Array.isArray(record.pending)||!Array.isArray(record.seenCallIds)||record.seenCallIds.some(id=>typeof id!=='string'||!id)||new Set(record.seenCallIds).size!==record.seenCallIds.length||!Number.isSafeInteger(record.rounds)||record.rounds<0||!Array.isArray(record.responseBoundaries)||record.responseBoundaries.some((index,i)=>!Number.isSafeInteger(index)||index<0||index>record.input.length||i>0&&index<record.responseBoundaries[i-1])||!Number.isSafeInteger(record.initialHistoryCount)||record.initialHistoryCount<0||record.initialHistoryCount>record.input.length||!object(record.workspaceContext)||typeof record.userMessage!=='string'||typeof record.model!=='string'||!record.model.trim()||record.reasoning!==undefined&&(!object(record.reasoning)||typeof record.reasoning.effort!=='string')||typeof record.done!=='boolean'||!Array.isArray(record.receiptLedger)||!object(record.budgets)||['maxRounds','maxOutputTokens','maxContextChars'].some(key=>!Number.isSafeInteger(record.budgets[key])||record.budgets[key]<1))invalid();
 bindingValue(record.binding);
 if(record.reason!==undefined&&typeof record.reason!=='string')invalid();
 if(['completed','cancelled','failed'].includes(record.status)!==record.done)invalid();
 if(record.requestIntent!==undefined&&(!object(record.requestIntent)||!['compaction_or_response','response'].includes(record.requestIntent.kind)||record.requestIntent.round!==record.rounds))invalid();
 if(['request_in_flight','compacting'].includes(record.status)&&!record.requestIntent)invalid();
 for(const item of record.input){if(!object(item)||typeof item.type!=='string'&&!['user','assistant'].includes(item.role))invalid();if(item.type==='function_call'&&(typeof item.call_id!=='string'||!item.call_id||typeof item.name!=='string'||typeof item.arguments!=='string'))invalid();if(item.type==='function_call_output'&&(typeof item.call_id!=='string'||!item.call_id||!validToolContent(item.output)))invalid();if(item.role&&(!['user','assistant'].includes(item.role)||typeof item.content!=='string'&&!Array.isArray(item.content)))invalid();}
 const ids=new Set();for(const call of record.pending){if(!object(call)||typeof call.callId!=='string'||!call.callId||ids.has(call.callId)||!record.seenCallIds.includes(call.callId)||typeof call.name!=='string'||!call.name||!object(call.args)||typeof call.mutates!=='boolean')invalid();ids.add(call.callId);const original=record.input.filter(item=>item.type==='function_call'&&item.call_id===call.callId);if(original.length!==1||original[0].name!==call.name||record.input.some(item=>item.type==='function_call_output'&&item.call_id===call.callId))invalid();}
 const hashes=new Set();for(const entry of record.receiptLedger){if(!object(entry)||typeof entry.hash!=='string'||!/^[0-9a-f]{64}$/.test(entry.hash)||hashes.has(entry.hash)||entry.formPrepared!==undefined&&typeof entry.formPrepared!=='boolean')invalid();hashes.add(entry.hash);if(entry.response!==undefined)validateResponse(entry.response,record);}
 if(record.lastResponse!==undefined)validateResponse(record.lastResponse,record);
 if(record.status==='waiting_tools'&&(!record.pending.length||!record.lastResponse||record.lastResponse.done||record.lastResponse.round!==record.rounds||canonical(record.lastResponse.calls)!==canonical(record.pending)))invalid();
 if(record.status==='completed'&&(!record.lastResponse||!record.lastResponse.done||record.pending.length))invalid();
 if(['receipts_saved','planned'].includes(record.status)&&record.pending.length)invalid();
 const session={...record,seenCallIds:new Set(record.seenCallIds),controller:new AbortController(),busy:false,restored:true};
 if(record.config!==config&&!record.done){session.status='blocked';session.reason='configuration_changed';session.done=false;}
 else if(['request_in_flight','compacting'].includes(record.status)){session.status='unknown';session.reason='request_outcome_unknown';session.done=false;}
 else if(['receipts_saved','planned'].includes(record.status)){session.reason='request_not_dispatched';}
 else if(record.status==='waiting_tools'&&record.pending.some(call=>call.name==='agent_delegate')&&!record.delegationCheckpoint){session.status='blocked';session.reason='delegation_state_not_persisted';session.done=false;}
 if(record.config===config)for(const call of record.pending){let args;try{args=parse(call.name,call.args).args;}catch(_error){invalid();}if(canonical(args)!==canonical(call.args))invalid();const source=record.input.find(item=>item.type==='function_call'&&item.call_id===call.callId);let original;try{original=parse(source.name,source.arguments).args;}catch(_error){invalid();}if(canonical(original)!==canonical(call.args))invalid();}
 return session;
}
function summary(session){return {sessionId:session.id,status:session.status,round:session.rounds,done:!!session.done,restored:!!session.restored,canResumeWithReceipts:['waiting_tools','receipts_saved','planned'].includes(session.status)&&!session.busy,pending:session.pending.map(call=>({callId:call.callId,name:call.name})),text:(session.responseDurable===false?session.durableResponse:session.lastResponse)?.text||'',...(session.binding?{binding:{...session.binding}}:{}),...(session.reason?{reason:session.reason}:{})};}
module.exports={digest,bindingValue,assertBinding,configuration,snapshot,restore,summary};
