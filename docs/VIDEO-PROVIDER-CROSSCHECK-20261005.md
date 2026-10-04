# 视频供应商合同复核 · 2026-10-05

本次检查的是当前本地实现的请求合同、轮询、恢复和归档。公开官方资料与社区源代码已实际读取，定向回归 **72/72 通过**；没有调用真实付费模型，没有读取真实 Key。账号权限、收费、服务端对媒体的实际解码、生成质量和结果播放仍未验证。

## 可运行范围

| 本地操作 / 请求 | 原生适配覆盖 | 实际前提与边界 |
| --- | --- | --- |
| 文生视频、图生视频、首尾帧、全能参考 / `video.generate` | `ark-native`、`minimax-native` | 显式真实模型映射、对应 mode/spec/media 能力及账号权限。一次任务一个视频，不自动替换规格或模型。 |
| 视频编辑生成 / `video.generate` + `VIDEO_EDIT` | Ark 显式 `omniReferenceTaskType: edit` | 一个来源视频，4–30 秒，`ratio=adaptive`、`duration=-1`；视频须为公网 HTTPS。 |
| 样片及转正式片 / `video.generate` | Ark 显式 draft 能力 | 样片 480p；转正式片只提交原 `draft_task.id` 和 1080p，不能重复提示词、参考或规格。MiniMax 不支持该本地合同。 |
| 延长菜单 / `video.extend` | 三个原生适配均未覆盖该 kind | 需要独立 `tasks-v1` 服务实现方向、实际裁片、参考与结果合同。Ark `omniReferenceTaskType: extend` 是 `video.generate` 的显式子类型字段，并不等于已接通延长菜单。 |
| 视频超分 / `video.upscale` | `fal-video-native` | 显式 FLUX 或 Topaz Proteus endpoint；真实源尺寸、时长及实际选段 MP4。不是任意 fal 视频模型路由。 |
| 重拍 / `video.reshoot` | 均未覆盖 | 当前请求明确标记 `capabilityMode: prompt_simulation`，包含分段及相机轨迹；需要实现该协议的独立服务，不能声称原生 API 已支持可控多视角重拍。 |
| 物体替换 / `video.replace`、移除 / `video.erase` | 均未覆盖 | 请求含识别后的 mask、来源选段和替换图；需要独立服务。普通视频编辑提示词不能替代时序 mask 合同。 |

`tasks-v1` 只提供运输协议；配置 URL/Key 本身不证明其服务实现了这些动作。三个原生适配会拒绝未支持的 kind，不静默改成普通生成。

## 官方资料与对照结果

### Ark

