# 摄像机拍摄与画布保存

`camera-capture.mjs`完成快门闭环：保存已接受的摄像机作者状态，通过独立 WebGLRenderTarget 真实渲染当前 optical camera，编码 JPEG quality .92，写入 LocalAssets，再创建与片场连接的图片节点，并等待画布持久保存。拍摄不退出摄像机接管，不追加 `capturedPhotos`，不自动保存 `worldSpace.views`。历史照片只读管理和时间轴拍摄仍需补齐；安装包导出的 `saveCurrentView` 回调不能证明官方存在同名直接 UI 按钮。镜头列表、重命名、删除与批量导出见 [镜头管理](CAMERA-MANAGER.md)。

## 接入

```js
import {createCameraCapture} from './camera-capture.mjs';

const shutter = createCameraCapture({
  app: window.CanvasApp,
  session,
  runtime,
  nodeId,
  assets: window.LocalAssets,
  onStatus({status, busy, applied, nodeId, captureId, width, height}) {}
});

try {
  const photo = await shutter.capture();
  // 仅此处可以报告图片已保存；photo.nodeId 指向真实画布图片。
} catch (error) {
  // error.applied=true 表示节点已创建，但这次操作未确认持久保存。
  // 保留当前实例，用户重试时再调用 capture()，复用原照片与节点。
}

shutter.busy;           // rendering / encoding / asset / canvas save 全过程
shutter.pendingReceipt; // null 或 captureId/nodeId/applied/width/height
shutter.dispose();     // 终止迟到结果；不删除已经应用的图片
```

`capture()`成功返回 `{ok:true,captureId,nodeId,asset,width,height,provenance}`；失败抛错。实例同一时间仅接受一次拍摄，第二次调用抛 `studio_v3_capture_busy`。`onStatus`按进度发送 `preparing`／`retrying`、`rendering`、`saving-asset`、`adding-to-canvas`、`saving-canvas`、`saved`／`failed`，最后 `idle`。`saved`发出时 `busy`仍为 true，最终 `idle`才为 false；成功详情来自 Promise 返回值。状态回调异常不会影响保存。

宿主应在 `busy`期间禁止关闭、切镜头、切 setup/source/project、改变光学设置或开启另一作者工具，并禁用重复快门。关闭前先 `dispose()`，这样旧结果不能在新片场中创建图片。失败后允许关闭，但必须展示真实 `applied`状态：图片可能已在画布中而未确认保存。`dispose`不回滚这种已应用修改。

## 依赖与权限

| 依赖 | 必须提供的合同 |
| --- | --- |
| `app` | `getState().nodes`、同步 `createConnected(nodeId,outputs)`、异步 `saveProject({beforeCommit})`；保存必须尊重守卫，并等待 CanvasStore 写入队列 |
| `session` | `getState()`、`flush()`、`getFence()`、`isCurrent()`；可选 `history.getActiveTransaction()`与 `getStatus()`用于拒绝活动编辑和未保存场景 |
| `runtime` | 实际 `camera`、`getVisibleCameraState()`、`renderPhoto(camera,options)`、`setCapturing(boolean)`；接管时需 `possessing`与 `checkpointCameraControl()`，预览时可提供 `previewCameraEntityId` |
| `LocalAssets` | `put(Blob)`在 IndexedDB 事务成功后返回非空 `asset:`引用 |

没有新 session envelope 或领域写入 API。场景保存仍走现有 `session.flush()`；图片保存走现有 `CanvasApp.saveProject()`。不用单独 `CanvasStore.flush()`重试失败，因为那会再次等待已拒绝的 latestSave，而没有生成新的保存快照。

离屏渲染与编码由 `runtime.renderPhoto` 提供，使用 `photo-renderer.mjs`。本模块默认使用 `crypto.randomUUID()`与 `Date.now()`；测试可注入 `createId`、`now`。`createCanvas` 参数保留旧适配器兼容性，当前拍照流程不调用它。可覆盖 `getFence`和 `isCurrent`，但必须保持真实 project/session/owner/source 资格；fence 必须是 JSON 对象，包含 revision，以及可追踪的 sourceBinding。`revision`／`editEpoch`属于渲染期间需固定的完整 fence，图片已创建后的保存重试只要求稳定身份和来源/setup 不变。

模块拒绝只读、活动作者事务、未保存或失效场景、非 PerspectiveCamera、无效 camera schema、WebGL context lost、空 JPEG 和非本地素材引用。PerspectiveCamera 类型检查不区分 orbit 与 viewfinder：宿主应按产品入口资格选择允许的光学模式，不能以此类型检查替代入口权限。模块仅访问本地 renderer、IndexedDB 与现有画布保存，不请求模型或生成 API。

## 拍摄顺序与失败

