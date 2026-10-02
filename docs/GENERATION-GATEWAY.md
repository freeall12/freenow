# 生成任务后端接口

前端默认连接本机 `/api/generation`。服务端通过 `server/generation.cjs` 接入任务提供方，生产服务使用 `generation-durable.cjs` 保存任务，浏览器通过 `generation-api.js` 查询与恢复。图片、全景图、视频、音频、文字及3D任务共享此接口；不依赖 Agent 的 OpenAI Key。

## 配置与替换

### 协议选择（2026-10-03）

`GENERATION_API_PROTOCOL` 默认 `tasks-v1`，仍要求外部网关实现以下任务协议。`openai-native` 通过现有 OpenAI SDK 接入 `text.generate` 的 Responses API，以及 `image.generate` 的 Images generations / edits API，以及限定文字转语音的 audio/speech API 和焦点点选识别的 Responses 视觉输入。带图片参考的生成仅在模型映射显式开启后走 edits。两种协议共用现有本地任务记录与结果回填。`configured:true` 表示配置完整，不代表已联网验证账号权限、模型存在或服务可用。

另可选 `ark-native`，直接适配火山方舟的 `/contents/generations/tasks`，无需自行实现 `/tasks` 网关。显式配置所选型号的生成方式、画幅、时长、分辨率和引用范围；原远端任务 ID 持久化，刷新/服务重启后仅 GET 查询，不重发未知 POST。单任务视频、首尾帧、参考与样片正式片的配置见 [Ark 视频适配](ARK-VIDEO.md)。可选 `GENERATION_PROVIDERS` / `GENERATION_ROUTES` 同时配置多个供应商，按功能和模型别名精确分流；不自动故障转移。见 [多供应商设置](MULTI-PROVIDER-SETUP.md)。Agent 的独立 OpenAI 配置不受影响。

原生协议的 `GENERATION_API_KEY` 独立于 Agent Key；可选 `GENERATION_API_BASE_URL` 是 SDK 基础地址，留空使用 SDK 官方默认地址。自定义兼容服务必须实际实现 Responses 或 Images，Chat Completions 地址不能自动替代。必须配置 `GENERATION_MODEL_MAP` JSON，对每个展示别名指定 `kind`、真实 `model`，可选 `maxCount`（默认1，最大10）、`reasoningMap`、`sizeMap`、`qualityMap`。例如：

```json
{
  "gpt-5.6-sol": {
    "kind": "text.generate",
    "model": "YOUR_TEXT_MODEL",
    "reasoningMap": {"low":"low","medium":"medium","high":"high"},
    "maxCount": 1
  },
  "gpt-image-2": {
    "kind": "image.generate",
    "model": "YOUR_IMAGE_MODEL",
    "sizeMap": {"1:1|1K":"1024x1024"},
    "qualityMap": {"low":"low","medium":"medium","high":"high"},
    "supportsImageReferences": true,
    "maxImages": 16,
    "maxCount": 1
  }
}
```

这些是本地菜单别名，不是同名厂商模型承诺。尺寸映射以 `画幅|分辨率` 为键，未映射的选择在请求发出前阻止；配置者应只映射目标模型真实支持的规格。示例只覆盖1:1/1K；GPT 自适应尺寸须显式配置 `"auto|":"auto"`。此时历史空字符串 quality 仅表示没有分辨率选择，不覆盖实际 outputQuality。历史顶层 `quality` 等于 `imageSize` 时表示分辨率，实际生成质量使用 `providerParameters.quality` 或 `outputQuality`，互相矛盾的配置拒绝提交。文字参考会并入提示词；视频生成、音乐/音效/克隆音色、3D、全景、审核、其他识别、擦除、局部重绘、扩图和其它图片操作均需对应的任务网关。未知生成参数拒绝；前端既有精确、无效的默认元数据仅用于兼容，不能作为原生供应商能力。

