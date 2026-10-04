# Agent 流式代码块控件 · 2026-10-05

正式助手消息在已出现代码块时即可复制和切换自动换行。后续文本增量及回复完成保留同一代码块、工具栏、焦点和横向滚动；不必等待整个任务结束。本次不修改模型请求、供应商状态、消息发送或工具授权。

## 官方依据与本地差异

依据官方发布 `eb1c3578957450302e3cff5edd2ad253d0874421` 的 `vendor-pkg-canvas-CwfaULgq.js`：

- `Dne / ChatCodeBlock`，字符位置2121412，参数仅为 `{code,language}`；无 `isStreaming` 禁用条件，始终显示复制和自动换行按钮。复制使用当前 `code`，成功反馈2秒。
- `X5 / PlainTextCodeBlock`，调用 `Dne` 的字符位置2363557；向代码组件传实际当前正文和语言。助手 `g2 / RenderContent` 的Markdown输出不会因流式状态取消这个代码组件。
- 整包SHA256：`cf4df1be70ee5b4379f539d93fc3b1b9b566bf307817aa215b1272cb37725946`。官方包仅作设计查证，产品与公开QA均不加载原始reference或供应商网络。

本地原 `messages.mjs` 仅在complete分支调用 `decorateCode`，流式期间已显示的代码无法复制或换行；complete分支的 `innerHTML` 还会重建正文，丢失代码内焦点和横向滚动。本次补齐这一明确差异，沿用已有图标、样式和Markdown净化器。

## 实现

`messages.mjs` 在文本增量和状态变化时统一patch安全Markdown并装配代码控件；相同代码块已有工具栏不重复装配。复制在实际点击时读取该块当前 `code.textContent`，只复制这一块；异步期间后来出现的代码不自动加入已点击的剪贴板快照。成功提示仍只代表这次真实剪贴板写入；失败不会伪造成功。已切会话、renderer重置或节点移除时忽略迟到结果。

`streaming.mjs` 只对净化后的模型正文做DOM增量，保留由宿主标记的代码工具栏，并在属性删除和写入两处保护它的 `data-wrap`。所以继续生成或完成回复不会把用户的off重置成on，也不会替换工具按钮或代码节点。整个消息的复制/反馈/分叉仍遵循原完成条件；流式代码控件可用不表示模型任务已经完成。

未新增依赖、语法高亮器、代码执行权限或文件写入；Shiki高亮与数学排版不是本批交付。

## 窄检查

`node --test tests/agent-message-code-stream.test.cjs tests/agent-message-stream.test.cjs`：13项通过。新增4项覆盖未闭fence的真实复制、20次增量、on→off→增量→complete、同代码/工具栏/焦点/37px横滚动、点击快照、失败/迟到、双代码块独立状态、不可信HTML、以及净化器没有初始data-wrap时的属性保护。原9项流式行为继续通过，旧测试的“流式零代码按钮”预期已据官方改正。

两个生产模块与QA模块 `node --check` 通过；正式server返回公开QA页面及模块HTTP200。本批只执行相关窄检查，没有扩大已知失败的旧回归。

## 公开隔离QA

入口 `/src/features/agent-messages/qa/code-stream.html` 直接使用正式 `createMessageRenderer`、`updateStreaming` 和现有构建产物中的Markdown净化器。仅显式按钮产生固定文本增量；不调用模型、不写会话/画布或storage，不需要隐含调试对象。

1. “开始未闭合代码块”：代码工具栏已有两个按钮，整条消息动作仍待完成。
2. 点换行按钮，再“追加代码增量”；可见回执应为 `sameCode:true`、`sameToolbar:true`、`wrap:off`。复制并粘贴到页面文本框，回执展示实际剪贴板与当前代码。
3. “1秒后追加增量”后，用Tab聚焦代码换行按钮并等待；追加后焦点保持。较长代码可横滚动，后续增量与完成保持当前scrollLeft。
4. “完成回复”：代码及工具栏身份保持，整条消息动作出现；再复制会取得最终当前代码。“切换为空会话”释放当前消息并停止定时增量。

主线程实际Computer Use已通过：未闭fence仍在streaming时显示两个代码按钮，复制真实写入剪贴板；追加增量后再次复制取得更新后的 `actualCode`，实际粘贴与该代码一致。完成回复时 `sameCode:true`、`sameToolbar:true`，换行保持off。

真实横向wheel将代码滚动至80px后，定时增量仍保持 `scrollLeft:80`、焦点位于自动换行按钮、wrap为off，并保留相同代码与工具栏DOM。切换空会话后工具栏为0。见[实际流式代码控件截图](screenshots/agent-streaming-code-controls-20261005.jpg)。这些证据证明正式消息组件的本地增量、剪贴板和焦点流程，不代表真实供应商模型或全站视觉验收。
