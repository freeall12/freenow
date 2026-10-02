# Agent 聊天 HTML 与 Widget 卡片

职责：恢复官方 `ShowHtmlCard` / `ShowWidgetCard` 的会话内呈现与交互，不包含独立的 MCP Apps JSON-RPC 运行时。

## 模块边界

- `tools.mjs`：展示工具输入与产物收据验证。准备元数据不执行 HTML，也不代表浏览器已渲染。
- `cards.mjs`、`styles.css`、`icons.mjs`：卡片、官方加载状态/动效、28px Tabler 图标、受控 iframe 生命周期。
- `widget-proxy.html`：基于官方安装包的双 iframe/CSP，新增本地媒体交接回复和捕获helper注入；不再声称是未修改原文件。
- `integration.mjs`：会话与 trace 绑定、卡片缓存、版本验证、预览销毁、消息回传。
- 宿主 `agent-client.js`：队列持久化、OpenAI请求、正常工具确认；执行区 `agent-execution/view.mjs` 负责稳定结果槽，`agent-messages/reconcile.mjs` 避免普通重绘把 iframe 从文档移除。

## 工具契约

| 工具 | 输入 | 输出 | 权限与失败 |
| --- | --- | --- | --- |
| `show_widget` | `widget_code`（非空、最多60000字符），可选 `title`（200字符） | `{kind:'widget',title}` | 非修改工具；代码仅保存于 trace.args，在opaque iframe执行。无代码、工具失败、初始化10秒超时或代理报错隐藏卡片。 |
| `show_html` | `artifact_path`，可选 `title`、`description`（4000字符） | `{kind:'html',namespace,artifact_path,revision,title,description?}` | 只能打开当前画布完整HTML产物。不存在、类型不符、namespace/path/revision变化均失败；点击时再次读取验证，不打开分页片段或旧版本。 |

`createArtifactController({getContext,getStore,onQueuePrompt,onError,...})` 提供 `render(trace)`、`prune(traces)`、`reset()`。同会话同trace普通更新保持iframe；会话切换、关闭、离页销毁它。Widget内部临时状态不跨刷新/关闭持久化。

## Widget bridge

生成的HTML通过 `window.tapnow.sendPrompt(text)` 与 `window.tapnow.openLink(httpUrl)` 使用消息与链接操作；另外 `uploadToCanvas(blob, options)` 只提出真实媒体交接，宿主按钮确认后才创建节点，没有通用canvas/scene/tools/call能力。宿主验证实际frame来源、nonce、完成握手、存活会话以及用户activation/焦点，限制350ms连续动作和并发提交。此门槛只能减少自动脚本/重复发送，不能证明任意组件文本可信；生成内容仍是不可信数据。

消息走真实队列并记录 `widgetOrigin:{traceId,callId,title}`，不覆盖主输入草稿、附件，也不替用户回答待处理问题/表单。来自Widget的新轮次若要修改画布/片场，仍使用正常手动确认，即使全局模式为自动。保存失败会回滚队列；错误记录不能保留可操作展示卡。

日志使用已有会话trace、队列记录和SDK工具输出；不添加secret或完整代码到独立遥测。无Key保持配置错误，不返回伪模型结果。HTML预览默认不提供分享（用户排除范围）。

## 来源与验证

官方包：`/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/widget-proxy.html`；源码：`reference/canvas-current-readable.js` 35499–35609。官方教程：https://docs.tapnow.media/zh/docs/agent/manage-agent-outputs 。

测试：`agent-widget-tools`、`agent-widgets`、`agent-widget-integration`、`agent-widget-host`、`agent-execution-view`；已有stream/HTTP回归覆盖工具续轮与页面生命周期。真实浏览器证据、下载与原生App限制见 `reference/agent-widgets-20260930.md`。不把本地固定SDK回复当作真实模型验收。

## 白模媒体交接追加

`createWhiteboxCapture` 提供指定画布PNG截图及按固定模拟时间/墙钟节拍录制。`uploadToCanvas`传输实际Blob，当前卡片nonce/代码/会话绑定；宿主确认、取消、格式/尺寸/时长检查、素材保存、回执和仅保存重试均有实现。来源参考中仅发现该API名称，参数、确认界面与捕获helper是本地实现，并非恢复了缺失官方附件。

主入口将保存回执追加到原widget trace.result.mediaOutputs，供下一用户轮查读。截图/录像不自动向模型发送提示或生成视频；下载前不改变画布。详细接口与验证范围见 [集成记录](../../../reference/agent-whitebox-handoff-integration.md)。
