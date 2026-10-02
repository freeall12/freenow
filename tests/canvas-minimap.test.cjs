const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const entry=pathToFileURL(path.resolve(__dirname,'../src/features/canvas-minimap/entry.mjs')).href;
const geometryUrl=pathToFileURL(path.resolve(__dirname,'../src/features/canvas-minimap/geometry.mjs')).href;

function fixture(count=2000){
  const writes={nodes:0,container:0,attributeReads:0,structure:0},work={nodeReads:0,layoutReads:0,pileBuilds:0,membershipReads:0},handlers=new Map();let resize;
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.classes=new Set();this.hidden=false;this.clientWidth=198;this.clientHeight=148;this.clientLeft=this.clientTop=1;
      const changed=()=>{writes[this.dataset.nodeId?'nodes':'container']++;};
      this.style=new Proxy({setProperty:(key,value)=>{changed();this.style[key]=value;}},{set:(target,key,value)=>{changed();target[key]=value;return true;}});
      this.classList={add:value=>{if(!this.classes.has(value)){this.classes.add(value);changed();}},toggle:(value,on)=>{if(this.classes.has(value)!==on){on?this.classes.add(value):this.classes.delete(value);changed();}}};
    }
    setAttribute(key,value){writes[this.dataset.nodeId?'nodes':'container']++;this.attributes.set(key,String(value));}
    getAttribute(key){writes.attributeReads++;return this.attributes.get(key)??null;}
    append(...children){writes.structure++;for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
    insertBefore(child,before){writes.structure++;child.remove();child.parent=this;this.children.splice(before?this.children.indexOf(before):this.children.length,0,child);}
    replaceChildren(...children){writes.structure++;for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
    remove(){if(!this.parent)return;writes.structure++;this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
    get firstElementChild(){return this.children[0]||null;}
    get nextElementSibling(){return this.parent?.children[this.parent.children.indexOf(this)+1]||null;}
    addEventListener(type,run){handlers.set(this.tagName+':'+type,run);}
    hasPointerCapture(){return false;}
    releasePointerCapture(){}
  }
  const root=new Element('aside'),canvas=new Element('canvas'),toggle=new Element('button');canvas.clientWidth=1280;canvas.clientHeight=720;
  global.document={head:new Element('head'),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),querySelector:selector=>({'#minimap':root,'#canvas':canvas,'#toggle-map':toggle}[selector])};
  const owners=new Map(),piles={owner:{has(id){work.membershipReads++;return owners.has(id);}}},layouts=new Map();
  global.window={NodeEditor:{layoutFor:n=>{work.layoutReads++;return layouts.get(n.id);}},CanvasPiles:{index:()=>{work.pileBuilds++;return piles;}},addEventListener(type,run){handlers.set('window:'+type,run);}};global.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){}};global.cancelAnimationFrame=()=>{};
  const nodes=new Proxy(Array.from({length:count},(_,i)=>({id:'n'+i,type:'image',x:-100123.456+(i%50)*700.125,y:-80000.125+Math.floor(i/50)*500.375,width:435.25,height:250.125})),{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))work.nodeReads++;return Reflect.get(target,key,receiver);}});
  const state={nodes,selected:[],view:{x:40500,y:32220,scale:.4}};const app={getState:()=>state,setView:view=>{state.view={...view};}};
  return{state,app,root,canvas,toggle,writes,work,piles,owners,layouts,handlers,resize:(width,height)=>resize([{contentRect:{width,height}}]),reset(){for(const key in writes)writes[key]=0;for(const key in work)work[key]=0;},layer:()=>root.children[0].children[0]};
}
function transformed(record,matrix){const values=matrix.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);return{x:Number(record.getAttribute('x'))*values[0]+values[4],y:Number(record.getAttribute('y'))*values[3]+values[5],width:Number(record.getAttribute('width'))*values[0],height:Number(record.getAttribute('height'))*values[3]};}

