import {isStaticAssetRef,validateResourceIndex} from './index-format.mjs';

const failure=(message,cause)=>Object.assign(Error(message),{code:'media_unavailable',...(cause?{cause}:{})});
const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('本地素材导入已取消','AbortError');};
const digest=async bytes=>{
  if(!globalThis.crypto?.subtle)throw failure('当前环境无法核对素材内容');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
};
const mediaMime=(mime,kind)=>kind==='model'?mime.startsWith('model/')||mime==='application/octet-stream':kind?mime.startsWith(kind+'/'):/^(image|video|audio|model)\//.test(mime)||mime==='application/octet-stream';

// Inputs are a mapped local ref and its complete trusted index. Validation and
// bounded byte verification must finish before AssetStore receives any Blob.
export async function importIndexedAsset(source,{index,assets,fetchImpl=globalThis.fetch,signal,maxBytes=80*1024*1024,expectedKind,hashBytes=digest,beforePut=()=>{}}={}){
  check(signal);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>100*1024*1024||expectedKind&&!['image','video','audio','model'].includes(expectedKind))throw failure('本地素材导入预算或类型无效');
  if(!isStaticAssetRef(source)||typeof assets?.put!=='function'||typeof fetchImpl!=='function'||typeof hashBytes!=='function')throw failure('本地素材导入适配器或引用无效');
  const validated=validateResourceIndex(index),ref='/assets/'+source.replace(/^(?:\.\/|\/)?assets\//,'');
  const matches=Object.values(validated.entries).filter(entry=>entry.ref===ref),row=matches[0];
  if(row&&matches.some(entry=>entry.sha256!==row.sha256||entry.bytes!==row.bytes))throw failure('同一本地素材的索引校验值冲突');
  if(!row||row.bytes>maxBytes)throw failure('本地素材不在可信索引中或超过导入预算');
  let response;
  try{response=await fetchImpl(ref,{signal,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store'});}catch(error){check(signal);throw failure('可信本地素材读取失败',error);}
  check(signal);
  const rejectResponse=message=>{try{Promise.resolve(response?.body?.cancel?.()).catch(()=>{});}catch{/* Stop an unread stream without replacing the error. */}throw failure(message);};
  if(!response?.ok||response.redirected||!response.body?.getReader)rejectResponse('可信本地素材没有可读取的字节流');
  const mime=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=response.headers?.get('content-length');
  if(!mediaMime(mime,expectedKind)||length!=null&&(!/^\d+$/.test(length)||Number(length)!==row.bytes))rejectResponse('本地素材类型或声明长度与索引不符');
  const reader=response.body.getReader(),chunks=[];let size=0;
  const cancel=()=>{try{Promise.resolve(reader.cancel(signal?.reason)).catch(()=>{});}catch{/* Preserve the validation failure. */}};
  signal?.addEventListener('abort',cancel,{once:true});
  try{
    for(;;){check(signal);const {done,value}=await reader.read();check(signal);if(done)break;
      if(!(value instanceof Uint8Array)||size+value.byteLength>row.bytes||size+value.byteLength>maxBytes)throw failure('本地素材实际字节超过索引或导入预算');
      size+=value.byteLength;chunks.push(value);
    }
  }catch(error){cancel();throw error;}
  finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
  if(size!==row.bytes)throw failure('本地素材实际长度与索引不符');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const actual=await hashBytes(bytes);check(signal);if(actual!==row.sha256)throw failure('本地素材实际内容与索引不符');
  beforePut();check(signal);
  const saved=await assets.put(new Blob([bytes],{type:mime}));check(signal);
  if(typeof saved!=='string'||!/^asset:[^\s]+$/.test(saved))throw failure('可信本地素材未写入素材存储');
  return saved;
}
