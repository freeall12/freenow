const test=require('node:test'),assert=require('node:assert/strict');
const {instantiate}=require('../canvas-clipboard.js');
const subject={name:'演员',assets:[{id:'a',type:'text',name:'人物',text:'保持外观'},{id:'b',type:'audio',name:'声音',url:'asset:voice',durationMs:1700}]};
function host(){const state={nodes:[],edges:[]};let commits=0;return {get commits(){return commits;},getState:()=>state,notify(){},pasteGraph(snapshot,position){commits++;const graph=instantiate(snapshot,state.nodes,position);state.nodes.push(...graph.nodes);return graph;}};}
test('subject import uses one real graph instantiation and preserves fractional world position, media duration and async provenance',async()=>{
 const {applySubject}=await import('../src/features/subject-library/apply.mjs');const app=host();let checked=false;
 const graph=await applySubject(subject,app,{position:{x:13.125,y:-200.75},resolveUrl:async url=>url,
  mapNode:async(node,index)=>({...node,subjectImport:{index}}),beforeCommit:()=>{assert.equal(app.commits,0);checked=true;}});
 assert.equal(checked,true);assert.equal(app.commits,1);assert.equal(graph.nodes.length,2);
 assert.deepEqual(graph.nodes.map(n=>[n.x,n.y]),[[13.125,-200.75],[373.125,-200.75]]);
 assert.equal(graph.nodes[1].durationMs,1700);assert.equal(graph.nodes[1].subjectImport.index,1);assert.equal(graph.nodes[0].content,'保持外观');
});
test('late cancellation, subject revision failure and unresolved asset prevent all graph writes',async()=>{
 const {applySubject}=await import('../src/features/subject-library/apply.mjs');
 const app=host(),controller=new AbortController();
 await assert.rejects(applySubject(subject,app,{position:{x:1,y:2},signal:controller.signal,resolveUrl:async url=>url,mapNode:async node=>{controller.abort();return node;}}),{name:'AbortError'});
 await assert.rejects(applySubject(subject,app,{position:{x:1,y:2},resolveUrl:async url=>url,beforeCommit:()=>{throw Error('subject version conflict');}}),/version conflict/);
 await assert.rejects(applySubject(subject,app,{position:{x:1,y:2},resolveUrl:async url=>{if(url)throw Error('missing asset');return url;}}),/missing asset/);
 assert.equal(app.commits,0);assert.equal(app.getState().nodes.length,0);
});
