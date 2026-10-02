const {test} = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/features/agent-apps/library-picker.mjs');
const folder = {folder_id:'private:test',scope:'private',name:'测试',path:'测试',asset_count:1};
const item = {asset_id:'a1',type:'image',name:'  小猫  图片  ',source_url:'library://private/a1'};
const data = {folders:[folder],assets:[item]};
test('official private input, exact state and tool type restrictions',async()=>{
 const m=await load(),r=m.prepareLibraryPicker({...data,applied:{types:['image']}});
 assert.deepEqual(m.initialLibraryPickerState(r),{scope:'private',query:'',folder:null,picked_asset_id:null});
 assert.deepEqual(m.validateLibraryPickerFindRequest({scope:'private',folder_id:folder.folder_id,types:['image']},r),{scope:'private',folder_id:folder.folder_id,types:['image']});
 for(const bad of [{...data,folders:[]},{...data,folders:[{...folder,scope:'team'}]},{...data,assets:[{...item,source_url:'https://evil.test/image.png'}]},{...data,tools:['anything']}])assert.throws(()=>m.prepareLibraryPicker(bad));
 for(const bad of [{scope:'team',query:'猫',types:['image']},{scope:'private',query:'猫'},{scope:'private',folder_id:folder.folder_id,query:'猫',types:['image']},{scope:'private',query:' 猫',types:['image']}])assert.throws(()=>m.validateLibraryPickerFindRequest(bad,r));
 const state={scope:'private',query:'',folder,picked_asset_id:'a1'};assert.deepEqual(m.validateLibraryPickerState(state,r),state);
 assert.throws(()=>m.validateLibraryPickerState({...state,folder:{...folder,path:'fake'}},r));
 assert.throws(()=>m.validateLibraryPickerState({...state,picked_asset_id:'missing'},r));
});
test('official model reference and message must match actual visible asset',async()=>{
 const m=await load(),r=m.prepareLibraryPicker(data),s=m.initialLibraryPickerState(r);
 const c=m.libraryPickerModelContext(item);assert.equal(c,'用户引用了素材库素材 "小猫 图片"（asset_id=a1, type=image, url=library://private/a1）');
 assert.deepEqual(m.resolveLibraryPickerContext({content:[{type:'text',text:c}]},r),item);
 const out=await m.resolveLibraryPickerReply('【素材：小猫 图片】请描述构图',r,s,item);assert.equal(out.result.question,'请描述构图');assert.match(out.metadata.handoffId,/^library_[0-9a-f]{64}$/);
 assert.equal((await m.resolveLibraryPickerReply('I picked "小猫 图片" from my library.',r,s,item,[item],'en-US')).kind,'reference');
 for(const msg of ['【素材：其他】请描述','【素材：小猫 图片】 两个  空格','【素材：小猫 图片】','I picked "小猫 图片" from my library.'])await assert.rejects(m.resolveLibraryPickerReply(msg,r,s,item));
 assert.throws(()=>m.resolveLibraryPickerContext({content:[{type:'text',text:c+' extra'}]},r));
 assert.throws(()=>m.validateLibraryPickerCanvasRequest({asset:{media_type:'image',source_url:'https://evil.test/x',name:item.name}},r));
 assert.deepEqual(m.validateLibraryPickerCanvasRequest({asset:{media_type:'image',source_url:item.source_url,name:item.name}},r),item);
 const a={asset_id:'audio',type:'audio',name:'声音',source_url:'library://private/audio'};assert.throws(()=>m.validateLibraryPickerCanvasRequest({asset:{media_type:'image',source_url:a.source_url,name:a.name}},m.prepareLibraryPicker({...data,assets:[a]})));
});
async function fixture({save=async()=>true,persistConversation=async()=>true}={}){
 const m=await load(),{createLibraryPickerRuntime}=await import('../src/features/agent-apps/library-picker-runtime.mjs');
 const library={items:[{id:'a1',name:'小猫',type:'image',folder:'测试',image:'data:image/png;base64,aGk='},{id:'team',name:'团队',scope:'team',type:'image',image:'data:image/png;base64,aGk='}],folders:['测试']};
 const nodes=[],app={getState:()=>({nodes}),insertAsset:asset=>{const n={...asset,id:'created-'+(nodes.length+1),title:asset.name};nodes.push(n);return n;}};let live=true,project='p1';
 const runtime=createLibraryPickerRuntime({library,app,store:{save},getProjectId:()=>project,persistConversation});
 const args=await runtime.prepareAppArgs({resource_uri:m.libraryPickerUri,data:{},title:'库'},{isCurrent:()=>live});
 const response=m.prepareLibraryPicker(args.data,args.title),trace={id:'t1',result:runtime.bindPreparedResult({response},args)};trace.appState=m.initialLibraryPickerState(response);
 const ctx=runtime.capture(response,{trace,chat:{id:'c1'},isCurrent:()=>live});
 return {m,runtime,args,response,trace,ctx,library,nodes,setLive:v=>live=v,setProject:v=>project=v};
}
test('runtime reads real private library, binds context and commits actual node',async()=>{
 let saves=0,conversations=0;const f=await fixture({save:async()=>{saves++;return true;},persistConversation:async()=>{conversations++;return true;}}),folder=f.response.folders.find(x=>x.path==='测试');
 assert.equal(f.response.assets.length,0);const found=await f.ctx.find({scope:'private',folder_id:folder.folder_id},{userAction:true});assert.equal(found.items.length,1);assert.equal(found.items[0].source_url,'library://private/a1');
 const item=found.items[0];await f.ctx.setModelContext({content:[{type:'text',text:f.m.libraryPickerModelContext(item)}]},{userAction:true});
 const reply=await f.ctx.reply('我从素材库选择了「小猫」。',f.trace.appState,{userAction:true});assert.equal(reply.result.asset.asset_id,'a1');
 await assert.rejects(f.ctx.reply('我从素材库选择了「小猫」。',f.trace.appState,{userAction:true}),/缺少本次/);
 const receipt=await f.ctx.addToCanvas({asset:{media_type:'image',name:item.name,source_url:item.source_url}},{userAction:true});assert.equal(receipt.node_ref,'node/created-1');assert.equal(f.nodes[0].fullImage,f.library.items[0].image);assert.equal(saves,1);assert.equal(conversations,1);assert.equal(f.trace.libraryPickerPlacements.length,1);
});
test('runtime rejects false actions, forged source, team, stale library/project and restore',async()=>{
 const f=await fixture(),request={scope:'private',query:'小猫'};
 await assert.rejects(f.ctx.find(request),/用户动作/);await assert.rejects(f.ctx.find({...request,scope:'team'},{userAction:true}));await assert.rejects(f.ctx.find(request,{restore:true}),/恢复查询/);
 f.trace.appState={...f.trace.appState,query:'小猫'};assert.equal((await f.ctx.find(request,{restore:true})).items.length,1);
 await assert.rejects(f.ctx.addToCanvas({asset:{media_type:'image',name:'小猫',source_url:'https://evil.test/x'}},{userAction:true}));assert.equal(f.nodes.length,0);
 f.library.items[0].image='data:image/png;base64,bmV3';await assert.rejects(f.ctx.find(request,{userAction:true}),/已变化/);
 const g=await fixture();g.setProject('other');await assert.rejects(g.ctx.find(request,{userAction:true}),/会话已切换/);
 const h=await fixture();h.setLive(false);await assert.rejects(h.ctx.find(request,{userAction:true}),/会话已切换/);
});
test('runtime never reports success on graph or conversation save failure',async()=>{
 for(const config of [{save:async()=>false},{persistConversation:async()=>false}]){
 const f=await fixture(config),{items}=await f.ctx.find({scope:'private',query:'小猫'},{userAction:true}),item=items[0];
 await assert.rejects(f.ctx.addToCanvas({asset:{media_type:'image',name:item.name,source_url:item.source_url}},{userAction:true}),/保存失败/);assert.equal(f.nodes.length,1);assert.equal(f.trace.libraryPickerPlacements,undefined);
 }
});
test('runtime discards agent-supplied library fields and never permits unsafe stored media',async()=>{
 const f=await fixture();await assert.rejects(f.runtime.prepareAppArgs({resource_uri:f.m.libraryPickerUri,data:{assets:[item]}}),/宿主读取/);
 f.library.items[0].image='https://evil.test/image.png';const args=await f.runtime.prepareAppArgs({resource_uri:f.m.libraryPickerUri,data:{}}),response=f.m.prepareLibraryPicker(args.data),trace={id:'new',result:f.runtime.bindPreparedResult({response},args)};trace.appState=f.m.initialLibraryPickerState(response);const ctx=f.runtime.capture(response,{trace,chat:{id:'c1'},isCurrent:()=>true});
 const out=await ctx.find({scope:'private',query:'小猫'},{userAction:true});assert.equal(out.items[0].source_url,undefined);assert.equal(out.items[0].preview_url,undefined);
 await assert.rejects(ctx.addToCanvas({asset:{media_type:'image',name:'小猫',source_url:'https://evil.test/image.png'}},{userAction:true}));assert.equal(f.nodes.length,0);
});
test('last sent picked_asset_id survives official folder/query switching',async()=>{
 const f=await fixture();const {items}=await f.ctx.find({scope:'private',query:'小猫'},{userAction:true});const chosen=items[0];
 await f.ctx.setModelContext({content:[{type:'text',text:f.m.libraryPickerModelContext(chosen)}]},{userAction:true});await f.ctx.reply('我从素材库选择了「小猫」。',f.trace.appState,{userAction:true});
 const saved={scope:'private',query:'不存在',folder:null,picked_asset_id:'a1'};const empty=await f.ctx.find({scope:'private',query:'不存在'},{userAction:true});assert.equal(empty.items.length,0);assert.deepEqual(f.ctx.validateState(saved),saved);
 assert.throws(()=>f.ctx.validateState({...saved,picked_asset_id:'team'}));
 const reloaded=await f.ctx.find({scope:'private',query:'小猫'},{userAction:true});await f.ctx.setModelContext({content:[{type:'text',text:f.m.libraryPickerModelContext(reloaded.items[0])}]},{userAction:true});assert.equal((await f.ctx.reply('【素材：小猫】继续描述',saved,{userAction:true})).kind,'reference');
});
test('iframe operation guard prevents late query results and canvas insertion after awaits',async()=>{
 const f=await fixture();let fresh=true;const promise=f.ctx.find({scope:'private',query:'小猫'},{userAction:true,isCurrent:()=>fresh});fresh=false;await assert.rejects(promise,/已重载/);assert.equal(f.ctx.getVisibleAssets().length,0);
 fresh=true;const {items}=await f.ctx.find({scope:'private',query:'小猫'},{userAction:true,isCurrent:()=>fresh});const promise2=f.ctx.addToCanvas({asset:{media_type:'image',name:items[0].name,source_url:items[0].source_url}},{userAction:true,isCurrent:()=>fresh});fresh=false;await assert.rejects(promise2,/已重载/);assert.equal(f.nodes.length,0);
});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function place(f){const {items}=await f.ctx.find({scope:'private',query:'小猫'},{userAction:true}),chosen=items[0];return f.ctx.addToCanvas({asset:{media_type:'image',name:chosen.name,source_url:chosen.source_url}},{userAction:true});}
test('deleting the inserted node while graph save waits never creates a success receipt',async()=>{
 const entered=deferred(),commit=deferred();let conversations=0;const f=await fixture({save:async()=>{entered.resolve();await commit.promise;return true;},persistConversation:async()=>{conversations++;return true;}});
 const operation=place(f);await entered.promise;assert.equal(f.nodes.length,1);f.nodes.splice(0);commit.resolve();await assert.rejects(operation,error=>error.code==='placement_changed');assert.equal(f.trace.libraryPickerPlacements,undefined);assert.equal(conversations,0);
});
test('node changes during conversation commit reject success and persist receipt compensation',async()=>{
 for(const mutate of [f=>f.nodes.splice(0),f=>{f.nodes[0].fullImage='data:image/png;base64,bmV3';},f=>{f.nodes[0].provenance.asset_id='other';},f=>{f.nodes[0].type='video';}]){
  const entered=deferred(),commit=deferred();let f,calls=0,persisted;
  f=await fixture({persistConversation:async()=>{calls++;persisted=structuredClone(f.trace.libraryPickerPlacements);if(calls===1){entered.resolve();await commit.promise;}return true;}});
  const previous=[{node_ref:'node/old',asset_id:'old'}];f.trace.libraryPickerPlacements=previous;
  const operation=place(f);await entered.promise;assert.equal(persisted.length,2);mutate(f);commit.resolve();await assert.rejects(operation,error=>error.code==='placement_changed');assert.equal(calls,2);assert.strictEqual(f.trace.libraryPickerPlacements,previous);assert.deepEqual(persisted,previous);
 }
});
test('failed receipt compensation after deletion is reported independently',async()=>{
 const entered=deferred(),commit=deferred();let f,calls=0;f=await fixture({persistConversation:async()=>{if(++calls===1){entered.resolve();await commit.promise;return true;}return false;}});
 const operation=place(f);await entered.promise;f.nodes.splice(0);commit.resolve();await assert.rejects(operation,error=>error.code==='conversation_rollback_failed');assert.equal(f.trace.libraryPickerPlacements,undefined);assert.equal(calls,2);
});


