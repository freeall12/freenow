import * as THREE from 'three';
// Matches the current official scene navigation: local-axis WASDQE, 3x Shift, 0.003 drag sensitivity.
export class Navigation {
  constructor(camera, canvas) {
    this.camera=camera;this.canvas=canvas;this.enabled=true;this.speed=3;this.keys=new Set();this.drag=null;this.abort=new AbortController();this.rotation=new THREE.Euler(0,0,0,'YXZ');this.direction=new THREE.Vector3();
    const options={signal:this.abort.signal},allowed=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight']);
    canvas.addEventListener('keydown',e=>{if(!this.enabled||!allowed.has(e.code)||e.metaKey||e.ctrlKey||e.altKey||e.isComposing)return;e.preventDefault();e.stopPropagation();this.keys.add(e.code);},options);
    canvas.addEventListener('keyup',e=>this.keys.delete(e.code),options);
    for(const target of [canvas,window])target.addEventListener('blur',()=>this.reset(),options);
    document.addEventListener('visibilitychange',()=>this.reset(),options);
    canvas.addEventListener('pointerdown',e=>{if(!this.enabled||e.button!==0)return;canvas.focus({preventScroll:true});this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);},options);
    canvas.addEventListener('pointermove',e=>{if(!this.enabled||this.drag?.id!==e.pointerId)return;this.rotation.setFromQuaternion(camera.quaternion);this.rotation.y-=(e.clientX-this.drag.x)*.003;this.rotation.x=Math.max(-Math.PI/2+.01,Math.min(Math.PI/2-.01,this.rotation.x-(e.clientY-this.drag.y)*.003));camera.quaternion.setFromEuler(this.rotation);this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};},options);
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>this.resetDrag(),options);
    canvas.addEventListener('wheel',e=>{if(!this.enabled)return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);camera.translateZ(Math.max(-1,Math.min(1,delta/300))*this.speed);},{...options,passive:false});
  }
  resetDrag(){const old=this.drag;this.drag=null;if(old&&this.canvas.hasPointerCapture(old.id))this.canvas.releasePointerCapture(old.id);}
  reset(){this.keys.clear();this.resetDrag();}
  update(dt){if(!this.enabled)return;const k=code=>Number(this.keys.has(code));this.direction.set(k('KeyD')-k('KeyA'),k('KeyE')-k('KeyQ'),k('KeyS')-k('KeyW'));this.direction.normalize().applyQuaternion(this.camera.quaternion).multiplyScalar(this.speed*(k('ShiftLeft')||k('ShiftRight')?3:1)*dt);this.camera.position.add(this.direction);}
  dispose(){this.reset();this.abort.abort();}
}
