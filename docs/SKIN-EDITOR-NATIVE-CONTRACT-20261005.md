# 皮肤编辑器：官方合同与原生供应商核对（2026-10-05）

当前 TapNow 安装包明确使用 **Enhancor**，不是 Topaz 或 fal 的人像参数，也不是提示词编辑。`detailed` 使用独立 Detailer 模型；`standard`、`heavy` 使用同一皮肤模型的固定参数。Enhancor 的公开官方文档确实提供 Detailer 和 Skin V1 原生接口，但尚不能据此声明 freenow 的三档原生接入完成或“只填 Key 即可用”。

本轮只读本机安装包与公开网页/静态文档 GET，没有请求 TapNow 私有生成接口、没有读取真实环境文件或 Key、没有提交生成/上传、没有使用浏览器。没有验证真实模型效果、账号权限、成本、回调或输出质量。现有源码与多代理并行修改没有被本研究改写。

## 来源和复核

工作区为 `outputs/canvas-replica`，研究开始时为 `main`、`ff38e4c92117c9000f6a10a7a600ccfa3414a41b`。项目没有 `.codex/skills/` 可用技能；未调用全局或归档技能。

| 证据 | 地址或文件 | SHA-256 / 说明 |
| --- | --- | --- |
| 当前 UI 和分发 | `/Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js` | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| 当前 wrapper | `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| 旧 UI 研究 | ignored `reference/image-enhance.md` | 仅辅助核对本地 `image.skin` 请求、三模式、重度警告和增强节点行为；原 wrapper 结论以本轮安装包为准 |
| Enhancor 官网 | [https://www.enhancor.ai/](https://www.enhancor.ai/) | GET 200；HTML `d50ea0425cc74d309ca97e44716bfdd68b23b8112ec6d2c0f7a16febe0a41840`；标题为 AI Skin Texture Enhancement Tool |
| 真实官方应用 | [https://app.enhancor.ai/](https://app.enhancor.ai/) | GET 200；HTML `db03727309444a209ca66296961713697b461b789957d35fbbf7779085ef3e72`；引用下述公开静态包 |
| 官方 API 文档入口 | [https://app.enhancor.ai/api-dashboard](https://app.enhancor.ai/api-dashboard) | 应用源中的真实 API Access 路由；本轮没有登录或访问账号面板数据 |
| 官方文档来源 | [App-7b0f88a2.js](https://app.enhancor.ai/assets/App-7b0f88a2.js) | GET 200，6,792,285 字节；`92adb9e583d1e84cd2daba209070eb86cac7d914061f513c9bf6b5661457d6b4` |
| 提取的官方 Markdown | 临时 `/tmp/enhancor-public-api-docs-20261005.md` | `dc76d27dc9920f477cdbefa5ff452d04e7ee723396652ae1f242fb63a216349d`；仅为本机核对，未将完整第三方包/文档纳入仓库 |

官方 Markdown 是公开应用包中的 `const o1='## Skin Enhancor API – V1...'` 字符串。其起止为 UTF-8 解码后 JavaScript 字符串的字符索引 `1453885` 至 `1710005`（含引号）；这些不是字节偏移。解码 JS 字符串后，将文档中的字面 `\n` 恢复为换行。临时文件第 1–134 行为 Skin V1，第 135–278 行为 V3，第 279–410 行为 V4，第 1216–1312 行为 Detailer。文件后续存在其他供应商文档，不能把其他模型的字段搬到皮肤接口。

复核本机证据只需读公开代码中的以下符号，不需要运行或发送网络请求：

```sh
shasum -a 256 /Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js
shasum -a 256 /Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js
rg -n 'Detailer API|Skin Enhancor API|skin_refinement_level|webhookUrl' /tmp/enhancor-public-api-docs-20261005.md
```

## 安装包的精确行为

`course` 中 `Vrt` 从节点 `mode` 读取状态，默认 `detailed`；提交先保存该值，再调用 `cIe.handleImageEnhance`。`cIe` 使用 `xge`，带入完整源图和 `metadata:{node_id,canvas_id?}`。`xge` 构造 `{images:[imageUrl],times:1,metadata?}`，按模式调用不同 wrapper：

| UI mode | index 导出与 wrapper | 模型 | 固定模型参数 |
| --- | --- | --- | --- |
| `detailed` / 细节增强 | `s1` → `uOl` | `enhancor-detailed` | 无额外模型参数 |
| `standard` / 标准增强 | `r$` → `cOl` | `enhancor-realistic-skin` | `enhancement_mode:'standard'`、`skin_texture_level:0.32`、`skin_realism_level:1.7`、`preserve_eyes:true`、`preserve_mouth:true` |
| `heavy` / 重度增强 | `s0` → `dOl` | `enhancor-realistic-skin` | `enhancement_mode:'heavy'`、`skin_texture_level:0.42`、`skin_realism_level:2.3`、`portrait_depth:0.4`、`preserve_background:true` |

共通 wrapper 发送 `scene:'enhance'`、`provider:'enhancor'`、`images`、`times`、可选 `metadata`，使用 `C1.Post(s5.IMAGE_GEN,body,{shareRequest:false})`。`s5.IMAGE_GEN` 由 `api/conversation/v1/generations/image` 构成。它是 TapNow 自己的聚合接口，不是 freenow 应当复用的运行端点。

`cOl/dOl/uOl` 字符索引分别为 `6705576`、`6705888`、`6706203`。`xge` 分发约位于 `383000`，`Vrt` 约位于 `3252900`。包装层没有发送 `prompt`、选区或蒙版，也没有倍率/目标尺寸字段。标准模式没有显式发送背景保留；重度没有显式发送眼睛、嘴保留，不能推导其省略字段的服务端默认值。

`qAa`（course 导入为 `Yc`）要求聚合 API 回应 `data.result.ids`，随后注册任务完成/失败回调。这是原站任务系统，不能当作 Enhancor 的 `requestId` 协议。

原 UI 展示 `16 - 134` 用量、`1 min`；这些仅为原站显示值，不是独立供应商报价或时长承诺。警告为 `Too much enhancement may alter the image`（中文“过度增强可能会改变图像”）。三档不能压缩为同一提示词的不同强度。

## Enhancor 的公开原生协议

以下是公开 Markdown 的精确字段，未实际调用。两个 API 都使用 `x-api-key`；JSON 请求使用 `Content-Type: application/json`。

| 用途 | base URL | 队列与查询 |
| --- | --- | --- |
| Skin V1，原标准/重度的同厂商候选 | `https://apireq.enhancor.ai/api/realistic-skin/v1` | `POST /queue`、`POST /status` |
| Detailer，原细节增强的同厂商候选 | `https://apireq.enhancor.ai/api/detailed/v1` | `POST /queue`、`POST /status` |

