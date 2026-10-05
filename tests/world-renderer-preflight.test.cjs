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
  await target.apply({type:'model',format:request.parameters.provider==='worldlabs'?'spz':'glb',representation:request.parameters.representation,url:'/api/generation/media/result'});
  return {status:'succeeded'};
 }};
 const panel=new Element('section'),context={...world,...renderer,app,panel,activeId:node.id,pending:new Set(),panelKey:null,promptTimer:null,composing:false,selecting:false,
  window:{GenerationAPI:api},DOMException,clearTimeout(){},setTimeout:()=>1,
  get:id=>state.nodes.find(item=>item.id===id),update:settings=>Object.assign(node.worldConfig,settings),refresh(){},closePopover(){},openPopover(){},chooseReference(){},
  icons:{plus:'<svg/>'},el:(...args)=>new Element(...args),button:(label,action)=>{const button=new Element('button','world-button',label);button.onclick=action;button.ariaLabel=label;return button;},
  worldProviderPresentation:model=>({label:model.label}),
  captureWorldSourceGuard:(...args)=>{calls.guard++;return media.captureWorldSourceGuard(...args);},
  loadAgent:async()=>agent,
  loadResource:async()=>{calls.resource++;return {materialize:async output=>{calls.materialize++;return {outputType:output.format==='spz'?'world':'asset',worldResource:{format:output.format,url:'asset:actual-model'}};}}},
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
  return Promise.resolve().then(async()=>{await options.onSubmitted(job);target.guard();await target.apply({type:'model',format:request.parameters.provider==='worldlabs'?'spz':'glb',url:'/api/generation/media/actual-result'});return {status:'succeeded'};});
 }};
 return {node,state,app,api,calls,read:()=>agent.readWorld({nodeId:node.id},{app}),
  start:args=>agent.startWorldGeneration({nodeId:node.id,...args},{app,api,materialize:async(output,outputType)=>{calls.materialize++;assert.equal(outputType,output.format==='spz'?'world':'asset');return {outputType,worldResource:{format:output.format,url:'asset:actual-model'}};}})};
}

test('world catalog reports actual local GLB/SPZ rendering separately from provider readiness',async()=>{
 const f=await agentFixture(),catalog=f.read();
 assert.equal(catalog.models.length,3);assert.deepEqual(catalog.outputRenderer,{formats:['glb','spz'],representations:['mesh','gaussianSplat'],gaussianSplat:true});assert.equal(catalog.liveProviderVerified,false);assert.match(catalog.note,/无LOD/);
 for(const model of catalog.models){assert.equal(model.localRenderer.supported,true);assert.equal(model.localRenderer.error,null);}
});
for(const model of ['worldlabs-marble-1.1','worldlabs-marble-1.1-plus']){
 test('Node '+model+' uses ordinary guarded dispatch and SPZ materialization',async()=>{const f=await nodeFixture(model);await f.context.generate();assert.equal(f.calls.guard,1);assert.equal(f.calls.dispatch,1);assert.equal(f.calls.materialize,1);assert.equal(f.node.worldResource.format,'spz');assert.deepEqual(f.notifications,[]);});
 test('Agent '+model+' checks provider readiness and uses the same SPZ pipeline',async()=>{const f=await agentFixture(model),next=await f.start({model});await next.completion;assert.equal(f.calls.availability,1);assert.equal(f.calls.dispatch,1);assert.equal(f.calls.materialize,1);assert.equal(f.node.worldResource.format,'spz');});
}
test('unconfigured Marble still stops before dispatch despite available local SPZ renderer',async()=>{const f=await agentFixture('worldlabs-marble-1.1');f.api.availability=async()=>{f.calls.availability++;return {configured:false};};assert.equal((await f.start({})).configurationRequired,true);assert.equal(f.calls.availability,1);assert.equal(f.calls.dispatch,0);assert.equal(f.calls.materialize,0);});
test('Node Gaussian controls enable generation for valid input and stay independent of provider configuration',async()=>{const f=await nodeFixture('worldlabs-marble-1.1'),[world]=await ready;f.context.build(f.node,[],world.prepare(f.node,[]));const submit=f.panel.querySelector('.world-generate'),input=f.panel.querySelector('textarea');assert.equal(submit.disabled,false);assert.equal(input.disabled,false);assert.equal(f.panel.querySelector('.world-renderer-unavailable'),null);input.value='a new courtyard';input.oninput();assert.equal(submit.disabled,false);assert.equal(f.calls.dispatch,0);});

test('Node Tripo GLB settings remain enabled and dispatch through normal materialization',async()=>{
 const f=await nodeFixture(),[world]=await ready;f.context.build(f.node,[],world.prepare(f.node,[]));
 assert.equal(f.panel.querySelector('.world-generate').disabled,false);assert.equal(f.panel.querySelector('.world-renderer-unavailable'),null);
 await f.context.generate();assert.equal(f.calls.dispatch,1);assert.equal(f.calls.guard,1);assert.equal(f.calls.resource,1);assert.equal(f.calls.materialize,1);
 assert.equal(f.node.worldResource.format,'glb');assert.equal(f.node.worldResource.url,'asset:actual-model');assert.deepEqual(f.notifications,[]);
});
