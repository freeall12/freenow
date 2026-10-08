# 俯视图作者桥

`plan-workspace.mjs` 把平面图 marker 与手势连接到现有时间轴作者和片场会话。不创建独立实体数据，不修改渲染器、入口或 UI。官方依据为 [完整俯视图合同](../../../docs/research/STUDIO-V3-PLAN-20261008.md) 以及本地安装包 A 的 `r4`、`b4`、`y4` 和 E 的 `Edt`。

## 接口

```js
const plan = createPlanWorkspace({
  getState: () => temporal.displayState,
  getAuthorState: () => session.getState(),
  session, temporal,
  getRuntime: () => runtime,
  isCurrent: () => session.isCurrent(),
  getSelected: () => selectedEntityId,
  onSelect: selectEntity,
  onLane: lane => { lastLane = lane; },
  onChange: refreshPlan,
  onError: showError,
  getBusy: externalBusy
});
```

`getBusy` 表示外部独占状态，如拍摄、未保存回执、发布、加载或来源切换；不得包含本桥自己的 gesture/prime/history，否则手势会把自己阻断。

| 接口 | 输入与结果 |
| --- | --- |
| `readMarkers()` | 从真实 `renderSetup` 以及实体定义 join 生成 detached marker 数组。 |
| `beginEdit({entityId, kind, marker?})` | `kind` 为 `move`、`heading`、`fov`；返回 `Promise<lease|null>`。`marker` 仅验证实体身份，确认后的原始状态重新读取。 |
| `lease.onMove({position?, heading?, fov?})` | 同步布尔结果。position 使用 `{x,z}`，忽略传入 y 并保持原有高度；heading 单位弧度；fov 是领域垂直视角，单位度。 |
| `lease.onEnd()` | 同步提交最后的 preview；一次手势产生一个历史记录，无 preview 的手势不保存额外状态。 |
| `lease.onCancel()` / `cancel()` | 同步取消自己的事务；等待确认时取消对应准备请求，不创建实体或关键帧。 |
| `dispose()` | 取消自己的输入和事务，使后续 begin 失效；不销毁共享 scene、graph 或 renderer。 |

返回 marker 字段：`id/entityId`、`kind`（actor→person，prop→object）、`position`、`heading/yaw`、`label`、`color`、`selected`、`visible`、`locked`、`readOnly`、`draggable`。camera 另外含真实 `fov/frameAspectRatio/focalLength` 和对应 `camera` 对象、`showExtendedFov`；同实体已有 selected temporal key 时 `fovPresentation: 'hidden'`，对应官方避免 live marker 与 key marker 重复 FOV 的行为。

颜色优先实体定义。无自定义色时使用官方 A `vL/yx` 的 UTF-16 FNV-1a unsigned 32-bit hash，落到 rose/blue/gold/green/violet/teal 六色 palette，与角色颜色一致。

## 固定目标与事务

开始前检查锁定、共享基准只读、外部 busy、播放/拖动、已有事务，以及 scene/setup/source/owner/editEpoch fence。然后 await `temporal.primeTransform`，由它确定 base、selected-key 或需要确认的 time-key。**确认之前不写采样 base**。完成后重读显示状态作为 gesture original，并通过 `handleTransform` 或 `handleCameraEdit` 开始同步事务。

每次 onMove 使用 gesture original 计算绝对结果；不会从异步渲染尚未追上的状态累计位移或角度。保留 original y、scale 和倾斜，复用 `setEntityHeading/setRotationHeading`。camera 位置和旋转以 optical camera 为准，通过 `cameraRotationToPlan` 同步 plan transform。

FOV 与 heading 可在同一次 onMove 中提交，领域 optics 使用 `cameraOpticsPatch`，保持 ratio、焦点、光圈等其它字段，按既有合同将焦距限制为 8..400mm。左右边缘拖动、保留对侧边缘、水平/垂直角度换算及局部 SVG preview 由 surface 完成；本桥只接收最终 `{heading,fov}`。

一个 gesture 对应一个历史事务：连续 preview 不产生 undo 条目，onEnd 一次提交，onCancel 恢复完整作者状态。每次自己的 preview 后刷新 editEpoch fence。纯保存 revision acknowledgement 不使目标失效；source、setup、owner 和外部 editEpoch 变化仍拒绝继续输入。取消只针对匹配的 history transaction，不能结束其他编辑器的事务。

原生 runtime/graph/source record 也纳入当前 gesture 身份。源被替换或视图卸载后调用取消；pending prime 完成时发现请求已取消，会清理相同所有者的自家 prime，不能开启新事务。

## 与官方 camera tracking 一致

本地安装包 A `y4` 通过 camera-framing patch 写 yaw/FOV。其 `xc` 来自 E 的 `Edt`（字符位置 1544785）：

```js
function Edt(camera, yaw) {
  return {...camera, rotation: vF(camera.rotation, yaw)};
}
```

base `rotateDirectorPlanEntity` 和 temporal camera-framing 都保留 spread 的其它镜头字段，移动也只覆盖 position。这里保留 `lookAt`，不把平面图朝向编辑扩展为摄像机操控的跟踪解绑。专项验证 authored optical rotation、plan rotation 和 lookAt 字段；真实渲染中的 tracking 目标解析属于 runtime 集成验收。

## Surface 的职责和本批边界

surface 负责最近一次成功渲染的 projection、≥4px 阈值、pointerId/capture、等待确认时指针释放的取消、FOV 局部 preview、点击选择和空白清除。收到异步 lease 时须复核自己的 pointer generation，失效则立即 onCancel。

本批不包含平面图背景/renderer profile、剖切、navigation、放置新实体、路径或关键帧控制点、SVG marker/FOV hit 层。它提供这些交互的作者桥，不能据此宣告完整 P2 视觉或交互验收完成。

## 验证

```sh
node --check src/features/studio-v3/plan-workspace.mjs
node --test tests/studio-v3-plan-workspace.test.cjs
```

单一专项使用真实 schema、`createStudioSession`（ownership/history/persistence）和 temporal host。覆盖 marker optical precedence、固定 original 的 y/tilt/scale 保留、单步 undo、atomic camera FOV/heading、lookAt 保留、selected-key/base 隔离、implicit key 确认与取消、纯 revision ack、native source 替换、pending dispose 清理、共享基准/锁定/busy，以及外部事务隔离。浏览器验收由入口/surface 集成阶段执行。
