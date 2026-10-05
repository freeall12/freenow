# SPZ 本地成熟渲染器接入 · 2026-10-05

用户批准新增生产依赖后，接入官方 `@sparkjsdev/spark@2.3.1`（MIT），传递依赖 `fflate0.8.3`（MIT），沿用项目 Three0.186。当前本地导入、真实解码与片场接线已实现；默认3D预览的浏览器GPU图像已通过（正向蜥蜴、台座及花园），片场持久化和PNG摄影已通过，2秒短运镜真实播放已通过；不能把下述Node合同测试视为摄影通过。SPZ本地渲染能力已开放；生成仍需正确供应商配置，真实Marble Key尚未验收。通过World节点导入SPZ并进入片场，片场上传按钮仍仅支持GLB。

## 运行与来源

```bash
pnpm install --frozen-lockfile
pnpm build:spark
pnpm dev
# 打开 http://127.0.0.1:4173/qa/spz-world.html?session=<新的隔离会话>
```

`scripts/build-spark.cjs` 从官方 npm ESM 生成本地 `assets/spark.js`，external 为项目的 `three` 与 `three/addons/*`；没有第二套 Three。Rust WASM 和 Worker 已包含在库内，运行不请求远端代码。许可证保存在 `assets/licenses/`。首次 SPZ 才动态加载 Spark。

验收素材为 Niantic MIT 仓库真实 `hornedlizard.spz`，不是 GLB 改名、图片球体或模拟点云：18,143,098 bytes，SPZ2，786,233 Gaussian，SH3，展开50,318,928 bytes。SHA256 `a076ca6aeb9f1a8fe52526f4a7c381fe8fffec60c0d7eb64b45532189b64bc6a`。固定 commit、源地址与许可证位于 `qa/fixtures/spz/source.json` / `LICENSE-Niantic-MIT.txt`。QA 页面复用正式生产模块，使用隔离 IndexedDB 和明确未配置的模型接口，不调用原站服务。

## 文档与渲染边界

- 原始 SPZ Blob 保存到现有 LocalAssets；可直接下载原字节。描述保存本地url、count、完整bounds、可选metricScaleFactor、groundPlaneOffset、coordinateSystem和framingBounds。
- 权威片场对象是普通 Three Group，`userData.worldSplat`保存描述；变换、父子关系、相机与动画仍保存在真实GLB文档。`splatAssets`保存sidecar引用。SplatMesh、SparkRenderer、GPU纹理不会进入JSON、ObjectLoader、SkeletonUtils或GLTFExporter。
- 各WebGLRenderer有独立SplatContext。隐藏渲染层只在该上下文累积/绘制时可见；照片与视频等输出先等待当前镜头排序。回调只置dirty，同视角空闲绘制不重复排序。
- 撤销/恢复先准备新context，成功后替换旧context；关闭等待在途排序，释放源mesh与Spark。取消不可中断的原生解码时释放迟到结果；共享官方Worker池保留复用，不能未经检查终止所有Worker。
- 删除最后一个SPZ时不再显示旧Spark accumulator，镜头context重新清空；无摄影镜头时预览不会传入null camera；异步ready后核对文档根，避免把过期文档误标成功。
- 普通GLB路径保持；含高斯片场的“完整GLB下载”明确拒绝，提示下载源SPZ，不输出丢失高斯的空壳GLB。

## 坐标与取景

