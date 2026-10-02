# OpenAI 原生文字转语音

现有画布和 Agent 使用 `kind:'audio.generate'` 与 `parameters.scene:'Text-to-Speech'`。适配复用这个合同，不新增 `audio.speech` 路由或前端型号。音乐、音效、音频参考、图片参考、克隆声线、ElevenLabs 稳定性和其他供应商特有能力不能等效为 OpenAI Speech，均在提交前明确拒绝。

## 配置合同

以下对象是 `GENERATION_MODEL_MAP` 的一个条目，展示别名与实际型号由操作者映射。Key仍仅由既有服务端配置提供。

```json
{
  "doubao-seed-audio-1-0": {
    "kind": "audio.generate",
    "scene": "Text-to-Speech",
    "model": "YOUR_ACCESSIBLE_OPENAI_TTS_MODEL",
    "defaultVoice": "coral",
    "voiceMap": {"narrator":"coral", "neutral":"alloy"},
    "formatMap": {"wav":"wav", "mp3":"mp3"},
    "defaultFormat": "wav",
    "speedMap": {"-50":0.5, "0":1, "25":1.25, "100":2},
    "defaultSpeed": 1,
    "wavSampleRate": 24000,
    "maxCount": 1
  }
}
```

该条目表示本机操作者选择使用 OpenAI 合成普通语音，不是 Seed/ElevenLabs 供应商能力或音色等效承诺。`defaultVoice` 或非空 `voiceMap` 至少有一个；可用映射目标仅为官方内置音色，拒绝 custom voice 对象。按2026-10-02实时官方指南，`tts-1`/`tts-1-hd` 支持9个音色：alloy、ash、coral、echo、fable、onyx、nova、sage、shimmer；其他配置型号仅允许官方公布的13个内置音色。账号型号权限仍须实际供应商验收。

`formatMap` 与 `defaultFormat` 必须显式配置，当前只开放 WAV/MP3，映射不能改变格式含义。PCM无文件头、Opus、AAC、FLAC尚未开放，不能把 `ogg_opus` 偷换成 MP3。`voice_id`/`voice` 必须匹配显式别名；未选择音色才使用操作者的默认音色。

## 现有参数如何映射

| 现有字段 | 原生行为 |
|---|---|
| `prompt`、文字 `inputs` | 朗读文本1–4096字符；AudioUI已前置的文字参考保持，不重复添加；直接调用的未展开文字参考按输入顺序前置 |
| `parameters.model` | 上层提供方按展示别名选择这个条目，实际 `body.model` 来自操作者配置 |
| `scene` | 必须是 `Text-to-Speech`；Music/Sound拒绝 |
| `voice_id` / `voice` | 经 `voiceMap` 映射到内置音色；冲突或未映射拒绝 |
| `format` / `response_format` | 经 `formatMap` 选择WAV/MP3；冲突拒绝 |
| `speech_rate` | 必须在显式 `speedMap` 中，保持现有UI的 `speed=1+百分比/100` 含义；例如25→1.25 |
| `speed` | 原生倍率0.25–4；若同时有 `speech_rate`，必须与映射值相同 |
| `sample_rate` | Speech没有该请求字段；仅在WAV且等于显式 `wavSampleRate` 时接收，之后验证返回WAV的真实采样率，未向供应商请求设置或重采样 |
| `pitch_rate:0`、`loudness_rate:0`、`enable_subtitle:false` | 明确识别为中性、无字幕参数；非中性/启用字幕拒绝 |
| `stability`、歌词、时长、其他字段 | 无法等效，提交前拒绝；不能静默忽略 |

Seed默认WAV/24000Hz/零语速偏移/零声调和音量偏移/无字幕可在上述输出约束下接入。Seed UI切MP3仍会携带 `sample_rate`，这项请求明确拒绝，因为原生MP3没有可设置的采样率合同。ElevenLabs UI默认携带 `stability:0.5`，同样明确拒绝；不能声称全部TTS菜单都已可用。

