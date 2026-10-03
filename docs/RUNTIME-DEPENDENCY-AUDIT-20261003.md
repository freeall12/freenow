# 运行时原站依赖独立审计 · 2026-10-03

## 阅读规则与本轮收尾状态

本文件先列收尾状态，再保留早期审计证据。**“历史审计存档”分隔线后的章节全部描述当时版本，其中“当前”“最终”“本轮”不代表收尾版本。** 特别是“主页面 CSP 已撤回”“product-kit 未注册”“只读审计、未浏览器验收”均为历史阶段结论，不能作为现在的事实引用。

- 主 `index.html` 已有严格同源响应 CSP；同源生成网关与已落盘生成媒体替代了此前阻碍主页面收紧的浏览器直连路径。App/widget 专用策略独立保留。
- HTML 预览/下载已接共享资源派生；主线程报告实际完成 HTML 下载、重新打开、真实图像、计数及交互验收。Agent 会话附件迁移也已用真实 PNG 完成迁移、权威回读与刷新复验。这些浏览器证据由主线程取得，本审计整理者没有重复操作。
- Widget 入向资源已经接线，合同见 [Widget HTML 入向资源本地化](widget-html-resource-localization.md)；product-kit 已接实际本地产品图，当前合同与浏览器证据见 [本地运行边界](LOCAL-RUNTIME-BOUNDARIES-20261003.md)。不能沿用历史的未接入结论。
- 未映射资源仍需明确导入或修复；静态资源本地化、资源请求阻断、浏览器功能验收分别报告。没有据此声称任意历史 HTML、动态脚本或全部模型供应商能力都已验收。

## 当前补充复核：同源网关落盘后的主页面 CSP 与剩余持久资源

本节优先于历史存档。最初补充复核为只读代码与文档，随后完成共享 HTML 模块的专项测试和独立组合复核；主线程另外完成了上述实际浏览器验收。文中代码行号对应各次复读时，不应代替最终代码定位；最初收尾仅整理文档，此后本轮 Agent Markdown 导航专项已修复代码、重建 bundle 并执行定向检查，见第 3 节，未追加浏览器操作。

### 主页面严格同源 CSP 已落地，按具体功能记录验收

追加复读确认 `server/server.cjs:80` 已对 `relative === 'index.html'` 返回下述同源策略，覆盖 `/` 与 `/index.html`；`:83` 的 App/widget HTML 专用策略保持独立。主页面及既有 Three 片场的浏览器记录见本地运行边界；后续 HTML 导出和会话 PNG 迁移验收由主线程单独完成，不能把局部通过扩大为全部编辑器或供应商验收。

此前撤回全局 CSP 的两个主要原因已经发生实质变化：`generation-ui.js:70–88` 的主 provider 固定使用同源 `/api/generation`；`generation-config/client.mjs:16` 配置保存也只 POST 同源端点。网关目标地址是送给本机服务的配置数据，浏览器不再对它直接 POST/poll。生成媒体通过已封存的本地 API route 读取。页面 CSP 不影响本机服务按显式配置访问独立供应商。

主 `index.html` 的直接资源属性聚合为 21 个 link.href、2 个 img.src、71 个 script.src，共 94 个，远程属性计数为零。主链未发现必需远程字体、模块、Worker、WebSocket 或 AudioWorklet。图片编辑器 `image-editor-entry.mjs:25–26` 的 FontFace 使用本地 `assets/fonts/`；Three 在 `studio.mjs:29` 与 `studio-v2/model-io.mjs:11` 使用本地 `/node_modules/three/.../draco/gltf/` 解码器。DRACOLoader 会读取本地 JS/WASM，并用 Blob 创建 worker，不能遗漏 `worker-src 'self' blob:` 和当前 WASM/动态代码所需 eval 权限。Fabric/Tiptap 资源来自项目本地 bundle。

已用于**主页面**的权限形状：

```text
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;
style-src 'self' 'unsafe-inline';
connect-src 'self' data: blob:;
img-src 'self' data: blob:;
media-src 'self' data: blob:;
font-src 'self' data: blob:;
worker-src 'self' blob:;
frame-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self'
```

