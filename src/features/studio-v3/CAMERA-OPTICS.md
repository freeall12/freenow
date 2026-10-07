# Studio V3 摄像机光学

## 依据与边界

2026-10-08 静态阅读 `/Applications/TapNow.app/Contents/Resources/web/assets/` 中以下安装包源码。没有 import、eval 或运行官方 bundle，没有调用模型或付费接口。

| 源文件 | SHA-256 | 阅读到的合同 |
| --- | --- | --- |
| `ThreeDWorkspace-BzPphAqB.js` | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` | `I`/`P` 创建摄像机继承 viewport/visible camera；`Fs` 示例摄像机；`Gn`/`_n` 状态转换；`Gs` 默认景深；`Tc` Spark 景深参数；`Wa` 焦距输入；`ax` 真实离屏摄像机 |
| `WorkspaceViewfinderButton-BHqIWibq.js` | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` | `Nc`/`Yn`/`Co` 参数默认和范围；`Ki` 画幅选项；`Ml` 实体画幅降级；`Vc` Spark 光圈角；`El`/`Fo`/`Uo` viewport 取景框补偿 |
| `course-api-base-url-CGXqZmAy.js` | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` | `Nv`/`uM` 传感器；`Bq` 裁切；`jOe` 垂直 FOV；`BOe` 焦距反算；`vdt` 自动横竖画幅 |
| `world-object-camera-framing-CAbqcro9.js` | `62fd36b27ff8aaac02f44332e545334d8e9bf92abe7d2b4f1b5b5f69565c8f27` | `et` 包围盒取景：转入相机坐标的八角点分别满足水平、垂直视角；`Oe` 距离；near≥.01，far≥1000。此文件主要是 GLTF/environment/framing，光学默认来自前述文件 |

源码出现的字段、默认值和计算式是**安装包源码合同**。本文提到的 Three 投影验证是**本地实现的定向测试**，不构成官方运行行为或全片场视觉验收。

## 官方参数

| 参数 | 静态证据与边界 | 本地映射 |
| --- | --- | --- |
| 焦距 | `Nc=24`；`xt=8`，`Et=400`；预设 8/16/24/35/50/85/135/400 mm；`Zn` clamp；`jc` 切换预设时用 .5 mm 容差 | `CAMERA_OPTICS_DEFAULTS.focalLength`、`FOCAL_LENGTH_PRESETS`、`stepFocalLength` |
| 画幅 | `Ki` 共 19 项，带 cinema/photo/social 与 common/extended；实体 `Ml` 缺省→16:9。viewport 未锁画幅时 `vdt` 根据横竖选 3:2 或 2:3 | `FRAME_ASPECT_RATIO_OPTIONS` 原顺序保留；新建实体在无 viewport 输入时使用16:9；`null` 可保留为自动画幅 |
| 传感器 | 横向 36×24 mm；竖向 24×36 mm；`Bq` 先选方向，再按比例从传感器内裁切 | `sensorDimensions`，不直接采用 Three 默认 35 mm filmGauge |
| FOV | 垂直 `2 atan(sensorHeight/(2 focalLength))`；反算 `sensorHeight/(2 tan(fov/2))`。`Uc` 以 8–400 mm 转换出的 FOV 为边界 | `focalLengthToFov`、`fovToFocalLength`；FOV-only action 反算焦距后限制至8–400 |
| 光圈 | `Co=[1.4,2,2.8,4,5.6,8,11,16,22]`；`Oc=11`；`Vo` clamp 至1.4–22 | `APERTURE_PRESETS`，默认 f/11 |
| 对焦 | `Lc=10` m；`Mo=.1` m；`jo` 设置下界；`focus` 可 point/distance；本地 schema 另支持 object/none。`Gn` 以 focus.distance 优先；旧裸 focusDistance≥100 且无显式distance/point会回落10 | action distance 同步 focusDistance；point/object 清缓存距离；`sparkDepthOfField` 用相机前向轴深度，而非空间直线距离 |
| 景深模式 | `Gs` 默认 deepFocus；`Tc` deepFocus 强制 Spark focalDistance=0、apertureAngle=0 | 默认 deepFocus；纯映射返回相同零参数 |
| 渲染裁剪 | viewport 与离屏 `new zi(...,.1,1e3)`；framing `et` 会根据物体距离调整near/far | 实体相机默认 near=.1/far=1000；未加入自动包围盒取景扩展 |

官方新建摄像机不是恒定的24 mm：`I`（地面放置）和`P`（当前视点放置）从当前 viewport snapshot `_n(s())`/`_n(l())` 复制已有光学状态，再经 `Ml` 将缺省实体画幅补为16:9。24 mm/f11/deepFocus/10 m 是无当前视点时的本地降级默认；宿主可把实际 viewport camera 作为 create action.camera 输入。官方示例 `Fs` 的四台摄像机有独立焦距/FOV/画幅，不能当作创建默认。

## 本地输入与一致性

`cameraOpticsPatch(previous, patch)` 返回独立的完整摄像机快照，保留 pose、focus、lookAt 和其他原字段。它不访问状态仓库、渲染器或网络。

```js
import {cameraOpticsPatch, normalizeCameraOptics} from './camera-optics.mjs';
const next = cameraOpticsPatch(currentCamera, {focalLength: 85});
// UI 可直接把局部输入交给 action reducer，避免 UI 维护第二套公式。
applyAction({type: 'update', entityId, patch: {camera: {frameAspectRatio: 9 / 16}}});
const displayed = normalizeCameraOptics(currentCamera);
```

- 明确输入焦距时，焦距拥有投影，重新计算 FOV，包括旧快照中焦距和FOV矛盾的情况。
- 明确输入FOV、未输入焦距时，反算并保存焦距；比例单独改变时保留焦距。
- finite且正数的越界输入按官方范围 clamp；字符串、NaN、Infinity、零、负值拒绝。FOV还必须<180。`frameAspectRatio:null`、`focusDistance:null`单独支持。
- `focus:{mode:'distance',distance}`同步focusDistance；`focusDistance`单独输入生成distance目标；清为null生成none目标。point/object目标将缓存距离清为null，等待真实相机求深度。
- `entity-actions.mjs`将摄像机position/rotation与transform双向同步；双重pose输入冲突仍拒绝。旧快照进行光学编辑后，实体transform恢复摄像机pose；`render-graph.camera()`读取旧快照时也把模型pose与真实相机同步。
- 官方的俯视平面transform可能仅保留yaw（如`Fs`），本地三维模型与相机完整rotation同步是为避免图标/transform/拍摄方向分离。这里不声称与官方俯视yaw投影的结构完全相同。

`applyCameraOptics(threeCamera, config)`使用裁切sensor height设置 `filmGauge=height×max(aspect,1)`，然后调用真实Three `setFocalLength` 和 `updateProjectionMatrix`。因此 Three `getFocalLength()`、实际FOV、投影矩阵和UI焦距保持一致；不会再由旧FOV覆盖焦距。函数只负责光学，pose由宿主负责，**不会改变传入相机的near/far**。`.1/1000`只在graph新建实体摄像机时采用官方viewport/离屏构造默认；既有/宿主摄像机的裁剪距离保持原值，大型场景应由framing/runtime根据包围盒另行决定。

`render-graph.targets()`把camera lookAt的派生quaternion同步到模型root；对象目标移动后两者一起更新。域状态的原始transform/camera.rotation不重写，保留作者可撤销的位姿。

## 光圈和景深的真实实现边界

官方 `Vc` 使用下式，而不是未经调整的物理光圈角：

```text
worldScale = 2 × focusDistance × tan(verticalFov/2) / sensorHeight
apertureDiameter = focalLength / fNumber × worldScale
apertureAngle = min(.03, 2 × atan(apertureDiameter/(2×focusDistance)) × .03)
```

本地 `apertureAngle`复现这个调整系数和上限。`sparkDepthOfField(config,{camera,resolveEntityPosition,boundsCenter})`返回 `{focalDistance, apertureAngle}`。**Three PerspectiveCamera自身不渲染景深**；`camera.focus`和`userData.studioV3Optics`仅保留参数。运行时现已将映射结果赋给当前 `SplatContext.spark`，普通 GLB mesh 不具备景深虚化。

当前模块本地扩展支持object目标resolver、none/显式null无限远（返回零景深），并允许用boundsCenter求缺省轴深度。对点/对象目标会重新计算轴深度；目标在相机后方时回落10 m。官方 `oO` 对已缓存finite focusDistance先用缓存，`ox`可回落包围盒中心再回落10 m。旧裸focusDistance≥100的官方`Gn`兼容迁移和viewport逐帧焦点缓存没有在此模块自动执行；宿主迁移/运行时必须明确处理，不能把保存参数当作景深已实现。

官方viewport有`Fo`/`Uo`的取景框高度比例补偿：缩小取景框时扩大viewport FOV，拍摄再恢复frame FOV。实体PerspectiveCamera直接使用frame FOV。此模块未自动增加viewport补偿或平滑；宿主如果有内嵌取景框应单独处理。

## 运行时 Spark 接入与只读预览

2026-10-08 核验本地既有成熟渲染器 `world-node/splat-io.mjs:SplatContext`：真实SparkRenderer在 `.spark`，`render`回调负责实际Three draw。核验已声明依赖 `@sparkjsdev/spark@2.3.1` 的 `dist/types/SparkRenderer.d.ts:103–108/325–326`：`focalDistance`为焦平面距离，`apertureAngle`为全宽弧度角，0关闭。其`dist/spark.module.js:12446–12447`在draw更新uniform时读取两个实例属性。因此无需新包或持续调用Spark.update来改变景深uniform。

`runtime.mjs`在实际render回调前、settle后，以及capture draw前将参数赋给`gaussian.spark.focalDistance/apertureAngle`。参数根据**这次draw的camera**选择，不依据selected entity或activeViewId：

- orbit/plan视图强制零景深，即使选中摄像机。已渲染的实体摄像机使用该camera所属的最新state；外部有效PerspectiveCamera只在显式携带`userData.studioV3Optics`时使用相应镜头合同。
- 点焦点沿实际camera前轴计算深度；object目标从ready/visible实体root求世界位置，offset按目标局部坐标变换（包含其旋转/缩放）。目标移动后无需保存缓存距离。
- 临时capture采用拍摄camera的景深，成功/异常均在finally恢复当前可见相机。异步settle期间所有权失效、source/setup切换、camera移除/隐藏会拒绝过期capture，不绘制旧帧。
- source/setup变化或预览摄像机失效时自动回到进入预览前的orbit/plan，并清零景深；失效会话及dispose也清零。dispose同时取消待渲染帧、清preview ID，再调用既有SplatContext.dispose。
- 仍按需请求帧。静态预览只绘制一次；启用DOF不启动永久RAF循环。现有动画/Spark onDirty才继续请求帧。

当前runtime没有可编辑possession会话。新增的是可实际使用的**只读预览**：

```js
runtime.previewCamera(entityId); // true: 切为camera视图；false: 非ready/hidden/非摄像机
runtime.camera;                  // 当前实体真实PerspectiveCamera
runtime.previewCameraEntityId;
runtime.cameraPreviewReturnView; // 进入预览前的orbit/plan
runtime.cameraPreviewRect;       // {left,top,width,height}：相对canvas的CSS像素；非preview为null
runtime.clearCameraPreview();    // 返回原视图并返回视图字符串
runtime.setView('orbit');        // 明确退出预览，也支持plan
runtime.depthOfFieldSupported;   // 当前有效会话是否存在真实SparkRenderer
runtime.sparkDepthOfFieldParameters(); // 当前实际可见camera对应映射，纯读
```

预览关闭OrbitControls，并阻止TransformControls attach与focusEntity改写camera；setView可明确退出。`resize`不会覆盖实体FOV/画幅。`depthOfFieldSupported`只说明Gaussian景深渲染路径存在，不表示普通GLB也有景深。尚未添加官方viewport取景框FOV补偿或可编辑possession。

实际preview现已按camera.aspect居中fit到整个renderer逻辑尺寸，使用黑matte与setViewport/setScissor绘制frame，保持projection原值而避免拉伸。`cameraPreviewRect`把这个frame按真实canvas.getBoundingClientRect比例换为canvas局部CSS坐标，供宿主绘制边框；hitEntity/hitSurface把同一frame转换为绝对client rect生成光线，frame外返回null。CSS缩放、画幅编辑、resize、preview切换/移除都从当前有效camera与画布尺寸重新求rect。

每次draw结束（包括异常）恢复full viewport、full scissor与关闭scissorTest，并恢复原clearColor/alpha。capture根据**传入camera**独立fit，不沿用预览镜头的裁剪；finally恢复实际可见camera景深，并按需请求一次帧重绘当前预览。`setCapturing(true)`期间仍由既有渲染暂停保护，解除后才绘制。官方居中取景框只有约50%viewport面积的FOV补偿仍未实现；此处是填满可用viewport的letterbox预览。

新增运行时定向测试使用真实Three camera/graph/domain和模拟GPU渲染入口，检查**实际draw时**Spark实例参数、相机归属和清理。没有用模拟结果声称真实WebGL像素的虚化质量已验收。

## 定向验证

```bash
node --test tests/studio-v3-camera-optics.test.cjs tests/studio-v3-entity-actions.test.cjs
node --test --test-name-pattern='separate camera optics' tests/studio-v3-runtime.test.cjs
node --test tests/studio-v3-runtime-optics.test.cjs
```

2026-10-08：26+1项通过。包括已知传感器尺寸、焦距/FOV反算、19项画幅、所有焦距预设在6类画幅下的真实Three投影矩阵与焦距getter、范围/非法输入、景深参数映射、持久化pose/投影同步、setup撤销/重做，以及lookAt目标移动后camera/模型方向同步而domain位姿保持原值。附带parent授权的prop默认材质color:null→移除实例override验证，world undo/redo通过。未重跑全仓，未进行浏览器/WebGL景深视觉验收，未提交。

后续运行时专项11项通过：selected/orbit隔离、只读preview、光圈/对象局部offset对焦/point depth、hidden/remove/source/setup变化、capture成功/异常恢复、async过期capture拒绝、按需RAF及dispose、无Spark的GLB能力边界，以及新增landscape/portrait真实viewport比例、CSS缩放/偏移的已知目标picking和matte拒绝、独立capture fit与异常state恢复/单帧重绘。此次只重跑新增专项，不重复原27项或全仓。
