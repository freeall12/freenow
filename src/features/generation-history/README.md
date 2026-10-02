# 生成历史的媒体来源恢复

历史侧栏沿用 `reference/generation-history-20261002.md` 捕获的官方筛选、真实日期、预览及批量应用语义；共享预览的模型、日期、提示词来自该结果的保存记录，见 `reference/media-preview.md`。

- 图片归档和原输出恢复优先读取 `fullImage`，再读取 `image` / `url`，与共享媒体来源解析一致。下载及再次插入使用已归档的全尺寸媒体，不用缩略图替代原图。
- 供应商明确返回的 `output.model` 优先于请求的 `parameters.model/modelId`；持久化允许保留该字符串，刷新后重试归档仍使用原输出。请求参数继续保存原值。
- 预览和重新应用图片 / 视频时，把任务 ID、请求类型、原提示词、实际模型绑定到转成 data URL 的媒体，并恢复真实创建日期。修改下一次生成设置不能改变该媒体的来源。媒体地址替换后，旧来源不再提供模型。
- `video.analyze` 与包含 `sourceRange` 的裁片保存为分析来源，预览省略生成模型；描述模型不能显示为视频生成模型。历史不会为旧导入媒体或空项目补造任务。
- 创建时间仍保存为 UTC ISO 并按实际时间倒序；侧栏日期分组按浏览器本地日历日，和共享预览的本地日期一致。类型与文本筛选不变，没有增加日期过滤或改写原收据。
- Marble 原世界输出保留严格、有界的 `worldId/model/marbleUrl/assets/coordinateSystem/splatResolution`。所选 SPZ 地址必须与 LOD 项一致，身份必须与 `sourceFileId` 一致，语义数值必须有效；未知键、缺失来源或格式矛盾直接拒绝。签名资源查询原样保存，便于刷新后重试原输出。
- 成功归档仍依赖实际 world materializer。历史完整传递它保存的 `worldPatch/worldResource.world`，校验格式与原元数据；SPZ MIME 为 `application/octet-stream`，GLB 为 `model/gltf-binary`。下载后缀优先实际 `worldResource.format`，其次原 `row.format`，只允许 `spz/glb`；不按通用 Blob MIME 把 SPZ 改名成 GLB，也不改变下载字节。
- `world.assets` 中其余远程 LOD、mesh 与 pano 元数据仍是原地址；仅所选、实际本地化的 `worldResource.url` 可称本地素材。没有渲染器时保持归档失败并允许原结果重试，不声明 SPZ 可渲染或全部 LOD 已离线。

聚焦回归：

```sh
node --test tests/generation-history.test.cjs tests/media-preview.test.cjs
node --test tests/generation-history-world.test.cjs
```

可重复的隔离浏览器入口：

```sh
node scripts/build-generation-history-fixture.cjs
# 打开 /qa/generation-history-app.html?session=<独立会话名>
```

`qa-controls.mjs` 只允许该精确路由与匹配的 Canvas / LocalAssets namespace。它用 Canvas 绘制真实 1200×800 PNG 与 300×200 缩图，直接走历史收据与归档接口，明确标注未调用模型；不会连接供应商或创建伪造的模型任务。重复点击保留该项目既有记录，刷新继续使用相同 session；不清空存储。

`generation-ui.js` 可能在解析后续 `local-assets.js` 前动态加载历史。默认素材服务尚未存在且文档仍在解析时，`install()` 等待 `DOMContentLoaded` 后才捕获服务，避免整个项目持有 undefined；素材脚本加载失败则明确报错并允许重试安装。已经留下的失败历史保留原任务与原媒体，使用“重试原图片归档”或侧栏“重试归档”恢复，不重新提交模型。

