const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../src/features/studio-v2/viewport-shortcuts.mjs');
async function fixture(){
 const {createViewportKeyHandler}=await modulePromise,calls=[],selected={userData:{studioId:'box'}},runtime={selected,loadStatus:'ready',motionIndex:0,
  focus:object=>calls.push(['focus',object]),focusView:()=>calls.push(['view']),setMode:mode=>calls.push(['mode',mode]),undo:redo=>calls.push(['undo',redo]),remove:id=>calls.push(['remove',id]),
  playback:{toggleMotion:()=>calls.push(['play'])},motion:{open:false,selected:-1,remove:()=>calls.push(['key-remove'])},onError:error=>calls.push(['error',error.message])};
 const handler=createViewportKeyHandler(runtime);
 const key=(key,options={})=>{const event={key,code:key===' '?'Space':'Key'+key.toUpperCase(),defaultPrevented:false,target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...options};handler(event);return event;};
 return {calls,runtime,key,selected};
}

test('focus, transform, motion and undo shortcuts dispatch once to the selected context',async()=>{
 const f=await fixture();
 for(const key of ['f','p','r','t',' '])assert.equal(f.key(key).defaultPrevented,true);
 f.key('z',{metaKey:true});f.key('Z',{metaKey:true,shiftKey:true});f.key('y',{ctrlKey:true});
 assert.deepEqual(f.calls,[['focus',f.selected],['view'],['mode','translate'],['mode','rotate'],['mode','scale'],['play'],['undo',false],['undo',true],['undo',true]]);
});

test('modifier keys, composition, native interactive controls and repeated deletion leave scene data untouched',async()=>{
 const f=await fixture();
 for(const options of [{shiftKey:true},{altKey:true},{metaKey:true},{ctrlKey:true},{isComposing:true},{defaultPrevented:true},{target:{closest:()=>({})}}])f.key('Delete',options);
 f.key('Delete',{repeat:true});f.key('z',{metaKey:true,altKey:true});f.key('p',{shiftKey:true});
 assert.deepEqual(f.calls,[]);
 f.key('Delete');assert.deepEqual(f.calls,[['remove','box']]);
 f.runtime.motion.open=true;f.runtime.motion.selected=1;f.key('Backspace');assert.deepEqual(f.calls.at(-1),['key-remove']);
});

test('unavailable playback, no selection, loading and export states do not consume unrelated keys',async()=>{
 const f=await fixture();f.runtime.motionIndex=-1;f.runtime.selected=null;
 for(const key of ['f','p','r','t','Delete',' '])assert.equal(f.key(key).defaultPrevented,false);
 f.runtime.selected=f.selected;
 for(const patch of [{loadStatus:'loading'},{loadStatus:'ready',exporting:true},{exporting:false,closed:true}]){Object.assign(f.runtime,patch);assert.equal(f.key('Delete').defaultPrevented,false);}
 assert.deepEqual(f.calls,[]);
});

test('keyframe transforms remain available without object selection and failures reach the runtime error surface',async()=>{
 const f=await fixture();f.runtime.selected=null;f.runtime.motion.open=true;f.runtime.motion.selected=1;
 f.key('r');assert.deepEqual(f.calls,[['mode','rotate']]);
 f.runtime.motion.remove=()=>{throw Error('至少保留两个关键帧');};f.key('Delete');assert.deepEqual(f.calls.at(-1),['error','至少保留两个关键帧']);
 f.runtime.undo=()=>Promise.reject(Error('读取失败'));f.key('z',{metaKey:true});await Promise.resolve();assert.deepEqual(f.calls.at(-1),['error','读取失败']);
});
