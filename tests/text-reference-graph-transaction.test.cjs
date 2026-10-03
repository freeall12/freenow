const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=require('../canvas-text.js'),source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function named(name){const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start);return source.slice(start,end);}
function method(name,next){const start=source.indexOf(`    ${name}(`),end=source.indexOf(`\n    ${next}`,start+1);assert.ok(start>=0&&end>start);return source.slice(start,end).trim().replace(/,$/,'');}
function fixture(){return {nodes:[{id:'a',type:'text',content:'甲',title:'甲',x:0,y:0},{id:'b',type:'text',content:'乙',title:'乙',x:0,y:0},{id:'t',type:'text',textMode:'generate',generation:{model:'gemini-3.1-flash-lite',prompt:'比较{{Text 1}}与{{Text 2}}',referenceIds:['a','b'],promptReferenceBindings:[{renderText:'Text 1',referenceKey:'node:a'},{renderText:'Text 2',referenceKey:'node:b'}]},x:0,y:0},{id:'pure',type:'text',content:'纯文本'}],edges:[{id:'ea',source:'a',target:'t'},{id:'eb',source:'b',target:'t'}]};}
function harness(graph=fixture()){
 let serial=0;const context=vm.createContext({graph:structuredClone(graph),structuredClone,crypto:{randomUUID:()=>`copy-${++serial}`},window:{CanvasText:text,CanvasGroups:require('../canvas-groups.js'),CanvasPiles:{index:()=>({owner:new Map()})},CanvasConnections:{} }});
 vm.runInContext(`let nodes=graph.nodes,edges=graph.edges,selected=new Set(),history=[],saves=0,renders=0,rebuilds=0;
 const clone=structuredClone;function remember(){history.push(clone({nodes,edges}));}function persist(){saves++;}function render(){renders++;}function rebuildAndPersist(){rebuilds++;persist();}function rebuild(){rebuildAndPersist();}function notify(message){throw Error(message);}
 ${named('removeSelected')} ${named('duplicate')}
 const api={${method('removeEdges','addConnectionNode(')}};window.CanvasApp=api;
 globalThis.probe={remove:ids=>{selected=new Set(ids);removeSelected();},duplicate:ids=>{selected=new Set(ids);duplicate();},disconnect:ids=>api.removeEdges(ids),state:()=>clone({nodes,edges,history,saves,renders,rebuilds}),undo:()=>{const old=history.pop();nodes=old.nodes;edges=old.edges;}};`,context);
 return context.probe;
}
test('disconnect atomically removes only the bound mention and undo restores the original graph',()=>{
 const p=harness(),before=p.state();p.disconnect(['ea']);const after=p.state(),target=after.nodes.find(n=>n.id==='t');
 assert.equal(after.history.length,1);assert.equal(after.saves,1);assert.equal(target.generation.prompt,'比较与{{Text 1}}');assert.deepEqual([...target.generation.referenceIds],['b']);
 assert.equal(text.request(target,after.nodes,after.edges).prompt,'比较与乙');p.undo();assert.deepEqual(p.state().nodes,before.nodes);assert.deepEqual(p.state().edges,before.edges);
});
test('source deletion retains pure text mode and cleans stale legacy references in one history entry',()=>{
 const graph=fixture();graph.nodes.find(n=>n.id==='t').generation.referenceIds.push('missing');const p=harness(graph);p.remove(['a']);const state=p.state();
 assert.equal(state.history.length,1);assert.equal(state.saves,1);assert.equal(state.nodes.find(n=>n.id==='pure').generation,undefined);assert.deepEqual([...state.nodes.find(n=>n.id==='t').generation.referenceIds],['b']);
});
test('duplicating source and target remaps semantic identity while preserving external references',()=>{
 const p=harness();p.duplicate(['a','t']);const state=p.state(),target=state.nodes.find(n=>n.id==='copy-2');
 assert.equal(state.history.length,1);assert.deepEqual([...target.generation.referenceIds],['copy-1','b']);assert.equal(target.generation.promptReferenceBindings[0].referenceKey,'node:copy-1');assert.equal(target.generation.promptReferenceBindings[1].referenceKey,'node:b');assert.equal(target.generation.prompt,'比较{{Text 1}}与{{Text 2}}');
});
