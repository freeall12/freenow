const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(kind) {
  const source = fs.readFileSync(require.resolve(`../image-${kind}-ui.mjs`), 'utf8');
  const from = source.indexOf('function renderPending('), until = source.indexOf('\n}', from) + 2;
  assert.ok(from >= 0 && until > from);
  const metrics = {reads:0,queries:0,writes:0,attributes:0,toggles:0,placed:0,closed:0};
  const pending = new Set(), classes = new Set(), placeholders = new Map();
  function placeholder() {
    let text='',role=null;
    return {get textContent(){return text;},set textContent(v){text=v;metrics.writes++;},getAttribute(){return role;},setAttribute(_k,v){role=v;metrics.attributes++;}};
  }
  const nodes = Array.from({length:500},(_,i)=>({id:`n${i}`,image:'image.png',get pendingOperation(){metrics.reads++;return i<4?`image.${kind}`:null;}}));
  nodes.slice(0,4).forEach(n=>placeholders.set(n.id,placeholder()));
  const state={nodes,selected:['n0']}, context={pending,operations:pending,app:{getState:()=>state},current:null,source:n=>n?.image,CSS:{escape:s=>s},document:{
    querySelector(selector){metrics.queries++;return placeholders.get(selector.match(/data-id="([^"]+)"/)[1])||null;},
    body:{classList:{contains:s=>classes.has(s),toggle(s,on){metrics.toggles++;if(on)classes.add(s);else classes.delete(s);}}},
    addEventListener(type,handler){context.listener=handler;},
  }};
  vm.createContext(context);vm.runInContext(source.slice(from,until),context);
  // Use the actual registered listener to catch lost event forwarding and panel positioning.
  const listener=source.match(/document\.addEventListener\('canvas:render',event=>\{if\(current[^\n]+/);
  if(listener) vm.runInContext(listener[0],context);else context.listener=context.renderPending;
  const reset=()=>Object.keys(metrics).forEach(key=>metrics[key]=0);
  return {context,metrics,state,pending,placeholders,classes,reset,render:event=>context.listener(event),manual:()=>context.renderPending(),panel:()=>context.current={id:'n0',node:nodes[0],src:'image.png',place(){metrics.placed++;},close(){metrics.closed++;context.current=null;}}};
}
for(const kind of ['erase','outpaint','redraw','relight']) {
  test(`${kind}: viewport changes scan no task nodes and do not mutate placeholders`,()=>{
    const f=fixture(kind);f.manual();f.reset();
    for(let i=0;i<90;i++)f.render({detail:{viewportOnly:true}});
    assert.deepEqual(f.metrics,{reads:0,queries:0,writes:0,attributes:0,toggles:0,placed:0,closed:0});
  });
  test(`${kind}: running/interrupted transitions, missing DOM and selection remain current`,()=>{
    const f=fixture(kind);f.manual();const p=f.placeholders.get('n0'),interrupted=p.textContent;
    assert.match(interrupted,/中断/);f.reset();f.manual();assert.equal(f.metrics.writes,0);assert.equal(f.metrics.attributes,0);assert.equal(f.metrics.toggles,0);
    f.pending.add('n0');f.manual();assert.match(p.textContent,/正在/);f.pending.delete('n0');f.manual();assert.equal(p.textContent,interrupted);
    p.textContent='stale';f.manual();assert.equal(p.textContent,interrupted);
    f.state.selected=[];f.manual();assert.equal(f.classes.has(`image-${kind}-pending`),false);
    f.placeholders.delete('n0');assert.doesNotThrow(()=>f.manual());
  });
}
for(const kind of ['redraw','relight'])test(`${kind}: active panel follows view while pending scan stays skipped`,()=>{
  const f=fixture(kind);f.reset();f.panel();for(let i=0;i<90;i++)f.render({detail:{viewportOnly:true}});
  assert.equal(f.metrics.placed,90);assert.equal(f.metrics.reads,0);assert.equal(f.metrics.writes,0);
  f.state.selected=[];f.render({detail:{viewportOnly:true}});assert.equal(f.metrics.closed,1);
});

test('relight updates running state even when its panel was closed while preparing assets',async()=>{
  const source=fs.readFileSync(require.resolve('../image-relight-ui.mjs'),'utf8');
  const start=source.indexOf('operations.add(target.id);'),end=source.indexOf('const canvas=',start);
  const f=fixture('relight');f.manual();f.context.target={id:'n0'};f.context.close=()=>{};
  vm.runInContext(`(function(){${source.slice(start,end)}}).call({close})`,f.context);
  assert.match(f.placeholders.get('n0').textContent,/正在/);
  const terminal=source.match(/finally\{(operations.delete\(target.id\);[^}]+)\}/)[1];
  vm.runInContext(terminal,f.context);assert.match(f.placeholders.get('n0').textContent,/中断/);
});
