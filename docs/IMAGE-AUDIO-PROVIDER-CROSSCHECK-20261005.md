# 图片与音频供应商契约交叉核查 · 2026-10-05

目前可直接配置供应商 Key 的图片链路是 OpenAI 生图/参考图、GPT Image 2 蒙版擦除/重绘/扩图、fal BiRefNet 抠图与 Topaz 2x/4x；音频链路是 OpenAI Speech、Eleven v3 TTS、Eleven Sound v2、Eleven Music、MiniMax Music 2.6。原生适配均是明确的功能子集，菜单型号或操作按钮的存在不代表全部能力已接通。后续新增的[受限多角度](FAL-MULTI-ANGLE-NATIVE-20261005.md)、[Music合同](elevenlabs-music-native.md)与[音频凭据字节保护](AUDIO-CREDENTIAL-BYTES-20261005.md)以专项记录为准。

本次修复普通 OpenAI 图片结果校验：仅有 PNG IHDR 文件头、缺少 IDAT/IEND、非规范 Base64 的响应不再由适配器返回 `succeeded`。已安装 SDK 的 generate/edit 两条路径均验证异常结果 `unknown`、一次 POST、无自动重试；异常字节也不再作为成功供应商结果进入持久记录。没有新增依赖、协议或供应商调用。

## 功能与原生覆盖

| 画布操作/型号 | 当前原生链路 | 请求与配置要点 | 边界/状态 |
| --- | --- | --- | --- |
| `image.generate` / 显式映射的图片别名 | `openai-native` → `/v1/images/generations` | 服务端 `{kind,model,sizeMap,qualityMap,maxCount}`；UI 比例/分辨率必须精确映射 | 不自动选择实际供应商型号；相机、全景、联网搜索等非等价参数拒绝 |
| `image.generate` / 图片参考 | 同协议 → `/v1/images/edits`，SDK multipart | 显式 `supportsImageReferences:true`、`maxImages` 1–16；PNG/JPEG/WebP 内联上传 | 这是参考图编辑，不能替代透明蒙版；prompt、图序、mode/count 校验；本地字节预算不是供应商效果保证 |
| `image.erase`、`image.redraw`、`image.outpaint` | `openai-masked-edit-native` → `/v1/images/edits` | 当前只允许 `gpt-image-2` / `gpt-image-2-2026-04-21`；每操作单独模型映射 | 最后一张透明主图上传为第一张；派生独立 PNG alpha mask；重绘最多一张额外参考；不缩放 mask |
| `image.remove-background` | `fal-native` → queue `fal-ai/birefnet` | 单图，PNG 输出，`output_mask:false`、`refine_foreground:true` | 使用图片输出，不能把 mask 当作品；未实现 fal Storage 自动上传 |
| `image.upscale` / Topaz | `fal-native` → queue `fal-ai/topaz/upscale/image` | `provider:'topazlabs'`；2x/4x；五项风格映射见下 | 6x 拒绝，不截断倍率或串联多次收费；不伪造返回尺寸 |
| `image.upscale` / Magnific、`image.skin` | 无原生适配 | 原参数可经有能力的 `tasks-v1` 网关传递 | fal Topaz 不等价于皮肤增强或 Magnific 滑杆；此项目未接通这些供应商原生协议 |
| `image.multiAngle` | 本批新增 fal Qwen 2511 原生替代 | 明确绑定 `image.multiAngle`；四参数按受限合同转换 | 不等价于原站私有转换；广角和低于 -30° 拒绝；[配置及证据](FAL-MULTI-ANGLE-NATIVE-20261005.md) |
| `image.relight` | 无原生适配 | 当前请求含标准光位、亮度、色温、轮廓光 | 本地打光预览不证明服务端模型支持；不能转成普通生图后宣称等效 |
| 图片全景生成提示、`panorama.edit` | 无原生适配 | `panorama.edit` 含源全景、相机、世界方向区域、2048×1024 equirectangular 合成要求 | OpenAI 普通图片适配明确拒绝全景标志；片场导出/全景浏览是本地功能，供应商全景编辑仍需网关实现 |
| `audio.generate` / OpenAI TTS | `openai-native` → SDK `/v1/audio/speech` | `{scene:'Text-to-Speech',model,defaultVoice/voiceMap,formatMap,defaultFormat,speedMap}` | WAV/MP3 子集；不能当作 Seed/Doubao 原生协议或声音等效；真实 Seed 声线 ID 须显式映射 |
| `audio.generate` / `eleven_v3` | `elevenlabs-native` → `/v1/text-to-speech/{voice_id}` | 默认实际 `eleven_v3`；真实音色目录 ID；`xi-api-key`；默认 `mp3_44100_128` | 当前 3000 字符、一次一个结果、稳定度 0/0.5/1；这是本地保守范围；克隆、字幕、额外速度参数未实现 |
| `audio.generate` / `eleven_sound_effect` | `elevenlabs-sound-native` → `/v1/sound-generation` | 实际 `eleven_text_to_sound_v2`；`loop`、`prompt_influence`；自动时长省略 `duration_seconds` | 0.5–30 秒或自动；固定 MP344100/128；TTS/Music 不走此接口 |
| `audio.generate` / `music-2.6` | `minimax-music-native` → `/v1/music_generation` | Bearer Key；`stream:false`、hex 输出；`audio_setting`、歌词/纯音乐模式 | prompt ≤2000、歌词 ≤3500；无 cover/音频参考、时长控制、字幕；账号必须具备该付费 API 资格 |
| `audio.generate` / `music_v1` | `elevenlabs-music-native` → `/v1/music` | 公开Compose/MP344100/128；普通与纯音乐prompt，自定义使用单节composition_plan | 节点自动或3–300秒；自定义须明确3–120秒、最多30行，每行200字符；真实账号/成曲待验 |
| Seed/Doubao TTS、Mureka、Sonilo | 无对应原生适配 | 现有 UI 合同可指向实际支持的 `tasks-v1` 网关 | 不因填写品牌 Key 就自动工作；不冒用其他供应商作为同型号实现 |

