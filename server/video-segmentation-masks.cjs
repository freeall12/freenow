'use strict';

const {inflateSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {crc32,decodePNG}=require('./generation-png-alpha.cjs');

const MAX_BYTES=32*1024*1024,MAX_PIXELS=16*1024*1024;
const MAX_RLE_BYTES=64*1024*1024,MAX_TOTAL_PIXELS=512*1024*1024;
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const invalid=message=>Object.assign(Error(message),{code:'segmentation_invalid_result',status:502});
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function budget(value,fallback){if(value===undefined)return fallback;if(!integer(value,1,fallback))throw invalid('分割蒙层预算无效');return value;}
function dimensions(width,height,maxPixels=MAX_PIXELS){if(!integer(width,1,65535)||!integer(height,1,65535)||width*height>maxPixels)throw invalid('分割蒙层尺寸无效或超过像素预算');}
const sha=pixels=>createHash('sha256').update(pixels).digest('hex');
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};

// SAM2's binary sequence has no ancillary chunks. A strict whitelist also
// prevents compressed/text metadata or animation from carrying hidden data.
function inspectPNG(bytes,{width:expectedWidth,height:expectedHeight,maxBytes,maxPixels}){
 if(!Buffer.isBuffer(bytes)||bytes.length<57||bytes.length>maxBytes||!bytes.subarray(0,8).equals(SIGNATURE))throw invalid('分割蒙层须为预算内完整 PNG');
 let offset=8,width,height,channels,ended=false,sawData=false;const compressed=[];
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset),end=offset+length+12;
  if(end>bytes.length)throw invalid('分割 PNG 数据不完整');
  const type=bytes.toString('latin1',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);
  if(!['IHDR','IDAT','IEND'].includes(type)||crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw invalid('分割 PNG 含无效校验、元数据或不支持的数据块');
  if(type==='IHDR'){
   if(offset!==8||length!==13)throw invalid('分割 PNG 头无效');
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);dimensions(width,height,maxPixels);
   if(width!==expectedWidth||height!==expectedHeight||data[8]!==8||![0,2,6].includes(data[9])||data[10]!==0||data[11]!==0||data[12]!==0)throw invalid('分割 PNG 须为原尺寸、非交错 8-bit 灰度/RGB/RGBA');
   channels=data[9]===0?1:data[9]===2?3:4;
  }else if(type==='IDAT'){
   if(!channels||!length)throw invalid('分割 PNG 图像数据无效');
   sawData=true;compressed.push(data);
  }else{
   if(!channels||!sawData||length!==0||end!==bytes.length)throw invalid('分割 PNG 结尾无效');
   ended=true;break;
  }
  offset=end;
 }
 if(!ended)throw invalid('分割 PNG 缺少完整结尾');
 return {width,height,channels,compressed};
}

function decodeGray({width,height,compressed}){
 const row=width,expected=(row+1)*height;let raw;
 try{
  const bytes=Buffer.concat(compressed),decoded=inflateSync(bytes,{maxOutputLength:expected,info:true});
  raw=decoded.buffer;
  if(raw.length!==expected||decoded.engine.bytesWritten!==bytes.length)throw invalid('分割 PNG 解压长度无效');
 }catch{throw invalid('分割 PNG 压缩数据损坏或超过解压预算');}
 const pixels=Buffer.alloc(width*height);
 for(let y=0;y<height;y++){
  const filter=raw[y*(row+1)],start=y*row;
  if(filter>4)throw invalid('分割 PNG 滤波方式无效');
  for(let x=0;x<row;x++){
   const a=x?pixels[start+x-1]:0,b=y?pixels[start-row+x]:0,c=y&&x?pixels[start-row+x-1]:0;
   const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
   pixels[start+x]=(raw[y*(row+1)+1+x]+prediction)&255;
  }
 }
 return pixels;
}

function encodeRuns(pixels){
 const chunks=[];let foregroundPixels=0,textBytes=0,current='',hasRun=false;
 for(let i=0;i<pixels.length;){
  if(pixels[i]===0){i++;continue;}
  const start=i;while(i<pixels.length&&pixels[i]===255)i++;
  const length=i-start,run=`${start} ${length}`;
  const text=(hasRun?' ':'')+run;textBytes+=text.length;
  if(textBytes>MAX_RLE_BYTES)throw invalid('分割 RLE 超过预算');
  current+=text;hasRun=true;foregroundPixels+=length;
  // Bound the number of retained JS objects even for checkerboard masks.
  if(current.length>=65536){chunks.push(current);current='';}
 }
 if(current)chunks.push(current);
 return {rle:chunks.join(''),foregroundPixels};
}

function decodeSegmentationPng(bytes,{width,height,maxBytes,maxPixels}={}){
 maxBytes=budget(maxBytes,MAX_BYTES);maxPixels=budget(maxPixels,MAX_PIXELS);dimensions(width,height,maxPixels);
 const image=inspectPNG(bytes,{width,height,maxBytes,maxPixels});let pixels;
 if(image.channels===1)pixels=decodeGray(image);
 else{
  let decoded;try{decoded=decodePNG(bytes);}catch{throw invalid('分割 PNG 压缩数据或滤波无效');}
  pixels=Buffer.alloc(width*height);
  for(let i=0;i<pixels.length;i++){
   const offset=i*image.channels,value=decoded.pixels[offset];
   if(decoded.pixels[offset+1]!==value||decoded.pixels[offset+2]!==value||image.channels===4&&decoded.pixels[offset+3]!==255)throw invalid('分割 PNG 含彩色或透明像素，不能作为二值蒙层');
   pixels[i]=value;
  }
 }
 for(const value of pixels)if(value!==0&&value!==255)throw invalid('分割 PNG 含非二值像素，未使用阈值转换');
 return {width,height,...encodeRuns(pixels),pixelSha256:sha(pixels)};
}

