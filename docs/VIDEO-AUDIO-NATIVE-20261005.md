# 视频拟音的显式 ThinkSound 替代接口

2026-10-05 首批核验记录：安装版 TapNow 的 Sonilo 音乐 / 音效支持参考视频；当时读取的 TapNow 官方使用文档和客户端资源没有提供可独立接入的 Sonilo 公开鉴权、请求、结果、恢复或取消合同。因此首批没有实现或声明 `sonilo-native`，实现的是操作者明确配置的 **ThinkSound Video-to-Audio** 原生 fal 接口，仅覆盖 **单视频 → 单音频拟音**。以下安装包证据、哈希和 ThinkSound 验收保留该批历史范围。

同日后续扩大公开来源调查，已在 [Sonilo 官方开发者平台](https://platform.sonilo.com/docs/api/video-to-music) 与 [完整 OpenAPI](https://platform.sonilo.com/openapi.json) 找到独立 API，并实现 **`sonilo-native` 原生 Music**：本地 MP4 文件上传、视频音乐、文字分段音乐、1–10 个变体与原任务恢复。详细合同见 [Sonilo 原生音乐](SONILO-NATIVE-20261005.md)。这纠正的是首批调查的来源覆盖范围，不把安装包客户端路由误当供应商合同。Sonilo 原生 SFX、stems、语音保留和 ducking 仍未接入；ThinkSound 是可选的明确 SFX 替代。

## 官方 Sonilo 证据与范围

来源：[TapNow 音频使用文档](https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-audio)、本机 `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` 与 `page-DVqoHdTT.js`。使用文档列出 Sonilo Music 用于音乐和环境 / 动作音效，说明生成音频节点可试听、下载和存入素材库；它不是供应商 API 文档。

安装版 `index-BsHyQ2qj.js` 的静态证据（字符偏移，文件非源码行号）：

| 位置 | 原合同 |
| --- | --- |
| 6769549，`FAa` | `sonilo-music`，提示词 1000 字符，支持视频，默认 `duration:60`；音乐时长预设 30 / 60 / 120 秒，自定义 5–360 秒 |
| 6772910，`OAa` | `sonilo-sfx`，提示词 2000 字符，支持视频，来源最大 180 秒，默认 `duration:10`；音效预设 5 / 10 / 30 秒，自定义 1–180 秒 |
| 6780554，`Sfs` | 视频音乐提交 `scene:"video-to-music"`、`model`、`video_url`、可选 `prompt`、`duration`、`segments`；无视频时提交 `audio-gen` |
| 6780839，`Ifs` | 视频拟音提交 `scene:"video-to-sfx"`、`model`、`video_url`、可选 `prompt`、`duration`；无视频时提交 `sound-effect` |
| `page-DVqoHdTT.js` 的 `wg.sonilo` | Agent 提供 `music` / `sound` 场景及对应 Sonilo 型号；仅有客户端路由信息，无法由此推导独立供应商鉴权 |

复核 SHA-256：

```text
index-BsHyQ2qj.js a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4
page-DVqoHdTT.js 8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86
```

本地 `audio-core.js` 保留上述两个型号及视频输入限制；`audio-ui.js` 在正式提交前读取视频时长，让 `parameters.duration` 跟随来源。首批 ThinkSound 替代没有伪造 Sonilo 密钥入口、使用原站服务或复制登录凭据。后续音乐 / 音乐分段已由独立 Sonilo 原生接口接入；无视频音效及 Sonilo 原生 SFX 仍未接入，不会把音乐请求转发到 ThinkSound。

### 后续 Sonilo Music 独立 Key 配置

在私有环境文件中填写独立 [Sonilo API Key](https://platform.sonilo.com/dashboard/api-keys)，这里只给出空变量和路由模板。将条目合并到已有配置，保留下面 `sonilo-sfx → videoSound` 的可选 ThinkSound 路由和其他音频型号：

```sh
SONILO_API_KEY=
GENERATION_PROVIDERS='{"sonilo":{"protocol":"sonilo-native","apiKeyEnv":"SONILO_API_KEY","baseUrl":"https://api.sonilo.com","modelMap":{"sonilo-music":{"kind":"audio.generate","model":"sonilo-music"}}}}'
GENERATION_ROUTES='{"audio.generate":{"models":{"sonilo-music":"sonilo"}}}'
```

Music 原字节 multipart 上传不依赖公网视频发布；本机需 FFmpeg / FFprobe。`SONILO_API_KEY` 只进入官方服务端 API 请求头，不能用 `FAL_KEY` 替代。SFX 替代仍单独使用 fal Key；两条配置均不代表已完成真实供应商音质 / 视觉同步验收。[多供应商配置](MULTI-PROVIDER-SETUP.md)

## 真实供应商合同

当前公开 GET 核验来源：

- [ThinkSound audio API](https://fal.ai/models/fal-ai/thinksound/audio/api)
- [供应商模型可读合同](https://fal.ai/models/fal-ai/thinksound/audio/llms.txt)
- [队列 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/thinksound/audio)
- [ThinkSound 原始项目](https://github.com/QwenAudio/ThinkSound)及其 [README](https://github.com/QwenAudio/ThinkSound/blob/master/README.md)

fal 公共模型元数据标识该路由已公开、未弃用、商业使用接口，发布于 2025-07-02；原始项目是 NeurIPS 2025 的视频 / 多模态音频生成实现。自托管代码、模型许可证仍需单独核对：README 区分 Apache 2.0 内容与来自 Stable Audio Open 的 VAE / Stability AI Community License。本适配调用 fal 的现有托管 HTTP 接口，没有安装模型、客户端或其他依赖。

| 参数 | 公开合同与适配行为 |
| --- | --- |
| 模型 | `fal-ai/thinksound/audio`，明确显示 `ThinkSound Video-to-Audio` |
| `video_url` | 必填。输入使用一个实际 MP4；公网 HTTPS 来源先安全读取并转成校验后的内联 MP4再 POST |
| `prompt` | 可选，默认空字符串；没有文字时供应商从视频提取引导描述。保留用户实际字符串，不截断或追加编造内容 |
| `seed` | 可选整数或 `null`；本地要求 JavaScript 安全整数，没有人为设定供应商未公开的整数范围 |
| `num_inference_steps` | 可选整数 2–100，官方默认 24 |
| `cfg_scale` | 可选数字 1–20，官方默认 5 |
| `duration` | **公开请求没有此字段**。本地只验收来源时长绑定，不向供应商发送自定义时长控制 |
| 输出 | 必须为 `audio:File` 与 `prompt:string`；官方例子是 WAV。适配要求完整 16-bit PCM WAV，按实际 PCM 字节测得时长，拒收视频或错误 MIME |

`fal-ai/mmaudio-v2` 的公开合同接受视频，但仅返回 `video:File`；其 `/text-to-audio` 返回音频但不接受视频。因此未用 MMAudio 冒充视频到音频接口，也没有自动从视频结果提取音轨的隐式处理。

**时长边界必须分开理解。** ThinkSound 公开 schema 没有来源最大时长、输出时长参数、分段、循环或音乐编排控制。`localVideoDuration:1–180` 继承 Sonilo SFX 的本地入口边界，不代表已验证 ThinkSound 支持 180 秒；元数据明确 `providerMaxVideoDuration:null`。正式请求要求 `parameters.duration === inputs[0].duration`，内联 / 下载后的 MP4 `mvhd` 时长须在 0.01 秒误差内一致，返回 WAV 实际样本时长须与原视频在 0.1 秒误差内一致。超长、截短或其他不符结果保持原任务待核实，不截断、拼接或重新生成。

## 操作者显式配置

服务协议是 `fal-video-audio-native`，Key 是独立 fal 账户的服务端凭据。以下只包含无凭据的映射示例，不包含可用密钥；须使用项目既有服务端配置或会话配置机制。

```json
{
  "protocol": "fal-video-audio-native",
  "baseUrl": "https://queue.fal.run",
  "modelMap": {
    "sonilo-sfx": {
      "kind": "audio.generate",
      "model": "fal-ai/thinksound/audio",
      "semantics": "explicit-native-alternative"
    }
  }
}
```

没有默认映射。缺 Key、缺显式 map、映射音乐、替换模型、遗漏 `semantics`、使用其他 API origin 均不提交。模型名只是画布原有 `sonilo-sfx` 选择的绑定别名；实际执行的是 ThinkSound，前端和公开配置元数据必须显示真实模型及替代含义。已有原生 Sonilo 字样不得用于描述此后端。

适配器 `server/generation-video-audio.cjs` 导出：

```js
createVideoAudioProvider({
  baseUrl: '', apiKey: '', modelMap,
  fetchImpl: fetch,
  download: createGenerationMediaDownloader().download,
  mediaTimeoutMs: 120000
})
```

还导出 `parseVideoAudioModelMap`、`VIDEO_AUDIO_MODEL`、`MAX_AUDIO_BYTES`、`MAX_VIDEO_BYTES`。`download` 是服务端测试接缝，不可由浏览器或任务请求指定；生产默认下载器固定公共 DNS 与连接对端、拒绝重定向、限制响应字节并验证素材格式。

直接请求示例（真实 MP4 已先绑定，无参考片段）：

```json
{
  "kind": "audio.generate",
  "nodeId": "target-audio",
  "prompt": "",
  "inputs": [{"id":"source-video","type":"video","url":"data:video/mp4;base64,...","duration":2}],
  "parameters": {
    "model":"sonilo-sfx",
    "virtualModel":"sonilo-music",
    "scene":"Sound",
    "duration":2,
    "providerParameters":{"seed":0,"num_inference_steps":24,"cfg_scale":5}
  }
}
```

该示例的 `...` 不是有效媒体内容。真实入口必须提供完整且可校验的媒体字节。最多一个视频 / 一个结果；Music、纯文字生成、额外文字 / 图片 / 音频引用、`clip`、`trim`、`sourceClip`、`segments`、循环、格式选择及其他未支持设置直接拒绝。选择片段必须先导出真实 MP4。不会忽略参数后计费。

## 字节、恢复与取消

- MP4 上限为本地 50,000,000 bytes；完整顶层容器、非空 `mdat`、`mvhd`、`vide` 视频轨、视觉 `stsd`、`stts/stsc/stsz/stco` 或 `co64` 样本索引须有效并真实引用媒体 payload。仅有容器头、音频轨或空数据不会进入 POST。这是完整索引 MP4 的结构 / 样本边界验证，**不是完整编解码解码验收**；碎片化或该验证不支持的 MP4 须先导出兼容文件。
- 公网视频来源和 WAV CDN 均使用安全下载器，验证 DNS / 实际连接对端、长度、MIME、完整数据；不附带 fal Key、Cookie 或 provider 回执中的自定义 headers。响应最多 1 MiB JSON，媒体最多本地预算，读取有超时与取消；媒体响应和编码元数据都拒收凭据回显，包括 URL 百分号编码及 UTF-16 元数据。
- 队列复用 `generation-fal-queue.cjs` 的固定 origin 和 SDK 应用队列路由：唯一 POST `/fal-ai/thinksound/audio`，原任务 GET `/fal-ai/thinksound/requests/{request_id}/status?logs=0`，完成后 GET 同任务结果。公开 OpenAPI 的路由表含模型路径 `/audio`；当前共享队列采用项目已核实的 SDK `owner/alias` 应用队列归属，不跟随供应商给出的 `status_url/response_url/cancel_url`。
- 接受任务后保存 `va1` 标识，绑定真实模型、原始 request ID、明确替代含义和原视频时长。重启后查询相同身份；Key 轮换不改变配置 fingerprint。不同任务 ID、无配置、错误或污染响应、超时均不会重 POST。
- 取消调用原任务 `/cancel` 的 PUT。`CANCELLATION_REQUESTED`、`ALREADY_COMPLETED`、`NOT_FOUND` 都无法证明远程计算停止，返回 `unknown`；本地取消和远端停算保证不能混为一谈。
- 结果先完整读取并校验 WAV，再返回内联 `data:audio/wav`，共享 materializer 保存到本地 `/api/generation/media/{resourceId}`。本地保存失败可恢复原任务结果；不会重新生成或二次下载已交给 materializer 的同一 WAV。

## 本次验证与未验证事项

没有读取真实 `.env` / Key、发起实际模型 POST 或收费调用。测试使用隔离 HTTP 回执、已有两秒 MP4 样本与合成两秒 PCM WAV；音质和模型产出能力不由这些 fixture 证明。

```bash
node --test tests/generation-video-audio.test.cjs
node --test --test-name-pattern='public video sources' tests/generation-video-audio.test.cjs
node --test --test-name-pattern='header-only|public video sources|MP4 actual|video-only optional' tests/generation-video-audio.test.cjs
node --check server/generation-video-audio.cjs
```

首轮 12/12 通过；新增公网来源安全预下载后只运行差异测试 1/1；补索引视频轨验证后只运行差异测试 4/4；收紧额外结果字段后恢复 / 描述符 / 下载 / 本地保存差异测试 4/4。覆盖无配置、明确映射、精确 wire、空 prompt、额外设置和引用零 POST、私网来源、完整媒体、凭据污染、原任务恢复、Key 轮换、私有 DNS / 对端不匹配、真实音频本地保存、取消、超时和丢失 POST 禁止重发。独立只读交叉审阅复现的 64 字节伪 MP4 已零 POST 拒绝，相关新增回归独立 1/1 通过。共享路由、会话配置和浏览器交互由相应模块独立验证；本文件记录独立适配器的证据和限制。

## 正式画布的隔离 HTTP fixture

```bash
node scripts/qa-video-audio-native.cjs
```

脚本打印随机 loopback 页面 URL、audit URL、上游端口和临时归档目录。它运行正式画布 / AudioAPI / GenerationAPI / 持久 gateway；将固定 fal API 身份通过服务端 `fetchImpl` 接缝转到真实 loopback HTTP，将固定媒体身份下载后的 bytes 交给生产 downloader 校验。生产 DNS / 连接对端 / origin 策略未改。该脚本不读取真实 `.env`，Key 为私有 fixture 常量，不写入审计；终止信号关闭三个模式的持久 gateway 和两台 HTTP listener。

来源是 `qa/trim-scenes.mp4`，启动时调用已安装 `ffprobe` 读取真实视频轨、尺寸和时长（当前样本 8 秒）。输出是脚本生成的相同时长 16 kHz 单声道 PCM16 440 Hz 音调，有渐入渐出，明确 **固定音频，不是模型效果**。脚本不会模拟模型拟音品质。

页面左上面板：

1. 点击 **创建视频→音效节点**，真实 MP4 导入 LocalAssets，创建 Sound / Sonilo 选择器的音频节点并连接来源。
2. 点击正式音频面板的 **生成音频**。确认显示实际 **ThinkSound Video-to-Audio** 替代模型，再核对节点原地应用、实际播放和本地 `/api/generation/media/` URL。
3. **缺Key（零提交）**、**缺路由（零提交）** 切换独立 gateway；实际生成按钮应禁用且上游 POST 数不增加。**恢复配置** 切回 ready。
4. **空提示词（视频推导）** 与 **拟音提示词** 只改节点草稿，不代替正式生成。

安全审计 GET `/api/qa/video-audio-native-audit` 返回模式、来源真实元数据、音频固定 fixture 标识、上游任务数、POST 的实际模型 / 引用字节数 / 提示词长度 / 有限控制参数、任务原 ID 的 GET 与无认证 CDN 读取；不返回完整 Key、Authorization、内联媒体或提示词原文。浏览器侧 `window.videoAudioNativeQA` 提供节点 ID、正式任务状态和原生播放事件；重载恢复可查看同一临时归档目录中的既有任务。本次本模块先完成脚本语法检查，正式浏览器验收由共享接线验证记录补充。

## 主线程 CUA 已完成的路径

正式音频按钮和真实 Agent 卡各提交一次，共 2 个隔离 HTTP fixture 任务。8 秒 MP4 原生播放得到 320×180 / readyState 4 并结束；两份 256,044 bytes、PCM16 mono 16 kHz WAV 实际播放至 8 秒 / ended，刷新后恢复。Agent 默认卡显示实际 ThinkSound 显式替代与“跟随视频”；请求重建后 input / parameters duration 为 8，provider wire 未传 duration。明确 5 秒冲突未提交，缺 Key / 缺路由禁用；恢复只 GET 原 ID，CDN 无 Authorization。

WAV 是固定 440 Hz 音调，不是模型拟音效果。本次证明正式控件、请求、媒体归档及原生播放 / 刷新链；无真实 Key 或供应商质量验收。[完整本批证据与截图](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)保留 fixture 和边界。
