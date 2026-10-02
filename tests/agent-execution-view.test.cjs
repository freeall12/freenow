const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
// Isolate the execution renderer from the browser-only bundled rich-text editor.
const {pathToFileURL}=require('node:url'),viewURL=pathToFileURL(require.resolve('../src/features/agent-execution/view.mjs'));
const source=require('node:fs').readFileSync(viewURL,'utf8').replace("import {createGenerationCard,supportsCard} from '../agent-generation/card.mjs';","const supportsCard=trace=>trace.name==='generation_submit';function createGenerationCard(trace){const element=document.createElement('section');element.className='test-generation';const card={element,updates:0,suspends:0,update(){this.updates++;},suspend(){this.suspends++;},destroy(){element.remove();element.dataset.destroyed='true';}};element.card=card;return card;}").replace(/(from\s*)'([^']+)'/g,(_,prefix,specifier)=>prefix+JSON.stringify(new URL(specifier,viewURL).href)).replaceAll('import.meta.url',JSON.stringify(viewURL.href));
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
async function fixture(options={}){
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/'}),prior={},keys=['window','document','crypto','CSS','localStorage','requestAnimationFrame','cancelAnimationFrame'];
 for(const key of keys){prior[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='crypto'?require('node:crypto').webcrypto:key==='CSS'?{escape:value=>value}:dom.window[key]});}
 const {createExecutionRenderer}=await modulePromise,renderer=createExecutionRenderer(options);
 return{dom,renderer,document:dom.window.document,close(){renderer.destroy();dom.window.close();for(const key of keys)if(prior[key])Object.defineProperty(globalThis,key,prior[key]);else delete globalThis[key];}};
}
const trace=(id,name='canvas_read',status='done')=>({id,name,status,args:{},result:{nodes:[]},startedAt:100,completedAt:2100});

test('repeated complete render and reset preserve connected group, result slot and widget browsing context',async()=>{
 const seen=[],artifacts=new Map(),f=await fixture({renderArtifact(value,{streaming}){seen.push([value.id,streaming]);if(value.name!=='show_widget')return null;if(!artifacts.has(value.id)){const card=document.createElement('section'),frame=document.createElement('iframe');card.append(frame);artifacts.set(value.id,card);}return artifacts.get(value.id);}});
 try{
  const traces=[trace('read'),trace('widget','show_widget')],root=f.renderer.render(traces,{key:'a',streaming:true});f.document.body.append(root);
  const frame=root.querySelector('iframe'),context=frame.contentWindow,slot=frame.closest('.execution-results'),artifactParent=frame.parentElement.parentElement,removed=[];
  const observer=new f.dom.window.MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===root||node===slot||node===artifactParent||node.contains?.(frame))removed.push(node);});observer.observe(f.document.body,{childList:true,subtree:true});
  for(let i=0;i<40;i++){f.renderer.reset();assert.equal(f.renderer.render(traces.map(value=>({...value})),{key:'a',collapse:i%2===0,streaming:false}),root);assert.equal(frame.contentWindow,context);assert.equal(slot.isConnected,true);}
  await Promise.resolve();observer.disconnect();assert.deepEqual(removed,[]);assert.equal(root.querySelectorAll('.execution-results').length,2);assert.equal(slot.closest('.execution-content'),null);assert.equal(root.querySelectorAll('.execution-raw').length,1);assert.deepEqual(seen.at(-1),['widget',false]);
 }finally{f.close();}
});

test('new traces append without detaching existing artifact and updateTrace keeps artifact slot',async()=>{
 const frames=new Map(),calls=[],f=await fixture({appendResults(slot,result,value){slot.textContent=result?.label||value.id;},renderArtifact(value,options){calls.push(options.streaming);if(value.name!=='show_widget')return null;if(!frames.has(value.id))frames.set(value.id,document.createElement('iframe'));return frames.get(value.id);}});
 try{
  const widget=trace('widget','show_widget'),root=f.renderer.render([widget],{key:'a',streaming:true});f.document.body.append(root);const frame=frames.get('widget'),context=frame.contentWindow,slot=frame.closest('.execution-results');
  f.renderer.render([widget,trace('new')],{key:'a',streaming:true});assert.equal(frame.contentWindow,context);assert.equal(root.children[1],slot);
  f.renderer.updateTrace({...widget,result:{label:'updated'}});assert.equal(slot.querySelector('.execution-regular-results').textContent,'updated');assert.equal(frame.contentWindow,context);assert.equal(calls.at(-1),true);
  f.renderer.updateTrace(widget,{streaming:false});assert.equal(calls.at(-1),false);
  f.renderer.render([widget],{key:'a'});assert.equal(root.querySelectorAll('.execution-results').length,1);assert.equal(frame.contentWindow,context);
 }finally{f.close();}
});

