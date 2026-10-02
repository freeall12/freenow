const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function fixture(){
 const timers=new Map(),cancelled=[];let timerId=0;
 class Surface{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn,options={}){const item={fn,capture:options===true||!!options.capture};const list=this.listeners.get(type)||[];list.push(item);this.listeners.set(type,list);options.signal?.addEventListener('abort',()=>this.removeEventListener(type,fn,options),{once:true});}
  removeEventListener(type,fn,options={}){const capture=options===true||!!options.capture;this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item.fn!==fn||item.capture!==capture));}
  emit(type,event={},capture=false){for(const item of [...this.listeners.get(type)||[]])if(item.capture===capture){item.fn(event);if(event.immediate)break;}if(!capture&&!event.immediate)this['on'+type]?.(event);}
 }
 const document=new Surface(),window=new Surface();
 class Element extends Surface{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.className='';this.style={};this.dataset={};this.attributes={};this.offsetWidth=320;this.offsetHeight=200;this.clientHeight=200;this.scrollHeight=200;this.scrollTop=0;this.scrollLeft=0;this.value='';this.selectionStart=0;this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>{this.className+=' '+name;},remove:name=>{this.className=this.className.split(' ').filter(x=>x!==name).join(' ');},toggle:(name,value)=>value?this.classList.add(name):this.classList.remove(name)};}
  get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  append(...items){for(const item of items){item.remove?.();item.parentElement=this;this.children.push(item);}}
  after(item){this.parentElement?.append(item);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  replaceChildren(...items){this.children.forEach(child=>{child.parentElement=null;});this.children=[];this.append(...items);}
  contains(target){return target===this||this.children.some(child=>child.contains?.(target));}
  matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector.startsWith('[')){const m=selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);const value=m[1].startsWith('data-')?this.dataset[m[1].slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]:this.attributes[m[1]];return m[2]===undefined?value!==undefined:value===m[2];}return this.tagName===selector.toUpperCase();}
  closest(selector){for(let node=this;node;node=node.parentElement)if(selector.split(',').some(part=>node.matches(part)))return node;return null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches?.(selector)?[child]:[]),...(child.querySelectorAll?.(selector)||[])]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  setAttribute(name,value){this.attributes[name]=String(value);}removeAttribute(name){delete this.attributes[name];}
  focus(){document.activeElement=this;document.emit('focusin',{target:this});}
  click(){if(!this.disabled)this.onclick?.({target:this,preventDefault(){},stopPropagation(){}});}
  scrollIntoView(){}getBoundingClientRect(){return{left:100,top:500,bottom:530,right:200,width:100,height:30};}
  setPointerCapture(id){this.pointer=id;}hasPointerCapture(id){return this.pointer===id;}releasePointerCapture(){this.pointer=null;}
  animate(){return{finished:Promise.resolve()};}
 }
 document.body=new Element('body');document.createElement=tag=>new Element(tag);document.activeElement=document.body;
 const context=vm.createContext({document,window,innerWidth:1000,innerHeight:800,AbortController,crypto:{randomUUID:()=>String(timerId++)},matchMedia:()=>({matches:true}),setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){if(timers.has(id))cancelled.push(timers.get(id));timers.delete(id);},icons:{search:'',folder:'',back:''},subjectIcons:{subject:''},musicIcon:'',libraryFolders:[],libraryScope:item=>item.scope||'personal',libraryAsset:item=>item,assetReference:item=>item});
 function load(path,start='export function'){const source=fs.readFileSync(require.resolve('../'+path),'utf8');vm.runInContext(source.slice(source.indexOf(start)).replaceAll('export ',''),context);}
 load('src/features/node-composer/reference-preview.mjs');
 function key(target,key='Escape',extra={}){const event={target,key,...extra,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=this.immediate=true;}};const path=[];for(let node=target;node;node=node.parentElement)path.push(node);for(const node of [...path].reverse()){node.emit('keydown',event,true);if(event.stopped)return event;}for(const node of path){node.emit('keydown',event);if(event.stopped)return event;}document.emit('keydown',event);return event;}
 const flush=()=>{const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());};
 return{document,window,Element,context,key,load,timers,cancelled,flush};
}

