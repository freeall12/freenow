'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {createVideoMaskMediaTools,LIMITS}=require('../server/generation-video-mask-media.cjs');
const exec=promisify(execFile),ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',ffprobe=process.env.FFPROBE_PATH||'ffprobe';
let directory,source,silent,available=false,prepared;
const tools=createVideoMaskMediaTools({ffmpegPath:ffmpeg,ffprobePath:ffprobe});
const makeMask=(overrides={})=>({encoding:'rle-zero-based-row-major',width:64,height:48,fps:16,frames:Array.from({length:128},(_,i)=>i%9===0?'':`${64*20+(i*3)%56} 3`),...overrides});
const input=()=>({source,mask:makeMask(),sourceClip:{start:1,end:6.0625}});
async function run(args){return (await exec(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{encoding:'buffer',maxBuffer:32*1024*1024})).stdout;}
async function file(bytes,name){const p=path.join(directory,name);await fs.writeFile(p,bytes);return p;}
function ready(t){if(available)return true;t.skip('FFmpeg/FFprobe unavailable; actual decoding checks were not run');return false;}
before(async()=>{
 try{await exec(ffmpeg,['-version']);await exec(ffprobe,['-version']);available=true;}catch{return;}
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'video-mask-media-tests-'));const sound=path.join(directory,'source.mp4'),mute=path.join(directory,'silent.mp4');
 await run(['-f','lavfi','-i','testsrc2=size=64x48:rate=16:duration=8','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=8','-c:v','libx264','-crf','0','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',sound]);
 await run(['-i',sound,'-map','0:v:0','-c:v','copy','-an',mute]);source={bytes:await fs.readFile(sound),mime:'video/mp4'};silent={bytes:await fs.readFile(mute),mime:'video/mp4'};
});
after(async()=>{if(directory)await fs.rm(directory,{recursive:true,force:true});});

