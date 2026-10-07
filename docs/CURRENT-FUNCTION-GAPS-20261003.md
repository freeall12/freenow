# 当前有效功能缺口 · 2026-10-03

本清单首先记录本轮开始时的只读审计；下方保留初始依据，最新状态以本段及对应验收文档为准。`REPLICA-COVERAGE.md` 的覆盖表与日期回路、`AGENT-WORKFLOW-INVENTORY-20261003.md` 早期10/22快照，以及其他阶段报告均保留历史证据；其中“待补”不能直接当作当前待开发任务。

已实现旧学习卡三个预览槽的本地迁移，真实浏览器解码、刷新和未知资源保留已验，见[迁移验收](INTERACTIVE-LEARNING-PREVIEW-MIGRATION.md)。字幕结果合同及画布事务已接入；已有恢复节点没有原绑定收据时保留现有字幕、不盲目重绑定。

已补普通音频原节点完成、全部输出保留、首项字幕绑定及播放遮挡修复；分组已接本地持久恢复、原任务查询、显式继续和停止。实际浏览器刷新、第二页面锁、404不重发、完成回执失败恢复已验，见[该批验收与限制](LOCAL-AUDIO-AND-WORKFLOW-RECOVERY-20261003.md)。下方三项为历史审计依据，不能再次列为尚未实施。全站状态一致性、精确模板和真实供应商仍开放；SPZ 最新范围见下方。

## 已有实现，不重复开发

2026-10-08 补充：[音频空白拖动](AUDIO-PLAYER-GESTURES-20261008.md)、[普通节点直接标题编辑](../src/features/canvas-node-titles/README.md)和[搜索焦点 Enter](CANVAS-SEARCH-KEYBOARD-20261008.md)已接入并按各自范围实机验证，不能继续列为未实现。标题控件首次选中才创建，减少 DOM 开销但不证明整体 FPS。模板编辑器已有本标签页草稿和冲突保护，保存失败保留/实际回读已验；刷新恢复仍仅有定向检查，[来源复查](research/agent-template-source-followup-20261008.md)未新增92份精确正文。

2026-10-07 补充：[Sonilo 原生 SFX](SONILO-SFX-NATIVE-20261005.md)已实现文字/完整视频音效及连续分段，20 项定向检查和 4 项受影响 Music 回归通过；不能再将“原生 SFX 未接入”当作当前缺口。8秒视频与0.5秒Agent文字音效已实机播放、刷新恢复；全部非法操作组合与真实账号/音质仍待验，stems、语音保留、ducking 未实现。[本批状态](STATUS.md)区分源码与实际界面范围。

2026-10-05 / 1005p补充：[Sonilo原生Music](SONILO-NATIVE-20261005.md)现已按完整官方开发者合同实现本地MP4直传、文字/视频音乐、精确分段与多变体，不再将“Sonilo音乐/分段”列为未实现。正式节点/Agent、媒体归档、历史第二项、缺配置零提交和同库重开已有[本批实机证据](LOCAL-SONILO-AGENT-AND-HISTORY-20261005.md)。该批时 Sonilo SFX/stems/语音保留/ducking及真实供应商仍开放；SFX 当前接入见上方 2026-10-07 补充。Product Kit、Director Markup保存/交接/关闭与长历史DOM更新亦已补齐并定向验证，不能等同全部状态或视觉验收。

2026-10-05 / 1005o补充：[Agent首次识别及恢复](LOCAL-AGENT-SEGMENTATION-AND-EXPORTS-20261005.md)已实机验证独立确认、来源漂移拒绝、同素材重存与原Agent回执闭环、换clip后取消、同库重启后显式补发唯一未派发分支；本地封面解析、视频规格焦点/滚轮与Widget实际PNG/MP4/WebM下载亦已验。合成供应商证明本地流程，真实识别质量仍待Key验收；HTML独立离线重开和92份精确模板正文仍开放。

2026-10-05 / 1005m补充：[分组/多选复制粘贴](CANVAS-GROUP-COPY-PASTE-20261005.md)已验父子绝对几何、入边保留/出边排除、清图库/运行归属、连续粘贴、⌘D与撤销；[拼装审阅](AGENT-CUTLIST-REVIEW-INTERACTIONS-20261005.md)已验裁切/保留、同快照确认、复原再改、关闭失败重试与刷新。普通单节点[副本](CANVAS-SINGLE-DUPLICATE-20261005.md)、[人物走位](AGENT-CHARACTER-BLOCKING-INTERACTIONS-20261005.md)、[视频延长生命周期](VIDEO-EXTENSION-LIFECYCLE-20261005.md)亦已有前批证据。其他节点组合、应用全部状态/语言和真实供应商仍需逐项核对。

