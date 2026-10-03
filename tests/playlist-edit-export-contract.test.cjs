'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('../canvas-playlist.js');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(){
 const handlers=new Map(),windowHandlers=new Map(),created=[],downloads=[],reads=[],posts=[],notices=[],history=[];let project='initial',guard;
 const document={activeElement:null,addEventListener(type,fn){const items=handlers.get(type)||[];items.push(fn);handlers.set(type,items);}};
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.style={};this.className='';this.open=false;this.paused=true;this.clientWidth=1200;this.offsetWidth=160;this.offsetHeight=120;this.classList={add:name=>{this.className+=' '+name;},toggle:(name,on)=>{this.className=this.className.split(' ').filter(v=>v&&v!==name).concat(on?[name]:[]).join(' ');}};}
  append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}replaceChildren(...items){this.children.forEach(item=>item.parentNode=null);this.children=[];this.append(...items);}remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}get firstChild(){return this.children[0];}
  set innerHTML(value){this.html=value;this.replaceChildren();}get innerHTML(){return this.html;}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}
  set src(value){this.attributes.src=value;this.duration=8;this.videoWidth=320;this.videoHeight=180;queueMicrotask(()=>this.onloadedmetadata?.());}get src(){return this.attributes.src;}
  removeAttribute(key){delete this.attributes[key];}load(){}pause(){this.paused=true;this.onpause?.();}play(){this.paused=false;return Promise.resolve();}
  contains(target){return target===this||this.children.some(child=>child.contains(target));}
  matches(selector){if(selector==='dialog[open]')return this.tagName==='dialog'&&this.open;if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));const attr=selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);if(attr)return attr[2]===undefined?this.attributes[attr[1]]!==undefined:this.attributes[attr[1]]===attr[2];return selector===this.tagName;}
  closest(selector){for(let current=this;current;current=current.parentNode)if(selector.split(',').some(part=>current.matches(part)))return current;return null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(){}focus(){document.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;this.onclose?.();}getBoundingClientRect(){return {left:0,top:0,bottom:104,width:960,height:104};}
 }
 document.body=new Element('body');document.createElement=tag=>new Element(tag);document.createTextNode=text=>Object.assign(new Element('#text'),{textContent:text});const canvas=new Element('main'),bar=new Element('div'),shell=new Element('section');shell.className='node';shell.dataset.id='p';for(const name of ['node-title','node-body','port']){const item=new Element('div');item.className=name;shell.append(item);}document.body.append(canvas,bar);canvas.append(shell);
 const clip=(id,url,start=0,duration=4)=>({id,url,sourceId:'v',title:id,sourceDuration:8,trimStart:start,duration}),playlist={id:'p',type:'playlist',title:'测试时间线',x:0,y:450,width:960,clips:[clip('a','/qa/red.mp4',1,4),clip('b','/qa/blue.mp4',0,3)]},state={nodes:[playlist],selected:['p'],view:{x:0,y:0,scale:1}};
 document.querySelector=selector=>({'#canvas':canvas,'#node-toolbar':bar}[selector]||document.body.querySelector(selector));
 const app={getState:()=>state,getNodeElement:()=>shell,render:()=>{for(const fn of handlers.get('canvas:render')||[])fn({});},select:id=>{state.selected=[id];},setView(){},notify:message=>notices.push(message),updateNode(id,patch){history.push(structuredClone(playlist));Object.assign(playlist,patch);this.render();},createConnected:(...args)=>{created.push(args);return args[1];}};
 let fetchImpl=async(url,options={})=>{if(url==='/api/media/playlist'){posts.push(JSON.parse(options.body));return new Response('synthetic merged bytes',{headers:{'Content-Type':'video/mp4'}});}reads.push({url,options});return new Response(String(url),{headers:{'Content-Type':'video/mp4'}});};
 const window={CanvasApp:app,CanvasPlaylistCore:core,CanvasClipboard:require('../canvas-clipboard.js'),CanvasProjects:{id:()=>project,registerNavigationGuard:fn=>guard=fn},location:{href:'http://localhost:4173/',origin:'http://localhost:4173'},CANVAS_COMMAND_ICONS:{},UI_ICONS:{},LocalAssets:{url:async value=>value},PileArchive:{zip:files=>{window.lastZip=files;return new Blob(['zip']);}},LocalMedia:{asDataUrl:async blob=>'data:video/mp4;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'),download:(blob,name)=>downloads.push({blob,name}),process:async()=>new Blob(['trimmed'],{type:'video/mp4'})},addEventListener:(type,fn)=>windowHandlers.set(type,fn)};
 let sequence=0;vm.runInNewContext(fs.readFileSync(require.resolve('../canvas-playlist-ui.js'),'utf8'),{window,document,localStorage:{getItem:()=> 'true'},innerWidth:1600,innerHeight:900,crypto:{randomUUID:()=> 'split-'+(++sequence)},AbortController,Map,Set,WeakMap,JSON,Object,URL,fetch:(...args)=>fetchImpl(...args),requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout,clearTimeout,queueMicrotask});
 const key=(value,target=canvas,patch={})=>{const event={key:value,target,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...patch};for(const handler of handlers.get('keydown')||[]){handler(event);if(event.stopped)break;}return event;};
 return {window,document,Element,state,playlist,created,downloads,reads,posts,notices,history,canvas,key,api:window.CanvasPlaylist,clip,setFetch:value=>fetchImpl=value,switchProject:()=>project='other',guard:()=>guard(),pagehide:()=>windowHandlers.get('pagehide')?.(),undo:()=>{Object.assign(playlist,history.pop());app.render();}};
}

