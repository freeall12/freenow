# 本机视频分割服务

视频替换/移除编辑器的目标识别现在只请求本机 `/api/video-segmentation/`。实际分割由操作者在服务端配置的独立供应商执行，地址和 Key 不进入浏览器、画布、版本、运行记录或日志。本机 UI、选区、蒙层验证/播放、保存流程不依赖 TapNow 服务。

支持两种显式协议：默认的 `segment-video` 自定义服务，以及固定模型版本的 `replicate-sam2-native` 原生分割。二者不会根据 Key 自动切换。配置状态不等于真实账号、模型效果或端到端验收通过。

## 原生 Replicate SAM2

需要本机 FFmpeg/FFprobe 和独立的 Replicate Token。服务读取进程环境，不自动读取 `.env`。从 `.env.example` 复制到私有配置后，由自己的启动方式载入：

```dotenv
VIDEO_SEGMENTATION_PROTOCOL=replicate-sam2-native
REPLICATE_API_TOKEN=
REPLICATE_SEGMENTATION_VERSION=
```

版本留空使用已核对的固定 `33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d`；其他版本会明确拒绝。认证仅发送到固定 Replicate API origin，不需要填写自定义服务地址。`FFMPEG_PATH`、`FFPROBE_PATH` 可覆盖本机工具位置，默认使用 PATH。

打开视频的物体移除/替换工具，点击“添加蒙层”，在原视频提示帧框选并确认。原生模式会先展示上传和计费说明：本机物化提示帧起始的前向片段；中间提示帧另物化倒序片段，最多两次独立推理。准备片段不包含音轨，逐帧RGB验证和来源索引保留，不能通过复制首帧或遮罩补齐时间轴。

输入沿用原尺寸、全源时长与中心像素点合同。原生路径要求实际零起点、方形像素、偶数尺寸和恒定5–30 FPS视频；来源32 MiB、全部准备片段90 MiB、raw磁盘2 GiB，完整预算见[媒体模块](VIDEO-SEGMENTATION-MEDIA-20261005.md)。不支持的来源会在上传前拒绝，不暗中截断、改速或降采样。

| 操作 | 本机接口与行为 |
| --- | --- |
| 创建 | UUID意图先保存，再 `POST /api/video-segmentation/tasks`，带同 UUID `Idempotency-Key`。 |
| 查看/恢复 | `GET /api/video-segmentation/tasks/:id`，只查询既有任务、下载及合并，不重新推理。 |
| 续发 | `needs_resume` 时用户确认后 `POST /tasks/:id/resume`，仅派发已准备且尚未提交的方向。 |
| 取消 | `POST /tasks/:id/cancel`，分别处理已知预测；回执未知不能宣称远程取消成功。 |

后台私有目录 `server/.segmentation-tasks` 保存任务及实际片段/PNG，不公开静态访问且被 Git 忽略。重启不自动重新提交；未知 POST 不自动重试。两路实际二值PNG必须覆盖完整原时间轴、提示帧逐像素相同，全部通过才返回RLE。前端等待实际画布保存与flush确认，失败保留同任务、同资产再保存；供应商身份、模型、来源、clip或选择变化会阻断旧结果。配置和状态响应不包含Key、上传URL或视频字节。

分割与后续 Wan VACE 编辑是两个独立能力：Replicate Token用于识别，fal Key用于已有蒙层的移除/替换。后者还要求选段81–241帧。不能将“分割成功”解释为后续编辑也满足输入条件或已生成成片。完整合同见[任务后台](REPLICATE-SAM2-NATIVE-20261005.md)、[前端与恢复](VIDEO-SEGMENTATION-FRONTEND-20261005.md)。真实供应商的RGB H.264解码兼容、双向跟踪一致性及实际效果仍待授权验收。

## 自定义同步服务配置

`.env.example` 只提供空变量；服务读取进程环境，不自动读取文件。

```dotenv
VIDEO_SEGMENTATION_PROTOCOL=segment-video
VIDEO_SEGMENTATION_API_BASE_URL=https://your-segmentation-service.example/api
VIDEO_SEGMENTATION_API_KEY=
```

实际地址必须由操作者填入，服务要实现下面的请求/结果合同。需要认证时设置私有 Key，使用 `Authorization: Bearer <Key>`；只有服务本身支持匿名调用时才能不设置 Key。地址不能带用户名、密码、查询或片段。修改后重启本地服务，然后在编辑器的连接入口点击“刷新连接状态”。界面只读取配置状态；此按钮不会提交视频或试调用模型。

配置状态中的 `configured:true` 只说明地址和可选 Key 的格式符合本地规则；`availabilityVerified:false` 保留真实可用性未验证。配置响应不返回地址或 Key。

## 自定义同步服务合同

浏览器 `GET /api/video-segmentation/config` 查询状态，`POST /api/video-segmentation/segment` 提交实际请求。服务端固定向环境配置地址加 `/segment-video` 发送 POST，不接受浏览器指定供应商地址或凭据。

```json
{
  "kind": "video.segment",
  "nodeId": "source-node-id",
  "sourceVideoUrl": "data:video/mp4;base64,...",
  "width": 320,
  "height": 180,
  "duration": 4,
  "time": 1.25,
  "selection": {"x": 0.1, "y": 0.1, "width": 0.25, "height": 0.5},
  "pointPrompts": [{"x": 72, "y": 63, "time": 1.25, "label": 1}]
}
```

