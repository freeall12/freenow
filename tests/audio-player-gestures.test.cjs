'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function fixture(options={dragSurface:true},nodeId='audio-node'){
 const selected=[],canvasEvents=[];
 class Element{
  constructor(tag,cls=''){this.tagName=tag;this.className=cls;this.children=[];this.clientWidth=260;this.clientHeight=120;this.currentTime=0;this.duration=10;this.paused=true;}
  append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
  setAttribute(){} removeAttribute(){} load(){} pause(){this.paused=true;}
  play(){this.paused=false;return Promise.resolve();}
  closest(selector){return selector==='button'?(this.tagName==='button'?this:this.parentNode?.closest(selector)||null):null;}
  setPointerCapture(id){this.capture=id;}
  getBoundingClientRect(){return {left:100,width:260};}
  getContext(){const gradient={addColorStop(){}};return new Proxy({createLinearGradient:()=>gradient},{get:(object,key)=>object[key]||(()=>{})});}
  querySelectorAll(){return this.children.flatMap(child=>[...(child.tagName==='button'?[child]:[]),...child.querySelectorAll()]);}
 }
 const context={app:{getState:()=>({selected:[]}),select:id=>selected.push(id)},el:(tag,cls)=>new Element(tag,cls),button:(label,_icon,action)=>{const b=new Element('button');b.label=label;b.onclick=action;b.click=action;return b;},icon:()=>'',devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){} disconnect(){}},window:{LocalAssets:{url:()=>new Promise(()=>{})}},decode:()=>new Promise(()=>{}),time:t=>String(t),playing:null,Math};
 vm.createContext(context);
 const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' function makePlayer('),end=source.indexOf('\n async function localize(',start);
 vm.runInContext(source.slice(start,end),context);
 const player=context.makePlayer('asset:local-wave',nodeId,options),waveWrap=player.wrap.children[0],wave=waveWrap.children[0],controls=player.wrap.children[1];
 player.audio.onloadedmetadata();
 function pointer(target,{button=0,x=230}={}){
  const event={target,button,clientX:x,pointerId:7,stopped:false,prevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;}};
  target.onpointerdown?.(event);
  if(!event.stopped&&target!==player.wrap)player.wrap.onpointerdown(event);
  if(!event.stopped)canvasEvents.push(event);
  return event;
 }
 return {player,waveWrap,wave,controls,selected,canvasEvents,pointer};
}

test('node player surrounding surface reaches the canvas while left waveform scrub stays local',()=>{
 const f=fixture();
 assert.equal(f.pointer(f.waveWrap).stopped,false);assert.equal(f.pointer(f.controls).stopped,false);
 assert.equal(f.canvasEvents.length,2);assert.deepEqual(f.selected,[]);assert.equal(f.player.audio.currentTime,0);
 const scrub=f.pointer(f.wave,{x:230});assert.equal(scrub.stopped,true);assert.equal(scrub.prevented,true);assert.equal(f.wave.capture,7);assert.equal(f.player.audio.currentTime,5);
 f.wave.onpointermove({clientX:295});assert.equal(f.player.audio.currentTime,7.5);f.wave.onpointerup();
 f.wave.onpointermove({clientX:360});assert.equal(f.player.audio.currentTime,7.5);assert.equal(f.canvasEvents.length,2);
});

test('middle and right waveform gestures do not seek and reach canvas pan/context handling',()=>{
 const f=fixture();for(const button of [1,2]){const event=f.pointer(f.wave,{button,x:360});assert.equal(event.stopped,false);assert.equal(event.prevented,false);}
 assert.equal(f.canvasEvents.length,2);assert.equal(f.player.audio.currentTime,0);assert.equal(f.wave.capture,undefined);
});

test('nested playback button targets stop dragging and retain playback/skip actions',async()=>{
 const f=fixture(),[rewind,play,forward]=f.controls.children,icon={closest:selector=>play.closest(selector)};
 assert.equal(f.pointer(icon).stopped,true);assert.equal(f.pointer(forward).stopped,true);assert.equal(f.canvasEvents.length,0);
 await play.onclick();assert.equal(f.player.audio.paused,false);forward.onclick();assert.equal(f.player.audio.currentTime,10);rewind.onclick();assert.equal(f.player.audio.currentTime,0);
 await play.onclick();assert.equal(f.player.audio.paused,true);
});

test('preview/background clicks stay local and waveform remains seekable',()=>{
 const f=fixture({},undefined);assert.equal(f.pointer(f.waveWrap).stopped,true);assert.equal(f.canvasEvents.length,0);
 f.pointer(f.wave,{x:165});assert.equal(f.player.audio.currentTime,2.5);assert.equal(f.canvasEvents.length,0);
});

test('nonseekable drag surface does not capture waveform pointers or change playback',()=>{
 const f=fixture({dragSurface:true,seekable:false});assert.equal(f.pointer(f.wave).stopped,false);assert.equal(f.player.audio.currentTime,0);assert.equal(f.wave.capture,undefined);
});

test('waveform scrubbing resumes a playing clip without making a canvas gesture',async()=>{
 const f=fixture();await f.controls.children[1].onclick();f.pointer(f.wave,{x:295});assert.equal(f.player.audio.paused,true);f.wave.onpointerup();assert.equal(f.player.audio.paused,false);assert.equal(f.player.audio.currentTime,7.5);assert.equal(f.canvasEvents.length,0);
});
