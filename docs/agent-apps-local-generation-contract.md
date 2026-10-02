# 三个生成应用的共享本地合同

生产接线：`agent-client.js` → `integration.mjs` → `host.mjs` → 三个应用专属runtime → `GenerationAPI` / TaskService。原始官方HTML仅作本地资源，来源像素由宿主读取，未使用原站账户或支付服务。

## 工具与权限

| 应用 | 仅此iframe可调用的工具 | 真实结果 |
| --- | --- | --- |
| animatic@v2 | animatic_variants_submit、animatic_variants_lookup | 实际任务身份、当前状态、已核验真实图板 |
| previs@v3 | previs_variants_submit、previs_variants_lookup | 实际任务身份、当前状态、已核验真实图板 |
| ecommerce-photoset@v2 | ecommerce_photoset_generate | 精确确认的Amazon行/参数对应任务或具体失败 |

submit需要当前iframe真实用户动作与空闲会话；lookup允许被动读取，无法授权新POST或自动应用恢复输出。每个应用拒绝其他应用工具以及任意Agent工具。专属用户操作只授权本次保存的参数。Animatic普通确认与商品组图freeform确认进入正常用户队列，后续Agent工具仍使用正常权限。

## previs_generate_sheet

Purpose：为已保存并被真实Agent队列接受的预演清单生成缺失图板，使用正常画布修改确认。

Inputs：仅 `trace_id`（当前会话实际show_app记录）、`reply_id`（UUIDv4）、`shot_codes`（1–96个唯一保留镜头）。模型不得传来源、manifest、媒体URL、参数覆盖或授权字段。图板范围与完整保留镜头由专属runtime核验。

Outputs：真实TaskService提交记录、任务ID与pending/failed状态；不承诺已完成、正确九格或已保存最终媒体。成功完成且标准canvasResults应用到原占位后，宿主读取真实像素与SHA并投影回官方图板。

Permissions：`mutates:true`，遵循正常Agent修改确认。需要当前trace、真实用户队列/历史用户消息的widgetOrigin、accepted reply和真实`submission.id`回执一致。本地服务必须已配置；确认预演本身不授权该工具。

Failure modes：缺少配置、来源字节或项目/会话变化、状态与已确认清单不一致、目标撤销、输出未真实应用、保存失败均明确拒绝。unknown任务只GET原job_id，不盲目重POST。临时工具context释放不取消已持久授权任务，但后台派发仍核验实际来源与范围。

Logging：`trace.previsReplies`保存清单与accepted/run_id；`trace.appReplyReceipts`绑定真实队列`submission.id`，记录waiting/running/completed/unknown；`trace.previsJobs`保留真实生成任务。历史上下文去除data/blob媒体、来源私有结构与密钥，历史回执不构成新授权。

Tests：`tests/agent-apps-local-generation-integration.test.cjs`覆盖app工具隔离、真实动作、精确预验许可、队列保存/accepted回调先于drain、身份重放与冲突、回滚、真实run生命周期、多次图板完成与新编辑保护、状态通知、历史剔除媒体以及生产controller接线。专属任务回归见`tests/agent-previs.test.cjs`。

## 队列、状态与投影

预验只检查拟提交payload；正式确认要求实际保存状态相符。队列身份、回执和accepted manifest先持久化，再解锁drain。两个保存阶段均重新核验真实已选变体与来源；失败补偿队列/回执，不能开始运行。

`run_id`是实际`submission.id`。读取真实queued/active/interrupted/最终保存记录，返回waiting/running/unknown/inactive；当前官方卡也收到对应真实状态更新。完成图板投影重建来源绑定，使用递增projection revision。`previsProjectionReceipt`只标记该accepted reply与最新materialized初态，允许后续分批完成；有新的用户编辑就停止替换当前状态。页面重载后，已选变体通过原任务GET、真实节点/输出SHA和已保存回执只读恢复纹理与来源projection，保留同一保存state，不重复POST、不自动再应用或重建节点。

## 本地计费展示

`mcp-app-proxy.html`按完整官方SHA仅对对应资源生成展示派生；磁盘原HTML保持。商品组图五语言的20处费用提示改为本地任务提交、未提供费用估算、已配置供应商按实际用量计费。预演的两处固定26积分改为供应商计费，同一SHA派生还保留可信未配置分类与五语言未派发提示。Animatic通过`animatic-local-errors.mjs`同一原SHA派生处理价格展示及明确未配置错误，防止连续原SHA派生产生冲突。所有确认按钮与正常生成流程保留。

`configuration_required`错误只增加可信`{code:'configuration_required',providerDispatched:false}`，其他错误不附带此分类。费用不可用返回unavailable，未编造Tapies额度或免费/收费结果。

## 验证边界

共享单元/生产controller测试证明接线和事务边界，不证明实际供应商生成质量或官方iframe视觉一致。实际图板需独立查看；真实服务配置与浏览器验收由对应QA流程记录。独立QA队列不会伪造模型运行完成。