不要用通用全HTML规则覆盖已有 opaque App/widget 代理的专用权限和本地握手处理。主页面策略足以阻止未映射原站 `img/video/audio/fetch` 自动发出请求，并保留数据和字段诊断；不能据此声称旧素材已经可用。

仍存在的明确功能变化：`agent-workflows/media-resolver.mjs:32` 接受通用 HTTPS 来源，后续 Image/video/audio.src 会在浏览器解码；`media-transport.mjs:66` 的 forceInline 分支会跨源 fetch。这类**用户独立 HTTPS 参考直读**也会被严格 CSP 拒绝，需要先导入本机。`agent-attachments/media-inputs.mjs:9–14` 的历史附件解码同样如此。Marble 公有 URI 仅作为数据传给本机服务/供应商的分支不受页面 CSP 限制。不能把限制独立 HTTPS 参考直读说成没有行为变化；若该流程仍须保留，应走受控显式本地导入，而非放行所有 HTTPS。

### 1. HTML 原文下载边界已由本地派生和导出包裹替换

入口一为 `agent-artifacts/panel.mjs:77` 的文件预览；入口二为 `agent-widgets/integration.mjs:37–56` 的 show_html 卡片。两者读取权威 artifact file 后调用同一个 `openHtmlPreview`。

初轮发现旧下载直接 `Blob([file.content])`，仅应用内预览有 CSP。该问题已经由共享 `html-document.mjs` 与 artifact 的本地导出会话接线替换：原正文保留，预览/下载消费受资源检查的派生结果，离线导出使用外层策略与 opaque sandbox 包裹。未知资源或外部代码不静默当作成功导出；异步结果仍须匹配原路径、revision、正文和当前预览。

当前实现用惰性 template 解析媒体属性，按精确来源哈希索引验证本地字节并嵌入 data URL，CSS 使用 CSSOM。没有采用最初建议的 DOMParser 读取未知原文。主线程已实际下载、重新打开，并验证真实图像和计数/交互；内联脚本仍未做通用静态分析，不能把本次夹具的通过视为任意 HTML 的功能保证。合同和已知不支持的 CSS/外部代码范围见 [HTML 资源派生](HTML-RESOURCE-DERIVATION.md)。

权威存储为 `agent-artifacts/store.mjs:4–13` 的 `<project namespace>-artifacts`，documents store 的 canvas document；文件通过 `store.write()` → `model.nextDocument()` 检查 expected_revision。若需要保存本地化派生文件，使用新 artifact_path 和 source_artifact_path/source_revision 保留来源，不能覆盖不匹配 revision 的原文件。

### 2. Widget 历史资源已接入只读入向本地派生

历史 trace.args.widget_code 原文保留。cards → html-resources →共享 html-document 在 sendRender 前处理明确资源槽，只把 ready 派生结果交给既有双 iframe；精确映射的本地文件和可信 asset 字节转为 data URL，unknown/读取失败显示“组件资源待修复”并允许重试。内层继续只允许 data/blob 媒体、connect-src none，不直接放行 `/assets/...` 或远程来源。

root 本轮已在 cards 与 integration 的 openLink 两层调用 `local-resource-migration/origin-policy.mjs`，禁止原站域及其子域，保留用户激活、nonce/source和当前trace校验。这是已修的宿主导航入口，不应继续列成未修原站跳转。

接线已绑定 frame/generation/nonce/trace/code/当前会话，缓存核对索引和资产绑定，过期结果不得发送。纯内联无资源组件保留原同步握手；固定 widget policy 保留既有 Blob 预览能力。专项接线测试与浏览器 QA 入口见 Widget 合同，不能把该接线存在当作所有历史组件和白模录像都已浏览器验收。已有 uploadToCanvas 仍是组件输出进入画布的出向桥，与新入向派生职责不同。

### 3. Agent 会话与主页面数据驱动入口

权威记录仍为 `agent-conversations:<projectId>`，保存 `{chats,activeId}`；旧 localStorage 在权威记录存在时仅作为只读遗留来源。现在已有显式附件迁移接线，进入保存队列、CAS 重算并在持久提交后更新页面，不再是初轮“没有迁移钩子”的状态。

