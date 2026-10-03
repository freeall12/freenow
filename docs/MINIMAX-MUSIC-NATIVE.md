# MiniMax Music 2.6 原生音乐适配

本批将普通音频节点和 Agent `audio.generate` 的 MiniMax Music 2.6 连接到独立 `minimax-music-native` 协议。它同步调用官方音乐 API，接收并核验实际音频 hex，再交给既有 gateway / durable / mediaStore 归档。每次单个结果、只 POST 一次；不生成假字幕，不把歌词当作识别字幕。

## 可用性与官方证据

2026-10-03 核实的两份官方页面：

- [英文 Music Generation](https://platform.minimax.io/docs/api-reference/music-generation.md)：OpenAPI server 为 `https://api.minimax.io`。
- [中文 Music Generation](https://platform.minimaxi.com/docs/api-reference/music-generation.md)：OpenAPI server 为 `https://api.minimax.cn`。

两页顶部均公告：**2026-08-20 起音乐和歌词付费 API 不再接受新用户，既有付费用户可继续；免费音乐 API 停止。** 因此新建普通 Key 不保证有音乐 API 资格。配置就绪只表示本地地址、Key 和模型映射有效，不能代替供应商账号资格验证；`accountEligibility` 显式为 `existing-paid-music-api-user`。不自动改用免费模型、Music 3、网站工作流或另一地区 host。

本批未调用真实付费 API，不能证明账号资格、生成音质或供应商在任意账户下的运行表现。两份公开文档只执行无凭据 GET；本地合同测试使用真实正弦音频 fixture。

公开 markdown 快照 SHA-256（不存用户 Key）：

| 页面 | SHA-256 |
| --- | --- |
| 英文 | 2257d7a4b9d531c26c45b64958feec283335cc839d012bf62db5752baccc7f67 |
| 中文 | 9b7c4433b54f25e43bb542883080fb2375e6a92e4cd12963eb2bc47bbaed9502 |

## 配置

单供应商示例（Key 仅填自己的服务端环境，不提交到仓库）：

```dotenv
GENERATION_API_PROTOCOL=minimax-music-native
GENERATION_API_BASE_URL=https://api.minimax.io
GENERATION_API_KEY=<existing-paid-music-api-user-key>
GENERATION_MODEL_MAP={"music-2.6":{"kind":"audio.generate","model":"music-2.6"}}
```

多供应商路由示例：

```dotenv
MINIMAX_MUSIC_API_KEY=<existing-paid-music-api-user-key>
GENERATION_PROVIDERS={"minimax_music":{"protocol":"minimax-music-native","apiKeyEnv":"MINIMAX_MUSIC_API_KEY","baseUrl":"https://api.minimax.io","modelMap":{"music-2.6":{"kind":"audio.generate","model":"music-2.6"}}}}
GENERATION_ROUTES={"audio.generate":{"models":{"music-2.6":"minimax_music"}}}
```

中国官方端点须显式设 `https://api.minimax.cn`；不根据 Key、语言或错误猜地区，也不在另一 host 上重新 POST。沿现 endpoint policy 支持明确的独立自托管 origin，拒绝原站域名、路径 base 和 redirect。模型映射可用自己的公开 alias，但供应商 model 必须明确为 `music-2.6`；禁止伪装其他模型。模块缺省 map 为这一模型，显式 `{}` 保持未配置。

默认输出 MP3 / 44100 Hz / 128000 bit/s。映射中可以明确调整：

```json
{
  "music-2.6": {
    "kind": "audio.generate",
    "model": "music-2.6",
    "audioSetting": {"format": "wav", "sampleRate": 24000}
  }
}
```

MP3 允许采样率 16000 / 24000 / 32000 / 44100，码率 32000 / 64000 / 128000 / 256000；低于 32000 Hz 不接受无法表示的 256000 MP3。WAV 不允许配置压缩 bitrate，本批验证 16-bit PCM WAV 1/2 声道，拒绝裸 PCM。请求显式 format / sample_rate / bitrate 必须匹配服务端配置，矛盾参数会在网络前拒绝，不静默忽略。

## 输入映射

普通节点复用 `AudioCore.transition({}, 'minimax-music-26', 'Music')`；Agent 目录新增同模型，图标复用现 MiniMax 视频目录官方资产，沿现表单布局。Agent 歌词、格式与采样率经 `audioRequestConfig` 和 `core.transition` 转换，不另建 generation 流程。

| 本地参数 | 原生字段与规则 |
| --- | --- |
| model / modelId | 明确映射的 `music-2.6` 或 alias；同时出现须一致 |
| scene / virtualModel | `Music` / `minimax-music-26` |
| prompt + text inputs | 文字参考拼一次换行；最终最多 2000 字符，不截断 |
| lyric_mode=false, force_instrumental=false | `lyrics_optimizer:true`, `is_instrumental:false`，供应商自动写歌词；必须有音乐描述 |
| lyric_mode=true, force_instrumental=false | `lyrics_optimizer:false`, 原样 `lyrics`；歌词 1–3500 字符，保留换行和结构标签，prompt 可空 |
| lyric_mode=false, force_instrumental=true | `lyrics_optimizer:false`, `is_instrumental:true`；必须有音乐描述，不发歌词 |
| format / sample_rate / bitrate | 对照明确配置的 `audio_setting` |
| count / times / request.count | 若提供只能为 1 |

自定义歌词与纯音乐双 flag 冲突、自动/纯音乐模式残留非空歌词均显式拒绝。Agent 切模式保留已输入歌词，验证提示清空或切回自定义；不会偷偷丢掉用户歌词。源节点自定义+纯音乐双 flag 也不能在 Agent 转换时被隐藏。

普通 AudioCore 公共目录现 prompt 上限仍为 3500；本协议在 prepare 阶段按官方 music-2.6 的 **2000 prompt / 3500 lyrics** 分开核验。Agent 已按这两个上限验证。超过原生上限不会 POST。

以下均在网络前拒绝：音频/图片/video/cover 参考、未展开 references、多结果、时长、voice、字幕、stream、URL 输出、供应商任意额外参数、Music 3/free/cover 模型替代。只支持文字参考，无真实 ASR/音效路径；歌词生成不等于带时间戳字幕。

## 输出、失败与恢复

请求：`POST /v1/music_generation`，Bearer Key，固定 `stream:false` / `output_format:'hex'`。

- 仅接受 HTTP 200 JSON、无 redirect、identity encoding、有界 body（实际音频 ≤50 MiB，JSON ≤100 MiB+64 KiB）；声明长度与实际长度必须一致。
- `base_resp.status_code` 必须为整数。0 继续核验；非 0 返回 terminal failed，供应商原始错误文案不回显。HTTP/连接/不完整回执未证实失败时保留 unknown。
- 成功必须 `data.status:2`、非空完整偶数 hex，并真实解码。MP3 验证所有 frame 与采样率/码率，WAV 验证 RIFF/chunk/PCM 字节边界与采样率。
- `extra_info.music_size` / `music_sample_rate` 若提供，必须与实际字节一致。不把供应商 `music_duration` 当真实播放时长。
- JSON 与解码字节拒绝凭据回显；公开 metadata、指纹和文案不含 Key。指纹包含协议/origin/map，Key 轮换不改指纹。
- 成功只返回真实 `audio` data URL；既有媒体归档再保存本地资源。无 fake subtitle、remote task ID 或凭借 trace_id 恢复能力。
- 同步 API 无 poll / remote cancel。外部取消会终止本地等待并拒绝迟到结果；超时、读取 stall、fetch 忽略 signal 时也不重 POST。unknown 任务不会自动重新生成。

## 验证与浏览器 fixture

专项测试：

```bash
node --test tests/generation-minimax-music.test.cjs
node --check server/generation-minimax-music.cjs
node --check src/features/agent-generation/audio.mjs
node --check scripts/qa-minimax-music-native.cjs
node --check src/features/audio-generation/qa/native-minimax-music.mjs
```

2026-10-03：12/12 专项测试通过。覆盖 AudioCore 三模式 exact POST、Agent source 恢复/冲突和字段转换、区域 origin、明确 alias、参数零网络拒绝、真实 MP3/WAV hex、损坏/截断/长度/采样率/凭据回显拒绝、供应商 terminal failure、取消/超时/迟到/stall 单 POST。独立 reviewer 另确认 durable 明确失败与幂等恢复无重复 POST。主代理负责 shared 注册、生产 gateway 集成与 CUA 实际页面验收。

隔离浏览器合同 fixture：

```bash
node scripts/qa-minimax-music-native.cjs
```

stdout 返回随机 loopback 页面和 `/api/qa/minimax-music-audit` URL。该页面用正式 `index.html` / AudioAPI / GenerationAPI 与正式 gateway / durable / mediaStore，四份 canvas/editor/sidebar/versions 数据脚本改用 `defaults/`，起始空画布，避免个人参考种子；服务端存储放入独立临时目录；浏览器随机 origin 独立存储；CSP 只允许 self/data/blob，其他业务 API 未配置；不读取真实 Key，也不连接原站或真实模型供应商。

面板选择歌词模式→创建测试音频节点→正式链提交当前节点→查看/播放原节点→刷新后查看/播放；既有真实 MP3 fixture 被模拟 upstream 编成 hex。自动/自定义/纯音乐改变实际原生 request 参数，声音都是本地正弦音，仅验证合同。`window.minimaxMusicNativeQA` 可读源ID/画布state/jobs，播放事件与实际回执在面板内；服务器 audit 可确认每次单 POST 与归档访问。刷新保留 sourceID，不能凭 fixture 证明真实音乐质量。

本批实际主画布 Computer Use、原节点回填/刷新播放及后端落盘证据见[联合验收](LOCAL-NATIVE-MEDIA-AND-SCENE-EXPORT-20261003.md)。本地正弦音频不代表真实模型质量。
