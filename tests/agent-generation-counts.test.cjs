const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/features/agent-generation/card.mjs'),'utf8');
const nodes=[{id:'a',type:'image',image:'asset:a'},{id:'b',type:'image',image:'asset:b'}];
const args=id=>({nodeId:id,kind:'image.generate',model:'nano-banana-2',prompt:'保留主体，自然光',referenceIds:[id],count:12});

test('confirmation count options and validation share captured layout without extending tool arguments',async()=>{
 const {createGenerationDraft,normalizeDraft,parameterOptions,confirmedArguments}=await import('../src/features/agent-generation/model.mjs'),{parse}=require('../agent-tools.js');
 for(const resultMode of ['pile','spread']){
  const original=args('a'),draft=createGenerationDraft(original,{resultMode},nodes);
  assert.equal(draft.count,12);assert.equal(draft.resultMode,resultMode);assert.deepEqual(parameterOptions(draft,nodes).count,[1,2,4,8,12]);
  const confirmed=confirmedArguments(original,{...draft,nodeId:'b',referenceIds:[],kind:'video.generate'},nodes);
  assert.equal(confirmed.nodeId,'a');assert.deepEqual(confirmed.referenceIds,['a']);assert.equal(confirmed.kind,'image.generate');assert.equal(confirmed.count,12);assert.equal(confirmed.resultMode,undefined);parse('generation_submit',confirmed);
  const variants=normalizeDraft({...draft,resultMode:'variants'},nodes);assert.equal(variants.count,4);
  assert.throws(()=>confirmedArguments(original,{...variants,count:12},nodes),/生成参数无效/);
  const mj=normalizeDraft({...draft,model:'midjourney-v7'},nodes);assert.equal(mj.count,3);assert.deepEqual(parameterOptions(mj,nodes).count,[1,2,3]);
 }
});

test('browser preference fallback is safe, while explicit draft/config modes stay authoritative',async()=>{
 const {generationResultMode,createGenerationDraft}=await import('../src/features/agent-generation/model.mjs');
 const storage=Object.getOwnPropertyDescriptor(global,'localStorage'),window=Object.getOwnPropertyDescriptor(global,'window');
 try{
  global.window={};Object.defineProperty(global,'localStorage',{configurable:true,value:{getItem:()=> 'spread'}});
  assert.equal(generationResultMode(),'spread');assert.equal(createGenerationDraft(args('a'),{},nodes).count,12);
  assert.equal(createGenerationDraft(args('a'),{resultMode:'variants'},nodes).count,4);
  Object.defineProperty(global,'localStorage',{configurable:true,get(){throw Error('blocked');}});
  assert.equal(generationResultMode(),'variants');assert.equal(generationResultMode('pile'),'pile');
 }finally{if(storage)Object.defineProperty(global,'localStorage',storage);else delete global.localStorage;if(window)Object.defineProperty(global,'window',window);else delete global.window;}
});

test('actual open-card event updates batch drafts and captures live prompt before redrawing',async()=>{
 const model=await import('../src/features/agent-generation/model.mjs'),{batchOptions,batchDecisions}=await import('../src/features/agent-generation/batch.mjs');
 const trace={status:'pending',batchItems:['a','b'].map((id,i)=>({callId:'call'+i,args:args(id)}))},items=trace.batchItems.map(item=>({args:model.createGenerationDraft(item.args,{resultMode:'spread'},nodes),rejected:false})),calls={capture:0,persist:0,render:0};
 const context={trace,items,draft:{...items[0].args},normalizeDraft:model.normalizeDraft,getNodes:()=>nodes,formError:'old',generationResultMode:model.generationResultMode,captureInputs(){calls.capture++;items[1].args.prompt='尚未失焦的输入';},persist(){calls.persist++;},render(){calls.render++;}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' function applyResultMode('),source.indexOf(' function change(')),context);
 context.updateResultMode({detail:{mode:'variants'}});
 assert.equal(context.draft.count,4);assert.equal(items[0].args.count,4);assert.equal(items[1].args.count,4);assert.equal(items[1].args.prompt,'尚未失焦的输入');assert.equal(context.formError,'');assert.deepEqual(calls,{capture:1,persist:1,render:1});
 context.updateResultMode({detail:{mode:'spread'}});context.draft.count=12;
 assert.deepEqual(batchOptions(context.draft,items,nodes).count,[1,2,4,8,12]);
 const decisions=batchDecisions(trace,context.draft,items,nodes);assert.equal(decisions.length,2);assert.equal(decisions[1].args.prompt,'尚未失焦的输入');assert(decisions.every(d=>d.args.count===12&&d.args.resultMode===undefined));
 const before={...calls};trace.status='done';context.updateResultMode({detail:{mode:'variants'}});assert.deepEqual(calls,before);assert.equal(context.draft.count,12,'completed receipts retain historical count');
 trace.status='pending';context.updateResultMode({detail:{mode:'invalid'}});assert.deepEqual(calls,before);
 context.draft.kind='audio.generate';context.updateResultMode({detail:{mode:'variants'}});assert.deepEqual(calls,before);
});

test('card teardown removes both result-mode event listeners',()=>{
 const removed=[],context={closeMenu(){},previews:{destroy(){}},destroyInputs(){},window:{removeEventListener:(name,listener)=>removed.push([name,listener])},updateMode(){},updateResultMode(){},resultModeStorage(){},root:{remove(){}}};
 vm.createContext(context);const method=source.slice(source.indexOf('  destroy(){'),source.indexOf('\n  update(next)')).trim().replace(/,$/,'');
 vm.runInContext('({'+method+'}).destroy()',context);
 assert.deepEqual(removed.map(([name])=>name),['agent:confirmation-mode','canvas:generation-result-mode','storage']);
 assert.equal(removed[1][1],context.updateResultMode);assert.equal(removed[2][1],context.resultModeStorage);
});
