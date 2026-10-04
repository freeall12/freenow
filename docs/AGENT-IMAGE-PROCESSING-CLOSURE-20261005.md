# Agent 图片处理链路收尾（2026-10-05）

本轮补齐 Agent 专用图片处理的高清输入、来源绑定和派发前持久回执，新增 `image.remove-background`，并为 `image.multiAngle` 暴露当前 Qwen 接口需要的显式参数。结果沿用生产 `submitDerived` 创建与来源连接的新节点；不会以任务提交回执声称已生成或已落图。

## 核对范围与依据

- 原有 `scene_panorama` 已具备打开、读取、区域/历史、生成、取景和 patch 编辑，通过 StudioAPI 派发。本轮未把这些功能当成缺失项。
- 原有 `generation_submit` 已声明超分、打光和多角度，具体缺口是专用操作使用缩略图 URL，且缺少跨异步阶段的项目/来源约束。
- 原有 Fabric `image_editor_edit` 的裁剪、擦除、姿态、分组与重挂不是 AI 蒙版生成。本地 AI 擦除、重绘、扩图 UI 与供应商适配也已存在；本轮不新增 Agent 蒙版几何接口。
- 官方包 `reference/vendor-pkg-canvas-BREtla0j.js` 的 matting 分支创建独立 CUTOUT 节点并连接来源，支持这里采用派生节点语义。SHA256：`3709d30a9368348765cd2d9c00a3fceaff4598a685e43615e23e79e912e3bf62`。
- `runtime-reference/whitebox-to-film.json` 是官方界面的正文采集，SHA256：`a47ee81a1d7d29ca1186fc13e03b2ac2ca5fbf3fe14bcd95b7cb1971c496612f`。其原流程描述 WebGL 控件/录制到 Seedance，本地适配明确使用真实 Studio 布景、关键帧、导出与生成工具。
- 技能详情保存的是 dialog text/article；不是原始 SKILL.md，缺失引用正文仍标记未采集。来源边界见 `src/features/agent-skills/README.md`。

## 实现与工具合同

Purpose：通过已配置的生成服务完成 `image.upscale`、`image.relight`、`image.multiAngle`、`image.remove-background`，保留来源并创建连接结果。

Inputs：`generation_submit` 的 `kind`、`nodeId`、`prompt`，可选 `model`、`referenceIds`、`count`；打光沿用 aspect/quality/resolution。抠图与多角度只能使用来源节点的一张图片、单个结果。未知显式参数会拒绝，未定义参数不进入 native body。

多角度必须提供空 prompt 和全部四个参数，缺值不会套用 UI 默认值：

| Agent 参数 | 允许值 | 当前 Qwen native 映射 |
| --- | --- | --- |
| `rotate_right_left` | -90..90 | `(value + 360) % 360` → horizontal_angle |
| `move_forward` | 0..10 | 原值 → zoom |
| `vertical_angle` | -2/3..1 | 原值 ×45 → vertical_angle |
| `wide_angle_lens` | false | 当前接口不支持 true |

该合同对应 `fal-ai/qwen-image-edit-2511-multiple-angles`，不声称重建物理相机或复现专有后端。示例：

```json
{"kind":"image.multiAngle","nodeId":"source","prompt":"","rotate_right_left":-30,"move_forward":2,"vertical_angle":0.5,"wide_angle_lens":false}
```

Outputs：提交返回 `nodeId`、`taskId`、当前 status；任务结果和应用状态沿用真实 TaskService 与 Agent generation trace。配置无法确认时返回 `configuration_required`，不创建任务。

Permissions：沿用生产 ask/auto 执行模式；ask 待审批和拒绝都不会读取素材或创建任务。派发使用 `fullImage || image`；已有 `prepareImageToolMedia` 和共享 transport 只解析/序列化一次，没有重复解码缩略图。

Failure modes：绑定项目 ID、来源节点对象与媒体/crop/clip/trim/params/settings 等签名；availability 返回、媒体读取完成、结果应用前再次检查。项目切换、节点替换或来源变更会拒绝。`beforeDispatchReady` 必须等待现有 Agent `onDepthSubmitted` 保存并 flush 任务 ID，失败/取消/上游历史门失败不会发起供应商请求。结果保存失败沿用应用重试，保留结果 IDs，避免再次请求或重复创建节点。

Logging：任务 ID 在原 conversation trace 中先持久化；`attachGenerationJob` 继续反映 task 与 applied 状态。审批动作分别显示“图片超分 / 图片打光 / 多角度调整 / 图片抠图”。专用request.label使用“图片超分 / 重新打光 / 多角度调整 / 抠图”，任务与派生结果标题通过既有label fallback本地化；kind与供应商参数不变，不重写已保存的历史标题。

