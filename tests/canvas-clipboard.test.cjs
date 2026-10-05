const test=require('node:test'),assert=require('node:assert/strict'),{capture,instantiate,duplicateNode}=require('../canvas-clipboard.js');
const nodes=[{id:'g',type:'group',x:50000.25,y:-2000.5,width:800,height:400},{id:'a',type:'image',parentId:'g',x:50100.25,y:-1900.5,width:200,height:200,generation:{referenceIds:['b'],referenceBindings:[{nodeId:'b'}]}},{id:'b',type:'image',parentId:'g',x:50400.25,y:-1900.5,width:200,height:200},{id:'ext',type:'text',x:40000,y:-1000,width:300,height:300}],edges=[{id:'in',source:'ext',target:'a'},{id:'ab',source:'a',target:'b'},{id:'out',source:'a',target:'ext'}];
const ids=()=>{let i=0;return()=>`new-${++i}`;};
test('group clipboard uses absolute coordinates once and retains only incoming reference edges',()=>{const snapshot=capture(nodes,edges,['g']);assert.equal(snapshot.nodes.length,3);const graph=instantiate(snapshot,nodes,{x:100.25,y:200.5},0,.25,ids());assert.equal(graph.nodes[1].x,200.25);assert.equal(graph.nodes[1].y,300.5);assert.equal(graph.nodes[1].parentId,graph.nodes[0].id);assert.deepEqual(graph.nodes[1].generation.referenceIds,[graph.nodes[2].id]);assert.deepEqual(graph.nodes[1].generation.referenceBindings,[{nodeId:graph.nodes[2].id}]);assert.equal(graph.edges.length,2);assert.equal(graph.edges[0].source,'ext');assert.deepEqual(graph.selected,[graph.nodes[0].id]);assert.equal(nodes[1].x,50100.25);});
test('paste offsets repeat by 40 screen pixels at fractional zoom',()=>{const snap=capture(nodes,edges,['a']);const graph=instantiate(snap,nodes,{x:10,y:20},2,.25,ids());assert.equal(graph.nodes[0].x,330);assert.equal(graph.nodes[0].y,340);assert.equal(graph.nodes[0].parentId,undefined);});
test('deleted external sources do not produce dangling edges',()=>{const snap=capture(nodes,edges,['a']);assert.equal(instantiate(snap,[],{x:0,y:0},0,1,ids()).edges.length,0);});
test('pile copies own members and selects only its root',()=>{const pile=[{id:'p',type:'pile',x:100,y:200,width:200,height:200,memberIds:['a','b']},...nodes.slice(1,3).map(n=>({...n,parentId:undefined}))];const graph=instantiate(capture(pile,[],['p']),pile,{x:0,y:0},0,1,ids());assert.equal(graph.nodes.length,3);assert.deepEqual(graph.nodes[0].memberIds,graph.nodes.slice(1).map(n=>n.id));assert.deepEqual(graph.selected,[graph.nodes[0].id]);});
test('studio and empty selection reject rather than silently losing scene state',()=>{assert.throws(()=>capture([{id:'s',type:'studio'}],[],['s']),/3D/);assert.throws(()=>capture(nodes,edges,[]),/选择/);});

test('copied reference order remaps internal sources and keeps outside references',()=>{const snap=capture(nodes,edges,['g']);snap.nodes.find(n=>n.id==='a').generation={referenceOrder:['node:b','node:ext','saved:0'],promptReferenceBindings:[{renderText:'Image 1',referenceKey:'node:b'},{renderText:'Image 2',referenceKey:'node:ext'}]};const result=instantiate(snap,nodes,{x:0,y:0},0,1,ids());const a=result.nodes.find(n=>n.generation?.referenceOrder),b=result.nodes.find(n=>n.type==='image'&&n!==a);assert.deepEqual(a.generation.referenceOrder,['node:'+b.id,'node:ext','saved:0']);assert.deepEqual(a.generation.promptReferenceBindings.map(ref=>ref.referenceKey),['node:'+b.id,'node:ext']);});
test('copy of reversed deep groups traverses linearly and preserves original node order',()=>{
  let reads=0;const deep=Array.from({length:2000},(_,i)=>({id:'g'+i,type:'group',get parentId(){reads++;return i?'g'+(i-1):undefined;},x:50000.125+i,y:-2000.375,width:300,height:200})).reverse();
  const graph=capture(deep,[],['g0']);assert.equal(graph.nodes.length,2000);assert.equal(graph.nodes[0].id,'g1999');assert.equal(graph.nodes.at(-1).id,'g0');
  assert(reads<=deep.length*5,'parent indexing, structured clone, and root detachment must stay linear');assert.equal(graph.nodes[0].x,51999.125);
  const cycle=capture([{id:'p',type:'pile',memberIds:['q']},{id:'q',type:'pile',memberIds:['p']}],[],['p']);assert.equal(cycle.nodes.length,2);
});

