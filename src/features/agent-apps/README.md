# Agent MCP Apps 卡片

官方参考与证据：`reference/mcp-picker-template-handoff.md`、`reference/agent-apps-20260930.md`。与自由 HTML/Widget 的 `agent-widgets` 分离；应用模板和协议不是任意代码执行接口。

## 模块边界

- `registry.mjs`：十六个已接通的版本 URI、模板 ID 范围、展示策略与状态校验。
- `director-markup.mjs`：真实剧本文本输入、官方 DM1 批注解码、已保存正文/位置/批注核对与稳定交接 ID。
- `performance-rhythm.mjs`：固定时长、实际驱动力曲线/节拍与PS1确认核对，合同见 [表演节奏](PERFORMANCE-RHYTHM.md)。
- `story-room.mjs`：来源场景、按幕排列、新增/废弃与NS1确认核对，合同见 [剧本结构板](STORY-ROOM.md)。
- `actor-emotion.mjs`：人物与真实媒体来源、面部/声音状态、灰模指导图片与AE2确认核对，合同见 [人物情绪导演台](ACTOR-EMOTION.md)。
- `production-progress.mjs`、`production-progress-runtime.mjs`：真实生成任务回执、当前 `GenerationAPI.getJobs()` 只读投影、已应用结果与真实图片/视频字节预览；多结果优先展开实际占位/结果节点，来源任务卡需全部实际结果存在才可完成。
- `interactive-learning.mjs`：学习目录/五题学习板、真实保存状态与精确 IL1 队列交接，合同见 [互动学习](INTERACTIVE-LEARNING.md)。
- `library-picker.mjs`、`library-picker-runtime.mjs`：真实个人库查询、来源绑定、引用与实际入图；团队库不在本地接线范围。
- `color-adjust.mjs`、`color-adjust-runtime.mjs`：官方18参数像素变换、真实图片预览/PNG输出、已保存输出回执与官方上下文文案核验。
- `platform-resize.mjs`、`platform-resize-runtime.mjs`：真实图片尺寸与千分比裁切、指定平台规格、真实PNG批量入图及幂等回执。
- `cutlist-review.mjs`、`cutlist-review-runtime.mjs`：真实视频解码/哈希、源时基裁切提案、保存状态与精确CR1正常队列交接。
- `character-blocking.mjs`、`character-blocking-runtime.mjs`：真实人物引用与局部头像裁图、positions/facings保存、精确CB3与真实来源交接，见[人物站位合同](CHARACTER-BLOCKING.md)。
- `product-kit.mjs`、`product-kit-runtime.mjs`：真实产品源图、配色/调性/禁令与规格确认、精确PK1及来源绑定，见[产品素材合同](product-kit.md)。
- `ad-review.mjs`、`ad-review-runtime.mjs`：真实图片/视频与审核阶段、marks/notes保存、精确AR1及来源绑定，见[广告审核合同](AD-REVIEW.md)。
- `integration.mjs`：会话/trace身份、卡片复用、保存与正常消息队列适配。
- `host.mjs`：JSON-RPC握手、nonce/source、状态回执、运行状态与展示通知。相同host context/run不重发，避免官方模板清空暂停状态。
- `card.mjs`、`styles.css`、`icons.mjs`：官方标题栏/图标、加载与失败、重载、展开和焦点恢复；重载不重提生成任务。
- `resources/`：安装包manifest与原HTML模板、受限本地proxy及明确的传输兼容修正。包含文件不等于对应工具工作流已实现。

## show_app 合同

Purpose：在Agent会话显示十六个已集成官方应用：三个选择器、导演批注、表演节奏、剧本结构、人物情绪、制作进度、互动学习、个人素材选择、调色、平台裁切、拼装审阅、人物站位、产品素材板和广告审核。可编辑应用保存实际状态并通过正常消息队列交接；制作进度只读取真实制作任务。

Inputs：三个选择器 `resource_uri`（motion-picker@v1、creative-picker@v1、website-design-picker@v1），可选title、original_request、recommended_template_id。另外十三个工作流使用各自data（素材选择可省略data），拒绝混用模板选择参数及任意工具参数：

