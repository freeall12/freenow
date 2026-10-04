# 图片转 360° 全景原生替代 · 2026-10-05

本项目新增显式选择的 **Hunyuan World Panorama** 图片转全景能力。供应商接口是 `fal-ai/hunyuan_world`，接收一张源图与提示词，返回一张全景图片。它与普通 2:1 图片生成、Marble 世界生成、`panorama.edit` 区域编辑分别处理；不能把画幅正确当作内容具有真实 360° 连续性的证明，也不能据此宣称与 TapNow 的模型或画面效果等同。

实现入口为 [`server/generation-panorama.cjs`](../server/generation-panorama.cjs)，导出 `createPanoramaProvider` 和 `parsePanoramaModelMap`；公开协议为 `fal-panorama-native`。路由器与单供应商网关已接入此协议。前端的 [`panorama-native.mjs`](../src/features/image-generation/panorama-native.mjs) 负责明确选择和配置门控，[`panorama-media.mjs`](../src/features/image-generation/panorama-media.mjs) 负责解析实际源素材、原尺寸 PNG 转换和过期源检查。

## 配置

以下是单功能示例。已有供应商或路由时，合并对应条目后重启服务，不要覆盖其他配置。`.env.example` 不会自动加载。

```sh
export GENERATION_PROVIDERS='{"panorama":{"protocol":"fal-panorama-native","apiKeyEnv":"FAL_KEY","modelMap":{"hunyuan-world-panorama":{"kind":"image.generate","model":"fal-ai/hunyuan_world"}}}}'
export GENERATION_ROUTES='{"image.generate":{"models":{"hunyuan-world-panorama":"panorama"}}}'
```

真实 `FAL_KEY` 由服务进程私有环境提供。只接受别名 `hunyuan-world-panorama`、操作 `image.generate`、模型 `fal-ai/hunyuan_world` 的精确映射；`fal-ai/hunyuan_world/image-to-world` 会使配置无效。默认且唯一允许的 queue origin 为 `https://queue.fal.run`。公开配置响应不包含 Key、模型 endpoint 或私人映射。

能力记录明确声明：`semantics:'explicit-native-alternative'`、`source:'image'`、`projection:'equirectangular'`、`fixedAspectRatio:'2:1'`、`nativeSize:true`、`editing:false`、`maxImages:1`、`maxCount:1`、输入/输出 MIME `image/png`、PNG profile `noninterlaced-8bit-rgb-rgba`。这里的投影声明来自专用模型语义和上游全景工具；本地尺寸与像素检查无法判定真实模型画面的接缝和球面一致性。

## 输入与不可丢弃的参数

最小本地请求如下：

```js
{
  kind: 'image.generate',
  prompt: '保持原房间，拓展为完整 360° 空间',
  inputs: [{type: 'image', url: 'data:image/png;base64,...'}],
  parameters: {
    modelId: 'hunyuan-world-panorama',
    isPanoramaPrompt: true,
    ratio: '2:1',
    count: 1
  }
}
```

- 必须完整绑定唯一源图片；`references` 只能省略或为空数组。提示词必须非空且不超过 32768 字符，原样发送，不添加原站 prompt 前缀。
- 服务端只接受可实际解码的内联 PNG，最多 20 MiB、32×1024×1024 像素、非交错 8-bit RGB/RGBA。公开源 URL、JPEG、WebP 必须先由 host 解码并转换为原尺寸 PNG。前端转换不缩图以满足预算；超限明确拒绝。
- 若输入附带宽高或 MIME，必须与实际 PNG 一致。裁切、mask、clip、projection、相机/区域输入以及其他未知字段在 POST 前拒绝。
- 必须明确开启 `isPanoramaPrompt:true`。提供画幅时只能是 `2:1`，提供数量时必须为 1。wire mode 若提供只能是 `image_to_image`，resultMode 若提供只能是 `variants`。
- 不支持 quality、imageSize、thinking、seed、camera、region、世界生成或全景区域编辑，不会静默丢弃这些参数。既有标签、源/目标节点、布局和批次元数据仅用于本地任务，不当作供应商 generation 字段发送。

