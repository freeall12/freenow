# Agent MCP Apps 卡片

官方参考与证据：`reference/mcp-picker-template-handoff.md`、`reference/agent-apps-20260930.md`。与自由 HTML/Widget 的 `agent-widgets` 分离；应用模板和协议不是任意代码执行接口。

## 模块边界

- `registry.mjs`：三个已接通的版本 URI、模板 ID 范围、展示策略与状态校验。
- `integration.mjs`：会话/trace身份、卡片复用、保存与正常消息队列适配。
- `host.mjs`：JSON-RPC握手、nonce/source、状态回执、运行状态与展示通知。相同host context/run不重发，避免官方模板清空暂停状态。
- `card.mjs`、`styles.css`、`icons.mjs`：官方标题栏/图标、加载与失败、重载、展开和焦点恢复；重载不重提生成任务。
- `resources/`：安装包原始proxy、manifest与HTML模板。包含文件不等于对应工具工作流已实现。

## show_app 合同

Purpose：在Agent会话显示官方本地模板选择器。

Inputs：`resource_uri`（仅motion-picker@v1、creative-picker@v1、website-design-picker@v1），可选title、original_request、recommended_template_id。

Outputs：本地`kind:mcp_app`展示回执；选择由应用通过`ui/message`进入新的用户回合，保留`widgetOrigin`与handoffId。

Permissions：`sandbox=allow-scripts`双iframe；只对manifest与带版本hash的静态HTML开放匿名跨源读取。API继续拒绝Origin:null。消息来源需当前会话、存活trace、对应iframe、nonce及真实当前用户动作；它不是精确意图的密码学证明。模板消息不允许扩大工具权限，所有修改仍经过正常手动确认。

Failure modes：非法资源、初始化超时、保存失败、过期来源、不支持方法均明确失败。`tools/call`、结构化appReply等未实现方法返回JSON-RPC错误。

Logging：会话保存show_app trace、appState、appHandoffs与widgetOrigin；handoff去重与队列同一次提交，失败回滚，不覆盖输入草稿。任意KEY只放服务端。

Tests：host/card/registry、widget queue、stream聚焦回归；手工浏览器验收通过真实OpenAI SDK和本机固定HTTP响应，未调用外部模型。

## 尚未完成

另外19个MCP资源的专属工作流、完整艺术/硬件模板逐项交互、模板文件获取/哈希校验/产物编辑链仍待接入。当前只证实选择器流程；有KEY也不能自动补齐尚未实现的工作流。应用交接已按官方hidden标志隐藏聊天行，原文和widgetOrigin仍保留于历史，修改工具仍需正常确认；运行中不接受新的应用交接。验收见 `reference/agent-hidden-handoff-20260930.md`。