本地素材在配置检查通过后转换为实际视频字节。服务接受有效 Base64 的 `data:video/*` 或合法 HTTP(S) 来源；不读取文件路径、blob 或资产 ID。内联字节最多50MiB、整个HTTP请求最多68MiB。字节封装验证不等于视频编解码验证，视频尺寸与时长仍由编辑器实际读取。

请求字段、选区字段与中心像素提示严格核对，保留原视频完整时间轴。来源、节点与参数变化仍由编辑器守卫阻止迟到应用。

供应商直接返回：

```json
{"width":320,"height":180,"fps":24,"frames":["0 12 320 12","..."]}
```

也可返回 `{width,height,fps?,rleUrl}`：服务端读取供应商同 origin 的 HTTP(S) JSON数组，把逐帧RLE内联返回浏览器。相对地址按供应商基础地址解析；其他 origin、凭据地址和非HTTP(S)被拒绝。RLE GET 保留原接口的无额外认证行为，不转发分割 POST 的 Key；需要认证的供应商应直接返回 `frames`，或提供可直接读取的同源蒙层URL。

结果使用 `src/features/video-mask/core.mjs` 原验证器：尺寸匹配、时长/帧率匹配、游程合法不重叠、不能全部为空。没有 `fps` 时按帧数/视频时长推导。服务端只返回 `width/height/fps/frames`，不返回供应商链接、额外元数据或错误正文。视频编辑的后续生成仍使用既有 `video.replace/video.erase` 网关。

## 自定义同步服务的权限、失败与取消

- 只有点击编辑器的识别确认才提交视频。服务最多同时处理2项，默认5分钟总等待；不自动重发 POST。
- 配置及输入检查在派发前完成。禁止 `tapnow.{media,ai,art,top,zone,plus,tv}`、`tamaredge.top` 及子域，另拒绝采集记录中具名的 `conversation-service-131786869360.asia-northeast1.run.app` 服务及子域；大小写及尾点规范化后检查。不扩大禁止其他 Google 托管服务。
- 供应商 POST 与 RLE GET 都使用 `redirect:'error'`，不跟随任何跳转。
- 非成功HTTP、非法JSON、过大结果、错误RLE返回稳定错误分类，不转发远程错误正文。供应商和蒙层响应最多68MiB，读超限或取消时释放流。
- 浏览器取消或连接断开会中断本机等待并把 AbortSignal 传给供应商请求；这不能确认外部识别已停止。界面明确显示外部停止尚未确认。
- POST 回执丢失或超时分类为 `segmentation_unknown`，不自动重试。不具备供应商任务ID、查询或取消协议，因此不能恢复未知分割请求或声称远程取消成功。分割未进入生成任务持久化，不保存请求视频、地址或 Key。

`setProvider({segment(request,{signal,onProgress})})` 保留自定义测试能力；生产默认使用本机传输。原HTTP进度仍为提交0、拿到完整结果100，未伪造中间进度。`httpProvider()` 不再接受浏览器地址或 Key。

## 服务端接线

模块 `server/video-segmentation.cjs` 提供 `createVideoSegmentationService` 选择器，原 `createVideoSegmentationAdapter` 保留给同步协议。正式服务器显式传入协议、独立凭据、私有目录和本机媒体工具，启动等待 `ready`，退出等待 `close`（如该协议提供）。

初始化：

```js
const {createVideoSegmentationService}=require('./video-segmentation.cjs');
const videoSegmentation=createVideoSegmentationService({
  protocol:process.env.VIDEO_SEGMENTATION_PROTOCOL,
  baseUrl:process.env.VIDEO_SEGMENTATION_API_BASE_URL,
  apiKey:process.env.VIDEO_SEGMENTATION_API_KEY,
  replicateApiToken:process.env.REPLICATE_API_TOKEN,
  version:process.env.REPLICATE_SEGMENTATION_VERSION
});
```

在 `/api/` 本机Host/Origin检查后、通用非POST/Agent配置检查前分发：

```js
if(pathname.startsWith('/api/video-segmentation/'))
  return await videoSegmentation.handle(req,res,pathname,{json,body});
```

`body` 必须接收第二个字节限制参数；handler 请求上限为68MiB。同步协议不写磁盘，原生协议保存私有任务与媒体；两者均不接受任意供应商代理地址，不记录视频请求正文或Key。

## 验证

```sh
node --test tests/video-mask.test.cjs tests/video-segmentation-server.test.cjs
node --check src/features/video-mask/segmentation.mjs
node --check src/features/video-mask/ui.mjs
node --check server/video-segmentation.cjs
```

2026-10-03 上述定向测试17/17通过，相关语法检查与 `git diff --check` 通过。覆盖配置缺失/无泄露、原请求与RLE验证、所有禁止域、同源蒙层读取、两段真实HTTP拒绝跳转、非法输入/JSON/HTTP/超限、真实AbortController、等待超时、读流取消、容量释放、客户端断开和未知回执不重试。真实供应商识别质量、认证及费用未验收。

### 本机接线与界面复验

根线程已在 `server/server.cjs` 完成模块实例化和同源API分发并重启本机服务。实际 GET config 返回200/未配置，POST segment 返回503/configuration_required；真实编辑器框选后进入未配置提示和连接说明。关闭窗口取消迟到配置读取，并将焦点返回原连接按钮；隔离页调用生产configure已实际确认active焦点。供应商仍未配置，不能据此宣称已识别出蒙层。