Topaz 风格对应官方输入 `model`：`general` → `Standard V2`、`low_resolution` → `Low Resolution V2`、`animation_3d` → `CGI`、`high_fidelity` → `High Fidelity V2`、`text_refine` → `Text Refine`。本次实时 API schema 仍包含这五项；官方新增型号/选项不自动成为本项目功能。

## 与官方资料对应的关键合同

**OpenAI 图片。** 官方指南目前主推 GPT Image 2.5 Sunburst/Flare，但仍明确保留 GPT Image 2。普通 `openai-native` 可由操作者明确映射实际型号；不代表所有型号与本地参数组合均已实测。专用蒙版适配维持已核实 GPT Image 2 型号，不自动升级。GPT Image 2 的动态尺寸要求两边为16倍数、最长边≤3840、长短比≤3、总像素655360–8294400；质量为 low/medium/high/auto。本地蒙版目标尺寸逐项核验，返回 PNG 必须匹配目标。GPT Image 2 的 `input_fidelity` 无需发送，本地没有随意加上该字段。

官方指南与 SDK 都确认 mask 作用于第一张输入图、alpha=0 表示编辑区域。指南 mask 章节写小于50MB，而官方 Node SDK multipart 字段仍写 mask PNG 小于4MB；本地采用更保守的 mask <4 MiB、图片 <50 MiB。GPT Image mask 是模型指导，不能承诺选区之外逐像素不变。普通图片结果的新校验检查完整 PNG 容器及规范 Base64，不是完整 PNG 解码或视觉验收；后续本地媒体归档与浏览器解码仍保留。

**fal 队列。** 官方 SDK `parseEndpointId` 和 queue 方法证实：提交完整 `/fal-ai/topaz/upscale/image`，status/result/cancel 使用 app 根 `/fal-ai/topaz/requests/{id}`；不是把 `/upscale/image` 再拼进恢复 URL。本地从已配置 origin/模型和任务 ID 构造带 Key 请求，不使用回执 convenience URL 作为凭据目的地。`COMPLETED` 要继续读取实际结果，存在 error 时不能算成功；取消请求被接受不证明已运行任务停止。BiRefNet/Topaz 支持公开 URL 或 data URI，本地不把私有资产标识直接送给模型。

