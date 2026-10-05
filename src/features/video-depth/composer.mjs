import {assertDepthConfiguration,depthDisclosure} from './native-profile.mjs';
import {buildDepthRequest,prepareDepthTaskRequest} from '../agent-workflows/depth-video.mjs';
import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
import {prepareDepthMedia} from './media.mjs';

export const depthModel={id:'depth-anything-video',name:'Depth Anything Video',icon:'assets/branding/freenow-mark.svg',description:'视频转逐帧深度图视频（时序一致），最高1080p',isNew:true};
export const depthCountHint='每个结果独立执行一次完整视频深度转换。';
export const isDepthModel=value=>['depth-anything-video','DEPTH_ANYTHING_VIDEO','Depth Anything Video'].includes(value?.model||value?.modelId||value);
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
const referenceKeys=['refs','referenceBindings','referenceOrder'];
const nodeId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value);

// The official optional-prompt effect clears the old prompt when switching to
// depth. Ordinary generation settings must not become hidden upload intent.
export function depthComposerSettings(settings={}){
 return {prompt:'',...Object.fromEntries(referenceKeys.filter(key=>Object.hasOwn(settings,key)).map(key=>[key,structuredClone(settings[key])])),model:depthModel.name,modelId:depthModel.id,mode:'视频编辑',videoMode:'VIDEO_EDIT',variant:'video-edit',count:[1,2].includes(settings.count??settings.times)?settings.count??settings.times:1,times:[1,2].includes(settings.count??settings.times)?settings.count??settings.times:1,resultMode:settings.resultMode||'variants'};
}
export function depthReferenceError(inputs=[]){
 if(inputs.length!==1||inputs[0]?.type!=='video')return '深度转换必须且只能连接一个来源视频';
 if(inputs[0].empty||!inputs[0].url)return '来源视频节点没有可读取的视频';
 if(!nodeId(inputs[0].id||inputs[0].nodeId))return '深度转换需要绑定实际来源视频节点';
 return '';
}
export function depthComposerRequest({nodeId,settings,inputs=[],sourceNodes=[]}={}){
 if(!isDepthModel(settings))throw fail('请选择 Depth Anything Video');
 if(Object.keys(settings).some(key=>!['prompt',...referenceKeys,'promptReferenceBindings','model','modelId','mode','videoMode','variant','count','times','resultMode'].includes(key))||settings.modelId!==undefined&&settings.modelId!==depthModel.id||settings.videoMode!==undefined&&settings.videoMode!=='VIDEO_EDIT'||settings.variant!==undefined&&settings.variant!=='video-edit')throw fail('深度模型包含不支持的隐藏设置，请重新选择模型');
 if(settings.prompt?.trim())throw fail('深度转换不使用提示词，请重新选择模型清空提示词');
 if(![1,2].includes(settings.count)||settings.times!==undefined&&settings.times!==settings.count)throw fail('深度转换数量须为 1 或 2，且数量声明必须一致');
 const error=depthReferenceError(inputs);if(error)throw fail(error);
 const input=inputs[0],id=input.id||input.nodeId,source=sourceNodes.find(node=>node.id===id);
 if(!source||source.type!=='video')throw fail('来源视频节点已不存在');
 if(source.video!==input.url)throw fail('来源视频已变化，请重新选择参考');
 for(const field of ['clip','trim','sourceClip'])if(source[field]!=null||input[field]!=null)throw fail('深度转换需要完整且已物化的视频，请先导出选段');
 if(typeof nodeId!=='string'||!nodeId.trim()||nodeId!==nodeId.trim()||nodeId.length>200||/[\x00-\x1f\x7f]/.test(nodeId))throw fail('目标视频节点无效');
 return {kind:'video.depth',nodeId,label:'视频深度转换',prompt:'',inputs:[{id,type:'video',url:input.url,...input.title?{title:input.title}:{}}],parameters:{composer:'video-depth-node-v1',model:depthModel.id,count:settings.count,times:settings.count,resultMode:settings.resultMode||'variants'}};
}

