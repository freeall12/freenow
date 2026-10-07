# 本机外部 Agent：只读 MCP 第一阶段

实现日期：2026-10-08。生产入口为 `window.ExternalAgentUI.open()`，画布帮助菜单和桌面 Agent 菜单可打开连接面板。此模块服务能启动本机 MCP stdio 子进程的客户端；云端 HTTP 连接器、写操作、生成、任意工具转发、官方 TapNow 服务均未接入。

## 实际接入

启动桌面后打开“连接外部 Agent”，复制面板**当前实际生成**的 `mcpServers.freenow` 配置，合并到支持 stdio 的客户端配置。它使用本应用实际 Electron executable、runtime 中的 `server/external-agent/stdio.cjs`、此次应用生命周期的私有 socket 和 `ELECTRON_RUN_AS_NODE=1`。配置没有 API Key、OAuth token 或远端地址。

客户端完成标准 `initialize` 和 `notifications/initialized` 后，`tools/list` 只返回两项固定工具。此时仍不能读取画布。回到桌面连接面板，对该客户端点击“授权读取”，并在原生对话框确认当前项目和元数据范围。自报 clientInfo 只作显示，不是应用身份认证。

授权一小时，仅绑定当前 connection、桌面窗口、页面生命周期和项目 ID。重载、切换项目、关闭、撤销、过期均使旧权限失效；重连不会继承权限。未握手 socket 10 秒断开，已握手但未批准、撤销或过期的连接在 5 分钟后断开；请求活动不延长批准等待期限。

浏览器版的同一面板明确显示没有本机 MCP 通道。连接地址不能替换成官方服务或任意 URL；本模块不增加 HTTP server、CORS、OAuth、远端资源请求或模型轮次。

## 工具合同

| | `workspace_status` | `canvas_read` |
| --- | --- | --- |
| Purpose | 查询获批活跃画布的元数据状态 | 分页列出获批活跃画布节点概要 |
| Inputs | `{}` | `offset` 0–100000、`limit` 1–50（默认20）、可选64位 `expected_revision` |
| Outputs | `project_id,revision,read_only,node_count,edge_count` | 同前，追加 `offset,next_offset,nodes` |
| Permissions | 当前有效客户端 grant | 同前；只允许元数据 capability |
| Failure modes | 未批准、过期、撤销、页面未就绪/已离开、工作区变化 | 同前，加 revision 变化、非法分页参数 |
| Logging | 无提示词、内容、节点或路径日志 | 同前；协议 stdout 只写 MCP 帧 |
| Tests | 协议、真实 socket、主进程边界与生产宿主 QA | 同前，加分页/revision/字段隔离 |

节点字段只有 `id,type,title,x,y,width,height,selected`；只读取实际 `string node.title`，没有标题时为空串，绝不从隐藏 name/label、正文或提示词补标题。没有图像/视频/音频 bytes、URL、预览、会话、文件路径、模型 Key、正文或提示词。titles 是不可信用户数据，工具目录明确告知外部 Agent 不得当成指令。

revision 是当前元数据快照（项目、全部节点概要与连线身份）的 SHA-256，不是磁盘保存证明、整个工作区正文 hash 或写入版本。第一页返回 revision，后续页传 `expected_revision`；元数据变动时返回 `revision_changed`，客户端须重新读取。只读查询不调用保存、导出、供应商或生成，也不证明模型输出已完成。

## 实际生产链

```text
客户端 stdin/stdout
→ server/external-agent/stdio.cjs + protocol.cjs
→ socket-client.cjs
→ 私有 Unix socket → broker.cjs
→ desktop/external-agent.cjs（批准/范围/来源与生命周期）
→ preload 的窄请求/回执桥
→ 本模块 host.mjs
→ 当前生产 window.CanvasApp.getState()
```

`desktop/main.cjs` 创建 broker 并管理导航/崩溃/关闭失效；`desktop/preload.cjs` 只在本机顶层主页面暴露 `FreenowExternalAgent`。主进程检查 webContents、mainFrame、实际本机 URL 与 URL project ID；回执按 requestId、frame、pageId、projectId、epoch 匹配。broker 在派发前和异步返回后再次验证 grant，并在输出前校验严格结果 schema，额外字段使整个结果失败。

socket 位于应用专有子目录：canonical、当前用户持有、目录 `0700`、socket `0600`；名称每次应用启动随机生成，不能替换已有 socket。连接上限8、每连接并发上限4、每分钟60请求，输入单帧64 KiB、输出128 KiB、队列积压256 KiB。边界限于同用户进程，不能将文件权限宣称为抵御已经控制该系统用户的强沙箱。标签不是已验证客户端身份，所以授权窗口明确标注“未经身份验证”。

所有授权只在内存中保存；无凭据文件、自动授权、持久通用 token、任意 JS/shell/文件命令或通用工具名称映射。读取获批元数据仍可能使外部客户端将其发送到自己的模型；授权 UI 明确说明这一点。

## 本次定向验证

```sh
node --test tests/external-agent-protocol.test.cjs \
  tests/external-agent-broker.test.cjs \
  tests/external-agent-host.test.cjs \
  tests/external-agent-desktop.test.cjs \
  tests/external-agent-ui.test.cjs
```

这组回归覆盖协议、严格参数/结果、真实 socket、真实 stdio 子进程、未批准拒绝、逐客户端隔离、过期/撤销/取消、迟到回执、导航/关闭失效、原始 socket 占满后的超时释放、隐藏字段不导出、原生批准默认取消及 frame/sender 验证。

当前共 21 项：protocol 5、broker 6、host 2、desktop 5、UI 3，包含关闭后的 IPC guard 回归。此前合并运行的 19 项全部通过；新增动态 Tab 与 closed guard 后，最新 desktop + UI 定向运行的 8 项全部通过。其余 13 项在此前运行通过，此后未改动；本次收尾未重复运行其他旧测试套件。相关源码语法检查通过。

