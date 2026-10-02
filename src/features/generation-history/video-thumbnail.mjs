import {openVideoFrames} from '../../../video-frames.mjs';
const encode=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(Error('视频缩略图编码失败')),'image/jpeg',.85));
// Use the same decoded reader for validation and the genuine first frame. A
// black first frame is a valid result; never replace it with unrelated artwork.
export async function inspectVideoThumbnail(source,{thumbnail=true,signal,openFrames=openVideoFrames,encodeFrame=encode}={}) {
  const reader=await openFrames(source,signal);
  try{
    const {width,height,duration}=reader;
    if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0||!Number.isFinite(duration)||duration<0)throw Error('历史视频内容无效');
    const result={width,height,duration};if(!thumbnail)return result;
    try{
      const size=Math.max(1,Math.round(320*Math.min(1,width/height))),frame=await reader.at(0,size);
      if(signal?.aborted)throw signal.reason;
      result.thumbnailBlob=await encodeFrame(frame);
    }catch(error){if(signal?.aborted)throw signal.reason;result.thumbnailError=error.message || '视频缩略图读取失败';}
    return result;
  }finally{reader.dispose();}
}
