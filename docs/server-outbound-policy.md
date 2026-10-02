# 非生成服务的出站边界

本机服务对 Agent、检索、语音识别、HTML 作品生成与视频分割采用同一原站域禁用规则。允许操作员配置正常的外部兼容 API；不得把请求发到 TapNow 原站域及子域、原始 conversation 服务或 tamaredge 域，也不得跟随 HTTP 重定向。该约束在实际 SDK fetch 与适配器 fetch 上执行，不依赖模型提示词。

## 实际请求链清点

| 本机入口 | 实际外部调用 | 发送的数据 | 保护位置 |
| --- | --- | --- | --- |
| `/api/agent/turn`、`continue` | `client.responses.create`，普通 JSON 或 SDK stream | 用户任务、画布元数据、附件 JPEG、工具定义、已接受回执 | server factory → AgentRuntime 的受保护 client → SDK clone 的 fetch |
| Agent 上下文整理 | `client.responses.compact` | 已完成的旧模型与工具交换 | 同一受保护 client；不支持或失败时保留原上下文并报告 unavailable |
| Agent 委派 | 子 AgentRuntime 的 `responses.create`、`compact` | 子任务及明确提供的上下文 | 继承父运行的受保护 client，不创建另一条未受保护 SDK 链 |
| `/api/agent/search` | `responses.create`，`tools: web_search` | 验证后的公开检索词、可选域名过滤 | 同一受保护 client；检索源 URL 仅返回链接，不由本机服务下载 |
| `/api/voice/transcribe` | `client.audio.transcriptions.create` | 上传的录音文件与显式转写模型 | 同一受保护 client，Multipart 合同保持 |
| `/api/agent/artifact-html` | `client.responses.create` | 已验证的 brainstorm 元数据和正文 | 同一受保护 client；保留原 HTML 返回合同 |
| `/api/video-segmentation/segment` | POST `<configured endpoint>/segment-video`，必要时 GET 同源 `rleUrl` | 验证过的视频字节/来源、选区与像素提示 | 共享目的地址/redirect guard；RLE GET 继续同源校验，不携带 API Key |
| `/api/media/*`、`/api/media/playlist` | 本机 FFmpeg 子进程 | 上传字节写入临时文件 | `file,pipe` 协议白名单、格式白名单；不接受远端媒体地址作为 FFmpeg 输入 |
| 本机 video scene 媒体分析 | 本机 FFmpeg/ffprobe | 验证过的本机视频字节 | 本机输入与协议白名单，未增加网络来源 |

`server/outbound-client.cjs` 的 `createConfiguredModelClient` 在启动时验证配置，非法地址使连接保持未配置并返回安全的 `configurationError`，不会让服务器启动日志或公开配置包含地址和 Key。目的地址与模型仍参与原有 Agent 恢复身份；有效配置保留 SDK 原本的 baseURL 字面身份以兼容旧检查点。

## SDK、凭据与流式返回

真实注入 SDK 通过 `withOptions` 复制后安装受保护 fetch，保留注入 transport、显式 endpoint 与认证合同，不修改共享 SDK。默认重试关闭；方法调用也固定 `maxRetries: 0`。没有 endpoint、Key 或 SDK transport 的普通本机 mock 保留原对象合同。

Key 只在内存 closure 与 SDK 中使用。普通响应中的字符串和字段名在进入消费者前检查，不允许 Key 被当作模型文本、工具参数、响应 ID、HTML、转写结果或压缩内容返回或持久化。检查使用解析后的原字符串，覆盖引号、反斜杠及标准 URL percent 编码（包括检索引用地址），不依赖 JSON 转义后的 substring。上游错误改为固定安全信息，保留可用于已有认证提示的 HTTP status；不会回显错误正文。

SDK 动态 Key callback 继续可用。transport 只在私有 closure 中观察实际 Bearer 值，让动态凭据也经过同样的返回检查；这些值不进入 config、trace 或任务文件。

Agent stream 会按最长 Key 的完整 UTF-8 percent 编码长度保留文字尾部，再合并检查下一个 delta。含 Key 的跨片文本在公共 `text_delta` 发出前被阻止；完成事件的完整响应也先检查。合法文字在完成时补齐，思考活动、终态工具身份和取消合同继续保留。凭据回显不是完成结果，不会执行其工具或保存其 provider output。

视频分割仍可丢弃未使用的上游额外字段；实际将取回的 RLE 地址若包含 Key，会在 GET 前停止。最终公开的几何和 RLE 帧字段同样检查。无 Key 自托管分割服务继续可用。

## 覆盖范围与未完成边界

本清点只证明上述本机服务器直接发出的请求受到保护，不能据此声称整个页面已与原站零关联。

- 浏览器中的历史 Canvas/LocalAssets 保存内容、用户输入的远端媒体地址、原站参考与旧 HTML/template 资源必须由前端资源迁移、渲染策略和实际 Network 验收继续审查；服务器 SDK guard 不会替浏览器拦截图片、视频、字体或脚本请求。
- 检索源链接和用户明确点击的外部导航不是服务器素材下载。上游原生 `web_search` 的远端工具执行由已配置供应商负责，本机 fetch guard 只能约束发往该供应商的 API 地址，无法验证其内部检索网络。
- 内部测试可注入没有 transport 身份的 mock；这不是可从浏览器选择的供应商配置入口。生产连接始终由启动 factory 创建真实受保护 SDK。

## 验证

```bash
node --test tests/non-generation-outbound.test.cjs tests/voice.test.cjs tests/agent-search.test.cjs tests/agent-compaction.test.cjs tests/agent-stream.test.cjs tests/video-segmentation-server.test.cjs
```

新增最小回归涵盖真实 SDK 的五种 API 发包、loopback HTTP 307 的一次 POST 和零目标请求、原站配置拒绝、普通/转义/动态/URL 编码 Key 回显、跨 delta 文字、正常工具与 reasoning 事件、取消及分割回执地址。只使用合成数据和本机 HTTP fixture；不读取真实 `.env` 或 Key，不调用实际供应商。
