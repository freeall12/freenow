'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {rejectCredentials}=require('./generation-durable.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {publicMediaUrl,createGenerationMediaDownloader}=require('./generation-media-download.cjs');
const {assertNetworkDestination}=require('./generation-endpoint-policy.cjs');
const MAX_BYTES=32*1024*1024,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
const fail=(code='unknown',local=false)=>Object.assign(Error(local?'Ark 本地视频未通过发布配置或实际字节校验；尚未上传或提交生成':'Ark 素材发布或原任务尚未确认；不会重新上传或生成'),{code,...local?{providerDispatched:false}:{}});
const check=signal=>{if(signal?.aborted)throw signal.reason;};
const alias=r=>r.parameters?.providerParameters?.model??r.parameters?.modelId??r.parameters?.model;
const allowedProtocols=new Set(['fal-native','fal-video-native','fal-video-mask-native','fal-video-audio-native','fal-video-depth-native','fal-panorama-native']);

function arkVideoUploadConfiguration(modelMap,providers){
 const map=typeof modelMap==='string'?JSON.parse(modelMap):modelMap??{},clean=structuredClone(map),uploads={};
 if(!object(map))throw fail('configuration_invalid',true);
 for(const [name,entry]of Object.entries(map)){
  if(!object(entry))throw fail('configuration_invalid',true);
  if(entry.videoUploadProvider===undefined)continue;
  const id=entry.videoUploadProvider,provider=Object.hasOwn(providers,id)?providers[id]:null;
  if(typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)||!provider||!allowedProtocols.has(provider.protocol)||typeof provider.apiKey!=='string'||!provider.apiKey||provider.apiKey!==provider.apiKey.trim()||provider.apiKey.length>4096||/[\x00-\x1f\x7f]/.test(provider.apiKey))throw fail('configuration_invalid',true);
  if(provider.baseUrl){const u=new URL(provider.baseUrl);if(u.origin!=='https://queue.fal.run'||u.pathname!=='/'||u.username||u.password||u.search||u.hash)throw fail('configuration_invalid',true);}
  delete clean[name].videoUploadProvider;uploads[name]={providerId:id,apiKey:provider.apiKey};
 }
 return {modelMap:clean,uploads};
}