Skin V1 `/queue` 必填 `model_version:'enhancorv1'`、`img_url`（公开可访问 HTTPS 原图）、`webhookUrl`（接收结果的服务端 URL）。公开 enhancement 字段为：

| 字段（大小写必须保留） | 文档范围 / 默认 / 条件 |
| --- | --- |
| `enhancementMode` | `standard` 或 `heavy`；默认 `standard` |
| `enhancementType` | `face` 或 `body`；默认 `face` |
| `skin_refinement_level` | **整数** 0–100，默认 0 |
| `skin_realism_Level` | 浮点数 0–5，默认 0 |
| `portrait_depth` | 数值 0.2–0.4，默认 0.2；仅 heavy 使用 |
| `background`、`skin`、`nose`、`eye_g`、`r_eye`、`l_eye`、`r_brow`、`l_brow`、`r_ear`、`l_ear`、`mouth`、`u_lip`、`l_lip`、`hair`、`hat`、`ear_r`、`neck_l`、`neck`、`cloth` | boolean，默认 false；true 表示保留该区域原特征、阻止 AI 增强 |

Detailer `/queue` 仅公开必填 `img_url`、`webhookUrl`（HTTP/HTTPS）。没有公开 `model_version`、模式、倍率、目标分辨率或图像格式参数。服务描述为 detailer enhancement and upscaling，不承诺相同尺寸。

两个 `/queue` 的成功示例均为 `{success:true,requestId:'...'}`。两个 `/status` 都是 **POST**，body 为 `{request_id:'...'}`；示例回应 `{requestId:'...',status:'IN_QUEUE',cost:...}`。状态全集：`PENDING`、`IN_QUEUE`、`IN_PROGRESS`、`COMPLETED`、`FAILED`。文档说 FAILED 退还 credits，这是供应商文字声明，本轮没有核验。

完成结果只在这两个模型的 webhook 示例中明确写出：`{request_id:'...',result:'https://...',status:'COMPLETED',cost?}`。公开 Skin/Detailer `/status` 示例没有展示完成时 `result` 的字段形态。不能因为其他模型的 completed status 示例有 result 就推断本模型也保证相同。文档没有皮肤/Detailer取消端点、幂等键、回调签名或事件重放合同。

## 尚不能推导的等价映射

同一厂商并不自动证明 TapNow 的聚合参数与公网 V1 是同一个合同：

- `skin_texture_level:0.32/0.42` 和公网 `skin_refinement_level`（整数 0–100）没有公开换算说明。**不能乘以100得到32/42，也不能取0、默认值或近似值后宣称等效。**
- `skin_realism_level` 与 `skin_realism_Level` 只有名称和数值范围相近，尚无绑定模型版本/重命名说明。
- `preserve_eyes` 与 `r_eye/l_eye/eye_g` 的区域覆盖差异未明确；不能仅因文字相近选其中几项并宣称原合同等价。
- `preserve_mouth` 与 `mouth/u_lip/l_lip`、`preserve_background` 与 `background` 是候选语义对应，未获得原聚合服务的映射证据。
- TapNow 没有公开 `enhancor-realistic-skin` 对应的 `model_version`；V3/V4 的相同供应商不能替代 V1，也不能静默替代原模型。V3 支持 preset/custom 和1024–3072输出；V4是另一组 strength/fast/lighting 参数，这些不是原三档字段。
- Detailer 原生独立 endpoint 与原 `enhancor-detailed` 命名/用途吻合，是优先候选；仍未证明模型版本和输出完全等价。
- Skin V1 和 Detailer 没有输出 PNG/JPEG/WebP 选择、MIME、真实像素尺寸或画幅保证；仅有结果 URL。必须取回并完整解码真实输出，不按源尺寸或URL扩展名捏造属性。

