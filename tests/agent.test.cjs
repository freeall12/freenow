const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../agent-tools.js');const {AgentRuntime}=require('../server/agent.cjs');
const response=(output)=>({output,output_text:output.filter(o=>o.type==='message').map(o=>o.content[0].text).join('')});
const call=(name,args,id='call_1')=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:id});
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
function runtime(replies,opts={}){const requests=[];const client={responses:{create:async args=>{requests.push(args);return response(replies.shift()||[message('done')]);}}};return {agent:new AgentRuntime({client,model:'test-model',...opts}),requests};}
test('tool schema rejects injection, unknown operations and invalid world coordinates',()=>{assert.throws(()=>parse('eval',{code:'alert(1)'}),/Unknown/);assert.throws(()=>parse('scene_update',{id:'x',patch:{position:[0,NaN,1]}}),/number/);assert.throws(()=>parse('canvas_add',{type:'text',title:'t',x:0,y:1,url:'javascript:1'}),/not allowed/);assert.throws(()=>parse('scene_add',{kind:'actor',properties:{scale:[1,-1,1]}}),/number/);assert.throws(()=>parse('scene_update',{id:'a',patch:JSON.parse('{"__proto__":{}}')}),/not allowed/);});
test('artifact tools cannot escape virtual storage and writes retain confirmation',async()=>{
 const input={artifact_path:'artifacts/广告脚本.md',title:'脚本',content_type:'markdown',content:'# 脚本',expected_revision:0};
 assert.equal(parse('artifacts_write',input).definition.mutates,true);
 for(const path of ['../.env','artifacts/../.env','artifacts/a/../../.env','artifacts/a\\b','artifacts//x','artifacts/a/','https://example.com','artifacts/%2e%2e/x','artifacts/x\n'])assert.throws(()=>parse('artifacts_read',{artifact_path:path}),/invalid string/);
 assert.throws(()=>parse('artifacts_write',{...input,execute:true}),/not allowed/);
 const {agent}=runtime([[call('artifacts_write',input)]]);
 assert.equal((await agent.start({message:'保存脚本'})).calls[0].mutates,true);
});
test('artifact revisions prevent lost updates; long content is paged and remains untrusted',async()=>{
 const {nextDocument,readSlice,validatePath}=await import('../src/features/agent-artifacts/model.mjs');
 const input={artifact_path:'artifacts/script.md',title:'脚本',content_type:'markdown',content:'a'.repeat(18000),expected_revision:0};
 const original={files:[],revision:0};const one=nextDocument(original,input);
 assert.equal(original.files.length,0);assert.equal(one.files[0].revision,1);
 assert.throws(()=>nextDocument(one,input),/已更新/);
 const two=nextDocument(one,{...input,content:'<script>untrusted()</script>',expected_revision:1});
 assert.equal(two.files[0].revision,2);assert.equal(one.files[0].content.length,18000);
 const page=readSlice(one.files[0],0,16000);assert.equal(page.content.length,16000);assert.equal(page.next_offset,16000);
 assert.equal(readSlice(one.files[0],16000).next_offset,null);
 assert.throws(()=>readSlice(one.files[0],.5),/范围/);
 assert.throws(()=>validatePath('artifacts/../private'),/路径/);
});
test('interactive HTML SDK request has no tools and rejects invalid source or incomplete output',async()=>{
 const {generateArtifactHtml}=require('../server/agent-artifacts.cjs'),requests=[];
 const source={artifact_path:'artifacts/brainstorm.md',title:'故事',content:'## 方向\n- **点子**：太空旅行',revision:1};
 const client={responses:{create:async request=>{requests.push(request);return {output_text:'```html\n<!doctype html><html><body>故事</body></html>\n```'};}}};
 const result=await generateArtifactHtml({source},{client,model:'configured-model'});
 assert.match(result.html,/^<!doctype html>/);assert.equal(requests[0].store,false);assert.equal(requests[0].tools,undefined);assert.equal(requests[0].model,'configured-model');assert.match(requests[0].instructions,/untrusted/);
 await assert.rejects(()=>generateArtifactHtml({source:{...source,artifact_path:'../.env'}},{client,model:'configured-model'}),/invalid/);
 await assert.rejects(()=>generateArtifactHtml({source,apiKey:'injected'},{client,model:'configured-model'}),/not allowed/);
 assert.equal(requests.length,1);
 await assert.rejects(()=>generateArtifactHtml({source},{client:{responses:{create:async()=>({status:'incomplete',output_text:'<html>'})}},model:'configured-model'}),/未完成/);
});
test('late interactive output cannot overwrite brainstorm source and carries the captured revision',async()=>{
 const {createArtifactGeneration}=await import('../src/features/agent-artifacts/generation.mjs');
 const writes=[],file={artifact_path:'artifacts/brainstorm.md',title:'original',content:'original content',revision:3};let finish;
 const manager=createArtifactGeneration({store:{write:async value=>{writes.push(value);return {...value,revision:9};}},getAdapter:()=>async()=>new Promise(resolve=>finish=resolve)});
 const pending=manager.generate(file);assert.equal(manager.get(file.artifact_path).status,'generating');file.content='new content';file.revision=4;
 finish({html:'<html>generated</html>',title:'page'});await pending;
 assert.equal(writes[0].source_revision,3);assert.notEqual(writes[0].artifact_path,file.artifact_path);assert.equal(writes[0].expected_revision,0);assert.equal(manager.get(file.artifact_path).status,'ready');assert.equal(file.content,'new content');
 const unsafe=createArtifactGeneration({store:{write:async()=>{throw Error('must not write')}},getAdapter:()=>async()=>({html:'<html>x</html>',artifact_path:file.artifact_path})});
 await unsafe.generate(file);assert.equal(unsafe.get(file.artifact_path).status,'failed');assert.match(unsafe.get(file.artifact_path).error,/不能覆盖/);
});
test('Responses continuation uses real call IDs, correct tool results and store:false',async()=>{const {agent,requests}=runtime([[call('canvas_read',{})],[call('canvas_add',{type:'text',title:'hello',x:12,y:-5},'call_2')],[message('完成')]]);let r=await agent.start({message:'Add text'});assert.equal(r.calls[0].mutates,false);r=await agent.resume(r.sessionId,[{callId:'call_1',result:{nodes:[]}}]);assert.equal(r.calls[0].mutates,true);r=await agent.resume(r.sessionId,[{callId:'call_2',result:{id:'node-1'}}]);assert.equal(r.done,true);assert.equal(r.text,'完成');assert.ok(requests.every(r=>r.store===false));assert.ok(requests[2].input.some(x=>x.type==='function_call_output'&&x.output.includes('node-1')));});
test('tool receipts reject omissions and fabrication, while identical accepted receipts return the saved response without executing again',async()=>{
 const {agent,requests}=runtime([[call('canvas_read',{})]]),r=await agent.start({message:'read'});
 await assert.rejects(()=>agent.resume(r.sessionId,[{callId:'other',result:{}}]),/不匹配/);await assert.rejects(()=>agent.resume(r.sessionId,[]),/不匹配/);
 const receipts=[{callId:'call_1',result:{}}],done=await agent.resume(r.sessionId,receipts);assert.deepEqual(await agent.resume(r.sessionId,receipts),done);assert.equal(requests.length,2);
 await assert.rejects(()=>agent.resume(r.sessionId,[{callId:'call_1',result:{fabricated:true}}]),/结束/);assert.equal(requests.length,2);
});
test('unknown model tools are returned as errors, never sent to browser for execution',async()=>{const {agent,requests}=runtime([[call('shell_exec',{cmd:'rm'})],[message('已停止')]]);const r=await agent.start({message:'read'});assert.equal(r.done,true);assert.equal(r.calls.length,0);assert.match(requests[1].input.find(i=>i.type==='function_call_output').output,/Unknown tool/);});
test('tool loop has a strict round budget',async()=>{const {agent}=runtime([[call('canvas_read',{})]],{maxRounds:1});const r=await agent.start({message:'read'});const done=await agent.resume(r.sessionId,[{callId:'call_1',result:{}}]);assert.equal(done.done,true);assert.match(done.text,/上限/);});
test('cancel prevents further execution',async()=>{const {agent}=runtime([[call('scene_capture',{})]]);const r=await agent.start({message:'capture'});assert.equal(agent.cancel(r.sessionId).cancelled,true);await assert.rejects(()=>agent.resume(r.sessionId,[{callId:'call_1',result:{}}]),{code:'cancelled'});});

