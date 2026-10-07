# 火山 Ark 原生视频生成

`GENERATION_API_PROTOCOL=ark-native` 将 `video.generate` 接到 Ark 的异步视频任务 API。填入服务端 API 地址、Key 和真实模型能力映射后，文生视频、图生视频、首尾帧、全模态参考、Seedance 2.5 样片及正式片可以提交真实任务。本地契约回归已验证；没有使用真实 Key 调用模型，账号开通、配额、模型效果和可播放输出仍需真实供应商验收。

## 最小配置

服务端读取以下配置，浏览器不能选择供应商地址或提交凭据：

```dotenv
GENERATION_API_PROTOCOL=ark-native
GENERATION_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
GENERATION_API_KEY=由操作者在本机填写
GENERATION_MODEL_MAP={"seedance-2.0":{"kind":"video.generate","model":"doubao-seedance-2-0-260128","modes":{"TEXT_TO_VIDEO":{"ratios":["16:9"],"resolutions":["1080p"],"durations":[5],"audio":true},"REFERENCE_TO_VIDEO":{"ratios":["16:9"],"resolutions":["1080p"],"durations":[5],"audio":true,"maxImages":9}}}}
```

此最小示例只开放 Seedance 2.0 的 16:9、1080p、5 秒、声音开关和最多 9 张图片。UI 默认的「全能参考」会选择 `REFERENCE_TO_VIDEO`，即使没有图片；因此示例同时配置文生与参考方式。其他规格会在提交前明确报错，不会改成另一种规格。实际部署前核对账号已开通的物理模型 ID；也可将 `model` 填为操作者自己的推理接入点 ID。

原生 Ark 协议只支持视频生成。图片、文字、音频生成、视频解析、视频增强、蒙层编辑、3D 等操作需要对应原生适配或 `tasks-v1` 服务。

多供应商模式另支持显式 `videoUploadProvider:"fal"`：引用独立 fal Key，将本地实际 MP4 完整解码并发布至公网 HTTPS 后交给 Ark。没有这一配置仍拒绝本地视频；单供应商的上述最小配置不会启用上传。预算、配置和原任务恢复见[本地视频发布](ARK-LOCAL-VIDEO-PUBLICATION-20261008.md)，不能将 Ark Files 理解接口当作生成视频上传。

## 完整模型能力契约

映射的键是 UI 的稳定模型 ID，不是 Ark 的物理 ID：`seedance-2.0`、`seedance-2.0-mini`、`seedance-2.0-fast`、`seedance-2.5`、`seedance-2.5-draft`。每个条目必须包含 `kind: "video.generate"`、真实 `model` 与非空 `modes`。样片 UI ID 可映射到与普通 Seedance 2.5 相同的物理型号。

以下为一个完整的 **Seedance 2.5** 单条目示例。它需要放在 `GENERATION_MODEL_MAP` 的 `seedance-2.5` 键下；使用样片菜单时，将同一条目也配置到 `seedance-2.5-draft`：

```json
{
  "kind": "video.generate",
  "model": "doubao-seedance-2-5-260628",
  "supportsDraft": true,
  "supportsDraftTask": true,
  "mediaTransport": {
    "image": ["image/png", "image/jpeg", "image/webp"],
    "audio": ["audio/wav", "audio/mp3", "audio/mpeg"]
  },
  "modes": {
    "TEXT_TO_VIDEO": {
      "ratios": ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
      "resolutions": ["480p", "720p", "1080p"],
      "durations": [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      "audio": true
    },
    "IMAGE_TO_VIDEO": {
      "ratios": ["adaptive"],
      "resolutions": ["480p", "720p", "1080p"],
      "durations": [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      "audio": true
    },
    "START_END_TO_VIDEO": {
      "ratios": ["adaptive"],
      "resolutions": ["480p", "720p", "1080p"],
      "durations": [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      "audio": true
    },
    "REFERENCE_TO_VIDEO": {
      "ratios": ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
      "resolutions": ["480p", "720p", "1080p"],
      "durations": [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      "audio": true,
      "maxImages": 30,
      "maxVideos": 10,
      "maxAudios": 10,
      "videoDurationRange": {"min": 2, "max": 30, "totalMax": 30},
      "audioDurationRange": {"min": 2, "max": 30, "totalMax": 30},
      "omniReferenceTaskType": "reference"
    },
    "VIDEO_EDIT": {
      "ratios": ["adaptive"],
      "resolutions": ["480p", "720p", "1080p"],
      "durations": [-1],
      "audio": true,
      "maxImages": 30,
      "maxVideos": 1,
      "maxAudios": 10,
      "videoDurationRange": {"min": 4, "max": 30, "totalMax": 30},
      "audioDurationRange": {"min": 2, "max": 30, "totalMax": 30},
      "omniReferenceTaskType": "edit"
    }
  }
}
```

