const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const uri=name=>'ui://tapnow/'+name+'@v1';
const source=fs.readFileSync('src/features/agent-apps/resources/apps/creative-picker@v1.2a07bc2e.html','utf8');
test('Creative strict family and active recommendations agree at real tool parse and registry boundaries',async()=>{
 const {prepareApp}=await import('../src/features/agent-apps/registry.mjs'),{parse}=require('../agent-tools.js');
 for(const family of ['website','art','hardware']){const args={resource_uri:uri('creative-picker'),family};assert.deepEqual(prepareApp(parse('show_app',args).args).response,{original_request:'',family});assert.equal(prepareApp(args).response.recommended_template_id,undefined);}
 for(const args of [{resource_uri:uri('creative-picker'),family:'all'},{resource_uri:uri('creative-picker'),family:'art',recommended_template_id:'H01'},{resource_uri:uri('creative-picker'),family:'hardware',recommended_template_id:'A17'},{resource_uri:uri('creative-picker'),recommended_template_id:'A05'},...['motion-picker','website-design-picker','library-picker','director-markup'].map(name=>({resource_uri:uri(name),family:'website'}))]){assert.throws(()=>parse('show_app',args));assert.throws(()=>prepareApp(args));}
 for(const recommended_template_id of ['A01','A17','H01','H08'])assert.equal(prepareApp(parse('show_app',{resource_uri:uri('creative-picker'),recommended_template_id}).args).response.recommended_template_id,recommended_template_id);
 assert.equal(prepareApp({resource_uri:uri('website-design-picker')}).response.family,'website');
});
test('preserved official adapter gives saved state priority, family without preselection, and real retired/list behavior',()=>{
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'2a07bc2e7e3874c49f012f1022cbf838939bf8ea502ca33af31b277986dadcc9');
 const code=source.match(/ze\.ontoolresult=e=>\{.*?\};ze\.onhostcontextchanged/s)[0].replace(/;ze\.onhostcontextchanged$/,'');
 const restored=[],scope={ze:{},le:{restoreState:v=>restored.push(JSON.parse(JSON.stringify(v))),setStateHandler(){},setConversationBusy(){}},Wv(){}};vm.runInNewContext(code,scope);
 for(const family of ['art','hardware']){scope.ze.ontoolresult({structuredContent:{family}});assert.deepEqual(restored.at(-1),{version:1,mode:family});}
 const saved={version:1,mode:'hardware',selectedId:'H08',drafts:{}};scope.ze.ontoolresult({structuredContent:{family:'art',recommended_template_id:'A01'},_meta:{'tapnow/widgetState':saved}});assert.deepEqual(restored.at(-1),saved);
 assert.match(source,/state\.selectedId==null\|\|byId\.get\(state\.selectedId\)\?\.retired\?null/);assert.match(source,/const list=items\.filter\(x=>!x\.retired&&x\.family===mode/);
});
test('manager local launch uses official labels and no preselection, persists once, reuses card, rejects busy/save failure/switch',async()=>{
 const {managerPickerArgs,launchManagerPicker}=await import('../src/features/agent-manager/picker-launch.mjs');
 for(const [id,family]of [['creative-generative-art','art'],['creative-hardware-mg','hardware'],['website-design',undefined]]){const args=managerPickerArgs(id,'原需求');assert.equal(args.family,family);assert.equal(args.recommended_template_id,undefined);assert.ok(args.title);}
 const chat={messages:[]};let context={chat,panelActive:true,running:false,pageLeaving:false},writes=0,count=0;const options={id:'creative-generative-art',getContext:()=>context,persist:async()=>{writes++;},uuid:()=>`launch_${++count}`};
 const trace=await launchManagerPicker(options);assert.equal(trace.role,'tool');assert.equal(trace.result.response.family,'art');assert.equal(chat.messages.length,1);assert.equal(writes,1);assert.equal(await launchManagerPicker(options),trace);assert.equal(chat.messages.length,1);
 for(const key of ['running','pageLeaving']){context={...context,[key]:true};await assert.rejects(()=>launchManagerPicker(options));context={...context,[key]:false};}
 await assert.rejects(()=>launchManagerPicker({...options,id:'creative-hardware-mg',persist:async()=>false}));assert.equal(chat.messages.length,1);
 await assert.rejects(()=>launchManagerPicker({...options,id:'creative-hardware-mg',persist:async()=>{context={...context,chat:{messages:[]}};}}));assert.equal(chat.messages.length,1);
 assert.equal(await launchManagerPicker({...options,id:'brainstorm'}),null);
});
function sample(id){const family=id[0]==='A'?'art':'hardware',parameters={title:'实际修改',subtitle:'用户描述',accent:'#abcdef',intensity:.4,seed:21},initial_state={dragX:.3,dragY:-.2,progress:.42};const selection={schema_version:1,library_version:'1.1.0',catalog_sha256:'10421d5dedd820104b167d60af250e2a6657365226b0bc7a456f5daffea56781',locale:'zh_CN',skill:family==='art'?'creative-generative-art':'creative-hardware-mg',family,template_id:id,template_name:'模板',parameters,output:{kind:'animation-html',width:1200,height:675,fps:60,duration:12},user_request:'我的需求',initial_state};return{selection,state:{version:1,mode:family,selectedId:id,drafts:{[id]:{parameters,request:selection.user_request}},inputs:{[id]:initial_state},pending:{id:'creative_handoff_001',accepted:false,signature:JSON.stringify(selection)}}};}
test('new Creative handoffs bind actual saved spec, exact official prompt/catalog/ref and pending ID; invalid drafts/ref/retired reject',async()=>{
 const {resolveCreativePickerReply,creativeSelectionPrompt}=await import('../src/features/agent-apps/creative-picker.mjs'),{creativeTemplateReferences}=await import('../src/features/agent-apps/creative-template-references.mjs');
 const original=JSON.parse(source.match(/window.TemplateReferences=(\{.*?\});/s)[1]);assert.deepEqual(creativeTemplateReferences,original);
 const official=source.match(/function Vv\(e,n,r,o\)\{.*?\}function Kv/s)[0].replace(/function Kv$/,'');const scope={window:{TemplateReferences:original}};vm.runInNewContext(official,scope);
 for(const id of ['A01','A17','H01','H08']){const {selection,state}=sample(id),spec={...selection,template_ref:original[id]},text=scope.Vv('tapnow-creative',selection,state.pending.id,'原需求'),meta={hidden:true,handoffId:state.pending.id};assert.equal(text,creativeSelectionPrompt(spec,state.pending.id,'原需求'));assert.equal(resolveCreativePickerReply(text,{original_request:'原需求',family:'website'},state,meta).text,text,'old state wins over newly supplied family');
 for(const change of [s=>s.pending.accepted=true,s=>s.selectedId='A05',s=>s.drafts[id].parameters.title='changed',s=>s.inputs[id].dragX=0,s=>s.pending.id='other_id']){const next=structuredClone(state);change(next);assert.throws(()=>resolveCreativePickerReply(text,{original_request:'原需求'},next,meta));}
 for(const invalid of [text+'extra',text.replace(original[id].sha256,'a'.repeat(64)),text.replace('awaiting-content','generate-now')])assert.throws(()=>resolveCreativePickerReply(invalid,{original_request:'原需求'},state,meta));assert.throws(()=>resolveCreativePickerReply(text,{original_request:'原需求'},state,{...meta,hidden:false}));assert.throws(()=>resolveCreativePickerReply(text,{original_request:'原需求'},state,meta,uri('website-design-picker')));
 }
 const retired=sample('A05');assert.throws(()=>resolveCreativePickerReply('x',{},retired.state,{hidden:true,handoffId:retired.state.pending.id}));
});

