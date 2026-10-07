'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function fixture(node,editorVideo){
 const source=fs.readFileSync(require.resolve('../canvas-menus.js'),'utf8'),start=source.indexOf('  const variants ='),end=source.indexOf('  function keepMain(',start),primary=source.slice(source.indexOf('  const primaryMedia ='),source.indexOf('  function node(x,y)'));
 const state={nodes:[node]},insertions=[];
 const app={getState:()=>state,projectIdentity:()=>({id:'menu-history'}),insertGraph:graph=>{insertions.push(graph);state.nodes.push(...graph.nodes);return graph.group;},fitNode(){}};
 const window={EDITOR_DATA:{nodes:{[node.id]:{video:editorVideo}}}};global.window=window;
 const context={app,window,loadRuntime:()=>import('../src/features/node-history-expansion/runtime.mjs')};
 const wrapper=source.slice(start,end).replace("import('./src/features/node-history-expansion/runtime.mjs')",'loadRuntime()');
 vm.runInNewContext(primary+wrapper+'\nthis.apply=applyHistory;',context);
 return {apply:()=>context.apply(node),insertions,state};
}
test('production menu history wrapper expands EDITOR_DATA current video plus an old version using the real runtime/model',async()=>{
 const node={id:'legacy-video',type:'video',title:'Legacy',x:10,y:20,width:300,height:200,image:'poster.png',videoMetadata:{width:1280,height:720,duration:5},versions:[{video:'asset:old.mp4',width:640,height:480,duration:3}]},before=structuredClone(node),f=await fixture(node,'asset:current.mp4');
 const group=await f.apply();assert.equal(f.insertions.length,1);assert.equal(group.type,'group');assert.deepEqual(f.insertions[0].nodes.slice(1).map(n=>n.video),['asset:current.mp4','asset:old.mp4']);assert.deepEqual(f.insertions[0].nodes[1].videoMetadata,{width:1280,height:720,duration:5});assert.deepEqual(node,before);
});
test('production menu history wrapper keeps fullImage-only current image plus an alternative in the real runtime/model',async()=>{
 const node={id:'full-image',type:'image',title:'Original',x:10,y:20,width:300,height:200,fullImage:'asset:original.png',pixelWidth:400,pixelHeight:300,versions:[{image:'asset:old.png',width:200,height:200}]},before=structuredClone(node),f=await fixture(node);
 await f.apply();assert.equal(f.insertions.length,1);assert.deepEqual(f.insertions[0].nodes.slice(1).map(n=>n.fullImage||n.image),['asset:original.png','asset:old.png']);assert.deepEqual(node,before);
});
test('legacy single video without alternatives remains a real no-history rejection and leaves the graph untouched',async()=>{
 const node={id:'single-video',type:'video',x:10,y:20,width:300,height:200,versions:[]},f=await fixture(node,'asset:current.mp4');await assert.rejects(f.apply(),/无可应用历史/);assert.equal(f.insertions.length,0);assert.equal(f.state.nodes.length,1);
});