已实现范围为 chats[].uploads、chats[].messages[].uploads、chats[].queuedMessages[].uploads 内 image/video 附件的 asset 与可选 image；主线程用真实 PNG 完成迁移、权威回读和刷新复验。合同见 [Agent 会话附件迁移](AGENT-CONVERSATION-RESOURCE-MIGRATION.md)。App trace.result.response/appState 的媒体槽需按已注册 resource_uri 单独处理，不属于这次附件迁移范围；文字、提示词、工具参数、ID、raw request 和恢复 journal 不通用替换。`projectAppModelResult()` 的模型投影也不能当作持久迁移。

实际读取入口包括：

| 入口 | 触发与行为 |
|---|---|
| `app.js:112` makeNode | 当前画布、撤销恢复后直接赋 img.src；unknown保留旧 URL 时仍会请求，主 CSP 可统一挡住 |
| `canvas-projects/ui.js:25` | 项目列表 thumbnail 直接赋 img.src；可能来自尚未打开项目的旧记录 |
| `agent-client.js:405` | 工具结果卡直接显示当前节点 image |
| `agent-attachments/picker.mjs:12–13` | 引用选择器直接设置节点 img/video.src，仅 asset:随后解析 |
| `agent-composer/reference-preview.mjs:7` | 引用预览经 LocalAssets.url 后赋 media.src；该resolver当前非asset来源原样返回 |
| `agent-client.js:97`、forms view | 表单图片来源从当前节点/已上传附件解析；旧来源仍需读取边界保护 |
| `agent-client.js:711–714`、media-inputs | 发送Agent附件时实际浏览器解码并采样媒体；不是只把名字发给模型 |

普通消息 `agent-messages/markdown.mjs` 丢弃 raw HTML，把 Markdown 图片变成 anchor，不会自动请求图片。本轮导航专项复核确认旧 `safeMessageLink()` 仅检查协议，Agent 普通回复与历史消息中的原站链接可经用户点击打开新标签；主页面资源 CSP 不会阻止这种导航。该入口现已复用共享 `independentNavigationUrl()`：HTTP/HTTPS 原站域、子域及尾点形式被拒绝，只保留链接标签；独立来源与 mailto 保留。普通 Markdown 链接、自动识别链接和图片链接统一经过此检查，不改写消息原文或持久记录。实际入口 `agent-client.js` 加载的 `assets/agent-editor.js` 已通过现有 `build:agent` 重建；专项检查覆盖上述域形式、独立链接和 mailto，另以实际消息渲染器核对输出 DOM，未访问原站、未据此声称浏览器中全部导航路径均已验收。文本产物 `TextEditor.html` 同样剥除图片并把链接变成静态 span，不是自动联网入口。SVG/XML namespace、ui://tapnow RPC 标识、DB/key名称、skill sourceUrl证据字段、URL格式示例均不能按请求数量统计。

### 4. 素材库与模板专项提交边界复读

`sidebars.js:14–38` 的普通素材库写入与迁移共用 Web Locks 写锁，普通写入按自身快照串行提交并比较原始存储字串；迁移在锁内同时比较内存 baseline、权威原始字串和未保存状态。不支持锁时迁移返回 lock_unavailable。`templates-ui.js:24–31` 的迁移在同一 IndexedDB 读写事务内读取全部记录、比较 baseline 并批量 put，提交后才换缓存；`:36–37` 的普通保存对目标记录做同事务 CAS。本次静态复读没有发现这两个合作写入协议的覆盖新版本路径，未运行专项测试。

两处 mediaSource 在赋 src 前拒绝已识别原站域与子域，模板图使用也有单独读取检查。曾发现条目本身没有 video 时，预览/插入检查之后才补入 `EDITOR_DATA.nodes[item.nodeId].video` 的有效来源边界；专项实现已修复。当前 `sidebars.js:55–57` 的 effectiveLibraryAsset 在检查/插入前解析真实后备视频，`:33–37` 的迁移先把后备来源物化，再纯映射。专项实现线程报告针对该缺口的回归已通过；本审计仅复读代码，未重复运行其测试。

### 5. 历史 HTML 资源派生模块已实现，消费者接线独立验证

