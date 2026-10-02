const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');
if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const modules=Promise.all([import('../src/features/studio-v2/scene-panel.mjs'),import('../src/features/studio-v2/classes.mjs')]);
const object=(id,hidden=false)=>({name:id,userData:{studioId:id,studioMotionSource:hidden},children:[]});
async function fixture(t,{children=[],cameras=[],clips=[]}={}){
 const [{createScenePanel},{classes}]=await modules,dom=new JSDOM('<body/>');
 const previous={document:global.document,window:global.window};global.document=dom.window.document;global.window=dom.window;
 t.after(()=>{dom.window.close();Object.assign(global,previous);});
 const canvas=document.createElement('canvas');canvas.tabIndex=0;document.body.append(canvas);
 const calls=[],runtime={content:{children,userData:{}},selected:null,shotId:cameras[0]?.id,motionIndex:clips[0]?.index,
  focusView:()=>canvas.focus({preventScroll:true}),focus:value=>calls.push(['frame',value]),objects:()=>cameras,find:id=>cameras.find(camera=>camera.id===id),select:value=>calls.push(['object',value]),
  selectShot:id=>calls.push(['shot',id]),selectMotion:(index,id)=>calls.push(['motion',index,id]),motion:{start:(index,id)=>calls.push(['edit',index,id])},
  playback:{catalog:()=>clips,index:-1,target:'camera',playing:false}};
 const panel=createScenePanel(runtime),element=panel.render();document.body.append(element);
 const scene=()=>[...element.querySelectorAll('.'+classes.panelTab)].find(button=>button.textContent==='场景').click();
 return {element,classes,calls,scene,runtime,canvas};
}

test('hidden motion source nodes never create an empty show-more page',async t=>{
 const f=await fixture(t,{children:[...Array.from({length:50},(_,i)=>object('visible-'+i)),...Array.from({length:51},(_,i)=>object('hidden-'+i,true))]});f.scene();
 assert.equal(f.element.querySelectorAll('.'+f.classes.treeSelect).length,50);
 assert.equal(f.element.querySelector('.'+f.classes.moreObjects),null);
 assert.doesNotMatch(f.element.textContent,/hidden-/);
});

test('pagination counts visible nodes and a real second page remains selectable',async t=>{
 const children=Array.from({length:51},(_,i)=>object('visible-'+i));children.splice(5,0,...Array.from({length:80},(_,i)=>object('source-'+i,true)));
 const f=await fixture(t,{children});f.scene();assert.equal(f.element.querySelectorAll('.'+f.classes.treeSelect).length,50);
 f.element.querySelector('.'+f.classes.moreObjects).click();
 const rows=f.element.querySelectorAll('.'+f.classes.treeSelect);assert.equal(rows.length,51);assert.equal(f.element.querySelector('.'+f.classes.moreObjects),null);
 rows[50].click();assert.deepEqual(f.calls,[['object',children.at(-1)],['frame',children.at(-1)]]);
 assert.equal(document.activeElement,f.canvas);
 assert.equal(rows[50].querySelector('span').title,'visible-50');
});

test('long shot and motion names retain official truncation spans and full hover labels without losing actions',async t=>{
 const name='很长的镜头名称 · 保留完整悬停说明',camera={id:'camera',kind:'camera',name,userData:{studioId:'camera'}},clip={index:3,name:'环绕推进的完整运镜名称',duration:2,cameraIds:['camera'],objectTracks:[]};
 const f=await fixture(t,{cameras:[camera],clips:[clip]});
 const shot=f.element.querySelector('.'+f.classes.shotRow);assert.equal(shot.querySelector('span').title,name);assert.equal(shot.querySelector('span').textContent,name);assert.equal(shot.querySelector('small').title,'1 段运镜');shot.click();
 const label=f.element.querySelector('.'+f.classes.clipLabel);assert.equal(label.title,clip.name+' · '+name);
 const association=label.querySelector('.'+f.classes.clipAssociation);assert.equal(association.querySelector('span').textContent,name);assert.equal(association.querySelector('svg').getAttribute('width'),'11');assert.equal(association.querySelector('svg').getAttribute('aria-hidden'),'true');
 f.element.querySelector('.'+f.classes.clip).click();f.element.querySelector('.'+f.classes.clipEdit).click();
 assert.deepEqual(f.calls,[['shot','camera'],['motion',3,'camera'],['edit',3,'camera']]);
});