全景小接口：新增可选 boolean `isPanoramaPrompt`，只允许 `image.generate`，仅显式传值时写入 `parameters.isPanoramaPrompt`；true/false 都原样保留，不根据模型或提示词推断。`hunyuan-world-panorama` 的 native 适配、2:1/单参考约束和 card normalization 属于独立全景实现，见 `docs/PANORAMA-NATIVE-20261005.md`。

CUA 前复核补充：普通 Agent 媒体 resolver 输出含本地 `sourceUrl` 身份，严格全景 helper 不接收该供应商字段。`prepareAgentMediaInputs` 接收所选 panoramaModel 后只返回 type/id/url/实测 width/height，原 fullImage、节点对象、clip/trim/crop/imageCrop 仍由 snapshot guard 检查。缺实测尺寸会拒绝；没有通过删除 guard 来通过白名单。

## 验证证据与限制

首轮收尾窄检查：

```bash
node --test tests/agent-image-processing.test.cjs tests/agent-panorama-selection.test.cjs
```

9/9 通过。测试使用实际 schema、Agent dispatch 片段、审批执行器、durable callback、TaskService、prepareImageToolMedia、共享 transport、fal adapter、应用 runner 和当前 `generation-ui.js` 派生应用分支。Node 仅替换 FileReader 序列化原语和 DOM 媒体检查；真实 PNG bytes 经 loopback HTTP 进入 native queue body，返回 PNG 后创建连接节点。覆盖手动审批、自动多角度、拒绝/未配置、高清来源、跨异步来源变更、回执/历史失败、取消和保存重试。

收尾时全部9个 owned JS/MJS/CJS 文件的 `node --check`、已跟踪 scoped `git diff --check`、owned 文本空白/冲突标记检查通过；隔离 HTML 已由 build script 按当前 index 重建，fixture/controls/高清来源注入和三个 PNG 签名/尺寸检查通过。

CUA 阻断修复后的增量检查：`tests/agent-image-processing-fixture.test.cjs` 的既有6/6及新增refresh专项1/1，`tests/agent-panorama-selection.test.cjs` 3/3。前者复现原 storage quota 异常，核对真实 localStorage getter 完全不访问、fetch/DB getter 异常阻断、数据库 namespace、CSP先于脚本且没有同源 API connect 权限、document.baseURI下精确技能目录GET与生产requestAgent turn/continue入口，并让全景 fixture 通过真实 preparePanoramaMedia 配置/请求检查和 transport；Node 只替换最后 Image/canvas 编码原语。refresh专项使用实际loadResourceIndex检查空合成映射schema、独立tasks/posts恢复及nativeFetch=0。后者使用实际 dispatch 和 media-inputs 模块，验证纯字段得到 native helper 接受，实测尺寸保留、fullImage/crop/节点替换 guard 仍拒绝。

此前与 media-inputs、Qwen multi-angle、image-tool-media 的限定组合 26/26 通过；本轮没有重复跑已过范围或完整套件。最新复跑修正了提取式 VM fixture 的验证函数名：共享 UI 已改用 `validateJobMedia`，fixture 仍提供旧名 `validateOutputMedia`。这不是生产应用失败。

邻接 `agent-generation-counts` 的一次组合运行存在 teardown VM 上下文缺少 `audioMetadataRevision` 的失败，已告知主任务，不在此处修改其他 owner 的 model/card 测试上下文。

没有使用真实密钥、付费请求或供应商输出；loopback 结果为固定夹具，不证明模型视觉质量。浏览器 CUA 验收由主任务执行，本文不将 Node 通过当作浏览器交互通过。

主任务 j5 CUA已确认实际抠图请求和审批：允许前posts=0/sourceReads=0；允许后posts=1、acknowledged=true、原图512×320/3035bytes、nodes=2/edges=1、job succeeded/applied=true、errors=[]。continue仅固定回复。首次刷新已保留nodes=2/edges=1及工具对话结果，但夹具未处理资源迁移索引导致提示，并且可见postsDetail未恢复；完成refresh修复后，主任务再次确认tasks ready/posts=1同原ID、errors=[]、两处结果图片均512×320、nodes=2/edges=1、无新POST。

