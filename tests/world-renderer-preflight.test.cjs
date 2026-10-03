'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const entry=fs.readFileSync(require.resolve('../src/features/world-node/entry.mjs'),'utf8');
const ready=Promise.all([
 import('../src/features/world-node/model.mjs'),
 import('../src/features/world-node/render-capabilities.mjs'),
 import('../src/features/world-node/media.mjs'),
 import('../src/features/agent-generation/world.mjs'),
]);
class Element {
 constructor(tag,className='',text){this.tag=tag;this.className=className;this.children=[];this.textContent=text??'';this.attributes={};this.isConnected=false;this.classList={add:value=>{this.className+=' '+value;}};}
 append(...children){this.children.push(...children);}
 prepend(...children){this.children.unshift(...children);}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(key,value){this.attributes[key]=value;}
 querySelector(selector){return this.children.flatMap(child=>[child,child.querySelector(selector)]).find(child=>child&&(selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tag===selector))??null;}
}
async function nodeFixture(model='tripo-h3'){
 const [world,renderer,media,agent]=await ready;
 const node={id:'world',type:'world',worldConfig:{model,prompt:'a courtyard',material:'pbr'}},state={nodes:[node],edges:[]};
 const calls={dispatch:0,resource:0,materialize:0,guard:0,updates:0},notifications=[];
 const app={getState:()=>state,updateNode:(id,patch)=>{calls.updates++;Object.assign(node,patch);},notify:message=>notifications.push(message)};
 const api={getJobs:()=>[],configuration:async()=>({configured:true}),runInPlace:async(request,target,options)=>{
  calls.dispatch++;options.onSubmitted({controller:new AbortController()});target.guard();
  await target.apply({type:'model',format:'glb',representation:'mesh',url:'/api/generation/media/result'});
  return {status:'succeeded'};
 }};
 const panel=new Element('section'),context={...world,...renderer,app,panel,activeId:node.id,pending:new Set(),panelKey:null,promptTimer:null,composing:false,selecting:false,
  window:{GenerationAPI:api},DOMException,clearTimeout(){},setTimeout:()=>1,
  get:id=>state.nodes.find(item=>item.id===id),update:settings=>Object.assign(node.worldConfig,settings),refresh(){},closePopover(){},openPopover(){},chooseReference(){},
  icons:{plus:'<svg/>'},el:(...args)=>new Element(...args),button:(label,action)=>{const button=new Element('button','world-button',label);button.onclick=action;button.ariaLabel=label;return button;},
  worldProviderPresentation:model=>({label:model.label}),
  captureWorldSourceGuard:(...args)=>{calls.guard++;return media.captureWorldSourceGuard(...args);},
  loadAgent:async()=>agent,
  loadResource:async()=>{calls.resource++;return {materialize:async()=>{calls.materialize++;return {outputType:'asset',worldResource:{format:'glb',url:'asset:actual-model'}};}}},
 };
 vm.createContext(context);
 // Execute the production Node functions; substitute only dynamic module
 // loaders so a GLB result can be applied without starting a WebGL context.
 const generate=entry.slice(entry.indexOf('async function generate()'),entry.indexOf('function chooseReference()'))
  .replace("import('../agent-generation/world.mjs')",'loadAgent()').replace("import('./resource.mjs')",'loadResource()');
 const build=entry.slice(entry.indexOf('function build('),entry.indexOf('const covers ='));
 const submission=entry.slice(entry.indexOf('const submissionError ='),entry.indexOf('\nfunction update('));
 vm.runInContext(submission+'\n'+generate+'\n'+build,context);
 return {node,state,app,api,calls,notifications,panel,context};
}
async function agentFixture(model='tripo-h3'){
 const [,, ,agent]=await ready;
 const node={id:'world',type:'world',worldConfig:{model,prompt:'a courtyard',material:'pbr'}},state={nodes:[node],edges:[]};
 const calls={availability:0,dispatch:0,materialize:0},app={getState:()=>state,updateNode:(id,patch)=>Object.assign(node,patch)};
 const api={getJobs:()=>[],availability:async()=>{calls.availability++;return {configured:true};},runInPlace:(request,target,options)=>{
  calls.dispatch++;const job={id:'actual-local-job',request,status:'queued'};
  return Promise.resolve().then(async()=>{await options.onSubmitted(job);target.guard();await target.apply({type:'model',url:'https://provider.example.test/result.glb'});return {status:'succeeded'};});
 }};
 return {node,state,app,api,calls,read:()=>agent.readWorld({nodeId:node.id},{app}),
  start:args=>agent.startWorldGeneration({nodeId:node.id,...args},{app,api,materialize:async(output,outputType)=>{calls.materialize++;assert.equal(outputType,'asset');return {outputType,worldResource:{format:'glb',url:'asset:actual-model'}};}})};
}

