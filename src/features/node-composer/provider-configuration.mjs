const own=(value,key)=>value!=null&&Object.hasOwn(value,key);

// Aliases are public request identifiers. Never infer a native model or silently
// move an unavailable selected route to a sibling provider.
export function requestModelAlias(request){
  const p=request?.parameters||{};
  return p.providerParameters?.model??p.modelId??p.model??(request?.kind==='image.upscale'&&typeof p.provider==='string'?'image.upscale:'+p.provider:['image.recognize','video.analyze','image.remove-background','image.multiAngle'].includes(request?.kind)?request.kind:undefined);
}

export function selectedProviderId(metadata,request){
  if(metadata?.protocol!=='routed'||!request?.kind)return null;
  const routes=metadata.routes,route=own(routes,request.kind)?routes[request.kind]:null;
  if(typeof route==='string')return route;
  if(!route||typeof route!=='object')return null;
  const alias=requestModelAlias(request);
  return alias!==undefined&&own(route.models,alias)?route.models[alias]:route.default??null;
}

export function resolveProviderConfiguration(metadata,request){
  if(metadata?.protocol!=='routed'||!request?.kind)return metadata;
  const id=selectedProviderId(metadata,request);
  return typeof id==='string'&&own(metadata.providers,id)?metadata.providers[id]:{protocol:'routed',configured:false,missing:[]};
}

const operationLabels={'text.generate':'文本生成','image.generate':'图片生成','video.generate':'视频生成','audio.generate':'音频生成','image.recognize':'焦点识别','image.remove-background':'图片抠图','image.upscale':'图片超分','image.skin':'皮肤增强','image.erase':'图片擦除','image.redraw':'图片重绘','image.outpaint':'图片扩图','image.inpaint':'图片蒙版重绘','image.multiAngle':'图片多角度','image.relight':'图片打光','video.analyze':'分镜解析','video.upscale':'视频超分','video.depth':'视频深度','video.extend':'延长镜头','video.replace':'视频替换','video.erase':'视频移除','video.reshoot':'视频重拍','model.generate':'3D 模型生成','world.generate':'3D 资源生成','panorama.edit':'全景编辑'};
const nativeKinds={
  'openai-native':['text.generate','image.generate','audio.generate','image.recognize','video.analyze'],
  'ark-native':['video.generate'],'fal-native':['image.remove-background','image.upscale','image.multiAngle'],
  'minimax-native':['video.generate'],'tripo-native':['world.generate'],
  'elevenlabs-native':['audio.generate'],'marble-native':['world.generate'],
  'minimax-music-native':['audio.generate'],'fal-video-native':['video.upscale'],
  'fal-video-audio-native':['audio.generate'],'ark-video-extend-reference':['video.extend'],
  'ark-video-reshoot-edit':['video.reshoot'],'fal-panorama-native':['image.generate'],
  'fal-video-mask-native':['video.erase','video.replace'],
  'elevenlabs-sound-native':['audio.generate'],'elevenlabs-music-native':['audio.generate'],'mureka-native':['audio.generate'],'seed-audio-native':['audio.generate'],'openai-masked-edit-native':['image.erase','image.redraw','image.outpaint']
};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const publicAlias=value=>typeof value==='string'&&value.trim()&&value.length<=200&&!/[\x00-\x1f\x7f]/.test(value);

// Some direct adapters publish complete per-operation profiles without a models
// table. imageReferences is deliberately excluded: it omits text-to-image models.
function publicModels(selected,kind){
  const capabilities=selected?.capabilities;
  if(object(capabilities?.models))return capabilities.models;
  const profile=selected?.protocol==='ark-native'&&kind==='video.generate'?'video':
    selected?.protocol==='openai-native'?({'audio.generate':'speech','image.recognize':'analysis','video.analyze':'videoAnalysis'})[kind]:null;
  if(!profile||!object(capabilities?.[profile]))return null;
  return Object.fromEntries(Object.keys(capabilities[profile]).map(alias=>[alias,{kind}]));
}

