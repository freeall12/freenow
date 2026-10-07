# 外部 Agent MCP 接入：官方合同、本地缺口与最小实现

日期：2026-10-08。范围：官方公开帮助文档、TapNow macOS 安装包公开运行资源、本仓库源码。本文是研究与后续设计，未实现外部 MCP 服务。

## 结论

官方帮助菜单中的“连接 Agent”是让其他 Agent 连接 **TapNow 提供的外部 MCP 服务**，不是本产品内置 Agent 的模型设置。内置 Apps 使用的 iframe MCP Apps 协议、内置 Responses API 工具、供外部 Agent 调用的 MCP 服务是三个不同层次。本地已经实现前两层的一部分，**尚未实现第三层**。

官方公开合同包含远端服务地址、浏览器账户授权、团队绑定、生成计费、画布回填及素材库访问。本仓库是独立本机产品，不能复制官方地址并宣称外部接入已完成，也不能通过该入口静默访问官方服务。最小本地方案是先让支持本机 stdio MCP 的客户端接入桌面工作区，使用显式客户端授权、窄工具白名单和活跃画布宿主桥接；云端 Agent 接入另立项目。

## 1. 证据与验证边界

本次只读取公开文档 HTML、安装包公开 JS/HTML 与项目源码。未登录、未读取私人画布/素材库/Key、未向官方 MCP endpoint 发起握手或工具请求、未触发生成、未使用 CUA。仓库 `main` 上已有其他任务的未提交修改；本文以当前工作区源码为快照，未修改那些文件。

