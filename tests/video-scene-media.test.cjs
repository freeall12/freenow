'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {analyzeVideoMedia,MAX_INPUT_BYTES}=require('../server/video-scene-media.cjs');
const exec=promisify(execFile),ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',ffprobe=process.env.FFPROBE_PATH||'ffprobe';
let directory,bytes,available=false;
before(async()=>{
 try{await exec(ffmpeg,['-version']);await exec(ffprobe,['-version']);available=true;}catch{return;}
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-video-scenes-test-'));
 const input=path.join(directory,'three-colors.mp4');
 await exec(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=red:s=96x64:r=10:d=1','-f','lavfi','-i','color=c=green:s=96x64:r=10:d=1','-f','lavfi','-i','color=c=blue:s=96x64:r=10:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',input]);
 bytes=await fs.readFile(input);
});
after(async()=>{if(directory){for(const name of await fs.readdir(directory))await fs.unlink(path.join(directory,name));await fs.rmdir(directory);}});
const options={ffmpegPath:ffmpeg,ffprobePath:ffprobe};
function needsMedia(t){if(available)return true;t.skip('本机 FFmpeg/FFprobe 不可用；实际媒体回归未执行');return false;}
async function inspectScene(scene,index,dominantChannel){
 const file=path.join(directory,`result-${index}.mp4`);await fs.writeFile(file,scene.video);
 const {stdout}=await exec(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file]);
 const metadata=JSON.parse(stdout),video=metadata.streams.find(stream=>stream.codec_type==='video');
 assert.equal(Number(video.duration),scene.duration);assert.equal(video.width,scene.width);assert.equal(video.height,scene.height);
 assert.ok(metadata.streams.some(stream=>stream.codec_type==='audio'),'裁切保留实际音轨');
 assert.ok(Math.abs(scene.duration-(scene.end-scene.start))<.12);
 for(const frame of scene.frames){assert.ok(frame.time>=scene.start&&frame.time<scene.end);assert.equal(frame.timeBasis,'source-range-mapped-output-presentation-approximate');assert.equal(frame.time,scene.start+frame.presentationTime);assert.equal(frame.image.readUInt16BE(0),0xffd8);assert.ok(frame.image.length>100);}
 assert.equal(scene.frames.length,3);assert.ok(scene.poster.equals(scene.frames[1].image));
 if(dominantChannel!==undefined){const poster=path.join(directory,`poster-${index}.jpg`);await fs.writeFile(poster,scene.poster);const {stdout}=await exec(ffmpeg,['-hide_banner','-loglevel','error','-i',poster,'-vf','scale=1:1','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer'});assert.equal(stdout.length,3);assert.ok(stdout[dominantChannel]>70);assert.ok(stdout[dominantChannel]>stdout[(dominantChannel+1)%3]+50&&stdout[dominantChannel]>stdout[(dominantChannel+2)%3]+50,'海报实际像素匹配对应分镜颜色');}
}

test('full-frame scene scan detects all three colors and returns real playable clips/audio/posters',async t=>{
 if(!needsMedia(t))return;
 const result=await analyzeVideoMedia({bytes,mimeType:'video/mp4'},options);
 assert.deepEqual(result.range,{start:0,end:3});assert.equal(result.duration,3);assert.equal(result.width,96);assert.equal(result.height,64);
 assert.equal(result.scenes.length,3);
 for(const [index,scene]of result.scenes.entries()){assert.ok(Math.abs(scene.start-index)<.01);assert.ok(Math.abs(scene.end-(index+1))<.01);await inspectScene(scene,index,index);}
});

test('selected clip produces all scenes with original absolute offsets and real media durations',async t=>{
 if(!needsMedia(t))return;
 const result=await analyzeVideoMedia({bytes,mimeType:'video/mp4',clip:{start:.4,end:2.6}},options);
 assert.deepEqual(result.range,{start:.4,end:2.6});assert.equal(result.scenes.length,3);
 const expected=[[.4,1],[1,2],[2,2.6]];
 for(const [index,scene]of result.scenes.entries()){assert.ok(Math.abs(scene.start-expected[index][0])<.01);assert.ok(Math.abs(scene.end-expected[index][1])<.01);await inspectScene(scene,index+10);}
});

test('no-cut selected clip retains one real scene without inventing boundaries',async t=>{
 if(!needsMedia(t))return;
 const result=await analyzeVideoMedia({bytes,mimeType:'video/mp4',clip:{start:1.2,end:1.8}},options);
 assert.equal(result.scenes.length,1);assert.equal(result.scenes[0].start,1.2);assert.equal(result.scenes[0].end,1.8);await inspectScene(result.scenes[0],20);
});

test('two-color selected range returns two complete offset clips',async t=>{
 if(!needsMedia(t))return;
 const result=await analyzeVideoMedia({bytes,mimeType:'video/mp4',clip:{start:.4,end:1.6}},options);
 assert.equal(result.scenes.length,2);assert.equal(result.scenes[0].start,.4);assert.equal(result.scenes[0].end,1);assert.equal(result.scenes[1].start,1);assert.equal(result.scenes[1].end,1.6);
 for(const [index,scene]of result.scenes.entries())await inspectScene(scene,30+index);
});

test('non-frame-aligned clip retains source cut timestamps and declares mapped presentation times',async t=>{
 if(!needsMedia(t))return;
 const result=await analyzeVideoMedia({bytes,mimeType:'video/mp4',clip:{start:.45,end:2.65}},options);
 const expected=[[.45,1],[1,2],[2,2.65]];
 assert.equal(result.scenes.length,3);
 for(const [index,scene]of result.scenes.entries()){
  assert.ok(Math.abs(scene.start-expected[index][0])<.001);assert.ok(Math.abs(scene.end-expected[index][1])<.001);await inspectScene(scene,40+index);
 }
});

