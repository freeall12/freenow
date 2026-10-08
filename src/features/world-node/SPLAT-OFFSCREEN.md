# SPZ 离屏 LOD、排序与同步绘制

`SplatContext`新增两条摄影专用接口。旧`prepare/settle/enqueue/render`继续按视口drawingBuffer工作并合并重叠排序请求。

```js
const options = {width, height, signal, assertCurrent};
await gaussian.settleOffscreen(root, opticalCamera, options);
const result = gaussian.renderSettled(root, opticalCamera, () => {
  // 同步绘制，返回值交给宿主摄影模块；不得触发另一条SPZ更新。
  renderer.render(scene, opticalCamera);
  return true;
}, options);
```

宿主持有独占renderer拍摄lease，暂停普通viewport与shot绘制，跨异步阶段检查同一场景/资源/相机身份。此模块不自动暂停宿主，也不提供不同摄影请求并发能力。`width/height`为正整数物理像素；`signal`可选；`assertCurrent()`应抛异常或返回false表示失效。

`settleOffscreen`先等旧队列、prepare源资源，再按显式目标尺寸完成原生LOD选择、累积和排序。Spark.renderSize在LOD之前设为目标尺寸，排序promise结束后恢复原值。场景或镜头在等待中改变、signal abort、上下文dispose、身份失效会拒绝，错误时清除摄影缓存。dispose仍等待正在运行的native工作，避免释放仍被GPU/worker使用的资源。

摄影缓存key包含offscreen/viewport模式、宽高、相机世界/投影矩阵及fov/aspect/zoom/near/far/layers、源节点/mesh身份、矩阵、继承visibility与layers；并保留root对象身份。`renderSettled`同步复核当前key及源成员，不匹配或存在pending update就拒绝。它临时打开当前Gaussian layer并关闭Spark.autoUpdate，finally恢复；不调用enqueue/LOD/update，也不安排后台更新。异步draw会被拒绝。下一次普通viewport请求因mode/尺寸key不同，重新按屏幕尺寸选择/排序。

空SPZ root也可settle并同步draw，Gaussian layer保持隐藏。此接口只覆盖已有SPZ源对象的绘制生命周期；加载/修改descriptor所引用的源文件仍遵循既有prepare与materialization规则。

## 可核验依据

本机TapNow安装包源码静态证据：

- `WorkspaceViewfinderButton-BHqIWibq.js`的`Ti`，字符offset43712：摄影draw临时设置Spark.target、renderSize(width,height)、encodeLinear，finally恢复。
- `ThreeDWorkspace-BzPphAqB.js`的`jK`，字符offset705142：独立offline路径等待未初始化SPZ，await spark.update({scene,camera})，前后检查AbortSignal。独立renderer与复用viewport的摄影路径是两种不同资源所有权，不能混写为同一路径。

本地锁定SDK`@sparkjsdev/spark`2.3.1的`dist/spark.module.js`：

- onBeforeRender约12418行才按实际target设置renderSize；此时修改不能补救更早已完成的LOD。
- update/updateInternal约12475–12530行：prepareGenerate读取renderSize；updateInternal await driveSort。上下文串行与minSortIntervalMs=0避免重叠排序被SDK跳过。
- driveLod约12612行：Perspective像素尺度含`2*tan(fov/2)/renderSize.y`和lodRenderScale。因此目标height必须在LOD之前设置。
- 既有SplatLodController等待native worker独占任务与真实LOD indices，再允许累积/排序；不以proxy bounding box代替真实SPZ。

## 验证与边界

2026-10-08针对性验证：

```sh
node --test tests/world-splat-offscreen.test.cjs tests/studio-v3-photo-renderer.test.cjs
node --test --test-name-pattern='per-context Gaussian sorting|closed context releases|deleting the last source|proxy and camera layer-only' tests/world-splat.test.cjs
```

离屏SPZ专项7/7、摄影专项8/8通过；旧viewport精确回归4/4通过。覆盖目标尺寸在LOD/sort前生效、等待与恢复、不enqueue、thumbnail重排、viewport切回、pose/projection/layers/transform/visibility/root变化拒绝、异步阶段身份/abort/dispose、错误时恢复及空源。

测试使用真实Three对象、SplatContext源码和受控LOD/Spark/GPU adapter。SDK阅读证明调用时序，adapter测试证明本地调度合同；尚未做浏览器实际WebGL像素、真实SPZ在4096/320目标下LOD内容与排序、最终JPEG颜色/DOF/地面叠加验收。250000限制排序/绘制数量，不限制解码后的完整源常驻内存。
