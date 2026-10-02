import * as THREE from 'three';
// Official white-model viewport treatment. Swap only during render; exports keep original PBR materials.
export class DisplayMaterials {
  constructor(){this.cache=new Map();this.arrays=new WeakMap();this.frames=[];}
  get(material){if(this.cache.has(material))return this.cache.get(material);let display=material;
    if(material.type==='MeshStandardMaterial'&&!Object.values(material).some(value=>value?.isTexture)&&!Object.keys(material.userData?.gltfExtensions||{}).length){const {r,g,b}=material.color;if(Math.max(r,g,b)-Math.min(r,g,b)<=.03&&Math.min(r,g,b)>=.2&&!material.transparent&&material.opacity===1&&!material.vertexColors&&material.emissive.getHex()===0&&material.metalness===0&&material.roughness>=.8)display=new THREE.MeshPhongMaterial({name:material.name,color:material.color.clone().multiplyScalar(.65),specular:0x111111,shininess:20,side:material.side,flatShading:material.flatShading,depthWrite:material.depthWrite,depthTest:material.depthTest,toneMapped:material.toneMapped});}
    this.cache.set(material,display);return display;
  }
  display(material){
    if(!Array.isArray(material))return this.get(material);
    let entry=this.arrays.get(material);
    // Material arrays can be edited in place while importing or editing a model.
    if(!entry||entry.sources.length!==material.length||material.some((value,index)=>value!==entry.sources[index])){
      const display=material.map(value=>this.get(value));
      entry={sources:material.slice(),display:display.some((value,index)=>value!==material[index])?display:material};
      this.arrays.set(material,entry);
    }
    return entry.display;
  }
  render(root,render){
    // Reuse flat restoration buffers; a nested preview render needs its own buffer.
    const originals=this.frames.pop()||[];
    try{
      root.traverse(object=>{if(!object.isMesh)return;const material=object.material,display=this.display(material);if(display===material)return;originals.push(object,material);object.material=display;});
      return render();
    }finally{
      for(let i=0;i<originals.length;i+=2)originals[i].material=originals[i+1];
      originals.length=0;this.frames.push(originals);
    }
  }
  dispose(){for(const [original,display] of this.cache)if(original!==display)display.dispose();this.cache.clear();this.arrays=new WeakMap();this.frames.length=0;}
}