实际读取[创建任务正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1520757)，并对照[官方页面](https://www.volcengine.com/docs/ark/create-video-generation-task-api)、[Python Tasks SDK](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/resources/content_generation/tasks.py)、[Python 输入类型](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/create_task_content_param.py)和 [Go 类型](https://github.com/volcengine/volcengine-go-sdk/blob/master/service/arkruntime/model/content_generation.go)。

- 创建 `POST /contents/generations/tasks` 返回 `id`；查询只使用原 `GET /contents/generations/tasks/{id}`。`expired` 是执行超时，现有代码映射为失败。
- 成功需 `content.video_url`；输出保持原任务 ID，不把返回的整数 `duration` 当成实际播放时长，也不编造尺寸/封面。
- 图片/音频文档支持规范 Base64；视频栏只列公网 URL 和 `asset://`。当前适配只开放视频公网 HTTPS，未实现 Ark 素材库，拒绝内联本地视频，与 metadata 的 media transport 边界一致。
- 官方明确：`edit` 至少含一项 `reference_video`，来源 4–30 秒，画幅 `adaptive`、时长 `-1`；`extend` 至少含一项 `reference_video`，画幅 `adaptive`。本次补足这些提交前约束，见下节。

### MiniMax H3 / H3 Max

实际读取[创建接口 Markdown](https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md)、[查询接口 Markdown](https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md)、[删除任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-delete)和[上传文件](https://platform.minimax.io/docs/api-reference/file-management-upload)。

- `POST /v2/video_generation` → `task_id`；`GET /v2/query/video_generation/{task_id}` → `task.id/status/content.url`。没有使用旧 Hailuo 的 `file_id` 换下载地址流程。
- 当前官方明确 `MiniMax-H3` 支持 768P/2K、4–15 秒；`MiniMax-H3-Max` 支持 480P/768P、5–15 秒。保留已有显式型号配置，没有硬编码替代型号。
- 参考图/视频/音频 role 与 content 数组合同一致；MP4 data URI 保持，MOV 先通过上传接口，再绑定上传回执的 `mm_file://{file_id}`；不把丢失上传回执当作可以重试的证据。
- Max 的 `extra.prompt_expansion_mode` 官方枚举为 `disabled/balanced/quality`，现有实现一致；不支持的音轨开关、样片、相机控制均在提交前拒绝。
- V2 查询状态为 `queued/running/succeeded/failed/cancelled`，可查最近 7 天；结果 URL 会过期，允许查原任务取得新 URL。创建/轮询地址和身份验证一致。
- 删除接口会删除已完成/失败记录，不能取消运行中的任务；现有适配不向用户承诺远端取消。H3 Context-IR 和 regenerate 是独立接口，本次没有冒充已实现。

### fal 视频超分

实际读取 [FLUX OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-video-upscale)、[Topaz OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/topaz/upscale/video)、[FLUX 使用说明](https://fal.ai/models/fal-ai/flux-video-upscale/llms.txt)、[Topaz 使用说明](https://fal.ai/models/fal-ai/topaz/upscale/video/llms.txt)和[官方 JS queue SDK](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/queue.ts)。

- FLUX `upscale_factor` 为 1.5–3，`creativity` 为 0/1，来源 MP4 最长 20 秒、50 MB；当前精确/创意模式映射一致。原图尺寸决定目标长边倍率，不能忽略范围后提交。
- Topaz 当前 OpenAPI 支持 Proteus、1–4 倍、`target_fps` 16–60；本地菜单映射只开放 auto/30/60，显式 `H264_output: true`。90fps、2x 慢放未实现，不自动降级。Proteus 是显式配置，不使用供应商默认型号。
- 提交地址保留完整 endpoint 路径，轮询/结果/取消地址使用 `owner/alias/requests/{request_id}`，与 JS SDK 一致；不向响应中的任意 status/result URL 发送 Key。
- 队列 `COMPLETED` 后才 GET 结果，需真实 `video.url`。错误/异常响应不重新 POST；结果尺寸和封面由实际媒体读取负责。
- 当前 OpenAPI 的 QueueStatus 未定义 `error/error_type` 可为空的成功变体，没有证据支持放宽现有错误字段检查，本次未修改共用 queue 代码。

## 可靠开源实现的交叉证据

这些代码用于确认实际工程写法，不能替代官方合同或真实账号验证。

| 源代码快照 | 本次实际核对 | 不能推导的结论 |
| --- | --- | --- |
| [ComfyUI MiniMax 节点](https://github.com/Comfy-Org/ComfyUI/blob/f1072eb0350638a3390ddb6afbcaa8c6b237c6fd/comfy_api_nodes/nodes_minimax.py) | H3 创建 `/proxy/minimax/v2/video_generation`、查询原 ID、等待 `task.status`、读取 `task.content.url`，首尾/参考 roles，与本地 H3 V2 一致。 | 它通过 Comfy 的代理运输；Max 节点使用 fal endpoint，不能套用到本地 MiniMax 原生 Max。旧 Hailuo 的 file retrieve 分支也不能当作 H3 合同。 |
| [ComfyUI ByteDance 节点](https://github.com/Comfy-Org/ComfyUI/blob/f1072eb0350638a3390ddb6afbcaa8c6b237c6fd/comfy_api_nodes/nodes_bytedance.py) | `_seedance2_build_request` 对 edit 设 adaptive/-1，对 extend 设 adaptive；支持本次显式子类型约束修复。 | 社区自动重写规格不是本地产品的许可；本地拒绝矛盾参数，保留用户选择。 |
| [ComfyUI-fal-API client](https://github.com/gokayfem/ComfyUI-fal-API/blob/ef7c1214156b310d762c6456aedf26de62cc06c0/nodes/utils/api.py)（Apache-2.0） | `client.subscribe` 使用 enqueue ID 和 queue callback，结果缓存及 URL provenance 可追溯。 | 它的[视频节点](https://github.com/gokayfem/ComfyUI-fal-API/blob/ef7c1214156b310d762c6456aedf26de62cc06c0/nodes/video_node.py)里存在其他 upscaler，不构成本地 FLUX/Topaz 的模型规格证明；endpoint 规格仍依据官方 OpenAPI。未引入该项目代码/依赖。 |

## 本次最小修复

1. `server/generation-ark.cjs`：对显式 `edit/extend` profile 统一校验实际视频、adaptive；edit 另校验 -1 和实际来源 4–30 秒。原先 `REFERENCE_TO_VIDEO` 的宽能力映射能绕过这些官方限制，甚至无视频提交。
2. 同一 adapter 拒绝未裁出的 `input.clip/trim/sourceClip`。原先会忽略选区并把整片 URL 发给供应商；现在请求在 POST 前失败。
3. `tests/generation-ark.test.cjs`：新增子类型与未裁片回归；普通 reference 的 2 秒输入继续允许。无 materializer 的恢复用例正确保留供应商成功描述，但公开状态为归档未确认，无公开输出。
4. `tests/generation-ark-gateway.test.cjs`：旧用例仍期待公开远端 URL，HEAD adapter 也失败。本次更新到当前持久化合同：原任务 GET 恢复后，用真实 QA MP4 fixture 写入本地媒体 store，比对完整 bytes；再次重启不下载、不请求供应商。

没有修改公共请求协议、模型默认值、路由、账号权限或凭据，也没有新增依赖。

## 归档与恢复核对

生产 gateway 使用持久化 task store、provider binding/fingerprint 和媒体 materializer。供应商成功先保存私有 `providerResult`，视频 bytes 本地归档、校验完成才公开 `/api/generation/media/{id}`。归档失败是供应商已完成但媒体尚未保存，不重新生成；原结果过期时只查询原任务。来源配置变化需要恢复原配置，不能悄悄改走新路由。

本次 Ark 集成回归和既有 fal 路由恢复回归覆盖了原任务 ID、一个 POST、GET 恢复、实际 MP4 bytes 和本地资源。视频播放/缩略图仍需浏览器实际解码验证；本次未占用主线程浏览器，也未把 MP4 包络检查当作真实播放证据。

## 新鲜验证

```bash
node --test tests/generation-ark.test.cjs tests/generation-ark-gateway.test.cjs tests/generation-minimax.test.cjs tests/generation-minimax-media.test.cjs tests/generation-fal-video.test.cjs tests/generation-fal-queue.test.cjs tests/generation-music-video-integration.test.cjs
```

结果：72 passed，0 failed。三个改动 CJS 文件的 `node --check` 和 scoped `git diff --check` 通过。初跑两个旧 Ark 归档断言失败；用 HEAD adapter 复跑仍同样失败，随后按现行归档合同修正用例，未放宽生产成功条件。未运行全量 suite、未执行真实付费模型调用。

仍缺：独立延长菜单适配、mask 替换/移除、可控重拍原生合同；Ark 本地视频公网上传或素材库；真实账号权限与模型媒体验收。现有原生协议配置成功只表示本地合同准备就绪。
