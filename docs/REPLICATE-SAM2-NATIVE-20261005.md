# Replicate SAM2 原生任务后台 · 2026-10-05

原生 `replicate-sam2-native` adapter 已实现固定版本异步预测、私有双方向任务、即时 PNG/RLE 归档与严格原时轴合并。只有全部实际方向通过验证才返回 `mask`；没有模型运行、真实 Key、供应商上传或付费推理证据。本地 HTTP fixture 验证的是传输、持久化与状态机，不能证明 SAM2 的识别质量或两个方向首帧一致策略的实际通过率。

参考来源：[接入评估](VIDEO-SEGMENTATION-REPLICATE-READINESS-20261005.md)、[本批公开传输合同](REPLICATE-SAM2-TRANSPORT-20261005.md)、[无损片段](VIDEO-SEGMENTATION-MEDIA-20261005.md)、[PNG/RLE codec](VIDEO-SEGMENTATION-MASK-CODEC-20261005.md)。公开模型版本与页面所链接 Git commit 之间没有逐字节部署对应证明。

## 固定供应商与输入

- 协议 `replicate-sam2-native`；模型 `meta/sam-2-video`；固定版本 `33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d`。
- `REPLICATE_API_TOKEN` 只保存在服务端闭包，认证请求固定 `https://api.replicate.com`。未知版本拒绝配置；没有可把 Key 发到任意 URL 的 baseUrl 设置。
- 复用现有 `video.segment` 校验；点取选区真实像素中心，时间映射与实际 CFR/PTS 由媒体模块处理。
- 从原字节计算 `source.sha256`，私有保存原字节和准备片段。前向 `[k..N-1]` 与倒序 `[k..0]` 均真实物化，边界点击只创建一路。每个方向保留片段 SHA、实际首帧 SHA、源索引、精确输入 SHA、版本和预测 ID。
- Files API `POST /v1/files` 用 multipart `content` 文件 part，MIME `video/mp4`。上传回执必须同时符合安全 file ID、准确 size、SHA256、MIME、尚未过期 expires_at 和固定 API origin 的原 file 引用。引用保留原查询，不推导 `/download`，不会把引用发回前端。单个物化文件必须小于保守的 100,000,000 bytes 客户端上限。
- `POST /v1/predictions` 请求固定 version 与已证 PNG 输入字段；首次请求体绝无任意客户端模型参数。回执必须符合 model、version、id、精确 echo input 及已知 lifecycle；`aborted` 是失败终态。`data_removed:true` 明确报告恢复过期。

## 路由与收据

| 操作 | 请求 | 返回 |
| --- | --- | --- |
| 配置 | `GET /api/video-segmentation/config` | 配置可用性、固定版本、凭据指纹、最多2路、远程按方向取消 |
| 新识别 | `POST /api/video-segmentation/tasks` + `Idempotency-Key: <UUID>` + 原 `video.segment` JSON | `202`，平铺 TaskDTO，`id` 等于提交前保存的 UUID |
| 查询/取回 | `GET /api/video-segmentation/tasks/:id` | `200`，仅查询已知预测与归档/本地合并；未知本地 ID 返回404且不会创建推理 |
| 明确继续 | `POST /api/video-segmentation/tasks/:id/resume` + `{}` | `202`，只授权已准备但未派发方向；unknown POST不得继续 |
| 取消 | `POST /api/video-segmentation/tasks/:id/cancel` + `{}` | `200`，停止本机、分别请求已知预测取消 |

TaskDTO 包含 `id/protocol/version/providerFingerprint/status/nodeId/createdAt/updatedAt/maxPredictions/branches/canResume/remoteCancellation`。准备后追加 `source:{sha256,width,height,fps,numFrames,duration}` 和 `prompt:{frameIndex,time,pts}`；成功后追加完整 `mask:{encoding,width,height,fps,frames}`。方向收据有 `direction/status/predictionId?/numFrames/downloadedFrames/remoteCancellation/remoteTerminalStatus?`。失败提供固定安全 `code/error`。不会公开输入 URL、原视频 base64、供应商上传/输出 URL、日志或 Key。

客户端必须先保存 UUID 意图，再 POST。同 UUID + 相同校验请求仅返回已有收据，绝不再次启动工作；同 UUID + 不同请求返回409。创建 HTTP 回执丢失时 GET 同 UUID，不能生成新 UUID 并自动重复提交。

`providerFingerprint` 由固定 origin、版本及 Key 的 SHA256 指纹共同构成，公开不可逆摘要。更换账户凭据或版本后，旧任务不能查询上游，也不能继续派发（已完整归档的本地结果仍可读取）；恢复原配置后才可取回。

## 批准配置与 POST 边界 · 1005o

原生 `POST /api/video-segmentation/tasks` 和 `POST /api/video-segmentation/tasks/:id/resume` 必须携带用户本次批准的两个公开身份字段：

```http
X-Segmentation-Model-Version: <config.version>
X-Segmentation-Provider-Fingerprint: <config.providerFingerprint>
```

服务端在校验幂等 ID、解析请求体、准备或读取来源、上传、查询续发任务及创建预测之前，要求两者与当前服务实例配置逐字一致。任一缺失或不匹配返回 `409 segmentation_configuration_identity_mismatch`；不保存新任务、不解析视频，也不会向更换后的配置提交识别。不能仅在收到创建回执后拒绝错误身份，因为那时可能已经产生费用。

前端保存的批准值在 POST 时原样携带，不能自动替换为刚刷新的未批准配置。服务 A 重启为 B 后，A 的创建批准及旧收据续发首先被此 HTTP 边界拒绝；即使显式批准 B，A 的已有收据仍受原任务 `providerFingerprint` 绑定限制，返回 `segmentation_provider_changed`，不查询或续发到 B。