用户已批准 Spark 2.3.1，预算内 SPZ 已完成真实解码、预览、片场保存/撤销、照片与2秒视频；[混合拾取](SPZ-MIXED-PICKING-20261005.md)及[原生tiny-lod](SPZ-LOD-20261005.md)已实机验证。不能再将依赖授权、基础渲染、普通混合遮挡或LOD列为尚未实现。LOD最多25万参与绘制/排序，不减少全量解码或驻留数据；仍需多设备压力、长视频、复杂半透明、按页流式加载及真实Marble生成/碰撞对齐验收。前批已补[视频深度普通节点、双结果、布局和恢复](LOCAL-DEPTH-BATCH-AND-CANVAS-20261005.md)。

2026-10-05 / 1005n 视频蒙层补充：[Wan VACE编辑](WAN-VACE-VIDEO-MASK-NATIVE-20261005.md)和[Replicate SAM2首次识别](REPLICATE-SAM2-NATIVE-20261005.md)均已有独立原生适配。后者真实双向片段、PNG/RLE、持久任务、保存恢复、前端守卫与本机整链已实现；需独立Replicate Token，不能用fal Key代替。原fal候选的[RLE合同缺口](VIDEO-SEGMENTATION-FAL-CONTRACT-20261005.md)保留。真实供应商账号、线上RGB H.264兼容、PNG/跟踪质量及双向首帧一致率仍未验；[本批实机范围](LOCAL-SAM2-AND-BLOCKING-20261005.md)不等于所有模型可用。

2026-10-05补充：[视频工具与存储批次](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)已接 ThinkSound 单视频拟音、Toolbar 延长镜头参考生成、个人素材库IndexedDB容量迁移、模板离页保护及嵌套制作进度卡品牌。该批时Sonilo音乐/分段尚未接入，现已由上方1005p补齐；Ark本地视频公网传输、Sonilo其他原生能力、92份HTML原文与真实Key验收仍开放；不要将新增适配简化为“所有菜单仅填Key即可”。

- 当前 `agent-apps/registry.mjs` 已登记官方 manifest 全部22个版本URI、20个功能族，包括历史 animatic v1 / character-blocking v1；Creative 已接受严格 family 参数及拒绝退役A05推荐。登记不等于全部状态/视觉验收。
- `show_form` 的九类字段、新用户轮提交合同；Seedance 样片→正式片专用引用/投影；Agent 父子检查点与终态委派结果核对后继续，均已有生产入口。
- HTML讨论、内层Escape、本地正文编辑与CAS保存；文本原子引用、共享音色目录/试听；图片/视频/音频旧节点文件导入修复；生成媒体实际本机归档均已有专项代码和最新文档。
- 92份精确模板正文仍有资源缺口，不把已存在的本地模板编辑器重新列为缺失；SPZ/Spark 依赖授权与基础渲染已按上方最新记录补齐。

## 本轮开始时核实的三项（保留初始依据）

### P1：Seed音频字幕结果→文本节点闭环

**当前入口：** `audio-ui.js:101` 已有 `enable_subtitle` 开关；`generation-ui.js:145` 的 `applyResults` 仅处理通用标准输出，无字幕角色或 `sourceAudioNodeId` 更新逻辑。`server/generation-durable.cjs` / `generation-media-materializer.cjs` 的标准输出字段不接原站 `outputs.subtitle` 对象。开关可保存不代表字幕产物已实现。

**官方依据：** 可追溯官方包 `reference/vendor-pkg-canvas-CvuTKiTt.js` 的 `WQ` 完成回调：只在Seed模型且 `enable_subtitle===true` 时读取 `H.outputs?.subtitle`，调用 `h(x,W)`。`h` 对空 `text` 不操作；已有 `Q.TEXT && data.sourceAudioNodeId===音频ID` 则更新正文，否则在音频右侧 `(width??300)+80` 创建标题为 `audio.seedAudio.subtitleNodeTitle` 的纯文本节点并连边。`reference/audio-nodes.md` 记录其源码来源；不是凭字幕翻译词猜出的需求。

