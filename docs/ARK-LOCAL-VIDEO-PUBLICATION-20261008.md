# Ark 本地 MP4 公网传输 · 2026-10-08

本批补齐 `ark-native`、`ark-video-extend-reference`、`ark-video-reshoot-edit` 的**显式可选**本地视频传输：本机实际 MP4 → 独立 fal CDN 上传 → 公网 HTTPS → 原生 Ark 任务 → 实际结果解码 → 本地媒体归档。默认继续阻断本地视频，仍不能宣称只填 Ark Key 就能使用全部菜单。

## 配置与可见提示

仅支持已有多供应商配置。型号映射添加 `videoUploadProvider:"fal"`，引用 `GENERATION_PROVIDERS.fal` 中单独声明的 fal 原生协议及其 `apiKeyEnv`。不复用 Ark Key、不推断可用 sibling、不创建 fal 生成任务，也不新增第三方认证合同。

```json
{
  "video": {
    "protocol": "ark-native",
    "apiKeyEnv": "VIDEO_API_KEY",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "modelMapEnv": "VIDEO_MODEL_MAP"
  },
  "fal": {
    "protocol": "fal-native",
    "apiKeyEnv": "FAL_KEY",
    "modelMap": {}
  }
}
```

```json
{"video.generate":{"models":{"seedance-2.5":"video"}}}
```

```json
{
  "seedance-2.5": {
    "kind": "video.generate",
    "model": "YOUR_ACCESSIBLE_ARK_MODEL",
    "videoUploadProvider": "fal",
    "modes": {
      "REFERENCE_TO_VIDEO": {
        "ratios": ["adaptive"], "resolutions": ["720p"],
        "durations": [5], "audio": true,
        "maxImages": 0, "maxVideos": 1, "maxAudios": 0,
        "videoDurationRange": {"min": 2, "max": 30, "totalMax": 30}
      }
    }
  }
}
```

上面分别为 `GENERATION_PROVIDERS`、`GENERATION_ROUTES` 和 `VIDEO_MODEL_MAP`。型号和能力只是配置示例，需根据已开通的型号填写；没有提供真实账号或默认付费型号。fal 空 modelMap 用于仅上传，不需要配置任何 fal 生成路由；其生成能力为未配置不会阻止这个显式 storage 引用。缺少引用供应商、Key，引用非 fal 协议或不允许的 fal 地址均使配置失效，不回落旧 Key。

延长/重拍在各自既有 entry 上加同名字段，保留其 `capabilityMode:"prompt_simulation"`、profile 与单结果语义。旧请求/结果 API 合同不变，直接单供应商模式不支持这项跨供应商字段。纯公网视频及未选择上传的型号保留原流程。

UI 的延长/重拍 readiness 行持续显示：本地 MP4 将先发布至 fal 公网 HTTPS，再交给 Ark；需要独立 fal Key，限 32 MiB、24–30 FPS。普通节点及共用生成任务准备分支在读取来源前显示同样的发布提示，并说明结果保存到本机；API 配置能力列表也保留此说明。提交提示是现有短通知，持续提示以工具状态行及配置列表为准。未新增确认弹窗。

## 媒体与权限边界