## 本地图片、回调和只填 Key 的边界

公开原生 Skin/Detailer 都必填远端 `img_url` 与 `webhookUrl`。不能把 `localhost`、本地资产路径、blob URL 或 data URL 直接发送给这些接口。没有证据允许省略回调，仅靠轮询；不能发送无实际接收能力的示例回调 URL 来绕过必填项。

完整公开 Markdown 未提供带 `x-api-key` 的通用官方图片 upload/storage 接口。公开应用实现包含登录令牌授权的 presigned upload（`Authorization`，并非 API Key 合同）；本轮只看静态代码，没有请求它。其他模型文档建议把本地文件上传到第三方 `tmpfiles.org`，不能自动视为皮肤协议的原生上传能力，也不能未经明确产品设计静默发布用户图片。

因此可接入条件包括供应商 API Key、真正可访问的完整原图、可用公网回调和可信结果取回合同。API Key 自身不能让本机资源成为公开 HTTPS，也不能让本机服务接收公网回调。没有公开回调签名说明时，未来实现应把回调作为待核验通知，不直接信任其结果 URL；需要供应商可复核任务结果，或明确设计额外认证边界。

## 实作建议与结论

本批可完成独立 freenow 前后端合同、原三档参数 profile、完整源图守卫、增强节点同节点回填/版本、Agent确认和本地夹具链路。保持现有标准请求：

```json
{
  "kind": "image.skin",
  "prompt": "",
  "inputs": [{ "type": "image", "nodeId": "source-node", "url": "local-asset-or-exported-source" }],
  "parameters": { "mode": "detailed" }
}
```

这段是 **freenow 内部/gateway 输入**，不是 Enhancor 可直接接受的 body；任意通用 `tasks-v1` 服务必须自行实现这个合同。真实适配器负责完整原图导出、来源绑定、原参数解释和供应商传输。不能仅因为通用网关登记支持 `image.skin` 就宣称原生接入成功。

公网原生选择优先级为 Enhancor Detailer、Enhancor Skin V1；目前保持原生未完成，直到参数转换、原图公开传输、回调与结果核验缺口被证据关闭。没有理由将它自动转成 OpenAI 提示词编辑、Topaz face enhancement 或 fal 任意模型。

本轮试查 `fal-ai/enhancor/detailed`、`fal-ai/enhancor/realistic-skin` 的 `/api` 页面得到200，但相应官方 OpenAPI 和 `llms.txt` 全部404。通用页面HTTP200不是模型存在或合同证据。`https://enhancor.ai/llms.txt` 也返回与官网首页相同HTML/hash，不是文本文档。这些入口未被用于任何适配决策。

## 结构化证据摘要

```json
{
  "source": "tapnow-installed-public-ui-wrapper",
  "provider": "enhancor",
  "modes": {
    "detailed": { "model": "enhancor-detailed", "fields": {} },
    "standard": {
      "model": "enhancor-realistic-skin",
      "fields": { "enhancement_mode": "standard", "skin_texture_level": 0.32, "skin_realism_level": 1.7, "preserve_eyes": true, "preserve_mouth": true }
    },
    "heavy": {
      "model": "enhancor-realistic-skin",
      "fields": { "enhancement_mode": "heavy", "skin_texture_level": 0.42, "skin_realism_level": 2.3, "portrait_depth": 0.4, "preserve_background": true }
    }
  },
  "publicCandidates": {
    "detailed": "https://apireq.enhancor.ai/api/detailed/v1",
    "standardAndHeavy": "https://apireq.enhancor.ai/api/realistic-skin/v1"
  },
  "publicAuthHeader": "x-api-key",
  "queueMethod": "POST",
  "queuePath": "/queue",
  "statusMethod": "POST",
  "statusPath": "/status",
  "statusRequestField": "request_id",
  "queueResponseIdField": "requestId",
  "requiredSourceField": "img_url",
  "requiredCallbackField": "webhookUrl",
  "nativeParityVerified": false,
  "onlyKeyReady": false,
  "realModelCallPerformed": false,
  "unknown": ["texture-refinement-map", "preservation-region-map", "original-model-version", "completed-status-result-shape", "output-codec-and-dimensions", "api-key-image-upload", "webhook-authentication", "cancellation"]
}
```

检查仅包含来源 hash、公开 Markdown 字段与源码调用链、文档内 JSON 解析和文档 diff。没有模型调用结果可供视觉验收。
