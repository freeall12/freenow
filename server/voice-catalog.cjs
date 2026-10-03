'use strict';
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree}=require('./outbound-client.cjs');
const {createGenerationMediaDownloader,publicMediaUrl}=require('./generation-media-download.cjs');
const {validateMP3,waveMetadata}=require('./generation-openai-speech.cjs');
const MiB=1024*1024,MODELS=new Set(['eleven_v3','elevenlabs-v3','elevenlabs']);
const messages={voice_catalog_configuration_required:'音色库未配置，请在服务端设置 ElevenLabs Key 和供应商。',voice_catalog_model_unavailable:'此模型尚未接入真实音色库。',voice_catalog_invalid_input:'音色库请求参数无效。',voice_catalog_upstream_failed:'音色库服务请求失败，请检查服务端配置后重试。',voice_catalog_response_rejected:'音色库响应未通过安全校验。',voice_catalog_timeout:'音色库请求超时，请重试。',voice_catalog_busy:'音色库请求繁忙，请稍后重试。',voice_catalog_cancelled:'音色库请求已取消。',voice_preview_unavailable:'此音色暂无可用试听，请刷新音色库后重试。'};
const fail=(code,status=502)=>Object.assign(Error(messages[code]),{code,status});
function text(value,max,{empty=false}={}){if(typeof value!=='string'||value.length>max||!empty&&!value.length||/[\x00-\x1f\x7f]/.test(value))throw fail('voice_catalog_response_rejected');return value;}
function check(signal){if(signal?.aborted)throw fail(signal.reason?.name==='TimeoutError'?'voice_catalog_timeout':'voice_catalog_cancelled',signal.reason?.name==='TimeoutError'?504:499);}
async function bounded(operation,signal){
 check(signal);let stop;const aborted=new Promise((_,reject)=>{stop=()=>{try{check(signal);}catch(e){reject(e);}};signal.addEventListener('abort',stop,{once:true});});
 try{return await Promise.race([Promise.resolve().then(operation),aborted]);}finally{signal.removeEventListener('abort',stop);}
}
async function readJson(response,signal,max){
 if(!response.ok||response.status!==200||response.redirected)throw fail('voice_catalog_upstream_failed');
 const type=response.headers.get('content-type')||'',length=response.headers.get('content-length');
 if(!/^application\/json(?:;|$)/i.test(type)||length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw fail('voice_catalog_response_rejected');
 if(!response.body)throw fail('voice_catalog_response_rejected');
 const reader=response.body.getReader(),chunks=[];let size=0,complete=false;
 try{for(;;){const part=await bounded(()=>reader.read(),signal);if(part.done)break;size+=part.value.byteLength;if(size>max)throw fail('voice_catalog_response_rejected');chunks.push(Buffer.from(part.value));}check(signal);const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));complete=true;return result;}
 catch(e){if(e.code?.startsWith('voice_'))throw e;throw fail('voice_catalog_response_rejected');}
 finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function createVoiceCatalog({provider='elevenlabs',apiKey='',baseUrl='https://api.elevenlabs.io',localPort,fetchImpl=fetch,downloader,timeoutMs=20000,now=Date.now,maxConcurrent=4,catalogTtlMs=30000,previewTtlMs=60000}={}){
 let destination,configured=false;
 try{destination=endpoint(baseUrl,{localPort});const url=new URL(destination);if(url.pathname!=='/'||provider!=='elevenlabs'||typeof apiKey!=='string'||!apiKey||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))throw Error();assertCredentialFree(destination,apiKey);configured=true;}catch{}
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>8)throw Error('Invalid voice catalog limits');
 const transport=protectGenerationFetch(fetchImpl),media=downloader||createGenerationMediaDownloader({timeoutMs,limits:{audio:8*MiB}});
 const pages=new Map(),registry=new Map(),previews=new Map(),active=new Set();let previewBytes=0,closed=false;
 function prune(){const time=now();for(const [key,item]of pages)if(item.expires<=time)pages.delete(key);for(const [key,item]of registry)if(item.expires<=time)registry.delete(key);for(const [key,item]of previews)if(item.expires<=time){previewBytes-=item.bytes.length;previews.delete(key);}}
 function available(model){if(!MODELS.has(model))throw fail('voice_catalog_model_unavailable',503);if(!configured||closed)throw fail('voice_catalog_configuration_required',503);}
 async function run(signal,operation){
  check(signal);if(active.size>=maxConcurrent)throw fail('voice_catalog_busy',429);
  const controller=new AbortController(),combined=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);active.add(controller);
  try{return await bounded(()=>operation(combined),combined);}catch(e){check(combined);if(e.code?.startsWith('voice_'))throw e;if(e.code==='provider_response_rejected'||e.code?.startsWith('media_'))throw fail('voice_catalog_response_rejected');throw fail('voice_catalog_upstream_failed');}finally{controller.abort();active.delete(controller);}
 }
 async function list({model='eleven_v3',cursor='',pageSize=100,search='',signal}={}){
  available(model);check(signal);
  if(typeof cursor!=='string'||cursor.length>2048||/[\x00-\x1f\x7f]/.test(cursor)||typeof search!=='string'||search.length>200||/[\x00-\x1f\x7f]/.test(search)||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw fail('voice_catalog_invalid_input',400);
  prune();const cacheKey=JSON.stringify([cursor,pageSize,search]),cached=pages.get(cacheKey);if(cached)return structuredClone(cached.result);
  return run(signal,async combined=>{
   const url=new URL('v2/voices',destination);url.searchParams.set('page_size',String(pageSize));url.searchParams.set('include_total_count','false');if(cursor)url.searchParams.set('next_page_token',cursor);if(search)url.searchParams.set('search',search);
   const response=await bounded(()=>transport(url,{method:'GET',headers:{'xi-api-key':apiKey,Accept:'application/json'},signal:combined}),combined);
   let raw;try{raw=await readJson(response,combined,MiB);}finally{void response.body?.cancel().catch(()=>{});}
   assertCredentialFree(raw,apiKey);
   if(!raw||!Array.isArray(raw.voices)||raw.voices.length>200||typeof raw.has_more!=='boolean')throw fail('voice_catalog_response_rejected');
   const token=raw.next_page_token==null?null:text(raw.next_page_token,2048);if(raw.has_more&&(!token||token===cursor))throw fail('voice_catalog_response_rejected');
   const seen=new Set(),descriptors=[];
   const voices=raw.voices.map(voice=>{
    if(!voice||typeof voice!=='object'||typeof voice.voice_id!=='string'||!/^[-\w]{1,128}$/.test(voice.voice_id)||seen.has(voice.voice_id))throw fail('voice_catalog_response_rejected');seen.add(voice.voice_id);
    const labels=voice.labels??{};if(!labels||typeof labels!=='object'||Array.isArray(labels)||Object.keys(labels).length>32)throw fail('voice_catalog_response_rejected');
    const cleaned=Object.fromEntries(Object.entries(labels).map(([key,value])=>[text(key,80),text(value,256,{empty:true})]));
    const result={id:voice.voice_id,name:text(voice.name,256),labels:cleaned,category:voice.category==null?'':text(voice.category,64,{empty:true})};
    if(voice.description!=null)result.description=text(voice.description,4096,{empty:true});
    if(voice.preview_url){const preview=publicMediaUrl(voice.preview_url).href;assertCredentialFree(preview,apiKey);descriptors.push({id:result.id,url:preview});result.previewRef=result.id;result.previewUrl=`/api/generation/voices/${encodeURIComponent(result.id)}/preview?model=eleven_v3`;}
    return result;
   });
   const result={configured:true,provider:'elevenlabs',model:'eleven_v3',voices,hasMore:raw.has_more,nextCursor:raw.has_more?token:null};assertCredentialFree(result,apiKey);check(combined);
   for(const item of descriptors){const old=registry.get(item.id);if(old&&old.url!==item.url){const preview=previews.get(item.id);if(preview){previewBytes-=preview.bytes.length;previews.delete(item.id);}}registry.delete(item.id);const descriptor=old?.url===item.url?old:{url:item.url};descriptor.expires=now()+300000;registry.set(item.id,descriptor);}
   // A refreshed voice without a preview must not retain its old descriptor.
   for(const voice of voices)if(!voice.previewRef){registry.delete(voice.id);const old=previews.get(voice.id);if(old){previewBytes-=old.bytes.length;previews.delete(voice.id);}}
   while(registry.size>1000){const id=registry.keys().next().value;registry.delete(id);const old=previews.get(id);if(old){previewBytes-=old.bytes.length;previews.delete(id);}}
   pages.set(cacheKey,{result,expires:now()+catalogTtlMs});while(pages.size>20)pages.delete(pages.keys().next().value);
   return structuredClone(result);
  });
 }
 async function preview({id,model='eleven_v3',signal}={}){
  available(model);check(signal);if(typeof id!=='string'||!/^[-\w]{1,128}$/.test(id))throw fail('voice_catalog_invalid_input',400);
  prune();const descriptor=registry.get(id);if(!descriptor)throw fail('voice_preview_unavailable',404);const cached=previews.get(id);if(cached)return {mime:cached.mime,bytes:Buffer.from(cached.bytes)};
  return run(signal,async combined=>{
   // Only a catalog-derived public URL is downloaded. Never forward the API Key
   // to a CDN or accept an arbitrary URL supplied by the browser.
   const downloaded=await bounded(()=>media.download(descriptor.url,{kind:'audio',signal:combined}),combined);let size=0;const chunks=[];
   try{for await(const chunk of downloaded.stream){check(combined);size+=chunk.length;if(size>8*MiB)throw fail('voice_catalog_response_rejected');chunks.push(Buffer.from(chunk));}}finally{downloaded.close();}
   check(combined);const bytes=Buffer.concat(chunks);if(!size||!['audio/mpeg','audio/wav'].includes(downloaded.mime))throw fail('voice_catalog_response_rejected');
   try{if(downloaded.mime==='audio/mpeg')validateMP3(bytes);else waveMetadata(bytes);}catch{throw fail('voice_catalog_response_rejected');}
   assertCredentialFree(bytes.toString('utf8'),apiKey);
   if(registry.get(id)!==descriptor||descriptor.expires<=now())throw fail('voice_preview_unavailable',404);
   const item={mime:downloaded.mime,bytes,expires:now()+previewTtlMs};const old=previews.get(id);if(old)previewBytes-=old.bytes.length;previews.delete(id);previews.set(id,item);previewBytes+=size;
   while(previewBytes>24*MiB||previews.size>32){const first=previews.keys().next().value;previewBytes-=previews.get(first).bytes.length;previews.delete(first);}
   return {mime:item.mime,bytes:Buffer.from(bytes)};
  });
 }
 async function handle(req,res,pathname,{json}){
  const abort=new AbortController(),cancel=()=>{if(!res.writableEnded)abort.abort();};res.on('close',cancel);
  try{
   if(!['GET','HEAD'].includes(req.method)||pathname==='/api/generation/voices'&&req.method!=='GET')return json(res,405,{code:'voice_catalog_method_not_allowed',error:'音色库只支持读取。'});
   const url=new URL(req.url,'http://localhost'),model=url.searchParams.get('model')||'eleven_v3';let result;
   if(pathname==='/api/generation/voices'){
    const size=url.searchParams.get('pageSize');if(size!==null&&!/^\d{1,3}$/.test(size))throw fail('voice_catalog_invalid_input',400);
    result=await list({model,cursor:url.searchParams.get('cursor')||'',pageSize:size===null?100:Number(size),search:url.searchParams.get('search')||'',signal:abort.signal});return json(res,200,result);
   }
   const match=/^\/api\/generation\/voices\/([^/]+)\/preview$/.exec(pathname);if(!match)throw fail('voice_preview_unavailable',404);
   result=await preview({id:match[1],model,signal:abort.signal});
   const headers={'Content-Type':result.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};let start=0,end=result.bytes.length-1,status=200;
   if(req.headers.range){const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!range||!range[1]&&!range[2]){res.writeHead(416,{'Content-Range':`bytes */${result.bytes.length}`});return res.end();}if(range[1]){start=Number(range[1]);if(range[2])end=Math.min(Number(range[2]),end);}else start=Math.max(0,result.bytes.length-Number(range[2]));if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=result.bytes.length){res.writeHead(416,{'Content-Range':`bytes */${result.bytes.length}`});return res.end();}status=206;headers['Content-Range']=`bytes ${start}-${end}/${result.bytes.length}`;}
   headers['Content-Length']=end-start+1;res.writeHead(status,headers);return res.end(req.method==='HEAD'?undefined:result.bytes.subarray(start,end+1));
  }catch(e){if(!res.destroyed&&!res.headersSent)json(res,e.status||502,{configured:false,code:e.code||'voice_catalog_upstream_failed',error:messages[e.code]||messages.voice_catalog_upstream_failed});}finally{res.removeListener('close',cancel);}
 }
 function close(){closed=true;for(const controller of active)controller.abort();pages.clear();registry.clear();previews.clear();previewBytes=0;}
 return {list,preview,handle,close};
}
module.exports={createVoiceCatalog};
