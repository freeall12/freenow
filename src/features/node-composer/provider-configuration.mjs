const own=(value,key)=>value!=null&&Object.hasOwn(value,key);

// Aliases are public request identifiers. Never infer a native model or silently
// move an unavailable selected route to a sibling provider.
export function requestModelAlias(request){
  const p=request?.parameters||{};
  return p.providerParameters?.model??p.modelId??p.model??(request?.kind==='image.upscale'&&typeof p.provider==='string'?'image.upscale:'+p.provider:['image.recognize','video.analyze','image.remove-background'].includes(request?.kind)?request.kind:undefined);
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

export function providerConfigured(metadata,request){
  const selected=resolveProviderConfiguration(metadata,request);
  if((metadata?.protocol==='routed'||selected?.protocol==='fal-native')&&request?.kind&&selected?.configured===true&&selected.protocol!=='tasks-v1'){
    if(selected.capabilities?.kinds?.includes(request.kind)!==true)return false;
    const models=selected.capabilities?.models;
    const alias=requestModelAlias(request);
    return alias!==undefined&&own(models,alias)&&models[alias]?.kind===request.kind;
  }
  return typeof selected?.configured==='boolean'?selected.configured:null;
}

const operationLabels={'text.generate':'文本生成','image.generate':'图片生成','video.generate':'视频生成','audio.generate':'音频生成','image.recognize':'焦点识别','image.remove-background':'图片抠图','image.upscale':'图片超分','image.skin':'皮肤增强','video.analyze':'分镜解析','model.generate':'3D 模型生成','world.generate':'3D 资源生成','panorama.edit':'全景编辑'};
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
