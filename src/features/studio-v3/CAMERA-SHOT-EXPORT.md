# 本地镜头媒体导出

`camera-shot-export.mjs` 只负责真实离屏渲染与媒体编码；`webm-encoder.mjs` 使用浏览器原生 WebCodecs，把实际编码包封装为有限长度 WebM。不会调用 TapNow、媒体供应商、保存项目、写 LocalAssets 或创建画布节点。UI 发布事务由 `camera-batch-publish.mjs` 等调用方负责。

## 调用合同

```js
const exporter = createCameraShotExporter({
  getState, getSourceResource, getFence, isCurrent, onProgress,
});
const results = await exporter.render(shot, {signal, state: batchSnapshot});
exporter.dispose();
```

每项返回 `{type, blob, width, height, title, provenance}`。视频额外返回 `duration`（秒）和第一帧 `posterBlob`；contact sheet 返回镜头时长，但 `type` 明确为 `image`。默认 runtime 是 `autoRender:false` 的独立 Three 实例；当前交互 runtime 的相机、控制器和渲染循环不参与导出。

| 内容 | 实际格式 | 尺寸与时序 |
| --- | --- | --- |
| 静态镜头 | JPEG，质量 .92 | 4096×2304 |
| 动态镜头 | WebM，优先 VP9，其次 VP8 | 1280×720，30 fps |
| 无可用原生视频编码器 | WebP 六帧横向 contact sheet，质量 .82 | 4096×2304，采样覆盖 0 至镜头结束 |

WebM 返回 `video/webm;codecs=vp9` 或 `video/webm;codecs=vp8`，不宣称 MP4。动态输出含 `codec/fps/frameCount/durationMs` provenance。视频帧在 `i / 30` 秒采样，微秒时间戳由 WebCodecs 接收；离屏帧渲染耗时不会改变视频速度。原生队列达到 4 时 flush，累计编码包默认最多 256 MiB，每个 VideoFrame 和 encoder 均关闭。WebM 记录 Track 尺寸、默认帧时长、Segment Duration、关键帧和各帧时间戳；长镜头切分 Cluster。

## 构图与采样

导出先保持镜头自身的 optical aspect 离屏渲染，再按源证据 `F0` 用 `max(targetWidth/sourceWidth,targetHeight/sourceHeight)` 居中 cover crop 成固定输出比例；不拉伸画面。六帧 contact sheet 每格独立 cover crop。

请求镜头 ID 必须能从捕获快照的 `listCameraShots` 重新解析。关联真实摄像机的镜头调用 `sampleCameraShotState`，保留 baseline 权威性，按所有 schema 已知频道与官方时序公式返回临时领域状态。无关联静态 View 使用 `createCameraShotPreviewState` 与冻结的 View 光学状态。动态镜头必须有真实摄像机和正时长。详情见 [CAMERA-SHOT-SAMPLING.md](./CAMERA-SHOT-SAMPLING.md)。

实际 renderer 支持 transform、visibility、真实 actor clip、lookTarget 与 camera.lookAt；逐帧推进 clip mixer。采样完成并不等于所有领域字段已可渲染：

- 持握关系尚无真实 renderer 实现，非空 `heldEntityId` 明确报 `studio_v3_shot_render_unsupported`。
- 光圈景深当前依赖 Spark/Gaussian；普通 GLB 镜头使用 `aperture` 会明确报上述错误，默认 `deepFocus` 可正常导出。
- 实体或来源模型报告加载失败，明确报 `studio_v3_shot_resource_failed`，不发布不完整画面。

这些是本批真实呈现边界；schema 字段采样自身已完成，持握渲染与普通模型景深仍未完成。

## 所有权、取消与错误

渲染开始时深复制 state、来源资源和 fence；每次异步操作前后检查 signal、所有者与 fence。一次 exporter 只运行一个镜头。取消、关闭或来源变化后不返回结果；即使 encoder 已取消，也等待正在运行的 GPU 帧完成后再释放 runtime，且仅释放一次。观察者异常不改变导出所有权。

