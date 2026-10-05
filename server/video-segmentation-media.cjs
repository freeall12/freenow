'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {mediaInternals:{command,decodeArgs,probeVideo,envelope,sameTiming}}=require('./generation-video-mask-media.cjs');
const MiB=1024*1024;
const LIMITS=Object.freeze({maxInputBytes:32*MiB,maxPreparedBytes:90*MiB,maxTotalBytes:128*MiB,maxPixels:16777216,maxRawPixels:1536*MiB,maxRawDiskBytes:2048*MiB,maxSourceFrames:2400,timeoutMs:120000,maxConcurrent:2});
let activeJobs=0;
const object=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
const fail=(message,code='segmentation_media_invalid')=>Object.assign(Error(message),{code,providerDispatched:false});
const check=signal=>{if(signal?.aborted)throw signal.reason||fail('本地分割媒体准备已取消','segmentation_cancelled');};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function keys(value,allowed){if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw fail('本地分割媒体包含未知字段');}
function validateRequest(request){
 keys(request,['kind','nodeId','sourceVideoUrl','width','height','duration','time','selection','pointPrompts']);
 if(![request.width,request.height].every(n=>Number.isSafeInteger(n)&&n>=2)||!Number.isFinite(request.duration)||request.duration<=0||!Number.isFinite(request.time)||request.time<0||request.time>request.duration||!Array.isArray(request.pointPrompts)||request.pointPrompts.length!==1)throw fail('分割来源声明或提示时间无效');
 const point=request.pointPrompts[0];keys(point,['x','y','time','label']);
 if(![point.x,point.y].every(Number.isSafeInteger)||point.x<0||point.x>=request.width||point.y<0||point.y>=request.height||point.time!==request.time||point.label!==1)throw fail('分割提示须为来源内的单个前景像素');
 // The adapter validates node/URL/selection identity. This local module consumes
 // bytes only; when a selection is supplied, independently check its center.
 if(request.selection!==undefined){const rect=request.selection;keys(rect,['x','y','width','height']);if(!Object.values(rect).every(Number.isFinite)||rect.x<0||rect.y<0||rect.width<=0||rect.height<=0||rect.x+rect.width>1||rect.y+rect.height>1||point.x!==Math.min(request.width-1,Math.round((rect.x+rect.width/2)*request.width))||point.y!==Math.min(request.height-1,Math.round((rect.y+rect.height/2)*request.height)))throw fail('分割选区与中心像素不一致');}
 return point;
}
function createVideoSegmentationMediaTools(options={}){
 keys(options,['ffmpegPath','ffprobePath',...Object.keys(LIMITS)]);
 const tools={...LIMITS,ffmpegPath:'ffmpeg',ffprobePath:'ffprobe',...options};
 for(const [key,max]of Object.entries(LIMITS))if(!Number.isSafeInteger(tools[key])||tools[key]<1||tools[key]>max)throw fail('本地分割媒体预算配置无效','configuration_invalid');
 for(const key of ['ffmpegPath','ffprobePath'])if(typeof tools[key]!=='string'||!tools[key])throw fail('本地媒体工具路径无效','configuration_invalid');
 async function prepareSegmentationMedia(input,{signal}={}){
  check(signal);keys(input,['source','request']);keys(input.source,['bytes','mime']);const point=validateRequest(input.request);envelope(input.source,tools.maxInputBytes,false,input.source.mime==='video/mp4');
  if(activeJobs>=tools.maxConcurrent)throw fail('本地分割媒体正在处理其他任务','segmentation_media_busy');
  activeJobs++;let directory,rawFile;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const timer=setTimeout(()=>controller.abort(fail('本地分割媒体准备超过时间预算','segmentation_media_timeout')),tools.timeoutMs);
  try{
   directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-segmentation-media-'));await fs.chmod(directory,0o700);
   const file=path.join(directory,'source');await fs.writeFile(file,input.source.bytes,{mode:0o600,signal:combined});
   const actual=await probeVideo(file,tools,combined),request=input.request;
   if(actual.width!==request.width||actual.height!==request.height||Math.abs(actual.duration-request.duration)>Math.max(actual.timeTolerance,.001))throw fail('来源声明尺寸或时长与实际视频不一致');
   // Tie chooses the earlier frame. At duration, choose the last actual PTS.
   let frameIndex=0;for(let i=1;i<actual.pts.length;i++)if(Math.abs(actual.pts[i]-request.time)<Math.abs(actual.pts[frameIndex]-request.time)-1e-12)frameIndex=i;
   const indices=[];
   if(frameIndex===0||frameIndex<actual.numFrames-1)indices.push({direction:'forward',sourceIndices:Array.from({length:actual.numFrames-frameIndex},(_,i)=>frameIndex+i)});
   if(frameIndex>0)indices.push({direction:'reverse',sourceIndices:Array.from({length:frameIndex+1},(_,i)=>frameIndex-i)});
   const branchFrames=indices.reduce((sum,b)=>sum+b.sourceIndices.length,0),pixels=actual.width*actual.height,frameBytes=pixels*3;
   const rawBytes=actual.numFrames*frameBytes;
   // Bound the materialized source before decoding. FFmpeg writes directly to
   // a private disk file; RGB memory is a few frames, never N complete frames.
   if((actual.numFrames+branchFrames)*pixels>tools.maxRawPixels||rawBytes>tools.maxRawDiskBytes||input.source.bytes.length>tools.maxTotalBytes)throw fail('来源与分支总原始像素或磁盘超过准备预算','segmentation_media_budget');
   const rawPath=path.join(directory,'source.rgb');
   await command(tools.ffmpegPath,[...decodeArgs(file),'-map','0:v:0','-an','-sn','-dn','-fps_mode','passthrough','-pix_fmt','rgb24','-frames:v',String(actual.numFrames),'-f','rawvideo','-fs',String(rawBytes),'-y',rawPath],{signal:combined,maxStdout:1024});
   if((await fs.stat(rawPath)).size!==rawBytes)throw fail('来源真实解码帧数不一致');
   rawFile=await fs.open(rawPath,'r');
   async function readFrame(index,buffer=Buffer.allocUnsafe(frameBytes)){
    check(combined);let offset=0;while(offset<frameBytes){const {bytesRead}=await rawFile.read(buffer,offset,frameBytes-offset,index*frameBytes+offset);if(!bytesRead)throw fail('来源原始帧磁盘数据不完整');offset+=bytesRead;check(combined);}return buffer;
   }
   const frameHashes=[],scanBuffer=Buffer.allocUnsafe(frameBytes);
   for(let i=0;i<actual.numFrames;i++)frameHashes.push(sha(await readFrame(i,scanBuffer)));
   const firstFrameSha256=frameHashes[frameIndex],branches=[];let preparedBytes=0;
   for(const branch of indices){
    check(combined);const output=path.join(directory,branch.direction+'.mp4'),numFrames=branch.sourceIndices.length;
    const remaining=Math.min(tools.maxPreparedBytes-preparedBytes,tools.maxTotalBytes-input.source.bytes.length-preparedBytes);
    if(remaining<1)throw fail('分支总媒体字节超过预算','segmentation_media_budget');
    async function* frames(){for(const index of branch.sourceIndices)yield await readFrame(index);}
    // libx264rgb crf0 preserves the canonical decoded RGB bytes. No YUV
    // subsampling, source seeking, rotation, scaling, fps filter or padding.
    await command(tools.ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-f','rawvideo','-pixel_format','rgb24','-video_size',`${actual.width}x${actual.height}`,'-framerate',`${actual.fpsNumerator}/${actual.fpsDenominator}`,'-i','pipe:0','-an','-vf','setsar=1','-fps_mode','passthrough','-c:v','libx264rgb','-preset','veryfast','-crf','0','-pix_fmt','rgb24','-video_track_timescale',String(actual.fpsNumerator),'-map_metadata','-1','-movflags','+faststart','-fs',String(remaining+1),'-y',output],{signal:combined,input:frames(),maxStdout:1024});
    const stat=await fs.stat(output);if(!stat.size||stat.size>remaining)throw fail('分支总媒体字节超过预算','segmentation_media_budget');
    const metadata=await probeVideo(output,tools,combined);sameTiming(metadata,{...actual,numFrames,duration:numFrames/actual.fps,pts:Array.from({length:numFrames},(_,i)=>i/actual.fps)});if(metadata.hasAudio)throw fail('准备分支含意外音轨');
    let cursor=0,frameHash=createHash('sha256'),verifiedFirstHash;
    await command(tools.ffmpegPath,[...decodeArgs(output),'-map','0:v:0','-an','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{signal:combined,maxStdout:numFrames*frameBytes,onStdout:chunk=>{
     let at=0;while(at<chunk.length){const index=Math.floor(cursor/frameBytes),offset=cursor%frameBytes,take=Math.min(frameBytes-offset,chunk.length-at);if(index>=numFrames)throw fail('准备分支增加了实际帧');frameHash.update(chunk.subarray(at,at+take));cursor+=take;at+=take;if(cursor%frameBytes===0){const decodedHash=frameHash.digest('hex');if(decodedHash!==frameHashes[branch.sourceIndices[index]])throw fail('无损分支改变了来源像素');if(index===0)verifiedFirstHash=decodedHash;frameHash=createHash('sha256');}}
    }});
    if(cursor!==numFrames*frameBytes||verifiedFirstHash!==firstFrameSha256)throw fail('准备分支首帧或总帧数不一致');
    const bytes=await fs.readFile(output,{signal:combined});preparedBytes+=bytes.length;
    branches.push({...branch,mime:'video/mp4',bytes,sha256:sha(bytes),numFrames,firstFrameSha256});
   }
   check(combined);return {source:{sha256:sha(input.source.bytes),...actual},prompt:{frameIndex,time:request.time,pts:actual.pts[frameIndex],x:point.x,y:point.y},branches};
  }catch(error){check(combined);if(error.code==='video_mask_media_budget')throw fail('本地分割媒体解码超过预算','segmentation_media_budget');if(error.code==='invalid_video_mask_media')throw fail(error.message);throw error;}
  finally{clearTimeout(timer);try{try{await rawFile?.close();}finally{if(directory)await fs.rm(directory,{recursive:true,force:true});}}finally{activeJobs--;}}
 }
 return {prepareSegmentationMedia,limits:Object.freeze(Object.fromEntries(Object.keys(LIMITS).map(key=>[key,tools[key]])))};
}
module.exports={createVideoSegmentationMediaTools,LIMITS};
