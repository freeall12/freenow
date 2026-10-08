# Studio V3 独立离屏摄影渲染

`photo-renderer.mjs` 复用现有 Three renderer，将独立克隆的 PerspectiveCamera 直接渲染到真实 WebGLRenderTarget，以默认 4096 长边读回 RGBA 像素（可显式指定 1–4096 整数长边），再翻转 Y 写入 2D canvas。`.capture()` 用 JPEG quality .92 编码；`.render()` 返回像素 canvas，供宿主后续编码。没有读取或放大 renderer.domElement 的像素。

此模块不改 runtime、entry、camera-capture，不写领域状态、素材或画布。宿主仍负责摄像机 checkpoint、拍摄权限、暂停常规绘制与最终保存。

## 官方来源

2026-10-08 静态核对本机 `WorkspaceViewfinderButton-BHqIWibq.js`：

| 来源／字符 offset | 合同 |
| --- | --- |
| `wl` 40167 | clone optical camera，按目标 ratio 设置 aspect；显式 ratio 时通过 Uo 裁切垂直 FOV |
| `ii` 35118 | 长边 4096，另一边 Math.round，至少 1；无效 ratio 回落 1.5 |
| `Qt` 34757、photo encoding profile | image/jpeg，quality .92 |
| `pi/fr/mi/gi`，38100–39700 邻域 | RGBA8 render target、renderer.outputColorSpace、线性过滤与禁 mipmap；读像素、上下翻转、写 canvas |
| `Ei/Jt/Ti/Ai`，41800–44400 邻域 | photographic 不含 editor entity 5、overlay 3 与 outline 6/7，保留 ground 4 独立 pass；Spark offscreen target/renderSize/encodeLinear 临时设置并恢复 |

层别与上游 helper 隐藏依据见 [摄影与相机接管调研](../../../docs/research/STUDIO-V3-CAMERA-POSSESSION-20261008.md)。模块显式关闭 clone 相机的编辑层，并隐藏标记为 helper/captureExcluded 的节点，以兼容本地 viewport 相机常开多个编辑层的现状。独立 ground layer 4 或 `userData.photoGroundReference=true` 不被通用 helper 排除；显式传入 getHelperRoots 的整个 root 始终隐藏。

## 调用接口

```js
const photos = createPhotoRenderer({
  renderer,
  scene,
  getFence: () => captureIdentity(),
  isCurrent: () => ownsCurrentScene(),
  settle: async ({camera, width, height, signal, fence}) => {
    await settlePhotographicSpark({camera, width, height, signal, fence});
  },
  getSpark: () => gaussian?.spark || null,
  getHelperRoots: () => [workspaceHelperRoot],
  // 可选同步 wrapper，例如临时开启已 settle 的 Gaussian layer。
  renderFrame: ({draw}) => withSettledGaussianVisibility(draw),
});

const result = await photos.capture({
  camera: actualPerspectiveCamera,
  longEdge: 4096, // 小尺寸预览可用 320；直接渲染更小目标
  frameAspectRatio: 9 / 16,
  frameHeightRatio: 1,
  optics: opticalSnapshot,
  resolveEntityPosition,
  boundsCenter,
});
// result = {canvas, blob, width:2304, height:4096,
//           mimeType:'image/jpeg', quality:.92}
```

`createPhotoRenderer` 参数：

- `renderer/scene` 必需；使用现有 renderer 与真实 Three.Scene。renderer 必须有常规 target、viewport、scissor、pixelRatio 读写 API，以及异步或同步 renderTargetPixels API。
- `getFence()/isCurrent()` 默认 null/true；生产宿主必须传入同一 capture 的领域／资源身份。fence 为 JSON 值，按结构精确比较；每个 await 前后检查。不要使用只验证 camera entity ID 的弱身份。
- `settle({camera,width,height,signal,fence})` 默认空等待；真实 SPZ 宿主负责等待资源、排序与 LOD，必须使用离屏目标尺寸。模块在 settle 之后读取 getSpark，允许 settle 首次创建 Spark。
- `getSpark()` 默认 null；返回实际 SparkRenderer。模块临时设置 target、renderSize、encodeLinear、focalDistance/apertureAngle，并全部恢复。
- `getHelperRoots()` 默认空列表；可交工作区辅助 root，不能把需保留的 ground references 放在该 root 内。
- `renderFrame({camera,target,profile,draw,signal,fence})` 默认 `draw()`；必须同步调用 draw **恰好一次**并返回严格 true。异步 wrapper 或仅返回 true 而没执行 draw 会被拒绝。宿主 wrapper 不得后台 enqueue Spark 更新。
- `createCanvas()` 默认 document.createElement('canvas')；必须具有 2D context；capture 还需要 toBlob。
- `createRenderTarget(width,height)` 默认新 WebGLRenderTarget；测试可注入，生产必须返回该尺寸的新目标，不能传借来的共享目标。

