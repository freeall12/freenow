# Ark 本地视频传输核对（2026-10-05）

当前公开合同无法证明「仅填写 Ark Key，上传任意本地视频，再直接用于 Seedance 视频生成」可用。Ark Files API 支持同一 API Key 上传本地二进制视频，但返回的 File ID 用于多模态理解。视频生成接口只明确支持公网视频 URL 或 `asset://<ASSET_ID>`；不能把 File ID 当成 Asset ID，也不能据 Files API 存在宣称本地视频延长已接通。

本次只读获取官方公开正文及 SDK，没有读取账户、真实 Key，没有上传媒体或调用模型。此文记录的是公开接口合同，不是供应商账号或真实生成验收。

## 接口关系

| 路径 | 鉴权与输入 | 回执及引用 | 是否解决只填 Ark Key 的本地视频生成 |
| --- | --- | --- | --- |
| `POST /api/v3/files` | Ark Bearer API Key；multipart 二进制文件 | `file.id`；`GET /files/{file_id}` 等待 `active`；在 Responses/Chat 中传 `file_id` | 未证明。视频生成正文没有 File ID 引用合同，文件响应没有公网 URL |
| `CreateAsset` 控制面 OpenAPI | AK/SK 签名；公共可访问 `URL`、`GroupId`、`AssetType` | `Id`；`GetAsset` 等待 `Active`；生成时传 `asset://<Id>` | 不能。需要额外 AK/SK/权限，且素材创建仍要求 URL |
| `POST /api/v3/contents/generations/tasks` | Ark Bearer API Key；`video_url.url` 为公网 URL 或 `asset://` | 任务 `id`；查询原任务，成功取 `content.video_url` | 只在输入已是供应商可访问 URL 或有效 Asset ID 时成立 |

未发现此视频生成合同中的 `media_id`、`file_id`、`file://`、localhost、视频 Base64 输入或 File ID 到 Asset ID 的转换字段。不能自行构造这些输入。

## Files API：可上传，但默认是理解输入