图片参考启用方法与实际素材读取边界见 [OpenAI 图片参考适配](OPENAI-IMAGE-REFERENCES.md)。未配置 `supportsImageReferences:true` 的旧映射保持只支持无图片参考生成；开启时必须同时配置 `maxImages`（1–16，并符合所选实际型号限制）。能力报告仅公开展示别名、引用数、支持的 MIME 与内联传输方式，不公开真实型号。带图片时 `image_to_image`、无图片时 `text_to_image`；模式矛盾在提交前拒绝。

原生语音需单独配置 `audio.generate` / `Text-to-Speech` 映射，Seed 中性默认参数可以直接使用。WAV/MP3、音色和语速必须显式映射；采样率只校验实际 WAV，不作为供应商可调参数。音乐、音效及 Eleven 的 stability 等未支持选项明确拒绝。见 [OpenAI 语音适配](OPENAI-SPEECH.md)。

原生焦点识别使用明确的 `image.recognize` 映射，保留完整图片、0–1点击坐标和原编辑会话绑定；结果为严格JSON候选框。浏览器先受限读取实际素材并解码，服务端不抓取任意URL。刷新后仅能查询原识别记录，不能恢复失效标签或导成普通正文节点。见 [焦点识别适配](OPENAI-ANALYSIS.md)。

原生 `video.analyze` 使用明确同名模型映射、FFmpeg/FFprobe 和 Responses 视觉描述。完整选区逐帧检测后输出实际 MP4 分镜与 JPEG 海报；`sourceRange` 保留原片区间，物理裁切输出不能再携带 `clip`。40 MiB/600秒/32镜头本地预算、三帧描述精度和已验证范围见 [视频分镜适配](OPENAI-VIDEO-ANALYSIS.md)。本机准备失败尚未提交模型时保存 failed，已有任一模型调用后的不确定失败保持 unknown。

SDK自动重试关闭。文字批量按顺序调用并返回同序outputs；中途故障可能有已计费的部分结果，本地保留unknown，不能自动重跑。Images返回的base64必须具有PNG签名及有效IHDR；元数据取图片真实尺寸，远端URL不假定请求尺寸，后续浏览器还须实际解码。SDK的url字段仅接受没有用户名密码的HTTP(S)，data/blob不能绕过b64_json检查。PNG头检查不替代完整像素解码。原生同步调用没有可恢复的远端任务ID；成功结果在本地落盘，连接中断或服务重启后的不确定任务保持unknown，通过原本地任务/幂等键读取，永不重复提交。取消中止本地等待并拦截迟到结果，`providerCancellation:unconfirmed`，不能承诺远端停算或退款。

配置JSON/地址/协议无效时 `GET /api/generation/config` 返回 `configured:false`、`configurationError:'configuration_invalid'`；tasks-v1非法基础地址同样不会让整个服务崩溃。不返回Key、真实endpoint或SDK对象。返回 `missing` 与 `capabilities`，`verified:'local-contract-only'` 表示当前只有本地契约验证。原生 `references` 和 `imageReferences` 据模型映射报告，remoteRecovery与remoteCancellation为false；本地 `recovery:true` 仅表示持久记录可查询。服务不自动加载 `.env.example`，参考仓库根目录占位文件使用shell环境或Node `--env-file` 启动。

浏览器“连接 API”显示本机状态，可切回本机服务并重新读取配置。直接连接仍限tasks-v1，要求CORS，Key只在页面内存保留；地址不得含用户密码、query token或fragment。关闭弹窗清空密码输入，不写localStorage。直接连接没有本机持久任务恢复承诺。

验证：`node --test tests/generation-openai.test.cjs tests/generation.test.cjs tests/generation-durable.test.cjs`。使用显式SDK替身与私有测试存储；没有真实供应商或计费调用。

启动服务前设置 `GENERATION_API_BASE_URL`、`GENERATION_API_KEY`。地址指向实现以下任务协议的网关，Key仅在服务端使用。前端已有的“连接 API”保留会话级直接适配能力。

