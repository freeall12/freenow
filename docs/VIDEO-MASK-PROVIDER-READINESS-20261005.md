# 视频移除 / 替换供应商就绪核对 · 2026-10-05

后续实现状态：本文保留开发前的研究结论。现已实现 [Wan VACE 适配、路由和配置](WAN-VACE-VIDEO-MASK-NATIVE-20261005.md)、[真实媒体准备](VIDEO-MASK-MEDIA-PREPARATION-20261005.md)、[CDN 上传](FAL-CDN-UPLOAD-20261005.md)及[准备恢复](VIDEO-MASK-DURABLE-RECOVERY-20261005.md)。下文“尚未实现”描述的是本研究完成时；新视频首次识别所需的[分割服务合同缺口](VIDEO-SEGMENTATION-FAL-CONTRACT-20261005.md)仍开放。

**建议下一步实现独立的 Wan VACE 遮罩编辑 adapter，显式绑定 `fal-ai/wan-vace-14b/inpainting`。** 公开合同同时包含来源视频、时序遮罩视频和参考图片，可承接 `video.erase` 与 `video.replace` 的主要输入。它是明确的独立供应商替代，不是 TapNow 私有 `tapnow-video-edit` 的同型号实现，也未证明生成效果等同。第二候选 LTX 2.3 能消费时序遮罩，但没有替换图片字段，不能承接当前图片替换操作。

当前仅完成只读核对和本记录；尚未实现 adapter、遮罩封装、上传或路由。填 Key 仍不能使当前两个操作直接可用。首次识别目标还依赖独立分割服务，这个前置缺口也必须计入端到端验收。

## 实际核对范围

