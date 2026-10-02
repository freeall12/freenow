const {test}=require('node:test'),assert=require('node:assert/strict');
const api=import('../src/features/generation-results/plan.mjs');
function setup(patch={}){
 const source={id:'source',type:'image',x:10.25,y:-30.75,width:250.5,height:160.25,image:'old.png',fullImage:'full.png',generation:{prompt:'生成',model:'configured-model',count:4},parentId:'group',...patch};
 const nodes=[{id:'input',type:'image',image:'ref.png',x:0,y:0,width:100,height:100},{id:'group',type:'group',x:0,y:0,width:1000,height:1000},source];
 const edges=[{id:'e1',source:'input',target:'source',order:2,valueKey:'image_srefs',purpose:'generation-input',sourceHandle:'r',targetHandle:'l'}];
 let counter=0;return {nodes,edges,sourceNodeId:source.id,resultCount:4,runId:'run',idFactory:kind=>`${kind}-${++counter}`};
}
test('spread preserves existing source and uses count+1 grid without source-result links',async()=>{
 const {planGenerationResults:p}=await api,args=setup(),before=structuredClone(args.nodes),plan=p(args),source=args.nodes.at(-1);
 assert.deepEqual(args.nodes,before);assert.equal(plan.nodes.find(node=>node.id===source.id),source);assert.equal(plan.targetNodeIds.length,4);assert.equal(plan.createdTargetNodeIds.length,4);assert.equal(plan.preservesSourceNode,true);
 assert.deepEqual(plan.pendingTargetNodes.map(node=>[node.x,node.y]),[[324.75,-30.75],[639.25,-30.75],[10.25,193.5],[324.75,193.5]]);
 assert.equal(plan.edgeChanges.length,4);assert.ok(plan.edgeChanges.every(change=>change.item.source==='input'&&change.item.order===2&&change.item.valueKey==='image_srefs'&&change.item.sourceHandle==='r'&&change.item.targetHandle==='l'));
 assert.equal(plan.additionalParameters.batch_count,4);assert.ok(plan.pendingTargetNodes.every(node=>node.parentId==='group'&&node.generation.count===1&&node.generation.times===1&&node.pendingOperation==='image.generate'));
});
test('empty source uses its ID for first result and preserves exact input ordering and purpose',async()=>{
 const {planGenerationResults:p}=await api,args=setup({image:'',fullImage:''});args.edges.push({id:'draft',source:'input',target:'source',purpose:'draft-reference',order:0,valueKey:'draft'},{id:'excluded',source:'missing',target:'source',purpose:'world-script'},{id:'outgoing',source:'source',target:'input'});args.resultsPerRequest=3;
 const plan=p(args);assert.equal(plan.targetNodeIds[0],'source');assert.equal(plan.createdTargetNodeIds.length,3);assert.equal(plan.edgeChanges.length,6);assert.deepEqual(plan.edgeChanges.slice(0,2).map(change=>change.item.purpose),['generation-input','draft-reference']);
 assert.deepEqual(plan.requestPlans.map(request=>request.targets.map(target=>target.resultIndex)),[[0,1,2],[0]]);assert.equal(plan.additionalParameters.batch_count,2);
 assert.deepEqual(plan.pendingTargetNodes.map(node=>[node.x,node.y]),[[10.25,-30.75],[324.75,-30.75],[10.25,193.5],[324.75,193.5]]);
});
test('clones clear media/history/file identities without mutating prompt or source',async()=>{
 const {planGenerationResults:p}=await api,args=setup({versions:[{image:'secret-old.png'}],imageHistory:[{id:'history'}],currentSourceFileId:'provider-file',fileID:'legacy-id',video:'stale',clip:{start:2},taskInfo:{old:true},generationRecovery:{version:1,runId:'old'}}),plan=p({...args,editorPrompt:'new prompt'}),node=plan.pendingTargetNodes[0];assert.equal(node.generationRecovery,undefined);
 for(const field of ['fullImage','versions','imageHistory','currentSourceFileId','fileID','video','clip','taskInfo'])assert.equal(node[field],undefined,field);
 assert.equal(node.image,'');assert.equal(node.prompt,'new prompt');assert.equal(node.generation.prompt,'new prompt');assert.equal(args.nodes.at(-1).generation.prompt,'生成');assert.equal(args.nodes.at(-1).currentSourceFileId,'provider-file');
});
test('text variants replace first source and spread; media variants stay on history path',async()=>{
 const {planGenerationResults:p}=await api,args=setup({type:'text',text:'existing markdown'}),plan=p({...args,resultLayout:'variants'});
 assert.equal(plan.preservesSourceNode,false);assert.equal(plan.targetNodeIds[0],'source');assert.equal(plan.pendingTargetNodes[0].text,'existing markdown');assert.equal(plan.pendingTargetNodes[1].text,'');assert.equal(plan.additionalParameters.layout,'spread');
 assert.throws(()=>p({...setup(),resultLayout:'variants'}),{code:'variants_history_required'});
});
test('flat text content is recognized and cleared only on additional targets',async()=>{
 const {planGenerationResults:p,hasResult}=await api,args=setup({type:'text',content:'本地 Markdown 正文'}),plan=p({...args,resultLayout:'variants'});
 assert.equal(hasResult(args.nodes.at(-1)),true);assert.equal(plan.isRegeneration,true);assert.equal(plan.pendingTargetNodes[0].content,'本地 Markdown 正文');assert.ok(plan.pendingTargetNodes.slice(1).every(node=>node.content===''&&node.text===''));assert.equal(args.nodes.at(-1).content,'本地 Markdown 正文');
});
test('snapshot permits movement but rejects changed source, references and input topology',async()=>{
 const {captureResultSnapshot:c,assertResultSnapshot:a,assertPlanCurrent,planGenerationResults:p}=await api,args=setup(),snapshot=c(args.nodes,args.edges,'source'),plan=p(args);
 args.nodes.at(-1).x+=.5;assert.equal(a(snapshot,args.nodes,args.edges),true);assert.throws(()=>assertPlanCurrent(plan,args.nodes,args.edges),{code:'stale_result_plan'});args.nodes.at(-1).x-=.5;
 args.nodes[0].image='changed.png';assert.throws(()=>a(snapshot,args.nodes,args.edges),{code:'stale_result_plan'});args.nodes[0].image='ref.png';args.edges[0].order=3;assert.throws(()=>a(snapshot,args.nodes,args.edges),{code:'stale_result_plan'});args.edges[0].order=2;
 args.nodes.at(-1).generation.prompt='edited';assert.throws(()=>a(snapshot,args.nodes,args.edges),{code:'stale_result_plan'});
});
test('invalid IDs, missing inputs and hidden pile source fail before graph mutation',async()=>{
 const {planGenerationResults:p,assertPlanCurrent}=await api,args=setup(),plan=p(args);
 assert.throws(()=>p({...setup(),idFactory:()=> 'source'}),/标识/);assert.throws(()=>p({...setup(),resultCount:0}),/正整数/);
 args.nodes.push({id:'owner',type:'pile',memberIds:['source']});assert.throws(()=>p(args),/隐藏/);args.nodes.pop();
 args.nodes=args.nodes.filter(node=>node.id!=='input');assert.throws(()=>p(args),/参考/);
 const fresh=setup();fresh.nodes.push({id:plan.createdTargetNodeIds[0]});assert.throws(()=>assertPlanCurrent(plan,fresh.nodes,fresh.edges),{code:'stale_result_plan'});
});
test('pile includes preserved source, inherits parent and keeps member world coordinates',async()=>{
 const {planGenerationResults:p}=await api,args=setup(),plan=p({...args,resultLayout:'pile'}),pile=plan.pileNode;
 assert.deepEqual(pile.memberIds,plan.layoutNodeIds);assert.equal(pile.memberIds[0],'source');assert.equal(pile.parentId,'group');assert.equal(pile.selected,false);assert.deepEqual([pile.x,pile.y,pile.width,pile.height],[10.25,-30.75,250.5,160.25]);
 for(const id of pile.memberIds){const node=plan.nodes.find(node=>node.id===id);assert.equal(node.parentId,undefined);assert.equal(node.x,10.25);assert.equal(node.y,-30.75);}
 assert.equal(args.nodes.at(-1).parentId,'group');assert.throws(()=>p({...setup(),resultLayout:'pile',pileRules:{maxMembers:4}}),/堆叠/);
});
test('text pile size uses 320 display bounds and original bounds center; one result makes no pile',async()=>{
 const {planGenerationResults:p}=await api,args=setup({type:'text',text:'old',width:640,height:400}),plan=p({...args,resultLayout:'pile'});
 assert.deepEqual([plan.pileNode.x,plan.pileNode.y,plan.pileNode.width,plan.pileNode.height],[170.25,69.25,320,200]);
 const single=p({...setup({image:'',fullImage:''}),resultCount:1,resultLayout:'pile'});assert.equal(single.pileNode,undefined);assert.equal(single.nodeChanges.length,1);
});
