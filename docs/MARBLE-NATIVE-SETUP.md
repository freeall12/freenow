# World Labs Marble 原生接口

核验日期：2026-10-03。适配器：`server/generation-marble.cjs`，导出 `createMarbleProvider`、`parseMarbleModelMap`。这份说明描述已接线的 API 生成、原任务恢复与 SPZ 输出合同，以及尚待实现的渲染边界。真实供应商调用尚未验收。

## 当前接线状态

2026-10-03 已直接检查 `server/generation-router.cjs` 和 `server/generation.cjs`：两处已导入 `createMarbleProvider`，协议白名单和原生工厂均注册 `marble-native`。既有 `generation-routing-config.cjs` 解析服务端环境配置与 Key 引用，无须新增凭据字段。下文配置可用于这条后端链；没有 Key、没有映射或别名未路由时，明确返回未配置并保持零上传、零生成请求。

原生适配器、路由和持久媒体服务可分别验证生成、原操作查询与 SPZ 原始资源保存；公共结果使用本机 `/api/generation/media/{id}`，资源所有权和完整性由持久媒体服务验证。原始资源保留 SPZ 格式及世界元数据，碰撞网格仅作为辅助资源。真实 SPZ/Spark 渲染涉及新增依赖，审批仍待回复，尚未完成接入及浏览器验收；本轮没有安装或再次申请依赖。后端配置就绪、资源保存成功均不表示已经能在世界节点预览、进入片场或拍摄高斯场景。

## 官方来源

