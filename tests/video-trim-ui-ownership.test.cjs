const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const deferred=()=>{let resolve;const promise=new Promise(a=>{resolve=a;});return {promise,resolve};};
async function fixture(){
 const core=await import('../video-trim-core.mjs'),transaction=await import('../src/features/video-trim/result-transaction.mjs');
 let project='one',processHook=async()=>new Blob(['trim-output'],{type:'video/mp4'}),serializeHook=async()=> 'data:video/mp4;base64,YQ==',saveHook=async()=>{},frameHook=async()=>{};
 const node={id:'source',video:'asset:source',width:400,height:225,x:20,y:30},state={nodes:[node],edges:[]},calls={process:0,insert:0,save:0,dispose:0},errors=[],notices=[];
 const app={projectIdentity:()=>({id:project}),getState:()=>state,createConnected:(id,outputs)=>{calls.insert++;const nodes=outputs.map((node,i)=>({...node,id:'output-'+i}));state.nodes.push(...nodes);state.edges.push(...nodes.map(node=>({source:id,target:node.id})));return nodes;},saveProject:async()=>{calls.save++;return saveHook();},notify:message=>notices.push(message)};
 const reader={duration:4,dispose:()=>{calls.dispose++;},at:async time=>{await frameHook(time);return {toDataURL:()=> 'data:image/jpeg;base64,YQ==',getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(time<2?[255,0,0,255]:[0,0,255,255])})})};}};
 const context={...core,...transaction,window:{CanvasApp:app,CANVAS_MENU_ICONS:{},LocalAssets:{url:async()=>'/qa/trim-scenes.mp4'},LocalMedia:{process:async()=>{calls.process++;return processHook();},asDataUrl:()=>serializeHook()}},openVideoFrames:async()=>reader,fetch:async()=>({ok:true,blob:async()=>new Blob(['input'],{type:'video/mp4'})}),AbortController,DOMException,console};
 const source=fs.readFileSync(require.resolve('../video-trim-ui.mjs'),'utf8').replace(/^import .*\n/gm,'').replace('export function open','function open');vm.runInNewContext(source+'\nglobalThis.TrimEditor=TrimEditor;',context);
 const editor=Object.create(context.TrimEditor.prototype);Object.assign(editor,{id:node.id,src:node.video,sourceClip:'null',node,base:0,duration:4,range:{start:1,end:3},busy:false,loaded:true,alive:true,visible:true,owner:transaction.captureTrimOwner(app,node,n=>n.video),
  beginJob(){this.assertSource();this.busy=true;this.jobController=new AbortController();},progress(){},endJob(){this.busy=false;},close(){this.visible=false;},dispose(){this.alive=false;},jobError(error){errors.push(error);}});
 return {editor,node,state,calls,errors,notices,setProject:value=>{project=value;},setProcess:fn=>{processHook=fn;},setSerialize:fn=>{serializeHook=fn;},setSave:fn=>{saveHook=fn;},setFrame:fn=>{frameHook=fn;}};
}

test('manual and smart production handlers wait for save acknowledgement before success',async()=>{
 for(const mode of ['manual','smart']){
  const f=await fixture(),gate=deferred(),saving=deferred();f.setSave(()=>{saving.resolve();return gate.promise;});
  const pending=mode==='manual'?f.editor.exportRanges([f.editor.range]):f.editor.analyze();await saving.promise;
  assert.equal(f.calls.insert,1);assert.equal(f.notices.length,0);gate.resolve();await pending;assert.equal(f.errors.length,0);assert.equal(f.notices.length,1);assert.equal(f.calls.process,mode==='manual'?1:2);
 }
});

test('background manual processing refuses another project with same ID and media',async()=>{
 const f=await fixture(),gate=deferred(),started=deferred();f.setProcess(()=>{started.resolve();return gate.promise;});const pending=f.editor.exportRanges([f.editor.range]);await started.promise;f.editor.close();f.setProject('two');gate.resolve(new Blob(['late'],{type:'video/mp4'}));await pending;
 assert.equal(f.calls.insert,0);assert.equal(f.calls.save,0);assert.equal(f.errors[0].code,'trim_source_changed');
});

test('late serialization after stop, source edit or undo replacement never inserts a result',async()=>{
 for(const mode of ['stop','source','replacement']){
  const f=await fixture(),gate=deferred(),started=deferred();f.setSerialize(()=>{started.resolve();return gate.promise;});const pending=f.editor.exportRanges([f.editor.range]);await started.promise;
  if(mode==='stop')f.editor.jobController.abort();if(mode==='source')f.node.video='asset:changed';if(mode==='replacement')f.state.nodes[0]={...f.node};gate.resolve('data:video/mp4;base64,YQ==');await pending;
  assert.equal(f.calls.insert,0);assert.equal(f.calls.save,0);assert.ok(f.errors[0]);
 }
});

test('smart detection stops before FFmpeg when ownership changes during frame reading',async()=>{
 const f=await fixture(),gate=deferred(),started=deferred();f.setFrame(time=>{if(time===.2){started.resolve();return gate.promise;}});const pending=f.editor.analyze();await started.promise;f.setProject('two');gate.resolve();await pending;
 assert.equal(f.calls.process,0);assert.equal(f.calls.insert,0);assert.equal(f.errors[0].code,'trim_source_changed');
});

test('production save failure preserves result and transaction retries without FFmpeg or duplicate nodes',async()=>{
 const f=await fixture();f.setSave(async()=>{throw Error('disk full');});await f.editor.exportRanges([f.editor.range]);assert.equal(f.errors[0].code,'trim_save_failed');assert.equal(f.notices.length,0);assert.equal(f.state.nodes.length,2);
 f.setSave(async()=>{});await f.editor.commit.retrySave();await f.editor.exportRanges([f.editor.range]);assert.equal(f.calls.process,1);assert.equal(f.calls.insert,1);assert.equal(f.calls.save,2);
});