主任务 j6 `&kind=angle&auto` CUA确认posts=1/acknowledged=true，参数-30/2/0.5/false原样保留、sourceReads=1、nodes=2/edges=1、applied=true、errors=[]。发现当时任务/结果标题使用裸image.multiAngle，已补专用中文label；更新后的自动多角度native HTTP→派生应用窄测1/1通过，断言任务label与结果node.title均“多角度调整”，底层kind不变。主任务j9新session再次CUA确认结果节点、连线、任务panel和Agent查看卡均显示“多角度调整”，kind仍image.multiAngle、posts=1/acknowledged=true/512×320，四个参数保持不变、errors=[]。j6已保存的旧标题没有重写。

主任务 j7 `&kind=panorama` CUA确认实际图片卡显示Hunyuan / 2:1 / 1×原生尺寸。允许后posts=1/sourceReads=1、实际源PNG512×320/6073bytes、inputKeys仅type/id/url/width/height、完整原生参数、acknowledged=false（如实记录generic没有Agent专用callback）、applied=true/errors=[]。该固定工具调用nodeId和referenceIds都指向image-source，因此结果替换同一目标，nodes=1/edges=0；不能归入抠图/多角度“来源保留且创建连接结果”的叙述。再次reload仍为同一taskId、posts=1，未出现新POST或源读取，taskRecords ready/errors=[]，结果PNG实际可解码为1024×512。上述任务状态、应用状态和像素证据才支持成功；固定continue文字“已收到提交回执”不算成功证据。

主任务 j8 `&configured=false` CUA确认在正式批准后明确显示“缺少FAL_API_KEY”，posts=0/sourceReads=0/jobs=[]、nodes=1/edges=0；未配置失败没有创建生成任务或读图。

## 全景同节点目标的旧原图历史（只读代码证据）

本节只核查代码，没有新增测试或操作j7历史数据。j7使用默认variants布局：

- `generation-ui.js:475` 默认mode=variants；`src/features/generation-results/workflow.mjs:46` 对媒体variants不创建占位工作流，沿用图片历史路径。`generation-ui.js:487`为image.generate的图片目标捕获imageSignature，应用在`:298-303`验证媒体后调用 `history.record(n,job,...)`，保留同一nodeId。
- `image-versions-core.mjs:2` 的src优先fullImage；`image-history-core.mjs:33-36` 在首次生成、原节点尚无history时，把旧src(node)创建为 `previous:image-source` 批次。`:7-8` 将该旧完整图片地址同时放入option.image/fullImage，连同既有版本、来源ID和provenance保留；保存的是对原文件的引用，不是把新结果地址写回旧记录。
- `image-history-core.mjs:38-41` 新task批次插入前端，返回新的primaryPatch加完整imageHistory；`:27-29`只更新当前主图/当前版本字段。j7旧原图仍应位于imageHistory的previous批次，而当前fullImage指向1024×512全景结果。原输入图片像素尺寸若初始节点没有pixelWidth/pixelHeight不会凭空写入旧批次，历史选择时可重新解码。
- `app.js:626-634` updateNode先remember旧节点，再Object.assign包含imageHistory的patch并保存；`:78`将完整nodes交给CanvasStore.save。`image-history-ui.mjs:26`通过primaryPatch重新选旧批次为主图。该代码证据说明本场景保留旧高清地址及历史选择路径；主任务现有reload像素证据验证了新主图持久化，尚未通过浏览器切换旧历史项来验证旧图回选。

只读审阅补充：独立 reviewer 的4个 Hunyuan 最小用例确认纯输入字段、fullImage优先以及fullImage/crop/来源对象/target.generation漂移guard；2个实际 createHistory/core + TaskService 用例确认 writeRecord=disk full 时媒体=0/provider=0，成功时原 taskId先保存历史后调用provider。generic缺Agent专用submittedTaskId关联不等于缺生成历史durable gate，没有依据声称自动重复付费。已有边界：初始来源crop仅绑定快照，不执行图片裁剪或向Hunyuan发送crop，而使用完整fullImage；sourceUrl投影没有新增这一行为。

## 隔离浏览器验收入口

```bash
node scripts/build-agent-image-processing-fixture.cjs
```

主任务首轮 CUA 确实遇到 `QuotaExceededError`：原夹具的 prefixed localStorage 写入导致初始化中止，实际请求落到真实 API 并显示 OPENAI 未配置。这说明入口路径和 namespace 本身不能证明隔离。该失败已修复并保留复现测试，不能将首轮 CUA 记为通过。