受主进程新增桥影响的保存/退出夹具已适配独立传输替身，`tests/desktop-main-startup-close.test.cjs` 的 6 项通过；检查保存拒绝时不关闭连接、正常退出只关闭一次，以及后台关闭未确认时保留页面和恢复输入。此夹具执行真实 main 与页面生命周期，socket/IPC 由替身隔离，不能据此增加真实外部客户端验收范围。

其中 broker/desktop 单元回归使用合成公开状态、窗口和对话框对象；**这些测试不替代实际 Electron main → preload → CanvasApp 链路验收**。真实 stdio 子进程回归仍通过夹具 dispatch，不能称为生产画布验证。

实际生产验收使用 [production-client.cjs](../../../tests/fixtures/external-agent-production-client.cjs)。它启动配置所用的 Electron-as-Node executable，通过生产 socket、main/preload 和 CanvasApp 获取真实状态，自己不批准、不提供 renderer 夹具、不打印节点 ID/名称/内容。操作者必须在真实 GUI 建立公开 QA 画布与节点、批准客户端，再撤销或重载；客户端只输出握手、工具名、拒绝状态、计数与 revision 一致性。

2026-10-08 实际生产验收：隔离、无 Key 的源码桌面通过真实 GUI 新建公开 QA 项目、添加并命名一个文本节点；正常 Cmd+Q 后用同一临时 profile/公开 project ID 重启最新 main/broker/host。真实客户端的标准握手与两工具目录通过；批准前返回 `authorization_required`。操作者用原生对话框明确批准后，实际生产链返回 `nodeCount=1, edgeCount=0, returnedNodes=1, revisionBound=true, stderrBytes=0`。真实 Cmd+R 之后，旧客户端读取被拒绝，验收客户端报告 `productionRevocation=passed` 并正常退出。

公开的[原生批准后连接面板截图](../../../docs/screenshots/external-agent-production-authorized-20261008.png)记录范围与状态。验收程序没有输出项目 ID、节点 ID、名称或正文。此记录证明源码生产通路，不是旧 Alpha 安装包验收，也不是两个商业 Agent 产品的真实配置验证。

真实 UI 发现并修复轮询替换按钮导致的 AX identity/焦点丢失：客户端行按 connection ID 保留同一个按钮，未变化时不重建行，批准等待期间不刷新；三项 UI 回归验证轮询、状态改变与客户端增删不会丢失原按钮和焦点，并验证异步加入的客户端按钮参与 Tab/Shift+Tab 循环。实际 GUI 用一个始终未批准的新 pending 客户端验证：从关闭按钮连续三次 Tab 到“授权读取”按钮（AX46），轮询后仍保留同一 AX46 和焦点；Tab 循环返回关闭，Shift+Tab 返回 AX46。该客户端未被再次授权，元数据读取保持拒绝，随后正常停止。

最后一次退出验证在包含 closed guard 的最新 main 上执行：复用同一隔离 QA profile/公开项目，确认此前公开节点仍在，未再连接、握手、批准或读取；正常 Cmd+Q 后桌面进程（session 38041）exit 0、输出为空，4183 端口已释放，未出现关闭后的 IPC handler 错误。关闭后保留的 handler 会先拒绝全部方法，避免迟到的 pagehide 注销产生错误，同时不再访问 broker 或打开批准对话框。

## 隔离源码 QA 与重启

仅开发版本支持以下命令。QA profile 使用新建的临时目录，供应商配置是无 Key 模板，与用户的实际桌面存储分开：

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin TMPDIR=/tmp \
  node_modules/.bin/electron desktop --freenow-source --freenow-external-agent-qa
```

生产页面初次运行可能读取工作区旧的、未跟踪的 `canvas-data.js`，因此在真实项目 UI **新建并切换到一个公开空画布**、添加公开节点之后，才允许批准外部 QA 客户端。不要授权默认旧画布，也不要拿它的数据作验收。生产打包会使用 `defaults/canvas-data.js`，与源码旧 fixture 的边界见项目打包规则。

正常 Cmd+Q 保存并退出后，可显式复用该 QA 临时 profile，并直接打开已创建的公开项目。只允许 canonical、当前用户持有、`0700`、位于实际临时目录下且名称为 `freenow-desktop-qa-xxxxxx` 的目录；任意其他 userData 路径拒绝。参数仅开发 QA 使用，不由 MCP 客户端设置，也不在已打包版本生效。

```text
--freenow-source --freenow-external-agent-qa
--freenow-external-agent-qa-profile=<此前实际生成的私有临时目录>
--freenow-external-agent-qa-project=<实际公开项目ID>
```

socket 随应用生命周期更新，重启后必须使用面板的新配置。生产打包需将新增源码纳入仓库追踪，再按已有桌面准备流程构建；当前准备脚本只复制追踪的公开运行资源，不会扫描用户私有数据或为了未追踪开发文件扩大复制范围。

桌面打包只包含生产 `external-agent.cjs` 桥，开发用 `external-agent-qa.cjs` 不纳入 ASAR。主入口在 `!app.isPackaged` 且显式 QA 参数成立时才加载该帮助模块；本次静态配置核对通过，没有为此重建旧 Alpha。

## 未完成范围

尚未验证两个独立第三方 Agent 产品的配置界面与完整对话，也未做新桌面包产物验收。已有测试客户端验证标准协议，不等于官方客户端认证或市场发布。写操作、生成、结果回填、媒体像素、素材库、OS 文件、多项目全库、OAuth 与云端 HTTP 均需独立合同、产品确认和验收。
