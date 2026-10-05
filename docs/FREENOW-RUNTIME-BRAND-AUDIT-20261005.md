# 运行时品牌与原站脱钩窄审计 · 2026-10-05

本批发现并修复一个明确遗漏：正式 Agent 平台尺寸应用成功提示仍要求到 TapNow 画布查看，并使用 Tapies 货币称谓。仅修改生产通用代理中的固定版本派生，不改用户内容、兼容 alias、原始捕获 HTML 或来源许可；不宣称全站本地化完成。

## 修改与保护

`src/features/agent-apps/resources/mcp-app-proxy.html` 新增 `localizePlatformResizeBrand`，只接受 `platform-resize@v1` 的完整原始 SHA256。与既有 Product Kit、Previs 等版本派生相同，在注入 CSP 和设置内层 srcdoc 前执行；其他应用原样返回。没有新增模块 fetch、CORS 放行、依赖或图标。

| 固定字典 | 当前文案 |
| --- | --- |
| 英文成功 | `Added N image(s) to the project, open the freenow canvas to view them.` |
| 中文成功 | `已添加 N 张到项目，请在 freenow 画布中查看。` |
| 英文本机说明 | `Local image cropping` |
| 中文本机说明 | `本机图片裁切` |

裁切数量、用户标题、SDK、工具调用、失败状态和原应用交互保持。内层依旧 opaque `sandbox="allow-scripts"`，网络连接禁用，只接受 host 交付的本地 data/blob 媒体。

原始源文件与 manifest 保持，当前校验值：

```text
platform-resize@v1.897f4688.html
897f46887563e4ed59db6b0f33cb0896631715c0c39a7e8793470978c7383365

resources/apps/manifest.json
0dd8a985d35138f6927023736ae1c3dfed1ce925e6fc5312f35f78ada61e4ba0
```

## 本批审计范围

- 核对主 `index.html` 标题/favicon/logo、片场与全景片场、GLB 预览提示、HTML 预览宿主和 Agent 入口；这些入口当前均指向本地 freenow 资源。已存截图 `freenow-production-progress-brand-20261005.jpg` 显示固定 freenow 提示和 F 图，用户“TapNow 用户自定义项目”标题保留。截图为先前主线程验收，不算本批新浏览器证据。
- 根据实际 registry 与 manifest 交集检查 22 个已登记应用的对应 HTML：没有发现静态 HTTP(S) `src`/`href` 或原站 URL。未登记 Product Kit 历史源中的演示 URL仍是来源证据；正式 manifest 选择本地派生版本。production-progress 的固定品牌已由其专属代理派生。本次不全局替换构建注释、协议和来源署名。
- 检查 HTML、Widget 媒体、图片编辑、片场 GLB、画布媒体/堆叠/播放列表的下载名入口；本批未发现固定 TapNow 默认名。名称来自用户文件/项目/节点，或 `creative-page.html`、`白模产物`、`Image Editor.*`、`Scene.glb` 等中性兜底。用户自定义名称可包含旧品牌，保持原文。
- 通用 App proxy 本地读取 manifest/HTML，内层 `connect-src 'none'`，图片限定 data/blob。Agent Markdown 与 App detail 的原站导航使用既有 origin policy 拒绝。本批未改动出站策略；CSP 禁止远程资源不能据此证明所有功能已可用。

## 定向验证

```sh
node --test tests/agent-platform-resize-local-brand.test.cjs
node --test tests/agent-app-escape-bridge.test.cjs tests/agent-app-detail-links.test.cjs
```

**5 项通过**。新增两项执行实际代理派生与内嵌字典：原始字节/版本不匹配拒绝；反向恢复四条文案后 HTML 与完整原始源逐字一致；单数/复数和中文数量正确；实际用户标题函数保留 `TapNow 用户作品`；派生后全部应用脚本通过 esbuild 解析，代理内嵌脚本通过 `vm.Script` 解析。另三项覆盖代理 Escape 和 App detail 导航隔离。

## 浏览器结果与尚未验收

主线程初次从 `src/features/agent-apps/qa/platform-resize.html` 的生产 registry/proxy 入口看到“本机图片裁切”，点击一度受到工具焦点和坐标限制；未削弱 sandbox 或用 eval 点击。后续 **1005k 已完成中文真实指针拖动、原生添加三张 PNG、保存和 freenow 成功提示**，见[最新实机记录](AGENT-PLATFORM-RESIZE-DRAG-SELECTION-20261005.md)，不能再把该中文成功态列为待验。本子任务没有真实模型调用或全套测试。English、刷新恢复及失败重试在该轮未重复验收；全部正式入口、动态脚本/用户 HTML、未知资源槽、实际导出像素/元数据和原站断连后的工作流仍需分别取得证据，不以22个登记资源静态检查代替全站盘点。

全量开放清单见 [本地化与品牌验收](FREENOW-LOCALIZATION-ACCEPTANCE.md)，当前品牌具体位置见 [运行标签记录](FREENOW-RUNTIME-BRAND-LABELS-20261005.md)、[制作进度品牌派生](FREENOW-PRODUCTION-PROGRESS-BRAND-20261005.md) 及[本批导出窄审计](FREENOW-EXPORT-BRAND-AUDIT-20261005.md)。

## QA 宿主排版补记

主线程已实际读到内嵌“本机图片裁切”；后续点击被 Computer Use 的 fractional iframe input coordinates 安全检查拒绝，测得外层 iframe top 为 `573.0546875`。本批只调整 `qa/platform-resize.html` 宿主：段落/输出行高 20px、标题行高 36/28px、caption 16px、整数边距，控制区 flex 排列并明确按钮边框和尺寸，源预览图片采用 block 去除行内基线空隙。没有改正式 App 字节、生产 card/iframe 样式、QA 模块或独立 IndexedDB。

静态检查确认全部 control ID、模块入口、wrapper 平衡和整数 typography。主线程重载后外层 iframe top 为 548、内层 top 为 0，初始品牌可见；当时点击仍被工具限制，已有数据保持。后续 1005k 中文实测得到 450×800、800×800、1200×675 PNG、1 次 undo、1 份持久回执，成功提示为“已添加 3 张到项目，请在 freenow 画布中查看。”，并保存[真实截图](screenshots/agent-platform-resize-drag-20261005.jpg)。

入口为 `http://127.0.0.1:4173/src/features/agent-apps/qa/platform-resize.html`，静态页面无需构建或重启。已有 QA 数据恢复后直接使用现有应用，关闭运行/保存失败开关、选尚未提交的裁切组合并点击“添加 N 张”；必要时“打开官方平台适配”新建卡片仍绑定已有源图。不要点击“载入实际像素测试图”覆盖当前 QA 会话。本链只在本机裁切，不调用供应商。
