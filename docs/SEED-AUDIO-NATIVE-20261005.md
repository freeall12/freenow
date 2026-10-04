# Seed Audio 1.0 原生接口 · 2026-10-05

本地 `seed-audio-native` 使用火山引擎公开的 **多模态音频生成** 接口，实际型号为 `seed-audio-1.0`。它与 `seed-tts-2.0` 的同步语音合成接口是不同产品；没有转成 OpenAI Speech，也没有挪用旧 TTS 请求体、成功码或鉴权资源 ID。

实现位于 `server/generation-seed-audio.cjs`，独立验收在 `tests/generation-seed-audio.test.cjs`。本记录确认适配器合同与本地模拟 HTTP；实际账户开通状态、生成质量、声线与音频播放仍须有资格的供应商账号验收。

## 官方合同与配置

2026-10-05 通过公开无凭据 GET 读取[官方音频生成 HTTP 文档](https://www.volcengine.com/docs/6561/2550782)、[错误码](https://www.volcengine.com/docs/6561/2534853#2u2ql30k)。网站普通 HTML 是 JS 壳；使用该网站自身的公开 `/api/doc/getDocDetail?LibraryID=6561&DocumentID=2550782` 获取完整文档。其 `DocumentCode` 为 `audio-generation-http`，更新日期为 2026-09-28。原始正文、错误码、SHA256和安装包枚举摘录仅保存在开发机忽略目录 `reference/seed-audio-api-20261005.json`；公开使用以本页合同及官方链接为准。

| 项目 | 官方合同与本地处理 |
| --- | --- |
| URL | `POST https://openspeech.bytedance.com/api/v3/tts/create`，一次提交，无自动重试 |
| 新版鉴权 | `X-Api-Key`，从语音新版控制台 API Key 管理创建；不是 Ark Bearer Key |
| 其他请求头 | `X-Api-Request-Id` 使用随机 UUID，只作追踪，不作为可恢复任务 ID |
| AppID / ResourceID | 此新版音频生成合同不需要。旧控制台双头鉴权未实现；未猜 `X-Api-Resource-Id` |
| 型号 | `model:"seed-audio-1.0"`；默认本地别名 `doubao-seed-audio-1-0`，虚拟型号 `seed-audio-1-0` |
| 输入 | `text_prompt`，1–3000 字符；文字参考合并一次，保留换行 |
| 参考 | `references:[{image_data:base64}]` / `{image_url:https}` 或按原输入顺序 `{audio_data:base64}` / `{audio_url:https}`；无参考时省略字段 |
| 字幕 | `audio_config.enable_subtitle`；实际响应 `subtitle.text` 绑定到这一音频输出，沿用共享字幕规范 |
| 结果 | JSON 中完整 `audio` Base64；从实际媒体字节确认格式、采样率和时长，再交给共享 materializer 归档 |
| 状态 | 官方错误文档明确 code/message 可选，失败时 HTTP 非 200 返回八位错误码。本地 200 + 完整音频 + 无 code 确认成功；未核实 `code:0` 或旧 TTS `20000000` 均 unknown |
| 任务 | 无 poll/cancel/recover API。两小时有效期 URL、Logid、请求 UUID 都不伪装成任务 ID |

Key 保持在服务端闭包。配置 reader/router 接线由共享服务负责；适配器构造器为：

```js
createSeedAudioProvider({
  apiKey: process.env.SEED_AUDIO_API_KEY,
  // 可省略，默认官方 origin；不得包含 /api 路径。
  baseUrl: 'https://openspeech.bytedance.com',
  // 可省略；显式 {} 保持不可用。
  modelMap: {'doubao-seed-audio-1-0': {kind: 'audio.generate', model: 'seed-audio-1.0'}}
})
```

仅 API Key 缺失时仍不能提交；填写 Key 不证明账户拥有 Seed Audio 1.0 服务资格。配置 metadata 与 fingerprint 不含 Key；改变 Key 不改变协议指纹。真实 Key 不进入画布、字幕、响应、媒体标签或持久任务文件。

## 已实现参数与范围

| 参数 | 本地支持 |
| --- | --- |
| `format` | `wav`、`mp3`、`ogg_opus`，均实际检查并归档；PCM 没有独立可播放容器，未开放 |
| WAV 采样率 | 8000 / 16000 / 24000 / 32000 / 40000 / 44100 / 48000；官方省略默认40000，本地节点明确24000原样发送 |
| MP3 采样率 | 8000 / 16000 / 24000 / 32000 / 44100 / 48000；省略默认44100 |
| Ogg Opus | 仅48000。UI 选 Ogg + 24000 必须拒绝并提示修改，不能静默重采样 |
| `speech_rate`、`loudness_rate` | 整数 -50–100，0默认；保留官方百分比单位 |
| `pitch_rate` | 整数 -12–12，0默认 |
| `enable_subtitle` | 布尔开关；开启要求实际供应商返回合法字幕文本；空白文本按共享规范省略，无字幕对象或假造文本均 unknown |
| 图片 | 一张 PNG/JPEG/WebP，真实大小1 KiB–10 MiB；检查内联容器与尺寸 |
| 音频 | 最多三条 WAV/MP3/Ogg Opus。内联每条真实大小≤10 MiB、按实际音频帧/容器计算≤30秒；远端HTTPS交给供应商校验实际内容 |
| 混合引用 | 图片与音频禁止混用；音频顺序保持，`@音频N` 必须对应存在的第N条音频 |
| 数量 | 一个任务只有一个结果；次数/型号/场景矛盾、未知参数均提交前拒绝 |

原生能力通过 `metadata.capabilities.seedAudio[alias]` 声明。`referenceFormats`、`sampleRates`、`defaultSampleRates`、`minReferenceImageBytes`、各数量与大小界限供前端按实际路由预检；不会把 `tasks-v1` 网关硬限制成此子集。

正式请求示例保持原单位：

```json
{
  "model": "seed-audio-1.0",
  "text_prompt": "温柔女声朗读：你好，今天一起去骑车。",
  "audio_config": {
    "format": "wav",
    "sample_rate": 24000,
    "speech_rate": 0,
    "loudness_rate": 0,
    "pitch_rate": 0,
    "enable_subtitle": true
  }
}
```

## 明确的子集与失败行为

官方 `image_url/audio_url` 已实现：保留显式公网HTTPS地址原字串映射到相应字段，不额外抓取。复用 `publicMediaUrl` 与原站媒体阻断，拒绝 userinfo、私网数值IP、localhost/local/internal和原站域名。公网域名的DNS解析、实际可读性、格式、10MiB/30秒限制由供应商读取和校验；本地不把URL或input.duration/size当作实际字节验收。参考方式 metadata 为 `inline-or-public-https`，`remoteReferenceValidation:"provider"`。本地asset/blob仍走已有媒体准备后inline。官方 `speaker`、PCM、显式/隐式水印存在，但当前节点并无speaker或水印输入，本批明确拒绝这类参数及未展开references。

图片或音频参考只要含非null的 `clip`、`trim`、`sourceClip`，无论是内联还是HTTPS都在收费POST之前拒绝，要求先物化选区为独立媒体，避免静默发送完整源素材。字段省略或null不误拒绝。

输出必须包含完整 Base64 音频；仅过期远端 URL 的响应当前 unknown，不冒充本地归档完成。字幕仅接真实 `subtitle.text`，保留其排版；官方 sentences/words 时间轴不进入当前仅 `{text}` 的共享字幕 schema。本地不能声称已提供字级字幕编辑/导出。

媒体检查为容器与帧结构验收：WAV 复用已有16位PCM验证，MP3检查所有帧并读真实采样率，Ogg Opus检查完整页、CRC、序号、流ID、BOS/EOS、OpusHead/Tags、帧时长及终止granule范围。没有引入解码依赖；检查不证明音质、内容或供应商实际遵循提示词，最终浏览器解码与听音验收仍须进行。Ogg Opus 当前支持标准单流mono/stereo、mapping family0；多声道/其他mapping拒绝。

响应非200且含官方八位4/5开头错误码为 sanitized `failed/provider_rejected`；异常/截断/超限/未知状态码、凭据回显、超时均 unknown，不自动补发。取消关闭当前连接与reader，不宣称供应商取消或退费。重定向固定拒绝，避免 `X-Api-Key` 被发送到另一目的地。JSON与所有媒体实际字节使用共享 credential helper 检查，覆盖UTF-8、百分号编码及UTF-16双字节序标签。

## 验证

```sh
node --test tests/generation-seed-audio.test.cjs
node --check server/generation-seed-audio.cjs
git diff --check
```

16项独立测试通过。实际回环 HTTP 收到原生 POST/鉴权/型号/单位，WAV、MP3、Ogg Opus 三格式经过真实 materializer/media store，GET与Range字节相同，字幕来自供应商fixture。服务重启与Key轮换后保持原音频和原字幕，供应商调用数不增加。未知响应同幂等Key在重启后仍为 unknown，没有新增生成调用或成功字幕/媒体。其他覆盖包括真实重定向隔离、流超时/迟到响应清理、原Node和Agent配置、引用顺序与30秒边界、公网HTTPS字段精确传递与私网/原站零网络拒绝、未物化媒体选区零网络拒绝与null兼容、错误采样率/格式/状态/凭据拒绝。

Ogg fixture由已存在的本机ffmpeg生成0.12秒440Hz正弦音，不依赖测试机安装ffmpeg；MP3复用仓库已有合成fixture。独立适配器工作没有真实供应商计费调用，没有读取任何 `.env` 或私密Key，没有新增依赖、修改共享路由/字幕schema或浏览器操作。

主任务完成共享 gateway 与正式按钮的 CUA 验收，见[音频原生合同专项记录](../src/features/audio-generation/qa/native-pair.md)：Ogg/24000 禁用，显式 48000+字幕生成实际 Ogg 与字幕节点/来源连线，31 秒本地参考、缺 Key、空路由禁用，刷新后原生播放到 ended。该记录附审计和浏览器事件，区分先前 HTTP smoke 与本次浏览器提交；fixture 证明归档与解码链路，真实供应商账号、声线及生成质量仍未验证。