## 模块与集成接口

`server/generation-openai-speech.cjs` 导出：

```js
validateSpeechProfile(entry); // 返回配置克隆，非法配置抛 configuration_invalid
speechCapabilities(entry);    // 返回 scene/音色别名/格式/语速/引用边界，不返回真实型号
const prepared = prepareSpeechRequest(request, entry);
// {
//   kind: 'audio.generate',
//   body: {model, input, voice, response_format, speed, stream_format:'audio'},
//   expectedSampleRate: 24000 // 可选，只有WAV
// }
const result = await submitSpeech(prepared, {sdk, signal});
// {status:'succeeded', outputs:[{type:'audio',url:'data:audio/wav;base64,…',duration}]}
```

提供方在配置阶段对音频条目调用 `validateSpeechProfile`，在准备阶段调用 `prepareSpeechRequest`，在提交阶段使用现有SDK实例调用 `submitSpeech`。模块仅调用 `sdk.audio.speech.create`，发 `POST /audio/speech` JSON并读取二进制 `Response`。模块不创建新的凭据来源、不抓取素材URL、不调用克隆或音乐接口、不另建任务路由。

## 输出、取消、失败与记录

- 二进制读取有32 MiB总预算，检查声明长度并逐块计数；完整读取后才输出，空/截断/错误类型/格式/采样率均为unknown。
- WAV验证RIFF/fmt/data结构、完整16位PCM帧、真实采样率和样本时长；兼容长度以 `0xffffffff` 声明的流式WAV，以完整HTTP结束后的实际字节计数。返回原始字节，不改写或重采样。
- MP3验证ID3边界及完整MPEG Layer III帧。该结构检查不替代浏览器完整解码；编码器延迟和padding使帧数不能直接作为播放时长，因此MP3不填猜测时长。复用现有AudioAPI解码、波形与播放路径。
- `maxRetries:0`，请求和二进制消费共用超时/取消边界。取消中止本地等待并拦截迟到结果；不承诺远端停止或退款。请求后异常、429、输出不符均保持unknown，不自动重新提交。
- 复用原持久任务记录和幂等查询，重启后不重复生成。模块不新增Key、文本、音频日志。成功输出字节保存在既有本机任务记录中。
- 输出是AI合成语音，应在产品已有生成记录/结果说明中明确表达，不能当成录制或克隆的真人音色。

## 验证和来源

```sh
node --test tests/generation-openai-speech.test.cjs tests/audio.test.cjs
```

当前15项通过，包括实际Seed UI/Agent参数，真实已安装SDK的Speech endpoint/body/headers/二进制WAV，MP3字节保留，voice/format/speed边界，音乐/音效/克隆与稳定性拒绝，异常二进制/真实采样约束，取消/超时/unknown零重试及本机重启幂等。独立复审另用现有14秒WAV验收素材，经完整本机native提供方与安装SDK注入fetch走过一次Speech请求，字节保持且API调用1次。

测试响应是离线音频素材，未向真实供应商调用或计费，不能据此宣称语音效果或账号型号权限已验收。`tests/fixtures/speech-tone.mp3` 是离线440Hz、24000Hz、0.12秒正弦音测试素材，命令如下；运行测试不依赖ffmpeg：

```sh
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i 'sine=frequency=440:sample_rate=24000:duration=0.12' \
  -c:a libmp3lame -b:a 64k -write_xing 0 -map_metadata -1 \
  tests/fixtures/speech-tone.mp3
```

权威合同：[OpenAI文字转语音指南](https://developers.openai.com/api/docs/guides/text-to-speech)、[Speech API参考](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)，以及已安装SDK `node_modules/openai/resources/audio/speech.d.ts` 和 `speech.js`。官方输入上限4096字符，speed0.25–4，Speech返回二进制；API支持的其他格式不等于本项目已支持。