`ratios` 控制允许的画幅；没有配置时只允许省略画幅。`resolutions` 和 `durations` 必须显式列出。`audio: true` 开放生成声音开关。参考方式的 `maxImages/maxVideos/maxAudios` 不配置则视为 0；允许音视频输入时必须同时配置对应的单项及总时长范围。Seedance 2.0 系列的音频参考需要图片或视频，须配置 `audioRequiresCompanion: true`；2.5 可以只输入音频。

`omniReferenceTaskType` 可设为 `reference/edit/extend/auto`，直接映射为 Ark 的 `omni_reference_task_type`。视频编辑必须配置 `edit`，仅允许 `adaptive` 与 `duration=-1`。普通参考示例固定 `reference`，若实际提示词要求编辑/延长，供应商仍可能返回任务类型不匹配。延长工作流的独立操作尚未接入此适配；不要仅依据该字段存在宣称延长菜单已支持。

官方参数范围是上限；能力映射应按账号、物理模型版本和工作流收窄。SDK 中存在字段，不能证明任意模型支持该字段。当前适配没有自动从供应商发现账号权限，也不会自动替换型号。

## UI 到 Ark 请求

| UI 参数/输入 | Ark 字段 |
| --- | --- |
| `providerParameters.model` | 服务端映射条目的 `model` |
| `aspectRatio`、`resolution`、`duration` | `ratio`、`resolution`、`duration` |
| `generateAudio`、`draft` | `generate_audio`、`draft` |
| 文字提示词与文字参考 | `content: [{type:"text",text:...}]` |
| 图生输入 | `image_url`，`role:"first_frame"` |
| 有序首尾帧输入 | 第一张 `first_frame`，第二张 `last_frame` |
| 全模态参考 | `reference_image`、`reference_video`、`reference_audio` |
| `{{Image 1}}` / `{{Video 1}}` / `{{Audio 1}}` | `@image1` / `@video1` / `@audio1`；不存在的序号拒绝 |
| `draft_video_id` / `draftVideoId` | `content:[{type:"draft_task",draft_task:{id:...}}]` |

每个原生任务仅生成 1 个视频；`count/times/batch_count` 或结果占位数量不为 1 会在调用前拒绝，不会生成一条后声称整批完成。当前没有实现种子、搜索、回调、优先级、输出格式、自定义相机和其他额外供应商参数。UI 历史默认的 Sony Venice / Zeiss Ultra Prime / 24mm / ƒ/4 / high 仅是继承的非视频元数据；改变这些值会拒绝。布局、引用顺序和结果占位是本地画布元数据。

Seedance 2.5 首帧/首尾帧必须 `ratio=adaptive`。现有 UI 在这些方式下不显示画幅选项，但旧节点可能保留之前的 16:9；适配会拒绝该值。应让节点设置使用 `adaptive` 后提交，不能悄悄裁剪或忽略用户参数。

## 本地媒体和结果

当前浏览器传输保留公网 URL，将本地图片/音视频转为 data URI。适配器接受公网 HTTPS 图片、音视频 URL；不从服务端下载输入媒体。公网 URL 的格式、实际内容和供应商访问权限最终仍由供应商验证。

