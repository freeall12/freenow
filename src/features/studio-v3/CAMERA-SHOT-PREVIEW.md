# 镜头缩略图渲染合同

`camera-shot-preview.mjs` 使用独立 canvas 和 `createStudioV3Runtime`，不借用当前片场 viewport、相机、画布或控制会话。默认 runtime 保留真实 asset loader、render graph、Spark 和正式 `renderPhoto` 拍摄流程。`autoRender: false`，禁止操控输入，不启动持续 RAF 绘制。

```js
const thumbnails = createCameraShotPreview({
  getState: () => session.snapshot(),
  getSourceResource: (stageId, shot) => host.sourceResource(stageId, shot)
});
const image = await thumbnails.request(shot, {
  signal: requestAbort.signal,
  isCurrent: () => currentOwner === owner && currentShotRevision === revision
});
imageElement.src = image.url;
// 替换镜头、关闭面板或移除图片时释放该消费者的地址。
image.dispose();
await thumbnails.dispose();
```

## 输入与快照

- `shot` 是 `listCameraShots` 返回的 detached descriptor；读取其 `stageId`、`setupId`、`id`、`setup`、`entities`、`camera`。
- `getState()` 和 `getSourceResource(stageId, shot)` 必须同步返回同一片场所有者的严格 schema v4 state 和 JSON 源资源描述；源资源可为 `null`，表示真正的无源场景。资源解析由独立 runtime 的默认本地 asset loader 完成。
- 在 request 调用时立即复制 state、shot、资源。排队期间的域编辑不会改变该请求正在渲染的对象。
- `createCameraShotPreviewState(state, shot)` 把 shot 已合并的 baseline 与独立 setup 固定为渲染快照：仅在复制品中清空目标 stage baseline 的 entityStates，将 shot.setup 完整装入目标独立 setup、shot.entities 装入 definitions，设置 active stage/setup，清空 active view。所有域关联再由 `assertState` 和相机目标验证检查。这个渲染专用快照不可写回或持久化。
- shot 的 roles、其他域关系依赖 full state；若快照关系已经不匹配，请求失败。宿主的 `isCurrent` 应检查所有者和实际场景版本，返回字面量 `true` 才可完成。

## 拍摄与输出

先等待 `runtime.sync(snapshot)`，再从 shot.camera 创建真实 Three PerspectiveCamera，应用完整镜头参数、rotation order 和 lookAt。点目标直接使用 shot 值；实体目标从独立 render graph 的世界位置解析。动态镜头缩略图使用 descriptor 当前静态姿态；本模块不采样时间线、不实现视频导出。

调用 `runtime.renderPhoto(camera, {longEdge, frameAspectRatio})`，得到真实 JPEG Blob。输出保持光学画幅，bounding-fit 于 320×180，不补边、不拉伸：16:9 为 320×180，9:16 为 101×180，1:1 为 180×180。自动画幅在这个横向预览表面解析为 3:2。JPEG 质量严格为 `.92`。

`request(shot, {signal?, isCurrent?})` 返回 `Promise<{url, width, height, dispose}>`。`dispose()` 幂等，首次返回 true，后续返回 false。图片的 object URL 是单个消费者的 lease，缓存命中也生成独立 URL。

## 缓存与资源所有权

- 所有实际渲染串行，前一请求关闭 runtime 后才开始下一请求；排队的相同内容通过首个完成结果的缓存复用。
- LRU 最多 96 项、16 MiB。字节预算包含 JPEG Blob size 和 cache key 的 UTF-16 字符字节估算。`maxEntries`、`maxBytes` 注入只允许降低上限；超预算单图直接返回而不缓存。
- key 包含源资源、world owner、stage、环境、房间、角色、definitions、合并 setup、camera。shot.title 单独修改不影响 key；场景其他对象或源资源变化不能误用旧图。
- 缓存只拥有 Blob。驱逐不会撤销仍显示的消费者 URL；因此消费者保留的 URL leases 不计入 LRU 预算，宿主必须释放替换或卸载的图片。
- 服务 `dispose()` 异步取消正在执行及排队的请求，清缓存，撤销全部仍保留的 URL，等待独立 runtime 清理。可读取 `disposed`、`cacheSize`、`cacheBytes`。

## 取消、失败和权限

AbortSignal 在排队、资源 sync、正式拍摄期间可取消请求。取消会提前关闭独立 runtime，触发其内部资产加载与拍摄所有权失效；请求最后再次检查 signal/current，过期结果不进入缓存或 UI。没有轮询 `isCurrent`；宿主主动变化时应同时 abort 旧请求，以及时释放资源。

源资源加载失败、实体未 ready、runtime failed 状态、GPU/编码错误、非 JPEG/空 Blob、错误尺寸都会 reject。常用错误码：`studio_v3_shot_preview_unavailable`、`studio_v3_shot_preview_aborted`、`studio_v3_shot_preview_stale`、`studio_v3_shot_preview_disposed`。底层错误可直接传播。UI 应显示“缩略图不可用”或请求取消状态，不生成替代假图。

本模块不写领域、history 或外部服务；只读取宿主授予的资源，使用既有本地 asset loader 权限。测试适配器 `runtimeFactory`、`createCanvas`、`createObjectURL`、`revokeObjectURL` 只用于聚焦验证；宿主应保留真实默认 runtime。

## 验证

```sh
node --test tests/studio-v3-camera-shot-preview.test.cjs
```

专用测试覆盖严格 baseline 合并快照、横竖画幅、真实 Three 光学与 lookAt、串行缓存与 LRU、源/场景变更失效、URL lease、排队/运行取消、过期结果、加载与编码失败、服务销毁。测试注入 runtime 验证合同，未证明浏览器 GPU、Spark LOD 或实际模型图像的视觉验收；宿主接入后需真实场景检查。

主线已在真实镜头管理中解码并显示 101×180 的本地角色竖幅 JPEG，见 [Computer Use 证据](../../../docs/verification/20261008-studio-shots.md)。没有据此外推全部模型或 SPZ 缩略图可用。
