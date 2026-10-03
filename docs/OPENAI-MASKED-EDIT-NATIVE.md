# OpenAI Images 原生蒙版编辑

`openai-masked-edit-native` 接通正式擦除、重绘（含一张参考图）和扩图工具的真实透明蒙版请求。使用现有 OpenAI SDK `images.edit`，上传独立 PNG mask，不退化为普通图生图，不改已有工具 UI、坐标或其他供应商协议。

## 官方契约与本地范围

2026-10-03 对官方页面执行无凭据 GET：

- [Image generation guide Markdown](https://developers.openai.com/api/docs/guides/image-generation.md)，HTTP 200。
- [Create image edit](https://developers.openai.com/api/reference/resources/images/methods/edit)，HTTP 200 HTML。该地址追加 `.md` 当前未返回有效文档，未使用其结果作证据。
- [官方 OpenAI Node SDK Images contract](https://raw.githubusercontent.com/openai/openai-node/master/src/resources/images.ts)，独立 reviewer 核实。

只启用 `gpt-image-2` 与 `gpt-image-2-2026-04-21`。当前 guide 首页主推 Image 2.5，但保留 GPT Image 2 的明确能力说明，当前 API / 已安装 SDK 均有 GPT Image 2 及其 snapshot。不会把前端的 `gpt-image-2` 悄悄换为 2.5、其他模型或 Responses API。

官方规定 mask 的透明 alpha=0 区域表示编辑范围；多图时 mask 作用于**第一张图**。官方同时指出 GPT Image 将 mask 作为指导，未承诺精确遵守每一条边界；因此本地保证 mask 坐标与请求语义正确，不宣称未选区域逐像素不变。GPT Image 模型可能要求供应商组织验证；本地配置就绪不证明账号资格或实际编辑质量。

guide 的 mask 章节写 image/mask 同格式同尺寸、文件小于 50 MB；当前 SDK multipart contract 对 mask 更保守，要求 PNG 小于 4 MB。本批采用 **派生 mask <4 MiB、输入图片 <50 MiB**，并保持相同原图像素尺寸。主图仅支持正式工具导出的非交错 8-bit RGBA PNG；参考允许现有 image-reference 校验支持的 PNG/JPEG/WebP，最多一张。

## 前端原语义与蒙版映射

现有请求均是主图放在 `inputs` 最后，主图 PNG 的 alpha=0 标示选区：

- `image-erase-ui.mjs` 的 `transparentImage()` 从真实 Fabric 绘制对象导出蒙版，将被选原图像素 alpha 清零，再导出 PNG。
- `image-redraw-ui.mjs` 在透明主图前放可选参考。`image-redraw-core.mjs` 的固定 prompt 明确说 “The last image is the main image” 和 “Image 1 is a reference”。
- `image-outpaint-ui.mjs` 用 `targetPixels()` 算原画布位置，在同尺寸透明画布的 `(x,y)` 放原图，提交 `canvas:{width,height,x,y}`；这已包含用户拖框的精确坐标。

原生适配从最后一张主图的真实 PNG 解码像素生成独立 RGBA PNG mask：原 alpha=0 → mask alpha=0；其他原 alpha → mask alpha=255，RGB 固定零。解码检查 CRC、IHDR、完整 chunks、PNG filters 0–4、有界 zlib、像素总数，拒绝损坏、交错/其他色深、APNG、全透明与全不透明“蒙版”。解析上限 33,554,432 像素（覆盖常见 4K 原图的默认扩框），不通过缩放绕过上限。

重绘有一张参考时，上传顺序改为 `[main, reference]`，mask 作用第一张主图。仅接受现前端真实固定 prompt 前缀，并在该前缀中改 last→first、Image 1 reference→Image 2 reference。`Redraw prompt:` 后的用户描述逐字保留，包含其换行和引用文字。未知图序提示词会在网络前拒绝，不能只重排图片却留下矛盾提示词。

无参考重绘、擦除、扩图不需要改 prompt。主图与 mask 均不裁切、不缩放、不重编码主图；扩图 `canvas` 尺寸必须匹配真实 PNG、坐标必须为有效整数。所有输入字节和原请求在准备/提交过程中保持原语义。

`src/features/image-editor/masked-edit-media.mjs` 仅在捕获的协议为 `openai-masked-edit-native` 时准备素材：保留主图 data PNG；复用现媒体 resolver / 有界 transport 将 asset/blob/独立公共参考转为真实内联字节；然后对每张内联图片进行浏览器实际解码、核验尺寸。每次 await 前后检查取消与源替换。禁止原站地址，不通过画布重采样。其他协议返回原 request 对象。

## 模型映射与路由

每个映射 entry.kind 为三个具体操作之一；同一公开 alias 可以经三个 provider 实例共用同一服务端 Key，保留现 router 的公开合同。

单操作示例：

```dotenv
GENERATION_API_PROTOCOL=openai-masked-edit-native
GENERATION_API_BASE_URL=https://api.openai.com/v1
GENERATION_API_KEY=<your-openai-key>
GENERATION_MODEL_MAP={"gpt-image-2":{"kind":"image.erase","model":"gpt-image-2","allowDynamicSize":true,"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4}}
```

三个操作的路由示例：

```dotenv
OPENAI_MASKED_EDIT_KEY=<your-openai-key>
GENERATION_PROVIDERS={"erase":{"protocol":"openai-masked-edit-native","apiKeyEnv":"OPENAI_MASKED_EDIT_KEY","baseUrl":"https://api.openai.com/v1","modelMap":{"gpt-image-2":{"kind":"image.erase","model":"gpt-image-2","allowDynamicSize":true,"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4}}},"redraw":{"protocol":"openai-masked-edit-native","apiKeyEnv":"OPENAI_MASKED_EDIT_KEY","baseUrl":"https://api.openai.com/v1","modelMap":{"gpt-image-2":{"kind":"image.redraw","model":"gpt-image-2","allowDynamicSize":true,"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4}}},"outpaint":{"protocol":"openai-masked-edit-native","apiKeyEnv":"OPENAI_MASKED_EDIT_KEY","baseUrl":"https://api.openai.com/v1","modelMap":{"gpt-image-2":{"kind":"image.outpaint","model":"gpt-image-2","allowDynamicSize":true,"qualityMap":{"low":"low","medium":"medium","high":"high"},"maxCount":4}}}}
GENERATION_ROUTES={"image.erase":{"models":{"gpt-image-2":"erase"}},"image.redraw":{"models":{"gpt-image-2":"redraw"}},"image.outpaint":{"models":{"gpt-image-2":"outpaint"}}}
```

只有 GPT Image 2 明确核实的动态尺寸被允许。`allowDynamicSize:true` 将前端 `targetWidth/targetHeight` **原样** 转为 `body.size=WxH`，不是把所有图形统一为方图：

- 两边均为 16 的倍数，且每边 ≤3840。
- 长边/短边 ≤3。
- 面积 655,360–8,294,400 像素。
- 官方将高于 2560×1440 的尺寸标为 experimental，本地不把此能力声明为供应商已实测稳定。

对受限兼容服务，可禁用动态尺寸并显式限制：

```json
{
  "gpt-image-2": {
    "kind": "image.erase",
    "model": "gpt-image-2",
    "allowDynamicSize": false,
    "sizeMap": {
      "1K|1024x1024": "1024x1024",
      "1K|1248x832": "1248x832",
      "2K|2048x2048": "2048x2048"
    },
    "qualityMap": {"low":"low","medium":"medium","high":"high"},
    "maxCount": 4
  }
}
```

尺寸映射必须保持同一个 WxH，不会把用户目标改为不同尺寸。质量映射明确同名 low/medium/high/auto；未配置请求质量会在网络前拒绝。生成次数默认上限 1，可明确设 1–4；匹配既有 UI x1–x4。

## 参数、响应与失败

允许参数为 model/modelId、aspectRatio=`auto`、imageSize=`1K/2K/4K`、quality、targetWidth、targetHeight、count/times，扩图另允许 canvas。model 与 modelId、所有 count 字段若并存必须一致。其他参数如 mask 字段、普通图生图模式、联网搜索、input_fidelity、裸 providerParameters、任意 vendor 字段均拒绝，不静默忽略。GPT Image 2 默认处理高保真输入，按官方文档省略 input_fidelity。

实际 SDK body：

```text
model, prompt, n, size, quality, output_format:'png', stream:false
image:[main.png, optional reference]
mask:同源像素尺寸的实际 mask.png
```

只调用一次 `sdk.images.edit`；从不调用 images.generate。SDK 与调用 options 都是 `maxRetries:0`。同步 API 无 remote poll/cancel/task ID，provider trace 不作为可恢复任务ID。

- response JSON 有界为 64 MiB，验证 MIME / encoding / Content-Length；完整 PNG b64 必须与实际结果 count、targetWidth/Height 一致。输出 PNG 支持非交错 8-bit RGB/RGBA，核验 CRC/chunks/deflate/filter；HTTP URL、假图片、错尺寸、截断结果均保持 unknown。
- 实际 SDK 400/401/403/404/422/429 等明确 4xx 拒绝返回 terminal failed；408/409、5xx、连接或未证实响应保持 unknown。供应商错误详情不回显；普通注入 client 的伪造 status 不当作明确拒绝。
- 请求、服务端配置、响应 JSON、原图与输出字节拒绝 Key 回显；注入 SDK 的已知 Key / 实际 Bearer 也参与保护。Key 不进入 metadata/公开报错/指纹；Key 轮换不改 fingerprint。
- 取消/超时/迟到 fetch/SDK 忽略 signal/body stall 不会触发第二次 POST。取消仅说明本地不再接受迟到结果，不能保证远端生成或计费已取消。
- 既有 durable/mediaStore 归档真实 PNG；相同幂等键恢复原回执，不重复生成。

## 验证和实际编辑器 QA

```bash
node --test tests/generation-openai-masked-edit.test.cjs
node --check server/generation-openai-masked-edit.cjs
node --check server/generation-png-alpha.cjs
node --check src/features/image-editor/masked-edit-media.mjs
node --check scripts/qa-openai-masked-edit.cjs
node --check src/features/image-editor/qa/native-masked-edit.mjs
```

2026-10-03：13/13 专项测试通过，包括全部 PNG filter 的真像素、CRC/解压边界、真实安装 SDK multipart/单 POST、现有 redraw core 固定 prompt 与一参考转换、矩形动态扩图和坐标、alias/规格/参数零派发拒绝、实际 PNG 结果核验、明确拒绝/unknown、超时取消、参考内联/真实解码入口/源替换 guard/禁止原站/其他协议不变。

独立 reviewer 负责另一个 gateway/router/durable 集成测试，主代理负责共享接线、env 和 CUA。未调用真实付费 OpenAI；专项模拟证明合同和真实媒体归档能力，不能证明真实模型效果或账号资格。

2026-10-03 主代理 CUA 已通过实际重绘编辑器的一参考生成：源图与独立 mask 均为 640×480，真正绘制的可编辑像素 32,320，bounds 为 `(224,153)–(383,354)`；SDK 上传顺序 `main.png/reference.png`，目标 `2352×1760`、count=1，固定图序前缀已修正且中文用户描述保留。结果实际添加到正式画布。此项来自隔离模拟上游，不证明真实供应商效果；擦除与扩图的浏览器验收由主代理继续。

隔离正式编辑器 QA：

```bash
node scripts/qa-openai-masked-edit.cjs
```

stdout 给出随机 loopback 页、audit URL 与临时存储目录。四份数据脚本使用 defaults 并起始空画布，新 browser origin 与 backend stores 隔离；固定本地合成 Key，CSP 仅 self/data/blob，其他业务 API 未配置，不连接原站或付费模型。

1. 点“创建本地测试图与参考图”，将真实本地 PNG 入正式 LocalAssets，并创建原图/参考节点。
2. 点“打开正式擦除工具”，在实际模型菜单选 GPT Image 2，真实画选区，点工具自己的“擦除”。检查结果与 audit 的实际 source/mask 像素尺寸、透明选区 bounds、单 POST。
3. 打开正式重绘工具，选 GPT Image 2、真实画选区、填用户描述、通过正式参考选择器选蓝色参考节点，再点工具自己的生成。audit 应为 `[main.png, reference.png]` 且固定 prompt 图序已修正，用户描述保留。
4. 打开正式扩图工具，选 GPT Image 2、拖框，再点真实“扩图”。audit 应保存放大后的原画布尺寸、独立同尺寸 mask、非方形目标尺寸。
5. 查看结果节点、刷新，验证本地归档图片仍能解码；服务端 audit 验证未自动重复 POST。

QA 面板没有提交 provider 的按钮；真正生成只能经过正式编辑器、透明 PNG 导出和现有 GenerationAPI。模拟上游解析真实 SDK multipart 后将 mask 透明选区填成绿色并返回真实 PNG，这只是便于验收的确定性图像，明确不代表 OpenAI 编辑质量。

Root 追加正式工具 CUA：擦除输出 PNG2352×1760、扩图透明源与 mask 均960×720/输出1168×880。三类 PNG 刷新后全部实际解码；三次操作上游共3次 POST，刷新未重新提交。本机刷新观察62条请求全部同源。完整证据见 [本批记录](LOCAL-MASKED-SOUND-AND-PERFORMANCE-20261003.md)。