test('model aliases resolve server-side and stay fixed through tool continuations',async()=>{
 const {agent,requests}=runtime([[call('canvas_read',{})],[message('done')],[message('other')]],{models:{'g-3-8-flash':'configured-fast-model'}});
 const result=await agent.start({message:'read',modelSelection:{id:'g-3-8-flash'}});
 agent.model='changed-default';agent.models['g-3-8-flash']='changed-route';
 await agent.resume(result.sessionId,[{callId:'call_1',result:{nodes:[]}}]);
 await agent.start({message:'next',modelSelection:{id:'auto'}});
 assert.deepEqual(requests.map(r=>r.model),['configured-fast-model','configured-fast-model','changed-default']);
});
test('unconfigured or malformed model selection cannot silently call the default model',async()=>{
 const {agent,requests}=runtime([]);
 await assert.rejects(()=>agent.start({message:'read',modelSelection:{id:'not-connected'}}),e=>e.code==='configuration_required');
 await assert.rejects(()=>agent.start({message:'read',modelSelection:{id:'../provider'}}),/无效/);
 assert.equal(requests.length,0);assert.equal(agent.sessions.size,0);
});

test('thinking effort is explicitly mapped and remains fixed through tool continuation',async()=>{
 const {agent,requests}=runtime([[call('canvas_read',{})],[message('done')]],{models:{'deepseek-v4-1-flash':'configured-model'},reasoning:{'deepseek-v4-1-flash':{max:'xhigh'}}});
 const r=await agent.start({message:'read',modelSelection:{id:'deepseek-v4-1-flash',thinking:{enabled:true,level:'max'}}});
 agent.reasoning['deepseek-v4-1-flash'].max='low';
 await agent.resume(r.sessionId,[{callId:'call_1',result:{nodes:[]}}]);
 assert.deepEqual(requests.map(r=>r.reasoning),[{effort:'xhigh'},{effort:'xhigh'}]);
});
test('unsupported thinking states and missing provider mappings fail before any SDK call',async()=>{
 const {agent,requests}=runtime([],{models:{'deepseek-v4-1-flash':'model','tapnow-o-4-6':'other'}});
 for(const thinking of [{enabled:false,level:'high'},{enabled:true,level:'medium'},{enabled:true,level:'high',provider:'injected'}]) await assert.rejects(()=>agent.start({message:'read',modelSelection:{id:'deepseek-v4-1-flash',thinking}}),/思考|档位/);
 await assert.rejects(()=>agent.start({message:'read',modelSelection:{id:'deepseek-v4-1-flash',thinking:{enabled:true,level:'high'}}}),e=>e.code==='configuration_required');
 assert.equal(requests.length,0);assert.equal(agent.sessions.size,0);
});
test('disable and switch-only models require explicit provider semantics, Auto omits reasoning',async()=>{
 const {agent,requests}=runtime([],{models:{'tapnow-o-4-6':'model','k-2-6':'other'},reasoning:{'tapnow-o-4-6':{off:'none'},'k-2-6':{enabled:'medium',off:'none'}}});
 await agent.start({message:'read',modelSelection:{id:'tapnow-o-4-6',thinking:{enabled:false,level:'medium'}}});
 await agent.start({message:'read',modelSelection:{id:'k-2-6',thinking:{enabled:true}}});
 await agent.start({message:'read',modelSelection:{id:'auto'}});
 assert.deepEqual(requests.map(r=>r.reasoning),[{effort:'none'},{effort:'medium'},undefined]);
});

test('conversation model survives preference changes and persisted history, unknown legacy models are not guessed',async()=>{
 const {captureSessionModel,sessionModelId}=await import('../src/features/agent-composer/model-session.mjs');
 const chat={messages:[]};
 assert.equal(captureSessionModel(chat,'deepseek-v4-1-flash'),'deepseek-v4-1-flash');
 chat.messages.push({role:'user',text:'read'});
 const restored=JSON.parse(JSON.stringify(chat));
 assert.equal(sessionModelId(restored,'auto'),'deepseek-v4-1-flash');
 assert.equal(captureSessionModel(restored,'tapnow-g-6-s'),'deepseek-v4-1-flash');
 assert.equal(captureSessionModel({messages:[]},'auto'),'auto');
 const legacy={messages:[{role:'user',text:'legacy'}]};
 assert.throws(()=>captureSessionModel(legacy,'auto'),/未记录/);
 assert.equal(legacy.selectedModelAtStart,undefined);
});

test('Agent attachments become actual Responses image inputs, with no remote URL or file path fetching',async()=>{
 const {mediaContent}=require('../server/agent-media.cjs');
 const imageUrl='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,16]).toString('base64');
 const parts=mediaContent([{name:'clip.mp4',imageUrl,time:1.25}]);assert.equal(parts[1].type,'input_image');assert.equal(parts[1].image_url,imageUrl);assert.match(parts[0].text,/sampledVideoFrameSeconds/);
 assert.throws(()=>mediaContent([{name:'bad',imageUrl:'https://example.invalid/private'}]),/格式/);
 assert.throws(()=>mediaContent([{name:'bad',imageUrl:'data:image/jpeg;base64,'+Buffer.from('html').toString('base64')}]),/JPEG/);
 assert.throws(()=>mediaContent([{name:'bad',imageUrl,time:-1}]),/时间/);
 const requests=[],runtime=new AgentRuntime({model:'test-model',client:{responses:{create:async input=>{requests.push(input);return {output:[],output_text:'ok'};}}}});
 await runtime.start({message:'describe',mediaInputs:[{name:'frame',imageUrl}]});assert.equal(requests[0].input.at(-1).content[2].type,'input_image');
});

test('composer mention identity survives text/clipboard conversion and deletion removes only explicit skills',async()=>{
 const {textDocument,documentText,mentionNames,applyComposerSnapshot,documentForDraft}=await import('../src/features/agent-composer/editor-state.mjs');
 const text='前文 @depth-video-studio 后文\n第二行',doc=textDocument(text,['depth-video-studio']);
 assert.equal(documentText(doc),text);assert.equal(documentText({content:doc.content[0].content}),'前文 @depth-video-studio 后文');
 assert.deepEqual(mentionNames(doc),['depth-video-studio']);
 const restored=JSON.parse(JSON.stringify({studioNodeId:'scene',text,composerDoc:doc,skills:['3d-scene-director','depth-video-studio']}));
 assert.deepEqual(documentForDraft(restored),doc);applyComposerSnapshot(restored,{doc:textDocument('只保留正文')});
 assert.deepEqual(restored.skills,['3d-scene-director']);assert.equal(restored.text,'只保留正文');
 const legacy={text:'@depth-video-studio ',skills:['depth-video-studio']};
 applyComposerSnapshot(legacy,{doc:textDocument('')});assert.deepEqual(legacy.skills,[]);
 const typed=textDocument('@unknown-skill');assert.deepEqual(mentionNames(typed),[]);
});

test('reference identities survive duplicate labels and clearing a turn preserves only explicit pins and scene',async()=>{
 const {textDocument,documentText,applyComposerSnapshot}=await import('../src/features/agent-composer/editor-state.mjs');
 const {referenceNodes}=await import('../src/features/agent-composer/reference-data.mjs');
 const refs=[{kind:'node',id:'a',label:'same'},{kind:'node',id:'b',label:'same'}];
 const doc=textDocument('@same @same @same',[],refs);
 assert.deepEqual(referenceNodes(doc).map(r=>r.id),['a','b']);assert.equal(documentText(doc),'@same @same @same');
 const draft={studioNodeId:'scene',refs:['manual','a','scene'],referencePins:['manual','a'],skills:['3d-scene-director']};
 applyComposerSnapshot(draft,{doc});assert.deepEqual(draft.refs,['manual','a','b','scene']);
 const submitted=[...draft.refs];applyComposerSnapshot(draft,{doc:textDocument('')});
 assert.deepEqual(draft.refs,['manual','a','scene']);assert.deepEqual(submitted,['manual','a','b','scene']);
});
test('reference resolution respects library scope, live deletion and exact canvas numbering',async()=>{
 const {resolveReferenceData,nodeOptions}=await import('../src/features/agent-composer/reference-data.mjs');
 const data={nodes:[{id:'a',title:'same',type:'image'},{id:'b',title:'same',type:'text'}],library:[{id:'same',name:'Personal',folder:'角色',type:'image'},{id:'same',name:'Team',folder:'角色',scope:'team',type:'image'}]};
 const refs=[{kind:'folder',id:'角色',scope:'personal'},{kind:'folder',id:'角色',scope:'team'},{kind:'library',id:'same',scope:'team'},{kind:'app',id:'brainstorm'}];
 assert.deepEqual(resolveReferenceData(refs,data).map(r=>r.name),['Personal','Team']);
 assert.deepEqual(nodeOptions(data.nodes,'#2').map(r=>r.id),['b']);
 assert.throws(()=>resolveReferenceData([{kind:'node',id:'deleted',label:'lost'}],data),/已删除/);
 assert.throws(()=>resolveReferenceData([{kind:'library',id:'deleted',scope:'personal',label:'lost'}],data),/已删除/);
 assert.equal(resolveReferenceData([{kind:'folder',id:'empty',scope:'personal'}],data).length,0);
});