只有 `ShotVideoUnsupportedError`（缺少 VideoEncoder/VideoFrame 或 VP9/VP8 均不支持）触发 contact sheet。configure/encode/GPU/加载/取消/所有权错误全部传播，不能静默替代为图片。进度阶段包含 preparing、rendering、encoding、contact-sheet、completed。调用方不得把排队、渲染中或失败状态标为已生成。

## 验证与实证边界

```sh
node --test tests/studio-v3-camera-shot-export.test.cjs
node --check src/features/studio-v3/camera-shot-export.mjs
node --check src/features/studio-v3/webm-encoder.mjs
```

专项验证涵盖独立 snapshot/runtime、静态尺寸/MIME/比例、时序采样、poster、unsupported-only 回退、失败/取消/stale/busy、释放、持握/DOF gate 与原生编码器生命周期。单元测试使用 fixture 图片字节和 dummy 编码包，只证明控制流程与容器元数据，不证明真实视频可解码。

浏览器真实验收入口：`/src/features/studio-v3/qa/export.html`。页面只使用本地公开餐椅 GLB，可生成并下载 JPEG/WebM/contact sheet，也展示 `<video>` 实际解码尺寸和时长。

当浏览器原生下载不可用时，可明确点击“验证真实编码文件”进行本机 QA 验收：

```sh
node scripts/serve-studio-shot-audit.cjs
node --test tests/studio-v3-shot-audit.test.cjs
```

此独立脚本监听 `127.0.0.1:4197`，不接入生产服务器。按钮把本地公开模型生成的原始 Blob 发送至 `POST /audit`，只允许 `http://localhost:4196` 或 `http://127.0.0.1:4196` Origin、明确 WebM MIME、EBML 头和最多 2 MiB 数据。固定写入 `build/qa/studio-shot-audit/public-shot.webm`，不接收用户路径参数；同一时刻最多一次上传、保存与解码检查。没有外部网络、供应商或付费调用。

脚本使用既有 `FFPROBE_PATH` / `FFMPEG_PATH`，否则从 PATH 查找工具。ffprobe 返回受限元数据和实际 `-count_frames`；ffmpeg 使用 passthrough 输出真实解码帧的 MD5，避免生成补帧。stdout 只解析字段白名单、数字帧列和 32 位 hex MD5，HTTP 结果显示这些 JSON；不输出媒体字节、不记录任意工具 stdout/stderr。工具失败只返回固定错误。脚本四项 HTTP 守卫专项通过，注入检查器仅验证接口边界。

### 2026-10-08 真实文件验收

主线 CUA 实际生成视频并点击验收按钮后，独立读取原始落盘 WebM，ffprobe 与 ffmpeg 解码一致：VP9 Profile 0、yuv420p、1280×720、`30/1` fps、1.000000 秒、56649 bytes、30 个实际解码帧及 30 个不同 MD5。SHA256：`7ccab1ef7a28cda1dc3c30c82b96b62dbc8400790c1753818694ad51da7d8988`。

已实际查看解码帧 0、15、29 的拼接图：均能看到餐椅与地面，摄像机角度变化；三个样本不是全黑或空白。160×90 检查样本亮度标准差分别为 13.41、13.01、13.38，三者非黑像素比例均为 1。MD5 差异本身不等于视觉正确，以上结论同时依赖实际图像查看。

精简实证：[20261008-studio-shots-video.json](../../../docs/verification/20261008-studio-shots-video.json)。公开可播放样例：[dynamic-chair.webm](../../../docs/screenshots/20261008-studio-shots/dynamic-chair.webm)，与原始落盘字节完全相同。

此结论限定为一段 1 秒的公开本地 GLB 镜头，证明实际离屏渲染、原生编码和 WebM 解码闭环。未覆盖所有模型、长视频、Gaussian 或全部时间频道组合；未证明生产镜头管理器的批量持久化、最终安装包或 MP4 导出。持握关系和普通 GLB 光圈景深的未完成边界保持不变。本次独立文件验收没有重跑 HTTP 或功能测试。

源公式依据：[STUDIO-V3-VIEWS-PHOTOS-20261008.md](../../../docs/research/STUDIO-V3-VIEWS-PHOTOS-20261008.md)，官方只作只读本地源证据，未执行其代码或服务。
