# World Labs Marble 原生接口

核验日期：2026-10-03。适配器：`server/generation-marble.cjs`，导出 `createMarbleProvider`、`parseMarbleModelMap`。这份说明描述独立适配器合同和后续接线方案，不能视为已上线的世界生成能力。

## 当前接线状态

2026-10-03 已直接检查 `server/generation-router.cjs` 和 `server/generation.cjs`：两处尚未导入或注册 `marble-native`，其协议白名单和 provider 工厂都没有 Marble。`generation-routing-config.cjs` 仅解析环境配置和解析 Key 引用，不会自动注册新协议。因此，下文环境变量示例目前只是未来配置示例；直接设置它们会被路由校验拒绝，不能启动生产可用的 Marble 生成链。

`server/generation-marble.cjs` 当前可独立构造并通过模拟 transport 验证合同。真实 SPZ/Spark 渲染涉及新增依赖，审批仍待回复，尚未完成接入及浏览器验收。现阶段交付是独立适配器准备；设置 Key、独立测试通过或收到 SPZ URL 都不能替代完整世界的可用验收。渲染就绪后，再完成后文的路由注册和端到端验证。

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

以下是路由注册和 SPZ 渲染完成后的未来配置示例，当前尚不可直接启用。届时可将其合并到既有 `GENERATION_PROVIDERS` / `GENERATION_ROUTES`；保留其他供应商配置，Plus 别名按上面的精确型号单独配置：

```dotenv
MARBLE_API_KEY=
GENERATION_PROVIDERS={"marble":{"protocol":"marble-native","apiKeyEnv":"MARBLE_API_KEY","modelMap":{"worldlabs-marble-1.1":{"kind":"world.generate","model":"marble-1.1","displayModel":"Marble 1.1","modes":["TEXT_TO_WORLD","IMAGE_TO_WORLD","PANORAMA_TO_WORLD","MULTI_IMAGE_TO_WORLD","VIDEO_TO_WORLD"]}}}}
GENERATION_ROUTES={"world.generate":{"models":{"worldlabs-marble-1.1":"marble"}}}
```

前端现有 `parameters.model` 使用模型别名，`provider:'worldlabs'`、`outputType:'world'`、`representation:'gaussianSplat'`。`modelType` 必须与实际输入一致。

| 模式 | 实际输入 | 官方请求 |
| --- | --- | --- |
| TEXT_TO_WORLD | 无媒体，非空提示词 | `world_prompt.type:'text'` |
| IMAGE_TO_WORLD | 1 张图片 | `type:'image'`，`is_pano:false` 或显式 `'auto'` |
| PANORAMA_TO_WORLD | 1 张图片，显式 `isPano:true` | `type:'image'`，`is_pano:true` |
| MULTI_IMAGE_TO_WORLD | 2–4 张；5–8 张须显式重建 | `type:'multi-image'` |
| VIDEO_TO_WORLD | 1 个已物化视频 | `type:'video'` |

拒绝音频、图片视频混用、多个视频、深度输入、网格/Chisel、扩展/编辑和未支持参数。官方 Marble 产品的编辑工具不等于本次 world-generation API 的已接能力。未物化 `clip` / `trim` 必须在浏览器媒体链先处理；`sourceRange` 可以保留来源，但不会代替真实裁切。

可选 `parameters.marbleParams`：

- `reconstruct_images`：仅多图模式接受 boolean；5–8 张必须明确 `true`，不会自动开启。
- `azimuths`：与多图逐一对应；元素为 null（不发送角度）或 `[0,360)` 有限数。
- `disable_recaption`：所有模式 boolean（包括最新 TextPrompt schema）；`true` 需要明确文字提示词。
- `display_name`：非空、最多 64 字符；`seed`：0–4294967295 整数。
- `splatResolution`：`500k`（本适配器默认）、`100k`、`150k`、`full_res`，仅控制所选返回资源，不传成官方生成参数。所选 LOD 缺失明确拒绝；不自动切换分辨率。

普通公开 HTTPS 直接成为 `source:'uri'`，服务端不拉取输入 URL。内联 PNG/JPEG/WebP 在本项目验证编码和像素结构，再上传原始字节；不隐式转码。项目本地图片预算 20 MiB，视频预算 40 MiB，完整 JSON 请求预算 64 MiB、提示词 32768 字符。视频官方 schema 上限是 100 MB，项目预算更小是现有传输约束，不是官方能力上限。本地视频校验仅覆盖 MIME、base64 和容器头，浏览器仍需确认可解码与实际裁切范围。

签名上传只用返回 `required_headers`，绝不附带 `WLT-Api-Key`。上传回执类型/扩展/方法不一致、危险头、局域网地址、凭据 URL、丢失 PUT 回执均阻止生成。响应体上限 1 MiB，网络超时 30 秒，禁止自动重定向。没有远端取消合同；本地取消/超时不能证明供应商停止生成或退款。

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

## 渲染就绪后的最小注册点

1. `server/generation-router.cjs`：导入 `createMarbleProvider`；provider 配置协议白名单增加 `marble-native`；原生工厂选择分支增加 `createMarbleProvider`。沿用现有 `rg1.` 路由身份、别名选路和 provider 指纹恢复规则。
2. `server/generation.cjs`：导入 `createMarbleProvider`；单供应商协议分支和 `invalidProtocol` 白名单增加 `marble-native`。多供应商仍走已有 `createGenerationRouter`，不能落到 tasks-v1。
3. `server/generation-routing-config.cjs` 现有通用字段已经能解析 `protocol`、`apiKeyEnv` 和 `modelMap`；不需要增加凭据字段或新的环境解析协议。接线后用显式 `world.generate` 模型别名路由启用 Marble，保留 Tripo 路由。
4. 验收链同时确认 durable 保留并校验 SPZ 世界元数据，UI/Agent/历史结果按 `format:'spz'` 与 `representation:'gaussianSplat'` 正确物化和预览；绝不能把它送进 GLB 加载器。

正式开放前应使用模拟供应商覆盖路由注册、缺 Key 零 dispatch、原操作重启恢复、明确型号/模式和 SPZ 元数据持久化，再对真实 SPZ 完成浏览器渲染与坐标验收。此清单是后续工作，不表示上述注册或真实联调已经完成。

## 聚焦验证

```bash
node --test tests/generation-marble.test.cjs
```

测试只使用本地模拟 transport，不调用真实模型。覆盖显式配置、五种输入、上传头与字节、4/8 图模式、原操作恢复、真实 SPZ 合同、拒绝网格代理、尺度缺失、身份不一致、丢失回执、取消、超时和响应预算。真实供应商资产的内容、浏览器 SPZ 解码/碰撞对齐、网络权限和费用仍需配置后单独验收。