test('application installation state requires adapter confirmation and failed operations preserve existing state',async()=>{
 const {createAppRegistry,validateSkill}=await import('../src/features/agent-manager/model.mjs');
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},catalog=[{id:'builtin',installed:true,builtin:true},{id:'external',installed:false}];let adapter;
 const registry=createAppRegistry({storage,catalog,adapter:()=>adapter});
 await assert.rejects(()=>registry.install('external'),/未配置/);assert.equal(registry.state('external').installed,false);
 adapter={install:async()=>({installed:false}),uninstall:async()=>({uninstalled:false})};
 await assert.rejects(()=>registry.install('external'),/未完成/);assert.equal(values.size,0);
 adapter.install=async()=>({installed:true});await registry.install('external');registry.enable('external',false);
 assert.deepEqual(createAppRegistry({storage,catalog}).state('external'),{installed:true,enabled:false});
 await assert.rejects(()=>registry.uninstall('external'),/未完成/);assert.equal(registry.state('external').installed,true);
 await assert.rejects(()=>registry.uninstall('builtin'),/内置/);
 adapter.uninstall=async()=>({uninstalled:true});await registry.uninstall('external');assert.equal(registry.state('external').installed,false);
 assert.throws(()=>validateSkill({name:'Bad name',description:'x',text:'y'}),/名称/);
 assert.throws(()=>validateSkill({name:'existing',description:'x',text:'y'},[{name:'existing'}]),/同名/);
 assert.deepEqual(validateSkill({name:' local-skill ',description:' desc ',text:' body '}),{name:'local-skill',description:'desc',text:'body',custom:true});
});

test('skill packages preserve reference hierarchy, reject oversized/path-escaping input, and page only package files',async()=>{
 const {readSkillPackage,resolveSkillFile,readSkillPage}=await import('../src/features/agent-manager/skill-package.mjs');
 const file=(name,content,path)=>({name,size:Buffer.byteLength(content),webkitRelativePath:path,text:async()=>content});
 const imported=await readSkillPackage([file('SKILL.md','---\nname: Package Name\ndescription: >\n  first line\n  second line\n---\n# Guide','package/SKILL.md'),file('steps.md','x'.repeat(21000),'package/references/steps.md'),file('a.png','skip','package/a.png')],{directory:true});
 assert.equal(imported.skill.name,'package-name');assert.equal(imported.skill.description,'first line second line');assert.equal(imported.skill.files.length,2);assert.equal(imported.skipped,1);
 assert.equal(resolveSkillFile(imported.skill,'references/steps.md','../SKILL.md').path,'SKILL.md');
 assert.throws(()=>resolveSkillFile(imported.skill,'SKILL.md','../secret.md'),/超出/);assert.throws(()=>resolveSkillFile(imported.skill,'SKILL.md','https://example.com'),/不支持/);
 const page=readSkillPage(imported.skill,{path:'references/steps.md'});assert.equal(page.content.length,20000);assert.equal(page.nextOffset,20000);assert.equal(readSkillPage(imported.skill,{path:'references/steps.md',offset:20000}).content.length,1000);
 await assert.rejects(()=>readSkillPackage([{...file('SKILL.md','x','package/SKILL.md'),size:2097153}],{directory:true}),/2 MB/);
 await assert.rejects(()=>readSkillPackage([file('SKILL.md','x','package/../SKILL.md')],{directory:true}),/路径/);
 await assert.rejects(()=>readSkillPackage([file('a.md','x','')],{directory:true}),/无法读取/);
 await assert.rejects(()=>readSkillPackage([file('skill.md','---\nname: existing\n---\nbody')],{existing:[{name:'existing'}]}),/同名/);
});
test('skill rename and removal update semantic drafts without replacing plain prose or previous messages',async()=>{
 const {rewriteSkillDraft}=await import('../src/features/agent-manager/skill-package.mjs');
 const draft={skills:['old','other'],composerDoc:{type:'doc',content:[{type:'paragraph',content:[{type:'skillMention',attrs:{name:'old'}},{type:'text',text:' @old plain'}]}]}};
 const renamed=rewriteSkillDraft(draft,'old','new');assert.equal(renamed.doc.content[0].content[0].attrs.name,'new');assert.equal(renamed.doc.content[0].content[1].text,' @old plain');assert.deepEqual(renamed.skills,['new','other']);assert.equal(draft.composerDoc.content[0].content[0].attrs.name,'old');
 const removed=rewriteSkillDraft(draft,'old',null);assert.equal(removed.doc.content[0].content.length,1);assert.deepEqual(removed.skills,['other']);
 const {parse}=require('../agent-tools.js');assert.equal(parse('skills_read',{name:'package',path:'references/steps.md',offset:20000}).definition.mutates,false);assert.throws(()=>parse('skills_read',{name:'package',offset:-1}));
});

test('skill form uses official name, description and instruction limits',async()=>{
 const {validateSkill}=await import('../src/features/agent-manager/model.mjs');const fields={name:'a'.repeat(64),description:'d'.repeat(1024),text:'x'.repeat(20000)};
 assert.equal(validateSkill(fields).name.length,64);assert.throws(()=>validateSkill({...fields,name:fields.name+'a'}),/64/);assert.throws(()=>validateSkill({...fields,description:fields.description+'d'}),/1024/);assert.throws(()=>validateSkill({...fields,text:fields.text+'x'}),/20000/);
});

