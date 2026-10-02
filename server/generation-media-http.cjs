'use strict';
const {pipeline}=require('node:stream/promises');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function singleRange(value,size){
 if(typeof value!=='string')return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||!match[1]&&!match[2])return false;
 let start,end;
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return false;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)return false;end=Math.min(end,size-1);}
 return {start,end};
}
// Only a stored resource ID is accepted. The task must have atomically published
// that exact ID before any bytes may be served; no provider URL or file path is
// accepted. The store verifies integrity and returns the same read-only handle.
function createGenerationMediaHttp({store,ownsResource}){
 if(!store||typeof store.open!=='function'||typeof ownsResource!=='function')throw TypeError('Media HTTP requires a store and task ownership assertion');
 let closing=false;const active=new Map();
 async function transfer(req,res,id,{json},signal){
  if(!UUID.test(id))return json(res,404,{code:'media_not_found',error:'本地媒体不存在'});
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
  if(closing)return json(res,503,{code:'service_closed',error:'本地媒体服务已关闭'});
  let opened;
  try{
   opened=await store.open(id);
   if(!await ownsResource(opened.info.taskId,id))return json(res,404,{code:'media_not_found',error:'本地媒体尚未发布或不属于已完成任务'});
   if(signal.aborted){res.destroy();return;}
   const info=opened.info,etag='"sha256-'+info.sha256+'"';
   const headers={'Content-Type':info.mime,'Content-Length':info.bytes,'ETag':etag,'Accept-Ranges':'bytes','Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'};
   const rangeValue=req.headers?.range,ifRange=req.headers?.['if-range'];
   const range=rangeValue&&(!ifRange||ifRange===etag)?singleRange(rangeValue,info.bytes):null;
   if(range===false){res.writeHead(416,{...headers,'Content-Range':`bytes */${info.bytes}`,'Content-Length':0});return res.end();}
   if(!range&&req.headers?.['if-none-match']?.split(',').map(value=>value.trim()).includes(etag)){const {['Content-Length']:_,...cached}=headers;res.writeHead(304,cached);return res.end();}
   if(range){headers['Content-Range']=`bytes ${range.start}-${range.end}/${info.bytes}`;headers['Content-Length']=range.end-range.start+1;}
   res.writeHead(range?206:200,headers);if(req.method==='HEAD')return res.end();
   const stream=opened.handle.createReadStream({start:range?.start??0,end:range?.end??info.bytes-1,autoClose:false});
   await pipeline(stream,res,{signal});
  }catch(error){
   if(res.headersSent){res.destroy();return;}
   return json(res,error.code==='media_integrity_error'?409:404,{code:error.code==='media_integrity_error'?'media_integrity_error':'media_not_found',error:error.code==='media_integrity_error'?'本地媒体缺失；请从原任务重新取回素材':'本地媒体不存在'});
  }finally{await opened?.handle.close().catch(()=>{});}
 }
 function handle(req,res,id,helpers){const controller=new AbortController(),operation=transfer(req,res,id,helpers,controller.signal);active.set(operation,controller);operation.finally(()=>active.delete(operation)).catch(()=>{});return operation;}
 async function close(){closing=true;for(const controller of active.values())controller.abort();await Promise.allSettled([...active.keys()]);}
 return {handle,close};
}
module.exports={createGenerationMediaHttp,singleRange};
