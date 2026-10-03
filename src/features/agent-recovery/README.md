# 中断任务核对与显式继续

`agent-client.js` 在发送前将 `activeRun`（submissionId、开始时间、project/conversation/submission 绑定）写入本项目的 `agent-conversations:<projectId>` 记录。收到流式 session 身份后立即保存 sessionId；刷新、离页、取消或请求失败时，将同一任务移入按 submissionId 去重的 `interruptedRuns`，解除执行忙碌状态。IndexedDB 和 localStorage 备用加载共用 `hydrateChat`；核对失败保留原身份，重复核对更新原记录。

对话中的“核对中断任务”只发送 `POST /api/agent/state {sessionId,binding}`，无自动查询、模型请求、工具执行或回执重放。响应必须匹配原 sessionId 与完整 binding；未配置模型 Key 不应阻止该只读接口。聊天切换、项目身份变化、离页、关闭再打开面板后，迟到响应不能更新记录。

`waiting_tools` 仅表示等待原调用回执，不构成执行授权。`unknown` 不自动重发；无 sessionId/binding 的历史任务不可推断或补造服务端身份。`completed` 展示服务端保存的文本，并明确说明完成状态不证明画布产物已保存。对话分叉不继承原会话的中断身份。

服务端返回可选 `delegation:{callId,tasks}` 时，核对卡片同时展示原子任务状态和依赖关系。客户端先校验委派callId属于当前父运行待办、任务ID唯一、依赖完整且无环、跳过原因来自失败的真实前序；错误响应不替换已核对记录。只存标题、状态、依赖和有限错误文本，不接收子任务输入、工具参数或像素；文本使用textContent展示。列表是本次读取的快照，不是自动刷新或继续按钮。

聚焦验证：`node --test tests/agent-recovery.test.cjs`。验证真实项目持久化封装、手动只读查询、同次点击去重、异步身份保护、读取失败重试、响应绑定校验和返回文本的安全展示；不使用模型、Key 或浏览器 E2E。

## 持久回执与继续合同

`journal.mjs` 保存原提交快照及 SHA-256、当前来源 SHA-256、工具轮次、全部待办 ID/名称、已完成调用 ID、已见调用 ID，以及当前轮完整的 prepared transport receipts。普通 trace 仍只展示结果摘要；journal 直接保存 `withInspectionMedia` 与 `withDepthFormEvidence` 准备后的真实像素和真实表单证据，绝不从 trace 或 state 重造。每轮待办在工具执行前提交；每组真实完成后提交进度；完整回执和 `continue_requested` 在 `/continue` 前提交并等待 flush。画布保存、conversation 保存或来源核对失败，都阻断该请求；超过现有 1 MB 请求限额会保留任务并阻断，不会删除像素后装成视觉回执。

`video_analyze` 的 bridge 仍返回原 taskId 的持久派发回执。Agent 下一轮前，`generation-settlement.mjs` 只等待本轮该工具的原任务结算：成功须结束实际画布应用，或已有明确应用错误；失败、取消、缺配置、unknown 和已取回但等待显式应用的结果不无限等待。预算为 660 秒（服务端分镜最长 600 秒，加本地应用余量）；取消、原 chat/project/run 失效或任务身份不可验证均阻止续轮，并清理订阅。等待不发起任务、不调用应用重试、不撤回已成功结果；原回执不替换成推断的最终结果。现有生成任务卡通过真实状态订阅显示解析/应用进度。普通 `generation_submit` 等其他异步生成合同保持原样。

分镜结算后才保存画布并建立完整来源签名，避免合法异步结果落地恰好夹在签名与检查点之间。签名后的用户编辑仍严格阻止 `/continue`，没有重算 hash 后放行或忽略结果节点的例外。等待期间沿用原工具执行边界；来源视频修改仍由分镜 bridge 的持续 guard 阻止迟到回填，不新增全画布编辑锁。

用户点击“继续中断任务”后先重新读 state，再校验原 session/binding、原提交 hash、来源版本和以下条件。继续期间不接受新的队列/Widget 需求、不自动 drain 已暂停队列；后续 `ask_question` 的真实用户回答仍按原入口提交。

|服务端状态|前端继续条件与提交|
|---|---|
|`waiting_tools`|当前轮次相同，保存的完整真实回执与全部 pending callId/name 精确匹配；提交原完整 results。没有回执或可能部分执行均阻断。|
|`receipts_saved`|pending 为空且保存的原完整回执属于服务端当前轮次；仍提交原完整 results，以命中原服务端回执账本，不采用空数组替换像素或表单证据。|
|`planned`|仅轮次 0、pending/seen ID 均为空，且原提交上下文和来源签名存在；显式提交 `results:[]` 继续服务端已有输入，不重新调用 `/turn`。|
|其他状态或 `canResumeWithReceipts:false`|阻断；缺配置、unknown、blocked、cancelled 不装作已继续。|

继续请求仍使用现有 `POST /api/agent/continue {sessionId,binding,results}`，没有公共 API 改动。响应必须保留同一 session 并推进轮次，已见过的 callId 不得再执行；`show_form` 的同轮、无调用、done 完成是唯一例外。之后调用 `runToolLoop`，与普通启动共享真正的工具执行、用户确认、生成卡、问题回答和逐轮持久化逻辑。

