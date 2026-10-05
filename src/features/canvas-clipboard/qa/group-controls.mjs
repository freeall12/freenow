const fixture=window.CanvasDuplicateFixture,app=()=>window.CanvasApp;
let baseline=null,baselineSaves=0,ready=false;
const graph=()=>JSON.stringify({nodes:app().getState().nodes,edges:app().getState().edges});
function report(){
  if(!app())return;
  const state=app().getState(),originalIds=new Set(fixture.seed.nodes.map(node=>node.id)),copies=state.nodes.filter(node=>!originalIds.has(node.id)),copyIds=new Set(copies.map(node=>node.id));
  const edges=state.edges.filter(edge=>!fixture.seed.edges.some(original=>original.id===edge.id));
  const summary=node=>({id:node.id,title:node.title,originId:fixture.seed.nodes.find(original=>original.title===node.title)?.id,type:node.type,parentId:node.parentId,extent:node.extent,x:node.x,y:node.y,width:node.width,height:node.height,loading:node.loading,taskInfo:node.taskInfo,selected:node.selected,dragging:node.dragging,currentSourceFileId:node.currentSourceFileId,historyCount:node.imageHistory?.length||0,versionsCount:node.versions?.length||0,historyVariantCount:node.historyVariantCount,pendingOperation:node.pendingOperation,generationRun:node.generationRun,generationRecovery:node.generationRecovery,workflowRecoveryResult:node.workflowRecoveryResult,hasGeneration:!!node.generation});
  const originals=state.nodes.filter(node=>originalIds.has(node.id)),originalBaseline=baseline&&JSON.parse(baseline).nodes;
  parent.postMessage({type:'canvas-group-copy-qa',report:{ready,projectId:fixture.projectId,namespace:fixture.namespace,view:state.view,originals:originals.map(summary),copies:copies.map(summary),addedEdges:edges,selected:state.selected,originalsUnchanged:originalBaseline&&JSON.stringify(originals)===JSON.stringify(originalBaseline),exactUndoRestored:baseline===graph(),writesSinceBaseline:fixture.saves.length-baselineSaves,completedSaves:fixture.completedSaves,mediaMatchesSource:copies.every(copy=>{const source=fixture.seed.nodes.find(original=>original.title===copy.title);return !source||copy.image===source.image&&copy.fullImage===source.fullImage;}),externalIncoming:edges.filter(edge=>!copyIds.has(edge.source)&&copyIds.has(edge.target)).length,internalEdges:edges.filter(edge=>copyIds.has(edge.source)&&copyIds.has(edge.target)).length,externalOutgoing:edges.filter(edge=>copyIds.has(edge.source)&&!copyIds.has(edge.target)).length,blockedAPIs:fixture.blockedAPIs,externalAttempts:fixture.externalAttempts}},location.origin);
}
for(let attempt=0;attempt<200;attempt++){
  if(window.CanvasMenus&&window.NodeEditor&&app()?.getState().nodes.some(node=>node.id==='qa-copy-group')){await app().saveProject();baseline=graph();baselineSaves=fixture.saves.length;ready=true;break;}
  await new Promise(resolve=>setTimeout(resolve,50));
}
fixture.report=report;document.addEventListener('canvas:render',()=>{if(ready)setTimeout(report,0);});report();
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent)return;const action=event.data?.action;if(action==='select-group'||action==='select-text'){app().select(action==='select-group'?'qa-copy-group':'qa-copy-text');document.querySelector('#canvas').focus({preventScroll:true});}if(action==='undo')app().undo();if(action==='report')report();});
