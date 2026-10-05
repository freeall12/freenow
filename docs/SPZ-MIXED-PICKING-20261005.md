# SPZ 与网格混合深度点选 · 2026-10-05 / 1005l

当前修复了片场“网格GPU ID命中总是压过高斯”的选择规则。网格保留实际材质/纹理透明孔、骨骼与morph形变的GPU片元判断；高斯使用已安装Spark2.3.1的原生`SplatMesh.raycast`。两者转换为同一摄影机、同一物理像素的深度后比较。Node定向36/36通过；主任务已完成真实GPU四种遮挡模式的CUA鼠标点选验收。

## 官方合同证据

- 本机 `/Applications/TapNow.app/Contents/Resources/web/assets/spark.module-LMeSeoEa.js` 的`SplatMesh.raycast`与当前npm包都返回 `{distance,point,object}`；默认`minRaycastOpacity=0.2`。逆世界矩阵作用于ray原点/方向，方向不再normalize，返回参数保持为世界ray距离，因此对象非均匀缩放不应另乘猜测比例。
- 精确已安装发布物：`node_modules/@sparkjsdev/spark/dist/spark.module.js:10840`与`dist/types/SplatMesh.d.ts`。packed/ext原始Gaussian交给官方WASM raycast，`point=worldOrigin+worldDirection*distance`。本轮未新增依赖、复制厂商业务模块或调用原站生成API。
- [官方raycasting例子](https://github.com/sparkjsdev/spark/blob/main/examples/raycasting/index.html)实际使用Three Raycaster对SplatMesh点选。当前公开[原生raycast实现](https://github.com/sparkjsdev/spark/blob/main/rust/spark-rs/src/raycast.rs)展示官方椭球/扁盘选择语义；这不是项目新写的Gaussian近似。公开main可能变动，精确JS合同以上述已安装2.3.1为准。npm的gitHead在公开GitHub未能解析，未把它伪称为已验证Rust版本。
- Three0.186 `WebGLRenderTarget({count:2})`提供MRT；`readRenderTargetPixelsAsync`支持第8参数textureIndex。深度编码直接使用Three `ShaderChunk.packing`的`packDepthToRGBA`，CPU解码使用其`UnpackFactors4`。

## 具体选择策略

1. 将CSS点击换算为绘图缓冲区物理像素中心；GPU ID和Spark raycast共用该中心。
2. Spark只检查权威文档当前Gaussian proxy的可见父链/图层与所属根。隐藏的实现render layer不影响合法高斯拾取；脱离文档、隐藏父对象和不匹配camera layer的proxy不能命中。
3. 无有效Spark命中时沿用原`ScenePicker.pick()`的ID路径。有Spark命中时调用新`pickHit()`，同一次原材质GPU pass输出attachment0的24bit ID及attachment1的打包深度，避免CPU网格raycast丢失alpha孔和形变。
4. 将官方Spark世界point投影得到normalized depth，丢弃摄影机near/far范围外命中；比较`floor(depth*2^24)`并clamp远平面值。同一个深度cell稳定优先网格，不跨相邻cell给网格额外容差。多个同距离Gaussian稳定按其文档ID排序。
5. 保留原session/revision、文档根、相机姿态/投影、CSS尺寸、绘图缓冲区和播放状态guards；迟到GPU结果不能改写已经变化的选择。

渲染层保持每个proxy的layer mask，Spark presentation接受所有view layer，再由Spark原生`prepareGenerate`按camera mask筛选具体SplatMesh。camera/proxy layer变化纳入累积key，不能误复用旧排序。

MRT读取前已恢复临时ID材质、隐藏根与renderer状态；两项GPU fence采用allSettled完整排空，一个失败也必须等另一项结束才释放target。原`pick()`返回稳定ID的调用合同保持，新增`pickHit()`返回 `{id,depth}`。

## 隔离真实GPU验收

```
http://127.0.0.1:4173/qa/spz-world.html?session=spzpick1005l-root1&picking
```

使用全新session。点“建立真实SPZ前后遮挡QA”，复用Niantic真实786,233 Gaussian素材和正式片场模块；根据真实Spark raycast点在前后放两块真实PlaneGeometry。前景salmon网格有真RGBA纹理，透明孔模式清除其中心像素；后景蓝网格无透明孔。诊断`picking.target`给实际画布点击坐标，`expectedId`为稳定文档ID。模式及预期：

| 模式 | 预期命中 |
| --- | --- |
| 前景网格 | frontId |
| 仅后景网格与高斯 | gaussianId |
| 前景纹理透明孔、后景网格与高斯 | gaussianId |
| 隐藏高斯、隐藏前景 | rearId |

用真实鼠标点选目标验证UI选中对象；“程序点选目标并核对”只作为重复测量辅助，不能替代鼠标/GPU截图。外部和模型请求继续禁止。本轮新增`qa/spz-picking-controls.mjs`，主QA仅在明确`picking`参数时加载。

2026-10-05，主任务root在上述session的tab72中，冻结生产代码reload后重新建立真实场景。诊断目标为`(400.25,360.25)`，每种模式均使用CUA实际鼠标`click(400,360)`，没有用“程序点选目标并核对”替代此次验收：

| 实测模式 | expectedId与selectedId一致 |
| --- | --- |
| 前景网格 | `c22ce535-ba4c-43b1-8d3a-62c97657ec79`（frontId） |
| 后景网格 | `b63a653e-0cc6-4d92-b1a3-77b9fecb61b9`（gaussianId） |
| 透明孔 | `b63a653e-0cc6-4d92-b1a3-77b9fecb61b9`（gaussianId） |
| 隐藏高斯 | `70630671-9e74-4e7b-8db7-2bab0b8e8368`（rearId） |

实际GPU素材为786,233 Gaussian；fixture记录的`externalAttempts=[]`、`blockedAPIs=[]`、`localFinalizeRequests=0`，浏览器warn/error均为空。root通过真实`Page.captureScreenshot`保存[JPEG截图](screenshots/spz-mixed-picking-20261005.jpg)。验收后仅修正QA顶部`studioId`诊断：优先读取当前runtime所属场景，避免多次build后误显示第一个旧片场；未改变生产拾取行为。

## 定向检查

```bash
node --test tests/studio-v2-scene-picker.test.cjs tests/studio-v2-mixed-picking.test.cjs tests/world-splat.test.cjs
```

36/36通过，覆盖原13项GPU点选合同及新MRT/native raycast边界、前后深度、alpha孔、pixel center、近远裁剪、正交投影、隐藏父链、文档归属、稳定ID、双fence失败释放与layer-only重排。显式GPU/WASM边界doubles只验证项目适配，不证明实际GPU材质编译或图像。

## 保留边界

当前renderer采用普通深度（未启用logarithmic/reversed depth）。选择依据是官方Spark opacity阈值raycast及网格GPU命中；多层半透明Gaussian最终颜色是混合结果，没有唯一可见表面，本轮不宣称逐像素合成透明度等价或替代官方raycast语义。官方全量raycast的CPU代价仍需随实际场景测量。LOD/性能预算、真实Marble Key和完整跨设备验收保持原边界。
