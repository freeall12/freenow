# Magnific Precision V2 原生接口合同

核验日期：2026-10-05。仅读取本机 TapNow 0.4.81 包装器和公开官方文档；未读取账号、Key、`.env` 或抓包，未请求生成、上传、任务查询等认证 API。本文件描述可实现的公开合同，不代表真实图像效果、账户权限或收费验收。

**结论：当前 UI 的 Magnific 四项参数可以直接映射官方 Upscaler Precision V2。** 官方 `sharpen / smart_grain / ultra_detail` 的范围与默认值分别为 0–100、7 / 7 / 30，`scale_factor` 支持整数 2–16，涵盖现有界面整数 2–8。无需将参数拼入 prompt，也无需用其他 upscaler 替代。

## 1. 本机包装器与官方产品的对应

`image-enhance-core.mjs` 当前请求保留 `provider:'magnific'`、`scaleFactor`、`sharpen`、`smartGrain`、`ultraDetail`。读取本机安装包得到：

- `/Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js`：`Sge()` 将 Magnific 设置交给 `provider:'freepik', model:'magnific-v2'`，单图写入 `images:[imageUrl]`，三个字段改为 `sharpen / smart_grain / ultra_detail`。界面常量为倍率 2–8、三个整数滑杆 0–100、默认 2 / 7 / 7 / 30。
- `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js`：导出的 `pOl` 增加 `scene:'enhance'`，向 TapNow 自身的 `api/conversation/v1/generations/image` 提交包装请求。

这证明原产品前端参数语义与供应商标签，**不能把 TapNow 的内部包装路径或 `images/provider/model/scene/metadata` 当成供应商公开请求 schema**。官方 Precision V2 使用单数 `image`。安装包 SHA、字符偏移和结构化参数映射见 [tapnow-wrapper-evidence.json](research/magnific-precision-20261005/tapnow-wrapper-evidence.json)，未复制或执行完整应用脚本。

## 2. 当前官方域名与认证

2026-10-05 请求 `https://docs.freepik.com/llms.txt`，最终 URL 为 `https://docs.magnific.com/llms.txt`。官方 Authentication 页面链接的完整 OpenAPI 与 Precision V2 页面均声明：

```text
Base URL: https://api.magnific.com
Authentication: x-magnific-api-key: <server-side private API key>
Content-Type: application/json
```

官方认证说明只支持服务器到服务器的私有 Key；Key 不进入浏览器、画布、Agent 参数或任务输出。当前证据不确认旧 `api.freepik.com` 或 `x-freepik-api-key` 是否继续可用，也不确认旧 Freepik Key 与新 Magnific Key 的互通性。实现应显式使用本次确认的 Magnific 合同，不向旧域名自动降级或携 Key 跟随跨 origin 重定向。

