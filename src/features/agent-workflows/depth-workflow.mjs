import {buildDepthRequest,buildRecastRequest,mediaSignature} from './depth-video.mjs';

const failure=(code,message,details={})=>Object.assign(Error(message),{code,...details});
const aborted=signal=>{if(signal?.aborted)throw signal.reason??failure('cancelled','工作流已取消');};
// Host-owned confirmation/inspection receipts are deliberately not trusted tool arguments.
// Provider metadata is untrusted. resolveMedia decodes output before any completed node is created.
export function createDepthVideoWorkflow({getNode,getNodes,getIdentity=getNode,resolveMedia,runInPlace,createConnected,persist,assertConfirmed,assertInspected,assertConversionConfigured=()=>{},assertSession=()=>{}}){
  for(const [name,fn]of Object.entries({getNode,getNodes,resolveMedia,runInPlace,createConnected,persist,assertConfirmed,assertInspected}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  function node(id,type){const value=getNode(id);if(!value||value.type!==type)throw failure('node_unavailable','画布参考节点不存在或类型不符：'+id);return value;}
  function guardFor(nodes,signal){const snapshots=nodes.map(value=>[value.id,mediaSignature(value),getIdentity(value.id)]);return ()=>{aborted(signal);assertSession();for(const [id,signature,identity]of snapshots)if(getIdentity(id)!==identity||mediaSignature(getNode(id))!==signature)throw failure('source_changed','参考素材已变化，未回填生成结果');};}
  async function input(value,signal){return {...await resolveMedia(value,{signal}),id:value.id,type:value.type};}
  async function submit(request,nodes,{signal,apply}){
    const guard=guardFor(nodes,signal);let created;
    const job=await runInPlace(request,{type:'video',guard,apply:async output=>{
      guard();
      if(!created){
        if(output?.type!=='video'||!(output.video||output.url))throw failure('invalid_output','视频结果缺少可读取媒体');
        const video=output.video||output.url;
        // Do not pass provider dimensions or duration into the decoder's temporary node.
        const decoded=await resolveMedia({id:'workflow-output:'+request.nodeId,type:'video',video},{signal});
        guard();
        if(!Number.isFinite(decoded?.duration)||decoded.duration<=0||!Number.isInteger(decoded.width)||decoded.width<=0||!Number.isInteger(decoded.height)||decoded.height<=0)throw failure('invalid_output','实际视频解码后缺少有效像素尺寸或时长');
        created=apply({...output,video,width:decoded.width,height:decoded.height,duration:decoded.duration});if(!Array.isArray(created)||!created.length||created.some(value=>!value?.id))throw failure('apply_failed','画布结果节点创建失败');
      }
      try{await persist();}catch(error){Object.assign(error,{applied:true,nodeIds:created.map(value=>value.id)});throw error;}
      return created;
    }},{signal});
    if(!created||job.status!=='succeeded')throw failure(job.status||'incomplete','任务尚未完成或尚未应用到画布');
    return {taskId:job.id,nodeIds:created.map(value=>value.id),nodes:created};
  }
  return {
    async convert({sourceId,modelId},{signal}={}){
      const source=node(sourceId,'video'),signature=mediaSignature(source),guard=guardFor([source],signal);guard();
      await assertConversionConfigured({kind:'video.depth',...modelId?{parameters:{model:modelId}}:{}},{signal});guard();
      await assertInspected({stage:'source',nodes:[source]});guard();
      const existing=getNodes().find(value=>value.type==='video'&&value.video&&value.provenance?.depthWorkflow?.stage==='depth'&&value.video===value.provenance.depthWorkflow.outputMedia&&value.provenance.depthWorkflow.sourceId===sourceId&&value.provenance.depthWorkflow.sourceSignature===signature);
      if(existing){const reuseGuard=guardFor([source,existing],signal);await input(existing,signal);reuseGuard();return {reused:true,nodeIds:[existing.id],nodes:[existing]};}
      const sourceInput=await input(source,signal);guard();const request=buildDepthRequest({source:sourceInput,modelId});
      await assertConversionConfigured(request,{signal});guard();
      return submit(request,[source],{signal,apply:output=>{
        if(Math.abs(output.duration-sourceInput.duration)>.1||output.width!==sourceInput.width||output.height!==sourceInput.height)throw failure('depth_contract_mismatch','深度结果未保留源视频时长或分辨率，不能作为已完成深度转换');
        return createConnected(sourceId,[{type:'video',title:'深度视频',video:output.video||output.url,...output.poster?{image:output.poster}:{},width:output.width,height:output.height,duration:output.duration,videoMetadata:{width:output.width,height:output.height,duration:output.duration},provenance:{kind:'depth-video',depthWorkflow:{stage:'depth',sourceId,sourceSignature:signature,outputMedia:output.video||output.url,protocol:'local-depth-v1'}}}]);
      }});
    },
    async recast({depthNodeId,character,setting,model,videoMode,duration,aspect,resolution,generateAudio,prompt},{signal,confirmation}={}){
      const depth=node(depthNodeId,'video'),references=[depth];
      for(const role of [character,setting])if(role?.nodeId&&!references.some(value=>value.id===role.nodeId))references.push(node(role.nodeId,'image'));
      const guard=guardFor(references,signal);guard();
      await assertInspected({stage:'recast',nodes:references,depthNodeId});guard();
      const inputs=await Promise.all(references.map(value=>input(value,signal)));guard();
      const request=buildRecastRequest({depth:inputs[0],assets:inputs.slice(1),character,setting,model,videoMode,duration,aspect,resolution,generateAudio,prompt});
      await assertConfirmed({confirmation,depthNodeId,character,setting,model,videoMode,duration,aspect,resolution,generateAudio,prompt,request,sourceDuration:request.workflow.sourceDuration,outputDuration:request.workflow.outputDuration,durationChanged:request.workflow.durationChanged});guard();
      return submit(request,references,{signal,apply:output=>{
        if(Math.abs(output.duration-request.workflow.outputDuration)>.1)throw failure('recast_duration_mismatch','实际重演视频时长与已确认请求不符，不能回填截短或延长的结果');
        return createConnected(depthNodeId,[
        {type:'video',title:'深度视频重演',video:output.video||output.url,...output.poster?{image:output.poster}:{},width:output.width,height:output.height,duration:output.duration,videoMetadata:{width:output.width,height:output.height,duration:output.duration},provenance:{kind:'depth-recast',depthWorkflow:{...request.workflow,prompt:request.prompt}}},
        {type:'text',title:'重演参考分工与提示词',textMode:'pure',content:JSON.stringify({roleMap:request.workflow.roleMap,prompt:request.prompt,parameters:request.parameters,sourceDuration:request.workflow.sourceDuration,actualDuration:output.duration,actualResolution:{width:output.width,height:output.height}},null,2),provenance:{kind:'depth-reference-map',depthNodeId}}
      ]);}});
    }
  };
}
