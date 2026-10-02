'use strict';
const {normalizeApiBaseUrl}=require('../generation-api.js');
const BLOCKED=['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
const localHost=host=>host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1'||host==='::1'||host==='::ffff:7f00:1';
const hostName=url=>url.hostname.toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
function assertNetworkDestination(value){
 let url;try{url=new URL(typeof value==='string'?value:value?.url||value?.href);}catch{throw Object.assign(Error('生成网络目标无效'),{code:'configuration_destination_forbidden'});}
 const host=hostName(url);
 if(!['http:','https:'].includes(url.protocol)||BLOCKED.some(domain=>host===domain||host.endsWith('.'+domain)))throw Object.assign(Error('生成网络目标不允许'),{code:'configuration_destination_forbidden'});
}
function protectGenerationFetch(fetchImpl){return (url,options={})=>{assertNetworkDestination(url);return fetchImpl(url,{...options,redirect:'error'});};}
function endpoint(value,{localPort}={}){
 const fail=code=>Object.assign(Error('生成服务地址无效或不允许'),{code,status:400});
 if(typeof value!=='string'||!value||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw fail('configuration_invalid');
 let result;try{result=normalizeApiBaseUrl(value);}catch{throw fail('configuration_invalid');}
 const url=new URL(result),host=hostName(url),port=Number(url.port||(url.protocol==='https:'?443:80));
 // Local self-hosting is explicit user configuration. Reject this listener and
 // original-site destinations before any credential-bearing network request.
 if(BLOCKED.some(domain=>host===domain||host.endsWith('.'+domain))||localPort&&port===Number(localPort)&&localHost(host))throw fail('configuration_destination_forbidden');
 return result;
}
module.exports={endpoint,localHost,hostName,assertNetworkDestination,protectGenerationFetch};
