'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('../src/features/library-asset-roundtrip/core.js');
const image={id:'source',type:'image',title:'原始高分图',x:54015.125,y:-4155.375,width:446.25,height:251.125,image:'asset:thumbnail',fullImage:'asset:original',pixelWidth:1920,pixelHeight:1080,currentSourceFileId:'file-original',provenance:{kind:'generation-result',mediaSource:'asset:original',model:'original-model',prompt:'原始提示词',taskId:'historical-task'},tool:'image-editor',editorDoc:{objects:['source']},pendingOperation:'image.generate',generationRun:{runId:'running'},imageHistory:[{options:[{image:'asset:old'}]}]};
const capture=node=>core.capture(node,{id:'saved',name:node.title,folder:'Others'});
test('ordinary library save/restore retains original media rather than preview and source dimensions',()=>{
 const before=structuredClone(image),item=capture(image),patch=core.restore(JSON.parse(JSON.stringify(item)));
 assert.equal(item.fullImage,'asset:original');assert.equal(item.image,'asset:thumbnail');assert.equal(patch.fullImage,'asset:original');assert.equal(patch.pixelWidth,1920);assert.equal(patch.pixelHeight,1080);assert.equal(patch.width,446.25);assert.equal(patch.height,251.125);assert.equal(patch.currentSourceFileId,'file-original');assert.deepEqual(patch.provenance,image.provenance);assert.deepEqual(image,before);
 for(const field of ['x','y','id','parentId','nodeId','tool','editorDoc','pendingOperation','generationRun','imageHistory','videoHistory','worldResource','agentImageEditor'])assert.equal(patch[field],undefined);
});
test('saved provenance is an independent original-result receipt and never the current prompt draft',()=>{
 const node={...image,generation:{prompt:'Edited next request',model:'next-model'}},item=capture(node);node.provenance.prompt='changed after capture';assert.equal(item.provenance.prompt,'原始提示词');assert.equal(item.provenance.model,'original-model');assert.equal(item.generation,undefined);assert.equal(item.provenance.taskId,'historical-task');
});
test('video roundtrip keeps local primary, poster, clip, dimensions, duration and analysis source range',()=>{
 const n={id:'video',type:'video',title:'剪辑',image:'asset:poster',video:'asset:video',width:435.125,height:244.75,videoMetadata:{width:320,height:180,duration:4},clip:{start:.5,end:2.5},currentSourceFileId:'video-file',sourceRange:{start:10,end:12,videoId:'source-video'},provenance:{kind:'video-analysis',mediaSource:'asset:video',model:null},worldResource:{url:'source-world'},audio:'unrelated'};
 const item=capture(n),patch=core.restore(item);assert.equal(patch.video,'asset:video');assert.equal(patch.image,'asset:poster');assert.equal(patch.audio,undefined);assert.deepEqual(patch.clip,n.clip);assert.deepEqual(patch.videoMetadata,n.videoMetadata);assert.deepEqual(patch.sourceRange,n.sourceRange);assert.equal(patch.worldResource,undefined);assert.equal(patch.currentSourceFileId,'video-file');
});
test('legacy asset fields and legacy video indirection remain compatible without inventing metadata',()=>{
 assert.deepEqual(core.restore({type:'image',image:'preview.png'}),{image:'preview.png',fullImage:undefined,video:undefined,audio:undefined});
 assert.equal(core.capture({id:'video',type:'video',image:'poster.png'},{id:'saved',legacyVideo:'legacy.mp4'}).video,'legacy.mp4');assert.equal(core.restore({type:'video',nodeId:'source'},{legacyVideo:'legacy.mp4'}).video,'legacy.mp4');
 assert.equal(core.restore({type:'image',image:'only.png'}).provenance,undefined);
});
test('known mismatching source evidence cannot relabel replaced media or follow stale pixel/clip identities',()=>{
 const item=capture({...image,fullImage:'asset:replacement',videoMetadata:{width:320,height:180,duration:4},clip:{start:0,end:1},sourceRange:{start:2,end:3}}),patch=core.restore(item);
 assert.equal(item.fullImage,'asset:replacement');for(const field of ['provenance','pixelWidth','pixelHeight','currentSourceFileId','clip','videoMetadata','sourceRange'])assert.equal(patch[field],undefined);
 const stale={...capture(image),fullImage:'asset:changed-after-save'};assert.equal(core.restore(stale).provenance,undefined);
});
test('invalid optional sizes and clip bounds are not installed in a new node',()=>{
 const p=core.restore({type:'video',video:'v.mp4',width:Infinity,height:-1,clip:{start:5,end:3},videoMetadata:{width:NaN,height:180,duration:Infinity}});assert.equal(p.width,undefined);assert.equal(p.height,undefined);assert.equal(p.clip,undefined);assert.deepEqual(p.videoMetadata,{width:null,height:180,duration:null});
});
test('same source may be saved twice with independent library identity and no project-specific binding',()=>{
 const a=core.capture(image,{id:'saved-a',folder:'Others'}),b=core.capture(image,{id:'saved-b',folder:'Others'});assert.notEqual(a.id,b.id);assert.equal(a.nodeId,b.nodeId);assert.equal(a.fullImage,b.fullImage);a.provenance.model='a';assert.equal(b.provenance.model,'original-model');assert.equal(b.projectId,undefined);
});

