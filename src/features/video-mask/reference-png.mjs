import {serializeClipBlob} from '../agent-workflows/local-clip-resolver.mjs';
// Decode every format, including PNG, then write only pixels. This removes
// container metadata and preserves reference geometry without downsampling.
export async function normalizeMaskReference(input,{signal,validateSources=()=>{},fetchImpl=fetch,decode=createImageBitmap,canvasFactory=()=>document.createElement('canvas'),serialize=serializeClipBlob,maxBytes=20*1024*1024}={}){
 const check=()=>{if(signal?.aborted)throw signal.reason;validateSources();};check();
 const response=await fetchImpl(input.url,{signal,credentials:'omit',redirect:'error'});check();if(!response.ok)throw Error('替换图片读取失败');
 const blob=await response.blob();check();if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||!blob.size||blob.size>maxBytes)throw Error('替换图片须为真实 PNG/JPEG/WebP，且不超过 20 MiB');
 const bitmap=await decode(blob);try{check();if(!Number.isSafeInteger(bitmap.width)||!Number.isSafeInteger(bitmap.height)||bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>16777216)throw Error('替换图片实际尺寸无效或超出像素预算');for(const k of ['width','height'])if(input[k]!==undefined&&input[k]!==bitmap[k])throw Error('替换图片实际尺寸已变化');
  const canvas=canvasFactory();canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');if(!context)throw Error('PNG 图片转换不可用');context.drawImage(bitmap,0,0);
  const png=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG 图片转换失败')),'image/png'));check();if(png.type!=='image/png'||!png.size||png.size>maxBytes)throw Error('转换后的 PNG 超过 20 MiB；未缩小参考图');const url=await serialize(png,{signal});check();return {...input,url,width:bitmap.width,height:bitmap.height};
 }finally{bitmap.close();}
}