新增 `local-resource-migration/html-document.mjs` 与合同文档 `docs/HTML-RESOURCE-DERIVATION.md`，保留原文、原 UTF-8 哈希，不写用户存储。template 惰性解析明确媒体槽，精确索引映射通过 importIndexedAsset 的临时内存适配器校验字节后嵌入 data URL；已有 asset 只读 Blob 转码。CSS 用 CSSOM 解析 URL token，外部样式/import/font/image-set 等未支持边界给 error，内联 JS 未分析只给 warning。默认 artifact 策略 data-only，widget 固定策略保留既有图片/媒体 blob 权限。模块返回的 ready 仅表示可识别静态资源完成，动态导航仍须消费者外层 opaque sandbox 与 frame 策略保护。

该模块专项 9 项和语法检查通过，独立组合复核还验证真实 PNG 索引/asset 的一致字节、仅一次本地读取、无自动请求和无存储写入。消费者接线已完成；主线程随后实际验证 HTML 下载/重新打开的图像与交互。Widget 合同明确另外的浏览器验收边界，不因共享模块测试通过就声称任意历史组件全部可用。

### 本节验收范围与限度

本审计整理者没有运行 CUA、读取用户私有存储或执行全套测试；共享模块专项和独立组合复核由相应实现/复核线程完成，HTML 导出及真实 PNG 会话迁移刷新由主线程完成。本地运行边界记录还包括主页面、既有 Three 片场及字体的各自验收。未记录的压缩 Draco/WASM、全部 Fabric 编辑状态、所有 Widget 录像及真实供应商联调不能据此推定通过。阻止原站请求、数据迁移成功和功能可用是三个不同结论。

## 历史审计存档：以下仅为修改过程证据

**本分隔线之后全部是较早版本的审计记录，不是收尾结论。** 审计目录为 `/Users/laplace/Documents/Codex/2026-09-22/new-chat/outputs/canvas-replica`。当时范围包括 Agent Apps 官方 HTML、四类代理、互动学习/个人素材、内置技能、服务端资源与遥测，最初阶段只改文档。保留原定位和推理供追溯；以下“当前”“最终”“本轮”一律指各历史阶段，已被上方收尾状态替代。

## 历史第一轮结论（已被收尾状态替代）

第一轮结束时，Agent App 与技能捕获正文已从本地加载，未找到固定原站 API/遥测端点；互动学习、素材库与 Widget 原站媒体权限已收紧。当时主画布全局 CSP 曾因直连配置和远程结果回填回归而撤回，product-kit 也只挡住演示图、尚未接本地运行输入。这些是历史过程，后续已完成同源网关、本地生成媒体、主页面 CSP、product-kit 输入与历史资源迁移/派生；具体收尾状态及验收范围以本文件开头为准。

## 历史第一轮风险排序

### 1. 初轮发现，二次复核已收紧：Widget 允许任意 HTTPS 图片/视频/音频

- `src/features/agent-widgets/widget-proxy.html:48`：`img-src data: blob: https:`。
- 同文件 `:49`：`media-src data: blob: https:`。
- 同文件 `:178–184`：宿主传入的 widget HTML 进入 `buildSrcdoc`，并由内层 iframe 实际执行/渲染。
- `connect-src 'none'`（同文件 `:51`）阻止 fetch/XHR/WebSocket/beacon，但不会阻止 CSP 另行允许的 `img.src`、`video.src`、`audio.src`。因此 widget 内容中如出现原站媒体地址，会产生真实网络请求。当前没有固定 TapNow 请求作为必然启动行为。

最小修复：将这两条资源权限收紧到 `data: blob:`；对已配置供应商的结果，在宿主受控媒体读取流程中显式本地化后再交付 Widget。需验证真实生成结果、媒体预览和录像交接，不应仅删权限后让图片静默消失。

二次复核当前 `widget-proxy.html:48–49` 已为 `img-src data: blob:` / `media-src data: blob:`。原站媒体加载权限已移除；历史Widget中的远程资源不会自动成为本地数据，因此仍需实际媒体交付验收。

### 2. 历史初轮发现：当时 product-kit 演示图未本地化

