# 预演 previs@v3 本地合同

依据未修改的 `resources/apps/previs@v3.584fd5b2.html`；宿主依据 `reference/vendor-packages-CN3JnHbF.js` 的 `wae` / `og` / `ig`：允许展开且默认展开。没有向原站发送请求。

## 输入、状态与确认

`previs.mjs` 的 `preparePrevis`：`version:3`、`locale`、`title`、`generation_spec:{model?,aspect_ratio?,resolution?}`、`order`，以及 `sheets:[{sheet_id,sheet_node_ref?,shots:[{shot_code,cell,duration,move,size?,camera_height?,speed_curve?,transition?,script_text?,dialogue?:{text,est_duration},lens?}]}]`。Agent只提交实际图片节点引用及镜头文字；不能注入纹理、地址、预览、图片或SHA。无图板的镜头是实际用户确认的脚本计划。

最多96镜头、每图板1..9镜头且cell不重复；镜头时长0.4..15秒。确认时每张保留图板总时长不得超过30秒。镜头文字<=600、台词<=200字符；官方编辑文本预算8KiB、widget状态16KiB。真实源图每张16MiB、合计64MiB；inline预览合计900000字符，读取超时30秒。

状态是官方 `v:3,selected_shot,edits,order,deleted,variants,submission`。edits使用 `dur/move/curve/trans`，图片保存 `kind/texture_id/sheet_node_ref/cell`。官方提交顺序为：`tapnow/validateAppReply`，保存最新状态 `tapnow/setWidgetState`，`ui/message`。所以 `preflightReply`验证尚未持久的结构化计划，最终 `validateReply`严格核对真实已保存状态，两个阶段返回同一manifest_revision。

确认 `ui/message` 是 `role:user,content:[]`，details为 `{type:'app_reply',reply_id,action:'previs_reply',payload,expected_manifest_revision?}`。payload为 `schema_version:'previs_reply.v1',decision:'confirm',edits,deleted_shot_codes,order,variant_selections`。`applyReply`将镜头编辑、顺序、选图、删除和prepared回执一次持久保存；`resolveReply`为正常Agent队列提供精确文字与节点来源，剥离内联预览。

`run_id`由共享正常队列真实submission.id提供，不由runtime随机伪造。共享保存接受回执后才把entry标为accepted；`tapnow/getAppReplyRunStatus`绑定实际queued/activeRun/interruptedRun记录，等待/未知不会宣称完成。

## 真实生成与恢复

官方工具：

- `previs_variants_submit`：`{plan_id,shot_code,source:{kind:'cell',sheet_node_ref:'node/<id>',cell:0..8}}`，metadata为`tapnow/callId`；读取并裁出实际源图cell，将实际像素交给普通图片生成。
- `previs_variants_lookup`：`{source_refs:['node/<id>']}`，返回`items:[{shot_code,plan_id,node_id,status,image_url?,cells?}]`，完成必须存在真实已应用任务、resultIds、媒体及输出SHA。
- `previs_generate_sheet`：正常Agent修改确认后调用。只接受`trace_id,reply_id,shot_codes`；runtime执行入口接受已解析的`{reply_id,shot_codes}`。要求实际accepted预演回执与真实appReplyReceipts run_id一致。同图板必须确认所有保留镜头。

生成使用现有 `GenerationAPI.submit` 的标准 `image.generate` 和 `resultMode:'spread'`，count固定1图（图片内容为3×3图板）。实际任务占位先保存；正常工具结束释放临时页面context，不会取消已持久授权任务；后台派发仍严格核验原项目、会话、源像素与目标，并响应任务取消。`beforeDispatchReady`持久保存真实job_id后才允许网络派发。配置通过现有API availability核验，Key和模型使用现有本机生成路由配置，见 `docs/GENERATION-GATEWAY.md` / `docs/MULTI-PROVIDER-SETUP.md`；没有新增依赖或供应商后台接口。无Key时明确未配置，既不创建任务也不伪造图片。

未知任务只GET原job_id；lookup不重发POST、不自动新增或应用恢复节点。恢复成功尚未应用时保持pending，用户通过现有任务栏“恢复到原占位”明确应用。终态失败后的官方显式新callId重试可提交新任务，复用原占位且保留全部历史job_id；旧callId重放、运行中、unknown、已完成任务不会重新POST。原占位撤销或删除后禁止自动重建。

