# 图片打光独立供应商契约核查 · 2026-10-05

**历史研究结论：四个专用打光端点不能原生承接完整原参数。后续已新增 [OpenAI参数提示词编辑](OPENAI-RELIGHT-NATIVE.md)，显式保留26光位和全部控件，不代表这些专用端点的缺口已消失或私有模型视觉等效。** 已读取四个真实公开打光 endpoint；它们均不接受现有标准光位、亮度百分比、Kelvin 色温及独立轮廓光这一组参数。本轮只新增此证据说明，不新增伪成功适配器、不修改已有请求、不替换成普通生图或猜测提示词。

这不是对全部供应商的穷尽判断，而是对下列已核实公开合同的结论。真正可实施的最小替代是新增**显式选择的公开打光模式**，同时切换到该模式实际支持的参数集合；不能让现有26光位、色温、轮廓光控件继续提交后被丢弃。

## 现有功能与原站语义

当前安装 TapNow 为 **0.4.81**。安装包的 `course-api-base-url-CGXqZmAy.js` 定义原站自有接口 `POST /api/chat/v1/beta/relight`，提交以下对象，等待响应 `code === 0 && data.fileUrl` 后回填结果。它不是一个已公开的独立 fal 原生 endpoint，也没有公开供应商模型身份或后台转换规则。

```js
{
  fileId: source,
  angle: { preset: 'front_0' },
  brightnessPercent: 50,
  temperatureK: 5600,
  rimEnabled: true,
  rimPreset: 'back_0'
}
```

wrapper 的缺省值是亮度50、色温5600、轮廓光false、轮廓光位back_0；已抓取原站面板自己的初始值是轮廓光true，不能将两者混同。当前本地 `image-relight-core.mjs` / `image-relight-ui.mjs` 与已抓前端保留以下用户语义：

| 用户控制 | 原站与本地请求语义 |
| --- | --- |
| 主光 | 26个标准光位；8方位×水平/上45°/下45°，另有顶部90°与底部-90°；提交 `angle.preset` |
| 亮度 | `brightnessPercent` 为10、50、100三档 |
| 色温 | `temperatureK` 为2000、3000、4000、5600、7000、8000六档 |
| 轮廓光 | `rimEnabled` 是独立开关，只在指定主光位有效；不能用一个“rim_light”整体风格代替 |
| 轮廓光位 | `rimPreset` 为 `back_0`、`top_back_45`、`low_back_45`，锁定背部三个位置 |

本地提交 `kind:'image.relight'`、空提示词、一张真实源图片 URL/内联字节和上述五项参数；Three.js只提供可操作预览。源图绑定、生成占位、失败清理和结果保护已经实现，但预览不证明供应商执行这些参数。

## 四个已核实的公开模型

