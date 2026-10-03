'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const ready=import('../src/features/local-resource-migration/node-image-repair.mjs');
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const old='https://files.tapnow.media/unknown.png?token=private-old-reference';
const file=()=>new Blob([bytes],{type:'image/png'});
async function fixture(){
 const {createNodeImageRepair}=await ready;
 let node={id:'selected',type:'image',x:10,y:20,width:200,height:180,image:old,fullImage:old,sourceJournal:{source:old},generation:{model:'old-model'},provenance:{kind:'generation-result',mediaSource:old,model:'old-model'}};
 const other={...structuredClone(node),id:'other'},undo=[];let project='qa',jobs=[],current=true,stored={nodes:[structuredClone(node),structuredClone(other)]},puts=0,updates=0,saves=0,reads=0,decodes=0,blob=null;
 const options={nodeId:'selected',getNode:()=>node,getProjectId:()=>project,isCurrent:()=>current,getJobs:()=>jobs,
  assets:{put:async value=>{puts++;blob=value;return 'asset:qa-file';}},readAsset:async()=>{reads++;return blob;},
  decodeImage:async value=>{decodes++;assert.deepEqual(Buffer.from(await value.arrayBuffer()),bytes);return {width:1,height:1};},
  hashBytes:async value=>createHash('sha256').update(value).digest('hex'),
  updateNode:(_id,patch)=>{updates++;undo.push(structuredClone(node));Object.assign(node,patch);},
  saveProject:async()=>{saves++;stored={nodes:[structuredClone(node),structuredClone(other)]};},readProject:async()=>structuredClone(stored)};
 return {options,create:()=>createNodeImageRepair(options),node:()=>node,other,undo,counts:()=>({puts,updates,saves,reads,decodes}),setNode:value=>{node=value;},setProject:value=>{project=value;},setJobs:value=>{jobs=value;},setCurrent:value=>{current=value;},stored:()=>stored};
}
test('manual repair verifies real bytes, updates only selected old aliases once and preserves provenance journal and undo',async()=>{
 const f=await fixture(),other=structuredClone(f.other),before=structuredClone(f.node()),service=f.create();
 const result=await service.repair(file());assert.equal(result.persisted,true);assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(f.node().image,'asset:qa-file');assert.equal(f.node().fullImage,'asset:qa-file');assert.deepEqual(f.node().sourceJournal,before.sourceJournal);assert.deepEqual(f.node().generation,before.generation);assert.deepEqual(f.node().provenance,{kind:'imported',mediaSource:'asset:qa-file',model:null});assert.deepEqual(f.other,other);assert.deepEqual(f.undo,[before]);assert.equal(f.node().x,10);assert.equal(f.node().width,200);assert.deepEqual(f.counts(),{puts:1,updates:1,saves:1,reads:1,decodes:1});assert.equal(f.stored().nodes[0].image,'asset:qa-file');
});
test('bad MIME, empty/oversize file, decode, dimensions and saved-byte mismatch never publish a node edit',async()=>{
 for(const mode of ['mime','empty','oversize','decode','dimensions','bytes','type']){
  const f=await fixture(),before=structuredClone(f.node());let input=file();
  if(mode==='mime')input=new Blob([bytes],{type:'image/svg+xml'});
  if(mode==='empty')input=new Blob([],{type:'image/png'});
  if(mode==='oversize')input=new Blob([new Uint8Array(20*1024*1024+1)],{type:'image/png'});
  if(mode==='decode')f.options.decodeImage=async()=>{throw Error('invalid image');};
  if(mode==='dimensions')f.options.decodeImage=async()=>({width:8192,height:8192});
  if(mode==='bytes')f.options.readAsset=async()=>new Blob([bytes.map(value=>value^1)],{type:'image/png'});
  if(mode==='type')f.options.readAsset=async()=>new Blob([bytes],{type:'image/jpeg'});
  await assert.rejects(f.create().repair(input));assert.deepEqual(f.node(),before);assert.equal(f.counts().updates,0);assert.equal(f.counts().saves,0);
 }
});
test('late node edits, replacement, project switch, current gate and busy generation prevent publication',async()=>{
 for(const mode of ['edit','identity','project','current','pending','queued','running','applying']){
  const f=await fixture(),normal=f.options.readAsset;
  f.options.readAsset=async ref=>{const blob=await normal(ref);if(mode==='edit')f.node().generation.prompt='new';if(mode==='identity')f.setNode(structuredClone(f.node()));if(mode==='project')f.setProject('other');if(mode==='current')f.setCurrent(false);if(mode==='pending')f.node().pendingOperation='image.generate';if(['queued','running','applying'].includes(mode))f.setJobs([{id:'job',status:mode==='applying'?'succeeded':mode,applying:true,request:{parameters:{canvasResults:{targetNodeIds:['selected']}}}}]);return blob;};
  await assert.rejects(f.create().repair(file()));assert.equal(f.node().image,old);assert.equal(f.counts().updates,0);assert.equal(f.counts().saves,0);
 }
});
test('save failure accurately reports applied but unconfirmed and retry saves without a second edit/import/undo',async()=>{
 const f=await fixture(),normal=f.options.saveProject;let first=true;f.options.saveProject=async()=>{if(first){first=false;throw Error('disk failure');}return normal();};
 const service=f.create(),result=await service.repair(file());assert.equal(result.applied,true);assert.equal(result.persisted,false);assert.match(result.saveError,/disk failure/);assert.equal(f.node().image,'asset:qa-file');assert.equal(f.stored().nodes[0].image,old);
 const retry=await service.retrySave();assert.equal(retry.persisted,true);assert.equal(f.counts().updates,1);assert.equal(f.counts().puts,1);assert.equal(f.undo.length,1);assert.equal(f.stored().nodes[0].image,'asset:qa-file');
});
test('retry cannot save a different project and a mismatched confirmation stays unconfirmed',async()=>{
 const f=await fixture();f.options.readProject=async()=>({nodes:[]});const service=f.create(),result=await service.repair(file());assert.equal(result.persisted,false);f.setProject('another');const retry=await service.retrySave();assert.equal(retry.persisted,false);assert.match(retry.saveError,/画布已切换/);assert.equal(f.counts().saves,1);
});
test('repair preserves valid local alias and main attribution while fixing only an old preview; dragging remains allowed',async()=>{
 const f=await fixture();f.node().fullImage='asset:existing-full';const provenance=structuredClone(f.node().provenance),normal=f.options.readAsset;
 f.options.readAsset=async ref=>{f.node().x=900;f.node().y=700;return normal(ref);};
 const result=await f.create().repair(file());assert.equal(result.persisted,true);assert.deepEqual(result.fields,['image']);assert.equal(f.node().fullImage,'asset:existing-full');assert.deepEqual(f.node().provenance,provenance);assert.equal(f.node().x,900);assert.equal(f.node().pixelWidth,undefined);
});
test('confirmation checks context after each await and successful retries are idempotent',async()=>{
 for(const mode of ['save-context','read-media','read-identity']){
  const f=await fixture(),save=f.options.saveProject,read=f.options.readProject;
  if(mode==='save-context')f.options.saveProject=async()=>{await save();f.setCurrent(false);};
  else f.options.readProject=async()=>{const value=await read();if(mode==='read-media')f.node().image=old;else f.setNode(structuredClone(f.node()));return value;};
  const service=f.create(),result=await service.repair(file());assert.equal(result.persisted,false);assert.equal(service.status().persisted,false);
 }
 const f=await fixture(),service=f.create();await service.repair(file());f.options.saveProject=async()=>{throw Error('must not run');};const before=f.counts();const retry=await service.retrySave();assert.equal(retry.persisted,true);assert.equal(service.status().persisted,true);assert.deepEqual(f.counts(),before);
});
