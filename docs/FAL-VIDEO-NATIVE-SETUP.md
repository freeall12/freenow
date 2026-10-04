# fal 视频增强原生接口

`server/generation-fal-video.cjs` 提供 `createFalVideoProvider({baseUrl,apiKey,modelMap,fetchImpl})`。使用 fal Key 和显式映射即可连接官方队列，无需自行开发 tasks-v1 网关。模块不新增依赖，复用 `generation-fal-queue.cjs`。本次只进行了公开文档 GET 与本地合同测试，未调用收费模型，未验收真实增强画质。

## 可使用的菜单

| 现有菜单 | 本模块映射 | 边界 |
| --- | --- | --- |
| FLUX Video Upscale 精准 / 创意 | `fal-ai/flux-video-upscale` | 与官方前端参数对应；保留原比例，1.5–3 倍，MP4 ≤20 秒、≤50,000,000 字节；仅创意模式接受提示词 |
| Topaz Labs 视频增强 | `fal-ai/topaz/upscale/video`，显式 `Proteus` | 原速；auto / 30 / 60fps；1–4 倍；输出明确指定 H.264 |
| Topaz 90fps / 2x 慢放 | 未提交 | 当前 OpenAPI 没有等价配置，不降成 60fps、不丢弃慢放 |
| 主体替换 / 物体移除 | 保留原 tasks-v1 边界 | 前端使用逐帧 RLE 蒙层与替换图片；不能用提示词视频模型冒充蒙层编辑 |
| 视频重拍 / 延长 | 保留已有专用边界 | 分镜运镜/视角与延长方向、参考主体等尚无本批核实的同义接口；已有 Ark `VIDEO_EDIT` 不等于重拍编辑器的全部行为 |

UI 依据：`reference/video-upscale.md`、`reference/video-mask.md`、`reference/video-reshoot.md`、`reference/video-creation.md`，及发布包 `vendor-pkg-canvas-Bx0RCmle.js` / `vendor-packages-Bt6k8W9q.js`。这些是产品语义证据；本地 mock 成功不能证明真实供应商效果。

## 配置

```sh
export FAL_KEY='YOUR_FAL_KEY'
export FAL_VIDEO_MODEL_MAP='{"flux-video-upscale":{"kind":"video.upscale","model":"fal-ai/flux-video-upscale"},"prob-4":{"kind":"video.upscale","model":"fal-ai/topaz/upscale/video","enhancementModel":"Proteus"}}'
export GENERATION_PROVIDERS='{"falVideo":{"protocol":"fal-video-native","apiKeyEnv":"FAL_KEY","modelMapEnv":"FAL_VIDEO_MODEL_MAP"}}'
export GENERATION_ROUTES='{"video.upscale":{"models":{"flux-video-upscale":"falVideo","prob-4":"falVideo"}}}'
```

将占位 Key 换成自己的 Key，或使用已有 `.env` 配置流程。Key 不写入 modelMap、请求、浏览器存储或结果记录。已有供应商/路由应合并对应条目，不能覆盖其他操作的配置。

单供应商：`GENERATION_API_PROTOCOL=fal-video-native`，`GENERATION_API_KEY` 为自己的 Key，`GENERATION_MODEL_MAP` 使用上述映射。默认地址固定 `https://queue.fal.run`；可省略 `GENERATION_API_BASE_URL`。

`prob-4` 仅是既有前端请求的公开别名；操作者必须显式选择真实 `enhancementModel:"Proteus"`。模块不会根据名称推断版本，也不会把 FlashVSR、Artemis 或 Starlight 偷换为原菜单的模型。当前 Topaz 支持范围仅为此明确选择的 Proteus 子集。

## 请求与结果合同

输入保持现有 `src/features/video-upscale/core.mjs` 的 `video.upscale` 请求：一个 `source_video`、原尺寸、目标长边。FLUX 的 `mode/creativity/upscaleFactor/durationSeconds/duration` 必须一致；Topaz 的 `width/height/frameRate/slowMotion` 必须对应原尺寸与目标，拒绝裁画幅、缩小、额外滑块、多结果和供应商不明参数。

本机来源须为实际 MP4 数据 URI。API 页面明确允许 Base64 data URI；本模块验证规范 Base64、完整 MP4 容器、真实字节大小上限。完整解码、尺寸与时长由既有浏览器读取流程及官方模型 API 验证；容器检查不声称证明文件一定可完整播放。公网输入只允许不含凭据的 HTTPS，拒绝原站、localhost、私网 IP 等；公网真实大小和时长最终受 fal 的官方限制，未提前下载整片做额外收费操作。

片段必须先用既有 `LocalMedia.process('trim',...)` 得到真实选段 MP4，再移除裁片指令。任何遗留 `clip`、`trim`、`sourceClip` 都拒绝，不能处理整片替代选区。`src/features/video-upscale/ui.mjs` 已有这一实际裁片流程。

Topaz发送 `{video_url,model:"Proteus",upscale_factor,H264_output:true,target_fps?}`；auto 不发送 target_fps。FLUX发送 `{video_url,upscale_factor,creativity,prompt?}`，不自动放宽安全参数。结果必须是官方单个 `video` File 的公网 MP4 URL；若声明 image/png、私网或带凭据 URL、无效文件大小则保持 unknown。缺省/nullable content_type 不捏造 MIME，交既有本机 materializer 下载和识别实际视频字节。不会虚构封面、输出尺寸或进度百分比。

## 恢复与失败

原任务 ID 绑定 endpoint、request_id、kind 和显式增强模型。刷新/进程重建后只查询同一任务，映射变化时不换模型。队列回执、状态、结果中的 request_id 必须一致。POST 丢失响应、404、超时、未知状态或无效结果都不会自动再次提交。取消使用官方 PUT，但回执不等于远程计算已停止。

Topaz 提交用完整 endpoint `/fal-ai/topaz/upscale/video`；状态、结果、取消使用 `/fal-ai/topaz/requests/:id`，与官方 JS SDK 的 `parseEndpointId` + owner/alias 实现一致。不能照生成 OpenAPI 的展开路径误改共享队列，也不能把供应商返回的 status_url 当作带 Key 请求的权威目标。

## 官方证据与验证

公开 GET 获取于 2026-10-03；完整 OpenAPI 留档 `reference/fal-video-native-20261003.json`。

- [FLUX 官方 API](https://fal.ai/models/fal-ai/flux-video-upscale/api)、[agent 文本](https://fal.ai/models/fal-ai/flux-video-upscale/llms.txt)、[OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-video-upscale)
- [Topaz 官方 API](https://fal.ai/models/fal-ai/topaz/upscale/video/api)、[agent 文本](https://fal.ai/models/fal-ai/topaz/upscale/video/llms.txt)、[OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/topaz/upscale/video)
- [官方 JS SDK 队列实现](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/queue.ts)

Topaz 页面描述还提到 8x/120fps，而当前公开 input schema 只有 1–4 倍/16–60fps；本模块按较窄、可验证的 schema 执行。不能用宽泛描述越过明确参数限制。

```sh
node --test tests/generation-fal-video.test.cjs tests/generation-fal-queue.test.cjs tests/video-upscale.test.cjs
node --check server/generation-fal-video.cjs
```

12 项模块合同、10 项共享队列、5 项现有菜单核心测试通过，覆盖精准/创意实际字段、Topaz明确编码、unsupported 零 POST、MP4与片段校验、原ID恢复、模型变化、未知结果不重发和取消边界。真实画质、音轨保留、输出播放及收费容量仍需用户配置 Key 后另行验收；本批不做真实收费调用。
