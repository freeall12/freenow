const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policyReady=import('../src/features/local-resource-migration/display-media.mjs');
const read=file=>fs.readFileSync(require.resolve('../'+file),'utf8');
const between=(source,start,end)=>{const index=source.indexOf(start);assert.ok(index>=0,start);const last=source.indexOf(end,index+start.length);assert.ok(last>index,end);return source.slice(index,last);};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const original='https://files.tapnow.media/retained.png';
function dom(policy){
 const writes=[],clicks=[];
 class Element{
  constructor(tag,cls='',text){this.tag=tag;this.value='';this.className=cls;this.textContent=text||'';this.children=[];this.attributes={};this.dataset={};this.style={setProperty(){}};this.isConnected=false;this.paused=true;this.currentTime=0;this.volume=1;this.duration=1;this.listeners={};this.classList={add(){},remove(){},toggle(){},contains:()=>false};}
  set src(value){writes.push({kind:'src',value});assert.equal(policy.isOriginalMediaRef(value),false);this._src=value;}
  get src(){return this._src;}
  set poster(value){writes.push({kind:'poster',value});assert.equal(policy.isOriginalMediaRef(value),false);this._poster=value;}
  get poster(){return this._poster;}
  set href(value){writes.push({kind:'href',value});assert.equal(policy.isOriginalMediaRef(value),false);this._href=value;}
  get href(){return this._href;}
  attach(connected){this.isConnected=connected;this.children.forEach(child=>child.attach(connected));}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);child.attach(this.isConnected);}}
  replaceChildren(...children){this.children.forEach(child=>child.attach(false));this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];if(key==='src')this._src=undefined;}
  querySelectorAll(selector){const found=[];const visit=node=>{for(const child of node.children){if(selector==='button'&&child.tag==='button'||selector==='video'&&child.tag==='video'||selector[0]==='.'&&child.className.split(' ').includes(selector.slice(1)))found.push(child);visit(child);}};visit(this);return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  remove(){this.attach(false);if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  addEventListener(name,fn){this.listeners[name]=fn;}pause(){this.paused=true;}load(){this.loads=(this.loads||0)+1;}play(){this.paused=false;return Promise.resolve();}
  click(){clicks.push(this.href);}focus(){}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
 }
 const body=new Element('body');body.attach(true);
 const el=(...args)=>new Element(...args),document={body,activeElement:null,createElement:el};
 return {Element,body,el,document,writes,clicks};
}
function context(values){return vm.createContext({...values,console,Promise,structuredClone,clearTimeout(){},setTimeout(){return 1;}});}

test('LocalAssets passthrough blocks retained original domains before storage or consumption; local refs remain usable',async()=>{
 const policy=await policyReady;let opened=0;const window={CanvasResourceDisplayReady:Promise.resolve(policy)};
 const c=context({window,indexedDB:{open(){opened++;assert.fail('remote refs do not read local storage');}}});vm.runInContext(read('local-assets.js'),c);
 for(const source of [original,'//tapnow.ai/a','https://sub.tapnow.art./a','/\\files.tapnow.media/a','https://tamaredge.top/a','https://conversation-service-131786869360.asia-northeast1.run.app/a'])await assert.rejects(window.LocalAssets.url(source),{code:'original_service_blocked'});
 for(const source of ['/api/generation/media/local','qa/local.png','data:image/png;base64,AA','blob:http://localhost/local','https://independent.example.test/local.png'])assert.equal(await window.LocalAssets.url(source),source);
 assert.equal(opened,0);
});

