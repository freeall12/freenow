# Plan temporal 轨迹作者桥

`plan-trajectories.mjs` 把当前独立状态中的真实 temporal 位置通道映射为可绘制、可编辑的平面轨迹。它不创建 renderer、SVG 或 pointer listeners，不修改播放采样后的 entity base，不调用外部 API。`temporal-workspace.mjs` 的新增 `beginTrajectoryEdit` 只承接同一作者 owner、history、view 与 native/source fence。

## 使用

```js
const trajectories = createPlanTrajectories({
  getState: () => temporal.displayState,
  getAuthorState: session.getState,
  session, temporal,
  beginEntityEdit: planWorkspace.beginEdit,
  getRuntime: () => runtime,
  isCurrent,
  getSelected,
  onSelect,
  getBusy,
  onChange: refreshPlan,
  onError: reportError,
});

const getPaths = trajectories.readPaths;
const beginPathEdit = trajectories.beginEdit;
const onPathSelect = trajectories.select;
```

领域输入必须从 author session 读取；所有位置为 `{x,y,z}`。描述符是 detached JSON 数据，可被展示层处理而不污染作者状态。

## readPaths 合同

`[{id,entityId,kind,label,color,selected,readOnly,draggable,visible,keys,segments,controls,playhead}]`。

- `id` 是实际 temporal track ID，`kind` 为 `person | object | camera`。
- `keys`: `{id,keyId,timeMs,label?,position,heading,selected,draggable,camera?}`。camera key 的光学姿态及 FOV 来自该时刻的实际 temporal 采样；不会使用当前 live camera 冒充 key。
- `segments`: `{id,fromKeyId,toKeyId,fromTimeMs,toTimeMs,p0,p1,p2,p3,bend?,length,interpolation,points,parameters}`。展示用 `interpolation` 为 `cubic | hold`，领域 `linear` 位置通道实际按自动 cubic 轨迹采样。`p1/p2` 是 Bezier 控制点，`bend` 是独立 smoothstep 空间约束，不能把 bend 当成 Bezier 控制点。
- `points` 是 65 个等时间采样点，沿用领域 64 chord 累积距离反查；对应 `parameters` 是各点的真实 cubic 参数。pointer 最近样本线段应同时插值时间与 parameters，写 bend 时用后者的 `t`。hold 在终点前保持 p0，展示层画 hold 符号，不连移动线。
- `controls`: `{id,kind:'bend'|'endpoint',position,anchor,screenProxy,endpoint?,fromKeyId?,toKeyId?,t?}`。只给当前选中、可编辑轨迹提供 controls。endpoint 是非 hold 首段 p1／末段 p2。bend proxy 的 anchors 是 p0/p3；endpoint 是一个端点 anchor，fallback 是对端。30px proxy 位移与 connector 由 surface 负责。
- `playhead`: `{position,timeMs,heading}` 是作者 temporal 对当前 playhead 的真实采样。

场景基准没有 temporal 路径。locked/shared/readonly/playback/scrubbing/confirmation/busy 路径拒绝作者编辑。

## beginEdit 合同

```js
const lease = await trajectories.beginEdit({
  kind: 'key' | 'bend' | 'endpoint' | 'path' | 'key-heading' | 'key-fov',
  pathId,
  entityId, // 可选；给出时必须匹配 path owner
  keyId, // key
  endpoint: 'start' | 'end', // endpoint
  fromKeyId, toKeyId, // bend/path
  t, position, timeMs, // path: pointerdown 最近点固定值
});
lease?.onMove({position: {x, y, z}}); // key/bend/endpoint/path
// key-heading: {heading}; key-fov: {heading,fov}
lease?.onEnd(); // 也可传最后一个 {position}
lease?.onCancel();
```

返回 `Promise<lease|null>`，lease 的三个动作返回 boolean。surface 应在达到 4px 拖动阈值后才申请 lease，projection、保 depth 反投影、proxy offset、window pointer ownership 由 surface 保持。

- `key` 只写指定 key 的 `entity.transform.position`，保留它的 interpolation、Y、其他通道与 base。选择该 key 并同步 playhead 到 key 时间。
- `key-heading` / `key-fov`：先选择指定 key，再调用可选 `beginEntityEdit` (`planWorkspace.beginEdit`) 的 heading/fov 作者桥。heading 支持 actor/prop/camera，FOV 仅 camera；FOV 原子更新 key 的 yaw 和光学值。每次 await 后和每次 move/end 都核对固定 selected-key、来源、作者 fence，错 key 取消且不写作者状态。`onEnd({heading,fov})` 可提交最终光学值；不会转发 position 或修改 base。宿主离开 plan 时同时取消 trajectories 和 planWorkspace，以即时撤销仍在 prime await 的委托输入。
- `endpoint` 写 `set-endpoint-control` 的控制点；保留另一端及原控制点 Y。
- `bend` 写固定相邻非 hold segment 的约束；复用原 constraint.t 或 .5，保留原控制点 Y。
- `path` 是曲线拖动：冻结 pointerdown 的 from/to 和 cubic `t`，只写 bend。拒绝 hold、`t <= .05 || t >= .95`、距任一端点不超过 `max(端点3D距离,1)*.05` 的输入。Y 取该轨迹原位置，传入 pointer Y 不覆盖它。

