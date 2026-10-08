# 俯视新实体摆位

`plan-placement.mjs` 将新增角色／摄像机接到现有 `reduceEntityAction`、`StudioSession` 与真实资源 graph。官方依据：`ThreeDWorkspace-BzPphAqB.js` 的 `GC` 498313、`l4` 498905、`kW` 255465，以及 `EnvironmentLightingPickerContent-CigxxFZu.js` 的 `ar` 53236。未调用生成 API。

## Purpose / Inputs / Outputs

```js
const placement = createPlanPlacement({
  getState: session.getState, session,
  getRuntime: () => runtime,
  isCurrent: session.isCurrent,
  getBusy: externalBusy,
  beforeWrite: () => temporal.beforeWrite(),
  onLane: lane => { lastLane = lane; },
  onChange: refreshPlan,
  onSelect: selectEntity,
  onError: showError
});
const lease = await placement.begin({
  kind: 'actor', label: '角色名',
  point: {x, z}, projection: lastDisplayedProjection
});
lease?.onMove({position: currentPoint});
lease?.onEnd();
```

| 接口 | 输入／输出 |
| --- | --- |
| `begin(descriptor)` | `Promise<lease|null>`；`kind` 为 actor/camera；新角色需要非空 trim 后 label，支持 color/actorGender；`roleId` 表示同 stage 的已有 role。可传 world point，或 nx/ny；projection 可选且必须对应当前成功显示的 frame。 |
| `lease.onMove({position?,heading?})` | 同步 boolean；heading 为世界弧度，有显式 heading 时优先使用。position 只用于首点→当前点算朝向，距离小于 .05m 不改变朝向，不移动 entity。非法有限值拒绝。 |
| `lease.onEnd(patch?)` | 同步 boolean；可应用最终 heading/position，再提交一次事务。无拖动默认 heading0。 |
| `lease.onCancel()` / `cancel()` | 同步 boolean；等待 beforeWrite 或模型资源时也可取消；重复取消已取消 lease 返回 true，不操作后来事务。 |
| `dispose()` | 同步取消自己的事务，拒绝后续 begin；不销毁共享 scene/renderer。 |
| `active` | detached `{entityId,kind,point,pending}` 或 null，供 host 状态提示使用。 |
| `runtime.resolvePlanSurface({point?,nx?,ny?,projection?})` | 返回 `{point,normal,source,distance}` 或 null。只使用最近成功 plan projection 的 x/z，向下选择 normal.y≥.65 的最高可用 mesh/collider；无支撑才 fallback 到 groundY。点输入忽略 y。 |

`createId`、`now` 可注入用于确定性宿主／测试；默认 UUID 和当前时间。父层负责 window pointer capture、pointerId 过滤、迟到 lease 取消、Escape、blur、关菜单／切换 setup／source 前调用 cancel。`getBusy` 只能表示外部独占状态，不能包含本模块 pending、transaction、selection 或 host 的 planPending 描述符。

## Permissions

只使用当前可编辑的 session；任何 mutation 仍由 session ownership/persistence 门禁验证。camera 只允许 independent setup。baseline 角色进入共享 entityStates，使用 world lane；独立状态的角色／摄像机仅进入当前 entityStates，使用 `setup:<setupId>` lane。新增角色定义、实例和后续朝向共一个 world-space scope 事务。模型通过既有 local asset loader，不新增依赖、生成请求或远端素材访问路径。

begin 在 pointerdown 同步解析并保存支撑点，然后等待 beforeWrite。创建 heading0 的首个 preview 后 await 当前作者 state 的 runtime.sync；仅真实 graph entity ready 后选择实体并返回 lease。同一 state 的宿主 sync 重用 loading record，不重复加载。拖朝向复用 transform-coordinates，保持实体 position/scale 并由实体 reducer 同步 camera optical pose。

## Failure modes / Logging

busy、foreign transaction、基准 camera、无 ready plan frame、过期 projection、无效 role 或空新角色名均返回 null。作者 node/stage/setup/source/fence、runtime/graph/sourceRecord 任一变化使 gesture 拒绝后续输入，且只取消自己拥有的事务。revision 保存确认不会使 gesture 失效；editEpoch 会随自己的 preview 更新 token。

资源失败回滚 role/entity/state 全部 preview，不产生历史记录。cancel 在异步准备期间立即回滚；迟到资源由 render graph 自己取消／释放。cleanup 只在同 runtime/graph/source、当前作者身份且没有新 gesture 或 foreign transaction 时重同步当前 state；不会重新应用旧 snapshot。错误交给 onError；状态刷新交给 onChange，history label 为 `director.placeEntity:<entityId>`，实体 ID 使 lease 不会匹配后来的事务。模块没有隐式日志持久化。

## Tests

```bash
node --test tests/studio-v3-plan-placement.test.cjs
```

定向覆盖真实 session+runtime+graph：点按创建、最高支撑、baseline 共享／独立局部、已有 role、camera optical heading/+1.6、固定首点、单步 undo、重复 sync 资源复用、失败／迟到资源释放、等待取消／dispose、stale author／foreign transaction fence、last displayed projection 和保留旧实体 y 的区别。该检查不是 UI／视觉验收。
