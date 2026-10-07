# Studio V3 Three 运行时

`runtime.mjs` 把领域层的完整 schema 4 envelope 渲染为 Three 场景。渲染内容由 `world-space.mjs` 的 `renderSetup()` 决定：先合并共享基底，再加入独立状态实体。运行时使用 V3 实体 ID，不读取或改写 V2 studio 数据。

## 接入

```js
import {createStudioV3Runtime} from './runtime.mjs';

const runtime = createStudioV3Runtime({
  canvas,
  getState: session.getState,
  getFence: session.getFence,
  isCurrent: session.isCurrent,
  getSourceResource: stageId => resolveLocalStageResource(stageId),
  onStatus: event => showLocalRenderStatus(event),
  onTransform: event => applyDomainTransaction(event),
});

await runtime.sync();
// 容器尺寸变化后调用 runtime.resize(width, height)。
// 片场关闭或所有权移交时 await runtime.dispose()。
```

这里的三个应用回调是接入示例，由调用方提供。`getSourceResource(stageId)` 返回 `null` 表示空场景，或返回本地 GLB/SPZ 描述符 `{url, format, ...metadata}`；也接受 `{sourceUrl, sourceFormat}`。SPZ 元数据可放在 `splat` 字段中。场景源与角色/相机/道具分别解码和释放。

`getState()` 必须返回完整 schema 4 envelope，不能只返回 `worldSpace`。坐标使用 xyz，旋转使用弧度，镜头 fov 使用度。运行时使用领域层指定的 ground.y 作为支撑地面。

`getFence()` 可直接使用会话层返回的 `{nodeId, projectId, sessionToken, revision, editEpoch, sourceBinding}`。`isCurrent()` 必须判断当前会话所有权，关闭后返回 false。所有者、会话、sourceBinding、stage、setup 或资产描述变化会取消尚未完成的旧加载。同一资产加载中，调用方显式 `sync()` 可以推进 revision/editEpoch：保留同一次解码，并在完成时应用最新标题、姿态、可见性和变换。没有对应同步的旧 fence 不能发布迟到结果。

## 操作接口

| 方法 | 行为 |
| --- | --- |
| `sync(state = getState())` | 校验完整 envelope，同步源和实体，返回加载结果报告；失败由报告和 `onStatus` 表示 |
| `setView('orbit' \| 'plan')` | 切换真实透视 Orbit 或俯视正交相机；平面视图禁用旋转 |
| `selectEntity(id)` / `focusEntity(id)` | 更新选择框或将视图对准实际边界 |
| `entityObject(id)` / `entityCamera(id)` | 取得 ready 实体 Object3D 或独立 PerspectiveCamera，失败/未就绪返回 null |
| `hitEntity({clientX, clientY})` | 返回实体 ID、命中点、距离和 locked 标记，隐藏实体不参与 |
| `hitSurface(client, options)` | 返回 `{point, normal, source, distance}` 或 null |
| `attachTransform(id, mode)` | 连接真实 TransformControls；mode 为 translate/rotate/scale；锁定、隐藏或未就绪时返回 false |
| `cancelTransform()` | 恢复拖动前变换并发出 cancel；没有拖动时返回 false |
| `retryEntity(id)` | 显式重试 failed 实体；传 `'source'` 重试源模型 |
| `resize(width, height)` / `render()` | 同步尺寸或立即绘制 |
| `settle(camera)` / `renderCapture(camera)` | 等待 Gaussian 资源稳定，再使用指定相机绘制并返回 renderer 的 canvas |
| `setCapturing(boolean)` | 暂停或恢复普通视口刷新，供调用方协调捕获 |
| `dispose()` | 幂等释放 RAF、控件、图、Gaussian 上下文、模型和 renderer |

对象还暴露 `scene`、`renderer`、`graph`、`controls`、`transformControls`、`orbitCamera`、`planCamera`，以及只读的 `camera`、`view`、`selectedEntityId`、`disposed`。这些是渲染对象，不能替代领域层状态。

`onTransform({phase, entityId, transform})` 的 phase 依次为 begin、preview、commit；取消时为 cancel。调用方负责对应 `history.begin/preview/commit/cancel` 和保存。运行时不自行写入领域层或 CanvasStore。自己的 preview 同步不会取消当前拖动；切换来源或状态会取消。实体变为锁定/隐藏会解除控件。回调失败会恢复预览，取消回调失败也不会阻断 GPU 清理。

`onStatus` 使用 `{kind: 'source'|'entity'|'runtime', id, status, error?, code?}`。模型状态为 loading、ready 或 failed；加载失败会移除未完成的渲染根节点，不生成成功占位物。已失败资产需显式重试。

## 资产与资源边界