test('ordinary duplicate uses absolute width plus 100, detaches parent, and deeply isolates content',()=>{
 const source={id:'child',type:'text',x:50000.125,y:-2000.375,width:330.5,height:120,parentId:'group',extent:'parent',content:'独立正文',generation:{prompt:'参考原文',referenceIds:['external']},params:{nested:{value:1}},textHistory:[{text:'原历史'}]};
 const before=structuredClone(source),result=duplicateNode(source,[],ids());
 assert.equal(result.node.x,50430.625);assert.equal(result.node.y,source.y);assert.equal(result.node.id,'new-1');assert.equal(Object.hasOwn(result.node,'parentId'),false);assert.equal(Object.hasOwn(result.node,'extent'),false);
 result.node.generation.referenceIds.push('changed');result.node.params.nested.value=2;result.node.textHistory[0].text='改变';assert.deepEqual(source,before);
 assert.equal(duplicateNode({...source,extent:[[0,0],[100,100]]},[],ids()).node.extent[1][0],100,'non-parent extent is retained');
 assert.equal(duplicateNode({...source,width:undefined,measured:{width:123.75}},[],ids()).node.x,source.x+223.75);
 assert.equal(duplicateNode({...source,width:undefined},[],ids()).node.x,source.x+350);
});

test('ordinary duplicate copies outgoing first, appends target orders, and preserves incoming orders and handles',()=>{
 const source={id:'a',type:'image',x:1.25,y:2.75,width:200,height:100,image:'current.png'};
 const original=[{id:'in-1',source:'up1',target:'a',order:3,sourceHandle:'s1',targetHandle:'t1',selected:true,style:{stroke:'#f00'}},{id:'out-1',source:'a',target:'down',order:2,sourceHandle:'s2',targetHandle:'t2',path:'M0,0 C1,2 3,4 5,6',purpose:'generation-input',custom:{keep:true}},{id:'in-2',source:'up2',target:'a',data:{order:7,purpose:'world-script'}},{id:'out-2',source:'a',target:'down',order:4},{id:'unrelated',source:'other',target:'down',order:9}];
 const before=structuredClone(original),result=duplicateNode(source,original,ids()),[out1,out2,in1,in2]=result.edges;
 assert.deepEqual(result.edges.map(edge=>[edge.source,edge.target]),[['new-1','down'],['new-1','down'],['up1','new-1'],['up2','new-1']]);
 assert.deepEqual([out1.order,out2.order,in1.order,in2.data.order],[10,11,3,7]);assert.equal(out1.sourceHandle,'s2');assert.equal(out1.targetHandle,'t2');assert.equal(in1.sourceHandle,'s1');assert.equal(in1.targetHandle,'t1');assert.equal(in2.data.purpose,'world-script');assert.equal(out1.purpose,'generation-input');assert.equal(out1.path,undefined);assert.equal(in1.selected,undefined);
 out1.custom.keep=false;in1.style.stroke='#0f0';assert.deepEqual(original,before);
 assert.equal(new Set([result.node.id,...result.edges.map(edge=>edge.id)]).size,5);
});