test('prune removes only obsolete groups, blocks stale trace updates, and reset retains active groups',async()=>{
 const seen=[],f=await fixture({renderArtifact(value){seen.push(value.id);return null;}});
 try{
  const a=f.renderer.render([trace('a')],{key:'ga'}),b=f.renderer.render([trace('b')],{key:'gb'});f.document.body.append(a,b);f.renderer.reset();assert.equal(a.isConnected,true);assert.equal(b.isConnected,true);
  f.renderer.prune(['gb']);assert.equal(a.isConnected,false);assert.equal(b.isConnected,true);const count=seen.length;f.renderer.updateTrace(trace('a'));assert.equal(seen.length,count);
  assert.equal(f.renderer.render([trace('b')],{key:'gb'}),b);assert.notEqual(f.renderer.render([trace('a')],{key:'ga'}),a);
  f.renderer.prune([]);assert.equal(b.isConnected,false);
 }finally{f.close();}
});

test('ordinary disclosures, confirmation and display-tool suppression retain behavior',async()=>{
 const confirmations=[],f=await fixture({onConfirm:(value,allowed)=>confirmations.push([value.id,allowed])});
 try{
  const pending=trace('edit','canvas_update','pending');pending.args.prompt='修改画面';const root=f.renderer.render([pending,trace('prepare','prepare_widget'),trace('html','show_html')],{key:'a',collapse:true});f.document.body.append(root);
  assert.equal(root.querySelectorAll('.execution-tool').length,1);assert.equal(root.textContent.includes('prepare_widget'),false);assert.equal(root.textContent.includes('show_html'),false);root.querySelector('.execution-allow').click();assert.deepEqual(confirmations,[['edit',true]]);
  const trigger=root.querySelector('.execution-line');trigger.click();assert.equal(trigger.getAttribute('aria-expanded'),'true');f.renderer.reset();f.renderer.render([pending],{key:'a'});assert.equal(root.querySelector('.execution-line').getAttribute('aria-expanded'),'true');
  f.renderer.render([trace('read')],{key:'a',collapse:true});const summary=root.querySelector('.execution-summary-trigger');assert.ok(summary);summary.click();f.renderer.render([trace('read')],{key:'a',collapse:true});assert.equal(root.querySelector('.execution-summary-trigger'),summary);assert.equal(summary.getAttribute('aria-expanded'),'true');
 }finally{f.close();}
});

test('generation card lifecycle and real form drafts survive same-group renders and prune cleans cards',async()=>{
 const f=await fixture({forms:{onSubmit:()=>true}});try{
  const generated=trace('generation','generation_submit','pending'),form=trace('form','show_form','waiting');form.args={title:'创作需求',fields:[{id:'prompt',type:'text',label:'描述'}]};form.formDraft={prompt:'保留输入'};
  const root=f.renderer.render([generated,form],{key:'a'});f.document.body.append(root);const generation=root.querySelector('.test-generation'),formCard=root.querySelector('.agent-form-card'),input=formCard.querySelector('input,textarea');assert.ok(input);assert.equal(input.value,'保留输入');
  f.renderer.reset();assert.equal(generation.card.suspends,1);f.renderer.render([generated,form],{key:'a',collapse:true});assert.equal(root.querySelector('.test-generation'),generation);assert.equal(generation.card.updates,1);assert.equal(root.querySelector('.agent-form-card'),formCard);assert.equal(input.isConnected,true);assert.equal(input.value,'保留输入');assert.equal(root.querySelector('.execution-summary'),null);
  f.renderer.prune([]);assert.equal(generation.dataset.destroyed,'true');assert.equal(formCard.isConnected,false);
 }finally{f.close();}
});

test('rerender, reset and prune clear only their own running timers',async()=>{
 const originalSet=global.setInterval,originalClear=global.clearInterval,timers=new Set();global.setInterval=()=>{const id={};timers.add(id);return id;};global.clearInterval=id=>timers.delete(id);
 const f=await fixture();try{
  f.renderer.render([trace('a','canvas_read','running')],{key:'a'});f.renderer.render([trace('b','canvas_read','running')],{key:'b'});assert.equal(timers.size,2);
  for(let i=0;i<20;i++)f.renderer.render([trace('a','canvas_read','running')],{key:'a'});assert.equal(timers.size,2);
  f.renderer.prune(['b']);assert.equal(timers.size,1);f.renderer.reset();assert.equal(timers.size,0);
 }finally{f.close();global.setInterval=originalSet;global.clearInterval=originalClear;}
});

test('failed display tools surface localized errors instead of disappearing with hidden cards',async()=>{
 const f=await fixture();try{
  const html=trace('html','show_html','error');html.result={error:'互动作品路径无效'};const widget=trace('widget','show_widget');widget.result={error:'保存失败'};
  const root=f.renderer.render([html,widget],{key:'a',collapse:true});f.document.body.append(root);assert.deepEqual([...root.querySelectorAll('.execution-error')].map(node=>node.textContent),['互动作品路径无效','保存失败']);assert.ok(root.textContent.includes('失败：展示互动作品'));assert.ok(root.textContent.includes('失败：展示互动组件'));assert.equal(root.querySelector('.execution-summary'),null);f.renderer.render([widget],{key:'a',collapse:true});assert.equal(root.querySelector('.execution-summary'),null);assert.equal(root.querySelector('.execution-error').textContent,'保存失败');
 }finally{f.close();}
});
