'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const request={kind:'world.generate',prompt:'测试世界',parameters:{modelId:'marble-public-alias'}};
const memoryStore=()=>{const data=new Map();return {data,readAll:async()=>[...data.values()].map(value=>structuredClone(value)),write:async value=>{data.set(value.id,structuredClone(value));}};};
const reply=value=>({ok:true,json:async()=>value});
const splats={'100k':'https://assets.test/world/100k.spz','150k':'https://assets.test/world/150k.spz','500k':'https://assets.test/world/500k.spz?X-Amz-Signature=asset-signature','full_res':'https://assets.test/world/full.spz'};
function worldOutput(){return {type:'model',url:splats['500k'],format:'spz',representation:'gaussianSplat',sourceFileId:'world-original',filename:'真实世界.spz',poster:'https://assets.test/world/cover.webp',world:{worldId:'world-original',model:'marble-1.1',marbleUrl:'https://marble.worldlabs.ai/world/world-original',coordinateSystem:'marble_raw_opencv',splatResolution:'500k',assets:{splats:{spzUrls:{...splats},semanticsMetadata:{metricScaleFactor:1.25,groundPlaneOffset:-.5}},mesh:{colliderMeshUrl:'https://assets.test/world/collider.glb',fullResMeshUrl:'https://assets.test/world/full.glb',hqMeshUrl:'https://assets.test/world/hq.glb'},imagery:{panoUrl:'https://assets.test/world/pano.jpg'}}}};}
async function accept(output,{store=memoryStore(),kind=request.kind}={}){
 const service=createDurableGenerationService({store,baseUrl:'https://gateway.test',apiKey:'server-secret',fetchImpl:async()=>reply({id:'provider-task',status:'succeeded',outputs:[output]})});
 const created=await service.submit({...request,kind},{idempotencyKey:'world-output-check'}),job=await service.get(created.id);await service.close();return {job,store};
}

test('Marble SPZ metadata retains all world resources and restores them without posting or polling again',async()=>{
 const output=worldOutput(),{job,store}=await accept(output);assert.equal(job.status,'succeeded');assert.deepEqual(job.outputs,[output]);assert.equal(job.outputs[0].url,output.world.assets.splats.spzUrls['500k']);assert.notEqual(job.outputs[0].url,output.world.assets.mesh.colliderMeshUrl);assert.equal(job.outputs[0].representation,'gaussianSplat');
 const restored=createDurableGenerationService({store,baseUrl:'https://gateway.test',apiKey:'rotated-secret',fetchImpl:()=>assert.fail('terminal output must not dispatch or poll')});
 const result=await restored.lookup('world-output-check');assert.equal(result.status,'succeeded');assert.deepEqual(result.outputs,[output]);assert.equal(result.providerTaskId,'provider-task');assert.equal((await restored.submit(request,{idempotencyKey:'world-output-check'})).id,job.id);await restored.close();
 const record=JSON.stringify([...store.data.values()][0]);assert.ok(!record.includes('server-secret'));assert.ok(!record.includes('rotated-secret'));
});

test('Marble LOD subsets, optional assets and finite semantics preserve exact coordinates without invented conversion',async()=>{
 for(const resolution of ['100k','150k','500k','full_res']){
  const output=worldOutput();output.url=splats[resolution];output.world.splatResolution=resolution;output.world.assets={splats:{spzUrls:{[resolution]:output.url},semanticsMetadata:{metricScaleFactor:1e-6,groundPlaneOffset:0}}};delete output.poster;
  const {job}=await accept(output);assert.equal(job.status,'succeeded');assert.deepEqual(job.outputs[0].world,output.world);assert.equal(job.outputs[0].world.coordinateSystem,'marble_raw_opencv');assert.equal(job.outputs[0].world.assets.mesh,undefined);
 }
 for(const model of ['marble-1.1','marble-1.1-plus','marble-1.0','marble-1.0-draft']){const output=worldOutput();output.world.model=model;const {job}=await accept(output);assert.equal(job.status,'succeeded');assert.equal(job.outputs[0].world.model,model);}
});

