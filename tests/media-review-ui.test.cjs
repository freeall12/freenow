const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function fixture(count=0){
 const core=await import('../media-review-core.mjs'),icons=(await import('../media-review-icons.mjs')).default,counts={lookups:0,queries:0,scans:0,writes:0,serializations:0},elements=new Map(),listeners=new Map();let observer;
 const mutation=(target,type,addedNodes=[],removedNodes=[])=>{if(observer&&target.isConnected)observer.records.push({target,type,addedNodes,removedNodes});};
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this._class='';this.value='';this.style={};this.hidden=false;this.classList={contains:value=>this._class.split(' ').includes(value),toggle:(value,on)=>{const classes=new Set(this._class.split(' ').filter(Boolean));on?classes.add(value):classes.delete(value);this.className=[...classes].join(' ');}};}
  get isConnected(){return this.root||!!this.parentNode?.isConnected;}
  get className(){return this._class;}set className(value){this._class=value;counts.writes++;mutation(this,'attributes');}
  append(...children){counts.writes++;for(const child of children){child.remove();child.parentNode=this;this.children.push(child);}mutation(this,'childList',children);}
  remove(){if(!this.parentNode)return;counts.writes++;const parent=this.parentNode;parent.children=parent.children.filter(child=>child!==this);this.parentNode=null;mutation(parent,'childList',[],[this]);}
  contains(child){return this===child||this.children.some(node=>node.contains(child));}
  setAttribute(key,value){counts.writes++;this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  get textContent(){return this.value+this.children.map(child=>child.textContent).join('');}
  set textContent(value){for(const child of [...this.children])child.remove();this.value=value;counts.writes++;mutation(this,'childList',value?[new Element('#text')]:[]);}
  set innerHTML(value){this.textContent='';if(value.includes('<svg'))this.append(new Element('svg'));}
  set outerHTML(value){const parent=this.parentNode;this.remove();const next=new Element(value.includes('<svg')?'svg':'div');parent.append(next);}
  querySelector(selector){counts.queries++;const matches=node=>selector.startsWith('.')?node.classList.contains(selector.slice(1)):node.tagName===selector;const walk=node=>{for(const child of node.children){if(matches(child))return child;const found=walk(child);if(found)return found;}return null;};return walk(this);}
 }
 const body=new Element('body'),head=new Element('head');body.root=head.root=true;
 const state={nodes:[],selected:[]},app={getState:()=>state,getNodeElement:id=>{counts.lookups++;return elements.get(id)||null;},notify(){}};
 function shell(node){const element=new Element('div');element.className='node';element.dataset.id=node.id;const title=new Element('div');title.className='node-title';const text=new Element('span');text.className='title-text';text.textContent=node.title||node.id;const legacy=new Element('span');legacy.className='restricted';title.append(text,legacy);element.append(title);body.append(element);elements.set(node.id,element);return {element,title,text,legacy};}
 for(let i=0;i<count;i++){const node={id:'n'+i,type:'image',image:'assets/'+i+'.png'};state.nodes.push(node);shell(node);}
 const context={...core,JSON:{parse:JSON.parse,stringify(...args){counts.serializations++;return JSON.stringify(...args);}},icons,httpAdapter:()=>null,document:{body,head,createElement:tag=>new Element(tag),addEventListener:(type,fn)=>listeners.set(type,fn),querySelector(){counts.scans++;throw Error('unexpected full document lookup');},querySelectorAll(){counts.scans++;throw Error('unexpected full document scan');}},window:{CanvasApp:app,EDITOR_DATA:{nodes:{}},CANVAS_MENU_ICONS:{compliance:'<svg></svg>'}},localStorage:{getItem:()=> '[]',setItem(){}},MutationObserver:class{constructor(callback){this.callback=callback;this.records=[];observer=this;}observe(){}takeRecords(){const records=this.records;this.records=[];return records;}},structuredClone,console,innerWidth:1280,innerHeight:720};
 vm.createContext(context);const source=fs.readFileSync(require.resolve('../media-review-ui.mjs'),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');vm.runInContext(source,context);
 const render=detail=>listeners.get('canvas:render')({detail}),service=vm.runInContext('service',context),reset=()=>Object.keys(counts).forEach(key=>counts[key]=0);
 return {core,counts,elements,state,shell,Element,body,render,service,context,reset};
}

test('500 stable unknown reviews across 90 drag frames perform no subtree queries, scans or DOM writes',async()=>{
 const f=await fixture(500);f.render();f.reset();
 for(let frame=0;frame<90;frame++){f.state.nodes[0].x=frame+.125;f.render();}
 assert.deepEqual(f.counts,{lookups:45000,queries:0,scans:0,writes:0,serializations:0});
 f.reset();f.render({viewportOnly:true});assert.deepEqual(f.counts,{lookups:0,queries:0,scans:0,writes:0,serializations:0});
});

