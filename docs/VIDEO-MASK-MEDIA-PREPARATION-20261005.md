# 视频 mask 的真实媒体准备（2026-10-05）

实现：`server/generation-video-mask-media.cjs`。测试：`tests/generation-video-mask-media.test.cjs`。本模块只处理已经取得的真实字节，不下载、上传或调用模型。供应商合同、结果质量门槛与私有 staging 由 `generation-video-mask.cjs` 负责。

## API 与恢复

```js
const { createVideoMaskMediaTools, LIMITS } = require('./generation-video-mask-media.cjs');
const media = createVideoMaskMediaTools({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' });
const actual = await media.inspectVideo({ bytes, mime }, { signal });
const prepared = await media.prepareMedia({
  source: { bytes, mime },
  mask: { encoding: 'rle-zero-based-row-major', width, height, fps, frames },
  sourceClip: { start, end }, // 可省略或为 null；[start,end)
}, { signal });
const checked = await media.validateResult({ bytes: resultBytes, mime: 'video/mp4' }, prepared, { signal });
const final = await media.preserveAudio(checked, prepared, { signal });
```

`prepared` 包含 `video`、`mask`（`bytes`、`video/mp4`、实际 metadata）、可空 `audio`、`metadata` 和 `sourceRange`。恢复阶段只需要保存的 `metadata`、`audio`；验证与原音恢复不重新准备或上传来源/mask。来源对象只允许 `bytes/mime`，结果对象可以含 `metadata`，但总是重新读取真实字节，不信任调用者 metadata。未知字段拒绝。

## 来源、mask 和选段

- 先验证 MP4/MOV 完整顶层容器索引或 WebM 魔数，再执行 FFprobe 和完整 FFmpeg 解码；格式签名不代表验收通过。
- 仅一条视频、最多一条音轨；偶数宽高、方形像素、无未物化旋转、5–30 FPS。全部帧的真实 PTS 必须从 0 开始并对应 `i/fps`，每帧持续时间及视频 stream 时长必须一致。VFR、非零起点、坏帧与截断明确拒绝。
- 全来源最多 2400 帧；RLE 必须覆盖全来源、同宽高同 FPS 同帧数，使用从 0 开始的行优先 `start length` 整数游程。空帧是空字符串，目标白色、背景黑色；不接受 COCO RLE、重叠/越界游程或无目标选段。
- `sourceClip` 必须在真实视频范围内并对齐帧边界（1µs 容差）。共同使用同一组 frame indices 裁切来源和 mask，PTS 归零。选段仅接受 81–241 帧；不补帧、截断、改速或偷偷移动选区。
- 来源视频用 H.264 CRF0、yuv420p 编码，保持尺寸与时序；这是编码选定像素格式的无损模式，不是对任意来源色彩格式的逐 RGB 像素保证。测试对 yuv420p 来源验证全部解码 RGB 像素一致。
- mask 全部逐帧编码后，重新流式解码并比较每一个灰度字节，包括空帧，确认白黑语义、移动目标和帧数完全一致；不缓存完整 raw mask。

## 结果与原音

结果须声明并确认为 MP4：MOV/QuickTime 品牌、WebM 与 MIME 不一致均拒绝。重新验证全部帧、PTS、FPS、时长、SAR 和显示比例。支持供应商按同一比例改变像素尺寸（2px 取整容差），不要求任意来源尺寸与原生 720p 输出逐像素尺寸一致。供应商层另有面积至少 `720*720` 的保守本地质量门槛；该门槛不是公开 fal `720p` 枚举的精确几何保证。

原音不能以供应商输出音轨替代：

1. 有声来源要求单声道/双声道、8–96kHz、起点 0、完整覆盖选段。视频边界也须对齐音频样本；不补静音或改变声音速度。
2. 原选段解码保存为 PCM32 WAV，记录 sample rate、channels、sample count、duration 和全部 PCM 的 SHA-256。保存音轨重新测量，防止改 WAV header 后变速。
3. 来源为 AAC 时尝试原包复制，仅在真实时长、采样率和每一个解码 PCM 样本与原选段一致时采用 `audio/mp4` / `copy-aac`。全来源复制保留 AAC priming；截取导致包边界/样本不一致则回退。
4. 回退保存 `audio/wav` / `decoded-pcm32-lossless`，最终用 FLAC32-in-MP4 无损恢复。输出再次完整解码，逐样本比较；本机 FFmpeg 不支持或比较失败则拒绝，不偷偷二次有损 AAC 编码。
5. 无声来源强制去掉供应商音轨。`validateResult` 只检查媒体合同；交付必须走 `preserveAudio`。

