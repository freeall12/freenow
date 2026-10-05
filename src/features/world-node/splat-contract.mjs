// File and decoded budgets are separate: gzip size does not bound GPU allocation.
export const splatLimits=Object.freeze({bytes:64*1024*1024,expandedBytes:256*1024*1024,splats:2500000,sceneSplats:2500000});
const fail=(message,code='world_splat_invalid')=>Object.assign(Error(message),{code});
export function parseSplatHeader(bytes){
  if(bytes.byteLength<16)throw fail('SPZ 文件头不完整');
  const view=new DataView(bytes.buffer,bytes.byteOffset,16),version=view.getUint32(4,true),count=view.getUint32(8,true),degree=bytes[12];
  if(view.getUint32(0,true)!==0x5053474e||version<1||version>3||!count||degree>3||bytes[13]>24||bytes[14]&~1||bytes[15])throw fail('文件不是支持的 SPZ 1–3 数据');
  const expandedBytes=16+count*((version===1?6:9)+3+(version>=3?4:3)+1+3+degree*(degree+2)*3);
  if(count>splatLimits.splats||expandedBytes>splatLimits.expandedBytes)throw fail('SPZ 超过本地 250 万高斯或 256 MiB 解码预算；原文件仍可保留','world_splat_budget');
  return {version,count,degree,expandedBytes};
}
export async function inspectSplatHeader(blob,{signal}={}){
  if(!blob?.size||blob.size>splatLimits.bytes)throw fail('SPZ 文件为空或超过本地 64 MiB 导入预算','world_splat_budget');
  if(typeof DecompressionStream!=='function')throw fail('此浏览器不支持本地 SPZ 有界检查','world_splat_unavailable');
  const reader=blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader(),prefix=new Uint8Array(16);let offset=0,expanded=0,header;
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
    // Verify the actual gzip stream as well as its declared allocation budget.
    // Keep only the prefix; never retain the expanded payload in JavaScript.
    while(true){signal?.throwIfAborted();const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;expanded+=value.byteLength;
      if(expanded>splatLimits.expandedBytes)throw fail('SPZ 实际展开超过 256 MiB 解码预算','world_splat_budget');
      if(offset<16){const length=Math.min(value.length,16-offset);prefix.set(value.subarray(0,length),offset);offset+=length;if(offset===16)header=parseSplatHeader(prefix);}
      if(header&&expanded>header.expandedBytes)throw fail('SPZ 实际展开大小与文件头不一致');
    }
    if(!header)header=parseSplatHeader(prefix.subarray(0,offset));
    if(expanded!==header.expandedBytes)throw fail('SPZ 实际展开大小与文件头不一致');return header;
  }
  catch(error){if(signal?.aborted)throw signal.reason;if(error.code?.startsWith('world_splat_'))throw error;throw fail('SPZ 压缩文件无法读取');}
  finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function validateSplatDescriptor(value){
  if(!value||value.version!==1||value.format!=='spz'||typeof value.url!=='string'||!value.url||!Number.isInteger(value.count)||value.count<1||value.count>splatLimits.splats||!Array.isArray(value.bounds)||value.bounds.length!==2||value.bounds.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))||value.bounds[0].some((n,i)=>n>value.bounds[1][i]))throw fail('已保存的高斯素材描述无效');
  if(value.metricScaleFactor!==undefined&&(!Number.isFinite(value.metricScaleFactor)||value.metricScaleFactor<=0)||value.groundPlaneOffset!==undefined&&!Number.isFinite(value.groundPlaneOffset))throw fail('已保存的高斯尺度或地面偏移无效');
  if(value.coordinateSystem!==undefined&&!['spz_rub','marble_raw_opencv'].includes(value.coordinateSystem))throw fail('已保存的高斯坐标合同无效');
  if(value.framingBounds!==undefined&&(!Array.isArray(value.framingBounds)||value.framingBounds.length!==2||value.framingBounds.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))||value.framingBounds[0].some((n,i)=>n>value.framingBounds[1][i])))throw fail('已保存的高斯取景边界无效');
  return value;
}
