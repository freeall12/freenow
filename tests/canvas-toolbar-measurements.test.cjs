const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../canvas-menus.js'),'utf8');
const implementation=source.slice(source.indexOf('  function toolbarMeasurements('),source.indexOf('  const measureToolbar='));
function fixture(){
 let records=[],notifyResize,deliverMutation,onWindowResize,reads=0,resizeCalls=0;
 const dimensions={width:398,height:48,canvas:1280};
 const element={className:'node-toolbar image-tools',style:{cssText:'left: 8px; top: 65px;'},get offsetWidth(){reads++;return dimensions.width;},get offsetHeight(){reads++;return dimensions.height;}};
 const canvas={get clientWidth(){reads++;return dimensions.canvas;}};
 const context={MutationObserver:class{constructor(fn){deliverMutation=fn;}observe(){}takeRecords(){const value=records;records=[];return value;}},ResizeObserver:class{constructor(fn){notifyResize=fn;}observe(){}},window:{addEventListener(type,fn){if(type==='resize')onWindowResize=fn;}}};
 vm.runInNewContext(implementation+';this.measure=toolbarMeasurements;',context);
 const measure=context.measure(element,canvas,()=>resizeCalls++);
 return{measure,element,canvas,dimensions,get reads(){return reads;},get resizeCalls(){return resizeCalls;},record(record){records.push(record);},deliver(){deliverMutation(records);records=[];},resize(){notifyResize();},windowResize(){onWindowResize();}};
}
test('ordinary movement and no-op class changes reuse measurements without layout reads',()=>{
 const f=fixture();assert.equal(f.measure().width,398);assert.equal(f.reads,3);
 for(let i=0;i<180;i++){
  f.element.style.cssText=`left: ${8+i*.125}px; top: ${65-i*.375}px;`;
  f.record({target:f.element,type:'attributes',attributeName:'style'});
  f.record({target:f.element,type:'attributes',attributeName:'class'});
  assert.equal(f.measure().height,48);f.deliver();
 }
 assert.equal(f.reads,3);
});
test('synchronous structure, sizing styles, visibility and class changes invalidate before observer delivery',()=>{
 const f=fixture();f.measure();
 for(const record of [{type:'childList'},{type:'characterData'},{type:'attributes',attributeName:'hidden'}]){
  f.dimensions.width+=20;f.record({target:f.element,...record});assert.equal(f.measure().width,f.dimensions.width);
 }
 f.element.className='node-toolbar video-tools';f.dimensions.width=526;f.record({target:f.element,type:'attributes',attributeName:'class'});assert.equal(f.measure().width,526);
 f.element.style.cssText+=' width: 400px;';f.dimensions.width=400;f.record({target:f.element,type:'attributes',attributeName:'style'});assert.equal(f.measure().width,400);
 f.dimensions.height=60;f.record({target:{},type:'attributes',attributeName:'style'});assert.equal(f.measure().height,60);
});
test('observer and window resizing refresh canvas bounds and request repositioning',()=>{
 const f=fixture();f.measure();f.dimensions.canvas=711;f.dimensions.width=390;f.resize();assert.equal(f.resizeCalls,1);assert.equal(f.measure().canvasWidth,711);assert.equal(f.measure().width,390);
 f.dimensions.canvas=480;f.windowResize();assert.equal(f.measure().canvasWidth,480);
 f.dimensions.canvas=600;f.record({target:f.canvas,type:'attributes',attributeName:'style'});assert.equal(f.measure().canvasWidth,600);
});
test('size transitions read the current animation frame before ResizeObserver delivers and settle back to cache',()=>{
 const f=fixture(),animation={transitionProperty:'margin-left',playState:'running',pending:false};
 let animationReads=0;f.element.getAnimations=()=>{animationReads++;return [animation,{transitionProperty:'opacity',playState:'running'}];};
 f.measure();
 for(const width of [389,393,397,398]){f.dimensions.width=width;assert.equal(f.measure().width,width);}
 animation.playState='finished';f.dimensions.width=400;assert.equal(f.measure().width,400);
 const reads=f.reads,queries=animationReads;for(let i=0;i<180;i++)assert.equal(f.measure().width,400);
 assert.equal(f.reads,reads);assert.equal(animationReads,queries);
});