function saveHarness({fail=false,withoutCore=false}={}){
 const source=fs.readFileSync(require.resolve('../sidebars.js'),'utf8'),start=source.indexOf('  function saveAsset('),end=source.indexOf('\n  document.addEventListener',start),dialogs=[],library=[],writes=[],notices=[];
 const make=(tag,text)=>({tag,text,children:[],value:'',disabled:false,append(...items){this.children.push(...items);},setAttribute(){},close(){this.closed=true;}}),el=(tag,cls,text)=>make(tag,text),btn=(text,run)=>Object.assign(make('button',text),{onclick:run});
 const context=vm.createContext({window:{CanvasLibraryAssetRoundtrip:withoutCore?undefined:core,EDITOR_DATA:{nodes:{}}},crypto:{randomUUID:()=> 'saved'},assets:null,folders:['Others'],extraFolders:[],library,el,btn,showDialog:d=>dialogs.push(d),showLibrary:()=>{},app:{notify:message=>notices.push(message)},persistLibrary:async()=>{writes.push(structuredClone(library));if(fail)throw Error('quota failed');}});
 vm.runInContext(source.slice(start,end)+';globalThis.saveAssetForTest=saveAsset;',context);return {save:context.saveAssetForTest,dialogs,library,writes,notices,setFail:value=>{context.persistLibrary=async()=>{writes.push(structuredClone(library));if(value)throw Error('quota failed');};}};
}
test('production save dialog writes complete source metadata and only closes after successful persistence',async()=>{
 const f=saveHarness(),n=structuredClone(image);f.save([n]);const d=f.dialogs[0];d.children.find(n=>n.tag==='input').value='保存名';await d.children.find(n=>n.tag==='button').onclick();assert.equal(f.writes.length,1);assert.equal(f.library[0].fullImage,'asset:original');assert.equal(f.library[0].name,'保存名');assert.deepEqual(f.library[0].provenance,image.provenance);assert.equal(d.closed,true);
});
test('production save failure retains one complete prepared asset, unchanged source and retry identity',async()=>{
 const f=saveHarness({fail:true}),n=structuredClone(image),before=structuredClone(n);f.save([n]);const d=f.dialogs[0],save=d.children.find(n=>n.tag==='button');await save.onclick();assert.equal(d.closed,undefined);assert.equal(f.library.length,1);assert.match(f.notices[0],/素材尚未保存/);assert.equal(f.library[0].fullImage,'asset:original');assert.deepEqual(n,before);f.setFail(false);await save.onclick();assert.equal(f.library.length,1);assert.equal(f.library[0].id,'saved');assert.equal(d.closed,true);
});
test('production synchronous insert installs one complete node and preserves world insertion coordinates',()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),start=source.indexOf('    insertAsset('),end=source.indexOf('\n    addTypedNode(',start),events=[],nodes=[];
 const context=vm.createContext({window:{CanvasLibraryAssetRoundtrip:core,EDITOR_DATA:{nodes:{}}},nodes,events,structuredClone,remember:()=>events.push('remember'),newNode:(type,point,image,title)=>({id:'fresh',type,title,x:point.x,y:point.y,width:446,height:250,image}),rebuildAndPersist:()=>events.push(structuredClone(nodes)),selected:new Set()});vm.runInContext('globalThis.api={'+source.slice(start,end).trim().replace(/,$/,'')+'};',context);
 const item=capture(image),before=structuredClone(item),node=context.api.insertAsset(item,{x:54015.125,y:-4155.375});assert.ok(!node?.then);assert.equal(events.length,2);assert.equal(nodes.length,1);assert.equal(node.x,54015.125);assert.equal(node.y,-4155.375);assert.equal(node.fullImage,'asset:original');assert.equal(node.pixelWidth,1920);assert.deepEqual(node.provenance,image.provenance);assert.equal(node.tool,undefined);assert.deepEqual(item,before);
});