图板回填 `querySheets`返回已持久manifest及可信projection（新图板真实SHA、media、snapshot）；共享先保存response/context，再重建capture与官方updateData。结果读取、预览解码和回执保存前后重新核验同节点对象、相同媒体、任务request/outputs/resultIds/status/applied、实际SHA。原图来源只接受asset/data/blob，以及精确 `/api/generation/media/<UUIDv4>` 同源资源；拒绝HTTP替代地址、重定向、foreign peer、无界流和超限像素。

图板3×3生成质量和九种景别语义是模型结果，不能仅凭任务成功宣称正确，需要实际查看生成图板。

## 接线接口

`createPrevisRuntime({app,localAssets,store,generationAPI,getProjectId,persistConversation,fetchImpl?,getOrigin?,renderPreview?,renderCell?})`导出 `prepareAppArgs`、`bindPreparedResult`、`capture`、`generateSheets`。capture提供 `guard/validateSourcesCurrent/validateState/preflightReply/validateReply/resolveReply/applyReply/submitVariants/lookupVariants/querySheets/isCurrent/dispose`；工具返回MCP包装，shared callback使用`structuredContent ?? value`。

## 验证与限制

`node --test tests/agent-previs.test.cjs`：14项定向测试通过；涵盖官方先预验后保存、严格状态/选图、稳定重试、无Key无POST、先保存任务身份、实际应用/哈希、输出解码期间替换、GET恢复、撤销不重建、显式终态重试、临时tool-context释放仍守真实scope，以及图板可信投影、已选变体真实纹理与来源SHA。源模块与QA语法通过。

独立QA：`/src/features/agent-apps/qa/previs.html`。生产controller/host/registry/runtime，独立IndexedDB；源图明确为真实Canvas QA输入、非模型生成。普通确认保存真实waiting队列，本独立页不执行Agent或伪造运行完成。实际图片生成通过本机TaskService与生成网关；提供缺图板、正常明确生成、原任务GET取回、明确应用原占位、撤销、保存失败和持久回读。

本次未使用CUA，未调用真实供应商；未完成官方iframe实际视觉、播放/键盘或真实模型质量验收。测试provider/mock只用于生命周期回归，不作为真实生成证据。

独立复审已复验：结果preview期间替换拒绝、双图板选中变体补齐真实texture和source SHA；确认保存期间删除已选变体已追加失败补偿回归。共同源守卫也覆盖已保存选图，因此普通队列保存期间不能接受失效selectedvariant。

## 2026-10-03 本轮实机与刷新恢复

root已实际操作QA：源图为真实九格；S1时长3→3.1；本机彩色96×64 fixture沿gpt-image-2模型别名提交，POST1→GET1，九格可选；选择ELS并应用修改后真实持久waiting队列1、accepted reply/run_id一致。该fixture不是AI模型输出，不代表图片模型质量；真实本机媒体为 `/api/generation/media/34b6b1be-3853-4f59-a5cd-41787e22a293`。

实机刷新发现原结果纹理未随已保存选图恢复：任务与本机图片仍在，页内getJobs为空，旧response没有variant texture，官方卡显示“仍在生成”。已修复 `querySelectedVariants({recover:true})`，生产renderArtifact与QA启动首次render之前都调用：只GET原任务、核对曾已保存的receipt/job_id/node_ref、原节点任务标识、真实GET输出地址、本机SHA和尺寸，再补纹理及可信source binding并保存。恢复保留时长、ELS/cell、widget submission、waiting队列和run_id；不新增或重应用画布节点，不重新POST，不伪造job.applied/resultIds。

原14项定向检查通过；新增1项最小刷新回归通过，覆盖getJobs为空、GET取原task、POST仍1、真实texture/source补回、state/graph不变和同址像素修改拒绝。源与QA语法/diff通过。root已完成修复后的真实iframe刷新复验：GET原by-key累计为3，POST仍1；ELS、3.1秒、waiting队列1和原run_id均保留；展开九格显示真实96×64本机彩色fixture。截图为 `/tmp/freenow-previs-restored-20261003.png`，可见完整编辑器、九格与Agent等待状态。该图仍是本机测试输入，不代表真实图片模型质量。本子任务未使用CUA，实机证据来自root。
