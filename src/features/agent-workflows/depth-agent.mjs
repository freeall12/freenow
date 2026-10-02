import {createDepthVideoWorkflow} from './depth-workflow.mjs';
import {createWorkflowMediaResolver} from './media-resolver.mjs';
import {buildRecastForm,mediaSignature,depthProtocol} from './depth-video.mjs';
import {inspectCanvasMedia,inspectionMedia} from '../agent-vision/inspect.mjs';
import {videoModels} from '../agent-generation/video-catalog.mjs';
import {supports} from '../video-generation/settings.mjs';
import {prepareWorkflowInputs} from './media-transport.mjs';

const formEvidence=new WeakMap();
export function withDepthFormEvidence(entry){const submission=formEvidence.get(entry.result);return submission?{...entry,formSubmission:submission}:entry;}
const fail=message=>{throw Error(message);};
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const checkedRole=value=>value?{...(value.nodeId?{nodeId:value.nodeId}:{}),...(value.description?.trim()?{description:value.description.trim()}:{})}:undefined;

function submittedForm(args,{getMessages,validateFormSubmission}){
  const messages=getMessages(),trace=messages.find(message=>message.role==='tool'&&message.name==='show_form'&&message.callId===args.formCallId&&message.status==='done');
  const user=messages.findLast(message=>message.role==='user'&&message.formSubmission?.tool_call_id===args.formCallId);
  if(!trace||!user)fail('该表单尚无当前对话的真实用户提交，请等待填写后继续');
  const submission=validateFormSubmission(trace.args,user.formSubmission,args.formCallId);
  if(submission.skipped)fail('用户跳过了该表单，不能生成依赖其确认的视频');
  return {form:trace.args,result:submission};
}
export function rolesFromForm(args,host){
  if(!args.formCallId)return {character:checkedRole(args.character),setting:checkedRole(args.setting)};
  const {form,result:submission}=submittedForm(args,host);
  const values=new Map(submission.values.map(item=>[item.field_id,item.value])),roles={};
  for(const role of ['character','setting']){
    const fields=form.fields.filter(field=>[role+'_image',role+'_description'].includes(field.id));
    if(!fields.length){roles[role]=checkedRole(args[role]);continue;}
    if(fields.some(field=>field.type!==(field.id.endsWith('_image')?'image_select':'text')))fail('表单角色字段类型不匹配');
    const selected=values.get(role+'_image'),description=values.get(role+'_description');
    if(selected!=null&&(!Array.isArray(selected)||selected.length>1)||description!=null&&typeof description!=='string')fail('表单角色答案无效');
    const chosen=checkedRole({nodeId:selected?.[0],description:description||''});
    if(!chosen?.nodeId&&!chosen?.description)fail('人物和环境都需要实际图片或文字，不能使用未提交的默认值');
    if(args[role]&&canonical(checkedRole(args[role]))!==canonical(chosen))fail('生成角色参数与用户最新表单提交不一致');
    roles[role]=chosen;
  }
  return roles;
}