async function pickerHarness({resolveAsset=async ref=>'blob:resolved-'+ref.slice(6)}={}){
 const {bindLocalImage}=await import('../src/features/local-resource-migration/display-image.mjs'),source=fs.readFileSync(require.resolve('../canvas-commands.js'),'utf8'),start=source.indexOf(' function assets(point)'),end=source.indexOf('\n function context(',start),assigned=[],inserted=[];
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.value='';this.parent=null;}
  append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
  setAttribute(key,value){this.attrs[key]=value;}
  replaceChildren(){for(const item of this.children)item.parent=null;this.children=[];}
  get isConnected(){return this===body||!!this.parent?.isConnected;}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
  showModal(){}
  close(){this.onclose?.();}
  set src(value){this._src=value;assigned.push(value);}
  get src(){return this._src;}
 }
 const body=new Element('body'),document={body},el=(tag,cls,text)=>Object.assign(new Element(tag),{className:cls,text}),items=[{type:'image',name:'原图',image:'asset:thumbnail',fullImage:'asset:original'}];
 const context=vm.createContext({document,el,icons:{},window:{CanvasLibrary:{items},UI_ICONS:{close:''}},app:{insertAsset:(...args)=>inserted.push(args)},localImageReady:Promise.resolve({bindLocalImage:(image,options)=>bindLocalImage(image,{...options,resolveAsset})})});vm.runInContext(source.slice(start,end)+';globalThis.openForTest=assets;',context);
 context.openForTest({x:15,y:20});const dialog=body.children[0],grid=dialog.children[2],search=dialog.children[1];
 const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};return {body,dialog,grid,search,items,assigned,inserted,tick};
}
test('production asset picker resolves local thumbnail and original fallback, then uses actual synchronous insertion',async()=>{
 const refs=[],f=await pickerHarness({resolveAsset:async ref=>{refs.push(ref);return 'blob:'+ref.slice(6);}});await f.tick();const row=f.grid.children[0],image=row.children[0];assert.equal(image.src,'blob:thumbnail');assert.deepEqual(refs,['asset:thumbnail']);image.onerror();await f.tick();assert.equal(image.src,'blob:original');assert.deepEqual(refs,['asset:thumbnail','asset:original']);assert.ok(f.assigned.every(url=>!url.startsWith('asset:')));row.onclick();assert.equal(f.inserted.length,1);assert.equal(f.inserted[0][0],f.items[0]);assert.deepEqual(JSON.parse(JSON.stringify(f.inserted[0][1])),{x:15,y:20});assert.equal(image.onerror,null);assert.equal(f.dialog.isConnected,false);
});
test('production asset picker invalidates late media after search rerender or dialog close',async()=>{
 const releases=[],f=await pickerHarness({resolveAsset:ref=>new Promise(resolve=>releases.push(()=>resolve('blob:'+ref.slice(6))))});await f.tick();const old=f.grid.children[0].children[0];f.search.value='absent';f.search.oninput();releases.shift()();await f.tick();assert.equal(old.src,undefined);assert.equal(old.onerror,null);f.search.value='';f.search.oninput();await f.tick();const replacement=f.grid.children[0].children[0];f.dialog.close();releases.shift()();await f.tick();assert.equal(replacement.src,undefined);assert.equal(replacement.onerror,null);assert.deepEqual(f.assigned,[]);
});

