const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(require.resolve('../'+file),'utf8');
const scripts={image:read('node-editor.js'),text:read('text-generation-ui.js'),audio:read('audio-ui.js')};
const between=(source,start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('shared official action preserves button, SVG identity and disabled validity across job transitions',async()=>{
 const writes={html:0,attributes:0,disabled:0};
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.className='';this._disabled=false;this.classList={add:cls=>{this.className+=' '+cls;}};}
  append(child){if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);child.parentNode=this;this.children.push(child);}
  insertBefore(child,before){child.parentNode=this;this.children.splice(this.children.indexOf(before),0,child);}
  get firstElementChild(){return this.children[0]||null;}
  set innerHTML(value){writes.html++;this.html=value;this.children=[{tag:'svg',parentNode:this}];}
  set disabled(value){writes.disabled++;this._disabled=value;}get disabled(){return this._disabled;}
  setAttribute(key,value){writes.attributes++;this.attributes[key]=value;}getAttribute(key){return this.attributes[key]??null;}
 }
 const head=new Element('head'),original=global.document;
 global.document={head,createElement:tag=>new Element(tag),querySelector:()=>head.children.find(child=>'generationAction'in child.dataset)};
 try{
  const {updateGenerationAction}=await import('../src/features/generation-results/action-button.mjs');
  const footer=new Element('footer'),button=new Element('button');button.className='generate-trigger text-generate';footer.append(button);
  const shell=updateGenerationAction(button,{disabled:false,label:'生成文本'});
  assert.equal(footer.children[0],shell);assert.equal(shell.children[0],button);assert.match(button.className,/generate-trigger text-generate generation-action-button/);assert.equal(shell.children.length,1);
  assert.match(button.html,/m5 12 7-7 7 7/);assert.match(button.html,/M12 19V5/);assert.equal(button.disabled,false);
  const arrow=button.firstElementChild;
  updateGenerationAction(button,{busy:true,disabled:false,label:'生成文本'});assert.notEqual(button.firstElementChild,arrow);assert.match(button.html,/M12 3a9 9 0 1 0 9 9/);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
  const spinner=button.firstElementChild,before={...writes};for(let i=0;i<120;i++)updateGenerationAction(button,{busy:true,disabled:false,label:'生成文本'});
  assert.equal(button.firstElementChild,spinner);assert.deepEqual(writes,before);
  updateGenerationAction(button,{busy:false,disabled:true,label:'生成文本'});assert.match(button.html,/M12 19V5/);assert.equal(button.disabled,true);
  updateGenerationAction(button,{busy:false,disabled:false,label:'生成文本'});assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),'false');
  button.innerHTML='<span>external replacement</span>';updateGenerationAction(button,{disabled:false});assert.match(button.html,/M12 19V5/);
  const another=new Element('button');footer.append(another);updateGenerationAction(another,{disabled:false});assert.equal(head.children.length,1);
 }finally{global.document=original;}
});

function submissionFixture(kind){
 const node={id:'source',type:kind==='audio'?'audio':kind==='text'?'text':'image'},nodes=[node],jobs=[],notifications=[],events=[],prepare=deferred(),submit=deferred();
 let preparations=0,calls=0;
 const context={node:kind==='text'?id=>nodes.find(n=>n.id===id):node,current:node,config:{prompt:'原始提示'},submitting:new Set(),preparing:new Set(),draftFinalUI:null,structuredClone,
  app:{getState:()=>({nodes}),notify:message=>notifications.push(message)},window:{GenerationAPI:{getJobs:()=>jobs,submit:request=>{calls++;events.push(request);return submit.promise;}}},
  updateBusyState(){},updateGenerate(){},updateGenerateState(){},frameError:()=>'',generationContent:()=>({prompt:'投影提示'}),persist(){},buildRequest:()=>{preparations++;return prepare.promise;},panel:{querySelector:()=>({set textContent(value){notifications.push(value);}})}};
 let body;
 if(kind==='image')body=between(scripts.image,'  function busy()','\n')+ '\n'+between(scripts.image,'  async function submitGeneration()','  function updateBusyState(')+'\nglobalThis.run=submitGeneration;globalThis.isBusy=()=>busy();';
 else if(kind==='text')body=between(scripts.text,'  const busy =','\n')+'\n'+between(scripts.text,'  async function submit(id)','  function position(')+'\nglobalThis.run=()=>submit("source");globalThis.isBusy=()=>busy("source");';
 else body=between(scripts.audio,' const generationBusy=','\n')+'\n'+between(scripts.audio,' async function generate()',' function draw()')+'\nglobalThis.run=generate;globalThis.isBusy=()=>generationBusy("source");';
 vm.createContext(context);vm.runInContext(body,context);
 return{context,node,nodes,jobs,notifications,events,prepare,submit,get calls(){return calls;},get preparations(){return preparations;}};
}

for(const kind of ['image','text','audio']){
 test(`${kind} action blocks duplicate submits during async preparation and releases after completion`,async()=>{
  const f=submissionFixture(kind),first=f.context.run();assert.equal(f.context.isBusy(),true);await f.context.run();
  if(kind!=='image'){assert.equal(f.preparations,1);assert.equal(f.calls,0);f.prepare.resolve({nodeId:'source',kind:kind+'.generate'});await new Promise(setImmediate);}
  assert.equal(f.calls,1);await f.context.run();assert.equal(f.calls,1);assert.equal(f.context.isBusy(),true);
  f.submit.resolve({id:'accepted'});assert.equal((await first).id,'accepted');assert.equal(f.context.isBusy(),false);
  if(kind==='image'){assert.equal(f.events[0].parameters.prompt,'原始提示');assert.equal(f.events[0].prompt,'投影提示');}
 });
 test(`${kind} action preserves queued/running/applying and pending-operation lock without blocking completed jobs`,()=>{
  const f=submissionFixture(kind);
  for(const status of ['queued','running']){f.jobs[0]={request:{nodeId:'source'},status};assert.equal(f.context.isBusy(),true);}
  f.jobs[0]={request:{nodeId:'source'},status:'completed',applying:true};assert.equal(f.context.isBusy(),true);
  for(const status of ['completed','failed','cancelled','configuration_required']){f.jobs[0]={request:{nodeId:'source'},status};assert.equal(f.context.isBusy(),false);}
  f.jobs[0]={request:{nodeId:'other'},status:'running'};assert.equal(f.context.isBusy(),false);f.node.pendingOperation='pending';assert.equal(f.context.isBusy(),true);
 });
 test(`${kind} submit errors release lock and remain recoverable`,async()=>{
  const f=submissionFixture(kind),first=f.context.run();if(kind!=='image'){f.prepare.resolve({nodeId:'source'});await new Promise(setImmediate);}
  f.submit.reject(Error('供应商未配置'));await first;assert.equal(f.context.isBusy(),false);assert.deepEqual(f.notifications,['供应商未配置']);
 });
}

test('ordinary button never takes over video draft-final submission',async()=>{
 const f=submissionFixture('image');let calls=0;f.context.draftFinalUI={finalMode:()=>true,submit:()=>{calls++;return'final';}};
 assert.equal(await f.context.run(),'final');assert.equal(calls,1);assert.equal(f.calls,0);assert.equal(f.context.submitting.size,0);
});
