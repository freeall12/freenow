'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all(['model','core','archive'].map(name=>import('../src/features/generation-history/'+name+'.mjs')));
const worldOutput=()=>({type:'model',url:'https://assets.test/500k.spz?X-Amz-Signature=signed-resource',format:'spz',representation:'gaussianSplat',sourceFileId:'world-original',filename:'world.spz',poster:'https://assets.test/cover.webp',world:{worldId:'world-original',model:'marble-1.1',marbleUrl:'https://marble.worldlabs.ai/world/world-original',coordinateSystem:'marble_raw_opencv',splatResolution:'500k',assets:{splats:{spzUrls:{'100k':'https://assets.test/100k.spz','500k':'https://assets.test/500k.spz?X-Amz-Signature=signed-resource'},semanticsMetadata:{metricScaleFactor:1.25,groundPlaneOffset:-.5}},mesh:{colliderMeshUrl:'https://assets.test/collider.glb'},imagery:{panoUrl:'https://assets.test/pano.jpg'}}}});

test('history world snapshots keep strict bounded original SPZ metadata including signed LOD URLs',async()=>{
 const [{outputSnapshot}]=await modules,output=worldOutput(),snapshot=outputSnapshot(output);
 assert.deepEqual(snapshot.world,output.world);assert.equal(snapshot.url,output.url);assert.equal(snapshot.format,'spz');assert.equal(snapshot.representation,'gaussianSplat');
 snapshot.world.assets.splats.semanticsMetadata.metricScaleFactor=10;assert.equal(output.world.assets.splats.semanticsMetadata.metricScaleFactor,1.25);
 for(const mutate of [o=>{delete o.url;},o=>{delete o.world;},o=>{o.world.worldId='other';},o=>{o.world.worldId='..';o.sourceFileId='..';},o=>{o.format='glb';},o=>{o.representation='mesh';},o=>{o.world.model='unknown';},o=>{o.world.coordinateSystem='y_up';},o=>{o.world.splatResolution='1m';},o=>{o.world.assets.splats.spzUrls={};},o=>{o.world.assets.splats.spzUrls.other='https://assets.test/other.spz';},o=>{o.url=o.world.assets.mesh.colliderMeshUrl;},o=>{o.world.assets.splats.semanticsMetadata.metricScaleFactor=0;},o=>{o.world.assets.splats.semanticsMetadata.groundPlaneOffset=Infinity;},o=>{o.world.assets.mesh=null;},o=>{o.world.assets.imagery={};},o=>{o.world.assets.splats.apiKey='not-persisted';},o=>{o.world.assets.splats.semanticsMetadata.matrix=[1,0,0];},o=>{o.world.marbleUrl='https://assets.test/'+('a'.repeat(8192));},o=>{o.world.assets.imagery.panoUrl='https://user:secret@assets.test/pano.jpg';},o=>{o.world.assets.splats.spzUrls['100k']='https://127.0.0.1/world.spz';}]){
  const invalid=worldOutput();mutate(invalid);assert.throws(()=>outputSnapshot(invalid),/元数据无效/);
 }
});

test('failed world materialization retains metadata through refresh and retries only the original output without claiming SPZ readiness',async()=>{
 const [,{createHistory}]=await modules,records=new Map(),attempts=[];
 const store={readRecord:async key=>structuredClone(records.get(key)),writeRecord:async(key,value)=>records.set(key,structuredClone(value))};
 const archive=async output=>{attempts.push(structuredClone(output));throw Error('SPZ renderer is unavailable');};
 const build=()=>createHistory({projectId:'isolated-world-history',store,archive,lookup:()=>assert.fail('original output retry must not query or generate')});
 const job={id:'original-world-task',status:'succeeded',createdAt:Date.parse('2026-10-03T08:00:00Z'),request:{kind:'world.generate',prompt:'原始世界',parameters:{outputType:'world',representation:'gaussianSplat',model:'marble-1.1'}},outputs:[worldOutput()]};
 const first=build();await first.ready();await first.captureSubmission(job);await first.observe(job);assert.equal(first.list()[0].archiveStatus,'failed');
 assert.deepEqual([...records.values()][0].receipts[0].outputs[0].world,job.outputs[0].world);
 const reopened=build();await reopened.ready();await reopened.retry(job.id);assert.equal(reopened.list().length,1);assert.equal(reopened.list()[0].archiveStatus,'failed');assert.equal(attempts.length,2);assert.deepEqual(attempts[1].world,job.outputs[0].world);assert.equal(attempts[1].url,job.outputs[0].url);
});

