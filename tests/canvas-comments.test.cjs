const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture(initial,{projectId='canvas',storage,records:recordStorage,writeError:initialWriteError,legacyWriteError,readError,readPending=false,deferWrites=false}={}){
 const storageKey=projectId==='canvas'?'tapnow-comments':'tapnow-comments:project:'+projectId;
 const recordKey='comments-canvas:'+projectId,records=recordStorage||new Map(),writes=[],reads=[],pendingWrites=[];
 const metrics={created:0,inserted:0,removed:0,styles:0},listeners=new Map(),windowListeners=new Map(),stored=storage||new Map([[storageKey,JSON.stringify(initial)]]);let document,writeError=initialWriteError,releaseRead,latestWrite=Promise.resolve(),flushError=null,flushes=0;
 const readGate=readPending?new Promise(resolve=>releaseRead=resolve):Promise.resolve();
 const store={readRecord:async key=>{reads.push(key);await readGate;if(readError)throw readError;return structuredClone(records.get(key));},writeRecord:(key,value)=>{
   const snapshot=structuredClone(value);writes.push({key,snapshot});latestWrite=(async()=>{if(deferWrites)await new Promise((resolve,reject)=>pendingWrites.push({resolve,reject}));if(writeError)throw writeError;records.set(key,snapshot);})();return latestWrite;
 },flush:async()=>{flushes++;await latestWrite;if(flushError)throw flushError;}};
 class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.events=new Map();this.className='';this.parentElement=null;this.textContent='';this.dataset={};this.clientWidth=900;this.classList={add(){},remove(){},toggle(){}};this.style=new Proxy({},{set:(target,key,value)=>{metrics.styles++;target[key]=value;return true;}});metrics.created++;}
  get isConnected(){return this===document.body||this===canvas||this===commentButton||!!this.parentElement?.isConnected;}
  get firstChild(){return this.children[0]||null;}
  get nextSibling(){return this.parentElement?.children[this.parentElement.children.indexOf(this)+1]||null;}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){if(node.parentElement){const old=node.parentElement.children;old.splice(old.indexOf(node),1);}const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parentElement=this;metrics.inserted++;}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;metrics.removed++;if(document.activeElement===this)document.activeElement=document.body;}}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(name,listener){this.events.set(name,listener);}
  focus(){document.activeElement=this;}
  closest(){return null;}
 }
 const canvas=new Element('main'),commentButton=new Element('button'),body=new Element('body');
 document={body,activeElement:body,createElement:tag=>new Element(tag),querySelector:selector=>selector==='#canvas'?canvas:selector.startsWith('.side-tools button')?commentButton:null,addEventListener(name,listener){const list=listeners.get(name)||[];list.push(listener);listeners.set(name,list);}};
 const view={x:10,y:20,scale:1},state={nodes:[],selected:[],view};
 const window={CanvasStore:store,CanvasApp:{getState:()=>state},UI_ICONS:{arrow:'<svg></svg>',image:'<svg></svg>'},addEventListener(name,listener){const list=windowListeners.get(name)||[];list.push(listener);windowListeners.set(name,list);}};
 const context=vm.createContext({window,document,location:{href:'http://localhost:4173/'+(projectId==='canvas'?'':'?project='+projectId)},URL,localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>{if(legacyWriteError)throw legacyWriteError;stored.set(key,value);}},innerWidth:1000,innerHeight:800,crypto:{randomUUID:()=> 'new-comment'},Map,Set,Promise,structuredClone});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/features/canvas-projects/core.js'),'utf8'),context,{filename:'canvas-projects/core.js'});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../advanced-tools.js'),'utf8'),context,{filename:'advanced-tools.js'});
 const render=viewportOnly=>{for(const listener of listeners.get('canvas:render'))listener({detail:{viewportOnly}});};
 const layer=canvas.children.find(node=>node.className==='canvas-comments'),draft=()=>body.children.find(node=>node.className==='comment-composer');
 return {metrics,view,document,layer,render,stored,draft,commentButton,canvas,records,recordKey,writes,reads,ready:tick,releaseRead:()=>releaseRead(),commit:()=>pendingWrites.shift().resolve(),projects:window.CanvasProjects,storageKey,setWriteError:error=>writeError=error,setFlushError:error=>flushError=error,flushes:()=>flushes,dispatchDocument:(name,event)=>{for(const listener of listeners.get(name)||[])listener(event);},dispatchWindow:(name,event)=>{for(const listener of windowListeners.get(name)||[])listener(event);}};
}
const initial=[{id:'a',x:100,y:80,text:'第一条'},{id:'b',x:250,y:150,text:'第二条'}];

