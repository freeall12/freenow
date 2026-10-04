# 原生 SPZ / Spark 本地集成计划

首次研究：2026-10-03；本机安装包、npm 发布物与当前接线复核：2026-10-05。当前只更新此方案，未安装依赖、修改生产代码、操作浏览器或提交 Git。目标是用 World Labs 的成熟高斯渲染器直接解码并渲染 SPZ，保留原始高斯数据与来源。

## 结论与最小依赖审批

建议新增并精确固定一个生产依赖 `@sparkjsdev/spark@2.3.1`；npm 元数据声明其传递依赖为 `fflate@^0.8.2`。保留本项目现有 `three@0.186.0` 和 esbuild，不增加另一套 Three、Rust、独立解码器或自写高斯渲染器。

批准后执行 `pnpm add @sparkjsdev/spark@2.3.1 --save-exact`，核对 lockfile 的实际变更与单一 Three 实例。新包审批包含传递的 fflate；此命令尚未执行。

2026-10-05 重新读取 npm registry 与 `2.3.1` tarball，确认 `latest` 仍为 `2.3.1`，许可证 MIT，版权声明 `Copyright © 2025 WORLD LABS TECHNOLOGIES, INC.`，peer dependency 为 `three >=0.180.0`，本项目满足。README 明确支持 WebGL2、SPZ、多个高斯对象、网格混合渲染及多个视点。包发布与源码覆盖已核验；本机 GPU、Three 0.186 上的实际渲染尚未验证。

审批内容是新增上述生产库及其声明的传递依赖，不包括框架升级、服务器静态目录放宽或修改供应商路由。依据项目 AGENTS.md 的“添加新生产依赖先询问”要求，获批之前保持现有能力声明和 SPZ 生成前阻止行为；复制整份库到 assets 也属于引入生产库，不能以 vendor 文件绕过审批。

## 2026-10-05 本机官方安装包证据

来源为 `/Applications/TapNow.app/Contents/Resources/web/assets/`，仅静态读取以下文件；未读取凭据、执行厂商 JS 或调用原站 API。