点击“保存合成高清历史”后刷新，用“读取持久历史与节点来源”确认持久化。打开左侧历史预览，再应用到画布，检查 1200×800、`QA 返回模型标记`、原提示词及真实日期。点击“修改已插入节点的下次参数”后再次双击预览，检查器中的 `sourceBound` 应为 true，`previewModel/previewPrompt/previewCreatedAt` 应保持原记录。下载落盘和真实供应商调用需要独立证据，本模块的 Node 回归不代替它们。分析视频省略模型的回归由现有 `video.analyze` 测试覆盖。

普通生成占位回填和显式任务恢复也保留独立 `image` 缩图与 `fullImage` 原图，防止覆盖全尺寸来源；相关回归：

```sh
node --test tests/generation-results-workflow.test.cjs tests/generation-recovery-integration.test.cjs
```


## 本机生成资源合同（2026-10-03）

新服务端公开结果的媒体引用仅为 `/api/generation/media/<UUIDv4>`。`generation-api.js` 的主来源与可读取别名、原图、封面、sourceUrl 和嵌套世界资源采用精确路径校验；任意 relative/file、query/hash、尾斜线或非 v4 ID不会因此得到支持。现有 `data:` / `asset:` 用户素材继续工作。

历史 `model.mjs` 保存独立 `image/fullImage`、类型别名、`mime/sourceUrl/sourceRange`，Marble 各LOD、mesh、pano、本体尺度和坐标元数据均保留。`world.marbleUrl` 仍为 HTTPS 信息链接，不下载成媒体。`archive.mjs` 读取本机ref再写入已有本地素材库；GLB `resource.materialize` 仍真实解码并生成封面，SPZ仍明确提示渲染器未接入，字节本地化不代表可预览。

实际入口包括 `TaskService.consume/recover/validateResult`，`generation-results/workflow.apply` 与 `recovery.importRecoveredOutputs`，历史 `outputSnapshot/archive/node/blob/thumbnail`，以及世界 `materialize/preview/download`、全景 `panoramaStage`。生成应用与恢复的赋值流程本身支持同源路径，无需转换为供应商地址。任务进度、成功和恢复仅透传公开的 `providerStatus` 与 `localization:{state,revision,errorCode,retryable}`，素材保存失败保留 unknown 与原任务恢复原因，不产生第二次生成请求。

旧远程迁移尚未完成：保留历史源记录，不删除或假装已归档。已确认的 TapNow/tamaredge运行域在这些媒体读取入口先提示需要迁移，不自动下载；其他合法供应商远程来源保留既有读取能力，尚需后续迁移。旧合法地址重定向到 TapNow、画布中已有远程img/video、旧模型内嵌资源和其他旧素材入口仍需统一迁移审计，本轮没有借全局CSP封锁来声明整个应用已隔离。


独立浏览器验收 fixture：运行 `node tests/fixtures/generation-local-media-server.cjs --port 4174`，打开 `http://127.0.0.1:4174/qa/generation-local-media.html`。默认先显示素材保存失败，再点击“只取回原任务”经 GET 本地保存、真实解码图片；两项 POST 计数均应为 1。刷新保留原任务标识。页面不调用真实供应商，不需要真实 Key；只有固定的非秘密配置哨兵用于满足现有 tasks-v1 配置门，实际 provider transport 全在内存执行。`--success` 可启动直接成功模式，新一轮验收使用不同端口避免旧浏览器任务记录串入。服务仅绑定127.0.0.1，任务与媒体保存在新建临时私有目录，静态服务仅开放专属页面和所需前端模块。默认失败闸门要由显式GET解除，避免自动轮询跳过失败画面；这是验收注入，不是生产恢复协议。


fixture 默认使用脚本内置的 96 × 64 QA 合成棋盘格 PNG，克隆仓库后不需要私有示例素材。可通过 `--source /absolute/path/to/local.png` 显式选择本机 PNG；来源文件只读取，不导入或提交。页面显示素材来源且始终标注非模型结果。2026-10-03 已运行的相机图片验收使用显式选定的本机 `assets/696b1da59de7a308.png` 字节作为 fixture source；截图证明媒体本地保存与实际解码，不证明 AI 生成。此素材不作为默认依赖，也不随本次提交导入。