test('rejects URL-only data, unsupported mime, oversized input and pre-cancellation without dispatch',async()=>{
 for(const input of [{url:'https://example.invalid/video.mp4',mimeType:'video/mp4'},{bytes:Buffer.from('bad'),mimeType:'application/octet-stream'},{bytes:Buffer.alloc(MAX_INPUT_BYTES+1),mimeType:'video/mp4'}])await assert.rejects(analyzeVideoMedia(input,options),{code:'invalid_video_input'});
 const controller=new AbortController();controller.abort(new DOMException('stop','AbortError'));
 await assert.rejects(analyzeVideoMedia({bytes:Buffer.from('bad'),mimeType:'video/mp4'},{...options,signal:controller.signal}),{name:'AbortError'});
});

test('missing local decoder returns a safe unavailable code without leaking the executable path',async()=>{
 const missing='/private/nonexistent-ffprobe-tool-for-video-test';
 await assert.rejects(analyzeVideoMedia({bytes:Buffer.from('video bytes'),mimeType:'video/mp4'},{ffprobePath:missing}),error=>error.code==='media_tool_unavailable'&&!error.message.includes(missing)&&!error.cause);
 if(available)await assert.rejects(analyzeVideoMedia({bytes,mimeType:'video/mp4'},{...options,ffmpegPath:missing}),error=>error.code==='media_tool_unavailable'&&!error.message.includes(missing)&&!error.cause);
});

test('validates clip bounds against actual source and rejects malformed source bytes',async t=>{
 if(!needsMedia(t))return;
 for(const clip of [{start:-1,end:2},{start:1,end:1},{start:0,end:4},{start:0},{start:0,end:1,url:'ignored'}])await assert.rejects(analyzeVideoMedia({bytes,mimeType:'video/mp4',clip},options),{code:'invalid_video_clip'});
 await assert.rejects(analyzeVideoMedia({bytes:Buffer.from('not a movie'),mimeType:'video/mp4'},options),{code:'video_analysis_failed'});
});

test('in-flight cancellation kills the decoder and removes private temporary inputs',async t=>{
 if(!needsMedia(t))return;
 const executable=path.join(directory,'waiting-tool'),marker=path.join(directory,'cancelled-input-path');await fs.writeFile(executable,`#!/bin/sh\nfor media_arg; do :; done\nprintf '%s' "$media_arg" > '${marker}'\nexec /bin/sleep 10\n`,{mode:0o700});
 const controller=new AbortController(),start=Date.now();
 const pending=analyzeVideoMedia({bytes,mimeType:'video/mp4'},{...options,ffprobePath:executable,signal:controller.signal});
 const timer=setTimeout(()=>controller.abort(new DOMException('stop','AbortError')),2000);pending.catch(()=>{});let inputPath;
 try{
  for(let attempt=0;attempt<70;attempt++){try{inputPath=await fs.readFile(marker,'utf8');break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
  controller.abort(new DOMException('stop','AbortError'));await assert.rejects(pending,{name:'AbortError'});
 }finally{clearTimeout(timer);controller.abort();await pending.catch(()=>{});}
 assert.ok(Date.now()-start<3000,'取消不等待完整处理超时');
 assert.ok(inputPath?.includes('canvas-video-scenes-'));
 await assert.rejects(fs.stat(path.dirname(inputPath)),{code:'ENOENT'},'取消清理本次任务的输入临时目录');
});

test('scene and original-duration budgets reject whole analysis instead of truncating',async t=>{
 if(!needsMedia(t))return;
 const manyCuts=path.join(directory,'many-cuts.mp4'),longSource=path.join(directory,'long-source.mp4');
 await exec(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=black:s=64x48:r=20:d=3.4','-vf',"geq=lum='if(mod(floor(N/2),2),235,16)':cb=128:cr=128",'-c:v','libx264','-pix_fmt','yuv420p','-y',manyCuts]);
 await assert.rejects(analyzeVideoMedia({bytes:await fs.readFile(manyCuts),mimeType:'video/mp4'},options),error=>error.code==='video_analysis_budget'&&error.message.includes('32'));
 await exec(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=black:s=32x32:r=1:d=601','-c:v','libx264','-pix_fmt','yuv420p','-y',longSource]);
 await assert.rejects(analyzeVideoMedia({bytes:await fs.readFile(longSource),mimeType:'video/mp4'},options),error=>error.code==='video_analysis_budget'&&error.message.includes('600'));
});

test('bounds local decoder concurrency and releases slots after abort',async t=>{
 if(!needsMedia(t))return;
 const executable=path.join(directory,'waiting-concurrency');await fs.writeFile(executable,'#!/bin/sh\nexec /bin/sleep 10\n',{mode:0o700});
 const controller=new AbortController(),first=analyzeVideoMedia({bytes,mimeType:'video/mp4'},{...options,ffprobePath:executable,signal:controller.signal}),second=analyzeVideoMedia({bytes,mimeType:'video/mp4'},{...options,ffprobePath:executable,signal:controller.signal});
 const results=Promise.allSettled([first,second]);
 await assert.rejects(analyzeVideoMedia({bytes,mimeType:'video/mp4'},options),{code:'video_analysis_busy'});
 controller.abort(new DOMException('stop','AbortError'));assert.ok((await results).every(result=>result.status==='rejected'&&result.reason.name==='AbortError'));
 const result=await analyzeVideoMedia({bytes,mimeType:'video/mp4',clip:{start:0,end:.3}},options);assert.equal(result.scenes.length,1);
});