- 无配置时创建的任务进入 `configuration_required`，不调用模型、不返回示例媒体。
- 提供方实现 `generate(request,{signal,onProgress}) => {outputs}` 即可替换HTTP网关。具体厂商的模型名、全景提示词、素材上传和状态映射在这里适配，不假定任意厂商Key都兼容统一协议。
- `parameters.providerParameters.model` 是官方界面的模型别名；需映射到实际服务型号。`isPanoramaPrompt:true` 与 `aspectRatio:'2:1'` 一并保留。普通2:1图没有全景标记。
- 输入包含URL、data URI或项目本地素材标识。供应商适配器必须按来源转换/上传；不能把浏览器blob或本地素材标识直接当成公网URL。

## 本机路由

| 路由 | 行为 |
|---|---|
| `GET /api/generation/config` | 返回 `configured`、`protocol`、`missing`、`configurationError`、`capabilities`、本地`recovery`，不返回Key |
| `POST /api/generation/tasks` | 请求 `{kind,nodeId?,label?,prompt?,inputs?,parameters?}`，返回202和任务ID |
| `GET /api/generation/tasks/by-key/:localTaskId` | 按浏览器原任务 ID 找回请求、状态与输出；只查询，不重新生成 |
| `GET /api/generation/tasks/:id` | 返回状态、进度、成功输出或错误 |
| `DELETE /api/generation/tasks/:id` | 取消排队/运行任务；终态幂等 |

不确定提交或连接中断会进入 `unknown`，须查询确认；不能当作失败自动重发。

状态：`queued` → `running` → `succeeded` / `failed` / `cancelled` / `configuration_required`。
输出：`{outputs:[{type:'image',url:'https://…',width:4096,height:2048}]}`，也支持video/audio/text/model。文本须返回非空`text`。媒体地址与类型经过统一校验。前端复用原有真实媒体解码、来源失效保护与结果回填。

上游HTTP网关实现对应的`POST /tasks`、`GET /tasks/:id`、`DELETE /tasks/:id`；可在POST直接返回outputs，也可返回ID供轮询。取消向上游发送DELETE，前后端均丢弃迟到结果。若供应商不支持停止，已发起的远端计算可能继续；不能把本地取消视作供应商退款或停止承诺。

## 权限、失败和记录

- 沿用服务端localhost Host/Origin限制；请求不能指定外部网关地址或读取服务端凭据。
- 生成请求体上限64MiB；其他JSON接口仍为原1MB限制。
- 任务ID、状态、创建时间和进度可查询；不记录Key或提示词到服务端日志。上游错误在本机返回通用文案，避免泄露认证信息。
- 无目录的测试兼容网关仍使用单进程内存最多保留500条任务；终态一小时后清理，重启不恢复任务。当前不是持久化分布式队列。
- HTTP任务默认10分钟超时，取消传播最多等待5秒。输出为空、类型错误或无效媒体地址进入failed。

验证：`node --test tests/generation.test.cjs`。覆盖无配置、进度、协议、取消/迟到结果、参数准备、全景与普通2:1区分、后端任务读取及Key不回传。真实供应商、外部素材上传和真实模型效果待拿到接口后联调。


## 焦点编辑识别 `image.recognize`

用途：在另一图片的点击位置识别候选对象，用于当前生成节点的提示词与参考连线。复用上述任务提交/查询/取消，不调用官方识别服务。

请求：

```json
{
  "kind": "image.recognize",
  "nodeId": "source-image-node",
  "inputs": [{"type": "image", "url": "reference-image-url"}],
  "parameters": {
    "point": {"x": 0.25, "y": 0.32},
    "binding": {"sourceNodeId": "source-image-node", "targetNodeId": "reference-image-node", "markId": "unique-mark-id"},
    "output": {"format": "json", "boxOrder": ["top", "left", "bottom", "right"], "coordinates": "normalized-0-1"}
  }
}
```