- `src/features/agent-apps/resources/apps/product-kit@v1.758d09b3.html:175`：演示对象 `U_` 含 `thumbnail_url:"https://files.tapnow.ai/demo/product-kit.webp"`；同一行 `os=window.parent===window` 判定顶层预览模式。
- 同文件 `:175`：`j_` 创建 `img` 并执行 `o.src=e`；`xm` 从 `L.product.thumbnail_url` 取图。
- 同文件 `:176`：`F_` 在顶层预览模式执行 `zm(U_)`，随后渲染上述图片。
- 当时 `src/features/agent-apps/registry.mjs:14–28` 没有 product-kit，处于已归档待接入阶段。该阶段性状态已过时；收尾版本已接实际本地产品图，见本文件开头链接。
- `server/server.cjs:63–70` 静态服务公开项目 HTML，故用户直接访问该资源页能触发此条件路径；此路径不经过 App 代理的 `data/blob` CSP。

最小修复：把演示缩略图交付为本地嵌入图/本地数据，或在本地演示映射中提供同图；保留原版捕获文件与本地化产物来源/hash界限。不要通过禁止演示入口替代功能还原。

二次复核：`server/server.cjs:70` 为该直接HTML响应添加CSP，`files.tapnow.ai`不在 `img-src` 中，因此浏览器应在发网络请求前阻止该图片。原URL仍在演示对象中，页面将走 `j_` 的字母fallback，而非显示实际本地演示图；这是资源缺口，不是已完成原图还原。

### 3. 本轮已修复：互动学习与个人素材原站媒体路径

修改前证据：

- `interactive-learning.mjs:5` 原权限表包含 `files.tapnow.*`、测试文件域与 `tamaredge`；`:22–26` 接受这些 HTTPS 图片地址。
- `resources/apps/interactive-learning@v1.cd0bb18c.html:168` 把 `preview_url`、`learner_preview_url`、`contrast_url` 交给图片渲染函数，属于真实图片资源请求，非文档链接。
- `library-picker.mjs:6,22` 原域表允许原站图片与来源地址；`library-picker-runtime.mjs:13,36–43` 从当前个人素材投影出图片预览；`resources/apps/library-picker@v1.3449ff83.html:317` 明确执行 `i.src=n.preview_url`。
- `registry.mjs:23–24` 将这些图片域传入资源 CSP；原 `mcp-app-proxy` 会追加至 `img-src`。

当前复读：

- `interactive-learning.mjs:6` 权限表为空；`:23–26` 预览只接受 PNG/WebP/JPEG base64 data URL。
- `library-picker.mjs:7` 权限表为空；`:17–22` 仅保留宿主 `library://private` 标识和 data/blob 预览。
- `library-picker-runtime.mjs:9–13` 实际素材仅接受 `asset:` 或匹配类型的 base64 data，不再接受 HTTPS 来源。
- `mcp-app-proxy.html:136–149` CSP 不再使用传入远程域。

剩余验证：旧会话中持久化的远程预览输入应明确要求重新获取/本地导入，而不是无提示的坏图；真实个人本地图片/视频预览及添加到画布需浏览器回归。

### 4. 历史导航检查：当时 Widget openLink 尚未加入原站域策略

- `src/features/agent-widgets/cards.mjs:164–169`：收到 `openLink`，需 `interactive(...)` 和 `userAction()`，只接受 HTTP/HTTPS，之后调用宿主回调或 `window.open`。
- `src/features/agent-widgets/integration.mjs:86–87` 同样执行通用 HTTP/HTTPS 导航。

这是内容提供的用户操作导航能力，未找到固定 TapNow 目标；不是后台 fetch 或自动原站回退。若“无 TapNow 关联”还要求禁止任意用户内容跳转原站，应在同一宿主导航边界做明确域策略，或使用应用自己的本地帮助/文档；不要把所有外部合法链接无条件删除。

## 历史四类代理复查

审计初读时，`mcp-app-proxy`、`production-progress-proxy`、`cutlist-review-proxy`、`widget-proxy` 含 prod/test TapNow 父源 allowlist。它们用于判断 `postMessage` 来源：按代理自身 hostname 选择生产/测试策略；localhost 走空 patterns 加 localhost/same-origin。列表本身不执行 fetch、导航或远程回退。

根线程本轮已经统一改成精确 `origin===location.origin`，包含端口，移除 prod/test 分支。当前定位：三个 App proxy `:80–90`；Widget proxy `:29–39`。保留 `event.source===window.parent`、nonce 和内层 source 检查。