- director-markup@v1：`data:{draft,locale?}`，正文非空且最多8000 UTF-16字符，支持中/英/日/韩/法。
- performance-rhythm@v3：固定duration_ms、真实scene、曲线点curve和节拍beats，详见 [输入与状态合同](PERFORMANCE-RHYTHM.md)。
- story-room@v1：实际acts/scenes/plotlines/causal_links，详见 [来源与结构合同](STORY-ROOM.md)。
- actor-emotion@v1：当前项目真实source、actor参考图片与绑定、face及视频模式可选voice/dialogue，详见 [媒体与人物合同](ACTOR-EMOTION.md)。
- production-progress@v1：`data:{node_ids,project_id?}`。宿主要求当前会话真实已提交的图片/视频任务，绑定实际taskId和项目；Agent不能提供items、完成状态、百分比或预览URL。当前任务尚未应用或未知时不会标为完成；刷新不会自行恢复或重发任务。
- interactive-learning@v1：`data.view=syllabus` 时为真实course/chapters，`board` 时为level及q2/q3/q4/q5题目、hints、可选初始进度。保存后核对精确IL1再进入普通队列；自评标记不代表模型判分或已经学会。
- library-picker@v1：可选 `data:{applied:{types},can_add_to_canvas}`。宿主从实时 `CanvasLibrary.items/folders` 读取个人库，拒绝Agent提供素材/文件夹/URL、拒绝团队scope；缺getter明确失败，不能用空库掩盖读取失败。

- color-adjust@v2：`data:{node_ref,params?,suggested?,locale?}`，真实图片节点，18个参数为整数；fade/rolloff为0..100，其余为-100..100。suggested只接受exposure/temperature/tint，宿主不会伪造建议；预览只由真实图像生成。官方state是18参数加active_tab与advanced_open的平坦对象。
- platform-resize@v1：`data:{image_id,platforms,project_id?,locale?}`；platforms必须1..16个唯一实际规格，每项platform、label_zh、label_en、ratio_id（r_W_H），可选selected。宿主读取真实图片尺寸后计算千分比最大取景范围，Agent不能提供preview、尺寸或裁切结果。
- cutlist-review@v1：`data:{shots,locale?,ratio?,notes?,target_duration_s?}`，每项真实视频节点id、label、实际media_duration_ms、in_ms、out_ms、default_keep，可选trim_reason、flag、flag_note。源时长与实际解码毫秒核验；预览由宿主读取完整有界视频并写入data:video。原视频已裁切状态需先用现有video_trim导出完整结果，不能误用源视频。

- character-blocking@v3：`data:{locale?,target,aspect_ratio,scene,characters}`；人物使用真实文本与整数千分比x/y、可选facing及`portrait_source:{node_ref,crop?}`，宿主从实际本地图片裁图；禁止模型传portrait/URL/字节，详见[合同](CHARACTER-BLOCKING.md)。
- product-kit@v1：`data:{node_ref,version,locale,variant,product,kit_version,updated_at,palette,tones,look,bans,copy,hypotheses,plan_attached?,summary}`；模型product只含name/category/price_band，缩略图由宿主真实解码产生，详见[合同](product-kit.md)。
- ad-review@v1：`data:{locale?,stage,batch,items}`；stage为frame_cull/pilot_review/final_review，items使用实际node_ref、combo、media和官方文本；不接受模型preview/poster/URL/字节，详见[合同](AD-REVIEW.md)。

Outputs：本地`kind:mcp_app`展示回执；选择或已核对的编辑结果通过`ui/message`进入新的用户回合，保留原官方协议、可读结果、`widgetOrigin`与handoffId。打开应用、采用节奏/结构或确认人物情绪均不等于生成授权。

Permissions：`sandbox=allow-scripts`双iframe；只对manifest与带版本hash的静态HTML开放匿名跨源读取。API继续拒绝Origin:null。消息与写入来源需当前会话、存活trace、对应iframe、nonce及真实当前用户动作；制作进度只读轮询不需用户动作，个人库被动查询仅允许恢复已实际保存的query/folder；它不是精确意图的密码学证明。应用消息不扩大工具权限，后续画布修改和生成仍经过正常流程。

