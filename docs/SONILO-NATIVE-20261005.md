# Sonilo 原生视频音乐与分段音乐

2026-10-05 公开文档核验后新增独立 `sonilo-native` 音乐适配器。**本地 MP4 字节直接通过 Sonilo 官方 multipart 文件字段上传，音乐和时间边界由原生 Video-to-Music 接口处理。** 无视频的分段音乐使用另一个原生 Text-to-Music 接口，不把它标为视频音乐。没有读取真实 Key、原站账号、环境文件或上传私人素材；测试仅用仓库视频和合成 PCM WAV。

本文件更新了 [前批视频拟音调查](VIDEO-AUDIO-NATIVE-20261005.md) 的发现范围：前批读取的 TapNow 使用文档和安装包没有公开独立 Sonilo 合同，但本次进一步读取的 **Sonilo 官方开发者平台已经提供合同**。ThinkSound 仍是明确替代的拟音接口，不代表 Sonilo 音乐。本批仅完成 Music 适配器；Sonilo SFX、语音保留、ducking 和分轨仍不在本模块范围。

## 官方合同与可复核来源

- [Sonilo 官方网站](https://sonilo.com/)直接链接独立开发者平台和 fal Sonilo 模型。
- [完整 OpenAPI](https://platform.sonilo.com/openapi.json)：固定服务 `https://api.sonilo.com`、Bearer 鉴权、multipart、异步任务、1–10 变体以及 WAV。
- [Video-to-Music](https://platform.sonilo.com/docs/api/video-to-music)：真实视频文件上传、视频上限 6 分钟、音乐分段规则。
- [Text-to-Music](https://platform.sonilo.com/docs/api/text-to-music)：文字音乐和分段，不含视频参考。
- [原任务查询](https://platform.sonilo.com/docs/api/get-task)：原 task ID、`processing/succeeded/failed`、临时结果 URL 和 `audio` 各输出。
- [主站精简 OpenAPI](https://sonilo.com/openapi.json)：可以发现官方入口，但部分字段落后于完整平台合同。
- [fal Sonilo v1.1](https://fal.ai/models/sonilo/v1.1/video-to-music/llms.txt)：也是真实视频音乐，但该公开合同没有 `segments`，输入仅公网视频 URL。本批选择独立 Sonilo 文件上传合同，以满足本地视频和分段需求。

上述来源均为无鉴权的公开 GET。去敏后的精确合同片段、端点正文和原响应 SHA-256 保存在 [research/sonilo-native-20261005](research/sonilo-native-20261005/sources.json)。没有存入 Cookie、Key 或用户视频。

**文档差异不能混用。** 主站精简 schema 的 `Segment` 写成 `start/end`，适合 SFX；平台音乐端点正文明确使用 `start/prompt/label?`。完整平台 OpenAPI 的 `segments` 只写成表单字符串，必须结合端点正文确定音乐时间边界。完整平台比主站精简 schema 多出 `mp3`、`variants_num` 等字段；本模块固定使用已共同核实的 async WAV，不推测 streaming、其他格式和不支持的附加功能。

| 项目 | 原生合同与本地行为 |
| --- | --- |
| 运行 origin | 仅 `https://api.sonilo.com`；不能配置到原站、代理或测试 loopback。fixture 通过服务端 `fetchImpl` 接缝转发 |
| 鉴权 | 服务端请求头 `Authorization: Bearer <独立 Sonilo Key>`；凭据不进入表单、任务 ID、配置元数据、CDN 请求或浏览器 |
| 视频提交 | `POST /v1/video-to-music`，multipart `video` 文件；恰一真实 MP4，`mode=async`、`output_format=wav`、`variants_num` |
| 文字提交 | `POST /v1/text-to-music`，multipart `prompt/duration`；无视频字段，不声称视频理解 |
| 接受任务 | HTTP 202，`{task_id,status:"processing"}`；不把默认 HTTP 200 NDJSON 当成完整结果 |
| 查询 | `GET /v1/tasks/{原 task_id}`；只接受原身份和官方的三个状态 |
| 成功结果 | `audio:[{stream_index,url,content_type,file_size,sample_rate?,channels?,title?}]`；请求多少结果就必须返回多少，不静默选第一首；可选采样率 / 声道与真实 WAV 核对，标题对象 `{title:string}` 经校验后保留 |
| 多结果 | 显式计数 1–10 → `variants_num`，**每个变体单独计费，多个变体线性增加费用**；本批没有发起真实收费请求 |
| 输出格式 | 固定 WAV；官方为 16-bit PCM。字节完整读取并验证 PCM16、样本时长与原视频 / 指定文字时长相差不超过 0.1 秒 |
| 远程取消 | 公开 spec 没有取消端点；`remoteCancellation:false`，模块不导出虚构 cancel |
| 供应商幂等 | 公开 spec 没有幂等 Key / 去重保证；`providerIdempotency:false`。POST 回执丢失是 unknown，不自动重 POST |

## 配置与适配器接口

```json
{
  "protocol": "sonilo-native",
  "baseUrl": "https://api.sonilo.com",
  "modelMap": {
    "sonilo-music": {"kind":"audio.generate","model":"sonilo-music"}
  }
}
```

上述示例没有可用 Key；需要操作者独立的 Sonilo API Key 与账号权限。没有仿造 TapNow 供应商服务或读取原站凭据。`sonilo-music` 是现有画布选择器的原生音乐绑定；Sonilo REST 请求没有 `model_id` 字段，因此不向上游编造型号字段。

```js
const {createSoniloProvider}=require('./server/generation-sonilo.cjs');
const provider=createSoniloProvider({
  baseUrl:'https://api.sonilo.com', apiKey, modelMap,
  fetchImpl:fetch,
  download:createGenerationMediaDownloader().download,
  timeoutMs:30000, mediaTimeoutMs:120000,
  ffmpegPath:'ffmpeg', ffprobePath:'ffprobe'
});
```

导出 `createSoniloProvider`、`parseSoniloModelMap`、`validateSoniloSegments`、`DEFAULT_SONILO_MODEL_MAP` 和预算常量。返回 `prepare/submit/poll/generate`、公开 `metadata`、不含 Key 的 `fingerprint`。`prepare` 是同步参数/容器校验；`submit` 在 POST **之前** 完成本地 FFprobe 和 FFmpeg 实际解码。`generate` 会 **await `onTaskIdentity`**，确认调用者完成身份保存后才开始轮询。

`fetchImpl/download/ffmpegPath/ffprobePath` 仅为受信任服务端依赖，浏览器请求不能提供它们，也不能给媒体下载传 Authorization / Cookie / headers。当前模块不读取 `.env` 或 `process.env`；由共享服务注册处注入已配置工具路径。

## 前端合同

最小文字请求：

```json
{
  "kind":"audio.generate",
  "prompt":"轻柔弦乐与渐进鼓点",
  "inputs":[],
  "parameters":{
    "model":"sonilo-music","virtualModel":"sonilo-music","scene":"Music",
    "duration":10,"count":2,
    "segments":[
      {"start":0,"label":"intro","prompt":"轻柔弦乐"},
      {"start":5,"label":"chorus","prompt":"加入渐进鼓点"}
    ]
  }
}
```

最小视频请求（`...` 仅表示示例，实际须完整 MP4 字节）：

```json
{
  "kind":"audio.generate",
  "prompt":"",
  "inputs":[{"id":"source","type":"video","url":"data:video/mp4;base64,...","duration":8}],
  "parameters":{
    "model":"sonilo-music","virtualModel":"sonilo-music","scene":"Music",
    "duration":8,"count":1,
    "segments":[{"start":0,"label":"intro","prompt":"柔和弦乐"}],
    "providerParameters":{"model":"sonilo-music","prompt_influence":0.7}
  }
}
```

模型设置里的 `model` 是一致性检查，不会作为不存在的供应商表单字段提交。`prompt_influence` 为 0–1，仅适用于视频。视频有真实参考时允许空总提示词，以便上游基于视频推导方向；文字音乐要求非空描述。保留 TapNow 入口 1000 字符上限，供应商正文上限 2000；不截断提示词。

`request.count`、`parameters.count`、`parameters.times` 是等价计数，出现多个时必须一致，且都是整数 1–10；缺省为 1。文字时长必须为 5–360 **整数秒**。视频时长 5–360 秒，`parameters.duration` 必须等于 `inputs[0].duration`，实际视频轨时长误差不超过 0.01 秒；视频时长不是自定义控制字段，不向 Video-to-Music 发送 `duration`。视频的 5 秒下限来自画布入口约束；供应商正文仅公开最大 6 分钟。

音乐 `parameters.segments`：

- 1–30 项，仅允许 `start/prompt/label`；不接受 SFX `end`，不排序、量化、平移或补造边界。
- 第一项 `start===0`；后续严格增加且间隔至少 5 秒；末项不超过实际总时长减 5 秒。
- 每段 `prompt` 非空、最多 200 字符；`label` 可省略，或者为 `intro/verse/pre-chorus/chorus/bridge/break/silence/outro/none`。
- 以 `JSON.stringify(segments)` 原样进入 multipart 字符串字段；不会把多个片段拆成多个收费 POST、分开生成后拼接。

公开 `metadata.capabilities.music['sonilo-music']` 与 `videoAudio['sonilo-music']` 提供同一 profile：`scene:Music`、`semantics:native`、`durationMode:source-video-or-explicit`、`duration:{min:5,max:360,automatic:false}`、`localVideoDuration:{min:5,max:360}`、`maxCount:10`、`count:{min:1,max:10,billing:per-variant}`、`segments:true`、`segmentContract`、`textOnly:true`、`formats:[wav]`。元数据另声明 `videoReferences.transport:multipart-file`、`remoteRecovery:true`、`remoteCancellation:false`。

成功后音频节点当前默认应用第一项结果。其他变体的真实入口为画布左侧 **历史 → 音频**；每个 output 索引均保留独立的结果项，可预览、播放并应用到目标节点。节点内部当前没有音乐变体切换器，不能把后端多输出能力描述为节点内切换交互。[正式 UI 与隔离 QA](SONILO-NATIVE-UI-QA-20261005.md)

拒绝音效场景、歌词、额外文字 / 图片 / 音频引用、超过一个视频、未导出的 `clip/trim/sourceClip`、输入自身的 `segments`、未知 provider 设置、preserve_speech、ducking、stems 和不支持的格式。不会忽略设置后计费。

## 字节、恢复与失败边界

本地来源 MP4 最大 50,000,000 bytes，真实视频上限 360 秒 / 16,777,216 pixels / 21,600 声明帧、最多一条视频和一条音轨。这些是本地资源预算；供应商默认上传 300 MB 不代表本机网关允许 300 MB。本地使用临时私有目录 / 文件，并在结束或失败后清理。

内联来源验证 base64 canonical bytes、完整 MP4 外层容器、真实视频轨与时长，再用现有本机 FFmpeg 全解码，不裁切、补帧或改速。公网 HTTPS 来源先通过默认安全下载器固定公共 DNS / 实际连接对端、拒绝重定向、限时限字节，下载后做同样解码；发送的也是已验证 **文件原字节**，不把未经读取的 URL 交给上游。缺媒体工具、伪容器、音频假视频、来源尺寸或声明时长不符都零 POST。

此来源验收采用 FFprobe 视频轨时长与 FFmpeg 完整解码，并未逐帧比对 PTS / DTS 或建立每个分段的模型音符时间轴；它证明有效视频原字节与用户边界被保留在请求中，不证明供应商生成音乐在每个视觉事件处精确同步。后一项需要真实模型结果与视频共同试听 / 对齐验收。

接受后保存 `sn1` 标识，包含配置 fingerprint、音乐类型、原始 task ID、来源 / 指定时长、变体数量及来源哈希。Key 轮换不改变 fingerprint；重启使用相同原任务 GET，不复用 provider 回执中任意状态 URL。查询中身份不符、未知状态、非空 processing 音频、结果污染和 CDN失败均不重 POST。

异步来源准备失败统一为经过清理的 `sonilo_preparation_failed`，带 `providerDispatched:false`。共享 durable 仅在可信本地 `sonilo-native` 音乐适配、尚无已保存 provider task ID 且代码精确匹配时，将其持久化为“失败，尚未上传或提交”；重启和同一幂等键仍保持该失败。普通远程 gateway 的同名字段、其他未知代码、已保存 task ID 或 POST 后未知失败不能获得这个零提交声明。

批次成功要求实际数量完全一致，`stream_index` 为恰好 0…count-1 且无重复，URL 无重复；按索引排序后逐个读取 WAV。每文件最多 50 MiB，整批最多 128 MiB；这是公开元数据里的显式本地预算。供应商文件描述的 bytes 必须等于实际 bytes；所有结果通过才返回，不返回半批。输出为完整内联 `data:audio/wav`，共享 materializer 直接归档为本地 `/api/generation/media/`，无需再次读 CDN。

402 等明确拒绝返回失败并提示配置/权限/额度，绝不改调用其他模型。丢失 POST 回执、未知/错误任务查询、响应截断、超时、污染或本地保存失败保持原任务待核实。网络读取预算与轮询预算分开，默认 3 秒查询、不编造进度百分比。模块没有远程取消合同；本地取消不能声称远程停止计费。

## 验证

```sh
node --test tests/generation-sonilo.test.cjs
node --check server/generation-sonilo.cjs
```

定向检查包含官方模型/metadata、计数冲突、真实 loopback HTTP multipart（原视频 bytes、分段字符串和 Key 只在 API 请求头）、独立文字端点、变体不拆 POST、乱序结果归位与完整数量、伪视频/虚假时长/缺工具零提交、安全公网预下载、无认证 CDN、Key 轮换/原任务恢复、await 身份保存、未知状态不重提交、真实 PCM WAV 时长和共享本地媒体归档。

最终模块定向检查 **15/15 通过**，两份服务端文件语法检查通过。新增回归覆盖官方合法的 `sample_rate/channels/title` 回执及真实样本核对、截断/污染/悬挂下载、本地 FFprobe 真实解码失败在 durable 重启后保持 failed/POST0、任意远程旗标与已接受任务不能冒称零提交。前批 mask preparation 的相关套件单独复核，无需重跑无关旧全套。

音频 fixture 是合成 PCM 数据，HTTP 回执是隔离 fixture：**不证明 Sonilo 音质、音乐与视觉匹配程度、真实账号权限、费用或长视频能力。** 本模块的共享服务注册、前端分段/计数、Agent及正式浏览器验收由相应接线任务独立完成；本文件不把适配器定向测试等同于全 Sonilo 完成。
