# fal 图片抠图与 Topaz 放大

`server/generation-fal.cjs` 导出 `createFalProvider({baseUrl,apiKey,modelMap,fetchImpl})`。无需增加 SDK 或依赖，网络请求由 `generation-fal-queue.cjs` 执行。真实调用需要使用操作者自己的 fal Key；本次仅验证官方 schema 与本地 mock 合同，尚未验收真实图像效果或实际收费。

## 配置

供应商与模型映射由服务端配置。不要将 Key 放入请求、画布、任务或前端存储。

```dotenv
GENERATION_PROVIDERS={"fal":{"protocol":"fal-native","baseUrl":"https://queue.fal.run","apiKeyEnv":"FAL_KEY","modelMapEnv":"FAL_MODEL_MAP"}}
GENERATION_ROUTES={"image.remove-background":"fal","image.upscale":{"models":{"image.upscale:topazlabs":"fal"}}}
FAL_MODEL_MAP={"image.remove-background":{"kind":"image.remove-background","model":"fal-ai/birefnet"},"image.upscale:topazlabs":{"kind":"image.upscale","model":"fal-ai/topaz/upscale/image"}}
```

在本地服务的环境中设置 `FAL_KEY` 后重启服务。`baseUrl` 省略或为空字符串时使用官方 `https://queue.fal.run`；非空值必须是同一官方 origin，不支持携带 Key 的代理地址。已有其他供应商时，将上述 `fal` 供应商和两条路由合并进现有 JSON。配置 Key 不代表允许试调用；只有用户实际提交图片操作才发起队列请求。

单供应商模式使用 `GENERATION_API_PROTOCOL=fal-native`、`GENERATION_API_BASE_URL=https://queue.fal.run`、`GENERATION_API_KEY` 和同结构 `GENERATION_MODEL_MAP`。所有模型条目都必须显式配置 `{kind,model}`，不根据界面名称猜接口。

显式 `parameters.providerParameters.model ?? modelId ?? model` 优先；无显式模型时，抠图使用 `image.remove-background`，带 `provider:'topazlabs'` 的放大使用 `image.upscale:topazlabs`。改路由不会把已接受任务发给另一供应商。

## 已核实映射

| 操作/风格 | 官方 endpoint / 输入 model |
| --- | --- |
| `image.remove-background` | `fal-ai/birefnet` |
| `image.upscale`、`general` | `fal-ai/topaz/upscale/image`、`Standard V2` |
| `low_resolution` | 同上、`Low Resolution V2` |
| `animation_3d` | 同上、`CGI` |
| `high_fidelity` | 同上、`High Fidelity V2` |
| `text_refine` | 同上、`Text Refine` |

Topaz 官方 `upscale_factor` 范围为 1–4。此界面的原生适配支持 2x/4x，6x 在派发前失败，不截断倍数、不自动串联收费请求。缺省风格与倍率对应界面缺省 `general`、2x。

Magnific 的 `sharpen`、`smartGrain`、`ultraDetail` 与 2–8x、皮肤 `detailed/standard/heavy` 尚未找到可忠实映射的已核实 fal 接口，不支持。未识别设置会失败，不静默忽略后发请求。

## 模型输入与输出

抠图请求发送：

```json
{"image_url":"实际源图片","output_format":"png","output_mask":false,"refine_foreground":true,"sync_mode":false}
```

BiRefNet 官方必填项为 `image_url`。还支持 `model`（默认 `General Use (Light)`，可选 `General Use (Heavy)`/`Portrait`）与 `operating_resolution`（默认 `1024x1024`，另有 `2048x2048`）；当前界面没有这两个选项，适配采用官方默认。输出 `{image:{url,content_type?,file_name?,file_size?,width?,height?},mask_image?}`；适配仅使用实际透明图片，不将 mask 当成作品。编辑器 `parameters.width/height` 是画布元数据，不用它裁切或改变源图。

Topaz 请求发送：

```json
{"image_url":"实际源图片","model":"Standard V2","upscale_factor":2,"output_format":"png","crop_to_fill":false}
```

Topaz 官方必填项仅为 `image_url`。放大接口还公开面部增强、锐化、去噪、压缩修复和部分生成型号专属选项；当前 UI 未配置这些设置，采用官方默认。官方默认 `face_enhancement:true`、`face_enhancement_strength:0.8`、`subject_detection:'All'`，因此真实图像效果需实测。PNG 是为了避免对作品额外施加 JPEG 压缩。

Topaz 官方输出 `{image:{url,content_type?,file_name?,file_size?}}`，schema 不承诺宽高。适配只保留响应实际提供的合法 `width/height`，不以源尺寸乘倍率伪造。统一成功回执：

```js
{
  id: 'fl1.<opaque identity>',
  status: 'succeeded',
  outputs: [{type:'image',url:'实际文件 URL',mimeType:'image/png',
    sourceFileId:'实际 fal request_id',width:/* 仅实际返回时 */,height:/* 同左 */}]
}
```

## 素材与文件边界

每任务仅一张绑定在 `inputs` 的图片。支持有效内联 PNG/JPEG/WebP，或无凭据公网 HTTPS。拒绝 blob、私有资产标识、本机地址、无效 Base64、SVG 和多图。宿主负责在来源守卫下把本地图片转为内联字节；适配不会读取任意远程资源。

官方模型 API 说明支持 Base64 data URI 或公开可访问 URL，并提示大 Base64 会影响请求性能。当前官方两份 OpenAPI 未标明硬性字节/像素上限，不能把本机预算当作 fal 保证。此实现完整请求最多 64 MiB，单张解码图片小于 50 MiB；Base64 膨胀后实际可提交的字节更少。复用的本机校验要求图片宽高 1–65535，该边界也不是模型效果保证。