人物应用的`tools/call`仅接受actor-emotion@v1的`actor_emotion_save_expression_guide`，受该应用、当前人物绑定、真实来源节点、参考图片、已提交面部状态及调用ID约束。宿主核对并实际解码官方灰模捕获的512×512 PNG/WebP，保存本地素材、创建真实图节点、提交画布及会话后，才返回真实`node_ref/guide_sha256/binding/face`回执。确认时再次核对图片字节哈希、节点来源及当前保存状态；节点被删除、撤销或改动后旧回执失效。此接口不能调用任意工具，也不提交人物媒体生成。图片已入图但后续会话保存失败时，回执/队列明确失败，可见图节点可能保留，不能宣称整个画布操作已撤销。

各应用的专属窄方法：

- actor-emotion@v1：`tools/call` → `actor_emotion_save_expression_guide`，真实指导图片保存后才给回执。
- production-progress@v1：`tools/call` → `get_production_result`。核对同顺序node_ids/project_id与真实生成trace，始终只读；官方SDK只带progressToken时合法，不强加人物写回专属callId。只有provider succeeded、应用已提交、实际结果节点仍存在且媒体与job.outputs/生成provenance一致时才能done。真实图片按有界字节或实际缩放像素转为data:image；视频先实际解码宽高/时长，再把完整有界字节转为data:video/mp4或webm，在官方video标签播放。仅此资源使用本地 `production-progress-proxy.html` 传输副本：只允许production-progress@v1，media-src增加data:，保留双opaque iframe、scripts-only和connect-src none，忽略网络域输入；官方页面原字节保留；共享 `mcp-app-proxy.html` 仅对product-kit执行下文所述SHA核验后的窄传输修正。单图读取上限8MiB、单视频8MiB、每次读取总量16MiB、缓存/整页媒体文本15MiB、host仅此专属查询回执上限16MiB，整次读取/解码30秒；流式核对声明与实际字节，超时、来源失效或关闭立即中止，重复轮询复用有界缓存。视频超限时有已证明属于该实际输出的poster才提供明确“首帧预览（非完整播放）”；否则保留真实已应用状态，注明“预览超限，未加载播放”，不能假称可播或改变原任务。读取失败或来源变化不给虚假完成预览。没有状态保存或ui/message。
- library-picker@v1：`tools/call` → `find_library_assets`；`ui/update-model-context` 绑定当前可见真实资产；`tapnow/addToCanvas` 只能导入宿主选定资产的真实媒体，实际画布与会话保存后返回node_ref。普通搜索、上下文更新、入图检查当前iframe动作；被动搜索只可恢复已存浏览位置。所有异步阶段核对本次iframe代次/状态/项目，禁止工具泛化。
- interactive-learning@v1：无专属tools/call；学习板通过 `tapnow/setWidgetState` 保存，精确IL1通过 `ui/message` 进入正常队列；目录无需编辑状态。

个人库引用从runtime核验后的资产生成内部 `libraryReference`，client将其写成 `referenceMention` 到本次队列composerDoc。正常 `runSubmission` 经 `resolveReferenceData` 取真实个人库项目并由 `prepareMediaInputs` 读取图片/视频帧送入模型，不能把 `library://private/<id>` 当成可访问媒体。开始执行前以及实际媒体读取后再次核验原show_app来源绑定SHA256；排队后同ID换媒体会明确失败。此引用不扩大生成或其他写入权限。

Failure modes：非法资源、初始化超时、保存失败、过期来源、不支持方法均明确失败。除本应用以上专属方法之外的tools/call、结构化appReply、任意model context等未实现方法返回JSON-RPC错误；真实图片、画布保存和会话回执必须分别成立。

