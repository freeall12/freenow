'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deflateSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {crc32}=require('../server/generation-png-alpha.cjs');
const {decodeSegmentationPng:decode,mergeSegmentationMasks:merge}=require('../server/video-segmentation-masks.cjs');

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;}
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
function png({width=3,height=5,type=0,pixels,filters=[0,1,2,3,4],header={},rawOverride,compressedOverride,before=[],after=[],split=false}={}){
 const channels=type===0?1:type===2?3:4,row=width*channels;
 pixels??=Buffer.from(Array.from({length:width*height*channels},(_,i)=>type===6&&i%4===3?255:(Math.floor(i/channels)%3===1?255:0)));
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=header.depth??8;ihdr[9]=type;ihdr[10]=header.compression??0;ihdr[11]=header.filter??0;ihdr[12]=header.interlace??0;
 const raw=Buffer.alloc((row+1)*height);
 for(let y=0;y<height;y++){
  const filter=filters[y%filters.length];raw[y*(row+1)]=filter;
  for(let x=0;x<row;x++){
   const a=x>=channels?pixels[y*row+x-channels]:0,b=y?pixels[(y-1)*row+x]:0,c=y&&x>=channels?pixels[(y-1)*row+x-channels]:0;
   const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
   raw[y*(row+1)+1+x]=(pixels[y*row+x]-prediction)&255;
  }
 }
 const compressed=compressedOverride??deflateSync(rawOverride??raw),middle=Math.max(1,Math.floor(compressed.length/2));
 const idats=split?[chunk('IDAT',compressed.subarray(0,middle)),chunk('IDAT',compressed.subarray(middle))]:[chunk('IDAT',compressed)];
 return Buffer.concat([signature,chunk('IHDR',ihdr),...before,...idats,...after,chunk('IEND',Buffer.alloc(0))]);
}
const expectInvalid=fn=>assert.throws(fn,error=>error.code==='segmentation_invalid_result'&&error.status===502);
function record(values,width=3,height=2,type=0){const pixels=Buffer.from(values.flatMap(v=>type===0?[v]:type===2?[v,v,v]:[v,v,v,255]));return decode(png({width,height,type,pixels,filters:[0,4]}),{width,height});}
const source=(numFrames=5)=>({width:3,height:2,fps:30000/1001,numFrames,duration:numFrames/(30000/1001)});
function branch(direction,k,numFrames,records){const count=direction==='forward'?numFrames-k:k+1,step=direction==='forward'?1:-1;return {direction,numFrames:count,sourceIndices:Array.from({length:count},(_,j)=>k+step*j),frames:Array.from({length:count},(_,j)=>records[k+step*j])};}
function input(k=2,numFrames=5){const records=Array.from({length:numFrames},(_,i)=>record(Array.from({length:6},(_,j)=>j===i%6?255:0)));return {source:source(numFrames),prompt:{frameIndex:k},branches:k===0?[branch('forward',k,numFrames,records)]:k===numFrames-1?[branch('reverse',k,numFrames,records)]:[branch('forward',k,numFrames,records),branch('reverse',k,numFrames,records)]};}

test('real zlib grayscale/RGB/RGBA, all five filters, canonical row-major RLE and identical pixel hashes',async()=>{
 const values=[0,255,255,255,0,0,0,255,0,0,0,255,255,255,0];
 const expected='1 3 7 1 11 3',hash=createHash('sha256').update(Buffer.from(values)).digest('hex');
 for(const type of [0,2,6]){
  const pixels=Buffer.from(values.flatMap(v=>type===0?[v]:type===2?[v,v,v]:[v,v,v,255]));
  const result=decode(png({type,pixels,split:true}),{width:3,height:5});
  assert.deepEqual(result,{width:3,height:5,rle:expected,foregroundPixels:7,pixelSha256:hash});
  // Crossing index 2 -> 3 must stay one run, proving rows are contiguous.
  const {decodeMask}=await import('../src/features/video-mask/core.mjs');
  const rgba=decodeMask(result.rle,3,5);assert.deepEqual(Array.from(rgba.filter((_,i)=>i%4===3)),values.map(v=>v?128:0));
 }
});

