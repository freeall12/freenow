# 当前有效功能缺口 · 2026-10-03

本清单首先记录本轮开始时的只读审计；下方保留初始依据，最新状态以本段及对应验收文档为准。`REPLICA-COVERAGE.md` 的覆盖表与日期回路、`AGENT-WORKFLOW-INVENTORY-20261003.md` 早期10/22快照，以及其他阶段报告均保留历史证据；其中“待补”不能直接当作当前待开发任务。

本批已实现旧学习卡三个预览槽的本地迁移，真实浏览器解码、刷新和未知资源保留已验，见[迁移验收](INTERACTIVE-LEARNING-PREVIEW-MIGRATION.md)。字幕结果合同及画布事务已接入，范围包含明确新结果及同页重试；已有恢复节点没有原绑定收据时保留现有字幕、不盲目重绑定。普通音频仍生成新结果节点，而官方原地完成音频的差异保留为待补，不把字幕接线等同整个音频行为一致。分组调度持久恢复仍未实施。

## 已有实现，不重复开发

- 当前 `agent-apps/registry.mjs` 已登记官方 manifest 全部22个版本URI、20个功能族，包括历史 animatic v1 / character-blocking v1；Creative 已接受严格 family 参数及拒绝退役A05推荐。登记不等于全部状态/视觉验收。
- `show_form` 的九类字段、新用户轮提交合同；Seedance 样片→正式片专用引用/投影；Agent 父子检查点与终态委派结果核对后继续，均已有生产入口。
- HTML讨论、内层Escape、本地正文编辑与CAS保存；文本原子引用、共享音色目录/试听；图片/视频/音频旧节点文件导入修复；生成媒体实际本机归档均已有专项代码和最新文档。
- 92份精确模板正文与SPZ/Spark依赖授权是已知外部/资源阻塞，本轮不再次穷尽查找，也不把已存在的本地模板编辑器重新列为缺失。

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

完整同态视觉、拖动/hover组合、真实供应商质量仍是验收项；不要把“未验收”写成“代码未实现”。建议最小下一批优先字幕回填或学习预览迁移，分组恢复在独立完整合同后推进。