适配器返回一个 `type:'text'` 的输出，`text` 是以下 JSON 的字符串：

```json
{"items":[{"label_name":"人物","label_desc":"穿蓝色外套的人","box_2d":[0.1,0.2,0.9,0.8]}]}
```

坐标均在0–1且矩形有正面积。前端过滤无效候选；无候选、JSON错误、缺Key、超时均移除加载标记并展示失败原因。识别成功只更新提示词标签/框，退出编辑模式时建立缺失参考连线，不创建文本结果节点。取消、源节点删除、目标图片替换或标签删除后，迟到结果不能写入。刷新后不恢复临时运行任务；保留已完成标签。

权限：仅点击/快捷键进入后的用户点选触发请求；Key沿用服务端配置，不额外引入权限或客户端凭据。日志沿用任务ID/状态/进度，原图上传或私有素材解析由具体供应商适配器完成。验证见 `tests/focus-edit.test.cjs` 和 `reference/focus-edit.md`；固定候选只存在显式启用的隔离验收页。

## 画布生成参考输入

单节点图片/视频生成现在从实时上游连线解析 `inputs`，兼容旧版图片refs与referenceBindings。同一来源不会因旧配置和连线并存而重复提交；来源更新后使用当前媒体地址。输入按图片、视频、音频、文本排列，类型内使用用户排序。视频使用真实video URL，音频使用audio URL，文本使用text正文；封面仅用于UI。每项可含来源id/title。空来源在提交前报错。

服务端任务协议保持不变；供应商适配仍需落实各模型的多模态支持、文件上传/本地asset解析以及输入限制。没有Key时不会生成结果。验证包含真实点击生成的四类请求与configuration_required状态，见 `reference/node-composer.md`。

节点已连接引用：`{{Image N}}`、`{{Video N}}`、`{{Audio N}}` 的N对应同类型inputs顺序，前端通过来源身份绑定保护排序/断连。节点与分组工作流提交的request.prompt将 `{{Text N}}` 替换为实时文本正文，未引用的上游文本前置；parameters.prompt保留原始编辑token。服务端仍走原可替换网关，不要求/暴露客户端密钥，也不把未配置任务伪装成成功。

## 素材库引用与 Agent 直接提交

节点编辑器保存 `{{Asset:JSON}}` 素材快照；提交前将媒体转为对应的inputs和同类型序号，将文本转为正文。媒体按类型+URL去重，不向供应商传递编辑器Asset标签。原始parameters.prompt可保留编辑token，不应作为供应商最终提示词。

`src/features/node-composer/generation-request.mjs` 在前端共用TaskService入口准备image/video请求，覆盖GenerationAPI直接调用：模型目录别名/参考模式校验、Asset类型校验、投影后图片数量校验。已准备请求重复执行保持幂等，不重复前置上游文本。此准备不改变HTTP协议，也不是服务端权限校验。素材URL解析/上传仍属于实际供应商适配器。

后续接入需提供服务地址、Key、真实模型映射及上传协议；Key只放服务端环境配置。没有Key时现有任务进入configuration_required，前端显示待连接API并提供重试。全景/图像/视频/LLM前后端和参数交互继续实现，不因缺Key停留在静态按钮。

## 画布结果模式与有序输出

`GenerationAPI.submit` 的普通图片/视频 `spread`、`pile` 和全部文本结果布局，已接入 `src/features/generation-results/workflow.mjs`。图片/视频 `variants` 继续使用原有历史结果路径；文本 `variants` 的有效布局为 `spread`。专用原位编辑、派生结果和 Seedance 正式片不经过这条普通结果布局路径。

入口确认提供方未配置时不创建占位，仍返回真实 `configuration_required` 任务。确认已配置后，在调用提供方前原子创建/更新全部目标节点及复制的输入边。一个浏览器任务仍只调用一次 `provider.generate`；本机 `/api/generation/tasks` 创建一个网关任务并向上游提交一次请求，**当前没有依据 `requestPlans` 自动拆分远端请求**。

