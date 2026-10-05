'use strict';

// Explicit supplier-boundary fixture. No network fallback or fake socket/DNS
// state is used: source bytes and PNG streams are injected into the adapter.
const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto'),{deflateSync}=require('node:zlib');
const root=path.resolve(__dirname,'../../../..');
const {crc32}=require(path.join(root,'server/generation-png-alpha.cjs'));
const {decodeSegmentationPng}=require(path.join(root,'server/video-segmentation-masks.cjs'));
const {createGenerationMediaDownloader}=require(path.join(root,'server/generation-media-download.cjs'));
const {SAM2_VERSION}=require(path.join(root,'server/video-segmentation-replicate-transport.cjs'));
const run=promisify(execFile),KEY='synthetic-sam2-local-qa-only-token';
const WIDTH=320,HEIGHT=180,FPS=10,FRAMES=50;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const modes=new Set(['success','delay','prompt-conflict','one-failed-download','unknown-receipt','needs-resume']);
const shape=index=>({x:20+index*4,y:60,width:40,height:50});
function pixelsAt(index){const shapeAt=shape(index),pixels=Buffer.alloc(WIDTH*HEIGHT*3);for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){const inside=x>=shapeAt.x&&x<shapeAt.x+40&&y>=60&&y<110;pixels.set(inside?[240,180,40]:[24,32,44],(y*WIDTH+x)*3);}return pixels;}
function chunk(type,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;}
function maskPNG(index,conflict=false){const s=shape(index),raw=Buffer.alloc((WIDTH+1)*HEIGHT);for(let y=s.y;y<s.y+s.height;y++)raw.fill(255,y*(WIDTH+1)+1+s.x+(conflict?1:0),y*(WIDTH+1)+1+s.x+s.width+(conflict?1:0));const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(WIDTH);ihdr.writeUInt32BE(HEIGHT,4);ihdr[8]=8;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const blocked=()=>Object.assign(Error('Unmatched supplier fixture boundary; external network blocked.'),{code:'segmentation_fixture_blocked'});
async function createSam2Fixture({directory,ffmpegPath='ffmpeg',ffprobePath='ffprobe',mode='success',history}={}){
 if(!modes.has(mode))throw blocked();
 const sourceFile=path.join(directory,'sam2-source.mp4'),rawFile=path.join(directory,'sam2-source.rgb');
 if(!await fs.stat(sourceFile).catch(()=>null)){
  const sourcePixels=Array.from({length:FRAMES},(_,i)=>pixelsAt(i));
  await fs.writeFile(rawFile,Buffer.concat(sourcePixels),{mode:0o600});
  await run(ffmpegPath,['-v','error','-nostdin','-f','rawvideo','-pixel_format','rgb24','-video_size',`${WIDTH}x${HEIGHT}`,'-framerate',String(FPS),'-i',rawFile,'-an','-vf','setsar=1','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-video_track_timescale',String(FPS),'-movflags','+faststart',sourceFile],{timeout:20000});
  await fs.unlink(rawFile);
 }
 // Browser source uses common H.264/yuv420p. Branch identity is compared with
 // these actual decoded source RGB bytes, including the source codec's losses.
 const decodedSource=(await run(ffmpegPath,['-v','error','-nostdin','-i',sourceFile,'-map','0:v:0','-an','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',maxBuffer:12*1024*1024,timeout:20000})).stdout;
 const sourceFrameBytes=WIDTH*HEIGHT*3;if(decodedSource.length!==FRAMES*sourceFrameBytes)throw blocked();
 const sourceHashes=Array.from({length:FRAMES},(_,i)=>digest(decodedSource.subarray(i*sourceFrameBytes,(i+1)*sourceFrameBytes)));
 const sourceBytes=await fs.readFile(sourceFile);
 if(history&&history.source.sha256!==digest(sourceBytes))throw blocked();
 const sourceDataUrl='data:video/mp4;base64,'+sourceBytes.toString('base64'),dataDownloader=createGenerationMediaDownloader();
 const files=new Map(),predictions=new Map(),pngs=new Map();let origin='',sequence=history?.uploads.length??0,downloadFaultUsed=false;
 const audit={fixture:true,networkFallback:false,supplier:'synthetic Replicate boundary',mode,source:{width:WIDTH,height:HEIGHT,fps:FPS,numFrames:FRAMES,duration:5,sha256:digest(sourceBytes),movingBox:true,hasAudio:false,codec:'h264',pixelFormat:'yuv420p',uploadComparison:'actual source decoded RGB'},counts:{uploadPostAttempts:0,uploadPosts:0,predictionPosts:0,predictionGets:0,cancelPosts:0,sourceDownloads:0,pngDownloadAttempts:0,pngDownloads:0,rejectedBoundaryCalls:0},uploads:[],predictions:[],downloads:[]};
 if(history){Object.assign(audit.counts,history.counts);for(const key of ['uploads','predictions','downloads'])audit[key]=structuredClone(history[key]);}
 const snapshot=()=>structuredClone(audit);
 async function verifyVideo(bytes,direction){
  const name=`upload-${++sequence}`,file=path.join(directory,name+'.mp4');await fs.writeFile(file,bytes,{mode:0o600});
  const probe=JSON.parse((await run(ffprobePath,['-v','error','-select_streams','v:0','-show_entries','stream=width,height,nb_frames,avg_frame_rate','-of','json',file],{timeout:20000})).stdout).streams[0];
  const {stdout}=await run(ffmpegPath,['-v','error','-nostdin','-i',file,'-map','0:v:0','-an','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',maxBuffer:12*1024*1024,timeout:20000});
  const frameBytes=WIDTH*HEIGHT*3;if(probe.width!==WIDTH||probe.height!==HEIGHT||probe.avg_frame_rate!=='10/1'||stdout.length%frameBytes)throw blocked();
  const indices=[];for(let i=0;i<stdout.length/frameBytes;i++){const hash=digest(stdout.subarray(i*frameBytes,(i+1)*frameBytes)),index=sourceHashes.indexOf(hash);if(index<0)throw blocked();indices.push(index);}
  const k=indices[0],expected=direction==='forward'?Array.from({length:FRAMES-k},(_,i)=>k+i):Array.from({length:k+1},(_,i)=>k-i);
  if(JSON.stringify(indices)!==JSON.stringify(expected))throw blocked();
  return {numFrames:indices.length,sourceIndices:indices,firstFrameSha256:sourceHashes[k],pixelOrderVerified:true};
 }
 function predictionDTO(value){const processing=audit.mode==='delay'&&Date.now()<value.readyAt;return {id:value.id,model:'meta/sam-2-video',version:SAM2_VERSION,input:value.input,status:value.cancelled?'canceled':processing?'processing':'succeeded',...(!processing&&!value.cancelled?{output:value.output}:{})};}
 const fetchImpl=async(url,options={})=>{
  try{
   if(typeof url!=='string'||new Headers(options.headers).get('authorization')!=='Bearer '+KEY||options.redirect!=='error')throw blocked();
   if(url==='https://api.replicate.com/v1/files'&&options.method==='POST'){
    if(!(options.body instanceof FormData)||Array.from(options.body.keys()).join(',')!=='content')throw blocked();
    const file=options.body.get('content'),direction=file.name?.replace(/\.mp4$/,'');if(!['forward','reverse'].includes(direction)||file.type!=='video/mp4')throw blocked();
    audit.counts.uploadPostAttempts++;
    if(audit.mode==='needs-resume'&&direction==='reverse')return await new Promise((_,reject)=>{const stop=()=>reject(Object.assign(Error('Expected fixture upload interrupted by service close.'),{code:'segmentation_cancelled'}));options.signal.addEventListener('abort',stop,{once:true});if(options.signal.aborted)stop();});
    const bytes=Buffer.from(await file.arrayBuffer()),meta=await verifyVideo(bytes,direction),id='file'+(audit.uploads.length+1);files.set(id,{bytes,direction,...meta});audit.counts.uploadPosts++;audit.uploads.push({id,direction,bytes:bytes.length,sha256:digest(bytes),...meta});
    return Response.json({id,urls:{get:'https://api.replicate.com/v1/files/'+id},content_type:'video/mp4',size:bytes.length,checksums:{sha256:digest(bytes)},expires_at:new Date(Date.now()+3600000).toISOString()});
   }
   if(url==='https://api.replicate.com/v1/predictions'&&options.method==='POST'){
    const body=JSON.parse(options.body),input=body.input,fileId=input?.input_video?.replace('https://api.replicate.com/v1/files/',''),file=files.get(fileId);
    if(body.version!==SAM2_VERSION||!file||Object.keys(input).sort().join(',')!==['input_video','click_coordinates','click_labels','click_frames','click_object_ids','mask_type','output_video','output_format','output_frame_interval'].sort().join(',')||input.click_labels!=='1'||input.click_frames!=='0'||input.click_object_ids!=='target'||input.mask_type!=='binary'||input.output_video!==false||input.output_format!=='png'||input.output_frame_interval!==1)throw blocked();
    const point=JSON.parse(input.click_coordinates),s=shape(file.sourceIndices[0]);if(!Array.isArray(point)||point.length!==2||point.some(v=>!Number.isInteger(v))||point[0]<s.x||point[0]>=s.x+s.width||point[1]<s.y||point[1]>=s.y+s.height)throw blocked();
    const id='fixtureprediction'+(audit.predictions.length+1),output=file.sourceIndices.map((sourceIndex,index)=>{const url=`https://replicate.delivery/sam2-local/${id}/frame_${String(index).padStart(5,'0')}.png`,bytes=maskPNG(sourceIndex,audit.mode==='prompt-conflict'&&file.direction==='reverse'&&index===0);pngs.set(url,{bytes,id,direction:file.direction,index,sourceIndex});return url;});
    const value={id,input,direction:file.direction,output,readyAt:Date.now()+5000,cancelled:false};predictions.set(id,value);audit.counts.predictionPosts++;audit.predictions.push({id,direction:file.direction,numFrames:file.numFrames,promptFrameIndex:file.sourceIndices[0],point,...audit.mode==='unknown-receipt'?{receipt:'synthetically lost'}:{receipt:'known'}});
    if(audit.mode==='unknown-receipt')throw Object.assign(Error('Synthetic accepted POST lost its receipt.'),{code:'segmentation_unknown'});
    return Response.json(predictionDTO(value));
   }
   const match=/^https:\/\/api\.replicate\.com\/v1\/predictions\/(fixtureprediction\d+)(\/cancel)?$/.exec(url),value=match&&predictions.get(match[1]);
   if(!value)throw blocked();
   if(match[2]&&options.method==='POST'){audit.counts.cancelPosts++;value.cancelled=true;return Response.json(predictionDTO(value));}
   if(!match[2]&&options.method==='GET'){audit.counts.predictionGets++;return Response.json(predictionDTO(value));}
   throw blocked();
  }catch(error){if(error.code==='segmentation_fixture_blocked')audit.counts.rejectedBoundaryCalls++;throw error;}
 };
 const downloader={async download(url,{kind,signal,onBytes=()=>{}}={}){
  if(signal?.aborted)throw Object.assign(Error('Fixture download cancelled.'),{code:'media_cancelled'});
  // The production browser sends a real data URL. Keep the production decoder,
  // signature sniffing and source-byte limits for that non-network path.
  if(kind==='source'&&url===sourceDataUrl){audit.counts.sourceDownloads++;return dataDownloader.download(url,{kind,signal,onBytes});}
  if(kind==='source'&&[origin+'/qa/sam2-source.mp4',origin+'/qa/trim-scenes.mp4'].includes(url)){audit.counts.sourceDownloads++;onBytes(sourceBytes.length);return {mime:'video/mp4',expectedBytes:sourceBytes.length,stream:Readable.from([sourceBytes])};}
  const png=pngs.get(url);if(kind!=='image'||!png){audit.counts.rejectedBoundaryCalls++;throw blocked();}
  audit.counts.pngDownloadAttempts++;
  if(audit.mode==='one-failed-download'&&!downloadFaultUsed&&png.direction==='forward'&&png.index===3){downloadFaultUsed=true;throw Object.assign(Error('Synthetic one-time PNG download failure.'),{code:'media_download_failed'});}
  const decoded=decodeSegmentationPng(png.bytes,{width:WIDTH,height:HEIGHT});onBytes(png.bytes.length);audit.counts.pngDownloads++;audit.downloads.push({predictionId:png.id,direction:png.direction,index:png.index,sourceIndex:png.sourceIndex,bytes:png.bytes.length,sha256:digest(png.bytes),pixelSha256:decoded.pixelSha256,foregroundPixels:decoded.foregroundPixels});
  return {mime:'image/png',expectedBytes:png.bytes.length,stream:Readable.from([png.bytes])};
 }};
 return {sourceFile,sourceBytes,apiKey:KEY,fetchImpl,downloader,snapshot,setOrigin(value){origin=value;},setMode(value){if(!modes.has(value))throw blocked();audit.mode=value;downloadFaultUsed=false;return snapshot();},modes:[...modes]};
}
module.exports={createSam2Fixture};
