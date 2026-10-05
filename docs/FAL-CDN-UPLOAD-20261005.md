# fal CDN 单次原生上传 · 2026-10-05

`server/generation-fal-upload.cjs` 提供独立服务器上传工具。它将准备完成的实际文件字节发送至 fal CDN，返回已确认的文件 URL；不创建生成任务、不接入路由或 UI，也不负责视频解码、共同裁片、mask 封装或分割。调用方必须先授权此次素材发布，并验证来源身份、媒体容器和业务限制。

## 官方依据

本次重新无凭据 GET [fal 官方 storage.ts](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/storage.ts)，SHA256 `789bc247006fe3093c5c5f7127e77f1c94199ca7a80e1f0c0861640301c66ccc`。`initiateUpload` 与 `createStorageClient.upload` 的单次协议是：

```text
POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3
Authorization: Key <server-only-key>
Content-Type: application/json
{"content_type":"video/mp4","file_name":"source.mp4"}
→ {"upload_url":"<signed HTTPS URL>","file_url":"<CDN file URL>"}

PUT <upload_url>
Content-Type: video/mp4
<actual file bytes; no Authorization or fal API Key>
```

本模块仅实现单次流程。SDK 在文件超过 `MULTIPART_THRESHOLD=90*1024*1024` 时切换 multipart，本工具在此边界拒绝超额，不暗中切换协议。SDK 的 multipart、重试、lifecycle 扩展不属于本次实现。官方 [response.ts](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/response.ts) 以 HTTP 成功回执确认上传；这里保守仅接收 200/201/204，且完整读取有界响应。没有找到该单次流程的状态查询或撤销接口，因此没有提供 restore、自动重试、远端删除或“已取消远端上传”承诺。

## 输入、输出和权限

```js
const {createFalUpload} = require('./generation-fal-upload.cjs');
const uploader = createFalUpload({apiKey: serverOnlyKey});
const result = await uploader.upload({
  bytes: preparedBuffer, // Buffer or Uint8Array, copied before asynchronous work
  mime: 'video/mp4',
  fileName: 'source.mp4'
}, {
  signal,
  onStage: async checkpoint => {
    // Save into the current operation's private durable manifest before returning.
    await persistUploadCheckpoint(checkpoint);
  }
});
// {status:'uploaded', fileUrl, mime, bytes:<byte count>, sha256}
```

- `apiKey` 只在服务器闭包中保存，只发固定 `rest.fal.ai` 初始化 URL。调用参数没有供应商地址、headers、下载凭据、FFmpeg 参数或重试选项。
- `bytes` 必须非空且不超过预算；复制后的 SHA256 绑定真正发送的字节。MIME 为不含参数的标准类型字符串；文件名不能包含路径、控制字符或超长名称。上传工具不把 MIME 标签当容器验证证明。
- 配置默认 `maxBytes=90*1024*1024`、`timeoutMs=120000`、`maxConcurrent=1`，分别允许向下收紧文件/超时预算、将并发设为 1–4。90 MiB 与官方 SDK 单次路径阈值一致，是本地保护上限，不是经真实账号验证的 fal HTTP 上传上限。并发超额直接拒绝，不暗中排队或晚些重新发布。
- 受保护网络注入为 `lookup(host,{all:true,verbatim:true})` 与 Node `requestImpl(url,options,callback)`；生产默认 DNS lookup + `https.request`。普通 fetch 的 Response 不能证明 TLS peer，所以不接收 `fetchImpl`；未知配置和上传 options 明确拒绝，避免忽略注入后误用真实网络。
- 该工具没有授权交互，调用本身代表此次发布的 host 授权。业务层须在未配置、来源变化或未授权时避免调用。日志不应保存 Key、签名 PUT URL、原响应正文或文件字节；私有 manifest 可保存下面的有界身份/阶段字段。

## 写前阶段与错误合同

每次 `onStage` 均 await 成功后才进入下一个网络操作。四个成功路径 checkpoint：

| stage | status | 身份与含义 |
| --- | --- | --- |
| `initiating` | `pending` | `identity:null`，`initiationDispatched:true` 先保存初始化派发意图，再 POST |
| `initiated` | `pending` | 已校验并取得文件身份，未 PUT；先保存再继续 |
| `uploading` | `pending` | `uploadDispatched:true` 先保存上传派发意图，再 PUT |
| `uploaded` | `uploaded` | PUT 成功回执、响应安全检查均完成；先保存再返回，调用方才可处理下一文件或生成 |

事件通用字段：

```js
{
  stage, status,
  identity: null || {fileUrl, mime, bytes, sha256},
  initiationDispatched, uploadDispatched,
  retryable: false,
  // Terminal best-effort reporting also supplies code.
}
```

两个 `Dispatched` 字段是保守的**写前派发意图**，不证明网络已发送或供应商已收到；因此即使取消恰好发生在 checkpoint 后、真正发送前，也可能留下 unknown。签名 `upload_url` 不出现在事件、返回值或错误中。