输出 `audioPolicy` 为 `copy-source-aac`、`preserve-source-decoded-pcm32-lossless` 或 `silent-source`。AAC 的浏览器兼容性一般较好，FLAC-in-MP4 仍须按实际目标浏览器检查；媒体单元测试不证明浏览器播放。保留 PCM 是相对原来源解码样本精确，不声称恢复有损 AAC 编码前声音。

## 预算、权限与失败

| 预算 | 上限 |
| --- | ---: |
| 来源字节 | 32 MiB |
| 单个供应商结果 / 最终结果 | 100 MiB |
| 单个准备文件（上传前） | 90 MiB |
| 每帧像素数 | 16,777,216 |
| 所选完整 raw mask | 256 MiB |
| RLE 文本 | 32 MiB |
| 全来源帧数 | 2400 |
| 单次操作 | 120 秒 |
| 进程内并发操作 | 2 |

配置只能下调预算。90 MiB 是本地准备上限，与当前单次上传器预算一致，不是远端供应商硬上限；上传前还须由 provider 检查每份 bytes。FFmpeg/FFprobe 路径是可信服务器配置。子进程仅读取私有临时路径与验证数字，协议限 `file,pipe`、格式白名单；不能把输入 URL 或任意参数传入子进程。临时目录由本模块创建并在成功/失败/取消后清理。

每次操作有 AbortSignal、时间、字节与解码日志预算。取消先 SIGTERM、500ms 后 SIGKILL；不返回部分文件。文件 I/O 提前抛出 AbortError 时也保留统一的取消/超时 reason，成功返回前再次检查信号。错误含可审计 `code` 与 `providerDispatched:false`，不暴露工具私有路径或原始日志。常见错误：`invalid_video_mask_media`、`video_mask_media_budget`、`video_mask_media_busy`、`video_mask_media_timeout`、`media_tool_unavailable`。调用者负责记录阶段、错误码与操作身份，不记录媒体字节或原始命令。

## 新鲜验证

```bash
node --check server/generation-video-mask-media.cjs
node --test tests/generation-video-mask-media.test.cjs
```

2026-10-05：8/8 通过，无 skipped（约 18.3 秒，FFmpeg 8.1.2）。覆盖全帧像素/PTS、移动与空 RLE、非零裁片、原音逐样本保留、全来源 AAC 包复制、无声源剥离新增音轨、同比分辨率、错误比例与低分辨率来源放大后的拉伸反例、删帧/FPS/SAR/截断、MOV 误标 MP4、坏 RLE、非帧边界、非零 PTS/VFR、预算/缺工具/超时/取消。

浏览器检查用本地合成素材，不是模型结果：`/tmp/video-mask-media-qa-1005/aac-source.mp4`（960×720、16 FPS、128 帧、8 秒、440Hz AAC），`aac-copy-output.mp4`（AAC 原包复制）和 `flac-trim-output.mp4`（81 帧、5.0625 秒、FLAC32 原音恢复）。本模块没有浏览器或付费供应商调用证据；浏览器播放结论由主任务独立记录。

后续主线程已实际播放上述AAC复制与FLAC32裁片至ended，muted=false且无媒体error；还完成正式pipeline结果播放与刷新。详见[本批实机记录](LOCAL-VIDEO-MASK-AGENT-20261005.md)。这是当前浏览器的播放兼容证据，没有工具音频听辨，也不代表所有浏览器均支持FLAC-in-MP4。临时样本未提交，通用QA服务没有开发机`/tmp`硬编码依赖。

独立只读审查使用另一份 96×64、10 FPS、10 秒的移动白条合成来源，验证 `[.4,8.5)` 对应原帧 4–84，来源 RGB、全部 mask 灰度字节、81 帧 PTS 与 8.1 秒时长一致；非对齐 `.41`、起点偏移 5 秒、VFR、删除中间帧均拒绝。审查发现原 aspect 容差按输出尺寸计算会放大误差，已修为以来源尺寸为单位，真实 1080×700 拉伸结果（应 1080×720）在冻结版本重新验证为拒绝。另用 44.1kHz 有声来源独立比较原样本 `[17640,374850)` 共 357210 个样本：准备音轨与最终音轨均逐字节一致，供应商 12 秒/880Hz 音轨被原 8.1 秒/440Hz 选段替换，视频、音轨与容器均实测起点 0、时长 8.1 秒。审查生产 SHA-256：`e7a6f7defad651731df1e3b5b136d6e9f9b97310764f6a9448dcecfc0a260af5`；未见剩余阻断。