test('Agent Markdown rejects active content while preserving GFM and literal code',async()=>{
 const {renderMessageMarkdown,safeMessageLink}=await import('../src/features/agent-messages/markdown.mjs');
 const html=renderMessageMarkdown('# 标题\n\n**重点**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n[危险](javascript:alert(1)) ![图片](https://example.com/a.png)\n\n<script>alert(1)</script>');
 assert.match(html,/<h1>标题<\/h1>/);assert.match(html,/<strong>重点<\/strong>/);assert.match(html,/<table>/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<script|<img|href="javascript:/);assert.equal(safeMessageLink('data:text/html,hi'),null);assert.equal(safeMessageLink('/private'),null);assert.equal(safeMessageLink('https://example.com'), 'https://example.com/');
});

test('Conversation fork keeps the selected history and scene but never pending input or later actions',async()=>{
 const {forkConversation}=await import('../src/features/agent-messages/model.mjs');
 const source={id:'source',title:'场景',queuedMessages:[{id:'later-task'}],studioNodeId:'scene',selectedModelAtStart:{id:'auto'},text:'未发出的文字',composerDoc:{type:'doc'},refs:['image','scene'],skills:['other'],uploads:[{id:'upload'}],messages:[{role:'user',text:'构图',composerDoc:{type:'doc'}},{role:'tool',status:'done',result:{nodeId:'created'}},{role:'assistant',text:'完成'},{role:'user',text:'此后'}]};
 const result=forkConversation(source,2,{id:'fork',now:'2026-09-29T00:00:00Z'});
 assert.deepEqual(result.queuedMessages,[]);assert.equal(result.messages.length,3);assert.equal(result.messages[1].status,'done');assert.equal(result.studioNodeId,'scene');assert.deepEqual(result.refs,['scene']);assert.equal(result.text,'');assert.deepEqual(result.uploads,[]);assert.deepEqual(result.forkedFrom,{chatId:'source',messageIndex:2});
 result.messages[0].text='changed';assert.equal(source.messages[0].text,'构图');assert.equal(source.messages.length,4);assert.throws(()=>forkConversation(source,3),/不存在/);
});

test('Agent rerender preserves reading position, following only the bottom or a new session',async()=>{
 const {captureReaderPosition,restoreReaderPosition}=await import('../src/features/agent-messages/model.mjs');
 const list={dataset:{sessionId:'a'},scrollTop:123.5,clientHeight:400,scrollHeight:1600};const state=captureReaderPosition(list);
 list.scrollHeight=2000;list.scrollTop=0;restoreReaderPosition(list,state);assert.equal(list.scrollTop,123.5);
 list.scrollTop=1599;const end=captureReaderPosition(list);list.scrollHeight=2300;restoreReaderPosition(list,end);assert.equal(list.scrollTop,2300);
 list.dataset.sessionId='b';restoreReaderPosition(list,state);assert.equal(list.scrollTop,2300);
});

test('Queue submissions freeze references and attachments; editing restores only the submitted draft',async()=>{
 const {captureSubmission,restoreSubmission,reorderQueue}=await import('../src/features/agent-queue/model.mjs');
 const chat={id:'a',text:'第一条',refs:['node-a'],skills:['director'],uploads:[{id:'one',asset:'asset:1'}],artifactRefs:[{artifact_path:'a.md'}],quotedText:'引用',composerDoc:{type:'doc',content:[]}};
 const item=captureSubmission(chat,{selection:{id:'auto'},id:'item',now:1});chat.uploads[0].asset='asset:changed';chat.refs.push('node-b');chat.text='后续草稿';
 assert.equal(item.uploads[0].asset,'asset:1');assert.deepEqual(item.refs,['node-a']);restoreSubmission(chat,item);assert.equal(chat.text,'第一条');assert.equal(chat.id,'a');assert.equal(chat.uploads[0].asset,'asset:1');
 const rows=[{id:'1'},{id:'2'},{id:'3'}];assert.deepEqual(reorderQueue(rows,'1','3').map(x=>x.id),['2','3','1']);assert.deepEqual(rows.map(x=>x.id),['1','2','3']);assert.throws(()=>captureSubmission({...chat,text:' '.repeat(2)}),/请输入/);
});

test('Queue runner serializes submissions, persists dequeue before execution, and pauses without losing remaining work',async()=>{
 const {createQueueRunner}=await import('../src/features/agent-queue/model.mjs');
 const chat={id:'a',queuedMessages:[{id:'first'},{id:'second'}]},events=[];let release;
 const runner=createQueueRunner({getChat:()=>chat,validate(){},persist(){events.push('persist:'+chat.queuedMessages.map(x=>x.id));},run:async(_,item)=>{events.push('start:'+item.id);if(item.id==='first')await new Promise(resolve=>release=resolve);events.push('end:'+item.id);return item.id==='second'?{error:'configuration_required'}:{};},changed(){},failed(error){events.push(error.message);}});
 const running=runner.drain();await runner.drain();assert.deepEqual(events,['persist:second','start:first']);chat.queuedMessages.push({id:'third'});release();await running;
 assert.deepEqual(events.filter(x=>x.startsWith('start:')),['start:first','start:second']);assert.equal(chat.queuePauseReason,'configuration_required');assert.deepEqual(chat.queuedMessages.map(x=>x.id),['third']);
 await runner.drain();assert.equal(events.filter(x=>x==='start:third').length,0);
});

test('Queue preflight and storage failures retain the first task without invoking tools',async()=>{
 const {createQueueRunner}=await import('../src/features/agent-queue/model.mjs');
 for(const phase of ['validate','persist']){
  const chat={id:'a',queuedMessages:[{id:'one'}]};let calls=0;
  const runner=createQueueRunner({getChat:()=>chat,validate(){if(phase==='validate')throw Error('scene changed');},persist(){if(phase==='persist')throw Error('storage full');},run:async()=>{calls++;},changed(){},failed(){}});
  await runner.drain();assert.equal(calls,0);assert.equal(chat.queuedMessages[0].id,'one');assert.ok(chat.queuePauseReason);
 }
});
test('Execution confirmation rejects and aborts without running a mutating tool',async()=>{
 const {executeTracedCall}=await import('../src/features/agent-execution/trace.mjs');
 let calls=0;const traces=[],call={name:'canvas_add',args:{x:2.375,y:-.123456789},callId:'one'};
 const deps={changed:t=>traces.push(structuredClone(t)),execute:async()=>{calls++;},confirm:async()=>false};
 const denied=await executeTracedCall(call,deps);
 assert.equal(calls,0);assert.equal(traces.at(-1).status,'denied');assert.match(denied.result.error,/拒绝/);assert.equal(traces.at(-1).startedAt,undefined);
 const controller=new AbortController();
 await assert.rejects(executeTracedCall(call,{...deps,signal:controller.signal,confirm:async()=>{controller.abort();return true;}}),{name:'AbortError'});
 assert.equal(calls,0);assert.equal(traces.at(-1).status,'cancelled');assert.equal(traces.at(-1).args.y,-.123456789);
});

test('Execution trace preserves actual completion during stop and real error results',async()=>{
 const {executeTracedCall}=await import('../src/features/agent-execution/trace.mjs');
 const controller=new AbortController(),traces=[];let time=1000;
 const deps={changed:t=>traces.push(structuredClone(t)),now:()=>time+=250,signal:controller.signal,execute:async()=>{controller.abort();return {id:'actual-node'};}};
 await assert.rejects(executeTracedCall({name:'canvas_add',args:{},callId:'one'},deps),{name:'AbortError'});
 assert.equal(traces.at(-1).status,'done');assert.equal(traces.at(-1).result.id,'actual-node');assert.ok(traces.at(-1).endedAt>=traces.at(-1).startedAt);
 await executeTracedCall({name:'generation_submit',args:{},callId:'two'},{...deps,signal:undefined,execute:async()=>({error:'API 未配置'})});
 assert.equal(traces.at(-1).status,'error');assert.equal(traces.at(-1).result.error,'API 未配置');
});

test('Reload marks unresolved traces unknown and never fabricates elapsed time',async()=>{
 const {recoverTraces,elapsedMs,durationLabel}=await import('../src/features/agent-execution/trace.mjs');
 const messages=[{role:'tool',status:'pending'},{role:'tool',status:'running',startedAt:10},{role:'tool',status:'done',startedAt:100,endedAt:1300}];
 recoverTraces(messages);assert.equal(messages[0].status,'interrupted');assert.match(messages[0].result.error,/未执行/);assert.match(messages[1].result.error,/结果未恢复/);assert.equal(messages[1].endedAt,undefined);
 assert.equal(messages[2].status,'done');assert.equal(elapsedMs(messages.slice(0,2)),null);assert.equal(elapsedMs([messages[2]]),1200);assert.equal(durationLabel(null),'');
});

test('Generation confirmation executes edited fields once and preserves the original request and authority',async()=>{
 const {executeTracedCall}=await import('../src/features/agent-execution/trace.mjs');
 const {createGenerationDraft,confirmedArguments,normalizeDraft}=await import('../src/features/agent-generation/model.mjs');
 const original={nodeId:'target',referenceIds:['ref'],kind:'image.generate',prompt:'original',model:'seedream-5-pro'},nodes=[{id:'target'},{id:'ref',image:'asset:ref'}];
 const draft=createGenerationDraft(original,{},nodes),edited=normalizeDraft({...draft,prompt:'edited',model:'nano-banana-2',aspect:'16:9',count:2},nodes);
 const args=confirmedArguments(original,{...edited,nodeId:'other',referenceIds:[],kind:'video.generate'},nodes);assert.equal(args.nodeId,'target');assert.deepEqual(args.referenceIds,['ref']);assert.equal(args.kind,'image.generate');assert.equal(args.model,'nano-banana-flash');
 let trace,calls=0;await executeTracedCall({name:'generation_submit',args:original,callId:'c'},{confirm:async()=>({allowed:true,args}),execute:async(name,input)=>{require('../agent-tools.js').parse(name,input);calls++;assert.equal(input.prompt,'edited');assert.equal(input.count,2);return {taskId:'real-task'};},changed:value=>{trace=value;}});
 assert.equal(calls,1);assert.equal(trace.originalArgs.prompt,'original');assert.equal(trace.args.prompt,'edited');assert.equal(original.prompt,'original');
 assert.throws(()=>confirmedArguments(original,edited,[nodes[0]]),/参考素材已删除/);assert.throws(()=>confirmedArguments(original,{...edited,prompt:'  '},nodes),/提示词/);
});

test('Video model changes drop incompatible fields and validate reference modes and automatic duration',async()=>{
 const {createGenerationDraft,normalizeDraft,confirmedArguments}=await import('../src/features/agent-generation/model.mjs');
 const nodes=[{id:'target'},{id:'image',image:'asset:img'},{id:'video',video:'asset:vid'}];
 const args={nodeId:'target',kind:'video.generate',model:'seedance-2.0',prompt:'move',referenceIds:['image']};
 const draft=createGenerationDraft(args,{},nodes),next=normalizeDraft({...draft,model:'flux-3',duration:99,resolution:'4k',quality:'pro'},nodes);
 assert.equal(next.videoMode,'IMAGE_TO_VIDEO');assert.equal(next.duration,5);assert.equal(next.resolution,'720p');assert.equal(next.quality,undefined);assert.equal(next.aspect,undefined);
 assert.throws(()=>confirmedArguments({...args,referenceIds:['video']},next,nodes),/参考素材/);
 const edit=createGenerationDraft({...args,model:'seedance-2.5',referenceIds:['video'],videoMode:'VIDEO_EDIT'}, {},nodes);assert.equal(edit.duration,-1);
 const {parse}=require('../agent-tools.js');parse('generation_submit',edit);
 for(const duration of [0,-.5])assert.throws(()=>parse('generation_submit',{...args,duration}));assert.throws(()=>parse('generation_submit',{...args,duration:-1}));
});

test('Generation status follows its actual task including late failure, application failure and refresh',async()=>{
 const {attachGenerationJob,recoverGenerationJobs}=await import('../src/features/agent-generation/jobs.mjs'),{generationStatus}=await import('../src/features/agent-generation/model.mjs');
 const trace={name:'generation_submit',status:'done',result:{taskId:'one'}};
 assert.equal(attachGenerationJob(trace,{id:'other',status:'failed'}),false);assert.equal(generationStatus(trace).label,'已确认');
 attachGenerationJob(trace,{id:'one',status:'configuration_required',error:'connect API',outputs:[{secret:'not saved'}]});assert.equal(generationStatus(trace).state,'failed');assert.equal(trace.generationJob.outputs,undefined);
 recoverGenerationJobs([trace],[]);assert.equal(trace.generationJob.status,'configuration_required');
 attachGenerationJob(trace,{id:'one',status:'succeeded',applying:true});recoverGenerationJobs([trace],[]);assert.equal(trace.generationJob.status,'unknown');
 attachGenerationJob(trace,{id:'one',status:'succeeded',applicationError:'decode failed'});assert.equal(generationStatus(trace).error,'decode failed');
});

test('Batch grouping preserves mutation boundaries, settings and independent targets',async()=>{
 const {groupGenerationCalls}=await import('../src/features/agent-generation/batch.mjs');
 const make=(id,model='seedream-5-pro')=>({name:'generation_submit',callId:id,args:{nodeId:id,kind:'image.generate',model,prompt:id}});
 const a=make('a'),b=make('b'),c=make('c','nano-banana-2'),mutation={name:'canvas_read',args:{}};
 const groups=groupGenerationCalls([a,b,c,mutation,a,{...b,args:{...b.args,nodeId:'a'}}]);
 assert.deepEqual(groups.map(group=>group.length),[2,1,1,1,1]);assert.equal(groups[0][0],a);assert.equal(groups[3][0],a);
});

test('Batch confirmation edits selected items, returns every call ID and never executes removed items',async()=>{
 const {executeGenerationBatch,batchDraft,batchDecisions}=await import('../src/features/agent-generation/batch.mjs');
 const {confirmedArguments}=await import('../src/features/agent-generation/model.mjs'),{parse}=require('../agent-tools.js');
 const nodes=['a','b','c'].map(id=>({id,image:'asset:'+id})),calls=nodes.map(node=>({callId:'call-'+node.id,name:'generation_submit',args:{nodeId:node.id,referenceIds:[node.id],kind:'image.generate',model:'seedream-5-pro',prompt:'original '+node.id}})),submitted=[];let trace;
 const results=await executeGenerationBatch(calls,{confirm:async value=>{const items=batchDraft(value,()=>({}),nodes);items[0].args.prompt='edited';items[1].rejected=true;return {allowed:true,args:{decisions:batchDecisions(value,{...items[0].args,aspect:'16:9'},items,nodes)}};},validate:parse,validateConfirmed:(original,args)=>confirmedArguments(original,args,nodes),execute:async(name,args)=>{submitted.push(args);return {taskId:'job-'+args.nodeId};},changed:value=>trace=value});
 assert.deepEqual(submitted.map(args=>args.nodeId),['a','c']);assert.equal(submitted[0].prompt,'edited');assert.equal(submitted[1].prompt,'original c');assert.ok(submitted.every(args=>args.aspect==='16:9'));assert.deepEqual(submitted[1].referenceIds,['c']);
 assert.deepEqual(results.map(result=>result.callId),['call-a','call-b','call-c']);assert.match(results[1].result.error,/拒绝/);assert.equal(trace.batchItems[1].status,'denied');assert.equal(trace.batchItems[0].originalArgs.prompt,'original a');assert.equal(trace.status,'done');
});

test('Batch rejection, stale decisions and stop prevent unauthorized or later submissions',async()=>{
 const {executeGenerationBatch}=await import('../src/features/agent-generation/batch.mjs'),{recoverTraces}=await import('../src/features/agent-execution/trace.mjs');
 const calls=['a','b'].map(id=>({callId:id,name:'generation_submit',args:{nodeId:id,kind:'video.generate',prompt:id}}));let count=0,trace;
 const deps={execute:async()=>{count++;return {taskId:'job'};},changed:value=>trace=value};
 await executeGenerationBatch(calls,{...deps,confirm:async()=>false});assert.equal(count,0);assert.equal(trace.status,'denied');assert.equal(trace.startedAt,undefined);
 await executeGenerationBatch(calls,{...deps,confirm:async()=>({allowed:true,args:{decisions:[{callId:'wrong',allowed:true}]}})});assert.equal(count,0);assert.equal(trace.status,'error');
 const controller=new AbortController();await assert.rejects(executeGenerationBatch(calls,{...deps,signal:controller.signal,execute:async()=>{count++;controller.abort();return {taskId:'already-submitted'};}}),{name:'AbortError'});
 assert.equal(count,1);assert.equal(trace.batchItems[0].status,'done');assert.equal(trace.batchItems[0].result.taskId,'already-submitted');assert.equal(trace.batchItems[1].status,'cancelled');
 trace.status='running';trace.batchItems[1].status='waiting';recoverTraces([trace]);assert.equal(trace.status,'interrupted');assert.equal(trace.batchItems[1].status,'interrupted');assert.equal(trace.batchItems[0].status,'done');
});

test('Batch jobs match nested task IDs and do not hide an individual provider failure',async()=>{
 const {attachGenerationJob,recoverGenerationJobs}=await import('../src/features/agent-generation/jobs.mjs'),{generationStatus}=await import('../src/features/agent-generation/model.mjs');
 const trace={name:'generation_batch',status:'done',batchItems:[{name:'generation_submit',status:'done',result:{taskId:'a'}},{name:'generation_submit',status:'done',result:{taskId:'b'}}]};
 assert.equal(attachGenerationJob(trace,{id:'b',status:'failed',error:'real error'}),true);assert.equal(trace.batchItems[0].generationJob,undefined);assert.match(generationStatus(trace).error,/第 2 项.*real error/);
 recoverGenerationJobs([trace],[]);assert.equal(trace.batchItems[0].generationJob.status,'unknown');assert.equal(trace.batchItems[1].generationJob.status,'failed');
});

test('Agent skill commits persist references, reject stale edits and replay stable operation receipts',async()=>{
 const {commitSkill,skillVersion}=await import('../src/features/agent-manager/skill-commit.mjs');
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const input={name:'shot-workflow',description:'镜头规划',instructions:'Read canvas before arranging shots.',operation_id:'skill-create-1',base_version:'0',files:[{path:'references/steps.md',content:'检查构图'}]};
 const {needsToolConfirmation}=await import('../src/features/agent-execution/trace.mjs');
 assert.equal(parse('skills_save',input).definition.mutates,true);assert.equal(needsToolConfirmation(parse('skills_save',input).definition,'auto'),true);assert.equal(needsToolConfirmation(parse('generation_submit',{nodeId:'a',kind:'image.generate',prompt:'x'}).definition,'auto'),false);
 const saved=await commitSkill(input,{storage,builtinNames:[]});assert.equal(saved.saved,true);assert.equal(saved.created,true);
 const skill=JSON.parse(values.get('tapnow-custom-skills'))[0];assert.equal(await skillVersion(skill),saved.version);assert.equal(skill.files[1].content,'检查构图');
 const retry=await commitSkill(Object.fromEntries(Object.entries(input).reverse()),{storage});assert.equal(retry.replayed,true);assert.equal(retry.currentMatches,true);assert.equal(JSON.parse(values.get('tapnow-custom-skills')).length,1);
 await assert.rejects(()=>commitSkill({...input,instructions:'different'},{storage}),error=>error.code==='operation_conflict');
 const update={...input,operation_id:'skill-update-1',base_version:saved.version,instructions:'Revised instructions'};delete update.files;
 const updated=await commitSkill(update,{storage});assert.notEqual(updated.version,saved.version);assert.equal(JSON.parse(values.get('tapnow-custom-skills'))[0].files.length,2);
 await assert.rejects(()=>commitSkill({...update,operation_id:'skill-stale-1'},{storage}),error=>error.code==='version_conflict');
 const manuallyEdited=JSON.parse(values.get('tapnow-custom-skills'));manuallyEdited[0].text='manual edit';values.set('tapnow-custom-skills',JSON.stringify(manuallyEdited));
 await assert.rejects(()=>commitSkill({...update,base_version:updated.version,operation_id:'skill-stale-2'},{storage}),error=>error.code==='version_conflict');
 values.set('tapnow-custom-skills','[]');const old=await commitSkill(input,{storage});assert.equal(old.currentMatches,false);assert.equal(old.currentVersion,null);assert.equal(values.get('tapnow-custom-skills'),'[]');
});
test('Agent skill commit rejects unsafe package paths and recovers a lost commit receipt without overwriting',async()=>{
 const {commitSkill}=await import('../src/features/agent-manager/skill-commit.mjs');const values=new Map();let receiptWrites=0,failReceipt=false;
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(key==='tapnow-skill-commits-v1'&&failReceipt&&++receiptWrites===2)throw Error('quota');values.set(key,value);},removeItem:key=>values.delete(key)};
 const input={name:'safe-workflow',description:'安全提交',instructions:'Read actual state.',operation_id:'safe-operation',base_version:'0'};
 for(const path of ['../secret.md','/private.md','references/%2e%2e/private.md','SKILL.md','scripts/run.js','references/./x.md'])await assert.rejects(()=>commitSkill({...input,files:[{path,content:'x'}]},{storage}),/路径/);
 await assert.rejects(()=>commitSkill(input,{storage,builtinNames:['safe-workflow']}),/内置/);assert.equal(values.size,0);
 failReceipt=true;await assert.rejects(()=>commitSkill(input,{storage}),/quota/);assert.equal(JSON.parse(values.get('tapnow-custom-skills')).length,1);
 failReceipt=false;const recovered=await commitSkill(input,{storage});assert.equal(recovered.replayed,true);assert.equal(JSON.parse(values.get('tapnow-skill-commits-v1'))[0].status,'committed');assert.equal(JSON.parse(values.get('tapnow-custom-skills')).length,1);
});
test('manual skill edits and imports share Agent commit locking and preserve unrelated concurrent records',async()=>{
 const {commitSkill,updatePersonalSkill,skillVersion}=await import('../src/features/agent-manager/skill-commit.mjs');
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const original={name:'manual-workflow',description:'manual',text:'original',custom:true};await updatePersonalSkill({skill:original},{storage});
 const edit={...original,text:'manual edit'},other={name:'import-workflow',description:'import',text:'references',custom:true};
 await Promise.all([updatePersonalSkill({skill:other},{storage}),commitSkill({name:original.name,description:original.description,instructions:'Agent revision',operation_id:'concurrent-edit',base_version:await skillVersion(original)},{storage})]);
 assert.equal(JSON.parse(values.get('tapnow-custom-skills')).length,2);
 await assert.rejects(()=>updatePersonalSkill({skill:edit,previous:original},{storage}),error=>error.code==='version_conflict');
 const latest=JSON.parse(values.get('tapnow-custom-skills')).find(item=>item.name===original.name);
 await updatePersonalSkill({skill:{...latest,name:'renamed-workflow'},previous:latest},{storage});
 assert.equal(JSON.parse(values.get('tapnow-custom-skills')).find(item=>item.name===other.name).text,other.text);
 await assert.rejects(()=>updatePersonalSkill({skill:other},{storage}),error=>error.code==='name_conflict');
 await assert.rejects(()=>updatePersonalSkill({skill:null,previous:original},{storage}),error=>error.code==='version_conflict');
 const renamed=JSON.parse(values.get('tapnow-custom-skills')).find(item=>item.name==='renamed-workflow');await updatePersonalSkill({skill:null,previous:renamed},{storage});assert.deepEqual(JSON.parse(values.get('tapnow-custom-skills')).map(item=>item.name),['import-workflow']);
});

