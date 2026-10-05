'use strict';
const {inlineImage}=require('./generation-image-input.cjs');
const {decodePNG}=require('./generation-png-alpha.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');

const ALIAS='image.upscale:magnific',MODEL='magnific-v2';
const MAX_INPUT_BYTES=32*1024*1024,MAX_INPUT_PIXELS=32*1024*1024,MAX_REQUEST_BYTES=64*1024*1024;
const MAX_OUTPUT_BYTES=100*1024*1024,MAX_OUTPUT_PIXELS=100000000;
const PNG_METADATA=['iCCP','iTXt','zTXt'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});

function magnificCapabilities(){return {
 kind:'image.upscale',model:MODEL,vendor:'Magnific',implementation:'public-vendor-native',publicNativeProtocolVerified:true,
 sourceRole:'source_image',sourceScope:'complete-image',maxInputImages:1,maxCount:1,promptEditable:false,
 inputMimeTypes:['image/png'],inputCodec:'complete-noninterlaced-8bit-rgb-rgba-png',inputSizePolicy:'original-dimensions',
 preservesSubmittedSourceBytes:true,inputOriginalEncodingGuaranteed:false,rejectedPNGMetadataChunks:[...PNG_METADATA],maxInputBytes:MAX_INPUT_BYTES,maxInputPixels:MAX_INPUT_PIXELS,
 scaleFactors:Array.from({length:15},(_,i)=>i+2),uiScaleFactors:Array.from({length:7},(_,i)=>i+2),
 parameters:{scaleFactor:{min:2,max:16,default:2},sharpen:{min:0,max:100,default:7},smartGrain:{min:0,max:100,default:7},ultraDetail:{min:0,max:100,default:30}},
 defaults:{scaleFactor:2,sharpen:7,smartGrain:7,ultraDetail:30},
 outputCount:1,outputSizePolicy:'actual-decoded-dimensions',outputCodecValidation:'complete-decode',outputDecoder:'local-png-or-ffmpeg',
 outputMimeTypes:['image/png','image/jpeg','image/webp'],maxOutputBytes:MAX_OUTPUT_BYTES,maxOutputPixels:MAX_OUTPUT_PIXELS,
 budgetScope:'local-only',vendorOutputMimeGuaranteed:false,tapNowEquivalent:false
};}

function checkedSourcePNG(bytes,{apiKey=''}={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_INPUT_BYTES)throw fail('Magnific 来源超过本机 32 MiB 预算或为空');
 assertCredentialFreeBytes(bytes,apiKey);
 let offset=8;
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset),end=offset+12+length,type=bytes.toString('ascii',offset+4,offset+8);
  if(end>bytes.length||[...PNG_METADATA,'acTL','fcTL','fdAT','tRNS'].includes(type))throw fail('Magnific 来源须为已规范化的静态 RGB/RGBA PNG，不接受动画、额外透明度或压缩 metadata');
  offset=end;
 }
 let decoded;try{decoded=decodePNG(bytes);}catch{throw fail('Magnific 来源须为完整可解码的非交错 8-bit RGB/RGBA PNG');}
 assertCredentialFreeBytes(decoded.pixels,apiKey);
 return decoded;
}

function validateMagnificRequest(request,{apiKey=''}={}){
 rejectCredentials(request);assertCredentialFree(request,apiKey);
 if(!exact(request,['kind','label','nodeId','sourceNodeId','prompt','inputs','parameters','count','references'])||request.kind!=='image.upscale')throw fail('Magnific 只接受独立 image.upscale 请求，不接受额外字段');
 let size;try{size=Buffer.byteLength(JSON.stringify(request));}catch{throw fail('Magnific 请求无法编码');}
 if(size>MAX_REQUEST_BYTES)throw fail('Magnific 请求超过本机 64 MiB 预算');
 if(request.prompt!==''||request.count!==undefined&&request.count!==1||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('Magnific 需要空提示词、单张完整来源和单个结果');
 for(const key of ['label','nodeId','sourceNodeId'])if(request[key]!==undefined&&(typeof request[key]!=='string'||!request[key]||request[key].length>2048||/[\x00-\x1f\x7f]/.test(request[key])))throw fail('Magnific 节点身份或标题无效');
 const p=request.parameters;
 if(!exact(p,['provider','scaleFactor','sharpen','smartGrain','ultraDetail'])||Object.keys(p).length!==5||p.provider!=='magnific')throw fail('Magnific 需要显式四参数，不接受其他供应商、型号覆盖或未支持参数');
 const parameters={scaleFactor:p.scaleFactor,sharpen:p.sharpen,smartGrain:p.smartGrain,ultraDetail:p.ultraDetail};
 for(const [key,value]of Object.entries(parameters))if(!Number.isSafeInteger(value)||value<(key==='scaleFactor'?2:0)||value>(key==='scaleFactor'?16:100))throw fail('Magnific 倍率须为 2–16 整数，锐化、颗粒和细节须为 0–100 整数');
 if(!Array.isArray(request.inputs)||request.inputs.length!==1)throw fail('Magnific 需要且仅接受一张完整来源图片');
 const input=request.inputs[0];
 if(!exact(input,['type','role','url','nodeId','width','height'])||input.type!=='image'||input.role!=='source_image')throw fail('Magnific 需要已物化的完整 source_image，不接受裁切或选区字段');
 if(input.nodeId!==undefined&&(typeof input.nodeId!=='string'||!input.nodeId||input.nodeId.length>2048||/[\x00-\x1f\x7f]/.test(input.nodeId)))throw fail('Magnific 来源身份无效');
 if(request.sourceNodeId!==undefined&&input.nodeId!==undefined&&request.sourceNodeId!==input.nodeId)throw fail('Magnific 来源与源节点身份不一致');
 let image;try{image=inlineImage(input,0);}catch{throw fail('Magnific 来源须先物化为原尺寸完整 PNG');}
 if(image.mime!=='image/png')throw fail('Magnific 来源须先解码并物化为原尺寸完整 PNG');
 const decoded=checkedSourcePNG(image.bytes,{apiKey});
 for(const key of ['width','height'])if(input[key]!==undefined&&input[key]!==decoded[key])throw fail('Magnific 来源声明尺寸与实际 PNG 不一致');
 return {parameters,image:{...image,width:decoded.width,height:decoded.height}};
}

module.exports={ALIAS,MODEL,MAX_INPUT_BYTES,MAX_INPUT_PIXELS,MAX_REQUEST_BYTES,MAX_OUTPUT_BYTES,MAX_OUTPUT_PIXELS,magnificCapabilities,checkedSourcePNG,validateMagnificRequest};