export function providerConfigurationStatus(metadata,request,{operationOnly=false}={}){
  const routed=metadata?.protocol==='routed',kind=request?.kind,selected=resolveProviderConfiguration(metadata,request);
  const provider=routed&&kind?selectedProviderId(metadata,request):null;
  const alias=requestModelAlias(request),models=publicModels(selected,kind);
  const availableModels=Object.entries(models||{}).filter(([key,entry])=>publicAlias(key)&&entry?.kind===kind).map(([key])=>key);
  const supportedOperations=(Array.isArray(selected?.capabilities?.kinds)?selected.capabilities.kinds:[]).filter(value=>own(operationLabels,value)).map(value=>operationLabels[value]);
  const missing=(Array.isArray(selected?.missing)?selected.missing:[]).filter(value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(value));
  const operation=own(operationLabels,kind)?operationLabels[kind]:'当前操作';
  const mapping=routed?'所选供应商的 modelMap（或 modelMapEnv 引用的环境变量）':'GENERATION_MODEL_MAP';
  const support=supportedOperations.length?' 已配置操作：'+supportedOperations.join('、')+'。':'';
  const aliases=availableModels.length?' 可用公开别名：'+availableModels.join('、')+'。':'';
  const result=(configured,reason,message)=>({configured,reason,message,operation,provider,model:publicAlias(alias)?alias:null,availableModels,modelAliasesKnown:models!==null,supportedOperations,missing});
  if(metadata?.configurationError||selected?.configurationError)return result(false,'configuration_invalid','生成服务配置无效，请检查服务端协议、地址与模型映射。');
  if(operationOnly&&kind&&alias===undefined&&routed){
    // An operation query asks whether any configured route can do this job. It
    // never selects a fallback for an actual submission or an explicit alias.
    const rows=own(metadata.routes,kind)?configurationReadiness({...metadata,routes:{[kind]:metadata.routes[kind]}}):[];
    for(const row of rows.filter(row=>row.configured)){
      const candidate=providerConfigurationStatus(metadata.providers[row.provider],request,{operationOnly:true});
      if(candidate.configured===true)return {...candidate,provider:row.provider};
    }
    if(rows.length)return result(false,'operation_unmapped','尚未为'+operation+'配置可用供应商及模型，请检查 GENERATION_ROUTES 和供应商 '+mapping+'。');
  }
  if(routed&&kind&&(provider===null||!own(metadata.providers,provider)))return result(false,'route_missing','尚未为'+operation+'配置供应商路由，请在 GENERATION_ROUTES 中配置 '+kind+'。');
  if(selected?.configured===false)return result(false,'configuration_missing','所选生成服务尚未配置'+(missing.length?'，缺少 '+missing.join('、'):'')+'；请完成服务端配置后重试。');
  if(selected?.configured!==true)return result(null,'unknown','无法确认生成服务配置，请检查本机服务后重试。');
  if(!kind||selected.protocol==='tasks-v1')return result(true,'ready','生成服务已配置。');
  const native=own(nativeKinds,selected.protocol);
  const kindsKnown=Array.isArray(selected.capabilities?.kinds);
  const strict=routed||native&&(kindsKnown||!['openai-native','ark-native'].includes(selected.protocol));
  // Preserve old direct metadata that carries only configured/protocol. It cannot
  // prove a particular alias absent; current adapters publish operation kinds.
  if(strict&&selected.capabilities?.kinds?.includes(kind)!==true){
    const unsupported=native&&!nativeKinds[selected.protocol].includes(kind);
    return result(false,unsupported?'operation_unsupported':'operation_unmapped',unsupported?
      '当前原生适配器不支持'+operation+'。'+support+' 请连接支持此操作的原生适配器或 tasks-v1 任务网关。':
      '当前服务尚未配置'+operation+'（'+kind+'）。'+support+' 请在服务端 '+mapping+' 中配置此操作。');
  }
  if(operationOnly&&alias===undefined){
    if(models!==null&&!availableModels.length)return result(false,'model_unmapped','当前服务尚未公开'+operation+'的可用模型，请检查服务端 '+mapping+'。');
    return result(true,'ready',operation+'服务已配置。'+aliases);
  }
  if(alias===undefined&&selected.protocol==='fal-video-mask-native'&&availableModels.length===1)return result(true,'ready',operation+'服务已配置。'+aliases);
  if(strict&&!publicAlias(alias))return result(false,'model_required','请为'+operation+'选择已配置的公开模型别名。'+aliases);
  if((routed||native)&&models!==null&&(!own(models,alias)||models[alias]?.kind!==kind))return result(false,'model_unmapped','所选模型尚未映射到'+operation+'。请在服务端 '+mapping+' 中配置公开别名“'+(publicAlias(alias)?alias:'未选择')+'”（kind: '+kind+'）。'+aliases);
  if(routed&&models===null)return result(false,'model_unmapped','所选供应商尚未公开此操作的模型映射，请检查服务端 '+mapping+'。');
  return result(true,'ready','生成服务已配置。'+aliases);
}

