# ElevenLabs Music 原生供应商

已实现独立 `elevenlabs-music-native` 协议，默认本地模型别名与节点、Agent 目录一致：`music_v1`。适配器固定调用 ElevenLabs Music 的公开 Compose API，输出进入现有持久化任务、媒体校验、归档与本地下载链。

当前已验证官方公开 schema、SDK 合同和真实本地 HTTP / MP3 字节链路；没有真实 Key，也没有发出真实音乐生成或其他计费请求。测试音频是既有本地 MP3 tone fixture，不代表供应商音乐、中文歌词或风格效果。

## 官方合同与实现范围

核对时间：2026-10-05。官方 OpenAPI 完整响应 SHA-256：`bcda2b74cf627d3fcbb5f4235bef17845fc823cb5e18a1aaa21362a7cc1702b7`。schema 摘录和 SDK/community 内容哈希保留在本机 `reference/elevenlabs-music-api-20261005.json`（抓包研究目录不入库）。

- [官方 Compose API](https://elevenlabs.io/docs/api-reference/music/compose) 与 [官方 OpenAPI](https://api.elevenlabs.io/openapi.json)：`POST https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128`，`xi-api-key` 请求头，JSON body，`200` 响应为音频二进制。
- [官方 Python SDK](https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/music/client.py) 和 [官方 JS SDK](https://github.com/elevenlabs/elevenlabs-js/blob/main/src/api/resources/music/client/Client.ts)：`compose` 原生响应为 bytes / `ReadableStream<Uint8Array>`；SDK 与本地原生 HTTP 实现采用相同路径、query 与公开字段。两者许可证为 MIT，本项目无需安装。
- [社区 amlplugins/elevenlabs-music](https://github.com/amlplugins/elevenlabs-music)：MIT、0.0.1，源码只重导出 `@elevenlabs/elevenlabs-js`，没有额外的音乐协议或恢复逻辑；未安装，也没有把社区封装当作独立运行效果证据。
- 已抓原站 `reference/vendor-pkg-canvas-BREtla0j.js` 和本地 `audio-core.js`、`src/features/agent-generation/audio.mjs` 确认 Music 使用 `music_v1`、`music_length_ms`、`lyric_mode`、`force_instrumental`、`lyrics`。节点/Agent 当前 UI 时长上限为 300 秒；节点提示显示实际可选的 3–300 秒。原生供应商服务端协议可表达 600 秒，未因此扩大 UI 目录参数。

| 模式 | 原生 body | 已支持边界 |
| --- | --- | --- |
| 自动歌词/普通音乐描述 | `prompt`、`model_id:"music_v1"`、`force_instrumental:false` | 描述 1–4100 字符；时长省略或整数 3000–600000 ms |
| 纯音乐 | 同上，`force_instrumental:true` | 时长同上；不得残留自定义歌词 |
| 自定义歌词 | `composition_plan`、`model_id:"music_v1"`、`respect_sections_durations:true` | 单节；须明确 3000–120000 ms；最多 30 行，每行最多 200 字符 |

自定义歌词描述作为 `positive_global_styles:[prompt]`；歌词按原换行拆为 `sections[0].lines`，不改歌词文字、不自动插入 verse/chorus、不截断行、不分配多个音乐章节。单节名称为 `Song`。`composition_plan` 与顶层 `prompt` / `music_length_ms` / `force_instrumental` 互斥，因此这三个字段在自定义歌词请求中完全省略。

自动时长的自定义歌词、超过 120 秒的自定义歌词和超行/超字符输入在提交前返回 `unsupported_generation`。能力元数据 `capabilities.music.music_v1.customLyrics.duration` 明确给出 `min:3,max:120,automatic:false`，供 UI 提前校验。普通音乐关闭 `force_instrumental` 仅允许供应商按 prompt 决定是否有人声，不能保证必有人声。

公开 OpenAPI 还包含标为 `x-fern-ignore` 的 `lyrics_text`、`generation_mode` 等字段。当前公开 SDK 没有此稳定接口，本适配器不发送这些隐藏字段。其他 Music v2/v2.5、音频参考、inpaint、stem separation、seed、finetune、流式逐段播放、WAV/PCM 和多结果请求均未在此批接通，提交前拒绝，不替换成 TTS/SFX 或另一个模型。

## 配置

路由入口、单供应商协议入口和 readiness 注册由共享 gateway 接线。接线后最小路由配置为：

```dotenv
ELEVENLABS_API_KEY=填写自己的服务端Key
GENERATION_PROVIDERS={"music":{"protocol":"elevenlabs-music-native","apiKeyEnv":"ELEVENLABS_API_KEY"}}
GENERATION_ROUTES={"audio.generate":{"models":{"music_v1":"music"}}}
```

默认服务地址是 `https://api.elevenlabs.io`；默认模型映射为：

```json
{"music_v1":{"kind":"audio.generate","model":"music_v1"}}
```

可显式配置 `baseUrl` 或 `baseUrlEnv` 指向兼容的独立服务；地址只允许根路径，原站地址、嵌入凭据、带秘密的映射和参数均拒绝。Key 留在服务端，元数据不输出 Key；固定 `redirect:"error"` 防止重定向转发 Key。多个 ElevenLabs 语音、音效和音乐供应商可共用服务端 Key，通过模型路由分别调用对应原生协议。

适配器 API：

```js
const {createElevenLabsMusicProvider}=require('../server/generation-elevenlabs-music.cjs');
const provider=createElevenLabsMusicProvider({apiKey:process.env.ELEVENLABS_API_KEY});
// 交给现有 gateway/durable service；勿在浏览器或日志中暴露 Key。
```

## 执行和失败行为

Purpose: 将有界的 Music `audio.generate` 请求翻译为公开 ElevenLabs Compose API。

Inputs: 一个 Music 模型别名、描述、可选文字参考、模式和毫秒时长。参数必须一致，每次只允许一个输出。文本参考只合并一次；未展开 references、图片、音频或视频输入拒绝。

Outputs: 完整 MP3 校验成功后返回单个 audio data URL，由生产 materializer 保存为私有本地媒体资源。固定 MP3 44.1 kHz / 128 kbps；完整帧、码率、采样率、类型、长度均验收；大小上限 32 MiB。

Permissions: 本地服务端供应商配置授权；仅向已配置供应商 POST。真实 Key 缺失时 `configuration_required`。本地 fixture 使用明确的合成 Key，不读取用户环境凭据。

Failure modes: 网络断连、非 200、空/截断/错格式/超限媒体、超时、未知响应进入 `unknown`；不读回供应商错误正文、不自动重试、不再次计费提交。默认超时 600 秒，用户取消能停止本地等待和读取，但原生请求可能已在供应商执行。

Logging: 返回状态使用既有 durable receipt；不引入独立的供应商日志。响应 `song-id` 不作为可轮询异步任务 ID；此接口无已实现的远程恢复或取消。已有成功媒体重启后从本地存储读取；`unknown` 同幂等任务保持原状态，不产生新 POST。

Tests:

```bash
node --test tests/generation-elevenlabs-music.test.cjs
```

14 项供应商专项测试通过：精确 POST/schema、配置隔离、普通/纯音乐与毫秒边界、自定义 composition plan、真实节点/Agent 请求、无网络参数拒绝、MP3 内容拒绝、UTF-8/UTF-16 LE/BE 与百分号编码秘密回显拒绝、真实 HTTP 重定向防转发、取消/超时、真实 HTTP 断连后 `unknown` 持久化，以及真实 HTTP 上游 → durable → production materializer → owned GET/Range → 关闭上游 → 重启离线 GET 的完整字节比对。

前端新增 `native-profile.mjs`，通过公开 `GenerationAPI.availability()` / `configuration()` 获取实际路由能力，在节点生成按钮前显示自定义歌词 3–120 秒限制并禁用自动或超限输入。节点模式切换保留本地隐藏歌词草稿，只有当前模式有效字段发送给原生服务；Agent 明确提交的冲突歌词输入拒绝。tasks-v1 网关保留它自己的参数合同。

前端及相关音频应用回归：

```bash
node --test tests/audio-native-profile.test.cjs tests/audio-generation-in-place.test.cjs tests/audio-toolbar-performance.test.cjs tests/audio-menu-lifecycle.test.cjs tests/audio-menu-motion.test.cjs tests/audio-render-performance.test.cjs
```

34 项通过；与供应商专项合计 48 项。公共配置预检覆盖未配置、未路由、自定义自动时长、超限歌词与显式 Agent 冲突，失败时没有调用生成提交。

隔离浏览器 QA 入口（真实 loopback 上游与生产画布/gateway，不读取用户 Key）：

```bash
node scripts/qa-elevenlabs-music-native.cjs
```

脚本打印临时页面 URL 和 audit URL。2026-10-05 已在隔离页面使用正式画布及音频控件完成 CUA 浏览器验收：

- 正式参数菜单选择自定义歌词 + 自动时长时禁用生成；真实数值输入 121 秒继续禁用。改为 47 秒后可生成，Escape 关闭参数菜单并回焦到正式参数按钮。
- 正式生成提交 `composition_plan`，保留两行原歌词和 47000 ms。真实 4223 字节 MP3 经生产媒体归档，结果应用到同一节点的 `asset:` 引用；波形标记为 `decoded`，HTMLAudio 产生 `playing`、`timeupdate`、`ended` 事件。
- 正式参数切换至纯音乐后第二次生成成功，歌词在节点中隐藏，供应商 wire 不含 lyrics 或 composition plan。重新加载页面后结果仍可播放，提示显示实际节点目录范围 3–300 秒。
- 缺 Key 和缺路由均禁用生成，累计任务 POST 和上游 POST 保持各 2 次；恢复配置后重新可用。切回自定义时两行原歌词草稿和 47 秒完整保留。
- 鲜活 audit HTTP 读取确认仅 custom 和 instrumental 各一次 `/v1/music` POST；无效状态没有额外任务提交。

供应商 fixture 是既有正弦 MP3，实际可播放时长为 0.2 秒。47 秒只验证请求参数翻译与 UI 状态，不代表生成了 47 秒音乐，也不证明真实供应商的音乐质量或歌词遵循。浏览器验收完成后临时服务已停止，重新运行脚本会创建新的隔离端口与临时归档。

`music_v1` 在当前官方 OpenAPI 描述中已标记 deprecated，但仍为默认值与合法 enum。本适配器遵守现有目录明确选择的模型，不自动切换至 Music v2/v2.5。

没有运行真实供应商 Music API，供应商账号资格、Key 权限、延迟、成曲效果与中文歌词遵循仍需用户配置真实 Key 后验证。