- V3 GLB 的独立导入预算为 **100 MiB**，现有 V2 的 12 MiB 限制不变。SPZ 沿用现有本地 **64 MiB** 预算及点数校验。
- 来源仅接受 LocalAssets 的 `asset:` 引用、内嵌模型 data URL、同源静态/媒体路径及同源 blob URL。拒绝外部模型地址、带凭据/查询参数的模型 URL、重定向和 GLB 外部纹理/缓冲区引用。GLB 必须内嵌完整资源。
- 网络响应逐块有界读取，默认并发 2，可配置 1–4；默认超时 60 秒。排队/读取/解码均使用 materializationScope 处理取消、当前身份校验和超时。无法立即终止的解码尾任务会释放迟到结果；并发数表示受控加载任务，不保证第三方解码尾任务立即停止 CPU 工作。
- GLB 使用真实 GLTFLoader、Draco 和 Meshopt。复用项目已有生命周期插件和资源释放方法。各实体独立解码，避免材质、骨骼和 mixer 相互污染。
- 内置角色为 `assets/studio/character.glb`，相机模型为 `assets/studio/camera.glb`，道具通过现有 `studio-library-data.mjs` 查询。角色归一到 1.7 高；相机模型最大边归一到 0.25；其他 GLB 按底部或声明的中心锚点归一。道具 descriptor 的 scale 由调用方写入领域 transform。
- 角色姿态匹配模型中的实际 clip 名称。缺失 clip 返回 failed，不能报告已切换。Standing 停留于静态姿态；只有可见、已就绪、含实际运动轨道的其他 clip 才持续更新。
- SPZ 使用现有 decodeSplat / splatProxy / SplatContext，记录坐标系及 metricScaleFactor、groundPlaneOffset；转移后的 GPU mesh 由 SplatContext 拥有并释放。

## 绘制、支撑与捕获

静态场景按需绘制。控件 change、状态同步、尺寸变化、资源完成、Gaussian dirty 或选择变化触发一次 RAF；控件阻尼未结束或可见动态角色才续帧。RAF 去重，隐藏标签页取消刷新，恢复可见时重新绘制。关闭时移除 visibilitychange 监听。

`surface-hit.mjs` 用真实 Mesh 光线求交，法线经世界 normal matrix 变换。`support-surface` 自上向下选最高且向上的表面，默认 normal.y ≥ 0.5，拒绝墙面和不可支撑面。source 明确为 `mesh`、`collider` 或 `ground-plane`。`options.colliders` 可提供真实 Mesh collider；运行时不会从 Gaussian 点云虚构表面法线，也不会自动导入 SPZ metadata 中的碰撞体。

helper、相机可视模型、隐藏/未完成实体不参与支撑命中。相机可视模型仍可被 `hitEntity()` 选择。角色/道具是捕获内容；网格、选择框、变换控件、相机可视模型和 camera helper 标记 captureExcluded。捕获期间临时隐藏这些对象，成功、异常和异步失败后均恢复。

`renderCapture()` 返回一次真实绘制后的 canvas。调用方应以 `setCapturing(true)` / finally `setCapturing(false)` 包裹需要稳定画布的导出流程；这里尚不包含 CanvasStore 节点创建、图片编码、附件保存或拍摄完成事务。

镜头相机同步 position、rotation、fov、focalLength、frameAspectRatio，并保留 apertureFNumber、focusDistance 等完整光学字段。当前没有景深后处理，保留字段不能视为已实现景深效果。空场景、GLB 和 SPZ 源已接入，room/panorama 专属绘制不在此模块中实现。

## 验证

```bash
node --test tests/studio-v3-assets.test.cjs tests/studio-v3-runtime.test.cjs
node --check src/features/studio-v3/runtime.mjs
node --check src/features/studio-v3/render-graph.mjs
node --check src/features/studio-v3/asset-loader.mjs
node --check src/features/studio-v3/surface-hit.mjs
```

2026-10-08：两组聚焦测试 **23/23 通过**。覆盖有界读取、100 MiB 独立预算、本地来源、真实 GLB 解码、并发/超时/迟到释放、基底与状态、姿态/镜头/材质、资源复用、会话与状态切换、表面法线、捕获恢复、变换事务及静态/阻尼/隐藏标签页调度。

角色使用当前仓库真实 GLB，3,294,764 bytes，SHA-256 `2a9cad40a4625a695f4c3b87bb4d93cad8fd1d5d38783fc2414e577157d122bf`；无需 DOM 替身就能解码真实 skinned geometry 与 14 个 clip。实际 Standing/Idle clip 也用于静态/动态判断测试。

相机使用当前仓库真实 GLB，14,948 bytes，SHA-256 `00f5a46007aee91cf8a9accd2584ad83b7dc3ce2396c1dd325ff61c3304004e7`；Node 测试仅为内嵌 PNG 提供尺寸解析 bitmap shim，因此确认真实几何解码，不能据此声称纹理 GPU 显示通过。其余隔离生命周期测试使用轻量资产替身；运行时测试的 renderer/controls 注入也只验证接口和调度。

本模块的聚焦测试没有验证真实浏览器 GPU、Draco worker、真实 SPZ 显示、生产入口与面板交互、截图或拍摄到画布的完整闭环；这些需要接入后的浏览器验收。
