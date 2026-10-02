const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=import('../studio-placement.mjs'),three=import('three'),catalog=import('../studio-library-data.mjs');
test('all 63 sample models and previews are local, validated resources with original scale',async()=>{
 const {studioLibrary}=await catalog;assert.equal(studioLibrary.length,9);const items=studioLibrary.flatMap(g=>g.assets);assert.equal(items.length,63);assert.equal(new Set(items.map(i=>i.id)).size,63);
 for(const item of items){assert.ok(item.scale>0);const bytes=fs.readFileSync(path.join(__dirname,'..',item.model));assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(8),bytes.length);const image=fs.readFileSync(path.join(__dirname,'..',item.preview));assert.ok(image.length>100);assert.ok(image.toString('ascii',0,4)==='RIFF'||image[0]===137||image[0]===255);}
});
test('sample placement preserves original scale and exact world position without mutating catalog',async()=>{
 const {sampleProperties}=await source,{studioLibrary}=await catalog;const asset=studioLibrary[0].assets[0],position=[1.123,-1.7,3.456];const props=sampleProperties(asset.id,{position,materialMode:'clay'});assert.deepEqual(props.position,position);assert.deepEqual(props.scale,[asset.scale,asset.scale,asset.scale]);position[0]=99;assert.equal(props.position[0],1.123);assert.equal(props.materialMode,'clay');assert.throws(()=>sampleProperties('../unknown'),/不存在/);assert.throws(()=>sampleProperties(asset.id,{position:[Infinity,0,0]}),/位置/);assert.throws(()=>sampleProperties(asset.id,{materialMode:'exec'}),/材质/);
});
test('placement ray accounts for viewport offset and hits surfaces before the ground',async()=>{
 const {placementRay,placementSurface}=await source,{PerspectiveCamera,Mesh,BoxGeometry,MeshBasicMaterial}=await three;
 const camera=new PerspectiveCamera(50,2,.03,1000);camera.position.set(0,5,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();const ray=placementRay({x:500,y:400},{left:100,top:200,width:800,height:400},camera),ground=placementSurface(ray,{groundY:0});assert.ok(ground.length()<1e-8);
 const box=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());box.position.y=1;box.updateMatrixWorld();const hit=placementSurface(ray,{surfaces:[box],groundY:0});assert.ok(hit.y>0);assert.ok(placementSurface(ray,{surfaces:[box],groundY:0,groundOnly:true}).length()<1e-8);
});
test('sample tools reject unbounded positions before scene dispatch',()=>{const tools=require('../agent-tools.js');assert.throws(()=>tools.parse('scene_sample',{sampleId:'tree',position:[10001,0,0]}),/number/);assert.equal(tools.parse('scene_library',{query:'树'}).definition.mutates,false);assert.equal(tools.parse('scene_sample',{sampleId:'tree',position:[0,0,0]}).definition.mutates,true);});

test('cancelled or superseded model loads never attach a late preview',async()=>{
 const {installPlacement}=await source;class Fixture{};installPlacement(Fixture,{el:()=>({append(){}}),button:()=>({})});
 const pending=[],attached=[],disposed=[];const studio=new Fixture();Object.assign(studio,{data:{activeSetup:'setup-a'},root:{querySelector(){return null;},classList:{add(){},remove(){}},append(){}},transform:{detach(){}},scene:{add(item){attached.push(item);},remove(){}},notify(){},buildObject(){return new Promise(resolve=>pending.push(resolve));},disposeObject(item){disposed.push(item);}});
 const first=studio.beginPlacement('model',{name:'First'});studio.cancelPlacement();pending.shift()({root:{visible:true}});await first;assert.equal(attached.length,0);assert.equal(disposed.length,1);
 const old=studio.beginPlacement('model',{name:'Old'}),next=studio.beginPlacement('model',{name:'Current'});const oldItem={root:{}},nextItem={root:{}};pending.shift()(oldItem);pending.shift()(nextItem);await Promise.all([old,next]);assert.deepEqual(attached,[nextItem.root]);assert.ok(disposed.includes(oldItem));assert.equal(studio.placement.properties.name,'Current');studio.cancelPlacement();assert.ok(disposed.includes(nextItem));assert.equal(studio.placement,null);
});


test('world ground wins over geometry below it and ignores hidden ancestors',async()=>{
 const {placementRay,placementSurface}=await source,{PerspectiveCamera,Mesh,BoxGeometry,MeshBasicMaterial,Group}=await three;
 const camera=new PerspectiveCamera(50,1,.03,100);camera.position.set(0,5,0);camera.lookAt(0,0,0);const ray=placementRay({x:50,y:50},{left:0,top:0,width:100,height:100},camera);
 const box=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());box.position.y=-1.006;box.updateMatrixWorld();assert.equal(placementSurface(ray,{surfaces:[box],groundY:0}).y,0);
 const hidden=new Group();hidden.visible=false;box.position.y=1;hidden.add(box);hidden.updateMatrixWorld(true);assert.equal(placementSurface(ray,{surfaces:[hidden],groundY:0}).y,0);
});
