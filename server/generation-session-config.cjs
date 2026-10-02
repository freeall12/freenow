'use strict';
const {randomUUID,randomBytes,timingSafeEqual}=require('node:crypto');
const {createTasksProvider}=require('./generation-router.cjs');
const {endpoint,localHost,hostName}=require('./generation-endpoint-policy.cjs');
const CONFIG_LIMIT=16*1024;
const failure=(code,status=400)=>Object.assign(Error('本机生成配置未保存，请检查地址、Key 与请求来源'),{code,status});
const localAddress=value=>value==='127.0.0.1'||value==='::1'||value==='::ffff:127.0.0.1';
function validBinding(binding){
 return !!binding&&typeof binding==='object'&&!Array.isArray(binding)&&Object.keys(binding).sort().join(',')==='fingerprint,id,source,version'&&binding.version===1&&['environment','session'].includes(binding.source)&&(binding.source==='environment'?binding.id==='environment':typeof binding.id==='string'&&/^[a-f0-9-]{36}$/.test(binding.id))&&(binding.fingerprint===null&&binding.source==='environment'||typeof binding.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(binding.fingerprint));
}
function createGenerationSessionConfiguration({environment,fetchImpl=fetch,localPort,maxVersions=100}={}){
 const versions=new Map(),restoredVersions=new Map(),latestByFingerprint=new Map(),csrfToken=randomBytes(32).toString('base64url'),environmentId=randomUUID();
 const environmentBinding={version:1,source:'environment',id:'environment',fingerprint:environment.fingerprint};
 let current={binding:environmentBinding,transport:environment};
 function capture(configurationId){
  if(configurationId===undefined)return structuredClone(current.binding);
  if(configurationId===environmentId)return structuredClone(environmentBinding);
  if(typeof configurationId==='string'&&versions.has(configurationId))return structuredClone(versions.get(configurationId).binding);
  throw Object.assign(failure('configuration_changed',409),{providerDispatched:false});
 }
 function resolve(binding){
  if(!validBinding(binding))return null;
  if(binding.source==='environment')return binding.fingerprint===environment.fingerprint?environment:null;
  // Same-process identities keep their exact key version. After restart only
  // an explicitly configured matching non-secret endpoint can recover an ID.
  let version=versions.get(binding.id)||restoredVersions.get(binding.id);
  if(!version){version=latestByFingerprint.get(binding.fingerprint);if(version?.binding.fingerprint===binding.fingerprint)restoredVersions.set(binding.id,version);}
  return version?.binding.fingerprint===binding.fingerprint?version.transport:null;
 }
 function metadata(){return {...current.transport.metadata,source:current.binding.source,configurationId:current.binding.source==='environment'?environmentId:current.binding.id,csrfToken};}
 function configure(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw failure('configuration_invalid');
  if(Object.keys(input).length===1&&input.mode==='environment'){current={binding:environmentBinding,transport:environment};return metadata();}
  if(Object.keys(input).sort().join(',')!=='apiKey,baseUrl'||typeof input.apiKey!=='string'||Buffer.byteLength(input.apiKey)>8192||/[\x00-\x1f\x7f]/.test(input.apiKey))throw failure('configuration_invalid');
  if(versions.size>=maxVersions)throw failure('configuration_capacity',429);
  const baseUrl=endpoint(input.baseUrl,{localPort}),provider=createTasksProvider({baseUrl,apiKey:input.apiKey,fetchImpl,allowUnauthenticated:true,rejectCredentialEcho:true});
  if(!provider.configured)throw failure('configuration_invalid');
  const binding={version:1,source:'session',id:randomUUID(),fingerprint:provider.fingerprint};
  const version={binding,transport:{provider,configured:true,fingerprint:provider.fingerprint,metadata:provider.metadata}};
  versions.set(binding.id,version);latestByFingerprint.set(binding.fingerprint,version);current=version;
  return metadata();
 }
 function authorize(req){
  let origin;try{origin=new URL('http://'+req.headers?.host);}catch{throw failure('configuration_origin_forbidden',403);}
  if(!localHost(hostName(origin))||localPort&&Number(origin.port||80)!==Number(localPort)||!localAddress(req.socket?.remoteAddress)||req.headers?.origin!==origin.origin||req.headers?.['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')throw failure('configuration_origin_forbidden',403);
  const token=req.headers?.['x-generation-config-token'];
  if(typeof token!=='string'||Buffer.byteLength(token)!==Buffer.byteLength(csrfToken)||!timingSafeEqual(Buffer.from(token),Buffer.from(csrfToken)))throw failure('configuration_csrf_forbidden',403);
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers?.['content-type']||''))throw failure('configuration_content_type',415);
 }
 async function read(req){
  if(Number(req.headers?.['content-length'])>CONFIG_LIMIT)throw failure('configuration_too_large',413);
  const parts=[];let size=0;
  for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>CONFIG_LIMIT)throw failure('configuration_too_large',413);parts.push(Buffer.from(chunk));}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw failure('configuration_invalid');}
 }
 async function handle(req,res,{json}){
  try{authorize(req);const input=await read(req);return json(res,200,configure(input));}
  catch(error){return json(res,error.status||400,{code:error.code||'configuration_invalid',error:'本机生成配置未保存，请检查地址、Key 与请求来源'});}
 }
 return {capture,resolve,metadata,configure,handle,validBinding};
}
module.exports={createGenerationSessionConfiguration,validBinding,endpoint};