Logging：会话保存show_app trace、appState、appHandoffs与widgetOrigin；handoff去重与队列同一次提交，失败回滚，不覆盖输入草稿。工作流保留原DM1/PS1/NS1/AE2/CB3/PK1/AR1及核对后的可读内容；稳定内容SHA256交接ID用于同来源页重复确认去重。人物应用另保留实际指导图片回执、来源快照与字节哈希。任意KEY只放服务端。

生产应用状态与消息回执均等待对话 IndexedDB 事务实际提交；保存期间暂锁应用入队、队列编辑和发送，避免消费未确认的消息。提交失败撤销本次状态、队列项及去重身份，不改输入草稿或其他队列项。提交后再次核对会话、trace、资源、保存状态和 iframe 代次；保存期间切换来源或重载时，撤销该入队并等待补偿保存。补偿保存失败明确提示未能保存撤销结果，保留 unsaved 状态且不启动模型。

Story Room、人物情绪、互动学习板、个人素材页、人物站位、产品素材板和广告审核缺少已存状态时，controller在onReady通过正常保存链提交初始状态，不能把默认显示冒充持久保存。初始提交与后续状态写入按卡片串行，确认和指导图片保存先等待该链；异步期间重新核对trace/result/response、状态身份和来源代次，失败保持明确错误。

Tests：host/card/registry、各工作流协议/来源/保存、widget queue与stream聚焦回归。`agent-apps-batch-integration.test.cjs` 覆盖三应用工具白名单、官方仅progressToken的只读轮询、学习板真实保存前禁止IL1入队、真实个人库referenceMention进入媒体输入、多结果状态和媒体读取期间来源失效，另覆盖流读取的声明/实际字节预算、HTTP失败流取消、超时/关闭中止、专用proxy隔离以及真实本地MP4字节往返。Node测试的媒体解码采用明确桩，实际播放须独立浏览器验收。此前选择器手工验收使用真实OpenAI SDK和本机固定HTTP响应；本批确定性验收页使用生产prepareApp/controller/host，未调用外部模型。

本批实际浏览器已验证：表演节拍改到3.4s、强度3、填写备注并请求对白检查，实际排队1次，刷新和重复确认保持1次；Story Room新增「雨夜核对录音」，NS1交接保留2幕4场，实际排队1次并刷新恢复；人物原UI展开、悲伤→坚定灰模实际变化，保存真实指导图片1份并排队1次。尚未验收曲线拖动、跨幕拖拽、人物语音全部分支或完整同视口视觉；这些局部通过不能代表全部交互或真实模型能力通过。

## 尚未完成

对照当前manifest与registry，版本URI已接16/22，功能族已接16/20。未接的四族为animatic、ecommerce-photoset、layer-composer、previs；另保留未接历史URI animatic@v1和character-blocking@v1，不算两个新增功能族。完整艺术/硬件模板逐项交互、精确模板文件获取/哈希校验/产物编辑链仍待补齐。计数仅证明接线存在，不能作为完整视觉、交互、真实生成或本地化验收。有KEY也不能自动补齐尚未实现的工作流。应用交接已按官方hidden标志隐藏聊天行，原文和widgetOrigin仍保留于历史，修改工具仍需正常确认；运行中不接受新的应用交接。验收见 `reference/agent-hidden-handoff-20260930.md`。

## 导演画线批注

```json
{"resource_uri":"ui://tapnow/director-markup@v1","title":"雨夜剧本批注","data":{"draft":"林岚推开木门，停在雨里。","locale":"zh-CN"}}
```

直接使用未修改的安装包 `director-markup@v1.4b53a29e.html`。官方 `Rm/q_/J_/H_/Cm/V_` 定义初始数据、可恢复状态、UTF-16坐标和DM1确认；官方宿主 `Bue` 对此资源使用默认不展开策略，无外部媒体白名单。用户可改正文、选择文字添加镜头/运镜、句间插入切镜/情绪、删除批注；编辑覆盖原位置时必须修复失去位置的批注才可确认。

页面先保存最新状态，再确认交接。宿主解码单次正文编辑和紧凑批注，核对已保存正文及实际位置/类型/内容，补充可读正文和批注后通过正常队列请求Agent整理提示词。未保存、失去位置、空批注、拆开emoji的坐标、异步期间来源切换或状态变化均拒绝交接。该确认不触发视频生成，不开放tools/call。状态按UTF-8字节限制128KiB，普通选择器保持64KiB；官方DM1及最终可读交接均保留有界长度，超限需缩短内容。

