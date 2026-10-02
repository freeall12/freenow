# 运行时原站依赖独立审计 · 2026-10-03

审计目录：`/Users/laplace/Documents/Codex/2026-09-22/new-chat/outputs/canvas-replica`。范围为 Agent Apps 官方 HTML、四类沙箱代理、互动学习/个人素材、内置技能详情、服务端运行资源与遥测。字体与帮助入口由其他审计负责。本记录只改文档，未运行广泛测试、未提交代码。代码在根线程同时更新，因此分别列出修改前证据和本轮复读状态；下列“当前”是本文件生成时状态。

## 结论

Agent App 模板与技能捕获正文从本地文件加载，没有发现服务端直接调用 TapNow API 或固定 TapNow 遥测端点。修改前，互动学习和个人素材库确有条件性原站媒体请求，根线程本轮已移除对应域权限与远程输入。Widget HTTPS媒体权限也已移除。最终复读的服务端CSP仅作用于Agent App模板/代理和Widget代理，已撤回对主画布HTML的全局CSP，避免破坏已配置用户API与供应商结果回填。product-kit原站演示图现被沙箱范围CSP阻止，演示内容本地化仍未完成。主画布供应商媒体、旧远程历史与通用用户导航仍是待补边界，不能宣称全项目完全本地化。

## 按风险与可操作性排序

### 1. 初轮发现，二次复核已收紧：Widget 允许任意 HTTPS 图片/视频/音频

- `src/features/agent-widgets/widget-proxy.html:48`：`img-src data: blob: https:`。
- 同文件 `:49`：`media-src data: blob: https:`。
- 同文件 `:178–184`：宿主传入的 widget HTML 进入 `buildSrcdoc`，并由内层 iframe 实际执行/渲染。
- `connect-src 'none'`（同文件 `:51`）阻止 fetch/XHR/WebSocket/beacon，但不会阻止 CSP 另行允许的 `img.src`、`video.src`、`audio.src`。因此 widget 内容中如出现原站媒体地址，会产生真实网络请求。当前没有固定 TapNow 请求作为必然启动行为。

最小修复：将这两条资源权限收紧到 `data: blob:`；对已配置供应商的结果，在宿主受控媒体读取流程中显式本地化后再交付 Widget。需验证真实生成结果、媒体预览和录像交接，不应仅删权限后让图片静默消失。

二次复核当前 `widget-proxy.html:48–49` 已为 `img-src data: blob:` / `media-src data: blob:`。原站媒体加载权限已移除；历史Widget中的远程资源不会自动成为本地数据，因此仍需实际媒体交付验收。

### 2. 初轮发现，当前被CSP拦截：product-kit演示图尚未本地化

- `src/features/agent-apps/resources/apps/product-kit@v1.758d09b3.html:175`：演示对象 `U_` 含 `thumbnail_url:"https://files.tapnow.ai/demo/product-kit.webp"`；同一行 `os=window.parent===window` 判定顶层预览模式。
- 同文件 `:175`：`j_` 创建 `img` 并执行 `o.src=e`；`xm` 从 `L.product.thumbnail_url` 取图。
- 同文件 `:176`：`F_` 在顶层预览模式执行 `zm(U_)`，随后渲染上述图片。
- `src/features/agent-apps/registry.mjs:14–28` 当前没有 product-kit。它是已归档且待接入的页面，不是已接入 App 的自动 fallback。
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

### 4. 当前通用导航能力：用户操作后的 Widget openLink

- `src/features/agent-widgets/cards.mjs:164–169`：收到 `openLink`，需 `interactive(...)` 和 `userAction()`，只接受 HTTP/HTTPS，之后调用宿主回调或 `window.open`。
- `src/features/agent-widgets/integration.mjs:86–87` 同样执行通用 HTTP/HTTPS 导航。

这是内容提供的用户操作导航能力，未找到固定 TapNow 目标；不是后台 fetch 或自动原站回退。若“无 TapNow 关联”还要求禁止任意用户内容跳转原站，应在同一宿主导航边界做明确域策略，或使用应用自己的本地帮助/文档；不要把所有外部合法链接无条件删除。

## 四类代理的独立复查

审计初读时，`mcp-app-proxy`、`production-progress-proxy`、`cutlist-review-proxy`、`widget-proxy` 含 prod/test TapNow 父源 allowlist。它们用于判断 `postMessage` 来源：按代理自身 hostname 选择生产/测试策略；localhost 走空 patterns 加 localhost/same-origin。列表本身不执行 fetch、导航或远程回退。

根线程本轮已经统一改成精确 `origin===location.origin`，包含端口，移除 prod/test 分支。当前定位：三个 App proxy `:80–90`；Widget proxy `:29–39`。保留 `event.source===window.parent`、nonce 和内层 source 检查。