来源签名覆盖本项目完整 nodes/edges、有效图片/视频生成配置、产物路径与 revision、当前片场绑定/版本/对象信息、图片编辑器 session/revision/document、内置/个人技能及停用集、素材库/主体库和真实表单提交。忽略画布平移、缩放和选中状态。准备完成前关闭面板会取消准备；提交为正常 activeRun 后收起面板沿用原后台执行习惯，保持原 chat/project/run，真实结果仍保存，等待确认的操作须重开面板。Stop/pagehide 可中断；pagehide 保留原身份和已提交 journal。

限制：历史任务没有 journal 不能补造；普通工具部分已执行而完整回执未保存不能恢复执行；原始媒体结果只在 journal 成功持久化后可跨刷新补交。来源改变会保守拒绝，包括重新打开产生新 session 的片场或编辑器。子 Agent/DAG 未全部终态时只核对状态，不重新派发；完整终态结果可按下述专用合同读取原父回执，不能用子任务摘要替代正文。深度工作流的内存准备缓存不重建；下一轮若引用旧准备身份，真实工具可能要求重新读取/准备。服务端、真实模型/供应商质量和整体验收由主线验证。

## 完整终态委派回执

`terminal-delegation.mjs` 只支持已核对的父 `waiting_tools`：当前唯一待办必须是原 `agent_delegate`，与 journal 的原轮次、callId、名称、seen ID 和绑定匹配；所有子任务必须真实处于 completed/failed/cancelled/limited/skipped，依赖无环且跳过原因来自失败前序。unknown、运行中、等待工具、未启动或缺少原 journal 均阻断，没有子任务 POST 重试。

`terminalDelegationEligibility(record, scope)` 提供按钮状态与提示：“子任务已全部结束；继续前只读取服务端完整结果并保存原父回执，不重新执行子任务。”实际恢复调用 `prepareTerminalDelegationReceipt(record, {scope, sourceVersion, request, isCurrent, signal})`。它核验原提交和来源签名，仅发送一次 `delegated-result {sessionId,binding,callId}` 读取完整服务端聚合，核对 taskId/title/dependsOn/status/blockedBy 以及结果正文，然后建立原父工具的完整 transport receipt 和来源标记。读取不请求模型，也不将 state 的摘要补造成结论。服务端对提供的 binding 严格校验；父 `/continue` 再从服务端终态 settle 聚合，客户端不能替换真实结论。失败/上限/跳过保留事实，不能描述为全体成功。

当前主线接线顺序：恢复准备阶段重新读 state → 若终态资格成立，调用上述 helper → 保存并 flush 原 interrupted record 的 journal → 再次核对来源 → `buildResumePlan` → 进入原 activeRun 后按现有显式 `/continue` 和工具循环执行。helper 只准备回执，不自行持久化、调用 `/continue` 或执行工具。未读取完整回执时 `buildResumePlan` 返回 `resume_delegation_receipt_required`，安全保留原任务。完整回执校验后仅同步唯一匹配的原委派卡，展示真实子任务状态和完整正文；保留历史中断文本与本地工具步骤，无匹配卡不新建。同步也先持久保存，再进入续轮。

聚焦回归：`node --test tests/agent-recovery-terminal-delegation.test.cjs tests/agent-recovery-lifecycle.test.cjs`。前者通过实际 AgentRuntime 和内存检查点验证完整父回执与显式父续轮、失败及因果跳过、未知状态零请求、身份/来源/伪结果/迟到读取阻断；后者执行真实恢复控制函数验证准备期关闭、正式执行后收起，以及激活保存期间来源变化。无真实模型、浏览器或生产存储。

追加聚焦验证：`node --test tests/agent-recovery.test.cjs tests/agent-recovery-journal.test.cjs tests/agent-recovery-fixture.test.cjs tests/agent-generation-settlement.test.cjs`。结算测试执行真实 Agent 续轮边界及真实应用 runner，覆盖异步落图、签名后编辑拒绝、取消/切换、身份冲突、超时与订阅清理。不使用模型、Key、浏览器 E2E，也不改用户存储。

## 主 CUA 验证入口

已有本地服务可直接打开 `http://localhost:4173/qa/agent-recovery-app.html?session=recovery-20261002-a`，无需重启。该页面单独加载固定本地 fetch 夹具；Agent 与任务请求不会转发给正式后端，localStorage/sessionStorage 使用专用前缀，Canvas/Assets 使用独立数据库。正式页面未增加测试入口。此页面只能证明前端生命周期与真实本地工具循环，不能代替真实模型或服务端重启验收。

1. 左侧选择“等待原回执 · 正常恢复”，打开 AI 助手，在真实输入框输入“创建验收文本节点”并发送，点击“允许此操作”。首个 continue 固定断线。
2. 对话内点击“核对中断任务”→“继续中断任务”，允许下一轮新操作。左侧刷新统计应原调用节点数 1、后续新调用节点数 1；原 callId 不再执行。
3. 新 session URL 重做首个操作，断线后点击左侧“修改原调用来源以验证阻断”，再核对→继续。应提示来源版本变化，继续请求不增加、后续新调用节点数 0。
4. 下拉另外提供 `receipts_saved`、初始 `planned`、未知结果、缺回执、旧回包场景。每个场景使用新 session，避免已有记录混合；不删除旧数据。

2026-10-03 Computer Use 已验证 `terminal_delegation` 隔离场景：真实发送 → 执行通道中断 → 刷新并重开助手 → 核对 → 显式继续；turn/start/result/continue 均为 1，state 为 2，未创建节点或重启子任务。原委派卡更新为两项真实模拟 completed 和完整模拟正文，再次刷新保持。此证据使用明确标注的固定 QA 响应，不能代替真实模型质量或后端断电恢复验收。