App 外层卡片 `card.mjs:67` 使用 `sandbox="allow-scripts"`，文档安全 origin 为 opaque，但 `location.origin` 是 Location URL 的 origin 字符串，不能与返回 `null` 的 opaque `window.origin` 混淆。父页的 `event.origin` 为真实父 origin；URL 相同的本地父页因此仍应通过精确比较。此判断是源码/浏览器平台语义复核，尚未替代实际 iframe 握手验收。

三个 App proxy 的 `resolveAppsBase`（当前 `mcp-app-proxy:102–105`）根据本地路径选 `./apps/` 或 `/apps/`；`:114` 读取本地 manifest，`:200` 读取 `key.hash.html`。生产进度和粗剪代理同类读取在 `:114,208`。没有固定远程 URL 或失败后原站下载逻辑。`server.cjs:70` 仅对这些本地公共模板允许 CORS，以支持 opaque iframe 读取。

## 历史官方 HTML URL 分类

扫描了 `resources/apps/` 的 24 个 HTML，包括未注册版本；没有外部 `script src`、stylesheet URL 或实际 modulepreload 标签。常见 `fetch` 是 Vite modulepreload polyfill；没有对应远程标签，且已接入内层 CSP 的 `connect-src 'none'` 会阻止该类请求。Three.js 中存在通用 loader 方法，不代表业务一定调用远程资源。

无需当成联网依赖删除：

- `http://www.w3.org/...`：SVG/XML namespace。
- Zod 的 `http://[${value}]`：URL/IP格式校验时创建 URL 对象，不发送请求。
- `https://*.example.com`：MCP SDK schema 的 CSP描述示例。
- `https://jcgt.org/published/0007/04/01/`：Three.js shader注释中的论文来源。
- Motion picker 的 MDN path语法说明、SIL OFL许可地址：库错误文本/许可资料。
- `ui://tapnow/...`、`tapnow/setWidgetState` 等：当前本地 registry 与 RPC 协议标识；没有 DNS/HTTP语义。品牌迁移时应成组迁移标识和已保存数据，而不是断言这些字符串会联网。

## 历史内置技能详情检查

- `reader.mjs:18` 只 fetch `'/'+entry.captureFile`；`:31–32` 拒绝路径协议和穿越。
- `reader.mjs:73` 的 `sourceUrl` 是采集来源 metadata，不被 fetch。
- `detail.mjs:7` 优先返回本地捕获 `capture/article.html`。
- `agent-manager/manager.mjs:39` 实际通过传入 sanitizer 渲染捕获 HTML。
- `agent-client.js:779` sanitizer 没有允许 IMG/VIDEO/IFRAME/SCRIPT；剥除全部属性，只给 HTTPS A 重新赋 `href,target,rel`。因此捕获中图片地址不会作为真实图片加载。
- 本轮读取 `runtime-reference/*.json` 的捕获文章：当前没有 TapNow/tamaredge 的 href；只有 `opus55-motion-icon-20261002.json:15` 的 GitHub 项目 HTTPS链接成为可点击导航。YouTube文章中的三个相对 reference href 被 sanitizer移除，当前不可导航。

`index.mjs` 的 `sourceUrl:https://app.tapnow.media/`、捕获 `source`、dialog文字、技能叙述属于采集依据。它们不证明运行时原站服务依赖。若以后提供可点击来源，应映射到本地捕获详情页；如果本地化修改正文，需同步捕获的长度与 SHA256 校验，而不是直接删 JSON字符串后破坏 reader。

## 历史服务端运行资源与遥测检查

- `server/server.cjs:15,17–23` 初始化显式配置的 OpenAI客户端/生成网关；`:33–59` 通过本地 API处理 Agent、语音、搜索和媒体操作；`:72` 只绑定127.0.0.1。
- 运行静态资源由本地 fs提供（`:63–71`），不存在资源缺失后向原站拉取的 fallback。
- `server/*.cjs` 扫描未发现 TapNow/tamaredge API目标、Sentry、analytics、telemetry、sendBeacon固定端点。`server/agent.cjs:12` 的 TapNow/widget术语是本地 Agent指令与桥接协议。
- 配置后的模型任务确有外部供应商调用：OpenAI、fal、Tripo、WorldLabs及配置的其他供应商；这是用户显式配置的功能边界，并非 TapNow服务。默认地址或 endpoint字符串不是凭证未配置时的自动请求证据。
- 生产进度 `production-progress-runtime.mjs:108–109` 会 fetch当前真实节点媒体，再转为本地 blob/data预览。它不硬编码原站；若旧数据中仍存在原站URL，仍可请求该用户数据中的来源。全项目“完全本地媒体”验收还需要覆盖旧资产导入/恢复的统一边界，这次审计未扫描全部节点读取链。

