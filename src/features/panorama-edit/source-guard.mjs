const sceneSignature=(data,panoramaRecords=false)=>JSON.stringify(panoramaRecords?data:Object.fromEntries(Object.entries(data).filter(([key])=>!key.startsWith('panorama'))));
const editorSignature=e=>JSON.stringify([e.id,e.setupId,e.history.revision,e.history.state.image,e.base,e.history.state.regions,e.history.state.anchor,e.selectedPatchId??null,e.prompt.textContent.trim(),e.camera.position.toArray(),e.camera.quaternion.toArray(),e.camera.fov,e.camera.aspect]);
export function createPanoramaSourceGuard(studio,editor,{app=globalThis.window?.CanvasApp,panoramaRecords=false}={}){
 const node=app.getState().nodes.find(n=>n.id===studio.nodeId),projectId=app.projectIdentity().id,data=studio.data,scene=sceneSignature(data,panoramaRecords),intent=editorSignature(editor),storedScene=node?.studio&&sceneSignature(node.studio,panoramaRecords);
 const guard=()=>{
  if(editor.abort.signal.aborted||studio.closed||studio.closing||studio.panoramaEditor!==editor)throw Error('全景编辑会话已关闭或切换，旧结果未回填');
  if(app.projectIdentity().id!==projectId||!app.getState().nodes.includes(node)||node?.type!=='studio'||studio.data!==data||sceneSignature(data,panoramaRecords)!==scene||storedScene!==undefined&&sceneSignature(node.studio,panoramaRecords)!==storedScene||data.activeSetup!==editor.setupId||editorSignature(editor)!==intent)throw Error('片场、状态、全景来源、描述或镜头已变化，请重新提交');
 };
 guard.projectId=projectId;guard.node=node;guard();return guard;
}
export function createPanoramaProviderGuard(api){
 const revision=api.providerRevision?.();
 if(!Number.isSafeInteger(revision))throw Object.assign(Error('无法确认全景编辑供应商版本，请刷新页面后重试'),{code:'configuration_required',providerDispatched:false});
 return ()=>{if(api.providerRevision()!==revision)throw Object.assign(Error('全景编辑供应商已变化，请重新确认提交'),{code:'configuration_required',providerDispatched:false});};
}
export function createPanoramaConfigurationGuard(api,metadata,{providerGuard=createPanoramaProviderGuard(api)}={}){
 const expected=JSON.stringify(metadata);
 return ()=>{providerGuard();if(typeof api.configurationSnapshot!=='function'||JSON.stringify(api.configurationSnapshot())!==expected)throw Object.assign(Error('全景编辑配置已变化，请重新确认提交'),{code:'configuration_required',providerDispatched:false});};
}
