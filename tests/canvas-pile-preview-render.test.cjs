const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../canvas-piles.js'),motion=require('../canvas-pile-motion.js');

function fixture({count=1,textLength=24,script=fs.readFileSync(path.join(__dirname,'../canvas-piles-ui.js'),'utf8')}={}){
 const counts={queries:0,rebuilds:0,created:0,players:0,disposed:0,keyWrites:0,keyChars:0};
 class Element{
  constructor(tag){counts.created++;this.tagName=tag;this.children=[];this.style={};this.className='';this.attributes={};this.dataset=new Proxy({},{set(target,key,value){if(key==='key'){counts.keyWrites++;counts.keyChars+=String(value).length;}target[key]=value;return true;}});this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>{if(!this.classList.contains(name))this.className+=' '+name;}};}
  append(...items){for(const item of items){item.remove();item.parentNode=this;this.children.push(item);}}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  replaceChildren(...items){counts.rebuilds++;for(const item of this.children)item.parentNode=null;this.children=[];this.append(...items);}
  querySelectorAll(selector){counts.queries++;const result=[];const visit=root=>{for(const child of root.children){if(selector.startsWith('.')&&child.classList.contains(selector.slice(1)))result.push(child);visit(child);}};visit(this);return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  setAttribute(key,value){this.attributes[key]=String(value);}
 }
 const nodes=[],entries=[];
 for(let i=0;i<count;i++){
  const members=Array.from({length:3},(_,j)=>({id:`${i}-${j}`,type:'text',title:`文本${j}`,content:'长文本'.repeat(Math.ceil(textLength/3)).slice(0,textLength),x:53284.3+i*.125,y:-2180.48+j*.375,width:300.25,height:250.125}));
  const pile={id:`pile-${i}`,type:'pile',memberIds:members.map(n=>n.id)},element=new Element('node'),body=new Element('div');body.className='node-body pile-body';element.append(body);nodes.push(pile,...members);entries.push({pile,element,members,get body(){return element.children.find(child=>child.classList.contains('pile-body'));}});
 }
 const window={CanvasPiles:core,PileMotion:motion,CANVAS_GROUP_ICONS:{},UI_ICONS:{image:'image',video:'video',audio:'audio'},CanvasTextUI:{content(n,element){element.textContent=n.content;}}};
 vm.runInNewContext(script,{window,document:{createElement:tag=>new Element(tag),addEventListener(){}}});
 const index=()=>core.index(nodes);
 function render(){const shared=index();for(const entry of entries)window.CanvasPilesUI.refresh(entry.pile,entry.element,nodes,shared);}
 function audioAPI(){window.AudioAPI={createPlayer(){counts.players++;return{wrap:new Element('audio'),dispose(){counts.disposed++;}};}};}
 return{counts,window,nodes,entries,Element,index,render,audioAPI,reset(){for(const key in counts)counts[key]=0;}};
}

test('unchanged long-text pile previews retain cards with zero DOM queries or key writes during movement',()=>{
 const f=fixture({count:100,textLength:8193});f.render();const cards=f.entries.map(entry=>entry.body.children.slice());f.reset();
 for(let frame=0;frame<30;frame++){f.nodes[1].x+=.125;f.nodes[1].y-=.375;f.render();}
 assert.equal(f.counts.queries,0);assert.equal(f.counts.rebuilds,0);assert.equal(f.counts.created,0);assert.equal(f.counts.keyWrites,0);assert.equal(f.counts.keyChars,0);
 for(const [index,entry] of f.entries.entries())assert.deepEqual(entry.body.children,cards[index]);
 const position=motion.preview(f.entries[0].members).get(f.entries[0].members[0].id);assert.ok(f.entries[0].body.children[0].style.cssText.includes(`--px:${position.x}px;--py:${position.y}px;--pr:${position.rotate}deg;--ps:${position.scale}`));
});

test('all previous content-key fields, member ordering and undo replacement invalidate the preview',()=>{
 const f=fixture(),entry=f.entries[0],member=entry.members[0];f.render();
 const patches={id:'renamed-id',type:'video',title:'新标题',image:'/new-image.png',audio:'/new-audio.wav',content:'新中文内容',color:'#123456',width:320.375,height:280.625};
 for(const [key,value] of Object.entries(patches)){
  const cards=entry.body.children.slice(),old=member[key];member[key]=value;if(key==='id')entry.pile.memberIds[0]=value;f.render();assert.notEqual(entry.body.children[0],cards[0],key);
  member[key]=old;if(key==='id')entry.pile.memberIds[0]=old;f.render();
 }
 const before=f.nodes.map(node=>structuredClone(node));member.content='已编辑';f.render();assert.equal(entry.body.children[0].children[0].children[0].textContent,'已编辑');
 f.nodes.splice(0,f.nodes.length,...before);f.render();assert.equal(entry.body.children[0].children[0].children[0].textContent,before[1].content);
 const livePile=f.nodes.find(node=>node.id===entry.pile.id);livePile.memberIds.reverse();entry.pile=livePile;f.render();assert.deepEqual(entry.body.children.map(card=>card.dataset.pilePreviewMember),livePile.memberIds);
 livePile.memberIds.pop();f.render();assert.equal(entry.body.children.length,2);assert.equal(entry.body.ariaLabel,'堆叠节点，共 2 个节点');
});

test('body, card and complete node DOM replacement remounts cached preview content',()=>{
 const f=fixture(),entry=f.entries[0];f.render();const firstBody=entry.body;
 firstBody.replaceChildren();f.render();assert.equal(firstBody.children.length,3);
 const replacement=new f.Element('div');replacement.className='node-body pile-body';entry.element.replaceChildren(replacement);f.render();assert.equal(entry.body,replacement);assert.equal(replacement.children.length,3);
 const fake=new f.Element('div');fake.className='pile-card';replacement.children[1].remove();replacement.append(fake);f.render();assert.deepEqual(replacement.children.map(card=>card.dataset.pilePreviewMember),entry.pile.memberIds);
 const next=new f.Element('node'),body=new f.Element('div');body.className='node-body pile-body';next.append(body);f.window.CanvasPilesUI.refresh(entry.pile,next,f.nodes,f.index());assert.equal(body.children.length,3);
});

test('late audio API and changed audio source rebuild once and dispose previous players',()=>{
 const f=fixture(),entry=f.entries[0];entry.members[0].type='audio';entry.members[0].audio='/before.wav';f.render();assert.equal(f.counts.players,0);
 f.audioAPI();f.render();assert.equal(f.counts.players,1);const card=entry.body.children[0];f.render();assert.equal(entry.body.children[0],card);assert.equal(f.counts.players,1);
  entry.members[0].audio='/after.wav';f.render();assert.equal(f.counts.disposed,1);assert.equal(f.counts.players,2);
 const body=new f.Element('div');body.className='node-body pile-body';entry.element.replaceChildren(body);f.render();assert.equal(f.counts.disposed,2);assert.equal(f.counts.players,3);
 body.replaceChildren();f.render();assert.equal(f.counts.disposed,3);assert.equal(f.counts.players,4);
 delete f.window.AudioAPI;f.render();assert.equal(f.counts.disposed,4);assert.equal(f.counts.players,4);
});

module.exports={fixture};
