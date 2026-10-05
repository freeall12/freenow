export const directions=['片头延长','片尾延长'];
export const modes=['自然延续','动作接续','延续运镜','推进场景'];
export const clampDuration=value=>Math.max(4,Math.min(30,Math.round(value!==null&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):8)));
export const mediaSource=n=>n?.video||globalThis.EDITOR_DATA?.nodes[n?.id]?.video;
// The official toolbar selects this public catalog alias, independently of the
// source generation model. A server mapping supplies the actual provider ID.
export function extensionSettings(node){
  const params=node?.generation??node?.params??{},resolution=params.resolution??(/^(480p|720p|1080p|4k)$/i.test(params.quality??'')?params.quality:'720p');
  const audio=params.generateAudio??params.generate_audio??params.audio;
  return {direction:'片尾延长',duration:8,mode:'自然延续',modelId:'seedance-2.5',capabilityMode:'prompt_simulation',resolution:typeof resolution==='string'?resolution.toLowerCase():resolution,generateAudio:typeof audio==='boolean'?audio:true};
}
export function extensionSourceSettings(node){const {modelId,capabilityMode,resolution,generateAudio}=extensionSettings(node);return {modelId,capabilityMode,resolution,generateAudio};}
// Result ownership outlives the panel after dispatch, while request preparation
// also requires an active panel. Keep source identity independent of that UI.
export function extensionSourceGuard(app,node,{references=[]}={}){
  const projectId=app.projectIdentity().id,source=mediaSource(node),clip=JSON.stringify(node.clip||null),settings=JSON.stringify(extensionSourceSettings(node)),type=node.type;
  const refs=references.map(({node,source,clip})=>({node,source,clip,type:node?.type}));
  return ()=>{const nodes=app.getState().nodes;
    if(app.projectIdentity().id!==projectId||nodes.find(n=>n.id===node.id)!==node||node.type!==type||mediaSource(node)!==source||JSON.stringify(node.clip||null)!==clip||JSON.stringify(extensionSourceSettings(node))!==settings)throw Error('来源视频、生成设置或项目已变化，请重新生成');
    for(const ref of refs){const n=ref.node,url=n?.type==='video'?mediaSource(n):n?.fullImage||n?.image;if(!n||nodes.find(v=>v.id===n.id)!==n||n.type!==ref.type||url!==ref.source||JSON.stringify(n.clip||null)!==ref.clip)throw Error('参考素材已变化，请重新生成');}
  };
}
export function extensionLifetimeGuard(sourceGuard,{signal,isAlive=()=>true}={}){return ()=>{if(signal?.aborted||!isAlive())throw new DOMException('已取消','AbortError');sourceGuard();};}
export async function waitForExtensionLookup(operation,signal){
  const check=()=>{if(signal?.aborted)throw new DOMException('已取消','AbortError');};check();
  let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(new DOMException('已取消','AbortError'));signal?.addEventListener('abort',abort,{once:true});});
  try{const result=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),stopped]);check();return result;}finally{signal?.removeEventListener('abort',abort);}
}
export function fitCreation(node,width,height){
  const availableHeight=height-88-176,reserved=236+8;
  const scale=Math.max(.01,Math.min((width-192)/node.width,Math.max(1,availableHeight-reserved)/node.height)*.75);
  return {scale,x:width/2-(node.x+node.width/2)*scale,y:88+availableHeight/2-reserved/2-(node.y+node.height/2)*scale};
}
export function extendRequest(node,settings,references,subjects,prompt,source){
  if(!source)throw Error('来源视频尚不可用，请先上传或生成视频');
  if(references.length+subjects.length>4)throw Error('最多添加 4 个参考素材或主体');
  if(!directions.includes(settings.direction)||!modes.includes(settings.mode))throw Error('延长参数无效');
  const direction=settings.direction==='片尾延长'?'forward':'backward';
  return {kind:'video.extend',label:'延长视频',nodeId:node.id,prompt,inputs:[{type:'video',url:source,nodeId:node.id,role:'source_video'},...references.map(r=>({type:r.type,nodeId:r.id,url:r.url,role:'reference',...(r.clip?{clip:r.clip}:{})})),...subjects.flatMap(s=>s.assets.map(a=>({type:a.type,url:a.url,text:a.text,subjectId:s.id,role:'subject_reference'})))],parameters:{...extensionSettings(node),...settings,duration:clampDuration(settings.duration),ratio:'自适应',extendDirection:direction,sourceClip:node.clip||null,subjects:subjects.map(s=>({id:s.id,name:s.name,description:s.description})),referenceIds:references.map(r=>r.id),candidateCount:1}};
}