本适配不进行 fal Storage 上传。官方 `fal.storage.upload(file)` 返回可用于 `image_url` 的公开地址；以后增加上传必须明确新增网络动作及存储生命周期。fal 输出 URL 受账户媒体过期策略影响，宿主现有结果应用流程会下载并存入本地资产。Topaz/抠图网络返回文件 URL 不等于真实视觉验收完成。

## 队列与恢复合同

| 方法 | 行为 |
| --- | --- |
| `prepare(request)` | 检查配置、单图、模型与设置，不发请求 |
| `submit(request,{signal})` | 仅一次 `POST https://queue.fal.run/<完整 model endpoint>`；认证 `Authorization: Key <key>` |
| `poll(id,{signal})` | `GET /<owner/app>/requests/<request_id>/status?logs=0`；完成后 `GET /<owner/app>/requests/<request_id>` |
| `cancel(id,{signal})` | `PUT /<owner/app>/requests/<request_id>/cancel`；仅返回 `unknown`，不声称远端停止 |
| `generate` | 提交一次，记录接受身份并轮询；默认 1500ms 间隔、600s 总等待，最长 1800s |

例如 Topaz 提交完整路径 `/fal-ai/topaz/upscale/image`，状态、结果、取消使用 app 根路径 `/fal-ai/topaz/requests/<id>`。供应商返回的 convenience URLs 不用于带 Key 请求，避免把凭据发给另一个 origin。

官方状态 `IN_QUEUE`→`queued`、`IN_PROGRESS`→`running`。`COMPLETED` 仅表示请求结束；存在 `error/error_type` 时失败，必须取得合法真实输出才成功。提交回执可能省略 `status`，合法 `request_id` 且无 error 时表示接受排队。

身份含实际 model endpoint、request ID 与操作 kind；路由外层另外绑定供应商配置指纹。重启后只 GET 原任务。POST 回执丢失时没有可安全重建的任务 ID，保持 `unknown`，禁止自动重发。Key 轮换不改变配置身份；模型配置改变则停止恢复。

fal 取消返回 202 `CANCELLATION_REQUESTED`、400 `ALREADY_COMPLETED` 或 404 `NOT_FOUND`。202 也不保证正在执行的请求停止；本地取消阻止迟到应用，远端取消状态保持未确认。fal 自身队列有服务端 runner 重试，这与本机禁止重复 POST 的合同不同。

每次队列读取最长 30s、取消最长 5s、JSON 响应最多 1 MiB。超时或网络失败保持不确定状态，不转供应商，不回显上游私密内容。进度没有官方百分比，因此不从队列位置伪造进度。

## 证据与验证

官方资料于 2026-10-03 只读获取，未提供 Key、未调用收费 endpoint：

- [Topaz image upscale API / OpenAPI schema](https://fal.ai/models/fal-ai/topaz/upscale/image/api)
- [BiRefNet API / OpenAPI schema](https://fal.ai/models/fal-ai/birefnet/api)
- [队列状态、结果与取消](https://docs.fal.ai/model-apis/model-endpoints/queue)
- [官方 JS queue API](https://fal.ai/docs/api-reference/client-libraries/javascript/queue)

`fal-ai/magnific/upscale/api` 的官方页面返回 Next.js 404，无 schema；这只证明该候选路径不可用，不证明 fal 全站没有其他 Magnific 产品。未将名称相近的任意 upscaler 当成原 UI 参数等价实现。

```bash
node --test tests/generation-fal.test.cjs tests/generation-fal-queue.test.cjs
node --check server/generation-fal.cjs
```

专项验证使用隔离 mock，覆盖实际风格映射、6x/未知参数零派发、单图字节校验、任务身份恢复、原 endpoint 路径、不捏造尺寸、未知结果不重发、取消不冒充停止。真实 alpha 边缘、文字保真、面部变化、倍率和供应商容量限制需配置 Key 后使用实际作品验收。

宿主集成已完成：`generation-ui.js` 在具体操作配置检查后调用 `src/features/image-editor/task-media.mjs`。增强与抠图 UI 只传来源引用；统一准备阶段负责解析 `fullImage`、读取本地资产、限制完整请求大小、响应取消并重新检查来源。未配置的操作不提前读取图片，6x 在媒体解析前给出明确错误。抠图占位也按该操作的配置就绪状态创建。

2026-10-03 本批仅执行受影响链路检查：队列 10 项、原生映射 11 项、媒体准备 4 项、增强 6 项、抠图 9 项、现有配置前端 10 项、网关接线与重启恢复 2 项通过；未重复跑全量套件。独立交叉检查了队列与适配器接线。

浏览器复现：

```sh
node scripts/build-fal-native-fixture.cjs
# 打开 /qa/fal-native-app.html?session=独立标识
```

夹具使用隔离 localStorage/IndexedDB、本地合成 PNG，以及明确标记的固定源图回传；禁止外部生成调用。实际 Computer Use 观察：6x 失败时 `mediaReads=0, posts=0`；切回4x并选择文字优化后，参数为 `text_refine/4`、内联原图、任务成功并应用，菜单选中后收起并恢复焦点。最终入口的2x与抠图均成功应用，`posts=2, mediaReads=2, nodes=3`。截图 `/tmp/freenow-fal-tools-20261003.png` 为本机证据，不提交公共仓库。这验证传输、参数和结果落图，不代表 AI 超分或抠图效果。
