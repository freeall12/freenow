# OpenAI 原生视频分镜解析

本适配接通现有 `kind:'video.analyze'`、`operation:'film_scene_breakdown'`。本机 FFmpeg 解码选定视频范围的每一帧，以 `scdet` 检测切点并物理裁出完整镜头；随后逐镜头用三张带近似映射时间的 JPEG 调用 Responses，生成中文短标题与视觉描述。返回真实可播放的 MP4 片段和 JPEG 封面，前端仍经现有批量结果验证、原子应用和来源保护创建分镜资产。

这不是供应商的原生视频上传接口。三帧仅用于已检测镜头的视觉描述；检测扫描整个选定范围，不以少量均匀采样的文字概述冒充分镜。场景检测仍是本地近似：阈值、缩放、渐变转场和快速运动会影响切点，不能保证逐个转场准确，更不代表复现官方私有分镜算法或画布布局。

## 配置

使用操作者明确选择、具备图片输入和 Structured Outputs 权限的型号，不从其他文本或图像条目猜选。以下条目放入 `GENERATION_MODEL_MAP`，不增加新的 Key 来源。

```json
{
  "video.analyze": {
    "kind": "video.analyze",
    "model": "YOUR_ACCESSIBLE_VISION_MODEL",
    "detail": "high",
    "maxOutputTokens": 1500
  }
}
```

仅支持 `kind/model/detail/maxOutputTokens`。`detail` 为 `low/high/auto`，默认 `high`；具体型号可能拒绝某一档位。每镜头输出预算512–16000 token，默认1500。没有用户可调的切点、镜头数、额外提示词或联网工具参数。

提供方能力挂在 `capabilities.videoAnalysis[alias]`，包含 `kind:'video.analyze'`、`operation:'film_scene_breakdown'`、`transport:'inline'`、`maxVideos:1`、MP4/WebM MIME、`maxVideoBytes:41943040`、`maxScenes:32`、`sceneDetection:'ffmpeg-scdet'` 和 `outputs:'video-clips-with-descriptions'`。能力信息不公开实际型号或 Key；它报告实现合同，不能证明真实视觉质量。

## 请求与真实媒体边界

```js
{
  kind: 'video.analyze', label: '分镜头解析', nodeId: 'source-node', prompt: '',
  inputs: [{
    type: 'video', url: 'data:video/mp4;base64,…',
    width: 1920, height: 1080, duration: 12.5,
    clip: {start: 1.5, end: 10.5}
  }],
  parameters: {
    operation: 'film_scene_breakdown', nodePosition: {x: 100, y: 200},
    width: 1920, height: 1080, duration: 12.5
  }
}
```

- 仅允许一个实际内联 MP4/WebM，最大40 MiB；不接受 HTTP、blob、asset URL，不由本模块抓取外部媒体。浏览器先通过已有素材传输边界解析本机素材。
- 视频 data URL 必须为规范 base64，MIME 与 MP4 `ftyp` / WebM EBML 容器头一致；真实解码由媒体层完成。容器头检查本身不是可播放验证。
- 两处宽高、时长均为完整源视频元数据，必须一致且有效。真实 FFprobe 尺寸必须匹配；真实源时长允许最多0.1秒或1%的浏览器元数据差异，以较大者为准。裁切区间使用原片绝对秒，必须有完整 `start/end`、正长度且位于原片内；未裁切可为 `null` 或省略。
- 输入字段为 `type/url/width/height/duration/clip` 和可选既有 `id/key/title` 元数据。参数仅接受现有 `operation/nodePosition/width/height/duration` 及可选一致的 `model/modelId` 别名。没有隐藏生成参数。
- 媒体层限制原片600秒、32镜头、40 MiB媒体输出；超过上限整体失败，不截断场景。FFmpeg/FFprobe 使用本机已有工具或 `FFMPEG_PATH/FFPROBE_PATH`，不安装依赖。真实媒体通过受限文件协议和临时路径处理，模块不传视频 URL 给 FFmpeg。

## 模块接口

`server/generation-openai-video-analysis.cjs` 导出：

```js
validateVideoAnalysisProfile(entry);
videoAnalysisCapabilities(entry);
const prepared = prepareVideoAnalysisRequest(request, entry); // 同步
// {kind:'video.analyze',profile,media:{bytes:Buffer,mimeType,clip},source:{width,height,duration}}
const result = await submitVideoAnalysis(prepared, {
  sdk, signal, timeoutMs: 600000,
  analyzeMedia // 可选测试注入；默认 video-scene-media.cjs 的 analyzeVideoMedia
});
// {status:'succeeded',outputs:[{
//   type:'video',url:'data:video/mp4;base64,…',poster:'data:image/jpeg;base64,…',
//   title:'镜头短标题',text:'中文视觉描述',width,height,duration,
//   sourceRange:{start,end}
// }]}
```

