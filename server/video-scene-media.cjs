'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');

const MAX_INPUT_BYTES=40*1024*1024,MAX_OUTPUT_BYTES=40*1024*1024,MAX_DURATION=600,MAX_SCENES=32;
const INPUT_FORMATS='mov,matroska,webm,ogg';
const MIME_TYPES=new Set(['video/mp4','video/webm','video/quicktime','video/ogg']);
let activeJobs=0;
const failure=(message,code='video_analysis_failed')=>Object.assign(Error(message),{code});
const toolFailure=error=>failure(error?.code==='EAGAIN'?'本机视频处理资源繁忙':error?.code==='ENOENT'?'未找到 FFmpeg/FFprobe，请配置本机工具路径':'无法启动视频处理工具',error?.code==='EAGAIN'?'video_analysis_busy':['ENOENT','EACCES','ENOEXEC'].includes(error?.code)?'media_tool_unavailable':'video_analysis_failed');
const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('已取消视频分析','AbortError');};

// Commands receive only private temporary paths and validated numeric values.
// No input URL or arbitrary FFmpeg options can cross this boundary.
async function command(binary,args,{signal,timeoutMs=120000,maxStdout=1024*1024}={}){
 check(signal);
 return new Promise((resolve,reject)=>{
  let child,stdout=[],stdoutBytes=0,stderr='',reason,timer,forceTimer;
  const stop=error=>{reason||=error;if(child){child.kill('SIGTERM');forceTimer||=setTimeout(()=>child.kill('SIGKILL'),1000);}};
  const cancel=()=>stop(signal.reason||new DOMException('已取消视频分析','AbortError'));
  try{child=spawn(binary,args,{stdio:['ignore','pipe','pipe']});}catch(error){reject(toolFailure(error));return;}
  timer=setTimeout(()=>stop(failure('本地视频分析超时，未返回部分镜头','video_analysis_timeout')),timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>maxStdout)stop(failure('视频处理输出超过预算','video_analysis_budget'));else stdout.push(chunk);});
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(Buffer.byteLength(stderr)>2*1024*1024)stop(failure('镜头检测日志超过预算，未截断分析','video_analysis_budget'));});
  child.on('error',error=>{reason||=toolFailure(error);});
  child.on('close',code=>{
   clearTimeout(timer);clearTimeout(forceTimer);signal?.removeEventListener('abort',cancel);
   if(reason)return reject(reason);
   if(code!==0)return reject(failure('视频解码或处理失败，未返回部分镜头'));
   resolve({stdout:Buffer.concat(stdout).toString(),stderr});
  });
 });
}

