'use strict';

const MAX_RESPONSE_BYTES=1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure=(code='unknown')=>Object.assign(Error(code==='provider_identity_mismatch'?'fal 任务身份未确认':'fal 请求状态未确认，请查询原任务；未自动重试'),{code});
const validId=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=2048&&!/[\x00-\x1f\x7f]/.test(value)&&value!=='.'&&value!=='..';
const hasError=value=>Object.hasOwn(value,'error')||Object.hasOwn(value,'error_type');

// Only server configuration selects the origin. Provider-supplied status,
// response and cancel URLs are never used to send authenticated requests.
function createFalQueue({baseUrl='https://queue.fal.run',apiKey,fetchImpl=fetch}={}){
 let endpoint='',configurationValid=false;
 try{
  if(typeof baseUrl!=='string'||!baseUrl||baseUrl!==baseUrl.trim())throw Error();
  const url=new URL(baseUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#'))throw Error();
  if(typeof apiKey!=='string'||!apiKey.trim()||apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)||typeof fetchImpl!=='function')throw Error();
  endpoint=url.href.replace(/\/+$/,'');configurationValid=true;
 }catch{}

 function modelRoutes(model){
  if(!configurationValid)throw failure();
  if(typeof model!=='string'||model.length>2048)throw failure();
  const parts=model.split('/');
  // Matches SDK parseEndpointId for ordinary owner/alias[/path] endpoints.
  // Workflow namespaces and URL syntax are outside this transport's scope.
  if(parts.length<2||parts[0]==='workflows'||parts.some(part=>! /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)||part==='.'||part==='..'))throw failure();
  return {submit:endpoint+'/'+parts.join('/'),app:endpoint+'/'+parts.slice(0,2).join('/')};
 }
 function requestRoute(model,requestId){
  const routes=modelRoutes(model);
  if(!validId(requestId))throw failure('provider_identity_mismatch');
  return routes.app+'/requests/'+encodeURIComponent(requestId);
 }
 function identity(value,requestId){
  if(Object.hasOwn(value,'request_id')&&(!validId(value.request_id)||requestId!==undefined&&value.request_id!==requestId))throw failure('provider_identity_mismatch');
 }

 async function read(url,method,body,signal,acceptedStatuses){
  const timed=AbortSignal.timeout(method==='PUT'?5000:30000),combined=signal?AbortSignal.any([signal,timed]):timed;
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const abort=()=>rejectAbort(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  const wait=operation=>Promise.race([Promise.resolve().then(()=>{if(combined.aborted)throw combined.reason;return operation();}),interrupted]);
  try{
   const response=await wait(()=>fetchImpl(url,{method,redirect:'error',headers:{Authorization:'Key '+apiKey,'Content-Type':'application/json'},signal:combined,...(body!==undefined?{body}:{})}));
   if(!(acceptedStatuses?acceptedStatuses.includes(response.status):response.ok)||Number(response.headers?.get('content-length'))>MAX_RESPONSE_BYTES){response.body?.cancel().catch(()=>{});throw failure();}
   if(!response.body?.getReader)throw failure();
   const reader=response.body.getReader(),parts=[];let bytes=0,complete=false;
   try{
    for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}bytes+=chunk.value.byteLength;if(bytes>MAX_RESPONSE_BYTES)throw failure();parts.push(Buffer.from(chunk.value));}
   }finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
   if(!object(value))throw failure();
   return {value,httpStatus:response.status};
  }catch{if(signal?.aborted)throw signal.reason;throw failure();}
  finally{combined.removeEventListener('abort',abort);}
 }

 async function submit(model,body,{signal}={}){
  const routes=modelRoutes(model);let serialized;
  try{if(!object(body))throw Error();serialized=JSON.stringify(body);if(!object(JSON.parse(serialized)))throw Error();}catch{throw failure();}
  // A lost POST response may have enqueued a billable task. Never retry here.
  const {value}=await read(routes.submit,'POST',serialized,signal);identity(value);
  if(!validId(value.request_id))throw failure('provider_identity_mismatch');
  // Official enqueue receipts can omit status while providing request_id.
  const status=!hasError(value)&&(value.status===undefined||value.status==='IN_QUEUE')?'queued':!hasError(value)&&value.status==='IN_PROGRESS'?'running':value.status==='COMPLETED'&&hasError(value)?'failed':'unknown';
  return {requestId:value.request_id,status};
 }
 async function poll(model,requestId,{signal}={}){
  const route=requestRoute(model,requestId);
  const {value}=await read(route+'/status?logs=0','GET',undefined,signal);identity(value,requestId);
  if(value.status==='IN_QUEUE')return {requestId,status:'queued'};
  if(value.status==='IN_PROGRESS')return {requestId,status:'running'};
  if(value.status!=='COMPLETED')return {requestId,status:'unknown'};
  if(hasError(value))return {requestId,status:'failed'};
  const {value:result}=await read(route,'GET',undefined,signal);identity(result,requestId);
  if(hasError(result))return {requestId,status:'failed'};
  return {requestId,status:'succeeded',result};
 }
 async function cancel(model,requestId,{signal}={}){
  const route=requestRoute(model,requestId);
  const {value,httpStatus}=await read(route+'/cancel','PUT',undefined,signal,[202,400,404]);identity(value,requestId);
  if(!(httpStatus===202&&value.status==='CANCELLATION_REQUESTED'||httpStatus===400&&value.status==='ALREADY_COMPLETED'||httpStatus===404&&value.status==='NOT_FOUND'))throw failure();
  // None of the documented cancellation receipts confirms execution stopped.
  return {requestId,status:'unknown'};
 }
 return {submit,poll,cancel};
}

module.exports={createFalQueue};