test('node candidate picker and legacy refs block original requests while preserving records and mixed local main media',async()=>{
 const policy=await policyReady,f=dom(policy),nodes=[{id:'target',type:'image',generation:{refs:[original,'data:image/png;base64,AA']}},{id:'old',type:'image',image:original,title:'原图片'},{id:'mixed-image',type:'image',image:original,fullImage:'data:image/png;base64,LOCAL',title:'本地图'},{id:'mixed-video',type:'video',image:original,video:'data:video/mp4;base64,LOCAL',title:'本地视频'}],snapshot=JSON.stringify(nodes),notices=[];
 const panel=f.el('section');panel.hidden=false;f.body.append(panel);
 const window={CanvasConnections:{validate:()=>null},LocalAssets:{url:async value=>value},CanvasLibrary:{items:[]}};
 const c=context({window,document:f.document,mediaDisplay:policy,mediaDisplayReady:Promise.resolve(policy),unavailableMedia:'原站资源已停用，请重新导入本地资源',make:f.el,button:(label,onclick,cls)=>Object.assign(f.el('button',cls,label),{onclick}),app:{getState:()=>({nodes}),notify:message=>notices.push(message)},node:nodes[0],activeId:'target',config:nodes[0].generation,panel,closePopover(){},getConfig:n=>n.generation,draw(){},icon:()=>'',focusEdit:null,composerLayout:null,selectReference(){},save(){},dragRef:null});
 const source=read('node-editor.js');vm.runInContext(between(source,'  function candidateReferenceSource(','  const $ =')+between(source,'  function chooseReference(','  function frameMode(')+between(source,'  function legacyReferenceRow(','  function refreshFooter('),c);
 c.chooseReference();const row=c.legacyReferenceRow();f.body.append(row);await flush();
 const picker=f.body.querySelector('.asset-picker'),buttons=picker.querySelectorAll('.asset-tile');
 assert.equal(buttons[1].disabled,true);assert.match(buttons[1].title,/重新导入/);assert.notEqual(buttons[2].disabled,true);assert.notEqual(buttons[3].disabled,true);
 assert.equal(buttons[2].children[0].src,'data:image/png;base64,LOCAL');
 assert.equal(row.children.find(item=>item.className==='reference-chip').children[0].src,undefined);
 assert.equal(f.writes.some(write=>policy.isOriginalMediaRef(write.value)),false);assert.equal(JSON.stringify(nodes),snapshot);
 await buttons[1].onclick();assert.match(notices[0],/重新导入/);
});

test('node reference images remain inert until policy loads; detached late images cannot consume media',async()=>{
 const policy=await policyReady,f=dom(policy);let resolve;const ready=new Promise(done=>resolve=done),window={LocalAssets:{url:async value=>value}};
 const c=context({window,mediaDisplay:null,mediaDisplayReady:ready,unavailableMedia:'请重新导入本地资源'});vm.runInContext(between(read('node-editor.js'),'  function displayReferenceImage(','  const $ ='),c);
 const blocked=f.el('img'),local=f.el('img'),detached=f.el('img');f.body.append(blocked,local,detached);
 c.displayReferenceImage(blocked,original);c.displayReferenceImage(local,'data:image/png;base64,AA');c.displayReferenceImage(detached,'data:image/png;base64,LATE');detached.remove();assert.deepEqual(f.writes,[]);
 resolve(policy);await flush();assert.equal(blocked.src,undefined);assert.match(blocked.title,/重新导入/);assert.equal(local.src,'data:image/png;base64,AA');assert.equal(detached.src,undefined);
});

function previewFixture(policy,resource,type='image',assetResolver=async value=>value){
 const f=dom(policy),s={resources:[resource],index:0,node:{id:'node',title:'媒体'},type,mediaRevision:0,frame:f.el('div'),loading:f.el('div'),status:f.el('div')};f.body.append(s.frame);
 const calls=[],window={LocalAssets:{url:async source=>{calls.push(source);return assetResolver(source);}}};
 const c=context({window,document:f.document,displayMediaRef:policy.displayMediaRef,isOriginalMediaRef:policy.isOriginalMediaRef,unavailableMedia:'原站资源已停用，请重新导入本地资源',el:f.el,session:s,selected:s=>s.resources[s.index],release:root=>root?.remove(),videoControls(){},imageEvents(){},facts(){},place(){},motion:()=>Promise.resolve()});
 const source=read('media-preview-ui.mjs');vm.runInContext(between(source,'async function resolvePreviewMedia(','const app=')+between(source,'async function loadMedia(','function open('),c);
 return {...f,c,s,calls};
}
test('preview blocks original primary, history/return poster and asset resolver redirects without rewriting source records',async()=>{
 const policy=await policyReady;
 for(const type of ['image','video']){
  const resource={src:original,poster:original},snapshot=JSON.stringify(resource),f=previewFixture(policy,resource,type);await f.c.loadMedia(f.s);await flush();
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.calls,[]);assert.match(f.s.layer.querySelector('.media-viewer-error').children[0].textContent,/重新导入/);assert.equal(JSON.stringify(resource),snapshot);
  const thumbnail=f.el('img');f.body.append(thumbnail);f.c.displayPoster(thumbnail,original);await flush();assert.equal(thumbnail.src,undefined);
 }
 const f=previewFixture(policy,{src:'asset:local'},'image',async()=>original);await f.c.loadMedia(f.s);assert.deepEqual(f.writes,[]);assert.match(f.s.layer.querySelector('.media-viewer-error').children[0].textContent,/重新导入/);
});
test('preview keeps local main video/image usable when only the secondary poster is original',async()=>{
 const policy=await policyReady;
 for(const type of ['image','video']){
  const resource={src:'data:'+type+'/fixture;base64,LOCAL',poster:original},snapshot=JSON.stringify(resource),f=previewFixture(policy,resource,type);await f.c.loadMedia(f.s);await flush();
  assert.deepEqual(f.writes,[{kind:'src',value:resource.src}]);assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(resource),snapshot);
 }
});