供应商 POST body **只有** `{image_url: sourceInlinePNG, prompt: originalPrompt}`。没有额外上传 POST、指定输出尺寸或伪造种子。

## 执行、恢复与本地归档

| 项目 | 具体行为 |
| --- | --- |
| 目的 | 一张绑定图片转为一张专用全景模型结果 |
| 提交 | 一次 POST `https://queue.fal.run/fal-ai/hunyuan_world`；Key 只发往验证过的 queue origin |
| 原任务身份 | `pn1` 封装固定模型、固定别名及原 request ID；伪造身份或移除原映射时拒绝查询替代模型 |
| 查询 | GET 原任务 `/requests/{id}/status?logs=0`；完成后 GET 原任务 `/requests/{id}` |
| 未确认状态 | 保留原身份为 `unknown`，恢复仍查询原任务，不重发生成 POST |
| 取消 | PUT 原任务 `/requests/{id}/cancel`；取消回执保留 `unknown`，不宣称远端执行已停止 |
| 输出 | 只接收单个 `image`；DNS 固定的公网 HTTPS 下载，无供应商 Key；实际 PNG 最多 32 MiB且实际解码宽高必须为 2:1 |
| 归档 | 保留验证后的原 PNG 字节；durable materializer 归档，公开成功结果使用 `/api/generation/media/{resourceId}` 本地地址 |
| 日志 | 既有 durable 任务记录提交/恢复/归档状态和供应商身份；错误不回显供应商正文，测试只用合成数据 |

下载不信任声明尺寸。响应中提供的 MIME、宽高和 `file_size` 必须与实际 bytes 一致；缺失宽高时从解码像素测量，不调整图片或编造尺寸。不支持的输出保持 `unknown`，原任务仍可再次查询。

完整原始 queue JSON 在转换为简化回执前进行凭据检查，包含之后会丢弃的 metadata；最多 1 MiB、严格 UTF-8。请求对象、原始输入/输出 PNG、解码像素及 percent-encoded URL 同样检查真实进程 Key。复用 `generation-png-alpha.cjs` 的 CRC、完整 IDAT/zlib、精确行长度、PNG filter 和像素预算验证。压缩/独立文本编码 metadata `zTXt`、`iTXt`、`iCCP` 暂不支持，避免发布未检查的凭据内容。此边界可能拒绝供应商生成的合法但不受支持 PNG；不得把这种拒绝改成仅读图头成功。

## 协议依据与复刻边界

2026-10-05 无凭据读取官方资料，未执行真实生成或付费 POST：