App 外层卡片 `card.mjs:67` 使用 `sandbox="allow-scripts"`，文档安全 origin 为 opaque，但 `location.origin` 是 Location URL 的 origin 字符串，不能与返回 `null` 的 opaque `window.origin` 混淆。父页的 `event.origin` 为真实父 origin；URL 相同的本地父页因此仍应通过精确比较。此判断是源码/浏览器平台语义复核，尚未替代实际 iframe 握手验收。

三个 App proxy 的 `resolveAppsBase`（当前 `mcp-app-proxy:102–105`）根据本地路径选 `./apps/` 或 `/apps/`；`:114` 读取本地 manifest，`:200` 读取 `key.hash.html`。生产进度和粗剪代理同类读取在 `:114,208`。没有固定远程 URL 或失败后原站下载逻辑。`server.cjs:70` 仅对这些本地公共模板允许 CORS，以支持 opaque iframe 读取。

## 官方 HTML URL 分类

扫描了 `resources/apps/` 的 24 个 HTML，包括未注册版本；没有外部 `script src`、stylesheet URL 或实际 modulepreload 标签。常见 `fetch` 是 Vite modulepreload polyfill；没有对应远程标签，且已接入内层 CSP 的 `connect-src 'none'` 会阻止该类请求。Three.js 中存在通用 loader 方法，不代表业务一定调用远程资源。

无需当成联网依赖删除：

- `http://www.w3.org/...`：SVG/XML namespace。
- Zod 的 `http://[${value}]`：URL/IP格式校验时创建 URL 对象，不发送请求。
- `https://*.example.com`：MCP SDK schema 的 CSP描述示例。
- `https://jcgt.org/published/0007/04/01/`：Three.js shader注释中的论文来源。
- Motion picker 的 MDN path语法说明、SIL OFL许可地址：库错误文本/许可资料。
- `ui://tapnow/...`、`tapnow/setWidgetState` 等：当前本地 registry 与 RPC 协议标识；没有 DNS/HTTP语义。品牌迁移时应成组迁移标识和已保存数据，而不是断言这些字符串会联网。

## 内置技能详情：当前没有原站导航或自动图片请求

- `reader.mjs:18` 只 fetch `'/'+entry.captureFile`；`:31–32` 拒绝路径协议和穿越。
- `reader.mjs:73` 的 `sourceUrl` 是采集来源 metadata，不被 fetch。
- `detail.mjs:7` 优先返回本地捕获 `capture/article.html`。
- `agent-manager/manager.mjs:39` 实际通过传入 sanitizer 渲染捕获 HTML。
- `agent-client.js:779` sanitizer 没有允许 IMG/VIDEO/IFRAME/SCRIPT；剥除全部属性，只给 HTTPS A 重新赋 `href,target,rel`。因此捕获中图片地址不会作为真实图片加载。
- 本轮读取 `runtime-reference/*.json` 的捕获文章：当前没有 TapNow/tamaredge 的 href；只有 `opus55-motion-icon-20261002.json:15` 的 GitHub 项目 HTTPS链接成为可点击导航。YouTube文章中的三个相对 reference href 被 sanitizer移除，当前不可导航。

`index.mjs` 的 `sourceUrl:https://app.tapnow.media/`、捕获 `source`、dialog文字、技能叙述属于采集依据。它们不证明运行时原站服务依赖。若以后提供可点击来源，应映射到本地捕获详情页；如果本地化修改正文，需同步捕获的长度与 SHA256 校验，而不是直接删 JSON字符串后破坏 reader。

## 服务端运行资源与遥测

- `server/server.cjs:15,17–23` 初始化显式配置的 OpenAI客户端/生成网关；`:33–59` 通过本地 API处理 Agent、语音、搜索和媒体操作；`:72` 只绑定127.0.0.1。
- 运行静态资源由本地 fs提供（`:63–71`），不存在资源缺失后向原站拉取的 fallback。
- `server/*.cjs` 扫描未发现 TapNow/tamaredge API目标、Sentry、analytics、telemetry、sendBeacon固定端点。`server/agent.cjs:12` 的 TapNow/widget术语是本地 Agent指令与桥接协议。
- 配置后的模型任务确有外部供应商调用：OpenAI、fal、Tripo、WorldLabs及配置的其他供应商；这是用户显式配置的功能边界，并非 TapNow服务。默认地址或 endpoint字符串不是凭证未配置时的自动请求证据。
- 生产进度 `production-progress-runtime.mjs:108–109` 会 fetch当前真实节点媒体，再转为本地 blob/data预览。它不硬编码原站；若旧数据中仍存在原站URL，仍可请求该用户数据中的来源。全项目“完全本地媒体”验收还需要覆盖旧资产导入/恢复的统一边界，这次审计未扫描全部节点读取链。

## 后续验收建议

做一个聚焦浏览器验收：本地 App握手、学习本地图片、个人素材data/asset预览、Widget本地图片/视频、production/cutlist实际blob预览、旧远程会话恢复，以及直接打开product-kit。记录实际request URL、触发交互和失败表现。静态字符串扫描不能替代该证据。

## 二次独立复核：全HTML CSP方案已撤回，最终仅约束App沙箱

