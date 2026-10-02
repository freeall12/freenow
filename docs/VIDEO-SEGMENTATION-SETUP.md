# 本机视频分割服务

视频替换/移除编辑器的目标识别现在只请求本机 `/api/video-segmentation/`。实际分割由操作者在服务端配置的独立供应商执行，地址和 Key 不进入浏览器、画布、版本、运行记录或日志。本机 UI、选区、蒙层验证/播放、保存流程不依赖 TapNow 服务。

这仍是已有的 `POST /segment-video` 自定义协议适配，不是任意厂商 Key 的通用支持。没有真实供应商配置或实测结果时，不宣称模型识别可用或效果已验证。

## 配置

`.env.example` 只提供空变量；服务读取进程环境，不自动读取文件。

```dotenv
VIDEO_SEGMENTATION_API_BASE_URL=https://your-segmentation-service.example/api
VIDEO_SEGMENTATION_API_KEY=
```

实际地址必须由操作者填入，服务要实现下面的请求/结果合同。需要认证时设置私有 Key，使用 `Authorization: Bearer <Key>`；只有服务本身支持匿名调用时才能不设置 Key。地址不能带用户名、密码、查询或片段。修改后重启本地服务，然后在编辑器的连接入口点击“刷新连接状态”。界面只读取配置状态；此按钮不会提交视频或试调用模型。

配置状态中的 `configured:true` 只说明地址和可选 Key 的格式符合本地规则；`availabilityVerified:false` 保留真实可用性未验证。配置响应不返回地址或 Key。

## 合同

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

结果使用 `video-mask-core.mjs` 原验证器：尺寸匹配、时长/帧率匹配、游程合法不重叠、不能全部为空。没有 `fps` 时按帧数/视频时长推导。服务端只返回 `width/height/fps/frames`，不返回供应商链接、额外元数据或错误正文。视频编辑的后续生成仍使用既有 `video.replace/video.erase` 网关。

## 权限、失败与取消

- 只有点击编辑器的识别确认才提交视频。服务最多同时处理2项，默认5分钟总等待；不自动重发 POST。
- 配置及输入检查在派发前完成。禁止 `tapnow.{media,ai,art,top,zone,plus,tv}`、`tamaredge.top` 及子域，另拒绝采集记录中具名的 `conversation-service-131786869360.asia-northeast1.run.app` 服务及子域；大小写及尾点规范化后检查。不扩大禁止其他 Google 托管服务。
- 供应商 POST 与 RLE GET 都使用 `redirect:'error'`，不跟随任何跳转。
- 非成功HTTP、非法JSON、过大结果、错误RLE返回稳定错误分类，不转发远程错误正文。供应商和蒙层响应最多68MiB，读超限或取消时释放流。
- 浏览器取消或连接断开会中断本机等待并把 AbortSignal 传给供应商请求；这不能确认外部识别已停止。界面明确显示外部停止尚未确认。
- POST 回执丢失或超时分类为 `segmentation_unknown`，不自动重试。不具备供应商任务ID、查询或取消协议，因此不能恢复未知分割请求或声称远程取消成功。分割未进入生成任务持久化，不保存请求视频、地址或 Key。

`setProvider({segment(request,{signal,onProgress})})` 保留自定义测试能力；生产默认使用本机传输。原HTTP进度仍为提交0、拿到完整结果100，未伪造中间进度。`httpProvider()` 不再接受浏览器地址或 Key。

## 服务端接线

模块 `server/video-segmentation.cjs` 导出 `createVideoSegmentationAdapter({baseUrl,apiKey,fetchImpl})`、`config()`、`segment(request,{signal})` 与 `handle(req,res,pathname,{json,body})`。

初始化：

```js
const {createVideoSegmentationAdapter}=require('./video-segmentation.cjs');
const videoSegmentation=createVideoSegmentationAdapter({
  baseUrl:process.env.VIDEO_SEGMENTATION_API_BASE_URL,
  apiKey:process.env.VIDEO_SEGMENTATION_API_KEY
});
```

在 `/api/` 本机Host/Origin检查后、通用非POST/Agent配置检查前分发：

```js
if(pathname.startsWith('/api/video-segmentation/'))
  return await videoSegmentation.handle(req,res,pathname,{json,body});
```

`body` 必须接收第二个字节限制参数；handler 请求上限为68MiB。模块不新增依赖、不写磁盘、不使用日志、不接受任意URL代理参数。

## 验证

```sh
node --test tests/video-mask.test.cjs tests/video-segmentation-server.test.cjs
node --check video-segmentation.mjs
node --check video-mask-ui.mjs
node --check server/video-segmentation.cjs
```

2026-10-03 上述定向测试17/17通过，相关语法检查与 `git diff --check` 通过。覆盖配置缺失/无泄露、原请求与RLE验证、所有禁止域、同源蒙层读取、两段真实HTTP拒绝跳转、非法输入/JSON/HTTP/超限、真实AbortController、等待超时、读流取消、容量释放、客户端断开和未知回执不重试。真实供应商识别质量、认证及费用未验收。

### 本机接线与界面复验

根线程已在 `server/server.cjs` 完成模块实例化和同源API分发并重启本机服务。实际 GET config 返回200/未配置，POST segment 返回503/configuration_required；真实编辑器框选后进入未配置提示和连接说明。关闭窗口取消迟到配置读取，并将焦点返回原连接按钮；隔离页调用生产configure已实际确认active焦点。供应商仍未配置，不能据此宣称已识别出蒙层。