抛出的 Error 使用固定无敏感信息的消息，并附同样的阶段/身份字段及 `code`。主要代码包括 `upload_invalid_input`、`upload_configuration_invalid`、`upload_dns_forbidden`、`upload_connection_forbidden`、`upload_redirect_forbidden`、`upload_credentials_rejected`、`upload_response_too_large`、`upload_receipt_invalid`、`upload_network_failed`、`upload_timeout`、`upload_cancelled`、`upload_checkpoint_failed` 和 `upload_concurrency_limit`。持久 checkpoint 抛出的 `storage_error`、`invalid_preparation_state`、`provider_identity_mismatch` 三个固定 code 保留，让 durable host 优先处理既有存储/身份失败；原 message、cause、URL 等不透传。复用策略拒绝 URL 时还可能保留有界的 `media_*` 代码。

- POST 回执丢失/无法安全解析：`status:'unknown'`、无文件身份；没有第二次 POST。
- 已取得文件身份后的 PUT 丢失、超时、取消或不安全响应：`status:'unknown'`，继续保留文件身份；没有第二次 PUT。
- 已取得身份、尚未上传时的 URL/DNS/持久化失败：保留身份并停止下一网络操作。派发意图 checkpoint 被拒绝时，状态保守标记 unknown。
- 任何 storage checkpoint 异常均停止；不再调用已经失败的 storage callback。最后 uploaded checkpoint 写入失败时，Error 的 `status:'uploaded'` 仅说明远端回执已确认，调用方仍须停止生成并处理本机持久化失败。
- 取消/超时会销毁本地连接，不能证明远端文件没有发布。取消后的 Error 必须由调用方持久化；不能依赖已被中止的 callback 再保存终态。
- 失败终态 `onStage` 为有界 best effort。回调应使用业务来源守卫，避免迟到写入覆盖更新操作。

上传工具本身不拥有跨重启 manifest，也不承诺一次 `upload()` 调用之外的幂等。host 必须先保存上传意图和源 SHA256，保存每个 checkpoint；重启遇到 pending/unknown 禁止隐式再次调用 upload。已保存 uploaded 的同一文件可以复用原 `fileUrl`，有效期/缺失须显式报告，不能自动重新发布。source、mask 与 replacement 的身份都确认后才允许唯一生成 POST；这条持久恢复链需由 provider 独立验收。

## 网络与响应边界

复用 `generation-media-download.cjs` 的公网 URL/地址范围策略及 `generation-endpoint-policy.cjs` 的原站封锁；HTTPS 限定、无 URL 用户名/密码或 fragment。初始化、签名 PUT、将交给模型的 file URL 均解析全部 DNS 地址并拒绝任一私网/非公网回答。实际连接钉选定地址；发送认证 headers 或私有文件 bytes 前检查 TLS encrypted/authorized 与 peer，接收响应后再次核对 peer。`agent:false` 不复用任意现存连接。节点 request 不执行 redirect，任何 3xx 拒绝。

响应最大 64 KiB；检查声明长度与实际完整字节、拒绝压缩编码与非法 JSON 初始化回执。复用 `outbound-client.cjs` 的 credential scanner，检查响应 headers/rawHeaders、UTF-8、UTF-16 LE/BE、URL percent encoding，以及上传输入 bytes/元数据，任何 Key 回显不进入公开错误。返回 file URL 的 DNS 验证只能证明此刻解析；业务层后续 GET/恢复仍应重新走现有安全下载策略，不能把此次验证当永久 DNS 信任。

## 验证与边界

```bash
node --test tests/generation-fal-upload.test.cjs
node --check server/generation-fal-upload.cjs
node --check tests/generation-fal-upload.test.cjs
git diff --check
```

16 项 focused tests 通过，覆盖原生字段、实际 bytes/不可变快照、Key 固定 origin 与无 Key PUT、每阶段持久化门控、混合 DNS 私网、TLS peer 发送前拒绝、redirect、原站/本地/带凭据 URL、响应凭据回显、响应预算、一次 POST/PUT 后丢回执 unknown、取消/超时、并发拒绝及 durable 固定 checkpoint code 保留。使用合成 Key 与 Node request fixtures；未读取真实 Key、私人文件或数据库，未操作浏览器或真实 fal 上传/付费接口，无新增依赖。

这些测试证明本地合同和失败边界，不证明真实账号 CDN 权限、文件有效期、实际上传吞吐、模型效果或 provider 跨重启恢复已经验收。

独立只读交审已复验最新 5 项重点（90 MiB/未知配置拒绝、固定 origin 与签名 PUT、含多尾点原站 URL、CDN DNS、丢 POST/PUT 回执），全部通过；此前 TLS peer、凭据回显与异步 checkpoint 重点也通过。最终追加的固定 checkpoint code 保留测试（3 code × 3 stage）独立复验 1/1 通过，helper 无残留阻断。交审发现 native 调用方仍传 100 MiB 的集成预算冲突，供应商模块负责人已改用独立上传 cap；上传与结果下载预算分开。该发现及跨重启 manifest 验收不属于 uploader 单模块完成证明。
