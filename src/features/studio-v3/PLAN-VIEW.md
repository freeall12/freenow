# Studio V3 俯视 SVG 交互层

`plan-view.mjs` 挂载独立 SVG overlay，使用最近一次成功渲染的 `plan-projection.mjs` snapshot。场景背景、renderer profile、author state、history 和时间轴写入均由宿主负责。设计依据为 `docs/research/STUDIO-V3-PLAN-20261008.md` 和本地官方 `WorkspacePlanView-HeQ7o6cq.js` 的静态源码；未执行官方 bundle 或访问官方服务。

## 接入

```js
const view = createPlanView({
  container,
  getSnapshot: () => ({...runtime.plan.read(), interactive: inputAvailable}),
  getMarkers: () => planWorkspace.readMarkers(),
  getNavigation: () => runtime.plan,
  beginEdit: request => planWorkspace.beginEdit(request),
  onSelect: entityId => selectEntity(entityId),
  onContextMenu: context => openExistingMenu(context),
  onReturn: returnToOnSet,
  onError: showError,
});
// 在成功渲染后和领域状态变更后刷新。
view.refresh();
```

返回 `{element, refresh, handleEscape, dispose, cancelGesture}`。`handleEscape()` 先取消当前手势，有待重试的回滚也优先取消；无手势时请求返回现场。`dispose()` 清理窗口监听、计时器和 overlay，不销毁共享 renderer/scene/model。

`getSnapshot()` 返回 `{active, ready, error, projection, zoom, rotation, sectionHeight}`，可附加 `sourceKey`、`sceneRevision`、`setupId` 作为稳定来源身份，以及 `interactive`。`interactive:false` 保留显示但禁止新的输入；现有实体编辑可等待自己触发的异步 busy，导航手势会取消。菜单、gallery、控制或确认弹层失效时宿主须调用 `view.cancelGesture()`，并调用领域 bridge 的 `cancel()` 关闭仍在等待的确认。来源变化必须改变稳定身份，或先设置 `ready:false` / `projection:null` 再刷新。每帧 projection 和 marker 新对象本身不会取消编辑。

`getNavigation()` 提供 `panPixels({dx,dy})`、`zoomBy(factor)`、`rotateBy(rad)`、`setSection(height|'all')`、`reset()`、`retry()`。这些调用只更新本地导航，不应写 author/history。

Marker 数据为 `{id, kind:'person'|'object'|'camera', position:{x,y,z}, heading, color, label, selected, locked, readOnly, visible}`。camera 额外提供 `camera:{fov, frameAspectRatio, focalLength}`，其中 `fov` 是垂直角度，`heading` 是统一 world yaw。`fovPresentation:'hidden'` 隐藏 live camera 的 FOV，供被选时间轴 key 的独立 overlay 接管。`visible:false` 不绘 marker。非编辑 marker 仍可选择；锁定／只读会阻止事务。

回调形状：

- `onSelect(entityId|null, marker?, event?)`：marker click 选择；空白左键按放且 Manhattan 位移不超过 4px 时清除。
- `onContextMenu({entityId|null, marker?, point, projection, clientX, clientY, event})`：使用同一投影解析 world point；即使缺 handler 也消费浏览器原生菜单。
- `beginEdit({entityId,kind:'move'|'heading'|'fov',marker})`：同步或异步返回 `{onMove(change),onEnd(),onCancel()}`，可返回 null 表示拒绝。移动／朝向 `onMove` 预览，最后一次 `onMove` 后 `onEnd`；FOV 仅在 pointerup 调一次 `onMove({heading,fov})` 再 `onEnd`，此前只在 SVG 本地预览。宿主将 camera 朝向和 optics 原子写入，保留其他旋转、scale 和时间轴目标。

## 交互和失败边界

移动／朝向／FOV 均以 Euclidean 距离 ≥4px 才申请事务。移动反解原 Y 的平面。朝向距实体小于 .05m 时拒绝结果；FOV 使用水平半角，保留对侧边后换回垂直 FOV，并按现有 optics 的 8–400mm 范围限制。可视 marker 尺寸固定为 1.55，不随世界 zoom 改变，方向按渲染 projection basis 旋转。marker 层按 10/20/30 优先级排序，FOV edge 为 40。

窗口 pointer session 按 pointerId 筛选，up/cancel/blur 清监听；Escape、失去 active/ready、来源身份变化、marker 删除／锁定／只读、dispose 均取消。等待 beginEdit 时持续保存最新指针和 pointerup；许可返回后仅处理最新坐标。取消后的许可返回只执行 rollback。onMove/onEnd 的异常或显式 false / `{ok:false}` 会报告并取消。onCancel 同样的失败会保留 lease，允许 Escape 重试，防止把回滚失败当完成；lease 取消应幂等。

空白左／中键拖动使用 Manhattan >4px 门槛。arrow 每次 42px；缩放 1.12；旋转按钮点按 ±15°，拖动 −dx*.008rad；wheel ctrl／line／page／大整数竖向 delta 缩放，其余 delta 平移。剖切 slider 0..1、step .001，`height=1.6*u/(1-u)`，1 为 all。加载失败隐藏 SVG 输入并显示原始中文“俯视图加载失败／重试”。

`plan-geometry.mjs` 仅包含抽取的 gt/vt camera path、Bn/Gn cursor、pt/Et 几何、标签算法和安装依赖中的同名 Tabler SVG。源文件 hash 随 module 保存。导航品牌按当前产品要求使用现有 `/assets/branding/freenow-mark.svg`，没有官方资源运行时依赖。

## 当前验收和差距

已验证：独立 DOM/SVG 命中与导航；实体移动／朝向；左右 FOV 对侧边固定、比例换算和单次最终提交；异步 pending 最终坐标；回滚与失效边界；原包几何／标签／控件尺寸；ready 与 interactive 分离。验证命令：

```sh
node --test tests/studio-v3-plan-view.test.cjs
node --check src/features/studio-v3/plan-view.mjs
```

没有在本模块内做真实 GPU 场景、source loader、bridge/history 或浏览器视觉验收；这些由集成宿主验证。`paths` 当前仅绘已有 points 的 polyline/虚线，无交互。官方 cubic、hold/playhead/rhythm、path 新 key、trajectory key、bend/endpoint proxy 和 hit priority 35/45 仍是下一块。新增 placement 与支撑面解析也由宿主后续接入。**本模块完成实体／FOV 闭环，不代表 P2 完整完成或浏览器 1:1 视觉验收。**
