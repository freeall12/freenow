# 摄像机管理领域模块

`camera-shots.mjs`派生当前状态的镜头列表，并纯执行 rename/remove。它不新增保存 View 入口、不创建按钮、不创建相机、不采样时间轴，也不操作 history、存储、输入或网络。历史事务和 UI 生命周期由主线接入。

## 输入与输出

```js
const shots = listCameraShots(state); // 默认当前 activeStageId / activeSetupId
const other = listCameraShots(state, {stageId, setupId});

const renamed = reduceCameraShotAction(state, {
  type: 'rename', shotId, title: '镜头名称'
});
const removed = reduceCameraShotAction(state, {type: 'remove', shotId});

// 可选确定性时间戳，供测试／宿主使用。
reduceCameraShotAction(state, action, {now: 1000});
```

列表的每个 detached descriptor 为：

```text
id, index, source: 'view' | 'camera', stageId, setupId, setupLabel,
title, kind: 'static' | 'dynamic', view, camera,
cameraEntityId: string | null, durationMs: number | null, entities, setup
```

`setup`是合并同 stage 场景基准后的 render setup；`entities`为领域定义列表。`view`在 implicit 情况只是合成数据，不写入世界状态。修改任何返回字段不会修改输入 state。

动作成功返回 `{ok:true,changed,state,lane,scope,entityId,shotId,shot}`。remove 另含 `removedViewIds`和 `removal:'local'|'global'|'views-only'`，其中 removedViewIds 包含真实 cascade 删除的其他状态视图。拒绝返回 `{ok:false,changed:false,state,lane,reason,message,...}`，保留原输入引用。无效领域数据／额外字段／非字符串名称等抛领域错误，输入始终不变。

## 列表规则

1. 严格验证 stage/setup 归属；场景基准不产生 manager 列表。
2. 同 stage baseline 与目标独立 setup 合并，baseline state 优先，保持独立 setup id。
3. 取同 stage/setup 且 `tags.includes('shot')`的 explicit views，按 createdAt 升序、id.localeCompare 排序。capture-only view 不作为 explicit 镜头。
4. view 关联的 camera state 存在时，真实 camera 同时替代 descriptor.camera 和 descriptor.view.camera；否则使用原 view.camera。explicit 关联相机 hidden 时仍列出，不能套用 implicit 的 visible 过滤。
5. 收集 explicit camera IDs。再按 camera entity createdAt/id 顺序列 implicit；要求合并 setup 中有 camera 且 visible 不为 false，并排除已被 explicit 占用的 IDs。

implicit id 为 `implicit-camera-shot:${setupId}:${cameraId}`，title 使用全局 entity.label，合成 view.tags 为 `['shot']`。capture-only 不显示为镜头条目，但它关联的可见 camera 若未被 explicit shot 占用，仍会产生 implicit 镜头；不能因为有拍摄记录就隐藏该相机。

`kind='dynamic'`使用官方 XT 的**已使用 key 时刻**：汇总整个 resolved setup 所有轨道中被 channel.values.keyId 引用的 keys，末正时刻才形成 dynamic duration。它不使用 setup.temporal.durationMs，不只检查该摄像机自身轨道；无被引用 key 或只有 0ms 的 key 为 static。static explicit 使用自己的有限 view.durationMs；static implicit 为 null。列表 camera 始终为当前 base 状态，不读取 temporal channel value；时间轴采样属于真正预览／导出的另一路径。

输入通过严格 `assertState`＋完整 `assertCamera`／JSON 验证。NaN/Infinity、缺 position/rotation/fov、无效标签或关系均拒绝，不从 viewport 临时补造 camera。explicit/implicit ID 碰撞也拒绝，动作以当前列表 membership 查找，不能通过解析任意 ID 越过 setup 归属。

## 改名与删除

