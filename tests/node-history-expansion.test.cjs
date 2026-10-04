const test=require('node:test'),assert=require('node:assert/strict');
const model=import('../src/features/node-history-expansion/model.mjs');
const source={id:'source',type:'image',title:'原图',parentId:'existing',x:54015.125,y:-4155.375,width:446,height:250,image:'current.png',generation:{prompt:'next',model:'next-model',count:4},pendingOperation:'image.generate',generationRun:{runId:'running'},imageHistory:[
 {id:'first',prompt:'portrait batch',parameters:{model:'m1',count:2},toolParameters:{quality:'high'},options:[{id:'a',image:'portrait.png',width:180,height:320,sourceFileId:'file-a'},{id:'b',image:'square.png',width:200,height:200}]},
 {id:'second',prompt:'wide batch',parameters:{model:'m2',count:1},options:[{id:'c',image:'wide.png',width:1600,height:900}]}
]};
const ids=()=>{let next=0;return()=>`created-${++next}`;};
test('official history batches form separate padded rows with fractional source coordinates untouched',async()=>{
 const m=await model,before=structuredClone(source),graph=m.expandHistory(source,m.historyBatches(source),{id:ids()}),[group,a,b,c]=graph.nodes;
 assert.equal(group.x,source.x+source.width+200);assert.equal(group.y,source.y);
 assert.equal(a.x,group.x+80);assert.equal(a.y,group.y+80);assert.equal(b.x,a.x+a.width+56);assert.equal(b.y,a.y);
 assert.equal(c.x,a.x);assert.equal(c.y,a.y+Math.max(a.height,b.height)+72);
 assert.equal(group.width,80+a.width+56+b.width+80);assert.equal(group.height,80+a.height+72+c.height+80);
 assert.deepEqual(graph.edges,[]);assert.deepEqual(source,before);assert.ok(graph.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
});
test('each result preserves its batch settings, media identity and provenance without task/history duplication',async()=>{
 const m=await model,{nodes:[group,a,b,c]}=m.expandHistory(source,m.historyBatches(source),{id:ids()});
 assert.equal(a.generation.prompt,'portrait batch');assert.equal(a.generation.model,'m1');assert.equal(a.generation.count,2);assert.equal(c.generation.count,1);assert.deepEqual(a.params,{quality:'high'});
 assert.equal(a.currentImageOptionId,'a');assert.equal(a.currentSourceFileId,'file-a');assert.equal(a.provenance.mediaSource,'portrait.png');assert.equal(a.parentId,group.id);assert.equal(a.title,'原图 1-1');assert.equal(c.title,'原图 2-1');
 for(const child of [a,b,c]){assert.deepEqual(child.imageHistory,[]);assert.deepEqual(child.videoHistory,[]);assert.deepEqual(child.versions,[]);assert.equal(child.pendingOperation,undefined);assert.equal(child.generationRun,undefined);}
});
test('one real historical result expands while single-source legacy without history still rejects',async()=>{
 const m=await model,n={...source,imageHistory:[{id:'single',prompt:'only',options:[{image:'one.png',width:200,height:200}]}]};
 assert.equal(m.expandHistory(n,m.historyBatches(n),{id:ids()}).nodes.length,2);assert.equal(m.historyBatches({...source,imageHistory:[]}).length,0);
});
test('legacy image current plus alternatives uses one deduplicated row',async()=>{
 const m=await model,n={...source,imageHistory:[]},batches=m.historyBatches(n,[{image:'current.png'},{image:'alternative.png',pixelWidth:100,pixelHeight:200},{image:'alternative.png'}]);
 assert.equal(batches.length,1);assert.deepEqual(batches[0].options.map(o=>o.image),['current.png','alternative.png']);
});
test('video rows preserve source metadata, clips, posters and per-batch prompts',async()=>{
 const m=await model,n={...source,type:'video',video:'main.mp4',videoHistory:[{id:'one',prompt:'first',parameters:{count:2},options:[{id:'v1',video:'a.mp4',poster:'a.png',width:1920,height:1080,duration:8,clip:{start:1,end:3}}]},{id:'two',prompt:'second',options:[{video:'b.mp4',poster:'b.png',width:1080,height:1920,duration:4}]}]},graph=m.expandHistory(n,m.historyBatches(n),{id:ids()}),a=graph.nodes[1],b=graph.nodes[2];
 assert.equal(a.video,'a.mp4');assert.equal(a.image,'a.png');assert.equal(a.fullImage,null);assert.deepEqual(a.videoMetadata,{width:1920,height:1080,duration:8});assert.deepEqual(a.clip,{start:1,end:3});assert.equal(a.generation.prompt,'first');assert.equal(b.generation.prompt,'second');assert.equal(b.y,a.y+a.height+72);
 assert.deepEqual(m.historyBatches({...n,videoHistory:[],versions:[]},[{video:'a.mp4'},{video:'main.mp4'}])[0].options.map(o=>o.video),['main.mp4','a.mp4']);
});

async function fixture(){
 global.window={LocalAssets:{url:async ref=>'blob:'+ref}};
 const {applyNodeHistory}=await import('../src/features/node-history-expansion/runtime.mjs'),node=structuredClone(source);node.pendingOperation=undefined;node.imageHistory=[{id:'one',options:[{image:'asset:decode'}]}];
 const state={nodes:[node]},calls=[],app={getState:()=>state,projectIdentity:()=>({id:fixture.project}),insertGraph:graph=>{calls.push(graph);state.nodes.push(...graph.nodes);return graph.group;},fitNode:(id,options)=>calls.push({id,options})};fixture.project='canvas';
 return {applyNodeHistory,node,state,app,calls};
}
test('image decode commits one graph and fits viewport without mutating source or batch metadata',async()=>{
 const f=await fixture(),before=structuredClone(f.node);await f.applyNodeHistory(f.node,{app:f.app,decodeImage:async()=>({width:90,height:160})});
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].nodes.length,2);assert.deepEqual(f.calls[1],{id:f.calls[0].group.id,options:{padding:.2,duration:800}});assert.deepEqual(f.node,before);
});
for(const kind of ['source change','undo replacement','project change','decode failure'])test(`async ${kind} cannot insert stale or partial graph`,async()=>{
 const f=await fixture();let release;const wait=new Promise(resolve=>release=resolve),pending=f.applyNodeHistory(f.node,{app:f.app,decodeImage:async()=>{await wait;if(kind==='decode failure')throw Error('decode failed');return {width:90,height:160};}});
 await new Promise(resolve=>setImmediate(resolve));
 if(kind==='source change')f.node.title='changed';if(kind==='undo replacement')f.state.nodes=[structuredClone(f.node)];if(kind==='project change')fixture.project='other';release();
 await assert.rejects(pending,kind==='decode failure'?/decode failed/:/节点或项目已变化/);assert.equal(f.calls.length,0);
});
test('unknown original-site media cannot be decoded or fetched to expand history',async()=>{
 const f=await fixture();f.node.imageHistory[0].options[0].image='https://app.tapnow.media/private.png';let decoded=false;
 await assert.rejects(f.applyNodeHistory(f.node,{app:f.app,decodeImage:async()=>{decoded=true;return {width:100,height:100};}}),/待导入本地/);assert.equal(decoded,false);assert.equal(f.calls.length,0);
});
test('save failure retains the inserted graph and rejects before successful viewport navigation',async()=>{
 const f=await fixture();window.CanvasStore={flush:async()=>{throw Error('save failed');}};
 await assert.rejects(f.applyNodeHistory(f.node,{app:f.app,decodeImage:async()=>({width:100,height:100})}),/save failed/);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].nodes.length,2);assert.equal(f.node.imageHistory.length,1);
});
test('history outputs are fresh generation nodes and carry only their own source range',async()=>{
 const m=await model,n={...source,tool:'image-editor',editorDoc:{private:'source document'},agentImageEditor:{thread:'source'},sourceRange:{start:5,end:10},worldResource:{url:'source.glb'},studioId:'source-studio',audio:'source.wav'};
 const history=m.historyBatches(n);history[0].options[1].sourceRange={start:1,end:2};const {nodes:[,a,b]}=m.expandHistory(n,history,{id:ids()});
 for(const field of ['tool','editorDoc','agentImageEditor','worldResource','studioId','audio','sourceRange'])assert.equal(a[field],undefined);
 assert.deepEqual(b.sourceRange,{start:1,end:2});assert.equal(b.provenance.kind,'video-analysis');assert.deepEqual(n.editorDoc,{private:'source document'});
});
for(const kind of ['project changed','group undone','group replaced'])test(`save wait ${kind} blocks late fit`,async()=>{
 const f=await fixture();let release;const wait=new Promise(resolve=>release=resolve);window.CanvasStore={flush:()=>wait};
 const pending=f.applyNodeHistory(f.node,{app:f.app,decodeImage:async()=>({width:100,height:100})});await new Promise(resolve=>setImmediate(resolve));
 if(kind==='project changed')fixture.project='different';else if(kind==='group undone')f.state.nodes=[f.node];else f.state.nodes=f.state.nodes.map(node=>node===f.node?node:structuredClone(node));release();
 await assert.rejects(pending,/历史分组或项目已变化/);assert.equal(f.calls.length,1);
});
