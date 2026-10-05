# Magnific Precision V2 独立原生接入

`magnific-native` 使用独立 Magnific 公开接口处理完整图片。公开协议与本机请求映射已验证；没有用真实 Key、真实上传或付费生成验收，不宣称与 TapNow 的包装层效果相同。公开文档明确提示放大可能添加细节或改变内容，不能宣传绝不重绘或完全保真。

## 配置

供应商协议设为 `magnific-native`，API 地址留空或填写 `https://api.magnific.com`，填写自己持有的 Magnific API Key。地址只接受该 HTTPS 域名根或 `/v1` 根；不接受旧 Freepik 域名、代理路径、账号口令或查询参数。凭据仅保留在服务端，不进入请求、回执、能力元数据或结果。

唯一模型映射：

```json
{
  "image.upscale:magnific": {
    "kind": "image.upscale",
    "model": "magnific-v2"
  }
}
```

仅填写 Key 不会完成模型映射。其他原生模型、Topaz 或皮肤增强不能通过此协议提交。已有 `tasks-v1` 是另一个由用户明确配置的任务网关，其实现及效果需要独立验证。

## 本机请求与官方线协议

本机只接受 `image.upscale`、空提示词、一个 `source_image`、一个结果和明确的四项参数：

```json
{
  "kind": "image.upscale",
  "prompt": "",
  "inputs": [{"type": "image", "role": "source_image", "url": "data:image/png;base64,..."}],
  "parameters": {"provider": "magnific", "scaleFactor": 2, "sharpen": 7, "smartGrain": 7, "ultraDetail": 30}
}
```

服务器完整解码静态非交错 8-bit RGB/RGBA PNG，核对实际尺寸、CRC、zlib 数据及凭据字节。输入最多 32 MiB、32 × 1024 × 1024 像素，请求最多 64 MiB，这些是本项目预算，官方 Precision V2 文档未承诺对应上限。浏览器可将其他静态格式规范化为原尺寸 PNG；不会缩图，但编码、ICC 色彩配置或 metadata 可能改变。直接支持的规范 PNG 保留已提交原字节。尚未物化的 URL、asset、blob、选区、裁切或动画不能发到原生供应商。

`POST https://api.magnific.com/v1/ai/image-upscaler-precision-v2`，认证头 `x-magnific-api-key`，JSON 仅包含：

```json
{"image":"<原 PNG 的 raw base64>","scale_factor":2,"sharpen":7,"smart_grain":7,"ultra_detail":30}
```

| 本机参数 | 官方字段 | 允许值 | 默认设置来源 |
| --- | --- | --- | --- |
| `scaleFactor` | `scale_factor` | 整数 2–16 | 本机界面默认 2；官方未声明默认 |
| `sharpen` | `sharpen` | 整数 0–100 | 官方默认 7 |
| `smartGrain` | `smart_grain` | 整数 0–100 | 官方默认 7 |
| `ultraDetail` | `ultra_detail` | 整数 0–100 | 官方默认 30 |

本机请求要求四项显式，不用缺字段触发隐式默认。原界面的倍率选择保持 2–8；公开能力记录官方 2–16。没有发送原包装层 `provider:freepik/model:magnific-v2`、额外 prompt、`output_format`、未知模型覆盖、flavor、webhook 或不受支持字段。官方 `image` 明确支持 raw base64 或公开 HTTPS URL，本项目选择经过本机完整校验的 raw base64；没有假设 data URI 或 opaque file ID 同样有效。

## 回执、恢复与取消

官方 POST/GET 回执形状：`{"data":{"task_id":"<UUID>","status":"CREATED|IN_PROGRESS|COMPLETED|FAILED","generated":["<HTTPS URL>"]}}`。

- 合法、无凭据的原 UUID 先通过 `await context.onTaskIdentity(id)` 保存，之后才解释状态与结果。首回执状态未知、图片损坏、多结果、无结果或结果含凭据都不能成为成功；已保存的原 UUID 仍可查询。
- `GET /v1/ai/image-upscaler-precision-v2/{task-id}` 只查询原 UUID，必须与回执 `task_id` 相同。重启、Key 轮换保留同一供应商指纹；恢复不会重发 POST。
- `CREATED` 映射 queued，`IN_PROGRESS` 映射 running，`FAILED` 映射失败并隐藏供应商诊断文本；不伪造处理中百分比。
- POST 不自动重试，HTTP/JSON 失败或超时保留 unknown。HTTP 回执预算 30 秒、1 MiB；本机轮询默认 10 分钟，可取消本机等待。
- 官方未发布本产品取消 endpoint 或幂等参数。模块不提供 cancel，能力 `remoteCancellation:false`；本地取消不能被描述成已停止远端任务或已退款。

## 真实结果与归档边界

公开文档只保证 `generated` URL 数组，没有格式、像素尺寸、字节上限或单张保证。宿主合同要求恰好一个 URL；不会悄悄选取多结果的首张。结果只接受公开 HTTPS URL，经过既有下载器的原站域名阻断、DNS 公网地址校验、连接 IP 绑定、禁止重定向及 MIME/实际容器核对，下载不携带 Magnific Key。

本机支持实际静态 PNG、JPEG、WebP 子集：每张最多 100 MiB、100,000,000 像素、每边最多 32768，同时最多两项结果下载与解码。完整 RGB/RGBA PNG 使用已有完整解码器；其他支持的静态图片使用已安装的 FFmpeg/FFprobe，从私有临时文件完整解码为 RGBA 流，实际字节总数必须恰好为解码尺寸 × 4。PNG 校验全部 CRC，压缩 text/ICC metadata、动画、旋转媒体、损坏编码、额外帧或像素含凭据不能成功。下载和解码各有 120 秒预算，取消会停止子进程并清理临时文件。JPEG/WebP 或其他 PNG 编码需要已有 FFmpeg/FFprobe；缺少工具会保留 unknown，之后可用同一个原任务查询。

结果尺寸来自完整解码，不用输入尺寸 × 倍率推断，不要求供应商实际结果尺寸必然等于倍率计算值。图片原结果编码和字节保持不变，没有转码后冒充原质量。验证后的内联结果交给既有 `generation-media-materializer` / `generation-media-store` 保存；宿主只有真实本地归档完成后才发布成功结果。能力 `outputMimeTypes`、`outputCodecValidation` 和各项上限描述的是本机可接受合同，不能转述为供应商保证。

## 验证与官方证据

```bash
node --test tests/generation-magnific.test.cjs tests/generation-magnific-integration.test.cjs
```

针对性测试覆盖配置和唯一映射、共享 UI 能力合同、真实 POST 字段、完整 PNG 输入、首 UUID checkpoint、未知/损坏结果 GET 恢复、真实 FFmpeg JPEG/WebP 解码、原结果字节保存、本地仓库实际归档及重启读取、超时/取消和不重 POST。所有 Key、网络回执和下载媒体均为本机合成测试素材；编解码器测试使用现机已有 FFmpeg，不请求供应商。

官方协议证据见 [MAGNIFIC-PRECISION-NATIVE-CONTRACT-20261005.md](MAGNIFIC-PRECISION-NATIVE-CONTRACT-20261005.md) 与 [research/magnific-precision-20261005/manifest.json](research/magnific-precision-20261005/manifest.json)。该证据区分已核实协议、未承诺的格式/限制以及未验收的真实效果与费用。

正式面板与 Agent 的本机实操、截图、保存与刷新边界见 [LOCAL-MAGNIFIC-AGENT-20261005.md](LOCAL-MAGNIFIC-AGENT-20261005.md)。