test('library Escape hides preview first, walks folder next, then closes once; IME remains untouched',async()=>{
 const f=fixture();f.load('src/features/node-composer/library-picker.mjs','const el=');let closed=0;
 const controller=f.context.createLibraryPicker({anchor:()=>({left:100,top:500}),getData:()=>({linked:[{key:'text:one',type:'text',title:'脚本',text:'正文'}],library:[],folders:[]}),allowed:['text'],onPick(){},onClose(){closed++;}});
 const search=controller.root.querySelector('input'),list=controller.root.querySelector('.agent-reference-list'),row=list.querySelector('[data-preview-key]');
 list.emit('pointerover',{target:row});f.flush();const preview=f.document.body.querySelector('.composer-reference-preview');assert.equal(preview.hidden,false);
 const first=f.key(search);assert.equal(first.defaultPrevented,true);assert.equal(closed,0);assert.equal(preview.isConnected,false);
 f.key(search,'Escape',{isComposing:true});f.key(search,'Escape',{keyCode:229});assert.equal(closed,0);
 f.key(search);assert.equal(closed,1);controller.close();assert.equal(closed,1);await Promise.resolve();assert.equal(controller.root.isConnected,false);
 const folder=f.context.createLibraryPicker({anchor:()=>({left:100,top:500}),getData:()=>({linked:[],library:[],folders:['场景','场景/室内']}),allowed:['image'],onPick(){},onClose(){closed++;}});
 const rootSearch=folder.root.querySelector('input');folder.root.querySelectorAll('button').find(button=>button.ariaLabel==='场景').click();
 assert.ok(folder.root.querySelector('.agent-reference-path'));f.key(rootSearch);assert.equal(folder.root.querySelector('.agent-reference-path'),null);assert.equal(closed,1);f.key(rootSearch);assert.equal(closed,2);
});

test('library portals have local ownership and external focus closes without restoring it',()=>{
 const f=fixture();f.load('src/features/node-composer/library-picker.mjs','const el=');const calls=[];
 const controller=f.context.createLibraryPicker({anchor:()=>({left:0,top:500}),getData:()=>({linked:[],library:[],folders:[]}),allowed:[],onPick(){},onClose:focus=>calls.push(focus)});
 const foreign=f.document.createElement('div');foreign.className='composer-reference-preview';f.document.body.append(foreign);foreign.focus();assert.deepEqual(calls,[false]);assert.equal(f.document.activeElement,foreign);controller.close();assert.deepEqual(calls,[false]);
});

test('destroy cancels delayed preview even if a queued timer runs late; outside and pagehide hide active media',()=>{
 const f=fixture(),track=new f.Element('div'),chip=new f.Element('button');chip.className='reference-chip';chip.dataset.referenceIndex='0';track.append(chip);f.document.body.append(track);
 const create=()=>f.context.referencePreviews(track,[{type:'text',title:'脚本',text:'正文'}],{enterDelay:300});
 const late=create();track.emit('pointerover',{target:chip});const pending=[...f.timers.values()];late.destroy();pending.forEach(fn=>fn());assert.equal(f.document.body.querySelector('.composer-reference-preview'),null);
 const unloading=create();track.emit('pointerover',{target:chip});const unloadPending=[...f.timers.values()];f.window.emit('pagehide');unloadPending.forEach(fn=>fn());assert.equal(f.document.body.querySelector('.composer-reference-preview'),null);unloading.destroy();
 const active=create();track.emit('pointerover',{target:chip});f.flush();const external=new f.Element('input');f.document.body.append(external);external.focus();assert.equal(f.document.body.querySelector('.composer-reference-preview'),null);
 track.emit('pointerover',{target:chip});f.flush();f.window.emit('pagehide');assert.equal(f.document.body.querySelector('.composer-reference-preview'),null);active.destroy();
});

test('reference sort ignores composing/consumed Escape and cancels on focus/outside/pagehide without reorder',()=>{
 for(const dismissal of ['focusin','pointerdown','pagehide']){
  const f=fixture();f.load('src/features/node-composer/reference-sort.mjs');const track=new f.Element('div'),chip=new f.Element('div'),external=new f.Element('input');chip.className='reference-chip';chip.dataset.referenceType='image';chip.dataset.referenceLabel='图片 1';track.append(chip);f.document.body.append(track,external);let reordered=0;
  const destroy=f.context.referenceSort(track,()=>reordered++,()=>{});f.key(chip,' ');assert.equal(track.dataset.sorting,'true');
  for(const extra of [{isComposing:true},{keyCode:229},{defaultPrevented:true}])f.key(chip,'Escape',extra);assert.equal(track.dataset.sorting,'true');
  if(dismissal==='pagehide')f.window.emit(dismissal);else f.document.emit(dismissal,{target:external},dismissal==='pointerdown');assert.equal(track.dataset.sorting,undefined);assert.equal(reordered,0);destroy();
 }
});

