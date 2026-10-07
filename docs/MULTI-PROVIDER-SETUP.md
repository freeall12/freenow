# 多供应商配置与验收

更新：2026-10-05。图片、视频、音频、文字、识别和分镜解析可以同时使用不同服务。此路由是本地实现，不代表已获得 TapNow 后端设计；未使用真实 Key 验收供应商。SPZ 本地显示另使用已获批准的 Spark 渲染器。

## 配置

根目录 `.env.example` 的末尾提供完整占位示例。复制到私有文件，填写实际 Key、地址、模型映射与目标模型真实支持的能力，然后启动：

```sh
node --env-file=.env.local server/server.cjs
```

本机端口默认为 4173。已有服务时先停止正确项目的进程；不要同时启动第二个实例。服务不会自动加载环境文件。Agent 对话仍单独使用 `OPENAI_API_KEY` / `OPENAI_MODEL` 等配置。

| 环境变量 | 内容 |
| --- | --- |
| `GENERATION_PROVIDERS` | JSON：供应商 ID → 配置 |
| `GENERATION_ROUTES` | JSON：准确操作 kind → 供应商 ID 或 `{default,models}` |

供应商配置允许 `protocol`、`apiKeyEnv`、`baseUrl` / `baseUrlEnv`、`modelMap` / `modelMapEnv`。Key 只允许通过环境变量名称引用；JSON 中的 `apiKey` 会使路由无效。地址和模型映射的内联值与环境引用不能同时提供。`modelMapEnv` 所引用的值同样为 JSON。协议支持 `openai-native`、`ark-native`、`ark-video-extend-reference`、`ark-video-reshoot-edit`、`fal-native`、`fal-video-native`、`fal-video-audio-native`、`fal-video-mask-native`、`fal-panorama-native`、`fal-video-depth-native`、`openai-panorama-edit-native`、`minimax-native`、`minimax-music-native`、`tripo-native`、`elevenlabs-native`、`elevenlabs-sound-native`、`elevenlabs-music-native`、`mureka-native`、`seed-audio-native`、`sonilo-native`、`openai-masked-edit-native`、`openai-relight-native`、`marble-native`、`magnific-native`、`skin-tasks-v1` 和 `tasks-v1`。fal 抠图和 Topaz 放大的可直接使用配置见 [fal 图片工具](FAL-NATIVE-SETUP.md)。

两项路由变量都未设置时，原单供应商配置保持不变。只设置一项、JSON 损坏或路由引用不存在的供应商时，整个路由禁用，不借用旧 Key。某个供应商缺 Key 或能力时只阻止选到它的功能，不影响其他已配置功能。Key 名称未设置等同该供应商未就绪。

```json
{
  "image.generate": "images",
  "video.analyze": "images",
  "video.generate": {"models": {"seedance-2.0": "video"}},
  "panorama.edit": "customTasks"
}
```

上例要求相应供应商真实存在并配置该操作。原生模型映射使用前端公开别名，值中的 `model` 才是运营者可用的真实型号。不能仅填 Key 就假定任意型号/参数均可用。MiniMax H3 视频与 Tripo 文字/单图生成 3D 已有独立原生适配；Marble 后端与预算内 SPZ 本地渲染已接通，Node/Agent 共用能力预检与素材应用链。SPZ 预览、片场、照片和短视频已通过真实本地样本，真实 Marble 生成仍待 Key 验收，详见 [Marble 配置](MARBLE-NATIVE-SETUP.md)。全景局部编辑与视频深度已有下述专用原生协议；皮肤仍需实际实现 `skin-tasks-v1` 的独立网关，其他未适配操作也不能由普通生图或视频 Key 自动启用。

默认路由仅在没有别名专属路由时生效，已经选定的供应商失败不会自动换供应商。已显式提供的 video `modelId` / `providerParameters.model` 与准备后的型号矛盾时拒绝请求，不得静默改路由。UI 目录外的自定义任务网关别名仍可使用。

### 视频深度与全景局部编辑

这两项分别使用独立 fal 与 OpenAI 配置。以下是精简配置示例；将两个供应商条目与操作路由**合并到已有 JSON**，保留其他 providers、routes 及模型专属路由，不要把整个变量覆盖为只含这两项的配置。私有环境文件中填写 `FAL_KEY` 与 `PANORAMA_OPENAI_API_KEY`；这些名称仅引用服务端 Key，不向浏览器返回。

