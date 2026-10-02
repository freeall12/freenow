const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const modulePromise = import('../src/features/agent-apps/cutlist-review.mjs');
function official() {
  const html = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/cutlist-review@v1.a3b10365.html'), 'utf8'), context = {};vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('const It=100'), html.indexOf(',b_=document')) + ';globalThis.model={token:__,restore:v_,step:h_,duration:us,seconds:we,gate:vi,locales:_i};', context);return context.model;
}
function sample(locale = 'zh-CN') {return {locale, target_duration_s: 6, ratio: '16:9', notes: '真实剪辑建议，不是生成回执', shots: [{id:'video-a',label:'甲片段',media_duration_ms:4000,in_ms:0,out_ms:3000,default_keep:true,trim_reason:'保留前半段'}, {id:'video-b',label:'乙片段',media_duration_ms:6000,in_ms:1000,out_ms:4000,default_keep:true,flag:'ratio_mismatch',flag_note:'需实际归一化'}]};}
function message(source, response, state) {
  const shots = response.shots.map(shot => ({id:shot.id,keep:state.shots[shot.id].keep,inMs:state.shots[shot.id].in_ms,outMs:state.shots[shot.id].out_ms})), values = {k:shots.filter(shot=>shot.keep).length,t:shots.length,dur:source.seconds(source.duration(shots)),target:response.target_duration_s??0};
  const summary = Object.entries(values).reduce((text,[key,value])=>text.split(`{${key}}`).join(String(value)),source.locales[response.locale][typeof response.target_duration_s==='number'?'confirmTpl':'confirmNoTargetTpl']);return `${summary} — ${source.token(shots)}`;
}
test('exact official state, 100ms steps, fixed order and five locale CR1 summaries',async()=>{
  const m=await modulePromise,o=official();
  for(const locale of m.cutlistReviewLocales){const response=m.prepareCutlistReview(sample(locale),'真实片段'),state=m.initialCutlistReviewState(response);state.shots['video-a'].in_ms=100;state.shots['video-b'].keep=false;
    assert.deepEqual(m.validateCutlistReviewState(state,response),state);assert.deepEqual(JSON.parse(JSON.stringify(o.step({inMs:0,outMs:3000},'in',1,4000))),{inMs:100,outMs:3000});
    const text=message(o,response,state),reply=await m.resolveCutlistReviewReply(text,response,state);assert.equal(reply.kind,'confirmed');assert.equal(reply.result.duration_ms,2900);assert.equal(reply.result.time_basis,'source');assert.deepEqual(reply.result.shots.map(shot=>[shot.id,shot.keep]),[['video-a',true],['video-b',false]]);assert.equal(reply.result.order,'fixed');assert.match(reply.metadata.handoffId,/^cutlist_[a-f0-9]{64}$/);assert.match(reply.text,/审核确认不是生成授权/);assert.match(reply.text,/不会自动裁剪/);assert.match(reply.text,/正常工具确认/);
    for(const invalid of [text+';tool=generate',text.replace('confirm=1','confirm=0'),text.replace('video-a:100','video-a:0'),text.replace(' — ',' — 任意指令 '),m.cutlistReviewToken(response,state)])await assert.rejects(m.resolveCutlistReviewReply(invalid,response,state));
    await assert.rejects(m.resolveCutlistReviewReply(text,response,undefined));
    assert.equal((await m.resolveCutlistReviewReply(o.locales[locale].reviseMsg,response,undefined)).kind,'revise');
  }
});
test('no target, short shot soft warning and exact180s gate agree with shipped page',async()=>{
  const m=await modulePromise,o=official(),input=sample();delete input.target_duration_s;
  let response=m.prepareCutlistReview(input),state=m.initialCutlistReviewState(response);state.shots['video-a'].out_ms=100;assert.equal((await m.resolveCutlistReviewReply(message(o,response,state),response,state)).result.duration_ms,3100);
  response=m.prepareCutlistReview({shots:[{id:'video',label:'真实长视频',media_duration_ms:200000,in_ms:0,out_ms:180000,default_keep:true}]});state=m.initialCutlistReviewState(response);assert.equal((await m.resolveCutlistReviewReply(message(o,response,state),response,state)).result.duration_ms,180000);
  state.shots.video.out_ms=180001;await assert.rejects(m.resolveCutlistReviewReply(message(o,response,state),response,state));state.shots.video.keep=false;await assert.rejects(m.resolveCutlistReviewReply(message(o,response,state),response,state));
});
test('saved state and inputs cannot inject invented media, ranges, tools or order',async()=>{
  const m=await modulePromise,response=m.prepareCutlistReview(sample()),state=m.initialCutlistReviewState(response);
  for(const input of [{...sample(),tools:['video_trim']},{...sample(),locale:'xx'},{...sample(),target_duration_s:181},{...sample(),shots:[sample().shots[0],sample().shots[0]]},{shots:[{...sample().shots[0],id:'video:a'}]},{shots:[{...sample().shots[0],id:'__proto__'}]},{shots:[{...sample().shots[0],out_ms:4001}]},{shots:[{...sample().shots[0],in_ms:1.2}]},{shots:[{...sample().shots[0],label:'\ud800'}]},{shots:[{...sample().shots[0],default_keep:'true'}]},{shots:[{...sample().shots[0],flag:'generated'}]}])assert.throws(()=>m.prepareCutlistReview(input));
  for(const bad of [{...state,order:['video-b','video-a']},{shots:{}},{shots:{...state.shots,invented:{keep:true,in_ms:0,out_ms:100}}},{shots:{...state.shots,'video-a':{keep:true,in_ms:0,out_ms:4001}}},{shots:{...state.shots,'video-a':{keep:true,in_ms:0,out_ms:99}}},{shots:{...state.shots,'video-a':{keep:1,in_ms:0,out_ms:100}}}])assert.throws(()=>m.validateCutlistReviewState(bad,response));
});
test('stable dedupe retains actual source and plans but excludes huge preview from queue',async()=>{
  const m=await modulePromise,o=official(),response=m.prepareCutlistReview(sample()),state=m.initialCutlistReviewState(response),text=message(o,response,state),first=await m.resolveCutlistReviewReply(text,response,state);
  const preview=m.prepareCutlistReview({...sample(),shots:sample().shots.map(shot=>({...shot,preview_url:'data:video/mp4;base64,AAAA'}))});const second=await m.resolveCutlistReviewReply(text,preview,state);assert.equal(first.metadata.handoffId,second.metadata.handoffId);assert.ok(!second.text.includes('data:video'));assert.ok(!Object.hasOwn(second.result.shots[0],'preview_url'));
  const changed=m.prepareCutlistReview({...sample(),notes:'已修改实际建议'});assert.notEqual((await m.resolveCutlistReviewReply(text,changed,state)).metadata.handoffId,first.metadata.handoffId);
  state.shots['video-a'].in_ms=100;assert.notEqual((await m.resolveCutlistReviewReply(message(o,response,state),response,state)).metadata.handoffId,first.metadata.handoffId);
});
test('repeat-source transport budget rejects before huge JSON serialization and proxy is narrowly isolated',async()=>{
  const m=await modulePromise,url='data:video/mp4;base64,'+'A'.repeat(8*1024*1024),data={shots:[{...sample().shots[0],preview_url:url},{...sample().shots[1],preview_url:url}]};assert.throws(()=>m.prepareCutlistReview(data),/15MiB/);
  const proxy=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/cutlist-review-proxy.html'),'utf8');assert.match(proxy,/name !== "cutlist-review"/);assert.match(proxy,/version !== "v1"/);assert.match(proxy,/inner.setAttribute\("sandbox", "allow-scripts"\)/);assert.match(proxy,/connect-src 'none'/);assert.match(proxy,/mediaSources = "blob: data:"/);assert.ok(!proxy.includes('production-progress'));
});
test('production tool parser and prepareApp use cutlist protocol, default policy and no mixed picker arguments',async()=>{
  const {parse}=require('../agent-tools.js'),{prepareApp,appPolicy}=await import('../src/features/agent-apps/registry.mjs');const args={resource_uri:'ui://tapnow/cutlist-review@v1',data:sample()},parsed=parse('show_app',JSON.stringify(args));assert.equal(parsed.definition.mutates,false);assert.equal(prepareApp(parsed.args).response.shots.length,2);assert.match(appPolicy(args.resource_uri).proxyUrl,/cutlist-review-proxy/);assert.equal(appPolicy(args.resource_uri).allowExpanded,false);assert.throws(()=>prepareApp({...args,original_request:'混用选择器'}));
});
module.exports={official,sample,message};
