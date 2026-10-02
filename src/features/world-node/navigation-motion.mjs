import * as THREE from 'three';

// Current official world h3/vp/YE/mv/OW, release eb1c357.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, step) => Math.abs(target - value) <= step ? target : value + Math.sign(target - value) * step;
export function wheelSample(event, height) {
  const {deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false} = event;
  const factor = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, height * .8) : 1;
  const horizontal = Math.abs(deltaX), vertical = Math.abs(deltaY);
  const intent = ctrlKey || deltaMode === 1 || deltaMode === 2 ? 'zoom'
    : horizontal > .75 || !Number.isInteger(deltaX) || !Number.isInteger(deltaY) || vertical <= 16 ? 'rotate'
      : horizontal < .75 && vertical >= 48 ? 'zoom' : 'rotate';
  return {x: deltaX * factor, y: deltaY * factor, intent};
}
export function wheelFocal(focal, delta) {return clamp(focal * Math.exp(-delta * .001), 8, 400);}

export class NavigationMotion {
  constructor(camera, {target = null, minDistance = .01, maxDistance = Infinity, movement = false} = {}) {
    this.camera = camera; this.target = target?.clone() || null; this.minDistance = minDistance; this.maxDistance = maxDistance; this.movement = movement;
    this.keys = new Set(); this.viewVelocity = new THREE.Vector2(); this.moveVelocity = new THREE.Vector3(); this.speedMultiplier = 1;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ'); this.offset = new THREE.Vector3(); this.spherical = new THREE.Spherical(); this.forward = new THREE.Vector3(); this.right = new THREE.Vector3(); this.direction = new THREE.Vector3();
    this.drag = {down: false, active: false, dx: 0, dy: 0, vx: 0, vy: 0};
  }
  rotate(yaw, pitch) {
    if (!yaw && !pitch) return;
    const camera = this.camera;
    if (this.target) {
      this.spherical.setFromVector3(this.offset.copy(camera.position).sub(this.target));
      this.spherical.radius = clamp(this.spherical.radius, this.minDistance, this.maxDistance);
      this.spherical.theta += yaw; this.spherical.phi = clamp(this.spherical.phi + pitch, .05, Math.PI - .05);
      camera.position.copy(this.offset.setFromSpherical(this.spherical).add(this.target)); camera.lookAt(this.target);
    } else {
      this.euler.setFromQuaternion(camera.quaternion, 'YXZ'); this.euler.y += yaw; this.euler.x = clamp(this.euler.x + pitch, -Math.PI * .45, Math.PI * .45); camera.quaternion.setFromEuler(this.euler);
    }
    camera.updateMatrixWorld(true);
  }
  reset() {this.keys.clear(); this.viewVelocity.set(0, 0); this.moveVelocity.set(0, 0, 0); this.speedMultiplier = 1; Object.assign(this.drag, {down: false, active: false, dx: 0, dy: 0, vx: 0, vy: 0});}
  get moving() {return this.keys.size > 0 || this.viewVelocity.lengthSq() > 0 || this.moveVelocity.lengthSq() > 0 || this.drag.dx !== 0 || this.drag.dy !== 0 || !this.drag.down && (this.drag.vx !== 0 || this.drag.vy !== 0) || this.speedMultiplier !== 1;}
  tick(delta) {
    const dt = clamp(delta, 0, .05), drag = this.drag;
    let x = 0, y = 0;
    if (drag.active) {x = drag.dx; y = drag.dy; drag.dx = drag.dy = 0;}
    else if (!drag.down) {x = drag.vx; y = drag.vy; drag.vx *= .92; drag.vy *= .92; if (Math.abs(drag.vx) + Math.abs(drag.vy) < .1) drag.vx = drag.vy = 0;}
    this.rotate(-x * .002, -y * .002);
    const k = code => Number(this.keys.has(code)), velocity = this.viewVelocity;
    if (k('ArrowLeft') || k('ArrowRight') || k('ArrowUp') || k('ArrowDown')) {
      velocity.x = approach(velocity.x, (k('ArrowLeft') - k('ArrowRight')) * 1.5, 12 * dt);
      velocity.y = approach(velocity.y, (k('ArrowUp') - k('ArrowDown')) * 1.5, 12 * dt);
    } else {velocity.multiplyScalar(1e-8 ** dt); if (Math.abs(velocity.x) < .005) velocity.x = 0; if (Math.abs(velocity.y) < .005) velocity.y = 0;}
    this.rotate(velocity.x * dt, velocity.y * dt);
    if (this.movement) {
      this.speedMultiplier = approach(this.speedMultiplier, k('ShiftLeft') || k('ShiftRight') ? 5 : 1, 8 * dt);
      this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion); this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.direction.copy(this.forward).multiplyScalar(k('KeyW') - k('KeyS')).addScaledVector(this.right, k('KeyD') - k('KeyA')); this.direction.y += k('KeyE') - k('KeyQ');
      if (this.direction.lengthSq()) this.moveVelocity.copy(this.direction.normalize().multiplyScalar(approach(this.moveVelocity.length(), 3 * this.speedMultiplier, 30 * dt)));
      else {this.moveVelocity.multiplyScalar(1e-8 ** dt); if (this.moveVelocity.length() < .015) this.moveVelocity.set(0, 0, 0);}
      this.camera.position.addScaledVector(this.moveVelocity, dt); this.camera.updateMatrixWorld(true);
    }
    return this.moving;
  }
}
