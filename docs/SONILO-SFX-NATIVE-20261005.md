# Sonilo 原生文字与视频音效

2026-10-05 核验独立 Sonilo 公开合同后，在 `server/generation-sonilo.cjs` 中新增显式 `sonilo-sfx` 绑定。它使用官方 Text-to-SFX / Video-to-SFX 端点，输出一份音效音频；不把 Music 或 ThinkSound 替代结果标为 Sonilo SFX。本批不实现 stems、ducking、speech、成片混流或其他生成服务。

本批只核验公开 GET、隔离 fixture HTTP、仓库视频与合成 PCM WAV。没有读取真实 Key、环境文件、原站账号或用户素材，没有向供应商发起付费 POST、上传或实际生成。真实账号权限、收费、音质和视觉同步效果仍未验证。

## 官方证据和差异

- [完整平台 OpenAPI](https://platform.sonilo.com/openapi.json)：固定运行 origin `https://api.sonilo.com`、Bearer、两个 SFX POST、multipart、异步 202、`duration` 为 number（0.5–180）。SFX 没有 `variants_num`、`mode`、`output_format` 或 `model_id` 字段。
- [Video-to-SFX 完整正文](https://platform.sonilo.com/docs/api/video-to-sfx)：恰一 `video/video_url`；最大 480 秒；`audio_format` 支持 `wav/mp3/aac/flac`；精确的 1–30 个 `start/end/prompt` 连续区间。普通 curl 可能返回精简代理阅读正文，完整正文以公开 Mozilla User-Agent GET 读取，没有使用账号或 Cookie。
- [Text-to-SFX 完整正文](https://platform.sonilo.com/docs/api/text-to-sfx)：文字提示必填，1–2000 字符；时长 0.5–180 秒、缺省 8 秒；没有公开 `segments`。本地要求显式时长以保存可恢复身份。
- [任务查询完整正文](https://platform.sonilo.com/docs/api/get-task)：SFX 的 `audio` 是一个 `{url,content_type,file_size}` 对象，Music 是数组。完整 OpenAPI 的共享 `TaskStatus.audio` 仅写成数组，落后于此正文。本模块按端点正文分开验证；不把数组 SFX 或 Music 单对象默认为兼容结果。

去敏的精确片段、原响应 SHA-256 和来源记录位于 [sfx-sources.json](research/sonilo-native-20261005/sfx-sources.json)、[SFX OpenAPI 片段](research/sonilo-native-20261005/sfx-platform-openapi-excerpt.json)、[视频正文](research/sonilo-native-20261005/video-to-sfx-sfx-contract-excerpt.txt)、[文字正文](research/sonilo-native-20261005/text-to-sfx-sfx-contract-excerpt.txt)、[任务结果对象正文](research/sonilo-native-20261005/get-task-sfx-contract-excerpt.txt)。官方“frame-accurate”是供应商声明，本地 fixture 不证明真实模型逐事件同步。

## 配置和恢复兼容

```json
{
  "protocol": "sonilo-native",
  "baseUrl": "https://api.sonilo.com",
  "modelMap": {
    "sonilo-sfx": {"kind":"audio.generate","model":"sonilo-sfx"}
  }
}
```

此示例没有可用 Key。需要操作者独立的 Sonilo API Key 及服务权限，由已有服务器配置系统注入。推荐独立 SFX provider；已有 Music provider 的 `DEFAULT_SONILO_MODEL_MAP` 保持单 Music 绑定和已发布 fingerprint 算法，默认不会启用 SFX。新安装也可显式配置两种绑定；映射变化会改变 fingerprint，已有任务须保留原 provider 配置恢复，不放宽 `rg1/sn1` 配置一致性。

REST 接口没有模型字段。`sonilo-sfx` 是本地明确的端点语义绑定，只在本地映射、metadata 和身份中使用；不会提交虚构供应商型号。

## 本地请求合同

文字请求：

```json
{
  "kind":"audio.generate",
  "prompt":"雨点敲击金属屋顶",
  "inputs":[],
  "parameters":{
    "model":"sonilo-sfx","virtualModel":"sonilo-music","scene":"Sound",
    "duration":2.375,"count":1
  }
}
```

视频请求（`...` 仅是示例，实际须完整 MP4）：

```json
{
  "kind":"audio.generate",
  "prompt":"",
  "inputs":[{"id":"source","type":"video","url":"data:video/mp4;base64,...","duration":2}],
  "parameters":{
    "model":"sonilo-sfx","scene":"Sound","duration":2,"count":1,
    "segments":[
      {"start":0,"end":0.375,"prompt":"轻微脚步"},
      {"start":0.375,"end":1.125,"prompt":"玻璃触碰"},
      {"start":1.125,"end":2,"prompt":"远处回响"}
    ]
  }
}
```

| 项目 | 本地行为 |
| --- | --- |
| 场景 / 型号 | `Sound` / `sonilo-sfx`；model、modelId 和可选 `providerParameters.model` 必须一致。virtualModel 可为正式选择器的 `sonilo-music` 或 `sonilo-sfx`，不参与实际端点改写 |
| 文字 | 0.5–180 秒 number、显式时长；描述非空，最多 2000 字符；Music 仍为 1000；无视频字段与分段 |
| 视频 | 一份真实 MP4；0.5–480 秒，0.5 秒下限是本地预算，官方只公开 480 秒上限；声明时长等于来源并经 FFprobe / 全解码核验 |
| 分段 | 仅视频，1–30 项，恰 `start/end/prompt`；首 start=0、end>start、前 end===后 start、末 end<=实际视频；prompt 非空最多 200 字符；不要求覆盖到视频末尾 |
| 精确边界 | 小数原样保留，`JSON.stringify(segments)` 一次提交；不排序、量化、补缝、裁切或拆收费任务 |
| 数量 | request.count / parameters.count / times 缺省 1；若出现须全为整数 1；公开合同无多变体，2–10 也拒绝，不能套 Music 数量 |
| 格式 | 固定 `audio_format=wav`；不提交 Music 的 mode/output_format/variants_num，不转码其他格式 |
| 附加设置 | 只接受可选 providerParameters.model 的一致性检查；prompt_influence、混流、speech、ducking、stems、歌词、私有headers和未知设置均拒绝 |

本地预校验继续复用 50,000,000 bytes、16,777,216 pixels、21,600 声明帧、最多一视频轨/一音轨的资源预算。来源文件只通过既有公共 DNS/实际对端安全下载器读取或内联 MP4 输入；FFmpeg 不读取外部 URL。完整 FFmpeg 解码后上传已验证原字节，不提交供应商 `video_url`。本模块不把供应商默认 300 MB 当作本地上传预算。

公开 `metadata.capabilities.sound['sonilo-sfx']` 与 `videoAudio['sonilo-sfx']` 提供同一 profile：`scene:Sound`、`semantics:native`、`durationMode:source-video-or-explicit`、文字 duration 0.5–180、localVideoDuration 0.5–480、`textOnly:true`、maxCount=1、`segments:true`、`segmentContract:{fields:[start,end,prompt],firstStart:0,contiguous:true,videoOnly:true,maxSegments:30,maxPromptCharacters:200}`、formats=[wav]。Music profile 的 start/prompt/label 与最少 5 秒规则保留。

## 工具执行合同

| 工具 / 操作 | 目的、输入 → 输出 | 权限 | 失败行为 | 日志 / 状态 | 定向测试 |
| --- | --- | --- | --- | --- | --- |
| parseSoniloModelMap | 精确的 Music/SFX 映射 → 克隆后映射 | 本地内存；不查账号、不读取环境 | 未知绑定、跨型号映射或多余字段 configuration_invalid | 配置 fingerprint，不记录 Key | 映射、默认 Music fingerprint 不变 |
| validateSoniloSfxSegments | 显式 start/end/prompt、实际时长 → 原值克隆 | 本地内存 | 不连续、越界、空提示、额外键、超过30项零 POST 拒绝 | 不量化、不补造事件时间 | 小数边界、空/重叠/间隙/反转/越界/label |
| prepare | 明确音频请求 → 原请求（完成同步输入校验） | 本地内存；无供应商调用 | 缺映射或未知参数拒绝 | 本地 preparation 错误；无 Key / 正文日志 | 场景、数量、文本分段、未支持参数零 POST |
| FFprobe + FFmpeg / 来源下载 | 私有临时 MP4、预算、来源声明 → 解码验收及原文件哈希 | 本机媒体工具；已安全验证的公共 HTTPS GET；私有临时目录 | 伪媒体、缺工具、声明不符 sonilo_preparation_failed、providerDispatched=false；清理临时文件 | 哈希和durable失败状态，不记录源内容/鉴权 | 真实2秒视频、声明不符、缺工具、私有DNS拒绝 |
| submit | 通过校验的请求 → 202 原task_id包装的 sn1 running | 仅 api.sonilo.com Bearer multipart POST；不传 Key 给下载器 | 明确4xx失败；丢失回执 unknown；不自动重 POST | 有回调时先 await onTaskIdentity，成功保存后才返回 accepted | HTTP真实表单字段/原字节、回调await、存储失败不GET |
| poll | 当前精确 sn1 → running/failed 或一份完整WAV | 仅原 task_id 的官方 GET；无认证公共结果 GET | 错身份/状态、污染、音频数组、下载/PCM/时长不符均保持 unknown；不新建任务 | 原身份、实际时长；不记录 Key、临时签名URL或供应商错误正文 | SFX对象、Music身份回归、结果污染、截断/无效WAV、真实24/32位及浮点WAV转换 |
| generate | 同请求 + 保存回调 + 轮询预算 → 最终一份音频 | 同 submit/poll；无额外接口 | 保存失败不轮询；超时 unknown；不补交任务 | 恰一次 await 身份回调；默认3秒查询；无伪进度 | 持久化后才GET、回调失败/POST丢失不重POST |

`fetchImpl/download/ffmpegPath/ffprobePath` 仅为服务端受信任依赖。所有 fixture 通过这些接缝实现，不允许浏览器请求配置路径、headers、Cookie 或 Authorization。输出下载只收到 `{kind,signal}`。

SFX `sn1` 沿用七项身份：fingerprint、本地 model、实际 type、原 task_id、显式/来源时长、数量1、来源/请求哈希。model/type 必须匹配当前精确映射和各自时长/数量边界。Key 轮换不改变 fingerprint；配置变化不能复用别的任务。durable 保存同原身份后重启只 GET，不 POST。

成功必须是单 `audio:{url,content_type:'audio/wav',file_size}`，拒绝 Music 数组、其他端点的 sfx/music/outputs、未请求标题/stream_index、任意额外 SFX 回执字段。供应商文件完整读取，原始 bytes 必须等于声明且最多 50 MiB。PCM16 WAV 保留原字节；其他实际 WAV 通过既有 FFprobe/FFmpeg 在 0700 私有临时目录真解码为 PCM16，保留采样率、1–2声道和实际时长，无裁切、补音或模型重生成。解码只允许本地 file/pipe 和 WAV；单音轨、8–192 kHz、0.5–480秒及50 MiB输出预算须全部满足，时长与任务一致（0.1秒容差），解码输出时长还须与探测值相差不超过一个样本。工具缺失、畸形/截断、解码失败或超预算保持原任务 unknown，仅可查询，不重 POST。临时文件在成功、失败或取消后清理。公开文档没有保证位深，因此不能仅凭非PCM16断言供应商结果无效。输出为完整 `data:audio/wav`，复用现有共享 materializer 本地归档；转换后的本地文件大小不再冒称供应商原始 file_size。Music WAV路径未改变。

公开合同无取消端点和供应商幂等保证；metadata 保持 `remoteCancellation:false`、`providerIdempotency:false`。本地放弃不能声明远程停止计费。

## 验证与范围

```sh
node --test tests/generation-sonilo-sfx.test.cjs tests/agent-sonilo-sfx-schema.test.cjs tests/sonilo-sfx-native-ui.test.cjs
node --test --test-name-pattern='Sonilo independent native metadata|unimplemented settings|restart and Key rotation recover|Sonilo direct\+routed profile' tests/generation-sonilo.test.cjs tests/sonilo-audio-native-ui.test.cjs
node --check server/generation-sonilo.cjs
node --check agent-tools.js
node --check src/features/audio-generation/native-profile.mjs
```

2026-10-07 新鲜验证：SFX backend **13/13**、Agent schema **3/3**、native UI **4/4**，合计 **20/20**；受影响 Music 最小回归 **4/4**；三个修改源文件语法检查通过。没有重跑无关旧全套。新增跨边界检查从正式 audio-ui.js 的 buildRequest、Agent工具parse、routed公开metadata生成实际HTTP JSON请求，再进入同一provider submit：覆盖正式虚拟Music选择器的Sound端点、0.5/0.75秒、精确分段原值、原MP4字节、2000通过/2001拒绝。真实FFmpeg由合成正弦PCM生成PCM24、PCM32和浮点WAV，再经provider真解码；转换后16bit样本与来源逐字节一致，只有一次提交和原任务GET。已有默认Music映射、fingerprint、七项sn1身份、标签与数量范围保留。

本批完成服务端、前端/Agent合同和跨边界定向验证。正式浏览器交互由主任务记录独立证据；本文件不据单元/集成检查宣称浏览器播放或真实Sonilo供应商验收。

2026-10-07 桌面媒体路径补充：Sonilo构造器与项目既有Magnific/本地视频工具约定一致，缺省读取 `FFMPEG_PATH` / `FFPROBE_PATH`；显式构造参数优先，未设置变量时仍为 `ffmpeg` / `ffprobe`。没有扩展HTTP请求或公开供应商配置字段。新增一条隔离child环境定向回归 **1/1**：只注入fixture工具路径和合成凭据，direct/routed gateway都完成真实MP4预检与PCM24 WAV解码，各指定FFmpeg/FFprobe包装器实际被调用四次，无额外POST。既有运行server和浏览器fixture未重启。

```sh
node --test --test-name-pattern='gateways honor fixture FFMPEG_PATH' tests/generation-sonilo-sfx.test.cjs
```
