'use strict';
const {protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {publicMediaUrl}=require('./generation-media-download.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const SAM2_VERSION='33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d';
const ORIGIN='https://api.replicate.com';
const fail=code=>Object.assign(Error('Replicate 分割回执未确认或不符合固定版本合同；未自动重试'),{code,status:502});
const validId=value=>typeof value==='string'&&/^[a-z0-9]{1,64}$/.test(value);
const validFileId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function checkedUrl(value,apiKey){if(typeof value!=='string'||value.includes('#'))throw fail('segmentation_invalid_result');assertCredentialFree(value,apiKey);const url=publicMediaUrl(value);if(url.protocol!=='https:'||url.hash)throw fail('segmentation_invalid_result');return url.href;}
function resultUrl(value,apiKey){const href=checkedUrl(value,apiKey),host=new URL(href).hostname.toLowerCase();if(host!=='replicate.delivery'&&!host.endsWith('.replicate.delivery'))throw fail('segmentation_invalid_result');return href;}
function uploadUrl(value,id,apiKey){const href=checkedUrl(value,apiKey),url=new URL(href);if(url.origin!==ORIGIN||url.pathname!=='/v1/files/'+id)throw fail('segmentation_upload_invalid');return href;}
function createReplicateSegmentationTransport({apiKey='',version=SAM2_VERSION,fetchImpl=fetch,timeoutMs=30000,maxResponseBytes=4*1024*1024}={}){
 const transport=protectGenerationFetch(fetchImpl);
 async function call(route,{method='GET',body,signal,onIdentity}={}){
  // No provider-supplied URL is ever allowed to select an authenticated origin.
  if(!/^\/v1\/(files|predictions)(\/[a-z0-9]{1,64})?(\/cancel)?$/.test(route))throw fail('segmentation_invalid_request');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  let rejectAbort;const stopped=new Promise((_,reject)=>{rejectAbort=()=>reject(fail('segmentation_unknown'));combined.addEventListener('abort',rejectAbort,{once:true});if(combined.aborted)rejectAbort();});
  const wait=operation=>Promise.race([Promise.resolve().then(operation),stopped]);let response;
  try{
   response=await wait(()=>transport(ORIGIN+route,{method,redirect:'error',headers:{Authorization:'Bearer '+apiKey,...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:combined}));
   if(response.status>=300&&response.status<400)throw fail('segmentation_http_error');
   if(Number(response.headers?.get('content-length'))>maxResponseBytes||!response.body?.getReader)throw fail('segmentation_invalid_result');
   const reader=response.body.getReader(),parts=[];let size=0,done=false;
   try{for(;;){const part=await wait(()=>reader.read());if(part.done){done=true;break;}size+=part.value.byteLength;if(size>maxResponseBytes)throw fail('segmentation_result_too_large');parts.push(Buffer.from(part.value));}}
   finally{if(!done)void reader.cancel().catch(()=>{});reader.releaseLock();}
   let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{throw fail('segmentation_invalid_result');}
   // Legal identity is saved before any echo, version, status or output checks.
   if(onIdentity&&validId(value?.id))await onIdentity(value.id);
   assertCredentialFree(value,apiKey);assertCredentialFree(Object.fromEntries(response.headers||[]),apiKey);
   if(!response.ok)throw fail('segmentation_http_error');
   return value;
  }catch(error){if(error?.code==='storage_error')throw error;throw fail(error?.code==='provider_response_rejected'?'segmentation_credentials_rejected':/^segmentation_/.test(error?.code||'')?error.code:'segmentation_unknown');}
  finally{combined.removeEventListener('abort',rejectAbort);}
 }
 async function upload(bytes,{direction,signal}={}){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>=100000000)throw fail('segmentation_upload_invalid');assertCredentialFreeBytes(bytes,apiKey);const form=new FormData();form.set('content',new Blob([bytes],{type:'video/mp4'}),direction+'.mp4');
  const receipt=await call('/v1/files',{method:'POST',body:form,signal});
  if(!validFileId(receipt?.id)||typeof receipt?.urls?.get!=='string'||receipt.content_type!=='video/mp4'||receipt.size!==bytes.length||receipt.checksums?.sha256!==require('node:crypto').createHash('sha256').update(bytes).digest('hex')||!Number.isFinite(Date.parse(receipt.expires_at))||Date.parse(receipt.expires_at)<=Date.now())throw fail('segmentation_upload_invalid');
  return {id:receipt.id,url:uploadUrl(receipt.urls.get,receipt.id,apiKey),expiresAt:receipt.expires_at,sha256:receipt.checksums.sha256,size:receipt.size};
 }
 function inputFor(url,prompt){return {input_video:checkedUrl(url,apiKey),click_coordinates:JSON.stringify([prompt.x,prompt.y]),click_labels:'1',click_frames:'0',click_object_ids:'target',mask_type:'binary',output_video:false,output_format:'png',output_frame_interval:1};}
 function validatePrediction(value,{id,input}){
  if(!value||value.id!==id||value.version!==version||value.model!=='meta/sam-2-video'||!['starting','processing','succeeded','failed','canceled','aborted'].includes(value.status)||!value.input||Object.entries(input).some(([key,item])=>value.input[key]!==item))throw fail('segmentation_identity_mismatch');
  if(value.data_removed===true)throw fail('segmentation_output_expired');
  if(value.status==='succeeded'){
   if(!Array.isArray(value.output)||!value.output.length||value.output.some(item=>typeof item!=='string')||new Set(value.output).size!==value.output.length)throw fail('segmentation_invalid_result');
   value.output.forEach((item,index)=>{const url=resultUrl(item,apiKey),match=/^frame_(\d+)\.png$/.exec(decodeURIComponent(new URL(url).pathname.split('/').at(-1)));if(match&&Number(match[1])!==index)throw fail('segmentation_invalid_result');});
  }
  return {id:value.id,status:value.status,...(value.status==='succeeded'?{output:value.output.map(url=>resultUrl(url,apiKey))}:{})};
 }
 return {version,inputFor,upload,async submit(input,{signal,onIdentity}={}){const receipt=await call('/v1/predictions',{method:'POST',body:{version,input},signal,onIdentity});if(!validId(receipt?.id))throw fail('segmentation_unknown');return validatePrediction(receipt,{id:receipt.id,input});},async poll(id,input,{signal}={}){if(!validId(id))throw fail('segmentation_identity_mismatch');return validatePrediction(await call('/v1/predictions/'+id,{signal}),{id,input});},async cancel(id,{signal}={}){if(!validId(id))throw fail('segmentation_identity_mismatch');const value=await call('/v1/predictions/'+id+'/cancel',{method:'POST',signal});if(value?.id!==id)throw fail('segmentation_identity_mismatch');return {id,status:value.status,confirmed:value.status==='canceled',alreadyTerminal:['succeeded','failed','aborted'].includes(value.status)};}};
}
module.exports={createReplicateSegmentationTransport,SAM2_VERSION,ORIGIN,validId,resultUrl};