// One host belongs to one conversation; inspection evidence is reset for every
// new model session and never accepted from child workers or persisted prose.
export function createDepthAgentHost({getNodes,getMessages,validateFormSubmission,localAssets,baseUrl,getIdentity=id=>getNodes().find(node=>node.id===id),runInPlace,createConnected,persist,resolveClip,onBeginTurn,inspect=inspectCanvasMedia,resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl,resolveClip,timeoutMs:resolveClip?120000:20000})}){
  const delivered=new Map();let pending=new WeakMap(),turn;
  const current=id=>getNodes().find(node=>node.id===id);
  const signature=id=>{const node=current(id);if(!node)fail('参考节点已不存在：'+id);return mediaSignature(node);};
  function checkTurn(token){if(turn!==token)fail('对话执行轮次已改变，请重新准备深度流程');}
  function assertInspected({nodes}){for(const node of nodes)if(delivered.get(node.id)?.signature!==signature(node.id)||delivered.get(node.id)?.identity!==getIdentity(node.id))fail('请先用 depth_video_prepare 或 canvas_inspect_media 查看当前素材，再继续生成：'+node.id);}
  async function inspectNodes(ids,options={}){
    const token=turn,before=new Map(ids.map(id=>[id,{signature:signature(id),identity:getIdentity(id)}]));
    const {resolvedMedia=new Map(),...inspectionOptions}=options;
    for(const id of ids){const node=current(id);if(node?.type==='video'&&(node.clip!=null||node.trim!=null)&&!resolvedMedia.has(id))resolvedMedia.set(id,await resolveMedia(node,{signal:options.signal}));}
    checkTurn(token);
    // Sample the actual exported clip used by generation, never the full source
    // with a shorter duration label. Original identities/signatures stay guarded.
    const inspectionNodes=()=>getNodes().map(node=>resolvedMedia.has(node.id)?{...node,video:resolvedMedia.get(node.id).url,clip:undefined,trim:undefined}:node);
    const result=await inspect(ids,{...inspectionOptions,getNodes:inspectionNodes,resolveUrl:url=>localAssets?.url(url)||url});checkTurn(token);
    for(const [id,value]of before)if(signature(id)!==value.signature||getIdentity(id)!==value.identity)fail('查看期间素材已变化，请重新查看');
    if(inspectionMedia(result).length)pending.set(result,{token,before});
    return result;
  }
  function acceptInspections(entries,{limitReached=false}={}){
    if(limitReached)return;
    for(const entry of entries){const evidence=pending.get(entry.result);if(!evidence||evidence.token!==turn)continue;
      const pixels=inspectionMedia(entry.result);for(const [id,value]of evidence.before)if(pixels.some(frame=>frame.nodeId===id)&&current(id)&&signature(id)===value.signature&&getIdentity(id)===value.identity)delivered.set(id,value);
      pending.delete(entry.result);
    }
  }
  function roles(args){return rolesFromForm(args,{getMessages,validateFormSubmission});}
  function source(id){const node=current(id);if(node?.type!=='video')fail('请选择当前画布中的真实视频');return node;}
  async function prepare(args,options={}){
    const token=turn,node=source(args.sourceId),values=args.stage==='recast'?roles(args):{},ids=[node.id];
    for(const role of [values.character,values.setting])if(role?.nodeId&&!ids.includes(role.nodeId))ids.push(role.nodeId);
    const before=signature(node.id),identity=getIdentity(node.id),metadata=await resolveMedia(node,{signal:options.signal});checkTurn(token);if(signature(node.id)!==before||getIdentity(node.id)!==identity)fail('读取期间来源视频已变化');
    const result=await inspectNodes(ids,{...options,resolvedMedia:new Map([[node.id,metadata]])});
    if(args.stage==='recast'&&args.formCallId){
      const submission=submittedForm(args,{getMessages,validateFormSubmission});
      if(canonical(roles(args))!==canonical(values))fail('查看期间表单答案已改变，请重新准备参考');
      formEvidence.set(result,structuredClone(submission));
    }
    return Object.assign(result,{workflow:'depth-video-studio',stage:args.stage,source:{id:node.id,width:metadata.width,height:metadata.height,duration:metadata.duration},
      protocol:depthProtocol,
      ...(args.stage==='recast'?{roles:values,form:buildRecastForm(getNodes(),values),models:videoModels.map(model=>({id:model.id,name:model.name,variants:model.variants.filter(variant=>['REFERENCE_TO_VIDEO','REFERENCE_VIDEO_TO_VIDEO'].includes(variant.modelType)&&supports(variant,{video:1,image:ids.length-1,audio:0})).map(variant=>({mode:variant.modelType,options:variant.options,referenceImageRange:variant.referenceImageRange,referenceVideoRange:variant.referenceVideoRange,referenceAudioRange:variant.referenceAudioRange,referenceVideoDurationRange:variant.referenceVideoDurationRange}))})).filter(model=>model.variants.length)}:{}),
      next:args.stage==='convert'?'在下一模型响应中调用 depth_video_convert；配置缺失不是深度转换成功。':'缺少人物或环境时原样调用 show_form，等待实际提交。选择后重新准备素材，再调用 depth_video_recast；不要默默缩短视频。'});
  }
  async function execute(name,args,{signal,authorize,onSubmitted}={}){
    if(typeof authorize!=='function')fail('缺少本次工具执行的宿主确认');
    const token=turn;await authorize(name,args);checkTurn(token);
    const values=name==='depth_video_recast'?roles(args):{},input={...args,...values};
    const workflow=createDepthVideoWorkflow({getNode:current,getNodes,getIdentity,resolveMedia,
      runInPlace:async(request,handlers,options)=>{
        handlers.guard();
        const prepared=await prepareWorkflowInputs(request,{signal:options.signal,baseUrl});
        checkTurn(token);handlers.guard();await authorize(name,args);
        return runInPlace(prepared,handlers,{...options,onSubmitted});
      },createConnected,persist,
      assertInspected:details=>{checkTurn(token);assertInspected(details);},
      assertConfirmed:async()=>{checkTurn(token);await authorize(name,args);if(name==='depth_video_recast'&&canonical(roles(args))!==canonical(values))fail('表单已被修改，请按最新答案重新提交');}});
    const result=await (name==='depth_video_convert'?workflow.convert(input,{signal}):name==='depth_video_recast'?workflow.recast(input,{signal}):fail('不支持的深度操作'));
    return {...result,nodes:undefined,inspectNodeIds:(result.nodes||[]).filter(node=>node.type==='video').map(node=>node.id),stage:name==='depth_video_convert'?'depth':'recast',applied:true,next:'查看 inspectNodeIds 的实际抽样帧后再评价深度或重演效果。回填成功不代表画面质量已验收。'};
  }
  return {beginTurn(id){turn=id;delivered.clear();pending=new WeakMap();onBeginTurn?.();},prepare,execute,inspect:inspectNodes,acceptInspections};
}
