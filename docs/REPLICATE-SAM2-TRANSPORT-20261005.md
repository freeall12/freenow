# Replicate SAM2 上传与任务传输合同 · 2026-10-05 / 1005n

**原生 adapter 可以使用 Files API 上传实际 MP4，再将响应的 `urls.get` 原样作为 `input_video`。通用上传合同不是 500MB；本地应保守拒绝 100,000,000 bytes 及以上的片段。** 本批仅核对公开文档、OpenAPI 和官方 SDK；没有读取 Key / 私有账号、上传或运行推理。模型和 PNG 语义沿用 [1005m 研究](VIDEO-SEGMENTATION-REPLICATE-READINESS-20261005.md)，没有宣称线上容器与公开源码完全一致。

## 实际上传请求

[官方 OpenAPI](https://api.replicate.com/openapi.json) 的 `/files` POST 与 [Files API 文档](https://sdks.replicate.com/typescript/resources/files/methods/create/) 在 2026-10-05 核对：固定 `POST https://api.replicate.com/v1/files`，multipart 文件 part 名为 `content`，文件 part 携带 filename 和 MIME type；metadata 是可选 JSON。filename 必须是有效 UTF-8、最多255 bytes，使用实际片段 basename，不能发送完整本地路径。

只作协议示意，不是在本批执行的命令：

```http
POST /v1/files HTTP/1.1
Host: api.replicate.com
Authorization: Bearer <configured token>
Content-Type: multipart/form-data; boundary=<generated boundary>

--<generated boundary>
Content-Disposition: form-data; name="content"; filename="forward.mp4"
Content-Type: video/mp4

<actual materialized MP4 bytes>
--<generated boundary>--
```

使用 Node FormData 时让 fetch 自动生成 Content-Type / boundary。[官方 JS 文件上传实现](https://github.com/replicate/replicate-javascript/blob/2fd6f3944f5e252f2eb7cd4e9e5416786b9c4861/lib/files.js) 与 [请求实现](https://github.com/replicate/replicate-javascript/blob/2fd6f3944f5e252f2eb7cd4e9e5416786b9c4861/index.js) 支持这一点。其固定 commit 日期为 2025-11-17，本次读取日期2026-10-05。

OpenAPI 的成功响应是201，文件对象要求 `id, urls, content_type, size, checksums, metadata, created_at, expires_at`；`urls.get` 示例为 `https://api.replicate.com/v1/files/{id}`。SDK 文档的200 example与此有差异，因此实现应接受合法2xx对象并记录实际状态，不凭网页 example假定200。保存 id、expires_at、size、sha256，交叉校验 size / checksum 与真实上传片段。

`urls.get` 是可用的模型输入，但它是 opaque 资源引用，不能自行拼出或改成 `/download`。[官方 JS util](https://github.com/replicate/replicate-javascript/blob/2fd6f3944f5e252f2eb7cd4e9e5416786b9c4861/lib/util.js) 与 [Python helpers](https://github.com/replicate/replicate-python/blob/d2956ff9c3e26ef434bc839cc5c87a50c49dfe20/replicate/helpers.py) 都直接取该字段填入 prediction input；[SDK README](https://github.com/replicate/replicate-javascript/blob/2fd6f3944f5e252f2eb7cd4e9e5416786b9c4861/README.md) 明确仅上传文件的同一用户 / 组织把它作为 prediction 或 training input时才供模型访问。Python固定 commit 日期2025-08-26；均在2026-10-05核对。

## 限制、失效和删除

OpenAPI 给413的 detail示例为100MB大小限制；[Input files 文档](https://replicate.com/docs/topics/predictions/input-files) 写本地上传100MB，SDK README写100MiB。实际服务器精确边界未测，使用小于100,000,000 bytes的本地限制同时满足两种口径。没有找到通用 Files API支持500MB的一手依据，其他模型的 hosted input限制不能套在 Files 上传上。

Files README写24小时失效，而OpenAPI的历史 example为1小时；**每次响应的 `expires_at` 才是恢复判断依据**。DELETE `/v1/files/{id}` 成功204，此后读取404。不要删除仍被活动任务使用的文件。

这与 [prediction数据保留](https://replicate.com/docs/topics/predictions/data-retention/) 的默认一小时是不同合同：预测输入参数、输出值、输出文件与日志会清除。每条成功分支立即下载验证并归档；`data_removed:true` 或远端失效且本地归档不完整时明确恢复失败，不能自动重新付费推理。以上来源均在2026-10-05核对。

## 模型身份、状态和请求边界

[HTTP API](https://replicate.com/docs/reference/http/) 与公开OpenAPI（核对2026-10-05）支持 `/v1/predictions` 的固定 version请求，创建响应201/202；查询对象含 id、model、version、input、status、data_removed。SAM2每次创建和查询都检查 model=`meta/sam-2-video`、version为1005m固定 digest、输入指纹与方向匹配，查询id与持久id相同。必须先持久化合法prediction id，身份不符也不能丢掉可能已计费任务的可追踪回执。

[生命周期](https://replicate.com/docs/topics/predictions/lifecycle/)（核对2026-10-05）的活动状态是starting/processing；终态包括succeeded/failed/canceled/**aborted**。aborted表示开始前触发期限，不收费；开始后取消为canceled，仍按已运行时间计费。未知status拒绝，不循环猜测。HTTP超时不证明远端停止。Cancel-After从创建时计算；默认运行超时30分钟。

取消固定 `POST /v1/predictions/{id}/cancel`，200回执仍要检查终态；失败或丢响应保存取消未知状态，再查已知id。每一路独立取消。未找到公开创建幂等保证；付费创建的网络、5xx、解析失败或落盘失败必须保留提交未知状态，禁止自动重发。

[输出 origin文档](https://replicate.com/docs/reference/how-does-replicate-work/)（核对2026-10-05）规定输出由 `replicate.delivery`及子域提供。下载PNG只允许HTTPS的该域族；API Key仅发给固定 `https://api.replicate.com`，拒绝带认证请求重定向，输出下载不携带Key。根据持久id本地构造查询/取消URL，不追随任意回执URL。文件输入引用与输出下载使用不同边界。

[限额文档](https://replicate.com/docs/topics/predictions/rate-limits/)（核对2026-10-05）列预测创建600/min、其他3000/min；低余额可能更严，赠送额度且无付款方式为1/sec与6/min。429含detail，但没有保证Retry-After必有；GET可有界退避。认证/额度/413/输入错误应明确停下。[预测错误码](https://replicate.com/docs/reference/error-codes) 是模型失败解释，不能把其建议retry直接实现成自动付费重跑。

## 证据与验收边界

[证据JSON](research/replicate-sam2-transport-20261005.json) 保存公开OpenAPI片段与官方源码hash；OpenAPI实际GET成功，92838 bytes，sha256=`4500bf86453ef1ab65a9e133929ce97f468cff9aa62ab7512d00fd588abb8b39`。网页文档经搜索连接器公开文本核对，没有伪造原始hash。

这是可实施的公开传输合同，不证明真实账号、上传执行、模型推理或PNG效果。后续真实验收仍需授权服务调用；本批不做这类调用。
