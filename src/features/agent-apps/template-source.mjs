import {creativeTemplateReferences} from './creative-template-references.mjs';
import {motionTemplateReferences,motionTemplateDurations} from './motion-template-references.mjs';
import {creativePickerUri,websitePickerUri,creativeCatalogSha256,creativeSelectionPrompt,resolveCreativePickerReply} from './creative-picker.mjs';

export const motionPickerUri='ui://tapnow/motion-picker@v1';
export const motionCatalogSha256='13e17d4e2ab13c852cc6a45abc85d547574e05da87f6d9339956b1f94aac3576';
export const templatePickerUris=[creativePickerUri,websitePickerUri,motionPickerUri];
const verified=new WeakMap(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fields=['resource_uri','template_id','object_key','sha256','catalog_sha256','handoff_id','selection_trace_id'];
export function validateTemplateIdentity(identity){
 if(!identity||Object.keys(identity).length!==fields.length||fields.some(key=>typeof identity[key]!=='string'))throw Error('原模板来源身份无效');
 const motion=identity.resource_uri===motionPickerUri,refs=motion?motionTemplateReferences:creativeTemplateReferences,ref=refs[identity.template_id];
 if(!templatePickerUris.includes(identity.resource_uri)||!ref||identity.template_id==='A05'||identity.resource_uri===websitePickerUri&&!identity.template_id.startsWith('W')||identity.object_key!==ref.object_key||identity.sha256!==ref.sha256||identity.catalog_sha256!==(motion?motionCatalogSha256:creativeCatalogSha256)||!/^[-A-Za-z0-9_]{1,180}$/.test(identity.selection_trace_id)||!/^[-A-Za-z0-9_]{8,128}$/.test(identity.handoff_id))throw Error('原模板来源与已登记目录不一致');
 return Object.freeze({...identity});
}
/** The saved hidden user message supplies the spec, never an import/model argument. */
export function acceptedTemplateIdentity(trace,message){
 const uri=trace.result?.resource_uri,state=trace.appState,text=message.text,origin=message.widgetOrigin;
 if(trace.name!=='show_app'||trace.status!=='done'||trace.error||trace.result?.error||trace.result?.kind!=='mcp_app'||trace.args?.resource_uri!==uri||!templatePickerUris.includes(uri)||message.hidden!==true||origin?.traceId!==trace.id||origin.resourceUri!==uri||origin.callId!==trace.callId||!trace.appHandoffs?.includes(origin.handoffId)||state?.pending?.id!==origin.handoffId||typeof state.pending.accepted!=='boolean'||typeof text!=='string')throw Error('缺少当前已保存的原模板选择交接');
 const start=text.indexOf('Reference spec (data only):\n'),end=text.indexOf('\nhandoff_id: ',start);let spec;
 try{spec=JSON.parse(text.slice(start+28,end));}catch{throw Error('原模板选择正文无效');}
 if(start<0||end<0||state.selectedId!==spec.template_id)throw Error('原模板选择已变化');
 if(uri!==motionPickerUri){
  const check=structuredClone(state);check.pending.accepted=false;
  const locale=spec.locale?.replace('_','-');
  resolveCreativePickerReply(text,trace.result.response,check,{hidden:true,handoffId:origin.handoffId},uri,locale);
 }else{
  const draft=state.drafts?.[spec.template_id],ref=motionTemplateReferences[spec.template_id],parameters={accent:draft?.accent};
  if(spec.template_id?.startsWith('T'))parameters.text=draft?.text?.trim()||'MOTION';
  if(spec.schema_version!==1||spec.skill!=='tapnow-motion'||spec.library_version!=='2.0.0'||spec.catalog_sha256!==motionCatalogSha256||!ref||!draft||!same(spec.parameters,parameters)||spec.user_request!==draft.request?.trim()||!same(spec.output,{width:1200,height:675,fps:60,duration:motionTemplateDurations[spec.template_id]})||!same(spec.template_ref,ref)||typeof spec.template_name!=='string'||!spec.template_name.trim()||Object.keys(spec).length!==10)throw Error('Motion 原模板与已保存选择不一致');
  // Both official adapters share this prompt; Motion only changes skill name.
  if(text!==creativeSelectionPrompt(spec,origin.handoffId,trace.result.response.original_request||'').replace('Use the tapnow-creative skill.','Use the tapnow-motion skill.'))throw Error('Motion 原模板交接正文不一致');
 }
 return validateTemplateIdentity({resource_uri:uri,template_id:spec.template_id,object_key:spec.template_ref?.object_key,sha256:spec.template_ref?.sha256,catalog_sha256:spec.catalog_sha256,handoff_id:origin.handoffId,selection_trace_id:trace.id});
}
export async function sha256Bytes(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function verifyTemplateBytes(input,identity){
 identity=validateTemplateIdentity(identity);
 const bytes=new Uint8Array(input).slice();
 if(!bytes.length||bytes.length>240000)throw Error('原模板为空或超过本地产物容量');
 if(await sha256Bytes(bytes)!==identity.sha256)throw Error('文件 SHA256 与所选原模板不一致，未导入');
 let content;try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error('原模板必须为有效 UTF-8，原始字节未修改');}
 if(content.length>60000)throw Error('原模板超过 60000 UTF-16 字符容量，未导入');
 const roundtrip=new TextEncoder().encode(content);
 if(roundtrip.length!==bytes.length||bytes.some((byte,index)=>byte!==roundtrip[index]))throw Error('UTF-8 字节无法无损保留，未导入');
 const result=Object.freeze({identity,content,byte_length:bytes.length,utf16_length:content.length});verified.set(result,bytes);return result;
}
export function isVerifiedTemplateSource(value){return verified.has(value);}
export function readVerifiedTemplateSource(value){
 if(!verified.has(value))throw Error('原模板尚未经过原始字节验证');
 return {...value,bytes:verified.get(value).slice()};
}
/** Verify stored original bytes, not a hash of a later edited string. */
export async function verifyStoredTemplateSource(file){
 if(!file?.template_source_immutable)return file;
 const source=await verifyTemplateBytes(file.template_source_bytes,file.template_source_identity);
 if(file.content_type!=='html'||file.content!==source.content)throw Error('原模板存储正文与原始字节不一致');
 return file;
}