test('official host locale overwrites signature locale without changing its saved identity',async()=>{
 const {resolveCreativePickerReply,creativeSelectionPrompt}=await import('../src/features/agent-apps/creative-picker.mjs'),{creativeTemplateReferences}=await import('../src/features/agent-apps/creative-template-references.mjs');const {selection,state}=sample('A01');selection.locale='en_US';state.pending.signature=JSON.stringify(selection);
 const text=creativeSelectionPrompt({...selection,locale:'zh_CN',template_ref:creativeTemplateReferences.A01},state.pending.id,'');assert.equal(resolveCreativePickerReply(text,{},state,{hidden:true,handoffId:state.pending.id}).text,text);
});

test('captured manager conversation rejects switches before launch and compensates an already saved trace',async()=>{
 const {launchManagerPicker}=await import('../src/features/agent-manager/picker-launch.mjs');const first={messages:[]},other={messages:[]};let context={chat:other,panelActive:true,running:false,pageLeaving:false},persisted=[];
 await assert.rejects(()=>launchManagerPicker({id:'creative-generative-art',expectedChat:first,getContext:()=>context,persist:async()=>{assert.fail('switched source may not save');}}));assert.equal(other.messages.length,0);
 context={...context,chat:first};let writes=0;await assert.rejects(()=>launchManagerPicker({id:'creative-generative-art',expectedChat:first,getContext:()=>context,persist:async()=>{persisted=structuredClone(first.messages);if(++writes===1)context={...context,chat:other};}}));assert.equal(first.messages.length,0);assert.equal(persisted.length,0);assert.equal(writes,2);
});