```sh
GENERATION_PROVIDERS='{"depth":{"protocol":"fal-video-depth-native","apiKeyEnv":"FAL_KEY","modelMap":{"depth-anything-video":{"kind":"video.depth","model":"fal-ai/depth-anything-video"}}},"panoramaEdit":{"protocol":"openai-panorama-edit-native","apiKeyEnv":"PANORAMA_OPENAI_API_KEY","modelMap":{"panorama.edit":{"kind":"panorama.edit","model":"gpt-image-2","semantics":"perspective-mask-reproject","quality":"high","cropSize":"1024x1024"}}}}'
GENERATION_ROUTES='{"video.depth":"depth","panorama.edit":"panoramaEdit"}'
```

- **视频深度**支持普通视频节点的 Depth Anything Video 模型菜单，以及 Agent 的 `depth_video_prepare` / `depth_video_convert` 工作流。普通节点连接一个完整视频，提示词为空，规格自动，数量1/2；双结果需服务的持久目录，支持多变体/铺开/堆叠。单完整 MP4、32 MiB、偶数宽高且宽<=1920/高<=1080、恒定5–30 FPS、最多2400帧；本机须有FFmpeg/FFprobe。实际输出为无声音灰度视频，逐帧时间、尺寸、时长和帧数须保持；选段先物化，未支持的改尺寸、彩色、原始NPZ或额外设置提前拒绝。原任务身份保存后恢复仅GET，不重复提交。[后端合同](VIDEO-DEPTH-NATIVE-20261005.md) · [正式节点入口](VIDEO-DEPTH-NODE-ENTRY-20261005.md)。深度后的重演另需配置普通视频生成供应商。
- **全景局部编辑**从片场全景框选进入，使用显式独立 `perspective-mask-reproject` 实现。来源为完整不透明2048×1024 PNG（<=32 MiB），仅1–32个当前可见凸四角选区；无选区整图编辑拒绝。透视crop与蒙版以1024×1024编辑后回投，球面选区外RGBA像素精确保留；硬边可能有接缝，不承诺原站三图模型效果。同步OpenAI编辑没有远端任务ID或远端取消，unknown不重发；已有成功结果保存失败可只重试应用。[全景局部合同](OPENAI-PANORAMA-EDIT-NATIVE-20261005.md)。

两项运行不请求原站。公开合同、固定本机媒体和任务持久化验证不代表真实账号访问权、额度或模型效果；填Key后仍需相应供应商账号和所配型号资格，并独立验收深度准确性或全景蒙版遵循/接缝。

### Magnific 完整图片放大

将以下条目合并到已有配置，保留 Topaz 等其他别名；然后在私有环境文件填写 `MAGNIFIC_API_KEY`。原生 origin 已固定，不需要托管公网源图或搭建 TapNow 代理。

```sh
GENERATION_PROVIDERS='{"magnific":{"protocol":"magnific-native","apiKeyEnv":"MAGNIFIC_API_KEY","modelMap":{"image.upscale:magnific":{"kind":"image.upscale","model":"magnific-v2"}}}}'
GENERATION_ROUTES='{"image.upscale":{"models":{"image.upscale:magnific":"magnific"}}}'
```

正式面板和 Agent 共用四参数、原尺寸 PNG、原 UUID 查询及真实结果归档。界面倍率2–8，输出格式/尺寸按实际解码；JPEG/WebP 需已安装 FFmpeg/FFprobe。不存在远端取消接口，取消本机等待不等于停止供应商任务。[精确合同、预算与配置](MAGNIFIC-NATIVE-20261005.md) · [本机验收](LOCAL-MAGNIFIC-AGENT-20261005.md)。真实账号权限、收费和生成质量仍待 Key 验收。

### Mureka 与 Seed Audio

两项已有原生默认 origin 和精确模型映射。将以下条目**合并**到已有配置，不能覆盖其他功能路由；Key 填写在私有环境文件中对应的 `MUREKA_API_KEY`、`SEED_AUDIO_API_KEY`。Seed 使用语音新版控制台 Key，不是 Ark Key。

```sh
GENERATION_PROVIDERS='{"mureka":{"protocol":"mureka-native","apiKeyEnv":"MUREKA_API_KEY"},"seedAudio":{"protocol":"seed-audio-native","apiKeyEnv":"SEED_AUDIO_API_KEY"}}'
GENERATION_ROUTES='{"audio.generate":{"models":{"mureka-8":"mureka","mureka-o2":"mureka","doubao-seed-audio-1-0":"seedAudio"}}}'
```