- 当前仅本地实际 MP4，每个输入文件和每个本地结果文件均最多 32 MiB，完整请求最多 64 MiB；来源帧率限定 24–30 FPS 恒定帧率，时长 2–30 秒、最多 900 帧。重拍仍要求 4–30 秒。本地结果解码预算为 5–30 FPS CFR、最多 900 帧、30 秒及 16777216 像素；不将来源最低面积或画幅条件套到 480p 方形/4:3 生成结果。此为本地完整解码预算，不代表 Ark 的全部官方能力。
- 来源实际宽高 300–6000、比例 0.4–2.5、总像素 407696–8295044、偶数尺寸、方形像素；来源声明的宽高、时长/毫秒、可选 fps 均须与完整 ffprobe 帧序列和 FFmpeg 解码一致。旋转、VFR、超预算、MOV/WebM 或缺编解码工具均明确失败，不重采样、不改速、不截短、不伪装 MIME。
- 先解码**全部**本地视频，再发布任何文件。选区仍由既有本地裁片器产出真实片段，server 不接收 clip/trim 指令代替实际视频；来源边界和主体素材 URL 快照继续严格绑定。
- fal Key 只由既有 `createFalUpload` 发往固定 fal 初始化地址，PUT 只带实际字节和 MIME。复用其全部 DNS 地址公网校验、TLS peer 钉选、redirect 拒绝、有界响应及凭据回显检查。原站、私网、用户名密码 URL、fragment 或无效媒体均被拒绝；结果下载复用既有受保护 downloader。
- 普通生成、延长和重拍在浏览器媒体读取前共用纯 URL 预检，规范化尾点并拒绝本地域名、私有/保留 IPv4、IPv6、原站、凭据和 fragment；浏览器预检不解析 DNS。服务器对实际下载/上传目标继续执行既有 DNS 与连接地址校验，浏览器通过不等于域名已验证为公网。
- 发布到 fal CDN 意味着独立公网地址。没有实现 ACL、自动远端删除、生命周期配置或永久 URL 保证；关闭/取消只停止本机工作，不能证明远端文件已删除或付费任务已取消。真实 fal CDN 权限、URL 到期、吞吐、Ark 账号/model 权限和音视频质量仍未实测。
- 私有准备目录为原任务目录旁的 `*-video-mask/ark-<providerId>/<preparationId>/`，目录 0700、文件 0600；保存 source bytes、SHA256、实际媒体 metadata 和已确认 file URL。manifest 和公有准备状态不保存 Key、签名 PUT URL、原 HTTP 响应或凭据。

## 持久状态、结果与失败

每个状态先保存私有 manifest，再 await durable task 的 checkpoint，成功后才能继续：media-preparing → media-ready → upload-initiating / upload-initiated / uploading / uploaded → generation-dispatching → generation-accepted。准备身份绑定完整请求摘要、原 localTaskId、型号、supplier 指纹和协议；模型原任务 ID 在返回/轮询前保存。

刷新/重启恢复只读取 manifest。没有原 task ID 的准备记录返回 unknown，**不再上传、不创建生成任务、不暗中续发尚未提交阶段**。有已保存 ID 的记录只能 GET 原任务；不同请求、localTaskId、路由或指纹拒绝。写前派发意图不等同供应商收到，回执丢失仍保守 unknown。正常已有任务及相同 Idempotency-Key 继续复用原本机 ID。

成功响应须为原任务唯一视频。结果安全下载完整字节、验证容器和实际解码，再保存 SHA256/metadata 的私有结果；之后交给已有 media materializer 归档为 `/api/generation/media/<id>`。重复/重启取回先核验已归档私有结果，不重新下载供应商结果或生成。结果声明时长不符、损坏/超预算、结果 SHA 漂移均不能声称成功。本批未把提示词当产物，也不复制来源视频冒充生成结果。

| 情况 | 本地表现 |
| --- | --- |
| 缺独立发布配置 | 配置/预检阻断，零来源读取、零上传、零模型派发 |
| 来源实际解码/声明失败 | `ark_video_preparation_failed`，`providerDispatched:false`，保留准备证据 |
| checkpoint 保存失败 | 停止后续网络，保留固定 storage/identity code |
| 上传或模型 POST 回执丢失 | unknown，读原记录；不重发 |
| 来源/路由/本机任务绑定漂移 | `provider_identity_mismatch` 或 `provider_configuration_changed` |
| 已接受任务结果不可用 | 不暴露成功产物，继续查询原任务/核对本机结果 |

## 官方依据与未补范围

2026-10-08 重新读取以下公开资料，未访问原站后端、未使用真实 Key 或调用生成 API：

