const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/features/agent-composer/panel-resize.mjs'),'utf8').replace(/^export /gm,'');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture({store,legacy='480',quota=true}={}){
  const events=new Map(),mirrors=[],errors=[],widths=[];
  const classes=()=>({add(){},remove(){}});
  const document={body:{classList:classes()},createElement(){const attrs=new Map(),capture=new Set();return{classList:classes(),append(){},setAttribute:(key,value)=>attrs.set(key,String(value)),getAttribute:key=>attrs.get(key),focus(){},setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture(id){capture.delete(id);this.onlostpointercapture?.({pointerId:id});}};}};
  const context={document,innerWidth:1200,localStorage:{getItem:()=>legacy,setItem(key,value){if(quota)throw Error('QuotaExceededError');mirrors.push({key,value});}},window:{CanvasStore:store,addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)},requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
  vm.runInNewContext(source,context);
  const open=()=>{const panel={style:{setProperty(key,value){this[key]=value;}}},ownWidths=[];const control=context.createPanelResize({panel,onWidth(value){widths.push(value);ownWidths.push(value);},onError:message=>errors.push(message)});return{panel,control,ownWidths,handle:control.element};};
  const key=(owner,value='ArrowLeft')=>owner.handle.onkeydown({key:value,preventDefault(){},stopPropagation(){}});
  const storage=value=>{for(const handler of events.get('storage')||[])handler({key:'tapnow-agent-panel-width',newValue:String(value)});};
  return{open,key,storage,errors,mirrors,widths};
}

test('durable width survives full localStorage and refresh, with legacy migration and late-read drag protection',async()=>{
  let record,reads=0;const writes=[];
  const store={async readRecord(key){reads++;assert.equal(key,'agent-panel-width');return record;},async writeRecord(key,value){assert.equal(key,'agent-panel-width');writes.push(value.width);record={...value};}};
  const f=fixture({store,legacy:'510'}),owner=f.open();assert.equal(owner.panel.style.width,'510px');await settle();
  assert.deepEqual(writes,[510]);f.key(owner);await settle();assert.equal(record.width,520);assert.deepEqual(f.errors,[]);
  owner.control.destroy();const reopen=f.open();await settle();assert.equal(reads,1);assert.equal(reopen.panel.style.width,'520px');reopen.control.destroy();
  const refreshed=fixture({store,legacy:'510'}),next=refreshed.open();await settle();assert.equal(next.panel.style.width,'520px');assert.deepEqual(refreshed.errors,[]);

  const read=deferred(),saved=[];const delayed=fixture({store:{readRecord:()=>read.promise,async writeRecord(_key,value){saved.push(value.width);}}});
  const dragging=delayed.open(),event=x=>({button:0,isPrimary:true,pointerId:1,clientX:x,preventDefault(){},stopPropagation(){}});
  dragging.handle.onpointerdown(event(700));read.resolve({width:400});await settle();assert.equal(dragging.panel.style.width,'480px');
  dragging.handle.onpointerup(event(644));await settle();assert.equal(dragging.panel.style.width,'536px');assert.deepEqual(saved,[536]);assert.deepEqual(delayed.errors,[]);
});

test('rapid writes and reopen retain one latest queued value; destroyed owners cannot reclaim UI or report failures',async()=>{
  const blocked=deferred(),writes=[];let calls=0;
  const store={async readRecord(){return{width:480};},async writeRecord(_key,value){writes.push(value.width);if(++calls===1)await blocked.promise;}};
  const f=fixture({store}),owner=f.open();await settle();f.key(owner);await settle();assert.deepEqual(writes,[490]);
  for(let i=0;i<120;i++)f.key(owner,i%2?'ArrowLeft':'ArrowRight');
  f.key(owner);owner.control.destroy();const reopened=f.open();assert.equal(reopened.panel.style.width,'500px');
  blocked.resolve();await settle();assert.deepEqual(writes,[490,500]);assert.equal(reopened.panel.style.width,'500px');assert.deepEqual(f.errors,[]);

  const read=deferred(),lost=fixture({store:{readRecord:()=>read.promise,async writeRecord(){throw Error('save failed');}}}),closed=lost.open();
  lost.key(closed);closed.control.destroy();const originalWidths=[...closed.ownWidths];read.resolve({width:400});await settle();
  assert.deepEqual(closed.ownWidths,originalWidths);assert.deepEqual(lost.errors,[]);
});

test('record failures retain visible widths and storage events without force-retrying conflicts or touching graphs',async()=>{
  const writes=[],conflict=Object.assign(Error('stale record'),{name:'AgentConversationConflictError'});
  const f=fixture({store:{async readRecord(){return{width:480};},async writeRecord(key,value){writes.push([key,value.width]);throw conflict;}}}),owner=f.open();await settle();
  f.key(owner);await settle();assert.equal(owner.panel.style.width,'490px');assert.deepEqual(writes,[['agent-panel-width',490]]);assert.match(f.errors[0],/另一窗口/);
  f.storage(530);assert.equal(owner.panel.style.width,'530px');await settle();assert.equal(writes.length,1);owner.control.destroy();const reopen=f.open();assert.equal(reopen.panel.style.width,'530px');
  const failed=fixture({store:{async readRecord(){throw Error('read failed');},async writeRecord(){assert.fail('unsafe write without successful revision read');}}}),next=failed.open();await settle();failed.key(next);await settle();assert.equal(next.panel.style.width,'490px');assert.deepEqual(failed.errors,['对话宽度未能保存']);
});
