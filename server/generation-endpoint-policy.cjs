'use strict';
const {normalizeApiBaseUrl}=require('../generation-api.js');
const BLOCKED=['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
const localHost=host=>host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1'||host==='::1'||host==='::ffff:7f00:1';
const hostName=url=>url.hostname.toLowerCase().replace(/\.+$/,'').replace(/^\[|\]$/g,'');
const originalHost=host=>BLOCKED.some(domain=>host===domain||host.endsWith('.'+domain));
function assertNetworkDestination(value){
 let url;try{url=new URL(typeof value==='string'?value:value?.url||value?.href);}catch{throw Object.assign(Error('生成网络目标无效'),{code:'configuration_destination_forbidden'});}
 const host=hostName(url);
 if(!['http:','https:'].includes(url.protocol)||originalHost(host))throw Object.assign(Error('生成网络目标不允许'),{code:'configuration_destination_forbidden'});
}
// Suppliers may fetch a media URL in the POST body themselves. Checking only
// our transport destination would let that input restore an original dependency.
// These are explicit media slots; prompts, text inputs and arbitrary metadata
// are never scanned or rewritten. Other URL contracts remain provider-owned.
function assertIndependentMediaInputs(request){
 const check=value=>{
  if(typeof value!=='string')return;
  // Parse scheme-bearing values exactly as an independent supplier/fetch does;
  // a same-scheme base would reinterpret `http:tapnow.media/a` as a local path.
  let url;try{url=new URL(value);}catch{try{url=new URL(value,'http://localhost');}catch{return;}}
  if(['http:','https:'].includes(url.protocol)&&originalHost(hostName(url)))throw Object.assign(Error('原站媒体输入已停用，请重新导入本地资源'),{code:'original_service_blocked',status:400,providerDispatched:false});
 };
 const media=value=>{if(typeof value==='string'){check(value);return;}if(!value||typeof value!=='object'||Array.isArray(value)||value.type==='text')return;for(const key of ['url','image','fullImage','video','audio','model','poster','sourceUrl','sourceVideoUrl'])check(value[key]);};
 const list=value=>{if(Array.isArray(value))value.forEach(media);};
 if(!request||typeof request!=='object')return request;
 list(request.inputs);list(request.references);
 const parameters=request.parameters;
 if(parameters&&typeof parameters==='object'){
  list(parameters.refs);
  if(Array.isArray(parameters.subjects))for(const subject of parameters.subjects)list(subject?.assets);
  const estimate=parameters.draftEstimateMedia;if(estimate&&typeof estimate==='object')for(const key of ['images','videos','audios'])list(estimate[key]);
 }
 return request;
}
function protectGenerationFetch(fetchImpl){return (url,options={})=>{assertNetworkDestination(url);return fetchImpl(url,{...options,redirect:'error'});};}
function endpoint(value,{localPort}={}){
 const fail=code=>Object.assign(Error('生成服务地址无效或不允许'),{code,status:400});
 if(typeof value!=='string'||!value||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw fail('configuration_invalid');
 let result;try{result=normalizeApiBaseUrl(value);}catch{throw fail('configuration_invalid');}
 const url=new URL(result),host=hostName(url),port=Number(url.port||(url.protocol==='https:'?443:80));
 // Local self-hosting is explicit user configuration. Reject this listener and
 // original-site destinations before any credential-bearing network request.
 if(originalHost(host)||localPort&&port===Number(localPort)&&localHost(host))throw fail('configuration_destination_forbidden');
 return result;
}
module.exports={endpoint,localHost,hostName,assertNetworkDestination,protectGenerationFetch,assertIndependentMediaInputs};