1. 接管时调用 `checkpointCameraControl()`，成功后保留 optical camera、接管模式和 viewport lease。脏作者事务提交，无变化事务取消；下一次真实输入才开启新事务。拒绝 checkpoint 时不渲染、不写素材。
2. 要求没有其他活动事务，等待场景 `flush()`成功且非 readonly、非 dirty；之后 `setCapturing(true)`冻结输入和转场。模块没有把 viewport 退出作为作者提交。
3. 固定真实 camera 与 pose/optics、owner 对象、完整 fence、stage/setup/source。`runtime.renderPhoto` 持有捕获 lease，暂停视口 RAF，排除编辑 helpers、hover 与选择轮廓，以真实离屏目标完成渲染和像素读回；必需场景来源与可见非camera实体资源先等待就绪，失败/失效或默认 30 秒超时明确拒绝且不编码；隐藏实体和被排除的 camera marker 不阻塞摄影。Gaussian 通过尺寸匹配的 settle/renderSettled 路径处理。
4. 按 optical `frameAspectRatio`（缺省 Three camera.aspect）直接生成该比例的离屏画幅。最长边必须为 4096，另一边四舍五入且至少为 1；编码非空 `image/jpeg` Blob，quality .92。尺寸或 MIME 不符合要求时拒绝保存，不回落或拉大 viewport 图片。
5. 每个异步边界重新检查身份和镜头。仅编码成功后保留 receipt；`LocalAssets.put`失败可直接重试这张已编码快照。写入途中失效可能留下未关联的本地 asset，但不会继续创建图片。
6. 同步 `createConnected`创建图片。真实 CanvasGeometry 会把节点展示宽度设为 446；`pixelWidth`／`pixelHeight`保留 JPEG 实际尺寸。图片带拍摄 provenance，成功后才能等待受守卫保护的 `saveProject`。
7. 素材或持久保存失败，保留 receipt；再次 `capture()`复用 Blob／asset／nodeId，不重拍、不重复节点。若 `createConnected`在同步加入节点后抛错，以 captureId 找回已应用图片。节点已删除、素材/provenance/像素尺寸已修改则拒绝重试，避免覆盖用户编辑。
8. 保存成功后清 receipt；无论成功失败，解除 `setCapturing`。迟到结果、source/setup/project 变化或 dispose 都不能报告成功。错误带 receipt 时附 `applied,nodeId,captureId,width,height,retryable`，其中 `retryable`仅表示实例/ownership仍可用，重试仍会核验节点。

图片 `provenance`含 `kind:'studio-render'`、`sceneId`、`sceneVersion:3`、`captureId`、`source:'possession'|'camera'`、`sourceNodeId`、`sourceKind`、`stageId`、`setupId`、`sourceCameraEntityId`、完整 `camera`、`revision`、`createdAt`。这是画布图片的本地溯源合同，不是官方 historicalPhotos item schema。

## 官方依据与本地差异

本次仅静态读取安装包，不执行官方 JavaScript 或请求官方 API。完整 hash 与来源见 [摄像机接管研究](../../../docs/research/STUDIO-V3-CAMERA-POSSESSION-20261008.md)。下面 offset 是解码后 JS string 的零基字符位置：

- `ThreeDWorkspace-BzPphAqB.js`：`w2`（189537）调用 capture 后以 `exportToCanvas([{src,title,aspectRatio}],{allowConcurrent:true,toast:false})`加入画布；`ny=5`限制最多 5 个 pending export。本地为单次串行保存，优先保证可重试回执。
- 同文件 `LS`（56055）序列化历史照片；`historicalPhotos.load`（61666）读取既有数据。这些路径不能证明当前 shutter 追加历史照片。`saveCurrentView` callback（277037；公开绑定 281161）显式调用 `qx`（245003）保存带 setup/stage/camera 的 view，shot view另加 tags并设置 active。它们与快门 export 分离。
- `WorkspaceViewfinderButton-BHqIWibq.js`：`wl`（40167）clone optical camera，以 `ii`（35118）指定 4096 长边的 offscreen 渲染，再用 `Qt`（34757）按 photo profile 编码；官方 photo profile 为 JPEG quality .92。本批已采用相同编码 profile。

本批直接渲染真实 4096 长边离屏目标，不读取或放大 renderer viewport。`cameraCaptureGeometry` 保留为旧 viewport 路径的兼容几何函数，不参与新快门流程。整数输出比例存在不足 1 pixel 的取整误差。单次快门串行保存与幂等回执是本地增强；历史照片、完整时间轴拍摄和多快门并发仍未交付。GLB 景深后处理未实现，真实 SPZ 4096 摄影像素与景深尚未实机验收。

## 验证

```sh
node --check src/features/studio-v3/camera-capture.mjs
node --test tests/studio-v3-camera-capture.test.cjs
```

本批摄像机 capture 与生产 scope 守卫专项共 10/10 通过，覆盖 4096 JPEG／本地素材／连接图片／保存顺序、checkpoint、拒绝 foreign transaction／readonly、失败回执与幂等重试、异步失效、dispose、并发拒绝、保存守卫、用户删除或修改图片、以及不追加历史照片／视图。renderPhoto、编码与存储在专项中使用适配器，不能单独证明 GPU 像素。

[2026-10-08 Computer Use 证据](../../../docs/verification/20261008-studio-shots.md)补充真实生产入口：横幅照片 naturalWidth/Height 为 4096×2170；9:16 为 2304×4096。注入媒体持久保存失败后，快门显示“重试保存照片”；重试成功并刷新，captureId/nodeId/asset 不变且只新增一个照片节点。历史照片与 views 仍为 0。图像真实完成解码，不把场景保存前的失败误报为照片保存重试证据。
