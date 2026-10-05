# SAM2 本机视频分支准备 · 2026-10-05 / 1005n

实现 `server/video-segmentation-media.cjs`，把提示对应的真实原帧物化为前向、倒序 MP4。返回前重新 probe 并逐帧解码比较 RGB 像素；没有来源 URL 替换、寻址跳帧、有损凑首帧或复制遮罩。

## 服务端合同

```js
const {createVideoSegmentationMediaTools}=require('./server/video-segmentation-media.cjs');
const media=createVideoSegmentationMediaTools();
const prepared=await media.prepareSegmentationMedia({
  source:{bytes:sourceBuffer,mime:'video/mp4'},
  request:{width:64,height:48,duration:0.5,time:0.21,
    pointPrompts:[{x:32,y:24,time:0.21,label:1}]}
},{signal});
```

`source` 接受实际 MP4、MOV、WebM 字节。`request` 可携带既有 `kind/nodeId/sourceVideoUrl/selection` 字段；本模块不会读取 URL。来源下载、节点/URL 身份和持久归档由 native adapter 负责。若带 `selection`，会复核与现有 core 相同的 `Math.round` 中心像素。默认工具名为 `ffmpeg/ffprobe`，可由服务端代码注入路径；模块不读取实际环境或 Key。

返回：

- `source:{sha256,width,height,fps,fpsNumerator,fpsDenominator,numFrames,duration,pts,timeTolerance,hasAudio,audio?}`：实际来源字节 SHA 与 FFprobe 时间、几何信息。
- `prompt:{frameIndex,time,pts,x,y}`：最近原 PTS 的帧 k，同时保存请求秒数与实测原 PTS；距离相同时取前一帧。点击 `duration` 取最后实际帧。
- `branches:[{direction,mime,bytes,sha256,numFrames,sourceIndices,firstFrameSha256}]`：真实片段字节、连续数量和来源索引。首帧 SHA 是原提示帧的解码 RGB24 像素 SHA，不是压缩文件 SHA。

N=5、k=2 时为 `[2,3,4]` 与 `[2,1,0]`，两路第0帧逐像素相同。k=0 只前向，k=N−1 只倒序，N=1 只前向。中间帧两路合计 N+1 个帧；合并去重由 PNG/RLE 模块负责。

## 实际物化与拒绝条件

复用 `generation-video-mask-media.cjs` 末尾追加的 `mediaInternals` 命名导出，只供 server 内部使用。没有改变原编辑媒体函数和公开返回合同。

来源严格沿用已证 CFR 范围：单视频、最多单音轨、偶数尺寸、方形像素、5–30 FPS，实测名义/平均帧率相同，PTS 从0开始且每帧持续时间一致。拒绝 VFR、非零原点、未物化旋转、损坏容器、缺帧或无法完整解码的来源。声明尺寸必须完全相同，声明时长误差上限为实测时间容差与1ms中的较大者；这个1ms只用于浏览器来源声明，实际帧/PTS 验证仍使用原严格时间容差。

先将 canonical RGB24 直接解码写入私有磁盘文件，按位置每次读取一个原帧，通过有背压的 stdin 送入 rawvideo 编码器。来源帧 SHA 逐帧读取计算；整个视频不会进入一个 RGB Buffer。`libx264rgb -crf 0` 生成无损 RGB H.264 MP4，保留来源有理数 FPS 并重建片段从0开始的时间。没有缩放、旋转、fps filter、补帧或变速。重新 probe 所有分支的尺寸、帧数、FPS、时长、PTS，再流式解码 RGB24，以每帧 SHA256 与对应原索引的来源帧 SHA256 完全相等作为无损验证，包括两路首帧。小尺寸验收额外完整回读真实分支，对每帧做 Buffer 逐像素比较。

准备片段明确无音轨，分割不需要声音；来源字节本身没有被改写，返回保留来源音轨信息。本模块不负责成片音轨替换/保存。不声明原编码码流、HDR/高位深或色彩元数据逐字节保留；无损断言指相同本机解码流程产生的 RGB24 像素。模型部署内部 JPEG 提取、线上 decoder 对 RGB H.264 的兼容和模型质量仍须真实供应商验收。

