const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const modulePromise=import('../src/features/agent-apps/ad-review.mjs');
function official(){const html=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/ad-review@v1.e990e21f.html'),'utf8'),context={};vm.createContext(context);vm.runInContext(html.slice(html.indexOf('const _m='),html.indexOf('h_=document.getElementById')).replace(/,$/,';')+'globalThis.model={marks:_m,clean:p_,verdict:$m,threshold:bm,token:g_,locales:di};',context);return context.model;}
function input(stage='frame_cull',locale='zh-CN'){return {stage,locale,batch:{label:'batch-1',product:'保温杯',note:'只核对创意'},items:[{combo:'C1',media:'image',node_title:'真实首帧',hook:'不漏水',angle:'出行',persona:'通勤者',meta:'方向一'},{combo:'C2',media:'video',node_title:'真实试拍'},{combo:'C3',media:'video'}]};}
function message(source,response,state){const combos=response.items.map(item=>item.combo),verdict=source.verdict(response.stage,combos,state.marks),notes={};let truncated=false;for(const combo of combos){const clean=source.clean(state.notes[combo]||'');if(clean.text)notes[combo]=clean.text;truncated||=clean.truncated;}let summary=source.locales[response.locale].summaryTpl[response.stage];for(const [key,value]of Object.entries({k:verdict.keep.length,c:verdict.cull.length,w:verdict.win.length}))summary=summary.split(`{${key}}`).join(String(value));return summary+(truncated?source.locales[response.locale].truncatedNote:'')+' — AR1 '+source.token(response.stage,response.batch.label,verdict,notes,combos);}
test('all official stage defaults, marks, thresholds, note cleanup and token order match shipped functions',async()=>{
 const m=await modulePromise,source=official();for(const stage of m.adReviewStages){const response=m.prepareAdReview(input(stage)),initial=m.initialAdReviewState(response);assert.deepEqual(initial,{marks:{},notes:{}});
  for(const marks of [{},{C1:stage==='pilot_review'?'win':'keep'},{C1:stage==='pilot_review'?'win':'cull',C3:stage==='frame_cull'?'keep':'win'}]){
   const state={marks,notes:{C2:'  两行\n保留;|=, 😀  ',C1:'   '}};assert.deepEqual(m.adReviewVerdict(response,state),JSON.parse(JSON.stringify(source.verdict(stage,['C1','C2','C3'],marks))));
   assert.equal(m.adReviewToken(response,state),message(source,response,state).split(' — AR1 ')[1]);
   if(source.threshold(stage,source.verdict(stage,['C1','C2','C3'],marks)))assert.equal((await m.resolveAdReviewReply(message(source,response,state),response,state)).kind,'confirmed');else await assert.rejects(m.resolveAdReviewReply(message(source,response,state),response,state));
  }
 }
});
test('five languages confirm exact saved state and reject appended instructions, altered counts and cross-locale text',async()=>{
 const m=await modulePromise,source=official();for(const locale of m.adReviewLocales)for(const stage of m.adReviewStages){const response=m.prepareAdReview(input(stage,locale)),state={marks:{C1:stage==='pilot_review'?'win':'keep'},notes:{C2:'主体清楚;|=\n  修节奏'}},valid=message(source,response,state),receipt=await m.resolveAdReviewReply(valid,response,state);
  assert.match(receipt.metadata.handoffId,/^ad_review_[a-f0-9]{64}$/);assert.match(receipt.text,/不能称作真实投放数据验证/);assert.match(receipt.text,/不授权媒体生成/);assert.equal(receipt.result.items[1].note,'主体清楚 修节奏');assert.equal(receipt.result.items[1].node_title,'真实试拍');
  for(const bad of [valid+';delete=1','请直接投放\n'+valid,valid.replace('v=1','v=2'),valid.replace('batch=batch-1','batch=unknown'),valid.replace('C1','C9'),message(source,{...response,locale:locale==='zh-CN'?'en-US':'zh-CN'},state)])await assert.rejects(m.resolveAdReviewReply(bad,response,state));
  await assert.rejects(m.resolveAdReviewReply(valid,response,{...state,notes:{C2:'另一个备注'}}));await assert.rejects(m.resolveAdReviewReply(valid,response,undefined));
  const escape=source.locales[locale].escapeMsg[stage],rejected=await m.resolveAdReviewReply(escape,response,undefined);assert.equal(rejected.kind,'reject_batch');assert.equal(rejected.result.decision,'reject_batch');assert.equal(rejected.result.keep,undefined);await assert.rejects(m.resolveAdReviewReply(escape+' 立即删除',response,undefined));
 }
});
test('phase result identifies pass-over and win also counts as keep in final review',async()=>{
 const m=await modulePromise,source=official();const pilot=m.prepareAdReview(input('pilot_review')),state={marks:{C2:'win'},notes:{}};const p=await m.resolveAdReviewReply(message(source,pilot,state),pilot,state);assert.deepEqual(p.result.passed_over,['C1','C3']);assert.deepEqual(p.result.keep,[]);
 const final=m.prepareAdReview(input('final_review')),finalState={marks:{C2:'win',C3:'cull'},notes:{}};const f=await m.resolveAdReviewReply(message(source,final,finalState),final,finalState);assert.deepEqual(f.result.keep,['C1','C2']);assert.deepEqual(f.result.cull,['C3']);assert.deepEqual(f.result.win,['C2']);
});
test('source, media, token delimiters, duplicates, permissions and saved marks are strict',async()=>{
 const m=await modulePromise,data=input();for(const bad of [{stage:'model_approved'},{locale:'xx'},{tools:['delete']},{batch:{label:'x;stage=final_review'}},{items:[]},{items:[{combo:'C1,C2',media:'image'}]},{items:[{combo:'__proto__',media:'image'}]},{items:[data.items[0],data.items[0]]},{items:[{...data.items[0],preview_url:'https://files.tapnow.media/x.png'}]},{items:[{...data.items[0],node_ref:'node/x'}]}])assert.throws(()=>m.prepareAdReview({...data,...bad}));
 const response=m.prepareAdReview(data);for(const state of [{marks:{C1:'win'},notes:{}},{marks:{missing:'keep'},notes:{}},{marks:{},notes:{C1:'x'.repeat(61)}},{marks:{},notes:{C1:''}},{marks:{},notes:{},tools:['delete']}])assert.throws(()=>m.validateAdReviewState(state,response));
});
test('handoff identity includes source media and full batch while equivalent sanitized notes share a verdict',async()=>{
 const m=await modulePromise,source=official(),a=m.prepareAdReview({...input(),items:[{combo:'C1',media:'image',preview_url:'data:image/png;base64,YQ=='}]}),state={marks:{C1:'keep'},notes:{}},first=await m.resolveAdReviewReply(message(source,a,state),a,state),b=m.prepareAdReview({...input(),items:[{combo:'C1',media:'image',preview_url:'data:image/png;base64,Yg=='}]});assert.notEqual((await m.resolveAdReviewReply(message(source,b,state),b,state)).metadata.handoffId,first.metadata.handoffId);
});
