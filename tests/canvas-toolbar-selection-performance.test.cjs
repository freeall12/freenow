const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function between(from,to,script=source){const start=script.indexOf(from),end=script.indexOf(to,start+from.length);assert(start>=0&&end>start,from);return script.slice(start,end);}
function fixture(ids,baseline=false){
  const metrics={membership:0,toolbar:0},events=[],routes=[],connections=[],elements=new Map(),noop=()=>{};
  class Element{
    constructor(){this.style={};this.dataset={};this.children=[];this.attributes={};this.hidden=true;this.offsetWidth=180;this.offsetHeight=40;const items=new Set();this.classList={add:(...names)=>names.forEach(name=>items.add(name)),remove:(...names)=>names.forEach(name=>items.delete(name)),toggle(name,value){if(value)items.add(name);else items.delete(name);}};}
    append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}setAttribute(key,value){this.attributes[key]=String(value);}get lastChild(){return this.children.at(-1);}
  }
  const element=selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);};
  const nodes=Array.from({length:4000},(_,i)=>({id:`n${i}`,type:'image',x:52000.125+i*30.375,y:-300.375+i*.125,width:435.25,height:250.125}));
  const selected=new Set(ids);selected.has=function(id){metrics.membership++;return Set.prototype.has.call(this,id);};
  const canvas={getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720})};
  const c=vm.createContext({nodes,edges:[{id:'edge',source:'n0',target:'n3999'}],selected,view:{x:-36400.125,y:300.5,scale:.7},canvas,
    renderLayout:null,renderScale:.7,renderFrame:0,pendingRender:null,shellObserver:null,nodeElements:new Map(),refreshKeys:new Map(),paths:new Map(),original:new Map(),
    innerWidth:1280,innerHeight:720,world:new Element(),styleValue:(root,key,value)=>root.style[key]=String(value),attributeValue:noop,
    cancelAnimationFrame:noop,flushGesture:noop,renderNodeShell:noop,scheduleEmptyHint:noop,scheduleViewSave:noop,$:element,
    svg:()=>'<svg></svg>',duplicate:noop,rename:noop,download:noop,preview:noop,nodeMenu:noop,
    CustomEvent:class{constructor(type,data){this.type=type;this.detail=data?.detail;}},
    document:{createElement:()=>new Element(),addEventListener:noop,querySelector:()=>null,dispatchEvent:event=>events.push(event.detail)},
    window:{CANVAS_GROUP_ICONS:{},CanvasGroups:require('../canvas-groups.js'),CanvasPiles:require('../canvas-piles.js'),
      CanvasPilesUI:{toolbar:()=>false,refresh:noop},CanvasTextUI:{toolbar:()=>false},NodeEditor:{layoutFor:noop},
      WorldNode:{toolbar(picked){metrics.toolbar++;routes.push(picked);return false;}},CanvasMenus:{measureToolbar:()=>({width:180}),positionToolbar:()=>false},
      CanvasConnections:{render(state,byId,piles,pathFor){connections.push({selected:[...state.selected],path:pathFor(state.edges[0],byId,piles)});}}},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../canvas-groups-ui.js'),'utf8'),c);
  let toolbar=between('  let toolbarPicked=', '  function closeMenu(');
  if(baseline){const previous=toolbar;toolbar=toolbar.replace('viewportOnly&&toolbarPicked?toolbarPicked:(toolbarPicked=nodes.filter(n=>selected.has(n.id)))','nodes.filter(n=>selected.has(n.id))');assert.notEqual(toolbar,previous);}
  vm.runInContext([between('  function edgePath(', '  let renderFrame='),between('  function render(options)', '  function saveView()'),toolbar].join('\n'),c);
  return{c,metrics,events,routes,connections,bar:element('#node-toolbar'),render:options=>c.render(options)};
}

test('4000-node viewport frames retain toolbar/edge outputs and scan only on full selection/content refreshes',()=>{
  for(const ids of [[],['n3999'],['n3999','n0']]){
    const before=fixture(ids,true),after=fixture(ids),original=structuredClone(after.c.nodes);
    before.render();after.render();const children=[...after.bar.children],selectedNodes=after.routes.at(-1);
    for(let frame=0;frame<90;frame++){
      for(const f of [before,after]){f.c.view.x+=.125;f.c.view.y-=.375;f.c.view.scale+=.00125;f.render({viewportOnly:true});}
      assert.deepEqual(after.bar.style,before.bar.style);assert.equal(after.bar.hidden,before.bar.hidden);
      assert.equal(after.routes.at(-1),selectedNodes);assert.deepEqual(after.bar.children,children);
      assert.deepEqual(after.connections.at(-1),before.connections.at(-1));
      assert.deepEqual(after.c.view,before.c.view);assert.equal(after.c.world.style.transform,before.c.world.style.transform);
      assert.equal(after.events.at(-1).viewportOnly,true);
    }
    assert.equal(before.metrics.membership,364000);assert.equal(after.metrics.membership,4000);
    assert.equal(after.metrics.toolbar,91);assert.equal(after.events.length,91);assert.deepEqual(after.c.nodes,original);
    assert.deepEqual([...after.c.selected],ids);
    assert.deepEqual([...selectedNodes].map(n=>n.id),ids.length===2?['n0','n3999']:ids);
    for(const n of selectedNodes)assert.equal(n,after.c.nodes.find(node=>node.id===n.id));
  }

  const f=fixture(['n3999','n0']);f.render();const initial=f.routes.at(-1),replacement={...f.c.nodes[3999],type:'video',x:53000.875};
  f.c.nodes[3999]=replacement;f.c.nodes.splice(0,1);f.c.selected.clear();f.c.selected.add('n3999');
  // A queued content refresh must override a requested viewport-only pass.
  f.c.pendingRender=false;f.render({viewportOnly:true});assert.equal(f.events.at(-1).viewportOnly,false);
  assert.notEqual(f.routes.at(-1),initial);assert.equal(f.routes.at(-1).length,1);assert.equal(f.routes.at(-1)[0],replacement);
  assert.equal(f.metrics.membership,7999);const renewed=f.routes.at(-1);f.render({viewportOnly:true});assert.equal(f.routes.at(-1),renewed);assert.equal(f.metrics.membership,7999);
  f.c.nodes=[];f.c.selected.clear();f.render();assert.equal(f.routes.at(-1).length,0);assert.equal(f.bar.hidden,true);
  f.c.nodes=[replacement];f.c.selected.add(replacement.id);f.render();assert.equal(f.routes.at(-1)[0],replacement);assert.equal(f.bar.hidden,false);
});
