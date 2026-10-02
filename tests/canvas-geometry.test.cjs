const test=require('node:test'),assert=require('node:assert/strict'),{toWorld,toScreen,placeOutputs}=require('../canvas-geometry.js');
test('world/screen conversion preserves fractional original coordinates through pan, zoom and panel offset',()=>{for(const scale of [.15,.22841067612171173,.7,2]){const view={x:-11821.75458177424,y:1093.1602809876204,scale},p={x:52824.27,y:-3329.019},origin={x:38,y:15};const screen=toScreen(p,view,origin),actual=toWorld(screen,view,origin);assert.ok(Math.abs(actual.x-p.x)<1e-8);assert.ok(Math.abs(actual.y-p.y)<1e-8);}});
test('repeated output batches avoid overlap with different image aspect ratios',()=>{const source={id:'s',x:53000,y:-1300,width:446,height:250},existing=[source];for(let j=0;j<4;j++){const out=placeOutputs(source,[{width:2000,height:2000},{width:2000,height:1000}],existing);for(const a of out){for(const b of existing)assert.ok(a.x+a.width<=b.x||a.x>=b.x+b.width||a.y+a.height<=b.y||a.y>=b.y+b.height);existing.push(a);}}assert.equal(existing[0].x,53000);});
test('connection direction and short/backward curves preserve fractional anchors',async()=>{
 const {bezier,direction}=await import('../src/features/canvas-connections/geometry.mjs');
 assert.deepEqual(direction('input','output','left'),{source:'output',target:'input'});
 assert.deepEqual(direction('output','input','right'),{source:'output',target:'input'});
 assert.equal(bezier({x:53284.3,y:-2180.48},{x:53324.3,y:-1900.8}),'M53284.3,-2180.48 C53304.3,-2180.48 53304.3,-1900.8 53324.3,-1900.8');
 assert.equal(bezier({x:100.25,y:20.5},{x:.25,y:80.75}),'M100.25,20.5 C162.75,20.5 -62.25,80.75 0.25,80.75');
});
test('connections reject duplicates, pure-text inputs, incompatible media and audio reference mixing',async()=>{
 const {validateConnection,supportsVideoInputs}=await import('../src/features/canvas-connections/geometry.mjs');
 const audio=require('../audio-core.js'),nodes=[{id:'i',type:'image'},{id:'i2',type:'image'},{id:'t',type:'text',textMode:'pure'},{id:'a',type:'audio',audioConfig:{model:'doubao-seed-audio-1-0'}},{id:'v',type:'video'}];
 assert.equal(validateConnection(nodes,[], 'i','i2'),null);
 assert.match(validateConnection(nodes,[{source:'i',target:'i2'}],'i','i2'),/已经连接/);
 assert.match(validateConnection(nodes,[],'i','t'),/纯文本/);
 assert.match(validateConnection(nodes,[],'a','i'),/不能互相连接/);
 assert.equal(validateConnection(nodes,[],'i','a',audio.specs),null);
 assert.match(validateConnection(nodes,[{source:'i',target:'a'}],'i2','a',audio.specs),/上限/);
 assert.match(validateConnection([...nodes,{id:'a2',type:'audio'}],[{source:'i',target:'a'}],'a2','a',audio.specs),/不能混用/);
 assert.equal(supportsVideoInputs({audio:1}),true);
 assert.equal(supportsVideoInputs({image:999,video:999,audio:999}),false);
});
test('connection menu flips at viewport edge without changing its anchor',async()=>{
 const {menuPosition}=await import('../src/features/canvas-connections/geometry.mjs');const anchor={x:1270.125,y:700.75};
 const actual=menuPosition(anchor,{width:288,height:382},{width:1280,height:720});
 assert.equal(actual.left,980);assert.equal(actual.top,318.75);assert.equal(actual.transformOrigin,'288px 382px');assert.deepEqual(anchor,{x:1270.125,y:700.75});
});
test('multi-source connections preserve fractional group coordinates and order inputs by type',async()=>{
 const {selectionInputs,selectionBounds,selectionMenuAnchor}=await import('../src/features/canvas-connections/selection-model.mjs');
 const nodes=[{id:'i',type:'image',parentId:'g',x:53284.3,y:-2180.48,width:435,height:250},{id:'t',type:'text',x:53800.25,y:-1800.8,width:435,height:250}];
 assert.deepEqual(selectionInputs('image',nodes),['t','i']);
 assert.deepEqual(selectionBounds(nodes),{right:54235.25,centerY:-1865.6399999999999});
 assert.deepEqual(selectionMenuAnchor({x:1200.75,y:800.25},{width:1280,height:720}),{x:1139,y:395});
 assert.throws(()=>selectionInputs('imageEditor',nodes),/不支持/);
 assert.deepEqual(selectionInputs('imageEditor',nodes.map(n=>({...n,type:'image'}))),['i','t']);
 assert.throws(()=>selectionInputs('text',[...nodes,{id:'a',type:'audio'}]),/不支持/);
});
test('multi-source video uses incomplete current-model matching and complete fallback matching',async()=>{
 const {videoSelectionConfig,selectionInputs}=await import('../src/features/canvas-connections/selection-model.mjs');
 const nodes=[{id:'t',type:'text'},{id:'a',type:'audio'}];
 assert.deepEqual(selectionInputs('video',nodes),['t','a']);
 const current=videoSelectionConfig({model:'Seedance 2.0'},nodes);
 assert.equal(current.model,'Seedance 2.0');assert.equal(current.modelType,'REFERENCE_TO_VIDEO');
 const images=Array.from({length:3},(_,i)=>({id:String(i),type:'image'}));
 const fallback=videoSelectionConfig({model:'unknown-model'},images);
 assert.equal(fallback.model,'Seedance 2.0');assert.equal(fallback.modelType,'REFERENCE_TO_VIDEO');
 assert.equal(fallback.ratio,'16:9');assert.equal(fallback.quality,'720p');
 assert.throws(()=>selectionInputs('video',Array.from({length:100},(_,i)=>({id:String(i),type:'video'}))),/不支持/);
});

