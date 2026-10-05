# 内嵌应用关闭前保存（2026-10-05）

本批仅为 `performance-rhythm@v3` / `story-room@v1` 的精确派生页面补充关闭保存屏障。原 HTML 未改，分别仍为 SHA256 `9ead0d0bb847a55c3598ba90626b3fba85f9d2acbc773a447b12ee57d8994ae3` / `dae7d235df8887af866f8b1984b75075c651f1b4d8f79775a0470a4b89f569a0`。不重复修改上批确认/消息逻辑，不增加工具权限。

## 关闭合同

- `host.prepareToClose()` 向当前 iframe 发送唯一 `freenow/lifecycleFlush`。仅这两种资源启用；其他应用不宣称获得草稿 flush 能力。
- 精确派生页面安装监听后发送 `freenow/lifecycleReady`（`version:1`）；宿主通过现有 source/nonce 验证后才允许关闭准备。该通知仅确认本地监听已安装；关闭保存仍使用原 JSONRPC request/reply，未改为 notification。
- 派生页面校验 `event.source === window.parent`，blur 当前字段，锁住原应用根节点，调用已有真实 `tapnow/setWidgetState` 保存泵。成功后仅回复 `{flushed:true}`，继续锁定直到销毁或收到匹配请求 ID 的 `freenow/lifecycleResume`。
- 宿主严格校验外 iframe 身份、nonce、请求 ID、generation、当前来源和成功结果形状。默认 10 秒超时。失败、超时、重载或销毁拒绝旧回执；重复准备复用当前 Promise，不重复提交。
- `controller.prepareToClose()` 在原 chat、panelActive 和 pageLeaving 身份仍有效时串行准备每张卡片，并等待全部实际 stateWork。任一卡失败会解锁所有已准备的同伴。调用者应成功后立即切换或销毁，任何后置失败在 `finally` 调用 `cancelClose()`。
- `card.prepareToClose()` 显示保存状态；失败保留 iframe，显示原因及再次关闭重试提示。Backdrop、收起按钮、宿主 Escape 和内 iframe Escape 使用相同握手。仅收起放大视图时保存后解锁，保留 iframe。
- 主助手抽屉关闭、历史新建/选择/删除当前会话、消息分叉通过一个防重入过渡等待保存，成功才切身份或销毁。关闭还等待会话存储 flush；失败保留原抽屉和会话。
- 同步 `beginStudio()` 与多 guard 的项目导航保留原接口：有这两类应用仍打开时明确要求先收起助手。没有永久锁，也未把多个项目 guard 的一次通过误当作最终离开承诺。

## 权限和边界

生命周期只触发既有状态保存；不发送 `ui/message`、不授予 userActivation、不调用新工具。原双 `sandbox="allow-scripts"` opaque iframe 与代理的 nonce/source 验证保持。资源 SHA 必须校验通过才安装派生监听。

浏览器强制刷新、关闭窗口、`pagehide`、来源数据直接被外部替换和绕过准备的低层 `destroy/reset/prune` 无法等待跨 iframe 异步保存；不宣称这些路径保留最后编辑。低层重渲染/失效销毁仍同步拒绝旧身份。迁移会话附件的 applyCommitted 重建路径尚未增加此屏障。

## 验证

针对 host/card/派生桥/controller/client 的新测试覆盖延迟保存、错误重试、超时、重复关闭、错误来源、stale nonce/generation、切会话、同伴失败解锁、后置存储拒绝与保留原 iframe。关联 Rhythm/Story 保存与确认回归已重新执行通过；card 外层关闭与收起竞争、旧 generation 失败回执、控制帧分发回归也通过。Story 一项旧测试固定等待 8 个 VM microtask，在原 HEAD 代码同样失败；仅改成等待一个完整 event-loop turn，原断言未放宽。

首次真实浏览器快速关闭发现 SDK 同时处理新增控制请求并先回复 `Method not found`；页面正确保留，但关闭被阻止。派生监听仅对验证过的生命周期控制帧调用 `stopImmediatePropagation`，标准 SDK 保存回执与通知继续流通。Rhythm 在 capture 监听后复验通过；Story 的实际 SDK 在 `R_()` 中连接，最初桥位于其后，仍让 SDK 先收到请求。最终改为 SHA 验证后的精确 `R_();` 前安装桥。

原 JSDOM DOM 分发测试的 capture 优先顺序没有暴露 Story 的 Window 注册顺序问题。新增 `tests/agent-story-room-lifecycle-sdk.test.cjs` 执行完整固定 Story bundle 和 SDK，并按注册顺序分发 message：旧晚安装稳定复现 `-32601 Method not found`，新早安装等待真实 `tapnow/setWidgetState` 回执，存储失败返回错误而不假成功，2/2 通过。最后追加的 host 关闭测试 3/3 通过，验证本地关闭错误显示中文重试提示、原始 code/message 保留在内部 `cause`、并允许重试。该归一仅作用于本地关闭回执，未修改外部 SDK 错误处理。

浏览器验收入口使用正式 registry/controller/card/host 与真实 IndexedDB：

- `/src/features/agent-apps/qa/performance-rhythm.html?session=close-1005j`：延迟 1800ms，原生编辑后立即「关闭面板」，等待成功，再「重新打开已保存面板」核对实际已提交状态；勾选失败后关闭应保留页面，再关重试。
- `/src/features/agent-apps/qa/story-room.html?session=close-1005j`：新增场景后立即「关闭面板并保存」，重开及浏览器刷新核对实际状态；勾选「模拟保存失败」后关闭应保留，再解除失败重试。

主任务执行的真实 Chromium 原生交互结果：

- Rhythm：1800ms 延迟，编辑 b1 备注后立即关闭，显示保存中后才关闭；重开保留「保存确认后，再轻轻关门」。模拟保存失败保留输入「关闭失败应保留这一句」，解除失败后关闭重试成功，完整刷新后备注仍在。最终新 readiness 版本再 reload/关闭通过，保存待完成 0、提交 1、排队 0。
- Story：新增 N1「车站最后一盏灯」及 N2「钟声之后再离开」。模拟保存失败后关闭被拒绝，页面与 N2 保留；解除失败后 1800ms 显示保存中，N1/N2 实际写入 state 后才关闭；重开及 reload 后 5 个场景包含 N1/N2，排队 0，未调用模型。最终中文提示修复后再次原生勾选失败并关闭，显示「最后编辑未能保存，请重试；页面已保留…」，N1/N2 仍可见。失败保留截图：[Rhythm](screenshots/agent-close-save-20261005.jpg)、[Story](screenshots/agent-story-close-save-20261005.jpg)。

原生浏览器证据和自动化回归分别记录；强制刷新期间新增未提交编辑仍属前述边界。

最终独立交审发现 controller 测试仍匹配归一前的原始错误文案；改为同时断言顶层中文提示与 `cause.message` 原诊断，对应真实 controller 用例 1/1 通过，生产合同未改变。
