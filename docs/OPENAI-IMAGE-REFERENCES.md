# OpenAI 图片参考适配

用途：让普通画布 `image.generate` 的有序图片参考接入 OpenAI 原生 Images edits；无引用继续调用 Images generations。`tasks-v1` 和专用局部重绘、擦除、扩图合同保持原行为。

## 操作者配置

```json
{
  "gpt-image-2": {
    "kind": "image.generate",
    "model": "YOUR_ACCESSIBLE_GPT_IMAGE_MODEL",
    "supportsImageReferences": true,
    "maxImages": 16,
    "maxCount": 1,
    "sizeMap": {"1:1|1K": "1024x1024"},
    "qualityMap": {"low":"low", "medium":"medium", "high":"high"}
  }
}
```

这是 `GENERATION_MODEL_MAP` 的占位示例，配合 `GENERATION_API_PROTOCOL=openai-native` 与服务端 `GENERATION_API_KEY` 使用，不承诺账号可以访问任何特定型号。只有支持 GPT Image edits 的实际型号才应开启参考能力。`supportsImageReferences:true` 必须配 `maxImages`，范围1–16；配置者可以收紧到特定型号或部署限制。旧映射默认不启用图片参考。映射仅改变服务端支持能力，不修改画布菜单的商业型号限制。

## 输入、权限和处理

- 前端从当前任务捕获的提供方判断是否为本机 `openai-native`，后续切换直接网关不会改变已提交任务。只有原生图片生成分支将公网图片读取成内联数据；任务网关的公网 URL 行为保持。
- 图片按原 `inputs` 顺序保存，文字并入提示词。前端先解析本地素材身份或地址，原生分支此时不发起 Image 网络探测；通过下述受限读取取得公网/本地图片字节后，只解码实际提交的内联字节并取尺寸。来源变化、取消、解码失败均阻止供应商提交和结果占位规划。
- 浏览器公网读取使用 CORS、`credentials:omit`、`redirect:error`。无 CORS、重定向、HTTP失败、网络失败会明确报错，用户可先导入本地素材；没有服务端代理或静默丢图。跨源本地地址和带用户名密码的图片地址拒绝。
- 全请求64 MiB内联预算保持，超限拒绝且不截短/压缩。单张原生图片字节需小于50 MiB；实际全请求包含 base64 和参数，因此通常会先触发总预算。
- 服务端仅接受规范的 `data:image/png|jpeg|webp;base64,...`，校验 canonical base64、格式签名/结构和真实格式尺寸；不能信任客户端 MIME、宽高或任意 URL。服务端结构校验不替代完整像素解码，浏览器必须完成解码；绕过浏览器的调用仍须由供应商最终验证图片。
- SDK `images.edit` 收到 `image:Uploadable[]`，每项通过 `toFile` 设置真实 MIME 和有序文件名，实际发 `POST /images/edits` multipart。无图仍发 `POST /images/generations`。官方最新 JSON `images:[{image_url|file_id}]` 合同与本项目所用 SDK multipart 合同不同，不混用。
- 前端与服务端均检查引用上限；服务端拒绝媒体种类、模式/引用矛盾、模型标识矛盾、未映射规格、额外参数和超过32000字符的图片提示词。`modelId` 与 `providerParameters.model` 必须一致；顶层 `model` 若是映射别名也须一致，带 canonical `modelId` 时可保留未映射的 UI 展示名。`mask`、`input_fidelity` 和专用编辑操作未开放，不默认忽略或替用户指定。

## 输出、失败、记录

复用现有 PNG 输出检查与真实 IHDR 尺寸，不把请求规格当作返回尺寸。成功输出随后仍经画布实际解码/存储。能力 GET 返回 `references` 与按展示别名区分的 `imageReferences:{maxImages,mimeTypes,transport:'inline'}`；不回传 Key、真实 endpoint 或真实型号。

SDK重试关闭。计费提交后无法确认的错误、429和非法输出维持 `unknown`，没有自动第二次提交。取消中止本地等待并丢弃迟到结果，不承诺远端停止或退款。成功/unknown任务沿用本机持久记录和幂等查询，重启后不重复生成。任务记录可能含提交的图片字节，和既有本地内联素材任务一样保存在本机任务目录；不增加提示词、Key或图片日志。

## 验证与官方来源

```sh
node --test tests/generation-openai-references.test.cjs tests/generation-native-media.test.cjs tests/generation-openai.test.cjs tests/generation-media-preparation.test.cjs tests/generation.test.cjs tests/generation-durable.test.cjs
```

新专项覆盖：已安装 SDK 与注入 fetch 的真实 multipart 文件字节、顺序、MIME、型号/规格字段；1–16引用配置和17引用阻止；公网/本地转换与原网关行为；CORS/格式/解码/预算失败；来源变化/取消；预提交拒绝；unknown无重试；取消后迟到拦截；重启幂等。fetch仅返回本地测试响应，没有真实供应商或计费调用。SDK会用本地 `data:,` 探测 FormData 支持，测试将该探测与真正的 API 请求分开计数。

- [OpenAI 官方图片生成与编辑指南](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI 官方 Images edits 参考](https://developers.openai.com/api/reference/resources/images/methods/edit)
- 当前安装 SDK：`node_modules/openai/resources/images.d.ts` 的 `ImageEditParamsBase`（PNG/WebP/JPEG，每张<50MB，最多16），`resources/images.js` 的 `edit`（multipart）。

官方 mask 对多图中的第一张生效；项目专用局部重绘把主图放在引用列表末尾，因此专用编辑需要单独确定输入顺序和 mask 合同，不能顺便开放为普通 edits。