[Niantic同一commit README](https://github.com/nianticlabs/spz/blob/affd0ecea7fbb4c265ee119475af7ee5b2997482/README.md) 明确SPZ默认RUB（Right/Up/Back），和OpenGL/Three一致。本地SPZ默认`spz_rub`不翻轴；明确Marble输出`marble_raw_opencv`才应用`(1,-1,-1)`，原始素材不修改。明确Marble资源还以proxy.scale应用metricScaleFactor、proxy.position.y=+groundPlaneOffset，等价raw中心先缩放再减raw Y偏移后翻轴；GLB/JSON恢复已有变换，不再重复初始化。不能将厂商Marble路径的翻轴无条件应用到所有SPZ。

样本包含半径约200的真实远景Gaussian，主体约1单位。完整bounds用于空间数据；仅在完整范围比中心分布大4倍以上时，另以至多32K确定性样本的各轴10%–90%分位、15%padding作为自动取景hint。预览和片场focus用hint，不裁剪数据、不更改实际Gaussian数量；用户仍可自由导航看到远景。旧QA descriptor不会自动变成新hint，应使用新会话重新导入。

## 当前预算和限制

| 项目 | 实际限制 |
| --- | --- |
| SPZ压缩文件 | 64MiB |
| 解码展开预算 | 256MiB |
| 单文件与场景累计 | 各250万Gaussian |
| 格式 | SPZ1–3，经有界gzip全流实际展开计数与文件头exact长度核对，再由官方解码实际count核对；不支持vendor扩展header |
| 来源 | 同源本地asset/static/media/Blob，拒绝外部地址与跳转 |
| 绘制 | 官方tiny-lod，单视图最多250,000节点绘制/排序；原数据与树保留。没有100k→full_res资源切换或RAD分页 |
| 运镜输出 | 现有RAF + MediaRecorder实时录制，每次镜头改变等待排序；不保证30fps或逐帧精确 |

数字为保护性硬预算，不是实测性能承诺。1005m已接[原生LOD](SPZ-LOD-20261005.md)并验真实近远GPU、拾取、摄影、两秒运镜和释放恢复；下文保留早期全量版本验收数字。LOD预算不限制全源解码、树或GPU纹理驻留内存。pager、多设备GPU预算、500k/250万压力、连续五轮开关资源测量、断网重开、4096px节点拍摄和长视频仍需分别验证。混合拾取范围见[SPZ-MIXED-PICKING-20261005.md](SPZ-MIXED-PICKING-20261005.md)。Gaussian颜色由原始辐射数据决定，白模/PBR灯光不会等价修改高斯材质。

## 已跑检查

截至地面偏移和失败持久化修复，`tests/world-splat.test.cjs` 15/15通过。包括真实文件哈希/header、坏gzip/预算/cancel、本地引用校验、真实GLB/JSON与动画恢复、取景hint保留完整bounds、明确RUB/RDF变换、空镜头、最后资源删除、异步root替换、排序合并与迟到释放。渲染生命周期测试在显式GPU边界使用doubles，不证明实际GPU图像。

已跑相关GLB/存储回归48/48（materialization、download、save-recovery、repeat/multi-scene-import、scene-export、display-materials）。Spark构建、所改模块语法和diff检查通过。真实预览截图见 [spz-world-preview-20261005.jpg](./screenshots/spz-world-preview-20261005.jpg)。正向蜥蜴、台座与花园可辨，导航wheel有效；786,233实际Gaussian，最近导入667ms（已有缓存条件，不能称完全冷启动）。已通过正式预览进入片场、旋转20度并保存、撤销零旋转、重做恢复20度（revision=saved3），刷新同会话恢复稳定ID、旋转、摄影镜头和运镜（revision=saved6），shader Gaussian=786233。1280×720真实PNG已添加画布，图像见 [spz-shot-photo-20261005.jpg](./screenshots/spz-shot-photo-20261005.jpg)。原SPZ读回18,143,098 bytes和固定哈希完全一致，外部请求0。QA只白名单本机POST `/api/media/finalize`（可带唯一合法duration），真实FFmpeg已返回200 video/mp4并添加视频节点；完整视频预览DOM实测1280×720、duration=2，正常播放到currentTime=2、ended=true、error=null；首/末有内容且雕像与路径明显位移。图像见 [spz-motion-video-20261005.jpg](./screenshots/spz-motion-video-20261005.jpg) 及 [spz-world-canvas-20261005.jpg](./screenshots/spz-world-canvas-20261005.jpg)。未取得原MP4供ffprobe，不能报告容器帧率、零掉帧或逐帧精度。

SPZ当前16/16；新增小声明count+额外展开payload、截断payload拒绝回归。能力开放后preflight验证本地GLB/SPZ能力与供应商配置独立、Node/Agent使用同一guard与材料化链、缺配置零dispatch，错配格式拒绝；最终定向100/100通过（含SPZ、GLB存储恢复/导出、前置能力、Marble配置与持久化），构建/语法/diff检查通过。Marble后端集成测试有既有Three CJS废弃提示，结果通过。

最后 Computer Use 复验删除与撤销：刷新恢复的同一片场执行真实 `remove` 和 `flush`，`revision=savedRevision=1`，高斯列表为空、`spark=false`，主视口仅剩网格，镜头画面无残影；随后真实撤销并保存，`revision=savedRevision=2`，恢复同一对象 ID、20° 旋转及全部 786,233 高斯，主视口和镜头同时恢复。照片、视频与来源连线未改，外部请求为零。新增实际 gzip 展开预算另经独立只读交审，SPZ1–3 的长度公式已核对固定 Niantic 源码；未重复运行全库测试。

提交检查补记：正式源码与文档的 `git diff --cached --check` 通过。Spark 构建产物包含上游 GLSL 字符串行尾空白，该生成文件精确排除空白检查，保留库的原始着色器内容；密钥扫描仍包含该文件。