function connectionDocument(t){
 const previousDocument=global.document,previousWindow=global.window,counts={attributes:0,reads:0,appends:0,styles:0};
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.attrs=new Map();this.style={setProperty:(key,value)=>{counts.styles++;this.style[key]=value;}};this.classList={add(){}};this.dataset={};}
  setAttribute(key,value){counts.attributes++;this.attrs.set(key,String(value));}
  getAttribute(key){counts.reads++;return this.attrs.get(key)??null;}
  append(...children){for(const child of children){child.remove();child.parentNode=this;this.children.push(child);counts.appends++;}}
  remove(){if(this.parentNode){const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
  replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children);}
  addEventListener(){}
  get isConnected(){return !!this.root||!!this.parentNode?.isConnected;}
  get lastChild(){return this.children.at(-1);}
  get childElementCount(){return this.children.length;}
 }
 global.document={createElementNS:(_,tag)=>new Element(tag),createElement:tag=>new Element(tag),addEventListener(){}};global.window={addEventListener(){}};
 t.after(()=>{global.document=previousDocument;global.window=previousWindow;});
 return {Element,counts};
}
test('viewport-only connections skip graph and DOM work but invalidate geometry, selection and ownership on real edits',async t=>{
 const {Element,counts}=connectionDocument(t),{createLayer}=await import('../src/features/canvas-connections/layer.mjs'),{bezier}=await import('../src/features/canvas-connections/geometry.mjs');
 const root=new Element('svg');root.root=true;const selected=new Set(),layer=createLayer(root,selected);
 const a={id:'a',title:'A',x:12.125,y:9.5,width:100,height:80},b={id:'b',title:'B',x:300.25,y:20.75,width:100,height:60};
 let reads=0;const edges=Array.from({length:128},(_,index)=>({id:'edge-'+index,get source(){reads++;return 'a';},target:'b'})),byId=new Map([['a',a],['b',b]]),piles={owner:new Map()};
 const state={edges,selected:[],view:{x:0,y:0,scale:.7}},pathFor=(edge,map,owners)=>{const source=map.get(owners.owner.get(edge.source)||edge.source),target=map.get(edge.target);return bezier({x:source.x+source.width,y:source.y+source.height/2},{x:target.x,y:target.y+target.height/2});};
 layer.render(state,byId,piles,pathFor);const group=root.children[0],line=group.children[0],firstPath=line.getAttribute('d');
 reads=0;Object.keys(counts).forEach(key=>counts[key]=0);
 for(let index=0;index<100;index++)layer.render({...state,viewportOnly:true,view:{x:index*.125,y:-index*.25,scale:.7}},byId,piles,pathFor);
 assert.equal(reads,0);assert.deepEqual(counts,{attributes:0,reads:0,appends:0,styles:0});
 layer.render({...state,viewportOnly:true,view:{...state.view,scale:1.1}},byId,piles,pathFor);assert.equal(counts.styles,1);assert.equal(reads,0);
 // The same objects/arrays may change in place: a full render must still inspect them.
 a.x+=.125;layer.render(state,byId,piles,pathFor);assert.notEqual(line.getAttribute('d'),firstPath);assert.ok(line.getAttribute('d').startsWith('M112.25,'));
 state.selected=['a'];layer.render({...state,viewportOnly:true},byId,piles,pathFor);assert.equal(group.getAttribute('data-endpoint-selected'),'true');
 selected.add('edge-0');layer.render({...state,viewportOnly:true},byId,piles,pathFor);assert.equal(group.getAttribute('aria-selected'),'true');
 const pile={id:'pile',x:700.875,y:30.5,width:200,height:140};byId.set('pile',pile);piles.owner.set('a','pile');layer.render(state,byId,piles,pathFor);assert.ok(line.getAttribute('d').startsWith('M900.875,100.5'));
 const nextMap=new Map(byId);nextMap.set('b',{...b,title:'renamed',x:410.625});layer.render({...state,viewportOnly:true},nextMap,piles,pathFor);assert.match(group.getAttribute('aria-label'),/renamed/);assert.match(line.getAttribute('d'),/410.625,50.75$/);
 layer.drawPreview('b','right',{x:510.875,y:80.25});const preview=root.lastChild;assert.equal(preview.getAttribute('class'),'connection-preview');layer.render({...state,viewportOnly:true},nextMap,piles,pathFor);assert.equal(root.lastChild,preview);
 state.edges=edges.slice(1);layer.render(state,nextMap,piles,pathFor);assert.equal(group.parentNode,null);assert.equal(selected.has('edge-0'),false);
});
test('viewport-only multi-selection reuses world bounds while its screen anchor follows pan and zoom',async t=>{
 const {Element}=connectionDocument(t),{installSelection}=await import('../src/features/canvas-connections/selection.mjs');
 const canvas=new Element('div'),app={getState:()=>state};let lookups=0;
 const nodes=[{id:'a',type:'image',x:12.125,y:5.25,width:100,height:80},{id:'b',type:'image',x:300.875,y:10.5,width:100,height:60}];
 class Layout extends Map{get(id){lookups++;return super.get(id);}}
 const map=new Layout(nodes.map(node=>[node.id,node])),state={nodes,selected:['a','b'],view:{x:0,y:0,scale:1}},selection=installSelection(app,canvas,()=>{}),handle=canvas.children[2];
 selection.render(state,map);assert.equal(handle.hidden,false);const top=handle.style.top;
 lookups=0;selection.render({...state,viewportOnly:true,view:{x:32.75,y:-8.125,scale:.5}},map);assert.equal(lookups,0);assert.equal(handle.style.left,'245.1875px');assert.notEqual(handle.style.top,top);
 nodes[1].x+=.125;selection.render(state,map);assert.equal(handle.style.left,'413px');
 selection.render({...state,viewportOnly:true,selected:['a']},map);assert.equal(handle.hidden,true);
});

