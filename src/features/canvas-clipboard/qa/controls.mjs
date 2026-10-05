const fixture=window.CanvasDuplicateFixture,app=()=>window.CanvasApp;
let baseline=null,baselineSaves=0,ready=false;
const graph=()=>JSON.stringify({nodes:app().getState().nodes,edges:app().getState().edges});
function report(){
  if(!app())return;
  const state=app().getState(),source=state.nodes.find(node=>node.id==='qa-duplicate-source'),originalIds=new Set(fixture.seed.nodes.map(node=>node.id)),copies=state.nodes.filter(node=>!originalIds.has(node.id));
  const edges=state.edges.filter(edge=>!fixture.seed.edges.some(original=>original.id===edge.id));
  const summary=node=>({id:node.id,type:node.type,parentId:node.parentId,extent:node.extent,x:node.x,y:node.y,width:node.width,height:node.height,loading:node.loading,taskInfo:node.taskInfo,currentSourceFileId:node.currentSourceFileId,historyCount:node.imageHistory?.length||0,versionsCount:node.versions?.length||0,historyVariantCount:node.historyVariantCount,pendingOperation:node.pendingOperation,generationRun:node.generationRun,generationRecovery:node.generationRecovery,workflowRecoveryResult:node.workflowRecoveryResult});
  const sourceBaseline=baseline&&JSON.parse(baseline).nodes.find(node=>node.id===source?.id);
  parent.postMessage({type:'canvas-duplicate-qa',report:{ready,projectId:fixture.projectId,namespace:fixture.namespace,source:source&&summary(source),copies:copies.map(summary),addedEdges:edges,selected:state.selected,sourceUnchanged:sourceBaseline&&JSON.stringify(source)===JSON.stringify(sourceBaseline),exactUndoRestored:baseline===graph(),writesSinceBaseline:fixture.saves.length-baselineSaves,completedSaves:fixture.completedSaves,mediaMatchesSource:copies.every(copy=>copy.image===source?.image&&copy.fullImage===source?.fullImage),expectedDuplicatePosition:source&&{x:source.x+source.width+100,y:source.y},blockedAPIs:fixture.blockedAPIs,externalAttempts:fixture.externalAttempts}},location.origin);
}
for(let attempt=0;attempt<200;attempt++){
  if(window.CanvasMenus&&window.NodeEditor&&app()?.getState().nodes.some(node=>node.id==='qa-duplicate-source')){await app().saveProject();baseline=graph();baselineSaves=fixture.saves.length;ready=true;break;}
  await new Promise(resolve=>setTimeout(resolve,50));
}
fixture.report=report;document.addEventListener('canvas:render',()=>{if(ready)setTimeout(report,0);});report();
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent)return;const action=event.data?.action;if(action==='undo')app().undo();if(action==='report')report();});