function promptFixture(library=false){
 const f=fixture();let editor;if(library)f.load('src/features/node-composer/library-picker.mjs','const el=');
 const element=new f.Element('div');f.document.body.append(element);
 class Editor{
  constructor(options){editor=this;this.options=options;this.text='@';this.isEditable=true;this.isDestroyed=false;this.view={dom:new f.Element('div'),composing:false,coordsAtPos:()=>({left:100,top:500})};element.append(this.view.dom);this.commands={focus:()=>{this.view.dom.focus();this.options.onFocus?.();this.options.onSelectionUpdate?.();}};this.state={doc:{textBetween:(from,to)=>this.text.slice(from-1,to-1),content:{size:3}},selection:{empty:true,from:2,$from:{parentOffset:1,parent:{textBetween:()=>this.text}}}};}
  getJSON(){return{text:this.text};}destroy(){this.isDestroyed=true;}setEditable(value){this.isEditable=value;}
 }
 Object.assign(f.context,{el:(tag,cls,text)=>{const node=new f.Element(tag);node.className=cls;node.textContent=text;return node;},mentionDOM:()=>new f.Element('span'),referenceIcons:{},Editor,StarterKit:{configure:()=>({})},Mention:{},promptDocument:()=>({}),documentText:doc=>doc.text,mentionItems:items=>items,assetSegments:()=>[]});
 f.load('src/features/node-composer/prompt-editor.mjs');
 const control=f.context.createNodePrompt({element,value:'@',getPolicy:()=>({enabled:library,allowed:['text']}),getItems:()=>[{key:'text:1',title:'脚本',type:'text',renderText:'Text 1'}],onChange(){},onSubmit(){throw Error('Escape must not submit');}});
 return{...f,element,control,get editor(){return editor;}};
}

test('prompt Escape remains dismissed on focus/selection and reopens only after query changes',()=>{
 const f=promptFixture();f.editor.commands.focus();assert.ok(f.document.body.querySelector('.composer-mention-menu'));
 const event={key:'Escape',preventDefault(){this.defaultPrevented=true;},stopPropagation(){},stopImmediatePropagation(){}};f.editor.options.editorProps.handleKeyDown(null,event);assert.equal(event.defaultPrevented,true);assert.equal(f.document.body.querySelector('.composer-mention-menu'),null);
 f.editor.commands.focus();assert.equal(f.document.body.querySelector('.composer-mention-menu'),null);
 f.editor.text='@脚';f.editor.state.selection.from=3;f.editor.state.selection.$from.parentOffset=2;f.editor.state.doc.content.size=4;f.editor.options.onUpdate();assert.ok(f.document.body.querySelector('.composer-mention-menu'));
 const external=new f.Element('input');f.document.body.append(external);external.focus();assert.equal(f.document.body.querySelector('.composer-mention-menu'),null);assert.equal(f.document.activeElement,external);f.control.destroy();
});

test('prompt pagehide and destroy block queued composition suggestions without changing draft',()=>{
 for(const kind of ['pagehide','destroy']){
  const f=promptFixture();f.editor.commands.focus();if(kind==='pagehide')f.window.emit(kind);else f.control.destroy();
  f.editor.options.onSelectionUpdate();assert.equal(f.document.body.querySelector('.composer-mention-menu'),null);assert.equal(f.control.getText(),'@');
 }
});


test('library initialization transfers focus without dismissing its prompt owner or reopening after cancellation',async()=>{
 const f=promptFixture(true);f.editor.commands.focus();const root=f.document.body.querySelector('.node-library-picker');assert.ok(root);assert.equal(f.document.activeElement,root.querySelector('input'));
 f.key(f.document.activeElement);await Promise.resolve();assert.equal(f.document.activeElement,f.editor.view.dom);assert.equal(f.document.body.querySelector('.node-library-picker'),null);
 f.editor.commands.focus();assert.equal(f.document.body.querySelector('.node-library-picker'),null);assert.equal(f.control.getText(),'@');f.control.destroy();
});