test('official data order, unordered sentinel and self-loop duplication remain explicit',()=>{
 const source={id:'a',type:'audio',x:0,y:0,width:250,height:250,audio:'sound.wav'};
 const original=[{id:'one',source:'a',target:'t',data:{order:3,custom:'keep'}},{id:'two',source:'a',target:'t',data:{order:8}},{id:'unranked',source:'other',target:'t'},{id:'loop',source:'a',target:'a',order:4,sourceHandle:'right',targetHandle:'left'}];
 const result=duplicateNode(source,original,ids());assert.equal(result.edges[0].data.order,2**30+1);assert.equal(result.edges[1].data.order,2**30+2);assert.equal(result.edges[0].data.custom,'keep');assert.equal(result.edges[0].order,undefined);
 assert.deepEqual(result.edges.slice(-2).map(edge=>[edge.source,edge.target,edge.order]),[['new-1','a',5],['a','new-1',4]]);
 assert.equal(duplicateNode(source,[{id:'in',source:'s',target:'a'}],ids()).edges[0].order,0);
});

test('image and video duplicate reset gallery and task ownership while preserving current media provenance',()=>{
 for(const type of ['image','video']){
  const source={id:'source',type,x:1,y:2,width:250,height:140,image:'poster.png',fullImage:'current.png',video:type==='video'?'current.mp4':undefined,clip:{start:1,end:3},videoMetadata:{width:400,height:200,duration:4},generation:{prompt:'真实下一次参数',refs:['reference.png']},imageHistory:[{id:'image-batch'}],videoHistory:[{id:'video-batch'}],versions:[{image:'old.png'}],options:['old.png'],imageOptions:['old.png'],historyLocalQueues:['queue'],historySourceNodeId:'history-owner',historyPreviewSrc:'preview.png',currentImageOptionId:'old-option',currentVideoOptionId:'old-video-option',historyVariantsHidden:true,historyVariantCount:6,pendingOperation:type+'.generate',generationRun:{runId:'running'},generationRecovery:{version:1,runId:'running'},workflowRecoveryResult:{runId:'group-run',nodeId:'source'},taskInfo:{status:'PROCESSING'},loading:true,currentSourceFileId:'current-file',provenance:{kind:'generation-result',taskId:'past-job',mediaSource:type==='video'?'current.mp4':'current.png'},customMetadata:{running:'user-owned-label'}};
  const before=structuredClone(source),copy=duplicateNode(source,[],ids()).node;
  for(const key of ['image','fullImage','video','clip','videoMetadata','generation','provenance','currentSourceFileId','customMetadata'])assert.deepEqual(copy[key],source[key]);
  for(const key of ['imageHistory','videoHistory','versions','options','imageOptions','videoOptions','historyLocalQueues','historyLocalQueueMetadata','historyLocalQueueResourceMetadata'])assert.deepEqual(copy[key],[]);
  for(const key of ['pendingOperation','generationRun','generationRecovery','workflowRecoveryResult','historySourceNodeId','historyPreviewSrc','currentImageOptionId','currentVideoOptionId'])assert.equal(Object.hasOwn(copy,key),false);
  assert.equal(copy.loading,false);assert.equal(copy.taskInfo,null);assert.equal(copy.historyVariantsHidden,false);assert.equal(copy.historyVariantCount,1);assert.deepEqual(source,before);
 }
 assert.equal(duplicateNode({id:'empty',type:'image',x:0,y:0,width:250},[],ids()).node.historyVariantCount,0);
});

test('copy/paste still retains captured history and clone owners stay outside the new ordinary helper',()=>{
 const source={id:'a',type:'image',x:0,y:0,width:250,height:250,imageHistory:[{id:'old-history'}],pendingOperation:'image.generate',generationRun:{runId:'old'}};
 const pasted=instantiate(capture([source],[],['a']),[source],{x:100,y:100},0,1,ids()).nodes[0];assert.deepEqual(pasted.imageHistory,source.imageHistory);assert.deepEqual(pasted.generationRun,source.generationRun);
 for(const owner of [{...source,type:'group'},{...source,type:'pile'},{...source,type:'studio'},{...source,type:'html'},{...source,tool:'image-editor'}])assert.throws(()=>duplicateNode(owner,[],ids()),/普通/);
});