**OpenAI Speech。** 官方 API 与已安装 SDK 为二进制响应，输入最多4096字符、speed0.25–4。指南列出13个内置音色；tts-1/tts-1-hd 使用官方九声线子集。本地只开放 WAV/MP3，`speech_rate` 百分比经显式等义 speedMap 转换。`sample_rate` 是 WAV 实际输出约束，不是向供应商设置采样率或本地重采样。非零音调/音量、字幕、stability、媒体参考、克隆声音均明确拒绝；UI切MP3时仍携带Seed sample_rate 的组合也明确拒绝。

**ElevenLabs。** 本次实时 OpenAPI 证实 TTS query output_format 包含 `mp3_44100_128` 和 `wav_24000`；PCM/WAV44100、MP3192等有套餐要求，不能从本地配置推定权限。本地v3稳定度三档为保守子集，不把共享 schema 连续范围直接当v3效果保证。Sound v2 官方字段允许 loop、duration0.5–30或省略、influence0–1；本地发送真实型号而不是TTS或Music型号，并逐帧检查MP3采样/码率。

**MiniMax。** 当前官方 Music 文档包含3.0、2.6、cover等型号；本地严格只接2.6。`lyrics_optimizer` 自动歌词、`is_instrumental` 纯音乐、自定义歌词保持模式语义；矛盾flag或残留歌词拒绝而非丢弃。官方公告写2026-08-20起付费Music/Lyrics APIs不再对新用户开放，已有付费用户可继续；免费music APIs将停用。只读文档不能证明账户实际资格，不应建议新Key必然可用。国内 `api.minimax.cn` 必须显式配置，不能依据错误或语言猜地区后再次POST。

## 可直接合并的服务端配置片段

以下是独立 shell 的 ENV 示例。已有图片/视频/Agent配置时，先合并 `GENERATION_PROVIDERS` 和 `GENERATION_ROUTES` 的 JSON条目；不要覆盖其他供应商路由。Key通过私有环境提供，不写入本文、画布、浏览器存储或请求。示例未设置任何Key值，不会因复制而调用供应商。

```sh
export GENERATION_PROVIDERS='{
  "images":{"protocol":"openai-native","apiKeyEnv":"OPENAI_API_KEY","modelMapEnv":"IMAGE_MODEL_MAP"},
  "erase":{"protocol":"openai-masked-edit-native","apiKeyEnv":"OPENAI_API_KEY","modelMapEnv":"MASK_ERASE_MAP"},
  "redraw":{"protocol":"openai-masked-edit-native","apiKeyEnv":"OPENAI_API_KEY","modelMapEnv":"MASK_REDRAW_MAP"},
  "outpaint":{"protocol":"openai-masked-edit-native","apiKeyEnv":"OPENAI_API_KEY","modelMapEnv":"MASK_OUTPAINT_MAP"},
  "fal":{"protocol":"fal-native","apiKeyEnv":"FAL_KEY","modelMapEnv":"FAL_MODEL_MAP"},
  "speech":{"protocol":"openai-native","apiKeyEnv":"OPENAI_API_KEY","modelMapEnv":"SPEECH_MODEL_MAP"},
  "eleven":{"protocol":"elevenlabs-native","apiKeyEnv":"ELEVENLABS_API_KEY"},
  "sound":{"protocol":"elevenlabs-sound-native","apiKeyEnv":"ELEVENLABS_API_KEY"},
  "music":{"protocol":"minimax-music-native","apiKeyEnv":"MINIMAX_MUSIC_API_KEY","baseUrl":"https://api.minimax.io"}
}'
export GENERATION_ROUTES='{
  "image.generate":{"models":{"gpt-image-2":"images"}},
  "image.erase":{"models":{"gpt-image-2":"erase"}},
  "image.redraw":{"models":{"gpt-image-2":"redraw"}},
  "image.outpaint":{"models":{"gpt-image-2":"outpaint"}},
  "image.remove-background":"fal",
  "image.upscale":{"models":{"image.upscale:topazlabs":"fal"}},
  "audio.generate":{"models":{"doubao-seed-audio-1-0":"speech","eleven_v3":"eleven","eleven_sound_effect":"sound","music-2.6":"music"}}
}'
export IMAGE_MODEL_MAP='{"gpt-image-2":{"kind":"image.generate","model":"gpt-image-2","sizeMap":{"auto|":"auto","1:1|1K":"1024x1024"},"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4,"supportsImageReferences":true,"maxImages":16}}'
export MASK_ERASE_MAP='{"gpt-image-2":{"kind":"image.erase","model":"gpt-image-2","allowDynamicSize":true,"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4}}'
export MASK_REDRAW_MAP='{"gpt-image-2":{"kind":"image.redraw","model":"gpt-image-2","allowDynamicSize":true,"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4}}'
export MASK_OUTPAINT_MAP='{"gpt-image-2":{"kind":"image.outpaint","model":"gpt-image-2","allowDynamicSize":true,"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4}}'
export FAL_MODEL_MAP='{"image.remove-background":{"kind":"image.remove-background","model":"fal-ai/birefnet"},"image.upscale:topazlabs":{"kind":"image.upscale","model":"fal-ai/topaz/upscale/image"}}'
export SPEECH_MODEL_MAP='{"doubao-seed-audio-1-0":{"kind":"audio.generate","scene":"Text-to-Speech","model":"gpt-4o-mini-tts","defaultVoice":"coral","formatMap":{"wav":"wav","mp3":"mp3"},"defaultFormat":"wav","speedMap":{"0":1},"defaultSpeed":1,"wavSampleRate":24000,"maxCount":1}}'
export VOICE_CATALOG_PROVIDER=elevenlabs
export ELEVENLABS_API_BASE_URL=https://api.elevenlabs.io
```