官方[上传文件](https://www.volcengine.com/docs/ark/upload-files-api)、[文件输入教程](https://www.volcengine.com/docs/ark/file-api)和[文件对象](https://www.volcengine.com/docs/ark/Thefileobject)明确给出：

```http
POST https://ark.cn-beijing.volces.com/api/v3/files
Authorization: Bearer <ARK_API_KEY>
Content-Type: multipart/form-data; boundary=<boundary>

purpose=user_data
file=<binary video; filename=clip.mp4>
```

`purpose` 必选，值为 `user_data` 或 `agent`。`file` 与 `url` 二选一；本地上传应传真实二进制文件，不能将路径字符串当文件。可选 `expire_at` 为 Unix 秒；默认保存 7 天，教程允许 1–30 天。可选 `preprocess_configs[video][fps]` 等字段控制理解抽帧，默认 1 FPS，范围 0.2–5。这些不是 Seedance 生成输入的抽帧配置。

上传响应是 `object:"file"`，包含 `id`、`status`、`filename`、`bytes`、`mime_type`、`created_at`、`expire_at`、`preprocess_configs`、错误对象等。若指定用户 TOS 才返回 `tos.bucket/object_key`。官方 file object 没有返回供视频生成使用的公网 `url`、`media_id` 或 `asset_id`。

查询合同：

```http
GET https://ark.cn-beijing.volces.com/api/v3/files/<file_id>
Authorization: Bearer <ARK_API_KEY>
```

- `processing`：等待预处理，不能使用。
- `active`：处理完成；官方教程明确可在 Responses API、Chat API 中通过 `file_id` 实现多模态理解。
- `failed`：读取 `error.code/message`，不能继续使用。

官方 Python SDK `wait_for_processing()` 默认每 3 秒查询、最多等待 10 分钟，终态为 `active/failed`；函数返回 `failed` 对象并不等于成功，调用方仍需判断状态。教程另列服务端预处理超时 5 分钟。

Files API 视频格式为 `.mp4/.avi/.mov`，MIME 为 `video/mp4`、`video/x-msvideo`、`video/quicktime`。默认托管空间单文件上限 512 MB、每账号 20 GB；托管上传无需额外存储授权。用户指定 TOS 的视频文件上限 2 GB，其他文件 512 MB。教程没有为 Files 上传列一个可代替 Seedance 时长限制的统一视频时长上限；理解预处理限制不能套用到生成。Files 上传/管理本身不收费；用户 TOS 的存储、流量、请求等另行收费。

同 Key 本机实现 `/files` 二进制上传是可行的合同，但它只能承诺「文件输入上传」。官方 SDK 的[视频示例](https://github.com/volcengine/volcengine-python-sdk/blob/629d09880eff23a283a2af1dd98b65294776e614/volcenginesdkexamples/volcenginesdkarkruntime/async_responses_video.py)将该 ID 放在 `/responses` 的 `{type:"input_video",file_id:...}`，没有转交给 `/contents/generations/tasks`。

## 用户 TOS：需要配置独立可访问媒体通道

Files API 可以通过 multipart `tos[bucket]`、`tos[prefix]` 将文件存入用户已创建的 TOS Bucket；调用仍可使用 Ark API Key，但 Bucket 必须先在控制台授权。响应提供 Bucket 和 object key，不提供公网访问或签名 URL。

因此，Files→用户 TOS→生成是有条件的实现候选：还必须配置并核对对象的公网读取地址，或由独立服务签发足够有效期的 URL，并验证它指向实际可读取的原视频。不能仅由 `tos.object_key` 猜 URL，也不能将 `tos://` 当视频生成正文允许的输入。当前公开文件合同未证明默认托管空间可导出公网 URL。

若为私有对象签发 TOS URL，需要独立签名能力/相应凭据或服务；若使用已授权且可公开读取的对象，则需要操作者明确配置访问方式及存储权限。这些都是额外配置，不能展示为「只填 Key」。TOS 被 Files 托管的对象只能读取，不能在 TOS 侧覆盖、修改或删除；删除须走 Files API。

## Assets API：URL 入库，额外 AK/SK 与权益

官方[私域虚拟人像使用指南](https://www.volcengine.com/docs/ark/private-virtual-avatar-library-guide-preview)说明素材应为虚拟人像，非虚拟人像素材无需入库；私域素材库全部功能需高级创作权益包。首次创建 Asset Group 前须在控制台签署授权函。Assets API 要求 AK/SK 与相应 IAM 权限，不能用 Ark Bearer Key 替代。

1. [CreateAssetGroup](https://www.volcengine.com/docs/ark/create-asset-group-api)：

```http
POST https://ark.cn-beijing.volcengineapi.com/?Action=CreateAssetGroup&Version=2024-01-01
<Access Key / Secret Key request signature>
Content-Type: application/json

{"Name":"<group name>","GroupType":"AIGC","ProjectName":"<project>"}
```

目前 `GroupType` 仅支持 `AIGC`；返回组合 `Id`。`Name` 必选、最长 64 字符；可选 `Description` 最长 300 字符。

2. [CreateAsset](https://www.volcengine.com/docs/ark/create-asset-api)：

```http
POST https://ark.cn-beijing.volcengineapi.com/?Action=CreateAsset&Version=2024-01-01
<Access Key / Secret Key request signature>
Content-Type: application/json

{"GroupId":"<group Id>","URL":"<public video URL>","AssetType":"Video","ProjectName":"<project>"}
```

返回素材 `Id`。只支持 URL，不支持 Base64 或二进制文件；每次一个素材。`AssetType` 支持 `Image/Video/Audio`。`ProjectName` 默认 `default`，必须与组合一致。素材所属项目还必须与生成 API Key 所属项目及使用的推理接入点一致。

3. [GetAsset](https://www.volcengine.com/docs/ark/get-asset-api)：

```http
POST https://ark.cn-beijing.volcengineapi.com/?Action=GetAsset&Version=2024-01-01
<Access Key / Secret Key request signature>
Content-Type: application/json

{"Id":"<asset Id>","ProjectName":"<project>"}
```

`Status` 为 `Processing/Active/Failed`；`Active` 后可用 `asset://<Id>`。即使 HTTP 200，`Failed` 也表示失败，需保留 `Error.Code/Message`。入库异步、无上传时间 SLA，视频处理更慢。`GetAsset.URL` 有效期 12 小时；生成应使用素材 URI。真人库另有本人认证、授权、素材一致性校验流程，见[录入真人形象素材](https://www.volcengine.com/docs/ark/upload-real-person-portrait-assets)，不能把普通上传替代该流程。

## 视频生成限制

官方[创建视频生成任务](https://www.volcengine.com/docs/ark/create-video-generation-task-api)明确输入：

```json
{"type":"video_url","video_url":{"url":"<public URL or asset://Id>"},"role":"reference_video"}
```

这里没有图片/音频字段所列的 Base64 形式。视频与 Asset 入库约束：

- 容器 MP4/MOV；视频编码 H.264/AVC、H.265/HEVC。MP4 音频 AAC/MP3，MOV 音频 AAC/MP3/PCM。
- 单视频不超过 200 MB；24–60 FPS；宽高各 300–6000 px；宽高比 0.4–2.5；总像素数 407696–8295044。分辨率列为 480p/720p/1080p/4K。
- Seedance 2.5 非视频编辑任务单视频 2–30 秒，编辑任务 4–30 秒；最多 10 个视频，总时长不超过 30 秒。Seedance 2.0 系列单视频 2–15 秒，最多 3 个，总时长不超过 15 秒。
- 2.5 原生 `omni_reference_task_type:"extend"` 要求至少一个 `reference_video`、`ratio:"adaptive"`；生成模型还会根据提示词判定任务类型，不一致可能异步报 `InvalidParameter.TaskTypeMismatch`。

这些限制适用于生成输入，Files 能接收更大文件不能放宽它们。本地参考生成应承认它是依据提示词生成新片段；Ark 原生延长合同与“只输出新增片段”的参考生成产品语义不能混为一谈。

## 证据与实施边界

官方正文通过网站自身公开文档接口读取，例如[生成正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1520757)、[上传正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryCode=ark&DocumentCode=upload-files-api&lang=zh)、[Files 教程正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryCode=ark&DocumentCode=file-api&lang=zh)、[CreateAsset 正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryCode=ark&DocumentCode=create-asset-api&lang=zh)。Files/Assets 文档标识来自该网站脚本实际使用的公开 `getDocList`，未凭空枚举路径。

交叉核对官方 SDK 树 SHA `629d09880eff23a283a2af1dd98b65294776e614`：[Files 请求及轮询](https://github.com/volcengine/volcengine-python-sdk/blob/629d09880eff23a283a2af1dd98b65294776e614/volcenginesdkarkruntime/resources/files.py)、[上传类型](https://github.com/volcengine/volcengine-python-sdk/blob/629d09880eff23a283a2af1dd98b65294776e614/volcenginesdkarkruntime/types/file_create_params.py)、[文件对象](https://github.com/volcengine/volcengine-python-sdk/blob/629d09880eff23a283a2af1dd98b65294776e614/volcenginesdkarkruntime/types/file_object.py)、[生成内容类型](https://github.com/volcengine/volcengine-python-sdk/blob/629d09880eff23a283a2af1dd98b65294776e614/volcenginesdkarkruntime/types/content_generation/create_task_content_param.py)。SDK 的 URL 上传注释称 `tos` 必需，而当前官方正文允许 HTTP/HTTPS 上传至默认托管存储；此差异不影响本地 binary 合同，也不能作为生成桥接的证据。

当前项目可完成公网 HTTPS 视频的参考生成适配，并明确拒绝本地 data URI。完整本地链路还需一个有证据、可配置的公网媒体上传/URL 签发通道，再进行真实上传、供应商读取、生成、播放与下载验收。Files ID 直传、伪造 Asset ID、由对象名推算 URL 都不属于已验证实现。