test('media inspection transports decoded pixels transiently and rejects stale or missing canvas media',async()=>{
 const {inspectCanvasMedia,inspectionMedia,withInspectionMedia}=await import('../src/features/agent-vision/inspect.mjs');
 const nodes=[{id:'image',type:'image',title:'Frame',image:'asset:real'},{id:'video',type:'video',title:'Clip',video:'asset:clip'}];
 const prepared=[{name:'image',imageUrl:'jpeg-image'},{name:'video',imageUrl:'jpeg-frame',time:1.25}];
 const result=await inspectCanvasMedia(['image','video'],{getNodes:()=>nodes,resolveUrl:url=>url,prepare:async()=>prepared});
 assert.equal(result.visualInputCount,2);assert.equal(result.nodes[1].samples[0].time,1.25);assert.equal(inspectionMedia(result)[0].nodeId,'image');
 assert.equal(JSON.stringify(result).includes('jpeg-image'),false);assert.equal(withInspectionMedia({callId:'inspect',result}).mediaInputs[0].imageUrl,'jpeg-image');
 await assert.rejects(()=>inspectCanvasMedia(['missing'],{getNodes:()=>nodes}),/不存在/);
 await assert.rejects(()=>inspectCanvasMedia(['image','image'],{getNodes:()=>nodes}),/不同/);
 await assert.rejects(()=>inspectCanvasMedia(['image'],{getNodes:()=>nodes,prepare:async()=>{nodes[0].image='asset:changed';return prepared.slice(0,1);}}),/已变化/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>inspectCanvasMedia(['image'],{getNodes:()=>nodes,signal:controller.signal}),error=>error.name==='AbortError');
});
test('Responses tool continuation carries actual inspection images only for matching pending nodes and commits atomically',async()=>{
 const imageUrl='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,16]).toString('base64');
 const {agent,requests}=runtime([[call('canvas_read',{},'read'),call('canvas_inspect_media',{ids:['image']},'inspect')],[message('inspected')]]);
 const first=await agent.start({message:'检查拍摄画面'}),session=agent.sessions.get(first.sessionId),initialLength=session.input.length;
 const entry={callId:'inspect',result:{nodes:[{id:'image',type:'image'}]},mediaInputs:[{nodeId:'image',name:'image',imageUrl}]};
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'read',result:{}},{...entry,mediaInputs:[{nodeId:'wrong',name:'wrong',imageUrl}]}]),/不匹配/);
 assert.equal(session.input.length,initialLength);assert.equal(session.pending.length,2);
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'read',result:{},mediaInputs:entry.mediaInputs},entry]),/不接受/);
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'read',result:{}},{callId:'inspect',result:{nodes:[]}}]),/缺少实际画面/);
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'read',result:{}},{...entry,mediaInputs:[{nodeId:'image',name:'image',imageUrl:'https://example.invalid/x'}]}]),/格式/);
 const finished=await agent.resume(first.sessionId,[{callId:'read',result:{nodes:[]} },entry]);assert.equal(finished.done,true);
 const output=requests[1].input.find(item=>item.type==='function_call_output'&&item.call_id==='inspect');assert.equal(output.output[2].type,'input_image');assert.equal(output.output[2].image_url,imageUrl);assert.equal(output.output[2].detail,'auto');
});