test('reject CRC corruption, truncation, trailing data, duplicate headers and unsafe PNG chunks',()=>{
 const valid=png(),badCRC=Buffer.from(valid);badCRC[badCRC.length-1]^=1;
 const header=valid.subarray(8,33);
 for(const bytes of [badCRC,valid.subarray(0,-1),Buffer.concat([valid,Buffer.from([0])]),Buffer.concat([valid.subarray(0,33),header,valid.subarray(33)])])expectInvalid(()=>decode(bytes,{width:3,height:5}));
 for(const type of ['tEXt','zTXt','iTXt','iCCP','tRNS','acTL','fcTL','fdAT','PLTE','gAMA','vpAg','ABCD']){
  expectInvalid(()=>decode(png({before:[chunk(type,Buffer.from('credential-secret'))]}),{width:3,height:5}));
 }
 expectInvalid(()=>decode(png({after:[chunk('IDAT',Buffer.alloc(0))]}),{width:3,height:5}));
});

test('reject alternate depth, unsupported color, interlace, wrong dimensions and byte/pixel budgets',()=>{
 for(const header of [{depth:16},{depth:1},{interlace:1},{compression:1},{filter:1}])expectInvalid(()=>decode(png({header}),{width:3,height:5}));
 for(const type of [3,4,5])expectInvalid(()=>decode(png({type}),{width:3,height:5}));
 expectInvalid(()=>decode(png(),{width:5,height:3}));
 expectInvalid(()=>decode(png(),{width:3,height:5,maxBytes:60}));
 expectInvalid(()=>decode(png(),{width:3,height:5,maxPixels:14}));
 expectInvalid(()=>decode(png(),{width:3,height:5,maxPixels:0}));
 expectInvalid(()=>decode(png(),{width:3,height:5,maxBytes:33*1024*1024}));
});

test('reject malformed compressed streams, expanded excess/short data and unsupported filters in every color mode',()=>{
 for(const type of [0,2,6]){
  const channels=type===0?1:type===2?3:4,expected=(3*channels+1)*5;
  const raw=Buffer.alloc(expected);raw[0]=5;
  for(const options of [{compressedOverride:Buffer.from('not-zlib')},{rawOverride:Buffer.alloc(expected+1)},{rawOverride:Buffer.alloc(expected-1)},{rawOverride:raw},{compressedOverride:Buffer.concat([deflateSync(Buffer.alloc(expected)),Buffer.from('trailer')])},{compressedOverride:Buffer.concat([deflateSync(Buffer.alloc(expected)),deflateSync(Buffer.alloc(expected))])}])expectInvalid(()=>decode(png({type,...options}),{width:3,height:5}));
 }
});

test('only exact 0/255 binary and fully opaque gray RGB/RGBA are accepted, empty frames remain explicit',()=>{
 for(const value of [1,127,254])expectInvalid(()=>record([0,value,255,0,0,0]));
 const colored=Buffer.from([255,0,255,0,0,0]);expectInvalid(()=>decode(png({width:2,height:1,type:2,pixels:colored}),{width:2,height:1}));
 for(const alpha of [0,1,254])expectInvalid(()=>decode(png({width:1,height:1,type:6,pixels:Buffer.from([255,255,255,alpha])}),{width:1,height:1}));
 assert.equal(record([0,0,0,0,0,0]).rle,'');
 assert.equal(record([255,255,255,255,255,255]).rle,'0 6');
});