test('minimap pan/zoom never rewrites node attributes and preserves fractional projection',async()=>{
  const {install}=await import(entry),{geometry,project}=await import(geometryUrl),f=fixture(),map=install(f.app),identities=f.layer().children.slice();f.reset();f.state.viewportOnly=true;
  for(const key of ['clientWidth','clientHeight'])Object.defineProperty(f.canvas,key,{get(){throw Error('viewport-only update forced a layout read');}});
  for(let i=0;i<180;i++){f.state.view.x=40500+i*1750.125;f.state.view.y=32220-i*1200.375;f.state.view.scale=.15+i*.0025;map.update(f.state);}
  assert.equal(f.writes.nodes,0);assert.equal(f.writes.attributeReads,0);assert(f.writes.container<=180*8);assert.deepEqual(f.layer().children,identities);
  const expectedMap=geometry(f.state.nodes,f.state.view,{width:1280,height:720});
  for(let i=0;i<f.state.nodes.length;i++){const actual=transformed(identities[i],f.layer().getAttribute('transform')),expected=project(f.state.nodes[i],expectedMap);for(const key in actual)assert(Math.abs(actual[key]-expected[key])<1e-9,`${i} ${key}`);}
  map.destroy();
});

test('minimap reflects node edits, order, group color and hidden/removed membership',async()=>{
  const {install}=await import(entry),f=fixture(4),map=install(f.app);const a=f.state.nodes[0],b=f.state.nodes[1];
  const group={id:'group',type:'group',x:a.x-20,y:a.y-20,width:1500,height:350,groupColor:'#e7b870cc'};a.parentId=b.parentId=group.id;f.state.nodes.unshift(group);f.state.selected=[group.id];map.update(f.state);
  assert.equal(f.layer().children[0].dataset.nodeId,'group');assert.equal(f.layer().children[1].getAttribute('fill'),'#e7b870cc');
  f.state.nodes.shift();map.update(f.state);assert.equal(f.layer().children[0].getAttribute('fill'),'rgba(90,90,99,0.5)');
  a.x-=100000.123;a.y-=50000.456;b.hidden=true;map.update(f.state);assert.equal(f.layer().children.length,3);
  const {geometry,project}=await import(geometryUrl),expected=project(a,geometry(f.state.nodes.filter(n=>!n.hidden),f.state.view,{width:1280,height:720})),actual=transformed(f.layer().children[0],f.layer().getAttribute('transform'));assert(Math.abs(actual.x-expected.x)<1e-9);assert(Math.abs(actual.y-expected.y)<1e-9);
  f.state.nodes=[];map.update(f.state);assert.equal(f.layer().children.length,0);assert(!f.layer().getAttribute('transform').includes('NaN'));map.destroy();
});

test('minimap moving one interior node updates only its mark while retaining exact projection',async()=>{
  const {install}=await import(entry),{geometry,project}=await import(geometryUrl),f=fixture(),map=install(f.app),identities=f.layer().children.slice(),moving=f.state.nodes[1025];f.reset();
  for(let i=0;i<180;i++){moving.x+=.125;moving.y-=.375;map.update(f.state);}
  assert.equal(f.writes.attributeReads,0);
  assert.equal(f.writes.nodes,360,'only the moving mark x and y change');
  assert.deepEqual(f.layer().children,identities);
  const expectedMap=geometry(f.state.nodes,f.state.view,{width:1280,height:720});
  for(let i=0;i<f.state.nodes.length;i++){const actual=transformed(identities[i],f.layer().getAttribute('transform')),expected=project(f.state.nodes[i],expectedMap);for(const key in actual)assert(Math.abs(actual[key]-expected[key])<1e-9,`${i} ${key}`);}
  map.destroy();
});

test('minimap stable projection handles changed bounds, extreme relocation, removal and empty-to-nonempty',async()=>{
  const {install}=await import(entry),{geometry,project}=await import(geometryUrl),f=fixture(5),map=install(f.app);
  function verify(){const expectedMap=geometry(f.state.nodes.filter(n=>!n.hidden),f.state.view,{width:1280,height:720});for(const mark of f.layer().children){const node=f.state.nodes.find(n=>n.id===mark.dataset.nodeId),actual=transformed(mark,f.layer().getAttribute('transform')),expected=project(node,expectedMap);for(const key in actual)assert(Math.abs(actual[key]-expected[key])<1e-8,`${node.id} ${key}`);}}
  const moving=f.state.nodes[0];moving.x=-260123.456;moving.y=-180987.654;f.reset();map.update(f.state);
  assert.equal(f.writes.nodes,2,'bounds changes move static marks through the parent transform');assert.equal(f.writes.attributeReads,0);verify();
  moving.x=-1e12-.125;moving.y=1e12+.375;map.update(f.state);verify();
  for(const mark of f.layer().children)for(const key of ['x','y','width','height'])assert(Math.abs(Number(mark.getAttribute(key)))<1000,'extreme relocation rebases SVG-local coordinates');
  f.state.nodes.shift();map.update(f.state);verify();
  f.state.nodes=[];map.update(f.state);assert.equal(f.layer().children.length,0);
  f.state.nodes=[{id:'readded',type:'image',x:800123.456,y:-999987.654,width:435.25,height:250.125}];map.update(f.state);verify();assert.equal(f.layer().children.length,1);
  map.destroy();
});

