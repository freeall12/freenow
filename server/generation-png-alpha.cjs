'use strict';
const {inflateSync,deflateSync}=require('node:zlib');
const MAX_PIXELS=32*1024*1024,MAX_MASK_BYTES=4*1024*1024,signature=Buffer.from([137,80,78,71,13,10,26,10]);
const invalid=()=>Object.assign(Error('蒙版需要完整、非交错的 8-bit RGB/RGBA PNG，未提交模型'),{code:'unsupported_generation'});
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);name.copy(bytes,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;}
function encodeRGBA(width,height,rgba){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_PIXELS||rgba.length!==width*height*4)throw invalid();const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const row=width*4,raw=Buffer.alloc((row+1)*height);for(let y=0;y<height;y++)rgba.copy(raw,y*(row+1)+1,y*row,(y+1)*row);return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
function decodePNG(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<45||!bytes.subarray(0,8).equals(signature))throw invalid();
 let offset=8,width=0,height=0,channels=0,ended=false,sawData=false,dataEnded=false,sawPalette=false;const compressed=[];
 while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),end=offset+12+length;if(end>bytes.length)throw invalid();const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw invalid();
  if(type==='IHDR'){if(offset!==8||length!==13)throw invalid();width=data.readUInt32BE(0);height=data.readUInt32BE(4);if(!width||!height||width>65535||height>65535||width*height>MAX_PIXELS||data[8]!==8||![2,6].includes(data[9])||data[10]||data[11]||data[12])throw invalid();channels=data[9]===6?4:3;}
  else if(type==='IDAT'){if(!channels||dataEnded)throw invalid();sawData=true;compressed.push(data);}
  else if(type==='IEND'){if(length||!sawData||end!==bytes.length)throw invalid();ended=true;break;}
  else{if(type==='PLTE'){if(sawData||sawPalette||!length||length>768||length%3)throw invalid();sawPalette=true;}if(sawData)dataEnded=true;if(type==='tRNS'||type==='acTL'||type==='fcTL'||type==='fdAT'||type[0]===type[0].toUpperCase()&&type!=='PLTE')throw invalid();if(!channels)throw invalid();}
  offset=end;
 }
 if(!ended)throw invalid();const row=width*channels,expected=(row+1)*height;let raw;
 try{const decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected,info:true});raw=decoded.buffer;if(decoded.engine.bytesWritten!==compressed.reduce((sum,part)=>sum+part.length,0)||raw.length!==expected)throw invalid();}catch{throw invalid();}
 const pixels=Buffer.alloc(row*height);
 for(let y=0;y<height;y++){const filter=raw[y*(row+1)],start=y*row;if(filter>4)throw invalid();for(let x=0;x<row;x++){const a=x>=channels?pixels[start+x-channels]:0,b=y?pixels[start-row+x]:0,c=y&&x>=channels?pixels[start-row+x-channels]:0;pixels[start+x]=(raw[y*(row+1)+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}}
 return {width,height,channels,pixels};
}
function alphaMask(bytes){
 const image=decodePNG(bytes);if(image.channels!==4)throw invalid();const rgba=Buffer.alloc(image.width*image.height*4);let editablePixels=0,preservedPixels=0;
 for(let i=0;i<image.pixels.length;i+=4){if(image.pixels[i+3]===0)editablePixels++;else{rgba[i+3]=255;preservedPixels++;}}
 if(!editablePixels||!preservedPixels)throw Object.assign(Error('蒙版必须同时含可编辑透明区域和保留内容，未提交模型'),{code:'unsupported_generation'});
 const mask=encodeRGBA(image.width,image.height,rgba);if(mask.length>=MAX_MASK_BYTES)throw Object.assign(Error('生成的真实 PNG 蒙版超过 4 MiB，未缩放或提交模型'),{code:'unsupported_generation'});
 return {bytes:mask,width:image.width,height:image.height,editablePixels,preservedPixels};
}
module.exports={decodePNG,encodeRGBA,alphaMask,crc32,MAX_PIXELS,MAX_MASK_BYTES};