export function providerConfigured(metadata,request,options){
  return providerConfigurationStatus(metadata,request,options).configured;
}

export function configurationReadiness(metadata){
  if(metadata?.protocol!=='routed')return [];
  return Object.entries(metadata.routes||{}).flatMap(([kind,route])=>{
    const ids=typeof route==='string'?[route]:[route?.default,...Object.values(route?.models||{})];
    const providers=[...new Set(ids.filter(id=>typeof id==='string'))];
    return (providers.length?providers:[null]).map(id=>{
      const config=id&&own(metadata.providers,id)?metadata.providers[id]:null;
      const kindsReady=config?.capabilities?.kinds?.includes(kind)===true;
      const models=config?.capabilities?.models;
      const defaultReady=(typeof route==='string'||route?.default===id)&&Object.values(models||{}).some(entry=>entry?.kind===kind);
      const aliasReady=Object.entries(route?.models||{}).some(([alias,provider])=>provider===id&&own(models,alias)&&models[alias]?.kind===kind);
      return {operation:operationLabels[kind]||kind,provider:id,configured:config?.configured===true&&(config.protocol==='tasks-v1'||kindsReady&&(defaultReady||aliasReady)),configurationError:!!config?.configurationError,missing:Array.isArray(config?.missing)?config.missing.filter(value=>typeof value==='string'):[]};
    });
  });
}

// This inventory includes absent routes. A configured generic gateway proves
// connectivity only; it does not declare support for every canvas operation.
export function generationOperationReadiness(metadata){
  const routed=metadata?.protocol==='routed';
  return Object.entries(operationLabels).flatMap(([kind,operation])=>{
    const routes=routed?configurationReadiness({...metadata,routes:own(metadata.routes,kind)?{[kind]:metadata.routes[kind]}:{}}):[];
    const candidates=routed?(routes.length?routes:[{provider:null,configured:false}]):[{provider:null,configured:true}];
    return candidates.map(route=>{
      const selected=routed?(route.provider&&own(metadata.providers,route.provider)?metadata.providers[route.provider]:null):metadata;
      const status=providerConfigurationStatus(selected,{kind},{operationOnly:true});
      const missing=(Array.isArray(selected?.missing)?selected.missing:[]).filter(value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(value));
      let state='pending',reason=status.reason;
      if(metadata?.configurationError||selected?.configurationError){state='invalid';reason='configuration_invalid';}
      else if(routed&&!selected){reason='route_missing';}
      else if(!selected){state='unknown';reason='service_unavailable';}
      else if(status.configured===true&&route.configured){
        if(selected.protocol==='tasks-v1'){state='gateway';reason='gateway_capability_unverified';}
        else if(!Array.isArray(selected.capabilities?.kinds)){state='unknown';reason='capabilities_unknown';}
        else{state='ready';reason='ready';}
      }
      else if(status.configured===null){state='unknown';}
      return {kind,operation,provider:publicAlias(route.provider)?route.provider:null,state,reason,configured:state==='ready',missing};
    });
  });
}
