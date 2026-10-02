# MiniMax H3 原生视频接入

本项目的 `minimax-native` 对接 **MiniMax H3 多模态视频**。H3 与 H3 Max 是不同视频型号；与 Tripo 3D 型号无关。无需另建任务网关。配置服务端 Key 和显式型号能力映射后，视频任务使用官方异步 API。Key 不发送到浏览器。

## 官方合同与型号

2026-10-03 核对的官方资料：

- [模型说明](https://platform.minimax.io/docs/guides/models-intro)
- [视频工作流及素材规格](https://platform.minimax.io/docs/guides/video-generation)
- [V2 创建任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)
- [V2 查询任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)
- [取消或删除任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-delete)
- [文件上传](https://platform.minimax.io/docs/api-reference/file-management-upload)
- [官方 H3 模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)

| API 型号 | 输出分辨率 | 整数时长 | 官方生成模式 |
| --- | --- | --- | --- |
| `MiniMax-H3` | `768P`、`2K` | 4–15 秒 | 文字、首帧/尾帧/首尾帧、图像/视频/音频参考 |
| `MiniMax-H3-Max` | `480P`、`768P` | 5–15 秒 | 同上；Max 另支持提示词扩展选项 |

当前产品目录保留捕获到的前端模式：H3 的四种模式；Max 的文字/图生模式。配置映射可缩小官方能力，不能扩大官方上限。展示别名必须映射到上述真实型号，不能用未核实的 Hailuo 名称代替。

## 服务端配置

单供应商环境配置：

```sh
GENERATION_API_PROTOCOL=minimax-native
GENERATION_API_BASE_URL=https://api.minimax.io
GENERATION_API_KEY=<只在服务端设置>
GENERATION_MODEL_MAP=<下面 JSON 压成一行>
```

`baseUrl` 是 HTTPS 源站，不添加 `/v2`；多供应商配置的 `protocol`、`baseUrl`、`apiKey`、`modelMap` 采用相同字段，模型路由别名与映射键一致。可保留其他供应商路由，参见 [多供应商配置](MULTI-PROVIDER-SETUP.md)。

完整 H3 映射示例：

```json
{
  "MiniMax-H3": {
    "kind": "video.generate",
    "model": "MiniMax-H3",
    "modes": {
      "TEXT_TO_VIDEO": {
        "ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        "resolutions": ["768P", "2K"],
        "durations": [4,5,6,7,8,9,10,11,12,13,14,15]
      },
      "IMAGE_TO_VIDEO": {
        "ratios": ["adaptive"],
        "resolutions": ["768P", "2K"],
        "durations": [4,5,6,7,8,9,10,11,12,13,14,15]
      },
      "START_END_TO_VIDEO": {
        "ratios": ["adaptive"],
        "resolutions": ["768P", "2K"],
        "durations": [4,5,6,7,8,9,10,11,12,13,14,15]
      },
      "REFERENCE_TO_VIDEO": {
        "ratios": ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        "resolutions": ["768P", "2K"],
        "durations": [4,5,6,7,8,9,10,11,12,13,14,15],
        "maxImages": 9,
        "maxVideos": 3,
        "maxAudios": 3,
        "maxMedia": 12,
        "videoDurationRange": {"min": 2, "max": 15, "totalMax": 15},
        "audioDurationRange": {"min": 2, "max": 15, "totalMax": 15}
      }
    }
  }
}
```

配置 Max 时，使用别名和真实型号 `MiniMax-H3-Max`，将各模式的分辨率改为 `["480P","768P"]`，时长改为 5–15。不能继承 H3 的 `2K` 或 4 秒配置。所有模式必须显式声明 `resolutions`、`durations`。文生模式还须声明具体 `ratios`；图生模式可以省略 `ratios` 或只声明 `adaptive`。

公开配置元数据仅暴露展示别名、模式规格及 MIME 能力，不暴露 Key、源站或映射中的真实型号字段：

```js
capabilities.models[alias] = {kind: 'video.generate'};
capabilities.video[alias] = {
  modes: /* 上述显式模式规格 */,
  supportsDraft: false,
  supportsDraftTask: false,
  maxCount: 1,
  maxMedia: 12,
  mediaTransport: {
    image: ['image/png','image/jpeg','image/webp','image/heic','image/heif'],
    video: ['video/mp4','video/quicktime'],
    audio: ['audio/wav','audio/mp3','audio/mpeg']
  }
};
```

可选的映射字段 `mediaTransport` 可进一步缩小各类 MIME 列表。浏览器预检应读取实际映射，不把未配置模式当成可用。

## 提交、素材与结果

原生提交只有一个生成 POST：`POST /v2/video_generation`，Bearer 认证，JSON 请求字段为 `model`、`content`、`resolution`、`duration` 及可选 `ratio`。成功回执的 `task_id` 保存为原任务身份，然后只用 `GET /v2/query/video_generation/{task_id}` 核对。`queued/running/succeeded/failed/cancelled` 是已核实状态；不凭进度猜测完成。

前端 `providerParameters.model/modelType/aspectRatio/resolution/duration/times` 映射到原生字段；重复的顶层规格必须一致。每个任务只生成一个视频。所有模式须带非空提示词，最多 7000 个字符。文本参考合并为一个文本项；`{{Image 1}}`、`{{Video 1}}`、`{{Audio 1}}` 依据输入序号转换成官方示例使用的自然语言 `reference image/video/audio 1`，缺失引用会在提交前失败。

首尾帧映射为 `first_frame/last_frame`，参考映射为 `reference_image/reference_video/reference_audio`。首尾帧与参考角色不能混合。未给角色的两帧依输入顺序分配；显式单尾帧角色可以保留。主体库的 `subject_reference` 是内部角色，提交时映射到所选模式的原生角色。

文生视频必须选择具体比例。图生视频画幅由图像决定，API 会忽略具体比例；本适配器直接拒绝这种会被忽略的比例，支持省略或 `adaptive`。参考模式可以使用具体比例或自适应。没有视频编辑、Seedance 样片、音轨开关、相机/镜头设备字段的创建 API 映射，不会把这些请求静默降级成参考生成。产品默认相机字段仅视为未改动的界面元数据；更改它们会失败。

输入支持公网 HTTPS、`mm_file://{file_id}` 和官方内联格式。适配器不会读取任意服务器文件路径。图像文件 ≤30 MiB，参考视频 ≤50 MiB，参考音频 ≤15 MiB；请求 ≤64 MiB。图像/视频尺寸 256–5760、比例 0.4–2.5。视频帧率 23.976–60；视频和音频每段 2–15 秒，各类总时长 ≤15 秒。混合参考最多 12 个媒体，独立上限图片 9、视频 3、音频 3。视频和音频须提供实际媒体时长，不能自动截短。

PNG/JPEG/WebP、MP4、WAV/MP3 使用内联数据；浏览器的 `audio/mpeg` 会规范成官方 `audio/mp3`。MOV 没有官方 data URI 格式，因此使用 `POST /v1/files/upload`，multipart 字段 `purpose=video_generation_input` 和 `file`；只在 `base_resp.status_code=0` 且 `file.file_id` 完整可验证时以 `mm_file://` 提交生成。不会猜测文件 ID、下载地址或自动重试上传。上传素材有效 7 天；HEIC/HEIF 的完整尺寸和编码验证由官方服务完成。其他格式只做有界包络/文件头检查和已知尺寸检查，最终解码与编解码器规格由供应商验证。

成功查询直接返回 `task.content.url`，本项目将它作为真实视频结果并保留原 task ID 来源。**H3 V2 无须走旧视频接口的 file_id 换下载地址流程。** 任务查询仅支持最近 7 天；结果 URL 有时效，须及时保存或重新查询。

## 失败、取消与验收范围

网络中断、非 2xx、响应超过 1 MiB、非法 JSON、缺失任务 ID、身份/状态漂移及成功却无结果，均保留为未知状态，不发第二次生成 POST。有已接受任务 ID 时可继续 GET 恢复。HTTP 与读取响应体共用 30 秒限时，生成轮询默认 10 秒，最长 30 分钟；取消本地等待不代表供应商已经取消。

官方 `DELETE /v2/video_generation/{task_id}` 会取消排队任务，也会**删除已成功/失败的记录**，且无法取消运行任务。没有可保证仅取消的原子条件接口，即使先 GET 排队状态也存在竞态。因此适配器不暴露 `cancel`，`remoteCancellation=false`，不会因本地停止而删除远端任务记录。

Max 的可选 `providerParameters.extra.prompt_expansion_mode` 只允许 `disabled/balanced/quality`；H3 不接受该选项。回调、H3-Context-IR 和 768P→2K 再生成是其他官方 API，未冒充为当前视频创建流程。

聚焦验证：

```sh
node --check server/generation-minimax.cjs
node --test tests/generation-minimax.test.cjs
```

当前通过 16 项 mock 契约测试；未调用真实收费 API，公开 `verified=local-contract-only`。真实 Key 权限、模型生成效果、供应商文件解码和真实结果保存仍需联调验证。
