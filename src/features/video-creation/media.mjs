import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {createLocalClipResolver} from '../agent-workflows/local-clip-resolver.mjs';
import {prepareWorkflowInputs} from '../agent-workflows/media-transport.mjs';
import {assertExtensionConfiguration} from './native-profile.mjs';

// Run inside TaskService, after route readiness and before its dispatch receipt.
// A selected clip must become actual video bytes, not merely metadata beside the
// uncut original: task gateways cannot otherwise know which frames to continue.
export async function prepareExtensionMedia(request,{
 signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,localMedia=globalThis.LocalMedia,
 baseUrl=globalThis.document?.baseURI,resolveMedia,transport=prepareWorkflowInputs,nativeConfiguration
}={}){
 if(request.kind!=='video.extend')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason;validateSources();};
 check();if(nativeConfiguration)assertExtensionConfiguration(nativeConfiguration,request);const prepared=structuredClone(request),inputs=prepared.inputs||[];
 const nodes=inputs.map((input,index)=>{
  if(input.type==='text')return null;
  const clip=input.type==='video'?(input.role==='source_video'?prepared.parameters?.sourceClip:input.clip):null;
  return {id:'extension-input:'+index,type:input.type,[input.type]:input.url,...clip?{clip}:{}};
 });
 const clips=nodes.some(node=>node?.clip);
 if(!resolveMedia){
  const resolveClip=clips?createLocalClipResolver({getNode:id=>{check();return nodes.find(node=>node?.id===id);},localMedia}):undefined;
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl,resolveClip,timeoutMs:clips?120000:20000});
 }
 for(const [index,input]of inputs.entries()){
  check();if(input.type==='text')continue;
  const node=nodes[index],actual=await resolveMedia(node,{signal});check();
  input.url=actual.url;
  if(actual.width!==undefined)input.width=actual.width;
  if(actual.height!==undefined)input.height=actual.height;
  if(actual.duration!==undefined){input.duration=actual.duration;input.durationMs=Math.round(actual.duration*1000);}
  if(node.clip){input.sourceRange={...node.clip};delete input.clip;if(input.role==='source_video')prepared.parameters.sourceClip=null;}
 }
 if(nativeConfiguration)assertExtensionConfiguration(nativeConfiguration,prepared,{prepared:true});
 const result=await transport(prepared,{signal,baseUrl,validateSources:check,timeoutMs:120000});check();if(nativeConfiguration)assertExtensionConfiguration(nativeConfiguration,result,{prepared:true});return result;
}