## 预算、取消和清理

| 默认上限 | 含义 |
| --- | --- |
| 来源32 MiB | 实际输入压缩字节 |
| 所有分支90 MiB | 两路合计压缩输出，不按单路放宽 |
| 来源与分支128 MiB | 同时保留的压缩字节 |
| 单帧16,777,216像素 | 继承几何预算 |
| 来源与分支1536 Mi个像素 | `(N+sum(branchFrames))*W*H`，限制总处理工作量 |
| 原始磁盘2 GiB | `N*W*H*3`，仅物化一份来源 RGB；分支逐帧读取与流式核验 |
| 来源2400帧 / 120秒 / 并发2 | 模块内进程范围的任务槽及每次处理时间预算 |

几何、帧数、原始磁盘与总像素工作量预算在 RGB 解码前判断。完整原始视频只存在于临时磁盘；内存持有少量原帧 Buffer、FFmpeg codec 状态、最多2400个帧 SHA 与受限压缩字节，不随 N 保留完整原始视频。2 GiB 可覆盖1080p、30 FPS、10秒来源的 RGB 磁盘大小，但来源32 MiB、两路90 MiB、时间及工作量限制仍可能拒绝高复杂度内容；不保证任意10秒视频通过。可注入更小预算，不能超出默认硬上限。FFmpeg 以实测 N 与预计 raw 字节数限制输出，真实文件大小必须完全等于预算内的 `N*W*H*3`。

工具调用只有生成的私有路径与校验数值，没有外部 URL 或调用者参数拼接。每个 job 独立创建0700临时目录，输入0600；成功、异常、超时和取消都仅删除自己创建的目录。取消先 SIGTERM，未退出则500ms后 SIGKILL，等待子进程 close 后再清理。并发槽在清理后释放。异常没有返回部分分支，错误附 `providerDispatched:false`。

`segmentation_media_invalid/budget/busy/timeout` 表示媒体、总预算、并发和超时拒绝。最前面的已有容器 envelope 拒绝保留 `invalid_video_mask_media`，缺本机工具保留 `media_tool_unavailable`。调用者主动取消保留原 signal reason。

## 本机验收

```bash
node --test tests/video-segmentation-media.test.cjs
node --check server/video-segmentation-media.cjs
node --check server/generation-video-mask-media.cjs
node --check tests/video-segmentation-media.test.cjs
git diff --check -- server/video-segmentation-media.cjs server/generation-video-mask-media.cjs tests/video-segmentation-media.test.cjs docs/VIDEO-SEGMENTATION-MEDIA-20261005.md
```

测试使用本机 FFmpeg/FFprobe 8.1.2 与临时合成 testsrc2/sine 视频，覆盖：首/中间/片尾实际物化、所有帧像素映射、提示帧 SHA、真实720p/1080p各5秒（10 FPS、50帧、k=25、前25帧/倒26帧）、N=1、30000/1001 CFR、来源声明错误、中心提示错误、VFR、非零PTS、真实旋转、总预算、超时、运行中取消杀进程、独立临时目录清理与并发释放。没有私人素材、外部连接、上传或供应商推理。媒体管线专项 **7/7通过，零跳过**，约15.7秒；最后补齐 undefined/null/缺字段输入拒绝，相关定向 **1/1通过**，管线未改。上述语法与差异空白检查通过。没有新增依赖、commit/push或全套测试。

本地片段验证证明物化与映射正确；未调用 Replicate，不证明部署兼容、PNG 像素极性、模型跟踪效果或双路提示帧 mask 一致率。

独立只读交审另验真实720p、5秒、30 FPS（150帧，k=75）：前向75帧、倒序76帧，处理约5.05秒；压缩分支为11,545,605与11,625,194字节。独立FFmpeg读取原n75，RGB SHA256与两路首帧均为 `3e328c398f3a4540e30def1830d0fad503ef514253730155a91f1bcdd6d6eab6`。编码器stdin背压阶段取消后，子进程已退出、所属临时目录不存在，并发槽可重用。未重复执行负责人已通过的全套。