test('closed minimap skips all graph traversal and DOM work, including resize and blur refresh',async()=>{
  const {install}=await import(entry),{geometry,project}=await import(geometryUrl),f=fixture(),map=install(f.app),moving=f.state.nodes[1000];
  f.toggle.onclick();assert.equal(f.root.hidden,true);f.state.viewportOnly=true;f.reset();
  for(let i=0;i<180;i++){moving.x+=.125;f.state.view.x+=750.125;f.state.view.scale=.3+i*.001;f.state.viewportOnly=i%2===0;map.update(f.state);}
  f.resize(1170,650);f.handlers.get('window:blur')();
  assert.deepEqual(f.work,{nodeReads:0,layoutReads:0,pileBuilds:0,membershipReads:0});
  assert.deepEqual(f.writes,{nodes:0,container:0,attributeReads:0,structure:0});
  f.toggle.onclick();assert.equal(f.root.hidden,false);
  assert.equal(f.work.nodeReads,4000,'one current-layout pass plus one graph pass after reopening');
  assert.equal(f.work.layoutReads,2000);assert.equal(f.work.pileBuilds,1);assert.equal(f.work.membershipReads,2000);
  const expectedMap=geometry(f.state.nodes,f.state.view,{width:1170,height:650}),expected=project(moving,expectedMap),actual=transformed(f.layer().children[1000],f.layer().getAttribute('transform'));
  for(const key in actual)assert(Math.abs(actual[key]-expected[key])<1e-9,key);
  map.destroy();
});

test('manual reopening rebuilds latest in-place edits, deletion, hidden state, pile ownership and selection',async()=>{
  const {install}=await import(entry),{geometry,project}=await import(geometryUrl),f=fixture(6),map=install(f.app),[a,b,c,d,e]=f.state.nodes;
  a.type='group';a.groupColor='#edaa66';b.parentId=a.id;f.state.selected=[a.id];map.update(f.state,undefined,f.piles);
  f.toggle.onclick();f.state.viewportOnly=true;
  a.x-=32000.125;a.groupColor='#66bbee';b.y+=700.375;f.owners.set(c.id,'pile');map.update(f.state,undefined,f.piles);
  f.state.nodes.splice(3,1);e.hidden=true;f.state.selected=[];map.update(f.state,undefined,f.piles);
  a.width+=250.5;b.x+=3100.75;f.layouts.set(b.id,{height:420.875});map.update(f.state,undefined,f.piles);
  f.reset();f.toggle.onclick();
  assert.equal(f.root.hidden,false);assert(f.work.nodeReads>=f.state.nodes.length);
  assert.deepEqual(f.layer().children.map(mark=>mark.dataset.nodeId),[a.id,b.id,'n5']);
  assert.equal(f.layer().children[0].getAttribute('fill'),'#66bbee');
  assert.equal(f.layer().children[1].getAttribute('fill'),'rgba(90,90,99,0.5)');
  for(const mark of f.layer().children)assert.equal(mark.classes.has('minimap-node-highlight'),false);
  const visible=f.state.nodes.filter(n=>!n.hidden&&!f.owners.has(n.id)).map(n=>({...n,...f.layouts.get(n.id)})),expectedMap=geometry(visible,f.state.view,{width:1280,height:720});
  for(const mark of f.layer().children){const node=visible.find(n=>n.id===mark.dataset.nodeId),actual=transformed(mark,f.layer().getAttribute('transform')),expected=project(node,expectedMap);for(const key in actual)assert(Math.abs(actual[key]-expected[key])<1e-9,key);}
  map.destroy();
});

