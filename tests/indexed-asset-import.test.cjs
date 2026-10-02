'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex'),ref='/assets/known.png',bytes=new Uint8Array([1,2,3,4]),index={version:1,algorithm:'sha256-exact-utf8',entries:{[hash('source')]:{ref,sha256:hash(bytes),bytes:4}}};
const response=(body=bytes,mime='image/png',headers={})=>new Response(body,{headers:{'content-type':mime,...headers}});

test('trusted exact static refs import verified bounded bytes with same-origin fetch and never put mismatches',async()=>{
 const {importIndexedAsset}=await import('../src/features/local-resource-migration/import-asset.mjs');let puts=0,requests=0;
 const assets={put:async blob=>{puts++;assert.equal(blob.size,4);assert.equal(blob.type,'image/png');return 'asset:verified';}},fetchImpl=async(source,options)=>{requests++;assert.equal(source,ref);assert.equal(options.mode,'same-origin');assert.equal(options.redirect,'error');return response();};
 assert.equal(await importIndexedAsset('./assets/known.png',{index,assets,fetchImpl,expectedKind:'image',hashBytes:hash}),'asset:verified');
 for(const options of [{source:'/assets/unknown.png'},{source:'/assets/%2e%2e/known.png'},{maxBytes:3},{expectedKind:'audio'},{fetchImpl:async()=>response(new Uint8Array([8,7,6,5]))},{fetchImpl:async()=>response(new Uint8Array([1,2,3,4,5]))},{fetchImpl:async()=>response(bytes,'image/png',{'content-length':'5'})}])await assert.rejects(importIndexedAsset(options.source||ref,{index,assets,fetchImpl,expectedKind:'image',hashBytes:hash,...options}),error=>error.code==='media_unavailable');
 assert.equal(puts,1);assert.equal(requests,2);
});

test('cancellation and a changed-source guard refuse AssetStore put after byte preparation',async()=>{
 const {importIndexedAsset}=await import('../src/features/local-resource-migration/import-asset.mjs');let puts=0;const assets={put:async()=>{puts++;return 'asset:unexpected';}},controller=new AbortController();
 await assert.rejects(importIndexedAsset(ref,{index,assets,fetchImpl:async()=>response(),signal:controller.signal,hashBytes:async value=>{controller.abort();return hash(value);}}),error=>error.name==='AbortError');
 await assert.rejects(importIndexedAsset(ref,{index,assets,fetchImpl:async()=>response(),hashBytes:hash,beforePut:()=>{throw Error('source changed');}}),/source changed/);assert.equal(puts,0);
});

test('conflicting hashes or byte lengths for one static ref reject before fetching or putting',async()=>{
 const {importIndexedAsset}=await import('../src/features/local-resource-migration/import-asset.mjs');let fetches=0,puts=0;
 for(const row of [{ref,sha256:hash('different'),bytes:4},{ref,sha256:hash(bytes),bytes:5}]){
   const ambiguous={...index,entries:{...index.entries,[hash('another-source')]:row}};
   await assert.rejects(importIndexedAsset(ref,{index:ambiguous,assets:{put:async()=>{puts++;return 'asset:unexpected';}},fetchImpl:async()=>{fetches++;return response();},hashBytes:hash}),error=>error.code==='media_unavailable'&&error.message.includes('冲突'));
 }
 assert.equal(fetches,0);assert.equal(puts,0);
});
