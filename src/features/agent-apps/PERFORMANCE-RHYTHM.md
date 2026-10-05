# 官方表演节奏页（v3）接线合同

依据：未修改的 `resources/apps/performance-rhythm@v3.9ead0d0b.html`。官方 `cb` 接受版本2数据；`Zs/As` 校验节奏，`bb/vb` 保存/恢复，`hb` 输出PS1，`Zb` 在确认前提交状态。官方宿主对此资源使用默认不展开策略。与 actor-emotion 的表达指导图片工具、story-room 的场景结构工作流分开。

本模块完成输入、状态与实际确认内容核对；主宿主接线须按下面合同执行。单独开放URI不能完成工作流。

Purpose：在固定时长内编辑表演驱动力曲线和停顿、重音、打断、重叠对白、情绪转折、动作节拍，并把实际确认结果交回正常Agent消息队列。它不调整视频速度、不编辑媒体、不自动提交生成。

Inputs：`preparePerformanceRhythm(data,title?)` 的data为：

```json
{"duration_ms":12000,"scene":"她握住门把手，停顿，把真正的告别吞了回去。","curve":[{"id":"p1","at_ms":0,"drive":24},{"id":"p2","at_ms":6200,"drive":86},{"id":"p3","at_ms":12000,"drive":42}],"beats":[{"id":"b1","at_ms":6500,"kind":"pause","intensity":3,"label":"吞回真话"}],"locale":"zh-CN"}
```

固定时长2000–600000ms；scene非空、最多4000字符；curve 3–12个严格递增点，首点0、末点固定时长，drive为0–100整数。beats最多24项，at_ms在固定时长内，强度1/2/3；label按官方要求规范空白且不超过48字符。曲线和节拍各自ID唯一，格式 `^[a-z0-9][a-z0-9_-]{0,23}$`。locale可选中/英/日/韩/法，title最长200字符；输入不能带媒体引用或未知字段。输出补官方必要的version:2、summary、title、locale。

Outputs：`resolvePerformanceRhythmReply(text,response,savedState)` 为异步调用，返回 `{kind:'confirmed'|'revise',text,metadata,result?}`。confirmed保留原PS1，附来源scene、固定时长和真实编辑曲线/节拍JSON；review_requested明确决定是否请Agent检查对白时长。检查请求要求先报告问题，禁止自动修改。稳定内容SHA256 handoffId用于同来源卡片重复确认去重。revise只接受五种官方“回对话调整”文案，不把它当作采用节奏。

Permissions：复用现有双iframe/source/nonce/当前用户操作要求。此应用不需要媒体域名、外部API或tools/call。来源是该trace在打开页时持久化的真实场景输入，固定时长不可由回执替换。队列走普通新用户回合，保留widgetOrigin；不能把表演提示词采用当成媒体生成授权。

Failure modes：官方 `fp` 会吞掉状态保存错误，因此宿主必须拒绝PS1与实际保存状态不一致的确认，不能只相信应用“确认”按钮。字段、重复ID、固定端点、未知类型、错误编码、未保存、跨版本、曲线/节拍/对白检查标志不一致均拒绝；保存失败不返回成功。初始未操作时也需由官方确认流程保存状态。

本地交互派生：`performance-rhythm-local-interactions.mjs` 仅接受 v3 原始 SHA256 `9ead0d0bb847a55c3598ba90626b3fba85f9d2acbc773a447b12ee57d8994ae3`，原始资源不改。修复Tab聚焦后键盘删除错目标，确认在保存前同步锁定交互并核对同一快照，保存失败不发送确认；连续编辑仍防抖，结束手势立即刷新，慢保存合并最新待存状态，相同已提交状态不会重复写入。接线由proxy在CSP包装前调用 `localizePerformanceRhythmInteractions(html,name,version)`。不增加工具、媒体或网络权限。

Logging：保存show_app原args/result、验证后的appState、原PS1+已读结果、handoffId与widgetOrigin。普通选择/播放头不改变确认内容的去重ID。

## 根宿主接线

1. registry增加 `ui://tapnow/performance-rhythm@v3`，policy `{allowExpanded:false,autoExpandOnReady:false}`，保留普通64KiB状态上限。prepareApp调用本模块准备官方response。
2. show_app schema为该resource提供上述data；输入完整性和端点仍由本模块执行校验，不能只依赖JSON Schema。
3. onSetWidgetState先执行 `validatePerformanceRhythmState(state,trace.result.response.duration_ms)`，再等待正常保存提交。失败保持原状态。
4. onSendPrompt调用resolver前捕获 `savedState=trace.appState`、当前trace/会话身份和response。异步完成后再次确认当前卡片/会话、未运行/未离开以及appState和response身份未变化，再把返回text/metadata交给正常onQueuePrompt。
5. 不要从消息中自定duration/scene，不要开放工具或媒体权限。返回false/抛错均保持失败，不创建伪造确认。

## 验收

`/src/features/agent-apps/qa/performance-rhythm.html` 使用生产prepareApp/controller/card/host和原始官方应用，精确捕获的官方示例仅用于确定性操作验收，可改实际JSON输入。专用IndexedDB等待事务提交；初始化前禁用操作，未调用模型。普通重绘保留iframe，刷新恢复状态；真实PS1与已存状态核对后才写入专用队列，重复确认去重，运行中拒绝提交。宿主来源guard在存储提交后再次核对，来源失效时撤回并提交回滚。此隔离队列检查不能替代主Agent接线浏览器验证或真实模型质量验证。

```sh
node --test tests/agent-performance-rhythm.test.cjs
node --test tests/agent-performance-rhythm-interactions.test.cjs
node --check src/features/agent-apps/performance-rhythm.mjs
node --check src/features/agent-apps/qa/performance-rhythm.mjs
```

测试用官方独立 `hb/Zs/As` 函数生成并检验PS1，覆盖端点、排序、中文/emoji/分隔符、实际保存核对、重复ID、无权限字段、review与回对话请求。完整页面交互、同视口视觉、主Agent接线和真实模型检查仍须单独验收。
