'use strict';
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const guards=new WeakMap();
const credentialErrors=new WeakSet();
const rejected=()=>{const error=Object.assign(Error('模型服务响应包含凭据，已拒绝接收；未自动重试'),{code:'provider_response_rejected',status:502});credentialErrors.add(error);return error;};
function containsCredential(value,secret){
 if(!secret)return false;
 if(typeof value==='string'){
  if(value.includes(secret))return true;
  // Result links can echo a Key with URL percent encoding. Decode only valid
  // percent runs; unrelated malformed percent text must not bypass the check.
  const decoded=value.replace(/(?:%[a-f0-9]{2})+/gi,part=>{try{return decodeURIComponent(part);}catch{return part;}});
  if(decoded.includes(secret))return true;
  try{for(const [key,item]of new URL(value).searchParams)if(key.includes(secret)||item.includes(secret))return true;}catch{}
  return false;
 }
 return !!value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>containsCredential(key,secret)||containsCredential(item,secret));
}
function assertCredentialFree(value,secret){if(containsCredential(value,secret))throw rejected();return value;}
function assertCredentialFreeBytes(bytes,secret){
 if(!secret)return bytes;
 assertCredentialFree(bytes.toString('utf8'),secret);
 // Binary media metadata can store text as UTF-16 in either byte order.
 // Metadata boundaries need not align with the start of the complete file.
 for(const offset of [0,1]){
  const aligned=bytes.subarray(offset,bytes.length-((bytes.length-offset)%2));
  assertCredentialFree(aligned.toString('utf16le'),secret);
  const bigEndian=Buffer.from(aligned);bigEndian.swap16();
  assertCredentialFree(bigEndian.toString('utf16le'),secret);
 }
 return bytes;
}
function safeError(error,signal){
 if(signal?.aborted)return signal.reason;
 if(error&&typeof error==='object'&&credentialErrors.has(error))return error;
 return Object.assign(Error('模型服务请求失败，请检查本机供应商配置；未自动重试'),{code:'provider_request_failed',...(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?{status:error.status}:{})});
}
function protectModelClient(client,{apiKey,fetchImpl,localPort}={}){
 if(!client)return null;
 if(guards.has(client))return guards.get(client);
 const secret=typeof apiKey==='string'?apiKey:typeof client.apiKey==='string'?client.apiKey:'';
 // Plain in-process test clients have no transport or credential identity.
 // Preserve their exact contract; production and real injected SDKs are guarded.
 if(!client.baseURL&&!secret&&typeof client.withOptions!=='function')return client;
 if(client.baseURL)endpoint(client.baseURL,{localPort});
 const credentials=new Set(secret?[secret]:[]),protectedFetch=protectGenerationFetch(fetchImpl||client.fetch||fetch);
 const transport=(url,options={})=>{
  // SDK key callbacks retain their authentication contract. Observe only the
  // actual bearer value in this private closure so echoed dynamic keys also fail.
  const authorization=new Headers(options.headers||url?.headers).get('authorization');
  if(authorization?.startsWith('Bearer ')&&authorization.length>7)credentials.add(authorization.slice(7));
  return protectedFetch(url,options);
 };
 const check=value=>{for(const credential of credentials)assertCredentialFree(value,credential);return value;};
 const sdk=typeof client.withOptions==='function'?client.withOptions({fetch:transport,maxRetries:0}):client;
 async function* streamEvents(stream,signal){
  let tail='';const hold=Math.max(0,...[...credentials].map(value=>3*Buffer.byteLength(value)-1));
  try{
   for await(const event of stream){
    check(event);
    if(credentials.size&&event.type==='response.output_text.delta'&&typeof event.delta==='string'){
     const combined=tail+event.delta;check(combined);
     const boundary=Math.max(0,combined.length-hold),delta=combined.slice(0,boundary);tail=combined.slice(boundary);
     if(delta)yield {...event,delta};
    }else{
     // Keep a possible credential prefix until completion has also passed the
     // full response check. A secret split over several deltas cannot escape.
     if(event.type==='response.completed'&&tail){yield {type:'response.output_text.delta',delta:tail};tail='';}
     yield event;
    }
   }
  }catch(error){throw safeError(error,signal);}
  finally{stream.controller?.abort();}
 }
 async function invoke(owner,method,args,options={}){
  try{
   const result=await owner[method](args,{...options,maxRetries:0});
   if(result&&typeof result[Symbol.asyncIterator]==='function')return {controller:result.controller,[Symbol.asyncIterator]:()=>streamEvents(result,options.signal)};
   return check(result);
  }catch(error){throw safeError(error,options.signal);}
 }
 const protectedClient={baseURL:sdk.baseURL};
 if(sdk.responses){protectedClient.responses={};for(const method of ['create','compact'])if(typeof sdk.responses[method]==='function')protectedClient.responses[method]=(args,options)=>invoke(sdk.responses,method,args,options);}
 if(sdk.audio?.transcriptions?.create)protectedClient.audio={transcriptions:{create:(args,options)=>invoke(sdk.audio.transcriptions,'create',args,options)}};
 guards.set(protectedClient,protectedClient);return protectedClient;
}
function createConfiguredModelClient({apiKey='',baseUrl='',client,fetchImpl,localPort}={}){
 let destination;
 try{
  destination=endpoint(baseUrl||client?.baseURL||'https://api.openai.com/v1',{localPort});
  if(baseUrl&&client?.baseURL&&destination!==endpoint(client.baseURL,{localPort}))throw Error();
  if(!apiKey&&!client)return {client:null,configured:false,configurationError:null,baseURL:baseUrl||destination};
  if(!client){const OpenAI=require('openai');client=new OpenAI({apiKey,baseURL:baseUrl||destination,fetch:protectGenerationFetch(fetchImpl||fetch),maxRetries:0});}
  return {client:protectModelClient(client,{apiKey:apiKey||undefined,fetchImpl,localPort}),configured:true,configurationError:null,baseURL:client.baseURL||destination};
 }catch{return {client:null,configured:false,configurationError:'configuration_invalid',baseURL:null};}
}
module.exports={protectModelClient,createConfiguredModelClient,assertCredentialFree,assertCredentialFreeBytes};
