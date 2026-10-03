const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const start=source.indexOf('    applyAudioSubtitle('),end=source.indexOf('    async commitGenerationPlan(',start);
assert.ok(start>0&&end>start);
function fixture(){
 const audio={id:'audio',type:'audio',audio:'asset:real-audio',x:52000.375,y:-1400.125,width:300.25,height:300};
 const c={nodes:[audio],edges:[],selected:new Set(['keep-selection']),history:[],saves:0,window:{},TextEncoder,crypto:require('node:crypto'),flushGesture(){},
  remember(){c.history.push(structuredClone({nodes:c.nodes,edges:c.edges}));},rebuildAndPersist(){c.saves++;}};
 vm.createContext(c);vm.runInContext('var api={'+source.slice(start,end)+'};',c);
 const plan=(extra={})=>({source:audio,sourceAudio:audio.audio,existing:null,existingContent:null,text:'第一行字幕\nSecond line',title:'音频字幕',...extra});
 return {c,audio,plan,apply:(p,options)=>c.api.applyAudioSubtitle(p,options)};
}
test('subtitle transaction preserves exact world placement and selection with one node/edge undo',()=>{
 const f=fixture(),n=f.apply(f.plan());
 assert.equal(n.x,52380.625);assert.equal(n.y,-1400.125);assert.equal(n.width,300);assert.equal(n.height,200);
 assert.equal(n.textMode,'pure');assert.equal(n.sourceAudioNodeId,'audio');assert.equal(n.content,'第一行字幕\nSecond line');
 assert.deepEqual([...f.c.selected],['keep-selection']);assert.equal(f.c.history.length,1);assert.equal(f.c.saves,1);
 assert.deepEqual({...f.c.edges[0]},{id:f.c.edges[0].id,source:'audio',target:n.id,sourceHandle:'right',targetHandle:'left'});
 const previous=f.c.history[0];assert.equal(previous.nodes.length,1);assert.equal(previous.edges.length,0);
 const update=f.plan({existing:n,existingContent:n.content,text:'新版\n准确字幕'});f.apply(update);
 assert.equal(f.c.nodes.length,2);assert.equal(f.c.edges.length,1);assert.equal(f.c.history.length,2);assert.equal(n.x,52380.625);
 f.apply(f.plan({existing:n,existingContent:n.content,text:n.content}));assert.equal(f.c.history.length,2);assert.equal(f.c.saves,2);
});
test('an unflushed rich-text subtitle draft blocks result application without destroying or flushing it',()=>{
 const f=fixture(),existing=f.apply(f.plan()),draft={node:existing,readonly:false,dirty:true,conflict:false,saved:existing.content,draft:'用户正在输入的字幕'};
 f.c.session=draft;
 const textUI=fs.readFileSync(require.resolve('../canvas-text-ui.js'),'utf8');
 vm.runInContext(textUI.slice(textUI.indexOf('  function hasPendingEdits('),textUI.indexOf('  function flush(')),f.c);
 f.c.window.CanvasTextUI={hasPendingEdits:f.c.hasPendingEdits};
 assert.throws(()=>f.apply(f.plan({existing,existingContent:existing.content,text:'generated replacement'})),/字幕未应用/);
 assert.equal(existing.content,draft.saved);assert.equal(draft.draft,'用户正在输入的字幕');assert.equal(draft.dirty,true);assert.equal(draft.conflict,false);assert.equal(f.c.history.length,1);
 draft.dirty=false;draft.conflict=true;assert.equal(f.c.hasPendingEdits(existing.id),true);
 draft.conflict=false;assert.equal(f.c.hasPendingEdits(existing.id),false);
});
test('stale audio identity/content, duplicate subtitles and lost ownership never mutate or add undo',()=>{
 for(const change of [
  (f,p)=>{f.c.nodes[0]={...f.audio};},
  (f,p)=>{f.audio.audio='asset:new-audio';},
  (f,p)=>{f.c.nodes.push({id:'other',type:'text',sourceAudioNodeId:'audio',content:'keep'});},
  (f,p)=>{p.text='x'.repeat(32769);},
  (f,p)=>{p.text='  ';},
 ]){
  const f=fixture(),p=f.plan();change(f,p);const before=JSON.stringify(f.c.nodes);
  assert.throws(()=>f.apply(p),/字幕未应用/);assert.equal(JSON.stringify(f.c.nodes),before);assert.equal(f.c.history.length,0);assert.equal(f.c.saves,0);
 }
 const f=fixture();assert.throws(()=>f.apply(f.plan(),{isCurrent:()=>false}),/字幕未应用/);assert.equal(f.c.history.length,0);
 const existing=f.apply(f.plan()),p=f.plan({existing,existingContent:existing.content,text:'new'});existing.content='user edit';
 assert.throws(()=>f.apply(p),/字幕未应用/);assert.equal(existing.content,'user edit');assert.equal(f.c.history.length,1);
});
