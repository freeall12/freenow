const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 let writes=0;
 class Element{
  constructor(){this.children=[];this.dataset={};this.style={};this.attributes={};this.hidden=true;const classes=new Set();this.classList={contains:name=>classes.has(name),add(...names){writes++;names.forEach(name=>classes.add(name));},remove(...names){writes++;names.forEach(name=>classes.delete(name));}};}
  setAttribute(key,value){this.attributes[key]=value;}append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}
 }
 const document={createElement:()=>new Element(),addEventListener(){}},window={CanvasText:{},UI_ICONS:{},CanvasMenus:{measureToolbar:()=>({width:204})},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../canvas-text-ui.js'),'utf8'),{window,document});
 const bar=new Element(),bounds={left:19.25,right:899.75,top:48.5},view={x:7.125,y:81.25,scale:.7},node={id:'t',type:'text',x:200.125,y:240.375,width:320.5};
 return{bar,bounds,view,node,get writes(){return writes;},render(picked=[node]){return window.CanvasTextUI.toolbar(picked,bar,{view,canvas:{getBoundingClientRect:()=>bounds}});}};
}
test('text toolbar keeps controls and exact coordinates without repeated class invalidation',()=>{
 const f=fixture();f.render();const writes=f.writes,children=[...f.bar.children];
 for(let i=0;i<90;i++){f.view.x+=.125;f.view.y-=.375;f.render();const center=f.bounds.left+(f.node.x+f.node.width/2)*f.view.scale+f.view.x;assert.equal(f.bar.style.left,Math.max(f.bounds.left+8,Math.min(f.bounds.right-204-8,center-102))+'px');assert.equal(f.bar.style.top,Math.max(65,f.bounds.top+f.node.y*f.view.scale+f.view.y-61)+'px');}
 assert.equal(f.writes,writes);assert.deepEqual(f.bar.children,children);assert.equal(f.bar.hidden,false);
});
test('switching group or multi selection to text removes old styling and deselection clears text styling',()=>{
 const f=fixture();f.bar.classList.add('group-toolbar','multiselect-toolbar');f.render();assert.equal(f.bar.classList.contains('group-toolbar'),false);assert.equal(f.bar.classList.contains('multiselect-toolbar'),false);assert.equal(f.bar.classList.contains('text-node-toolbar'),true);
 assert.equal(f.render([]),false);assert.equal(f.bar.classList.contains('text-node-toolbar'),false);const writes=f.writes;f.render([]);assert.equal(f.writes,writes);
 f.render();assert.equal(f.bar.classList.contains('text-node-toolbar'),true);
});
test('toolbar respects current canvas bounds and rebuilds controls after a color change',()=>{
 const f=fixture();f.render();const before=f.bar.children[0];f.node.color='#ffc';f.bounds.right=310.25;f.bounds.left=50.5;f.view.x=900;f.render();assert.notEqual(f.bar.children[0],before);assert.equal(f.bar.style.left,(f.bounds.right-204-8)+'px');assert.equal(f.bar.children[0].children[0].style.backgroundColor,'#ffc');
});
