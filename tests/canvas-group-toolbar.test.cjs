const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const groups=require('../canvas-groups.js'),piles=require('../canvas-piles.js');

function fixture(nodes){
 const calls={eligible:0,visited:0,pileNodes:[],group:[]};
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.classList={toggle(){}};this.offsetWidth=180;}
  setAttribute(name,value){this.attributes[name]=value;}
  append(...children){this.children.push(...children);}
  replaceChildren(){this.children=[];}
 }
 const document={addEventListener(){},createElement:tag=>new Element(tag)},bar=new Element('div');
 const window={CANVAS_GROUP_ICONS:{},CanvasApp:{group:ids=>calls.group.push([...ids]),notify:message=>{throw Error(message);}},CanvasGroups:{...groups,eligible(picked,ids){calls.eligible++;calls.visited+=picked.length;return groups.eligible(picked,ids);}},CanvasPiles:{plan(all,ids){calls.pileNodes.push(all);return piles.plan(all,ids);}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../canvas-groups-ui.js'),'utf8'),{window,document});
 const view={x:7.125,y:-11.375,scale:.7};
 return{calls,bar,view,render(picked){return window.CanvasGroupsUI.toolbar(picked,bar,{nodes,view,canvas:{}});},button(label){return bar.children.find(e=>e.attributes['aria-label']===label);}};
}
const node=(id,patch={})=>({id:String(id),type:'image',x:53284.3+id*400.125,y:-2180.48,width:300,height:200,...patch});

test('group action tracks parent changes, mixed group selection and 50-node limit',()=>{
 const nodes=Array.from({length:51},(_,i)=>node(i)),group=node(100,{type:'group'});nodes.push(group);
 const f=fixture(nodes);
 f.render(nodes.slice(0,2));assert.ok(f.button('打组'));f.button('打组').onclick({stopPropagation(){}});assert.deepEqual(f.calls.group,[['0','1']]);
 nodes[0].parentId=nodes[1].parentId='existing';f.render(nodes.slice(0,2));assert.equal(f.button('打组'),undefined);
 nodes[1].parentId='other';f.render(nodes.slice(0,2));assert.ok(f.button('打组'));
 f.render([group,nodes[0]]);assert.equal(f.button('打组'),undefined);
 f.render([group,nodes[0],nodes[1]]);assert.ok(f.button('打组'));
 f.render(nodes.slice(0,50));assert.ok(f.button('打组'));
 f.render(nodes.slice(0,51));assert.equal(f.button('打组'),undefined);
 f.render([group]);assert.equal(f.button('打组'),undefined);assert.ok(f.button('解组'));
});

test('viewport frames inspect selected nodes only while retaining toolbar DOM and fractional positioning',()=>{
 const nodes=Array.from({length:2000},(_,i)=>node(i)),picked=nodes.slice(0,2),f=fixture(nodes);
 f.render(picked);const buttons=[...f.bar.children];f.calls.eligible=0;f.calls.visited=0;
 for(let i=0;i<180;i++){f.view.x+=.125;f.view.y-=.375;f.render(picked);}
 assert.equal(f.calls.eligible,180);assert.equal(f.calls.visited,360);assert.deepEqual(f.bar.children,buttons);
 const bounds=groups.bounds(picked,0);assert.equal(f.bar.style.left,((bounds.x+bounds.width/2)*f.view.scale+f.view.x-90)+'px');assert.equal(f.bar.style.top,(bounds.y*f.view.scale+f.view.y-56)+'px');
 const group=node(2001,{type:'group'});nodes.push(group);f.calls.eligible=0;f.render([group]);assert.equal(f.calls.eligible,0);
});

test('pile eligibility retains the full graph, including an unselected owner pile',()=>{
 const a=node(0),b=node(1),owner=node(2,{type:'pile',memberIds:[a.id]}),nodes=[a,b,owner],f=fixture(nodes);
 f.render([a,b]);assert.equal(f.button('堆叠'),undefined);assert.ok(f.button('打组'));assert.equal(f.calls.pileNodes[0],nodes);
 const free=fixture([a,b]);free.render([a,b]);assert.ok(free.button('堆叠'));
});