主任务现有本地 listener 上访问 `/qa/agent-image-processing-app.html?session=unique`。每个场景换 session，避免重用聊天或任务；偏好使用 page-memory localStorage，完全不读取或清理真实 origin localStorage。Canvas、assets、templates 和派生 artifacts 数据库均由 session namespace 约束，open会拒绝非namespace名称，deleteDatabase被禁止。fixture tasks/posts 保存在隔离 CanvasStore record中，用于同session重新查询；UI偏好不跨重载保存。

生成 HTML 在任何 script 前安装 CSP：connect-src 只允许 localhost/127.0.0.1 的 `/qa/` 媒体路径、精确 `/runtime-reference/skills-catalog.json` 以及 blob/data，不能使用宽泛的 `'self'`（那会允许真实 `/api`）。JS先安装拒绝所有请求的 fetch，再读取 bootstrap getter和初始化；异常时恢复拒绝，不能回退真实 API。初始化成功后的 fetch仅处理声明的API、精确技能目录GET、同源QA媒体和blob/data。CSP的浏览器实际执行仍交给主任务CUA，不以Node结构检查代替。

j2/j3仍在审批前失败；j4可见requests/errors定位到生产Agent在turn之前读取相对 `runtime-reference/skills-catalog.json`。夹具此前按location解析成 `/qa/runtime-reference/...`，而native fetch按HTML `<base href="/">`读取 `/runtime-reference/...`，被CSP拒绝。现统一按document.baseURI解析并传绝对URL，只增补GET `/runtime-reference/skills-catalog.json`这一个精确静态文件；CSP也只补这个精确文件地址，其他runtime-reference/API/POST均不放行。可见报告保留路径、方法、错误和CSP violation供浏览器复验。j2/j3/j4不能记为成功。

刷新时需要的GET `/assets/local-resource-index.json`精确返回合成 `{version:1,algorithm:'sha256-exact-utf8',entries:{}}`；不会读取本机私有资源映射，CSP也没有为它放行真实连接。DOMContentLoaded即恢复独立tasks/posts record并通知可见计数，未完成/失败时posts=null而非历史0。报告增加“收起验收数据 / 展开验收数据”按钮，只折叠pre，保留标题与其他按钮；展开高度限制40vh，避免诊断记录遮挡实际页面。

1. 默认 ask：在实际 Agent 输入请求，确认实际 pending “图片抠图”，批准后查看计数 POST=1、acknowledged=true、width=512/height=320、一条连接结果和来源不变。
2. 新 session 拒绝：POST=0、没有生成任务/结果。
3. 新 session 加 `&configured=false`：返回需要配置，POST=0。
4. 新 session 加 `&kind=angle&auto`：无需重复确认，四个显式参数仍为 -30/2/0.5/false；POST=1、高清输入、一条连接结果。
5. 同 session 重载后按原任务 ID 查询，任务 fixture 保存在隔离存储中。结果应用保存重试的不重复提交由窄测试覆盖。
6. 新 session 加 `&kind=panorama`：通过实际普通图片生成卡确认，显式 Hunyuan World Panorama / 2:1 / 单结果。生产 preparePanoramaMedia 对512×320原来源编码；POST夹具核对纯 input无sourceUrl和完整原生参数，返回真实1024×512 PNG。postsDetail中可见inputKeys与参数。普通生成已有项目生成历史dispatch gate；Agent专用 submittedTaskId callback未接该generic分支，因此全景fixture如实记录acknowledged=false，不伪称专用trace gate通过。

源图512×320、缩略图32×20与透明结果512×320为脚本生成的 PNG，分别位于 `qa/agent-image-processing-{source,thumbnail,result}.png`；build script另生成固定RGB 1024×512 `qa/agent-image-processing-panorama-result.png`，不代表模型输出。`qa/agent-image-processing-fixture.js`、controls 和生成 HTML 必须一并保留；当前 ignore 规则忽略部分 QA 文件，主任务需 scoped allowlist 或限定 force-add，避免提交缺素材的验收入口。

## 变更文件

`agent-client.js`、`agent-tools.js`、`src/features/agent-generation/image-processing.mjs`、`src/features/agent-generation/media-inputs.mjs`、`src/features/agent-execution/presentation.mjs`；三个窄测试、隔离 QA fixture/controls/HTML/PNG 与 build script。没有修改全景/视频适配、共享路由配置或其他 owner 的 model/card/batch。root另授权将主Agent固定欢迎“Hi New Tapper!”改为“你好，创作者！”，不涉及用户名称或兼容存储key。生成HTML由builder重建并继续忽略；提交仅需限定allowlist六个QA源码/PNG（fixture.js、controls.mjs、source.png、thumbnail.png、result.png、panorama-result.png）。