test('full connection renders reuse static edge state and update only incident paths during fractional movement',async t=>{
 const {Element,counts}=connectionDocument(t),{createLayer}=await import('../src/features/canvas-connections/layer.mjs');
 let reads=0,pathCalls=0;class CountMap extends Map{get(key){reads++;return super.get(key);}}
 const nodes=Array.from({length:100},(_,i)=>({id:'n'+i,title:'节点'+i,x:i*600+.125,y:99.375,width:435.25,height:250.125})),byId=new CountMap(nodes.map(n=>[n.id,n])),edges=nodes.map((n,i)=>({id:'e'+i,source:n.id,target:nodes[(i+1)%nodes.length].id}));
 const state={edges,selected:[],view:{x:0,y:0,scale:.7}},piles={owner:new Map()},root=new Element('svg');root.root=true;
 const layer=createLayer(root,new Set()),pathFor=(edge,map)=>{pathCalls++;return `${map.get(edge.source).x}:${map.get(edge.target).x}`;};layer.render(state,byId,piles,pathFor);
 const identities=root.children.slice();reads=pathCalls=0;Object.keys(counts).forEach(key=>counts[key]=0);
 layer.render(state,new CountMap(byId),piles,pathFor);
 assert.equal(reads,200,'one lookup per resolved endpoint');assert.equal(pathCalls,0);assert.equal(counts.attributes,0);assert.deepEqual(root.children,identities);
 nodes[50].x+=.125;reads=pathCalls=0;layer.render(state,new CountMap(byId),piles,pathFor);
 assert.equal(pathCalls,2);assert.equal(reads,204);assert.equal(counts.attributes,4,'two incident paths, each visible and hit target');
 assert.equal(identities[50].children[0].getAttribute('d'),`${nodes[50].x}:${nodes[51].x}`);
});