test('canvas pan/zoom reuses comment elements and handlers without losing focus',async()=>{
 const f=fixture(initial);await f.ready();const [first,second]=f.layer.children,click=first.onclick,baseline={...f.metrics};first.focus();
 for(let i=0;i<100;i++){Object.assign(f.view,{x:i,y:i*2,scale:1+i/100});f.render(true);}
 assert.equal(f.metrics.created,baseline.created);assert.equal(f.metrics.inserted,baseline.inserted);assert.equal(f.metrics.removed,baseline.removed);assert.equal(f.layer.children[0],first);assert.equal(f.layer.children[1],second);assert.equal(first.onclick,click);assert.equal(f.document.activeElement,first);assert.equal(first.style.left,(100*f.view.scale+f.view.x)+'px');assert.equal(first.style.top,(80*f.view.scale+f.view.y)+'px');
 const writes=f.metrics.styles;f.render(true);f.render(false);assert.equal(f.metrics.styles,writes);assert.equal(f.metrics.created,baseline.created);assert.equal(f.metrics.inserted,baseline.inserted);assert.equal(f.document.activeElement,first);
});

test('editing preserves the live draft across view changes and updates the reused comment',async()=>{
 const f=fixture(initial);await f.ready();const first=f.layer.children[0];first.onclick();const editor=f.draft(),text=editor.children[0];text.value='修改中的中文';text.oninput();text.focus();Object.assign(f.view,{x:1000,y:-1000,scale:2});f.render(true);f.render(false);
 assert.equal(f.draft(),editor);assert.equal(editor.children[0],text);assert.equal(f.document.activeElement,text);assert.equal(text.value,'修改中的中文');assert.equal(editor.style.left,'592px');assert.equal(editor.style.top,'65px');
 await send(text);assert.equal(f.draft(),undefined);assert.equal(f.layer.children[0],first);assert.equal(first.textContent,'修改中的中文');assert.equal(first.getAttribute('aria-label'),'评论：修改中的中文');assert.equal(f.records.get(f.recordKey).comments[0].text,'修改中的中文');assert.equal(JSON.parse(f.stored.get('tapnow-comments'))[0].text,'第一条');
 first.onclick();const reopened=f.draft().children[0];assert.equal(reopened.value,'修改中的中文');reopened.onkeydown({key:'Escape',stopPropagation(){},preventDefault(){}});assert.equal(f.draft(),undefined);
});

function edit(f,value){const text=f.draft().children[0];text.value=value;text.oninput();return text;}
function send(text){return text.onkeydown({key:'Enter',shiftKey:false,stopPropagation(){},preventDefault(){}});}
function cancel(f){f.draft().children[1].children.find(node=>node.getAttribute('aria-label')==='取消评论').onclick();}
function begin(f){f.commentButton.onclick();f.canvas.events.get('pointerdown')({target:{closest:()=>null},button:0,clientX:410,clientY:320,stopImmediatePropagation(){}});}

test('comments use project records while default retains the legacy value and other projects stay untouched',async()=>{
 const stored=new Map([['tapnow-comments',JSON.stringify(initial)],['tapnow-comments:project:a',JSON.stringify([{id:'scoped',x:20,y:30,text:'项目A评论'}])]]);
 const a=fixture([],{projectId:'a',storage:stored}),b=fixture([],{projectId:'b',storage:stored}),legacy=fixture([],{storage:stored});
 await Promise.all([a.ready(),b.ready(),legacy.ready()]);
 assert.equal(a.layer.children[0].textContent,'项目A评论');assert.equal(b.layer.children.length,0);assert.equal(legacy.layer.children[0].textContent,'第一条');
 a.layer.children[0].onclick();await send(edit(a,'仅修改项目A'));assert.equal(a.records.get(a.recordKey).comments[0].text,'仅修改项目A');assert.equal(JSON.parse(stored.get(a.storageKey))[0].text,'项目A评论');assert.equal(JSON.parse(stored.get('tapnow-comments'))[0].text,'第一条');assert.equal(stored.has(b.storageKey),false);
});