function validateFrame(frame,width,height){
 if(!frame||frame.width!==width||frame.height!==height||typeof frame.rle!=='string'||typeof frame.pixelSha256!=='string'||!/^[a-f0-9]{64}$/.test(frame.pixelSha256)||!integer(frame.foregroundPixels,0,width*height))throw invalid('分割帧缺少完整已验证像素信息');
 if(frame.rle.length>MAX_RLE_BYTES||frame.rle.endsWith(' '))throw invalid('分割帧 RLE 不是标准零基游程');
 const pairs=/(0|[1-9]\d*) ([1-9]\d*)(?: |$)/y,pixels=Buffer.alloc(width*height);let end=-1,count=0,offset=0;
 while(offset<frame.rle.length){
  pairs.lastIndex=offset;const pair=pairs.exec(frame.rle);
  if(!pair)throw invalid('分割帧 RLE 不是标准零基游程');
  offset=pairs.lastIndex;const start=Number(pair[1]),length=Number(pair[2]);
  // Adjacent runs are non-canonical: the decoder always joins them.
  if(!integer(start,0,pixels.length-1)||!integer(length,1,pixels.length)||start<=end||start+length>pixels.length)throw invalid('分割帧 RLE 越界、重叠或未合并相邻游程');
  pixels.fill(255,start,start+length);end=start+length;count+=length;
 }
 if(count!==frame.foregroundPixels||sha(pixels)!==frame.pixelSha256)throw invalid('分割帧 RLE 与已验证像素摘要不一致');
 return count;
}

function mergeSegmentationMasks({source,prompt,branches,maxRleBytes,maxTotalPixels}={}){
 maxRleBytes=budget(maxRleBytes,MAX_RLE_BYTES);maxTotalPixels=budget(maxTotalPixels,MAX_TOTAL_PIXELS);
 if(!source||!prompt)throw invalid('缺少分割来源或提示帧信息');
 const {width,height,fps,numFrames,duration}=source,k=prompt.frameIndex;dimensions(width,height);
 if(!integer(numFrames,1,54000)||!Number.isFinite(fps)||fps<=0||fps>240||!Number.isFinite(duration)||duration<=0||Math.abs(numFrames/fps-duration)>Math.max(.15,2/fps)||!integer(k,0,numFrames-1))throw invalid('分割来源帧率、帧数、时长或提示帧无效');
 const directions=k===0?['forward']:k===numFrames-1?['reverse']:['forward','reverse'];
 if(!Array.isArray(branches)||branches.length!==directions.length)throw invalid('分割分支缺失或多余');
 const totalFrames=directions.length===2?numFrames+1:numFrames;
 if(width*height*totalFrames>maxTotalPixels)throw invalid('分割全部帧超过总解压像素预算');
 const byDirection=new Map();let rleBytes=0,foreground=0;
 for(const branch of branches){
  if(!branch||!directions.includes(branch.direction)||byDirection.has(branch.direction))throw invalid('分割方向重复或无效');
  const count=branch.direction==='forward'?numFrames-k:k+1,step=branch.direction==='forward'?1:-1;
  if(branch.numFrames!==count||!Array.isArray(branch.sourceIndices)||branch.sourceIndices.length!==count||!Array.isArray(branch.frames)||branch.frames.length!==count)throw invalid('分割分支帧数缺失或多余');
  for(let j=0;j<count;j++){
   if(branch.sourceIndices[j]!==k+step*j)throw invalid('分割分支来源索引重复、缺失或不连续');
   const frame=branch.frames[j];
   if(typeof frame?.rle!=='string')throw invalid('分割分支帧数据无效');
   rleBytes+=Buffer.byteLength(frame.rle);
   if(rleBytes>maxRleBytes)throw invalid('分割全部 RLE 超过总预算');
   foreground+=validateFrame(frame,width,height);
  }
  byDirection.set(branch.direction,branch);
 }
 const forward=byDirection.get('forward'),reverse=byDirection.get('reverse');
 if(forward&&reverse&&forward.frames[0].pixelSha256!==reverse.frames[0].pixelSha256)throw invalid('两个分割分支的提示帧蒙层不一致');
 if(!foreground)throw invalid('没有识别到目标，请重新框选');
 const frames=Array.from({length:numFrames},(_,i)=>(i<k?reverse.frames[k-i]:forward?forward.frames[i-k]:reverse.frames[k-i]).rle);
 return {encoding:'rle-zero-based-row-major',width,height,fps,frames};
}

module.exports={decodeSegmentationPng,mergeSegmentationMasks,MAX_BYTES,MAX_PIXELS,MAX_RLE_BYTES,MAX_TOTAL_PIXELS};
