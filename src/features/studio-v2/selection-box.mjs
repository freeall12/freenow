import {spatialBounds} from '../world-node/splat-io.mjs';
import * as THREE from 'three';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
// Official Studio 2.0 selection: 6px dark border, 3px white foreground.
export class SelectionBox extends THREE.Group {
  constructor(){super();this.bounds=new THREE.Box3();this.geometry=new LineSegmentsGeometry();this.materials=[];const positions=[];for(let axis=0;axis<3;axis++)for(const a of [-.5,.5])for(const b of [-.5,.5]){const start=[0,0,0],end=[0,0,0];start[axis]=-.5;end[axis]=.5;start[(axis+1)%3]=end[(axis+1)%3]=a;start[(axis+2)%3]=end[(axis+2)%3]=b;positions.push(...start,...end);}this.geometry.setPositions(positions);for(const [index,[color,linewidth]] of [[1319723,6],[0xffffff,3]].entries()){const material=new LineMaterial({color,linewidth,depthTest:false,depthWrite:false,toneMapped:false}),line=new LineSegments2(this.geometry,material);line.renderOrder=1000+index;line.frustumCulled=false;this.materials.push(material);this.add(line);}this.visible=false;}
  setFromObject(object){spatialBounds(object,this.bounds);this.visible=!this.bounds.isEmpty();if(this.visible){this.bounds.getCenter(this.position);this.bounds.getSize(this.scale);this.updateMatrixWorld(true);}return this;}
  dispose(){this.geometry.dispose();this.materials.forEach(material=>material.dispose());}
}
