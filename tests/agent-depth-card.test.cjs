const test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const fr=createRequire(require.resolve('fabric')),dr=createRequire(fr.resolve('jsdom')),canvas=dr.resolve('canvas'),old=require.cache[canvas];require.cache[canvas]={exports:{createCanvas:undefined}};const {JSDOM}=fr('jsdom');if(old)require.cache[canvas]=old;else delete require.cache[canvas];
async function fixture(options={}){const dom=new JSDOM('<body></body>'),prior={};for(const name of ['window','document']){prior[name]=globalThis[name];globalThis[name]=name==='window'?dom.window:dom.window.document;}const module=await import('../src/features/agent-execution/depth-card.mjs');return{...module,dom,close(){dom.window.close();for(const name of ['window','document'])if(prior[name]===undefined)delete globalThis[name];else globalThis[name]=prior[name];}};}
const trace=()=>({id:'tool',name:'depth_video_recast',status:'running',args:{depthNodeId:'depth',character:{nodeId:'actor',description:'人物说明'},setting:{description:'房间'},model:'model',duration:5,formCallId:'form'}});

test('depth states follow the submitted job rather than tool completion or interruption',async()=>{
 const f=await fixture();try{
  for(const [status,label]of [['queued','排队中'],['running','生成中 30%'],['unknown','状态未确认'],['configuration_required','等待配置生成服务'],['failed','生成失败'],['cancelled','生成任务已取消']]){
   const state=f.depthTaskState({...trace(),status:'cancelled',submittedTaskId:'job',generationJob:{id:'job',status,progress:30}});assert.equal(state.label,label);
  }
  assert.equal(f.depthTaskState({...trace(),status:'done',submittedTaskId:'job'}).label,'状态未确认');
  assert.equal(f.depthTaskState({...trace(),submittedTaskId:'job',generationJob:{id:'job',status:'succeeded',applicationError:'持久化失败'}}).label,'结果应用失败');
  assert.equal(f.depthTaskState({...trace(),submittedTaskId:'job',generationJob:{id:'job',status:'succeeded',recovered:true}}).label,'结果待取回');
  assert.equal(f.depthTaskState({...trace(),status:'done',result:{reused:true}}).label,'已复用现有深度视频');
 }finally{f.close();}
});

test('confirmation uses the existing callback once and shows readable role/form/model values',async()=>{
 const f=await fixture(),calls=[];try{
  const value={...trace(),status:'pending'},card=f.createDepthExecutionCard(value,{onConfirm:(item,allowed)=>calls.push([item.id,allowed])});document.body.append(card.element);
  for(const label of ['深度视频：depth','人物：actor · 人物说明','环境：房间','模型：model','时长：5 秒','参考表单：form'])assert.ok(card.element.textContent.includes(label));
  const button=card.element.querySelector('.execution-allow');button.click();button.click();assert.deepEqual(calls,[['tool',true]]);
  assert.ok(f.depthToolDetails({...value,args:{formCallId:'form'}}).includes('人物与环境参考：读取该表单的用户确认提交，执行时校验'));
  card.update({...value,status:'running',submittedTaskId:'job',generationJob:{id:'job',status:'running',progress:10}});assert.equal(card.element.querySelector('.execution-confirmation'),null);card.destroy();
 }finally{f.close();}
});

