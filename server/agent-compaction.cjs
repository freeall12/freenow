'use strict';
const {isDeepStrictEqual}=require('node:util');
const {checkAbort}=require('./agent-stream.cjs');
const {protectModelClient}=require('./outbound-client.cjs');
const {toResponseInputItems}=require('openai/lib/responses/ResponseInputItems');

// This is a request-size heuristic, not a tokenizer or an advertised model limit.
function contextSize(input){
 return JSON.stringify(input,(_key,value)=>typeof value==='string'&&/^data:(image|audio|video)\//.test(value)?'[media content retained]'.repeat(160):value).length;
}
function userContent(item){
 const content=typeof item.content==='string'?[{type:'input_text',text:item.content}]:item.content;
 return content;
}
function validateCompaction(response,original){
 if(response?.object!=='response.compaction'||!Array.isArray(response.output)||!response.output.length)throw Error('上下文整理未返回完整结果');
 const summaries=response.output.filter(item=>item.type==='compaction');
 if(summaries.length!==1||typeof summaries[0].encrypted_content!=='string'||!summaries[0].encrypted_content.trim())throw Error('上下文整理缺少有效压缩记录');
 if(response.output.some(item=>item.type!=='compaction'&&(item.role!=='user'||item.type&&item.type!=='message')))throw Error('上下文整理包含非预期执行内容');
 const before=original.filter(item=>item.role==='user').map(userContent),after=response.output.filter(item=>item.role==='user').map(userContent);
 if(!isDeepStrictEqual(before,after))throw Error('上下文整理改变了用户输入，已保留原始上下文');
 return response.output;
}

async function compactContext({client,session,threshold=160000,instructions,onEvent}){
 client=protectModelClient(client);
 const before=contextSize(session.input);
 const state=session.contextCompaction??={count:0,lastAttemptSize:0,disabled:false};
 if(state.disabled||before<threshold||before<state.lastAttemptSize+Math.min(32000,threshold/4))return;
 // Keep the two newest complete model/tool exchanges verbatim. Boundaries are
 // recorded before response output, so reasoning/call/output pairs stay intact.
 const boundary=session.responseBoundaries?.length>=2?session.responseBoundaries.at(-2):session.initialHistoryCount||0;
 if(boundary<=0||session.pending.length)return;
 state.lastAttemptSize=before;
 const emit=(status,extra={})=>onEvent?.({type:'context_compaction',sessionId:session.id,round:session.rounds,status,...extra});
 if(typeof client.responses.compact!=='function'){state.disabled=true;emit('unavailable');return;}
 const original=session.input,head=original.slice(0,boundary),tail=original.slice(boundary);
 if(head.every(item=>item.role==='user'))return;
 emit('running');
 try{
  checkAbort(session.controller.signal);
  const result=await client.responses.compact({model:session.model,input:toResponseInputItems(head),instructions},{signal:session.controller.signal,maxRetries:0});
  checkAbort(session.controller.signal);
  const compressed=validateCompaction(result,head),next=[...compressed,...tail],after=contextSize(next);
  if(after>=before){emit('unchanged');return;}
  // Commit only the completed response; cancellation or invalid output leaves
  // the original history, pending identities and executed-call ledger intact.
  session.input=next;
  session.responseBoundaries=(session.responseBoundaries||[]).filter(index=>index>=boundary).map(index=>index-boundary+compressed.length);
  session.initialHistoryCount=0;
  state.count++;state.lastAttemptSize=after;state.last={before,after,round:session.rounds};
  emit('completed',{beforeChars:before,afterChars:after});
 }catch(error){
  checkAbort(session.controller.signal);
  // A compatible Responses provider may not implement /responses/compact.
  // Do not silently replace history with a lossy local summary or retry it.
  state.disabled=true;state.lastError='context_compaction_unavailable';emit('unavailable');
 }
}
module.exports={compactContext,contextSize,validateCompaction};