test('official cloud media stays in library data but is not exposed or imported by the local picker',async()=>{
 const f=await fixture();f.library.items[0].image='https://files.tapnow.media/private-image.png';
 const args=await f.runtime.prepareAppArgs({resource_uri:f.m.libraryPickerUri,data:{},title:'库'});
 const response=f.m.prepareLibraryPicker(args.data,args.title),trace={id:'local-only',result:f.runtime.bindPreparedResult({response},args)};
 trace.appState=f.m.initialLibraryPickerState(response);
 const ctx=f.runtime.capture(response,{trace,chat:{id:'c1'},isCurrent:()=>true});
 const found=await ctx.find({scope:'private',query:'小猫'},{userAction:true});
 assert.equal(found.items[0].source_url,undefined);assert.equal(found.items[0].preview_url,undefined);
 assert.equal(f.library.items[0].image,'https://files.tapnow.media/private-image.png');
 for(const key of ['source_url','preview_url'])assert.throws(()=>f.m.prepareLibraryPicker({...data,assets:[{...item,[key]:'https://files.tapnow.media/private-image.png'}]}));
 await assert.rejects(ctx.addToCanvas({asset:{media_type:'image',source_url:'library://private/a1',name:'小猫'}},{userAction:true}));assert.equal(f.nodes.length,0);
});
