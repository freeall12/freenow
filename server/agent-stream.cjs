'use strict';

function streamError(message,code){return Object.assign(new Error(message),{code});}
function checkAbort(signal){if(signal?.aborted)throw streamError('已取消','cancelled');}

// Only a completed Responses payload is authoritative for tool arguments. Deltas
// are display-only and reasoning events expose activity, never private content.
async function streamedResponse(client,request,{signal,onEvent,sessionId,round}){
 const emit=event=>onEvent({...event,sessionId,round}),reasoning=new Set();let stream,completed;
 try{
  checkAbort(signal);
  stream=await client.responses.create({...request,stream:true},{signal,maxRetries:0});
  checkAbort(signal);
  for await(const event of stream){
   checkAbort(signal);
   if(event.type==='response.output_text.delta'&&typeof event.delta==='string')emit({type:'text_delta',delta:event.delta});
   if((event.type==='response.output_item.added'||event.type==='response.output_item.done')&&event.item?.type==='reasoning'){
    const key=event.item.id??event.output_index;
    if(event.type==='response.output_item.added'){if(!reasoning.size)emit({type:'thinking',active:true});reasoning.add(key);}
    else if(reasoning.delete(key)&&!reasoning.size)emit({type:'thinking',active:false});
   }
   if(event.type==='response.failed'||event.type==='error')throw streamError('模型响应失败，请检查模型服务后重试。','response_failed');
   if(event.type==='response.incomplete')throw streamError('模型响应未完成，未执行本轮工具。','response_incomplete');
   if(event.type==='response.completed'){
    const response=event.response;
    if(response?.status!=='completed'||!Array.isArray(response.output)||response.output.some(item=>['incomplete','in_progress'].includes(item.status)))throw streamError('模型响应未完成，未执行本轮工具。','response_incomplete');
    completed=response;break;
   }
  }
  checkAbort(signal);
  if(!completed)throw streamError('模型流提前结束，未执行本轮工具。','stream_incomplete');
  return completed;
 }finally{
  if(!completed)stream?.controller?.abort();
  if(reasoning.size)emit({type:'thinking',active:false});
 }
}

function wantsAgentStream(req){return String(req.headers.accept||'').split(',').some(part=>{const [type,...params]=part.trim().toLowerCase().split(';');return type.trim()==='application/x-ndjson'&&!params.some(value=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(value));});}

// Start headers only after runtime validation and its first session event. This
// preserves JSON error statuses (including unconfigured models) before streaming.
async function writeAgentStream(res,run,{signal}={}){
 const emit=event=>{
  if(signal?.aborted||res.destroyed||res.writableEnded)return;
  if(!res.headersSent){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});res.flushHeaders?.();}
  res.write(JSON.stringify(event)+'\n');
 };
 try{const result=await run(emit);checkAbort(signal);emit({type:'result',result});res.end();}
 catch(error){
  if(!res.headersSent)throw error;
  emit({type:'error',error:error.status===401?'模型服务认证失败，请检查服务端 KEY。':error.message||'请求失败',...(error.code?{code:error.code}:{})});
  if(!res.destroyed&&!res.writableEnded)res.end();
 }
}

module.exports={streamedResponse,wantsAgentStream,writeAgentStream,checkAbort};
