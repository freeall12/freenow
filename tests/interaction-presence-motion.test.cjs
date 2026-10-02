'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

function fixture({reduced=false}={}){
  const preference={matches:reduced,addEventListener(type,fn){this.listener=fn;},removeEventListener(){this.listener=null;}};
  const element={hidden:true,style:{},attributes:{},calls:[],setAttribute(key,value){this.attributes[key]=value;},animate(frames,options){
    let resolve,reject;
    const animation={frames,options,finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),finish:()=>resolve(),cancel(){this.cancelled=true;reject(new Error('cancelled'));}};
    this.calls.push(animation);return animation;
  }};
  const context={module:{exports:{}},matchMedia:()=>preference,getComputedStyle:()=>({opacity:'.4',transform:'matrix(.8,0,0,.8,0,0)'})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../component-library/ui.js'),'utf8'),context);
  let removed=0;
  const motion=context.module.exports.createPresenceMotion(element,{onHidden:()=>removed++});
  const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
  return {element,motion,preference,flush,removed:()=>removed};
}

test('close during entry disables interaction; reopening survives stale cancelled completion',async()=>{
  const f=fixture();f.motion.enter();assert.equal(f.element.hidden,false);
  f.motion.exit();assert.equal(f.motion.isOpen,false);assert.equal(f.element.inert,true);assert.equal(f.element.attributes['aria-hidden'],'true');
  const old=f.element.calls.slice();f.motion.enter();assert.equal(f.element.inert,false);
  assert.equal(f.element.calls.at(-1).frames[0].opacity,'.4');
  for(const animation of old)animation.finish();await f.flush();
  assert.equal(f.element.hidden,false);assert.equal(f.motion.isOpen,true);assert.equal(f.removed(),0);
  for(const animation of f.element.calls.slice(-2))animation.finish();await f.flush();
  f.motion.exit();f.motion.exit();
  for(const animation of f.element.calls.slice(-2))animation.finish();await f.flush();
  assert.equal(f.element.hidden,true);assert.equal(f.removed(),1);
});

test('destroy prevents pending callbacks; reduced-motion change finishes the current close immediately',async()=>{
  const f=fixture();f.motion.enter();f.motion.destroy();await f.flush();assert.equal(f.removed(),0);assert.equal(f.preference.listener,null);
  const g=fixture();g.motion.enter();g.motion.exit();g.preference.matches=true;g.preference.listener();await g.flush();
  assert.equal(g.element.hidden,true);assert.equal(g.removed(),1);assert.equal(g.element.calls.every(animation=>animation.cancelled),true);
  const h=fixture({reduced:true});h.motion.enter();assert.equal(h.element.calls.length,0);h.motion.exit();assert.equal(h.element.hidden,true);
});

test('exit immediately removes pointer hit-testing and enter restores the original inline value through reversals',async()=>{
 for(const initial of ['','auto','none','inherit']){
  const f=fixture();f.motion.destroy();f.element.style.pointerEvents=initial;
  const context={module:{exports:{}},matchMedia:()=>f.preference,getComputedStyle:()=>({opacity:'.4',transform:'none'})};vm.runInNewContext(fs.readFileSync(require.resolve('../component-library/ui.js'),'utf8'),context);
  const motion=context.module.exports.createPresenceMotion(f.element);motion.enter();assert.equal(f.element.style.pointerEvents,initial);motion.exit();assert.equal(f.element.hidden,false,'exit is still visible during animation');assert.equal(f.element.style.pointerEvents,'none','visible retired overlay cannot cover the next trigger');const retired=f.element.calls.slice();motion.enter();assert.equal(f.element.style.pointerEvents,initial);for(const animation of retired)animation.finish();await f.flush();assert.equal(f.element.style.pointerEvents,initial);assert.equal(motion.isOpen,true);motion.destroy();
 }
 const reduced=fixture({reduced:true});reduced.motion.enter();assert.equal(reduced.element.style.pointerEvents,'');reduced.motion.exit();assert.equal(reduced.element.style.pointerEvents,'none');reduced.motion.enter();assert.equal(reduced.element.style.pointerEvents,'');reduced.motion.destroy();
});