test('actual manager onApp callback guards composer/app loading switches and syncs failed reference rollback',async()=>{
 const picker=await import('../src/features/agent-manager/picker-launch.mjs'),client=fs.readFileSync('agent-client.js','utf8'),start=client.indexOf("onApp:async(item,text='')=>",client.indexOf('async function manage(')),end=client.indexOf('});}',start),callback=client.slice(start+6,end).replace("await import('./src/features/agent-manager/picker-launch.mjs')",'picker');
 function fixture(){const chats=[{id:'a',messages:[],doc:{text:'prior'}},{id:'b',messages:[],doc:{text:'other'}}];let index=0,live=chats[0].doc.text,fail=false,persisted;const scope={picker,composerReady:Promise.resolve(),appCardsReady:Promise.resolve(),pageLeaving:false,panel:{},busy:false,queueRunner:{running:false},draft:()=>chats[index],open(){},render(){live=chats[index].doc.text;},save(){persisted=structuredClone(chats);return !fail;},async flushConversation(){},composerModule:{documentForDraft:d=>structuredClone(d.doc),applyComposerSnapshot(d,{doc}){d.doc=structuredClone(doc);},insertSessionReference(id,ref,text){const d=chats.find(x=>x.id===id);d.doc={text:d.doc.text+'@'+ref.id+' '+text};live=d.doc.text;scope.save();}}};const invoke=vm.runInNewContext('('+callback+')',scope);return{scope,chats,invoke,switch(){index=1;live=chats[1].doc.text;},fail(){fail=true;},editor:()=>live,persisted:()=>persisted};}
 for(const dependency of ['composerReady','appCardsReady']){let release;const f=fixture();f.scope[dependency]=new Promise(resolve=>release=resolve);const work=f.invoke({id:'creative-generative-art'},'request');await new Promise(setImmediate);f.switch();release();await assert.rejects(()=>work);assert.equal(f.chats[0].doc.text,'prior');assert.equal(f.chats[1].doc.text,'other');assert.equal(f.chats[0].messages.length+f.chats[1].messages.length,0);}
 const f=fixture();f.fail();await assert.rejects(()=>f.invoke({id:'creative-generative-art'},'request'));assert.equal(f.chats[0].doc.text,'prior');assert.equal(f.editor(),'prior');assert.equal(f.persisted()[0].doc.text,'prior');assert.equal(f.persisted()[0].messages.length,0);
});

test('manager reuse keeps original request identity; a different request opens a fresh unselected family',async()=>{
 const {launchManagerPicker}=await import('../src/features/agent-manager/picker-launch.mjs');const chat={messages:[]},options={id:'creative-generative-art',getContext:()=>({chat,panelActive:true}),persist:async()=>true};
 const first=await launchManagerPicker({...options,text:'需求一'}),second=await launchManagerPicker({...options,text:'需求二'});assert.notEqual(first,second);assert.equal(chat.messages.length,2);assert.equal(second.result.response.original_request,'需求二');assert.equal(second.result.response.recommended_template_id,undefined);assert.equal(await launchManagerPicker({...options,text:'需求二'}),second);
});
