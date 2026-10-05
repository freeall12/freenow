'use strict';
const {inlineImage}=require('./generation-image-input.cjs');
const {decodePNG}=require('./generation-png-alpha.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');

const KIND='image.skin',MODES=Object.freeze(['detailed','standard','heavy']);
const MAX_INPUT_BYTES=32*1024*1024,MAX_REQUEST_BYTES=64*1024*1024,MAX_INPUT_PIXELS=32*1024*1024;
// These are the observed editor semantics, not a verified public vendor wire.
// Never send this private wrapper shape to a guessed Enhancor or fal endpoint.
const PROFILES=Object.freeze({
 detailed:Object.freeze({provider:'enhancor',model:'enhancor-detailed'}),
 standard:Object.freeze({provider:'enhancor',model:'enhancor-realistic-skin',enhancement_mode:'standard',skin_texture_level:0.32,skin_realism_level:1.7,preserve_eyes:true,preserve_mouth:true}),
 heavy:Object.freeze({provider:'enhancor',model:'enhancor-realistic-skin',enhancement_mode:'heavy',skin_texture_level:0.42,skin_realism_level:2.3,portrait_depth:0.4,preserve_background:true})
});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});

function skinCapabilities(){
 return {kind:KIND,sourceRole:'source_image',sourceScope:'complete-image',modes:[...MODES],maxCount:1,maxInputImages:1,promptEditable:false,
  inputMimeTypes:['image/png'],inputCodec:'complete-noninterlaced-8bit-rgb-rgba-png',maxInputBytes:MAX_INPUT_BYTES,maxInputPixels:MAX_INPUT_PIXELS,
  rejectedPNGMetadataChunks:['zTXt','iTXt','iCCP'],inputSizePolicy:'original-dimensions',preservesSubmittedSourceBytes:true,
  semanticSource:'observed-editor-wrapper',vendor:'Enhancor',profiles:structuredClone(PROFILES),publicNativeProtocolVerified:false,
  outputSizePolicy:'actual-decoded-dimensions',outputCount:1,outputCodecValidation:'complete-decode',tapNowEquivalent:false};
}

// This profile describes a separately implemented tasks-v1 server contract.
// Configuration declares intent; it does not prove the remote server implements
// Enhancor, publishes media, or authenticates a supplier webhook.
function skinGatewayCapabilities(){return {...skinCapabilities(),implementation:'external-gateway-contract',semantics:'gateway-defined',vendorIntegrationRequired:true};}

function checkedSkinPNG(bytes,{apiKey=''}={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_INPUT_BYTES)throw fail('皮肤编辑来源 PNG 超过本机 32 MiB 限制或为空');
 assertCredentialFreeBytes(bytes,apiKey);
 let offset=8;
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset),end=offset+12+length;
  if(end>bytes.length||['zTXt','iTXt','iCCP'].includes(bytes.toString('ascii',offset+4,offset+8)))throw fail('皮肤编辑 PNG 不支持未审阅的压缩文本或色彩配置 metadata');
  offset=end;
 }
 let decoded;try{decoded=decodePNG(bytes);}catch{throw fail('皮肤编辑来源须为完整可解码的非交错 8-bit RGB/RGBA PNG');}
 assertCredentialFreeBytes(decoded.pixels,apiKey);
 return decoded;
}

