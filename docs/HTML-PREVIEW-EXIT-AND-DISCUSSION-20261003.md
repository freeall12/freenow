# HTML 预览退出与返回对话

范围仅为 `show_html` 的独立预览，不修改普通内嵌 `show_widget` 的退出、折叠或焦点行为。

## 行为与边界

- 预览的内外两层 iframe 均保留 `sandbox="allow-scripts"` 与既有离线 CSP，不增加网络、同源、导航、工具调用权限。
- 内层真实 Escape 经逐层握手转发。校验消息来源窗口、启动令牌、每次外层加载的 generation/nonce 及每次内层加载的 innerNonce；只有双方 ready 且当前焦点确实位于对应 iframe 才关闭。
- 合成事件、按键重复、IME、已消费事件均不关闭。内层监听在冒泡阶段，延后读取 defaultPrevented，内部菜单可先处理；捕获阶段记录已打开的内层原生 dialog，避免内部处理器先关 dialog 后同一次 Escape 又关闭预览。
- 普通关闭恢复打开前仍存在的焦点。程序调用 close 时，如果外部已获得焦点则不争抢。关闭后解绑监听、撤销 Blob、终止资源准备，旧消息和异步结果失效。
- 桥接仅注入派生预览。保留原始 doctype 的首位，避免切换到 quirks mode；离线导出和已保存作品原文不含预览桥接。

## 可选讨论接口

```js
openHtmlPreview({
  file,
  getCurrentFile: () => store.get(file.artifact_path),
  isCurrent: () => currentConversationIsStillActive,
  onDiscuss: async (latestFile, {isCurrent}) => {
    // 调用方保存引用/草稿，异步步骤前后检查上下文；不自动发送。
    // 成功后下一帧聚焦 composer，避免 modal 尚未关闭时焦点被阻止。
    return true;
  },
});
```

只有提供函数时显示“在对话中讨论”，复用既有按钮样式和 Tabler quote 图标。点击重新读取文件，核对同路径、HTML 类型、有效版本和正文限制；传入最新版本的浅冻结快照，而非打开预览时的旧版本。导出的旧版本约束保持原样。

重复点击合并；返回 `false` 或抛错时保留预览并显示错误，允许重试；其他成功返回关闭预览且不执行旧焦点恢复。父调用方负责对话保存、会话隔离和最终 composer 聚焦。预览自身不发送模型请求。

## 本次验证

`node --test tests/agent-html-preview.test.cjs tests/agent-artifact-local-export.test.cjs`：16/16 通过（10 项预览专项、6 项原导出回归）。两生产模块和 QA 模块语法检查通过。

预览专项使用受控事件/窗口 harness 与现有 jsdom，涵盖可信输入/IME/消费、内层 dialog、握手/重载/焦点守卫、版本更新、来源失效、关闭/会话切换期间异步结果、重复点击、失败重试和成功不抢焦点。它们不替代真实浏览器键盘及原生 dialog 验收。

QA：`/src/features/agent-artifacts/qa/preview-escape.html`。仅内存文件，不写画布或真实会话。

1. 打开预览，点击内部输入框，Escape 应关闭并返回打开按钮。
2. 打开内部菜单，第一下 Escape 只关闭菜单，第二下关闭预览。
3. 打开内部原生 dialog，第一下 Escape 只关闭内部 dialog。
4. 勾选“模拟更新到版本 2”，打开后点“在对话中讨论”，草稿应显示版本 2 并获得焦点，不自动发送。
5. 将讨论结果改为拒绝，按钮点击应保留预览并显示错误。

## 主任务补充的真实浏览器验收

主任务通过 CUA 完成以下实际操作，并反馈本分工记录（本分工未重复操作）：

- 双 iframe 内部菜单第一下 Escape 仅关闭菜单并保留预览，第二下关闭预览并返回打开按钮。
- 内层原生 dialog 第一下 Escape 仅关闭内层，第二下关闭预览。截图：`/tmp/freenow-html-preview-escape-20261003.png`。
- 完整生产主画布的隔离页保存 HTML 并更新到 revision 2，从侧栏打开后点击“在对话中讨论”：预览关闭、输入框获得焦点、既有中文草稿保留。
- 真实 CanvasStore 回读 `artifactRefs` 为 revision 2、`messages` 为 0，刷新后引用与草稿仍保留。截图：`/tmp/freenow-html-discussion-20261003.png`。

以上仅冻结本条预览退出、最新作品引用和草稿保存链路的验收，不代表普通 Widget 或全站交互验收完成。