test('new library records capture only compatible media and never inherit stale remote fields from a previous type',()=>{
 const old='https://resource.tapnow.ai/obsolete';
 for(const [type,fields] of [['image',{image:'asset:thumb',fullImage:'asset:full',video:old,audio:old}],['video',{image:'asset:poster',video:'asset:video',fullImage:old,audio:old}],['audio',{audio:'asset:audio',image:old,fullImage:old,video:old}],['text',{content:'正文',image:old,fullImage:old,video:old,audio:old}]]){
  const record=core.capture({id:type,type,...fields},{id:'saved',legacyVideo:old});assert.ok(!JSON.stringify(record).includes(old),type);const patch=core.restore({...record,...Object.fromEntries(['image','fullImage','video','audio'].filter(key=>record[key]===undefined).map(key=>[key,old]))});for(const key of ['image','fullImage','video','audio'])if(record[key]===undefined)assert.equal(patch[key],undefined,type+':'+key);
 }
});
test('production hydration only recovers seed original for unchanged image preview without pending or conflicting source identity',()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),start=source.indexOf('      const recovery=n.generationRecovery'),end=source.indexOf('\n    });clearOrphanGenerationState',start),block=source.slice(start,end),seed={...image,provenance:{mediaSource:'asset:original'}},restore=patch=>{
  const node={...structuredClone(seed),pendingOperation:undefined,generationRun:undefined,...patch};delete node.fullImage;
  const context=vm.createContext({n:node,original:new Map([[seed.id,seed]]),displayMediaRef:ref=>ref?.startsWith('asset:')?ref:'',generationSignature:()=> 'signature'});vm.runInContext(block,context);return node.fullImage;
 };
 assert.equal(restore({}),'asset:original');
 for(const patch of [{type:'video'},{type:'audio'},{image:'asset:replacement'},{image:null},{pendingOperation:'image.generate'},{generationRun:{runId:'in-flight'}},{provenance:{mediaSource:'asset:replacement'}},{currentSourceFileId:'replaced-file'},{sourceFileId:'other-file'}])assert.equal(restore(patch),undefined,JSON.stringify(patch));
});

test('production sidebar only applies legacy video indirection to an actual video asset',()=>{
 const source=fs.readFileSync(require.resolve('../sidebars.js'),'utf8'),start=source.indexOf('  const effectiveLibraryAsset='),end=source.indexOf('\n',start),old='https://resource.tapnow.ai/legacy.mp4',context=vm.createContext({window:{EDITOR_DATA:{nodes:{legacy:{video:old}}}}});vm.runInContext(source.slice(start,end)+';globalThis.effective=effectiveLibraryAsset;',context);
 assert.equal(context.effective({type:'image',nodeId:'legacy',image:'asset:image'}).video,undefined);assert.equal(context.effective({type:'video',nodeId:'legacy'}).video,old);assert.equal(context.effective({type:'video',nodeId:'legacy',video:'asset:video'}).video,'asset:video');assert.equal(context.effective({type:'image',nodeId:'legacy',video:'preserved-old-record'}).video,'preserved-old-record');
});

test('isolated QA baseline and picker receipts survive reload without touching a full localStorage',async()=>{
 const values=new Map(),source=fs.readFileSync(require.resolve('../src/features/library-asset-roundtrip/qa/controls.mjs'),'utf8'),start=source.indexOf('const session='),end=source.indexOf('const sha=',start),names=[];
 const indexedDB={open(name){names.push(name);const request={};queueMicrotask(()=>{request.result={createObjectStore(){},transaction(){const transaction={objectStore:()=>({get(key){return run(()=>values.get(name+key));},put(value,key){return run(()=>{values.set(name+key,structuredClone(value));return key;});}})};function run(action){const operation={};queueMicrotask(()=>{operation.result=action();operation.onsuccess?.();queueMicrotask(()=>transaction.oncomplete?.());});return operation;}return transaction;}};if(!values.has(name)){values.set(name,true);request.onupgradeneeded?.();}request.onsuccess?.();});return request;}};
 const load=()=>{const context=vm.createContext({indexedDB,URLSearchParams,location:{search:'?session=quota-case'},queueMicrotask,localStorage:{getItem(){throw Error('must not read localStorage');},setItem(){throw Error('quota exceeded');}}});vm.runInContext(source.slice(start,end)+';globalThis.qa={ready:receiptsReady,save:saveBaseline,get:()=>cachedBaseline};',context);return context.qa;};
 const first=load();await first.ready;const value={nodeId:'source',original:'asset:full',pickerEvidence:{naturalWidth:128,naturalHeight:72}};await first.save(value);const reloaded=load();await reloaded.ready;assert.deepEqual(reloaded.get(),value);assert.ok(names.every(name=>name==='qa-library-roundtrip:quota-case:receipts'));
});

test('legacy standalone save host remains usable without the new loader and retains original primary media',async()=>{
 const f=saveHarness({withoutCore:true});f.save([structuredClone(image)]);const dialog=f.dialogs[0];await dialog.children.find(n=>n.tag==='button').onclick();assert.equal(dialog.closed,true);assert.equal(f.library[0].fullImage,'asset:original');assert.equal(f.library[0].video,undefined);assert.equal(f.library[0].audio,undefined);assert.equal(f.notices.length,0);
});

