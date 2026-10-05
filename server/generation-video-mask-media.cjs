'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');

const MiB=1024*1024;
const LIMITS=Object.freeze({maxInputBytes:32*MiB,maxOutputBytes:100*MiB,maxPreparedBytes:90*MiB,maxPixels:16777216,maxRawMaskBytes:256*MiB,maxSourceFrames:2400,maxRleBytes:32*MiB,timeoutMs:120000,maxConcurrent:2});
const INPUT_FORMATS='mov,matroska,webm,ogg,wav';
let activeJobs=0;
const object=v=>v!==null&&Object.getPrototypeOf(v)===Object.prototype;
const failure=(message,code='invalid_video_mask_media')=>Object.assign(Error(message),{code,providerDispatched:false});
const check=signal=>{if(signal?.aborted)throw signal.reason||failure('本地视频处理已取消','media_cancelled');};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function keys(value,allowed){if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw failure('媒体准备含未知字段，未忽略后处理');}
function rational(value){const m=/^(\d+)\/(\d+)$/.exec(String(value));if(!m||![Number(m[1]),Number(m[2])].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1000000000))throw failure('视频缺少实际帧率或时间单位');return {numerator:Number(m[1]),denominator:Number(m[2]),value:Number(m[1])/Number(m[2])};}
function envelope(source,max,allowMetadata=false,mp4Only=false){
 keys(source,['bytes','mime',...allowMetadata?['metadata']:[]]);if(!Buffer.isBuffer(source.bytes)||!source.bytes.length||source.bytes.length>max||!['video/mp4','video/quicktime','video/webm'].includes(source.mime))throw failure('来源须为预算内实际 MP4、MOV 或 WebM 字节');
 if(mp4Only&&source.mime!=='video/mp4')throw failure('结果须为实际 MP4，未将 MOV 或 WebM 误标为 MP4');
 if(source.mime==='video/webm'){if(source.bytes.length<8||source.bytes.readUInt32BE(0)!==0x1a45dfa3)throw failure('WebM 字节与声明格式不一致');return;}
 const bytes=source.bytes,types=new Set();let at=0;
 while(at<bytes.length){if(at+8>bytes.length)throw failure('MP4/MOV 容器不完整');let size=bytes.readUInt32BE(at),head=8;const type=bytes.toString('ascii',at+4,at+8);if(size===1){if(at+16>bytes.length)throw failure('MP4/MOV 扩展索引不完整');size=Number(bytes.readBigUInt64BE(at+8));head=16;}else if(size===0)size=bytes.length-at;if(!Number.isSafeInteger(size)||size<head||at+size>bytes.length)throw failure('MP4/MOV 索引越界');if(type==='mdat'&&size===head)throw failure('视频媒体数据为空');if(mp4Only&&type==='ftyp'){const brands=[];if(size<head+8||(size-head)%4)throw failure('结果 MP4 文件类型索引不完整');brands.push(bytes.toString('ascii',at+head,at+head+4));for(let b=at+head+8;b<at+size;b+=4)brands.push(bytes.toString('ascii',b,b+4));if(brands.includes('qt  ')||!brands.some(brand=>/^(?:mp4[12]|isom|iso[2-9]|avc1|M4V |dash|cmfc|cmfs)$/.test(brand)))throw failure('结果容器不是实际 MP4');}types.add(type);at+=size;}
 if(!['ftyp','moov','mdat'].every(type=>types.has(type)))throw failure('来源缺少完整视频容器');
}