test('world catalog reports local GLB capability separately from provider readiness',async()=>{
 const f=await agentFixture(),catalog=f.read();
 assert.equal(catalog.models.length,3);assert.deepEqual(catalog.outputRenderer,{formats:['glb'],representations:['mesh'],gaussianSplat:false});
 assert.equal(catalog.models.find(model=>model.provider==='tripo').localRenderer.supported,true);
 for(const model of catalog.models.filter(model=>model.provider==='worldlabs')){
  assert.equal(model.localRenderer.supported,false);assert.match(model.localRenderer.error,/本地.*高斯泼溅.*SPZ.*渲染/);
  assert.ok(model.modes.includes('IMAGE_TO_WORLD'));assert.ok(model.modes.includes('PANORAMA_TO_WORLD'));
 }
});

for(const model of ['worldlabs-marble-1.1','worldlabs-marble-1.1-plus']){
 test('Node '+model+' blocks generation before source preparation, resource loading and dispatch',async()=>{
  const f=await nodeFixture(model);await f.context.generate();
  assert.equal(f.calls.guard,0);assert.equal(f.calls.dispatch,0);assert.equal(f.calls.resource,0);assert.equal(f.calls.materialize,0);assert.equal(f.calls.updates,0);
  assert.equal(f.notifications.length,1);assert.match(f.notifications[0],/本地.*高斯泼溅.*SPZ.*渲染/);assert.doesNotMatch(f.notifications[0],/Key|密钥/);
 });
 test('Agent '+model+' rejects locally before availability lookup and dispatch; an explicit GLB selection remains usable',async()=>{
  const f=await agentFixture();await assert.rejects(f.start({model}),{code:'world_renderer_unavailable'});
  assert.equal(f.calls.availability,0);assert.equal(f.calls.dispatch,0);assert.equal(f.calls.materialize,0);
  const next=await f.start({model:'tripo-h3'});assert.equal(next.job.id,'actual-local-job');await next.completion;
  assert.equal(f.calls.availability,1);assert.equal(f.calls.dispatch,1);assert.equal(f.calls.materialize,1);assert.equal(f.node.worldResource.format,'glb');
 });
}

test('Node keeps Gaussian model and prompt controls usable while generate remains disabled after typing',async()=>{
 const f=await nodeFixture('worldlabs-marble-1.1'),[world]=await ready;
 f.context.build(f.node,[],world.prepare(f.node,[]));
 const submit=f.panel.querySelector('.world-generate'),input=f.panel.querySelector('textarea'),message=f.panel.querySelector('.world-renderer-unavailable');
 assert.equal(submit.disabled,true);assert.match(submit.title,/本地.*SPZ.*渲染/);assert.equal(input.disabled,false);
 assert.equal(message.attributes.role,'status');assert.match(message.textContent,/本地.*SPZ.*渲染/);
 const footer=f.panel.querySelector('footer');assert.equal(footer.children[0].disabled,false,'model selector stays available');
 input.value='a new courtyard';input.oninput();assert.equal(submit.disabled,true);assert.match(submit.title,/本地.*SPZ.*渲染/);assert.equal(f.calls.dispatch,0);
});

test('Node Tripo GLB settings remain enabled and dispatch through normal materialization',async()=>{
 const f=await nodeFixture(),[world]=await ready;f.context.build(f.node,[],world.prepare(f.node,[]));
 assert.equal(f.panel.querySelector('.world-generate').disabled,false);assert.equal(f.panel.querySelector('.world-renderer-unavailable'),null);
 await f.context.generate();assert.equal(f.calls.dispatch,1);assert.equal(f.calls.guard,1);assert.equal(f.calls.resource,1);assert.equal(f.calls.materialize,1);
 assert.equal(f.node.worldResource.format,'glb');assert.equal(f.node.worldResource.url,'asset:actual-model');assert.deepEqual(f.notifications,[]);
});