test('multiple media inspections share one continuation budget and oversized server batches append nothing',async()=>{
 const {inspectCanvasMedia,withInspectionMedia}=await import('../src/features/agent-vision/inspect.mjs');
 const imageUrl='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(450000)]).toString('base64');
 const visualBudget={remaining:700000},nodes=[{id:'first',type:'image',image:'asset:first'},{id:'second',type:'image',image:'asset:second'}];
 const deps={getNodes:()=>nodes,resolveUrl:x=>x,visualBudget,prepare:async items=>items.map(item=>({name:item.name,imageUrl}))};
 const firstResult=await inspectCanvasMedia(['first'],deps);await assert.rejects(()=>inspectCanvasMedia(['second'],deps),error=>error.code==='visual_budget_exceeded');
 const {agent,requests}=runtime([[call('canvas_inspect_media',{ids:['first']},'first'),call('canvas_inspect_media',{ids:['second']},'second')],[message('first inspected; retry second')]]);
 const turn=await agent.start({message:'检查两张图'}),session=agent.sessions.get(turn.sessionId),before=session.input.length;
 const first=withInspectionMedia({callId:'first',result:firstResult}),second={callId:'second',result:{nodes:[{id:'second'}]},mediaInputs:[{name:'second',nodeId:'second',imageUrl}]};
 await assert.rejects(()=>agent.resume(turn.sessionId,[first,second]),/总量/);assert.equal(session.input.length,before);
 await agent.resume(turn.sessionId,[first,{callId:'second',result:{error:'本轮画面预算已用完，请下一轮继续查看。'}}]);assert.equal(requests.length,2);assert.ok(JSON.stringify({results:[first,{callId:'second',result:{error:'next round'}}]}).length<1000000);
 const fresh=await inspectCanvasMedia(['second'],{...deps,visualBudget:{remaining:700000}});assert.equal(fresh.visualInputCount,1);
});

