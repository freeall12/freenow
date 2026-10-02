# 原生 SPZ / Spark 本地集成计划

核验日期：2026-10-03。此文为只读研究结果；本轮未安装依赖、修改生产代码、操作浏览器或提交 Git。目标是用 World Labs 的成熟高斯渲染器直接解码并渲染 SPZ，保留原始高斯数据与来源。

## 结论与最小依赖审批

建议新增并精确固定一个生产依赖 `@sparkjsdev/spark@2.3.1`；npm 元数据声明其传递依赖为 `fflate@^0.8.2`。保留本项目现有 `three@0.186.0` 和 esbuild，不增加另一套 Three、Rust、独立解码器或自写高斯渲染器。

批准后执行 `pnpm add @sparkjsdev/spark@2.3.1 --save-exact`，核对 lockfile 的实际变更与单一 Three 实例。新包审批包含传递的 fflate；此命令尚未执行。

`2.3.1` 是此次查询 npm `latest` 得到的版本，许可证 MIT，版权所有者 WORLD LABS TECHNOLOGIES, INC.。peer dependency 为 `three >=0.180.0`，本项目满足。README 明确支持 WebGL2、SPZ、多个高斯对象、网格混合渲染及多个视点。包发布与源码覆盖已核验；本机 GPU、Three 0.186 上的实际渲染尚未验证。

## 原站捕获证据

- 当前捕获发布：`eb1c3578957450302e3cff5edd2ad253d0874421`，来源映射在 `reference/studio-v2-official-resources.json`。
- 世界模块：`reference/vendor-pkg-canvas-world-C-xhsVwu.js`，可读版本 `reference/world-current-readable.js`。
- 预览模块：`reference/vendor-pkg-canvas-three-d-preview-Bq5Gj4na.js` / `reference/world-preview-current-readable.js`。
- 世界模块按需导入 `vendor-spark-BB3I0rki.js`，取出 `SparkRenderer`、`SplatMesh`，并另载原站 reveal 效果模块。
- `new SparkRenderer({renderer, enableLod: true})` 加入 Three scene；`new SplatMesh({url})` 后等待 `initialized`。记录 `userData.worldRenderableKind = 'gaussian-splat'`，用专门高斯路径处理资源、尺度、边界与生命周期。
- 原站资源支持 `source_format: 'spz'` 与 `lod_assets` 的 `100k` / `full_res`。优先显示预览，另加载全分辨率，成功后切换；过期 load session 释放迟到结果。
- 原站 render graph 接收 `spark`；拍摄与主视口走相同渲染图。不要直接把异步排序尚未完成的第一帧当缩略图或拍摄完成。
- 全景是单独路径，高斯物品与高斯世界均存在；不应仅按 `outputType === 'world'` 判断格式。

原站 Spark chunk 本地捕获目录未保存实体。本轮从上述捕获模块明确引用的官方 CDN 地址读取并与 npm 发布物比较（仅静态分析，未执行厂商 JS）：

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

1. ESM 出口为 `dist/spark.module.js`，另有 `spark.module.min.js`。未压缩 ESM 约 2.82 MB，min 约 2.67 MB，不能把整个 16.4 MB npm 解包体积当浏览器下载量。
2. ESM 将 fflate 打入自身；外部 import 仅为 `three` 及 `three/addons/postprocessing/Pass.js`。现有 importmap 已支持这两种路径。
3. Rust 解码/排序 WASM 以 base64 ArrayBuffer 内嵌，`WebAssembly.compile(...)` 在本地编译。Worker 源码以字符串内嵌，使用 Blob URL 创建 Worker，并有 data URL 回退。
4. 发布包没有运行所需的独立 `.wasm` 或 Worker `.js` 文件，只有 Worker sourcemap；无需额外下载远端 WASM、Rust 构建或 CDN worker。ESM 源码未发现 `https://`。
5. 运行要求：WebGL2、WebAssembly、Worker、Blob URL。若未来加入 CSP，应允许本地模块、`worker-src blob:`，并验证 WASM 编译策略；不能默认已有严格 CSP 能兼容。当前服务器未检出 CSP 声明。
6. 当前服务器 `server/server.cjs:64` 拒绝除 `node_modules/three/` 以外的node_modules静态访问，因此直接映射 `/node_modules/@sparkjsdev/spark/dist/spark.module.js` 会被拦截。最小接法是用现有 esbuild 建独立 ESM `assets/spark.js`，保持 `three` 和 `three/addons/*` external，再在importmap映射 `@sparkjsdev/spark -> /assets/spark.js`；保留许可证/关联 legal comments。这样不需扩大服务器静态目录权限，也不用复制原站打包副本。另一方案是构建时复制官方self-contained ESM到assets并保存MIT许可证，仍需可重复构建脚本。
7. SPZ 原始字节、预览、可选 LOD 均要放入现有 LocalAssets / IndexedDB；不把短期 blob URL 存入文档。断网验收应验证所有代码、解码及输入数据都来自本地。

公开 API：`SplatMesh({fileBytes, fileType: SplatFileType.SPZ, fileName})`、`mesh.initialized`、`mesh.getBoundingBox()`、`mesh.dispose()`；`SparkRenderer({renderer, onDirty, enableLod})`、`spark.update({scene,camera})`、`spark.dispose()`。`onDirty` 特别用于异步排序/LOD 完成后的重新绘制，须合并到现有 dirty / invalidate 调度，不在回调中递归直接渲染。

压缩 SPZ 的解码已由 Spark 原生 loader/Rust 实现承担；无需转 PLY/GLB。包支持 SPZ 不等于任意损坏数据、任意 SPZ 修订或超大解压结果都安全。具体文件应由官方解码器验证；压缩字节上限与解码后的 splat/GPU预算需分别控制。

## 最小接线清单

| 位置 | 现状 | 必要变更 |
| --- | --- | --- |
| `world-node/resource.mjs` 的 `importFile/materialize/localize` | 仅接受 GLB，`format !== 'glb'` 拒绝 | 按真实 `glb/spz` 分派；保留 SPZ原始Blob、本地引用、格式、字节数与缩略图，调用Spark解码预览；沿用source guard、timeout和迟到dispose |
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

## 验证边界与下一步

本轮仅对捕获源码、官方发布内容、类型声明、现有接线点进行静态核验；未运行GPU、浏览器、依赖安装或全套测试。后续最小验收：真实SPZ本地导入→有内容渲染→旋转/移动→PNG真实画面→进入片场→相机拍摄/运镜→保存刷新/撤销恢复；另验证坏文件、预算、取消、迟到dispose、GLB无回归，以及断网时无代码/worker/wasm远程请求。任何一次首帧、空白截图、改名GLB或普通网格替代都不能作为高斯渲染完成证据。