| 来源 | SHA-256 | 证实内容 |
| --- | --- | --- |
| [fal queue OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/hunyuan_world) | `f5f6c094dde0bf0742da4479abd6a6d747431807b0081ccd47aa04e4826966b9` | `Hunyuan_worldInput` 仅有必填 `image_url`/`prompt`；`Hunyuan_worldOutput.image` 描述为生成的全景图片；官方 PNG 示例 1920×960；queue POST/GET/PUT |
| [模型 llms.txt](https://fal.ai/models/fal-ai/hunyuan_world/llms.txt) | `3c4d0109f08e35b0c2ed5b4b50ac3025f036790b9c0322fe1778d46d2145ebc2` | Hunyuan World 1.0 专用图片转全景；页面标价仅为宣传信息，未验证计费 |
| [腾讯上游 README](https://raw.githubusercontent.com/Tencent-Hunyuan/HunyuanWorld-1.0/main/README.md) | `44653ef2ea8d7787d28bb85bb9698f0675d9aecec7e52ceb6f3a4241b3aecc2d` | 全景作为 360° world proxy，图片转全景为独立阶段 |
| [上游 general_utils.py](https://raw.githubusercontent.com/Tencent-Hunyuan/HunyuanWorld-1.0/main/hy3dworld/utils/general_utils.py) | `d5b502863658cb38aee3476dbca36e2537657a01b5f2e0b281a251388e8d6608` | `spherical_uv_to_directions` 使用 `theta=(1-u)*2*pi`、`phi=v*pi` 等距柱状球面映射 |
| [上游 pano_depth_utils.py](https://raw.githubusercontent.com/Tencent-Hunyuan/HunyuanWorld-1.0/main/hy3dworld/utils/pano_depth_utils.py) | `de88a368c42f982fa367ca39b5d492b67eda634b266aea5b423ebf4c08aa62ae` | 深度全景流程调用上述球面 UV 工具 |

[fal 模型 API 说明](https://fal.ai/models/fal-ai/hunyuan_world/api) 明确支持 Base64 data URI。官方 schema 未提供区域编辑字段，因此本适配拒绝原站 `panorama.edit` 的 camera/quaternion/fov/regions/composite 参数。

原站证据保存在本机未发布的 `reference/image-panorama.md`。`canvas-current-readable.js`（SHA-256 `7db23cda5d02b1d41babc4d5adb3c13aea848aa864a37d52ccb6b17798e8eb3c`）证实：约 2:1 图片可进入全景预览；全景生成菜单携带 `isPanoramaPrompt:true`；原提交链添加专用 prompt 前缀；全景衍生 studio 保留 `sourceKind:'panorama'` 与 `pano_url`。这些前端 wrapper 不公开原站真实供应商 body。当前安装 TapNow 0.4.81 的 `index-BsHyQ2qj.js`（SHA-256 `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4`）也含 2:1 全景工厂选择。

`fal-ai/hunyuan_world/image-to-world` 返回 `world_file` 并要求 labels/classes，不适合这个图片输出能力。现有 Marble `world.generate` 可以附带 `pano_url`，但需要世界生成。当前 Marble `/marble/v1/pano:depth_to_rgb` 要求真实 depth panorama，也不等同普通图片转全景；其 `InpaintPanoPrompt` 输出 schema 不能证明现有世界生成路由支持区域编辑。

## 验证与尚未验收项

```sh
node --test tests/generation-panorama.test.cjs
node --test tests/generation-panorama.test.cjs tests/generation-fal-queue.test.cjs tests/generation-media-materializer.test.cjs tests/generation-openai-masked-edit.test.cjs
node --check server/generation-panorama.cjs
node --check tests/generation-panorama.test.cjs
```

全景专项 **16/16**、上述联合回归 **55/55** 通过。新增关键回归覆盖：CRC 正确但 zlib/解压行/filter 无效；未知 request/input 字段与 malformed references；被简化回执丢弃的 metadata 和 percent-encoded Key；PNG metadata 与解码像素中的 Key。

独立交审另执行 6 项针对性测试及独立 stdin stub 的 17 个案例，确认这些问题在提交前或结果发布前被拒绝，合法 PNG 仍保留原字节成功；未发现新增阻断。交审未重跑上述 55 项，也未执行真实供应商生成。

专项还使用真实本地 HTTP、durable service、media store、materializer 和媒体读取：一次 mock queue POST → `unknown` 多次查询 → 关闭/重启 → 原 ID 恢复 → 下载合成全景 PNG → 原字节归档 → HTTP 读回精确字节。测试不替代本地归档模块，但替代外部供应商和下载传输。POST 总计一次，公开输出只有本地媒体路径。

这些证据验证协议边界、真实像素解码、原任务恢复和本地归档。尚未验证真实账号可用性、实际输出 PNG profile、模型生成质量、接缝/球面一致性、TapNow 视觉效果等同；本文件也不将单元测试算作浏览器截图和交互验收。对应前端验收与 README 功能截图应由集成记录单独给出。