- 本地图片：默认支持 PNG/JPEG/WebP Base64；校验编码、格式头、图片尺寸 300–6000 像素、宽高比 0.4–2.5、单张小于 30 MiB。浏览器另行实际解码。官方还支持其他图片格式，此实现暂未提供它们的服务端校验。
- 本地音频：默认支持 WAV/MP3 的 Base64、格式头和小于 15 MiB；浏览器的 `audio/mpeg` 标签会规范化为官方文档要求的 `audio/mp3`，字节不变。需携带实际时长。格式头校验不等于完整音频解码。
- 本地视频：官方正文只列公网 URL/素材 ID，未列 Base64。此实现拒绝视频 data URI，要求先接入公网媒体上传；当前没有上传接口或 `asset://` 支持。
- `mediaTransport` 可收窄允许的本地图片/音频 MIME；空数组禁止该类型内联。完整请求上限为 64 MiB，不压缩、不截短。

成功输出必须来自真实的 `content.video_url`，且为不含凭据的公网 HTTPS URL。返回 `{type:"video",url,sourceFileId:<Ark任务ID>}`，供现有样片正式片链路引用。响应中的规格/整数时长不能代替实际解码，适配不编造输出尺寸、时长或缩略图。真实播放、下载、本地归档与恢复应用由现有前端链路处理。

## 提交、恢复和取消

创建只执行一次 `POST /contents/generations/tasks`，得到有效 `id` 立即返回本地持久任务服务。轮询/恢复只执行 `GET /contents/generations/tasks/{id}`。`queued/running` 保留等待状态；`succeeded` 需有真实结果；`failed/cancelled` 成为对应终态；`expired` 映射为失败。响应没有真实进度百分比，适配不伪造进度。

服务重启后，已保存供应商 ID 的任务可查原任务；丢失回执、网络超时、响应格式不明或 HTTP 失败保持 `unknown`，不自动重发 POST。每次 HTTP 操作上限 30 秒，响应 JSON 流上限 1 MiB，禁止跟随重定向，错误信息不转发供应商原始响应或 Key。非持久任务的 `generate()` 只 POST 一次，随后有界 GET 轮询，默认最多 30 分钟；超时保留未知状态及已有任务 ID。

本地取消停止等待并阻止迟到结果应用。此适配不调用供应商 DELETE，也不承诺供应商计算/计费已停止；`remoteCancellation:false`。取消后供应商仍可能完成任务。Ark 任务和样片任务 ID 保存 7 天；超过供应商保留期无法靠重新查询恢复。

样片需 `supportsDraft:true`，分辨率只能 480p；正式片需 `supportsDraftTask:true`，仅 1080p。正式片请求只发送相同模型、样片任务 ID 与 1080p，提示词/输入素材/声音/时长/画幅由 Ark 自动复用，禁止在正式片 wire 中重复传入。两步是独立任务、独立收费，现有 UI 的正式片确认与原图引用校验仍适用。

## 证据与验证

2026-10-03 读取以下官方公开正文和官方 SDK。没有调用真实模型：

- [创建视频生成任务 API](https://www.volcengine.com/docs/ark/create-video-generation-task-api)；正文可由[公开文档接口](https://www.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1520757)读取，含 Base64、媒体格式/限制、角色、物理模型规格及 `expired` 状态。
- [Seedance 2.5 教程](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh)；[公开正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryCode=ark&DocumentCode=seedance-2-5&lang=zh)，含样片正式片参数复用规则及物理模型 ID。
- [官方 Python Tasks SDK](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/resources/content_generation/tasks.py)；[输入类型](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/create_task_content_param.py)；[任务结果类型](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/content_generation_task.py)。创建回执字段是 `id`，任务结果字段是 `content.video_url`、`status`、`error.code/message` 等。
- [官方 Go 类型](https://github.com/volcengine/volcengine-go-sdk/blob/master/service/arkruntime/model/content_generation.go)交叉确认 `draft_task` 输入与上述结果字段。

```bash
node --test tests/generation-ark.test.cjs
```

此回归覆盖请求转换、内联图片/音频、严格能力限制、单次提交、异常响应、取消、中断恢复与样片任务标识。供应商效果验收必须另行用真实任务生成、播放和下载确认。
