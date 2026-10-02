import * as THREE from 'three';
import {binding, isolateCamera, motionTracks, keyTimes, worldPose, editWorldPose} from './motion-data.mjs';
import {syncEasing} from './motion-easing.mjs';
import {exportGlb} from './model-io.mjs';

const fields = ['position', 'rotation', 'scale'];
const transformFields = ['position', 'quaternion', 'scale'];
const find = (root, id) => {
  let result;
  root.traverse(node => { if (node.userData.studioId === id) result = node; });
  return result;
};

export function describeKeyframes(runtime) {
  const catalog = runtime.playback.catalog();
  return runtime.animations.map((clip, index) => {
    const targets = new Map();
    for (const track of clip.tracks) {
      const {node, field} = binding(runtime.content, track);
      if (!node?.userData.studioId || !transformFields.includes(field)) continue;
      const tracks = targets.get(node.userData.studioId) || [];
      tracks.push(track);
      targets.set(node.userData.studioId, tracks);
    }
    return {index, name: clip.name, duration: clip.duration,
      cameraIds: catalog[index]?.cameraIds || [],
      keyframeTargets: [...targets].map(([entityId, tracks]) => ({entityId, times: keyTimes(tracks)}))};
  });
}

function validate(args) {
  if (!Number.isFinite(args.time) || args.time < 0 || args.time > 120) throw Error('关键帧时间必须在 0 到 120 秒之间');
  if (args.space !== undefined && !['parent-local', 'world'].includes(args.space)) throw Error('关键帧坐标空间无效');
  if (args.animationIndex !== undefined && (!Number.isInteger(args.animationIndex) || args.animationIndex < 0)) throw Error('动画索引无效');
  if (args.pose !== undefined) {
    if (!args.pose || typeof args.pose !== 'object' || Array.isArray(args.pose) || !Object.keys(args.pose).length) throw Error('关键帧姿态不能为空');
    for (const [field, value] of Object.entries(args.pose)) {
      if (!fields.includes(field) || !Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw Error('关键帧姿态必须为有效的三维变换');
      if (field === 'scale' && value.some(n => Math.abs(n) < 1e-10)) throw Error('关键帧缩放不能为零');
    }
  }
}

function localPose(root, target, tracks, time) {
  const p = target.position.clone(), q = target.quaternion.clone(), s = target.scale.clone();
  for (const track of tracks) {
    const {node, field} = binding(root, track);
    if (node === target) ({position: p, quaternion: q, scale: s})[field].fromArray(track.createInterpolant().evaluate(time));
  }
  return new THREE.Matrix4().compose(p, q.normalize(), s);
}

function overridePose(matrix, patch) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  matrix.decompose(p, q, s);
  const reconstructed = new THREE.Matrix4().compose(p, q, s);
  if (matrix.elements.some((value, i) => Math.abs(value - reconstructed.elements[i]) > 1e-4 * Math.max(1, Math.abs(value)))) throw Error('变换包含剪切，无法安全编辑世界姿态');
  if (patch.position) p.fromArray(patch.position);
  if (patch.rotation) q.setFromEuler(new THREE.Euler(...patch.rotation.map(THREE.MathUtils.degToRad), 'XYZ'));
  if (patch.scale) s.fromArray(patch.scale);
  const result = new THREE.Matrix4().compose(p, q.normalize(), s);
  if (!result.elements.every(Number.isFinite)) throw Error('关键帧姿态无效');
  return result;
}

export async function saveSceneKeyframe(runtime, args) {
  runtime.assertReady();
  validate(args);
  const id = args.entityId ?? runtime.selected?.userData.studioId ?? runtime.shotId;
  const source = runtime.find(id);
  if (!source || source === runtime.content) throw Error('请先选择要设置关键帧的对象');
  let renderable = false;
  source.traverse(node => { if (node.isMesh || node.isBone || node.isLight) renderable = true; });
  if (!source.isCamera && !renderable) throw Error('此对象不支持关键帧播放，请选择镜头、模型、骨骼、光源或包含这些内容的组');
  const revision = runtime.revision, time = Math.fround(args.time), space = args.space ?? 'parent-local';
  source.updateWorldMatrix(true, false);
  // Capture the current object pose before any await; omitted pose retains the original tool contract.
  const captured = space === 'world' ? source.matrixWorld.clone() : source.matrix.clone();
  const root = runtime.playback.document(), clips = runtime.animations.map(clip => clip.clone());
  let target = find(root, id);
  const candidates = clips.map((clip, index) => motionTracks(root, target, clip).length ? index : -1).filter(index => index >= 0);
  const active = source.isCamera ? runtime.motionIndex : runtime.playback.index;
  let index = args.animationIndex;
  if (index !== undefined && !clips[index]) throw Error('指定动画不存在');
  if (index === undefined) {
    if (candidates.includes(active)) index = active;
    else if (candidates.length === 1) index = candidates[0];
    else if (candidates.length > 1) throw Error('此对象有多个动画，请指定 animationIndex');
    else { index = clips.length; clips.push(new THREE.AnimationClip((source.name || '对象') + (source.isCamera ? ' 运镜' : ' 动画'), 0, [])); }
  }
  if (target.isCamera) target = isolateCamera(root, target, clips);
  const clip = clips[index], tracks = motionTracks(root, target, clip);
  let pose;
  if (args.pose) {
    const base = space === 'world' ? worldPose(root, target, tracks, time) : localPose(root, target, tracks, time);
    pose = overridePose(base, args.pose);
  } else pose = captured;
  if (space === 'parent-local') pose = worldPose(root, target, tracks, time, new Map(), true).multiply(pose);
  // Empty clips need one real sample before the shared editing helper can insert channels.
  if (!tracks.length) {
    clip.tracks.push(new THREE.VectorKeyframeTrack(target.uuid + '.position', [time], target.position.toArray()),
      new THREE.QuaternionKeyframeTrack(target.uuid + '.quaternion', [time], target.quaternion.toArray()),
      new THREE.VectorKeyframeTrack(target.uuid + '.scale', [time], target.scale.toArray()));
  }
  for (const field of transformFields) editWorldPose(root, target, clip, time, pose, field, new Map());
  const updatedTracks = motionTracks(root, target, clip);
  syncEasing(target.isCamera ? updatedTracks : updatedTracks.filter(track => binding(root, track).node === target));
  clip.resetDuration();
  for (const track of clip.tracks) {
    if (!Array.from(track.values).every(Number.isFinite) || Array.from(track.times).some((t, i) => !Number.isFinite(t) || t < 0 || i && t <= track.times[i - 1])) throw Error('关键帧数值超出范围或时间重复');
  }
  await exportGlb(root, clips);
  runtime.assertReady();
  if (runtime.revision !== revision) throw Error('场景已更新，本次关键帧未写入，请重试');
  const snapshot = runtime.snapshot();
  runtime.select(null);
  // Cloned documents reuse geometry/materials; disposing the old root would invalidate the new one.
  runtime.content.removeFromParent();
  runtime.content = root;
  runtime.animations = clips;
  runtime.scene.add(root);
  runtime.select(target);
  if (target.isCamera) { runtime.shotId = id; runtime.motionIndex = index; }
  runtime.playback.select(index, target.isCamera ? 'camera' : 'objects', {play: false});
  runtime.playback.apply(time);
  runtime.recordHistory(snapshot);
  runtime.commit();
  try { await runtime.flush(); }
  catch (error) { error.applied = true; error.entityId = id; error.animationIndex = index; throw error; }
  return {entityId: id, animationIndex: index, time, duration: clip.duration,
    times: keyTimes(updatedTracks), space, playing: false};
}
