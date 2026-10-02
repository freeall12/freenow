import * as THREE from 'three';

// Official Studio uc: sample each interval separately so cuts have no travel path.
export class MotionOverlay extends THREE.Group {
  constructor(){super();this.positions=[];this.selected=-1;this.visible=false;}
  rebuild(times,evaluate){
    this.clearGeometry();this.positions=times.map(time=>new THREE.Vector3().setFromMatrixPosition(evaluate(time)));
    const positions=[],duration=times.at(-1)||1;
    for(let i=0;i<times.length-1;i++){
      const start=times[i],end=times[i+1],count=Math.max(2,Math.min(80,Math.ceil((end-start)/duration*512)));
      let previous=new THREE.Vector3().setFromMatrixPosition(evaluate(start));
      for(let j=1;j<=count;j++){
        const time=j===count?Math.max(start,end-Math.min(1e-6,(end-start)/1e4)):start+(end-start)*j/count;
        const point=new THREE.Vector3().setFromMatrixPosition(evaluate(time));
        positions.push(...previous.toArray(),...point.toArray());previous=point;
      }
    }
    const line=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3)),new THREE.LineBasicMaterial({color:8640493,transparent:true,opacity:.9,depthTest:false}));
    line.renderOrder=990;
    const geometry=new THREE.BufferGeometry().setFromPoints(this.positions);geometry.computeBoundingSphere();
    geometry.setAttribute('markerSelected',new THREE.Float32BufferAttribute(new Float32Array(this.positions.length),1));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(this.positions.flatMap(()=>[.51,.84,.93]),3));
    const material=new THREE.PointsMaterial({size:Math.max(.025,(geometry.boundingSphere?.radius||0)/60),sizeAttenuation:true,vertexColors:true,depthTest:false,depthWrite:false,transparent:true,toneMapped:false});
    const pixelRatio={value:1};
    material.onBeforeCompile=shader=>{
      shader.uniforms.markerPixelRatio=pixelRatio;
      shader.vertexShader='uniform float markerPixelRatio;\nattribute float markerSelected;\n'+shader.vertexShader.replace('#include <logdepthbuf_vertex>',`gl_PointSize = clamp(gl_PointSize * projectionMatrix[1][1] * mix(1.0, 1.4, markerSelected),
        mix(2.0, 4.0, markerSelected) * markerPixelRatio, 6.0 * markerPixelRatio);
        #include <logdepthbuf_vertex>`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_particle_fragment>',`#include <map_particle_fragment>
        float markerRadius = length(gl_PointCoord - vec2(0.5));
        if (markerRadius > 0.5) discard;
        diffuseColor.a *= 1.0 - smoothstep(0.35, 0.5, markerRadius);`);
    };
    this.points=new THREE.Points(geometry,material);this.points.renderOrder=991;
    this.points.onBeforeRender=renderer=>{pixelRatio.value=renderer.getPixelRatio();};
    this.add(line,this.points);this.select(this.selected);
  }
  select(index){
    this.selected=index;const colors=this.points?.geometry.getAttribute('color'),selection=this.points?.geometry.getAttribute('markerSelected');
    for(let i=0;colors&&i<colors.count;i++){const color=new THREE.Color(i===index?16764538:8640493);colors.setXYZ(i,color.r,color.g,color.b);selection.setX(i,i===index?1:0);}
    if(colors)colors.needsUpdate=true;if(selection)selection.needsUpdate=true;
  }
  clearGeometry(){for(const object of this.children.slice()){object.geometry.dispose();object.material.dispose();object.removeFromParent();}this.points=null;}
  dispose(){this.clearGeometry();this.positions=[];this.removeFromParent();}
}
