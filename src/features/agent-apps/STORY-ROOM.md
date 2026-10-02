# 官方 Story Room（v1）接线合同

依据：未修改的 `resources/apps/story-room@v1.dae7d235.html`。官方 `v_` 建初始列，`U_` 恢复状态，`km` 净化新增场名，`$_` 编码NS1，`b_` 计算移动数，`P_` 保存，`we` 发送本地化确认摘要。此页面没有输入JSON Schema；本模块按页面实际读取字段定义严格、有界的本地输入合同。官方宿主对此页使用默认不展开策略，无外部媒体权限。具体证据为 `reference/vendor-packages-CN3JnHbF.js` 的rg/wae/Bue：Story Room不在wae特例表，返回rg={allowExpanded:false,autoExpandOnReady:false}；无maxInlineHeight（520只用于三个picker）。Aae["story-room"]={}。

Purpose：编辑剧本按幕排列的实际场景讲述顺序，增加仅有名称的新场景、废弃原场景，查看剧情线/人物/故事时间/因果关系，并把确认结构交给正常Agent消息队列。此确认只整理结构或修改方案，画布写入、删除仍需正常修改确认，不自动生成正文或媒体。

Inputs：`prepareStoryRoom(data,title?)`；title来自show_app.title，默认「剧本结构板」。data顶层严格为：

```json
{"locale":"zh-CN","acts":[{"id":"A1","label":"第一幕"},{"id":"A2","label":"第二幕"}],"plotlines":[{"id":"P1","label":"调查","color":"teal"}],"scenes":[{"key":"S1","act":"A1","name":"医院走廊","cast":["林岚"],"plotline":"P1","story_order":3,"story_time":"事故后","loc":"医院","synopsis":"发现旧票根。","beat":"发现","has_body":true},{"key":"S2","act":"A2","name":"车站","cast":["林岚"],"plotline":"P1","story_order":1,"has_body":false}],"causal_links":[{"from":"S2","to":"S1"}]}
```

acts/scenes/plotlines/causal_links必须为数组；1–12幕、最多80来源场景、12剧情线、160因果链接。幕、场景和剧情线各自ID唯一，格式 `^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$`；来源场景key不能以N开头，因为官方页把所有N开头的卡片当新增卡。场景必须含key/act/name/cast，act必须存在；cast最多12个非空且不重复的人名。剧情线颜色为teal/blue/purple/pink/coral/amber/green/gray，场景plotline若非空必须存在。因果引用均为实际来源场景，不能自指或重复。locale可选中/英/日/韩/法，默认中文。scene可选字段见示例，不接收正文或任意工具字段。prepared JSON最多12000字符；有明确字段长度限制，交接最终最多16384字符，超长明确失败。

Outputs：`resolveStoryRoomReply(text,response,savedState)` async返回 `{kind:'confirmed'|'skip',text,metadata,result?}`。confirmed必须逐字匹配官方本地化摘要与NS1，不接受另加指令、只发NS1、错误计数或跨locale文案。交接保留原NS1并附实际按列排序的场景、原幕source_act、新场创建幕created_in_act、源剧情线/因果链接与废弃的源场景。新增场景明确has_body:false，不冒充已生成内容。skip仅接受当前locale的官方跳过文案，不采用本地未确认编辑。稳定内容SHA256 handoffId为 `story_<64 hex>`；nseq/过滤/折叠不改变确认内容身份，同来源卡片由正常队列按handoffId去重。

State：`validateStoryRoomState(state,response)` 校验并复制 `{cols,news,nseq,dels,filter,collapsed,stripOpen}`。列顺序和幕身份固定；每个来源场景须且只能出现在实际列或dels；每个新增场景须且只能出现在实际列。news为 `N1` 等官方序号，场名必须已经按官方km清理为最多24个UTF-16字符；不对确认后的名称做静默修复。news.act是创建幕，拖到其他幕后官方不会改它，因此不要求它等于当前列。nseq必须安全且不小于已用序号。非法/未知字段、重复/遗漏/不存在的场景、无效过滤/折叠均拒绝。普通64KiB宿主状态限额仍适用。

Permissions：复用双iframe、source/nonce、当前用户动作、会话/trace/iframe代次保护。无需tools/call、媒体域名或外部API。真实源场景来自已保存show_app.response，不能从NS1替换来源。此模块不发外部请求、不写画布，不将采用结构当成视频生成授权。

Failure modes：官方`Te`把状态保存延迟400ms；`P_`吞掉保存错误，确认`we`不会等待或刷新保存。宿主须核对已提交savedState，快速编辑后立即确认或失败保存不能产生成功回执。初始页面没有自动保存，因此生产controller的onReady须通过正常onSaveState持久化 `initialStoryRoomState(response)`，事务成功前不接受确认。也可在创建trace时同事务保存初始状态。已有历史无appState时必须通过同一初始状态保存链修复，不能直接把回执当作已保存状态。与官方U_的容错恢复不同，宿主不自动修复不一致状态。入队期间切换来源、改状态或重载必须撤销并等待补偿保存，补偿失败仍需报告未保存状态。

Logging：保存原args/response、验证后的appState、原NS1与可读结果、handoffId、widgetOrigin。不得用伪结构/伪正文/伪生成回执补齐未知来源。

## 根宿主接线

1. registry加 `storyRoomUri`，policy `{allowExpanded:false,autoExpandOnReady:false}`；prepareApp拒绝original_request/recommended_template_id混用，response调用prepareStoryRoom(args.data,title)。资源已在官方manifest中。
2. show_app schema提供上述data字段；仍运行模块的完整语义校验。生产controller onReady在缺少appState时调用正常onSaveState(initialStoryRoomState(response))并等待真实事务；不要改原HTML或把初始状态仅塞到result冒充持久状态。
3. 每record用串行stateWork链接初始保存和onSetWidgetState。先执行validateStoryRoomState(state,trace.result.response)，再调用正常onSaveState；保存失败保持原状态。
4. onSendPrompt先等待record.stateWork保存链完成，再使用现有异步source guard：捕获trace.appState、trace.result、response身份后调用resolver，异步完成后再次核对当前chat/trace/iframe代次、状态/response身份及未streaming，再将text/metadata交给正常队列。队列等持久事务提交，提交后再guard，失效撤销并保存回滚。
5. 初始保存、普通状态保存和确认排队必须共享生产保存锁，不能消费乐观更新但尚未提交的状态。不同card/trace的相同结果不可在全局互相吞掉。

## 验收

`/src/features/agent-apps/qa/story-room.html` 使用生产prepareApp/controller/card/host和未改官方页，需根宿主完成上述接线。独立IndexedDB `tapnow-qa-story-room-v1`，初始读取完成前禁用操作；保存真实状态与去重队列，初始化trace时保存官方初始状态，状态事务未提交时拒绝排队。刷新恢复、普通重绘保留iframe，运行中拒绝交接，存储提交后再次检查来源。不会清理其他存储，也未调用模型。

```sh
node --test tests/agent-story-room.test.cjs
node --check src/features/agent-apps/story-room.mjs
node --check src/features/agent-apps/qa/story-room.mjs
```

定向测试从官方HTML提取独立v_/U_/km/$_/b_和五locale文案，不依赖宿主编码器来生成期望值，覆盖初始/恢复、跨幕移动、新场与废弃、精确摘要、已存内容绑定、视图与内容ID、跳过、非法来源和状态。本批不运行浏览器、不调用真实模型；本地主Agent接线、完整页面交互/视觉和实际画布修改仍须单独验收。