确定性验收页：`/src/features/agent-apps/qa/director-markup.html`，使用生产registry/controller/host和原始官方页，专用IndexedDB保存真实操作及去重队列，等待事务提交才返回成功。初始读取完成前禁用操作；本页不修改其他画布或清理任何存储。页面显式注明未调用模型。源代码生成的DM1、四类批注、正文编辑、emoji/失效拒绝、重复确认ID与状态容量已有聚焦测试；浏览器和真实模型能力仍须分别验收。

```sh
node --test tests/agent-director-markup.test.cjs tests/agent-app-host.test.cjs tests/agent-app-registry.test.cjs tests/agent-app-card.test.cjs
```

## 三个编辑工作流的写入边界

- color-adjust@v2仅允许`tools/call → color_adjust_apply({node_ref,params})`、平坦state、官方固定Skip消息及`ui/update-model-context`。完整18参数取自当次实际Apply，官方400ms延迟state不会否定刚提交的参数。成功保存真实PNG节点、画布和会话回执后，宿主授予一次仅供当前Apply的上下文许可；官方await后不要求仍有瞬时用户激活。上下文必须与当前已保存输出和官方文案精确一致，不自动启动模型。后续模型回合读取有界历史回执，生成仍需正常授权。
- platform-resize@v1仅允许`tools/call → resize_for_platform_apply({image_id,project_id?,crops:[{platform,x,y,w,h}]})`，禁止state、message和model-context。x/y/w/h为千分比整数，宿主核验页面尺寸、平台顺序、重复宽高比和来源。真实裁切图片批次单次入图/撤销，保存后才返回实际node_refs；callId重试复用回执，不重复插图。
- cutlist-review@v1只允许保存`{shots:{[id]:{keep,in_ms,out_ms}}}`及官方message，无服务端工具。默认state保存核验当前来源，提交消息前重新读实际视频SHA，不逐次重复视频解码。精确CR1是后续普通用户回合中的审阅提案，不是自动拼装或生成授权。本地executor通过正常画布修改工具`cutlist_assemble`调用，仍不注册给iframe。审核确认后只保存提案，实际拼装需通过该工具的正常修改确认。

三个应用仍核对当前会话、trace/result/response、iframe/nonce、项目、真实来源以及运行状态。调色/平台裁切要求当前用户动作；调色的延迟上下文仅继承刚完成的那次Apply窄许可。新资源不能调用其他资源专属方法。图片输出已保留但会话提交失败时明确报错；不能声称整体撤销或伪造成功。凭据只留服务端，官方HTML原字节保留；共享proxy仅有下文列明的product-kit传输修正。

拼装审阅使用仅允许cutlist-review@v1的专属`cutlist-review-proxy.html`，开放有界data:video，保留双opaque iframe、scripts-only及connect-src none；单视频8MiB、总读取16MiB、整页响应15MiB、30秒超时。host仅cutlist-review与ad-review资源tool-result接受16MiB，关闭立即取消读取。颜色tool-result单独2MiB容纳实际512边预览；其他资源沿用原限制。

`projectAppModelResult`只作用于模型续轮和持久恢复回执：删除preview/preview_url/media_url/poster_url/thumbnail_url/portrait和宿主SourceContext，保留应用数据与真实来源ID。iframe和UI trace仍保留真实预览字节，数据不会全文塞进模型history。

验证：`node --test tests/agent-apps-edit-integration.test.cjs tests/agent-apps-batch-integration.test.cjs`。专项像素/裁切/视频/回执持久化测试与QA由各工作流模块提供。

## cutlist_assemble 正常执行工具

Purpose：从实际已接受的拼装审阅交接执行本地裁剪和固定顺序拼装，写入真实视频节点。