完整公开 spec 来源：[Authentication](https://docs.magnific.com/authentication) → [magnific-api-v1-openapi.yaml](https://storage.googleapis.com/fc-freepik-pro-rev1-eu-api-specs/magnific-api-v1-openapi.yaml)。当前完整 spec 不含 `x-freepik-api-key`。

## 3. 提交字段合同

`POST /v1/ai/image-upscaler-precision-v2`，`operationId: postAiImageUpscalerPrecisionV2`，必填 JSON body。页面与完整 OpenAPI 的 `request-content_3` 一致：

| 官方字段 | 类型 / 范围 | 必填 / 默认 | 当前 UI 映射与边界 |
| --- | --- | --- | --- |
| `image` | string；公开 HTTPS 图片 URL 或 Base64 图片字符串 | 唯一必填字段 | 一张绑定源图；不传 `images` 数组 |
| `scale_factor` | integer 2–16，或匹配 `^(2\|3\|4\|5\|6\|7\|8\|9\|1[0-6])$` 的 string | 可选；未声明默认 | `scaleFactor` 整数 2–8，直接传整数；不扩 UI，不截断或级联请求 |
| `sharpen` | integer 0–100 | 默认 7 | `sharpen`，直接传值 |
| `smart_grain` | integer 0–100 | 默认 7 | `smartGrain`，只改字段名 |
| `ultra_detail` | integer 0–100 | 默认 30 | `ultraDetail`，只改字段名 |
| `flavor` | `sublime / photo / photo_denoiser` | 可选；未声明默认 | 原 wrapper 和当前 UI 无此字段；省略，不自行选风格 |
| `webhook_url` | URI string | 可选 | 本机采用按原任务 ID 查询，可省略 |
| `filter_nsfw` | boolean | 默认 false | 原 wrapper / UI 无此字段；采用供应商默认 |

请求 body 示例（示意占位图，不是可发送真实任务）：

```json
{
  "image": "<原图的原始 Base64，或允许的公开 HTTPS URL>",
  "scale_factor": 2,
  "sharpen": 7,
  "smart_grain": 7,
  "ultra_detail": 30
}
```

该 schema 不包含 `prompt`、`model`、`provider`、`scene`、`metadata`、`output_format`、`width` 或 `height`。接口身份来自 URL，无需向供应商发送内部模型别名。产品说明强调受控细节增强；POST 的说明还写到可能改变原内容，但 schema 并无 prompt 字段。不能将产品名 Precision 解释为“绝不会改变内容”或已验证文字/人像保真。

## 4. 媒体输入、上传与限值

Precision V2 `image` 描述明确允许公开 HTTPS URL、Base64 编码图片字符串，未标 `format: byte`、`maxLength`、图片格式枚举或字节/像素上限。当前文档没有为此产品明确展示 `data:image/...;base64,...` 语法。可采用更保守的实现：校验宿主内联图，去掉 data URI 前缀，将原始文件字节的 Base64 发给 `image`，不重新 JPEG 编码、不缩小、不截图。

官方完整 spec 存在通用上传流程：

1. `POST /v1/ai/uploads/request-url`，body `{files:[{content_type:"image/png"}]}`，1–14 项；图片枚举为 PNG/JPEG/WebP。
2. 回执含 `upload_url`、`headers`、`file_id`、`asset_url`、`expires_in`、`asset_url_expires_in`。
3. 向预签名 `upload_url` PUT 原始文件字节，必须带返回的全部 `headers`；`asset_url` 在 PUT 成功后可读，可用于接受 URL 的 endpoint。

上传 schema 的 `file_id` 是不透明资产标识，通用描述建议 AI endpoint 在可用时使用；**Precision V2 的 `image` 只明确声明 HTTPS/Base64，没有明确承诺此字段接受 `file_id`**。若以后实现上传，使用可读 `asset_url` 这条已声明的 URL 路径；新增上传是独立网络动作和生命周期，不应因可内联而提前上传。

上传示例给出 `expires_in:120`、`asset_url_expires_in:86400`、`x-goog-content-length-range:"0,1073741824"`，都是通用上传示例，不能当 Precision V2 的固定存储时长或 1 GiB 生成容量保证。读取该 spec 未找到 Precision V2 的硬性大小、输出像素、最长执行时间或输出 URL 存活时长承诺。另一个 `image-upscale-request-content` 的 25.3 million pixels 限制属于其他 upscaler schema，不能移植到 V2。

本机防护预算可以自行限制输入和完整 JSON，但必须标为本机限制；PNG 原图路径的本机接入合同也不等于官方仅支持 PNG。源图格式、alpha 保留、超大图和真实账户额度需实际授权后验收。

## 5. 异步任务与结果合同

| 操作 | 官方方法与路径 | 回执 / 限制 |
| --- | --- | --- |
| 提交 | `POST /v1/ai/image-upscaler-precision-v2` | HTTP 200，`data` 包装的 task detail |
| 查询原任务 | `GET /v1/ai/image-upscaler-precision-v2/{task-id}` | `task-id` 必填、string UUID；同一 `data` task detail |
| 列表 | `GET /v1/ai/image-upscaler-precision-v2` | task detail 数组；不能用列表猜测丢失的提交身份 |
| 取消 | 没有在本次官方 Precision V2 paths 中发布 | 不自行构造 DELETE、PUT 或 `/cancel` 请求 |

POST / GET detail schema：

```json
{
  "data": {
    "task_id": "046b6c7f-0b8a-43b9-b35d-6489e6daee91",
    "status": "CREATED",
    "generated": []
  }
}
```

`data` 必填；`task_id` 和 `status` 必填；task detail 增加必填 `generated` 数组，其 item 是 URI string。状态枚举与官方示例：

| 官方状态 | 官方 `generated` 示例 | 本机建议解释（非官方新增状态） |
| --- | --- | --- |
| `CREATED` | `[]` | 已接受 / queued |
| `IN_PROGRESS` | `[]` | running |
| `COMPLETED` | `['https://ai-statics.freepik.com/completed_task_image.jpg']` | 只有合法真实输出时 succeeded |
| `FAILED` | `[]` | failed；保留任务身份 |

GET 已包含结果，不需要构造第二条 `/result` 请求。官方不提供进度百分比、queue position、尺寸、MIME、文件大小、文件名或独立取消状态。数组 schema 不限制只返回一图；宿主对输出数量的产品限制须显式校验，不能静默取第一张忽略其余。

生成 JPG URL 是例子，不是固定 JPEG 承诺。无 `output_format` 字段，不能发 `output_format:'png'`；不能因宿主使用 PNG 输入而把输出标为 PNG。归档实际图片后由真实文件/MIME/解码结果确定格式和尺寸，不能按源尺寸乘倍率伪造。

## 6. 错误、重试、恢复与本机取消

POST 与 GET 公开响应包括 200 / 400 / 401 / 500 / 503。400 有 JSON `message` 及 `application/problem+json` 的 validation schema；401 示例为 Missing / Invalid API key。共享 schema 的部分 validation 示例与 Precision V2 字段不相关，不能把它们当产品专属错误码。未公开 404 的任务不存在语义、429 的产品专属 body，不能据此断言这些响应不会发生。

官方总 Rate Limits 页面声明按 IP 限制 50 hits/s（5 秒窗口）、10 hits/s 平均（2 分钟窗口），按 Key 30,000 RPM；多数 API 无日请求限制。产品页同时提示依订阅等级变化，账户协议和真实返回头仍优先；请求频率上限不等于并发生成数或可消费额度。

当前 spec 未发布 Precision V2 幂等键、客户指定 task ID 或安全重建丢失 POST 回执的方法。产品页建议 503 exponential backoff，并未提供 POST 去重合同。建议实现：

- 每次用户提交最多一次 POST；POST 超时、断网或回执缺失时保持 unknown，不自动重试、不从任务列表推断身份、不切换供应商。
- 接受合法 task ID 后持久化原 endpoint / task ID / 操作和配置身份；刷新与重启只 GET 原任务。GET 网络失败可继续查询原任务，不再次提交。
- 不把本机 AbortController 或关闭面板解释为远端停止。本机取消阻止迟到应用；没有发布的远端取消合同，返回未确认状态并保留已接受身份。
- 网络错误和供应商错误只回传净化信息，不回显 Key、源 Base64、私有 URL 或上游原始错误体。

官方可选 webhook 有 `webhook-id / webhook-timestamp / webhook-signature`，认证页与 webhook 页面说明单独的 secret/HMAC 验证。当前本机轮询模式可省略 `webhook_url`，不新增外部回调入口。

## 7. 精确证据与 SHA-256

仓库仅保留 [Precision V2 相关 schema 摘取](research/magnific-precision-20261005/precision-v2-contract-evidence.json)、最小包装器映射与 [manifest.json](research/magnific-precision-20261005/manifest.json)。schema 摘取保存完整官方 spec 中与 POST / GET、输入、结果和认证有关的原文段落及原文行号；它不是完整 OpenAPI 文档，不包含无关 API 或完整第三方说明。manifest 保存 requested URL、实际最终 URL、HTTP 状态、UTC 时间、原文总字节数和完整 SHA-256。

本批下载的九份完整原文仅留在本机临时目录 `/tmp/freenow-magnific-reference-20261005`，不纳入仓库，临时文件可能被系统清理。公开读者应使用下面的官方链接重新获取原文并核对 SHA；manifest 中的临时绝对路径仅是本机留存记录，不是公共下载链接。[证据目录说明](research/magnific-precision-20261005/README.md)。

| 官方资料 | 关键证据 | 响应正文 SHA-256 |
| --- | --- | --- |
| [Freepik llms.txt](https://docs.freepik.com/llms.txt) | 最终转到 `docs.magnific.com/llms.txt`、新 API origin/header | `0deebc83a2c29e769971fb0bb2c0c63fd4ea307358e9246f3c3e174673e75ae3` |
| [Precision V2 POST](https://docs.magnific.com/api-reference/image-upscaler-precision-v2/post-image-upscaler-precision-v2.md) | 路径、完整输入字段、task 输出 | `389d3f4e5573341192035195a0560aa289f3535c06e1f6ec58845f7c73484d2f` |
| [Precision V2 Overview](https://docs.magnific.com/api-reference/image-upscaler-precision-v2/overview.md) | 2–16倍率、三参数默认、模型语义 | `94353c4852bfc5971abd95a826adc8d462521cd65986843e83a7c4814cbbf312` |
| [Precision V2 GET detail](https://docs.magnific.com/api-reference/image-upscaler-precision-v2/get-%7Btask-id%7D-by-id.md) | 原任务路径、UUID与状态结果 | `f2c5e78bc2293ced14fc3d9da59b173fee1b651ec303f38159a38f9ef3896ca3` |
| [Authentication](https://docs.magnific.com/authentication.md) | 仅 server-to-server 私有 Key、完整官方 spec 链接 | `362683a37fa94994a7f1c37c062b7fff3ba65aad31ffb2fe120fa52d794669ee` |
| [官方完整 OpenAPI](https://storage.googleapis.com/fc-freepik-pro-rev1-eu-api-specs/magnific-api-v1-openapi.yaml) | 输入与GET交叉确认、通用上传、无V2取消路径 | `62a3062430186379709c671400968c97eada5d8b2326eb4b34882ad576522738` |

完整 spec 可定位：V2 paths 第 8325–8397 行；V2 `request-content_3` 第 25339 行；倍率 schema 第 36618 行；通用上传 path 第 8953 行、schema 第 26063 行；`magnificApiKey` 第 37764 行。快照的行号不代表未来在线 spec 固定行号。

## 8. 未验证边界与实施验收

公开字段已足够实现原生适配，真实 Key 调用仍未发生。后续本机 mock 可验证精确单图 body、0/100和2/8边界、拒绝未知字段与小数、UUID身份、四状态、空/多个输出、原任务GET恢复、取消后的迟到应用、POST未知不重发、输出真实解码。

仍需授权真实作品验证：实际可接受图片格式与最大尺寸、data URI 是否原生接受、alpha与文字保真、不同倍率和增强值的效果、输出格式与尺寸、账户权限与旧Key互通、执行时长、生成输出 URL 过期时间、收费与限流。没有公开远端取消合同这一事实不影响本机取消保护，也不能被 mock 测试变成远端停止保证。