test('all first/middle/last prompt boundaries including one frame map exactly to original sequence',async()=>{
 const {validateMask}=await import('../src/features/video-mask/core.mjs');
 for(const n of [1,2,5,11])for(let k=0;k<n;k++){
  const value=input(k,n),result=merge(value);
  assert.equal(result.fps,30000/1001);assert.equal(result.frames.length,n);
  assert.deepEqual(result.frames,Array.from({length:n},(_,i)=>`${i%6} 1`));
  assert.deepEqual(validateMask(result,value.source),result);
  if(value.branches.length===2)assert.deepEqual(merge({...value,branches:[...value.branches].reverse()}),result);
 }
});

test('reject missing/extra/duplicate branches, wrong direction and every invalid source index mapping',()=>{
 for(const change of [v=>v.branches.pop(),v=>v.branches.push(v.branches[0]),v=>v.branches[1]=v.branches[0],v=>v.branches[0].direction='backward',v=>v.branches[0].sourceIndices[1]=2,v=>v.branches[0].sourceIndices[1]=4,v=>v.branches[0].sourceIndices.pop(),v=>v.branches[0].sourceIndices.push(5),v=>v.branches[0].numFrames--,v=>v.branches[0].frames.pop(),v=>v.branches[0].frames.push(v.branches[0].frames[0])]){
  const value=input();change(value);expectInvalid(()=>merge(value));
 }
 const last=input(4);last.branches.push({direction:'forward',numFrames:1,sourceIndices:[4],frames:[last.branches[0].frames[0]]});expectInvalid(()=>merge(last));
});

test('two prompt frames must have identical decoded pixels independent of PNG color encoding',()=>{
 const value=input();value.branches[1].frames[0]=record([0,0,255,0,0,0],3,2,6);
 assert.deepEqual(merge(value).frames,['0 1','1 1','2 1','3 1','4 1']);
 value.branches[1].frames[0]=record([0,0,0,255,0,0]);expectInvalid(()=>merge(value));
});

test('reject forged hashes/count/dimensions, noncanonical/overlap/out of bounds RLE and all-empty result',()=>{
 for(const change of [f=>f.width=2,f=>f.height=3,f=>f.foregroundPixels=2,f=>f.pixelSha256='0'.repeat(64),f=>f.rle='01 1',f=>f.rle='0 1 ',f=>f.rle='0 0',f=>f.rle='0 1 1 1',f=>f.rle='0 2 1 1',f=>f.rle='6 1',f=>f.rle='9007199254740992 1',f=>f.rle='0',f=>f.rle='0 6 1 1']){
  const value=input();change(value.branches[0].frames[0]);expectInvalid(()=>merge(value));
 }
 const value=input();for(const b of value.branches)b.frames=b.frames.map(()=>record([0,0,0,0,0,0]));expectInvalid(()=>merge(value));
});

test('total RLE and decompression pixel budgets include the duplicate prompt, source metadata is validated',()=>{
 const value=input();assert.equal(merge({...value,maxRleBytes:18,maxTotalPixels:36}).frames.length,5);
 expectInvalid(()=>merge({...value,maxRleBytes:17}));expectInvalid(()=>merge({...value,maxTotalPixels:35}));
 for(const change of [v=>v.source.numFrames=0,v=>v.source.fps=NaN,v=>v.source.duration=10,v=>v.source.width=0,v=>v.prompt.frameIndex=5,v=>v.prompt.frameIndex=1.5]){const bad=input();change(bad);expectInvalid(()=>merge(bad));}
});

test('fragmented binary mask spans bounded encoder chunks and streaming RLE validation without changing pixel order',()=>{
 const width=128,height=256,values=Array.from({length:width*height},(_,i)=>i%2?255:0);
 const frame=record(values,width,height),expected=values.flatMap((v,i)=>v?[`${i} 1`]:[]).join(' ');
 assert.ok(frame.rle.length>65536);assert.equal(frame.rle,expected);
 const result=merge({source:{width,height,numFrames:1,fps:1,duration:1},prompt:{frameIndex:0},branches:[{direction:'forward',numFrames:1,sourceIndices:[0],frames:[frame]}]});
 assert.deepEqual(result.frames,[expected]);
});