test('Q/E source-offset trims operate only on the playhead clip with a one-second minimum',()=>{
 const clips=[{id:'a',url:'a',sourceDuration:12,trimStart:2,duration:6},{id:'b',url:'b',sourceDuration:8,trimStart:1,duration:4}];
 assert.deepEqual(core.trimAt(clips,8,'left').map(c=>[c.trimStart,c.duration]),[[2,6],[3,2]]);assert.deepEqual(core.trimAt(clips,8,'right').map(c=>[c.trimStart,c.duration]),[[2,6],[1,2]]);
 assert.throws(()=>core.trimAt(clips,9.5,'left'),/至少1秒/);assert.throws(()=>core.trimAt(clips,6.5,'right'),/至少1秒/);assert.deepEqual(clips.map(c=>c.duration),[6,4]);
});
test('C/Q/E use the preview playhead and each actual edit creates one undo checkpoint',async()=>{
 for(const [key,ranges]of [['c',[[1,2],[3,2],[0,3]]],['q',[[3,2],[0,3]]],['e',[[1,2],[0,3]]]]){
  const f=fixture(),before=structuredClone(f.playlist.clips);f.api.open('p',false);await f.api.seek(2);const event=f.key(key);await Promise.resolve();assert.equal(event.defaultPrevented,true);assert.deepEqual(Array.from(f.playlist.clips,c=>[c.trimStart,c.duration]),ranges);assert.equal(f.history.length,1);f.undo();assert.deepEqual(f.playlist.clips,before);
 }
});
test('playlist shortcuts yield to text/menu/dialog/IME/combinations and unrelated focus',async()=>{
 const f=fixture();f.api.open('p',false);await f.api.seek(2);
 for(const tag of ['input','textarea','select']){const field=new f.Element(tag);f.canvas.append(field);assert.equal(f.key('q',field).defaultPrevented,undefined);}
 const field=new f.Element('div');field.setAttribute('contenteditable','true');f.canvas.append(field);assert.equal(f.key('e',field).defaultPrevented,undefined);
 const outside=new f.Element('button');f.document.body.append(outside);assert.equal(f.key('c',outside).defaultPrevented,undefined);
 for(const patch of [{isComposing:true},{keyCode:229},{defaultPrevented:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{repeat:true}])assert.equal(f.key('q',f.canvas,patch).stopped,undefined);
 const dialog=new f.Element('dialog');f.document.body.append(dialog);dialog.showModal();assert.equal(f.key('c').defaultPrevented,undefined);assert.equal(f.history.length,0);
});
test('originals download unique complete sources in timeline first-occurrence order',async()=>{
 const f=fixture();f.playlist.clips=[f.clip('blue-1','/qa/blue.mp4',2,2),f.clip('red','/qa/red.mp4',1,4),f.clip('blue-2','/qa/blue.mp4',4,2)];
 const files=await f.api.originals('p');assert.deepEqual(f.reads.map(read=>read.url),['/qa/blue.mp4','/qa/red.mp4']);assert.equal(files.length,2);assert.ok(files[0].name.startsWith('01-blue-1'));assert.ok(files[1].name.startsWith('02-red'));assert.equal(Buffer.from(files[0].bytes).toString(),'/qa/blue.mp4');assert.equal(f.downloads.length,1);for(const {options}of f.reads){assert.equal(options.redirect,'error');assert.equal(options.mode,'same-origin');}
});
test('merged request preserves captured ranges/order and reads duplicate source only once',async()=>{
 const f=fixture();f.playlist.clips=[f.clip('a','/qa/red.mp4',1,2),f.clip('b','/qa/blue.mp4',2,3),f.clip('c','/qa/red.mp4',5,1)];await f.api.exportMerged('p',true);
 assert.equal(f.reads.length,2);assert.deepEqual(f.posts[0].clips.map(clip=>[clip.start,clip.duration]),[[1,2],[2,3],[5,1]]);assert.equal(f.posts[0].clips[0].data,f.posts[0].clips[2].data);assert.equal(f.created.length,1);assert.equal(f.api.pending,0);
});
test('double export cannot issue a second request and source/project changes reject late results',async()=>{
 for(const reason of ['source','project','deleted']){
  const f=fixture(),entered=deferred(),gate=deferred();f.setFetch(async(url,options={})=>{if(url==='/api/media/playlist'){f.posts.push(JSON.parse(options.body));entered.resolve();await gate.promise;return new Response('late merged bytes',{headers:{'Content-Type':'video/mp4'}});}return new Response('source',{headers:{'Content-Type':'video/mp4'}});});
  const exporting=f.api.exportMerged('p',true);await entered.promise;assert.match(f.guard(),/正在导出/);await assert.rejects(f.api.exportMerged('p',true),/正在导出/);assert.equal(f.posts.length,1);
  if(reason==='source')f.playlist.clips[0].trimStart=2;if(reason==='project')f.switchProject();if(reason==='deleted')f.state.nodes=[];gate.resolve();await assert.rejects(exporting,/来源时间线或项目已变化/);assert.equal(f.created.length,0);assert.equal(f.downloads.length,0);assert.equal(f.api.pending,0);
 }
});
test('cancel or pagehide during late final conversion never applies a video',async()=>{
 for(const cancel of ['button','pagehide']){
  const f=fixture(),entered=deferred(),gate=deferred();let conversions=0;f.window.LocalMedia.asDataUrl=async()=>{if(++conversions===3){entered.resolve();await gate.promise;}return 'data:video/mp4;base64,AA==';};
  const task=f.api.exportMerged('p',true);await entered.promise;if(cancel==='button')f.document.body.querySelector('.playlist-export-progress').querySelector('button').onclick();else f.pagehide();gate.resolve();await task;assert.equal(f.created.length,0);assert.equal(f.api.pending,0);
 }
});
test('originals/extract reject late stale source; unlocalized external media never fetches',async()=>{
 for(const method of ['originals','extract']){const f=fixture(),entered=deferred(),gate=deferred();f.setFetch(async()=>{entered.resolve();await gate.promise;return new Response('source',{headers:{'Content-Type':'video/mp4'}});});const task=method==='originals'?f.api.originals('p'):f.api.extract('p','a');await entered.promise;f.switchProject();gate.resolve();await assert.rejects(task,/来源时间线或项目已变化/);assert.equal(f.created.length,0);assert.equal(f.downloads.length,0);}
 const f=fixture();f.playlist.clips[0].url='https://files.tapnow.media/unknown.mp4';await assert.rejects(f.api.originals('p'),/待导入本地/);assert.equal(f.reads.length,0);
});
test('append rejects a changed source playlist or source type across its async boundary',async()=>{
 for(const change of ['clips','type']){
  const f=fixture(),source={id:'source-playlist',type:'playlist',clips:[f.clip('source-old','/qa/red.mp4',0,2)]};f.state.nodes.push(source);
  const appending=f.api.append('p',source);if(change==='clips')source.clips=[f.clip('source-new','/qa/blue.mp4',1,3)];else source.type='video';
  await assert.rejects(appending,/来源片段已变化/);assert.equal(f.history.length,0);assert.equal(f.playlist.clips.length,2);
 }
});