曲线点击 **不创建关键帧**。surface 用 endpoint 最近参数 `t <= .001` / `t >= .999` 选择 from/to key，其他位置选实体；调用 `select({pathId,keyId?})`。点击不创建 transaction。曲线拖动也不增加 key 数量。

bend、endpoint、path 编辑保留原 playhead；结束后保留该时刻采样。一次 lease 只有一个 setup lane history transaction；连续 preview 不增加 undo，end 一次提交，cancel 回滚。取消会恢复同一来源此前的暂停预览。保存 revision 回执不会撤销 lease，editEpoch／setup／stage／来源／native graph 变更会拒绝迟到输入。取消绑定自身 transaction，不取消后续 foreign transaction。

`cancel()` 取消当前 pending/active 编辑；`dispose()` 取消并永久封闭本实例。pointercancel、离开plan、来源换代或宿主关闭时必须调用。

## Context 操作

`readContext({kind:'key',pathId,keyId})` 返回固定身份的 `{kind,pathId,entityId,keyId,label,timeMs,onDelete}`。`onDelete()` 返回既有 temporalAction result；来源或作者身份变化时拒绝。官方 plan key menu 只有“删除关键帧”。第一次 key click 选择，第二次 click 和 contextmenu 的菜单呈现由宿主负责。

`readContext({kind:'bend',pathId,fromKeyId,toKeyId})` 返回 `onReset()`；或直接调用 `resetBend({pathId,fromKeyId,toKeyId})`。官方 bend 右键直接 reset，没有额外菜单。reset 只删除这一 segment 的 transition，保留 track endpoint controls。

## 静态来源与边界

2026-10-08 安装包静态合同：`ThreeDWorkspace-BzPphAqB.js` 的 y4（506429）、w4（512569）、k4（514298）、e4（494565）与 yF/gF/bF；`WorkspacePlanView-HeQ7o6cq.js` 的 zt（43120）、Ur（43706）、mr/wr。曲线 cubic + smoothstep 与时间/距离反查复用当前 `camera-shot-sampling.mjs` 的 `temporalPositionPathSegments` 输出。

官方端点 marker 选非 hold 首末段，但 storage endpoint controls 只影响整个 position 序列首末段；若首尾为 hold，保留既有领域合同，不伪造额外中间 control storage。本模块没有修改采样器或 schema。

key 朝向与相机 key 两侧 FOV 编辑使用已有实体作者桥，surface 以该 key 的 sampled heading/FOV 计算对侧固定 ray；拖动中 FOV 可保持局部预览，结束时通过 `onEnd({heading,fov})` 一次写入。

## 缓存

作者 geometry 以 world/stage/setup/source、session fence 的 editEpoch 等作者身份缓存，排除 save revision；native source record 替换也会失效。无 editEpoch 的旧宿主退回 setup/entities 内容 fingerprint。key 采样和 65 点曲线只在 geometry 重建时计算；同作者的 selection/draggable/playhead 仅更新呈现，playhead setup sample 同时间复用。每次读取仅调用一次 `temporal.read` 与一次 status，返回拷贝以防展示层污染 cache。`getDiagnostics().geometryBuilds` 用于只读专项验证。

## 验证

```sh
node --test tests/studio-v3-plan-trajectories.test.cjs tests/studio-v3-temporal-workspace.test.cjs
```

2026-10-08：27/27 通过，其中本模块新增 10 项；覆盖 cubic/bend 与实际播放采样一致、descriptor detached、key/base/其他通道隔离、原Y、单条undo、端点/hold门禁、固定path参数、reset边界、上下文身份、保存回执、来源换代、取消恢复、pending disposal 和既有 temporal host 回归。浮点采样与光学换算用 1e-10 容差。

这是领域与作者桥专项验证，不证明浏览器 pointer/SVG、样式或官方视觉一致性。最终 surface/runtime 集成应另做浏览器验收。

追加 key 朝向/FOV 和 geometry cache 专项：

```sh
node --test --test-name-pattern='key heading delegate|key FOV delegate|key pose delegate|geometry cache' tests/studio-v3-plan-trajectories.test.cjs
```

2026-10-08 追加 4/4 通过：actor/prop/camera 固定 key heading、camera key FOV/base 光学隔离、异步委托期间换 key 取消、缓存复用及 preview/source 精确失效。没有重复运行此前 27 项。

提交／回滚失败边界：host 在 `retainView` 或 history commit 抛错、或 commit 返回 false 且事务仍活跃时保留作者 owner，原 lease 仍可回滚。rollback 返回 false 或抛错也保留 lease，允许重试；只有成功后才释放 owner/view/cancelled。history commit 的 false 若已消费无变化事务，则 host 保留 false 作为变更结果，外围 plan 用户 lease 将其规范为成功完成并释放，避免误报编辑失败或留下输入锁。相机 key 委托的共享 owner 也忽略纯保存 revision 回执，不忽略 editEpoch/来源变更。
