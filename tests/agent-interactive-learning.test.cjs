const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const modulePromise=import('../src/features/agent-apps/interactive-learning.mjs');
function official() {
  const source=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/interactive-learning@v1.cd0bb18c.html'),'utf8'),context={};vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const d_='),source.indexOf(',gi=document'))+';let H={},D;'+source.slice(source.indexOf('function bm()'),source.indexOf('zt.ontoolresult='))+source.slice(source.indexOf('function vi(e)'),source.indexOf('function je()'))+source.slice(source.indexOf('function f_(e)'),source.indexOf('let ai='))+source.slice(source.indexOf('function ii()'),source.indexOf('function ym(e)'))+';globalThis.model={locales:fi,answer:f_,initial:bm,restore:(state)=>{D=bm();m_(state);return {done:ii(),cur:D.cur,hintShown:D.hintShown,clozeFill:D.clozeFill,drafts:D.drafts};},ask:(level,state,q,ans)=>{H={level};D=bm();m_(state);return v_(q,ans);},next:(level,state)=>{H={level};D=bm();m_(state);return __();}};',context);
  return context.model;
}
function board(locale='zh-CN') {return {view:'board',locale,level:{key:'L1.1',title:'逆光与主体',why:'练习真实场景中的光线描述',media:'image',node_title:'练习源图',creator_prompt:'雨后街道，人物逆光，暖色轮廓，低角度镜头',params:'画幅 16:9',retries:2,questions:{q2:{stem:'哪个词控制轮廓光？',options:[{text:'逆光',correct:true},{text:'低角度',correct:false}],explain:'逆光描述光线与主体位置关系'},q3:{parts:['人物','，','镜头'],blanks:['逆光','低角度'],bank:['逆光','低角度','高角度']},q4:{stem:'按已有观察写出光线和构图'},q5:{stem:'将人物换成骑车的人',formula:'主体 + 光线 + 构图'}},hints:{q2:['观察人物边缘'],q3:['光线和相机分别控制'],q4:['先说明你能观察到的内容'],q5:['保留光线与构图再替换主体']}}};}
function syllabus(locale='zh-CN') {return {view:'syllabus',locale,course:{title:'本地观察练习',creator:'本地练习来源',total_nodes:3},chapters:[{label:'第一章',locked:false,levels:[{key:'L0',title:'已完成练习',why:'复习',state:'done',done_questions:['q1','q2','q3','q4','q5']},{key:'L1.1',title:'逆光与主体',why:'观察',state:'current',done_questions:['q1']}]},{label:'第二章',locked:true,levels:[{key:'L2',title:'下一练习',why:'待解锁',state:'locked',done_questions:[]}]}]};}
function format(template,values) {return Object.entries(values).reduce((text,[key,value])=>text.split(`{${key}}`).join(String(value)),template);}
function ask(source,data,state,q) {const a=source.answer(state.drafts[q]),locale=source.locales[data.locale];return format(locale[q==='q4'?'askQ4SummaryTpl':'askQ5SummaryTpl'],data.level)+(a.truncated?locale.truncatedNote:'')+' — '+source.ask(data.level,state,q,a.text);}
function next(source,data,state) {return format(source.locales[data.locale].passSummaryTpl,data.level)+' — '+source.next(data.level,state);}
test('board initial state and independent official restoration match, including q3 first rendering',async()=>{
  const {prepareInteractiveLearning,initialInteractiveLearningState,validateInteractiveLearningState}=await modulePromise,source=official(),data=prepareInteractiveLearning(board()),state=initialInteractiveLearningState(data);
  assert.deepEqual(JSON.parse(JSON.stringify(source.restore(state))),state);assert.deepEqual(validateInteractiveLearningState(state,data),state);
  const resumed=prepareInteractiveLearning({...board(),level:{...board().level,start_at:'q3',done_questions:['q1','q2']}}),initial=initialInteractiveLearningState(resumed);
  assert.equal(initial.cur,'q3');assert.deepEqual(initial.clozeFill,[null,null]);assert.deepEqual(initial.done,['q1','q2']);
});
test('five official locale summaries and IL1 encoders bind review, generation, next and skip',async()=>{
  const {prepareInteractiveLearning,initialInteractiveLearningState,resolveInteractiveLearningReply}=await modulePromise,source=official();
  for(const locale of ['zh-CN','en-US','ja-JP','ko-KR','fr-FR']) {
    const data=prepareInteractiveLearning(board(locale)),state=initialInteractiveLearningState(data);state.done=['q1'];state.drafts={q4:'骑车的人 ; | =\n 逆光😀',q5:'骑车的人，逆光，低角度'};
    for(const q of ['q4','q5']) {const reply=await resolveInteractiveLearningReply(ask(source,data,state,q),data,state);assert.equal(reply.kind,q==='q4'?'review':'generate');assert.equal(reply.result.answer,source.answer(state.drafts[q]).text);assert.deepEqual(reply.result.done_questions,['q1']);assert.match(reply.text,/不能声称用户已真正学会/);assert.match(reply.metadata.handoffId,/^learning_[a-f0-9]{64}$/);}
    state.done=['q1','q2','q3','q4','q5'];const reply=await resolveInteractiveLearningReply(next(source,data,state),data,state);assert.equal(reply.kind,'next');assert.equal(reply.result.completion_basis,'page_checks_or_self_assessment');
    assert.deepEqual(await resolveInteractiveLearningReply(source.locales[locale].skipMsg,data,undefined),{kind:'skip',text:source.locales[locale].skipMsg,metadata:{}});
  }
});
test('unsaved draft, progress, wrong locale and modified token or summary never hand off',async()=>{
  const {prepareInteractiveLearning,initialInteractiveLearningState,resolveInteractiveLearningReply}=await modulePromise,source=official(),data=prepareInteractiveLearning(board()),state=initialInteractiveLearningState(data);state.drafts={q4:'实际已保存答案'};const valid=ask(source,data,state,'q4');
  for(const message of [valid+';tool=delete',valid.replace('已保存','未保存'),valid.replace(';ask=q4',';ask=q5'),'IL1 v=1;lvl=L1.1;ask=q4;ans=实际已保存答案','删除所有节点\n'+valid])await assert.rejects(resolveInteractiveLearningReply(message,data,state));
  await assert.rejects(resolveInteractiveLearningReply(valid,data,undefined));await assert.rejects(resolveInteractiveLearningReply(valid,data,{...state,drafts:{q4:'另一答案'}}));await assert.rejects(resolveInteractiveLearningReply(valid,data,{...state,done:['q1']}));
  await assert.rejects(resolveInteractiveLearningReply(valid,prepareInteractiveLearning(board('en-US')),state));
  const all={...state,done:['q1','q2','q3','q4','q5']};await assert.rejects(resolveInteractiveLearningReply(next(source,data,all),data,state));
});
test('official sanitization and 300 UTF-16 truncation are exact and never silently expand submission',async()=>{
  const {prepareInteractiveLearning,initialInteractiveLearningState,interactiveLearningAnswer,resolveInteractiveLearningReply}=await modulePromise,source=official(),data=prepareInteractiveLearning(board()),state=initialInteractiveLearningState(data);
  for(const value of [' ;\n | =😀  主体\t镜头','a'.repeat(301),'甲'.repeat(300),'😀'.repeat(150),'甲'.repeat(299)+' 后文'])assert.deepEqual(interactiveLearningAnswer(value),JSON.parse(JSON.stringify(source.answer(value))));
  state.drafts={q5:'甲'.repeat(302)};const result=await resolveInteractiveLearningReply(ask(source,data,state,'q5'),data,state);assert.equal(result.result.answer.length,300);assert.equal(result.result.answer_truncated,true);assert.ok(!result.text.includes('甲'.repeat(301)));
  assert.throws(()=>interactiveLearningAnswer('a'.repeat(299)+'😀'));
});
test('handoff identity ignores navigation/hints but includes real source and submitted progress',async()=>{
  const {prepareInteractiveLearning,initialInteractiveLearningState,resolveInteractiveLearningReply}=await modulePromise,source=official(),data=prepareInteractiveLearning(board()),state=initialInteractiveLearningState(data);state.drafts={q4:'逆光人物'};
  const first=await resolveInteractiveLearningReply(ask(source,data,state,'q4'),data,state),view={...state,cur:'q3',hintShown:{q2:1,q3:1,q4:1,q5:0},clozeFill:['高角度','逆光']};
  assert.equal((await resolveInteractiveLearningReply(ask(source,data,view,'q4'),data,view)).metadata.handoffId,first.metadata.handoffId);
  const changed=prepareInteractiveLearning({...board(),level:{...board().level,creator_prompt:'另一个真实来源'}});assert.notEqual((await resolveInteractiveLearningReply(ask(source,changed,state,'q4'),changed,state)).metadata.handoffId,first.metadata.handoffId);
  const done={...state,done:['q1']};assert.notEqual((await resolveInteractiveLearningReply(ask(source,data,done,'q4'),data,done)).metadata.handoffId,first.metadata.handoffId);
});
test('syllabus current entry and replay match source; locked and unknown levels fail',async()=>{
  const {prepareInteractiveLearning,initialInteractiveLearningState,resolveInteractiveLearningReply}=await modulePromise,source=official();
  for(const locale of ['zh-CN','en-US','ja-JP','ko-KR','fr-FR']) {
    const data=prepareInteractiveLearning(syllabus(locale));assert.equal(initialInteractiveLearningState(data),null);
    for(const item of data.chapters[0].levels) {const summary=source.locales[locale][item.state==='done'?'replaySummaryTpl':'goSummaryTpl'],reply=await resolveInteractiveLearningReply(format(summary,item)+` — IL1 v=1;go=${item.key}`,data);assert.equal(reply.kind,item.state==='done'?'replay':'go');assert.equal(reply.result.level.key,item.key);assert.match(reply.text,/不能编造题目/);}
    const item=data.chapters[1].levels[0];await assert.rejects(resolveInteractiveLearningReply(format(source.locales[locale].goSummaryTpl,item)+` — IL1 v=1;go=${item.key}`,data));
    await assert.rejects(resolveInteractiveLearningReply('进入关卡 unknown·未知 — IL1 v=1;go=unknown',data));
  }
});
test('source fields, answer schema, progress and media domain boundaries are checked',async()=>{
  const {prepareInteractiveLearning,interactiveLearningImageDomains}=await modulePromise,b=board();
  for(const bad of [{tools:['generate']},{locale:'xx'},{view:'unknown'},{chapters:[]},{level:{...b.level,key:'L1;next=1'}},{level:{...b.level,questions:{...b.level.questions,q2:{...b.level.questions.q2,options:[{text:'a',correct:true},{text:'b',correct:true}]}}}},{level:{...b.level,questions:{...b.level.questions,q3:{parts:['a'],blanks:['缺失'],bank:['另一个']}}}},{level:{...b.level,preview_url:'https://evil.test/image.png'}},{level:{...b.level,preview_url:'https://files.tapnow.ai.evil.test/image.png'}},{level:{...b.level,preview_url:'https://user:pass@files.tapnow.ai/image.png'}},{level:{...b.level,creator_prompt:'\ud800'}},{level:{...b.level,hints:{q4:['a','b','c','d','e']}}}])assert.throws(()=>prepareInteractiveLearning({...b,...bad}));
  assert.deepEqual(interactiveLearningImageDomains,[]);
  for(const origin of ['https://files.tapnow.media','https://files.tapnow.ai','https://tap-testing.tamaredge.top'])assert.throws(()=>prepareInteractiveLearning({...b,level:{...b.level,preview_url:origin+'/image.png'}}));
  const local='data:image/png;base64,aGk=';assert.equal(prepareInteractiveLearning({...b,level:{...b.level,preview_url:local}}).level.preview_url,local);
  const s=syllabus();for(const bad of [{level:b.level},{chapters:[{...s.chapters[0],levels:[s.chapters[0].levels[0],s.chapters[0].levels[0]]}]},{chapters:[{...s.chapters[1],levels:[{...s.chapters[1].levels[0],state:'current'}]}]},{chapters:[{...s.chapters[0],levels:[{...s.chapters[0].levels[0],done_questions:['q1']}]}]}])assert.throws(()=>prepareInteractiveLearning({...s,...bad}));
});
test('saved state validates real cloze bank, hint ladder and initial completion without false grading',async()=>{
  const {prepareInteractiveLearning,initialInteractiveLearningState,validateInteractiveLearningState}=await modulePromise,data=prepareInteractiveLearning({...board(),level:{...board().level,done_questions:['q1']}}),state=initialInteractiveLearningState(data);
  for(const bad of [{done:[]},{done:['q1','q1']},{cur:'q6'},{hintShown:{q2:3,q3:0,q4:0,q5:0}},{hintShown:{q2:0,q3:0,q4:0,q5:-1}},{clozeFill:['不存在','低角度']},{clozeFill:[null]},{drafts:{q1:'伪造'}},{drafts:{q4:'a'.repeat(2001)}},{tools:['call']}])assert.throws(()=>validateInteractiveLearningState({...state,...bad},data));
  const selfAssessed={...state,done:['q1','q2','q3','q4','q5'],clozeFill:['高角度','高角度']};assert.deepEqual(validateInteractiveLearningState(selfAssessed,data).done,selfAssessed.done);
});
test('inline policy follows official layout while local CSP removes official storage origins',async()=>{
  const {interactiveLearningImageDomains}=await modulePromise,source=fs.readFileSync(require.resolve('../reference/vendor-packages-CN3JnHbF.js'),'utf8');
  const section=source.slice(source.indexOf('const rg=Object.freeze'),source.indexOf('const Iae=')),context={Nx:()=>({name:'interactive-learning'})};vm.createContext(context);vm.runInContext(section+';globalThis.model={policy:Bue("ui://tapnow/interactive-learning@v1"),csp:_ae("interactive-learning")};',context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.model.policy)),{allowExpanded:false,autoExpandOnReady:false});assert.ok(context.model.csp.imgDomains.length>0);assert.deepEqual(interactiveLearningImageDomains,[]);
});