Inputs：仅`{trace_id,handoff_id,operation_id}`。trace_id须当前会话的已完成cutlist-review展示记录；handoff_id须该记录实际已保存的cutlist_ SHA256；operation_id为稳定操作标识，重试使用同一标识。模型不能提供message、response、state或authorization。

Outputs：已保存的真实视频节点nodeIds、解码时长/尺寸、媒体SHA256、operationId以及绑定的trace_id/handoff_id。画布保存成功但会话记录失败时明确说明实际节点保留；会话回执按CAS撤销本次写入并持久补偿，不覆盖后续成功回执，补偿失败明确报错；没有真实产物回执不返回成功。

Permissions：`mutates:true`，沿正常executeTracedCall修改确认；由审核应用触发的下一回合仍固定要求确认。生产execute回调在正常确认之后传递宿主内部批准标志，模型参数没有授权字段。审核交接本身不自动执行、不代表生成授权。

Failure modes：未完成或非当前show_app、未持久接受的widgetOrigin、缺appHandoffs、CR1/完整交接正文/当前已存state不匹配、项目/来源字节/源节点变化、运行期间交接变更、超限、解码或保存失败均拒绝。现有已保存计划变更需重新审核；不默默重建被修改/删除的产物。

Logging：原show_app记录cutlistAssemblyReceipts，正常执行trace记录真实工具输出，当前会话持久化。后续普通模型回合通过有界历史回执读取，历史记录不当作新授权。

Tests：集成测试涵盖正常mutation确认/拒绝、只接受三项identity参数、真实user/queue交接、无审核及state变化拒绝、stable operation重试、不接收晚回执；实际FFmpeg/媒体解码和保存由cutlist专项runtime测试验证。


## 人物站位、产品素材与广告审核的本地交接

三应用均由runtime执行`prepareAppArgs → bindPreparedResult → capture`。原应用页面接收真实本地预览；模型回执剥除预览字节与宿主来源快照。初始及编辑状态按卡片串行保存，确认等待最新stateWork；精确官方消息经runtime.reply附真实node_ref/媒体SHA/项目，再保存为普通用户队列。保存前后、确认期间和队列实际flush后异步核验来源；同步isCurrent核对会话、trace/result/response与保存状态身份。失败撤销本次队列/handoff并补偿保存，不启动模型。三类没有iframe tools/call或model-context能力；打开与确认不提交生成，后续生成使用正常已配置API工具与权限。

character-blocking使用原官方HTML和默认本地图片CSP。product-kit磁盘原HTML不变；共享proxy仅在完整源SHA匹配且校验目标唯一时，把thumbnail_url的HTTPS校验窄替换成有界本地data:image校验，保留其余UI和脚本。ad-review使用仅允许ad-review@v1的`ad-review-proxy.html`：本地data/blob图片与视频、connect-src none、opaque scripts-only双iframe；单项8MiB、总读取16MiB、整页15MiB、30秒，host响应16MiB。人物站位和产品素材仍使用默认1,000,000字节host限制，并各有更小的预览限额。

本批共同接线相关37项检查通过；其中新增7项覆盖严格输入、模型预览剥除、保存等待/失败拒绝、来源变化及真实queue补偿。Node媒体解码存在明确测试桩，不能替代浏览器或真实模型验收。根任务已在实际浏览器核验站位真实头像、video/9:16、X310/facing96、CB3一次交接、reload恢复及保存失败无新队列；产品素材以真实本地camera图片856×558核验砂岩配色、双调性、PK1一次交接、来源SHA和真实reload恢复。人物鼠标拖动、产品拖动尚未验收；广告审核实际浏览器已验证中文首帧keep/cull与备注净化、英文试拍win/pass_over、日语成片keep/rework/win，三阶段累计3条可信node_ref/SHA交接；重复确认、刷新恢复、运行中拒绝和真实替换PNG后旧来源拒绝均通过。真实本地视频解码为320×180/8秒，readyState4并实际原生播放；后续模型生成与投放效果未验。正式首页Agent已实际加载且本轮console无warn/error；QA使用生产接线与本地保存，不是实际模型联调。以上均为局部证据，不等于全部交互、媒体生成或投放效果通过。
