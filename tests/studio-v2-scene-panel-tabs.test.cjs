const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');
if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const modules=Promise.all([import('../src/features/studio-v2/scene-panel.mjs'),import('../src/features/studio-v2/classes.mjs')]);
async function fixture(t){
 const [{createScenePanel},{classes}]=await modules,dom=new JSDOM('<body/>'),previous={document:global.document,window:global.window};
 global.document=dom.window.document;global.window=dom.window;t.after(()=>{dom.window.close();Object.assign(global,previous);});
 const camera={id:'camera',name:'真实镜头',kind:'camera',userData:{studioId:'camera'}},object={name:'真实模型',userData:{studioId:'object'},children:[]},calls=[];
 let scans=0;
 const runtime={content:{userData:{},children:[object]},selected:null,shotId:'camera',motionIndex:-1,
  playback:{catalog(){scans++;return [];},index:-1,target:'camera',playing:false},objects:()=>[camera],find:()=>camera,motion:{start(){}},
  selectShot:id=>calls.push(['shot',id]),select:target=>calls.push(['object',target]),focus:target=>calls.push(['frame',target]),focusView:()=>calls.push(['viewport'])};
 const owner=createScenePanel(runtime);let root=owner.render();document.body.append(root);
 return {dom,classes,calls,object,get root(){return root;},get scans(){return scans;},get tabs(){return [...root.querySelectorAll('[role="tab"]')];},get content(){return root.querySelector('[role="tabpanel"]:not([hidden])');},key(target,key,options={}){const event=new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;},rerender(){const next=owner.render();root.replaceWith(next);root=next;}};
}
test('horizontal studio tabs have one tab stop and connected labels and control panels',async t=>{
 const f=await fixture(t),[shooting,scene]=f.tabs;
 assert.equal(f.root.querySelector('[role="tablist"]').getAttribute('aria-orientation'),'horizontal');
 assert.deepEqual(f.tabs.map(tab=>tab.tabIndex),[0,-1]);
 for(const tab of f.tabs){const panel=document.getElementById(tab.getAttribute('aria-controls'));assert.equal(panel.getAttribute('role'),'tabpanel');assert.equal(panel.getAttribute('aria-labelledby'),tab.id);assert.equal(panel.tabIndex,0);}
 assert.equal(f.content.id,shooting.getAttribute('aria-controls'));assert.equal(scene.getAttribute('aria-selected'),'false');
 scene.focus();assert.equal(scene.getAttribute('aria-selected'),'true');assert.deepEqual(f.tabs.map(tab=>tab.tabIndex),[-1,0]);assert.equal(f.content.id,scene.getAttribute('aria-controls'));assert.equal(f.content.querySelector('.'+f.classes.treeSelect).ariaLabel,'真实模型');
});
test('arrows loop and Home End PageUp PageDown focus and automatically activate formal panels',async t=>{
 const f=await fixture(t);f.tabs[0].focus();
 for(const [key,index] of [['ArrowRight',1],['ArrowRight',0],['ArrowLeft',1],['Home',0],['End',1],['PageUp',0],['PageDown',1]]){
  const event=f.key(document.activeElement,key);assert.equal(event.defaultPrevented,true);assert.equal(document.activeElement,f.tabs[index]);assert.equal(f.tabs[index].getAttribute('aria-selected'),'true');assert.equal(f.content.id,f.tabs[index].getAttribute('aria-controls'));
 }
 assert.deepEqual(f.calls,[],'navigation must not select or mutate scene objects');
});
test('modified arrows, vertical keys, composing and already handled events leave focus and selection intact',async t=>{
 const f=await fixture(t),tab=f.tabs[0];tab.focus();const before=f.scans;
 for(const [key,options] of [['ArrowRight',{ctrlKey:true}],['ArrowRight',{metaKey:true}],['ArrowRight',{altKey:true}],['ArrowRight',{shiftKey:true}],['ArrowDown',{}],['ArrowUp',{}],['ArrowRight',{isComposing:true}],['Escape',{}],['Tab',{}]])assert.equal(f.key(tab,key,options).defaultPrevented,false);
 const handled=new f.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true});handled.preventDefault();tab.dispatchEvent(handled);
 assert.equal(document.activeElement,tab);assert.equal(tab.getAttribute('aria-selected'),'true');assert.equal(f.scans,before);
});
test('right and control clicks do not activate the scene tab; primary mouse focus and click activate once',async t=>{
 const f=await fixture(t),[shooting,scene]=f.tabs;shooting.focus();const before=f.scans;
 for(const options of [{button:2},{button:0,ctrlKey:true}]){
  const down=new f.dom.window.MouseEvent('mousedown',{bubbles:true,cancelable:true,...options});scene.dispatchEvent(down);assert.equal(down.defaultPrevented,true);
  scene.dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true,...options}));assert.equal(shooting.getAttribute('aria-selected'),'true');
 }
 scene.dispatchEvent(new f.dom.window.MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true}));scene.focus();scene.click();assert.equal(f.scans,before+1);assert.equal(scene.getAttribute('aria-selected'),'true');assert.equal(document.activeElement,scene);
});
test('RTL reverses only horizontal arrows and keeps Home End at first and last tab',async t=>{
 const f=await fixture(t);f.root.dir='rtl';f.tabs[0].focus();f.key(f.tabs[0],'ArrowLeft');assert.equal(document.activeElement,f.tabs[1]);f.key(f.tabs[1],'Home');assert.equal(document.activeElement,f.tabs[0]);f.key(f.tabs[0],'End');assert.equal(document.activeElement,f.tabs[1]);
});
test('formal row selection still uses object identity and shot transaction callbacks after keyboard navigation',async t=>{
 const f=await fixture(t);f.tabs[0].focus();f.key(f.tabs[0],'ArrowRight');f.content.querySelector('.'+f.classes.treeSelect).click();
 assert.deepEqual(f.calls,[['object',f.object],['frame',f.object],['viewport']]);f.tabs[0].focus();f.content.querySelector('.'+f.classes.shotRow).click();assert.deepEqual(f.calls.at(-1),['shot','camera']);
 const ids=f.tabs.map(tab=>tab.id);f.tabs[1].focus();f.rerender();assert.deepEqual(f.tabs.map(tab=>tab.id),ids);assert.equal(f.tabs[1].getAttribute('aria-selected'),'true');assert.deepEqual(f.tabs.map(tab=>tab.tabIndex),[-1,0]);
});
test('settings disclosure keeps the active tab and native Escape does not close or mutate the panel',async t=>{
 const f=await fixture(t);f.tabs[1].focus();const heading=f.root.querySelector('.'+f.classes.heading),body=f.root.querySelector('.'+f.classes.controlBody);heading.click();assert.equal(body.hidden,true);assert.equal(heading.getAttribute('aria-expanded'),'false');heading.click();assert.equal(body.hidden,false);assert.equal(f.tabs[1].getAttribute('aria-selected'),'true');assert.equal(f.key(f.tabs[1],'Escape').defaultPrevented,false);assert.deepEqual(f.calls,[]);
});

test('motion edit exposes the official full hover title and preserves its source camera and clip IDs',async t=>{
 const f=await fixture(t),camera=f.root.querySelector('.'+f.classes.shotRow);assert.ok(camera);
 // Read a real catalog entry and exercise the formal editor callback, independent of tab navigation.
 const [{createScenePanel}]=await modules,selected=[];
 const runtime={content:{children:[],userData:{}},selected:null,shotId:'source-camera',motionIndex:7,objects:()=>[{id:'source-camera',name:'来源镜头',kind:'camera'}],find:id=>({name:'来源镜头',userData:{studioId:id}}),playback:{catalog:()=>[{index:7,name:'很长的来源运镜',duration:2,cameraIds:['source-camera'],objectTracks:[]}],playing:false},motion:{start:(...args)=>selected.push(args)}};
 const root=createScenePanel(runtime).render();document.body.append(root);const edit=root.querySelector('.'+f.classes.clipEdit);assert.equal(edit.title,'编辑运镜');edit.click();assert.deepEqual(selected,[[7,'source-camera']]);
});
