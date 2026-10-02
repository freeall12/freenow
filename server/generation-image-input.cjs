'use strict';
const invalid=()=>Object.assign(Error('图片参考须为有效的内联 PNG、JPEG 或 WebP，未提交模型'),{code:'unsupported_generation'});

// This validates the upload envelope and format dimensions, not a full codec.
// The browser separately decodes the submitted bytes before dispatch.
function inlineImage(input,index){
 const match=typeof input?.url==='string'&&/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.url);
 if(!match||match[2].length%4!==0)throw invalid();
 const bytes=Buffer.from(match[2],'base64');
 if(!bytes.length||bytes.length>=50*1024*1024||bytes.toString('base64')!==match[2])throw invalid();
 let width=0,height=0;const format=match[1];
 if(format==='png'){
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw invalid();
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
  let offset=8,sawData=false,sawEnd=false;
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),end=offset+12+length;if(end>bytes.length)throw invalid();const type=bytes.toString('ascii',offset+4,offset+8);if(type==='IDAT')sawData=true;if(type==='IEND'){if(length||end!==bytes.length)throw invalid();sawEnd=true;break;}offset=end;}
  if(!sawData||!sawEnd)throw invalid();
 }else if(format==='jpeg'){
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw invalid();
  let offset=2;
  while(offset+4<=bytes.length){if(bytes[offset++]!==255)throw invalid();while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;if(offset+2>bytes.length)throw invalid();const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw invalid();if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)throw invalid();height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}offset+=length;}
 }else{
  if(bytes.length<25||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw invalid();
  const type=bytes.toString('ascii',12,16),length=bytes.readUInt32LE(16);if(20+length>bytes.length)throw invalid();
  if(type==='VP8X'&&length>=10){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
  else if(type==='VP8L'&&length>=5&&bytes[20]===47){const bits=bytes.readUInt32LE(21);width=1+(bits&16383);height=1+((bits>>>14)&16383);}
  else if(type==='VP8 '&&length>=10&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}
 }
 if(!width||!height||width>65535||height>65535)throw invalid();
 return {bytes,mime:'image/'+format,name:'reference-'+(index+1)+'.'+(format==='jpeg'?'jpg':format),width,height};
}
module.exports={inlineImage};