const creativeQuestions={questions:[
 {question_id:'style',header:'风格',question:'选择画面风格',multiSelect:false,options:[{label:'写实',description:'自然光'},{label:'动画',description:'手绘线条'}]},
 {question_id:'keep',header:'元素',question:'保留哪些元素',multiSelect:true,options:[{label:'角色',description:''},{label:'街道',description:''}]}
]};
const creativeAnswers={answers:[{question_id:'style',selected_labels:['写实']},{question_id:'keep',selected_labels:['角色','街道'],free_text:'保留自行车'}]};
test('structured questions reject ambiguous IDs and validate complete user answers against the exact options',()=>{
 const {validateQuestionAnswers}=require('../agent-tools.js');
 assert.equal(parse('ask_question',creativeQuestions).definition.mutates,false);
 assert.deepEqual(validateQuestionAnswers(creativeQuestions,creativeAnswers),creativeAnswers);
 assert.throws(()=>parse('ask_question',{questions:[creativeQuestions.questions[0],creativeQuestions.questions[0]]}),/ID/);
 assert.throws(()=>parse('ask_question',{questions:[{...creativeQuestions.questions[0],options:[{label:'x',description:''},{label:'x',description:''}]}]}),/选项/);
 for(const result of [{answers:[]},{answers:[creativeAnswers.answers[0]]},{answers:[creativeAnswers.answers[0],creativeAnswers.answers[0]]},{answers:[{question_id:'other',selected_labels:['写实']},creativeAnswers.answers[1]]},{answers:[{question_id:'style',selected_labels:['未知']},creativeAnswers.answers[1]]},{answers:[{question_id:'style',selected_labels:['写实'],free_text:'动画'},creativeAnswers.answers[1]]},{answers:[{question_id:'style',free_text:' '},creativeAnswers.answers[1]]},{answers:[{question_id:'style',free_text:'x'.repeat(201)},creativeAnswers.answers[1]]},{...creativeAnswers,skipped:true}])assert.throws(()=>validateQuestionAnswers(creativeQuestions,result));
 assert.deepEqual(validateQuestionAnswers(creativeQuestions,{answers:[{question_id:'style',free_text:'  极简  '},creativeAnswers.answers[1]]}).answers[0],{question_id:'style',free_text:'极简'});
});
test('question trace waits for actual submission and cannot execute or settle from partial answers or a stale view',async()=>{
 const {createQuestionWaiter}=await import('../src/features/agent-question-runtime/waiter.mjs');
 const {executeTracedCall}=await import('../src/features/agent-execution/trace.mjs');
 const waiter=createQuestionWaiter({validate:require('../agent-tools.js').validateQuestionAnswers});let trace,finished=false,executions=0;
 const pending=executeTracedCall({name:'ask_question',args:creativeQuestions,callId:'question'},{runId:'run',requestInput:value=>waiter.wait(value),execute:()=>{executions++;},changed:value=>trace=value}).then(result=>{finished=true;return result;});
 assert.equal(trace.status,'waiting');assert.equal(waiter.current,trace);assert.equal(finished,false);
 assert.throws(()=>waiter.submit(trace,{answers:[creativeAnswers.answers[0]]}));assert.equal(waiter.current,trace);
 assert.throws(()=>waiter.submit({...trace},creativeAnswers),/已结束/);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(executions,0);
 waiter.submit(trace,creativeAnswers);const output=await pending;assert.equal(trace.status,'done');assert.equal(output.callId,'question');assert.deepEqual(output.result,creativeAnswers);assert.equal(waiter.current,null);
 assert.throws(()=>waiter.submit(trace,creativeAnswers),/已结束/);
});
test('question cancellation and refresh preserve unanswered meaning and never return approval',async()=>{
 const {createQuestionWaiter}=await import('../src/features/agent-question-runtime/waiter.mjs');
 const {executeTracedCall,recoverTraces}=await import('../src/features/agent-execution/trace.mjs');
 const waiter=createQuestionWaiter({validate:require('../agent-tools.js').validateQuestionAnswers}),controller=new AbortController();let trace;
 const pending=executeTracedCall({name:'ask_question',args:creativeQuestions,callId:'question'},{signal:controller.signal,requestInput:value=>waiter.wait(value,{signal:controller.signal}),changed:value=>trace=value});
 trace.questionDraft={step:1,answers:[creativeAnswers.answers[0],null]};const saved=structuredClone(trace);recoverTraces([saved]);assert.equal(saved.status,'interrupted');assert.match(saved.result.error,/未提交回答/);assert.equal(saved.result.answers,undefined);assert.deepEqual(saved.questionDraft,trace.questionDraft);
 const rejection=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejection;assert.equal(trace.status,'cancelled');assert.equal(trace.result.answers,undefined);assert.equal(waiter.current,null);assert.throws(()=>waiter.submit(trace,creativeAnswers),/已结束/);
});
test('SDK question barrier withholds sibling tools and resumes only complete answers bound to the real call ID',async()=>{
 const {agent,requests}=runtime([[call('canvas_add',{type:'text',title:'must wait',x:.125,y:.25},'early'),call('ask_question',creativeQuestions,'ask'),call('canvas_read',{},'read')],[message('已收到选择')]]);
 const first=await agent.start({message:'先确认风格再创建'}),session=agent.sessions.get(first.sessionId),before=session.input.length;
 assert.deepEqual(first.calls.map(call=>call.name),['ask_question']);assert.equal(requests.length,1);
 assert.match(session.input.find(item=>item.type==='function_call_output'&&item.call_id==='early').output,/未执行/);
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'ask',result:{answers:[creativeAnswers.answers[0]]}}]));
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'ask',result:{skipped:true}}]));
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'ask',result:{error:'未回答',...creativeAnswers}}]),/not allowed/);
 assert.equal(requests.length,1);assert.equal(session.input.length,before);assert.equal(session.pending[0].callId,'ask');
 const done=await agent.resume(first.sessionId,[{callId:'ask',result:creativeAnswers}]);assert.equal(done.done,true);assert.equal(requests.length,2);
 const output=requests[1].input.find(item=>item.type==='function_call_output'&&item.call_id==='ask');assert.deepEqual(JSON.parse(output.output),creativeAnswers);
 const invalid=runtime([[call('canvas_add',{type:'text',title:'must wait',x:0,y:0},'mutation'),call('ask_question',{questions:[]},'invalid')],[message('无法提交问题')]]);
 const error=await invalid.agent.start({message:'先确认'});assert.equal(error.done,true);assert.match(invalid.requests[1].input.find(item=>item.call_id==='mutation'&&item.type==='function_call_output').output,/未执行/);
});

const creativeForm={title:'制作参数',fields:[
 {id:'style',type:'radio',label:'风格',required:true,options:[{value:'film',label:'电影'}]},
 {id:'keep',type:'checkbox',label:'元素',min_select:1,max_select:2,options:[{value:'actor',label:'人物'},{value:'street',label:'街道'}]},
 {id:'model',type:'select',label:'模型',options:[{value:'a',label:'A'}]},
 {id:'brief',type:'text',label:'描述',max_length:12},
 {id:'score',type:'rating',label:'评分',max:5},
 {id:'speed',type:'slider',label:'速度',min:0,max:2,step:.25,unit:'x'},
 {id:'date',type:'date',label:'日期'},
 {id:'count',type:'number',label:'数量',min:1,max:9},
 {id:'image',type:'image_select',label:'参考图',options:[{value:'shot',label:'镜头',file_id:'actual-node'}]}
]};
async function creativeSubmission(callId='form'){
 const model=await import('../src/features/agent-forms/model.mjs');return model.formSubmission(model.normalizeForm({args:creativeForm}),{style:'film',keep:['actor'],model:'a',brief:' 光影 ',score:4,speed:.75,date:'2026-09-30',count:2,image:['shot']},callId);
}
test('nine-field forms bind real call IDs and canonicalize user values while rejecting forged and invalid answers',async()=>{
 const {validateFormSubmission:check}=require('../agent-tools.js'),answer=await creativeSubmission();const original=structuredClone(creativeForm);
 assert.equal(parse('show_form',creativeForm).definition.mutates,false);assert.deepEqual(check(creativeForm,answer,'form'),answer);
 assert.equal(check(creativeForm,{...answer,values:answer.values.map(value=>({...value,display:'forged'}))},'form').values[0].display,'电影 (film)');
 for(const [id,value] of [['style','unknown'],['style',null],['keep',['actor','actor']],['brief','x'.repeat(13)],['score',4.5],['speed',.3],['date','2026-02-30'],['count',10],['image',['missing']]])assert.throws(()=>check(creativeForm,{...answer,values:answer.values.map(item=>item.field_id===id?{...item,value}:item)},'form'));
 for(const value of [{...answer,tool_call_id:'forged'},{...answer,values:answer.values.slice(1)},{...answer,values:[...answer.values.slice(1),answer.values[1]]},{...answer,values:answer.values.map(item=>({...item,field_label:'forged'}))},{...answer,skipped:true},{...answer,approval:true}])assert.throws(()=>check(creativeForm,value,'form'));
 assert.throws(()=>check(creativeForm,{...answer,tool_call_id:undefined},undefined));
 assert.deepEqual(check(creativeForm,{...answer,skipped:true,values:[]},'form'),{tool_call_id:'form',form_title:creativeForm.title,values:[],skipped:true});assert.deepEqual(creativeForm,original);
 assert.throws(()=>parse('show_form',{...creativeForm,fields:[creativeForm.fields[0],creativeForm.fields[0]]}));
});
test('show_form completes as a display receipt and remains usable after refresh without a waiter',async()=>{
 const {executeTracedCall,recoverTraces}=await import('../src/features/agent-execution/trace.mjs');let trace,executed=0;
 const result=await executeTracedCall({name:'show_form',args:creativeForm,callId:'form'},{execute:(name,args)=>{executed++;return {form:args,awaiting_submission:true};},changed:value=>trace=value});
 assert.equal(trace.status,'done');assert.equal(executed,1);assert.deepEqual(result.result,{form:creativeForm,awaiting_submission:true});assert.equal(result.result.values,undefined);
 trace.formDraft={brief:'未提交'};const saved=structuredClone(trace);recoverTraces([saved]);assert.equal(saved.status,'done');assert.deepEqual(saved.formDraft,trace.formDraft);assert.equal(saved.result.awaiting_submission,true);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>executeTracedCall({name:'show_form',args:creativeForm,callId:'cancelled'},{signal:controller.signal,execute:()=>assert.fail(),changed:()=>assert.fail()}),{name:'AbortError'});
});
test('SDK form barrier blocks siblings and ends the run on a prepared receipt without model continuation',async()=>{
 const {agent,requests}=runtime([[call('canvas_add',{type:'text',title:'wait',x:.125,y:.25},'mutation'),call('show_form',creativeForm,'form')]]);
 const first=await agent.start({message:'先填写制作参数'}),session=agent.sessions.get(first.sessionId),before=session.input.length;assert.deepEqual(first.calls.map(item=>item.name),['show_form']);assert.match(session.input.find(item=>item.call_id==='mutation'&&item.type==='function_call_output').output,/未执行/);
 const answer=await creativeSubmission();for(const result of [answer,{form:creativeForm,awaiting_submission:false},{form:creativeForm,awaiting_submission:true,values:answer.values},{form:{...creativeForm,title:'changed'},awaiting_submission:true},{awaiting_submission:true}])await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'form',result}]));assert.equal(session.input.length,before);assert.equal(requests.length,1);
 const last=await agent.resume(first.sessionId,[{callId:'form',result:{form:creativeForm,awaiting_submission:true}}]);assert.equal(last.done,true);assert.deepEqual(last.calls,[]);assert.equal(requests.length,1);assert.equal(session.pending.length,0);assert.equal(session.done,true);
 await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'form',result:answer}]),/结束/);assert.match(requests[0].instructions,/skipped form is not approval/);
});
test('initial form submission, skip and revision each create a new user turn without replaying tool calls',async()=>{
 const {agent,requests}=runtime([[call('show_form',creativeForm,'form')],[message('收到原表单')],[message('收到修订')],[message('收到跳过')]]),answer=await creativeSubmission();
 const first=await agent.start({message:'填写参数'});await agent.resume(first.sessionId,[{callId:'form',result:{form:creativeForm,awaiting_submission:true}}]);const original=structuredClone(agent.sessions.get(first.sessionId).input);
 const second=await agent.start({message:'',formSubmission:{form:creativeForm,result:answer}});assert.notEqual(first.sessionId,second.sessionId);
 const revision={...answer,values:answer.values.map(item=>item.field_id==='score'?{...item,value:5,display:'5/5'}:item)};
 await agent.start({message:'修改评分',context:{long:'x'.repeat(70000)},formRevision:{form:creativeForm,result:revision}});
 await agent.start({message:'',formSubmission:{form:creativeForm,result:{...answer,skipped:true,values:[]}}});assert.deepEqual(agent.sessions.get(first.sessionId).input,original);
 for(const request of requests.slice(1)){assert.equal(request.input.some(item=>item.type==='function_call_output'),false);assert.match(request.input[0].content,/User-submitted form submission/);assert.equal(request.input[0].role,'user');}
 assert.ok(requests[2].input[0].content.includes('"value":5'));assert.ok(requests[3].input[0].content.includes('"skipped":true'));
 await assert.rejects(()=>agent.start({message:'错误修订',formSubmission:{form:creativeForm,result:{...revision,tool_call_id:''}}}));await assert.rejects(()=>agent.start({message:'',formSubmission:{form:creativeForm,result:answer},formRevision:{form:creativeForm,result:answer}}));assert.equal(requests.length,4);
});