## 历史阶段的验收建议（不是未完成清单）

做一个聚焦浏览器验收：本地 App握手、学习本地图片、个人素材data/asset预览、Widget本地图片/视频、production/cutlist实际blob预览、旧远程会话恢复，以及直接打开product-kit。记录实际request URL、触发交互和失败表现。静态字符串扫描不能替代该证据。

## 历史二次复核：曾撤回全 HTML CSP，之后已重新实施主页面策略

本节记录主网关直连及远程结果尚未后端化时的撤回理由。现在同源网关与本地生成媒体已替代这两个主要前提，主 index.html 已重新实施严格同源 CSP；下面“最终仅约束 App”“主入口无新增 header”“供应商结果仍直接读取”均只描述当时版本。

初次二次复核时，`server/server.cjs:70` 曾为所有本地 `.html` 静态响应设置 CSP。独立review发现下面列出的配置与结果媒体回归，根线程曾撤回全局方案；那次复读条件为 `^src/features/(agent-apps/resources/|agent-widgets/widget-proxy.html$)` 加 `.html`，当时只有 App/widget 范围有新增响应 CSP。这不是收尾版本的 header 范围，主 index.html 后来已恢复独立严格策略。

最终沙箱CSP用 `self` 加当前请求的明确 `http://host:port` 允许本地加载，data/blob允许本地媒体；内联脚本/样式和现有eval保留，object禁止。API JSON响应不添加该CSP。这个收窄避免由沙箱本地化顺带破坏主画布已配置供应商链路，但也不覆盖主画布的远程历史/供应商媒体导入。

### 当时收窄范围下预计保持的本地功能

- 主入口 `index.html:9` 的内联 importmap、相对模块、CSS与 `/assets/` 资源不受此次新增header约束；仍按既有本地路径加载。
- 外层App代理在 opaque origin下 fetch本地模板：`connect-src` 中明确HTTP宿主地址覆盖了opaque下不能仅靠self匹配的情况，模板端 `Access-Control-Allow-Origin:*`仍保留（server:72）。代理再给srcdoc添加更严格meta CSP，两者取交集；没有把内层网络权限放宽。
- `studio.mjs:29` 的 Draco decoder位于 `/node_modules/three/examples/jsm/libs/draco/gltf/`，`DRACOLoader.js:426,440` 构建blob Worker。主画布/片场不再继承此次新增header，故此链路不存在该策略引入的限制；若未来强制全局CSP，原方案blob Worker与unsafe-eval权限有静态兼容依据，仍需实际压缩GLB解码验证。
- `studio.mjs:262`、`image-editor-entry.mjs:305` 的Blob+download导出不要求外部资源。`agent-artifacts/html-preview.mjs:25–27` 仍下载原HTML文件；`:43` 的应用内预览仍为opaque srcdoc且有独立禁止网络meta CSP。下载后用户在其他环境打开文件不受本地服务器响应CSP约束。
- Widget内层现只允许data/blob媒体，与HTML header资源权限交集没有冲突。内层原有 `script-src 'unsafe-inline'` / 默认禁止worker仍然存在，不能因header允许blob Worker就宣称任意Widget新获Worker能力。

未看到本轮CSP直接破坏本地模块、本地Three资源、Canvas/WebGL像素导出。源码复核不能代替主入口/Agent App/压缩GLB/实际下载验收。

### 当时全局方案暴露的已配置服务冲突

下表是促成撤回的review证据，不是最终收窄策略仍在阻断这些主画布请求。入口尚未后端化，运行边界需要在下一批真实适配。