async function probe(file,options){
 const result=await command(options.ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-show_entries','stream=codec_type,width,height,duration,avg_frame_rate:format=duration','-of','json',file],options);
 let value;try{value=JSON.parse(result.stdout);}catch{throw failure('无法读取实际视频元数据');}
 const video=value.streams?.find(stream=>stream.codec_type==='video');
 const duration=Number(video?.duration||value.format?.duration),width=video?.width,height=video?.height;
 if(!video||!Number.isFinite(duration)||duration<=0||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||height<2||width>8192||height>8192||width*height>33554432)throw failure('视频时长或画幅无效，未提交视觉分析','invalid_video_input');
 const [numerator,denominator]=String(video.avg_frame_rate||'0/1').split('/').map(Number),fps=numerator/denominator;
 return {duration,width,height,fps:Number.isFinite(fps)&&fps>0?fps:30,hasAudio:value.streams.some(stream=>stream.codec_type==='audio')};
}

function inputRange(clip,duration){
 if(clip===undefined||clip===null)return {start:0,end:duration};
 if(!clip||typeof clip!=='object'||Array.isArray(clip)||Object.keys(clip).some(key=>!['start','end'].includes(key))||!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>duration+0.001)throw failure('视频裁切区间必须是原片内的完整 start/end','invalid_video_clip');
 return {start:clip.start,end:Math.min(duration,clip.end)};
}

function sceneRanges(log,range){
 const length=range.end-range.start,cuts=[];
 for(const match of log.matchAll(/lavfi\.scd\.time:\s*([\d.eE+-]+)/g)){
  const time=Number(match[1]);
  if(!Number.isFinite(time)||time<0||time>length+0.001)throw failure('检测器返回无效镜头时间');
  // A boundary at the very first/last frame does not create a positive scene.
  if(time>0.000001&&time<length-0.000001&&!cuts.some(cut=>Math.abs(cut-time)<0.000001))cuts.push(time);
 }
 cuts.sort((a,b)=>a-b);
 if(cuts.length+1>MAX_SCENES)throw failure('检测到超过32个镜头，请先裁短视频；未截断结果','video_analysis_budget');
 const points=[0,...cuts,length];
 return points.slice(1).map((end,index)=>({start:range.start+points[index],end:range.start+end}));
}

async function analyzeVideoMedia(input,{signal,ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg',ffprobePath=process.env.FFPROBE_PATH||'ffprobe'}={}){
 check(signal);
 if(!input||!Buffer.isBuffer(input.bytes)||!input.bytes.length||input.bytes.length>MAX_INPUT_BYTES||!MIME_TYPES.has(input.mimeType))throw failure('视频分析需实际视频字节，且输入不超过40 MiB','invalid_video_input');
 if(activeJobs>=2)throw failure('本地视频分析队列已满，请稍后重试','video_analysis_busy');
 activeJobs++;
 let directory,timer;
 const controller=new AbortController(),cancel=()=>controller.abort(signal.reason||new DOMException('已取消视频分析','AbortError'));
 signal?.addEventListener('abort',cancel,{once:true});
 if(signal?.aborted)cancel();
 timer=setTimeout(()=>controller.abort(failure('完整视频分析超过五分钟预算，未返回部分镜头','video_analysis_timeout')),300000);
 const options={signal:controller.signal,ffmpegPath,ffprobePath};
 try{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-video-scenes-'));
  const source=path.join(directory,'input');await fs.writeFile(source,input.bytes,{mode:0o600});check(controller.signal);
  const metadata=await probe(source,options);
  if(metadata.duration>MAX_DURATION)throw failure('视频原片超过600秒，请先裁短原片','video_analysis_budget');
  const range=inputRange(input.clip,metadata.duration);
  // Scan every decoded frame of the selected range. RGB avoids luma-only
  // misses for differently colored cuts with similar luminance. Hard cuts are
  // still an approximation; the private official detector is not reproduced.
  const detection=await command(ffmpegPath,['-hide_banner','-loglevel','info','-nostdin','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-i',source,'-map','0:v:0','-an','-sn','-dn','-vf',`trim=start=${range.start}:end=${range.end},setpts=PTS-${range.start}/TB,scale=320:-2,format=rgb24,scdet=threshold=10`,'-f','null','-'],options);
  const ranges=sceneRanges(detection.stderr,range),scenes=[];let outputBytes=0;
  async function readOutput(file){check(controller.signal);let stat;try{stat=await fs.stat(file);}catch{throw failure('分镜没有生成完整媒体，未返回部分结果');}if(!stat.size||stat.size>MAX_OUTPUT_BYTES-outputBytes)throw failure('镜头媒体总量超过40 MiB，未返回部分结果','video_analysis_budget');const bytes=await fs.readFile(file);outputBytes+=bytes.length;return bytes;}
  for(const [index,timing]of ranges.entries()){
   check(controller.signal);const requestedDuration=timing.end-timing.start,videoPath=path.join(directory,`scene-${index}.mp4`);
   await command(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-i',source,'-ss',String(timing.start),'-t',String(requestedDuration),'-map','0:v:0','-map','0:a:0?','-sn','-dn','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-fs',String(MAX_OUTPUT_BYTES-outputBytes+1),'-y',videoPath],options);
   const actual=await probe(videoPath,options);
   if(Math.abs(actual.duration-requestedDuration)>Math.max(0.12,2/metadata.fps))throw failure('分镜媒体没有完整覆盖对应原片区间，未返回部分结果');
   const video=await readOutput(videoPath),frames=[];
   const frameProbe=await command(ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',videoPath],{...options,maxStdout:16*1024*1024});
   const timestamps=frameProbe.stdout.split('\n').map(line=>/^([\d.eE+-]+)(?:,|$)/.exec(line)?.[1]).filter(value=>value!==undefined).map(Number);
   if(!timestamps.length||timestamps.some(time=>!Number.isFinite(time)||time<0))throw failure('无法读取分镜的实际画面时间');
   for(const [frameIndex,fraction]of [.1,.5,.9].entries()){
    check(controller.signal);const sampledDuration=Math.min(actual.duration,requestedDuration),targetTime=Math.max(0,Math.min(sampledDuration-0.001,sampledDuration*fraction)),imagePath=path.join(directory,`scene-${index}-frame-${frameIndex}.jpg`);
    const candidates=timestamps.map((time,index)=>({time,index})).filter(frame=>frame.time<requestedDuration);
    if(!candidates.length)throw failure('分镜没有位于原片区间内的实际画面');
    const selected=candidates.reduce((best,frame)=>Math.abs(frame.time-targetTime)<Math.abs(best.time-targetTime)?frame:best),localTime=selected.time;
    // Seeking past the last display timestamp may produce no image even when
    // the container duration is longer. Select an actual decoded frame instead.
    await command(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-i',videoPath,'-map','0:v:0','-an','-sn','-dn','-frames:v','1','-vf',`select='eq(n,${selected.index})',scale='min(768,iw)':-2:out_range=full,format=yuvj420p`,'-q:v','3','-y',imagePath],options);
    // Transcoding can quantize source frames. This maps a real output display
    // timestamp into the requested source range; it is not original-source PTS.
    frames.push({time:timing.start+localTime,presentationTime:localTime,timeBasis:'source-range-mapped-output-presentation-approximate',image:await readOutput(imagePath)});
   }
   const poster=frames[1].image;
   if(outputBytes+poster.length>MAX_OUTPUT_BYTES)throw failure('分镜海报及媒体总量超过40 MiB，未返回部分结果','video_analysis_budget');
   outputBytes+=poster.length;
   scenes.push({...timing,duration:actual.duration,width:actual.width,height:actual.height,video,poster,frames});
  }
  check(controller.signal);
  return {duration:metadata.duration,width:metadata.width,height:metadata.height,range,scenes};
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',cancel);
  try{if(directory){for(const name of await fs.readdir(directory))await fs.unlink(path.join(directory,name));await fs.rmdir(directory);}}finally{activeJobs--;}
 }
}

module.exports={analyzeVideoMedia,MAX_INPUT_BYTES,MAX_OUTPUT_BYTES,MAX_DURATION,MAX_SCENES};
