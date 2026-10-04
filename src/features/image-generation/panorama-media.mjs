import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {serializeClipBlob} from '../agent-workflows/local-clip-resolver.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
import {isNativePanoramaRequest,assertNativePanoramaConfiguration} from './panorama-native.mjs';

const MAX_BYTES=20*1024*1024,MAX_PIXELS=32*1024*1024;
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});

// The native contract requires verifiable PNG pixels. Conversion preserves the
// complete source dimensions; it never resizes to fit the provider's budget.
export async function encodePanoramaSource(url,{
  signal,validateSources=()=>{},createImage=()=>new Image(),createCanvas=()=>document.createElement('canvas'),serialize=serializeClipBlob,timeoutMs=20000
}={}){
  const check=()=>{if(signal?.aborted)throw signal.reason??fail('全景素材准备已取消');validateSources();};
  check();
  if(typeof url!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url))throw fail('图生全景需要实际 PNG、JPEG 或 WebP 图片');
  if(Math.floor((url.length-url.indexOf(',')-1)*3/4)>MAX_BYTES+2)throw fail('全景源图片超过20 MiB，未缩小或压缩后提交');
  const image=createImage();let canvas,timer,abort;
  try{
    await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;error?reject(error):resolve();};
      abort=()=>finish(signal.reason??fail('全景素材准备已取消'));
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(fail('全景源图片解码超时')),timeoutMs);
      image.onerror=()=>finish(fail('全景源图片无法解码'));
      image.onload=()=>finish();
      if(signal?.aborted){abort();return;}image.src=url;
    });
    check();
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_PIXELS)throw fail('全景源图片像素无效或超过32M像素预算');
    canvas=createCanvas();canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw fail('无法准备全景源图片');
    context.drawImage(image,0,0);check();
    const blob=await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      abort=()=>finish(signal.reason??fail('全景素材准备已取消'));
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(fail('全景源图片编码超时')),timeoutMs);
      if(signal?.aborted){abort();return;}
      try{canvas.toBlob(value=>value?finish(null,value):finish(fail('全景源图片无法编码')),'image/png');}catch(error){finish(error);}
    });
    check();
    if(!blob.size||blob.size>MAX_BYTES||blob.type!=='image/png')throw fail('原尺寸 PNG 超过20 MiB或编码无效，未改变画幅后提交');
    const encoding=new AbortController();
    let rejectEncoding;
    const interrupted=new Promise((_,reject)=>{rejectEncoding=reject;});interrupted.catch(()=>{});
    abort=()=>encoding.abort(signal.reason??fail('全景素材准备已取消'));
    const onEncodingAbort=()=>rejectEncoding(encoding.signal.reason);
    encoding.signal.addEventListener('abort',onEncodingAbort,{once:true});
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>encoding.abort(fail('全景源图片序列化超时')),timeoutMs);
    let encoded;
    try{
      check();
      encoded=await Promise.race([Promise.resolve().then(()=>{check();return serialize(blob,{signal:encoding.signal});}),interrupted]);check();
    }finally{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);encoding.signal.removeEventListener('abort',onEncodingAbort);
      if(!encoding.signal.aborted)encoding.abort(fail('全景源图片序列化已结束'));
    }
    if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw fail('全景源图片编码未返回有效PNG');
    return {url:encoded,width,height};
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;
    image.removeAttribute?.('src');if(canvas){canvas.width=0;canvas.height=0;}
  }
}

export async function preparePanoramaMedia(request,{
  signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,nativeConfiguration,
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,encode=encodePanoramaSource
}={}){
  if(!isNativePanoramaRequest(request))return request;
  const check=()=>{if(signal?.aborted)throw signal.reason??fail('全景素材准备已取消');validateSources();};
  check();
  const prepared=structuredClone(assertNativePanoramaConfiguration(nativeConfiguration,request));
  assertWorkflowRequestBudget(prepared);
  const input=prepared.inputs[0];
  const actual=await resolveMedia({id:input.nodeId||input.id||'panorama-source',type:'image',image:input.url},{signal,decodeImage:false});check();
  let parsed;try{parsed=new URL(actual.url,baseUrl);}catch{throw fail('全景源图片地址无效');}
  if(parsed.username||parsed.password||isOriginalServiceHost(parsed.hostname))throw fail('全景源图片须先导入本地或使用独立的无凭据来源');
  input.url=actual.url;
  const transferred=await transport(prepared,{signal,baseUrl,inlineImages:true,maxMediaBytes:MAX_BYTES,validateSources:check});check();
  const pixels=await encode(transferred.inputs[0].url,{signal,validateSources:check});check();
  Object.assign(transferred.inputs[0],pixels);
  assertWorkflowRequestBudget(transferred);check();return transferred;
}