- checkout：`/Users/laplace/Documents/Codex/2026-09-22/new-chat/outputs/canvas-replica`，开始时 `main@62ec1ae`。
- 官方安装包：`/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js`，SHA256 `8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86`。
- 本地：`src/features/video-mask/{core,ui,segmentation}.mjs`、`server/video-segmentation.cjs` 的合同说明、`server/generation-router.cjs`、`server/generation-fal-queue.cjs` 与现有媒体处理模块。
- 公开无凭据 GET：fal 模型目录、下面两个模型的 `llms.txt` / OpenAPI、官方 fal JS queue/storage 源码、VACE 上游源码。不读私有抓包、`.env` 或 Key；没有付费调用、浏览器操作或全套测试。
- 初始猜测的 `fal-ai/bria/video/erase` 与 `fal-ai/video-inpainting` 没有取得真实 schema；普通网页壳的 HTTP 200 不作为接口存在的证据。随后从 [fal sitemap](https://fal.ai/sitemap.xml) 找到并读取两个真实 endpoint。

## 官方与本地语义

安装包 `Hq` 明确向原私有生成服务提交：`provider:"tamar"`、`model:"tapnow-video-edit"`、`scene:"generation"`、`times:1`、`source_video_url`、`rle_url`、`action`；替换时另有 `target_image_url`。`additional_parameters` 是原产品的批次/布局元数据，不能冒充公开供应商字段。估价函数 `qfe` 使用 `720p`、`adaptive`、`duration:-1`。结果创建连接到原视频的新节点，原片保留。

官方目标识别使用所画矩形的中心像素、当前帧 `frameIndex`、`label:1`，返回 `rleUrl`；`Bfe` 读取逐帧 RLE，按 `round(time * fps)` 取帧，把每对 start/length 写入扁平像素数组。它不是一个静态矩形遮罩，也不是仅靠自然语言指定区域。

本地 `core.mjs` 对应如下：

| 本地对象 | 已有语义 | 公开 adapter 必须保留 |
| --- | --- | --- |
| `video.segment` | 完整来源 `sourceVideoUrl`、实际宽高/时长、当前秒数、矩形及中心点 | 识别与生成是两个阶段，不把识别成功称为视频编辑完成 |
| `parameters.mask` | `rle-zero-based-row-major`，width/height/fps/frames；允许个别空帧，但整体须有目标；尺寸与全源时长匹配 | 全时序、位置、帧率与极性；不能只取首帧或把 rectangle 当 mask |
| `parameters.sourceClip` | `node.clip`，start/end 是原来源时间轴；UI 播放范围受其限制 | 原视频与遮罩必须共同裁选段并从 0 重计时；不能发送完整来源替代选段 |
| `video.erase` | 一项 `source_video`，`action:"remove"`，prompt 为空 | 真实遮罩擦除；不发送无关参考图片 |
| `video.replace` | 来源视频加一项 `replacement_image`，`action:"replace"`，prompt 为空 | 图片实际进入模型；不能把其 URL 写进提示词代替图像输入 |
| 固定参数 | adaptive、720p、candidateCount:1 | 仅在实际 schema 有等价字段时映射；不靠默认值猜测 |

`ui.mjs` 目前只把本地输入转成实际 data URI；没有把 RLE 编成视频，也没有为这个操作共同裁切 source/mask。保存的 `videoMask` 绑定来源、clip 字符串、asset 和识别时间，来源/选区变化会失效；新准备阶段与任务恢复必须继续使用这些守卫。

## 两个公开合同

| 项目 | Wan VACE 14B inpainting（优先） | LTX 2.3 Quality inpaint（仅擦除候选） |
| --- | --- | --- |
| 真实 model ID | `fal-ai/wan-vace-14b/inpainting` | `fal-ai/ltx-2.3-quality/inpaint` |
| 必需字段 | OpenAPI required 为 prompt/video_url；mask_video_url 描述明确“Required for inpainting”，本地应额外强制 | prompt/video_url/mask_video_url 三项 required |
| 时序 mask | `mask_video_url`；另有静态 mask_image_url，若视频遮罩存在则忽略静态图 | `mask_video_url`；明确白色区域重生成、黑色区域保留 |
| 替换图片 | `ref_image_urls:string[]`，可显式发送一张实际替换图 | **没有图片参考输入**；不允许把本地 replacement_image 静默丢弃 |
| 输出规格 | resolution 包括720p；aspect_ratio auto；可 match 输入帧数和fps | 没有 resolution/aspect_ratio 输入；num_frames 9–481、fps 1–60 |
| 默认时序风险 | 默认81帧/16fps，默认不匹配输入 | 默认121帧/24fps；不等于原视频时序 |
| 音频 | 当前 schema 没有来源音轨保留开关 | generate_audio 仅表示输出是否含音频，未证明保留原音轨 |
| 成品 | `video:VideoFile`，URL 必需；尺寸/帧数/fps/时长是可选元数据 | `video:File`，URL 必需；不能从通用 File 的 image/png 示例推断实际视频 MIME |

官方证据：

1. [Wan llms/schema](https://fal.ai/models/fal-ai/wan-vace-14b/inpainting/llms.txt)、[Wan OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/wan-vace-14b/inpainting)，本次 OpenAPI SHA256 `6ebd6be5b8f9645f75db07ceee1b2d97f1cd7b9e4a1b1a3cee1c69d686e3362a`。
2. [LTX llms/schema](https://fal.ai/models/fal-ai/ltx-2.3-quality/inpaint/llms.txt)、[LTX OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3-quality/inpaint)，SHA256 `88b05ffc03fbaceeac0e31699453f75af78c650e583bc77b6e08cde89654d2ae`。
3. [VACE 上游 README](https://github.com/ali-vilab/VACE/blob/main/README.md)、[Wan 源码](https://github.com/ali-vilab/VACE/blob/main/vace/models/wan/wan_vace.py)：prepare_source 共同加载来源视频和 mask，灰度归一为0–1；encode_frames 对 mask >0.5 二值化，并以 `frame*(1-mask)` 构造保留区域。白/1 是编辑区域，黑/0 是保留区域。该源码仅交叉证明模型语义，不能替代 fal 部署实现；本次源码 SHA256 `13e21d1df81fd78f962d54e4f3ddfa789e50bffc152446d27d405c62511a70f9`。

Wan `num_frames` 的机器字段 minimum17 与文字“81–241”冲突。初版应保守只接81–241帧且实际fps在5–30内的来源，并显示实际可用范围。match_input 不是无限长视频授权。更长、更短、变帧率或需重采样的视频应要求用户明确准备后再提交，不能截断、补尾帧、循环、改速后声称保留原时段。官方 schema 未声明来源总字节/时长与额外帧数对齐限制，不能自行宣传未证实范围；真实账号调用仍需确认部署端约束。

## 可实施的最小 Wan 合同

建议独立协议名 `fal-video-mask-native`；运营者显式映射 `video.erase` 与 `video.replace` 到上述同一实际 endpoint，并分别声明两种能力。不能把它挂到普通 video.generate 的宽路由后丢弃 mask。本地没有显式 model 的专用请求须按 kind 唯一匹配；不要借用未公开的 `tapnow-video-edit` 或原节点 Seedance 标签。

`prepare` 只做纯校验，不上传、不计费：严格检查 action/kind、一个source_video、替换时恰好一个replacement_image、sourceClip、全源mask、输出规格与候选数；未知参数、矩形假mask、零目标、失配尺寸/时序、显式来源范围矛盾都拒绝。请求中的字段不能提供下载凭据、供应商origin或FFmpeg参数。

后续媒体准备必须完成：

1. 读取实际来源字节并用现有受限FFprobe/FFmpeg方式取得宽高、时长、PTS/fps；不信 caller 的元数据。验证 mask 覆盖完整来源时间轴。所有网络素材使用现有独立来源、DNS/peer、无redirect、字节预算策略。
2. 有clip时实际裁出 `[start,end)` 视频；同时按同一输出PTS取 `frameAt(mask, start + outputTime)` 对应的mask，重新从0计时。来源和mask必须有相同帧数、fps、尺寸、时长与首帧时间；只裁来源或只slice RLE不够。原sourceRange保留为provenance，消费后不能留下一个仍会被忽略的sourceClip。
3. 将每帧目标RLE写成白255、其余黑0的灰度/黑白视频；不能上传UI蓝色半透明overlay、JSON RLE或静态首帧。采用受控MP4封装并解码复核极性、移动目标与边界；几何变换须对source/mask一致，mask重采样用nearest，不能独自拉伸或模糊选区。
4. 本地asset/blob/data URI不能直接充当公网URL。按[官方 CDN 合同](https://fal.ai/docs/documentation/model-apis/fal-cdn.md)上传实际来源片段、mask MP4、替换图。两模型schema没有独立证实大视频data URI的可用性；初版不要默认它可替代上传。
5. 仅媒体全部确认后发送一个生成POST。上传失败留在media preparation状态；回执丢失不自动重复生成。上传/媒体准备也要保留明确阶段与已取得文件身份，不能把重启当作隐式重新发布私人素材的许可。

fal 官方 [storage.ts](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/storage.ts) 与 [config.ts](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/config.ts) 给出单次上传真实协议，可按现有Node fetch实现，**无需为本任务先安装SDK**：

```text
POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3
Authorization: Key <server-only-key>
JSON: {content_type:"video/mp4",file_name:"source.mp4"}
→ {upload_url, file_url}
PUT upload_url: actual bytes; Content-Type only, no fal API Key
→ 确认成功后才使用 file_url
```

返回的签名upload_url和file_url仍须检查HTTPS、公网、独立来源及凭据回显；原样Key只发固定的认证origin，不发任意回执URL。初版设有界文件预算、受控并发/超时，拒绝超限而不自动转成multipart。SDK源码本次 SHA256 `789bc247006fe3093c5c5f7127e77f1c94199ca7a80e1f0c0861640301c66ccc`；其中multipart自动处理和重试不是本地已实现能力。

生成请求示例（替换）；移除省略ref_image_urls并换成明确擦除指令：

```json
{
  "prompt": "Replace the masked object with the subject in the reference image, preserving the surrounding scene and motion.",
  "video_url": "https://independent-cdn.example/prepared-source.mp4",
  "mask_video_url": "https://independent-cdn.example/prepared-mask.mp4",
  "ref_image_urls": ["https://independent-cdn.example/replacement.png"],
  "resolution": "720p",
  "aspect_ratio": "auto",
  "match_input_num_frames": true,
  "match_input_frames_per_second": true,
  "enable_prompt_expansion": false,
  "enable_auto_downsample": false,
  "temporal_downsample_factor": 0,
  "num_interpolated_frames": 0,
  "preprocess": false,
  "enable_safety_checker": true,
  "sync_mode": false
}
```

上述prompt是待实现的动作说明模板，非供应商原生remove/replace枚举。当前UI没有提示词输入，初版必须明确展示这一映射或提供可编辑描述；不得伪造图片内容说明，也不能宣传文字指令保证身份一致。固定指令可要求擦除/参考图替换，但实际效果仍待验。移除可使用 `Remove the masked object and reconstruct the background, preserving the unmasked scene and motion.`。

## 队列、结果与完成条件

- `POST https://queue.fal.run/fal-ai/wan-vace-14b/inpainting`，认证 `Authorization: Key`，先持久化request_id与完整model/origin身份。
- 按[官方 queue SDK](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/queue.ts)及已有 `generation-fal-queue.cjs`：原任务status/result使用owner/alias基础路径 `.../fal-ai/wan-vace-14b/requests/{id}`，status加`/status?logs=0`；不把model尾部inpainting重复拼进恢复路径，不使用回执任意URL发送Key。COMPLETED之后才取结果。
- unknown保持原ID查询；没有ID的丢失POST不补发。取消回执CANCELLATION_REQUESTED只证明请求已收，不承诺执行停止或退款。配置改变、Key轮换、素材变化仍沿用现有身份/指纹和应用守卫。
- 结果只接受真实`video.url`，安全下载完整bytes、容器校验、凭据字节扫描、本地媒体store归档后再公开成功。实际解码取得尺寸/fps/帧数/时长，与准备片段核对；缺失或矛盾不能用provider metadata、PNG通用示例或原视频代替。
- 若要保留原声音，应明确采用本地原选段音轨remux，且只有实际输出时序一致时才合成；Wan不提供声音保留保证，LTX的generate_audio也不是复制原音轨。不能无提示丢音轨或替换为新配音。
- 新结果创建连线节点、原片和mask保存状态保持；迟到结果不能覆盖已变化的来源、clip或替换图。

初版验收至少包含：移动目标的黑白时序mask与原PTS一致；非零start的sourceClip共同裁切；真实source/mask/ref三文件无Key上传与exact生成字段；只一次生成POST；错任务/回显/下载失败重启仅原GET恢复；完整真实MP4归档；帧率/时长不匹配和超范围零dispatch；无参考图的replace零dispatch；浏览器实际播放、听音及真实供应商视觉效果分别记录。模拟fixture通过只能证明合同与本地恢复，不证明模型按mask保留每个非目标像素。

## “填 Key 独立工作”的剩余范围

当前识别仍按 `VIDEO_SEGMENTATION_API_BASE_URL` + `/segment-video` 自定义合同工作，需要可部署且支持真实全视频分割的服务。Wan的mask_image_url自动跟踪不能替代本地已编辑、已持久化的完整RLE，也不能偷偷绕过识别阶段；LTX没有这一输入。此轮遵守仅查两条匹配生成接口的范围，没有确认现成分割供应商API。

因此最小可审阅实现应先完成：专用adapter、共同媒体准备、原生上传、持久队列与本地结果归档，再补真实分割服务的独立Key接入。只有识别→mask→编辑→归档→播放全部验收后，才可以声称从新导入本地视频开始的独立可用闭环。若先交付编辑阶段，应明确要求已有合法mask/分割服务。

本次只新增本文件；未修改实现、共享配置或README，未提交。两个公开OpenAPI和官方bundle重新GET/读取，示例字段按真实schema核对；未跑全套或付费生成，模型质量、账号资格、上传可用性与效果均未验。
