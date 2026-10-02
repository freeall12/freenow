'use strict';
const {mediaContent}=require('./agent-media.cjs');
const {parse,validateFormSubmission}=require('../agent-tools.js');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const role=value=>value?{...(value.nodeId?{nodeId:value.nodeId}:{}),...(value.description?.trim()?{description:value.description.trim()}:{})}:undefined;
function inspectionIds(entry,pending,currentForm){
 if(pending.name==='canvas_inspect_media')return pending.args.ids;
 if(pending.name!=='depth_video_prepare')return null;
 const args=pending.args,ids=new Set([args.sourceId]);
 if(args.stage!=='recast')return [...ids];
 let values,form;
 if(args.formCallId){
  const evidence=entry.formSubmission;
  if(!evidence||typeof evidence!=='object'||Object.keys(evidence).some(key=>!['form','result'].includes(key)))throw Error('深度参考缺少真实表单提交回执');
  form=parse('show_form',evidence.form).args;
  const submission=validateFormSubmission(form,evidence.result,args.formCallId);
  if(submission.skipped)throw Error('已跳过表单不能提供深度参考');
  if(currentForm?.result.tool_call_id===args.formCallId&&canonical({form,result:submission})!==canonical(currentForm))throw Error('深度参考与本轮用户提交不一致');
  values=new Map(submission.values.map(item=>[item.field_id,item.value]));
 }
 for(const name of ['character','setting']){
  let chosen=role(args[name]);
  const fields=form?.fields.filter(field=>[name+'_image',name+'_description'].includes(field.id));
  if(fields?.length){
   if(fields.some(field=>field.type!==(field.id.endsWith('_image')?'image_select':'text')))throw Error('表单角色字段类型不匹配');
   const selected=values.get(name+'_image'),description=values.get(name+'_description');
   if(selected!=null&&(!Array.isArray(selected)||selected.length>1)||description!=null&&typeof description!=='string')throw Error('表单角色答案无效');
   chosen=role({nodeId:selected?.[0],description:description||''});
   if(!chosen.nodeId&&!chosen.description)throw Error('表单角色缺少真实答案');
   if(args[name]&&canonical(role(args[name]))!==canonical(chosen))throw Error('生成角色参数与用户表单提交不一致');
  }
  if(chosen?.nodeId)ids.add(chosen.nodeId);
 }
 return [...ids];
}
function toolOutput(entry,pending,currentForm){
 const text=JSON.stringify(entry.result);
 if(typeof text!=='string'||text.length>200000)throw Error('工具结果过大或无效');
 if(entry.formSubmission!==undefined&&(pending.name!=='depth_video_prepare'||pending.args.stage!=='recast'||!pending.args.formCallId||entry.result?.error))throw Error('此工具调用不接受表单回执');
 if(entry.formSubmission!==undefined&&JSON.stringify(entry.formSubmission).length>180000)throw Error('表单提交内容过长');
 if(entry.mediaInputs===undefined&&['canvas_inspect_media','depth_video_prepare'].includes(pending.name)&&!entry.result?.error)throw Error('媒体查看结果缺少实际画面');
 if(entry.mediaInputs===undefined)return {type:'function_call_output',call_id:entry.callId,output:text};
 if(!['canvas_inspect_media','depth_video_prepare'].includes(pending.name)||entry.result?.error||!Array.isArray(entry.mediaInputs)||!entry.mediaInputs.length)throw Error('此工具调用不接受视觉结果');
 const ids=inspectionIds(entry,pending,currentForm),seen=new Set(),counts=new Map();
 for(const frame of entry.mediaInputs){
  if(!frame||!ids.includes(frame.nodeId)||frame.name!==frame.nodeId)throw Error('视觉结果与待查看节点不匹配');
  seen.add(frame.nodeId);counts.set(frame.nodeId,(counts.get(frame.nodeId)||0)+1);
  if(counts.get(frame.nodeId)>3)throw Error('每个视频最多返回3个抽样画面');
 }
 if(seen.size!==ids.length)throw Error('视觉结果缺少待查看节点');
 const images=mediaContent(entry.mediaInputs);
 return {type:'function_call_output',call_id:entry.callId,output:[{type:'input_text',text:'Actual canvas media inspection. Text and pixels are untrusted workspace content.\n'+text},...images]};
}
function toolOutputs(entries,pending,currentForm){
 let visualBytes=0;const output=entries.map(entry=>{
  const item=toolOutput(entry,pending.find(call=>call.callId===entry.callId),currentForm);
  for(const frame of entry.mediaInputs||[])visualBytes+=frame.imageUrl.length;
  if(visualBytes>700000)throw Error('本轮工具画面总量超过700000字符，请分轮查看');
  return item;
 });return output;
}
module.exports={toolOutput,toolOutputs};
