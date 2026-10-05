// Spark 2.3.1's real tiny-lod tree preserves the source and merges Gaussians.
// These limits bound drawing/sorting, not decoding or resident source memory.
export const splatLodPolicy=Object.freeze({method:'tiny-lod',targetSplats:250000,minPixelSize:2});
export async function buildSplatLod(mesh){
  if(!(mesh.packedSplats?.lodSplats||mesh.extSplats?.lodSplats))await mesh.createLodSplats({quality:false});
  const source=mesh.packedSplats||mesh.extSplats,tree=source?.lodSplats;
  if(!tree?.extra?.lodTree?.length||!(tree.getNumSplats()>0))throw Error('官方 Gaussian LOD 层级构建失败');
  mesh.enableLod=true;
  mesh.userData.worldLod={method:splatLodPolicy.method,sourceCount:source.getNumSplats(),treeCount:tree.getNumSplats(),treeBytes:tree.extra.lodTree.byteLength};
}

// The SDK's update() fires driveLod() without awaiting its worker. With manual
// accumulation that renders the full source once and can leave export stale.
// This pinned adapter captures the official exclusive task, waits for native
// traversal, and only then lets the context accumulate its selected indices.
export class SplatLodController {
  constructor(spark){
    if(typeof spark.driveLod!=='function'||typeof spark.ensureLodWorker!=='function'||typeof spark.updateLodIndices!=='function')throw Error('Spark 2.3.1 LOD 接口不可用');
    this.spark=spark;spark.enableDriveLod=false;this.updates=0;this.lastUpdateMs=0;
  }
  async select(camera,meshes){
    const spark=this.spark,start=performance.now(),visible=meshes.filter(mesh=>mesh.visible&&camera.layers.test(mesh.layers));
    for(const mesh of visible)mesh.updateWorldMatrix(true,false);
    spark.current.viewToWorld.copy(camera.matrixWorld);spark.lodDirty=true;
    const ensure=spark.ensureLodWorker,own=Object.hasOwn(spark,'ensureLodWorker'),update=spark.updateLodIndices,ownUpdate=Object.hasOwn(spark,'updateLodIndices'),worker=ensure.call(spark);let task;
    // Only the synchronous native dispatch sees this facade. No shared worker
    // or vendor prototype is modified; the returned task has an error owner.
    spark.ensureLodWorker=()=>({tryExclusive:callback=>{task=worker.exclusive(callback);task.catch(()=>{});return task;}});
    spark.updateLodIndices=(meshMap,keyIndices)=>{
      update.call(spark,meshMap,keyIndices);
      // 2.3.1 reuses GPU index textures but leaves their CPU arrays unchanged.
      // Native raycast reads those arrays, so retain the exact native selection.
      for(const [uuid,{indices,lodId}] of Object.entries(keyIndices)){
        const instance=spark.lodInstances.get(meshMap.get(uuid));if(!instance)continue;
        if(instance.indices!==indices)instance.indices.set(indices);instance.lodId=lodId;
        if(!spark.renderer.properties.has(instance.texture))instance.texture.needsUpdate=true;
      }
    };
    try{spark.driveLod({visibleGenerators:visible,camera});if(!task)throw Error('官方 Gaussian LOD 遍历未启动');await task;}finally{
      if(own)spark.ensureLodWorker=ensure;else delete spark.ensureLodWorker;
      if(ownUpdate)spark.updateLodIndices=update;else delete spark.updateLodIndices;
    }
    this.updates++;this.lastUpdateMs=performance.now()-start;
    const selected=visible.reduce((sum,mesh)=>sum+(spark.lodInstances.get(mesh)?.numSplats||0),0);
    if(selected>splatLodPolicy.targetSplats)throw Error('官方 Gaussian LOD 选择超过绘制预算');
  }
  async release(mesh){
    const spark=this.spark,instance=spark.lodInstances.get(mesh);if(instance){instance.texture.dispose();spark.lodInstances.delete(mesh);}
    const splats=mesh.packedSplats?.lodSplats||mesh.extSplats?.lodSplats,record=spark.lodIds.get(splats);
    if(record){spark.lodIds.delete(splats);spark.lodIdToSplats.delete(record.lodId);await spark.lodWorker.exclusive(worker=>worker.call('disposeLodTree',{lodId:record.lodId}));}
  }
  disposeTextures(){
    // In 2.3.1 Spark.dispose clears its live Map iterator before iterating it.
    // Explicitly dispose the index textures while the entries still exist.
    for(const instance of this.spark.lodInstances.values())instance.texture.dispose();this.spark.lodInstances.clear();
  }
  read(meshes){const spark=this.spark;return {...splatLodPolicy,updates:this.updates,lastUpdateMs:this.lastUpdateMs,selectedCount:[...spark.lodInstances].reduce((sum,[mesh,value])=>sum+(meshes.includes(mesh)&&mesh.visible?value.numSplats:0),0),drawCount:spark.display.numSplats,activeCount:spark.activeSplats,sources:meshes.map(mesh=>({...mesh.userData.worldLod,selectedCount:spark.lodInstances.get(mesh)?.numSplats||0,renderedCount:mesh.context?.numSplats.value||0})),workerTrees:spark.lodIds.size,indexTextures:spark.lodInstances.size};}
}
