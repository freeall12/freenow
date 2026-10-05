# 视频深度原生适配

2026-10-05。**公开合同与本机媒体验证，真实 Key 与模型质量待验。** 本次不调用模型、不读取真实 Key、不上传用户素材；测试仅使用仓库 64×48、2 秒 MP4 与本机响应夹具。

## 来源与选择

- 安装包 `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` 的 `DEPTH_ANYTHING_VIDEO="depth-anything-video"` 与 `C3s`：provider FAL、model、一个 `video_url`，零来源或多来源报错。
- 已抓取官方 Web `reference/vendor-packages-CN3JnHbF.js` 的 `ZX` 使用同一单视频转换；`reference/vendor-pkg-canvas-CwfaULgq.js` 的 wireName 与 maxImages=0/maxVideos=1/maxAudios=0 一致。
- [fal 官方 API](https://fal.ai/models/fal-ai/depth-anything-video/api) 与[完整 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/depth-anything-video)：真实 endpoint 是 `fal-ai/depth-anything-video`。名称倒置的 `fal-ai/video-depth-anything` OpenAPI 为 404/null，未作为实现合同。
- 官方页面 Files 段明确允许 Base64 data URI，来源先在本机校验后提交真实字节，不需要新增 CDN 发布流程。
- [冻结完整 schema](research/video-depth-fal-contract-20261005.json) / [本机包与 Web 哈希、源码摘要和 data URI 合同](research/video-depth-evidence-20261005.json)。这些文件为研究证据；运行无需原站。

普通视频节点入口的补充证据来自 `reference/canvas-current-readable.js`：`Bqe` 调用普通 `tme` 模型菜单，模型名 **Depth Anything Video**、TapNow 图标、NEW 标记；`ene` (`VideoGenerationControls`) 在 `promptPolicy=optional` 时清空已有提示词并只读，显示“该模型无需prompt输入”，语音输入同步锁定。规格弹窗仍可打开：单一“视频编辑”方式，比例/分辨率/时长为静态“自动”，没有可修改的音频/模式/质量选项。参考选择使用通用 picker（IMAGE/VIDEO/AUDIO/TEXT），不能声称官方 picker 已只过滤视频；深度原生转换最终只接收一个源视频。

官方数量控件在模型未声明 `timesOptions` 时回退 `[1,2]`，Depth 的 `options={}`，因此提供 1/2 个结果。`Zv` (`useGenerateVideo`) 的 `wb()` 默认 `variants`，将结果注入当前目标节点及历史变体；其他模式经 `T4e/fL/S4e`：空目标的首个结果使用当前节点，其余新增，已有媒体且 preserve-source 时全部新增。来源从 incoming edges 读取，来源节点与当前目标节点可以不同；这是普通模型生成路径，没有已填充视频工具条的特殊 depth 替换入口。

官方输入仅 `video_url` 必需；可选 model VDA-Small/Base/Large、五种 colormap、resolution auto/360p/480p/720p/1080p、max_frames（最多2400）、output_fps、side_by_side、include_raw_depths。输出 `video` 为 H.264 MP4 File，可选 `raw_depths` NPZ。它是相对深度可视化，不是工程测量或有尺度的场景重建。

## 本地闭环子集

`server/generation-video-depth.cjs` 只开放 `video.depth` 的 `local-depth-v1`：单 MP4、VDA-Large、grayscale、resolution auto、output_fps null、side_by_side false、include_raw_depths false。`max_frames` 使用实测全片帧数；不截短整片。固定说明 prompt 不发送模型；其他非空文字拒绝。

- 来源与结果均不超过32 MiB；来源宽<=1920、高<=1080，偶数尺寸、方形像素、无旋转；5–30 FPS 恒定帧率，1–2400 个真实帧。最大480秒仅为2400帧/5FPS的本地上限，并非供应商另行承诺。
- 官方只写 auto preserves input (max1080p)，未定义竖向1080p边界。本地保守采用1920×1080固定宽高边界；竖片高>1080拒绝，未推断供应商必然缩放方向。
- 复用既有 `createVideoMaskMediaTools().inspectVideo`：FFprobe读取每帧PTS/实际帧持续时间，FFmpeg完整解码；拒绝VFR、旋转、非方形像素、空索引、损坏/截断媒体。先验证完整 MP4 品牌，MOV/WebM不能换MIME冒充MP4。
- 公网 HTTPS 使用既有 DNS固定、连接端点验证、禁止跳转的媒体下载器；下载不携带 fal 授权。实际字节、MIME与声明大小必须一致，然后以 data URI 提交。内联来源同样解码，声明尺寸/时长不充当证明。
- 结果再次安全下载、完整解码，实际尺寸、帧率、帧数与时长必须符合原任务实测身份。音轨丢弃语义：源可有最多一轨音频，输出必须无音轨；不承诺恢复原声音。
- 支持1或2个结果：两个结果分别提交两个原生任务，独立下载、解码并按原规划顺序汇总；每个结果仍受32 MiB边界约束。不支持超过2个结果、选段声明（clip/trim/sourceClip）、变速、重采样、改尺寸、额外文字/参考、彩色映射、原始NPZ、并排比较或未经支持的供应商字段。调用前先物化真正片段；未知字段不忽略。

本机须可执行 FFmpeg、FFprobe；既有工具支持服务端 `FFMPEG_PATH`、`FFPROBE_PATH`。缺工具在来源验证阶段返回 `media_tool_unavailable` 且 `providerDispatched=false`，不会发送模型任务。

## 配置与接线

```json
{"depth-anything-video":{"kind":"video.depth","model":"fal-ai/depth-anything-video"}}
```

协议 `fal-video-depth-native`，API origin固定 `https://queue.fal.run`（可空使用默认）。Key留在服务端。导出 `createVideoDepthProvider`, `parseVideoDepthModelMap`, `MODEL`, `ALIAS`, `PROTOCOL`, `MAX_VIDEO_BYTES`。provider实现 `prepare`（同步静态校验）、`submit`（完整来源解码后按结果数发1或2次POST）、`poll`、`cancel`、`generate`；共享路由、任务持久化和媒体归档由现有 generation 层接线。

请求兼容 `buildDepthRequest`：`nodeId` 为目标节点，`inputs[0].id` 为来源节点，两者分别合法而无需相等；输入若声明 `nodeId`，须与其 `id` 一致。`parameters.workflow=depth-video-studio`、`protocol=local-depth-v1`、`resolution=source`、width/height/duration与来源一致、preserveDuration=true、promptUsed=false。单一kind映射允许省略model；指定时必须为`depth-anything-video`，多种model字段须一致。

`request.count/parameters.count/times` 与已声明的 `canvasResults.targetNodeIds.length` 须一致，为1或2。允许 `variants/spread/pile`，仅用于host结果应用，不传供应商。`batch_count` 是逻辑 `requestPlans.length`，不是结果数；没有 canvasResults 的 variants 请求若声明 batch_count，只能为1，即使 times=2。已有规划须按顺序覆盖所有目标，每组 resultIndex 从0连续，runId/batch_id 相符。错误规划在POST前拒绝。

`metadata.capabilities.videoDepth["depth-anything-video"]`公开本地边界、`kind=video.depth`、`semantics=per-frame-depth`、`audioPolicy=discard`、`tapNowEquivalent=false`、requiresMediaTools；配置ready仅表示服务参数就绪，实际模型能力待验。正式gateway按任务私有目录的 `-video-depth` 兄弟目录接线，router按provider ID分目录。直接创建provider没有 `directory` 时保持单结果兼容，maxCount=1；提供绝对私有directory时maxCount=2。静态prepare不创建目录。

结果输出真实data MP4与实测width/height/duration；FPS/帧数保留在原任务身份中用于恢复校验，供既有materializer写成本机媒体。`sourceFileId`为fal queue request_id，不是画布来源文件ID；画布关联由host原请求/provenance负责。

## 恢复与故障

`vd1.`身份保存endpoint、别名、原request_id和实测宽高/时长/FPS/帧数；不含Key。任务层必须在POST回执后持久该ID，再轮询；`generate`会await异步`onTaskIdentity`。重启或Key轮换重建provider后仅GET原status/result，不重新POST。丢失POST回执、异常JSON、凭据回显、不完整媒体、尺寸/时长/帧数不匹配均unknown，不记成功；原ID仍可继续查询。

双结果由 `server/generation-video-depth-batch.cjs` 管理稳定的 `vd2.<UUID>` 父身份。0600原子JSON记录只含fingerprint、实测几何/时间、来源/目标身份和两个子任务阶段，不含Key、媒体URL或结果bytes。初始pending记录落盘后先await父onTaskIdentity；callback拒绝则零POST。每次POST前保存dispatching，原回执身份保存accepted后才允许第二次POST；POST1回执后的保存失败会阻止POST2。

poll与重启只GET已经持久accepted的子身份；pending、dispatching、缺失/损坏/几何不符的manifest均unknown，永远不会补发或复制已有结果。只有两个独立身份均成功且各自实际MP4符合源实测合同，才按child index返回两个输出。原请求上下文如提供，来源/目标/几何也须与manifest一致。并发操作按父身份串行；取消先记录意图以阻止未派发子任务，再保存cancelled，仅取消已接受ID，不把未确认请求冒称已停止。

认证队列URL固定自行构造，忽略供应商status/response/cancel链接。整个受限JSON先作凭据检查，再交shared queue投影；结果下载也检查真实bytes。取消复用fal SDK队列合同，只是best-effort，`CANCELLATION_REQUESTED`/`ALREADY_COMPLETED`/`NOT_FOUND`不冒称模型已停止。

专项：`node --test tests/generation-video-depth.test.cjs`，涵盖完整schema锁定、exact wire、零POST拒绝、真实解码、原ID重建恢复、一次POST、媒体本地归档、unknown、不可信URL/凭据/流超时及存储回调。仓库视频是合同夹具，不能证明深度内容或VDA-Large质量。

1005k fresh验证：`tests/generation-video-depth.test.cjs` 12/12，`tests/generation-video-depth-batch.test.cjs` 11/11。双结果专项包含两次真实原生合同POST、两份不同实际MP4完整解码与本地归档、独立sourceFileId顺序、Key轮换仅GET恢复、POST1/POST2回执丢失、manifest写失败、父callback拒绝零POST、并发取消、重复子身份、坏/缺失/符号链接manifest和原请求身份不一致。新旧provider与batch文件语法检查通过。此前fal队列10/10、共享媒体工具8/8记录保留；本次未运行全库回归，也没有真实供应商效果验收。

## 隔离完整 pipeline 验收

启动 `node src/features/video-depth/qa/native-server.cjs 0`，自动只监听127.0.0.1上的一个空闲端口，输出 `/src/features/video-depth/qa/main.html?mode=pipeline&session=depth-native-1005-pipeline`。使用正式createGenerationGateway、routed深度适配器、临时磁盘任务/媒体、正式静态脚本；仅供应商fetch/download边界由受信任内部DI替代，未开放浏览器选传输/文件/密钥的配置。其他API拒绝，生成配置只读；CSP connect-src仅本机/data/blob。

灰度夹具 `src/features/video-depth/qa/media/depth-contract.mp4` 仅一份，来自仓库 `src/features/video-generation/qa/media/2.mp4` 经本机FFmpeg `hue=s=0`、H.264/yuv420p、原帧时序编码。SHA256 `be713115baff7fe0add78ff3c61b3ae143762f9832970f44ef58c91ff64dd6dc`；64×48、2秒、20FPS、40帧、2586bytes。这是灰度合同视频，绝非模型推断的深度。

`GET /api/generation/fixture-audit`返回supplierPosts/statusGets/resultGets/resultDownloads、已查询原ID、已下载原ID、输入字节数/哈希与本机archiveEntries；不输出Key或整段data。`POST /api/generation/fixture-control`接受严格JSON `{"mode":"unknown"}`（下一任务status暂不可用）或`{"mode":"release"}`（原status可恢复）；GET原tasks/by-key即可恢复，不需要新POST。

一次HTTP smoke已fresh通过：config就绪且无fixtureKey回显，其他API/配置写拒绝，任务成功并写真实`/api/generation/media/...`，回读2586bytes与原夹具exact相同；supplierPosts/statusGets/resultGets/resultDownloads各1，archiveEntries=2。浏览器验收应以起始audit的增量计算，不把这一次smoke计入UI提交。终止SIGTERM/SIGINT会关闭gateway并清理仅该临时目录，不修改用户项目。
