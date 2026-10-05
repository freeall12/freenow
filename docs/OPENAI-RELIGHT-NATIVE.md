# 独立 OpenAI 参数提示词打光编辑

`server/generation-openai-relight.cjs` 实现 `openai-relight-native`、`image.relight`。它把原工具的全部光照参数编译为结构化英文指令，再用现有 OpenAI SDK `images.edit` 编辑一张完整来源图。独立供应商没有公开与本地面板同名的物理打光参数；因此这是一种显式替代实现，**不保证物理精确打光，不保证逐像素保持，也不宣称与 TapNow 后端效果等效**。

## 官方依据与验证边界

2026-10-05 无凭据 GET 核对 [官方图像生成与编辑指南](https://developers.openai.com/api/docs/guides/image-generation.md)，并只读已安装 `openai/src/resources/images.ts` 的 `ImageEditParamsBase`：

- [Create image edit 官方 API](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [官方 Node SDK Images 源码](https://github.com/openai/openai-node/blob/master/src/resources/images.ts)

已安装 SDK 明确列出 `gpt-image-2`、`gpt-image-2-2026-04-21` 支持编辑。GPT Image 输入可为 PNG/WebP/JPG、单图小于 50 MB；GPT Image 返回 Base64。原生 `size` 控制生成图片而非输入图，支持自动尺寸及模型支持的明确尺寸。指南说明 `size:'auto'` 会根据提示词自动选择。`gpt-image-2` 忽略 `input_fidelity`，适配器不发送该字段，不发送 `response_format`。

仅启用项目已有依据的 GPT Image 2 两个模型；不会改成指南当前推荐的其他模型。专项已使用真实安装 SDK 的 multipart 与本地模拟响应，没有使用真实 Key、`.env`、付费 API 或供应商 POST。账号资格、组织验证、实际模型效果、色温/方位遵循程度均未实测。

## 操作员显式配置

映射只允许精确操作别名 `image.relight`。必须明确提供 `kind`、`model`、`semantics`、`quality`、`outputSize`，不推断默认模型或编辑身份：

```json
{
  "image.relight": {
    "kind": "image.relight",
    "model": "gpt-image-2",
    "semantics": "parameter-prompt-edit",
    "quality": "high",
    "outputSize": "auto"
  }
}
```

`quality` 允许 `low/medium/high/auto`，`outputSize` 允许 `auto/1024x1024/1536x1024/1024x1536`。请求不能覆盖这些服务端参数。自动尺寸下保留构图、主体、画幅是提示词要求，供应商可能输出不同宽高；结果以实际 PNG 解码尺寸归档。明确标准输出尺寸时，返回图片必须匹配该尺寸。**适配器从不为达到输出规格而裁切、缩放或重编码来源 PNG**。

多供应商路由由现有 gateway/router 接线，操作路由采用 kind-only 的 `image.relight`，不使用 UI 模型别名。本模块不承担公共路由与配置写入。

## 严格请求合同

```js
{
  kind: 'image.relight',
  prompt: '',
  sourceNodeId: 'source-node',
  inputs: [{
    type: 'image',
    role: 'source_image',
    nodeId: 'source-node',
    url: 'data:image/png;base64,...',
    width: 1920,
    height: 1080
  }],
  parameters: {
    angle: {preset: 'top_front_right_45'},
    brightnessPercent: 50,
    temperatureK: 5600,
    rimEnabled: true,
    rimPreset: 'back_0'
  }
}
```

参数五项均必填，`angle` 仅有 `preset`。来源仅一张完整图，role 必须为 `source_image`。可选声明尺寸需和真实字节一致；同时声明源节点身份需一致。额外 prompt 必须精确为空字符串；顶层 count 缺省或数值 1，references 缺省或空数组。不接受多个结果、模型别名、供应商字段、蒙版、额外参考、额外参数或未知请求字段。合法顶层元数据仅 `label/nodeId/sourceNodeId`。

后端 wire 仅接受完整非交错 8-bit RGB/RGBA PNG，沿用现有 PNG 解码器检查 CRC、完整 chunks、filters、有界 deflate 与像素总数。来源小于 50 MiB，最多 33,554,432 像素。拒绝截断、CRC 错误、假 PNG、APNG、其他色深/交错 PNG、asset/blob/HTTP 地址。来源和结果均拒绝 `zTXt/iTXt/iCCP` metadata 块：共享像素解码器未审阅这些独立文本/色彩配置编码，适配器沿用 panorama 的严格边界直接拒绝，不把其内容剥除后悄悄接收。即使压缩 metadata 没有凭据也同样拒绝，公开 profile 的 `rejectedPNGMetadataChunks` 明确三项限制。JPEG/WebP 不能依靠现有 envelope helper 冒充完整像素校验；浏览器可在原尺寸真实解码后转换为 PNG，再提交，公开 profile 明确 `inputMimeTypes:['image/png']`。转换会改变编码，不承诺原压缩字节相同；适配器上传的 PNG 字节保持原样。透明来源允许作为完整图，适配器不把 alpha 当作编辑 mask，也不上传 mask。

前端 `prepareRelightMedia` 在派发前真实解码完整来源图：服务器支持的静态 RGB/RGBA PNG 保留原字节；带 `tRNS/zTXt/iTXt/iCCP`、索引、16-bit 或交错的可解码静态 PNG，以及 JPEG/WebP，均按实际原尺寸经 Canvas 转为 RGB/RGBA PNG。APNG 提前拒绝，超出字节或像素预算不缩小图片。转换可能发生 ICC 色彩转换，不保证原编码、元数据或色彩配置原样；`preservesSourceBytes:true` 指服务器收到的已准备 PNG 上传字节保持原样。前端 readiness 严格核对压缩元数据拒绝列表，缺失、重复、额外或错误声明均不能作为已就绪能力。

## 26 光位与全部档位

同步声明由专项回归与 `image-relight-core.mjs` 逐项比较，避免后端只支持四方位却伪装成原参数：

| 高度 | 方位角 0/45/90/135/180/225/270/315 度对应的 preset |
| --- | --- |
| 0 度 | front_0, right_45, right_90, right_rear_45, back_180, left_rear_45, left_90, left_45 |
| +45 度 | top_front_45, top_front_right_45, top_right_45, right_rear_top_45, top_rear_45, left_rear_top_45, top_left_45, top_front_left_45 |
| -45 度 | bottom_front_45, bottom_front_right_45, bottom_right_45, right_rear_bottom_45, bottom_rear_45, left_rear_bottom_45, bottom_left_45, bottom_front_left_45 |
| +90/-90 度 | top_90 / bottom_90，规范方位角均为 0 |

方位约定：0 前、90 右、180 后、270 左，正高度上、负高度下。主光 `brightnessPercent` 只允许 10/50/100，作为原工具的视觉亮度档位，不把百分比假解释为校准的曝光倍率。`temperatureK` 只允许 2000/3000/4000/5600/7000/8000，编译保留精确 Kelvin，并说明低色温偏暖、高色温偏冷。

`rimEnabled` 是严格布尔。true 仅在 `front_0/left_90/right_90/top_90/bottom_90/top_front_45/left_45/right_45/top_front_left_45/top_front_right_45` 十个主光位合法。其余主光位开启轮廓光直接拒绝，不静默关闭。

`rimPreset` 始终保留并校验：`back_0` 为 180°/0°，`top_back_45` 为 180°/+45°，`low_back_45` 为 180°/-45°。即使关闭轮廓光，prompt 仍记录 preset 与坐标，并明确其为 inactive、不要添加轮廓光。默认值 50/5600/true/back_0 同样完整编译，没有默认字段被忽略。

## 公开能力和失败行为

`metadata.capabilities.relight` 是单一 profile，包含完整枚举、坐标、rimEligibleAngles、格式/字节/像素限制、输出尺寸和质量，以及：

```text
semantics: parameter-prompt-edit
sizePolicy: provider-native-output
preservesSourceBytes: true
aspectMatchGuaranteed: false
physicalLightingGuaranteed: false
tapNowEquivalent: false
promptEditable: false
maxInputImages/maxCount: 1
verified: official-schema-and-local-contract
```

`remoteRecovery/remoteCancellation` 均为 false。同步 Images API 没有本适配器可恢复的 task ID，不伪造 poll/cancel，不把供应商 trace 当作恢复 ID。SDK、SDK 克隆配置和每次调用均 `maxRetries:0`，仅一次 `images.edit`，不调用 `images.generate`。unknown 恢复须由已有 durable 层保留原回执，不重发付费生成。

响应仅接受有界 JSON（64 MiB）、真实单个完整 PNG Base64。检查 Content-Type、Content-Encoding、Content-Length 和完整 PNG 像素。拒绝 HTTP 图片 URL、假编码、损坏/截断 PNG、错误结果数或固定尺寸不符，状态保持 unknown。实际 SDK 明确 4xx（除 408/409）拒绝返回 failed/provider_rejected；408/409、5xx、连接错误、伪造 status、超时和未证实响应保持 unknown。

请求、配置、响应 JSON、来源与结果原始字节均沿用 credential echo 检查；原始 PNG 字节和完整解码后的像素都用 `assertCredentialFreeBytes` 同时扫描 UTF-8、UTF-16LE/BE 的两种字节对齐，拒绝辅助 metadata 块和 IDAT 压缩像素中的明文编码回显。独立压缩 metadata 按前述三类块限制拒绝，未实现任意 metadata 解压或 OCR，不把这项检查宣称为通用隐写识别。API Key 不进入 metadata/公开错误/指纹。Key 轮换不改变 fingerprint。端点 policy 禁止原站目的地和重定向；响应采用 identity 编码，有界流读取。取消只停止本地等待与接收迟到结果，不能保证远端计算或计费停止。忽略 signal 的 SDK、迟到 fetch、卡住的 body 均不会触发第二次 POST。

## 专项验证

```bash
node --test tests/generation-openai-relight.test.cjs
node --check server/generation-openai-relight.cjs
```

2026-10-05：12/12 专项测试通过。覆盖与 core 的 26 光位/10 个轮廓资格逐项相等；全部亮度/色温/轮廓开关与位置编译；真实安装 SDK multipart 原图字节、全部默认字段、auto 与单 POST；任意合法小源尺寸不被输出尺寸约束；结果按实际 PNG 测尺寸；明确配置、非法字段零派发；真实 PNG 完整性/结果数量/固定尺寸；明确拒绝和 unknown；凭据回显、响应边界、取消、迟到 SDK/fetch 与 body stall。追加真实有效 PNG 的 UTF-16LE/BE 辅助块回显回归，两种对齐均保证源零派发、结果 unknown 不重发，注入 SDK 的已知 Key 也参与扫描；三种压缩 metadata 块中的凭据及无凭据 metadata 均拒绝；IDAT 压缩像素中的凭据也在完整解码后拒绝。供应商执行 prompt 不包含参考产品品牌。未做真实供应商效果验收；前端、Agent、gateway/router/durable 与正式交互验收由其各自专属模块和测试负责。