rename trim 名称；空名与同名拒绝，不产生变化。explicit 只修改 source view.label，lane 为当前 setup；implicit 修改全局 camera entity.label，lane 为 world。因此 implicit 改名会反映在其他状态的 implicit 镜头中，既有 explicit view 的名称保留。

remove 的顺序遵循官方 QK：

1. explicit source view 自身先加入删除集合。
2. 若有关联 camera，再加入同 setup 全部 sourceCameraEntityId 匹配的 views，**不限 shot tags**；逐个用现有 `removeView`清除 view、对应 outputs/reference targets/activeView。
3. 用现有 `reduceEntityAction({type:'remove',mode:'local',setupId})`移除摄像机。官方 wy 先定位 requested setup 的 local state，否则 fallback 同 stage baseline。

独立 setup 分支只移除此 setup 的 camera state 与 owner tracks。其他 setup state/track/source camera view 仍引用时，definition 保留；最后引用消失才由现有 world-space garbage collection 全局清定义及关联关系。

**baseline fallback 是实际全局删除**：在独立 setup 的 manager 删除共享基准摄像机，会走 baseline→removeEntity cascade，其他状态的同摄像机 views/outputs/reference targets 也会清理。模块保留官方终态，不把它伪装成独立状态 local 删除，也不自行拒绝 shared baseline。返回 removal='global'、lane='world'与全部实际 removedViewIds，让宿主按真实结果处理历史/UI。

没有关联 camera 的 explicit shot 只删 source view。有关联 definition 但当前 setup/baseline 都没有 camera 实例时，同 setup views 仍删除，其他 setup 的 camera state 不受影响，removal='views-only'。

## 权限与失败边界

模块验证领域归属与操作目标；readonly、busy、playing、ownership/source fence、当前操控的 finish/handoff，以及具体 UI enabled 状态由宿主执行。官方 manager UI 隐藏 readonly，delete callback 拒 playing，busy/playback 禁用由 UI 提供；不能仅凭本模块返回 ok 就视为已经通过宿主权限。

每次 action 产生一个完整候选 state。宿主应使用返回的 lane/scope 包进原 history 单事务；不要每个 removeView 单独提交。reducer／schema 验证失败时整个结果拒绝，不能把部分候选 state 写回。这里不与 camera possession 的现有作者事务并行开始新 history。

`now`须有限、非负，不能让更新时间早于创建时间。列表自身不读取时钟；implicit 合成 view 使用 max(entity/state/setup updatedAt)。全零 authored timestamp 时保持 0，区别于官方 RK 的 Date.now fallback，使派生列表可复现。

## 官方证据与本地适配

研究代理直接定位官方安装包，并复核 `ThreeDWorkspace-BzPphAqB.js` 的 SK 原始片段：SK≈701015、CK=702129、EK≈702212、RK=702654、Y0=703148、rW=245344、Em=244945、nW=244982、qx=245003；rename/remove 位于 QK≈719330/719620。wy≈255184 及独立实例移除 m1/最终 Qc cascade 的行为由现有 world-space/entity-actions 承接。

Y0 的 XT 溯源至 course-api 的 kdt≈1552497、bLe≈1552218、yLe≈1552635；只统计 channel 使用的 key 时刻。官方字段取值本身不完整检查 finite camera，本地遵循项目严格 schema，拒绝坏数据；不会以过滤条目掩盖坏领域状态。

## 验证

```sh
node --test tests/studio-v3-camera-shots.test.cjs
```

11 个新专项覆盖 explicit/implicit 顺序、linked-camera 覆盖、baseline 合并、capture-only/hidden 分层、跨 stage/setup 归属、已使用 temporal keys、两种 rename、同 setup views 删除、其他状态保留、baseline 全局 cascade、无实例 view-only 删除、严格 finite 完整 camera 与真实 history 单步 undo/redo 精确恢复。只执行本专项及增量受影响案例，没有重跑全项目测试。浏览器列表与按钮、宿主权限和实际历史适配由主线另行验收。
