# Saved View 作者会话桥

`saved-view-workspace.mjs` 把纯 View reducer 接到真实 Studio V3 session 与独立导航相机。证据来源为 [2026-10-08 官方 View 调研](../../../docs/research/STUDIO-V3-SAVED-VIEWS-20261008.md)：官方安装包有 View 领域与相机恢复能力，尚未定位独立 Saved Views 管理 UI。「更新到当前视角」与独立管理入口属于本地补齐，不能据此宣称官方 UI 已复刻。

## 输入与输出

```js
createSavedViewWorkspace({
  getState, session, getRuntime, isCurrent, getSourceKey, getBusy,
  beforeWrite, waitForSync, onLane, onChange, onSelect,
  prepareNavigation, createId, now
})
```

- `getState()` 必须读取 session 作者状态，不能读取时间轴临时展示状态。
- `session` 使用既有 `createStudioSession`，包含真实 history、ownership、persistence 与 flush；不能用列表缓存替代。
- `getRuntime()` 返回有 `getNavigationCameraState()` 与 `restoreNavigationCamera(camera, {duration, isCurrent})` 的当前 runtime。
- `getBusy()` 可返回布尔值，或 `{busy, readonly, playing, scrubbing}`。宿主必须将只读、播放和拖动门禁接入；session 没有公开 readonly 字段，不能从 `getStatus()` 推断只读。
- `beforeWrite()` 返回 `false`、`{ok:false,...}` 或成功值。宿主在此结束控制 scope、取消相关作者手势与创建、调用 temporal.beforeWrite，并完成来源与状态检查。它不关闭视图菜单。
- `waitForSync()` 等待刚选中的 stage/setup 真正同步；`prepareNavigation()` 切到 orbit；`onSelect(null)` 可清实体选择。三者不得写 camera entity 或 temporal 内容。
- `onLane(lane)` 选择 history lane；`onChange()` 更新 UI。观察者错误不改变保存结果。
- `createId()` 只在实际创建准备完成后调用；`now()` 产生领域时间戳。

返回 `read()`、`saveCurrent({label?,notes?,tags?})`、`restore(viewId)`、`update(viewId)`、`rename(viewId,label)`、`remove(viewId)`、`select(viewId|null)`、`retrySave()`、`cancel()`、`dispose()` 和只读 `busy`。动作返回 Promise。

`read()` 返回 `{items,activeViewId,canSave,busy,pendingSave,disabledReason}`。items 包含所有持久 View 与 stage/setup 名称，不合成 camera-shot，不覆盖链接 camera 的 View 相机。canSave 要求独立 setup、可用 orbit 导航快照与所有宿主门禁通过；仅有选中 View 不意味着相机已恢复。

## 行为与历史

创建与更新只采集 `getNavigationCameraState()` 的真实 orbit 当前/目标快照，包含独立保存画幅；不用可见插值帧或俯视相机。baseline 不能保存。创建、相机更新、重命名与仅删 View 使用目标 `setup:<id>` lane，世界域 scope；选择用 `world` lane 和 `content:false`。每个实际变更只调用一次 session.change，再等待 session.flush。

恢复先真实选择所属 stage/setup，等待保存与资源同步，切 orbit、清实体选择，再用 detached 存储相机以 `.8` 秒导航动画恢复。已选同一 View 的 reducer no-op 仍执行导航恢复；不会接管作者 camera。完成回执区分 `applied`、`saved` 与 `restored`。例如 `{ok:false,applied:true,viewId,reason:'navigation-failed',saved:true,restored:false}` 表示选择已保存，相机未完成恢复。

所有请求串行。每次 await 前后固定检查 session 当前 ownership、项目/节点/来源、active stage/setup、editEpoch、runtime/graph/source 实例与请求序号。只有 save revision 被排除；editEpoch 保留。自身 session.change 后刷新固定 token，以允许自己的选择切换。外部事务、播放、scrubbing 或忙碌均拒绝；迟到回调不能写新场地。cancel/dispose 撤销请求租约，不取消其他编辑器的 history 事务。

## 保存失败与重试

如果真实 session.change 已应用而 flush 失败，返回 `{ok:false,applied:true,viewId,message}`，保留同 ID 的 View 与 `pendingSave` 回执，禁止追加其他 View 请求。回执属于工作区宿主实例，关闭或重开菜单不应重建这个实例。

`retrySave()` 只在来源、setup、editEpoch 与完整脏状态仍一致时重试 flush，不再执行 create 或其他 reducer，因此不会重复 ID、重复历史或偷偷再导航。失败恢复的选择保存重试成功后，用户可以再次恢复完成导航。

同来源外部顶部保存成功且 session.dirty=false 时，read 清回执。另有内容编辑时，回执明确显示 `pending-drift`，禁止把旧请求当成新状态的保存成功；必须由场地保存完成整个当前状态。来源/ownership 漂移即使新场地 clean，也不清旧回执，不把它宣称为旧 View 保存成功。

已经发出的真实持久化写入无法被 cancel 撤回；session 自身 ownership 保证迟到写不进入其他来源。导航运行中使用提供的 isCurrent 租约停止后续帧；宿主可在 UI 关闭或生命周期切换时通过既有 runtime 切换流程立即终止导航。cancel 不清失败保存回执。

## 边界与验收

不拍照、不调用 provider、不生成实体、不修改机位实体/temporal/计划图、不执行 camera possession、不删除已导出的画布节点。不把列表出现当作持久成功，不把持久选择当作相机完成。

专项验证：

```sh
node --test tests/studio-v3-saved-view-workspace.test.cjs
```

真实 session/history/ownership/persistence fixture 覆盖持久重开与 undo/redo、保存失败同 ID 重试、外部顶部保存、内容漂移、异步 setup/来源/runtime/editEpoch/事务/dispose 围栏、跨 stage/setup 导航时序、同选中 no-op 恢复、恢复保存失败、相机失败回执、纯 View CRUD 边界与 readonly/播放/拖动/baseline/non-orbit 门禁。该专项不是浏览器 UI 或真实 GPU 动画验收。

宿主接线已完成；真实生产菜单、跨状态恢复、保存失败原回执重试与刷新重开证据见[集成验收](../../../docs/verification/20261008-studio-saved-views.md)。本文件专项范围与集成验收分别记录。