function preferencesIDB(){
 const databases=new Map();let failWrites=false;
 return {setFail:value=>failWrites=value,indexedDB:{open(name){const request={};queueMicrotask(()=>{
  const fresh=!databases.has(name);if(fresh)databases.set(name,new Map());const values=databases.get(name);
  request.result={createObjectStore(){},close(){},transaction(store,mode){const transaction={},changes=[];let started=false;
   const commit=()=>{if(started)return;started=true;queueMicrotask(()=>{if(failWrites&&mode==='readwrite'){transaction.error=Error('IDB disk full');transaction.onabort?.();return;}for(const [key,value] of changes)value===null?values.delete(key):values.set(key,value);transaction.oncomplete?.();});};
   transaction.objectStore=()=>({put(value,key){changes.push([key,structuredClone(value)]);commit();},delete(key){changes.push([key,null]);commit();},openCursor(){const entries=[...values],cursor={};let i=0;const step=()=>queueMicrotask(()=>{const entry=entries[i++];cursor.result=entry?{key:entry[0],value:entry[1],continue:step}:null;cursor.onsuccess?.();if(!entry)commit();});step();return cursor;}});return transaction;
  }};if(fresh)request.onupgradeneeded?.();request.onsuccess?.();});return request;}}};
}
function loadPreferencesFixture(idb){
 const window={addEventListener(){}},navigator={locks:{request(name,...args){return args.at(-1)({name});}}};Object.defineProperty(window,'localStorage',{configurable:true,get(){throw Error('must not read user storage');}});
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/features/library-asset-roundtrip/qa/fixture.js'),'utf8'),{window,navigator,indexedDB:idb.indexedDB,location:{search:'?session=prefs-case'},URLSearchParams,console:{error(){}},Map,Promise});return {window,navigator};
}
test('QA production-library lock waits independent preferences IDB commit and real reload bootstrap hydrates it',async()=>{
 const idb=preferencesIDB(),first=loadPreferencesFixture(idb);await first.window.LibraryRoundtripQAStorage.ready;
 await first.navigator.locks.request('tapnow-library-write',()=>{first.window.localStorage.setItem('tapnow-library','[{"id":"saved"}]');first.window.localStorage.setItem('tapnow-folders','[]');});
 const second=loadPreferencesFixture(idb);await second.window.LibraryRoundtripQAStorage.ready;assert.equal(second.window.localStorage.getItem('tapnow-library'),'[{"id":"saved"}]');assert.equal(second.window.localStorage.getItem('tapnow-folders'),'[]');assert.equal(second.window.CANVAS_DB_NAME,'qa-library-roundtrip:prefs-case:canvas');
});
test('QA production-library lock rejects a real IDB write failure instead of reporting fake save success',async()=>{
 const idb=preferencesIDB(),f=loadPreferencesFixture(idb);await f.window.LibraryRoundtripQAStorage.ready;idb.setFail(true);
 await assert.rejects(f.navigator.locks.request('tapnow-library-write',()=>{f.window.localStorage.setItem('tapnow-library','[{"id":"failed"}]');f.window.localStorage.setItem('tapnow-folders','[]');}),/IDB disk full/);
 const reloaded=loadPreferencesFixture(idb);await reloaded.window.LibraryRoundtripQAStorage.ready;assert.equal(reloaded.window.localStorage.getItem('tapnow-library'),null);
});
test('public production/demo/adjacent QA entries load the real model before app or sidebar host',()=>{
 for(const file of ['index.html','docs/screenshots/demo.html']){const html=fs.readFileSync(require.resolve('../'+file),'utf8'),loader=html.indexOf('src/features/library-asset-roundtrip/core.js'),host=html.search(/(?:app\.js|fetch\('\.\.\/sidebars\.js')/);assert.ok(loader>=0&&host>loader,file);}
 const html=fs.readFileSync(require.resolve('../src/features/library-asset-roundtrip/qa/roundtrip.html'),'utf8'),payload=html.match(/id="library-roundtrip-production-scripts">([^<]+)/)[1],scripts=JSON.parse(payload);assert.ok(scripts.findIndex(s=>s.src?.includes('library-asset-roundtrip/core.js'))<scripts.findIndex(s=>s.src?.startsWith('app.js')));assert.ok(!scripts.some(s=>s.src?.startsWith('canvas-data.js')));assert.match(html,/qa\/boot\.mjs/);assert.ok(scripts.findIndex(s=>s.src==='local-assets.js')<scripts.findIndex(s=>s.src?.startsWith('generation-ui.js')));
});