test('new GLB format, mesh representation and filename survive durable storage while legacy Tripo output remains compatible',async()=>{
 for(const output of [{type:'model',url:'https://assets.test/chair.glb',format:'glb',representation:'mesh',filename:'真实椅子.glb',sourceFileId:'tripo-task',poster:'https://assets.test/chair.png'},{type:'model',url:'https://assets.test/chair.glb',sourceFileId:'tripo-task',poster:'https://assets.test/chair.png'}]){
  const {job,store}=await accept(output);assert.equal(job.status,'succeeded');assert.deepEqual(job.outputs,[output]);const restored=createDurableGenerationService({store,baseUrl:'https://gateway.test',apiKey:'key',fetchImpl:()=>assert.fail()});assert.deepEqual((await restored.lookup('world-output-check')).outputs,[output]);await restored.close();
 }
});

test('image fullImage is preserved with an allowlisted URL or bounded inline image, and unknown output fields are discarded',async()=>{
 for(const fullImage of ['https://assets.test/full.png','data:image/png;base64,iVBORw0KGgo=']){
  const output={type:'image',image:'https://assets.test/thumbnail.png',fullImage,width:1200,height:800,debug:{privatePath:'/private/debug'},customMedia:{url:'https://other.test'}};
  const {job}=await accept(output,{kind:'image.generate'});assert.equal(job.status,'succeeded');assert.equal(job.outputs[0].fullImage,fullImage);assert.equal(job.outputs[0].debug,undefined);assert.equal(job.outputs[0].customMedia,undefined);
 }
});

test('malformed or contradictory world metadata stays unknown without exposing a partial world',async()=>{
 const mutations=[
  output=>{output.world=[];},output=>{output.type='image';},output=>{output.format='glb';},output=>{output.representation='mesh';},
  output=>{output.sourceFileId='other-world';},output=>{output.world.worldId='..';output.sourceFileId='..';},output=>{output.world.worldId='world/secret';output.sourceFileId='world/secret';},
  output=>{output.world.model='unknown-model';},output=>{output.world.coordinateSystem='converted_y_up';},output=>{output.world.splatResolution='1m';},output=>{delete output.world.splatResolution;},
  output=>{output.world.assets.splats.spzUrls={};},output=>{output.world.assets.splats.spzUrls['other']='https://assets.test/other.spz';},
  output=>{delete output.world.assets.splats.spzUrls['500k'];},output=>{output.url=output.world.assets.mesh.colliderMeshUrl;},output=>{output.url=output.world.assets.mesh.colliderMeshUrl;output.world.assets.splats.spzUrls['500k']=output.url;},output=>{output.world.assets.splats.spzUrls['100k']='https://assets.test/world/mesh.obj';},
  output=>{output.world.assets.splats.semanticsMetadata.metricScaleFactor=0;},output=>{output.world.assets.splats.semanticsMetadata.metricScaleFactor=-1;},output=>{output.world.assets.splats.semanticsMetadata.metricScaleFactor=NaN;},
  output=>{output.world.assets.splats.semanticsMetadata.groundPlaneOffset=Infinity;},output=>{output.world.assets.splats.semanticsMetadata.groundPlaneOffset='0';},
  output=>{delete output.world.assets.splats.semanticsMetadata;},output=>{output.world.assets.mesh=null;},output=>{output.world.assets.mesh.colliderMeshUrl=null;},
  output=>{output.world.assets.imagery={};},output=>{output.world.assets.imagery.panoUrl=[];},output=>{output.world.extra={privatePath:'/private/test'};},
  output=>{output.world.assets.extra={url:'https://assets.test/untrusted'};},output=>{output.world.assets.splats.semanticsMetadata.transform=[1,0,0];},
  output=>{output.world.assets.mesh.bounds={min:[0,0,0]};},output=>{output.world.assets.imagery.width=1000;}
 ];
 for(const mutate of mutations){const output=worldOutput();mutate(output);const {job}=await accept(output);assert.equal(job.status,'unknown');assert.equal(job.code,'invalid_outputs');assert.equal(job.outputs,undefined);}
});

