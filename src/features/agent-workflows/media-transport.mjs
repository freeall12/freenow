import {serializeClipBlob} from './local-clip-resolver.mjs';

const MAX_REQUEST_BYTES=64*1024*1024;
const failure=(code,message)=>Object.assign(Error(message),{code});
const localHost=host=>host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='[::1]'||host==='0.0.0.0'||/^(127|10|192\.168)\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||/^169\.254\./.test(host);
const mimeFor=type=>new RegExp('^'+type+'/[a-z0-9.+-]+(?:;|$)','i');

export function assertWorkflowRequestBudget(request,maxRequestBytes=MAX_REQUEST_BYTES){
  if(!Number.isSafeInteger(maxRequestBytes)||maxRequestBytes<1||maxRequestBytes>MAX_REQUEST_BYTES)throw failure('invalid_transport_budget','生成请求预算须在 1–64 MiB 内');
  if(new TextEncoder().encode(JSON.stringify(request)).byteLength>maxRequestBytes)throw failure('media_request_too_large','完整生成请求超过内联预算，请接入媒体上传；没有压缩或截短素材');
}

export async function prepareWorkflowInputs(request,{
  signal,
  baseUrl=globalThis.document?.baseURI,
  fetchImpl=(...args)=>fetch(...args),
  serialize=serializeClipBlob,
  publishMedia,
  inlineImages=false,
  inlineVideos=false,
  maxMediaBytes=Infinity,
  validateSources=()=>{},
  maxRequestBytes=MAX_REQUEST_BYTES,
  timeoutMs=60000
}={}){
  if(!request||typeof request!=='object'||!Array.isArray(request.inputs))throw failure('invalid_media_request','生成请求缺少素材列表');
  if(!Number.isSafeInteger(maxRequestBytes)||maxRequestBytes<1||maxRequestBytes>MAX_REQUEST_BYTES)throw failure('invalid_transport_budget','生成请求预算须在 1–64 MiB 内');
  if(maxMediaBytes!==Infinity&&(!Number.isSafeInteger(maxMediaBytes)||maxMediaBytes<1||maxMediaBytes>MAX_REQUEST_BYTES))throw failure('invalid_transport_budget','单项素材预算须在 1–64 MiB 内');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw failure('invalid_timeout','素材传输超时须在 1–120000 毫秒之间');
  const prepared=structuredClone(request),encoder=new TextEncoder();
  const size=()=>encoder.encode(JSON.stringify(prepared)).byteLength;
  const budget=()=>{if(size()>maxRequestBytes)throw failure('media_request_too_large','完整生成请求超过内联预算，请接入媒体上传；没有压缩或截短素材');};
  const controller=new AbortController();let timer,rejectAbort;
  const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const cancel=()=>controller.abort(signal?.reason??failure('cancelled','素材传输已取消'));
  const onAbort=()=>rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>controller.abort(failure('media_transport_timeout','素材传输超时')),timeoutMs);
    const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;validateSources();};
  const wait=async operation=>{check();const value=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),interrupted]);check();return value;};
  function parse(value){try{return new URL(value,baseUrl);}catch{throw failure('invalid_media_url','素材地址无效');}}
  function publicUrl(value){const url=parse(value);return ['http:','https:'].includes(url.protocol)&&!localHost(url.hostname)&&(!baseUrl||url.origin!==parse(baseUrl).origin);}
  function dataMatches(value,type){const comma=value.indexOf(',');return comma>5&&comma<value.length-1&&mimeFor(type).test(value.slice(5,comma));}
  try{
    check();budget();
    for(const input of prepared.inputs){
      check();
      if(input?.type==='text'){if(typeof input.text!=='string')throw failure('invalid_media_input','文字参考缺少内容');continue;}
      if(!input||!['image','video','audio'].includes(input.type)||typeof input.url!=='string'||!input.url)throw failure('invalid_media_input','生成素材类型或地址无效');
      const url=parse(input.url);
      const forceInline=inlineImages&&input.type==='image'||inlineVideos&&input.type==='video';
      if(forceInline&&(url.username||url.password))throw failure('invalid_media_url','素材参考地址不能包含用户名或密码');
      if(url.protocol==='data:'){
        if(!dataMatches(input.url,input.type))throw failure('media_type_mismatch','内联素材类型与节点不符');
        continue;
      }
      const sameOrigin=!!baseUrl&&url.origin===parse(baseUrl).origin;
      if(['http:','https:'].includes(url.protocol)&&!sameOrigin){
        if(!publicUrl(input.url))throw failure('media_transport_unreachable','跨源本地素材不能直接发送远程模型，请先导入当前素材存储');
        if(!forceInline)continue;
      }
      if(url.protocol!=='blob:'&&!sameOrigin&&!(forceInline&&publicUrl(input.url)))throw failure('invalid_media_url','素材须先解析为实际媒体地址');
      if(!['http:','https:','blob:'].includes(url.protocol))throw failure('invalid_media_url','不支持此素材地址协议');
      let response;
      try{response=await wait(()=>fetchImpl(url.href,{signal:controller.signal,...forceInline?{mode:'cors',credentials:'omit',redirect:'error'}:{}}));}
      catch(error){check();if(forceInline)throw failure('media_transport_failed','素材参考读取失败，请检查跨域 CORS、网络和地址，或先导入本地素材');throw error;}
      if(!response?.ok)throw failure('media_transport_failed','本地素材读取失败');
      const currentBytes=size(),replacedBytes=encoder.encode(JSON.stringify(input.url)).byteLength;
      const inlineFits=bytes=>currentBytes-replacedBytes+Math.ceil(bytes/3)*4+128<=maxRequestBytes;
      const declared=Number(response.headers?.get?.('content-length'));
      const fits=bytes=>bytes<=maxMediaBytes&&(publishMedia||inlineFits(bytes));
      if(Number.isFinite(declared)&&declared>0&&!fits(declared)){response.body?.cancel?.().catch(()=>{});throw failure('media_request_too_large','素材超过请求内联预算，请接入媒体上传');}
      let blob;
      if(response.body?.getReader){
        const reader=response.body.getReader(),parts=[];let length=0,complete=false;
        try{for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}length+=chunk.value.byteLength;if(!fits(length))throw failure('media_request_too_large','素材超过请求内联预算，请接入媒体上传');parts.push(chunk.value);}blob=new Blob(parts,{type:response.headers.get('content-type')||''});}
        finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
      }else blob=await wait(()=>response.blob());
      if(!(blob instanceof Blob)||!blob.size||!mimeFor(input.type).test(blob.type))throw failure('media_type_mismatch','读取到的素材类型与节点不符或内容为空');
      if(!fits(blob.size))throw failure('media_request_too_large','素材超过完整请求内联预算，请接入媒体上传');
      const transported=await wait(()=>publishMedia?publishMedia(blob,{input:{...input},signal:controller.signal}):serialize(blob,{signal:controller.signal}));
      if(typeof transported!=='string'||(publishMedia?!publicUrl(transported):!transported.startsWith('data:')||!dataMatches(transported,input.type)))throw failure('invalid_media_transport','素材上传或编码未返回有效媒体地址');
      input.url=transported;budget();
    }
    check();budget();return prepared;
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);
    if(!controller.signal.aborted)controller.abort(failure('transport_finished','素材传输已结束'));
  }
}