// Local MP4 publication is an opt-in host transport. Ark's generation API has
// no inline video upload; its Key is never sent to the separate fal storage API.
function createArkVideoMediaProvider({provider,uploads={},directory,apiKey='',uploaderFactory,mediaTools,download}={}){
 if(!provider||!path.isAbsolute(directory)||!object(uploads))throw fail('configuration_invalid',true);
 const protocol=provider.metadata.protocol,secrets=[apiKey,...Object.values(uploads).map(e=>e.apiKey)].filter(Boolean);
 const credentialFree=value=>{rejectCredentials(value);for(const key of secrets)assertCredentialFree(value,key);};
 const credentialFreeBytes=bytes=>{for(const key of secrets)assertCredentialFreeBytes(bytes,key);};
 const fingerprint=hash({protocol,provider:provider.fingerprint,uploads:Object.fromEntries(Object.entries(uploads).map(([a,e])=>[a,e.providerId]))});
 const videoUpload=Object.fromEntries(Object.entries(uploads).map(([a,e])=>[a,{providerId:e.providerId,transport:'fal-public-https',mimeTypes:['video/mp4'],maxBytes:MAX_BYTES,sourceFps:{min:24,max:30},publication:'public',message:'本地 MP4 将先发布至 fal 公网 HTTPS，再交给 Ark；需要独立 fal Key。'}]));
 const metadata={...provider.metadata,capabilities:{...provider.metadata.capabilities,videoUpload,preparationRecovery:'read-only'}};
 let tools=mediaTools;const media=()=>tools??=require('./generation-video-mask-media.cjs').createVideoMaskMediaTools({maxInputBytes:MAX_BYTES,maxSourceFrames:900});
 const downloader=download??createGenerationMediaDownloader({limits:{video:MAX_BYTES}}).download;
 function httpsUrl(value){credentialFree(value);if(typeof value!=='string'||value.includes('#'))throw fail('unsupported_generation',true);const u=publicMediaUrl(value);assertNetworkDestination(u);if(u.protocol!=='https:')throw fail('unsupported_generation',true);return u.href;}
 function inline(input){
  const m=/^data:video\/mp4;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.url);
  if(!m||m[1].length%4||m[1].length>Math.ceil(MAX_BYTES/3)*4)throw fail('unsupported_generation',true);
  const bytes=Buffer.from(m[1],'base64');if(!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==m[1]||input.sizeBytes!==undefined&&input.sizeBytes!==bytes.length||[input.mime,input.mimeType].some(v=>v!==undefined&&v!=='video/mp4'))throw fail('unsupported_generation',true);
  credentialFreeBytes(bytes);require('./generation-video-mask-media.cjs').mediaInternals.envelope({bytes,mime:'video/mp4'},MAX_BYTES,false,true);return bytes;
 }
 function replace(request,replacements){
  const r=structuredClone(request),original=request.inputs??[];
  r.inputs=(r.inputs??[]).map((input,i)=>replacements.has(i)?{...input,url:replacements.get(i)}:input);
  if(Array.isArray(r.parameters?.subjects))for(const subject of r.parameters.subjects)for(const asset of subject.assets??[]){const index=original.findIndex(input=>input.type===asset.type&&input.url===asset.url);if(index!==-1&&replacements.has(index))asset.url=replacements.get(index);}
  return r;
 }
 function resolve(request){
  credentialFree(request);
  if(!object(request)||Buffer.byteLength(canonical(request))>64*1024*1024)throw fail('unsupported_generation',true);
  const publishing=Object.hasOwn(uploads,alias(request))?uploads[alias(request)]:null,files=new Map(),replacements=new Map();
  for(const [index,input]of (request.inputs??[]).entries()){
   if(input.type!=='video')continue;
   if(typeof input.url!=='string')throw fail('unsupported_generation',true);
   if(input.url.startsWith('data:')){if(!publishing)throw fail('configuration_required',true);files.set(index,inline(input));replacements.set(index,'https://v3.fal.media/freenow-preflight/'+hash(files.get(index))+'.mp4');}
   else httpsUrl(input.url);
  }
  provider.prepare(replace(request,replacements));return {publishing,files};
 }
 const prepare=request=>{resolve(request);return request;};
 const folder=id=>{if(!UUID.test(id))throw fail('provider_identity_mismatch');return path.join(directory,id);};
 async function privateDirectory(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.mode&0o077)throw fail('storage_error');}
 async function writeFile(dir,name,bytes){const h=await fs.open(path.join(dir,name),'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
 async function manifestWrite(m){credentialFree(m);const dir=folder(m.preparationId),name='.'+randomUUID()+'.tmp';await writeFile(dir,name,canonical(m));await fs.rename(path.join(dir,name),path.join(dir,'manifest.json'));const h=await fs.open(dir,'r');try{await h.sync();}finally{await h.close();}}
 async function readFile(dir,name,max){const h=await fs.open(path.join(dir,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();if(!s.isFile()||s.nlink!==1||s.mode&0o077||s.size<1||s.size>max)throw fail();const bytes=await h.readFile();if(bytes.length!==s.size)throw fail();credentialFreeBytes(bytes);return bytes;}finally{await h.close();}}
 async function manifestRead(id){const dir=folder(id),s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.mode&0o077)throw fail();const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(dir,'manifest.json',2*1024*1024)));credentialFree(m);if(m.version!==1||m.protocol!==protocol||m.preparationId!==id||m.fingerprint!==fingerprint||!Object.hasOwn(uploads,m.alias)||!/^[a-f0-9]{64}$/.test(m.requestHash))throw fail('provider_configuration_changed');return m;}
 async function checkpoint(m,stage,status,callback){m.stage=stage;m.status=status;await manifestWrite(m);await callback({version:1,protocol,preparationId:m.preparationId,kind:m.kind,stage,status,requestHash:m.requestHash});}
 function bind(m,options={}){if(options.localTaskId!==undefined&&options.localTaskId!==m.localTaskId||options.request&&hash(options.request)!==m.requestHash||options.preparationState&&(options.preparationState.preparationId!==m.preparationId||options.preparationState.requestHash!==m.requestHash||options.preparationState.protocol!==protocol||options.preparationState.kind!==m.kind))throw fail('provider_identity_mismatch');}
 const envelope=(m,id)=>'av1.'+Buffer.from(JSON.stringify([m.preparationId,id])).toString('base64url');
 function identity(id){let a;try{if(typeof id!=='string'||!/^av1\.[A-Za-z0-9_-]{1,1800}$/.test(id))throw Error();a=JSON.parse(Buffer.from(id.slice(4),'base64url'));if(!Array.isArray(a)||a.length!==2||!UUID.test(a[0])||typeof a[1]!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(a[1])||envelope({preparationId:a[0]},a[1])!==id)throw Error();}catch{throw fail('provider_identity_mismatch');}return a;}
 async function inspect(bytes,input,signal){
  require('./generation-video-mask-media.cjs').mediaInternals.envelope({bytes,mime:'video/mp4'},MAX_BYTES,false,true);
  const actual=await media().inspectVideo({bytes,mime:'video/mp4'},{signal});credentialFree(actual);
  // The reference-video minimum area does not apply to generated 480p square
  // or 4:3 results. Output geometry is decoded truth within the local budget.
  if(![actual.width,actual.height,actual.numFrames].every(n=>Number.isSafeInteger(n)&&n>0)||actual.width*actual.height>16777216||!Number.isFinite(actual.duration)||actual.duration<=0||actual.duration>30||!Number.isFinite(actual.fps)||actual.fps<5||actual.fps>30||actual.numFrames>900)throw fail(input?'ark_video_preparation_failed':'unknown',!!input);
  if(input&&(![actual.width,actual.height].every(n=>n>=300&&n<=6000)||actual.width/actual.height<.4||actual.width/actual.height>2.5||actual.width*actual.height<407696||actual.width*actual.height>8295044||actual.duration<2||actual.fps<24))throw fail('ark_video_preparation_failed',true);
  if(input)for(const [value,expected,tolerance]of [[input.width,actual.width,0],[input.height,actual.height,0],[input.duration,actual.duration,.001],[input.durationMs===undefined?undefined:input.durationMs/1000,actual.duration,.001],[input.fps,actual.fps,.001]])if(value!==undefined&&(!Number.isFinite(value)||Math.abs(value-expected)>tolerance))throw fail('ark_video_preparation_failed',true);
  return actual;
 }
 async function submit(request,options={}){
  request=structuredClone(request);const {files,publishing}=resolve(request);if(!files.size){const value=await provider.submit(request,options);credentialFree(value);await options.onTaskIdentity?.(value.id);return value;}
  const {signal,onPreparationState=async()=>{},onTaskIdentity=async()=>{},localTaskId}=options;
  if(typeof onPreparationState!=='function'||typeof onTaskIdentity!=='function'||localTaskId!==undefined&&!UUID.test(localTaskId))throw fail('invalid_preparation_state',true);
  const m={version:1,protocol,preparationId:randomUUID(),fingerprint,alias:alias(request),kind:request.kind,requestHash:hash(request),files:{},...localTaskId?{localTaskId}:{}},replacements=new Map();let remoteStarted=false;
  try{
   check(signal);await privateDirectory(directory);await privateDirectory(folder(m.preparationId));await checkpoint(m,'media-preparing','preparing',onPreparationState);
   // Decode every source before publishing any file. A later invalid reference
   // must not leave a partial remote disclosure or an accidentally paid task.
   for(const [i,bytes]of files){const metadata=await inspect(bytes,request.inputs[i],signal);await writeFile(folder(m.preparationId),i+'.bin',bytes);m.files[i]={bytes:bytes.length,sha256:hash(bytes),mime:'video/mp4',metadata};}
   await checkpoint(m,'media-ready','ready',onPreparationState);check(signal);
   const uploader=uploaderFactory?uploaderFactory(publishing):require('./generation-fal-upload.cjs').createFalUpload({apiKey:publishing.apiKey,maxBytes:MAX_BYTES});
   for(const [i,bytes]of files){
    check(signal);
    const f=m.files[i],value=await uploader.upload({bytes,mime:'video/mp4',fileName:'reference-'+i+'.mp4'},{signal,onStage:async event=>{remoteStarted=true;credentialFree(event);f.upload=structuredClone(event);const stages={initiating:['upload-initiating','dispatching'],initiated:['upload-initiated','confirmed'],uploading:['uploading','dispatching'],uploaded:['uploaded','confirmed']};const [stage,status]=stages[event.stage]??['unknown','unknown'];await checkpoint(m,stage,status,onPreparationState);}});
    remoteStarted=true;credentialFree(value);if(value?.status!=='uploaded'||value.mime!==f.mime||value.bytes!==f.bytes||value.sha256!==f.sha256)throw fail();f.fileUrl=httpsUrl(value.fileUrl);replacements.set(i,f.fileUrl);await checkpoint(m,'uploaded','confirmed',onPreparationState);
   }
   const translated=replace(request,replacements);provider.prepare(translated);check(signal);await checkpoint(m,'generation-dispatching','dispatching',onPreparationState);remoteStarted=true;
   const accept=async raw=>{if(typeof raw!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(raw)||m.requestId&&m.requestId!==raw)throw fail('provider_identity_mismatch');credentialFree(raw);m.requestId=raw;await checkpoint(m,'generation-accepted','confirmed',onPreparationState);await onTaskIdentity(envelope(m,raw));};
   const value=await provider.submit(translated,{...options,onPreparationState:undefined,onTaskIdentity:accept});if(!m.requestId)await accept(value.id);if(value.id!==m.requestId)throw fail('provider_identity_mismatch');return {...value,id:envelope(m,value.id)};
  }catch(error){if(signal?.aborted)throw signal.reason;if(['storage_error','invalid_preparation_state','provider_identity_mismatch'].includes(error.code))throw error;if(remoteStarted)throw fail();throw fail('ark_video_preparation_failed',true);}
 }
 async function resumePreparation(state,options={}){if(!state||state.version!==1||state.protocol!==protocol||!UUID.test(state.preparationId))throw fail('invalid_preparation_state');const m=await manifestRead(state.preparationId);bind(m,{...options,preparationState:state});check(options.signal);return m.requestId?{id:envelope(m,m.requestId),status:'queued'}:{status:'unknown',code:'media_preparation_unconfirmed'};}
 async function resultBytes(url,signal){const resource=await downloader(httpsUrl(url),{kind:'video',signal});try{if(resource.mime!=='video/mp4')throw fail();const parts=[];let size=0;for await(const chunk of resource.stream){check(signal);if(!(chunk instanceof Uint8Array)||(size+=chunk.length)>MAX_BYTES)throw fail();parts.push(Buffer.from(chunk));}if(!size||resource.expectedBytes!==undefined&&resource.expectedBytes!==size)throw fail();const bytes=Buffer.concat(parts);credentialFreeBytes(bytes);require('./generation-video-mask-media.cjs').mediaInternals.envelope({bytes,mime:'video/mp4'},MAX_BYTES,false,true);return bytes;}finally{resource.close?.();}}
 const busy=new Map();
 async function poll(id,options={}){
  if(typeof id!=='string')throw fail('provider_identity_mismatch');
  if(!id.startsWith('av1.'))return provider.poll(id,options);
  const [preparationId,raw]=identity(id),m=await manifestRead(preparationId);bind(m,options);if(m.requestId!==raw)throw fail('provider_identity_mismatch');if(busy.has(id))return busy.get(id);
  const operation=(async()=>{
   check(options.signal);
   const output=async()=>{const bytes=await readFile(folder(preparationId),'result.bin',MAX_BYTES);if(m.result.bytes!==bytes.length||m.result.sha256!==hash(bytes))throw fail();const actual=await inspect(bytes,null,options.signal);if(hash(actual)!==hash(m.result.metadata))throw fail();return {id,status:'succeeded',outputs:[{type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),mime:'video/mp4',width:actual.width,height:actual.height,duration:actual.duration,sourceFileId:raw}]};};
   if(m.result)return output();const value=await provider.poll(raw,options);credentialFree(value);if(value.id!==raw)throw fail('provider_identity_mismatch');if(value.status!=='succeeded')return {...value,id};
   if(value.outputs?.length!==1||value.outputs[0]?.type!=='video')throw fail();const bytes=await resultBytes(value.outputs[0].url,options.signal),actual=await inspect(bytes,null,options.signal);
   if(value.outputs[0].duration!==undefined&&Math.abs(value.outputs[0].duration-actual.duration)>.1)throw fail();const resultTemporary='.'+randomUUID()+'.result.tmp';await writeFile(folder(preparationId),resultTemporary,bytes);await fs.rename(path.join(folder(preparationId),resultTemporary),path.join(folder(preparationId),'result.bin'));m.result={bytes:bytes.length,sha256:hash(bytes),metadata:actual};await manifestWrite(m);return output();
  })();busy.set(id,operation);try{return await operation;}finally{busy.delete(id);}
 }
 async function generate(request,{pollInterval=1500,timeout=1800000,onProgress=()=>{},...options}={}){
  if(!resolve(request).files.size)return provider.generate(request,{...options,pollInterval,timeout,onProgress});
  if(!Number.isFinite(pollInterval)||pollInterval<1||pollInterval>30000||!Number.isFinite(timeout)||timeout<1||timeout>1800000)throw fail('unsupported_generation',true);
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{
   let value=await submit(request,{...options,signal});
   while(['queued','running'].includes(value.status)){onProgress(value.progress??0);await require('node:timers/promises').setTimeout(pollInterval,undefined,{signal});value=await poll(value.id,{...options,signal});}
   if(value.status!=='succeeded')throw fail(value.status);
   return value;
  }catch(error){if(options.signal?.aborted)throw options.signal.reason;if(signal.aborted)throw fail();throw error;}
 }
 return {...provider,fingerprint,metadata,prepare,submit,poll,generate,resumePreparation};
}
module.exports={createArkVideoMediaProvider,arkVideoUploadConfiguration,MAX_BYTES};
