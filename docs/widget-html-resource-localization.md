# Widget HTML 入向资源本地化

生产入口：`agent-widgets/cards.mjs` → `html-resources.mjs` →共享 `local-resource-migration/html-document.mjs`。

- 不修改历史 `widget_code`、trace 或会话正文。纯内联无资源 HTML 保持同步握手；明确资源槽走惰性模板解析、exact 索引查找/内容核验及真实 asset 字节转 data URL。
- 仅共享解析结果 `status: ready` 才交给既有双 iframe sandbox。未知、缺失、格式不支持或读取失败显示“组件资源待修复”，可显式重试；不把失败 HTML 当成功发送。
- Frame/generation/nonce/trace 对象/code/会话当前性均绑定到本次异步准备。换代码、换 trace、重载、暂停、销毁使旧结果失效。准备超过 30 秒可重试。
- 单卡仅保留一个原文准备与一个成功 HTML 缓存。重载握手核对索引内容、AssetStore 适配器与 asset URL/Blob 绑定；绑定未变复用已核验字节，不反复转码。失败不永久缓存。销毁释放准备结果、派生字符串和监听器；素材 Blob URL 仍由原素材适配器所有，不擅自 revoke 用户共享 URL。
- 保持已有 sendPrompt、媒体上传提案/宿主确认、用户激活与模型权限；未修改 proxy。共享解析使用固定 widget policy 保留原 img/media 的 data/blob 能力，禁止额外网络/外部脚本。
- 准备结果只表示静态明确资源槽已处理；内联动态 JS 没有静态资源可验证时不宣称其语义已验证，仍受既有 sandbox/CSP 限制。

## 检查与浏览器入口

3 项新增聚焦检查覆盖真实 Blob 字节运输、缓存绑定变更/失败重试、旧异步结果在多种上下文失效后不可发送，以及可见 pending→retry→ready。既有 Widget/控制器握手检查 24 项通过。测试基于 jsdom，未证明浏览器真实解码或视觉结果。

独立 QA：`/src/features/agent-widgets/qa/resource-localization.html`。使用内存素材与已有只读索引，不写画布或会话；提供真实内存素材、缺失素材、未知外链、索引 PNG、修复后重试、iframe 重载、销毁。浏览器验证由主线程统一执行，本分工未操作浏览器。

主线程已完成真实内存/索引图片、缺失后补齐重试、iframe重载、sendPrompt交接与未知外链的浏览器检查；见 [本批证据](LOCAL-HTML-AND-CONVERSATIONS-20261003.md)。白模录像仍未在本批重验。