test('failed comment edit retains text and coordinates without claiming success or mutating existing comments',async()=>{
 const quota=Object.assign(Error('full'),{name:'QuotaExceededError'}),f=fixture(initial,{writeError:quota});await f.ready();const original=f.layer.children[0];original.onclick();const editor=f.draft(),text=edit(f,'未保存的修改');await send(text);
 assert.equal(f.draft(),editor);assert.equal(text.value,'未保存的修改');assert.equal(original.textContent,'第一条');assert.equal(JSON.parse(f.stored.get(f.storageKey))[0].text,'第一条');assert.match(editor.children[2].textContent,/存储空间不足.*草稿已保留/);
 await assert.rejects(f.projects.assertCanNavigate(),/评论尚未发送/);
 f.setWriteError(null);await send(text);assert.equal(f.draft(),undefined);assert.equal(f.layer.children[0],original);assert.equal(original.textContent,'未保存的修改');assert.deepEqual(f.records.get(f.recordKey).comments[0],{...initial[0],text:'未保存的修改'});await f.projects.assertCanNavigate();assert.equal(f.flushes(),1);
});

test('failed new comment can retry once without duplicate comments or coordinate drift',async()=>{
 const f=fixture(initial,{writeError:Error('write denied')});await f.ready();begin(f);const editor=f.draft(),text=edit(f,'等待重试');await send(text);assert.equal(f.layer.children.length,2);assert.equal(f.draft(),editor);assert.match(editor.children[2].textContent,/评论保存失败.*草稿已保留/);
 Object.assign(f.view,{x:2000,y:3000,scale:2});f.render(true);f.setWriteError(null);await send(text);
 const saved=f.records.get(f.recordKey).comments;assert.equal(saved.length,3);assert.deepEqual(saved[2],{id:'new-comment',x:400,y:300,text:'等待重试'});
});