- [OpenAPI 原文](https://docs.worldlabs.ai/api/reference/openapi.yaml)：请求、模型枚举、上传、操作及资源字段。
- [模型映射](https://docs.worldlabs.ai/api/models)：`marble-1.1` / `marble-1.1-plus` / `marble-1.0` / `marble-1.0-draft`。拒绝弃用别名和未配置模型。
- [生成世界](https://docs.worldlabs.ai/api/reference/worlds/generate)：`POST /marble/v1/worlds:generate`，返回操作身份；`world_prompt` 支持 text、image、multi-image、video。
- [素材上传](https://docs.worldlabs.ai/api/reference/media-assets/prepare-upload)：`POST /marble/v1/media-assets:prepare_upload` 返回 `media_asset` 和 `upload_info`，按回执 PUT 原始字节，然后引用 `media_asset_id`。
- [查询原操作](https://docs.worldlabs.ai/api/reference/operations/get)：`GET /marble/v1/operations/{operation_id}`，`done=true` 且无 `error` 时，`response` 是 World。
- [查询原世界](https://docs.worldlabs.ai/api/reference/worlds/get)：操作完成快照缺少型号等字段时，GET 该原 World，严格核对最新合同。
- [生成示例](https://docs.worldlabs.ai/api/world-generation-examples)：单图、全景、多图和公开 URL 输入。
- [第三方 SPZ 渲染坐标](https://docs.worldlabs.ai/api/rendering-spz)：尺度、地面偏移及 `marble_raw_opencv` 坐标。

仅通过公开官方文档核验，没有真实 Key、付费调用或真实模型验收。文档有三处差异：模型说明页仍提到旧默认模型，而最新 OpenAPI 默认为 `marble-1.1`；Quickstart 视频格式推荐 MP4/MOV/MKV，而 VideoPrompt schema 推荐 MP4/WebM/MOV/AVI；Quickstart 完成快照示例使用旧 `id`，且明确提示 `model` 等字段可能为空，而最新 schema 使用 `world_id`。适配器始终发送显式模型，本地视频支持 schema 中四种格式，拒绝 MKV MIME；快照不完整时只读查询原 World，再按最新 schema 核对，不猜测字段。

## 配置和能力边界

构造参数 `baseUrl` 留空使用 `https://api.worldlabs.ai/marble/v1`；仅允许这一官方 HTTPS 基址。服务端 `apiKey` 通过 `WLT-Api-Key` 发送，不进入客户端元数据或指纹。没有 Key 或没有模型映射时，不上传、不生成。

```js
const {createMarbleProvider} = require('./server/generation-marble.cjs');
const provider = createMarbleProvider({
  apiKey: process.env.GENERATION_API_KEY,
  modelMap: {
    'worldlabs-marble-1.1': {
      kind: 'world.generate',
      model: 'marble-1.1',
      displayModel: 'Marble 1.1',
      modes: ['TEXT_TO_WORLD', 'IMAGE_TO_WORLD', 'PANORAMA_TO_WORLD',
        'MULTI_IMAGE_TO_WORLD', 'VIDEO_TO_WORLD'],
    },
    'worldlabs-marble-1.1-plus': {
      kind: 'world.generate',
      model: 'marble-1.1-plus',
      displayModel: 'Marble 1.1 Plus',
      modes: ['TEXT_TO_WORLD', 'IMAGE_TO_WORLD', 'PANORAMA_TO_WORLD',
        'MULTI_IMAGE_TO_WORLD', 'VIDEO_TO_WORLD'],
    },
  },
});
```

每个别名的型号、真实显示标签和允许模式必须明确配置。`protocol` 为 `marble-native`，仅提供 `world.generate`，一次生成一个世界。`prepare` 为纯验证；只有 `submit` 才上传和生成。配置指纹包含协议、基址和映射，排除 Key，允许 Key 轮换；模式和型号变化阻止原身份恢复。

以下是已注册后端的路由配置示例。将其合并到既有 `GENERATION_PROVIDERS` / `GENERATION_ROUTES`，保留其他供应商配置；Plus 别名按上面的精确型号单独配置。生成与保存原始资源可使用此配置，SPZ 预览仍按前述边界处理：

```dotenv
MARBLE_API_KEY=
GENERATION_PROVIDERS={"marble":{"protocol":"marble-native","apiKeyEnv":"MARBLE_API_KEY","modelMap":{"worldlabs-marble-1.1":{"kind":"world.generate","model":"marble-1.1","displayModel":"Marble 1.1","modes":["TEXT_TO_WORLD","IMAGE_TO_WORLD","PANORAMA_TO_WORLD","MULTI_IMAGE_TO_WORLD","VIDEO_TO_WORLD"]}}}}
GENERATION_ROUTES={"world.generate":{"models":{"worldlabs-marble-1.1":"marble"}}}
```

单供应商模式可设置 `GENERATION_API_PROTOCOL=marble-native`、`GENERATION_API_KEY` 与同结构的 `GENERATION_MODEL_MAP`，基础地址留空使用官方默认值。Key 只从服务端环境解析，不放进浏览器配置或 `GENERATION_PROVIDERS` 的内联字段。

公开 `capabilities.worldGeneration[alias]` 按实际配置模式给出上限：仅文字模式的参考能力为 false、图片和视频预算均为 0；单图模式上限 1 张，多图模式上限 8 张且普通非重建上限 4 张，视频模式上限 1 个视频。MIME 与字节预算也只对已配置媒体模式公开。`capabilities.output` 明确为 `{type:'model',format:'spz',representation:'gaussianSplat',coordinateSystem:'marble_raw_opencv'}`；此字段描述输出格式，不宣称渲染器就绪。`textReferences:false` 表示文字写入提示词，不能伪装为独立媒体参考输入。

前端现有 `parameters.model` 使用模型别名，`provider:'worldlabs'`、`outputType:'world'`、`representation:'gaussianSplat'`。`modelType` 必须与实际输入一致。

| 模式 | 实际输入 | 官方请求 |
| --- | --- | --- |
| TEXT_TO_WORLD | 无媒体，非空提示词 | `world_prompt.type:'text'` |
| IMAGE_TO_WORLD | 1 张图片 | `type:'image'`，`is_pano:false` 或显式 `'auto'` |
| PANORAMA_TO_WORLD | 1 张图片，显式 `isPano:true` | `type:'image'`，`is_pano:true` |
| MULTI_IMAGE_TO_WORLD | 2–4 张；5–8 张须显式重建 | `type:'multi-image'` |
| VIDEO_TO_WORLD | 1 个已物化视频 | `type:'video'` |

拒绝音频、图片视频混用、多个视频、深度输入、网格/Chisel、扩展/编辑和未支持参数。官方 Marble 产品的编辑工具不等于本次 world-generation API 的已接能力。未物化 `clip` / `trim` 必须在浏览器媒体链先处理；视频的可选 `sourceRange` 必须仅有有限数值 `start/end` 且满足 `0 <= start < end`，只保留已物化素材的原片来源，不发送成供应商裁切参数。

可选 `parameters.marbleParams`：

- `reconstruct_images`：仅多图模式接受 boolean；5–8 张必须明确 `true`，不会自动开启。
- `azimuths`：与多图逐一对应；元素为 null（不发送角度）或 `[0,360)` 有限数。
- `disable_recaption`：所有模式 boolean（包括最新 TextPrompt schema）；`true` 需要明确文字提示词。
- `display_name`：非空、最多 64 字符；`seed`：0–4294967295 整数。
- `splatResolution`：`500k`（本适配器默认）、`100k`、`150k`、`full_res`，仅控制所选返回资源，不传成官方生成参数。所选 LOD 缺失明确拒绝；不自动切换分辨率。

普通公开 HTTPS 直接成为 `source:'uri'`，服务端不拉取输入 URL。内联 PNG/JPEG/WebP 在本项目验证编码和像素结构，再上传原始字节；不隐式转码。项目本地图片预算 20 MiB，视频预算 40 MiB，完整 JSON 请求预算 64 MiB、提示词 32768 字符。视频官方 schema 上限是 100 MB，项目预算更小是现有传输约束，不是官方能力上限。本地视频校验仅覆盖 MIME、base64 和容器头，浏览器仍需确认可解码与实际裁切范围。

签名上传只用经校验的 `required_headers`，绝不附带 `WLT-Api-Key`。该对象最多 24 个不同的头名称、名称最多 80 字符、名称和值合计最多 16 KiB；拒绝重复大小写身份、危险控制头、控制字符和服务 API Key 回显。合法存储签名参数与所需 `x-goog-*` / `x-amz-*` 头不因此被屏蔽。上传回执类型/扩展/方法不一致、局域网地址、凭据 URL、丢失 PUT 回执均阻止生成。输入/输出 URL 复用持久媒体下载的静态公网地址校验，并要求 HTTPS；输入 URI 不会被服务端额外拉取。响应体上限 1 MiB，网络超时 30 秒，禁止自动重定向。没有远端取消合同；本地取消/超时不能证明供应商停止生成或退款。

## 恢复与输出合同

`submit` 返回 `mb1.` 编码身份，保存公开型号、输入模式、所选 SPZ LOD 和原始 `operation_id`。恢复只 GET 原操作，绝不重放上传或 `worlds:generate`。若完成快照缺少 `model` 或当前 `world_id`，先核对 `response.world_id`、旧 `response.id` 和 `metadata.world_id`（所有已有值必须一致），再 GET 原 `worlds/{world_id}`，要求返回当前 schema 的直接 World 对象、原身份和精确型号。查询失败或仍缺型号保持未确认；不能包装成成功。丢失提交回执返回 `unknown`；错误文字统一脱敏。官方示例的进度是 `{status,description}`，没有保证数值百分比，所以处理中返回 `status:'running'` 并省略百分比。

完成输出沿用项目 3D 通用 `type:'model'`，通过 `format:'spz'`、`representation:'gaussianSplat'` 和 `world` 区分完整世界。示意结构如下；URL 与数值只使用真实回执：

```js
{
  type: 'model',
  url: '<selected SPZ HTTPS URL>',
  format: 'spz',
  representation: 'gaussianSplat',
  sourceFileId: '<world_id>',
  poster: '<optional assets.thumbnail_url>',
  world: {
    worldId: '<world_id>',
    model: 'marble-1.1',
    marbleUrl: '<world_marble_url>',
    coordinateSystem: 'marble_raw_opencv',
    splatResolution: '500k',
    assets: {
      splats: {
        spzUrls: {'500k': '<url>', '100k': '<url>', full_res: '<url>'},
        semanticsMetadata: {metricScaleFactor: '<positive finite number>',
          groundPlaneOffset: '<finite number>'},
      },
      mesh: {colliderMeshUrl: '<optional URL>', fullResMeshUrl: '<optional URL>',
        hqMeshUrl: '<optional URL>'},
      imagery: {panoUrl: '<optional URL>'},
    },
  },
}
```

`spzUrls` 保留官方已返回的 100k/150k/500k/full_res 子集，所选 LOD 必须存在。`model`、操作身份、World 身份和 `metadata.world_id` 必须一致。新流水线尺度字段必须存在且有效；不会替缺失尺度猜测 1/0。明显的 GLB/GLTF/PLY/OBJ SPZ 地址会被拒绝。碰撞网格、全分辨率网格、HQ 纹理网格和全景都是可选辅助资源；网格不会成为世界主输出。

渲染建议：先把 Gaussian 中心和线性大小乘 `metricScaleFactor`，再仅对中心 Y 减 `groundPlaneOffset`；若解码器输出 log scale，增加 `log(metricScaleFactor)`。随后按渲染器约定转换轴；Marble Web Viewer 对生成 SPZ 使用绕 X 轴 180° 旋转。网格不是 SPZ 的尺寸字段，不能盲目套用同一变换；应按官方导出合同核验碰撞对齐。完整输出必须经 durable 持久化保留 `format`、`representation`、`world`，浏览器按表示类型选择渲染器。

## 已接线位置与剩余渲染工作

1. `server/generation-router.cjs`：已导入 `createMarbleProvider`，配置协议白名单与原生工厂已注册 `marble-native`。沿用现有 `rg1.` 路由身份、别名选路和 provider 指纹恢复规则。
2. `server/generation.cjs`：已导入 `createMarbleProvider`，单供应商协议分支和 `invalidProtocol` 白名单已注册 `marble-native`。多供应商仍走已有 `createGenerationRouter`，不会落到 tasks-v1。
3. `server/generation-routing-config.cjs` 现有通用字段已经能解析 `protocol`、`apiKeyEnv` 和 `modelMap`；不需要增加凭据字段或新的环境解析协议。接线后用显式 `world.generate` 模型别名路由启用 Marble，保留 Tripo 路由。
4. `generation-durable.cjs` 与持久媒体链保留并校验 SPZ 世界元数据、本机资源引用和任务所有权。UI/Agent/历史结果应按 `format:'spz'` 与 `representation:'gaussianSplat'` 处理；真实高斯预览、片场与拍摄仍待 Spark 接入，不能送进 GLB 加载器。

后端验收使用模拟供应商覆盖路由注册、缺 Key 零 dispatch、原操作重启恢复、明确型号/模式和 SPZ 元数据持久化。真实供应商生成以及真实 SPZ 的浏览器渲染、坐标与碰撞对齐验收仍需分别完成，不能以模拟 transport 或仅有资源 URL 替代。

## 聚焦验证

```bash
node --test tests/generation-marble.test.cjs tests/generation-marble-contract.test.cjs tests/generation-marble-integration.test.cjs
```

测试只使用本地模拟 transport，不调用真实模型。覆盖显式配置、准确模式能力、五种输入、上传头与字节、4/8 图模式、有限视频 provenance、原操作恢复、SPZ 输出合同、拒绝网格代理、尺度缺失、身份不一致、丢失回执、取消、超时和响应预算。集成用例连接实际 gateway/router/durable、下载器、物化器与本机资源存储，使用本地合成 SPZ/GLB/PNG 证明资源保存与原身份恢复合同，未经过 Spark 渲染。无后缀签名资源按 SPZ 合同保留，不凭 URL 扩展推断内容。真实供应商资产的内容、浏览器 SPZ 解码/碰撞对齐、网络权限和费用仍需配置后单独验收。