test('history archives preserve materializer-provided asset bytes and original world metadata with format-specific MIME at the mock boundary',async()=>{
 const [,,{createArchiver}]=await modules,output=worldOutput(),bytes=new Uint8Array([1,2,3,4]),assets=new Map([['asset:original-spz',new Blob([bytes],{type:'application/octet-stream'})]]);
 const patch={outputType:'world',image:'asset:cover',worldResource:{format:'spz',representation:'gaussianSplat',url:'asset:original-spz',thumbnail:'asset:cover',name:'world.spz',bytes:4,world:structuredClone(output.world)}};
 let materialized=0;const archiver=createArchiver({assets:{url:async value=>value},fetch:async source=>new Response(assets.get(source)),materializeWorld:async()=>{materialized++;return patch;}});
 const saved=await archiver.archive(output,{parameters:{outputType:'world'}});assert.equal(saved.mime,'application/octet-stream');assert.equal(saved.mediaRef,'asset:original-spz');assert.deepEqual(saved.worldPatch,patch);
 const node=await archiver.node({id:'world-row',type:'model',archiveStatus:'ready',parameters:{outputType:'world'},...saved});assert.deepEqual(node.worldResource.world,output.world);assert.equal(node.worldResource.format,'spz');assert.equal(node.worldResource.url,'asset:original-spz');assert.deepEqual(new Uint8Array(await assets.get(node.worldResource.url).arrayBuffer()),bytes);assert.equal(materialized,1);
 const glb=createArchiver({materializeWorld:async()=>({worldResource:{format:'glb',url:'asset:original-glb'}})});assert.equal((await glb.archive({type:'model',format:'glb',url:'https://assets.test/mesh.glb'},{parameters:{}})).mime,'model/gltf-binary');
});

test('history rejects malformed or contradictory materialized world metadata and source before wrapping a saved result',async()=>{
 const [,,{createArchiver}]=await modules;
 for(const mutate of [p=>{p.worldResource.url='https://assets.test/500k.spz';},p=>{p.worldResource.url='asset:';},p=>{p.worldResource.format='glb';},p=>{p.worldResource.representation='mesh';},p=>{delete p.worldResource.world;},p=>{p.worldResource.world.assets.splats.semanticsMetadata.metricScaleFactor=2;},p=>{p.worldResource.world.assets.extra={};}]){
  const output=worldOutput(),patch={worldResource:{format:'spz',representation:'gaussianSplat',url:'asset:original-spz',world:structuredClone(output.world)}};mutate(patch);
  const archiver=createArchiver({materializeWorld:async()=>patch});await assert.rejects(archiver.archive(output,{parameters:{outputType:'world'}}));
 }
 let calls=0;const archiver=createArchiver({materializeWorld:async()=>{calls++;}}),invalid=worldOutput();delete invalid.url;
 await assert.rejects(archiver.archive(invalid,{parameters:{}}),/元数据无效/);assert.equal(calls,0);
 const stored={id:'restored-world',type:'model',archiveStatus:'ready',parameters:{},mediaRef:'asset:original-spz',worldPatch:{worldResource:{format:'spz',representation:'gaussianSplat',url:'asset:original-spz',world:worldOutput().world}}};
 stored.worldPatch.worldResource.world.assets.splats.semanticsMetadata.metricScaleFactor=0;await assert.rejects(archiver.node(stored),/元数据无效/);
});

test('history downloads use the stored SPZ or GLB format and unchanged bytes rather than the generic Blob MIME',async()=>{
 const {install}=await import('../src/features/generation-history/entry.mjs'),bytes=new Uint8Array([1,2,3,4]);
 for(const [actual,recorded,expected]of [['spz','glb','spz'],['glb','spz','glb'],[undefined,'spz','spz'],['other','glb',null]]){
  const downloads=[],row={id:'download:0',taskId:'download',outputIndex:0,type:'model',title:'原始资源',createdAt:'2026-10-03T08:00:00Z',archiveStatus:'ready',mediaRef:'asset:original-bytes',format:recorded,worldPatch:{worldResource:{format:actual}}};
  const history=await install({root:{addEventListener(){},removeEventListener(){},LocalMedia:{download:(blob,name)=>downloads.push({blob,name})}},project:{id:'format-download'},app:{notify(){}},store:{readRecord:async()=>({version:1,projectId:'format-download',rows:[row],receipts:[]}),writeRecord:async()=>{}},assets:{url:async value=>value,put:async()=>assert.fail('must not re-encode download')},fetch:async()=>new Response(new Blob([bytes],{type:'application/octet-stream'}))});
  try{
   if(!expected){await assert.rejects(history.download([row]),/格式未知/);assert.equal(downloads.length,0);continue;}
   await history.download([row]);assert.equal(downloads.length,1);assert.equal(downloads[0].name,'原始资源-1.'+expected);assert.equal(downloads[0].blob.type,'application/octet-stream');assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()),bytes);
  }finally{history.dispose();}
 }
});
