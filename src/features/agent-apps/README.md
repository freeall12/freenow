# Agent MCP Apps 卡片

官方参考与证据：`reference/mcp-picker-template-handoff.md`、`reference/agent-apps-20260930.md`。与自由 HTML/Widget 的 `agent-widgets` 分离；应用模板和协议不是任意代码执行接口。

## 模块边界

- `registry.mjs`：四个已接通的版本 URI、模板 ID 范围、展示策略与状态校验。
- `director-markup.mjs`：真实剧本文本输入、官方 DM1 批注解码、已保存正文/位置/批注核对与稳定交接 ID。
- `integration.mjs`：会话/trace身份、卡片复用、保存与正常消息队列适配。
- `host.mjs`：JSON-RPC握手、nonce/source、状态回执、运行状态与展示通知。相同host context/run不重发，避免官方模板清空暂停状态。
- `card.mjs`、`styles.css`、`icons.mjs`：官方标题栏/图标、加载与失败、重载、展开和焦点恢复；重载不重提生成任务。
- `resources/`：安装包原始proxy、manifest与HTML模板。包含文件不等于对应工具工作流已实现。

## show_app 合同

Purpose：在Agent会话显示官方本地模板选择器。

Inputs：三个选择器 `resource_uri`（motion-picker@v1、creative-picker@v1、website-design-picker@v1），可选title、original_request、recommended_template_id。另支持 director-markup@v1，须提供 `data:{draft,locale?}`；正文非空且最多8000 UTF-16字符，locale支持中/英/日/韩/法。不接收预设批注、模板参数或任意工具参数。

Outputs：本地`kind:mcp_app`展示回执；选择由应用通过`ui/message`进入新的用户回合，保留`widgetOrigin`与handoffId。

Permissions：`sandbox=allow-scripts`双iframe；只对manifest与带版本hash的静态HTML开放匿名跨源读取。API继续拒绝Origin:null。消息来源需当前会话、存活trace、对应iframe、nonce及真实当前用户动作；它不是精确意图的密码学证明。模板消息不允许扩大工具权限，所有修改仍经过正常手动确认。

Failure modes：非法资源、初始化超时、保存失败、过期来源、不支持方法均明确失败。`tools/call`、结构化appReply等未实现方法返回JSON-RPC错误。

Logging：会话保存show_app trace、appState、appHandoffs与widgetOrigin；handoff去重与队列同一次提交，失败回滚，不覆盖输入草稿。导演批注保留原DM1文本并附加核对后的可读正文/批注JSON；稳定内容SHA256交接ID用于同页重复确认去重。任意KEY只放服务端。

生产应用状态与消息回执均等待对话 IndexedDB 事务实际提交；保存期间暂锁应用入队、队列编辑和发送，避免消费未确认的消息。提交失败撤销本次状态、队列项及去重身份，不改输入草稿或其他队列项。提交后再次核对会话、trace、资源、保存状态和 iframe 代次；保存期间切换来源或重载时，撤销该入队并等待补偿保存。补偿保存失败明确提示未能保存撤销结果，保留 unsaved 状态且不启动模型。

Tests：host/card/registry、widget queue、stream聚焦回归；手工浏览器验收通过真实OpenAI SDK和本机固定HTTP响应，未调用外部模型。

## 尚未完成

另外18个MCP资源的专属工作流、完整艺术/硬件模板逐项交互、模板文件获取/哈希校验/产物编辑链仍待接入。有KEY也不能自动补齐尚未实现的工作流。应用交接已按官方hidden标志隐藏聊天行，原文和widgetOrigin仍保留于历史，修改工具仍需正常确认；运行中不接受新的应用交接。验收见 `reference/agent-hidden-handoff-20260930.md`。

## 导演画线批注

```json
{"resource_uri":"ui://tapnow/director-markup@v1","title":"雨夜剧本批注","data":{"draft":"林岚推开木门，停在雨里。","locale":"zh-CN"}}
```

直接使用未修改的安装包 `director-markup@v1.4b53a29e.html`。官方 `Rm/q_/J_/H_/Cm/V_` 定义初始数据、可恢复状态、UTF-16坐标和DM1确认；官方宿主 `Bue` 对此资源使用默认不展开策略，无外部媒体白名单。用户可改正文、选择文字添加镜头/运镜、句间插入切镜/情绪、删除批注；编辑覆盖原位置时必须修复失去位置的批注才可确认。

页面先保存最新状态，再确认交接。宿主解码单次正文编辑和紧凑批注，核对已保存正文及实际位置/类型/内容，补充可读正文和批注后通过正常队列请求Agent整理提示词。未保存、失去位置、空批注、拆开emoji的坐标、异步期间来源切换或状态变化均拒绝交接。该确认不触发视频生成，不开放tools/call。状态按UTF-8字节限制128KiB，普通选择器保持64KiB；官方DM1及最终可读交接均保留有界长度，超限需缩短内容。

确定性验收页：`/src/features/agent-apps/qa/director-markup.html`，使用生产registry/controller/host和原始官方页，专用IndexedDB保存真实操作及去重队列，等待事务提交才返回成功。初始读取完成前禁用操作；本页不修改其他画布或清理任何存储。页面显式注明未调用模型。源代码生成的DM1、四类批注、正文编辑、emoji/失效拒绝、重复确认ID与状态容量已有聚焦测试；浏览器和真实模型能力仍须分别验收。

```sh
node --test tests/agent-director-markup.test.cjs tests/agent-app-host.test.cjs tests/agent-app-registry.test.cjs tests/agent-app-card.test.cjs
```