test('scene keyframe pose contract preserves radians and rejects ambiguous animation indices',()=>{
 const input={entityId:'camera',time:1.5,pose:{position:[1,2,3],rotation:[0,Math.PI/2,0],scale:[1,1,1]},space:'world',animationIndex:2};
 assert.deepEqual(parse('scene_keyframe',input).args,input);assert.equal(parse('scene_keyframe',{time:0}).definition.mutates,true);
 for(const invalid of [{...input,animationIndex:.5},{...input,animationIndex:-1},{...input,space:'screen'},{...input,pose:{rotation:[0,NaN,0]}},{...input,pose:{scale:[0,1,1]}},{...input,pose:{execute:'script'}}])assert.throws(()=>parse('scene_keyframe',invalid));
});

test('draft-to-final tool accepts only live node identities and keeps ordinary generation contracts intact',async()=>{
 const input={kind:'video.generate',draftSourceId:'draft'},withTarget={...input,nodeId:'final'};
 assert.deepEqual(parse('generation_submit',input).args,input);assert.deepEqual(parse('generation_submit',withTarget).args,withTarget);
 for(const invalid of [{...input,prompt:''},{...input,model:'Seedance 2.5'},{...input,resolution:'1080p'},{...input,referenceIds:['draft']},{...input,draftVideoId:'forged-provider-id'},{...input,kind:'image.generate'},{...input,nodeId:'draft'},{kind:'video.generate',nodeId:'target'},{kind:'video.generate',prompt:'missing target'}])assert.throws(()=>parse('generation_submit',invalid));
 assert.equal(parse('generation_submit',{kind:'video.generate',nodeId:'target',prompt:'normal'}).definition.mutates,true);
 const {agent}=runtime([[call('generation_submit',input,'draft-final')]]);assert.equal((await agent.start({message:'生成这张样片的正式片'})).calls[0].args.prompt,undefined);
});
test('draft-final confirmation validates source version and sole draft edge without allowing prompt or authority edits',async()=>{
 const {createGenerationDraft,confirmedArguments}=await import('../src/features/agent-generation/model.mjs');
 const source={id:'draft',type:'video',title:'样片',video:'asset:video',currentSourceFileId:'real-file',generation:{model:'Seedance 2.5 Draft',duration:5,draftEstimateMedia:{images:['asset:ref']}}},target={id:'final',type:'video',generation:{model:'Seedance 2.5',draftVideoId:'real-file'}},nodes=[source,target];
 const original={kind:'video.generate',draftSourceId:'draft'},draft=createGenerationDraft(original,{},nodes);assert.deepEqual(confirmedArguments(original,draft,nodes),original);assert.equal(draft.prompt,undefined);
 for(const patch of [{draftSourceId:'other'},{nodeId:'final'},{model:'other'},{prompt:'override inherited brief'}])assert.throws(()=>confirmedArguments(original,{...draft,...patch},nodes));
 source.currentSourceFileId='new-history-version';assert.throws(()=>confirmedArguments(original,draft,nodes),/已变化/);source.currentSourceFileId='real-file';source.generation.draftEstimateMedia.images.push('asset:new');assert.throws(()=>confirmedArguments(original,draft,nodes),/已变化/);source.generation.draftEstimateMedia.images.pop();
 const update={...original,nodeId:'final'},updateDraft=createGenerationDraft(update,{},nodes),edge={id:'ref',source:'draft',target:'final',purpose:'draft-reference'};assert.deepEqual(confirmedArguments(update,updateDraft,nodes,[edge]),update);
 for(const edges of [[],[{...edge,purpose:'generation-input'}],[edge,{id:'extra',source:'other',target:'final'}]])assert.throws(()=>confirmedArguments(update,updateDraft,nodes,edges));
 assert.throws(()=>confirmedArguments(original,draft,[target]));source.video=null;assert.throws(()=>confirmedArguments(original,draft,nodes));
});
test('draft-final operations remain separate from batch execution and discovery exposes no provider file identity',async()=>{
 const {groupGenerationCalls,executeGenerationBatch}=await import('../src/features/agent-generation/batch.mjs'),{draftSummary}=await import('../src/features/agent-generation/draft-final.mjs');
 const source={id:'draft',type:'video',video:'asset:private-video',currentSourceFileId:'provider-private-file',generation:{model:'Seedance 2.5 Draft',prompt:'private inherited prompt'}};
 const summary=draftSummary(source);assert.deepEqual(summary,{isDraft:true,isFinal:false,hasResult:true,model:'Seedance 2.5 Draft'});assert.ok(!JSON.stringify(summary).includes('private'));
 assert.equal(draftSummary({...source,currentSourceFileId:null}).hasResult,false);assert.equal(draftSummary({...source,generation:{model:'Seedance 2.5',draftVideoId:'actual'}}).isFinal,true);assert.equal(draftSummary({type:'image'}),undefined);
 const draft=id=>({name:'generation_submit',callId:id,args:{kind:'video.generate',draftSourceId:'draft',nodeId:id}}),normal=id=>({name:'generation_submit',callId:id,args:{kind:'video.generate',nodeId:id,prompt:'normal'}});
 assert.deepEqual(groupGenerationCalls([normal('a'),draft('b'),draft('c'),normal('d')],{nodes:[source]}).map(group=>group.length),[1,1,1,1]);await assert.rejects(()=>executeGenerationBatch([draft('b'),draft('c')],{execute:()=>assert.fail(),changed:()=>{}}),/批量/);
});