模型身份先由[公开 fal 目录](https://fal.ai/explore/search?query=relight)或官方模型页确认，再读取对应 OpenAPI；下表没有使用猜测路径的404作为能力证据。所有读取是公开无凭据 GET，没有付费任务提交。

| 模型 | 真实输入合同 | 真实输出 | 与当前面板的缺口 |
| --- | --- | --- | --- |
| `fal-ai/iclight-v2` | 必须 `prompt`、`image_url`；`initial_latent` 只可为 None/Left/Right/Top/Bottom；另有采样、分辨率等参数 | `images[]` | 没有26光位、亮度%、Kelvin或独立轮廓光；`cfg`/guidance/denoise不是亮度；提示词也不能证明精确映射 |
| `fal-ai/image-apps-v2/relighting` | `image_url`、可选 `lighting_style` 和4K `aspect_ratio` | `images[]` | 18种整体风格，不支持方向角、亮度、Kelvin、独立轮廓光；默认比例也不能未经用户决定改变原画幅 |
| `bria/fibo-edit/relight` | 必须 `image_url`、`light_direction`、`light_type`；方向仅front/side/bottom/top-down，风格13项 | 主结果 `image`；另有 `images`、`vgl` | side不区分左/右，没有45°组合及背光；风格时间段不等于准确Kelvin；无亮度、独立轮廓光 |
| `fal-ai/lightx/relight` | 必须 `video_url`；条件模式ic/ref/hdr/bg；ic条件含prompt、Left/Right/Top/Bottom | `video` | 是video-to-video，不是图片打光；不能把图片转成假视频后宣称实现现有操作 |

image-apps-v2的18种风格为natural、studio、golden_hour、blue_hour、dramatic、soft、hard、backlight、side_light、front_light、rim_light、sunset、sunrise、neon、candlelight、moonlight、spotlight、ambient。`rim_light` 是一个整图风格枚举，没有主光和独立轮廓光位组合字段。

BRIA的13种风格为midday、blue hour light、low-angle sunlight、sunrise light、spotlight on subject、overcast light、soft overcast daylight lighting、cloud-filtered lighting、fog-diffused lighting、moonlight lighting、starlight nighttime、soft bokeh lighting、harsh studio lighting。其官方说明称“structured text inputs”，但真实schema只有上述三个输入字段；返回的 `vgl` 不证明这个专用 endpoint 接受任意自定义照明JSON。

即使原请求恰好选择50%、5600K、关闭轮廓光，也不能把这些值判定为“中性、无需发送”：供应商schema没有保证这些基准值。本轮没有据此开放一个偷偷忽略默认参数的子集。

## 最小可实施设计：显式 BRIA 风格模式

以下是**待实现方案**，不是当前可复制启用的服务配置。优先选择 `bria/fibo-edit/relight`，因为它有专用图片打光输入、明确方向与风格枚举、单个主图片输出，且无需由应用猜测prompt。实际画面质量和主体一致性仍需有权限的真实供应商验收。

1. 用户显式选择“BRIA Fibo 方向/风格打光”，与“标准光位打光”区分；选择时才切换参数集合。公开别名可命名为 `image.relight:fibo-style`，独立原生协议/模型映射由后续接线确定，不从现有 `image.relight` 请求隐式推断。
2. 该模式显示四个原生方向及13种原生风格。side只能标为“侧光”，不能伪装为左侧/右侧。隐藏26光位、亮度%、Kelvin、轮廓光控件，保留旧模式的编辑值；不自动把旧设置投影到新模式。
3. 请求只允许一源图与显式 `light_direction`、`light_type`，空额外prompt；服务端严格白名单。旧五项参数在新模式下仍出现时，于HTTP前拒绝，不能默默丢弃；未知字段、枚举、批量/额外参考图同样拒绝。
4. 按固定已验证 HTTPS queue origin发送一次POST；持久保存实际模型、原request ID及操作/模式。poll、恢复、取消均沿用原任务身份；unknown只查询原任务，不重新POST。未来应复用 `generation-fal-queue.cjs`，但必须核对SDK实际app根路径，不能仅凭自动生成OpenAPI的子路径拼接恢复URL。
5. 源媒体只能用供应商明确支持的传输方式。schema目前说明URL；内联data URI或上传机制需独立核实和实现，不能直接把私有 `asset:`/blob送出。结果只取主 `image`，其他数组不得被隐式追加成多个画布作品。
6. 下载真实结果字节，沿用媒体materializer/store完整性校验和本地归档；公开成功 `outputs` 仅含本地媒体地址。供应商URL存在、回执COMPLETED或固定测试图均不能单独证明生成成功。

未来交付必须覆盖：协议输入/输出、权限、错误、公开元数据和日志；精确别名/参数拒绝；源字节/公网URL边界；一次POST；原ID恢复；无效结果unknown；取消未确认停止；真实本机HTTP网关与归档回环；前端模式切换和无空占位验收。未具备这些证据前，不把本方案列为已接通功能。

## 可复核来源与身份

以下SHA-256针对本次GET返回的原始UTF-8 OpenAPI字节；只用于定位本次证据，供应商日后更新schema时须重新核对。

| 官方schema | 输入schema名 / 字节数 | SHA-256 |
| --- | --- | --- |
| [IC-Light v2](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/iclight-v2) | `IclightV2Input` / 8575 | `af0f4d2f689a41ab274fa0d82348a38144e8e3c5e3c608b1f75c0c4893cfbee4` |
| [Light-X Relight](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/lightx/relight) | `LightxRelightInput` / 7238 | `b500762dbb25703286710b7a42419b282f912ae8ab23a50e8ee8e09bf3163c67` |
| [Image Apps v2 Relighting](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-apps-v2/relighting) | `ImageAppsV2RelightingInput` / 5566 | `b2bed231d731d07e2661de3f43fe77dd090b2c5f5c20ad189712800ca11fd5c7` |
| [BRIA Fibo Relight](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bria/fibo-edit/relight) | `FiboEditRelightInput` / 5800 | `e73c0ec5008c34f0da5051a62850b58f387c9bb198653ea5a8726f6835a985bd` |

补充官方可读说明：[IC-Light v2](https://fal.ai/models/fal-ai/iclight-v2/llms.txt)、[Image Apps v2](https://fal.ai/models/fal-ai/image-apps-v2/relighting/llms.txt)、[BRIA Fibo](https://fal.ai/models/bria/fibo-edit/relight/llms.txt)。这些文件来自供应商当前模型元数据，未依赖广告名称推断参数覆盖。

原站/当前实现身份：

| 文件 | SHA-256 | 用途 |
| --- | --- | --- |
| `/Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js` | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` | 当前0.4.81自有接口和wrapper缺省值 |
| `reference/vendor-pkg-canvas-relight-CbCBWpQQ.js` | `27393bc157dc6524fc397f7a3fb5f2d0ce0b967f190a10cc45712bb22330cd47` | 已抓原站面板参数、资格和回填合同；保留原始文件，未改写 |
| `image-relight-core.mjs` | `836711054149d2ee2e16063d00c619e6a3f01fd4973554a11f95804195c85295` | 当前本地26光位、离散参数、请求转换 |
| `image-relight-ui.mjs` | `999980ab25a5e1520198558524101b0f274016926a170d949ca8383568d123e1` | 当前源图绑定与生成生命周期；后续编辑可能改变哈希 |

`reference/` 为被忽略的原站证据目录，不是本轮提交内容。其他产品只读入口（Beeble、Pixelcut）没有取得足够独立schema，不作为可接通合同或否定其产品能力的证据。

## 本轮验证与剩余边界

```sh
node --test tests/image-relight.test.cjs
```

当前既有核心测试 **7/7通过**：光位/分档、主光拖动吸附、轮廓光资格与三点吸附、轨道与数值拖动、原请求字段及自由角拒绝、坐标/移镜。此次只增加说明，没有新适配器、新依赖或假生成结果，因此没有新增实现测试。

没有读取真实Key/私密env，没有供应商POST、浏览器操作、真实生成质量或像素等效验收。现有 `tasks-v1` 若由操作者提供真实支持这组参数的网关，仍可按旧请求接入；填写普通fal Key不能自动使该自有接口工作。