提交请求的 `parameters` 增加以下规划字段。例如 Midjourney 界面选择 8×：

```json
{
  "count": 2,
  "batch_count": 2,
  "batch_id": "browser-run-id",
  "is_regeneration": true,
  "layout": "spread",
  "canvasResults": {
    "runId": "browser-run-id",
    "targetNodeIds": ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"],
    "requestPlans": [
      {"requestId": "logical-request-1", "targets": [
        {"nodeId": "n1", "resultIndex": 0}, {"nodeId": "n2", "resultIndex": 1},
        {"nodeId": "n3", "resultIndex": 2}, {"nodeId": "n4", "resultIndex": 3}
      ]},
      {"requestId": "logical-request-2", "targets": [
        {"nodeId": "n5", "resultIndex": 0}, {"nodeId": "n6", "resultIndex": 1},
        {"nodeId": "n7", "resultIndex": 2}, {"nodeId": "n8", "resultIndex": 3}
      ]}
    ]
  }
}
```

`requestPlans` 是逻辑分组，`requestId` 不是已经存在的供应商任务 ID。`batch_count` 等于分组数；`batch_id` 与 `canvasResults.runId` 是浏览器任务 ID，本机网关及上游可以各有自己的任务 ID。`is_regeneration` 表示提交模板已有非空结果。`layout` 是有效画布布局，不能直接当作供应商模型参数。

| 规划场景 | 提供方数量设置 | 每组 target 数 | 必须返回的 outputs 数 |
| --- | --- | --- | --- |
| 普通图片 spread/pile | count/times = N | 1 | N |
| Midjourney spread/pile | count/times = T，当前 T 为 1、2、3 | 4 | 4T |
| 视频或文本布局 | count/times = N | 1 | N |

接入方可让上游直接返回多结果，或在适配器内部按 `requestPlans` 调用供应商并汇总；两种方式均须返回一个完整的有序数组。`outputs[i]` 对应 `targetNodeIds[i]`，等于按 requestPlans 顺序、各组 resultIndex 顺序展平；不能按远端完成时间排序。每项 type 必须与任务 kind 对应。当前回填不使用 output 自带 nodeId 做匹配。

媒体输出至少包含 `type` 和 `url`（或同类型的 image/video 字段）；文本输出包含 `type:'text'` 和非空 `text`。供应商有文件身份时另返回真实 `sourceFileId`，前端写为 `currentSourceFileId`；缺失则写 null。Seedance 样片后续定稿依赖该真实标识。图片尺寸和视频尺寸/时长由浏览器解码复核，视频元数据写入 `videoMetadata`。

本机网关校验一般输出形状，不持有画布，也不执行上述分组或校验画布目标数量。前端要求总数量、类型与规划完全一致，所有媒体解码成功、所有目标仍属于同一任务且未被编辑/替换，才一次回填。否则任务可以是供应商已成功而前端“结果应用失败”，不会部分覆盖画布；应重新生成。

取消、失败、运行后才报告缺配置或回填失败时，当前本地策略是保留占位节点/连线/堆叠，清除仍属于该任务的待生成标识；不删除占位或回滚其他用户编辑。此策略不能宣称与原站所有失败细节一致。取消发生在提交占位异步返回前也会补清；删除后撤销恢复的新节点不会被旧任务清理或回填。页面恢复和撤销恢复会去除没有活跃运行所有权的生成标识，不恢复远端任务。

提示词分为两种：`parameters.prompt` 是可编辑的原始提示词，保留引用 token；`request.prompt` 是发给模型的最终文本。文本编辑入口显式保存原始值。结果节点配置使用提交时捕获的原始值；Agent 直接提交未提供 `parameters.prompt` 时，使用本次 `request.prompt`，不回退覆盖为旧编辑器默认值。适配器应使用最终 `request.prompt` 发起生成。