| 入口 | 实际运行路径 | 被撤回的全局CSP影响 | 最小正确方向 |
| --- | --- | --- | --- |
| 生成配置中的直接tasks-v1网关 | `generation-ui.js:247–250` 允许URL+Key，切换到 `GenerationCore.httpProvider`；`generation-api.js:112–126` 发DELETE/POST/GET、轮询；`generation-ui.js:287` 对非本地provider仅判断是否存在 | 远程或另一本机端口会被connect-src拦截；界面可显示已配置但请求不能工作 | 保留合同和取消/查询语义，通过本地受控适配器连接用户网关；在适配完成前配置入口需准确显示不支持，不能静默保存成可用 |
| 视频分割API配置 | `video-segmentation.mjs:11–12` URL+Key，POST `/segment-video`，可再fetch返回的rleUrl；`video-mask-ui.mjs:2,38` 实际调用 | POST与跨源蒙层文件读取均会被拦截 | 本地分割适配器需同时处理请求、取消与有界蒙层下载，而不只代理第一个POST |

全项目浏览器源码扫描中，上述两个是找到的内置用户URL+Key配置UI。其他可注入扩展hook应另外区分：

- 合规：`media-review-ui.mjs:8` 默认 `httpAdapter()` → `/api/media-reviews`；`media-review-core.mjs:103–108`支持可选base，但没有用户URL配置UI。`MediaReview.setAdapter`（ui:67）允许程序注入，若自定义适配器直接fetch远程同样受CSP限制。服务端默认返回configuration_required，并非本轮引入的真实供应商回归。
- 语音：`voice-input.js:6` 默认 `/api/voice/transcribe`；`voice-core.js:38`支持可选url，`VoiceInput.setProvider`（input:28）为程序注入，无用户URL配置UI。默认本地链路不受影响。
- 反馈：`feedback.js:33,50,54` 默认无provider且仅本地保存，`FeedbackAPI.setProvider`为程序注入；没有内置远程HTTP实现/URL配置UI。
- `GenerationAPI.setProvider`、`VideoSegmentationAPI.setProvider`也允许程序注入，但不能据hook存在推断当前使用某个外部服务。

### 当时尚未完成的供应商媒体本地化

这不是旧历史独有问题，当前真实配置供应商的新任务也能返回远程结果URL：

- `server/generation-durable.cjs:63` 校验后仍返回HTTP(S)结果地址，不把每个结果下载为本地素材。
- `generation-ui.js:132–136` 通过Image/video的src校验返回结果，`LocalAssets.url` 对非asset字符串原样返回（local-assets.js:5）；若强制原全局方案，远程供应商媒体会被img/media-src阻止，成为“任务成功、结果应用失败”。最终收窄后主画布此链路保留既有行为。
- `generation-history/archive.mjs:7`、`audio-ui.js:39`、world/模型资源读取会fetch实际结果URL；未来全局限制之前需先提供本地媒体适配，目前仍可读取已配置供应商的远程结果。
- `agent-workflows/media-transport.mjs:59–66` 在forceInline时读取用户公网参考媒体，原全局方案也会拦截；非forceInline时公网地址继续传给本地服务器/供应商。最终收窄保留既有导入行为；HTML CSP不限制服务器出站请求。

最小正确方向：在本地受控媒体适配层实现供应商结果/用户明确导入参考的下载或代理，处理来源身份、失效URL、类型/大小/超时、取消和实际像素/解码验收。其授权/来源边界应独立于“删除TapNow域字符串”。保留用户自有远程媒体导入意图，并明确提示旧来源需重新导入。不要放行所有HTTPS来恢复功能，也不要以请求被挡作为功能已完成的证据。

### 当时记录的导航行为与限制

资源CSP没有提供通用导航禁令。`cards.mjs:164–169` 的用户动作openLink、技能详情HTTPS anchor、页面自身location导航/外部下载仍需按业务边界审计。当前Widget sandbox禁止top-navigation/popups，桥接openLink仍通过宿主用户动作；但整个主页面的导航能力未因资源CSP消失。

当时 `server/agent.cjs:12` 的本地资源指令有助于模型选资源，但不是权限执行层。那一阶段仅能确认 App 沙箱权限收紧，主画布历史/供应商媒体仍有远程读取路径，因此要求后续完整适配。本段不是收尾结论；同源网关、生成媒体落盘、主页面 CSP、HTML 派生和会话附件迁移的后续实现及实际验收见文件开头。
