const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');
if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const modules=Promise.all([import('../src/features/studio-v2/scene-panel.mjs'),import('../src/features/studio-v2/classes.mjs'),import('three'),import('../src/features/studio-v2/playback.mjs')]);
const node=(id,children=[])=>({name:id,userData:{studioId:id},children});
async function fixture(t,{children=[],cameras=[],clips=[],content,animations}={}){
 const [{createScenePanel},{classes},,{ScenePlayback}]=await modules,dom=new JSDOM('<body/>'),previous={document:global.document,window:global.window};
 global.document=dom.window.document;global.window=dom.window;t.after(()=>{dom.window.close();Object.assign(global,previous);});
 const canvas=document.createElement('canvas');canvas.tabIndex=0;document.body.append(canvas);const calls=[];
 const runtime={content:content||{userData:{},children},animations,selected:null,shotId:cameras[0]?.id,motionIndex:-1,
  objects:()=>cameras,find:id=>cameras.find(camera=>camera.id===id),selectShot(id){this.shotId=id;calls.push(['shot',id]);},selectMotion(index,id){this.motionIndex=index;this.shotId=id;calls.push(['motion',index,id]);},motion:{start:()=>{}},
  select(value){this.selected=value;calls.push(['object',value]);},focus:value=>calls.push(['frame',value]),focusView:()=>canvas.focus({preventScroll:true})};
 const playback=content?new ScenePlayback(runtime):{catalog:()=>clips,index:-1,target:'camera',playing:false};runtime.playback=playback;
 let catalogCalls=0;const original=playback.catalog.bind(playback);playback.catalog=()=>{catalogCalls++;return original();};
 const panel=createScenePanel(runtime);let element=panel.render();document.body.append(element);
 return {classes,runtime,calls,canvas,get element(){return element;},get catalogCalls(){return catalogCalls;},tab(label){[...element.querySelectorAll('button.'+classes.panelTab)].find(b=>b.textContent===label).click();},rerender(){const next=panel.render();element.replaceWith(next);element=next;}};
}
test('120 real Three cameras and clips use one actual graph catalog per shooting render',async t=>{
 const [,,THREE]=await modules,content=new THREE.Scene(),cameras=[],animations=[];
 for(let i=0;i<400;i++)content.add(new THREE.Group());
 for(let i=0;i<120;i++){const camera=new THREE.PerspectiveCamera();camera.name='镜头 '+i;camera.userData.studioId='camera-'+i;content.add(camera);cameras.push({id:camera.userData.studioId,name:camera.name,kind:'camera',userData:camera.userData});animations.push(new THREE.AnimationClip('运镜 '+i,2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,2],[0,0,0,1,0,0])]));}
 const f=await fixture(t,{content,cameras,animations});assert.equal(f.catalogCalls,1);
 assert.equal(f.element.querySelectorAll('.'+f.classes.shotRow).length,120);assert.equal(f.element.querySelectorAll('.'+f.classes.clipRow).length,120);
 assert.deepEqual([...f.element.querySelectorAll('.'+f.classes.shotRow+' small')].map(b=>b.textContent),Array(120).fill('1'));
 f.element.querySelectorAll('.'+f.classes.shotRow)[119].click();assert.equal(f.runtime.shotId,'camera-119');
 f.tab('拍摄');assert.equal(f.catalogCalls,2);assert.equal(f.element.querySelectorAll('.'+f.classes.shotRow)[119].getAttribute('aria-pressed'),'true');
});
test('one snapshot preserves shared-clip counts, duplicate associations and original motion order',async t=>{
 const cameras=['a','b'].map(id=>({id,name:id,kind:'camera',userData:{studioId:id}})),clips=[{index:4,name:'shared',duration:2,cameraIds:['b','a','a','missing'],objectTracks:[]},{index:9,name:'second',duration:3,cameraIds:['a'],objectTracks:[]}];
 const f=await fixture(t,{cameras,clips});assert.equal(f.catalogCalls,1);
 assert.deepEqual([...f.element.querySelectorAll('.'+f.classes.shotRow+' small')].map(b=>b.textContent),['2','1']);
 assert.deepEqual([...f.element.querySelectorAll('.'+f.classes.clipLabel)].map(b=>b.title),['shared · b','shared · a','shared · a','second · a']);
 f.element.querySelectorAll('.'+f.classes.clip)[2].click();assert.deepEqual(f.calls,[['motion',4,'a']]);
 clips.push({index:10,name:'new',duration:1,cameraIds:['b'],objectTracks:[]});f.tab('拍摄');assert.equal(f.catalogCalls,2);assert.equal(f.element.querySelectorAll('.'+f.classes.clipRow).length,5);assert.equal(f.element.querySelectorAll('.'+f.classes.shotRow+' small')[1].textContent,'2');
});
test('expand and collapse retain DOM focus on the replacement formal tree control',async t=>{
 const f=await fixture(t,{children:[node('group',[node('child')])]});f.tab('场景');const selector='.'+f.classes.treeExpand;
 const first=f.element.querySelector(selector);first.focus();first.click();const expanded=f.element.querySelector(selector);
 assert.notEqual(expanded,first);assert.equal(document.activeElement,expanded);assert.equal(expanded.getAttribute('aria-expanded'),'true');assert.equal(f.element.querySelectorAll('.'+f.classes.treeSelect).length,2);
 expanded.click();assert.equal(document.activeElement,f.element.querySelector(selector));assert.equal(document.activeElement.getAttribute('aria-expanded'),'false');assert.equal(f.element.querySelectorAll('.'+f.classes.treeSelect).length,1);
});
test('pagination keeps focus on remaining show-more, then first newly exposed row on the last page',async t=>{
 const f=await fixture(t,{children:Array.from({length:101},(_,i)=>node('row-'+i))});f.tab('场景');
 let more=f.element.querySelector('.'+f.classes.moreObjects);more.focus();more.click();more=f.element.querySelector('.'+f.classes.moreObjects);
 assert.equal(document.activeElement,more);assert.equal(f.element.querySelectorAll('.'+f.classes.treeSelect).length,100);
 more.click();const rows=f.element.querySelectorAll('.'+f.classes.treeSelect);assert.equal(rows.length,101);assert.equal(f.element.querySelector('.'+f.classes.moreObjects),null);assert.equal(document.activeElement,rows[100]);
 rows[100].click();assert.equal(f.runtime.selected.name,'row-100');assert.equal(document.activeElement,f.canvas);
});
test('nested parent pagination, expansion and collapse survive tab switches and full panel renders',async t=>{
 const group=id=>node(id,Array.from({length:101},(_,i)=>node(id+'-'+i))),f=await fixture(t,{children:[group('a'),group('b')]});f.tab('场景');
 const expand=id=>f.element.querySelector('.'+f.classes.treeExpand+'[data-object-id="'+id+'"]'),more=id=>f.element.querySelector('.'+f.classes.moreObjects+'[data-parent-id="'+id+'"]'),rows=id=>f.element.querySelectorAll('.'+f.classes.treeSelect+'[data-parent-id="'+id+'"]');
 expand('a').click();expand('b').click();more('a').click();assert.equal(rows('a').length,100);assert.equal(rows('b').length,50);assert.equal(document.activeElement,more('a'));
 more('a').click();assert.equal(document.activeElement,rows('a')[100]);assert.equal(rows('a').length,101);assert.equal(rows('b').length,50);
 f.tab('拍摄');f.tab('场景');f.rerender();assert.equal(rows('a').length,101);assert.equal(rows('b').length,50);assert.equal(expand('a').getAttribute('aria-expanded'),'true');assert.equal(expand('b').getAttribute('aria-expanded'),'true');
 expand('a').click();f.rerender();assert.equal(rows('a').length,0);assert.equal(rows('b').length,50);expand('a').click();assert.equal(rows('a').length,101);
});
test('scene object animation playback rows use the same fresh catalog snapshot',async t=>{
 const clips=[{index:7,name:'对象动画',duration:2,cameraIds:[],objectTracks:[{}]}],f=await fixture(t,{children:[node('model')],clips});let played;f.runtime.playAnimation=index=>{played=index;};f.tab('场景');assert.equal(f.catalogCalls,2);
 f.element.querySelector('[data-animation-index="7"]').click();assert.equal(played,7);clips[0].objectTracks=[];f.tab('场景');assert.equal(f.catalogCalls,3);assert.equal(f.element.querySelector('[data-animation-index]'),null);
});