| 本机文件 | 字节数 | SHA256 / 核验用途 |
| --- | ---: | --- |
| `spark.module-LMeSeoEa.js` | 5,061,903 | `16a7050d64cbe6fb2dd0dfa603f415a642f704e55de3b6d1a370ded0b6d9b3b9`；真实 SparkRenderer、SplatMesh、SPZ 解码、排序与内嵌 Worker/WASM |
| `ThreeDWorkspace-BzPphAqB.js` | 919,292 | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`；世界加载与片场运行链 |
| `ThreeDAssetPreview-BujuUe53.js` | 14,719 | `1c0527b6eaf566c908d8425f0429aaf96be88342da1a6d4548f7b057afb13b91`；物品/世界预览的真实格式分派 |
| `index-BsHyQ2qj.js` | 12,943,515 | Spark 唯一静态导入的应用共享 chunk，混合应用上下文及 Three，不能当 standalone Spark 发布物 |

世界和物品预览均按需创建 `SparkRenderer({renderer, enableLod: true})`。真实资源支持 `source_format: 'spz'` 和 `lod_assets`，优先 `100k`，存在 `full_res` 时加载后切换；世界加载有会话过期释放逻辑。`WorkspaceViewfinderButton-BHqIWibq.js` 动态导入该 Spark 文件及 `reveal-D_nF_v2l.js`，标记 `worldRenderableKind = 'gaussian-splat'`，同一 render graph 处理视口与摄影输出。reveal 是入场效果，不是 SPZ 解码的必要依赖。

本机 Spark 的两种内嵌 WASM base64 指纹与此前捕获一致：长度/哈希前16位为 `2067684 / 4aca2923a73f742f`、`217712 / e2b2120bc19f34ec`。指纹不能单独证明安装包的精确 npm 版本；本机未暴露依赖锁文件。

直接复制本机 Spark chunk 无法独立运行：开头通过约50个别名导入应用 index 的 Three 类型和工具，index 中 Three revision 为 `182`，项目为 `186`；Spark 包含 Camera 等 `instanceof` 检查，携带另一套 Three 会产生实例身份风险。人工抽离并重写别名虽然可行，但缺少独立发布边界与可重复构建，不作为集成路线。当前项目 package/lock/assets 中没有已接入的 Spark，也没有发现 `.spz` 样本。

## 原站捕获证据

- 当前捕获发布：`eb1c3578957450302e3cff5edd2ad253d0874421`，来源映射在 `reference/studio-v2-official-resources.json`。
- 世界模块：`reference/vendor-pkg-canvas-world-C-xhsVwu.js`，可读版本 `reference/world-current-readable.js`。
- 预览模块：`reference/vendor-pkg-canvas-three-d-preview-Bq5Gj4na.js` / `reference/world-preview-current-readable.js`。
- 世界模块按需导入 `vendor-spark-BB3I0rki.js`，取出 `SparkRenderer`、`SplatMesh`，并另载原站 reveal 效果模块。
- `new SparkRenderer({renderer, enableLod: true})` 加入 Three scene；`new SplatMesh({url})` 后等待 `initialized`。记录 `userData.worldRenderableKind = 'gaussian-splat'`，用专门高斯路径处理资源、尺度、边界与生命周期。
- 原站资源支持 `source_format: 'spz'` 与 `lod_assets` 的 `100k` / `full_res`。优先显示预览，另加载全分辨率，成功后切换；过期 load session 释放迟到结果。
- 原站 render graph 接收 `spark`；拍摄与主视口走相同渲染图。不要直接把异步排序尚未完成的第一帧当缩略图或拍摄完成。
- 全景是单独路径，高斯物品与高斯世界均存在；不应仅按 `outputType === 'world'` 判断格式。

2026-10-03 的参考捕获目录未保存 Spark 实体，当时从捕获模块明确引用的官方 CDN 地址读取并与 npm 发布物比较（仅静态分析，未执行厂商 JS）。以下保留历史证据；2026-10-05 未再次请求这些原站地址，当前本机实体见上一节：

| 官方地址 | 字节数 | SHA256 |
| --- | ---: | --- |
| [当前 vendor-spark-BB3I0rki.js](https://fe-assets.tapnow.media/eb1c3578957450302e3cff5edd2ad253d0874421/assets/vendor-spark-BB3I0rki.js) | 5,061,816 | `e948486136322dfabda95adbdbf716d91c5154f344c304f39f13e56e8372bd91` |
| [早期 vendor-spark-7-2NVTg0.js](https://fe-assets.tapnow.media/955f12545825932389f4e873a824a9c5dcd3fbd0/assets/vendor-spark-7-2NVTg0.js) | 5,061,816 | `d0133b74c5360f36e343f7a805002238467659de52160373d11f49d3574c4af6` |

代码指纹匹配 Spark **2.1.0**：92 个导出名称完全相同；两段内嵌 WASM base64 指纹为 `(217712, e2b2120bc19f34ec)` 与 `(2067684, 4aca2923a73f742f)`（长度与 SHA256 前16位），和 npm 2.0.0 / 2.1.0 相同，与 0.1.10、2.2.0、2.3.0、2.3.1 不同。进一步，捕获 shader 使用 2.1.0 修复后的 `uvec4 packedData` / `evaluateExtSH1(uvec4 packedData,...)`，没有 2.0.0 自带的 fullscreen triangle 实现。两份原站 chunk 的主要差别为 Three chunk 引用。

原站没有暴露其 package.json 或锁文件版本字段，因此严谨说法是“捕获代码与 Spark 2.1.0 匹配”，不能声称读到了原站精确依赖锁定信息。推荐 2.3.1 基于当前官方版本和 Three peer 兼容性，须做本地真实 SPZ 验证后接入。

## 官方包与离线资源

核验来源：

- [npm 元数据](https://registry.npmjs.org/@sparkjsdev%2fspark)
- [2.3.1 发布 tarball](https://registry.npmjs.org/@sparkjsdev/spark/-/spark-2.3.1.tgz)
- [官方源码仓库](https://github.com/sparkjsdev/spark)
- [官方文档与示例](https://sparkjs.dev/)

直接检查 tarball 的 `package.json`、`LICENSE`、`README.md`、`dist/spark.module.js` 及 `dist/types/*.d.ts`，得到：

1. ESM 出口为 `dist/spark.module.js`，另有 `spark.module.min.js`。2026-10-05 tarball 复核：ESM 为 2,816,188 字节、SHA256 `2de375d5e489692f976abe3199c8435ecc00f97fabaf35e489eb7d368e1f6f60`；min 为 2,671,267 字节。不能把整个 16.4 MB npm 解包体积当浏览器下载量。
2. ESM 将 fflate 打入自身；外部 import 仅为 `three` 及 `three/addons/postprocessing/Pass.js`。现有 importmap 已支持这两种路径。
3. Rust 解码/排序 WASM 以 base64 ArrayBuffer 内嵌，`WebAssembly.compile(...)` 在本地编译。Worker 源码以字符串内嵌，使用 Blob URL 创建 Worker，并有 data URL 回退。
4. 发布包没有运行所需的独立 `.wasm` 或 Worker `.js` 文件，只有 Worker sourcemap；无需额外下载远端 WASM、Rust 构建或 CDN worker。ESM 源码未发现 `https://`。
5. 运行要求：WebGL2、WebAssembly、Worker、Blob URL。当前正式入口已有CSP，允许本地模块、`worker-src 'self' blob:`及现有WASM编译所需策略；各QA页面另有自己的meta CSP。接入时须逐入口验证真实WASM编译与Worker加载，不能仅依据主入口配置宣称兼容。
6. 当前服务器静态路径策略拒绝除 `node_modules/three/` 以外的node_modules静态访问，因此直接映射 `/node_modules/@sparkjsdev/spark/dist/spark.module.js` 会被拦截。最小接法是用现有 esbuild 建独立 ESM `assets/spark.js`，保持 `three` 和 `three/addons/*` external，再在importmap映射 `@sparkjsdev/spark -> /assets/spark.js`；保留许可证/关联 legal comments。这样不需扩大服务器静态目录权限，也不用复制原站打包副本。另一方案是构建时复制官方self-contained ESM到assets并保存MIT许可证，仍需可重复构建脚本。
7. SPZ 原始字节、预览、可选 LOD 均要放入现有 LocalAssets / IndexedDB；不把短期 blob URL 存入文档。断网验收应验证所有代码、解码及输入数据都来自本地。

批准后添加 `scripts/build-spark.cjs` 和 `build:spark` 脚本：从官方 ESM 构建 `assets/spark.js`，格式 `esm`，external 为 `three`、`three/addons/*`；保留 MIT LICENSE 和打包 legal comments。`index.html` 的现有 importmap 保持 Three 路径，再增加 `@sparkjsdev/spark: /assets/spark.js`。生产适配模块用动态 import 首次加载 Spark，避免普通画布进入时下载/编译 WASM。相关 QA 页面采用同一映射。依赖图、构建产物与运行网络记录都应确认没有第二套 Three、远端脚本或隐藏 WASM 请求。

公开 API：`SplatMesh({fileBytes, fileType: SplatFileType.SPZ, fileName})`、`mesh.initialized`、`mesh.getBoundingBox()`、`mesh.dispose()`；`SparkRenderer({renderer, onDirty, enableLod})`、`spark.update({scene,camera})`、`spark.dispose()`。`onDirty` 特别用于异步排序/LOD 完成后的重新绘制，须合并到现有 dirty / invalidate 调度，不在回调中递归直接渲染。

压缩 SPZ 的解码已由 Spark 原生 loader/Rust 实现承担；无需转 PLY/GLB。包支持 SPZ 不等于任意损坏数据、任意 SPZ 修订或超大解压结果都安全。具体文件应由官方解码器验证；压缩字节上限与解码后的 splat/GPU预算需分别控制。

## 最小接线清单

| 位置 | 现状 | 必要变更 |
| --- | --- | --- |
| `world-node/resource.mjs` 的 `importFile/materialize/localize` | `.glb` 文件过滤，`assertWorldRendererSupport` 拒绝 SPZ | 按真实 `glb/spz` 分派；保留 SPZ原始Blob、本地引用、格式、字节数与缩略图，调用Spark解码预览；沿用source guard、timeout和迟到dispose |
| `world-node/materialization.mjs` | 有界读取，但 MIME/错误文字固定GLB与12MiB | 读取合同接受真实格式/MIME/独立预算；不能用GLB改名掩盖SPZ |
| `world-node/resource.mjs` 的 `stage/preview/renderPhoto` | Box3遍历几何，loadSaved为GLTF | SPZ用`getBoundingBox()`并应用对象世界变换，不能依赖普通几何Box3；同renderer挂Spark；接onDirty，拍摄先等待所需高斯更新，再输出实际图像 |
| `world-node/entry.mjs` 上传与进入片场 | 文件过滤`.glb`；片场只传`studioV2.asset` | 接受`.spz`；进入片场传明确格式和持久高斯引用，避免将SPZ交给GLTFLoader |
| `agent-generation/world.mjs` / generation结果与历史 | readWorld报告GLB-only，高斯false | 完成实际链路后再更新能力；材料回填、历史下载与恢复保留spz，不提前声明已支持 |
| `studio-v2/runtime.mjs.initialize/add`、`scene-import.mjs` | loadSaved / inspectModel /来源校验均GLB | 分派资源；沿用会话、revision、来源签名与本地asset限制；高斯对象标记和来源可审计 |
| `studio-v2/runtime.mjs` 主绘制 | 只camera变化或dirty时绘制 | Spark onDirty设dirty；高斯显式dispose；确保scene内renderer绑定匹配当前上下文 |
| `runtime.mjs.flush/snapshot/undo`、`playback.mjs` | GLB保存，toJSON/ObjectLoader撤销，SkeletonUtils clone文档 | 高斯对象只序列化本地源引用、稳定ID、父级、变换、可见性/来源，恢复时由Spark重建；阻止普通ObjectLoader/clone/GLTFExporter复制高斯GPU内部对象 |
| `shot-renderer.mjs`、`scene-capture.mjs`、运镜导出 | 镜头有独立WebGLRenderer | 每个渲染上下文配置对应Spark；等待排序完成才能拍摄/写视频帧；dispose镜头Spark，不共享一个绑定主renderer的Spark |
| `display-materials.mjs`、拾取、SelectionBox、focus与光照范围 | 只遍历isMesh与几何边界 | 跳过高斯渲染器内部mesh；用高斯边界/真实raycast；不把高斯套白模/PBR材质或宣称网格光照作用等价 |

推荐文档布局保持 `studioV2.asset` 为真正网格GLB，新增高斯资源 sidecar（例如 `splatAssets`），保存原始 SPZ asset 引用与对象结构。原始高斯与可编辑摄像机/网格共同恢复。纯高斯片场不能因“没有网格”而被保存为空。混合场景的 GLB 导出必须明确包含范围，不能悄悄丢高斯并声称完整导出。

Worker池与decoder的生命周期需按官方API核对：mesh.dispose / spark.dispose是必需的，但全局workerPool可能复用空闲worker，不应每关一个预览就未经检查终止共享池。异步排序在预览关闭后不得再触发宿主更新。取消无法中断的已启动解码时，用已有materializationScope释放迟到mesh。

## 分阶段文件改动与交付门槛

以下为批准依赖后的实现范围，不代表已经修改；新增模块名是建议。复用现有 GLB 加载器、LocalAssets、materializationScope、revision/session/source guard，不改供应商路由、原生音频或服务器权限。

| 阶段 | 文件范围 | 通过条件 |
| --- | --- | --- |
| A：本地成熟渲染器 | `package.json`、`pnpm-lock.yaml`；新增 `scripts/build-spark.cjs`、`assets/spark.js`、许可证文件及 `src/features/world-node/splat-io.mjs`；`index.html`/相关 QA importmap | 确认只用一套 Three；官方解码真实 SPZ，等待 initialized、检查实际 splat 数与边界；加载失败/取消/迟到对象全部释放；代码、WASM、Worker 都本地运行 |
| B：3D 节点与历史 | `world-node/resource.mjs`、`materialization.mjs`、`entry.mjs`；`generation-history/archive.mjs` 及必要合同/测试；新增 splat stage 适配模块 | 本地 SPZ→实际视口→旋转/移动→PNG→刷新后原字节和来源恢复；保留 SPZ MIME/后缀、World Labs 身份/尺度/LOD；坏文件或不支持设备不创建成功封面 |
| C：可编辑片场文档 | `studio-v2/runtime.mjs`、`scene-import.mjs`、`playback.mjs`、`save-recovery.mjs`、`model-io.mjs`、`scene-export.mjs`；新增高斯文档/生命周期适配模块 | 纯高斯和混合场景均能进入片场、变换、保存刷新、撤销/重做及放弃编辑恢复；GLB 网格路径不回归；不把 SplatMesh GPU 数据交给 ObjectLoader、SkeletonUtils 或 GLTFExporter |
| D：摄影与交互完整性 | `studio-v2/shot-renderer.mjs`、`scene-capture.mjs`、`video-export.mjs`、`display-materials.mjs`、`scene-picker.mjs`、`centered-transform.mjs` 的必要适配；节点拍摄路径 | 镜头预览、照片、运动视频都呈现真实高斯；每个 renderer 对应自己的 Spark；修复高斯边界/focus/拾取；白模/PBR切换不污染高斯内部材质；取消/关窗不遗留 GPU 对象 |
| E：能力声明与离线验收 | `world-node/render-capabilities.mjs`、`agent-generation/world.mjs`、必要 generation/history 合同与回归测试、专门 QA 夹具 | 上述端到端通过后才开放 SPZ readiness 和生成；断网重开、下载及拍摄无远端代码/素材请求；缺失 LOD 明确显示本地状态，不声明全部 LOD 离线 |

C 阶段的后向兼容文档建议：`studioV2.asset` 继续只指真正 GLB；增加 `splatAssets` 数组，每项只保存稳定对象 ID、父级 ID、本地 SPZ asset 引用、原格式、变换、可见性、来源与可用的本地 LOD。精确字段和校验须在实现前落实，并同步 save-recovery、snapshot、导入与导出逻辑。现有 IndexedDB Blob store 可复用，不预设数据库 schema 迁移。仅含高斯的片场也需要保存有效文档；不能把高斯移出 JSON 后导致对象丢失。混合场景下载 GLB 的范围必须明确，原 SPZ 源文件独立下载，不能称为完整高斯场景 GLB。

D 阶段不能只在当前同步 `shot.render()` 之前等待一次 initialized：镜头姿态改变会重新排序，需在输出帧前确保该视角准备完成。现有 `video-export.mjs` 是 RAF + MediaRecorder 实时捕获；异步高斯等待必须与录制时序一致，不能简单在循环里加 await 后仍声称30fps、无掉帧。先以短真实运镜检查首/中/末帧及时间，再决定是否需要局部调整帧调度，沿用现有编码器。

## 性能预算与规模

已确认的当前限制与建议集成预算分开记录。以下源码规模不是本机测量结果，也不是任意 full_res 都能显示的承诺。

| 层次 | 已确认现状 | 集成预算/控制 |
| --- | --- | --- |
| 原始字节 | GLB 前端12MiB；服务端 SPZ 下载及 generation media store 单项上限256MiB；SPZ gzip 展开上限1GiB | GLB保持原限；SPZ单独有界读取，不用 response.blob() 无界读取；本地存储限额须检查/捕获 quota error，下载可保存原字节不等于允许全部解码 |
| 首次展示 | 官方预览优先100k，存在时继续加载full_res | 优先本地100k；没有预览时显示实际加载状态，不伪造截图；切换时持有预览直到完整结果就绪，并释放被替换对象；不能同时无限加载多个大世界 |
| 桌面LOD目标 | 本机官方 Spark 默认2,500,000 splats；iOS1,500,000、Android1,000,000、Oculus500,000、VisionPro750,000 | 使用成熟LOD，按设备/GPU验证渲染目标；目标是可见选择预算，不是压缩数据/总解码容量上限；不得将低LOD截图当全分辨率交付 |
| Paged容量 | 本机官方默认桌面16,777,216，iOS6,291,456，其他移动8,388,608 splats | 这是pager容量，不是默认同时绘制数量；初版不照搬最大分配，配置需结合完整包2.3.1与本机测量验证 |
| 显存/堆 | packed 基础数组16B/splat，按2048宽纹理容量向上取整；SH、排序、WASM、上传、LOD和多上下文还会额外占用 | 同时控制压缩字节、NGSP头的总splat数/SH阶数、展开容量、实际解码数与渲染目标；解码前应有有界header检查，不能等分配完成再以GPU失败判断预算 |
| 画布/帧调度 | 普通3D节点只画封面；预览按需绘制，片场dirty/camera变化时绘制 | 延续懒加载；Spark onDirty 合并invalidate；关闭预览后停回调；拍摄可以临时使用第二上下文，输出完成即dispose；闲置不得持续重绘/重新排序 |

基础数组估算：100k≈1.53MiB、500k≈7.63MiB、250万≈38.15MiB、1000万≈152.59MiB，均未计容量填充和上述附加数据。SPZ高压缩比不能证明低内存占用。应先测100k、500k、250万，以及接近文件预算的坏/超限文件；记录冷/热首个可用帧、解码/排序耗时、平移/旋转帧时间p50/p95、可用的堆/GPU指标、连续开关预览与拍摄后的资源回落。2.3.1实际内存布局与本机可接受总splat上限尚待测，不能把上述静态估算作为内存峰值。

建议验收目标（尚未测得）：100k本地数据冷首次可用帧≤5秒；1280×720、DPR1的交互帧时间p95≤33.3ms；连续5轮打开/关闭/拍摄后没有累计未释放的 mesh/renderer 回调和资源；4096px节点照片和1280px片场照片记录各自真实输出与失败反馈。若目标不达标，优先调整LOD、调度和并发生命周期，保留原始SPZ与用户选择；不能通过只输出截图或改称“已完成”掩盖限制。

## 验证边界与下一步

2026-10-05 对本机安装包、npm registry/tarball、现有接线点做了静态复核，并执行：

```bash
node --test tests/world-renderer-preflight.test.cjs tests/generation-marble-contract.test.cjs tests/world-materialization.test.cjs
```

25/25通过，验证的是当前GLB链、取消/资源释放合同及SPZ尚未支持时的正确阻止。此结果不证明SPZ渲染。未运行GPU、浏览器、依赖安装或全套测试；项目未发现真实SPZ样本。仍未验证2.3.1 + Three0.186、本机WebGL2/Worker/WASM、真实高斯视觉、长运镜、4096px拍摄、实际内存/帧率、离线重开或全部LOD本地化。

批准依赖后先完成A/B并获取可许可使用的真实SPZ测试数据（小型官方示例或用户本地文件，记录来源/许可证/字节哈希，不调用原站API），再逐阶段验证C/D/E。最小完整验收：真实SPZ本地导入→有内容渲染→旋转/移动→PNG真实画面→进入片场→相机拍摄/运镜→保存刷新/撤销恢复；另验证坏文件、预算、取消、迟到dispose、GLB无回归，以及断网时无代码/worker/wasm远程请求。任何一次首帧、空白截图、改名GLB或普通网格替代都不能作为高斯渲染完成证据。