这个图片示例只映射auto与1:1/1K；其他画幅/分辨率须根据真实型号合同增加，不能把不同设置全部映射为方图。Speech示例是操作者选择OpenAI普通语音替代公开Seed别名，**不是Seed原生实现**。默认coral仅用于未指定声线的请求；选中的其他声线须配置准确 `voiceMap`，非零语速须增加等义 `speedMap`。若保留Seed供应商身份，应删除该替代路由并提供实际Seed网关实现。

Eleven和Sound使用各自已核实默认模型map，MiniMax Music使用默认2.6；显式空map不会启用默认。音色目录Key与生成Key的借用不自动发生；本例显式共用同一 `ELEVENLABS_API_KEY`。`.env.example`不会自动加载；以上ENV须进入启动服务的进程环境，变更后重启。操作员可只合并需要的供应商，不必配置全部。

**tasks-v1边界。** 浏览器“连接API”的会话配置使用任务网关合同：POST `/tasks`、GET/DELETE `/tasks/{id}`。该地址必须由操作者提供真正实现相应操作的网关，凭据是该网关的凭据；不是直接把OpenAI/fal/Eleven/MiniMax厂商Key填进去。`panorama.edit`、`image.relight`、皮肤/Magnific、Seed/Mureka/Sonilo及原生子集以外的多角度/Music若走网关，需验证请求所有参数、实际输出与恢复/取消语义。网关就绪不能证明具体供应商能力已完成。

## 证据来源与交叉判断

以下2026-10-05执行公开无凭据GET，未向生成endpoint提交任务。供应商文档是参数依据；官方SDK是实际HTTP路径/上传/响应例证；社区封装用于对照真实调用习惯，不能越过官方model-specific合同。`master/main`资料会变化，应在改型号时重新检查。

