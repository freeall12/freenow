# Magnific Precision V2 官方证据快照

2026-10-05 仅用无 Key 的公开 HTTPS GET 读取资料。未执行网页代码，未调用收费或认证 API。主体合同：[MAGNIFIC-PRECISION-NATIVE-CONTRACT-20261005.md](../../MAGNIFIC-PRECISION-NATIVE-CONTRACT-20261005.md)。

- `manifest.json`：九份公开原文的请求 URL、最终 URL、HTTP状态、UTC时间、原文总字节数和 SHA-256；`source_name` 是原文文件名，`temporary_raw_path` 仅记录本机临时位置。
- `precision-v2-contract-evidence.json`：官方完整 OpenAPI 中精确相关的原文摘取及原文行号：API origin / auth、Precision V2 POST / GET、输入字段 / 倍率、任务状态 / URL 输出、认证头；附最小 server-to-server 认证说明与未公开边界。不是完整 OpenAPI 文档。
- `tapnow-wrapper-evidence.json`：本机 TapNow 0.4.81 文件SHA、字符偏移与结构化包装器参数；不包含完整应用代码、账号信息或抓包。

完整原文已移至本机 `/tmp/freenow-magnific-reference-20261005`，未纳入仓库；包括官方完整 spec、三份操作文档、产品说明、认证、限流、webhook与Freepik索引响应。临时目录可能被清理，也不是公共下载地址。公开读者使用 manifest 中的官方 `effective_url` 获取原文后核对 SHA；其中 Freepik 的 `requested_url` 与最终 Magnific URL 一同记录域名转向证据。

本目录是日期快照，在线文档可能更新。无硬性大小/输出格式/取消合同，表示所读官方产品资料未公开这些保证，不表示服务完全没有内部限制或未来不会提供。