test('actual CFR frames and nonzero clip preserve every source pixel, PTS and moving black-white mask',async t=>{
 if(!ready(t))return;const actual=await tools.inspectVideo(source);assert.equal(actual.numFrames,128);assert.equal(actual.fps,16);assert.equal(actual.duration,8);assert.equal(actual.hasAudio,true);
 prepared=await tools.prepareMedia(input());assert.deepEqual(prepared.sourceRange,{start:1,end:6.0625});assert.equal(prepared.metadata.numFrames,81);assert.equal(prepared.metadata.duration,81/16);assert.equal(prepared.metadata.hasAudio,true);assert.equal(prepared.video.metadata.hasAudio,false);assert.deepEqual(prepared.mask.metadata.pts,prepared.video.metadata.pts);
 const v=await file(prepared.video.bytes,'prepared.mp4'),mask=await file(prepared.mask.bytes,'mask.mp4');
 const original=await run(['-i',path.join(directory,'source.mp4'),'-map','0:v:0','-vf','trim=start_frame=16:end_frame=97,setpts=PTS-STARTPTS','-fps_mode','passthrough','-an','-pix_fmt','rgb24','-f','rawvideo','pipe:1']),selected=await run(['-i',v,'-an','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(selected.length,81*64*48*3);assert.equal(selected.length,original.length);assert.equal(selected.equals(original),true,'selected source pixels must decode exactly');
 const raw=await run(['-i',mask,'-an','-pix_fmt','gray','-f','rawvideo','pipe:1']);assert.equal(raw.length,81*64*48);
 for(let frame=0;frame<81;frame++){const expected=Buffer.alloc(64*48),sourceIndex=frame+16;if(sourceIndex%9!==0)expected.fill(255,64*20+(sourceIndex*3)%56,64*20+(sourceIndex*3)%56+3);assert.equal(raw.subarray(frame*64*48,(frame+1)*64*48).equals(expected),true,'every white pixel belongs to the selected moving mask');}
 assert.equal(prepared.audio.metadata.numSamples,243000);assert.equal(prepared.audio.metadata.sampleRate,48000);
});

test('precise original audio survives lossless remux and supplier audio is never substituted',async t=>{
 if(!ready(t))return;prepared??=await tools.prepareMedia(input());const result=await tools.preserveAudio(prepared.video,prepared);assert.equal(result.metadata.hasAudio,true);assert.equal(result.metadata.audio.sampleRate,48000);assert.equal(result.metadata.duration,81/16);assert.ok(['copy-source-aac','preserve-source-decoded-pcm32-lossless'].includes(result.audioPolicy));
 const audio=await file(prepared.audio.bytes,'original-audio'),complete=await file(result.bytes,'complete.mp4'),rawOriginal=await run(['-i',audio,'-c:a','pcm_s32le','-f','s32le','pipe:1']),rawComplete=await run(['-i',complete,'-map','0:a:0','-c:a','pcm_s32le','-f','s32le','pipe:1']);assert.equal(rawComplete.equals(rawOriginal),true,'remux preserves the complete original PCM samples');
 const lost={...prepared,audio:null};await assert.rejects(tools.preserveAudio(prepared.video,lost),/原音轨保存信息缺失/);
 const corrupt=Buffer.from(prepared.audio.bytes);corrupt[corrupt.length-8]^=1;await assert.rejects(tools.preserveAudio(prepared.video,{...prepared,audio:{...prepared.audio,bytes:corrupt}}),{code:'invalid_video_mask_media'});
});

test('full-source AAC copy preserves original packets and decoded samples without re-encoding',async t=>{
 if(!ready(t))return;const p=await tools.prepareMedia({source,mask:makeMask()});assert.equal(p.audio.mime,'audio/mp4');assert.equal(p.audio.metadata.preservation,'copy-aac');const result=await tools.preserveAudio(p.video,p);assert.equal(result.audioPolicy,'copy-source-aac');assert.equal(result.metadata.audio.codec,'aac');
 const complete=await file(result.bytes,'aac-complete.mp4'),original=await run(['-i',path.join(directory,'source.mp4'),'-map','0:a:0','-c:a','pcm_s32le','-f','s32le','pipe:1']),actual=await run(['-i',complete,'-map','0:a:0','-c:a','pcm_s32le','-f','s32le','pipe:1']);assert.equal(actual.equals(original),true);
});

test('silent source strips any supplier sound while keeping exact source timeline',async t=>{
 if(!ready(t))return;const p=await tools.prepareMedia({...input(),source:silent});assert.equal(p.audio,null);const v=await file(p.video.bytes,'quiet.mp4'),withSound=path.join(directory,'supplier-audio.mp4');await run(['-i',v,'-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=5.0625','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac',withSound]);const output=await tools.preserveAudio({bytes:await fs.readFile(withSound),mime:'video/mp4'},p);assert.equal(output.metadata.hasAudio,false);assert.equal(output.audioPolicy,'silent-source');assert.equal(output.metadata.numFrames,81);
});

test('result actual decoding accepts proportional size changes but rejects frame, FPS, aspect and SAR changes',async t=>{
 if(!ready(t))return;prepared??=await tools.prepareMedia(input());const original=await file(prepared.video.bytes,'result-source.mp4'),good=path.join(directory,'scaled.mp4');await run(['-i',original,'-an','-vf','scale=128:96','-c:v','libx264','-crf','0',good]);assert.equal((await tools.validateResult({bytes:await fs.readFile(good),mime:'video/mp4'},prepared)).metadata.width,128);
 const filters=['trim=end_frame=80,setpts=PTS-STARTPTS','setpts=2*PTS','scale=128:80','scale=320:232,setsar=1','setsar=2'];
 for(const [i,filter]of filters.entries()){const bad=path.join(directory,'wrong-'+i+'.mp4');await run(['-i',original,'-an','-vf',filter,'-fps_mode','passthrough','-c:v','libx264',bad]);await assert.rejects(tools.validateResult({bytes:await fs.readFile(bad),mime:'video/mp4'},prepared),{code:'invalid_video_mask_media'});}
 const mov=path.join(directory,'quicktime.mov');await run(['-i',original,'-an','-c:v','copy',mov]);const movBytes=await fs.readFile(mov);
 for(const mime of ['video/quicktime','video/mp4']){await assert.rejects(tools.validateResult({bytes:movBytes,mime},prepared),{code:'invalid_video_mask_media'});await assert.rejects(tools.preserveAudio({bytes:movBytes,mime},prepared),{code:'invalid_video_mask_media'});}
 await assert.rejects(tools.validateResult({...prepared.video,mime:'video/webm'},prepared),{code:'invalid_video_mask_media'});
 await assert.rejects(tools.validateResult({bytes:prepared.video.bytes.subarray(0,-40),mime:'video/mp4'},prepared),{code:'invalid_video_mask_media'});
 await assert.rejects(tools.validateResult(prepared.video,{metadata:{...prepared.metadata,width:undefined}}),{code:'invalid_video_mask_media'});
});

test('misaligned selections, stale full-mask metadata and selected empty mask fail without padding or truncation',async t=>{
 if(!ready(t))return;
 for(const change of [{sourceClip:{start:.41,end:5.4725}},{sourceClip:{start:0,end:5}},{sourceClip:{start:1,end:9}},{mask:makeMask({fps:15})},{mask:makeMask({width:62})},{mask:makeMask({frames:makeMask().frames.slice(1)})},{mask:makeMask({encoding:'coco-rle'})},{sourceClip:{start:1,end:6.0625,anything:true}}])await assert.rejects(tools.prepareMedia({...input(),...change}),{code:'invalid_video_mask_media'});
 const frames=Array(128).fill('');frames[0]='0 3';await assert.rejects(tools.prepareMedia({...input(),mask:makeMask({frames})}),/选段内没有遮罩目标/);
 for(const rle of ['1 2 2 3','3071 2','-1 2','1 0','1 2.0','1']){const frames=makeMask().frames;frames[17]=rle;await assert.rejects(tools.prepareMedia({...input(),mask:makeMask({frames})}),{code:'invalid_video_mask_media'});}
});

test('nonzero presentation origin and variable frame timing are rejected rather than shifted',async t=>{
 if(!ready(t))return;
 for(const [name,filter]of [['offset','setpts=PTS+5/TB'],['vfr',"setpts='if(lt(N,64),N,64+(N-64)*2)/(16*TB)' "]]){const output=path.join(directory,name+'.mp4');await run(['-i',path.join(directory,'silent.mp4'),'-an','-vf',filter.trim(),'-fps_mode','passthrough','-c:v','libx264',output]);await assert.rejects(tools.inspectVideo({bytes:await fs.readFile(output),mime:'video/mp4'}),{code:'invalid_video_mask_media'});}
});

test('media envelopes, budgets, missing tools and cancellation fail explicitly before returning partial media',async t=>{
 assert.equal(LIMITS.maxOutputBytes,100*1024*1024);for(const bad of [{source:{bytes:Buffer.from('bad'),mime:'video/mp4'},mask:{}},{source:{bytes:Buffer.from('bad'),mime:'image/png'},mask:{}},{source:{url:'https://example.invalid',mime:'video/mp4'},mask:{}},{...input(),unknown:'ignored'}])await assert.rejects(tools.prepareMedia(bad),{code:'invalid_video_mask_media'});
 const controller=new AbortController();controller.abort(Error('cancelled-before-local'));await assert.rejects(tools.inspectVideo({bytes:Buffer.from('bad'),mime:'video/mp4'},{signal:controller.signal}));
 if(!ready(t))return;
 await assert.rejects(createVideoMaskMediaTools({maxInputBytes:1024}).prepareMedia(input()),{code:'invalid_video_mask_media'});
 await assert.rejects(createVideoMaskMediaTools({maxRawMaskBytes:1024}).prepareMedia(input()),{code:'video_mask_media_budget'});
 await assert.rejects(createVideoMaskMediaTools({ffprobePath:'/private/missing-video-mask-probe'}).prepareMedia(input()),e=>e.code==='media_tool_unavailable'&&!e.message.includes('/private/'));
 await assert.rejects(createVideoMaskMediaTools({timeoutMs:1}).prepareMedia(input()),{code:'video_mask_media_timeout'});
 const abort=new AbortController(),pending=tools.prepareMedia(input(),{signal:abort.signal});setTimeout(()=>abort.abort(Error('cancelled-during-probe')),10);await assert.rejects(pending,e=>e===abort.signal.reason||e.name==='AbortError');
});