初次二次复核时，`server/server.cjs:70` 曾为所有本地 `.html` 静态响应设置 CSP。独立review发现下面列出的实际配置与结果媒体回归，根线程随后撤回全局方案。最终复读条件为 `^src/features/(agent-apps/resources/|agent-widgets/widget-proxy.html$)` 加 `.html`：只有官方App模板、三类App代理和Widget代理有响应CSP，主入口与普通QA页面没有该新增header。

最终沙箱CSP用 `self` 加当前请求的明确 `http://host:port` 允许本地加载，data/blob允许本地媒体；内联脚本/样式和现有eval保留，object禁止。API JSON响应不添加该CSP。这个收窄避免由沙箱本地化顺带破坏主画布已配置供应商链路，但也不覆盖主画布的远程历史/供应商媒体导入。

### 最终范围下预计保持的本地功能

- 主入口 `index.html:9` 的内联 importmap、相对模块、CSS与 `/assets/` 资源不受此次新增header约束；仍按既有本地路径加载。
- 外层App代理在 opaque origin下 fetch本地模板：`connect-src` 中明确HTTP宿主地址覆盖了opaque下不能仅靠self匹配的情况，模板端 `Access-Control-Allow-Origin:*`仍保留（server:72）。代理再给srcdoc添加更严格meta CSP，两者取交集；没有把内层网络权限放宽。
- `studio.mjs:29` 的 Draco decoder位于 `/node_modules/three/examples/jsm/libs/draco/gltf/`，`DRACOLoader.js:426,440` 构建blob Worker。主画布/片场不再继承此次新增header，故此链路不存在该策略引入的限制；若未来强制全局CSP，原方案blob Worker与unsafe-eval权限有静态兼容依据，仍需实际压缩GLB解码验证。
- `studio.mjs:262`、`image-editor-entry.mjs:305` 的Blob+download导出不要求外部资源。`agent-artifacts/html-preview.mjs:25–27` 仍下载原HTML文件；`:43` 的应用内预览仍为opaque srcdoc且有独立禁止网络meta CSP。下载后用户在其他环境打开文件不受本地服务器响应CSP约束。
- Widget内层现只允许data/blob媒体，与HTML header资源权限交集没有冲突。内层原有 `script-src 'unsafe-inline'` / 默认禁止worker仍然存在，不能因header允许blob Worker就宣称任意Widget新获Worker能力。

未看到本轮CSP直接破坏本地模块、本地Three资源、Canvas/WebGL像素导出。源码复核不能代替主入口/Agent App/压缩GLB/实际下载验收。

### 已撤回全局方案会造成的已配置服务冲突

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

### 全局约束之前仍需解决的供应商媒体读取

这不是旧历史独有问题，当前真实配置供应商的新任务也能返回远程结果URL：

- `server/generation-durable.cjs:63` 校验后仍返回HTTP(S)结果地址，不把每个结果下载为本地素材。
- `generation-ui.js:132–136` 通过Image/video的src校验返回结果，`LocalAssets.url` 对非asset字符串原样返回（local-assets.js:5）；若强制原全局方案，远程供应商媒体会被img/media-src阻止，成为“任务成功、结果应用失败”。最终收窄后主画布此链路保留既有行为。
- `generation-history/archive.mjs:7`、`audio-ui.js:39`、world/模型资源读取会fetch实际结果URL；未来全局限制之前需先提供本地媒体适配，目前仍可读取已配置供应商的远程结果。
- `agent-workflows/media-transport.mjs:59–66` 在forceInline时读取用户公网参考媒体，原全局方案也会拦截；非forceInline时公网地址继续传给本地服务器/供应商。最终收窄保留既有导入行为；HTML CSP不限制服务器出站请求。

最小正确方向：在本地受控媒体适配层实现供应商结果/用户明确导入参考的下载或代理，处理来源身份、失效URL、类型/大小/超时、取消和实际像素/解码验收。其授权/来源边界应独立于“删除TapNow域字符串”。保留用户自有远程媒体导入意图，并明确提示旧来源需重新导入。不要放行所有HTTPS来恢复功能，也不要以请求被挡作为功能已完成的证据。

### 仍可离开本地的行为与限制

资源CSP没有提供通用导航禁令。`cards.mjs:164–169` 的用户动作openLink、技能详情HTTPS anchor、页面自身location导航/外部下载仍需按业务边界审计。当前Widget sandbox禁止top-navigation/popups，桥接openLink仍通过宿主用户动作；但整个主页面的导航能力未因资源CSP消失。

`server/agent.cjs:12` 新增本地资源指令有助于模型选择正确资源，但它不是权限执行层，也不能约束用户提供的历史内容或浏览器导航。固定TapNow演示资源请求现在在App模板/代理层被CSP阻止；主画布仍可能访问远程历史/供应商结果。最终结论仅为沙箱权限收紧及已定位未完成边界，服务器显式配置与供应商媒体仍需要完整适配证据。
