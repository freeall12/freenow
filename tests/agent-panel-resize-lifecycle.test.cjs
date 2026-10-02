const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const frames=new Map(),events=new Map(),writes=[],widths=[];let next=0;
 function classes(){const items=new Set();return {add:value=>items.add(value),remove:value=>items.delete(value),contains:value=>items.has(value)};}
 const body={classList:classes()};
 const document={body,activeElement:null,createElement(){const attrs=new Map(),capture=new Set();return {classList:classes(),append(){},setAttribute:(name,value)=>attrs.set(name,String(value)),getAttribute:name=>attrs.get(name),focus(){document.activeElement=this;},setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture(id){capture.delete(id);this.onlostpointercapture?.({pointerId:id});}};}};
 const panel={style:{setProperty(name,value){this[name]=value;}}};
 const context={document,innerWidth:1200,localStorage:{getItem:()=> '480',setItem:(...args)=>writes.push(args)},window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/features/agent-composer/panel-resize.mjs'),'utf8').replace(/^export /gm,''),context);
 const control=context.createPanelResize({panel,onWidth:width=>widths.push(width),onError:assert.fail});
 const event=(x,id=1)=>({button:0,clientX:x,pointerId:id,isPrimary:true,preventDefault(){},stopPropagation(){}});
 const key=value=>({key:value,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}});
 const tick=()=>{for(const [id,run]of [...frames]){frames.delete(id);run();}};
 return {control,handle:control.element,panel,document,context,events,frames,writes,widths,event,key,tick};
}
test('resize uses only its pointer and commits the actual pointerup coordinate once',()=>{
 const f=fixture(),h=f.handle;h.onpointerdown(f.event(700));h.onpointermove(f.event(0,2));assert.equal(f.frames.size,0);
 h.onpointermove(f.event(680));h.onpointerup(f.event(100,2));assert.equal(f.writes.length,0);h.onpointerup(f.event(650));
 assert.equal(f.panel.style.width,'530px');assert.equal(f.writes.length,1);assert.equal(f.frames.size,0);assert.equal(h.hasPointerCapture(1),false);assert.equal(f.document.activeElement,h);
 f.tick();assert.equal(f.panel.style.width,'530px');f.control.destroy();
});
test('Escape, pointercancel, capture loss and window blur restore the starting width without saving',()=>{
 for(const mode of ['escape','cancel','capture','blur']){
  const f=fixture(),h=f.handle;h.onpointerdown(f.event(700));h.onpointermove(f.event(660));f.tick();assert.equal(f.panel.style.width,'520px');
  if(mode==='escape'){const event=f.key('Escape');h.onkeydown(event);assert.equal(event.stopped,true);assert.equal(event.defaultPrevented,true);}
  if(mode==='cancel')h.onpointercancel(f.event(660));if(mode==='capture')h.releasePointerCapture(1);if(mode==='blur')f.events.get('blur')();
  assert.equal(f.panel.style.width,'480px',mode);assert.equal(f.writes.length,0,mode);assert.equal(f.document.body.classList.contains('agent-panel-resizing'),false);f.control.destroy();
 }
});
test('unchanged frames and boundary keys do not repeatedly reserve canvas space or write storage',()=>{
 const f=fixture(),h=f.handle;h.onpointerdown(f.event(700));for(let i=0;i<120;i++){h.onpointermove(f.event(700));f.tick();}h.onpointerup(f.event(700));
 assert.deepEqual(f.widths,[480]);assert.equal(f.writes.length,0);
 h.onkeydown(f.key('Home'));h.onkeydown(f.key('Home'));assert.equal(f.panel.style.width,'360px');assert.equal(f.writes.length,1);
 const composing={...f.key('ArrowLeft'),isComposing:true};h.onkeydown(composing);assert.equal(f.writes.length,1);
 f.context.innerWidth=700;f.events.get('resize')();assert.equal(f.widths.at(-1),0);f.control.destroy();
});
test('destroy cancels queued movement, releases capture and leaves no active listeners or persistence',()=>{
 const f=fixture(),h=f.handle;h.onpointerdown(f.event(700));h.onpointermove(f.event(650));f.control.destroy();f.tick();
 assert.equal(f.panel.style.width,'480px');assert.equal(f.frames.size,0);assert.equal(h.hasPointerCapture(1),false);assert.equal(f.events.size,0);assert.equal(f.writes.length,0);assert.equal(h.onpointermove,null);
});
