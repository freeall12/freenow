# 制作进度内嵌页品牌派生 · 2026-10-05

## 实际遗漏与修改

生产 `registry.mjs` 为 `ui://tapnow/production-progress@v1` 选择专属 `production-progress-proxy.html`。该代理此前直接把 `production-progress@v1.acd4e750.html` 写入内层 `srcdoc`。原页固定 UI 字典仍包含中英两套 TapNow 正在生成、在 TapNow 中打开和刷新超时后查看 TapNow 的提示；页脚 `I_()` 自建原品牌图形。额度不足分支还要求在 TapNow 充值，不能准确描述本地独立供应商。

新增 `src/features/agent-apps/production-progress-local-brand.mjs`，仅为这一个已登记版本派生固定显示内容：

- `generating`、`pendingState`、`openProject`、`timedOut` 的中英固定名称使用 freenow。
- `blockedBalance` 说明已配置供应商报告额度不足，要求核对其账户余额和 API 配置。没有宣传本地免费、无限生成或改变任务成功/失败状态。
- 页脚品牌函数改为创建本地 F 图片；复用已批准 `assets/branding/freenow-mark.svg`，Tabler 3.47.0 MIT 原 SVG 路径不变。15×15 图像以原字节 base64 data URI 交给内层，深色反色、浅色保持黑色。辅助技术通过旁边按钮文案获得品牌名称，图片本身保持装饰语义。

专属代理在原 HTML 读取之后、CSP 序列化之前懒加载派生模块，并通过同源静态路径读取本地 F 文件。原 HTML、manifest、参考备注、第三方作者和许可证未修改。`ui://tapnow/*`、JSON-RPC 方法和原轮询/回执逻辑保持兼容。

## 来源完整性与隔离

派生前同时核对完整 SHA256：

```text
production-progress@v1.acd4e750.html
acd4e750bc11ca20c2e44a87a7a7c1ba0bfd0053d8d1c8ecbf87d38be98a9b4f

assets/branding/freenow-mark.svg
408aa0c0d3fad94e812df60f5258218e685a3ae915c36656198a8444bb957b93
```

版本、字节或唯一替换目标不匹配时明确失败，不进行不确定替换。只有固定脚本字典、原页脚品牌函数和其图片样式改变；用户项目标题、任务标题和媒体 URI 从宿主数据传入，不作任何字符串替换。

双层 iframe 继续使用 `sandbox="allow-scripts"`，不加同源权限。内层保持 `connect-src 'none'`、`img-src data: blob:`，品牌文件只由本地代理读取，内层不请求远程品牌或原站资源。

主线程实际 Computer Use 发现：外层代理也处于 opaque origin，动态模块 import 被 CORS 拦截；普通 HTTP 200 不能证明其可加载。`server/server.cjs` 现有公开应用精确 CORS 名单补入且只补入 `src/features/agent-apps/production-progress-local-brand.mjs`、`assets/branding/freenow-mark.svg`，后者也是代理后续 fetch 所需。没有放宽整个目录或私有媒体/API；需重启既有服务后再做浏览器复验。

## 定向检查

```sh
node --test tests/agent-production-progress-local-brand.test.cjs tests/agent-production-progress.test.cjs
node --test tests/agent-production-progress-brand-static.test.cjs
node --check src/features/agent-apps/production-progress-local-brand.mjs
node --check src/features/agent-apps/qa/production-progress-brand.mjs
node --check server/server.cjs
git diff --check
```

16 项通过（新品牌保护 4 项、原进度合同 12 项）。新检查包含两套实际字典、修改字节/版本拒绝、派生后全部内嵌脚本的 esbuild 解析、保留原查询/轮询/回执函数、data SVG 回读与原文件一致，以及执行实际单结果渲染函数后“TapNow 用户自定义项目”标题和媒体 URI 保持原文。专属代理内嵌脚本通过 `vm.Script` 解析；本机服务已返回独立 QA HTML。以上是代码与 HTTP 证据，不等于浏览器像素验收。

CORS 修复另有 2 项通过：执行实际生产 request handler 的隔离 HTTP fixture，验证模块/F SVG 的 GET/HEAD 原字节和 `Access-Control-Allow-Origin: *`；邻近生产模块/Agent SVG 不新增 CORS，私有文件和 API 的 `Origin: null` 请求仍为 403。不启动真实 Agent、任务存储或读取 Key。实际 opaque iframe 加载仍由主线程重启服务后复验。

## 主线程 Computer Use 入口

```text
http://127.0.0.1:4173/src/features/agent-apps/qa/production-progress-brand.html
```

此页使用生产 card/host/registry/proxy 和原页派生 renderer，仅提供明确标记的本地显示测试状态，不调用生成接口，不读写已有存储：

1. 默认标题为“TapNow 用户自定义项目”；核对宿主卡片标题及内层任务标题原文，同时固定提示为“freenow 正在生成…”。
2. 检查双层 iframe 页脚“在 freenow 中打开”、F 图片实际解码（`complete`、`naturalWidth`）与 15×15 尺寸。
3. 切 English，核对待处理与按钮固定名称。
4. 点击“显示供应商额度不足状态”，核对中英供应商余额/API 提示，无原站充值要求。
5. 切换深色/浅色，确认 F 图像对比度和用户标题保持；切回待处理可重新读取明确本地测试状态。

生产进度策略不允许放大，此处验收双层隔离窗口与主题，并未新增放大能力。本批没有执行浏览器操作；实际截图和浏览器结果由主线程记录。

## 保留项与验收边界

其余已登记原应用的 TapNow 命中主要是 SDK/协议、构建备注或原技能交接内容；不能以搜索计数当作可见品牌遗漏，也不改原作品正文。原制作进度媒体往返 QA 的 `assets/tap-logo.webp` 是已声明的来源 fixture，未改动其历史提交或素材来源。本批只证明制作进度显示派生与来源保护，不宣称嵌套应用、导出产物或全站离线品牌清点全部完成。

## 主线程 CUA 重启复验

opaque iframe 首次真实加载出现 CORS 问题，修复上述两条精确公开路径并重启服务后，中文 / 英文、深色 / 浅色和错误 / 配额状态均实测为 freenow。F 图真实解码、原生尺寸 24×24（页脚 CSS 显示仍为 15×15）；用户正文“TapNow 用户自定义项目”原样保留。未放宽整个目录、私有媒体或 API 权限。

[本批截图和完整验收边界](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)使用本地合成状态；不是原站截图，也不是生成任务成功或质量证明。
