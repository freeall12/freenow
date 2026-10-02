// Grid shader and parameters from official page-BLLZVxQI.js; no official application code is executed.
import * as THREE from "three";
export class GroundGrid extends THREE.Mesh {
  constructor() {
    super(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, uniforms: { inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() }, viewProjection: { value: new THREE.Matrix4() }, eye: { value: new THREE.Vector3() }, pixelRatio: { value: 1 }, fadeDistance: { value: 100 } }, vertexShader: `
          uniform mat4 inverseProjection;
          uniform mat4 cameraWorld;
          varying vec3 rayNear;
          varying vec3 rayFar;
          vec3 unproject(vec2 point, float depth) {
            vec4 world = cameraWorld * inverseProjection * vec4(point, depth, 1.0);
            return world.xyz / world.w;
          }
          void main() {
            rayNear = unproject(position.xy, -1.0);
            rayFar = unproject(position.xy, 1.0);
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `, fragmentShader: `
          uniform mat4 viewProjection;
          uniform vec3 eye;
          uniform float pixelRatio;
          uniform float fadeDistance;
          varying vec3 rayNear;
          varying vec3 rayFar;

          float grid(vec2 point, float spacing) {
            vec2 coordinate = point / spacing;
            vec2 width = max(fwidth(coordinate), vec2(0.000001));
            vec2 pixels = abs(fract(coordinate - 0.5) - 0.5) / width;
            float coverage = 1.0 - smoothstep(0.0, pixelRatio, min(pixels.x, pixels.y));
            // Fade sub-pixel cells before they can form a moire pattern near the horizon.
            return coverage * smoothstep(2.0, 6.0, 1.0 / (max(width.x, width.y) * pixelRatio));
          }
          void main() {
            vec3 ray = rayFar - rayNear;
            if (abs(ray.y) < 0.000001) discard;
            float t = -rayNear.y / ray.y;
            if (t <= 0.0 || t >= 1.0) discard;
            vec3 world = rayNear + t * ray;
            vec4 clip = viewProjection * vec4(world, 1.0);
            gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;

            float footprint = max(length(dFdx(world.xz)), length(dFdy(world.xz))) * pixelRatio;
            float level = max(-2.0, log(max(footprint * 16.0, 0.00001)) / log(10.0));
            float spacing = pow(10.0, floor(level));
            float blend = fract(level);
            float fine = grid(world.xz, spacing) * 0.10 * (1.0 - blend);
            float medium = grid(world.xz, spacing * 10.0) * mix(0.22, 0.10, blend);
            float coarse = grid(world.xz, spacing * 100.0) * 0.22;
            float alpha = max(fine, max(medium, coarse));
            vec3 color = vec3(0.28);

            vec2 axisPixels = abs(world.xz) / max(fwidth(world.xz), vec2(0.000001));
            float xAxis = 1.0 - smoothstep(0.0, pixelRatio * 1.3, axisPixels.y);
            float zAxis = 1.0 - smoothstep(0.0, pixelRatio * 1.3, axisPixels.x);
            color = mix(color, vec3(0.56, 0.23, 0.22), xAxis);
            color = mix(color, vec3(0.22, 0.37, 0.56), zAxis);
            alpha = max(alpha, max(xAxis, zAxis) * 0.55);
            alpha *= 1.0 - smoothstep(fadeDistance * 0.35, fadeDistance, length(world.xz - eye.xz));
            if (alpha < 0.003) discard;
            gl_FragColor = vec4(color, alpha);
            #include <colorspace_fragment>
          }
        ` })), this.name = "Studio ground grid", this.frustumCulled = false, this.renderOrder = -1;
  }
  update(e, t) {
    const i = this.material.uniforms;
    i.inverseProjection.value.copy(e.projectionMatrixInverse), i.cameraWorld.value.copy(e.matrixWorld), i.viewProjection.value.multiplyMatrices(e.projectionMatrix, e.matrixWorldInverse), i.eye.value.setFromMatrixPosition(e.matrixWorld), i.pixelRatio.value = t, i.fadeDistance.value = Math.min(e.far * 0.8, Math.max(30, Math.abs(i.eye.value.y) * 12));
  }
  dispose() {
    this.geometry.dispose(), this.material.dispose();
  }
}