// Validation is synchronous and has no media lookup, normalization, or network.
// The trusted host must materialize an edited selection before building this
// complete-source request. Unknown fields are rejected instead of discarded.
function validateSkinRequest(request,{apiKey=''}={}){
 rejectCredentials(request);assertCredentialFree(request,apiKey);
 if(!exact(request,['kind','label','nodeId','sourceNodeId','prompt','inputs','parameters','count','references'])||request.kind!==KIND)throw fail('皮肤编辑仅接受独立 image.skin 请求，不接受额外字段');
 let size;try{size=Buffer.byteLength(JSON.stringify(request));}catch{throw fail('皮肤编辑请求无法编码');}
 if(size>MAX_REQUEST_BYTES)throw fail('皮肤编辑请求超过本机 64 MiB 限制');
 if(request.prompt!==''||request.count!==undefined&&request.count!==1||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('皮肤编辑只接受空提示词、一个完整来源和单个结果');
 for(const key of ['label','nodeId','sourceNodeId'])if(request[key]!==undefined&&(typeof request[key]!=='string'||!request[key]||request[key].length>2048||/[\x00-\x1f\x7f]/.test(request[key])))throw fail('皮肤编辑节点标识或标题无效');
 if(!exact(request.parameters,['mode'])||Object.keys(request.parameters).length!==1||!MODES.includes(request.parameters.mode))throw fail('皮肤编辑须明确选择 detailed、standard 或 heavy，不接受额外模型参数');
 if(!Array.isArray(request.inputs)||request.inputs.length!==1)throw fail('皮肤编辑需要且仅接受一张完整来源图片');
 const input=request.inputs[0];
 if(!exact(input,['type','role','url','nodeId','width','height'])||input.type!=='image'||input.role!=='source_image')throw fail('皮肤编辑需要已物化的完整 source_image，不接受选区、裁切或其他素材字段');
 if(input.nodeId!==undefined&&(typeof input.nodeId!=='string'||!input.nodeId||input.nodeId.length>2048||/[\x00-\x1f\x7f]/.test(input.nodeId)))throw fail('皮肤编辑来源身份无效');
 if(request.sourceNodeId!==undefined&&input.nodeId!==undefined&&request.sourceNodeId!==input.nodeId)throw fail('皮肤编辑来源与源节点身份不一致');
 let image;try{image=inlineImage(input,0);}catch{throw fail('皮肤编辑来源须先物化为原尺寸完整 PNG');}
 if(image.mime!=='image/png')throw fail('皮肤编辑来源须先解码并物化为原尺寸完整 PNG');
 const decoded=checkedSkinPNG(image.bytes,{apiKey});
 if(input.width!==undefined&&input.width!==decoded.width||input.height!==undefined&&input.height!==decoded.height)throw fail('皮肤编辑来源声明尺寸与实际 PNG 不一致');
 return {mode:request.parameters.mode,profile:structuredClone(PROFILES[request.parameters.mode]),image:{...image,width:decoded.width,height:decoded.height}};
}

async function validateSkinOutputs(outputs,{apiKey='',signal}={}){
 const unknown=()=>Object.assign(Error('皮肤编辑结果未通过完整 PNG、尺寸或凭据校验；未重新提交生成'),{code:'unknown'});
 try{
  rejectCredentials(outputs);assertCredentialFree(outputs,apiKey);
  if(!Array.isArray(outputs)||outputs.length!==1)throw Error();
  const output=outputs[0];
  if(!exact(output,['type','url','width','height','mime','sourceFileId'])||output.type!=='image'||typeof output.url!=='string'||output.mime!==undefined&&output.mime!=='image/png')throw Error();
  if(output.sourceFileId!==undefined&&(typeof output.sourceFileId!=='string'||!output.sourceFileId||output.sourceFileId.length>2048||/[\x00-\x1f\x7f]/.test(output.sourceFileId)))throw Error();
  const actual=inlineImage(output,0);if(actual.mime!=='image/png')throw Error();const bytes=actual.bytes;
  if(signal?.aborted)throw signal.reason;
  const image=checkedSkinPNG(bytes,{apiKey});
  if(output.width!==undefined&&output.width!==image.width||output.height!==undefined&&output.height!==image.height)throw Error();
  return [{type:'image',url:'data:image/png;base64,'+bytes.toString('base64'),mime:'image/png',width:image.width,height:image.height,...output.sourceFileId!==undefined?{sourceFileId:output.sourceFileId}:{}}];
 }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
}

module.exports={KIND,MODES,PROFILES,MAX_INPUT_BYTES,MAX_REQUEST_BYTES,MAX_INPUT_PIXELS,skinCapabilities,skinGatewayCapabilities,checkedSkinPNG,validateSkinRequest,validateSkinOutputs};