| 证据 | 实际读取位置 | 可以证明什么 |
| --- | --- | --- |
| D1 | [在其他 Agent 中使用 TapNow](https://docs.tapnow.media/zh/docs/mcp/use-tapnow-in-other-agents) | 服务角色、公开能力、生成费用与结果位置 |
| D2 | [添加自定义连接器](https://docs.tapnow.media/zh/docs/mcp/add-a-custom-connector) | 两个地区地址、一次浏览器授权、账户/团队范围、连通性检查方式 |
| D3 | [通过官方插件添加](https://docs.tapnow.media/zh/docs/mcp/add-through-an-official-plugin) | WorkBuddy、千问办公、豆包工作的市场安装形态 |
| O1 | `/Applications/TapNow.app/Contents/Info.plist` | 安装包版本与构建号均为 `0.4.81` |
| O2 | `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` | 旧安装包有 `mcpApp`、启动目录授权相关文案；指定外部入口字符串未检出 |
| O3 | `/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/mcp-app-proxy.html:17` | 双 iframe、`postMessage`、nonce、sandbox/CSP 的 Apps 代理边界 |
| L1 | [host.mjs](../../src/features/agent-apps/host.mjs)、[registry.mjs](../../src/features/agent-apps/registry.mjs) | 本地 Apps 的握手、资源白名单和逐应用工具回调 |
| L2 | [agent-tools.js](../../agent-tools.js)、[server/agent.cjs](../../server/agent.cjs) | 本地工具 schema 与 Responses API 函数调用循环 |
| L3 | [server/server.cjs](../../server/server.cjs)、[agent-client.js](../../agent-client.js) | 本机 HTTP 路由与浏览器宿主实际工具执行位置 |
| L4 | [canvas-store.js](../../canvas-store.js)、[project-context.js](../../project-context.js) | 浏览器 IndexedDB 与项目 namespace；外部进程不能直接当作已有后端项目 API |
| L5 | [出站边界](../server-outbound-policy.md)、[desktop/files-bridge.cjs](../../desktop/files-bridge.cjs)、[server/desktop-files.cjs](../../server/desktop-files.cjs) | 已有供应商出站保护、显式单目录文件授权，不等于外部 MCP 客户端已获授权 |

主线任务提供的官方 Web 实测：帮助菜单有“最近更新 / 使用教程 / 连接 Agent / 反馈问题 / 快捷键”；“连接 Agent”打开“在 Agent 中打开”对话框，出现 WorkBuddy、千问办公、更多 Agent。更多 Agent 提示把提示词粘贴到支持 MCP 的 Agent，并链接 D1。**这是主线提供的界面证据，本次未独立重复操作。**

O2 对 `WorkBuddy`、`workbuddy`、`千问`、`connectAgent`、`openInAgent`、`mcp.tapnow`、`agent-gateway`、`use-tapnow` 未命中。安装包与线上版本可能存在差异；不能据此否定主线刚观察到的线上入口。D3 还列出豆包工作，不能据此给刚观察到的对话框补造一个按钮或市场链接。D2 有“复制提示词”按钮，但本次未获得其点击后完整剪贴板内容，不声称原提示词已还原。

公开 HTML 与安装资源的 SHA-256（HTML 是本次响应快照，不保证未来响应字节相同）：

```text
D1 0753a8d07860a4df5dd8de6bf01d6900a7664f964900a9eafb4c9b54b45250f2
D2 2e96744139f2d86ff707852df5995100ef13668e9319180b007810a80f6c89a2
D3 6a38943955fd5d1b58f850e1854c6e2a22e85b8337beba11c106cbd76d4adc37
O2 a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4
O3 094188fcb51c1d80b064d1673f9ee6aa9f46701403537af42ea8103d85c6729f
```

## 2. 官方外部 MCP 的已知合同

### 接入与账户

以下地址是 D2 的原文，**仅作为研究证据，不是本地 freenow 配置值**：

| TapNow 网站 | 文档公布的 MCP 地址 |
| --- | --- |
| `app.tapnow.ai` | `https://mcp.tapnow.ai/api/agent-gateway/mcp/general/mcp` |
| `app.tapnow.media` | `https://mcp.tapnow.media/api/agent-gateway/mcp/general/mcp` |

D2 的步骤是添加名为 TapNow 的自定义连接器、填地址、连接、在浏览器登录并同意授权。连接地址自身不带身份信息；授权后的连接器可以使用对应账户生成并消耗 Tapies。授权限定登录的账户与团队，切换目标团队后须重新授权。文档建议通过“列一下我最近的 TapNow 画布”检查连接。

地址形态证明公开的远端 HTTP 接入点；**本文未验证实际 MCP protocolVersion、Streamable HTTP/SSE 传输协商、OAuth 元数据地址、scope、token 生命周期、客户端注册方式或工具 schema**。不要仅凭“浏览器授权”补造 OAuth endpoint，也不要把 UI 名称当作远端 `tools/list` 返回的工具名。

### 能力与结果

| D1 公布的能力 | 公开费用/结果合同 | 本次证据等级 |
| --- | --- | --- |
| 单图、短视频、电商组图、整套演示配图 | 生成消耗 Tapies，费用与站内生成一致 | 文档声明，未调用验证 |
| 改成各平台尺寸 | 文档标为不消耗 Tapies | 文档声明，具体方法/schema 未知 |
| 素材库检索、指定文件夹保存 | 与站内同一份素材库，文档标为不消耗 Tapies | 文档声明，未读取私人内容 |
| 最近画布列表 | 可用于连接检查，文档标为不消耗 Tapies | 文档声明，未执行检查 |
| 生成结果 | 自动进入授权账户的画布，回复带画布链接 | 文档声明，未生成验证 |

D1 提醒 Agent 可连续提交多项生成，建议先明确数量、类型、比例再执行。D2 提醒图片与视频有异步等待，必要时再次查询结果。不能把文档所述能力等同于已观测到的生产成功率、质量或延迟保证。

D3：WorkBuddy 有 TapNow 连接器和 TapNow 创意工作室专家；千问办公是带连接器与创作技能的“TapNow 创意工作室”专家套件；豆包工作是同名插件。安装仍需账户授权，市场可见性受账户、工作空间与版本影响。这些入口也不是内置模型供应商选择器。

## 3. 本地三个协议层分别是什么

| 层 | 现有实现 | 调用者/执行者 | 为什么不能当作外部 MCP 已完成 |
| --- | --- | --- | --- |
| 内置 Agent 模型工具 | `agent-tools.js:5` 定义 `{name, description, parameters, mutates}`；`server/agent.cjs:57` 转换为 Responses `type:function` | 本机服务调用配置的模型；浏览器宿主执行返回的函数调用 | 没有标准 MCP `initialize`、`tools/list`、外部连接会话；工具 schema 是素材，不是服务 |
| 内嵌 MCP Apps | `host.mjs:142` 处理 `ui/initialize`；`:304` 处理 `ui/notifications/initialized`；逐资源处理 `tools/call`、`ui/message` | 受控 iframe 与本页宿主通过 `postMessage` 交互 | `ui/initialize` 是 Apps UI 握手，不能替代外部 MCP server 的 `initialize`；其 `tools/call` 只在特定 iframe/resource 回调范围内成立 |
| 外部 MCP 服务 | 当前未发现实现 | 将来由外部 MCP 客户端调用本机工作区 | 当前无传输适配、外部工具目录、客户端授权、会话/工作区绑定或接入验收 |

Apps 限制有实质实现：`host.mjs:171` 只允许本应用的生成工具；`:181` 对素材库/进度查询指定单个工具名；`:219` 按资源只开放明确的保存/应用工具；`:263` 验证当前真实用户动作。O3 的内 iframe 仅 `allow-scripts`，没有 `allow-same-origin`，nonce 与来源验证用于隔离模板。MCP Apps HTML 中出现 `tools/call` 不代表第三方 Agent 可以连接 HTTP server。

`agent-client.js:328` 的 `executeTool` 使用 `window.AgentTools.parse`，之后读取 `app`、画布节点、浏览器资源和功能宿主。不能在 Node 中简单 `require(agent-tools.js)` 后直接得到执行器。`server/server.cjs:42` 校验 localhost/127.0.0.1 Host，`:50` 限制 API Origin，`:115` 监听 loopback；这是现有本机 API 边界，**不是外部客户端认证或授权系统**。无 Origin 的本机进程请求不能仅靠这条 Origin 检查获得客户端身份。

定向源码搜索未发现 `@modelcontextprotocol`、`McpServer`、`StdioServerTransport`、`StreamableHTTP`、`tools/list`、外部 `/mcp` 服务路由、OAuth discovery 实现。搜索范围为 package、server、业务源码与根 Agent 入口，不含整个资源 bundle 和测试夹具。结论限于当前工作区的这些入口。

## 4. 本地缺口与可复用边界

| 缺口 | 可以复用 | 必须新增或适配 |
| --- | --- | --- |
| MCP 传输/生命周期 | Node/Electron 运行环境 | 标准握手、能力协商、工具目录、调用/取消、stdio 帧与请求大小限制 |
| 外部客户端身份 | 桌面窗口与私有用户数据目录 | 独立客户端授权记录、绑定与撤销；不能复用 Agent 模型 Key |
| 工作区实时状态 | CanvasStore、CanvasProjectContext、活跃宿主 | 当前窗口/project/revision 的窄桥接；禁止另一进程直接读写 Chromium IndexedDB 文件 |
| 外部工具执行 | 部分领域模块、工具参数校验、现有回执/恢复 | 白名单执行端口，明确工作区所有者与并发写入规则；不能导出闭包或映射任意工具 |
| 图像/视频结果回填 | 生成网关、任务状态、浏览器结果应用逻辑 | 外部调用与原任务 ID、真实资源、当前画布 revision 的关联；完成与已保存分开报告 |
| 外部写入/生成权限 | 内置确认 UI、来源绑定、持久回执 | 为外部客户端单独授权具体操作与参数；内部 autoConfirm 不继承给外部客户端 |
| 可用连接说明 | 官方入口的交互参考 | 真实本地安装配置、能力/平台限制、可验证连接状态；不得伪造市场上架链接 |

桌面单目录文件桥接正在其他任务中修改。它的授权来自原窗口的选择器，并有独立 owner、grant 和回执；外部连接不自动继承它。现有“启动目录”或 Apps 素材库授权也不能推导出全磁盘或任意文件读取权限。

## 5. 推荐最小架构：桌面本机 stdio 第一阶段

下列目录/工具名均为**拟新增设计**，不是已有公开 API。第一阶段只服务有本机进程能力的客户端；Cloud ChatGPT 或其他云端连接器通常无法访问用户的 loopback/Unix socket，不能承诺所有支持 MCP 的 Agent 都能直接连上 freenow。

```text
支持 stdio 的外部 Agent
  ↕ 标准 MCP（stdin/stdout，仅协议帧）
scripts/freenow-mcp.cjs                 拟新增：传输入口
  ↕ 仅本机私有 IPC（无远端网络，无通用命令）
desktop/mcp-broker.cjs                  拟新增：原生授权、连接绑定、生命周期
  ↕ 限定 sender / owner / project / revision / capability
src/features/external-agent/host.mjs    拟新增：活跃画布领域执行端口
  ↕ 已有领域模块、保存/撤销/真实媒体来源
当前桌面画布 + 已有本机生成网关
```

broker 使用应用专有目录下的私有 Unix socket；目录 `0700`、socket `0600`，拒绝 symlink 与非本应用创建的路径。权限位只是同用户进程边界，不能替代连接授权。首次 stdio 连接由桌面原生窗口展示工具范围，用户选择当前项目并批准后建立短期 connection capability；绑定实际连接与窗口生命周期，进程关闭/项目切换/撤销即失效。未授权只允许协议握手，不返回项目或媒体数据。

授权记录只包含 client label、grant ID、工具集合、project ID、过期时间，不保存模型 Key。客户端自报 `clientInfo` 只是显示信息，不能当作经过验证的应用身份。外部脚本不可把自己声明为“WorkBuddy”来跳过授权。第二连接或重启须重新核对批准记录与实际会话，不继承上一个进程的权限。

桌面 IPC 必须验证 `webContents`/frame sender、当前本地页面 URL、窗口 owner、grant 版本、请求尺寸、工具 schema 与资源身份；渲染进程只收到当前请求允许的数据，不能调用任意 JS、任意 shell、任意服务路由。页面关闭/未就绪/项目变化返回 `workspace_unavailable` 或 `workspace_changed`，不隐式启动其他画布、不默默回退到另一个项目。

### 拟新增模块与最小职责

| 模块 | 职责/输入/输出 | 权限与失败行为 |
| --- | --- | --- |
| `server/mcp/protocol.cjs` | MCP 初始化、协商、工具目录、严格 request/schema 验证 | 无领域副作用；未知方法/版本/超大输入拒绝；stdout 无运行日志 |
| `server/mcp/tools.cjs` | 少量 MCP 工具 schema、结果封装与 annotations | allowlist；annotations 只作提示，运行时权限仍必须验证 |
| `desktop/mcp-broker.cjs` | 连接/原生授权/撤销/窗口绑定与序列化派发 | 默认拒绝；速率与并发限制；无公网监听 |
| `src/features/external-agent/host.mjs` | 根据当前项目执行领域查询/批准的修改并保存 | 单写者、revision 与真实来源检查；保存失败不能回报 committed |
| `server/mcp/receipts.cjs` | operation_id、参数摘要、批准范围、真实任务 ID 与回执 | 不存 Key/完整私人媒体；未知结果先查原回执，不重发生成 |
| `src/features/external-agent/connect.mjs` | 接入帮助、活跃连接、可撤销工具范围、真实连接检查 | 只生成本机实际配置；不宣称已安装/已登录/已连接 |

若选择 MCP SDK，需要依赖评估与项目依赖审批；本文不安装或添加任何依赖。若未来增加 HTTP transport，需要单独的 loopback token、Host/Origin 检查、会话身份、请求限制与撤销方案，不能直接给现有 `/api/*` 开放 CORS。远端 HTTP/账户 OAuth 属于后续独立范围，不能通过暴露本地服务或隧道偷渡实现。

## 6. 第一批工具与权限设计

工具名只是本地建议；官方真实工具名仍未知。

| 拟开放工具 | 输入/输出 | 权限与数据边界 |
| --- | --- | --- |
| `workspace_status` | 返回已批准 workspace ID、revision、可执行能力与宿主可用性 | 连接获批后只读；不返回所有私人项目/会话 |
| `canvas_read` | 限额分页节点概要、连接、实际 revision | 仅已批准项目；默认不返回媒体字节、隐藏会话正文或系统路径 |
| `media_inspect` | 已批准项目内实际节点 ID、明确视图参数 → 限额图片/元数据 | 媒体内容权限单独声明；本地解码；不下载任意 URL |
| `library_find` | 关键词/已批准文件夹/分页 → 元数据 | 首期可延后；只访问用户显式选定的素材库范围 |
| `canvas_propose_edit` | operation_id、expected_revision、白名单节点操作 → proposal ID/digest | 先给当前桌面用户审阅；提案不会修改节点 |
| `canvas_apply_edit` | proposal ID/digest → applied/saved/revision/receipt | 只执行宿主已批准的同一参数摘要；过期/来源变化/已撤销拒绝 |
| `generation_propose` | 实际来源节点、数量、种类、参数 → 提案与出站说明 | 尚不提交；验证配置不代表生成已授权 |
| `generation_submit` | 已批准 proposal + stable operation_id → actual task ID/status | 精确一次提交；配置身份、来源与批准摘要变化须重批 |
| `generation_status` | 该 grant 的实际 task ID → 真实任务/应用/保存状态 | 只读查询不触发恢复、重发或跨客户端读取 |

初期最小可交付只需 `workspace_status` + `canvas_read`，验证外部客户端确实能得到当前真实画布；然后开放确定性的本地修改；最后开放生成和结果回填。`show_app`、`ui/message`、`ask_question`、委派、技能保存、桌面文件整理不应默认导出，原来为内部 UI/模型轮次设计的确认不是外部调用协议。

### 出站、文件与审计

- 外部 Agent 从本机工具接收媒体后，可能把它发给自己的模型；授权页应说明“允许该客户端读取选定媒体”，不能把本机传输描述为全链路离线。元数据只读与媒体像素读取使用独立 capability。
- 生成批准必须显示实际供应商/模型、数量、类型、目的用途、发送的提示词/参考素材、费用未知或可用估算，不能展示虚构 Tapies。本地网关沿用既有原站域禁用与 redirect guard。
- 工具参数不接收 API Key、自定义 endpoint、任意 URL、任意绝对文件路径、执行脚本或命令。配置供应商在本产品服务端完成，工具不能改目的域。
- 初期不提供 OS 文件工具。后来导入/导出使用原生文件选择器生成单文件/单目标 capability，绑定 bytes hash、期限与 owner；目录整理另需显式目录授权及逐批预览，不继承全磁盘读写。
- 记录 connection ID、grant ID、project ID、request/operation ID、tool、参数摘要、revision、授权状态、任务 ID、applied/saved/providerDispatched、错误码。日志不记录 Key、完整素材内容、私人路径或完整提示词。
- 请求取消可停止尚未提交动作；已被供应商接受的任务保留真实 ID 并说明状态。超时/崩溃后若结果未知，查询同一操作回执；不能通过换 operation_id 自动重复扣费。

## 7. 可执行后续顺序与验收

1. **只读 MCP 闭环**：加入 desktop broker 与 stdio adapter，只列两项读取工具。桌面批准一个项目，外部客户端完成标准初始化/工具目录/真实 `canvas_read`，未配置 Agent 模型也能查询；未批准、换项目、关闭窗口、重启、撤销均拒绝。
2. **确定性本地编辑**：抽取一个小领域命令执行端口，提案 → 原生确认 → exact digest apply → 保存/撤销。并发手动编辑使 revision 过期，不能覆盖用户操作；相同 operation_id 重试返回同一回执，不创建第二节点。
3. **生成与回填**：复用网关，不经过额外模型轮次。显示实际出站范围，提交前持久批准/操作身份，记录实际任务，用户取消/断线/服务重启后只查原任务，只有已保存真实媒体才能回报 saved。用本地 provider fixture 验证，真实供应商质量另验收。
4. **接入帮助界面**：菜单命名“连接外部 Agent”，展示本机 stdio 的真实配置、当前平台限制和连接状态。未实现时明确标记；官方服务帮助仅作参考链接，不生成安装成功或登录成功反馈。

必须覆盖的回归：MCP 握手/版本/notifications/JSON-RPC 错误/取消；协议 stdout 干净；未批准客户端零数据；伪造 clientInfo/窗口 sender/资源 ID 拒绝；grants 撤销、到期和跨项目隔离；注入字段、任意 URL/path/shell 拒绝；来源变化、并发写入、保存失败、重复 operation_id/变化摘要；生成未配置/未批准零出站；完成、applied、saved 独立；未知任务不重发；Key/私人路径不出现在结果和日志。

验收至少使用两个支持本机 stdio 的真实客户端执行只读查询，再完成本地 fixture 的批准/编辑/保存闭环。内置 Agent 回归或 iframe Apps QA 通过不能替代外部 MCP 验收。云端接入、官方市场发布、OAuth、多用户/团队与全库访问均不计入第一阶段完成条件。

## 本次交付

只新增本文。公开文档读取与源码定向核对完成；未做外部 MCP runtime 测试，因为当前实现不存在。本地最小接入方案仍是建议，不代表任何配置、路由、工具或权限已创建。