`.render(args)` 返回 `{canvas,width,height,mimeType,quality}`；`.capture(args)` 额外返回非空 image/jpeg Blob。两者都异步，默认不创建 data URL，避免重复 JPEG 编码与内存复制。

`args.longEdge` 默认4096，必须为1–4096整数；320直接渲染小目标，不先拍4K再缩放，JPEG质量仍为.92。这是通用小尺寸渲染参数；官方镜头管理缩略图按320×180包围框适配，宿主需另行换算所需长边，不能将任意画幅longEdge320称为相同算法。

`args.camera` 必須是真实 PerspectiveCamera。默认采用 source.aspect；有效 `frameAspectRatio` 显式覆盖 ratio，且使用 `2×atan(tan(source.fov/2)×clamp(frameHeightRatio,1e-6,1))` 裁切 FOV。输出 ratio 使用整数宽高，所以存在不足 1 pixel 的取整误差。相机位置／朝向复制官方 camera.clone 合同，源相机应为独立光学 camera。

`args.optics` 默认 source.userData.studioV3Optics，再回落 source FOV/aspect。DOF 复用 camera-optics 的真实 Spark 参数算法；GLB-only 没有额外 DOF 后处理，不能声称 JPEG 上模拟了景深。point/object focus 可通过 resolveEntityPosition/boundsCenter 计算正向轴向深度。

`.busy/.disposed` 为只读状态；`.dispose()` 禁止新请求，向正在运行的 settle 发送 AbortSignal，并在下一次异步恢复时拒绝结果。dispose 不强行销毁正在读回的 target：目标在读回 promise 结束后才能安全释放。`.whenIdle()`返回始终resolve的Promise<void>，等待当前请求全部settle/readback/encode与target/reservation清理；操作异常仍由原render/capture Promise报告。无活动请求时立即resolve。宿主关闭顺序必须是`photos.dispose(); await photos.whenIdle();`再dispose renderer或forceContextLoss，避免提前释放仍读回中的target/PBO。busy保持到清理完成。

## 摄影渲染与恢复

摄影相机在 settle 前关闭3/4/5/6/7，确保高斯LOD/排序使用实际主pass层。摄影 draw 主 pass 保留内容层，关闭 3/4/5/6/7，开启 autoClear；随后 ground pass 只画 layer 4，关闭 autoClear、清 scene.background/overrideMaterial，并临时关闭 Spark 可见性避免同一高斯被画第二次。宿主可在同步 wrapper 内临时开启真实高斯 layer。

模块不更改屏幕 DPR 或尺寸来渲染 4K。target 自有 viewport/scissor 使用物理像素；renderer.setRenderTarget 应用该目标 viewport，因此独立于屏幕 pixelRatio。

同步渲染区间的 finally 恢复：

- renderer 原 render target、active cube face/mipmap、viewport、scissor/test、pixelRatio/size、autoClear、tone mapping/exposure、outputColorSpace、clear color/alpha。
- scene background/overrideMaterial，原来可见的 helper；本来隐藏的节点保持隐藏。
- Spark target、renderSize、encodeLinear、focalDistance、apertureAngle、visible。

Three 0.186的readRenderTargetPixelsAsync在首个await前绑定framebuffer并提交readPixels/PBO，故模块先在摄影目标上启动readback，再在同步finally恢复共享状态，然后等待GPU完成。encode发生在恢复之后；离屏目标保留至 readback 完成再 dispose。所有错误、stale fence、编码失败与 dispose 最终释放本模块的 renderer reservation。不同 photo-renderer 实例也不能同时使用同一个 renderer；普通 runtime 绘制不受该 reservation 自动控制，宿主应通过 capturing 状态阻止竞争。

## 失败与验收

错误 code 包括 `studio_v3_photo_busy/stale/disposed/render_rejected/canvas/encode`。抛异常意味着没有可保存照片；模块不静默回落 viewport 截图，也不会创建素材或写画布。

```sh
node --test tests/studio-v3-photo-renderer.test.cjs
```

2026-10-08 专项原8/8通过，新增dispose/readback drain专项1/1通过：4096尺寸与翻行、真实 Three target/clone 与摄影两 pass、JPEG .92、完整恢复、异步 settle/readback/encode fence、并发／dispose、同步 readback、编码失败、320真实小目标、readback启动可变更共享状态时的恢复、正常/失败native read均在target清理后才完成whenIdle且不传播operation失败。测试使用真实 Three 对象与 GPU/Canvas adapter。[本批 Computer Use](../../../docs/verification/20261008-studio-shots.md)已补验本地角色的真实 4096 JPEG 和公开餐椅的动态 WebM。SPZ 在4096尺寸下的 LOD/排序、景深与实际摄影像素仍未实机验收。

宿主现在可使用`SplatContext.settleOffscreen(root,camera,{width,height,signal,assertCurrent})`和`renderSettled(root,camera,draw,同options)`，见[离屏SPZ合同](../world-node/SPLAT-OFFSCREEN.md)。旧`settle/enqueue/render`保留视口行为；摄影不能直接使用旧方法。
