'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),code=fs.readFileSync(path.join(root,'src/features/generation-config/qa/configuration.js'),'utf8');
function fixture({preferences=new Map(),assets=new Map()}={}){
 const reads=[],writes=[],location=new URL('http://127.0.0.1:4173/src/features/generation-config/qa/main.html?session=synthetic-only&profile=angle');
 const window={localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,value)},LibraryRoundtripQAStorage:{flush:async()=>{}},
  LocalAssets:{put:async blob=>{const ref='asset:synthetic-'+(assets.size+1);assets.set(ref,blob);writes.push(ref);return ref;},url:async ref=>{if(!assets.has(ref))throw Error('本地资源已丢失');return 'blob:read-only-'+ref;}},
  fetch:async(ref,options)=>{reads.push({ref,options});assert.match(ref,/^\/src\/features\/video-history\/qa\/(landscape|portrait)\.png$/);return new Response(fs.readFileSync(path.join(root,ref)),{headers:{'Content-Type':'image/png'}});}};
 const context=vm.createContext({window,location,URL,URLSearchParams,Response,document:{querySelector:()=>({textContent:''})}});vm.runInContext(code,context);
 return {window,assets,preferences,reads,writes};
}
test('angle QA archives actual bundled PNG blobs before returning durable contract refs and reuses them on refresh',async()=>{
 const first=fixture();await assert.rejects(first.window.fetch('/api/generation/tasks',{method:'POST',body:'{}'}),/尚未归档/);
 await first.window.GenerationConfigurationQA.prepareLocalMedia();assert.equal(first.reads.length,2);assert.equal(first.writes.length,2);
 assert.match(first.window.CANVAS_DATA.nodes[0].image,/^asset:/);
 for(const {ref,options}of first.reads){assert.equal(options.mode,'same-origin');assert.equal(options.redirect,'error');}
 const task=await first.window.fetch('/api/generation/tasks',{method:'POST',body:JSON.stringify({kind:'image.multiAngle'})});assert.equal(task.status,202);
 const response=await first.window.fetch('/api/generation/tasks/multi-angle-contract-1'),result=await response.json(),ref=result.outputs[0].url;
 assert.match(ref,/^asset:/);assert.equal(result.status,'succeeded');
 assert.deepEqual(Buffer.from(await first.assets.get(ref).arrayBuffer()),fs.readFileSync(path.join(root,'src/features/video-history/qa/portrait.png')));
 const refreshed=fixture(first);await refreshed.window.GenerationConfigurationQA.prepareLocalMedia();assert.equal(refreshed.reads.length,0);assert.equal(refreshed.writes.length,0);
 assert.equal(refreshed.window.CANVAS_DATA.nodes[0].image,first.window.CANVAS_DATA.nodes[0].image);
 const replay=await refreshed.window.fetch('/api/generation/tasks/multi-angle-contract-1');assert.equal((await replay.json()).outputs[0].url,ref);
 const {migrateCanvasSnapshot}=await import('../src/features/local-resource-migration/snapshot.mjs'),report=await migrateCanvasSnapshot({version:1,nodes:[{image:first.window.CANVAS_DATA.nodes[0].image},{image:ref,fullImage:ref,options:[{url:ref}]}],edges:[]},{index:{version:1,algorithm:'sha256-exact-utf8',entries:{}}});
 assert.equal(report.summary.unresolved,0);assert.equal(report.summary.alreadyLocal,4);
});
test('missing cached QA bytes stay an explicit failure without deleting cache or creating replacement blobs',async()=>{
 const preferences=new Map([['qa-generation-angle-media-v1',JSON.stringify({source:'asset:missing-source',result:'asset:missing-result'})]]),f=fixture({preferences});
 await assert.rejects(f.window.GenerationConfigurationQA.prepareLocalMedia(),/本地资源已丢失/);
 assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);assert.equal(preferences.size,1);assert.equal(f.window.CANVAS_DATA,undefined);
 await assert.rejects(f.window.fetch('/api/generation/tasks',{method:'POST',body:'{}'}),/尚未归档/);
});
test('QA boot waits for durable archive before loading the production app descriptor',async()=>{
 const events=[],descriptors=[{src:'local-assets.js'},{src:'app.js?v=fixture'}];
 const document={querySelector:()=>({textContent:JSON.stringify(descriptors)}),createElement:tag=>({tag,style:{}}),body:{append(element){if(element.tag==='script'){events.push(element.src);queueMicrotask(()=>element.onload());}}}};
 const window={LibraryRoundtripQAStorage:{ready:Promise.resolve()},GenerationConfigurationQA:{profile:'native',prepareLocalMedia:async()=>{events.push('archive-start');await new Promise(resolve=>setImmediate(resolve));events.push('archive-committed');}}};
 const boot=fs.readFileSync(path.join(root,'src/features/generation-config/qa/boot.mjs'),'utf8'),context=vm.createContext({window,document,queueMicrotask});
 vm.runInContext('globalThis.finished=(async()=>{'+boot+'})();',context);await context.finished;
 assert.deepEqual(events,['local-assets.js','archive-start','archive-committed','app.js?v=fixture']);
});