验证见 `tests/generation-results-workflow.test.cjs`、`tests/generation-result-transaction.test.cjs`、`tests/generation-results-plan.test.cjs`、`tests/generation-result-counts.test.cjs`。尚未完成真实供应商分组执行、素材上传、分组进度/重试、持久化运行恢复及模型质量联调；不得将逻辑 requestPlans 或本地 QA 提供方解释为这些能力已经接入。

## 视频规格准备

已提取的12个模型经video-generation/settings.mjs匹配真实输入和生成方式；不兼容输入在发给供应商前失败。parameters.providerParameters包含model/modelType/variant及该方式支持的aspectRatio、resolution、duration、generateAudio、generateMode、times；首帧画幅由素材决定时省略aspectRatio。界面模型名仍为展示别名，网关需映射实际服务型号。更多旧模型、输入媒体时长限制和动态模型规格仍待补齐，见reference/video-generation-specs.md。

### 取消回执与回填边界（2026-09-30）

`TaskService.cancel(id)`、浏览器 `GenerationAPI.cancel(id)` 与Agent `generation_cancel` 使用相同真实回执：

```json
{"id":"task-id","outcome":"cancel_requested","status":"cancelled","localCancellationRequested":true,"lateResultBlocked":true,"providerCancellation":"unconfirmed"}
```

- `not_found`：没有本地任务记录，`status:null`；未发起取消，也不能判断远端任务状态。
- `already_terminal`：任务已经succeeded、failed、configuration_required或cancelled，本次没有重新取消。成功任务的输出和正在进行的结果应用均保留；此操作不能撤回已经完成的生成或已创建的节点。
- `cancel_requested`：本地queued/running任务接受取消并立即中止本地等待，阻止该任务的迟到输出进入成功回填。任务状态中的cancelled只表示本地停止；不等于供应商已经停算。

`localCancellationRequested`表示本次调用是否接受了新的本地取消。`lateResultBlocked`描述该任务已有的迟到结果保护；因此重复取消先前已取消的任务时，前者false、后者true。未开始provider调用时 `providerCancellation:not_requested`；已调用provider时为 `unconfirmed`，即使HTTP DELETE返回2xx也不会推断供应商确认停止或不再计费。现有DELETE仍为尽力传播，失败不会解除本地保护。超时、无upstream ID及未启用远端取消也不能形成远端停止承诺。

服务端 `DELETE /api/generation/tasks/:id` 保留job响应并增加 `cancellation` 回执；不存在仍返回404，同时返回 `cancellation.outcome:not_found`。活动任务的首次取消回执连同requestedAt保存在job.cancellation，GET可读取；重复DELETE返回本次already_terminal语义。不会记录Key或供应商响应正文。现有UI忽略返回值的cancel调用保持兼容。

回归覆盖queued取消不dispatch、异步prepare/迟到结果保护、running订阅取消阻断dispatch、不存在/全部终态/重复取消、失败DELETE不宣称远端已取消，以及终态输出与applying不改变。仅使用现有测试中的显式内存provider/fetch替身；没有外部供应商请求。任务记录仍为内存Map，服务重启恢复与持久化不在本增量范围内。

本增量验证：`node --test tests/generation.test.cjs tests/agent-browser-tools.test.cjs` 共41/41通过，包含正式Agent路由对三类回执的原样透传；`generation-api.js`、`server/generation.cjs`语法检查通过。未做真实供应商取消确认，也未将UI局部/内存测试表述为供应商已经停算。

## Seedance 2.5 样片与正式片

模型目录中的`seedance-2.5-draft`（展示名“Seedance 2.5 样片”，兼容旧Draft名称）或Seedance2.5配置`draft:true`提交固定480p样片。样片结果必须含真实视频URL与供应商返回的`sourceFileId`；本地视频URL或480p分辨率本身不构成定稿身份。

