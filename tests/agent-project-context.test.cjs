const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {resolve,createOperations,createConversations}=require('../project-context.js');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const client=fs.readFileSync(require.resolve('../agent-client.js'),'utf8').replace(/import\(([^\n]*?)\)/g,'__import($1)');
function page(id,storage,{records=new Map(),quota=false,failRecord=false,readRecord}={}){
 let guard,sequence=0,loadedState,conversationPersistence;const events=new Map();
 const node={id:'target',title:'原节点'};
 const window={CanvasApp:{getState:()=>({nodes:[node]}),updateNode:(id,patch)=>Object.assign(node,patch)},
  CanvasProjects:{id:()=>id,registerNavigationGuard:fn=>{guard=fn;}},CanvasProjectContext:{resolve:options=>resolve({projects:window.CanvasProjects,...options}),createOperations,createConversations:options=>{const persistence=createConversations(options),baseline=persistence.baseline;persistence.baseline=(chats,activeId)=>{loadedState=structuredClone({chats,activeId});baseline(chats,activeId);};conversationPersistence=persistence;return persistence;}},
  CanvasStore:{readRecord:readRecord||(async key=>records.get(key)),writeRecord:async(key,value)=>{if(failRecord)throw Error('IDB quota');records.set(key,structuredClone(value));}},
  AgentTools:require('../agent-tools.js'),addEventListener:(name,fn)=>events.set(name,fn)};
 const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(quota)throw Error('localStorage quota');storage.set(key,value);}};
 // Conversation hydration now depends on the real recovery modules. Keep
 // unrelated presentation modules idle while exercising actual persistence.
 const loadModule=specifier=>specifier.startsWith('./src/features/agent-recovery/')?import(pathToFileURL(path.resolve(__dirname,'..',specifier)).href):new Promise(()=>{});
 vm.runInNewContext(client,{window,localStorage,document:{querySelector:()=>null,createElement:()=>({}),head:{append(){}}},structuredClone,crypto:{randomUUID:()=>id+'-chat-'+(++sequence)},__import:loadModule,clearTimeout,setTimeout});
 return {window,guard:()=>guard(),node,events,get loadedState(){return loadedState;},records,get persistence(){return conversationPersistence;}};
}
test('default project retains legacy chat and queue keys; new project does not load or overwrite them',async()=>{
 const chat={id:'legacy-chat',title:'旧画布讨论',text:'保留草稿',messages:[{role:'user',text:'旧决定'}],queuedMessages:[{id:'old-queue',text:'已暂停任务'}]};
 const storage=new Map([['tapnow-agent-chats',JSON.stringify([chat])],['tapnow-agent-active-chat',chat.id]]);
 const legacy=page('canvas',storage);assert.equal(await legacy.guard(),null);
 const preserved=storage.get('tapnow-agent-chats');
 const fresh=page('new-project',storage);assert.equal(await fresh.guard(),null);
 const freshChats=fresh.loadedState.chats;
 assert.equal(freshChats.length,1);assert.equal(freshChats[0].text,'');assert.deepEqual(freshChats[0].messages,[]);assert.deepEqual(freshChats[0].queuedMessages,[]);
 assert.equal(storage.get('tapnow-agent-chats'),preserved);assert.equal(storage.get('tapnow-agent-active-chat'),chat.id);
 assert.equal(fresh.loadedState.activeId,freshChats[0].id);
 const restored=page('canvas',storage);assert.equal(await restored.guard(),null);assert.equal(JSON.parse(storage.get('tapnow-agent-chats'))[0].text,chat.text);
});
test('in-flight direct Agent tools block navigation without cancelling the write',async()=>{
 const storage=new Map(),host=page('new-project',storage);
 const write=host.window.AgentUI.execute('canvas_update',{id:'target',patch:{title:'已写入'}});
 assert.match(await host.guard(),/正在保存/);
 await write;assert.equal(host.node.title,'已写入');assert.equal(await host.guard(),null);
});
test('artifact namespaces and delayed writes retain the identity captured at page startup',async()=>{
 let id='canvas';const projects={id:()=>id},legacy=resolve({projects,baseNamespace:'custom-db'});
 id='project-b';const fresh=resolve({projects,baseNamespace:'custom-db'});
 assert.equal(legacy.namespace,'custom-db');assert.equal(legacy.storageKey('tapnow-agent-chats'),'tapnow-agent-chats');
 assert.equal(fresh.namespace,'custom-db:project:project-b');assert.equal(fresh.storageKey('studio-composer-sent:scene'),'studio-composer-sent:scene:project:project-b');
 id='project-c';assert.equal(fresh.namespace,'custom-db:project:project-b');
 const operations=createOperations();let finish;const write=operations.track(()=>new Promise(done=>{finish=done;}));
 assert.equal(operations.pending,1);assert.match(operations.guard(),/正在保存/);assert.match(operations.guard({busy:true}),/正在执行/);
 finish('saved');assert.equal(await write,'saved');assert.equal(operations.guard(),null);
 await assert.rejects(operations.track(()=>{throw Error('save failed');}),/save failed/);assert.equal(operations.pending,0);
});
test('full localStorage retains untouched legacy conversations and persists new project drafts in IndexedDB',async()=>{
 const raw=JSON.stringify([{id:'legacy',text:'保留旧草稿',messages:[],queuedMessages:[]}]),storage=new Map([['tapnow-agent-chats',raw],['tapnow-agent-active-chat','legacy']]),records=new Map();
 const old=page('canvas',storage,{quota:true,records});assert.equal(await old.guard(),null);assert.equal(storage.get('tapnow-agent-chats'),raw);
 const project=resolve({projects:{id:()=> 'fresh'}}),store={readRecord:async key=>records.get(key),writeRecord:async(key,value)=>records.set(key,structuredClone(value))};
 const persistence=createConversations({project,store,storage:{setItem(){throw Error('localStorage quota');}}});
 const chats=[{id:'fresh-chat',text:'新画布草稿',messages:[],queuedMessages:[]}];assert.equal(persistence.save(chats,'fresh-chat'),true);assert.equal(persistence.pending,1);
 chats[0].text='新画布第二次修改';assert.equal(persistence.save(chats,'fresh-chat'),true);await persistence.flush();
 assert.equal(records.get('agent-conversations:fresh').chats[0].text,chats[0].text);assert.equal(records.has('agent-conversations:canvas'),false);assert.equal(storage.get('tapnow-agent-chats'),raw);
 const restored=page('fresh',storage,{quota:true,records});assert.equal(await restored.guard(),null);assert.equal(restored.loadedState.chats[0].text,chats[0].text);
});
test('failed IndexedDB persistence remains unsaved until an identical snapshot succeeds on retry',async()=>{
 const project=resolve({projects:{id:()=> 'fresh'}});let failing=true,value;
 const persistence=createConversations({project,storage:{setItem(){throw Error('quota');}},store:{writeRecord:async(key,snapshot)=>{if(failing)throw Error('IndexedDB failed');value=snapshot;}}});
 const chats=[{id:'chat',text:'不能丢失',messages:[]}];assert.equal(persistence.save(chats,'chat'),true);await assert.rejects(persistence.flush(),/IndexedDB failed/);
 failing=false;assert.equal(persistence.save(chats,'chat'),true);await persistence.flush();assert.equal(value.chats[0].text,'不能丢失');
});
test('leaving during slow conversation hydration cannot overwrite a newer IndexedDB draft with startup localStorage',async()=>{
 let loaded;const records=new Map(),storage=new Map([['tapnow-agent-chats',JSON.stringify([{id:'stale',text:'旧镜像',messages:[]}])]]);
 const latest={chats:[{id:'latest',text:'IndexedDB最新草稿',messages:[],queuedMessages:[]}],activeId:'latest'};
 const host=page('canvas',storage,{records,readRecord:()=>new Promise(done=>{loaded=done;})});
 assert.throws(()=>host.window.AgentUI.attachNodes(['other-project-node']),/仍在加载/);
 host.events.get('pagehide')();await Promise.resolve();assert.equal(records.size,0);
 loaded(latest);assert.equal(await host.guard(),null);assert.equal(host.loadedState.chats[0].text,latest.chats[0].text);assert.equal(records.size,0);
});
test('a conflicting IndexedDB conversation write never changes the old localStorage mirror',async()=>{
 const storage=new Map([['tapnow-agent-chats:project:same',JSON.stringify([{id:'newer',text:'另一窗口的历史'}])]]),before=storage.get('tapnow-agent-chats:project:same');
 const project=resolve({projects:{id:()=> 'same'}}),persistence=createConversations({project,storage:{setItem:(key,value)=>storage.set(key,value)},store:{writeRecord:async()=>{throw Object.assign(Error('另一窗口已更新此会话'),{name:'AgentConversationConflictError'});}}});
 persistence.save([{id:'stale',text:'本页尚未保存的草稿'}],'stale');await assert.rejects(persistence.flush(),{name:'AgentConversationConflictError'});
 assert.equal(storage.get('tapnow-agent-chats:project:same'),before);
});
test('native reload prompts while a captured conversation snapshot has not committed',async()=>{
 const host=page('fresh',new Map());await host.guard();
 host.persistence.save([{id:'draft',text:'正在保存的新草稿',messages:[]}],'draft');let prevented=false;
 const event={preventDefault(){prevented=true;}};host.events.get('beforeunload')(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
 await host.persistence.flush();prevented=false;host.events.get('beforeunload')({preventDefault(){prevented=true;}});assert.equal(prevented,false);
});
test('IndexedDB conversation saves never mirror growing history into legacy localStorage',async()=>{
 const project=resolve({projects:{id:()=> 'canvas'}}),legacy='[{"id":"legacy","text":"old snapshot"}]',storage=new Map([['tapnow-agent-chats',legacy],['tapnow-agent-active-chat','legacy']]);
 let writes=0,snapshot;
 const persistence=createConversations({project,storage:{setItem(){writes++;throw Error('must remain read-only');}},store:{writeRecord:async(key,value)=>{assert.equal(key,'agent-conversations:canvas');snapshot=structuredClone(value);}}});
 persistence.save([{id:'chat',text:'x'.repeat(6*1024*1024),messages:[]}],'chat');await persistence.flush();
 assert.equal(snapshot.chats[0].text.length,6*1024*1024);assert.equal(writes,0);assert.equal(storage.get('tapnow-agent-chats'),legacy);assert.equal(storage.get('tapnow-agent-active-chat'),'legacy');
});
test('conversation persistence retains a strict localStorage fallback when no IndexedDB adapter exists',async()=>{
 const storage=new Map(),project=resolve({projects:{id:()=> 'fallback'}}),persistence=createConversations({project,storage:{setItem:(key,value)=>storage.set(key,value)}});
 assert.equal(persistence.save([{id:'chat',text:'fallback',messages:[]}],'chat'),true);await persistence.flush();
 assert.equal(JSON.parse(storage.get('tapnow-agent-chats:project:fallback'))[0].text,'fallback');
 const broken=createConversations({project,storage:{setItem(){throw Error('quota');}}});assert.equal(broken.save([{id:'chat',text:'unsaved'}],'chat'),false);await assert.rejects(broken.flush(),/quota/);
});
