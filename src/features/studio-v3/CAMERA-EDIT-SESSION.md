# 摄像机 possession 作者会话

`camera-edit-session.mjs`只拥有作者事务、原始领域快照与稳定 fence。它不监听 DOM、不创建 Three 摄像机、不调度 RAF，也不负责飞行、镜头动画或视口恢复。宿主 runtime 将临时 optical camera 与 navigation 接到这里；`onEdit`接项目现有 history/reducer。官方证据见 [操控源码合同第 5、6 节](../../../docs/research/STUDIO-V3-CONTROL-MODES-20261008.md)。

## 接口

```js
const session = createCameraEditSession({
  getSubject(entityId) { return {entityId, label, camera, transform}; },
  getFence() { return stableOwnershipFence; },
  onEdit(event) { return true; },
  onStart({entityId, label, camera, transform}) {},
  onPreview({entityId, camera, transform, kind, reason}) {},
  onEnd({entityId, reason, cancelled}) {},
  onInvalidate() {},
  onError(error) {}
});

session.start(entityId);                       // boolean
session.applyCamera(nextCamera, {kind, reason}); // 完整、合法 camera 快照
session.patchOptics({focalLength: 85});          // optics 白名单；归一化 focal/FOV
session.checkpoint('capture');                  // 提交拍摄快照，保留 possession / lease
session.finish('escape');                      // 有变化 commit，无变化 cancel 空事务
session.cancel('restore');                     // 精确进入前 camera + transform
session.refresh();                             // owner／subject 失效时 cancel('stale')
session.dispose();                             // cancel，释放，之后不再接受操作
session.active;                                // null 或 detached snapshot
```

`active`为 `{entityId,label,camera,transform,fence,dirty,failed,transactionOpen}`；修改它不会改变内部会话。`camera`是归一化后的临时 optical 状态；`transform`是领域 plan 状态。进入前的稀疏 camera 不会因归一化而写回领域。`onStart`的 camera 已补齐焦距、FOV、focus 等光学状态，适合 runtime 一次应用。

`getSubject`负责实时资格：不可写 setup、playing、scrubbing、失效实体或当前不能提供安全作者目标时返回 `null`。本地 temporal 作者路径尚未接入，宿主必须拒绝已有摄像机轨道的主体，不能退回修改 base。`getFence`须给 JSON 值，包含 owner/source/stage/setup/session 的稳定身份，排除自身 preview 造成的 revision/editEpoch；对象按值比较并深复制。它不能返回 `undefined`。

## 作者事务与失败行为

`onEdit`只接受同步、字面量 `true`，`undefined`、`{ok:true}`和 Promise 都视为拒绝。回调需原子执行：返回 false 或抛错时不得留下部分领域修改。事件为 `{phase,entityId,camera,transform,kind,reason,clearLookAt?}`。

| phase | 宿主动作 | 状态 |
| --- | --- | --- |
| begin | 开当前 camera owner 的 history transaction | 拒绝时不调用 onStart/onEnd，不抢视口 lease |
| preview | 以 camera + plan transform 预览真实 reducer | 多次输入仍属同一事务，无 history record |
| commit | 提交现有事务 | 必须 true 才调用 onEnd；失败保留主体与 lease |
| cancel | history.cancel，使用原始领域快照 | 成功释放；失败保留会话供重试 |

未 checkpoint 时，整段会话只有一个 begin。未产生有效变化时 `finish`发送 cancel 清空事务，而 `onEnd.cancelled=false`表达正常完成；没有空 record，也不写 defaults/timestamps。成功修改后的 finish 只发一次 commit。`start`同一 id 验证 owner 后返回 true；不同 id 先 finish 旧会话，成功之后才读取新主体／fence 并调用 onStart。旧事务提交失败不会开始新 owner。

拍摄调用 `checkpoint('capture')`：有修改时 commit，无修改时 cancel 空事务；成功后 active/viewport lease 保留，不调用 onEnd，将最后接受的 camera/transform 设为新 baseline/before，dirty=false、transactionOpen=false。宿主此时可调用真实 `StudioSession.flush()`，保存已拍摄的作者状态，无活动事务阻塞。下一次真实 pose/optics 修改才延迟 begin 新事务；没有变化的输入不 begin。下一段 finish/cancel 只影响下一段，已拍摄历史保留。checkpoint 失败保持旧 baseline 和活动事务，供重试或精确还原。

transactionOpen=false 时 finish/cancel/stale/dispose 只释放当前 possession owner，不发 history commit/cancel；之后其他 owner 开的事务不会被误取消。重开 begin 被其他作者事务拒绝时，保持最后接受的 optical camera，允许停止导航／重试。

`onPreview`只应用临时摄像机，可以返回 void；返回 false 或抛错拒绝这次预览。调用顺序为临时预览成功→onEdit preview→接受新 current。领域预览被拒绝时，再以 `reason='preview-rejected'`重放最后接受的临时 camera；异常用 `preview-failed`还原。错误 current 不会进入 active 或后续 commit。`onError`必须让 runtime 停止 navigation，保留会话供完成重试或还原；模块不会自行取消失败预览。成功重试清除 `failed`。

