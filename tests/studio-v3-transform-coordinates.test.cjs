const {test} = require('node:test'), assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs'), {createHash} = require('node:crypto'), vm = require('node:vm');
const modules = Promise.all([import('../src/features/studio-v3/transform-coordinates.mjs'), import('three')]);
const ORDERS = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];
const SOURCE = '/Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js';
const SOURCE_SHA = '157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca';
const near = (actual, expected, epsilon = 1e-10) => assert(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected} by ${Math.abs(actual - expected)}`);
const rotation = (order = 'XYZ', x = .63, y = 1.18, z = -.44) => ({x, y, z, order});
const transform = r => ({position: {x: 2, y: -1, z: 5}, rotation: r, scale: {x: 1.2, y: 2, z: -.8}});
function quat(THREE, r) {return new THREE.Quaternion().setFromEuler(new THREE.Euler(r.x, r.y, r.z, r.order ?? 'XYZ'));}
function equivalentQuaternion(actual, expected, epsilon = 1e-10) {
  const a = actual.toArray(), b = expected.toArray();
  const error = Math.min(Math.hypot(...a.map((value, i) => value - b[i])), Math.hypot(...a.map((value, i) => value + b[i])));
  assert(error <= epsilon, `quaternion orientation differs by ${error}`);
}
function orientation(THREE, actual, expected, epsilon) {equivalentQuaternion(quat(THREE, actual), quat(THREE, expected), epsilon);}
function independentHeading(THREE, r) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat(THREE, r));
  return Math.hypot(f.x, f.z) <= 1e-8 ? 0 : Math.atan2(f.x, -f.z);
}
function originalMath(source) {
  // Evaluate only the pinned, pure orientation functions; never execute the app bundle.
  const names = ['GOe', 'HOe', 'zq', 'uE', 'Vq', 'Gq', 'Fu', 'hE', 'vF', 'xF', 'Hq', 'ZOe', 'Uq', 'Wq', 'QOe', 'YOe', 'XOe', 'Cdt', 'Sdt', 'Edt'];
  const functions = names.map(name => {
    const start = source.indexOf(`function ${name}(`); assert(start >= 0, `official ${name} missing`);
    const brace = source.indexOf('{', start); let end = brace + 1, depth = 1;
    while (depth && end < source.length) {if (source[end] === '{') depth++; else if (source[end] === '}') depth--; end++;}
    assert.equal(depth, 0); return source.slice(start, end);
  });
  return vm.runInNewContext(`const XA=2*Math.PI,KOe={x:0,y:0,z:-1},qOe=1e-10;${functions.join('\n')};({${names.join(',')}})`);
}

test('heading uses actual Three rotated -Z, including all six Euler orders and wrap boundaries', async () => {
  const [coordinates, THREE] = await modules;
  assert.deepEqual(coordinates.EULER_ORDERS, ORDERS);
  for (const order of ORDERS) {
    for (const r of [rotation(order), rotation(order, -.91, -2.37, .52), rotation(order, 0, Math.PI - 1e-9, 0)]) {
      near(coordinates.rotationHeading(r), independentHeading(THREE, r));
    }
    near(coordinates.rotationHeading(rotation(order, 0, .7, 0)), -.7);
  }
  near(coordinates.wrapHeading(Math.PI), -Math.PI);
  near(coordinates.headingDelta(Math.PI - .02, -Math.PI + .03), .05);
  near(coordinates.headingDelta(-Math.PI + .03, Math.PI - .02), -.05);
});

test('heading setters left-multiply global Y yaw and preserve vertical forward component and Euler order', async () => {
  const [coordinates, THREE] = await modules;
  for (const order of ORDERS) for (const target of [-2.72, -.52, 0, 1.37, Math.PI + .15]) {
    const r = rotation(order), before = structuredClone(r), heading = independentHeading(THREE, r);
    const delta = ((target - heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -delta).multiply(quat(THREE, r));
    const actual = coordinates.setRotationHeading(r, target);
    equivalentQuaternion(quat(THREE, actual), expected);
    near(coordinates.rotationHeading(actual), coordinates.wrapHeading(target));
    near(new THREE.Vector3(0, 0, -1).applyQuaternion(quat(THREE, actual)).y, new THREE.Vector3(0, 0, -1).applyQuaternion(quat(THREE, r)).y);
    assert.equal(actual.order, order); assert.deepEqual(r, before);
  }
});

test('xF reflection targets negative heading, differs from heading removal and Euler-Y negation', async () => {
  const [coordinates, THREE] = await modules;
  for (const order of ORDERS) {
    const r = rotation(order), reflected = coordinates.reflectRotationHeading(r);
    near(coordinates.rotationHeading(reflected), -coordinates.rotationHeading(r));
    orientation(THREE, coordinates.reflectRotationHeading(reflected), r);
  }
  const r = rotation(), reflected = quat(THREE, coordinates.reflectRotationHeading(r));
  assert(reflected.angleTo(quat(THREE, coordinates.setRotationHeading(r, 0))) > .1);
  assert(reflected.angleTo(quat(THREE, {...r, y: -r.y})) > .1);
});

test('actor transforms convert both directions; props remain oriented unchanged with detached snapshots', async () => {
  const [coordinates, THREE] = await modules;
  for (const kind of ['actor', 'prop']) for (const order of ORDERS) {
    const stored = transform(rotation(order)), before = structuredClone(stored);
    const world = coordinates.entityTransformToWorld(kind, stored), read = coordinates.entityTransformFromWorld(kind, world);
    orientation(THREE, read.rotation, stored.rotation);
    orientation(THREE, world.rotation, kind === 'actor' ? coordinates.reflectRotationHeading(stored.rotation) : stored.rotation);
    assert.deepEqual(world.position, stored.position); assert.deepEqual(world.scale, stored.scale);
    assert.notEqual(world, stored); assert.notEqual(world.position, stored.position); assert.notEqual(world.rotation, stored.rotation); assert.notEqual(world.scale, stored.scale);
    assert.deepEqual(stored, before);
  }
});

test('world-heading entity interface matches actor controls and preserves tilted roundtrips', async () => {
  const [coordinates, THREE] = await modules;
  near(coordinates.entityHeadingRadians('actor', transform(rotation('XYZ', 0, 0, 0))), 0);
  near(coordinates.entityHeadingRadians('actor', transform(rotation('XYZ', 0, .8, 0))), .8);
  near(coordinates.entityHeadingRadians('prop', transform(rotation('XYZ', 0, .8, 0))), -.8);
  for (const kind of ['actor', 'prop', 'camera']) for (const order of ORDERS) {
    const stored = transform(rotation(order)), modified = coordinates.setEntityHeading(kind, stored, .91);
    near(coordinates.entityHeadingRadians(kind, modified), .91);
    const world = coordinates.entityTransformToWorld(kind, modified);
    orientation(THREE, coordinates.readEntityTransform(kind, world).rotation, modified.rotation);
    assert.deepEqual(modified.position, stored.position); assert.deepEqual(modified.scale, stored.scale);
  }
});

test('camera apply uses optical state pose; fallback applies plan reflection exactly once', async () => {
  const [coordinates, THREE] = await modules;
  for (const order of ORDERS) {
    const plan = transform(rotation(order)), optical = rotation(order, -.4, -.9, .21);
    const state = {transform: plan, camera: {position: {x: -4, y: 1.6, z: 7}, rotation: optical, fov: 37}}, before = structuredClone(state);
    const applied = coordinates.applyEntityTransform('camera', state);
    assert.deepEqual(applied.position, state.camera.position); assert.deepEqual(applied.rotation, optical); assert.deepEqual(applied.scale, plan.scale);
    near(coordinates.entityStateHeadingRadians('camera', state), coordinates.rotationHeading(optical));
    orientation(THREE, coordinates.applyEntityTransform('camera', {transform: plan}).rotation, coordinates.planRotationToCamera(plan.rotation));
    assert.deepEqual(coordinates.applyEntityTransform('camera', {transform: plan, camera: {rotation: optical}}).position, plan.position);
    orientation(THREE, coordinates.applyEntityTransform('camera', {transform: plan, camera: {position: state.camera.position}}).rotation, coordinates.planRotationToCamera(plan.rotation));
    assert.deepEqual(coordinates.applyEntityTransform('actor', state), coordinates.entityTransformToWorld('actor', plan));
    assert.deepEqual(state, before);
  }
});

test('camera read reflects optical pose into plan and retains prior authored scale when supplied', async () => {
  const [coordinates, THREE] = await modules;
  for (const order of ORDERS) {
    const optical = transform(rotation(order)), oldPlan = transform(rotation(order, 0, 0, 0)); oldPlan.scale = {x: 3, y: 4, z: 5};
    const plan = coordinates.readEntityTransform('camera', optical, oldPlan);
    assert.deepEqual(plan.position, optical.position); assert.deepEqual(plan.scale, oldPlan.scale);
    orientation(THREE, plan.rotation, coordinates.cameraRotationToPlan(optical.rotation));
    orientation(THREE, coordinates.applyEntityTransform('camera', {transform: plan}).rotation, optical.rotation);
    assert.notEqual(plan.scale, oldPlan.scale);
  }
});

test('actual PerspectiveCamera lookAt rotations survive optical/plan conversion for six orders', async () => {
  const [coordinates, THREE] = await modules;
  for (const order of ORDERS) for (const target of [[-4, 2, -7], [5, -1, 2], [2.1, 7, 3.2]]) {
    const camera = new THREE.PerspectiveCamera(); camera.position.set(2, 1.6, 3); camera.rotation.order = order;
    camera.lookAt(new THREE.Vector3(...target)); camera.updateMatrixWorld(true);
    const optical = {x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z, order};
    const stored = coordinates.cameraRotationToPlan(optical), restored = coordinates.planRotationToCamera(stored);
    equivalentQuaternion(quat(THREE, restored), camera.quaternion);
    near(coordinates.entityStateHeadingRadians('camera', {transform: transform(stored), camera: {rotation: optical}}), independentHeading(THREE, optical));
    const expectedDirection = new THREE.Vector3(...target).sub(camera.position).normalize();
    near(camera.getWorldDirection(new THREE.Vector3()).distanceTo(expectedDirection), 0);
  }
});

test('vertical-forward singularity returns heading zero without changing orientation; nearby tilt stays finite', async () => {
  const [coordinates, THREE] = await modules;
  for (const order of ORDERS) for (const sign of [-1, 1]) {
    for (const distance of [0, 5e-9]) {
      const r = rotation(order, sign * (Math.PI / 2 - distance), 0, 0);
      near(coordinates.rotationHeading(r), 0);
      assert.deepEqual(coordinates.reflectRotationHeading(r), r);
      orientation(THREE, coordinates.reflectRotationHeading(r), r);
    }
    const r = rotation(order, sign * (Math.PI / 2 - 2e-8), 0, 0), changed = coordinates.setRotationHeading(r, .7);
    for (const value of Object.values(changed).filter(value => typeof value === 'number')) assert(Number.isFinite(value));
    const delta = coordinates.headingDelta(coordinates.rotationHeading(r), .7);
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -delta).multiply(quat(THREE, r));
    // Official/Three Euler singular fallback (.9999999) loses tiny components.
    equivalentQuaternion(quat(THREE, changed), expected, 1e-7);
  }
});

test('Euler gimbal boundaries are evaluated by quaternion orientation, not Euler scalar equality', async () => {
  const [coordinates, THREE] = await modules;
  const singularAxis = {XYZ: 'y', YXZ: 'x', ZXY: 'x', ZYX: 'y', YZX: 'z', XZY: 'z'};
  for (const order of ORDERS) for (const sign of [-1, 1]) for (const distance of [0, 1e-7, .001]) {
    const r = rotation(order, .31, -.52, .27); r[singularAxis[order]] = sign * (Math.PI / 2 - distance);
    const reflected = coordinates.reflectRotationHeading(r), restored = coordinates.reflectRotationHeading(reflected);
    const delta = coordinates.headingDelta(coordinates.rotationHeading(r), -coordinates.rotationHeading(r));
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -delta).multiply(quat(THREE, r));
    equivalentQuaternion(quat(THREE, reflected), expected, 1e-6);
    if (order === 'YXZ' && distance === 1e-7) {
      // Gq/Three drops z near a vertical forward. This changes heading although
      // the first orientation is close; a second reflection is NOT an involution.
      near(quat(THREE, restored).angleTo(quat(THREE, r)), .54, 1e-6);
    } else orientation(THREE, restored, r, 1e-5);
    assert.equal(reflected.order, order);
  }
});

test('sameRotation compares q/-q and equivalent Euler orders with an angular tolerance', async () => {
  const [coordinates, THREE] = await modules;
  for (const order of ORDERS) {
    const r = rotation(order), q = quat(THREE, r), negative = quat(THREE, {...r, x: r.x + 2 * Math.PI});
    near(q.dot(negative), -1);
    assert(coordinates.sameRotation(r, {...r, x: r.x + 2 * Math.PI}));
    for (const otherOrder of ORDERS) {
      const e = new THREE.Euler().setFromQuaternion(q, otherOrder);
      assert(coordinates.sameRotation(r, {x: e.x, y: e.y, z: e.z, order: e.order}));
    }
    assert(coordinates.sameRotation(r, {...r, y: r.y + 1e-8}));
    assert(!coordinates.sameRotation(r, {...r, y: r.y + 1e-4}));
  }
  assert.throws(() => coordinates.sameRotation(rotation(), rotation(), -1), error => error.name === 'StudioDomainError');
});

test('no-op snapshots preserve omitted order and inputs reject malformed domains without mutation', async () => {
  const [coordinates] = await modules;
  const r = {x: 0, y: 0, z: 0};
  const unchanged = coordinates.setRotationHeading(r, 5e-11);
  assert.deepEqual(unchanged, r); assert.notEqual(unchanged, r);
  const bad = fn => assert.throws(fn, error => error.name === 'StudioDomainError');
  bad(() => coordinates.rotationHeading({x: NaN, y: 0, z: 0}));
  bad(() => coordinates.rotationHeading({...r, order: 'BAD'}));
  bad(() => coordinates.setRotationHeading(r, Infinity));
  bad(() => coordinates.wrapHeading('0'));
  bad(() => coordinates.entityTransformToWorld('light', transform(r)));
  bad(() => coordinates.entityTransformFromWorld('actor', {rotation: r}));
  bad(() => coordinates.applyEntityTransform('camera', {transform: transform(r), camera: {rotation: {x: 1}}}));
  assert.deepEqual(r, {x: 0, y: 0, z: 0});
});

test('pinned official pure Hq/ZOe/ct/xF/vF/hE/HOe functions agree with Three-based interfaces', {skip: !existsSync(SOURCE)}, async () => {
  const [coordinates, THREE] = await modules, source = readFileSync(SOURCE, 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), SOURCE_SHA, 'installed source changed; review math evidence before repinning');
  assert(source.includes('QOe as ct'), 'ct must resolve to QOe export, not unrelated nested ct');
  const official = originalMath(source);
  for (const order of ORDERS) for (const r of [rotation(order), rotation(order, -.91, -2.37, .52), rotation(order, Math.PI / 2 - 2e-8, 0, 0)]) {
    near(coordinates.rotationHeading(r), official.hE(r));
    orientation(THREE, coordinates.reflectRotationHeading(r), official.xF(r), 1e-7);
    orientation(THREE, coordinates.cameraRotationToPlan(r), official.QOe(r), 1e-7);
    orientation(THREE, coordinates.planRotationToCamera(r), official.Wq(r), 1e-7);
    for (const target of [-2.9, .81, 3.23]) orientation(THREE, coordinates.setRotationHeading(r, target), official.vF(r, target), 1e-7);
    for (const kind of ['actor', 'prop']) {
      const stored = transform(r), world = JSON.parse(JSON.stringify(official.Hq(kind, stored)));
      orientation(THREE, coordinates.entityTransformToWorld(kind, stored).rotation, world.rotation, 1e-7);
      orientation(THREE, coordinates.entityTransformFromWorld(kind, world).rotation, official.ZOe(kind, world).rotation, 1e-7);
      near(coordinates.entityHeadingRadians(kind, stored), official.Cdt(kind, {transform: stored}), 1e-7);
      orientation(THREE, coordinates.setEntityHeading(kind, stored, -.92).rotation, official.Sdt(kind, stored, -.92).rotation, 1e-7);
    }
    const state = {transform: transform(r), camera: {rotation: rotation(order, -.4, .8, .2)}};
    near(coordinates.entityStateHeadingRadians('camera', state), official.Cdt('camera', state));
    near(coordinates.entityStateHeadingRadians('camera', {transform: state.transform}), official.Cdt('camera', {transform: state.transform}));
  }
  near(coordinates.headingDelta(2.9, -3), official.HOe(2.9, -3));
  for (const sign of [-1, 1]) {
    const r = rotation('YXZ', sign * (Math.PI / 2 - 1e-7), -.52, .27);
    orientation(THREE, coordinates.reflectRotationHeading(coordinates.reflectRotationHeading(r)), official.xF(official.xF(r)), 1e-6);
  }
  const singularAxis = {XYZ: 'y', YXZ: 'x', ZXY: 'x', ZYX: 'y', YZX: 'z', XZY: 'z'};
  for (const order of ORDERS) for (const sign of [-1, 1]) for (const distance of [0, 1e-7, .001]) {
    const r = rotation(order, .31, -.52, .27); r[singularAxis[order]] = sign * (Math.PI / 2 - distance);
    orientation(THREE, coordinates.reflectRotationHeading(r), official.xF(r), 1e-6);
    orientation(THREE, coordinates.reflectRotationHeading(coordinates.reflectRotationHeading(r)), official.xF(official.xF(r)), 1e-5);
  }
});