正式片使用`video.generate`，parameters含`model:'Seedance 2.5'`、`draftVideoId`。前端统一workflow从当前唯一`draft-reference`来源解析文件ID，忽略过期请求中的ID；请求prompt为空、inputs为空，并删除普通素材/主体引用。服务端再次投影：

```json
{"model":"seedance-2.5","draft_video_id":"provider-draft-file-id","resolution":"1080p","times":1}
```

这是`parameters.providerParameters`的完整定稿内容。提供方需支持按样片文件定稿，不得把此请求降级为带普通prompt/element_refs的再次生成。不支持该能力时返回明确未配置/不支持错误。真实服务型号仍由接入方映射；只提供不同协议的Key不足以完成适配。

新建正式片节点及专属边一次提交，原样片保留。重试再次读取实时引用；源视频/文件身份/生成配置、引用边或目标配置变化时阻止旧结果写入。前端维护画布引用校验，任务后端不保存整张图；后端保证wire语义，拒绝无效显式正式片字段。取消沿用上面的任务回执，不宣称远端已停止计费。

Agent调用复用`generation_submit`，参数为`{kind:'video.generate',draftSourceId:'canvas-node-id',nodeId?:'existing-final-node-id'}`。不接受Agent指定供应商文件ID、prompt、resolution或普通参考列表；实际执行前重新校验审批来源指纹。详情见`AGENT-API.md`，本地视频/取消/失效/未配置状态已验证，真实供应商效果未验证。


## 持久恢复（2026-09-30 接线）

生产启动固定使用 `server/.generation-tasks`，在静态文件拒绝目录内。任务记录 0600、目录 0700，单进程独占；写盘与提交意图 checkpoint 完成后才向供应商 POST。记录保存原请求与输出，禁止凭据字段。请将该目录作为本地创作数据保护，不上传到公共仓库。没有修改浏览器数据库版本或清空已有画布。

浏览器提交使用原任务 UUID 作为 `Idempotency-Key`；同键同请求返回原任务，不同请求冲突返回 409。旧HTTP客户端无键时仍生成独立键，但无法靠其旧本地 ID 恢复。普通轮询不重复传输完整请求，只有 by-key 恢复返回原请求。记录不再按一小时删除；当前仍有 500 条任务容量保护，归档管理尚未实现。

重启有远端 ID：GET 原任务；提交意图存在但远端 ID 未知：`unknown`，禁止自动 POST。超时只停止等待，不自动取消；用户明确取消才发送 DELETE。关闭服务不把运行任务写为取消。服务端无配置时仍明确返回 `configuration_required`。磁盘不可用、损坏记录或目录正在被另一进程使用时阻止服务启动。

`GenerationAPI.recover(id)` 只取回任务/输出；新恢复的成功任务不会自动触碰画布。`applyRecovered(id, 'existing')` 只允许有保存基准、未修改且匹配原 run 的占位；`'new_nodes'` 将图片/视频/音频/文本作为独立节点导入，保留任务与输出序号以防再次导入重复。原位编辑、派生闭包、GLB 与片场全景的丢失 guard 不会被重建或绕过。原任务可能已在刷新前完成应用，应先检查现存结果；新节点方式是显式导入，不代表恢复原编辑事务。

浏览器会话直连自定义服务不自动获得持久恢复。媒体 URL 过期、本地 blob 丢失、刷新前旧版本任务没有落盘记录，均不能从 ID 伪造恢复。Agent 模型会话、等待用户问题、分组工作流和子 Agent 的跨服务重启恢复仍未完成。

关键验证见 `tests/generation-recovery.test.cjs`、`tests/generation-recovery-integration.test.cjs`、`tests/generation-durable.test.cjs`。未调用实际供应商，未跑 E2E。

原占位与新节点两种恢复都会等待画布保存；保存失败保留结果ID，再次尝试只保存当前图，不重放已应用的修改。取消/失败任务的显式清理同样只处理基准可验证的占位。完整接线记录见 [Agent任务恢复](../reference/agent-generation-recovery.md)。