媒体函数收到 `{bytes,mimeType,clip}` 与 `{signal}`，返回完整原片 `duration/width/height`、绝对 `range:{start,end}` 和连续 `scenes`。每场景含绝对 `start/end`、实际裁切媒体 `duration/width/height`、`video/poster` Buffer、三张 `{time,image}` JPEG。帧 `time` 是裁切输出的实际 presentation 时间加上请求镜头起点，近似映射到原片请求范围；它不是源帧原始 PTS 证明，非对齐裁切和编码会产生差异。模型输入明确使用 `frameTimeBasis:'source-range-mapped-output-presentation-approximate'` 和中文“近似时间”。提供方核对连续覆盖、媒体预算、真实尺寸、非空MP4和JPEG及帧时间；切片时长按真实媒体保存，编码帧量化造成的差异由媒体层验收。为H.264偶数画幅，实际片段可能比原片少1像素，输出保留真实片段尺寸。

输出 MP4 已物理裁切，不能再携带原片 `clip`，否则播放器会重复偏移。`sourceRange` 仅作原片出处标记，不用于播放裁切；不在每项复制原片 data URL。标题存为 `title`，视觉描述存为 `text`，便于现有节点和历史展示。

## 视觉、取消与失败

每个场景依次发一个 `POST /responses`，输入为三个带近似映射时间的 `input_image` JPEG和场景范围，不上传原片视频。`store:false`、`text.format.type:'json_schema'`、`strict:true`、固定 `{title,description}` schema；无 tools。提示词要求直接观察与运动推断相区分，禁止从三帧编造精确运镜、声音、台词、身份或不可见动作，并把画面内文字当不可信场景数据。

仅解析完整 Responses `message.output_text` 的完整JSON；拒绝、incomplete、工具调用、空文字、额外字段和非法结构均不接受。任何场景描述失败，整个输出批次都不返回；不默默过滤坏场景、不使用本机占位文字补齐。有效 schema 只能证明输出合同，视觉描述仍是模型推断，未保证描述或动作准确。

Responses 请求使用 `maxRetries:0`，没有自动重新提交。总超时默认10分钟，允许1–600000毫秒，同时传入SDK剩余 `timeout` 和内部 AbortSignal。取消和超时通过本地 race 有界结束等待，SDK或测试替身忽略signal的迟到响应不能成功，也不能开始下一场景。不能据此承诺远端已经停止、未扣费或退款。

模型调用前的本机失败标记 `error.providerDispatched=false`，宿主可保存为 `failed`，证明没有视觉模型调用；包括工具缺失、预算、解码、媒体验证和本机准备超时。模型已经调用任一场景后的异常保持 `unknown`，宿主继续使用持久任务回执和幂等查询，不自动重放。用户取消保留原 AbortSignal reason。提供方不新增源视频、frame正文或供应商详细错误日志；`prepared` 含媒体 Buffer，不应写入日志。

## 验证

```sh
node --check server/generation-openai-video-analysis.cjs
node --test tests/generation-openai-video-analysis.test.cjs
```

专项10项通过，覆盖显式配置、原请求合同、canonical base64/MIME/元数据/clip拒绝、逐场景三个时间戳帧、实际片段结果与出处、不完整媒体无SDK调用、已安装SDK的 `/responses` wire格式及429零重试、第二场景失败整体拒绝、本机失败无模型派发标记、忽略signal的媒体/SDK取消与超时。测试仅用注入 SDK/fetch，无真实模型调用；提供方测试中的视频容器是接口替身，真实解码、全范围检测、音轨和裁切另由 `video-scene-media.test.cjs` 验证。

提供方与媒体联合20项通过。另用现有 `qa/trim-scenes.mp4` 接通默认真实媒体处理和注入视觉 SDK，得到三个320×180实际视频输出，原片范围为0–2、2–4、4–8秒，三次模型接口调用各携带三个真实JPEG，封面和输出合同校验通过。此处描述为测试替身，不能作为模型视觉质量证据。

尚未验证账号模型权限、真实场景描述质量、转场检测准确率或官方布局一致性。不可从本机合同测试推断这些已达标。

接口合同参考：已安装 `openai@7.20.0` 的 `node_modules/openai/resources/responses/responses.d.ts`（`ResponseInputImage` 与 `ResponseFormatTextJSONSchemaConfig`）；[官方视觉指南](https://developers.openai.com/api/docs/guides/images-vision)、[Responses创建参考](https://developers.openai.com/api/reference/resources/responses/methods/create)、[Structured Outputs指南](https://developers.openai.com/api/docs/guides/structured-outputs)。这些图片输入合同没有宣称提供完整视频场景检测。