refresh 在每次输入／完成前验证稳定 fence 和 getSubject；失效时取消旧事务。取消无需新主体仍存在，payload 始终是原始 owner 的进入快照。宿主取消 history 时应使用已开始的事务，不从新的 activeSetup 推导写入目标。

## 相机字段与坐标

- `cameraOpticsPatch`负责 focal/FOV、纵横比与 DOF 归一化，之后 `assertCamera`和 JSON 校验拒绝无效／额外字段。`patchOptics`只允许 fov/frameAspectRatio/focalLength/apertureFNumber/depthOfFieldMode/focusDistance/focus。
- 摄像机 rotation 是 optical/world；真实 pose 改变时以 `cameraRotationToPlan`转换完整 rotation，保持 tilt 与 Euler 等价性。position 使用 optical position，scale 始终保持原领域 scale。
- optics-only 不改 transform，保留原 `camera.lookAt`。输入遗漏 lookAt 不代表删除；真实 pose 变化才移除它。
- pose 已移除进入前 lookAt 时，preview/commit 带 `clearLookAt:true`。宿主先 clone 当前 camera 并 `delete camera.lookAt`，通过 patchEntityState 清旧值，再执行真实 reducer。不能用 null/undefined 充当删除字段，也不能只向会合并旧字段的 reducer 传一个未带 lookAt 的 patch。
- 摄像机 scalar optics 与位置分量使用 `1e-4`容差；rotation 使用 `sameRotation(...,1e-4)`，跨 Euler order 与 quaternion 正负等价。DOF 模式、focus 对象和 tracking 删除按结构比较。小于阈值的输入不会积累 current，持续运动相对最后接受的 camera 超阈值后才写预览。

## 生命周期边界

所有生命周期／作者操作同步防重入。callback 中再次 start/apply/finish/cancel/refresh 返回 false；dispose 可以请求终止，但等当前 callback 返回后取消，防止交错事务。onStart 失败会取消并调用 onEnd；onEnd 抛错不会留下内部 active owner，也不会阻止 dispose。

视口 lease 是 runtime 的资源：onStart 保存原视口并进入临时 camera，onEnd 必须用 try/finally 清 navigation、释放临时 camera／lease，再处理还原动画。只有调用过 onStart 的会话才调用 onEnd；begin 被拒绝或在 begin 回调中 dispose 不会清另一个 owner 的 lease。切 camera 的 runtime 应复用原视口 baseline；旧 lease 的 identity 必须仍有效才可以恢复，不能覆盖新 owner。模块无法替代宿主清理一个未暴露的 lease。

dispose 或 onStart 失败后的强制清理即使宿主 cancel 拒绝也会释放内部 owner并调用 onError；宿主仍需在自己的 dispose 兜底取消 history，不能把拒绝的 callback 当成回滚成功。

## 官方依据与本地差异

本次直接静态读取 `/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`：

- `E2`（195115）只做 viewport possession；`GW`（282406）按 identity 持有一个 lease，旧 lease 不能恢复新 camera。
- `EV/RV/AV`（560316／565818／567587）分别保存 poseDirty、opticsDirty 与 stable owner target；possession 复用 E2 lease，普通 key edit 独立 lease。`$n`（158107）要求 finish callback true 才 exit；`Mf`（158412）取消作者事务后 exit。
- `m2/xr`（188476）camera position/Euler/fov/ratio 比较 `1e-4`；`lL`（158005）navigation 使用 position distance² `1e-10`与 `1-abs(quaternion.dot)` `1e-8`。本地事务的 quaternion `1e-4`角容差是去噪策略，不宣称与 lL 逐值一致。
- `ul`（245410）保留 existing transform scale，缺省单位 scale；`dV`（548847）相机分支保留旧 scale 并用 Hc 转完整 plan rotation。官方 ul 的作者写入 flatten plan pitch/roll，只留下 heading；本地遵循已有 V3 cameraRotationToPlan 统一合同，保留完整 rotation，以免实体 marker 与 optical camera 分歧。
- 官方 EV 在首次 record 时才 begin history，并把后续输入置 dirty 待 flush；本地立即 begin 并逐输入 preview，共同保证整段一个 commit。官方 EV 没有直接用统一 `1e-4` optics dirty 比较；本地以上判定用于避免空 record。

进入 `.8s`与退出 `.55s`动画、prefers-reduced-motion、输入 leases、DOM/navigation、render schedule、HUD与 production 持久化都由 runtime/entry 集成验收。未实现 selected/time-key authoring、创建 key 确认或 retarget；不能视为官方完整 temporal 控制。

## 验证

```sh
node --test tests/studio-v3-camera-edit-session.test.cjs
```

20 个专项用真实 `createHistory`＋`reduceEntityAction`证明：begin→多 preview→单 commit、undo/redo 精确复原、稀疏 baseline cancel、无操作与 quaternion 等价无历史、optics-only 保留 lookAt、合法字段删除和 scale/plan 姿态一致、输入验证、严格 boolean、失败恢复、owner切换、stale fence、callback重入和 disposal，以及拍摄 checkpoint 成功／失败、下一段独立事务、保留已拍摄状态和不取消其他 owner。额外使用真实 `StudioSession`证明 transaction-active 时 flush 拒绝，checkpoint 后保存成功且 possession 保留。临时 viewport lease 使用宿主回调模拟；真实 Three camera 与浏览器交互应由 runtime 层另行验证。
