const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const modules=Promise.all([import('three'),import('../src/features/studio-v2/model-io.mjs'),import('../src/features/studio-v2/runtime.mjs'),import('three/addons/loaders/GLTFLoader.js')]);

async function fixture(t){
  const [THREE,io,{SceneRuntime},{GLTFLoader}]=await modules;
  const previous={window:global.window,ProgressEvent:global.ProgressEvent};
  global.ProgressEvent=class extends Event {constructor(type,fields){super(type);Object.assign(this,fields);}};
  const json=JSON.parse(fs.readFileSync(require.resolve('../qa/studio-v2-multi-scene.gltf'),'utf8'));
  json.materials.push({pbrMetallicRoughness:{baseColorFactor:[0,0,1,1]}});json.accessors.push({...json.accessors[0]});
  json.meshes.push({primitives:[{attributes:{POSITION:4,NORMAL:1},material:1}]});json.nodes[3].mesh=1;
  const text=JSON.stringify(json),bytes=Buffer.from(text+' '.repeat((4-Buffer.byteLength(text)%4)%4)),glb=Buffer.alloc(20+bytes.length);
  glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(bytes.length,12);glb.writeUInt32LE(0x4e4f534a,16);bytes.copy(glb,20);
  const url=URL.createObjectURL(new Blob([glb]));global.window={LocalAssets:{url:async()=>url}};
  let counts=new Map();const original=GLTFLoader.prototype.parseAsync;
  GLTFLoader.prototype.parseAsync=async function(...args){
    const loaded=await original.apply(this,args);counts=new Map();
    const materials=new Set();for(const scene of loaded.scenes)scene.traverse(node=>{if(node.material)materials.add(node.material);});
    for(const material of materials)material.map=new THREE.Texture();
    for(const scene of loaded.scenes)scene.traverse(node=>{for(const resource of [node.geometry,node.material,node.material?.map])if(resource&&!counts.has(resource)){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}});
    return loaded;
  };
  t.after(()=>{GLTFLoader.prototype.parseAsync=original;URL.revokeObjectURL(url);Object.assign(global,previous);});
  return {THREE,io,SceneRuntime,counts:()=>counts};
}

test('default-scene loading releases unique siblings once and leaves chosen shared geometry, material and texture for its owner',async t=>{
  const f=await fixture(t),loaded=await f.io.loadSaved('asset:local'),counts=f.counts(),kept=new Set();
  loaded.scene.traverse(node=>[node.geometry,node.material,node.material?.map].filter(Boolean).forEach(resource=>kept.add(resource)));
  assert.deepEqual(loaded.scenes,[loaded.scene]);assert.equal(kept.size,3);assert.equal(counts.size,6);
  for(const [resource,count] of counts)assert.equal(count,kept.has(resource)?0:1);
  f.io.disposeLoadedModel(loaded);for(const count of counts.values())assert.equal(count,1);
});

test('model, actor and tree quick-add release failed default models and retain applied content through save failure',async t=>{
  const f=await fixture(t);
  for(const [kind,outcome] of [['model','success'],['actor','preflight-failure'],['tree','applied-save-failure']]){
    const content=new f.THREE.Scene(),runtime=Object.assign(Object.create(f.SceneRuntime.prototype),{content,
      async addObject(scene){if(outcome==='preflight-failure')throw Error('preflight');content.add(scene);if(outcome==='applied-save-failure')throw Object.assign(Error('save'),{applied:true});return {id:'added'};}});
    if(outcome==='success')await runtime.add(kind,{modelUrl:'asset:local'});else await assert.rejects(()=>runtime.add(kind),/preflight|save/);
    const counts=f.counts(),retained=new Set();content.traverse(node=>[node.geometry,node.material,node.material?.map].filter(Boolean).forEach(resource=>retained.add(resource)));
    for(const [resource,count] of counts)assert.equal(count,retained.has(resource)?0:1);
    f.io.disposeModel(content);for(const count of counts.values())assert.equal(count,1);
  }
});
