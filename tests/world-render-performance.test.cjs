const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/features/world-node/entry.mjs'),'utf8');
class Element {
 constructor(tag,cls=''){this.tag=tag;this.className=cls;this.children=[];this.dataset={};this.style={};this.classList={add(){}};this.offsetWidth=120;}
 append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
 replaceChildren(...items){for(const c of this.children)c.parentNode=null;this.children=[];this.append(...items);}
 querySelector(selector){return this.children.find(n=>selector==='svg'?n.tag==='svg':'.'+n.className===selector)||null;}
 insertAdjacentHTML(){this.append(new Element('svg'));}remove(){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}
}
function setup(){
 const actions=[],context={WeakMap,icons:{world:'<svg/>'},el:(...a)=>new Element(...a),button:(name,fn)=>({name,onclick:fn}),preview:id=>actions.push(['preview',id]),download:id=>actions.push(['download',id]),upload:id=>actions.push(['upload',id]),Math,JSON};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const covers ='),source.indexOf('async function preview(')),context);
 const root=new Element('section');root.append(new Element('div','node-title'),new Element('div','node-body'));
 return {context,root,actions,node:{id:'w',type:'world',image:'/image.webp',title:'Original',x:1.125,y:2.375,width:375}};
}
test('idle 3D cover and toolbar never traverse resource payload, keep decoded cover and controls',()=>{
 const {context:c,root,node,actions}=setup();node.worldResource={toJSON(){assert.fail('resource serialization during presentation');}};
 c.renderNode(node,root);const image=root.querySelector('.node-body').children[0],bar=new Element('div'),state={view:{x:3,y:7,scale:.22841067612171173},canvas:{clientWidth:1280}};
 c.toolbar([node],bar,state);const buttons=[...bar.children];
 for(let i=0;i<120;i++){node.x+=.125;c.renderNode(node,root);c.toolbar([node],bar,state);}
 assert.equal(root.querySelector('.node-body').children[0],image);assert.deepEqual(bar.children,buttons);buttons[0].onclick();buttons[1].onclick();assert.deepEqual(actions,[['preview','w'],['download','w']]);
 node.worldResource=null;c.toolbar([node],bar,state);assert.equal(bar.children.length,1);bar.children[0].onclick();assert.deepEqual(actions.at(-1),['upload','w']);
});
test('cover cache responds to title, image, empty image, shell, body and child replacement',()=>{
 const {context:c,root,node}=setup();c.renderNode(node,root);const body=root.querySelector('.node-body'),image=body.children[0];
 node.title='Changed';c.renderNode(node,root);assert.equal(image.alt,'Changed');assert.equal(body.children[0],image);
 node.image='/new.webp';c.renderNode(node,root);assert.notEqual(body.children[0],image);assert.equal(body.children[0].src,node.image);
 body.replaceChildren();c.renderNode(node,root);assert.equal(body.children[0].src,node.image);
 const replacement=new Element('div','node-body');body.remove();root.append(replacement);c.renderNode(node,root);assert.equal(replacement.children[0].src,node.image);
 delete node.image;c.renderNode(node,root);assert.equal(replacement.children[0].className,'world-node-symbol');
 const newRoot=new Element('section');newRoot.append(new Element('div','node-title'),new Element('div','node-body'));c.renderNode(node,newRoot);assert.equal(newRoot.querySelector('.node-body').children[0].className,'world-node-symbol');
});