test('outside, Escape, mode toggle and another comment retain a dirty draft until explicit cancellation',async()=>{
 const f=fixture(initial);await f.ready();begin(f);const editor=f.draft(),text=edit(f,'不可静默丢弃');
 f.canvas.events.get('pointerdown')({target:{closest:()=>null},button:0,clientX:700,clientY:600,stopImmediatePropagation(){}});
 assert.equal(f.draft(),editor);text.onkeydown({key:'Escape',stopPropagation(){},preventDefault(){}});assert.equal(f.draft(),editor);
 f.dispatchDocument('keydown',{key:'Escape'});f.commentButton.onclick();f.layer.children[1].onclick();assert.equal(f.draft(),editor);assert.equal(text.value,'不可静默丢弃');assert.match(editor.children[2].textContent,/尚未发送.*已保留/);
 await assert.rejects(f.projects.assertCanNavigate(),/评论尚未发送/);let prevented=false;const event={preventDefault(){prevented=true;}};f.dispatchWindow('beforeunload',event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
 cancel(f);assert.equal(f.draft(),undefined);await f.projects.assertCanNavigate();assert.deepEqual(JSON.parse(f.stored.get(f.storageKey)),initial);
});

test('invalid stored comments are preserved and editing stays blocked instead of saving an empty record',async()=>{
 const stored=new Map([['tapnow-comments','{"retained":"unrecognized older data"}']]),f=fixture([],{storage:stored});await f.ready();begin(f);
 assert.equal(stored.get('tapnow-comments'),'{"retained":"unrecognized older data"}');assert.equal(f.draft(),undefined);assert.equal(f.writes.length,0);assert.match(f.layer.children[0].textContent,/读取失败.*保护已有评论/);await assert.rejects(f.projects.assertCanNavigate(),/评论读取失败/);
});

test('new comment keeps existing buttons and saves canvas coordinates from its original draft',async()=>{
 const f=fixture(initial);await f.ready();const existing=[...f.layer.children];begin(f);
 const text=f.draft().children[0];text.value='新评论';text.oninput();Object.assign(f.view,{x:200,y:150,scale:.5});f.render(true);await send(text);
 assert.equal(f.layer.children.length,3);assert.equal(f.layer.children[0],existing[0]);assert.equal(f.layer.children[1],existing[1]);const added=f.records.get(f.recordKey).comments[2];assert.deepEqual(added,{id:'new-comment',x:400,y:300,text:'新评论'});assert.equal(f.layer.children[2].style.left,'400px');assert.equal(f.layer.children[2].style.top,'300px');
});

test('localStorage quota does not prevent comment commits and reload uses the durable project record',async()=>{
 const quota=Object.assign(Error('full'),{name:'QuotaExceededError'}),stored=new Map([['tapnow-comments',JSON.stringify(initial)]]),records=new Map(),f=fixture([],{storage:stored,records,legacyWriteError:quota});await f.ready();
 f.layer.children[0].onclick();await send(edit(f,'IndexedDB 已保存'));assert.equal(f.draft(),undefined);assert.equal(records.get(f.recordKey).comments[0].text,'IndexedDB 已保存');assert.equal(JSON.parse(stored.get('tapnow-comments'))[0].text,'第一条');
 const reloaded=fixture([],{storage:stored,records,legacyWriteError:quota});await reloaded.ready();assert.equal(reloaded.layer.children[0].textContent,'IndexedDB 已保存');assert.equal(reloaded.writes.length,0);
});

test('pending and rejected async reads never allow a seed list to overwrite the stored record',async()=>{
 const recordKey='comments-canvas:canvas',records=new Map([[recordKey,{comments:initial}]]),f=fixture([],{records,readPending:true});await tick();begin(f);assert.equal(f.draft(),undefined);assert.equal(f.writes.length,0);await assert.rejects(f.projects.assertCanNavigate(),/评论仍在读取/);
 f.releaseRead();await f.ready();assert.equal(f.layer.children[0].textContent,'第一条');assert.deepEqual(records.get(recordKey).comments,initial);
 const failed=fixture([],{records,readError:Error('database read denied')});await failed.ready();begin(failed);assert.equal(failed.draft(),undefined);assert.equal(failed.writes.length,0);await assert.rejects(failed.projects.assertCanNavigate(),/评论读取失败/);assert.deepEqual(records.get(recordKey).comments,initial);
});

test('pending commit retains the composer and blocks duplicate sends, cancellation and navigation',async()=>{
 const f=fixture(initial,{deferWrites:true});await f.ready();begin(f);const editor=f.draft(),text=edit(f,'等待交易提交'),saving=send(text);await tick();
 assert.equal(text.disabled,true);assert.equal(f.layer.children.length,2);assert.equal(f.records.has(f.recordKey),false);await send(text);assert.equal(f.writes.length,1);
 cancel(f);text.onkeydown({key:'Escape',stopPropagation(){},preventDefault(){}});assert.equal(f.draft(),editor);await assert.rejects(f.projects.assertCanNavigate(),/评论正在保存/);
 f.commit();await saving;assert.equal(f.draft(),undefined);assert.equal(f.records.get(f.recordKey).comments.length,3);await f.projects.assertCanNavigate();assert.equal(f.flushes(),1);
});

test('record conflict preserves the draft and a later navigation flush failure is not a false success',async()=>{
 const conflict=Object.assign(Error('stale tab'),{name:'CanvasCommentsConflictError'}),records=new Map([['comments-canvas:canvas',{comments:initial}]]),f=fixture([],{records,writeError:conflict});await f.ready();f.layer.children[0].onclick();const text=edit(f,'旧标签修改');await send(text);
 assert.match(f.draft().children[2].textContent,/另一窗口.*尚未保存.*草稿已保留/);assert.deepEqual(records.get(f.recordKey).comments,initial);await assert.rejects(f.projects.assertCanNavigate(),/评论尚未发送/);
 f.setWriteError(null);await send(text);f.setFlushError(Error('queued transaction failed'));await assert.rejects(f.projects.assertCanNavigate(),/queued transaction failed/);f.setFlushError(null);await f.projects.assertCanNavigate();
});

test('comment composition cannot submit or dismiss and external Escape retains a clean editor',async()=>{
 const f=fixture(initial);await f.ready();f.layer.children[0].onclick();const editor=f.draft(),text=editor.children[0];
 for(const key of ['Enter','Escape'])for(const guard of [{isComposing:true},{keyCode:229},{defaultPrevented:true}])await text.onkeydown({key,...guard,stopPropagation(){},preventDefault(){throw Error('composition must remain native');}});
 assert.equal(f.writes.length,0);assert.equal(f.draft(),editor);
 for(const guard of [{defaultPrevented:true},{isComposing:true},{target:{closest:()=>null}},{target:{closest:selector=>selector==='.comment-composer'?null:{}}}])f.dispatchDocument('keydown',{key:'Escape',...guard});
 assert.equal(f.draft(),editor);
 text.onkeydown({key:'Escape',stopPropagation(){},preventDefault(){}});assert.equal(f.draft(),undefined);assert.equal(f.document.activeElement,f.layer.children[0]);
});
