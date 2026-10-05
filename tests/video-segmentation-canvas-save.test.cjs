const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const appSource=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){const start=appSource.indexOf('  function '+name+'('),end=appSource.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start);return appSource.slice(start,end);}
function method(startText,endText){const start=appSource.indexOf(startText),end=appSource.indexOf(endText,start+1);assert.ok(start>=0&&end>start);return appSource.slice(start,end).trim().replace(/,$/,'');}
function actualCanvasHost(){
 const notices=[],calls=[],source={id:'source',type:'video',title:'公开合成来源',video:'asset:source',width:4,height:2,clip:{start:.5,end:1}},coreSource=fs.readFileSync(require.resolve('../src/features/canvas-projects/core.js'),'utf8'),snapshotStart=coreSource.indexOf('    snapshot(graph,view,history=[],future=[]){'),snapshotEnd=coreSource.indexOf('\n    setTitle(',snapshotStart);
 let fail=true,beforeWrite=()=>{},disk=null,latest=Promise.resolve(),flushes=0;
 const store={save(snapshot,id,options={}){calls.push({snapshot:structuredClone(snapshot),id,options});const copy=structuredClone(snapshot);latest=latest.catch(()=>{}).then(()=>{beforeWrite();if(options.beforeCommit&&options.beforeCommit()!==true)throw Error('commit refused');if(fail)throw Error('QA actual host save failed');disk=copy;});return latest;},async flush(){flushes++;await latest;}};
 const context=vm.createContext({source,structuredClone,localStorage:{setItem(){}},window:{CanvasStore:store},getNotice:()=>notices[0],document:{createElement:()=>({dataset:{},setAttribute(){},remove(){notices.splice(notices.indexOf(this),1);}}),body:{append:notice=>notices.push(notice)}}});
 const storageStart=appSource.indexOf('  function storageError('),storageEnd=appSource.indexOf('\n  try {',storageStart);
 vm.runInContext(`
 const clone=structuredClone,$=()=>getNotice(),flushGesture=()=>{},saveView=()=>{},notify=()=>{},original=new Map([[source.id,source]]);
 let nodes=[source],edges=[],view={x:12.5,y:-6.25,scale:.7},history=[],future=[],localChanges=0,graphLoaded=true,graphReadFailed=false,saveRevision=0,dirty=false,identityId='canvas';
 const projectId='canvas',validId=id=>typeof id==='string',metadataSeed={id:'canvas',title:'SAM2 QA',createdAt:null,updatedAt:null};let metadata={...metadataSeed};
 window.CanvasProjects={${coreSource.slice(snapshotStart,snapshotEnd).trim().replace(/,$/,'')},markDirty(value=true){dirty=value;},isDefault:()=>true};
 ${appSource.slice(storageStart,storageEnd)}
 ${fn('remember')}
 ${fn('persist')}
 const render=()=>{},rebuildAndPersist=()=>persist();
 window.CanvasApp={${method('    async saveProject(', '\n    async prepareProjectNavigation(')},${method('    updateNode(', '\n    insertGraph(')},getState:()=>({nodes,edges,view}),projectIdentity:()=>({id:identityId})};
 globalThis.probe={app:window.CanvasApp,node:source,dirty:()=>dirty,history:()=>clone(history),view:()=>clone(view),switchProject:()=>identityId='other'};
 `,context,{filename:'sam2-actual-canvas-save-production-methods.js'});
 return {app:context.probe.app,node:context.probe.node,notices,calls,get disk(){return disk;},get dirty(){return context.probe.dirty();},get history(){return structuredClone(context.probe.history());},get view(){return structuredClone(context.probe.view());},get flushes(){return flushes;},setFailure(value){fail=value;},setBeforeWrite(value){beforeWrite=value;},switchProject:()=>context.probe.switchProject()};
}
test('SAM2 failed autosave retry uses actual guarded CanvasApp save, preserves history/view and releases dirty/notice after real persistence',async()=>{
 const m=await import('../src/features/video-mask/recovery.mjs'),host=actualCanvasHost(),receipt=m.createSegmentationReceipt({app:host.app,node:host.node,source:host.node.video,rect:{x:0,y:0,width:.5,height:.5},time:.5,configuration:{version:'fixed'},uuid:()=> '11111111-1111-4111-8111-111111111111'});let puts=0;const application=m.createMaskApplication({app:host.app,node:host.node,store:{save:()=>assert.fail('direct graph save bypassed host'),flush:()=>assert.fail('host owns actual flush')},receipt,localAssets:{put:async()=>{puts++;return 'asset:mask';}}}),mask={width:4,height:2,fps:2,frames:['0 2','6 2']},media={width:4,height:2,duration:1};
 await assert.rejects(application.apply(mask,media),/actual host save failed/);assert.equal(host.dirty,true);assert.equal(host.notices.length,1);assert.equal(host.history.length,1);assert.equal(puts,1);assert.notEqual(receipt.status,'applied');
 host.setFailure(false);await application.apply(mask,media);assert.equal(receipt.status,'applied');assert.equal(host.dirty,false);assert.equal(host.notices.length,0);assert.equal(host.history.length,1);assert.equal(puts,1);assert.equal(host.flushes,1);assert.equal(host.disk.nodes[0].videoMask.asset,'asset:mask');assert.deepEqual(host.disk.view,host.view);assert.deepEqual(host.disk.history,host.history);assert.equal(host.disk.future.length,0);assert.equal(host.disk.project.id,'canvas');assert.equal(host.disk.history[0].nodes[0].videoMask,undefined);assert.equal(typeof host.calls.at(-1).options.beforeCommit,'function');
});
test('actual CanvasApp optional guard blocks a project change inside the storage transaction and keeps pending result retryable',async()=>{
 const m=await import('../src/features/video-mask/recovery.mjs'),host=actualCanvasHost(),receipt=m.createSegmentationReceipt({app:host.app,node:host.node,source:host.node.video,rect:{x:0,y:0,width:.5,height:.5},time:.5,configuration:{version:'fixed'},uuid:()=> '11111111-1111-4111-8111-111111111111'}),application=m.createMaskApplication({app:host.app,node:host.node,receipt,localAssets:{put:async()=> 'asset:mask'}});host.setBeforeWrite(()=>host.switchProject());await assert.rejects(application.apply({width:4,height:2,fps:2,frames:['0 2','6 2']},{width:4,height:2,duration:1}),/来源或项目已变化/);assert.equal(host.disk,null);assert.equal(host.dirty,true);assert.equal(host.notices.length,1);assert.notEqual(receipt.status,'applied');assert.equal(host.node.videoMask.asset,'asset:mask');
});
test('actual CanvasApp default save remains compatible and optional failed guard does not enqueue a write',async()=>{
 const host=actualCanvasHost();host.setFailure(false);await host.app.saveProject();assert.equal(host.calls.length,1);assert.equal(host.disk.project.id,'canvas');assert.equal(host.dirty,false);await assert.rejects(host.app.saveProject({beforeCommit:()=>false}),/保存资格已变化/);assert.equal(host.calls.length,1);await assert.rejects(host.app.saveProject({beforeCommit:'invalid'}),/守卫必须为函数/);assert.equal(host.calls.length,1);
});