test('connection content cache invalidates labels, ownership, animation, selection and missing endpoints',async t=>{
 const {Element,counts}=connectionDocument(t),{createLayer}=await import('../src/features/canvas-connections/layer.mjs');
 const a={id:'a',title:'原图',x:1.125,y:2.375,width:100,height:80},b={id:'b',title:'视频',x:300,y:90,width:200,height:120},pile={id:'pile',title:'堆叠',x:-200000.25,y:180000.75,width:300,height:250};
 const byId=new Map([['a',a],['b',b],['pile',pile]]),piles={owner:new Map()},edge={id:'ab',source:'a',target:'b',animated:true},state={edges:[edge],selected:['a'],view:{scale:.7}},selected=new Set(),root=new Element('svg');root.root=true;
 const pathFor=(edge,map,piles)=>{const a=map.get(piles.owner.get(edge.source)||edge.source),b=map.get(piles.owner.get(edge.target)||edge.target);return a&&b?`${a.x},${a.y}:${b.x},${b.y}`:'';},layer=createLayer(root,selected);
 layer.render(state,byId,piles,pathFor);const group=root.children[0],flow=group.children[3],gradient=group.children[2].children[0];assert.equal(group.children.length,4);
 counts.attributes=0;layer.render(state,byId,piles,pathFor);assert.equal(counts.attributes,0);assert.equal(group.children[3],flow);
 a.title='改名';layer.render(state,byId,piles,pathFor);assert.equal(group.getAttribute('aria-label'),'连线：改名 → 视频');assert.equal(group.children[3],flow);
 a.x+=.125;layer.render(state,byId,piles,pathFor);assert.equal(gradient.getAttribute('x1'),String(a.x+a.width));
 piles.owner.set('a','pile');layer.render(state,byId,piles,pathFor);assert.equal(gradient.getAttribute('x1'),String(pile.x+pile.width));assert.equal(group.getAttribute('aria-label'),'连线：改名 → 视频');
 selected.add('ab');layer.render(state,byId,piles,pathFor);assert.equal(group.getAttribute('aria-selected'),'true');
 edge.animated=false;layer.render(state,byId,piles,pathFor);assert.equal(group.children.length,2);
 edge.animated=true;state.selected=[];layer.render(state,byId,piles,pathFor);assert.equal(group.children.length,2);
 state.selected=['pile'];layer.render(state,byId,piles,pathFor);assert.equal(group.children.length,4);
 byId.delete('b');layer.render(state,byId,piles,pathFor);assert.equal(group.style.display,'none');
 byId.set('b',b);layer.render(state,byId,piles,pathFor);assert.equal(group.style.display,'');
 state.edges=[];layer.render(state,byId,piles,pathFor);assert.equal(root.children.length,0);assert.equal(selected.size,0);
});