| 来源等级 | 链接 | 本次使用的证据 |
| --- | --- | --- |
| 官方 | [OpenAI Image guide](https://developers.openai.com/api/docs/guides/image-generation)、[Edit API](https://developers.openai.com/api/reference/resources/images/methods/edit) | 模型、mask图序/指导边界、GPT Image 2尺寸/质量 |
| 官方SDK | [OpenAI Node Images](https://raw.githubusercontent.com/openai/openai-node/master/src/resources/images.ts) | `images.generate/edit`、multipart、PNG默认、mask<4MB；已安装SDK注入fetch验证实际调用 |
| 官方 | [OpenAI TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech)、[Speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create) | 内置音色、二进制格式、文本/speed限制；本地已安装speech.d.ts交叉读 |
| 官方 | [fal BiRefNet](https://fal.ai/models/fal-ai/birefnet/api)、[Topaz](https://fal.ai/models/fal-ai/topaz/upscale/image/api) | 输入、输出、风格、PNG、倍率、官方默认值 |
| 官方SDK | [fal queue](https://raw.githubusercontent.com/fal-ai/fal-js/main/libs/client/src/queue.ts)、[endpoint parser](https://raw.githubusercontent.com/fal-ai/fal-js/main/libs/client/src/utils.ts)、[client README](https://raw.githubusercontent.com/fal-ai/fal-js/main/libs/client/README.md) | submit与app根路径恢复、cancel、公开上传/URL契约 |
| 官方 | [Eleven TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)、[Sound](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)、[实时OpenAPI](https://api.elevenlabs.io/openapi.json) | 实际voice ID、output_format枚举、套餐、Sound v2字段 |
| 官方SDK | [Eleven JS README](https://raw.githubusercontent.com/elevenlabs/elevenlabs-js/main/README.md)、[Sound client](https://raw.githubusercontent.com/elevenlabs/elevenlabs-js/main/src/api/resources/textToSoundEffects/client/Client.ts) | vendor-maintainedSDK用法与Sound实际路径/query |
| 官方 | [MiniMax Music API](https://platform.minimax.io/docs/api-reference/music-generation) | 2.6实际型号、模式、prompt/lyrics限制、hex/音频设置、账户政策 |
| 社区实现 | [LangChain JS OpenAI image tool](https://raw.githubusercontent.com/langchain-ai/langchainjs/main/libs/providers/langchain-openai/src/tools/dalle.ts) | 环境Key→官方SDK `images.generate`；该封装主要是DALL-E参数，不能当GPT Image 2 mask/2.5等价证据；其多次generate与浏览器Key选项不照搬 |
| 社区实现 | [LangChain Community Eleven speech tool](https://raw.githubusercontent.com/langchain-ai/langchain-community/main/libs/community/langchain_community/tools/eleven_labs/text2speech.py) | `client.text_to_speech.convert(text,model_id,voice_id,output_format='mp3_44100_128')`与二进制落文件；默认v2系列不是本地v3质量证明 |

## 本次检查与剩余验收

修改文件：`server/generation-openai.cjs`、`tests/generation-openai.test.cjs`；同时修正两项图片持久化测试的旧夹具：参考图durable成功测试添加真实本地媒体store/materializer，fal恢复测试添加确定的PNG下载与本地归档断言。此前分别缺少materializer、只mock供应商JSON却期待远程URL成功，均与现行媒体必须本地归档的合同不符。修正夹具没有放宽生产校验。

```sh
node --test tests/generation-openai.test.cjs tests/generation-openai-references.test.cjs \
  tests/generation-openai-masked-edit.test.cjs tests/generation-openai-speech.test.cjs \
  tests/generation-speech-integration.test.cjs tests/generation-elevenlabs.test.cjs \
  tests/generation-elevenlabs-sound.test.cjs tests/generation-minimax-music.test.cjs \
  tests/generation-fal.test.cjs tests/generation-fal-queue.test.cjs \
  tests/generation-fal-integration.test.cjs tests/generation-masked-sound-integration.test.cjs
node --check server/generation-openai.cjs
git diff --check
```

最终聚焦检查114项通过。新增实际SDK异常PNG回归在修复前失败，修复后generate/edit四类异常均拒绝且一次调用；durable异常结果没有 `providerResult/localization` 成功痕迹，重启后同幂等请求不重发。图片参考、蒙版、fal队列、语音/音效/音乐契约与真实本地素材归档检查同时通过。本文ENV片段另外经JSON解析、真实routing reader/router与合成Key验证，九个provider全部configured，禁止network dispatch。未执行全量、视频或Agent套件，也未本次重做浏览器验收。

所有响应来自明确本地fixture或注入transport，验证的是契约、字节、路由与恢复。未读取真实Key、未供应商计费、未实际生成图片或音频。仍需操作者在具备型号/voice/套餐资格的账号上验收图片内容、alpha边缘、Topaz文字/面部保真、蒙版遵循、TTS音质/语言/声线、音效循环、音乐模式及供应商返回文件的实际播放与保存。没有原生适配的功能需先实现供应商协议或明确有能力的网关，再逐项验收。
