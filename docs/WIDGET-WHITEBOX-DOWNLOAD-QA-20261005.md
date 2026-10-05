# Widget 白模真实下载验收入口

此入口补齐真实 PNG / 原生 MediaRecorder → 正式 Widget 媒体接收器 → 宿主“下载素材”链路。只生成固定合成场景，不调用模型，不读取项目、会话、localStorage、IndexedDB 或用户素材。新增内容均为 QA 文件，生产代码未修改。

## 启动与隔离

已有本地服务可直接打开：

`http://127.0.0.1:4173/src/features/agent-widgets/qa/whitebox-download.html`

也可用现有 Python 启动纯静态服务，避免启动模型配置、应用运行时或用户数据存储：

```sh
python3 -m http.server 4197 --bind 127.0.0.1 --directory /Users/laplace/Documents/Codex/2026-09-22/new-chat/outputs/canvas-replica
```

然后打开 `http://127.0.0.1:4197/src/features/agent-widgets/qa/whitebox-download.html`。此页 CSP 禁止 connect-src；Widget 保留生产双层 sandbox 与其既有 CSP。

## 正式链路与验收范围

- `createWidgetCard` 使用默认资源准备、正式 proxy、`mediaBridgeSource`、`whiteboxCaptureSource` 和正式 receiver；不替换 nonce、source、trusted-event 或 Blob 验证。
- 截图由真实 `canvas.toBlob('image/png')` 产生；录像由真实 `canvas.captureStream(0)`、`requestFrame()` 和原生 `MediaRecorder` 产生。
- 宿主只通过正式接收器的“下载素材”按钮调用生产 `LocalMedia.download`。QA 回调记录原始字节数、MIME 和 SHA-256，不生成假 Blob、下载事件或成功回执。
- 本批只验下载。“添加到画布”明确报未配置，真实画布添加、媒体 finalize 与持久保存不在本页验收范围。
- 每次下载后的交接仍待处理，必须点宿主“拒绝”解除，或显式重建 Widget。下载不被记录成已添加/已保存。

## 实际按钮操作

1. 保持页面可见，等待 Widget 展示固定场景：320 × 180、深青背景、浅绿地面、固定蓝柱与橙色移动方块。
2. 点击 Widget 内“捕获 PNG”。正式宿主确认区出现后，点击其“下载素材”。保存文件 `widget-whitebox-qa-png.png`。
3. 记录页面下载请求的 SHA-256、MIME、字节数，以及浏览器实际下载事件、文件绝对路径。点宿主“拒绝”。
4. 点击“录制默认格式”，保持页面可见约 2 秒。默认生产候选顺序优先 MP4，再 WebM。保存正式按钮下载的 `widget-whitebox-qa-default.mp4` 或 `.webm`，记录实际 MIME 和后缀；点“拒绝”。
5. 如需覆盖两种容器，再分别点击“录制 WebM 能力环境”和“录制 MP4 能力环境”，每次下载后点“拒绝”。不可用格式按钮会禁用，须记录原生支持不足，不能改 MIME/后缀冒充成功。
6. 在宿主页显式选择刚下载的文件回读。要求 `matchesDownloadRequest: true`，实际尺寸 320 × 180；PNG 样本像素应为深青 `[32,50,58,255]`、地面 `[189,210,182,255]`、t=0.5 秒橙块 `[239,138,64,255]`、蓝柱 `[101,141,161,255]`。
7. 预览下载视频，验证橙块从左向右移动；另用真实文件检查编码、时长和多帧内容。录像请求为 2 秒、20 fps、40 次真实 requestFrame，文件编码时长/帧数须以解码工具为准。

生产 `record()` 没有 format/mime 参数。“能力环境”使用局部原生 `MediaRecorder` 子类，只限制 `isTypeSupported()` 候选 MIME 家族；不改变全局 API，构造、帧捕获和编码仍由原生实现完成。这是能力环境 fixture，不代表默认生产路径会优先 WebM。默认格式按钮完整保留生产选择逻辑。

## 落盘证据

`download_requested` 和 `diskSaveVerified:false` 仅表示下载函数已调用。页面回读校验实际文件字节，但浏览器 File API 不提供绝对路径，记录保留 `absolutePathAvailable:false`。

主任务可先在浏览器设置独立下载目录；记录实际 `Browser.downloadWillBegin` / `Browser.downloadProgress` 的 filename、guid、completed、filePath（如浏览器提供），再读取相应磁盘文件。若事件不提供路径，以配置的下载目录与实际存在的文件为准，不能仅拼接路径后宣称落盘。下载文件可能被浏览器重命名，使用实际事件与 SHA 对齐。

文件回读示例（路径须来自本次真实下载）：

```sh
shasum -a 256 /absolute/download/path/widget-whitebox-qa-png.png
sips -g pixelWidth -g pixelHeight /absolute/download/path/widget-whitebox-qa-png.png
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames -of json /absolute/download/path/widget-whitebox-qa-webm.webm
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames -of json /absolute/download/path/widget-whitebox-qa-mp4.mp4
```

保留至少三个不同时刻的解码帧或播放证据。PNG 的正确像素和视频的实际运动是内容证据；文件名、SHA、请求日志均不能单独证明视频非白帧。

## 当前状态

本入口初次新增时已做模块与生成内联脚本语法检查，以及既有正式媒体确认视图 4 项针对性回归。

主任务随后提供了实际 CUA 与磁盘文件检查结果：PNG、默认 MP4、WebM 均完成真实捕获 → 宿主“下载素材” → Downloads 文件存在 → file chooser 显式回读 SHA 匹配，尺寸均为 320 × 180。PNG 为 2500 字节，SHA 摘要 `3020d5d…8a3e`；默认 MP4 为 3724 字节，SHA 摘要 `58d074…40d21`，ffprobe 时长 1.9859 秒、H.264；WebM 为 4344 字节，SHA 摘要 `fac085…a0aa4`，ffprobe 时长 1.951485 秒、VP9。完整视频 SHA、原始文件大小、ffprobe 输出和实际解码结果见 [真实文件证据 JSON](research/widget-whitebox-download-20261005.json)。

两个视频均通过原生 controls 实际播放到 `ended`，`readyState=4`。主任务进一步对实际文件解码：两者均得到 40 帧、40 个不同的逐帧 SHA。第 0 / 20 / 39 帧橙块中心 x 坐标分别为 MP4 的 39.5 / 159.5 / 273.42、WebM 的 39.5 / 159.5 / 273.5，确认真实画面从左向右移动，而非白帧或同一帧重复。

录制请求为 2 秒、20 fps、40 个计划捕获帧；原始编码文件时长并非硬性 2 秒，实际为 MP4 1.985900 秒、WebM 1.951485 秒。下载链路保存原始真实字节，不通过改 MIME、补时长或后处理伪装录制结果；加入画布时的本地 finalize 与时长归一化仍不在本页验收范围。

实际回读截图保存在 `docs/screenshots/widget-whitebox-download-20261005.jpg`。主任务另一次 HTML 导出下载的自动事件等待曾在 20 秒超时，但 Downloads 中实际文件存在；该事件超时不能被报告为文件未落盘。Widget 文件落盘证据来自实际文件与显式回读，不来自 `download_requested` 标记。

本轮仅改善 QA 展示：完整请求/回读 JSON 默认折叠，上方保留文件名、字节、MIME、SHA 匹配和实际尺寸/时长摘要，每个实际文件预览有文件名 caption。既有页面状态和截图保持有效；新布局在下一次打开页面生效，无需为本批证据重录。本轮按任务要求未重跑测试，未修改生产链路，也未引入证据导入/导出协议。
