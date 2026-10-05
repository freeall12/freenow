const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const original = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/performance-rhythm@v3.9ead0d0b.html'), 'utf8');
const runtime = import('../src/features/agent-apps/performance-rhythm-local-interactions.mjs');
const fixture = () => ({curve: [{id:'p1',at_ms:0,drive:24},{id:'p2',at_ms:6200,drive:86},{id:'p3',at_ms:12000,drive:42}], beats: [{id:'b1',at_ms:6500,kind:'pause',intensity:3,label:'吞回真话'}], playhead_ms:0,selected_id:'b1',selected_type:'beat',review_requested:false});
const deferred = () => {let resolve, reject;const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject};};
async function derived() {return (await runtime).localizePerformanceRhythmInteractions(original,'performance-rhythm','v3');}
async function harness(request) {
  const html = await derived(), state = fixture(), requests = [], messages = [];
  const context = {structuredClone, clearTimeout, setTimeout, state, requests, messages, dt:false, Ms:false, De:null, Ls:{inert:false,contains:()=>true},document:{activeElement:null,documentElement:{lang:'zh-CN'}},navigator:{userActivation:{isActive:true}},ye:{textContent:''}, w:{duration_ms:12000}, ne:()=>({}), X:()=>{}, failed:0,
    bb:()=>structuredClone(state), Rb:()=> '采用 12.0s 表演节奏：3 个曲线点、1 个节拍标记。', Ki:()=>{context.failed++;context.ye.textContent='发送失败，请重试';},
    Xt:{request:async value=>{requests.push(value.params.state);await request?.(value.params.state);},sendMessage:async value=>{messages.push(value);}}};
  vm.createContext(context);
  const utility = original.slice(original.indexOf('function lp(e)'), original.indexOf('function vb(e,'));
  const persistence = html.slice(html.indexOf('let rhythmSaveLatest='),html.indexOf('async function gp('));
  const confirmation = html.slice(html.indexOf('async function Zb('),html.indexOf('function Ki(){'));
  vm.runInContext('const Ei=["pause","emphasis","interruption","overlap","emotion_turn","action"],Ni=/^[a-z0-9][a-z0-9_-]{0,23}$/,lt=100;'+utility+persistence+confirmation,context);
  return {context,state,requests,messages,run:code=>vm.runInContext(code,context)};
}
test('local derivative requires the exact captured v3 SHA and leaves official bytes intact',async()=>{
  const {localizePerformanceRhythmInteractions,performanceRhythmSourceSha256} = await runtime;
  assert.equal(require('node:crypto').createHash('sha256').update(original).digest('hex'),performanceRhythmSourceSha256);
  assert.equal(await localizePerformanceRhythmInteractions('other','story-room','v1'),'other');
  await assert.rejects(localizePerformanceRhythmInteractions(original+'\n','performance-rhythm','v3'),/integrity mismatch/);
  await assert.rejects(localizePerformanceRhythmInteractions(original,'performance-rhythm','v2'),/unsupported/);
  const html = await derived();assert.notEqual(html,original);
  await assert.rejects(localizePerformanceRhythmInteractions(html,'performance-rhythm','v3'),/integrity mismatch/);
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  // Parse the whole official bundle after substitution, not just extracted fixes.
  require('esbuild').transformSync(script,{loader:'js',format:'esm'});
  assert.equal(fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/performance-rhythm@v3.9ead0d0b.html'),'utf8'),original);
});
test('slow state persistence coalesces intermediate edits and flushes the latest state',async()=>{
  const first = deferred(), h = await harness(()=>h.requests.length===1?first.promise:undefined);
  const pending = h.run('kb(bb())');await Promise.resolve();h.state.curve[1].drive=40;const second=h.run('kb(bb())');h.state.curve[1].drive=60;const third=h.run('kb(bb())');
  assert.equal(pending,second);assert.equal(second,third);assert.equal(h.requests.length,1);
  first.resolve();await pending;
  assert.deepEqual(h.requests.map(value=>value.curve[1].drive),[86,60]);assert.equal(h.messages.length,0);
});
test('completed gestures with unchanged state reuse the actual successful save',async()=>{
  const h=await harness();await h.run('kb(bb())');await h.run('rhythmFlush()');await h.run('rhythmFlush()');
  assert.equal(h.requests.length,1);await h.run('Zb()');assert.equal(h.requests.length,1);assert.equal(h.messages.length,1);
});
test('same-task unchanged save followed by a changed save cannot resolve without saving the change',async()=>{
  const h=await harness();await h.run('kb(bb())');
  const unchanged=h.run('kb(bb())');h.state.curve[1].drive=73;const changed=h.run('kb(bb())');await Promise.all([unchanged,changed]);
  assert.deepEqual(h.requests.map(value=>value.curve[1].drive),[86,73]);
});
test('completion-phase pending save restarts before the waiting callers resolve',async()=>{
  const h=await harness();await h.run('kb(bb())');
  const unchanged=h.run('kb(bb())');await Promise.resolve();h.state.curve[1].drive=51;const changed=h.run('kb(bb())');await Promise.all([unchanged,changed]);
  assert.deepEqual(h.requests.map(value=>value.curve[1].drive),[86,51]);
});
test('confirmation restores the original inert value and connected trigger focus',async()=>{
  const h=await harness();let focused=0;h.context.document.activeElement={isConnected:true,focus(){focused++;}};
  await h.run('Zb()');assert.equal(h.context.Ls.inert,false);assert.equal(focused,1);
  h.context.Ls.inert=true;await h.run('Zb()');assert.equal(h.context.Ls.inert,true);assert.equal(focused,1);
});
test('expired activation after a slow save requires a fresh confirmation click without weakening permissions',async()=>{
  const save=deferred(),h=await harness(()=>save.promise),pending=h.run('Zb()');
  h.context.navigator.userActivation.isActive=false;save.resolve();await pending;assert.equal(h.messages.length,0);assert.equal(h.context.ye.textContent,'已保存，请再次点击确认。');
  h.context.navigator.userActivation.isActive=true;await h.run('Zb()');assert.equal(h.requests.length,1);assert.equal(h.messages.length,1);
});
test('rapid confirmation locks before save and sends one exact saved PS1 snapshot',async()=>{
  const save = deferred(), h = await harness(()=>save.promise);
  const pending = h.run('Zb()');await h.run('Zb()');
  assert.equal(h.context.dt,true);assert.equal(h.context.Ls.inert,true);assert.equal(h.requests.length,1);assert.equal(h.messages.length,0);
  save.resolve();await pending;
  assert.equal(h.messages.length,1);assert.match(h.messages[0].content[0].text,/curve=0~24,6200~86,12000~42/);
  assert.equal(h.context.dt,false);assert.equal(h.context.Ls.inert,false);
});
test('failed persistence never sends confirmation and the same real edit can be retried',async()=>{
  let shouldFail=true;const h=await harness(()=>{if(shouldFail)throw Error('transaction failed');});h.state.curve[1].drive=45;
  await h.run('Zb()');assert.equal(h.messages.length,0);assert.equal(h.context.failed,1);assert.equal(h.context.dt,false);
  shouldFail=false;await h.run('Zb()');assert.equal(h.messages.length,1);assert.match(h.messages[0].content[0].text,/6200~45/);
});
test('successful confirmation clears the previous failed-save status after retry',async()=>{
  let shouldFail=true;const h=await harness(()=>{if(shouldFail)throw Error('transaction failed');});h.state.review_requested=true;
  assert.equal(await h.run('fp()'),false);assert.equal(h.context.ye.textContent,'发送失败，请重试');assert.equal(h.messages.length,0);
  shouldFail=false;await h.run('Zb()');assert.equal(h.messages.length,1);assert.match(h.messages[0].content[0].text,/review=1$/);assert.equal(h.context.ye.textContent,'');
});
test('unexpected score mutation during saved confirmation fails without sending an old snapshot',async()=>{
  const save=deferred(),h=await harness(()=>save.promise),pending=h.run('Zb()');h.state.beats[0].label='另一版';save.resolve();await pending;
  assert.equal(h.messages.length,0);assert.equal(h.context.failed,1);assert.equal(h.context.Ls.inert,false);
});
test('confirm immediately after a pending drag save persists the final state before sending',async()=>{
  const save=deferred(),h=await harness(()=>h.requests.length===1?save.promise:undefined),pending=h.run('kb(bb())');await Promise.resolve();
  h.state.curve[1].drive=38;const confirm=h.run('Zb()');assert.equal(h.messages.length,0);save.resolve();await Promise.all([pending,confirm]);
  assert.deepEqual(h.requests.map(value=>value.curve[1].drive),[86,38]);assert.equal(h.messages.length,1);assert.match(h.messages[0].content[0].text,/6200~38/);
});
test('tab-focused curve and beat delete target their own IDs, not the previous selection',async()=>{
  const html=await derived(), context={selected:['beat','b1'],O:fixture().curve,G:[...fixture().beats,{id:'b2',at_ms:8000,kind:'action',intensity:2,label:''}],w:{duration_ms:12000},X:()=>{},Y:()=>{},J:0,
    Qt:(kind,id)=>{context.selected=[kind,id];},bp:()=>{context.deleted=[...context.selected];},Bs:()=>{context.deleted=[...context.selected];},At:{pause:'P',action:'A'},ir:{pause:'red',action:'blue'},I:{beats:{pause:'Pause',action:'Action'}},Ce:String,yr:{},
    document:{createElement:()=>({dataset:{},style:{setProperty(){}},setAttribute(){},addEventListener(name,listener){this[name]=listener;}})}};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function Tb('),html.indexOf('function Hs('))+html.slice(html.indexOf('function Ob('),html.indexOf('function kc(')),context);
  context.event={key:'Delete',preventDefault(){}};vm.runInContext('Tb(event,"p2")',context);assert.deepEqual(context.deleted,['point','p2']);
  context.selected=['beat','b1'];vm.runInContext('Ob(G[1]).keydown(event)',context);assert.deepEqual(context.deleted,['beat','b2']);
});