// Commands see only private files and checked numbers, never input URLs or
// caller-supplied arguments. Aborts kill the child before temporary cleanup.
async function command(binary,args,{signal,maxStdout=8*MiB,input,onStdout}={}){
 check(signal);
 return new Promise((resolve,reject)=>{
  let child,reason,killTimer,stdoutBytes=0,stderrBytes=0;const chunks=[];
  const stop=error=>{reason||=error;child?.kill('SIGTERM');killTimer||=setTimeout(()=>child?.kill('SIGKILL'),500);};
  const abort=()=>stop(signal.reason||failure('本地视频处理已取消','media_cancelled'));
  try{child=spawn(binary,args,{stdio:[input?'pipe':'ignore','pipe','pipe']});}catch{reject(failure('无法启动本机媒体工具','media_tool_unavailable'));return;}
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>maxStdout)stop(failure('媒体工具输出超过预算','video_mask_media_budget'));else if(onStdout){try{check(signal);onStdout(chunk);}catch(error){stop(error);}}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>MiB)stop(failure('媒体解码日志超过预算','video_mask_media_budget'));});
  child.on('error',()=>stop(failure('未找到或无法运行 FFmpeg/FFprobe','media_tool_unavailable')));
  child.stdin?.on('error',()=>stop(failure('遮罩编码输入未完整消费')));
  if(input)void(async()=>{try{for await(const bytes of input){check(signal);if(!child.stdin.write(bytes))await new Promise((yes,no)=>{const done=()=>{cleanup();yes();},closed=()=>{cleanup();no(failure('遮罩编码提前关闭'));},cleanup=()=>{child.stdin.removeListener('drain',done);child.stdin.removeListener('close',closed);};child.stdin.once('drain',done);child.stdin.once('close',closed);});}child.stdin.end();}catch(error){stop(error);}})();
  child.on('close',code=>{clearTimeout(killTimer);signal?.removeEventListener('abort',abort);if(reason)return reject(reason);if(code!==0||stderrBytes)return reject(failure('实际媒体解码或编码失败，未使用部分结果'));resolve(Buffer.concat(chunks));});
 });
}
function decodeArgs(file){return ['-hide_banner','-loglevel','error','-nostdin','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-i',file];}
async function probeVideo(file,tools,signal){
 const base=['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS];let summary,frames;
 try{summary=JSON.parse((await command(tools.ffprobePath,[...base,'-show_entries','format=format_name:stream=index,codec_type,codec_name,width,height,sample_aspect_ratio,avg_frame_rate,r_frame_rate,time_base,duration,start_time,sample_rate,channels:stream_side_data=rotation','-of','json',file],{signal})).toString());frames=JSON.parse((await command(tools.ffprobePath,[...base,'-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time,duration_time,pkt_duration_time','-of','json',file],{signal})).toString()).frames;}catch(error){if(error.code||signal.aborted)throw error;throw failure('无法读取实际视频帧信息');}
 const videos=summary.streams?.filter(s=>s.codec_type==='video'),audios=summary.streams?.filter(s=>s.codec_type==='audio');
 if(videos?.length!==1||!Array.isArray(audios)||audios.length>1)throw failure('仅支持一条视频与最多一条实际音轨');
 const v=videos[0],rate=rational(v.avg_frame_rate),nominal=rational(v.r_frame_rate),timeBase=rational(v.time_base),duration=Number(v.duration),tick=timeBase.value,tolerance=Math.max(0.000002,Math.min(tick*1.1,0.0001));
 if(!Number.isSafeInteger(v.width)||!Number.isSafeInteger(v.height)||v.width<2||v.height<2||v.width%2||v.height%2||v.width*v.height>tools.maxPixels||rate.value<5||rate.value>30||Math.abs(nominal.value-rate.value)>0.000001||!Number.isFinite(duration)||duration<=0||!Array.isArray(frames)||!frames.length||frames.length>tools.maxSourceFrames)throw failure('视频须为预算内偶数尺寸、5–30 FPS 的实际恒定帧率媒体');
 if(v.sample_aspect_ratio!=='1:1'||v.side_data_list?.some(side=>side.rotation!==undefined&&side.rotation!==0))throw failure('视频非方形像素或旋转信息未物化，未静默改变显示画幅');
 const pts=frames.map(frame=>Number(frame.best_effort_timestamp_time));
 if(pts.some((p,i)=>!Number.isFinite(p)||p<0||Math.abs(p-i/rate.value)>tolerance)||Math.abs(duration-pts.length/rate.value)>tolerance)throw failure('视频实际 PTS、帧数或时长不是完整恒定帧率，未补帧或改速');
 for(const frame of frames){const d=Number(frame.duration_time??frame.pkt_duration_time);if(!Number.isFinite(d)||Math.abs(d-1/rate.value)>tolerance)throw failure('视频帧缺少一致的实际持续时间');}
 await command(tools.ffmpegPath,[...decodeArgs(file),'-map','0:v:0','-map','0:a:0?','-sn','-dn','-f','null','-'],{signal,maxStdout:1024});
 const audio=audios[0];if(audio&&(!Number.isInteger(Number(audio.sample_rate))||Number(audio.sample_rate)<8000||Number(audio.sample_rate)>96000||![1,2].includes(audio.channels)||!Number.isFinite(Number(audio.start_time))||Math.abs(Number(audio.start_time))>1/Number(audio.sample_rate)))throw failure('来源音轨的采样率、声道或起始时间无法精确保留');
 return {width:v.width,height:v.height,fps:rate.value,fpsNumerator:rate.numerator,fpsDenominator:rate.denominator,numFrames:pts.length,duration,pts,hasAudio:!!audio,timeTolerance:tolerance,...audio?{audio:{sampleRate:Number(audio.sample_rate),channels:audio.channels,duration:Number(audio.duration),codec:audio.codec_name}}:{}};
}
async function probeAudio(file,tools,signal){
 const text=await command(tools.ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-show_entries','stream=codec_type,codec_name,sample_rate,channels,duration,start_time','-of','json',file],{signal,maxStdout:65536});let streams;try{streams=JSON.parse(text).streams;}catch{throw failure('无法读取原音轨信息');}
 if(!Array.isArray(streams)||streams.length!==1||streams[0].codec_type!=='audio')throw failure('原音轨保存容器不一致');const s=streams[0];return {sampleRate:Number(s.sample_rate),channels:s.channels,duration:Number(s.duration),start:Number(s.start_time??0),codec:s.codec_name};
}
function sameAudio(actual,expected){if(actual.sampleRate!==expected.sampleRate||actual.channels!==expected.channels||!Number.isFinite(actual.duration)||Math.abs(actual.duration-expected.duration)>1/expected.sampleRate||!Number.isFinite(actual.start)||Math.abs(actual.start)>1/expected.sampleRate)throw failure('原音轨真实采样率、声道或时间与保存信息不一致');}
function maskRuns(mask,metadata,limits,signal){
 keys(mask,['encoding','width','height','fps','frames']);if(mask.encoding!=='rle-zero-based-row-major'||mask.width!==metadata.width||mask.height!==metadata.height||!Number.isFinite(mask.fps)||Math.abs(mask.fps-metadata.fps)>0.000001||!Array.isArray(mask.frames)||mask.frames.length!==metadata.numFrames)throw failure('全时序 RLE 与来源实际尺寸、帧数或帧率不一致');
 let textBytes=0,found=false;const runs=[];
 for(const frame of mask.frames){check(signal);if(typeof frame!=='string')throw failure('RLE 帧须为游程文字');textBytes+=Buffer.byteLength(frame);if(textBytes>limits.maxRleBytes)throw failure('RLE 超过预算','video_mask_media_budget');const tokens=frame.trim()?frame.trim().split(/\s+/):[];if(tokens.length%2)throw failure('RLE 游程不完整');let end=0;const values=[];
  for(let i=0;i<tokens.length;i+=2){if(i%1024===0)check(signal);if(!/^\d+$/.test(tokens[i])||!/^\d+$/.test(tokens[i+1]))throw failure('RLE 必须是非负十进制整数');const start=Number(tokens[i]),length=Number(tokens[i+1]);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<end||length<=0||start+length>mask.width*mask.height)throw failure('RLE 游程越界或重叠');values.push(start,length);end=start+length;found=true;}runs.push(values);
 }
 if(!found)throw failure('整个时序遮罩没有目标');return runs;
}
function selectedRange(clip,metadata){
 const duration=metadata.numFrames/metadata.fps;if(clip!==undefined&&clip!==null){keys(clip,['start','end']);if(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>duration+0.000001)throw failure('来源选段须为实际视频内的 [start,end)');}
 const start=clip?.start??0,end=clip?.end??duration,first=Math.round(start*metadata.fps),last=Math.round(end*metadata.fps);
 if(Math.abs(first/metadata.fps-start)>0.000001||Math.abs(last/metadata.fps-end)>0.000001)throw failure('来源选段未对齐实际帧边界，未静默移动选区');
 if(last-first<81||last-first>241)throw failure('编辑选段须为 81–241 个实际帧，未截断或补帧');return {start,end,first,last};
}
function sameTiming(actual,expected,{aspectOnly=false}={}){
 const tolerance=Math.max(actual.timeTolerance||0.000002,expected.timeTolerance||0.000002);
 if(actual.numFrames!==expected.numFrames||Math.abs(actual.fps-expected.fps)>0.000001||Math.abs(actual.duration-expected.duration)>tolerance||actual.pts.length!==expected.pts.length||actual.pts.some((p,i)=>Math.abs(p-expected.pts[i])>tolerance))throw failure('结果实际帧数、帧率、PTS 或时长与选段不一致');
 if(aspectOnly){if(Math.abs(actual.width*expected.height-actual.height*expected.width)>2*Math.max(expected.width,expected.height))throw failure('结果画幅改变，不能静默替代原选段');}
 else if(actual.width!==expected.width||actual.height!==expected.height)throw failure('来源与遮罩的实际像素尺寸不一致');
}
function preparedMetadata(prepared){const m=prepared?.metadata;if(!object(m)||![m.width,m.height].every(n=>Number.isSafeInteger(n)&&n>=2&&n%2===0)||!Number.isInteger(m.numFrames)||m.numFrames<81||m.numFrames>241||!Number.isFinite(m.fps)||m.fps<5||m.fps>30||!Number.isFinite(m.duration)||!Number.isFinite(m.timeTolerance)||m.timeTolerance<0.000002||m.timeTolerance>0.0001||Math.abs(m.duration-m.numFrames/m.fps)>m.timeTolerance||!Array.isArray(m.pts)||m.pts.length!==m.numFrames||m.pts.some((p,i)=>!Number.isFinite(p)||Math.abs(p-i/m.fps)>m.timeTolerance)||typeof m.hasAudio!=='boolean')throw failure('缺少原选段可恢复的实际媒体信息');return m;}

function createVideoMaskMediaTools(options={}){
 keys(options,['ffmpegPath','ffprobePath',...Object.keys(LIMITS)]);const tools={...LIMITS,ffmpegPath:process.env.FFMPEG_PATH||'ffmpeg',ffprobePath:process.env.FFPROBE_PATH||'ffprobe',...options};
 for(const [key,max]of Object.entries(LIMITS))if(!Number.isSafeInteger(tools[key])||tools[key]<1||tools[key]>max)throw failure('本地媒体工具预算配置无效','configuration_invalid');
 if(typeof tools.ffmpegPath!=='string'||!tools.ffmpegPath||typeof tools.ffprobePath!=='string'||!tools.ffprobePath)throw failure('本地媒体工具路径无效','configuration_invalid');
 async function job(operation,{signal}={}){
  check(signal);if(activeJobs>=tools.maxConcurrent)throw failure('本地视频遮罩处理繁忙','video_mask_media_busy');activeJobs++;let directory;
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,timer=setTimeout(()=>controller.abort(failure('本地视频遮罩处理超过时间预算','video_mask_media_timeout')),tools.timeoutMs);
  try{directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-video-mask-'));const result=await operation(directory,combined);check(combined);return result;}catch(error){check(combined);throw error;}finally{clearTimeout(timer);activeJobs--;if(directory)await fs.rm(directory,{recursive:true,force:true});}
 }
 async function write(directory,name,bytes,signal){check(signal);const file=path.join(directory,name);await fs.writeFile(file,bytes,{mode:0o600,signal});check(signal);return file;}
 async function read(file,signal,max=tools.maxOutputBytes){check(signal);const stat=await fs.stat(file);if(!stat.size||stat.size>max)throw failure('准备媒体超过字节预算','video_mask_media_budget');const bytes=await fs.readFile(file,{signal});check(signal);return bytes;}
 const finish=['-map_metadata','-1','-movflags','+faststart','-fs',String(tools.maxOutputBytes+1),'-y'];
 const rateText=m=>`${m.fpsNumerator}/${m.fpsDenominator}`;
 async function pcm(file,signal){return command(tools.ffmpegPath,[...decodeArgs(file),'-map','0:a:0','-vn','-sn','-dn','-c:a','pcm_s32le','-f','s32le','pipe:1'],{signal,maxStdout:tools.maxOutputBytes});}
 async function inspectVideo(source,context){envelope(source,tools.maxInputBytes);return job(async(dir,signal)=>probeVideo(await write(dir,'source',source.bytes,signal),tools,signal),context);}
 async function prepareMedia(input,context){
  keys(input,['source','mask','sourceClip']);envelope(input.source,tools.maxInputBytes);
  return job(async(dir,signal)=>{
   const source=await write(dir,'source',input.source.bytes,signal),actual=await probeVideo(source,tools,signal),runs=maskRuns(input.mask,actual,tools,signal),range=selectedRange(input.sourceClip,actual),selected=runs.slice(range.first,range.last),numFrames=range.last-range.first;
   if(!selected.some(frame=>frame.length))throw failure('选段内没有遮罩目标，未提交空编辑');if(numFrames*actual.width*actual.height>tools.maxRawMaskBytes)throw failure('完整遮罩像素数据超过预算','video_mask_media_budget');
   const expected={...actual,numFrames,duration:numFrames/actual.fps,pts:Array.from({length:numFrames},(_,i)=>i/actual.fps)},videoFile=path.join(dir,'video.mp4'),maskFile=path.join(dir,'mask.mp4'),preparedFinish=['-map_metadata','-1','-movflags','+faststart','-fs',String(tools.maxPreparedBytes+1),'-y'];
   await command(tools.ffmpegPath,[...decodeArgs(source),'-map','0:v:0','-an','-sn','-dn','-vf',`trim=start_frame=${range.first}:end_frame=${range.last},setpts=PTS-STARTPTS`,'-fps_mode','passthrough','-c:v','libx264','-preset','veryfast','-crf','0','-pix_fmt','yuv420p','-video_track_timescale',String(actual.fpsNumerator),...preparedFinish,videoFile],{signal,maxStdout:1024});
   async function* masks(){for(const frame of selected){check(signal);const bytes=Buffer.alloc(actual.width*actual.height);for(let i=0;i<frame.length;i+=2)bytes.fill(255,frame[i],frame[i]+frame[i+1]);yield bytes;}}
   await command(tools.ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-f','rawvideo','-pixel_format','gray','-video_size',`${actual.width}x${actual.height}`,'-framerate',rateText(actual),'-i','pipe:0','-an','-vf','setsar=1','-c:v','libx264','-preset','veryfast','-crf','0','-pix_fmt','yuv420p','-video_track_timescale',String(actual.fpsNumerator),...preparedFinish,maskFile],{signal,input:masks(),maxStdout:1024});
   const videoMeta=await probeVideo(videoFile,tools,signal),maskMeta=await probeVideo(maskFile,tools,signal);sameTiming(videoMeta,expected);sameTiming(maskMeta,videoMeta);
   // Decode the entire encoded mask and compare every byte, including black
   // empty frames. A file signature cannot prove polarity or moving targets.
   let cursor=0,expectedFrame,expectedIndex=-1;const frameBytes=actual.width*actual.height;
   await command(tools.ffmpegPath,[...decodeArgs(maskFile),'-map','0:v:0','-an','-pix_fmt','gray','-f','rawvideo','pipe:1'],{signal,maxStdout:tools.maxRawMaskBytes,onStdout:chunk=>{let at=0;while(at<chunk.length){const index=Math.floor(cursor/frameBytes),offset=cursor%frameBytes;if(index>=selected.length)throw failure('遮罩编码增加了实际帧');if(index!==expectedIndex){expectedFrame=Buffer.alloc(frameBytes);for(let i=0;i<selected[index].length;i+=2)expectedFrame.fill(255,selected[index][i],selected[index][i]+selected[index][i+1]);expectedIndex=index;}const take=Math.min(frameBytes-offset,chunk.length-at);if(!chunk.subarray(at,at+take).equals(expectedFrame.subarray(offset,offset+take)))throw failure('遮罩编码改变了实际黑白目标像素');cursor+=take;at+=take;}}});
   if(cursor!==numFrames*frameBytes)throw failure('遮罩编码减少了实际帧');
   let audio=null;
   if(actual.hasAudio){
    const {sampleRate,channels}=actual.audio,startSample=Math.round(range.start*sampleRate),endSample=Math.round(range.end*sampleRate);
    if(Math.abs(startSample-range.start*sampleRate)>0.0001||Math.abs(endSample-range.end*sampleRate)>0.0001)throw failure('视频选段未对齐原音频样本，未静默移动声音');
    if(!Number.isFinite(actual.audio.duration)||actual.audio.duration+1/sampleRate<range.end)throw failure('原音轨未覆盖完整选段，未补静音或丢声音');
    const audioFile=path.join(dir,'audio.wav');await command(tools.ffmpegPath,[...decodeArgs(source),'-map','0:a:0','-vn','-sn','-dn','-af',`atrim=start_sample=${startSample}:end_sample=${endSample},asetpts=PTS-STARTPTS`,'-c:a','pcm_s32le','-fs',String(tools.maxPreparedBytes+1),'-y',audioFile],{signal,maxStdout:1024});
    const raw=await pcm(audioFile,signal);if(raw.length!==(endSample-startSample)*channels*4)throw failure('原选段音频没有完整样本，未补音');const audioMetadata={sampleRate,channels,numSamples:endSample-startSample,duration:(endSample-startSample)/sampleRate,pcmSha256:sha(raw),sampleFormat:'s32le',preservation:'decoded-pcm32-lossless'};sameAudio(await probeAudio(audioFile,tools,signal),audioMetadata);audio={bytes:await read(audioFile,signal,tools.maxPreparedBytes),mime:'audio/wav',metadata:audioMetadata};
    // Prefer the original, commonly playable AAC packets only when their
    // decoded samples and declared timeline exactly match the selected audio.
    if(actual.audio.codec==='aac')try{const copyFile=path.join(dir,'audio.m4a');await command(tools.ffmpegPath,[...decodeArgs(source),...range.first===0&&range.last===actual.numFrames?[]:['-ss',String(range.start),'-t',String(expected.duration)],'-map','0:a:0','-vn','-sn','-dn','-c:a','copy',...preparedFinish,copyFile],{signal,maxStdout:1024});const copied=await probeAudio(copyFile,tools,signal);sameAudio(copied,audioMetadata);if(!(await pcm(copyFile,signal)).equals(raw))throw failure('AAC 包边界与原选段样本不一致');audio={bytes:await read(copyFile,signal,tools.maxPreparedBytes),mime:'audio/mp4',metadata:{...audioMetadata,preservation:'copy-aac'}};}catch(error){check(signal);if(error.code!=='invalid_video_mask_media')throw error;}
   }
   return {video:{bytes:await read(videoFile,signal,tools.maxPreparedBytes),mime:'video/mp4',metadata:videoMeta},mask:{bytes:await read(maskFile,signal,tools.maxPreparedBytes),mime:'video/mp4',metadata:maskMeta},audio,metadata:{...videoMeta,hasAudio:actual.hasAudio},sourceRange:{start:range.start,end:range.end}};
  },context);
 }
 async function validateResult(source,prepared,context){envelope(source,tools.maxOutputBytes,true,true);const expected=preparedMetadata(prepared);return job(async(dir,signal)=>{const file=await write(dir,'result.mp4',source.bytes,signal),metadata=await probeVideo(file,tools,signal);sameTiming(metadata,expected,{aspectOnly:true});return {bytes:source.bytes,mime:'video/mp4',metadata};},context);}
 async function preserveAudio(source,prepared,context){
  envelope(source,tools.maxOutputBytes,true,true);const expected=preparedMetadata(prepared);
  return job(async(dir,signal)=>{
   const sourceFile=await write(dir,'result.mp4',source.bytes,signal),actual=await probeVideo(sourceFile,tools,signal);sameTiming(actual,expected,{aspectOnly:true});const output=path.join(dir,'complete.mp4');
   if(expected.hasAudio){
    const audio=prepared.audio;if(!audio||!['audio/wav','audio/mp4'].includes(audio.mime)||!Buffer.isBuffer(audio.bytes)||!audio.bytes.length||audio.bytes.length>tools.maxOutputBytes||audio.metadata?.sampleFormat!=='s32le'||!['copy-aac','decoded-pcm32-lossless'].includes(audio.metadata?.preservation)||audio.mime!==(audio.metadata.preservation==='copy-aac'?'audio/mp4':'audio/wav'))throw failure('原音轨保存信息缺失，未静默丢声');
    const audioFile=await write(dir,'original',audio.bytes,signal),raw=await pcm(audioFile,signal),m=audio.metadata;if(!Number.isInteger(m.sampleRate)||m.sampleRate<8000||m.sampleRate>96000||![1,2].includes(m.channels)||!Number.isSafeInteger(m.numSamples)||raw.length!==m.numSamples*m.channels*4||sha(raw)!==m.pcmSha256||Math.abs(m.duration-expected.duration)>1/m.sampleRate)throw failure('原音轨身份或时长改变，未替换声音');sameAudio(await probeAudio(audioFile,tools,signal),m);
    // FLAC 32 in MP4 avoids a second lossy AAC encode. Validate decoded PCM
    // exactly; unsupported local codec versions fail instead of degrading it.
    const codec=m.preservation==='copy-aac'?['-c:a','copy']:['-c:a','flac','-sample_fmt','s32','-bits_per_raw_sample','32','-strict','experimental'];await command(tools.ffmpegPath,[...decodeArgs(sourceFile),'-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-i',audioFile,'-map','0:v:0','-map','1:a:0','-sn','-dn','-c:v','copy',...codec,...finish,output],{signal,maxStdout:1024});
    const resultRaw=await pcm(output,signal);if(!resultRaw.equals(raw))throw failure('结果没有严格保留原选段音频样本');
   }else await command(tools.ffmpegPath,[...decodeArgs(sourceFile),'-map','0:v:0','-an','-sn','-dn','-c:v','copy',...finish,output],{signal,maxStdout:1024});
   const metadata=await probeVideo(output,tools,signal);sameTiming(metadata,expected,{aspectOnly:true});if(metadata.hasAudio!==expected.hasAudio)throw failure('输出音轨与原视频不一致');if(expected.hasAudio)sameAudio({...metadata.audio,start:0},prepared.audio.metadata);
   return {bytes:await read(output,signal),mime:'video/mp4',metadata,audioPolicy:expected.hasAudio?(prepared.audio.metadata.preservation==='copy-aac'?'copy-source-aac':'preserve-source-decoded-pcm32-lossless'):'silent-source'};
  },context);
 }
 return {prepareMedia,inspectVideo,validateResult,preserveAudio,limits:Object.freeze({...LIMITS,...Object.fromEntries(Object.keys(LIMITS).map(key=>[key,tools[key]]))})};
}
module.exports={createVideoMaskMediaTools,LIMITS};
// Server-only primitives shared with segmentation; the existing editing path is unchanged.
module.exports.mediaInternals=Object.freeze({command,decodeArgs,probeVideo,envelope,sameTiming});