test('every newly retained world URL rejects credentials, nonpublic hosts, unsupported schemes and excessive lengths',async()=>{
 const locations=[output=>({owner:output,key:'url'}),output=>({owner:output,key:'poster'}),output=>({owner:output.world,key:'marbleUrl'}),output=>({owner:output.world.assets.splats.spzUrls,key:'100k'}),output=>({owner:output.world.assets.mesh,key:'colliderMeshUrl'}),output=>({owner:output.world.assets.mesh,key:'fullResMeshUrl'}),output=>({owner:output.world.assets.mesh,key:'hqMeshUrl'}),output=>({owner:output.world.assets.imagery,key:'panoUrl'})];
 const unsafe=['http://assets.test/world.spz','https://user:secret@assets.test/world.spz','https://localhost/world.spz','https://localhost./world.spz','https://127.0.0.1/world.spz','https://10.1.2.3/world.spz','https://192.168.1.1/world.spz','https://172.16.0.1/world.spz','https://169.254.169.254/world.spz','https://100.64.0.1/world.spz','https://[::1]/world.spz','file:///private/world.spz','data:model/spz;base64,AAAA','javascript:alert(1)','https://assets.test/'+('x'.repeat(8192))];
 for(const locate of locations)for(const url of unsafe){const output=worldOutput(),{owner,key}=locate(output);owner[key]=url;const {job}=await accept(output);assert.equal(job.status,'unknown');assert.equal(job.code,'invalid_outputs');assert.equal(job.outputs,undefined);}
});

test('invalid format, representation, filename and fullImage are rejected rather than persisted as arbitrary metadata',async()=>{
 for(const patch of [{format:{extension:'spz'}},{format:'exe'},{representation:{type:'mesh'}},{representation:'unknown'},{filename:'../world.spz'},{filename:'world\\file.spz'},{filename:'world\n.spz'},{filename:'.'},{filename:'world.glb'},{filename:'x'.repeat(256)+'.spz'}]){const {job}=await accept({...worldOutput(),...patch});assert.equal(job.status,'unknown');assert.equal(job.code,'invalid_outputs');}
 for(const fullImage of [{url:'https://assets.test/full.png'},'https://user:secret@assets.test/full.png','http://127.0.0.1/full.png','data:text/html;base64,AAAA','data:image/svg+xml;base64,AAAA','blob:https://assets.test/id']){const {job}=await accept({type:'image',url:'https://assets.test/thumb.png',fullImage},{kind:'image.generate'});assert.equal(job.status,'unknown');assert.equal(job.code,'invalid_outputs');}
 const contradictory=await accept({type:'model',url:'https://assets.test/chair.glb',format:'glb',representation:'gaussianSplat'});assert.equal(contradictory.job.code,'invalid_outputs');
});

test('secret-shaped nested fields are rejected, and corrupt restored world metadata is recoverable only by original task lookup',async()=>{
 const secret=worldOutput();secret.world.assets.splats.apiKey='private-server-key';const invalid=await accept(secret);assert.equal(invalid.job.status,'unknown');assert.equal(invalid.job.code,'credentials_forbidden');assert.equal(JSON.stringify([...invalid.store.data.values()]).includes('private-server-key'),false);
 const {job,store}=await accept(worldOutput()),saved=store.data.get(job.id);saved.outputs[0].world.assets.splats.semanticsMetadata.metricScaleFactor=0;store.data.set(job.id,saved);let reads=0;
 const restored=createDurableGenerationService({store,baseUrl:'https://gateway.test',apiKey:'key',fetchImpl:async(_url,options)=>{assert.equal(options.method,'GET');reads++;return reply({id:'provider-task',status:'succeeded',outputs:[worldOutput()]});}});await restored.ready;assert.equal(store.data.get(job.id).status,'unknown');assert.equal(store.data.get(job.id).code,'stored_outputs_invalid');assert.equal(store.data.get(job.id).outputs,undefined);const recovered=await restored.lookup('world-output-check');assert.equal(recovered.status,'succeeded');assert.equal(reads,1);assert.deepEqual(recovered.outputs,[worldOutput()]);await restored.close();
});
