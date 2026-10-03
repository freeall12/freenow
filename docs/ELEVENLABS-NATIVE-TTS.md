# ElevenLabs 原生文字转语音

`elevenlabs-native` 直接调用官方 Text to Speech API。现有 Eleven TTS 音频节点与 Agent 确认卡均使用原始 `eleven_v3` 和音色库中的稳定 `voice_id`；不把名称映射到 OpenAI 声音，不需要另建 `/tasks` 网关。没有默认声线，用户必须选择真实音色。

## 配置与工作流

与其他供应商共用多供应商路由时，在已有配置中合并以下 provider 和音频模型路由；不要用示例覆盖已配置的图片/视频路由。

```bash
GENERATION_PROVIDERS={"eleven":{"protocol":"elevenlabs-native","apiKeyEnv":"ELEVENLABS_API_KEY"}}
GENERATION_ROUTES={"audio.generate":{"models":{"eleven_v3":"eleven"}}}
ELEVENLABS_API_KEY=YOUR_PRIVATE_KEY
VOICE_CATALOG_PROVIDER=elevenlabs
ELEVENLABS_API_BASE_URL=https://api.elevenlabs.io
```

默认 TTS origin 是 `https://api.elevenlabs.io`。如果显式配置兼容 origin，生成 provider 使用 `baseUrl` 或 `baseUrlEnv`；目录使用 `ELEVENLABS_API_BASE_URL`。这两个地址不会自动互相改写。默认没有 `modelMap` 时仅开启 `{eleven_v3:{kind:"audio.generate",model:"eleven_v3"}}`；显式 `modelMap:{}` 仍是未配置，错误映射不退回默认模型。

音色目录和生成 provider 可以显式引用同一个 `ELEVENLABS_API_KEY`，但填音色目录 Key 不会偷偷启用或改写生成配置。操作员还必须选择 `elevenlabs-native` 协议和模型路由。服务器 `process.env` 读取 Key；`.env.example` 不会自动加载。浏览器现有“连接 API”仍是原 `/tasks` 协议 session 配置，该窗口不应粘贴 ElevenLabs Key 并假定已选择原生协议。

只有单一生成供应商时，可以显式选择 legacy 配置：

```bash
GENERATION_API_PROTOCOL=elevenlabs-native
GENERATION_API_KEY=YOUR_PRIVATE_KEY
GENERATION_API_BASE_URL=https://api.elevenlabs.io
# 删除/省略 GENERATION_MODEL_MAP 使用已核实默认；显式 {} 会保持未配置。
```

此模式不自动把 `GENERATION_API_KEY` 借给音色目录；目录仍需要独立的 `ELEVENLABS_API_KEY`。需要两者共用时由操作员在私有 ENV 中显式配置同一值。

用户选择 Eleven TTS → 真实音色库选音色 → 输入正文 → 确认生成。Node/Agent 生成请求中的 `parameters.voice_id` 原样放入供应商路径；`parameters.model` 必须匹配已配置 alias，实际 body `model_id` 固定为 `eleven_v3`。稳定度仅支持现有 UI 三档 `0 / 0.5 / 1`，其他值在发送前拒绝，不舍入或换模型。

## 实际 API 合同

```http
POST https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID?output_format=mp3_44100_128
xi-api-key: SERVER_PRIVATE_KEY
Content-Type: application/json
Accept: audio/mpeg

{"text":"正文","model_id":"eleven_v3","voice_settings":{"stability":0.5}}
```

使用完整音频 HTTP 响应的有界流读取，不使用 WebSocket，也不提前把未校验字节传给浏览器。默认输出是官方默认 `mp3_44100_128`，逐帧检查完整 MP3、44.1 kHz 和 128 kbps；不接受改名 MP3、仅 ID3 标签、截断音频或不同实际采样率/码率。可选模型映射 `outputFormat:"wav_24000"` 读取真实 24 kHz、16 位 PCM WAV，严格检查 RIFF/fmt/data 长度、声道、采样率与 PCM 参数。其他码率/格式本批未接，不暗中转码。

```json
{"eleven_v3":{"kind":"audio.generate","model":"eleven_v3","outputFormat":"wav_24000"}}
```

正文与展开的文字参考合计最多 3000 字符，沿用现有 UI 限制。已经前置的文字参考不重复朗读。一次任务只有一个结果，不自动切段请求或并行多次收费。音乐、音效、音频/图片参考、克隆声线、速度、字幕、音量、发音字典和多说话人对话不由此接口承担；不支持参数在派发前明确拒绝。

## 安全、取消与归档