test('unknown submitted tasks expose existing recovery actions and preserve disclosure/button focus while progressing',async()=>{
 const f=await fixture(),calls=[];try{
  window.GenerationAPI={recover:async id=>calls.push(['recover',id]),applyRecovered:async(id,mode)=>calls.push(['apply',id,mode])};
  const value={...trace(),submittedTaskId:'job',generationJob:{id:'job',status:'unknown'}},card=f.createDepthExecutionCard(value);document.body.append(card.element);
  const trigger=card.element.querySelector('.execution-line');trigger.click();const recover=card.element.querySelector('.generation-small-button');recover.focus();
  for(let i=0;i<5;i++)card.update({...value,args:{...value.args,duration:6}});
  assert.equal(document.activeElement,recover);assert.equal(trigger.getAttribute('aria-expanded'),'true');await recover.onclick();assert.deepEqual(calls,[['recover','job']]);
  card.update({...value,status:'cancelled'});assert.ok(card.element.textContent.includes('工具已停止等待'));assert.ok(card.element.textContent.includes('状态未确认'));
  card.update({...value,generationJob:{id:'job',status:'succeeded',recovered:true,hasResultPlan:true}});const buttons=[...card.element.querySelectorAll('.generation-small-button')];assert.deepEqual(buttons.map(b=>b.textContent),['恢复到原占位','作为新节点取回']);await buttons[0].onclick();assert.deepEqual(calls.at(-1),['apply','job','existing']);await buttons[1].onclick();assert.deepEqual(calls.at(-1),['apply','job','new_nodes']);card.destroy();
 }finally{f.close();}
});

test('recovered results without an original result plan expose only new-node import',async()=>{
 const f=await fixture(),calls=[];try{
  window.GenerationAPI={recover:async()=>{},applyRecovered:async(id,mode)=>calls.push(['apply',id,mode])};
  const value={...trace(),submittedTaskId:'job',generationJob:{id:'job',status:'succeeded',recovered:true}},card=f.createDepthExecutionCard(value);document.body.append(card.element);
  for(const hasResultPlan of [undefined,false]){
   card.update({...value,generationJob:{...value.generationJob,hasResultPlan}});
   const buttons=[...card.element.querySelectorAll('.generation-small-button')];assert.deepEqual(buttons.map(button=>button.textContent),['作为新节点取回']);await buttons[0].onclick();assert.deepEqual(calls.at(-1),['apply','job','new_nodes']);
  }
  card.update({...value,generationJob:{...value.generationJob,hasResultPlan:true}});assert.deepEqual([...card.element.querySelectorAll('.generation-small-button')].map(button=>button.textContent),['恢复到原占位','作为新节点取回']);
  card.update({...value,generationJob:{...value.generationJob,hasResultPlan:false}});assert.deepEqual([...card.element.querySelectorAll('.generation-small-button')].map(button=>button.textContent),['作为新节点取回']);card.destroy();
 }finally{f.close();}
});

test('application failure retries only local application and surfaces its actual error',async()=>{
 const f=await fixture(),calls=[];try{
  window.GenerationAPI={recover:async()=>{},retryApplication:async id=>{calls.push(id);throw Error('仍未保存');}};
  const card=f.createDepthExecutionCard({...trace(),status:'error',submittedTaskId:'job',generationJob:{id:'job',status:'succeeded',applicationError:'保存失败'}});document.body.append(card.element);
  assert.ok(card.element.textContent.includes('结果应用失败'));const button=card.element.querySelector('.generation-small-button');assert.equal(button.textContent,'重试应用结果');await button.onclick();assert.deepEqual(calls,['job']);assert.ok(card.element.textContent.includes('仍未保存'));assert.equal(button.disabled,false);card.destroy();
 }finally{f.close();}
});

test('successful application recovery clears stale tool errors without changing the trace',async()=>{
 const f=await fixture();try{
  const value={...trace(),status:'interrupted',submittedTaskId:'job',error:'旧工具错误',result:{error:'旧应用错误'},generationJob:{id:'job',status:'succeeded',applicationError:'当前应用错误'}};
  const card=f.createDepthExecutionCard(value);document.body.append(card.element);assert.equal(card.element.querySelector('.execution-error').textContent,'当前应用错误');
  const recovered={...value,generationJob:{id:'job',status:'succeeded',applied:true}},snapshot=JSON.stringify(recovered);card.update(recovered);
  assert.equal(card.element.querySelector('.execution-error').textContent,'');assert.equal(card.element.querySelector('.execution-error').hidden,true);assert.ok(card.element.textContent.includes('已生成并应用'));assert.ok(card.element.textContent.includes('工具已停止等待'));assert.equal(JSON.stringify(recovered),snapshot);card.destroy();
 }finally{f.close();}
});
