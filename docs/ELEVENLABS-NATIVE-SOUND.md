# ElevenLabs 原生 Sound 音效

`elevenlabs-sound-native` 直接调用官方 `POST /v1/sound-generation`，现有 Node 和 Agent 的 `eleven_sound_effect` 明确映射为 `eleven_text_to_sound_v2`。它与 `elevenlabs-native` TTS 分开，音色目录与文字转语音仍沿用各自配置。

## 配置

在已有路由中合并下面的音效供应商与模型条目，保留现有图片、视频、语音及音乐路由：

```bash
GENERATION_PROVIDERS={"sound":{"protocol":"elevenlabs-sound-native","apiKeyEnv":"ELEVENLABS_API_KEY"}}
GENERATION_ROUTES={"audio.generate":{"models":{"eleven_sound_effect":"sound"}}}
ELEVENLABS_API_KEY=YOUR_PRIVATE_KEY
```

默认 origin 为 `https://api.elevenlabs.io`；兼容地址可显式配置 `baseUrl`/`baseUrlEnv`。默认模型映射为 `{eleven_sound_effect:{kind:"audio.generate",model:"eleven_text_to_sound_v2"}}`。显式空映射保持未配置；错误映射不会退回默认。单供应商可显式选择 `GENERATION_API_PROTOCOL=elevenlabs-sound-native` 并设置 `GENERATION_API_KEY`，不会自动借用音色目录凭据。`.env.example` 不自动加载；由服务端环境提供真实 Key。

## 请求与实际二进制

```http
POST https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128
xi-api-key: SERVER_PRIVATE_KEY
Content-Type: application/json
Accept: audio/mpeg

{"text":"轻柔的海浪拍打礁石","model_id":"eleven_text_to_sound_v2","loop":true,"prompt_influence":0.37,"duration_seconds":1.25}
```

音效参数原样传递，不舍入、不换模型：

| 产品字段 | 官方字段 | 支持范围 |
| --- | --- | --- |
| 时长 | `duration_seconds` | 0.5–30 秒，支持小数；省略/null 为自动，wire 省略该字段 |
| 循环 | `loop` | 布尔值，默认 false；v2 支持连续循环片段 |
| 提示词影响度 | `prompt_influence` | 有限数值 0–1，默认 0.3；越高越贴近描述，变化越少 |

Node 使用已有 0.5–30 秒范围和小数输入；Agent 保留原站 Agent 目录的 1–22 秒限制。供应商较宽能力不扩大原站 Agent UI。自动时长由供应商决定，后端不编造结果时长；loop 生成可重复播放的片段，不把单次生成延长到 30 秒之外。

文字参考折叠进有效描述，已前置的参考不重复。描述与参考总长度最多 1000 字符，沿用产品限制，一任务一个结果。语音音色、稳定度、音乐参数、图片/音频/视频参考及未展开引用都在 POST 前拒绝；本批只支持真实 MP3 44.1 kHz / 128 kbps，拒绝格式矛盾或暗中转码。官方 Sound endpoint 的格式枚举没有 WAV；不要复用 TTS 的 `wav_24000`。

使用最长 180 秒、最多 32 MiB 的有界流读取，检查 HTTP 200、响应类型、identity 编码、Content-Length、完整 MP3 逐帧结构、实际采样率/码率以及凭据泄漏。只有完整校验的真实字节作为 data URI 交给既有本地媒体归档，公开任务输出应为 `/api/generation/media/UUID`。不直接播放供应商未校验片段，MP3 时长由实际浏览器解码提供。

## 同步未知状态

该接口同步返回音频，无已核实的可恢复远端任务 ID、poll 或远端 cancel。请求/计费/history header 不构造任务身份。现有 durable 服务先保存本机 intent，派发后的 HTTP 失败、连接中断、超时或无效音频保持 `unknown`，不自动重试 POST；相同幂等键返回原任务。取消中断本机读取，不能保证远端生成或计费已经撤销，迟到响应不进入结果。

成功字节沿用本地 materializer/store，保存失败只重试本机保存。Key 仅发到配置的 API origin；错误不回显上游正文，重定向不转发凭据，响应音频元数据不得回显原始或 percent 编码 Key。配置成功不代表真实账号权限、额度或生成质量已经验证。

## 官方证据

2026-10-03 只读公开 HTTP 文档，快照保存在 `reference/elevenlabs-sound-native-20261003.json`：

- [官方 OpenAPI](https://api.elevenlabs.io/openapi.json)：`/v1/sound-generation`、v2 唯一模型枚举、loop、0.5–30 秒、0–1 影响度、默认 MP3 query 与二进制响应。
- [Create sound effect](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert.md)：同一精确 endpoint 和参数合同。
- [Sound effects overview](https://elevenlabs.io/docs/overview/capabilities/sound-effects.md)：给出 0.1–30 秒及非循环 WAV 48 kHz，但当前 endpoint schema/参考页为 0.5–30 秒且枚举无 WAV。本批采用更窄且可直接派发的 endpoint 合同，不将 overview 宣传范围视为额外已验证接口。

## 本机验证

```bash
node --test tests/generation-elevenlabs-sound.test.cjs
node --check server/generation-elevenlabs-sound.cjs
node scripts/qa-elevenlabs-sound-native.cjs
```

专测使用合成 Key、已有真实正弦 MP3 fixture，覆盖精确 POST、默认/小数/自动时长、循环、连续影响度、Node/Agent 请求、参考去重、拒绝参数、完整字节、错误流、重定向、凭据回显、忽略 abort 的传输和跨重启 unknown 不重发。

QA 脚本使用独立 loopback 端口、空 defaults 画布种子与私有临时 store，不读取真实 Key、不改主监听器。启动输出页面及 `/api/qa/elevenlabs-sound-audit` 地址。点击“创建测试音频节点”，通过正式音频参数入口编辑时长/循环，通过高级设置编辑影响度并正式生成；审计记录唯一 POST 的实际参数与字节、生产任务和原生音频 metadata/playing/timeupdate/ended/error 事件，刷新可继续验证原节点与归档音频。此 QA 使用本机正弦音，只证明真实交接与播放路径，不证明 ElevenLabs 的生成质量；未做收费调用。
