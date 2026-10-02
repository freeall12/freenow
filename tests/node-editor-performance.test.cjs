const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../node-editor.js'),'utf8');
const layoutSource=fs.readFileSync(require.resolve('../src/features/node-composer/layout.mjs'),'utf8');
const functionSource=(name,next)=>source.slice(source.indexOf('  function '+name+'('),source.indexOf('  function '+next+'('));
const placement=layoutSource.slice(layoutSource.indexOf('export function placeComposer('),layoutSource.indexOf('\nconst css =')).replace('export ','');
function panel(width=680){return {hidden:false,offsetWidth:width,style:{},classList:{add(){},remove(){}}};}
function harness(){
 const box=panel(),bounds={left:17.25,top:8.75,width:1250,height:690},view={x:-11235.125,y:475.875,scale:.22841067612171173},counts={content:0,popovers:0,history:0};
 const context={panel:box,node:{id:'a',type:'image',x:52000.125,y:1200.375,width:435.25,height:250.75},config:{model:'Tap Nano 2'},positionReady:false,app:{getState:()=>({view})},$:()=>({getBoundingClientRect:()=>bounds}),contentControl:()=>counts.content++,window:{NodeEditor:{layoutFor:()=>null},ImageHistory:{layoutFor:()=>{counts.history++;return context.historyLayout||null;}}},draftFinalUI:{finalMode:()=>false},placePopover:()=>counts.popovers++};
 vm.createContext(context);vm.runInContext(placement,context);context.composerLayout={placeComposer:context.placeComposer};vm.runInContext(functionSource('position','onRender'),context);
 return {context,box,bounds,view,counts};
}
test('pure viewport positioning preserves exact source anchor without remeasuring composer content',()=>{
 const {context,box,bounds,view,counts}=harness();context.position();assert.equal(counts.content,1);
 const expected=panel();let baselineMeasurements=0;const baseline={contentControl:()=>baselineMeasurements++};vm.createContext(baseline);vm.runInContext(placement,baseline);
 for(let i=0;i<180;i++){
  view.x=-11000.123456+Math.sin(i/9)*600;view.y=453.98765+Math.cos(i/11)*300;view.scale=.15+i/180*1.75;box.offsetWidth=expected.offsetWidth=i<90?680:720.25;
  context.position({viewportOnly:true});baseline.placeComposer(expected,context.node,view,bounds,context.config);
  assert.equal(box.style.left,expected.style.left);assert.equal(box.style.top,expected.style.top);
 }
 assert.equal(counts.content,1);assert.equal(baselineMeasurements,180);assert.equal(counts.popovers,181);assert.equal(counts.history,181);
});
test('full layout invalidations and live historical bounds still update after viewport frames',()=>{
 const {context,box,counts}=harness();context.position({viewportOnly:true});assert.equal(counts.content,1);
 context.historyLayout={x:52050.375,y:1203.25,width:510.125,height:280.625};context.position({viewportOnly:true});assert.equal(counts.content,1);
 const before=box.style.left;context.position();assert.equal(counts.content,2);assert.equal(box.style.left,before);
 context.node={...context.node,id:'b',type:'video'};context.config={model:'Kling 3.0 Omni'};context.positionReady=false;context.position({viewportOnly:true});assert.equal(counts.content,3);assert.equal(box.style.minWidth,'740px');
 box.hidden=true;context.position();assert.equal(counts.content,3);
});
class Element{
 constructor(tag,cls='',text){this.tag=tag;this.className=cls;this.textContent=text;this.children=[];this.classList={toggle(){}};}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}setAttribute(key,value){this[key]=value;}insertAdjacentHTML(){}
 querySelector(selector){return this.children.find(child=>selector==='.'+child.className)||null;}
}
test('one footer rebuild projects video inputs and specification once, preserving labels/audio',()=>{
 const footer=new Element('div','generation-footer'),prompt={},counts={inputs:0,configuration:0};
 const context={node:{id:'v',type:'video'},config:{model:'Seedance 2.5 样片',mode:'全能参考',ratio:'16:9',quality:'480p',duration:8,count:1},draftFinalUI:null,panel:{querySelector:selector=>selector==='.generation-footer'?footer:prompt},pop:{hidden:true},popAnchor:null,
 make:(...args)=>new Element(...args),button:(label,fn,cls)=>Object.assign(new Element('button',cls,label),{onclick:fn}),icon:()=>'<svg/>',imageMenus:null,videoInputs:()=>{counts.inputs++;return [];},videoMenus:{modelIcon:()=>null,modelFor:()=>({name:'Seedance 2.5 样片'}),configuration:()=>{counts.configuration++;return {modeOptions:['全能参考'],settings:{audio:true},options:{supportsAudio:true}};},triggerLabel:()=> '全能参考 · 16:9 · 480p · 8s',audioIcon:enabled=>new Element('span','audio',String(enabled))},modelMenu(){},qualityMenu(){},countMenu(){},submitGeneration(){},promptControl:null,focusEdit:null,activeId:'v',updateBusyState(){},placePopover(){},window:{VoiceInput:{bind(){}},REFERENCE_ICONS:{10:'<svg/>'}}};
 vm.createContext(context);vm.runInContext(functionSource('refreshFooter','imageInputCount'),context);context.refreshFooter();assert.equal(counts.configuration,1);assert.equal(counts.inputs,1);
 const quality=footer.querySelector('.quality-trigger');assert.equal(quality.children[0].textContent,'全能参考 · 16:9 · 480p · 8s');assert.equal(quality.children.at(-1).textContent,'true');assert.equal(footer.querySelector('.model-trigger').children[0].textContent,'Seedance 2.5 样片');
});
test('final-node full render positions once through its state update callback',()=>{
 const node={id:'final',type:'video',generation:{model:'Seedance 2.5',draftVideoId:'draft-file'}};let positions=0;
 const context={node,activeId:node.id,draftFinalSignature:'final:final-node',panel:{hidden:false},app:{getState:()=>({nodes:[node],selected:[node.id]})},draftFinalUI:{syncBadges(){},signature:()=> 'final:final-node',finalMode:()=>true},getConfig:()=>node.generation,structuredClone,updateBusyState:()=>positions++,window:{EDITOR_DATA:null}};
 vm.createContext(context);const start=source.indexOf('  function onRender('),end=source.indexOf('\n  for(const surface',start);vm.runInContext(source.slice(start,end),context);context.onRender();assert.equal(positions,1);
});
