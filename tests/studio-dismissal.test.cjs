const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');
if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const source=path=>fs.readFileSync(require.resolve('../'+path),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
 const dom=new JSDOM('<body><button id="outside">Outside</button><main id="studio"></main></body>');t.after(()=>dom.window.close());
 const {window}=dom,{document}=window,root=document.querySelector('main');
 Object.defineProperty(window.Element.prototype,'ariaLabel',{get(){return this.getAttribute('aria-label');},set(value){this.setAttribute('aria-label',value);},configurable:true});
 window.CanvasApp={notify(){}};window.VoiceInput={cancel(){}};
 const context=vm.createContext({window,document,innerWidth:1000,innerHeight:800,AbortController:window.AbortController,CustomEvent:window.CustomEvent,queueMicrotask,console,URL,Promise,setTimeout,clearTimeout});
 return {window,document,root,context,key(target,key='Escape',options={}){const event=new window.KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;}};
}
async function studioFixture(t){
 const f=fixture(t),{classes}=await import('../src/features/studio-v2/classes.mjs');let finish,disposed=0;
 const pending=new Promise(resolve=>finish=resolve),prepared={scenes:[{name:'Scene',index:0},{name:'Alternate',index:1}],defaultScene:0,loaded:{scenes:[{},{}]}};
 const runtime={nodeId:'studio',content:{children:[{}]},selected:null,playback:{playing:false},loadStatus:'ready',saveError:null,grid:{visible:true},lighting:{azimuth:0,elevation:0},commits:0,
  beginEdit(){},setLighting(patch){Object.assign(this.lighting,patch);},commit(){this.commits++;}};
 runtime.importPrepared=(_prepared,index)=>{runtime.importedScene=index;return pending;};runtime.add=()=>pending;
 Object.assign(f.context,{c:classes,runtime,defaultLighting:{azimuth:0,elevation:0},icons:new Proxy({},{get:()=>'<svg></svg>'}),
  bindTooltip:()=>({destroy(){}}),inspectModel:async()=>prepared,disposeModel:()=>disposed++,
  createScenePanel:()=>({render(){const n=f.document.createElement('section');n.ariaLabel='片场设置';return n;}}),objectInspector:()=>f.document.createElement('div'),
  createStudioComposer:()=>({element:f.document.createElement('div'),state:{},destroy(){},open(){}}),
  createShotPreview:()=>({element:f.document.createElement('div'),refresh(){},tick(){},dispose(){}}),
  createMotionUI:()=>({element:f.document.createElement('div'),refresh(){},dispose(){}}),closed:0});
 vm.runInContext(source('src/features/studio-v2/dom.mjs').replace(/^import .*\n/gm,'').replaceAll('export ',''),f.context);
 vm.runInContext(source('src/features/studio-v2/ui.mjs').replace(/^import .*\n/gm,'').replaceAll('export ',''),f.context);
 const ui=vm.runInContext('createUI({root:document.querySelector("main"),runtime,onClose:()=>closed++})',f.context);
 t.after(()=>ui.dispose());
 return {...f,ui,finish,runtime,get disposed(){return disposed;},async beginImport(sceneIndex=0){
  f.root.querySelector('[aria-label="添加模型"]').click();const popup=f.document.querySelector('.studio-v2-popover'),file=popup.querySelector('input[type=file]');
  Object.defineProperty(file,'files',{value:[{name:'scene.gltf',size:100}]});file.onchange();await settle();
  popup.querySelector('select').value=String(sceneIndex);popup.querySelector('[aria-label="添加到场景"]').click();return popup;
 }};
}
test('V2 model import owns its popup until adding/saving finishes, including repeated triggers and workspace close',async t=>{
 const f=await studioFixture(t),popup=await f.beginImport();
 assert([...popup.querySelectorAll('input[type=file],select,button')].every(control=>control.disabled));
 assert.throws(()=>f.ui.assertCanClose(),/正在添加并保存/);
 f.root.querySelector('[aria-label="添加模型"]').click();f.root.querySelector('[aria-label="视角操作帮助"]').click();
 f.document.querySelector('#outside').dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));
 const escape=f.key(popup);assert(escape.defaultPrevented);assert.equal(f.document.querySelector('.studio-v2-popover'),popup);assert.equal(f.disposed,0);
 f.finish();await settle();assert.equal(f.document.querySelector('.studio-v2-popover'),null);assert.doesNotThrow(()=>f.ui.assertCanClose());
});
test('V2 import preserves a nondefault glTF scene across the saving-state rerender',async t=>{
 const f=await studioFixture(t);await f.beginImport(1);assert.equal(f.runtime.importedScene,1);f.finish();await settle();
});
test('V2 import Escape restores trigger, same trigger toggles, and an upper native dialog keeps the popup intact',async t=>{
 const f=await studioFixture(t),trigger=f.root.querySelector('[aria-label="添加模型"]');trigger.click();let popup=f.document.querySelector('.studio-v2-popover');
 assert(popup.contains(f.document.activeElement));
 const modal=f.document.createElement('dialog');modal.setAttribute('open','');const field=f.document.createElement('input');modal.append(field);f.document.body.append(modal);field.focus();
 assert(!f.key(field).defaultPrevented);assert.equal(f.document.querySelector('.studio-v2-popover'),popup);modal.remove();
 assert(f.key(popup).defaultPrevented);assert.equal(f.document.activeElement,trigger);assert.equal(f.document.querySelector('.studio-v2-popover'),null);
 trigger.click();trigger.click();assert.equal(f.document.querySelector('.studio-v2-popover'),null);
});
test('V2 dismissing a live lighting slider commits once even when DOM removal does not emit blur/change',async t=>{
 const f=await studioFixture(t);f.root.querySelector('[aria-label="光照"]').click();const input=f.document.querySelector('input[aria-label="绕场景旋转光照"]');
 input.value='82';input.oninput();assert.equal(f.runtime.lighting.azimuth,82);assert.equal(f.runtime.commits,0);
 f.document.querySelector('#outside').dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));assert.equal(f.runtime.commits,1);assert.equal(f.document.querySelector('.studio-v2-popover'),null);
 input.onblur();assert.equal(f.runtime.commits,1);
});
test('V2 workspace pre-close finalizes its live lighting edit before the runtime flush',async t=>{
 const f=await studioFixture(t);f.root.querySelector('[aria-label="光照"]').click();const input=f.document.querySelector('input[aria-label="绕场景旋转光照"]');input.value='59';input.oninput();
 f.ui.assertCanClose();assert.equal(f.runtime.commits,1);f.ui.dispose();assert.equal(f.runtime.commits,1);
});
test('V2 entry API cannot close/dispose an importing workspace',async t=>{
 const f=fixture(t);let closes=0,disposed=0;
 Object.assign(f.context,{classes:{viewer:'viewer',world:'world'},el:(tag,cls)=>{const n=f.document.createElement(tag);n.className=cls;return n;},
  SceneRuntime:class{constructor(){this.content={children:[]};}async initialize(){}async close(){closes++;}},
  createUI:()=>({assertCanClose(){throw Error('模型正在添加并保存');},dispose(){disposed++;},notice(){}})});
 const text=source('src/features/studio-v2/entry.mjs').replace(/^import .*\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url','"http://localhost/entry.mjs"');
 vm.runInContext(text+'\nglobalThis.openStudio=open;',f.context);
 const instance=await f.context.openStudio({id:'studio'});await assert.rejects(instance.close(),/正在添加并保存/);assert.equal(closes,0);assert.equal(disposed,0);assert(f.document.querySelector('.studio-v2-root'));
});
test('V2 closing with a failed flush preserves the live scene and its retry state',async()=>{
 const {SceneRuntime}=await import('../src/features/studio-v2/runtime.mjs');let released=false;
 const runtime={closed:false,loadStatus:'ready',saved:{viewer:{}},read:()=>({viewer:{}}),async flush(){throw Error('Storage full');},abort:{abort(){released=true;}}};
 await assert.rejects(SceneRuntime.prototype.close.call(runtime),/Storage full/);assert.equal(runtime.closed,false);assert.equal(released,false);
});
test('production project snapshot failure prevents Studio savedRevision and close, and can be retried',async()=>{
 const appSource=source('app.js'),runtimeSource=source('src/features/studio-v2/runtime.mjs');let failing=true,saves=0,flushes=0,disposed=false;
 const node={id:'studio',type:'studio'},changes=[],context=vm.createContext({console,Promise,saveRevision:0,graphLoaded:true,graphReadFailed:false,nodes:[node],edges:[],view:{},history:[],future:[],original:new Map(),$:()=>null,flushGesture(){},saveView(){},storageError(){},exportGlb:async()=>({}),window:{}});
 const {window}=context;window.CanvasProjects={markDirty(){},isDefault:()=>false,snapshot(){if(failing)throw Object.assign(Error('cannot clone'),{name:'DataCloneError'});return {nodes:[node]};}};
 window.CanvasStore={save:async()=>saves++,flush:async()=>flushes++};window.LocalAssets={put:async()=>'asset:scene'};
 const start=appSource.indexOf('  function persist() {'),end=appSource.indexOf('\n  function storageError',start),saveBody=appSource.match(/async saveProject\(\)\{([^\n]+)\},/)[1];
 vm.runInContext(appSource.slice(start,end)+`\nglobalThis.productionSave=async function(){${saveBody}};`,context);
 window.CanvasApp={getState:()=>({nodes:[node]}),updateNode:()=>vm.runInContext('persist()',context),saveProject:context.productionSave};
 const flushMethod=runtimeSource.slice(runtimeSource.indexOf('  async flush(){'),runtimeSource.indexOf('\n  async add('));vm.runInContext('globalThis.productionFlush=({'+flushMethod+'}).flush;',context);
 const assertMethod=runtimeSource.match(/  assertTargetNode\(\)\{[^\n]+/)[0];vm.runInContext('globalThis.assertTargetNode=({'+assertMethod+'}).assertTargetNode;',context);
 const runtime={hostNode:node,assertTargetNode:context.assertTargetNode,closed:false,loadStatus:'ready',revision:1,savedRevision:0,nodeId:'studio',playback:{document:()=>({})},animations:[],grid:{visible:true},lighting:{},shotRatios:{},read:()=>({viewer:{}}),abort:{abort(){disposed=true;}},onChange:reason=>changes.push(reason),flush:context.productionFlush};
 await assert.rejects(runtime.flush(),/未能保存/);assert.equal(runtime.savedRevision,0);assert(runtime.saveError);assert.equal(saves,0);assert.equal(flushes,0);assert(changes.includes('save-error'));
 const {SceneRuntime}=await import('../src/features/studio-v2/runtime.mjs');await assert.rejects(SceneRuntime.prototype.close.call(runtime),/未能保存/);assert.equal(runtime.closed,false);assert.equal(disposed,false);
 failing=false;await runtime.flush();assert.equal(runtime.savedRevision,1);assert.equal(runtime.saveError,null);assert.equal(saves,2);assert.equal(flushes,1);
});
test('legacy Studio shortcuts ignore native dialogs, consumed keys, composition and focus outside the workspace',t=>{
 const f=fixture(t),text=source('studio.mjs'),method=text.slice(text.indexOf(' keyDown(e){'),text.indexOf('\n tick(){'));
 vm.runInContext('globalThis.handler=({'+method+'}).keyDown;',f.context);let selection=0;
 const studio={root:f.root,keys:new Set(),select(){selection++;}};
 f.context.handler.call(studio,{defaultPrevented:true});f.context.handler.call(studio,{isComposing:true});
 f.context.handler.call(studio,{target:f.document.querySelector('#outside')});
 const modal=f.document.createElement('dialog');modal.setAttribute('open','');f.document.body.append(modal);f.context.handler.call(studio,{target:f.root});assert.equal(selection,0);modal.remove();
 f.context.handler.call(studio,{target:f.root,code:'Escape',stopImmediatePropagation(){}});assert.equal(selection,1);
});
test('legacy Studio close awaits the project save, preserves resources/focus on rejection, and supports retry',async t=>{
 const f=fixture(t),text=source('studio.mjs'),method=text.slice(text.indexOf(' async close(){\n'),text.indexOf('\n}\ninstallTimeline'));
 vm.runInContext('globalThis.closeStudio=({'+method+'}).close;',f.context);let reject,disposed=0,selected=0;const notices=[],trigger=f.document.createElement('button');f.root.append(trigger);trigger.focus();f.root.inert=false;
 f.window.CanvasApp.saveProject=()=>new Promise((_resolve,fail)=>reject=fail);f.window.CanvasApp.select=()=>selected++;
 const release=()=>disposed++,studio={root:f.root,closed:false,persist(){},cancelPlacement(){},notify:message=>notices.push(message),entities:new Map(),abort:{abort:release},resizeObserver:{disconnect:release},renderer:{setAnimationLoop(){},dispose:release},controls:{dispose:release},transform:{dispose:release}};
 f.context.active=studio;const first=f.context.closeStudio.call(studio);assert.equal(f.root.inert,true);assert.equal(disposed,0);reject(Error('Storage full'));await assert.rejects(first,/Storage full/);
 assert.equal(studio.closed,false);assert.equal(f.root.inert,false);assert(f.root.isConnected);assert.equal(disposed,0);assert.equal(f.document.activeElement,trigger);assert.equal(notices.length,1);
 f.window.CanvasApp.saveProject=async()=>{};await f.context.closeStudio.call(studio);assert.equal(studio.closed,true);assert(!f.root.isConnected);assert.equal(selected,1);assert(disposed>0);
});
test('legacy Studio switching cannot open another legacy/V2 workspace after a rejected close',async t=>{
 const f=fixture(t);let opened=0;Object.assign(f.context,{active:{nodeId:'old',async close(){throw Error('Storage full');}},opening:null,studioV2:{current:()=>null,open:()=>opened++},Studio:class{constructor(){opened++;}async initialize(){}}});
 vm.runInContext(source('studio.mjs').match(/^async function open\(id\)\{[^\n]+/m)[0]+'\nglobalThis.openStudio=open;',f.context);
 for(const studioV2 of [undefined,{version:2}]){f.window.CanvasApp.getState=()=>({nodes:[{id:'new',type:'studio',studio:{},studioV2}]});await assert.rejects(f.context.openStudio('new'),/Storage full/);}
 assert.equal(opened,0);assert.equal(f.context.active.nodeId,'old');
});
test('legacy environment and panorama close decorators preserve their resources when base save rejects',async t=>{
 const f=fixture(t);let released=0;f.context.closeBase=async()=>{throw Error('Storage full');};
 const envMethod=source('studio-environment.mjs').match(/async close\(\)\{[^\n]+/)[0];vm.runInContext('globalThis.environmentClose=({'+envMethod+'}).close;',f.context);
 const studio={worldScene:{},scene:{remove(){released++;}},disposeObject(){released++;},environmentTextures:{dispose(){released++;}},closeEnvironmentPanel(){released++;},closePanoramaEditor(){released++;}};
 f.context.close=f.context.environmentClose;const panoramaMethod=source('studio-panorama.mjs').match(/async close\(\)\{[^\n]+/)[0];vm.runInContext('globalThis.panoramaClose=({'+panoramaMethod+'}).close;',f.context);
 await assert.rejects(f.context.panoramaClose.call(studio),/Storage full/);assert.equal(released,0);assert(studio.worldScene);
});
test('legacy Studio Escape dismisses the ratio or ordinary popup before changing viewfinder/selection',t=>{
 const f=fixture(t),text=source('studio.mjs'),method=text.slice(text.indexOf(' keyDown(e){'),text.indexOf('\n tick(){'));
 vm.runInContext('globalThis.handler=({'+method+'}).keyDown;',f.context);let selection=0;
 const studio={root:f.root,keys:new Set(),select(){selection++;}},trigger=f.document.createElement('button');f.root.append(trigger);
 const popup=f.document.createElement('div');popup.className='studio-popup';popup.returnFocus=trigger;f.root.append(popup);
 const event={target:f.root,code:'Escape',stopImmediatePropagation(){},preventDefault(){}};
 f.context.handler.call(studio,event);assert.equal(selection,0);assert.equal(f.document.activeElement,trigger);assert(!popup.isConnected);
 const ratio=f.document.createElement('div');ratio.className='studio-ratio-popover';let restored=false;ratio.closePanel=restore=>{restored=restore;ratio.remove();};f.root.append(ratio);
 f.context.handler.call(studio,event);assert.equal(selection,0);assert(restored);
});
test('world preview closes back to its launch focus, even after replacing a preview',async t=>{
 const f=fixture(t),trigger=f.document.querySelector('#outside');trigger.focus();let renders=0;
 f.window.CanvasApp.render=()=>renders++;
 Object.assign(f.context,{loadSaved:async()=>{throw Error('QA resource unavailable');},cancelAnimationFrame(){}});
 vm.runInContext(source('src/features/world-node/resource.mjs').replace(/^import .*\n/gm,'').replaceAll('export ','')+'\nglobalThis.openPreview=preview;',f.context);
 await f.context.openPreview({id:'world',title:'World',worldResource:{url:'/missing.glb'}});await f.context.openPreview({id:'world',title:'World',worldResource:{url:'/missing.glb'}});
 assert.equal(f.document.querySelectorAll('.world-preview').length,1);f.key(f.document.querySelector('.world-preview'));assert.equal(f.document.activeElement,trigger);assert.equal(renders,2);
});
test('world preview falls back to the canvas when its launch control was removed',async t=>{
 const f=fixture(t),trigger=f.document.querySelector('#outside'),canvas=f.document.createElement('main');canvas.id='canvas';canvas.tabIndex=0;f.document.body.append(canvas);trigger.focus();
 f.window.CanvasApp.render=()=>trigger.remove();Object.assign(f.context,{loadSaved:async()=>{throw Error('QA resource unavailable');},cancelAnimationFrame(){}});
 vm.runInContext(source('src/features/world-node/resource.mjs').replace(/^import .*\n/gm,'').replaceAll('export ','')+'\nglobalThis.openPreview=preview;',f.context);
 await f.context.openPreview({id:'world',title:'World',worldResource:{url:'/missing.glb'}});f.key(f.document.querySelector('.world-preview'));assert.equal(f.document.activeElement,canvas);
});
test('world HDRI rotation Escape cancels the drag before dismissing its environment menu',async t=>{
 const f=fixture(t);let rotation=0;const environment={resource:{id:'preset',label:'Preset'},get rotation(){return rotation;},setRotation(v){rotation=v;},select:async()=>true};
 Object.assign(f.context,{environment,notify(){},controls:new Proxy({},{get:()=>'<svg></svg>'}),presets:[{id:'preset',label:'Preset',url:'/preset.hdr',preview:'/preset.webp'}]});
 vm.runInContext(source('src/features/world-node/preview-environment-ui.mjs').replace(/^import .*\n/gm,'').replaceAll('export ',''),f.context);
 const view=vm.runInContext('environmentControls(document.querySelector("main"),environment,notify)',f.context);f.root.append(view.element);t.after(()=>view.dispose());await settle();
 const trigger=f.root.querySelector('.world-environment-trigger');trigger.click();const scale=f.root.querySelector('.world-rotation-scale');scale.setPointerCapture=()=>{};scale.releasePointerCapture=()=>{};
 scale.onpointerdown({button:0,clientX:100,pointerId:1,preventDefault(){}});scale.onpointermove({clientX:10});assert(rotation>0);
 assert(f.key(scale).defaultPrevented);assert.equal(rotation,0);assert(f.root.querySelector('.world-environment-menu'));
 assert(f.key(scale).defaultPrevented);assert.equal(f.root.querySelector('.world-environment-menu'),null);assert.equal(f.document.activeElement,trigger);
});
