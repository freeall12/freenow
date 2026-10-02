const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const fixture=()=>({nodes:[{id:'a',type:'image',title:'Original',image:'original.png',fullImage:'full.png',x:10.25,y:-30.75,width:446,height:250,generation:{prompt:'原提示词',count:2},imageHistory:[{id:'old',options:[{image:'previous.png'}]}]},{id:'b',type:'image',title:'Reference',image:'reference.png',x:900.5,y:40.125,width:250,height:250}],edges:[{id:'e',source:'b',target:'a',order:2,purpose:'generation-input'}]});
function named(name){const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start,`production function ${name}`);return source.slice(start,end);}
function method(name,next){const start=source.indexOf(`    ${name}(`),end=source.indexOf(`\n    ${next}`,start+1);assert.ok(start>=0&&end>start,`production method ${name}`);return source.slice(start,end).trim().replace(/,$/,'');}
function harness({ready=true,graph=fixture(),mirrorError}={}){
 const saves=[],legacy=[],renders=[],errors=[],pending=[],motion=[],cleanup=[],pileCalls={plan:0,dropTarget:0};let serial=0,load;
 const pileCore=require('../canvas-piles.js'),piles={...pileCore,plan(...args){pileCalls.plan++;return pileCore.plan(...args);},dropTarget(...args){pileCalls.dropTarget++;return pileCore.dropTarget(...args);}};
 const root={children:[],get firstElementChild(){return this.children[0]||null;},insertBefore(el,before){this.children=this.children.filter(item=>item!==el);const index=before?this.children.indexOf(before):-1;if(index<0)this.children.push(el);else this.children.splice(index,0,el);}};
 let rejectLoad;
 const store={load:()=>new Promise((resolve,reject)=>{load=resolve;rejectLoad=reject;}),save:state=>{saves.push(structuredClone(state));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 const notices=[];
 const context=vm.createContext({fixture:graph,ready,root,renders,errors,cleanup,structuredClone,crypto:{randomUUID:()=>`new-${++serial}`},innerWidth:1200,innerHeight:800,prompt:()=> 'Renamed',localStorage:{setItem:(key,value)=>{if(mirrorError)throw mirrorError;legacy.push({key,value});}},document:{createElement:()=>({dataset:{},setAttribute(){},remove(){notices.splice(notices.indexOf(this),1);}}),body:{append:notice=>notices.push(notice)}},getNotice:()=>notices[0],window:{CanvasStore:store,CanvasGroups:require('../canvas-groups.js'),CanvasPiles:piles,CanvasText:{config:()=>({prompt:'',model:'text-model'})},CanvasClipboard:{instantiate:snapshot=>structuredClone(snapshot)},CanvasConnections:{cancel(){},clearSelection(){}},CanvasPilesUI:{clearDropTarget:()=>cleanup.push('drop')},PileMotion:{cancel(){},capture(nodes){motion.push('capture');return structuredClone(nodes);},play(){motion.push('play');}},EDITOR_DATA:{nodes:{legacy:{video:'legacy.mp4'}}}}});
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
 globalThis.api={${[method('pasteGraph','stack('),method('updateNode','insertGraph('),method('insertGraph','insertAsset('),method('insertAsset','addTypedNode(')].join(',\n')},undo,duplicate,addNode};
 globalThis.probe={state:()=>clone({nodes,edges,selected:[...selected],filter,localChanges,graphLoaded}),rename:()=>rename(nodes[0]),remove:removeSelected,history:()=>clone(history),select:ids=>selected=new Set(ids),rebuild};
 probe.rebuild();
 `,context,{filename:'app-persistence-production-extract.js'});
 const finish=source.slice(source.indexOf('  const finish=e=>'),source.indexOf("\n  canvas.addEventListener('pointerup',finish)"));
 vm.runInContext(`
 let gesture=null,suppressContext=false;
 const canvas={dataset:{},classList:{remove:()=>cleanup.push('panning')}};
 const gestureQueue={clear:()=>cleanup.push('queue')},flushRender=()=>{},moveGesture=()=>cleanup.push('move');
 ${finish}
 probe.beginGesture=(id,point)=>{remember();selected=new Set([id]);const node=nodes.find(item=>item.id===id);gesture={mode:'node',saved:true,positions:[{id,x:node.x,y:node.y}],x:0,y:0,lastX:point.x,lastY:point.y};node.x+=15.125;node.y-=5.75;canvas.dataset.connectionsDragging='true';};
 probe.finish=finish;
 probe.gestureState=()=>clone({gesture,dragging:canvas.dataset.connectionsDragging,selectionHidden:root.hidden});
 `,context,{filename:'app-finish-production-extract.js'});
 const hydration=source.slice(source.indexOf('  window.CanvasStore.load().then'),source.lastIndexOf('\n})();')).trim();
 vm.runInContext(`globalThis.hydration=${hydration}`,context);
 saves.length=legacy.length=renders.length=pending.length=0;
 return {api:context.api,probe:context.probe,pileCalls,saves,legacy,renders,errors,pending,motion,cleanup,notices,load:async value=>{load(value);await context.hydration;},failLoad:async error=>{rejectLoad(error);await context.hydration;},state:()=>structuredClone(context.probe.state())};
}
const graphOf=state=>({nodes:state.nodes,edges:state.edges});
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
test('paste and graph insertion persist once and undo removes the entire imported graph',()=>{
 const graph={nodes:[{id:'g',type:'group',x:1.25,y:2.75,width:900,height:500},{id:'child',type:'image',parentId:'g',x:50.5,y:90.125,width:100,height:200,image:'import.png'}],edges:[{id:'import-edge',source:'g',target:'child'}],selected:['g'],group:{id:'g'}};
 for(const operation of [f=>f.api.pasteGraph(graph,{x:0,y:0}),f=>f.api.insertGraph(graph)]){
  const f=harness(),before=graphOf(f.state());once(f,()=>operation(f));assert.deepEqual(f.state().selected,['g']);once(f,()=>f.api.undo());assert.deepEqual(graphOf(f.state()),before);
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
