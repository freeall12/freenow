# 视频深度原生适配

2026-10-05。**公开合同与本机媒体验证，真实 Key 与模型质量待验。** 本次不调用模型、不读取真实 Key、不上传用户素材；测试仅使用仓库 64×48、2 秒 MP4 与本机响应夹具。

## 来源与选择

- 安装包 `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` 的 `DEPTH_ANYTHING_VIDEO="depth-anything-video"` 与 `C3s`：provider FAL、model、一个 `video_url`，零来源或多来源报错。
- 已抓取官方 Web `reference/vendor-packages-CN3JnHbF.js` 的 `ZX` 使用同一单视频转换；`reference/vendor-pkg-canvas-CwfaULgq.js` 的 wireName 与 maxImages=0/maxVideos=1/maxAudios=0 一致。
- [fal 官方 API](https://fal.ai/models/fal-ai/depth-anything-video/api) 与[完整 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/depth-anything-video)：真实 endpoint 是 `fal-ai/depth-anything-video`。名称倒置的 `fal-ai/video-depth-anything` OpenAPI 为 404/null，未作为实现合同。
- 官方页面 Files 段明确允许 Base64 data URI，来源先在本机校验后提交真实字节，不需要新增 CDN 发布流程。
- [冻结完整 schema](research/video-depth-fal-contract-20261005.json) / [本机包与 Web 哈希、源码摘要和 data URI 合同](research/video-depth-evidence-20261005.json)。这些文件为研究证据；运行无需原站。

官方输入仅 `video_url` 必需；可选 model VDA-Small/Base/Large、五种 colormap、resolution auto/360p/480p/720p/1080p、max_frames（最多2400）、output_fps、side_by_side、include_raw_depths。输出 `video` 为 H.264 MP4 File，可选 `raw_depths` NPZ。它是相对深度可视化，不是工程测量或有尺度的场景重建。

## 本地闭环子集

`server/generation-video-depth.cjs` 只开放 `video.depth` 的 `local-depth-v1`：单 MP4、VDA-Large、grayscale、resolution auto、output_fps null、side_by_side false、include_raw_depths false。`max_frames` 使用实测全片帧数；不截短整片。固定说明 prompt 不发送模型；其他非空文字拒绝。

- 来源与结果均不超过32 MiB；来源宽<=1920、高<=1080，偶数尺寸、方形像素、无旋转；5–30 FPS 恒定帧率，1–2400 个真实帧。最大480秒仅为2400帧/5FPS的本地上限，并非供应商另行承诺。
- 官方只写 auto preserves input (max1080p)，未定义竖向1080p边界。本地保守采用1920×1080固定宽高边界；竖片高>1080拒绝，未推断供应商必然缩放方向。
- 复用既有 `createVideoMaskMediaTools().inspectVideo`：FFprobe读取每帧PTS/实际帧持续时间，FFmpeg完整解码；拒绝VFR、旋转、非方形像素、空索引、损坏/截断媒体。先验证完整 MP4 品牌，MOV/WebM不能换MIME冒充MP4。
- 公网 HTTPS 使用既有 DNS固定、连接端点验证、禁止跳转的媒体下载器；下载不携带 fal 授权。实际字节、MIME与声明大小必须一致，然后以 data URI 提交。内联来源同样解码，声明尺寸/时长不充当证明。
- 结果再次安全下载、完整解码，实际尺寸、帧率、帧数与时长必须符合原任务实测身份。音轨丢弃语义：源可有最多一轨音频，输出必须无音轨；不承诺恢复原声音。
- 不支持选段声明（clip/trim/sourceClip）、变速、重采样、改尺寸、额外文字/参考、彩色映射、原始NPZ、并排比较、批量生成或未经支持的供应商字段。调用前先物化真正片段；未知字段不忽略。

本机须可执行 FFmpeg、FFprobe；既有工具支持服务端 `FFMPEG_PATH`、`FFPROBE_PATH`。缺工具在来源验证阶段返回 `media_tool_unavailable` 且 `providerDispatched=false`，不会发送模型任务。

## 配置与接线

```json
{"depth-anything-video":{"kind":"video.depth","model":"fal-ai/depth-anything-video"}}
```

协议 `fal-video-depth-native`，API origin固定 `https://queue.fal.run`（可空使用默认）。Key留在服务端。导出 `createVideoDepthProvider`, `parseVideoDepthModelMap`, `MODEL`, `ALIAS`, `PROTOCOL`, `MAX_VIDEO_BYTES`。provider实现 `prepare`（同步静态校验）、`submit`（完整来源解码后一次POST）、`poll`、`cancel`、`generate`；共享路由、任务持久化和媒体归档由现有 generation 层接线。

请求兼容 `buildDepthRequest`：`nodeId === inputs[0].id`；`parameters.workflow=depth-video-studio`、`protocol=local-depth-v1`、`resolution=source`、width/height/duration与来源一致、preserveDuration=true、promptUsed=false。单一kind映射允许省略model；指定时必须为`depth-anything-video`，多种model字段须一致。

`metadata.capabilities.videoDepth["depth-anything-video"]`公开本地边界、`kind=video.depth`、`semantics=per-frame-depth`、`audioPolicy=discard`、`tapNowEquivalent=false`、requiresMediaTools；配置ready仅表示服务参数就绪，实际模型能力待验。

结果输出真实data MP4与实测width/height/duration；FPS/帧数保留在原任务身份中用于恢复校验，供既有materializer写成本机媒体。`sourceFileId`为fal queue request_id，不是画布来源文件ID；画布关联由host原请求/provenance负责。

## 恢复与故障

`vd1.`身份保存endpoint、别名、原request_id和实测宽高/时长/FPS/帧数；不含Key。任务层必须在POST回执后持久该ID，再轮询；`generate`会await异步`onTaskIdentity`。重启或Key轮换重建provider后仅GET原status/result，不重新POST。丢失POST回执、异常JSON、凭据回显、不完整媒体、尺寸/时长/帧数不匹配均unknown，不记成功；原ID仍可继续查询。

认证队列URL固定自行构造，忽略供应商status/response/cancel链接。整个受限JSON先作凭据检查，再交shared queue投影；结果下载也检查真实bytes。取消复用fal SDK队列合同，只是best-effort，`CANCELLATION_REQUESTED`/`ALREADY_COMPLETED`/`NOT_FOUND`不冒称模型已停止。

专项：`node --test tests/generation-video-depth.test.cjs`，涵盖完整schema锁定、exact wire、零POST拒绝、真实解码、原ID重建恢复、一次POST、媒体本地归档、unknown、不可信URL/凭据/流超时及存储回调。仓库视频是合同夹具，不能证明深度内容或VDA-Large质量。

本次 fresh 验证：视频深度适配11项 + fal队列10项 = 21/21；交叉审阅后 resultMode/missing source id 拒绝焦点1/1；复用媒体工具真实解码专项8/8，包含非零PTS/VFR拒绝、来源/结果损坏、SAR/FPS变化及取消边界。`node --check server/generation-video-depth.cjs`与`git diff --check`通过，冻结schema SHA256回读匹配。没有运行全库回归，也没有真实供应商效果验收。

## 隔离完整 pipeline 验收

启动 `node src/features/video-depth/qa/native-server.cjs 0`，自动只监听127.0.0.1上的一个空闲端口，输出 `/src/features/video-depth/qa/main.html?mode=pipeline&session=depth-native-1005-pipeline`。使用正式createGenerationGateway、routed深度适配器、临时磁盘任务/媒体、正式静态脚本；仅供应商fetch/download边界由受信任内部DI替代，未开放浏览器选传输/文件/密钥的配置。其他API拒绝，生成配置只读；CSP connect-src仅本机/data/blob。

灰度夹具 `src/features/video-depth/qa/media/depth-contract.mp4` 仅一份，来自仓库 `src/features/video-generation/qa/media/2.mp4` 经本机FFmpeg `hue=s=0`、H.264/yuv420p、原帧时序编码。SHA256 `be713115baff7fe0add78ff3c61b3ae143762f9832970f44ef58c91ff64dd6dc`；64×48、2秒、20FPS、40帧、2586bytes。这是灰度合同视频，绝非模型推断的深度。

`GET /api/generation/fixture-audit`返回supplierPosts/statusGets/resultGets/resultDownloads、已查询原ID、已下载原ID、输入字节数/哈希与本机archiveEntries；不输出Key或整段data。`POST /api/generation/fixture-control`接受严格JSON `{"mode":"unknown"}`（下一任务status暂不可用）或`{"mode":"release"}`（原status可恢复）；GET原tasks/by-key即可恢复，不需要新POST。

一次HTTP smoke已fresh通过：config就绪且无fixtureKey回显，其他API/配置写拒绝，任务成功并写真实`/api/generation/media/...`，回读2586bytes与原夹具exact相同；supplierPosts/statusGets/resultGets/resultDownloads各1，archiveEntries=2。浏览器验收应以起始audit的增量计算，不把这一次smoke计入UI提交。终止SIGTERM/SIGINT会关闭gateway并清理仅该临时目录，不修改用户项目。
