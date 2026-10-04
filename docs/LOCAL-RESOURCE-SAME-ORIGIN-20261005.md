# 同源资源与多角度 QA 持久引用 · 2026-10-05

独立多角度合同 QA 在刷新后提示 11 项媒体待本地化。现场诊断来自当前画布两个节点及两份撤销历史：源图使用 `/src/features/video-history/qa/landscape.png`，合同输出使用同源绝对 `/src/features/video-history/qa/portrait.png`，多个图片、完整图片及选项字段重复引用同一素材。

这是两个不同的问题：QA 未通过生产本地资产服务归档输出；迁移器也不识别现实场景下合法的同源绝对 `/assets/` 和 `/api/generation/media/<UUIDv4>`。此次没有将 QA `/src/` 路径列入生产持久资源白名单，没有隐藏旧会话的提示，没有修改或删除任何旧 QA 数据。

## 生产迁移

新增 `src/features/local-resource-migration/local-reference.mjs`，由 `snapshot.mjs` 在现有资源槽迁移中调用。合法同源绝对 URL 规范为稳定根相对引用，例如：

```text
http://127.0.0.1:4173/assets/example.png → /assets/example.png
http://127.0.0.1:4173/api/generation/media/<UUIDv4> → /api/generation/media/<UUIDv4>
```

源哈希仍使用原 URL 的完整 UTF-8 字节；诊断不包含原 URL。当前画布、撤销和重做历史统一使用已有资源槽遍历，提示词、正文、身份、provenance 不修改。规范化结果走已有保存冲突和编辑保护流程，不能直接覆盖新修改。

判断使用当前浏览器 origin，并以 `document.baseURI`/页面 URL 提供上下文；显式测试可传入 `baseUrl` 和 `origin`。协议、端口、主机必须与可信 origin 一致。仅接受严格静态 assets 引用及现有 UUIDv4 媒体路由；带 userinfo、query、fragment、路径穿越、非法编码的描述符继续待导入。跨 origin、原站服务、同源私有路径及 `/src/` QA 文件不会因“本机 URL”获得持久身份。

这些判断不请求媒体，也不证明文件或媒体任务实际存在；引用可读性和实际字节仍由资源读取方验证。索引本身仍仅接受严格 `/assets/` 目标，没有放宽映射 schema。

## QA 归档

`generation-config/qa/boot.mjs` 加载生产 `local-assets.js` 后，等待 `GenerationConfigurationQA.prepareLocalMedia()` 完成，再加载生产 `app.js`。该方法仅在 angle profile 工作：

1. 使用同源、禁止重定向的读取获取已有 landscape/portrait PNG。
2. 校验响应成功、PNG MIME 与非空 Blob，通过真实 `LocalAssets.put()` 归档。
3. 源节点和合同输出使用 `asset:` 引用；结果来源仍是明确的本机合同 PNG，不是模型生成。
4. 引用缓存写入现有隔离 QA preferences，并等待其提交。刷新回读该 session 的 `asset:`，用 `LocalAssets.url()` 确认归档可读取，不重复归档。
5. 缓存 Blob 丢失、缓存格式无效、读取/归档失败时明确停止 QA bootstrap，保留缓存和原会话数据；不会自动替换已有缺失资产或返回未归档的合同成功结果。

没有修改 `canvas-data.js`、生产 LocalAssets 服务、provider、主画布数据或正式存储。没有覆盖重新生成的 QA `main.html`。

## 定向证据

```sh
node --test tests/local-resource-migration.test.cjs tests/generation-config-qa-media.test.cjs tests/canvas-resource-migration.test.cjs
node --check src/features/local-resource-migration/local-reference.mjs
node --check src/features/local-resource-migration/snapshot.mjs
node --check src/features/generation-config/qa/configuration.js
node --check src/features/generation-config/qa/boot.mjs
node --check tests/generation-config-qa-media.test.cjs
git diff --check
```

定向测试 **22/22**：真实仓库 PNG 文件字节对比、归档引用跨刷新复用、缺失缓存显式失败、boot 等待归档提交、同源 URL 的当前/撤销/重做规范化、引号和 UTF-8 路径保留、未映射来源及私有/外站/歧义 URL 保留，以及现有保存冲突/编辑保护。

这些 Node 测试使用合成 snapshot、VM 和独立资产适配器，没有读取实际浏览器 IndexedDB。真实新 session 的浏览器创建、结果展示和刷新检查由主任务另行记录；旧 session 的 11 项缺口证据保留。

## 主线程 Computer Use

2026-10-05使用新session `readiness-local-assets-1005b`、angle profile，正式多角度操作产生一个合同结果，随后重新加载页面。完整初始化后确认：

- 没有`resource-migration-notice`；源图和结果均以该origin的Blob URL实际解码，尺寸分别320×180、180×320。
- 源节点left/top仍为100.25/80.5px，结果为773.25/-113.5px；来源连线可见。
- QA刷新后任务计数为0，未重复提交生成；结果来自此前持久画布与本地资产。
- [刷新截图](screenshots/local-assets-refresh-20261005.jpg)保留正式界面和QA合同标识。原`readiness-brand-1005b`中11项提示仍保留，没有清理或覆盖旧数据。

这些图片是仓库本机合同PNG，不是供应商生成结果；新会话通过不表示所有既有私有项目的资源已自动修复。