Mureka 自动模式最多2000字符；自定义模式为1024字符提示词和1–5000字符歌词，单次一首。Seed支持WAV/MP3/Ogg Opus、1张图或最多3条音频参考与真实字幕文本；Ogg仅48000Hz，参考不能混用或带尚未物化的裁切选区。显式空 `modelMap:{}` 禁用该供应商，不使用默认替身。[Mureka完整合同](MUREKA-NATIVE-20261005.md) / [Seed完整合同](SEED-AUDIO-NATIVE-20261005.md)。

本机HTTP与正式节点已验证媒体归档/播放/刷新及缺配置零提交；实际供应商账号资格、型号访问权、声线和成曲质量仍需真实Key验收。

### Sonilo 原生音乐

使用独立 Sonilo 账号的 [API Key](https://platform.sonilo.com/dashboard/api-keys)，服务端仅引用变量名 `SONILO_API_KEY`。官方运行 origin 是 `https://api.sonilo.com`；不使用 TapNow Key、登录凭据或 fal Key。将以下 provider 和 `audio.generate.models.sonilo-music` 路由**合并到已有 JSON**，保留其他音乐、音效和语音映射；在私有环境文件中填写 `SONILO_API_KEY`，模板留空。

```sh
SONILO_API_KEY=
GENERATION_PROVIDERS='{"sonilo":{"protocol":"sonilo-native","apiKeyEnv":"SONILO_API_KEY","baseUrl":"https://api.sonilo.com","modelMap":{"sonilo-music":{"kind":"audio.generate","model":"sonilo-music"}}}}'
GENERATION_ROUTES='{"audio.generate":{"models":{"sonilo-music":"sonilo"}}}'
```

音乐支持本地 MP4 → Video-to-Music 和无视频 → Text-to-Music，5–360 秒、1–30 个真实分段边界、单次 1–10 个 WAV 变体。每个变体单独计费；数量和分段不会拆为多个 POST。本地视频在上传前校验、全解码，再以原字节 multipart 文件上传官方接口，不需要公网素材发布通道；需已安装的 FFmpeg / FFprobe，来源最多 50 MB。接受后持久保存原任务并查询恢复，没有公开远程取消或供应商幂等保证。

音频节点当前默认应用第一项结果；额外变体从画布左侧 **历史 → 音频** 查看，每个 output 索引可独立预览、播放和应用。没有声称节点内已有变体切换器。[原生合同与来源](SONILO-NATIVE-20261005.md) · [正式节点 / Agent QA](SONILO-NATIVE-UI-QA-20261005.md)。本机 fixture 不证明真实账号权限、音乐质量或与视觉事件的精确同步。

这是本批进一步读取 [Sonilo 完整公开 API](https://platform.sonilo.com/openapi.json) 后实现的 Music 能力。前批“没有找到独立 Sonilo API”仅描述当时已检查的 TapNow 使用文档 / 安装包来源。**Sonilo 原生 SFX 已另外接入**，需要显式 `sonilo-sfx` 型号绑定和 `Sound` 路由；Music 映射不会自动启用它。文字/完整视频、连续音效分段及精确配置见[SFX 原生合同](SONILO-SFX-NATIVE-20261005.md)，测试与实机边界见[SFX UI 记录](SONILO-SFX-UI-QA-20261005.md)。stems、语音保留和 ducking 仍未接入。下面的 ThinkSound 配置是另一种显式 SFX 替代，同一别名应选择一个实际路由，不同时绑定两家。

### 可选 ThinkSound 视频拟音与延长镜头

可选的视频拟音使用独立 fal Key，显式把画布 `sonilo-sfx` 别名绑定到 ThinkSound；界面说明真实执行模型，不声称执行 Sonilo 原生 SFX。它与上面的 `sonilo-native` 音乐路由使用不同 Key / 协议。以下条目须合并到已有路由，保留其他模型：

```sh
GENERATION_PROVIDERS='{"videoSound":{"protocol":"fal-video-audio-native","apiKeyEnv":"FAL_KEY","modelMapEnv":"VIDEO_AUDIO_MODEL_MAP"}}'
GENERATION_ROUTES='{"audio.generate":{"models":{"sonilo-sfx":"videoSound"}}}'
VIDEO_AUDIO_MODEL_MAP='{"sonilo-sfx":{"kind":"audio.generate","model":"fal-ai/thinksound/audio","semantics":"explicit-native-alternative"}}'
```

在私有环境文件填写 `FAL_KEY`。支持一个完整MP4，提示词可空；WAV时长必须与源视频一致，Agent默认时长会跟随视频，用户明确时长发生冲突则提交前拒绝。分段、音乐、循环等不支持项不忽略。[视频拟音合同](VIDEO-AUDIO-NATIVE-20261005.md)

延长镜头使用 `ark-video-extend-reference`，`video.extend.models.seedance-2.5` 路由、`ARK_API_KEY` 以及 `capabilityMode:prompt_simulation` 的精确映射；完整profile示例见 [`.env.example`](../.env.example)。源视频的分辨率和声音按能力预检，显式参数不静默降级。方向、4–30秒和四类连续性使用官方工具栏参考生成语义，效果仍需真实模型确认。

**Ark 本地视频还需要公网素材发布通道，单填 Key 不足。** 当前前端在读取本地视频或裁片前即禁用提交；公开 Files API 的 ID不能替代视频生成需要的URL/Asset ID。[延长镜头合同](VIDEO-EXTEND-NATIVE-20261005.md) · [本地传输调查](ARK-LOCAL-VIDEO-TRANSPORT-20261005.md)

两组示例已由生产配置读取器及路由执行零网络dry-run；本机HTTP媒体验收见[本批记录](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)。不代表真实供应商Key、账号资格或模型质量已验。

## 图片重新打光

`openai-relight-native` 将完整26光位、三档亮度、六档色温和轮廓光参数编译为一次 GPT Image 2 编辑。须明确选择 `semantics:"parameter-prompt-edit"`；这是独立参数编辑，不保证物理精确照明或原站模型的视觉效果。

```sh
GENERATION_PROVIDERS='{"relight":{"protocol":"openai-relight-native","apiKeyEnv":"OPENAI_API_KEY","modelMap":{"image.relight":{"kind":"image.relight","model":"gpt-image-2","semantics":"parameter-prompt-edit","quality":"high","outputSize":"auto"}}}}'
GENERATION_ROUTES='{"image.relight":"relight"}'
```

合并到已有 JSON，并在私有环境文件填写 `OPENAI_API_KEY`。此操作没有模型菜单，按 `image.relight` 唯一映射路由。来源按真实尺寸解码，必要时转为 PNG，不为匹配输出尺寸裁切或缩小；结果记录供应商实际尺寸。Agent 和工具栏使用同一媒体准备与服务端协议。仅有 Key 仍须具备所配型号访问权；真实打光质量待验。[输入、限制与失败合同](OPENAI-RELIGHT-NATIVE.md)

## 皮肤编辑专用网关

新增专用协议 `skin-tasks-v1`，只接 `image.skin`，不需要 `modelMap`。将下列条目合并到已有 JSON，配置自己实际实现合同的服务；这里的 Key 是该网关的 Key，不能直接使用 Enhancor Key。

```sh
SKIN_GATEWAY_URL=https://your-skin-gateway.example/api
SKIN_GATEWAY_KEY=replace-with-your-gateway-key
GENERATION_PROVIDERS='{"skin":{"protocol":"skin-tasks-v1","baseUrlEnv":"SKIN_GATEWAY_URL","apiKeyEnv":"SKIN_GATEWAY_KEY"}}'
GENERATION_ROUTES='{"image.skin":"skin"}'
```

三档为 `detailed/standard/heavy`，空提示词、单张完整原尺寸 PNG 输入及单结果。支持的模式必须明确声明；普通 `tasks-v1` 不默认启用皮肤菜单。PNG 上限32 MiB/32×1024×1024像素，结果须完整解码后本机归档；unknown只查询原任务，保存失败只重试应用。合法任务ID在结果验证前持久化，因此首回执坏PNG不会丢失后续查询身份。

Enhancor 公开协议仍要求公网 `img_url` 与 `webhookUrl`，原三档的精确参数换算未证实。供应商上传、回调、参数解释和实际皮肤效果须由该网关实现并独立验收；本机合同测试不替代它们。[完整网关合同](SKIN-EDITOR-PROVIDER-20261005.md) · [原生缺口](SKIN-EDITOR-NATIVE-CONTRACT-20261005.md) · [实机证据](LOCAL-SKIN-AGENT-20261005.md)

## 恢复、凭据和界面

视频物体移除／替换使用独立 `fal-video-mask-native` 协议，将 `video.erase` 和 `video.replace` 各自唯一映射到 `fal-ai/wan-vace-14b/inpainting` 并声明 `semantics:"explicit-native-alternative"`。这两个专用操作没有模型菜单，按 kind 路由；不借用来源节点的普通视频模型标签。配置示例及媒体预算见 [Wan VACE 接入](WAN-VACE-VIDEO-MASK-NATIVE-20261005.md)。已有完整时序蒙层时，来源片段、黑白蒙层视频及替换参考会真实上传到 fal CDN。

首次识别目标独立配置 `VIDEO_SEGMENTATION_PROTOCOL`：`segment-video` 使用自定义分割地址；`replicate-sam2-native` 使用固定Replicate SAM2版本和单独的 `REPLICATE_API_TOKEN`，最多两次推理，需FFmpeg并受媒体预算限制。两者均有明确本机接口，不由通用生成模型路由暗中切换。Fal Key不能代替Replicate Token；配置成功不表示真实模型效果已验证。[分割配置与恢复](VIDEO-SEGMENTATION-SETUP.md)。

- 浏览器只收到功能、公开别名和配置状态；不返回 Key、端点或真实模型 ID。任务在读取媒体前按操作和别名检查配置。
- 配置弹窗显示每个操作/供应商是否就绪；整体存在可用图片服务并不表示视频服务可用。
- 异步任务持久保存原供应商身份；修改路由表不改变旧任务的目的地。修改原供应商地址/模型映射后阻止查询及取消，恢复原配置才能继续核对。
- Key 轮换不会改变任务身份。unknown 提交不重发；没有远端任务 ID 的同步 OpenAI（含蒙版编辑、打光和全景局部编辑）、ElevenLabs TTS/Sound/Music、MiniMax Music 和 Seed Audio 任务只能查询本地证据。Mureka 保存原任务ID并仅查询该任务，远端取消未实现。
- Ark 原始 `sourceFileId` 保留，样片续生成仍使用原供应商任务 ID。远端取消仍依据具体协议，不能宣称 Ark 已停算。

型号与配置：[MiniMax H3 视频](MINIMAX-H3-SETUP.md)、[Tripo 3D](TRIPO-NATIVE-SETUP.md)。两个 H3 名称属于不同供应商和媒体类型，不能共用模型映射。

详细契约：[路由 API](generation-routing-contract.md)、[Ark 限制](ARK-VIDEO.md)、[OpenAI 图片参考](OPENAI-IMAGE-REFERENCES.md)、[原生分镜解析](OPENAI-VIDEO-ANALYSIS.md)。

当前逐项状态见[官方交叉核验与 Key 接入清单](OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md)；多角度新增显式受限 [Qwen 2511 原生替代](FAL-MULTI-ANGLE-NATIVE-20261005.md)，不等价于原站私有转换。

新增原生配置：[MiniMax Music 2.6](MINIMAX-MUSIC-NATIVE.md)、[fal 视频超分](FAL-VIDEO-NATIVE-SETUP.md)、[ElevenLabs TTS](ELEVENLABS-NATIVE-TTS.md)、[ElevenLabs 音效](ELEVENLABS-NATIVE-SOUND.md)、[ElevenLabs Music](elevenlabs-music-native.md)、[OpenAI 蒙版编辑](OPENAI-MASKED-EDIT-NATIVE.md)、[Marble](MARBLE-NATIVE-SETUP.md)。MiniMax Music API 仅对既有合资格付费用户开放，不能由 Key 存在推定访问权。视频超分的参数边界以适配器文档为准。

## 历史验收（最初路由批次）

- 全量 `npm test`：1493/1493 通过；`npm run check`：475 个 JavaScript 模块通过。
- 独立交叉审查及 51 项专项复验通过。真实网关测试混合 OpenAI 图片、Ark 视频与 tasks-v1，确认各用自己的地址/Key；缺路由/缺 Key/矛盾型号零派发，重启继续原任务，改地址不泄露任务 ID。
- 供应商调用全部使用替身；没有真实计费调用。不能据此确认真实账号权限、模型质量、供应商取消或媒体播放质量。

浏览器复现：

```sh
node scripts/build-provider-routing-fixture.cjs
# 打开 http://localhost:4173/qa/provider-routing-app.html?session=独立验收标识
```

入口使用公开空白种子，独立 localStorage/IndexedDB 命名空间，未知 API 和跨域 fetch 均禁止。计数中的 `blocked` 表示被夹具阻止的其他请求，不表示实际外部派发。

实际 Computer Use 顺序：检查分镜解析可用性 → 尝试未配置视频 → 生成固定测试图片 → 查看服务配置 → Escape。观察到 `availability.configured:false`，视频 `configuration_required`，`mediaReads:0`，图片 `posts:1`、`applied:1`、`succeeded`。图片是固定有效 PNG，用于结果解码和应用回调验收，未测试生图质量。配置弹窗分别显示图片就绪、视频/分镜待配置。Escape 关闭后焦点回到调用按钮。

截图 `/tmp/freenow-provider-routing-20261003.png` 留在开发机，公开仓库不依赖此文件。整体官方界面、所有功能组合和真实供应商仍未完成全量验收。