test('approved cache handles whole node replacement, title replacement, title edits and externally removed badges',async()=>{
 const f=await fixture(1),node=f.state.nodes[0];f.service.save(f.core.media(node),{status:'approved',message:'approved original'});f.render();f.reset();
 for(let i=0;i<20;i++)f.render();assert.equal(f.counts.queries,0);assert.equal(f.counts.writes,0);
 let old=f.elements.get(node.id);old.remove();let current=f.shell(node);f.render();assert.equal(current.title.querySelector('.media-review-badge').attributes['aria-label'],'approved original');assert.equal(current.legacy.hidden,true);
 const title=new f.Element('div');title.className='node-title';current.title.remove();current.element.append(title);f.render();assert.equal(title.querySelector('.media-review-badge').dataset.status,'approved');
 title.textContent='已改标题';f.render();assert.equal(title.querySelector('.media-review-badge').dataset.status,'approved');
 title.querySelector('.media-review-badge').remove();f.render();assert.equal(title.querySelector('.media-review-badge').dataset.status,'approved');
 const legacy=new f.Element('span');legacy.className='restricted';title.append(legacy);f.render();assert.equal(legacy.hidden,true);
 f.service.save(f.core.media(node),{status:'rejected',message:'new reason'});assert.equal(title.querySelector('.media-review-badge').attributes['aria-label'],'new reason');
 f.service.save(f.core.media(node),{status:'unknown',message:''});assert.equal(title.querySelector('.media-review-badge'),null);assert.equal(legacy.hidden,false);f.render();f.reset();for(let i=0;i<20;i++)f.render();assert.equal(f.counts.queries,0);assert.equal(f.counts.writes,0);
});

test('real media identity remains live across in-place clip/default/source changes and interrupted review updates',async()=>{
 const f=await fixture(),node={id:'v',type:'video',clip:{start:0,end:2}};f.context.window.EDITOR_DATA.nodes.v={video:'first.mp4'};f.state.nodes.push(node);const {title}=f.shell(node);
 let input=f.core.media(node,f.context.window.EDITOR_DATA.nodes.v);f.service.save(input,{status:'pending',interrupted:true,message:'resume'});assert.match(title.querySelector('.media-review-badge').textContent,/已中断/);
 f.service.save(input,{status:'pending',interrupted:false,message:'running'});assert.equal(title.querySelector('.media-review-badge').textContent,'正在验证');
 node.clip.start=.5;f.render();assert.equal(title.querySelector('.media-review-badge'),null);
 input=f.core.media(node,f.context.window.EDITOR_DATA.nodes.v);f.service.save(input,{status:'approved'});assert.equal(title.querySelector('.media-review-badge').dataset.status,'approved');
 f.context.window.EDITOR_DATA.nodes.v.video='second.mp4';f.render();assert.equal(title.querySelector('.media-review-badge'),null);
 node.type='image';node.image='thumb.png';node.fullImage='original.png';input=f.core.media(node);f.service.save(input,{status:'rejected_invalid'});assert.match(title.querySelector('.media-review-badge').attributes['aria-label'],/300 ~ 6000/);
 node.fullImage='replacement.png';f.render();assert.equal(title.querySelector('.media-review-badge'),null);
});

test('registered menu updates and deleting the last media copy cancel real in-flight review without late approval',async()=>{
 const f=await fixture(),a={id:'a',type:'video',video:'shared.mp4'},b={...a,id:'b'};f.state.nodes.push(a,b);f.shell(a);f.shell(b);let finish;
 f.context.window.MediaReview.setAdapter({submit:()=>new Promise(resolve=>finish=resolve),poll:()=>assert.fail()});
 const button=new f.Element('button');button.innerHTML='<svg></svg>';f.body.append(button);f.context.bindMenu(button,a.id);assert.equal(button.disabled,false);
 const promise=f.context.submit(a.id);await new Promise(resolve=>setImmediate(resolve));assert.equal(button.disabled,true);assert.equal(f.service.running.size,1);
 f.state.nodes.shift();f.elements.get(a.id).remove();f.render();assert.equal(f.service.running.size,1);assert.equal(button.disabled,true);
 f.state.nodes.pop();f.elements.get(b.id).remove();f.render();assert.equal(f.service.running.size,0);finish({status:'approved'});await promise;assert.equal(f.service.get(f.core.media(a)).status,'unknown');
 button.remove();f.render();f.reset();f.render();assert.equal(f.counts.queries,0);assert.equal(f.counts.scans,0);
 f.state.nodes.push(a);const restored=f.shell(a);f.render();assert.equal(restored.title.querySelector('.media-review-badge'),null);
});


test('stable populated reviews and registered menus avoid fingerprint serialization and repeated attribute writes',async()=>{
 const f=await fixture(1),node=f.state.nodes[0];f.service.save(f.core.media(node),{status:'approved',message:'ok'});
 const button=new f.Element('button');button.innerHTML='<svg></svg>';f.body.append(button);f.context.bindMenu(button,node.id);f.render();f.reset();
 for(let frame=0;frame<90;frame++)f.render();
 assert.equal(f.counts.serializations,0);assert.equal(f.counts.writes,0);
 const title=f.elements.get(node.id).querySelector('.node-title'),old=title.querySelector('.media-review-badge');
 // Even callers mutating an existing service entry must invalidate visible text.
 f.service.get(f.core.media(node)).message='edited in place';f.render();
 assert.notEqual(title.querySelector('.media-review-badge'),old);assert.equal(title.querySelector('.media-review-badge').attributes['aria-label'],'edited in place');
 button.attributes['aria-busy']='true';button.disabled=true;f.render();assert.equal(button.attributes['aria-busy'],'false');assert.equal(button.disabled,false);
});