test('changed nonempty selection automatically opens and invalidates identical viewport-only graph inputs',async()=>{
  const {install}=await import(entry),f=fixture(4),map=install(f.app),[a,b,c]=f.state.nodes,displayed=new Map(f.state.nodes.map(n=>[n.id,n]));
  a.type='group';a.groupColor='#aabbcc';b.parentId=a.id;map.update(f.state,displayed,f.piles);f.toggle.onclick();f.state.viewportOnly=true;
  a.x-=50000.125;b.y+=123.5;map.update(f.state,displayed,f.piles);
  f.state.nodes.splice(2,1);f.owners.set('n3','pile');map.update(f.state,displayed,f.piles);
  f.state.selected=[a.id];f.reset();map.update(f.state,displayed,f.piles);
  assert.equal(f.root.hidden,false);assert.equal(f.work.nodeReads,3);
  assert.deepEqual(f.layer().children.map(mark=>mark.dataset.nodeId),[a.id,b.id]);
  assert.equal(f.layer().children[0].getAttribute('fill'),'rgba(59, 130, 246, 0.9)');assert.equal(f.layer().children[1].getAttribute('fill'),'#aabbcc');
  f.toggle.onclick();f.reset();map.update(f.state,displayed,f.piles);assert.equal(f.root.hidden,true,'unchanged selection does not undo a manual close');assert.equal(f.work.nodeReads,0);
  map.destroy();
});

test('node count crossing 50 automatically rebuilds, while a stable count above 50 stays closed',async()=>{
  const {install}=await import(entry),f=fixture(50),map=install(f.app),displayed=new Map(f.state.nodes.map(n=>[n.id,n]));map.update(f.state,displayed,f.piles);f.toggle.onclick();f.state.viewportOnly=true;
  f.state.nodes.push({id:'added',type:'image',x:1.25,y:-3.125,width:240.5,height:300.25});f.reset();map.update(f.state,displayed,f.piles);
  assert.equal(f.root.hidden,false);assert.equal(f.work.nodeReads,51);assert.equal(f.layer().children.at(-1).dataset.nodeId,'added');
  f.toggle.onclick();f.reset();map.update(f.state,displayed,f.piles);assert.equal(f.root.hidden,true);assert.equal(f.work.nodeReads,0);
  f.state.nodes.splice(0,2);map.update(f.state,displayed,f.piles);assert.equal(f.root.hidden,true);
  f.state.nodes.push({id:'new-a',type:'audio',x:2,y:3,width:200,height:80},{id:'new-b',type:'video',x:300,y:3,width:200,height:100});map.update(f.state,displayed,f.piles);
  assert.equal(f.root.hidden,false);assert.equal(f.layer().children.length,51);assert.deepEqual(f.layer().children.slice(-2).map(mark=>mark.dataset.nodeId),['new-a','new-b']);
  assert(!f.layer().children.some(mark=>['n0','n1'].includes(mark.dataset.nodeId)));map.destroy();
});

test('hidden refresh that auto-opens derives current historical layout and piles exactly once',async()=>{
  const {install}=await import(entry),{geometry,project}=await import(geometryUrl),f=fixture(3),map=install(f.app),[a,b,c]=f.state.nodes;
  f.toggle.onclick();f.layouts.set(a.id,{x:a.x-1700.875,width:900.5});f.owners.set(c.id,'pile');f.state.selected=[a.id];f.reset();
  f.handlers.get('window:blur')();assert.equal(f.root.hidden,false);
  assert.deepEqual(f.work,{nodeReads:6,layoutReads:3,pileBuilds:1,membershipReads:3});
  assert.deepEqual(f.layer().children.map(mark=>mark.dataset.nodeId),[a.id,b.id]);
  const displayed=[{...a,...f.layouts.get(a.id)},b],expected=project(displayed[0],geometry(displayed,f.state.view,{width:1280,height:720})),actual=transformed(f.layer().children[0],f.layer().getAttribute('transform'));
  for(const key in actual)assert(Math.abs(actual[key]-expected[key])<1e-9,key);
  assert.equal(f.layer().children[0].getAttribute('fill'),'rgba(59, 130, 246, 0.9)');map.destroy();
});