`GET` 和 `/cancel` 不要求新增批准头，继续使用已有任务身份与恢复/取消规则；内部服务方法保持测试和私有调用兼容，公开 HTTP 路由始终强制此检查。两个字段均为公开版本/不可逆配置摘要，浏览器不接收或发送供应商 Key。

定向证据：`node --test tests/video-segmentation-replicate-approval.test.cjs`，3/3 通过。真实 localhost HTTP 请求验证缺失、部分、错误、正确创建头；同配置重启后正确/错误续发；A→B 重启后旧批准和旧收据拒绝；无批准头的 GET/cancel。被拒请求使用非法 JSON，body/parser、prepare、source、media、upload、submit、poll 计数不变，证明拒绝发生在视频处理之前。该专项使用私有临时 store 和计数 DI，仅验证配置批准边界，不是模型、媒体或真实供应商效果验收。未重跑旧专项或操作现有 QA host/store。

## 状态与持久化边界

父状态为 `preparing/running/needs_resume/unknown/succeeded/failed/cancelled`。原创建或显式续发仍在执行时，即使第一路已开始下载且第二路仍 pending，公开收据也保持 `running`、`canResume:false`；工作实际停止后才公开 `needs_resume`，避免前端过早停止观察或重复提示续发。私有目录默认 `server/.segmentation-tasks`，复用 `createGenerationStore` 的单 writer lease、原子 rename、文件/目录 fsync。媒体、PNG、完整 decode 记录置于独立 `files/:uuid/`，mode0600/0700；没有公开静态路由。

预测 POST 前先持久保存 `dispatching` 意图。任何合法 prediction ID 在验证剩余回执字段和凭据 echo 前保存。只有第一路得到明确安全回执，才允许第二路首次提交。回执丢失但没有已保存 ID 的方向为 `unknown`，普通查询、重启、同 ID 再创建或 resume 都不能重发或创建下一路。已知 ID 的回执校验失败也冻结下一路，但可以 GET 相同 ID 重新核对。

重启不会自动提交、重新上传或增加付费推理。`uploading` 恢复为 `pending`；`dispatching` 无 ID 恢复为 `unknown`。已知方向可以查询、归档；第二路仍未派发时为 `needs_resume`，需显式 POST resume。准备中断、尚未建立完整片段时报告准备失败；没有推理自动重试。

两路成功 PNG 分别立即下载，不等待另一路结束。每帧先持久保存真实 PNG 和完整 decode 记录，再保存方向下载进度。部分下载允许 GET 继续已有输出，不重复预测。已归档文件再次读回检查 SHA 和解码记录；重启后的成功 mask 必须重新核对 PNG、RLE 与完整 merge。缺失、损坏、过期或首帧冲突都不能发布部分结果或自动创建替代推理。

## 出站、预算与取消

输出只接受有序的 HTTPS `replicate.delivery` 或真实子域 URL，无重复；可识别的 `frame_00000.png` 文件名必须和数组位置一致。实际下载复用 DNS pinning、公网 IP、同 peer、无重定向、无认证头的 downloader；原站、内网、本机来源不能恢复为运行时依赖。

单 PNG 最多32MiB，尺寸最多16,777,216像素；整任务下载默认256MiB，所有方向总像素最多512MiPixels，RLE最多64MiB。总像素在上传前与首次解码前均检查，总下载按实际字节累计。更严格的 codec 像素/色深/CRC/filter/极性限制详见 codec 文档。

用户取消会请求每个已知 ID 的 cancel，不以停止本地 fetch 冒充远程停止。方向 `confirmed` 表示 cancel 回执为 canceled；`already_terminal` + 真实 `remoteTerminalStatus` 表示此前已 succeeded/failed/aborted，证明已停止但不证明取消成功；其他均 `unconfirmed`。无 ID 的未知 POST 永远不能确认远程停止。取消、终态失败与回执丢失都可能已经计费。

某一路明确失败时，后台主动请求已运行兄弟方向收尾；若取消回执显示该方向早已成功，则立即 GET 相同 ID 并归档其 PNG。兄弟方向取消失回执保留 unconfirmed。整个父任务依然失败，不能因另一方向成功发布部分蒙层。

## 本地证据

```bash
node --check server/video-segmentation-replicate.cjs
node --check server/video-segmentation-replicate-transport.cjs
node --test tests/video-segmentation-replicate.test.cjs
```

16/16 专项通过：真实 localhost HTTP multipart/预测/PNG fixture；准确原时轴 RLE；UUID 幂等；POST失回执未知；中断派发恢复未知；已有ID重启查询；第二路上传中断及明确resume；成功分支即时归档；部分下载续取；错误版本/模型/凭据echo与结果来源拒绝；兄弟失败或第二路上传失败主动收尾；双方向取消与already-terminal边界；供应商过期；Key指纹变更；本地PNG损坏；单writer互斥与任务HTTP路由。测试使用合成真实 MP4 与真实 zlib PNG；为了隔离状态机，专项注入已准备片段描述，媒体真实性由媒体专项和整链浏览器fixture独立验收。

整链浏览器发现的“第一路下载中、第二路 pending”状态窗口另增定向回归：`node --test --test-name-pattern='GET during authorized forward archive' tests/video-segmentation-replicate.test.cjs`，1/1 通过；该修复仅调整活跃任务的公开状态，没有重启或改动正在运行的 QA 私有收据。

仍需获授权的真实供应商验证移动、遮挡、倒序、边界重复提示一致性、PNG编码以及实际上线schema。配置完成只说明可发请求，不等于供应商可用或模型质量已验收。
