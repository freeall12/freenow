const {test}=require('node:test'),assert=require('node:assert/strict');
const moduleReady=import('../src/features/workflow-recovery/context.mjs');
const config=node=>node.generation||{},piles={index:nodes=>({owner:new Map(nodes.flatMap(node=>node.type==='pile'?(node.memberIds||[]).map(id=>[id,node.id]):[]))})};
test('workflow ownership ignores geometry and titles but includes media history and original result marker',async()=>{
 const {nodeVersion}=await moduleReady,node={id:'a',type:'image',parentId:'g',generation:{prompt:'船'},image:'asset:a',imageHistory:[{id:'old'}]},edges=[{source:'b',target:'a'}],baseline=nodeVersion(node,edges,config);
 assert.equal(nodeVersion({...node,x:500,y:200,width:600,title:'改名'},edges,config),baseline);
 for(const patch of [{image:'asset:b'},{parentId:'other'},{imageHistory:[{id:'new'}]},{workflowRecoveryResult:{runId:'run',taskId:'task'}},{generation:{prompt:'城'}}])assert.notEqual(nodeVersion({...node,...patch},edges,config),baseline);
 assert.notEqual(nodeVersion(node,[],config),baseline);
});
test('workflow context reads current pile ownership and preserves all tracked external source signatures',async()=>{
 const {readContext,contextMatches}=await moduleReady,state={nodes:[{id:'g',type:'group'},{id:'a',type:'image',parentId:'g'},{id:'b',type:'text',content:'参考'}],edges:[{source:'b',target:'a'}]},options={state,projectId:'p',groupId:'g',trackedIds:['a','b'],config,piles},baseline=readContext(options);
 assert.deepEqual(baseline.members,['a']);assert.ok(contextMatches(baseline,readContext(options)));
 state.nodes[1].x=40;assert.ok(contextMatches(baseline,readContext(options)));
 state.nodes[2].content='新参考';assert.equal(contextMatches(baseline,readContext(options)),false);
 state.nodes.push({id:'pile',type:'pile',parentId:'g',memberIds:['a']});assert.deepEqual(readContext(options).members,[]);
 assert.throws(()=>readContext({...options,trackedIds:['missing']}),/不存在/);
});
