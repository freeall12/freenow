const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const modules = Promise.all([import('../src/features/agent-apps/registry.mjs'), import('../src/features/agent-apps/director-markup.mjs')]);
// Use the captured independent implementation to generate real DM1 receipts.
function official() {
  const source = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/director-markup@v1.4b53a29e.html'), 'utf8');
  const context = {TextEncoder, btoa};vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const E_=/^[a-z0-9]'), source.indexOf('const B_={')) + ';globalThis.model={prepare:Rm,confirm:V_,save:q_};', context);
  return context.model;
}
function note(draft, start = 0, end = 2) {return {version:1,draft,anchors:[{id:'a1',type:'range',start,end,quote:draft.slice(start,end),before:draft.slice(Math.max(0,start-24),start),after:draft.slice(end,end+24),status:'valid'}],annotations:[{id:'n1',anchor_id:'a1',kind:'shot',content:'中景，人物与环境同框'}],active_annotation_id:null};}
function encode(payload) {return Buffer.from(JSON.stringify(payload)).toString('base64url');}
test('director app prepares source-valid script data and official fallback display policy', async () => {
  const [{prepareApp,appPolicy}] = await modules;
  const args = {resource_uri:'ui://tapnow/director-markup@v1',data:{draft:'林岚走进雨里。'}};
  const result = prepareApp(args);assert.equal(result.response.locale,'zh-CN');assert.equal(official().prepare(result.response).draft,args.data.draft);
  assert.equal(appPolicy(args.resource_uri).allowExpanded,false);
  for (const change of [{data:undefined},{data:{draft:' '}},{data:{draft:'x',tools:['delete']}},{data:{draft:'x',locale:'xx'}},{data:{draft:'x'.repeat(8001)}},{original_request:'x'},{recommended_template_id:'T01'}]) assert.throws(() => prepareApp({...args,...change}));
  assert.throws(() => prepareApp({resource_uri:'ui://tapnow/motion-picker@v1',data:{draft:'x'}}));
});
test('official compact confirmed edit and four note kinds resolve to verified human-readable queue content', async () => {
  const [, {resolveDirectorMarkupReply}] = await modules, base='林岚走进雨里。', draft='林岚慢慢走进雨里。', state=note(draft);
  state.anchors.push({id:'a2',type:'point',offset:draft.length,before:draft,after:'',status:'valid'});
  state.annotations.push({id:'n2',anchor_id:'a1',kind:'motion',content:'缓慢推进'},{id:'n3',anchor_id:'a2',kind:'cut',content:'切到钥匙特写'},{id:'n4',anchor_id:'a2',kind:'emotion',content:'警觉转为迟疑'});
  const source=official(), model={...source.prepare({version:1,draft,anchors:state.anchors,annotations:state.annotations}),baseDraft:base};
  const message='确认导演批注\n'+source.confirm(model), result=await resolveDirectorMarkupReply(message,base,state);
  assert.match(result.text,/林岚慢慢走进雨里/);assert.match(result.text,/切到钥匙特写/);assert.match(result.text,/DM1 data=/);assert.match(result.metadata.handoffId,/^director_[a-f0-9]{64}$/);
  assert.equal((await resolveDirectorMarkupReply(message,base,structuredClone(state))).metadata.handoffId,result.metadata.handoffId);
});
test('missing save, changed draft, orphaned notes, invalid Unicode and unknown payloads cannot create a queue receipt', async () => {
  const [, {resolveDirectorMarkupReply}] = await modules, base='人物进入房间',state=note(base), good='确认\nDM1 data='+encode({v:1,e:null,m:[[0,0,2,'中景，人物与环境同框']]});
  for (const changed of [undefined,{...state,draft:'新正文'},{...state,anchors:[{...state.anchors[0],status:'orphaned'}]},{...state,annotations:[{...state.annotations[0],content:''}]}]) await assert.rejects(resolveDirectorMarkupReply(good,base,changed));
  for (const payload of [{v:2,e:null,m:[]},{v:1,e:null,m:[],tools:['delete']},{v:1,e:{start:0,end:999,text:'x'},m:[]},{v:1,e:null,m:[[0,0,1,'别的注释']]}]) await assert.rejects(resolveDirectorMarkupReply('DM1 data='+encode(payload),base,state));
  await assert.rejects(resolveDirectorMarkupReply('DM1 data=bad',base,state));
  const emoji='😀人物', invalid=note(emoji,1,2);await assert.rejects(resolveDirectorMarkupReply('DM1 data='+encode({v:1,e:null,m:[[0,1,2,'中景，人物与环境同框']]}),emoji,invalid));
});
test('per-app state limits count UTF-8 bytes and keep ordinary picker storage bounded',async()=>{
  const [{copyAppState}] = await modules, state={draft:'雨'.repeat(24000)};
  assert.throws(()=>copyAppState(state));assert.equal(copyAppState(state,128*1024).draft.length,24000);
  assert.throws(()=>copyAppState({draft:'雨'.repeat(44000)},128*1024));
});
