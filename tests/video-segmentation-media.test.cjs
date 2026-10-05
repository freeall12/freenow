'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{createHash}=require('node:crypto');
const {createVideoSegmentationMediaTools}=require('../server/video-segmentation-media.cjs');
const exec=promisify(execFile),tools=createVideoSegmentationMediaTools();let directory,source,raw,available=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const request=(time=0,changes={})=>({width:64,height:48,duration:.5,time,pointPrompts:[{x:32,y:24,time,label:1}],...changes});
const input=(time=0,changes={})=>({source,request:request(time,changes)});
async function ffmpeg(args){return (await exec('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'buffer',maxBuffer:8*1024*1024})).stdout;}
const ready=t=>{if(available)return true;t.skip('FFmpeg/FFprobe unavailable: no actual decode verification');return false;};
before(async()=>{try{await exec('ffmpeg',['-version']);await exec('ffprobe',['-version']);available=true;}catch{return;}directory=await fs.mkdtemp(path.join(os.tmpdir(),'segmentation-media-tests-'));const file=path.join(directory,'source.mp4');await ffmpeg(['-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=0.5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:v','libx264','-crf','0','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);source={bytes:await fs.readFile(file),mime:'video/mp4'};raw=await ffmpeg(['-i',file,'-map','0:v:0','-an','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);});
after(async()=>{if(directory)await fs.rm(directory,{recursive:true,force:true});});

test('first, interior and duration clicks materialize lossless actual frame branches with exact full mapping',async t=>{
 if(!ready(t))return;
 for(const [time,k,expected]of [[0,0,[['forward',[0,1,2,3,4]]]],[.21,2,[['forward',[2,3,4]],['reverse',[2,1,0]]]],[.5,4,[['reverse',[4,3,2,1,0]]]]]){
  const prepared=await tools.prepareSegmentationMedia(input(time));assert.equal(prepared.source.sha256,hash(source.bytes));assert.equal(prepared.source.hasAudio,true);assert.equal(prepared.source.numFrames,5);assert.equal(prepared.prompt.frameIndex,k);assert.equal(prepared.prompt.time,time);assert.equal(prepared.prompt.pts,k/10);
  assert.deepEqual(prepared.branches.map(b=>[b.direction,b.sourceIndices]),expected);
  for(const branch of prepared.branches){const file=path.join(directory,`prepared-${time}-${branch.direction}.mp4`);await fs.writeFile(file,branch.bytes);const decoded=await ffmpeg(['-i',file,'-map','0:v:0','-an','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);const mapped=Buffer.concat(branch.sourceIndices.map(i=>raw.subarray(i*64*48*3,(i+1)*64*48*3)));assert.equal(decoded.equals(mapped),true,'each frame must equal its actual original source RGB frame');assert.equal(branch.firstFrameSha256,hash(raw.subarray(k*64*48*3,(k+1)*64*48*3)));assert.equal(branch.sha256,hash(branch.bytes));assert.equal(branch.numFrames,branch.sourceIndices.length);const probe=JSON.parse((await exec('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',file])).stdout);assert.deepEqual(probe.streams.map(s=>s.codec_type),['video']);}
 }
 const tied=await tools.prepareSegmentationMedia(input(.15));assert.equal(tied.prompt.frameIndex,1,'an equidistant click deterministically chooses the earlier PTS');
});

test('single frame and noninteger CFR retain rational timing without padding or rate conversion',async t=>{
 if(!ready(t))return;
 for(const [name,rate,frames]of [['single','10/1',1],['fractional','30000/1001',7]]){const file=path.join(directory,name+'.mp4');await ffmpeg(['-f','lavfi','-i',`testsrc2=size=64x48:rate=${rate}`,'-frames:v',String(frames),'-c:v','libx264','-crf','0','-pix_fmt','yuv420p',file]);const [num,den]=rate.split('/').map(Number),duration=frames*den/num,time=duration/2,prepared=await tools.prepareSegmentationMedia({source:{bytes:await fs.readFile(file),mime:'video/mp4'},request:request(time,{duration})});assert.equal(prepared.source.numFrames,frames);assert.equal(prepared.source.fpsNumerator,num);assert.equal(prepared.source.fpsDenominator,den);assert.equal(prepared.source.fps,num/den);if(frames===1)assert.deepEqual(prepared.branches.map(b=>[b.direction,b.sourceIndices]),[['forward',[0]]]);else assert.deepEqual(prepared.branches.map(b=>b.sourceIndices),[[3,4,5,6],[3,2,1,0]]);}
});

test('stale declarations and invalid hints fail without accepting an approximate source',async t=>{
 for(const bad of [undefined,null,{}, {source,request:null}])await assert.rejects(tools.prepareSegmentationMedia(bad),{code:'segmentation_media_invalid'});
 if(!ready(t))return;
 for(const changes of [{width:62},{height:46},{duration:.6},{time:.6},{pointPrompts:[{x:64,y:24,time:0,label:1}]},{pointPrompts:[{x:32,y:24,time:0,label:0}]},{pointPrompts:[{x:32,y:24,time:.1,label:1}]},{selection:{x:0,y:0,width:.5,height:1}},{extra:'ignored'}])await assert.rejects(tools.prepareSegmentationMedia(input(0,changes)),{code:'segmentation_media_invalid'});
 await assert.rejects(tools.prepareSegmentationMedia({source:{bytes:source.bytes.subarray(0,-30),mime:'video/mp4'},request:request()}),{code:'invalid_video_mask_media'});
 const good=await tools.prepareSegmentationMedia(input(0,{selection:{x:0,y:0,width:1,height:1}}));assert.equal(good.prompt.x,32);
});

test('VFR, nonzero PTS and unmaterialized rotation are rejected before branch encoding',async t=>{
 if(!ready(t))return;const original=path.join(directory,'source.mp4');
 for(const [name,filter]of [['vfr',"setpts='if(lt(N,2),N,2+(N-2)*2)/(10*TB)'"],['offset','setpts=PTS+5/TB']]){const file=path.join(directory,name+'.mp4');await ffmpeg(['-i',original,'-an','-vf',filter,'-fps_mode','passthrough','-c:v','libx264',file]);await assert.rejects(tools.prepareSegmentationMedia({source:{bytes:await fs.readFile(file),mime:'video/mp4'},request:request()}),{code:'segmentation_media_invalid'});}
 const rotated=path.join(directory,'rotated.mp4');await ffmpeg(['-display_rotation:v:0','90','-i',original,'-map','0:v:0','-c:v','copy',rotated]);await assert.rejects(tools.prepareSegmentationMedia({source:{bytes:await fs.readFile(rotated),mime:'video/mp4'},request:request()}),/旋转信息未物化/);
});

test('aggregate raw and byte budgets fail before returning any partial branch',async t=>{
 if(!ready(t))return;
 for(const options of [{maxRawDiskBytes:1024},{maxRawPixels:1024},{maxTotalBytes:source.bytes.length-1},{maxPreparedBytes:1024},{maxSourceFrames:4}])await assert.rejects(createVideoSegmentationMediaTools(options).prepareSegmentationMedia(input(.2)),e=>['segmentation_media_budget','segmentation_media_invalid'].includes(e.code));
 await assert.rejects(createVideoSegmentationMediaTools({maxInputBytes:source.bytes.length-1}).prepareSegmentationMedia(input()),{code:'invalid_video_mask_media'});
 await assert.rejects(createVideoSegmentationMediaTools({timeoutMs:1}).prepareSegmentationMedia(input()),{code:'segmentation_media_timeout'});
});

test('real 720p and 1080p five-second sources prepare full dual branches within bounded disk budget',async t=>{
 if(!ready(t))return;
 for(const [width,height]of [[1280,720],[1920,1080]]){
  const file=path.join(directory,`normal-${width}.mp4`),fps=10,numFrames=50,time=2.5;
  await ffmpeg(['-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=${fps}:duration=5`,'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p',file]);
  const prepared=await tools.prepareSegmentationMedia({source:{bytes:await fs.readFile(file),mime:'video/mp4'},request:request(time,{width,height,duration:5,pointPrompts:[{x:width/2,y:height/2,time,label:1}]})});
  assert.equal(prepared.source.numFrames,numFrames);assert.equal(prepared.source.duration,5);assert.equal(prepared.prompt.frameIndex,25);assert.deepEqual(prepared.branches.map(b=>b.numFrames),[25,26]);assert.deepEqual(prepared.branches[0].sourceIndices,Array.from({length:25},(_,i)=>25+i));assert.deepEqual(prepared.branches[1].sourceIndices,Array.from({length:26},(_,i)=>25-i));assert.equal(prepared.branches[0].firstFrameSha256,prepared.branches[1].firstFrameSha256);assert.ok(prepared.branches.reduce((sum,b)=>sum+b.bytes.length,0)<=90*1024*1024);
 }
});

test('inflight abort kills its child, releases concurrency and deletes only its own temporary directory',async t=>{
 if(!ready(t))return;const executable=path.join(directory,'blocked-probe'),marker=path.join(directory,'child.json');await fs.writeFile(executable,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,file:process.argv.at(-1)}));setInterval(()=>{},1000);\n`,{mode:0o700});
 const local=createVideoSegmentationMediaTools({ffprobePath:executable,maxConcurrent:1}),abort=new AbortController(),pending=local.prepareSegmentationMedia(input(),{signal:abort.signal});const rejection=assert.rejects(pending,e=>e===abort.signal.reason);let record;
 try{for(let i=0;i<100;i++){try{record=JSON.parse(await fs.readFile(marker,'utf8'));break;}catch{}await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(record,'controlled child started');await assert.rejects(local.prepareSegmentationMedia(input()),{code:'segmentation_media_busy'});}finally{abort.abort(Error('stop-local-preparation'));}
 await rejection;assert.throws(()=>process.kill(record.pid,0),{code:'ESRCH'});await assert.rejects(fs.stat(path.dirname(record.file)),{code:'ENOENT'});assert.equal((await fs.stat(directory)).isDirectory(),true,'fixture directory remains');const completed=await tools.prepareSegmentationMedia(input());assert.equal(completed.branches.length,1);
 const early=new AbortController();early.abort(Error('early'));await assert.rejects(tools.prepareSegmentationMedia(input(),{signal:early.signal}),e=>e===early.signal.reason);
});
