'use strict';
const https=require('node:https'),dns=require('node:dns/promises'),net=require('node:net'),{createHash}=require('node:crypto');
const {publicMediaUrl,publicAddress}=require('./generation-media-download.cjs');
const {assertNetworkDestination}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const INITIATE_URL='https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3';
// Official SDK switches to multipart above 90 MiB. This helper implements only
// the single-shot path, and never silently changes upload protocols.
const MAX_FILE_BYTES=90*1024*1024,MAX_RESPONSE_BYTES=64*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const CHECKPOINT_CODES=new Set(['storage_error','invalid_preparation_state','provider_identity_mismatch']);
const fail=code=>Object.assign(Error('fal 素材上传未确认或已拒绝；未自动重试或重新发布'),{code});
function equalAddress(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 if(net.isIP(b)===4)return a===b||a.toLowerCase()==='::ffff:'+b;
 try{return net.isIP(a)===6&&new URL('https://['+a+']/').hostname===new URL('https://['+b+']/').hostname;}catch{return false;}
}

// A fetch Response cannot prove its TLS peer. Keep the downloader's pinned DNS
// and Node request injection contract rather than trusting arbitrary fetch URLs.
function createFalUpload({apiKey,lookup=(host,options)=>dns.lookup(host,options),requestImpl=https.request,maxBytes=MAX_FILE_BYTES,timeoutMs=120000,maxConcurrent=1,...unknown}={}){
 if(Object.keys(unknown).length||typeof apiKey!=='string'||!apiKey||apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)||typeof lookup!=='function'||typeof requestImpl!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_FILE_BYTES||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>4)throw fail('upload_configuration_invalid');
 let active=0;
 async function upload(file,{signal,onStage=()=>{},...unknownOptions}={}){
  let identity=null,stage='validating',status='pending',initiationDispatched=false,uploadDispatched=false,receiptAccepted=false,acknowledged=false,callbackFailed=false,entered=false;
  const snapshot=()=>({stage,status,identity:identity?{...identity}:null,initiationDispatched,uploadDispatched,retryable:false});
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  const check=()=>{if(combined.aborted)throw fail(combined.reason?.name==='TimeoutError'?'upload_timeout':'upload_cancelled');};
  let stop;const interrupted=new Promise((_,reject)=>{stop=()=>reject(fail(combined.reason?.name==='TimeoutError'?'upload_timeout':'upload_cancelled'));});interrupted.catch(()=>{});
  combined.addEventListener('abort',stop,{once:true});if(combined.aborted)stop();
  const wait=operation=>{check();return Promise.race([Promise.resolve().then(()=>{check();return operation();}),interrupted]);};
  async function checkpoint(next,nextStatus='pending'){
   stage=next;status=nextStatus;
   try{await wait(()=>onStage(snapshot()));}catch(error){if(!combined.aborted){callbackFailed=true;throw fail(CHECKPOINT_CODES.has(error?.code)?error.code:'upload_checkpoint_failed');}throw error;}
   check();
  }
  function safeUrl(value){
   assertCredentialFree(value,apiKey);
   if(typeof value!=='string'||value.includes('#'))throw fail('upload_url_forbidden');
   const url=publicMediaUrl(value);
   assertNetworkDestination(url);
   if(url.protocol!=='https:')throw fail('upload_url_forbidden');
   return url;
  }
  async function destination(url){
   const host=url.hostname.replace(/^\[|\]$/g,'');
   const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await wait(()=>lookup(host,{all:true,verbatim:true}));
   if(!Array.isArray(addresses)||!addresses.length||addresses.length>64||addresses.some(item=>!item||!publicAddress(item.address)||item.family!==net.isIP(item.address)))throw fail('upload_dns_forbidden');
   return {url,selected:addresses[0]};
  }
  async function send({url,selected},{method,headers,body}){
   let request,response,sent=false;
   const close=()=>{response?.destroy();request?.destroy();};combined.addEventListener('abort',close,{once:true});
   try{
    const pinned=(_host,options,callback)=>{if(typeof options==='function'){callback=options;options={};}callback(null,...options?.all?[[selected]]:[selected.address,selected.family]);};
    response=await wait(()=>new Promise((resolve,reject)=>{
     const rejectSafe=code=>{close();reject(fail(code));};
     request=requestImpl(url,{method,headers,agent:false,lookup:pinned,family:selected.family,maxHeaderSize:16384,signal:combined},resolve);
     request.on('error',()=>reject(fail(combined.aborted?'upload_cancelled':'upload_network_failed')));
     request.on('socket',socket=>{
      const write=()=>{
       if(sent)return;
       if(combined.aborted)return rejectSafe('upload_cancelled');
       // Check before sending authenticated headers or private media bytes.
       if(socket.encrypted!==true||socket.authorized!==true||!equalAddress(socket.remoteAddress,selected.address))return rejectSafe('upload_connection_forbidden');
       sent=true;request.end(body);
      };
      socket.once('secureConnect',write);
      if(socket.encrypted===true&&socket.authorized===true&&!socket.connecting)write();
     });
    }));
    if(!sent||!equalAddress(response.socket?.remoteAddress,selected.address))throw fail('upload_connection_forbidden');
    assertCredentialFree(response.headers,apiKey);assertCredentialFree(response.rawHeaders,apiKey);
    if(response.statusCode>=300&&response.statusCode<400)throw fail('upload_redirect_forbidden');
    if(![200,201,204].includes(response.statusCode))throw fail('upload_http_error');
    const encoding=response.headers?.['content-encoding'];if(encoding&&encoding!=='identity')throw fail('upload_response_invalid');
    const length=response.headers?.['content-length'];
    if(length!==undefined&&(typeof length!=='string'||!/^\d{1,12}$/.test(length)||Number(length)>MAX_RESPONSE_BYTES))throw fail('upload_response_too_large');
    if(typeof response[Symbol.asyncIterator]!=='function')throw fail('upload_response_invalid');
    const parts=[],iterator=response[Symbol.asyncIterator]();let size=0;
    for(;;){const next=await wait(()=>iterator.next());if(next.done)break;if(!(next.value instanceof Uint8Array))throw fail('upload_response_invalid');size+=next.value.byteLength;if(size>MAX_RESPONSE_BYTES)throw fail('upload_response_too_large');parts.push(Buffer.from(next.value));}
    if(length!==undefined&&Number(length)!==size)throw fail('upload_response_invalid');
    const bytes=Buffer.concat(parts);assertCredentialFreeBytes(bytes,apiKey);return bytes;
   }finally{combined.removeEventListener('abort',close);close();}
  }
  try{
   check();
   if(Object.keys(unknownOptions).length||!object(file)||Object.keys(file).some(key=>!['bytes','mime','fileName'].includes(key))||!(file.bytes instanceof Uint8Array)||!file.bytes.byteLength||file.bytes.byteLength>maxBytes||typeof file.mime!=='string'||file.mime.length>128||! /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(file.mime)||typeof file.fileName!=='string'||!file.fileName.trim()||file.fileName!==file.fileName.trim()||Buffer.byteLength(file.fileName)>255||/[\x00-\x1f\x7f/\\]/.test(file.fileName)||['.','..'].includes(file.fileName)||typeof onStage!=='function')throw fail('upload_invalid_input');
   assertCredentialFree([file.mime,file.fileName],apiKey);
   if(active>=maxConcurrent)throw fail('upload_concurrency_limit');active++;entered=true;
   // Own immutable bytes across asynchronous checkpoints and DNS resolution.
   const bytes=Buffer.from(file.bytes),mime=file.mime,fileName=file.fileName,sha256=createHash('sha256').update(bytes).digest('hex');assertCredentialFreeBytes(bytes,apiKey);
   const init=await destination(new URL(INITIATE_URL));
   // These flags are durable dispatch intents, not proof of remote receipt.
   initiationDispatched=true;await checkpoint('initiating');
   const raw=await send(init,{method:'POST',headers:{Authorization:'Key '+apiKey,'Content-Type':'application/json','Accept-Encoding':'identity'},body:JSON.stringify({content_type:mime,file_name:fileName})});
   let receipt;try{receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw fail('upload_receipt_invalid');}
   if(!object(receipt)||Object.keys(receipt).some(key=>!['upload_url','file_url'].includes(key)))throw fail('upload_receipt_invalid');
   const fileUrl=safeUrl(receipt.file_url);await destination(fileUrl);
   identity={fileUrl:fileUrl.href,mime,bytes:bytes.length,sha256};receiptAccepted=true;
   const put=await destination(safeUrl(receipt.upload_url));
   await checkpoint('initiated');uploadDispatched=true;await checkpoint('uploading');
   await send(put,{method:'PUT',headers:{'Content-Type':mime},body:bytes});acknowledged=true;
   await checkpoint('uploaded','uploaded');return {status:'uploaded',...identity};
  }catch(error){
   const code=error?.code==='provider_response_rejected'?'upload_credentials_rejected':CHECKPOINT_CODES.has(error?.code)||typeof error?.code==='string'&&/^(upload_|media_)/.test(error.code)?error.code:'upload_failed';
   status=acknowledged?'uploaded':uploadDispatched||initiationDispatched&&!receiptAccepted?'unknown':code==='upload_cancelled'?'cancelled':'failed';
   stage=status==='uploaded'?'uploaded':status;
   const result=Object.assign(fail(code),snapshot());
   // Terminal reporting is best effort; checkpoint failure must not call the
   // failing storage callback again or authorize another network operation.
   if(!callbackFailed&&!combined.aborted&&typeof onStage==='function')try{await wait(()=>onStage({...snapshot(),code}));}catch{}
   throw result;
  }finally{combined.removeEventListener('abort',stop);if(entered)active--;}
 }
 return {upload};
}
module.exports={createFalUpload,INITIATE_URL,MAX_FILE_BYTES};