// Called inside TaskService.prepareInputs, after configuration is captured and
// with its live source guard. No placeholder or media probe precedes preflight.
export async function prepareDepthComposerRequest(request,{nativeConfiguration,signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl})}={}){
 if(request.kind!=='video.depth'||request.parameters?.composer!=='video-depth-node-v1')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason||fail('深度准备已取消');validateSources();};
 check();assertDepthConfiguration(nativeConfiguration,{kind:'video.depth',parameters:{model:depthModel.id,count:request.parameters?.count,times:request.parameters?.times}});
 const p=request.parameters||{},input=request.inputs?.[0];
 if(Object.keys(request).some(key=>!['kind','nodeId','label','prompt','inputs','parameters'].includes(key))||request.prompt!==''||!isDepthModel(p)||p.model!==depthModel.id||Object.keys(p).some(key=>!['composer','model','count','times','resultMode'].includes(key))||![1,2].includes(p.count)||p.times!==p.count||!['variants','spread','pile'].includes(p.resultMode)||!nodeId(request.nodeId))throw fail('深度节点请求包含不支持的设置');
 const error=depthReferenceError(request.inputs);if(error)throw fail(error);
 if(Object.keys(input).some(key=>!['id','type','url','title'].includes(key)))throw fail('深度来源包含未物化选段或不支持的参考声明');
 let url;try{url=new URL(input.url,baseUrl);}catch{throw fail('来源视频地址无效');}
 if(url.username||url.password||['http:','https:'].includes(url.protocol)&&isOriginalServiceHost(url.hostname))throw fail('原站或含凭据的视频需要先导入本机');
 if(!['asset:','data:','blob:','http:','https:'].includes(url.protocol))throw fail('不支持此来源视频地址');
 const actual=await resolveMedia({id:input.id,type:'video',video:input.url},{signal});check();
 if(actual.id!==input.id||actual.type!=='video')throw fail('实际来源视频身份与提交参考不一致');
 const prepared=buildDepthRequest({source:{...actual,...input.title?{title:input.title}:{}},modelId:depthModel.id});
 prepared.nodeId=request.nodeId;prepared.prompt='';prepared.parameters={...prepared.parameters,...p};delete prepared.parameters.composer;
 prepareDepthTaskRequest(prepared);assertDepthConfiguration(nativeConfiguration,prepared);check();return prepared;
}

export function depthComposerDisclosure(){return depthDisclosure+' '+depthCountHint;}

export async function prepareDepthNodeMedia(request,options={}){
 if(request.parameters?.composer!=='video-depth-node-v1')return prepareDepthMedia(request,options);
 const check=()=>{if(options.signal?.aborted)throw options.signal.reason||fail('深度准备已取消');options.validateSources?.();};
 const resolver=options.resolveMedia||createWorkflowMediaResolver(options);let actual,originalUrl;
 const resolveMedia=async(node,context)=>{
  check();if(actual&&node.id===actual.id&&[originalUrl,actual.url].includes(node.video))return structuredClone(actual);
  originalUrl=node.video;actual=await resolver(node,context);check();return structuredClone(actual);
 };
 const prepared=await prepareDepthComposerRequest(request,{...options,resolveMedia});check();
 return prepareDepthMedia(prepared,{...options,resolveMedia});
}

export function renderDepthSpecifications(pop){
 pop.classList.add('video-spec-menu');pop.setAttribute('aria-label','视频生成规格');
 for(const [label,value] of [['生成方式','视频编辑'],['比例','自动'],['清晰度','自动'],['生成时长','自动']]){
  const section=document.createElement('section');section.className='video-parameter-section';
  const heading=document.createElement('div');heading.className='video-parameter-label';heading.textContent=label;
  const display=document.createElement('div');display.className=label==='生成方式'?'video-parameter-segments':'video-parameter-auto';
  if(label==='生成方式'){const choice=document.createElement('button');choice.type='button';choice.textContent=value;choice.setAttribute('aria-pressed','true');choice.style.background='rgba(255,255,255,.1)';display.append(choice);}else display.textContent=value;
  section.append(heading,display);pop.append(section);
 }
}
