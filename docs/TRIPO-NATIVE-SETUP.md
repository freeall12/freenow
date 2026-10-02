# Tripo 原生 3D 资产接入

`tripo-native` 直接接入 Tripo 官方 V3 REST API，处理 `world.generate` 的文字或单张图片生成网格资产。它与 MiniMax H3 多模态视频接口相互独立；不能把这个 3D 适配视为 MiniMax H3 视频已接通。

目前仅验证官方合同和本地模拟传输。没有填写真实 Key、调用模型、上传用户图片或验证真实生成质量。实际 Tripo GLB 的预览、材质、压缩兼容性、下载和供应商账号权限需填写 Key 后联调。

## 明确型号后配置 Key

原画布公开模型别名是 `tripo-text-to-model-h3` / `tripo-image-to-model-h3`。操作者须明确选择实际 Tripo 版本；不会默认猜测版本，也不会映射到 2.5。官方 JavaScript SDK 的 `ModelVersion.H3_1` 对应 `v3.1-20260211`，`H3_0` 对应 `v3.0-20250812`。页面标签须始终带 `Tripo` 前缀，并显示具体版本。

示例多供应商配置（将这两条 provider / route 合并到既有配置，不要替换其他操作）：

```dotenv
TRIPO_API_KEY=
GENERATION_PROVIDERS={"tripo":{"protocol":"tripo-native","apiKeyEnv":"TRIPO_API_KEY","modelMap":{"tripo-text-to-model-h3":{"kind":"world.generate","mode":"text-to-model","model":"v3.1-20260211","displayModel":"Tripo H3.1"},"tripo-image-to-model-h3":{"kind":"world.generate","mode":"image-to-model","model":"v3.1-20260211","displayModel":"Tripo H3.1"}}}}
GENERATION_ROUTES={"world.generate":{"models":{"tripo-text-to-model-h3":"tripo","tripo-image-to-model-h3":"tripo"}}}
```

`modelMap` 的每项只接受 `kind`、`mode`、`model`、`displayModel`。选 V3.0 时使用 `model: "v3.0-20250812"` 与 `displayModel: "Tripo H3.0"`。图/文模式可分别配置，但界面需清楚显示实际所选版本。

不填地址时使用 `https://openapi.tripo3d.ai/v3`；官方中国节点可显式设置 provider 的 `baseUrl: "https://openapi.tripo3d.com/v3"`。地址仅允许这两个已核实节点。Key 仅位于服务端环境变量；前端配置状态不会返回 Key 或实际模型版本日期。

无 Key、映射缺失、版本标签与版本不一致或无效地址时，生成请求在本机阻止，图片不会上传。

## 请求与结果合同

- `prepare(request)` 仅检查配置、输入与参数，不发网络请求。
- `submit(request)` 向 `POST /v3/generation/text-to-model` 或 `image-to-model` 提交，返回包含原型号、模式和供应商 task ID 的本机任务身份。
- 文字模式支持 1–1024 字符提示词，不接受媒体；图片模式只接受一张图片，不接受额外提示词、视频、音频、多视角或全景语义。
- 当前 UI 的 `texture`、`pbr`、`smart_low_poly`、`quad`、`auto_size`、`generate_parts`、`export_uv`、`geometry_quality`、`compress`、`texture_quality` 原值提交。图片模式额外提交 `enable_image_autofix`、`orientation` 和按 UI 实际设置出现的 `texture_alignment`。
- `texture=false` 时须同时明确设置 `pbr=false`，防止官方 PBR 默认值重新打开纹理。三个 UI 材质状态分别为 `(false,false)`、`(true,false)`、`(true,true)`。
- `quad=true` 会使官方输出变为 FBX；分件输出需要独立结果合同。当前仅接单个 GLB，故 `quad=true`、`generate_parts=true` 在本机拒绝，不会偷偷关闭参数或额外提交格式转换任务。
- 未知参数、额外供应商参数、矛盾模型标识、错误布尔类型或尚未支持的参数值在提交前拒绝；不会忽略后提交。
- `poll(id)` 只 `GET /v3/tasks/{task_id}`，检查原任务 ID、生成类型、状态和进度。成功仅接收官方 `output.model_url` 的公网 HTTPS `.glb` 地址，保留真实 `rendered_image_url` 为封面；不会合成模型或假文件。
- `generate(request, options)` 支持 `signal`、`onTaskIdentity`、`onProgress`、轮询间隔与期限，复用一次提交的 task ID。轮询超时保留未确认状态，不重复 POST。

## 本地图片上传

仅在用户发起实际生成且配置与全部参数有效后，将有效 PNG/JPEG 字节以 authenticated multipart `POST /v3/files` 上传；收到有效 `file_token` 后才提交图片生成。上传和生成均不自动重试。

官方图片生成支持公网 PNG/JPEG/WebP 地址，但 `/v3/files` 上传文档仅列 PNG/JPEG。因此内联 WebP 在本机阻止并提示先转 PNG/JPEG。现有媒体准备层若明确实施本机格式转换，可以传转换后的实际像素；适配器不会伪装 MIME、将图片传到公共图床或保存虚构的 token。图片上传限制为 20 MiB，并校验内联格式结构和尺寸。

## 恢复、取消与错误

任务指纹包含官方节点及完整模型映射，不包含 Key。相同配置重启后可查询原供应商 task ID；单纯 Key 轮换不改变指纹。映射或节点改变时由持久化/路由层阻止把旧任务送到新配置；适配器也校验原型号与模式仍有映射。

若 POST 丢回包、上传回执无效或供应商响应不可确认，不会重放提交。已接受身份可继续只读查询；无接受身份不能推测生成不存在后自动再次收费。

目前官方任务合同列出 `cancelled` 状态，未核实可调用的取消端点；适配器不实现远端 `cancel`，`remoteCancellation=false`。本机停止等待不能保证远端收费任务停止。后续 GET 若返回正式 `cancelled`，才作为供应商取消结果。

每次 fetch 与响应读取可中断，期限 30 秒，JSON 响应最多 1 MiB，禁止认证重定向。对外错误使用固定消息，不返回供应商原始错误、Key 或内部网络细节。

## 定向验证与证据

```sh
node --check server/generation-tripo.cjs
node --test tests/generation-tripo.test.cjs
```

覆盖配置拦截、三种材质参数、真实 PNG multipart 字节、上传 token、无公共图床、原任务跨重启/Key 轮换恢复、只读 GET、失败与取消状态、进度、未知 POST 不重放、错误不泄漏、挂起 fetch/流读取中断、响应大小上限。此检查使用模拟 fetch，不消耗供应商额度。

2026-10-03 直接核对的官方一次来源：

- [Tripo V3 文字生成字段与结果](https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard)
- [Tripo V3 单图生成字段与结果](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard)
- [文件上传](https://developers.tripo3d.ai/en/docs/files)
- [单任务查询](https://developers.tripo3d.ai/en/docs/task-query)
- [任务生命周期](https://developers.tripo3d.ai/en/docs/task-lifecycle)
- [官方 SDK 集成与锁定版本](https://developers.tripo3d.ai/en/docs/sdk)
- [锁定 SDK 的 H3_1 / H3_0 枚举及官方节点](https://github.com/VAST-AI-Research/tripo-js-sdk/blob/e35134801b339caac0b84f36fe02d08e73e217b2/src/constants.js)

文档总览将型号称为 `tripo-v3.1` 等产品名，详细生成接口与锁定 SDK 使用版本日期字符串；本适配按详细合同固定实际日期字符串，不使用模糊产品名。
