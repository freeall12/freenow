const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('three'),import('../src/features/studio-v2/display-materials.mjs')]);
async function fixture(t){
  const [THREE,{DisplayMaterials}]=await modules,display=new DisplayMaterials(),root=new THREE.Group(),geometry=new THREE.BoxGeometry();
  const white=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),unchanged=new THREE.MeshBasicMaterial({color:0xff0000});
  t.after(()=>{display.dispose();geometry.dispose();white.dispose();unchanged.dispose();});
  const mesh=material=>{const object=new THREE.Mesh(geometry,material);root.add(object);return object;};
  return {THREE,display,root,white,unchanged,mesh};
}

test('unchanged materials avoid all per-render material assignments',async t=>{
  const f=await fixture(t),single=f.mesh(f.unchanged),array=f.mesh([f.unchanged,f.unchanged]);
  let writes=0;
  for(const object of [single,array]){let material=object.material;Object.defineProperty(object,'material',{get:()=>material,set:value=>{writes++;material=value;}});}
  for(let i=0;i<120;i++)f.display.render(f.root,()=>{});
  assert.equal(writes,0);
});

test('white model materials are temporary and stable multi-material arrays are reused across frames',async t=>{
  const f=await fixture(t),original=[f.white,f.unchanged],object=f.mesh(original);let first;
  for(let i=0;i<120;i++){
    assert.equal(f.display.render(f.root,()=>{
      assert.notEqual(object.material,original);assert.equal(object.material[0].type,'MeshPhongMaterial');assert.equal(object.material[1],f.unchanged);
      if(first)assert.equal(object.material,first);else first=object.material;
      return 'rendered';
    }),'rendered');
    assert.equal(object.material,original);
  }
});

test('in-place array edits, new array assignments and topology changes are visible on the next render',async t=>{
  const f=await fixture(t),original=[f.white],object=f.mesh(original);
  f.display.render(f.root,()=>assert.equal(object.material[0].type,'MeshPhongMaterial'));
  original[0]=f.unchanged;
  f.display.render(f.root,()=>assert.equal(object.material,original));
  original.push(f.white);
  f.display.render(f.root,()=>{assert.equal(object.material[0],f.unchanged);assert.equal(object.material[1].type,'MeshPhongMaterial');});
  object.material=[f.white,f.white];const replacement=object.material,added=f.mesh(f.white);
  f.display.render(f.root,()=>{assert.equal(object.material.length,2);assert.equal(added.material.type,'MeshPhongMaterial');});
  assert.equal(object.material,replacement);assert.equal(added.material,f.white);
  added.removeFromParent();
  f.display.render(f.root,()=>assert.equal(added.material,f.white));
});

test('render and traversal failures restore original materials and nested renders preserve the outer view',async t=>{
  const f=await fixture(t),object=f.mesh([f.white]),original=object.material;
  assert.throws(()=>f.display.render(f.root,()=>{throw new Error('GPU failure');}),/GPU failure/);
  assert.equal(object.material,original);
  const brokenRoot={traverse(callback){callback(object);throw new Error('traversal failure');}};
  assert.throws(()=>f.display.render(brokenRoot,()=>{}),/traversal failure/);assert.equal(object.material,original);
  f.display.render(f.root,()=>{const outer=object.material;f.display.render(f.root,()=>assert.equal(object.material,outer));assert.equal(object.material,outer);});
  assert.equal(object.material,original);
});

test('dispose releases replacement materials and invalidates array caches',async t=>{
  const f=await fixture(t),object=f.mesh([f.white]);let first,disposals=0;
  f.display.render(f.root,()=>{first=object.material[0];first.addEventListener('dispose',()=>disposals++);});
  f.display.dispose();assert.equal(disposals,1);
  f.display.render(f.root,()=>assert.notEqual(object.material[0],first));
});