1. [火山方舟创建视频生成任务](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)：`content.video_url.url` 文档接受公网 URL 或素材 ID；图片/音频另外列 Base64，视频未列。本地 transport 因此上传后只向 Ark 传官方 `video_url`，不把理解模型 Files API 套到生成 API。
2. [fal 官方 SDK storage.ts](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/storage.ts)：单次初始化 POST 返回 `upload_url`/`file_url`，随后 PUT 字节；90 MiB 以上另有 multipart。本次继续复用已实现的[单次上传合同](FAL-CDN-UPLOAD-20261005.md)，未实现 SDK 的 retry/multipart/lifecycle。
3. [Enhancor 网站](https://www.enhancor.ai/)及[公开自称官方的 API 文档库](https://github.com/rohan-kulkarni-25/enhancor-api-docs)：皮肤文档列 queue/requestId、status 状态及 webhook result 示例，但没有本地上传、COMPLETED `/status` 结果映射或可验证 webhook 来源合同；主站与该库的官方归属关联本批未得到完整公开证据。不能猜协议接付费接口，原 `skin-tasks-v1` 专用网关边界继续保留。

## 验证范围

2026-10-08 最后一次上述相关 11 个 focused suites 合并运行：115/115 通过；其中新增 Ark 媒体 suite 为 15/15。10 个受影响模块/入口语法检查及 `git diff --check` 通过。执行过程中出现既有 THREE CJS 弃用提示，不影响通过结果。

新增 `tests/generation-ark-video-media.test.cjs` 使用合成 Key、受控上传/生成 wire 和临时 FFmpeg 生成的实际 768×576、24fps、5秒 MP4。覆盖纯预检零目录/零媒体解码/零网络、全来源先解码、字节和上传收据绑定、每阶段 storage 门控、取消、丢 upload/POST、跨实例原 ID 恢复、三个 Ark 操作、本地资产/选区预检、发布提示早于来源读取、前端私网/尾点/原站预检零读取、480×480 结果、实际结果解码/篡改拒绝、generate 终态失败合同，以及真实 routed gateway 同库重启和本地媒体归档。其他受影响 focused suites 覆盖已有 Ark、延长/重拍及其前端 readiness、durable preparation、媒体准备、provider configuration 和 fal uploader。

```bash
node --test tests/generation-ark-video-media.test.cjs tests/generation-ark.test.cjs tests/generation-ark-gateway.test.cjs tests/generation-video-extend.test.cjs tests/generation-video-reshoot.test.cjs tests/generation-durable-preparation.test.cjs tests/generation-media-preparation.test.cjs tests/generation-provider-configuration.test.cjs tests/generation-fal-upload.test.cjs tests/video-creation-native-profile.test.cjs tests/video-reshoot-native-profile.test.cjs
```

模块与受影响入口语法检查及 `git diff --check` 另行执行。这里是实际本机媒体和合同验证，未验证真实供应商；未运行全库测试或安装依赖。

## Computer Use 补证

主任务使用独立 freenow 4195 服务和两个合成配置 QA 会话，未读取真实 Key 或调用外部 API：

- `qa/video-extension-app.html?mode=native&session=ark-1008-extension`：打开正式延长面板，状态行显示须明确配置 `videoUploadProvider` 与独立 fal Key，「确认并生成」禁用；实际 `posts/mediaPrepares/trimCalls` 均为 0。[界面截图](screenshots/ark-extension-publication-config-20261008.jpg)
- `qa/video-reshoot-native-app.html?mode=native&session=ark-1008-reshoot`：正式重拍面板已加载 8 秒真实合成视频的分镜缩略图，显示同类上传配置条件，「生成视频」禁用。关闭面板后点击 QA 的真实任务前置检查，任务明确失败，POST/裁片/生成素材读取均为 0；准备 hook 进入 1 次，在读取前拒绝，不能写成零 hook。预览本身使用本地媒体，不属于生成素材读取计数。[界面截图](screenshots/ark-reshoot-publication-config-20261008.jpg)

两页使用生产面板与 TaskService，配置回执为合成 Ark 且未启用 `videoUpload`。因此本批只证明缺发布配置的可见提示、禁用和前置阻断；启用发布后的通知实际可见时序、配置列表与成功全状态仍未实机验。测试第 111 行的 `notice → read → transport` 证明模块回调顺序，不等同屏幕显示顺序。QA 审计面板覆盖部分界面，两张截图不作为像素对齐证据。普通节点、真实 fal/Ark 权限、素材生命周期和供应商效果仍按上述边界分别验收。
