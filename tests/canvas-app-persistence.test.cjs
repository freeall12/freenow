const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),clipboard=require('../canvas-clipboard.js');
const fixture=()=>({nodes:[{id:'a',type:'image',title:'Original',image:'original.png',fullImage:'full.png',x:10.25,y:-30.75,width:446,height:250,generation:{prompt:'原提示词',count:2},imageHistory:[{id:'old',options:[{image:'previous.png'}]}]},{id:'b',type:'image',title:'Reference',image:'reference.png',x:900.5,y:40.125,width:250,height:250}],edges:[{id:'e',source:'b',target:'a',order:2,purpose:'generation-input'}]});
function named(name){const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start,`production function ${name}`);return source.slice(start,end);}
function method(name,next){const start=source.indexOf(`    ${name}(`),end=source.indexOf(`\n    ${next}`,start+1);assert.ok(start>=0&&end>start,`production method ${name}`);return source.slice(start,end).trim().replace(/,$/,'');}
function productionNodeEditor(editorData,drafts={}){
 const editorSource=fs.readFileSync(require.resolve('../node-editor.js'),'utf8'),context=vm.createContext({window:{EDITOR_DATA:editorData},drafts});
 const functions=['defaults','countConfiguration','normalizeCountConfig','getConfig'].map(name=>{const start=editorSource.indexOf(`  function ${name}(`),end=editorSource.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start);return editorSource.slice(start,end);});
 vm.runInContext(`const node=null,imageMenus=null,videoMenus=null,cameraControls=null,depthComposer=null,resultCounts=null,resultMode='variants',depthSelected=()=>false;${functions.join('\n')}globalThis.editor={getConfig};`,context);
 return context.editor;
}
function harness({ready=true,graph=fixture(),mirrorError,editorData={nodes:{legacy:{video:'legacy.mp4'}}},nodeEditor}={}){
 const saves=[],legacy=[],renders=[],errors=[],pending=[],motion=[],cleanup=[],pileCalls={plan:0,dropTarget:0};let serial=0,load;
 const pileCore=require('../canvas-piles.js'),piles={...pileCore,plan(...args){pileCalls.plan++;return pileCore.plan(...args);},dropTarget(...args){pileCalls.dropTarget++;return pileCore.dropTarget(...args);}};
 const root={children:[],getBoundingClientRect:()=>({left:0,top:0,width:1200,height:800}),get firstElementChild(){return this.children[0]||null;},insertBefore(el,before){this.children=this.children.filter(item=>item!==el);const index=before?this.children.indexOf(before):-1;if(index<0)this.children.push(el);else this.children.splice(index,0,el);}};
 let rejectLoad;
 const store={load:()=>new Promise((resolve,reject)=>{load=resolve;rejectLoad=reject;}),save:state=>{saves.push(structuredClone(state));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 const notices=[];
 const context=vm.createContext({navigator:{clipboard:{writeText:()=>Promise.resolve()}},fixture:graph,ready,root,renders,errors,cleanup,structuredClone,crypto:{randomUUID:()=>`new-${++serial}`},innerWidth:1200,innerHeight:800,prompt:()=> 'Renamed',localStorage:{setItem:(key,value)=>{if(mirrorError)throw mirrorError;legacy.push({key,value});}},document:{createElement:()=>({dataset:{},setAttribute(){},remove(){notices.splice(notices.indexOf(this),1);}}),body:{append:notice=>notices.push(notice)}},getNotice:()=>notices[0],window:{EDITOR_DATA:editorData,NodeEditor:nodeEditor,CanvasStore:store,CanvasGroups:require('../canvas-groups.js'),CanvasPiles:piles,CanvasText:{config:()=>({prompt:'',model:'text-model'})},CanvasClipboard:{...clipboard,instantiate:(...args)=>clipboard.instantiate(...args,()=>`new-${++serial}`)},CanvasConnections:{cancel(){},clearSelection(){}},CanvasPilesUI:{clearDropTarget:()=>cleanup.push('drop')},PileMotion:{cancel(){},capture(nodes){motion.push('capture');return structuredClone(nodes);},play(){motion.push('play');}}},EDITOR_DATA:editorData});
 // Execute production closure functions, including rebuild, history and hydration;
 // only the DOM/media renderer and async storage boundary are test doubles.
 vm.runInContext(`
 const clone=value=>structuredClone(value),original=new Map(fixture.nodes.map(node=>[node.id,clone(node)]));
 let nodes=clone(fixture.nodes),edges=clone(fixture.edges),selected=new Set(['a']),history=[],future=[],localChanges=0,graphLoaded=ready,graphReadFailed=false,filter='all',saveRevision=0;
 const view={x:-100.125,y:20.5,scale:.7},nodeElements=new Map(),nodeRecords=new Map(),pathElements=new Map(),generationRuns=new Map();
 const $=selector=>selector==='#storage-notice'?getNotice():root,flushGesture=()=>{},notify=()=>{};
 ${named('storageError')}
 const showStorageError=storageError;storageError=(error,operation)=>{errors.push('storage');showStorageError(error,operation);};
 function render(){renders.push(clone({nodes,edges}));}
 function syncNodeShell(){}
 function makeNode(node,before){const el={id:node.id,dataset:{type:node.type},get nextElementSibling(){return root.children[root.children.indexOf(this)+1]||null;}};root.insertBefore(el,before);nodeElements.set(node.id,el);nodeRecords.set(node.id,{node,content:nodeContentKey(node)});}
 function removeNodeElement(id){const el=nodeElements.get(id);root.children=root.children.filter(item=>item!==el);nodeElements.delete(id);nodeRecords.delete(id);}
 ${['remember','persist','undo','nodeContentKey','rebuild','rebuildAndPersist','clearOrphanGenerationState','generationSignature','rename','duplicate','removeSelected','newNode','addNode'].map(named).join('\n')}
 globalThis.api={${[method('captureSelection','pasteGraph('),method('pasteGraph','stack('),method('updateNode','insertGraph('),method('insertGraph','insertAsset('),method('insertAsset','addTypedNode(')].join(',\n')},getState:()=>clone({nodes,edges,selected:[...selected],view}),undo,duplicate,addNode};window.CanvasApp=api;
 globalThis.probe={state:()=>clone({nodes,edges,selected:[...selected],filter,localChanges,graphLoaded}),rename:()=>rename(nodes[0]),remove:removeSelected,history:()=>clone(history),select:ids=>selected=new Set(ids),rebuild};
 probe.rebuild();
 `,context,{filename:'app-persistence-production-extract.js'});
 const finish=source.slice(source.indexOf('  const finish=e=>'),source.indexOf("\n  canvas.addEventListener('pointerup',finish)"));
 vm.runInContext(`
 let gesture=null,suppressContext=false;
 const canvas={clientWidth:1200,clientHeight:800,dataset:{},classList:{remove:()=>cleanup.push('panning')}};
 const gestureQueue={clear:()=>cleanup.push('queue')},flushRender=()=>{},moveGesture=()=>cleanup.push('move');
 ${finish}
 probe.beginGesture=(id,point)=>{remember();selected=new Set([id]);const node=nodes.find(item=>item.id===id);gesture={mode:'node',saved:true,positions:[{id,x:node.x,y:node.y}],x:0,y:0,lastX:point.x,lastY:point.y};node.x+=15.125;node.y-=5.75;canvas.dataset.connectionsDragging='true';};
 probe.finish=finish;
 probe.gestureState=()=>clone({gesture,dragging:canvas.dataset.connectionsDragging,selectionHidden:root.hidden});
 `,context,{filename:'app-finish-production-extract.js'});
 const menusSource=fs.readFileSync(require.resolve('../canvas-menus.js'),'utf8'),menusFunction=name=>{const start=menusSource.indexOf(`  function ${name}(`),end=menusSource.indexOf(name==='copy'?'\n  function paste(':'\n  const variants',start+1);assert.ok(start>=0&&end>start);return menusSource.slice(start,end);};
 vm.runInContext(`const app=api;let copied=null,pasteAnchor=null,iteration=0,pointer={x:400.25,y:200.75};${menusFunction('copy')}${menusFunction('paste')}window.CanvasMenus={copy,paste};probe.setPointer=point=>pointer=point;probe.clipboard=()=>clone(copied);`,context,{filename:'canvas-menus-clipboard-production-extract.js'});
 const hydration=source.slice(source.indexOf('  window.CanvasStore.load().then'),source.lastIndexOf('\n})();')).trim();
 vm.runInContext(`globalThis.hydration=${hydration}`,context);
 saves.length=legacy.length=renders.length=pending.length=0;
 return {api:context.api,menus:context.window.CanvasMenus,probe:context.probe,pileCalls,saves,legacy,renders,errors,pending,motion,cleanup,notices,load:async value=>{load(value);await context.hydration;},failLoad:async error=>{rejectLoad(error);await context.hydration;},state:()=>structuredClone(context.probe.state())};
}
const graphOf=state=>({nodes:state.nodes,edges:state.edges});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ~= ${expected}`);
function once(f,operation){const before=f.saves.length;const value=operation();assert.equal(f.saves.length-before,1);assert.deepEqual(graphOf(f.saves.at(-1)),graphOf(f.state()));return value;}

test('single-node content and generation edits each save once and undo/redo retain complete graph',()=>{
 for(const patch of [{title:'Changed'},{generation:{prompt:'新的提示词',count:4}}]){
  const f=harness(),before=graphOf(f.state());once(f,()=>f.api.updateNode('a',patch));const after=graphOf(f.state());assert.equal(f.probe.history().length,1);
  once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);once(f,()=>f.api.undo(true));assert.deepEqual(graphOf(f.state()),after);
 }
});
test('rename, duplicate and delete save once, with exact history and connections restored',()=>{
 for(const operation of [f=>f.probe.rename(),f=>f.api.duplicate(),f=>f.probe.remove()]){
  const f=harness(),before=graphOf(f.state());once(f,()=>operation(f));assert.equal(f.probe.history().length,1);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
 }
});
test('production ordinary duplicate uses source width, copies incident edges and commits/undoes once',()=>{
 const graph=fixture();graph.edges.push({id:'out',source:'a',target:'b',order:3,sourceHandle:'right',targetHandle:'left',style:{stroke:'#123'}},{id:'other-out',source:'a',target:'b',order:7});
 const f=harness({graph}),before=graphOf(f.state());once(f,()=>f.api.duplicate());
 const state=f.state(),copy=state.nodes.at(-1);assert.equal(copy.x,556.25);assert.equal(copy.y,-30.75);assert.equal(copy.image,'original.png');assert.equal(copy.fullImage,'full.png');assert.deepEqual(copy.imageHistory,[]);assert.deepEqual(copy.generation,graph.nodes[0].generation);assert.deepEqual(state.selected,[copy.id]);
 const added=state.edges.slice(graph.edges.length);assert.deepEqual(added.map(edge=>[edge.source,edge.target,edge.order]),[[copy.id,'b',8],[copy.id,'b',9],['b',copy.id,2]]);assert.equal(added[0].targetHandle,'left');assert.deepEqual(added[0].style,{stroke:'#123'});assert.equal(f.probe.history().length,1);assert.equal(f.renders.length,1);
 once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);assert.equal(f.probe.history().length,0);assert.equal(f.renders.length,2);
 once(f,()=>f.api.undo(true));assert.deepEqual(graphOf(f.state()),graphOf(state));
});
test('production single grouped child detaches without adding parent coordinates or changing parent',()=>{
 const graph=fixture();graph.nodes.unshift({id:'g',type:'group',x:8000.25,y:-2000.125,width:900,height:500});graph.nodes[1].parentId='g';graph.nodes[1].extent='parent';
 const f=harness({graph}),before=graphOf(f.state());once(f,()=>f.api.duplicate());const copy=f.state().nodes.at(-1);
 assert.equal(copy.x,556.25);assert.equal(copy.y,-30.75);assert.equal(copy.parentId,undefined);assert.equal(copy.extent,undefined);assert.deepEqual(f.state().nodes[0],graph.nodes[0]);assert.deepEqual(f.state().selected,[copy.id]);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('production clone task reset leaves original owner and media untouched before any undo',()=>{
 const graph=fixture();Object.assign(graph.nodes[0],{pendingOperation:'image.generate',generationRun:{runId:'original-run',requestId:'original-request',resultIndex:0},generationRecovery:{version:1,runId:'original-run'},workflowRecoveryResult:{nodeId:'a',groupId:'owner'},loading:true,taskInfo:{status:'PROCESSING'},currentSourceFileId:'media-file',provenance:{kind:'imported',mediaSource:'full.png'}});
 const f=harness({graph});once(f,()=>f.api.duplicate());const [source,,copy]=f.state().nodes;
 assert.deepEqual(source,graph.nodes[0]);for(const key of ['pendingOperation','generationRun','generationRecovery','workflowRecoveryResult'])assert.equal(copy[key],undefined);assert.equal(copy.loading,false);assert.equal(copy.taskInfo,null);assert.equal(copy.currentSourceFileId,'media-file');assert.deepEqual(copy.provenance,source.provenance);
});
test('production duplicate materializes legacy current video and actual editor config before replacing the ID',()=>{
 const graph=fixture();Object.assign(graph.nodes[0],{type:'video',image:'poster.png'});delete graph.nodes[0].generation;
 const editorData={nodes:{a:{video:'assets/current-local.mp4',prompt:'旧节点提示词',model:'Seedance 2.0',duration:8,refs:['reference.png']}}},nodeEditor=productionNodeEditor(editorData),expected=structuredClone(nodeEditor.getConfig(graph.nodes[0])),f=harness({graph,editorData,nodeEditor}),before=graphOf(f.state());
 once(f,()=>f.api.duplicate());const copy=f.state().nodes.at(-1);assert.equal(copy.video,editorData.nodes.a.video);assert.equal(copy.historyVariantCount,1);assert.deepEqual(copy.generation,expected);assert.deepEqual(structuredClone(nodeEditor.getConfig(copy)),expected);assert.deepEqual(f.state().nodes[0],graph.nodes[0]);
 copy.generation.refs.push('new-reference');assert.deepEqual(editorData.nodes.a.refs,['reference.png']);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('production duplicate captures actual ID-bound editor drafts and retains explicit generation/params',()=>{
 for(const type of ['image','video']){
  const graph=fixture();graph.nodes[0].type=type;delete graph.nodes[0].generation;
  const editorData={nodes:{a:{prompt:'旧默认',count:1}}},drafts={a:{prompt:'未写回节点的草稿',times:2,refs:['draft-reference.png']}},nodeEditor=productionNodeEditor(editorData,drafts),expected=structuredClone(nodeEditor.getConfig(graph.nodes[0])),f=harness({graph,editorData,nodeEditor});
  once(f,()=>f.api.duplicate());assert.deepEqual(f.state().nodes.at(-1).generation,expected);assert.equal(expected.prompt,drafts.a.prompt);assert.equal(expected.count,2);assert.equal(graph.nodes[0].generation,undefined);
  for(const key of ['generation','params']){const explicit=structuredClone(graph);explicit.nodes[0][key]={prompt:'显式参数',nested:{keep:true}};const test=harness({graph:explicit,editorData,nodeEditor});once(test,()=>test.api.duplicate());assert.deepEqual(test.state().nodes.at(-1)[key],explicit.nodes[0][key]);if(key==='params')assert.equal(test.state().nodes.at(-1).generation,undefined);}
 }
});
test('production duplicate retains a blocked legacy video ref and its pending-import state',async()=>{
 const policy=await import('../src/features/local-resource-migration/display-media.mjs'),graph=fixture();graph.nodes[0].type='video';delete graph.nodes[0].generation;
 const editorData={nodes:{a:{video:'https://fe-assets.tapnow.media/qa-retained-media.mp4',prompt:'保留待导入引用'}}},nodeEditor=productionNodeEditor(editorData),f=harness({graph,editorData,nodeEditor});
 once(f,()=>f.api.duplicate());const copy=f.state().nodes.at(-1);assert.equal(copy.video,editorData.nodes.a.video);assert.equal(policy.displayMediaRef(copy.video),'');assert.equal(policy.nodeHasPendingOriginalMedia(copy),true);assert.equal(copy.historyVariantCount,1);assert.equal(f.state().nodes[0].video,undefined);
});
test('production uploaded media duplicate does not acquire a default generation composer',()=>{
 for(const type of ['image','video']){
  const graph=fixture();graph.nodes[0].type=type;graph.nodes[0].title='Uploaded media';delete graph.nodes[0].generation;if(type==='video')graph.nodes[0].video='local-upload.mp4';
  const editorData={nodes:{}},drafts={a:{prompt:'旧隐藏草稿'}},nodeEditor=productionNodeEditor(editorData,drafts),f=harness({graph,editorData,nodeEditor});once(f,()=>f.api.duplicate());const copy=f.state().nodes.at(-1);assert.equal(Object.hasOwn(copy,'generation'),false);assert.equal(Object.hasOwn(copy,'params'),false);assert.equal(copy.image,graph.nodes[0].image);assert.equal(copy.video,graph.nodes[0].video);
 }
});
test('production group and multi-selection duplicate use real copy/paste while single editor owners retain the previous branch',()=>{
 const graph=fixture();graph.nodes[0].parentId='g';graph.nodes.unshift({id:'g',type:'group',x:0,y:0,width:800,height:500});
 for(const ids of [['g'],['a','b']]){
  const f=harness({graph});f.probe.select(ids);const before=graphOf(f.state());once(f,()=>f.api.duplicate());const originals=ids[0]==='g'?graph.nodes.filter(n=>['g','a'].includes(n.id)):graph.nodes.filter(n=>ids.includes(n.id)),added=f.state().nodes.slice(graph.nodes.length),dx=(400.25+100.125)/.7-Math.min(...originals.map(n=>n.x)),dy=(200.75-20.5)/.7-Math.min(...originals.map(n=>n.y));
  assert.equal(added.length,originals.length);for(let i=0;i<added.length;i++){assert.equal(added[i].x,originals[i].x+dx);assert.equal(added[i].y,originals[i].y+dy);}assert.deepEqual(added.find(n=>n.type==='image').imageHistory,[]);assert.equal(f.probe.clipboard().nodes.length,originals.length);assert.equal(f.probe.history().length,1);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
 }
 const owner=fixture();owner.nodes[0].tool='image-editor';const f=harness({graph:owner});once(f,()=>f.api.duplicate());assert.equal(f.state().nodes.at(-1).x,90.25);assert.equal(f.state().nodes.at(-1).y,69.25);
});
test('real group copy/paste preserves nested absolute geometry and incoming graph, clears ownership, saves once and undoes exactly',()=>{
 const graph={nodes:[{id:'g',type:'group',parentId:'outer',extent:'parent',x:50000.125,y:-2000.375,width:900,height:500},{id:'nested',type:'group',parentId:'g',extent:'parent',x:50100.25,y:-1950.5,width:500,height:300},{id:'a',type:'image',parentId:'nested',extent:'parent',x:50130.625,y:-1900.875,width:200,height:100,image:'current.png',fullImage:'current-full.png',generation:{prompt:'keep',referenceOrder:['node:b','node:external']},imageHistory:[{options:['old.png']}],pendingOperation:'generate',generationRun:{runId:'old'},generationRecovery:{runId:'old'},workflowRecoveryResult:{nodeId:'a'},loading:true,taskInfo:{status:'PROCESSING'},currentSourceFileId:'retained',provenance:{taskId:'historical-file'}},{id:'b',type:'text',parentId:'g',x:50400.5,y:-1850.125,width:200,height:120,content:'原正文'},{id:'outer',type:'group',x:49000,y:-2500,width:2000,height:1500},{id:'external',type:'text',x:49000,y:-2000,width:200,height:120},{id:'downstream',type:'image',x:52000,y:-2000,width:200,height:100,image:'downstream.png'}],edges:[{id:'in',source:'external',target:'a',order:3,sourceHandle:'right',targetHandle:'left',custom:{keep:true},selected:true,path:'old'},{id:'inside',source:'a',target:'b',data:{order:7,purpose:'generation-input'}},{id:'out',source:'b',target:'downstream',order:8}]},f=harness({graph}),before=graphOf(f.state());f.probe.select(['g','a']);
 f.menus.copy();assert.equal(f.saves.length,0);assert.equal(f.probe.history().length,0);assert.equal(f.probe.clipboard().nodes.length,4);assert.deepEqual(f.probe.clipboard().edges.map(e=>e.id),['in','inside']);
 const pasted=once(f,()=>f.menus.paste({x:400.25,y:200.75})),[group,nested,a,b]=pasted.nodes,point={x:(400.25+100.125)/.7,y:(200.75-20.5)/.7};near(group.x,point.x);near(group.y,point.y);assert.equal(group.parentId,undefined);assert.equal(group.extent,undefined);assert.equal(nested.parentId,group.id);assert.equal(a.parentId,nested.id);near(nested.x-group.x,100.125);near(a.x-group.x,130.5);near(b.x-group.x,400.375);near(a.y-group.y,99.5);assert.equal(a.loading,false);assert.equal(a.taskInfo,null);assert.equal(a.pendingOperation,undefined);assert.equal(a.generationRun,undefined);assert.equal(a.generationRecovery,undefined);assert.equal(a.workflowRecoveryResult,undefined);assert.deepEqual(a.imageHistory,[]);assert.equal(a.currentSourceFileId,'retained');assert.deepEqual(a.provenance,{taskId:'historical-file'});assert.deepEqual(a.generation.referenceOrder,['node:'+b.id,'node:external']);assert.deepEqual(pasted.edges.map(e=>[e.source,e.target,e.order??e.data?.order]),[['external',a.id,3],[a.id,b.id,7]]);assert.equal(pasted.edges[0].sourceHandle,'right');assert.deepEqual(pasted.edges[0].custom,{keep:true});assert.equal(pasted.edges[0].selected,undefined);assert.equal(pasted.edges[0].path,undefined);assert.deepEqual(f.state().nodes.slice(0,graph.nodes.length),graph.nodes);assert.equal(f.renders.length,1);assert.equal(f.probe.history().length,1);
 const repeated=once(f,()=>f.menus.paste({x:400.25,y:200.75}));near(repeated.nodes[0].x,point.x+40/.7);near(repeated.nodes[0].y,point.y+40/.7);once(f,()=>f.api.undo());once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('real multi-selection copy/paste detaches each omitted parent, excludes outgoing edges and leaves upload composer absent',()=>{
 const graph=fixture();delete graph.nodes[0].generation;graph.nodes.unshift({id:'parent',type:'group',x:-1000.25,y:-900.5,width:2000,height:1500});graph.nodes[1].parentId='parent';graph.nodes[1].extent='parent';graph.nodes.push({id:'outside',type:'text',x:-400,y:0,width:200,height:100});graph.edges.push({id:'incoming',source:'outside',target:'a',order:6},{id:'outgoing',source:'b',target:'outside',order:9});const editorData={nodes:{}},f=harness({graph,editorData,nodeEditor:productionNodeEditor(editorData)}),before=graphOf(f.state());f.probe.select(['a','b']);f.menus.copy();const pasted=once(f,()=>f.menus.paste({x:100,y:90}));
 assert.equal(pasted.nodes.length,2);for(const n of pasted.nodes){assert.equal(n.parentId,undefined);assert.equal(n.extent,undefined);assert.equal(n.generation,undefined);}assert.equal(pasted.nodes[1].x-pasted.nodes[0].x,890.25);assert.equal(pasted.nodes[1].y-pasted.nodes[0].y,70.875);assert.deepEqual(pasted.edges.map(e=>[e.source,e.target,e.order]),[[pasted.nodes[1].id,pasted.nodes[0].id,2],['outside',pasted.nodes[0].id,6]]);assert.deepEqual(pasted.selected,pasted.nodes.map(n=>n.id));assert.deepEqual(f.state().nodes.slice(0,graph.nodes.length),graph.nodes);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('production capture materializes legacy video/getConfig only on the captured IDs without writing source nodes',()=>{
 const graph=fixture();graph.nodes.unshift({id:'g',type:'group',x:0,y:0,width:1400,height:800});for(const node of graph.nodes.slice(1))node.parentId='g';graph.nodes[1].type='video';delete graph.nodes[1].generation;graph.nodes[1].loading=true;graph.nodes[1].taskInfo={status:'PROCESSING'};graph.nodes[1].generationRun={runId:'old'};
 const editorData={nodes:{a:{video:'assets/legacy-current.mp4',prompt:'真实旧视频参数',duration:9},uncopied:{prompt:'不读取'}},drafts:{a:{prompt:'draft-priority'}}},nodeEditor=productionNodeEditor(editorData,{a:{prompt:'draft-priority',duration:7}}),f=harness({graph,editorData,nodeEditor}),before=graphOf(f.state());f.probe.select(['g']);const snapshot=f.api.captureSelection();assert.equal(f.saves.length,0);assert.equal(snapshot.nodes[1].video,editorData.nodes.a.video);assert.equal(snapshot.nodes[1].historyVariantCount,1);assert.equal(snapshot.nodes[1].generation.prompt,'draft-priority');assert.equal(snapshot.nodes[1].generation.duration,7);assert.equal(snapshot.nodes[2].generation,undefined);assert.deepEqual(graphOf(f.state()),before);const pasted=once(f,()=>f.api.pasteGraph(snapshot,{x:30,y:40}));assert.equal(pasted.nodes[1].video,editorData.nodes.a.video);assert.equal(pasted.nodes[1].generationRun,undefined);assert.equal(pasted.nodes[1].loading,false);assert.equal(pasted.nodes[1].taskInfo,null);assert.equal(pasted.nodes[2].generation,undefined);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('paste and graph insertion persist once and undo removes the entire imported graph',()=>{
 const graph={nodes:[{id:'g',type:'group',x:1.25,y:2.75,width:900,height:500},{id:'child',type:'image',parentId:'g',x:50.5,y:90.125,width:100,height:200,image:'import.png'}],edges:[{id:'import-edge',source:'g',target:'child'}],selected:['g'],group:{id:'g'}};
 for(const operation of [f=>f.api.pasteGraph(graph,{x:0,y:0}),f=>f.api.insertGraph(graph)]){
  const f=harness(),before=graphOf(f.state());once(f,()=>operation(f));assert.equal(f.state().selected.length,1);assert.equal(f.state().nodes.find(n=>n.id===f.state().selected[0]).type,'group');once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
 }
});
test('asset insertion saves and renders only the fully populated image/video/text/audio node',()=>{
 const assets=[{type:'image',name:'Image asset',image:'thumb.png',fullImage:'full-asset.png'},{type:'video',name:'Video asset',image:'poster.png',nodeId:'legacy'},{type:'text',name:'Text asset',content:'真实正文',color:'#ff0000'},{type:'audio',name:'Audio asset',audio:'audio.mp3'}];
 for(const asset of assets){
  const f=harness(),before=graphOf(f.state()),n=once(f,()=>f.api.insertAsset(asset,{x:400.25,y:200.75}));
  assert.equal(f.renders.length,1);assert.equal(n.x,(400.25+100.125)/.7);assert.equal(n.y,(200.75-20.5)/.7);assert.deepEqual(f.state().selected,[n.id]);assert.equal(f.state().filter,'all');assert.equal(f.probe.history().length,1);
  const saved=f.saves[0].nodes.at(-1);assert.equal(saved.title,asset.name);assert.equal(saved.fullImage,asset.fullImage);
  if(asset.type==='video')assert.equal(saved.video,'legacy.mp4');
  if(asset.type==='text'){assert.equal(saved.content,'真实正文');assert.equal(saved.textMode,'pure');assert.equal(saved.color,'#ff0000');assert.equal(Object.hasOwn(saved,'generation'),false);}
  if(asset.type==='audio'){assert.equal(saved.audioMode,'upload');assert.equal(saved.audio,'audio.mp3');assert.equal(saved.width,300);assert.equal(saved.height,300);}
  once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
 }
});
test('addNode keeps default screen coordinates, selection and generated text configuration',()=>{
 const f=harness(),n=once(f,()=>f.api.addNode('text'));assert.equal(n.x,(600+100.125)/.7);assert.equal(n.y,(400-20.5)/.7);assert.equal(n.title,'Text');assert.equal(n.textMode,'generate');assert.equal(n.width,300);assert.equal(n.height,200);assert.equal(n.generation.model,'text-model');assert.deepEqual(f.state().selected,[n.id]);
});
test('pre-load edit preserves legacy write and wins hydration with one complete IndexedDB save',async()=>{
 for(const operation of [f=>f.api.updateNode('a',{title:'Early edit'}),f=>f.api.insertAsset({type:'text',content:'Early asset'}),f=>f.probe.rename(),f=>f.api.duplicate(),f=>f.probe.remove()]){
  const f=harness({ready:false});assert.equal(f.saves.length,0);assert.equal(f.legacy.length,0);operation(f);assert.equal(f.saves.length,0);assert.equal(f.legacy.length,1);const edited=graphOf(f.state());
  await f.load({version:1,...fixture()});assert.equal(f.saves.length,1);assert.deepEqual(graphOf(f.saves[0]),edited);assert.deepEqual(graphOf(f.state()),edited);assert.equal(f.state().graphLoaded,true);
 }
});
test('untouched hydration restores saved data without saving over it or creating history',async()=>{
 const f=harness({ready:false}),saved={version:1,...fixture()};saved.nodes[0].title='Loaded';await f.load(saved);assert.equal(f.saves.length,0);assert.equal(f.legacy.length,0);assert.equal(f.state().nodes[0].title,'Loaded');assert.equal(f.probe.history().length,0);
 once(f,()=>f.api.updateNode('a',{title:'After load'}));
});
test('reload hydration clears orphan generated tasks while retaining unrelated custom task markers',async()=>{
 const saved={version:1,...fixture()};saved.nodes[0].pendingOperation='image.generate';saved.nodes[0].generationRun={runId:'old-run',requestId:'old-request',resultIndex:0};saved.nodes[1].pendingOperation='image.remove-background';saved.nodes[1].generationRun={runId:'custom-task'};
 const f=harness({ready:false});await f.load(saved);const [generated,custom]=f.state().nodes;assert.equal(generated.pendingOperation,undefined);assert.equal(generated.generationRun,undefined);assert.equal(generated.image,'original.png');assert.equal(custom.pendingOperation,'image.remove-background');assert.deepEqual(custom.generationRun,{runId:'custom-task'});assert.equal(f.saves.length,0);assert.equal(f.probe.history().length,0);
});
test('async save errors remain handled and queued snapshot is not altered by later edits',async()=>{
 const f=harness();once(f,()=>f.api.updateNode('a',{title:'First'}));once(f,()=>f.api.updateNode('a',{title:'Second'}));assert.equal(f.saves[0].nodes[0].title,'First');assert.equal(f.saves[1].nodes[0].title,'Second');f.pending[1].reject(Error('disk full'));await Promise.resolve();await Promise.resolve();assert.deepEqual(f.errors,['storage']);f.pending[0].resolve();await Promise.resolve();assert.equal(f.notices.length,1,'older completion cannot clear a newer failure');
});

test('legacy mirror quota cannot block IndexedDB and only a successful latest save clears the failure',async()=>{
 const quota=Object.assign(Error('storage full'),{name:'QuotaExceededError'}),f=harness({mirrorError:quota});
 once(f,()=>f.api.duplicate());f.pending[0].reject(quota);await Promise.resolve();
 assert.equal(f.notices[0].dataset.errorName,'QuotaExceededError');assert.match(f.notices[0].textContent,/存储空间不足.*尚未保存/);
 once(f,()=>f.api.updateNode('a',{title:'Retry'}));assert.equal(f.notices.length,1);f.pending[1].resolve();await Promise.resolve();assert.equal(f.notices.length,0);assert.equal(f.legacy.length,0);
});

test('failed graph hydration keeps automatic writes blocked and preserves the last stored graph',async()=>{
 const f=harness({ready:false});await f.failLoad(Error('read denied'));
 assert.equal(f.state().graphLoaded,false);assert.equal(f.notices[0].dataset.operation,'load');assert.match(f.notices[0].textContent,/停止自动保存.*尚未保存/);
 f.api.updateNode('a',{title:'Unsaved edit'});assert.equal(f.saves.length,0);assert.equal(f.legacy.length,0);assert.equal(f.state().nodes[0].title,'Unsaved edit');assert.equal(f.notices.length,1);
});

test('invalid existing graph is never replaced by the seed graph on the next edit',async()=>{
 const f=harness({ready:false});await f.load({version:1,nodes:[{id:'stored',x:0}],edges:[]});
 assert.equal(f.state().graphLoaded,false);assert.equal(f.notices[0].dataset.operation,'load');f.api.duplicate();assert.equal(f.saves.length,0);assert.equal(f.legacy.length,0);
});

function pileFixture(){const graph=fixture();graph.nodes.push({id:'c',type:'image',image:'c.png',x:2000,y:1000,width:250,height:250},{id:'p',type:'pile',title:'Pile',memberIds:['b','c'],x:2000,y:1000,width:250,height:250});return graph;}
function finishGesture(f,{join=false,cancel=false}={}){
 const point=join?{x:2125*.7-100.125,y:1125*.7+20.5}:{x:0,y:0};
 f.probe.beginGesture('a',point);f.probe.finish({type:cancel?'pointercancel':'pointerup',clientX:point.x,clientY:point.y});
 assert.deepEqual(structuredClone(f.probe.gestureState()),{gesture:null,dragging:undefined,selectionHidden:true});
 assert.deepEqual(f.cleanup,['queue','drop','panning']);
}
test('production finish saves ordinary movement once and preserves exact undo coordinates',()=>{
 const f=harness({graph:pileFixture()}),before=graphOf(f.state());once(f,()=>finishGesture(f));
 const moved=f.state().nodes.find(node=>node.id==='a');assert.equal(moved.x,25.375);assert.equal(moved.y,-36.5);assert.equal(f.renders.length,1);assert.deepEqual(f.motion,[]);
 once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('production finish joining an existing pile saves once and keeps animation/render sequence',()=>{
 const f=harness({graph:pileFixture()}),before=graphOf(f.state());once(f,()=>finishGesture(f,{join:true}));
 assert.deepEqual(f.state().nodes.find(node=>node.id==='p').memberIds,['b','c','a']);assert.deepEqual(f.state().selected,['p']);assert.deepEqual(f.motion,['capture','play']);assert.equal(f.renders.length,2);
 once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('production finish cancellation over a pile saves movement once without joining it',()=>{
 const f=harness({graph:pileFixture()}),before=graphOf(f.state());once(f,()=>finishGesture(f,{join:true,cancel:true}));
 assert.deepEqual(f.state().nodes.find(node=>node.id==='p').memberIds,['b','c']);assert.deepEqual(f.state().selected,['a']);assert.deepEqual(f.motion,[]);assert.equal(f.renders.length,1);
 once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
test('production finish before load writes legacy once for move, pile join and cancellation',async()=>{
 for(const options of [{},{join:true},{join:true,cancel:true}]){
  const f=harness({ready:false,graph:pileFixture()});finishGesture(f,options);assert.equal(f.saves.length,0);assert.equal(f.legacy.length,1);const edited=graphOf(f.state());
  await f.load({version:1,...pileFixture()});assert.equal(f.saves.length,1);assert.deepEqual(graphOf(f.saves[0]),edited);
 }
});


test('production release over many full piles validates once, joins the first eligible pile and undoes exactly',()=>{
 const nodes=[{id:'a',type:'image',x:-500.125,y:-200.375,width:100,height:80}];
 for(let p=0;p<25;p++){
  const memberIds=[];
  for(let i=0;i<(p===24?49:50);i++){const id=`member-${p}-${i}`;memberIds.push(id);nodes.push({id,type:'image',x:0,y:0,width:100,height:80});}
  nodes.push({id:`pile-${p}`,type:'pile',x:.125,y:-.375,width:100,height:80,memberIds});
 }
 const f=harness({graph:{nodes,edges:[]}}),before=graphOf(f.state());
 const point={x:50*.7-100.125,y:30*.7+20.5};
 f.probe.beginGesture('a',point);once(f,()=>f.probe.finish({type:'pointerup',clientX:point.x,clientY:point.y}));
 assert.equal(f.pileCalls.dropTarget,1);assert.equal(f.pileCalls.plan,0);
 assert.deepEqual(f.state().selected,['pile-24']);assert.equal(f.state().nodes.find(n=>n.id==='pile-24').memberIds.at(-1),'a');
 assert.deepEqual(f.motion,['capture','play']);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
});