**最小实现：** 定义配置供应商实际字幕文本到本地标准结果的窄适配，明确字幕角色与宿主源音频身份；可复用现有text输出载体，但不能将任意附加text自动当字幕。UI/Agent共用结果应用路径，在真实音频结果有效且保存后更新或创建一份字幕节点/边，按原taskId及来源版本去重，保护取消、换源、撤销和保存失败；字幕缺失/空白保持无字幕，不能抄prompt伪造。不新增字幕编辑器、烧录或新的语音模型。缺供应商配置仍明确未派发。

### P1：旧互动学习卡三个预览字段的精确本地迁移

**当前入口：** `src/features/local-resource-migration/conversations.mjs:30` 仅遍历uploads并调用人物预览helper；`project-context.js:68` 的App字段修改证明只白名单 actor.reference_nodes[].preview_url。没有互动学习 `result.response.level.preview_url / learner_preview_url / contrast_url` 的迁移器。`agent-apps/interactive-learning.mjs:23` 现在只接受有界data-image，因此旧远程预览卡不能靠现有附件迁移变成合法本地卡。

**官方依据：** 原官方 `interactive-learning@v1.cd0bb18c.html` 学习板实际读取level三个预览字段，展示目标图、学习者结果与对照图；已保留原文件及本地模块合同 `INTERACTIVE-LEARNING.md`。离线化需保留这一显示功能，不放回原站网络权限。

**最小实现：** 先仅支持合法done show_app且请求/结果URI同为interactive-learning@v1、view为board的三个精确图片槽位。复用现有完整原URL摘要索引、有界本机字节/SHA/MIME与真实图片解码、会话CAS及保存守卫；转换后完整校验学习板并证明其他字段未改。保留done/drafts、原调用、handoff和任务身份，不重授权旧交接；未知资源报告待导入而不联网回源。其他App纹理、通用appState与恢复日志不作递归URL替换。此批只补恢复显示，不扩展学习评分/生成流程。

### P1（后续批次）：分组工作流持久恢复

**当前入口：** `workflow-ui.js:3` 的runs仅为页面内存Map；`prepare` 的tracked/member基线与execute闭包不持久。`workflow-core.js` 的Execution只保留当前层/完成/错误；`agent-client.js` 的workflow_status直接读取此Map。生成任务本身与Agent父子检查点可恢复，不能恢复已经丢失的分组调度身份和下一层。

**官方依据：** `reference/workflow-templates.md` 追溯官方 `vendor-pkg-canvas-CvuTKiTt.js` 的Bu/A3e/J3e：依赖分层、同层并行、每节点一个结果、整层完成才进下一层、错误停止后续、stop不取消已发任务。这些调度语义须继续保持。刷新后恢复属于本地可靠交付补齐，不能宣称已经捕获官方同名恢复界面。

**实施范围：** 单独先制定完整恢复合同，记录项目/分组身份、图与来源版本、层计划、逐节点原taskId/提交状态/已应用回执及stop标志。刷新后先GET核对原任务和当前图，仅恢复可证明的回填；unknown不重POST，来源失效保持阻断，未派发层必须显式继续。复用已有任务存储/查询能力，不把整个workflow_run重跑当恢复。需要覆盖提交前、提交未知、供应商完成、画布保存及层边界；不作为本轮小改动直接实施。

## 本轮不扩张的范围

新版镜头光学写入：`AGENT-STUDIO-SETTINGS.md` 明确本次官方新版无焦距/光圈/对焦/景深写入控件，旧版光学不能直接推导新版需求。自定义音色训练：官方D5z包虽有上传/录音UI，但当前 `yz` 确认回调仅返回上页，未证明音色训练/创建API；本地已有音色目录不能据此扩成未确认的付费接口。

完整同态视觉、拖动/hover组合、真实供应商质量仍是验收项；不要把“未验收”写成“代码未实现”。后续继续逐项关闭剩余资源、完整交互及性能证据，不重复开发本页已实现项目。

最新增量：独立 OpenAI 蒙版编辑、ElevenLabs 音效、音频数字输入关闭保护、布局索引与片场目录/分页焦点已实现，并经定向 Computer Use。见[本批记录](LOCAL-MASKED-SOUND-AND-PERFORMANCE-20261003.md)。保留全部未验收项，不能以此次接口补齐宣称全站只填 Key 即全部可用。
