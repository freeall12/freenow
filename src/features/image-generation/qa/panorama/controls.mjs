const fixture=window.PanoramaNativeFixture;
for(let attempt=0;attempt<200;attempt++){
  if(window.NodeEditor&&window.GenerationAPI&&window.CanvasApp?.getState().nodes.some(node=>node.id==='qa-panorama-target'))break;
  await new Promise(resolve=>setTimeout(resolve,50));
}
function report(){
  const state=window.CanvasApp?.getState(),target=state?.nodes.find(node=>node.id==='qa-panorama-target');
  const requests=fixture.requests.map(request=>({kind:request.kind,prompt:request.prompt,inputs:request.inputs?.map(input=>({...input,url:input.url?.startsWith('data:')?'[inline '+input.url.slice(5,input.url.indexOf(';'))+' bytes]':input.url})),parameters:request.parameters}));
  parent.postMessage({type:'panorama-native-qa',report:{ready:!!window.NodeEditor,mode:fixture.mode,projectId:fixture.projectId,namespace:fixture.namespace,requests,sourcePreserved:state?.nodes.find(node=>node.id==='qa-panorama-source')?.image===fixture.seed.nodes[0].image,targetImage:target?.image?'[result exists]':null,config:target&&window.NodeEditor?.getConfig(target),jobs:window.GenerationAPI?.getJobs().map(job=>({id:job.id,status:job.status,applied:job.applied,applicationError:job.applicationError,error:job.error})),panoramaButtons:[...document.querySelectorAll('.image-panorama-view:not([hidden])')].length,blockedAPIs:fixture.blockedAPIs,externalAttempts:fixture.externalAttempts}},location.origin);
}
fixture.report=report;
window.GenerationAPI?.subscribe(()=>setTimeout(report,50));document.addEventListener('canvas:render',report);report();
window.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==parent)return;const action=event.data?.action;if(action==='finish')await fixture.finish();if(action==='report')report();if(action==='camera')window.NodeEditor.setConfig('qa-panorama-target',{cameraEnabled:true});if(action==='extra-source'){const source=window.CanvasApp.getState().nodes.find(node=>node.id==='qa-panorama-source');window.CanvasApp.insertDerived(source.id,'/assets/tap-logo.webp',1,1);window.CanvasApp.connect(window.CanvasApp.getState().nodes.at(-1).id,'qa-panorama-target');}report();});