function videoFixture(policy,node,ready=Promise.resolve(policy),assetResolver=async value=>value){
 const f=dom(policy),state={nodes:[node],selected:[node.id]},nodeBody=f.el('div');f.body.append(nodeBody);const notices=[],assetReads=[],trims=[],downloads=[],players=new Map();
 const window={CANVAS_MENU_ICONS:{},CanvasLibrary:{isFavorite:()=>false},LocalAssets:{url:async source=>{assetReads.push(source);return assetResolver(source);}},LocalMedia:{trim:async value=>{trims.push(value);return {blob:{}};},download:(...args)=>downloads.push(args)}};
 const c=context({window,document:f.document,app:{getState:()=>state,preview(){}},$:()=>nodeBody,el:f.el,btn:(label,onclick,cls)=>Object.assign(f.el('button',cls,label),{onclick}),players,source:n=>n.video,muted:true,hoveredId:null,editing:()=>false,notify:message=>notices.push(message),mediaDisplayReady:ready,unavailableMedia:'原站资源已停用，请重新导入本地资源'});
 const source=read('src/features/video-tools/entry.js');vm.runInContext(between(source,'  function player(','  async function extend(')+between(source,'  function inlinePlayer(','  function editing('),c);
 return {...f,c,state,notices,assetReads,trims,downloads,players};
}
test('inline player waits for policy, blocks originals, and rejects late or original asset resolution',async()=>{
 const policy=await policyReady;let resolve;const ready=new Promise(done=>resolve=done),node={id:'old',video:original,image:original},snapshot=JSON.stringify(node),f=videoFixture(policy,node,ready);
 const player=f.c.inlinePlayer(node);assert.deepEqual(f.writes,[]);resolve(policy);await flush();assert.deepEqual(f.writes,[]);assert.deepEqual(f.assetReads,[]);assert.match(player.wrap.querySelector('.video-player-error').children[0].textContent,/重新导入/);assert.equal(JSON.stringify(node),snapshot);
 let release;const lateNode={id:'late',video:'asset:local',image:original},g=videoFixture(policy,lateNode,Promise.resolve(policy),()=>new Promise(done=>release=done));const late=g.c.inlinePlayer(lateNode);await flush();late.wrap.remove();release('data:video/mp4;base64,LATE');await flush();assert.deepEqual(g.writes,[]);
 const bad={id:'bad',video:'asset:bad',image:original},h=videoFixture(policy,bad,Promise.resolve(policy),async()=>original);h.c.inlinePlayer(bad);await flush();assert.deepEqual(h.writes,[]);
});
test('video local main remains usable; original download and clip export do not touch resolvers or executors',async()=>{
 const policy=await policyReady,node={id:'mixed',video:'data:video/mp4;base64,LOCAL',image:original},f=videoFixture(policy,node);f.c.inlinePlayer(node);await flush();assert.deepEqual(f.writes,[{kind:'src',value:node.video}]);
 await f.c.downloadVideo({...node,video:original});await f.c.downloadVideo({...node,video:original,clip:{start:0,end:1}});assert.deepEqual(f.clicks,[]);assert.deepEqual(f.trims,[]);assert.equal(f.assetReads.includes(original),false);
 await f.c.downloadVideo(node);assert.deepEqual(f.clicks,[node.video]);await f.c.downloadVideo({...node,clip:{start:0,end:1}});assert.equal(f.trims.length,1);assert.equal(f.downloads.length,1);
});