- Key 只发送到服务端选定的 API origin，沿用原站域、用户信息/查询参数、当前监听器以及重定向阻断。供应商响应、音频元数据与配置不得回显原始或 URL percent 编码 Key。错误信息固定，不回显上游错误正文。
- 读取最长 180 秒，最多 32 MiB，校验实际 Content-Type、完整流长度和音频字节。网络断开、HTTP 错误、重定向、超时、取消或无效音频均不自动重试。取消会中断本机 HTTP 读取，但不能声称供应商计费或远端生成已撤销。
- POST 派发前继续由现有 durable 服务保存幂等 intent。供应商请求头/history ID 不当作可恢复任务 ID；该协议无 `poll`、无远端 `cancel`，中断后状态保持 `unknown`、不伪恢复、不重发 POST。相同幂等键只返回原记录。
- 只有完整校验的真实字节进入既有 `generation-media-materializer` 和本地媒体 store。公开任务只返回 `/api/generation/media/UUID`，成功音频可跨重启读取；保存失败只重试本机素材保存，不重新生成。MP3 时长由真实浏览器解码提供，后端不猜时长。
- 配置成功仅证明服务端协议与字段已接，不证明实际 Key、账号额度、模型权限或音色版权/质量已经验证。

## 官方来源与证据边界

2026-10-03 直接读取公开官方 HTTP 文档，未使用用户浏览器、Key 或付费接口：

1. [官方 OpenAPI](https://api.elevenlabs.io/openapi.json)：`POST /v1/text-to-speech/{voice_id}`、`xi-api-key`、body `text`/`model_id`/`voice_settings`，query `output_format`（默认 `mp3_44100_128`，含 `wav_24000`）和二进制响应。
2. [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert.md)：`output_format` 明确是 `codec_sample_rate_bitrate`；WAV/PCM 44.1 kHz 和 MP3 192 kbps 存在套餐限制，本批未选择这些高套餐输出。
3. [Models](https://elevenlabs.io/docs/overview/models.md)：`eleven_v3` 可用于 Text to Speech，官方上限 5000 字符；本批没有扩大现有 UI 3000 字符限制，也没有改用较新模型。
4. [Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices.md)：当前页面主要描述较新 v4，仍明确 v3 不支持 SSML break，且 PVC 在 v3 的质量未充分优化。原 v3 专页已变更/跳转，不能把 v4 能力当作本批 v3 的已验证能力。

OpenAPI 的共享 `VoiceSettingsResponseModel.stability` 给出数值范围 0–1、默认 0.5，但没有 v3 专属枚举。本批保守采用现有 UI 的三档值，不将共享 schema 当作所有连续值都在真实 v3 账号上可用的证明。三档真实质量及账号权限仍需配置后的联调；任何供应商拒绝都不会偷偷换档或重试收费请求。

## 验证

```bash
node --test tests/generation-elevenlabs.test.cjs
node --check server/generation-elevenlabs.cjs
```

专测使用合成 Key、本机 HTTP fixture、真实 MP3/WAV 字节。涵盖精确 POST、Node/Agent 输入、默认/空映射、多供应商不会误路由、音频规格/长度/Key 拒绝、取消/超时、生产 gateway 的实际媒体落盘、重启读取、未知状态不重发、取消后迟到字节不被接受。

专属真实 MP3 fixture 的生成命令（使用本机已有 FFmpeg，仅生成测试素材，不是运行时生成依赖）：

```bash
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=0.2' -ac 1 -c:a libmp3lame -b:a 128k -map_metadata -1 tests/fixtures/elevenlabs-tone-44100.mp3
```

此 fixture 仅证明编码、真实字节归档与交接合同，不证明 ElevenLabs 模型质量。本批未读取真实 Key、未调用供应商收费生成。

生产浏览器链可单独执行 `node scripts/qa-elevenlabs-native.cjs`。脚本打印备用 loopback URL、审计地址和私有临时目录；不读取 ENV、不改 4173、服务器主任务 store 或原源浏览器数据。该独立 origin 服务当前真实主页面，只加明确 fixture 辅助条：创建测试音频节点 → 在真实音色菜单选择 QA 音色 → 用真实生成链提交 → 查看生成的音频结果节点。实际 `AudioAPI.buildRequest`、`GenerationAPI.submit`、生产 router/gateway、媒体 store、浏览器 `LocalAssets` 与节点应用均保留；本机上游只返回测试正弦 MP3。

`/api/qa/elevenlabs-audit` 记录目录 GET、唯一 TTS POST 的模型/音色/稳定度/格式/实际字节和本机媒体取回；不会记录 Key 或正文。`window.elevenlabsNativeQA.audit` 记录真实请求、结果节点、原生 audio 的 metadata/playing/timeupdate/ended/error 事件，不伪造播放成功。该页面可证明真实前后端交接与播放路径，仍不能证明真实供应商模型能力。
