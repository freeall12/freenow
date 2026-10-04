const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function fixture({resolve=async ref=>ref}={}){
 const handlers=new Map(),calls=[],notices=[];
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes=new Map();this.dataset={};this.style={};this.className='';this.hidden=false;this.inert=false;this.classList={contains:n=>this.className.split(' ').includes(n),add:(...ns)=>{this.className=[...new Set([...this.className.split(' '),...ns])].join(' ');},remove:(...ns)=>{this.className=this.className.split(' ').filter(n=>!ns.includes(n)).join(' ');},toggle:(n,on)=>on?this.classList.add(n):this.classList.remove(n)};}
  setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return this.attributes.get(k);}removeAttribute(k){this.attributes.delete(k);delete this[k];}
  matches(selector){return selector.split(',').some(raw=>{const s=raw.trim();if(s.startsWith('.'))return this.classList.contains(s.slice(1));if(s.startsWith('#'))return this.id===s.slice(1);if(s==='[hidden]')return this.hidden;if(s==='[inert]')return this.inert;const a=s.match(/^\[([^=]+)(?:=["']?([^"'\]]+)["']?)?\]$/);if(a)return a[2]===undefined?this.attributes.has(a[1]):this.getAttribute(a[1])===a[2];if(s==='dialog[open]')return this.tagName==='dialog'&&this.open;return this.tagName===s;});}
  closest(selector){for(let n=this;n;n=n.parentNode)if(n.matches(selector))return n;return null;}
  contains(node){for(let n=node;n;n=n.parentNode)if(n===this)return true;return false;}
  querySelectorAll(selector){const all=[];const walk=n=>{for(const c of n.children){all.push(c);walk(c);}};walk(this);return all.filter(n=>selector.split(',').some(s=>{const scoped=s.trim().startsWith(':scope');return (!scoped||n.parentNode===this)&&n.matches(s.trim().replace(/^:scope\s*>\s*/,''));}));}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  append(...ns){for(const n of ns){n.remove();n.parentNode=this;this.children.push(n);}}prepend(...ns){for(const n of ns.toReversed()){n.remove();n.parentNode=this;this.children.unshift(n);}}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  get firstChild(){return this.children[0];}get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  focus(){document.activeElement=this;}pause(){this.paused=true;}load(){this.loads=(this.loads||0)+1;}play(){return Promise.resolve();}animate(){return {finished:Promise.resolve()};}
 }
 const document={head:new Element('head'),body:new Element('body'),createElement:t=>new Element(t),querySelector:s=>document.body.querySelector(s),querySelectorAll:s=>document.body.querySelectorAll(s),addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},dispatchEvent(e){for(const fn of handlers.get(e.type)||[])fn(e);}};
 const canvas=new Element('main');canvas.id='canvas';document.body.append(canvas);
 const n={id:'video',type:'video',video:'/main.mp4',x:53284.3125,y:-32.875,width:435.25,height:250.125,videoHistory:[{options:[{video:'/main.mp4',width:320,height:180},{video:'/portrait.mp4',width:180,height:320},{video:'/square.mp4',width:256,height:256},{video:'/fourth.mp4',width:320,height:180},{video:'/fifth.mp4',width:320,height:180}]},{options:[{video:'/other.mp4',width:320,height:180}]}]},state={nodes:[n],selected:[],view:{x:.125,y:-.375,scale:.55}};
 const owner=new Element('div'),body=new Element('div');body.className='node-body';owner.append(body);canvas.append(owner);
 const app={getState:()=>state,getNodeElement:()=>owner,render:()=>document.dispatchEvent({type:'canvas:render'}),select(id){state.selected=[id];this.render();},updateNode(id,patch){Object.assign(n,patch);this.render();},notify:m=>notices.push(m)};
 const window={CanvasApp:app,CanvasLibrary:{isFavorite:()=>false},NodeEditor:{getConfig:()=>({}),closePopover(){},invalidate(){}},NodeActions:{closePop(){}},LocalAssets:{url(ref){calls.push(ref);return resolve(ref);}}};
 const context=vm.createContext({core:await import('../src/features/video-history/core.mjs'),icons:(await import('../src/features/video-history/icons.mjs')).default,...await import('../src/features/local-resource-migration/display-media.mjs'),window,document,structuredClone,matchMedia:()=>({matches:true}),Event:class{constructor(type){this.type=type;}},CSS:{escape:v=>v},console});
 const source=fs.readFileSync(path.join(__dirname,'../src/features/video-history/ui.mjs'),'utf8').replace(/^import .*;\n/gm,'').replace("new URL('./styles.css',import.meta.url).href","'src/features/video-history/styles.css'");vm.runInContext(source,context);
 function event(type,target,extra={}){const e={type,target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};document.dispatchEvent(e);return e;}
 return {n,state,owner,body,canvas,document,window,calls,notices,Element,event,open(){window.VideoHistory.open(n.id);return owner.querySelector('.video-history-gallery');}};
}
test('mixed history cards retain per-item aspect ratios while grid uses first-item fractional cells',async()=>{
 const f=await fixture(),before=JSON.stringify(f.n);f.open();await settle();const cards=f.owner.querySelectorAll('.video-history-card'),cellHeight=435.25*180/320;
 assert.equal(cards[0].style.height,cellHeight+'px');assert.equal(cards[1].style.height,435.25*320/180+'px');assert.equal(cards[2].style.height,'435.25px');assert.equal(cards[1].style.left,'451.25px');assert.equal(cards[4].style.top,-(cellHeight+16)+'px');
 const video=cards[1].querySelector('video');video.videoWidth=200;video.videoHeight=400;video.duration=3;video.onloadedmetadata();assert.equal(cards[1].style.height,'870.5px');assert.equal(cards[4].style.top,-(cellHeight+16)+'px');assert.equal(JSON.stringify(f.n),before,'metadata stays in transient history copy');
 f.window.VideoHistory.close();assert.equal(f.owner.style.height,'250.125px');assert.equal(f.n.x,53284.3125);assert.equal(f.n.y,-32.875);
});
test('small preview metadata never overwrites original source resolution or duration on set-main',async()=>{
 const f=await fixture();f.n.videoHistory[0].options[0]={video:'asset:full',preview:'asset:small',width:1920,height:1080,duration:8};f.open();await settle();const card=f.owner.querySelector('.video-history-card'),video=card.querySelector('video');video.videoWidth=160;video.videoHeight=90;video.duration=2;video.onloadedmetadata();await card.onclick({stopPropagation(){}});assert.equal(f.n.video,'asset:full');assert.deepEqual({...f.n.videoMetadata},{width:1920,height:1080,duration:8});
 const g=await fixture();g.n.videoHistory[0].options[0]={video:'asset:unknown-full',preview:'asset:small'};g.open();await settle();const unknown=g.owner.querySelector('.video-history-card'),small=unknown.querySelector('video');small.videoWidth=90;small.videoHeight=160;small.duration=2;small.onloadedmetadata();assert.equal(unknown.style.height,435.25*160/90+'px');await unknown.onclick({stopPropagation(){}});assert.deepEqual({...g.n.videoMetadata},{width:null,height:null,duration:null});
});
test('asset preview fallback and posters share source and resolved URL policy',async()=>{
 const f=await fixture({resolve:async ref=>'blob:local-'+ref}),option=f.n.videoHistory[0].options[0];Object.assign(option,{video:'asset:original',preview:'asset:preview',poster:'asset:poster'});f.open();await settle();const video=f.owner.querySelector('video');assert.equal(video.src,'blob:local-asset:preview');assert.equal(video.poster,'blob:local-asset:poster');video.onerror();await settle();assert.equal(video.src,'blob:local-asset:original');assert.ok(f.calls.includes('asset:original'));
});
test('official preview or resolver redirect cannot reach media sinks; local original remains usable',async()=>{
 const f=await fixture({resolve:async ref=>ref==='asset:redirect'?'https://app.tapnow.media/private.mp4':'blob:'+ref});Object.assign(f.n.videoHistory[0].options[0],{video:'asset:local',preview:'https://app.tapnow.media/small.mp4',poster:'https://app.tapnow.media/poster.png'});f.open();await settle();let video=f.owner.querySelector('video');assert.equal(video.src,'blob:asset:local');assert.equal(video.poster,undefined);assert.ok(!f.calls.some(ref=>ref.startsWith('https:')));
 f.window.VideoHistory.close();f.n.videoHistory[0].options[0]={video:'asset:redirect'};f.open();await settle();video=f.owner.querySelector('video');assert.equal(video.src,undefined);assert.match(f.owner.querySelector('.video-history-error').children[0].textContent,/原站媒体待导入/);
});
test('retry resolves fresh local bytes and never reassigns a rejected original reference',async()=>{
 let ready=false;const f=await fixture({resolve:async ref=>{if(ref==='asset:main'&&!ready)throw Error('本地视频缺失');return 'blob:'+ref;}});f.n.videoHistory[0].options[0]={video:'asset:main'};f.open();await settle();const card=f.owner.querySelector('.video-history-card'),video=card.querySelector('video'),error=card.querySelector('.video-history-error');assert.ok(error);ready=true;await error.querySelector('button').onclick({stopPropagation(){}});await settle();assert.equal(video.src,'blob:asset:main');assert.equal(card.querySelector('.video-history-error'),null);
});
test('clicking a failed video overlay cannot bubble into selecting an unavailable main video',async()=>{
 const f=await fixture({resolve:async ref=>{if(ref==='asset:missing')throw Error('本地视频缺失');return ref;}});f.n.videoHistory[0].options[1]={video:'asset:missing'};f.open();await settle();const card=f.owner.querySelectorAll('.video-history-card')[1],overlay=card.querySelector('.video-history-error');let stopped=false;const e={target:overlay.children[0],stopPropagation(){stopped=true;}};for(let current=e.target;current&&!stopped;current=current.parentNode)await current.onclick?.(e);assert.equal(stopped,true);assert.equal(f.n.video,'/main.mp4');assert.equal(f.window.VideoHistory.activeId,f.n.id);
});
test('late asset resolves and metadata after batch switch or close cannot touch replacement gallery',async()=>{
 let release;const pending=new Promise(r=>release=r);const f=await fixture({resolve:ref=>ref==='asset:slow'?pending:Promise.resolve(ref)});f.n.videoHistory[0].options[0]={video:'asset:slow',poster:'asset:slow'};f.open();const old=f.owner.querySelector('video'),lateMetadata=old.onloadedmetadata;await f.owner.querySelectorAll('[role=tab]')[1].onclick({stopPropagation(){}});const replacement=f.owner.querySelector('video'),height=f.owner.style.height;release('blob:slow');await settle();old.videoWidth=10;old.videoHeight=200;lateMetadata();assert.equal(old.src,undefined);assert.equal(old.poster,undefined);assert.equal(f.owner.style.height,height);assert.equal(replacement.src,'/other.mp4');
 const late=replacement.onloadedmetadata;f.window.VideoHistory.close();replacement.videoWidth=10;replacement.videoHeight=500;late();assert.equal(f.owner.style.height,'250.125px');assert.equal(replacement.src,undefined);
});
test('history yields Escape and pointerdown to native dialogs, visible menus, Agent and IME',async()=>{
 const f=await fixture(),root=f.open(),dialog=new f.Element('dialog');dialog.open=true;f.document.body.append(dialog);let e=f.event('keydown',dialog,{key:'Escape'});assert.equal(e.stopped,undefined);f.event('pointerdown',dialog);assert.equal(f.window.VideoHistory.activeId,f.n.id);dialog.remove();
 const menu=new f.Element('div');menu.setAttribute('role','menu');f.document.body.append(menu);e=f.event('keydown',root,{key:'Escape'});assert.equal(e.stopped,undefined);f.event('pointerdown',f.canvas);assert.equal(f.window.VideoHistory.activeId,f.n.id);menu.hidden=true;
 const agent=new f.Element('aside');agent.id='agent-panel';f.document.body.append(agent);f.event('keydown',agent,{key:'Escape'});f.event('pointerdown',agent);assert.equal(f.window.VideoHistory.activeId,f.n.id);
 for(const extra of [{isComposing:true},{keyCode:229},{defaultPrevented:true}]){e=f.event('keydown',root,{key:'Escape',...extra});assert.equal(e.stopped,undefined);assert.equal(f.window.VideoHistory.activeId,f.n.id);}
 e=f.event('keydown',root,{key:'Escape'});assert.equal(e.stopped,true);assert.equal(f.window.VideoHistory.activeId,undefined);assert.equal(f.document.activeElement,f.owner.querySelector('.video-history-count'));
});
test('clean canvas outside closes while history controls and unrelated text input retain ownership',async()=>{
 const f=await fixture(),root=f.open();f.event('pointerdown',root);assert.equal(f.window.VideoHistory.activeId,f.n.id);const input=new f.Element('input');f.document.body.append(input);const e=f.event('keydown',input,{key:'Escape'});assert.equal(e.stopped,undefined);assert.equal(f.window.VideoHistory.activeId,f.n.id);f.event('pointerdown',f.canvas);assert.equal(f.window.VideoHistory.activeId,undefined);
});
