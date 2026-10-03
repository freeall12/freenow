# 新版片场透明区域与线/点拾取缺口（2026-10-03）

状态：GPU picker 已实现并通过独立源码复核、定向测试及主任务的分项 Computer Use。具体真实 GPU 证据见末节；特殊材质、全部设备与全站一致性仍开放。无新依赖。

依据唯一官方参考 `reference/studio-v2.md`，发布版 `eb1c3578957450302e3cff5edd2ad253d0874421`：

- `reference/studio-v2-page-readable.js:1992–2046` 的 `It` 使用 1×1 render target、克隆相机视口偏移与 GPU ID 颜色拾取。
- `2004–2010` 克隆原材质，保留标准材质纹理与形变路径，在片元着色器末尾追加 `diffuseColor.a < 0.05` 的 discard。这里只能断言到达这一步且 alpha 小于阈值的像素不阻挡后方物体；原材质的 alphaTest 等规则仍可能提前丢弃片元。
- `2022–2027` 覆盖 Mesh/Line/Points，包含相机辅助层。
- `2030–2046` 恢复原材质/可见性/渲染状态；异步读取与关闭释放有生命周期保护。
- `2674–2689` 调用方先拾运镜关键点，再拾内容/相机辅助层，通过 revision 丢弃迟到的旧结果。

修复前生产 `src/features/studio-v2/runtime.mjs` 的 pointerup 仅遍历 visible Mesh，取 Raycaster 第一命中。它不会用贴图最终 alpha 排除透明孔；GLB 导入的纯 Line/Points 无法通过世界视图点选。用户仍可通过对象树选择；该差异是交互缺口，不是仅技术方案不同。

建议最小实现：独立 `scene-picker.mjs` 复用已有 Three renderer，按官方契约渲染单像素 ID；不新增包。仅内容与相机辅助层参与，finally 恢复全部状态，以 revision/closed 守卫异步结果，关闭释放 target 与缓存材质。

验收至少包含：透明前景实心区域选中前景；透明孔选中后方模型；纯线/点模型点选；相机辅助体；快速连续点击与关闭后迟到结果；正常预览/导出不残留 ID 材质。不能因普通 cube 点选通过就宣称完整 GPU 拾取已完成。

## 规则边界

官方 `It.material` 强制 `NoBlending`、`transparent=false`、`depthWrite=true`、`toneMapped=false`、`dithering=false`。拾取返回单个节点 ID，不返回混合后的颜色贡献或穿透列表。alpha 等于 0.05 不被新增条件丢弃，但仍受原着色器的裁剪、alphaTest 等条件约束。

| 情形 | 源码能确定的行为与实际范围 | 后续验证 |
| --- | --- | --- |
| 标准 Mesh / Line / Points | 官方三类均进入 ID pass；LineSegments 属于 Line 范围。当前 runtime 只收集 Mesh。线宽、虚线空档、点大小及点精灵纹理取决于各自材质和 GPU 光栅化，不能用 Raycaster 的世界距离阈值替代 | 分别点击线段、虚线实线/空档、点精灵中心/透明边缘；确认空白处清除选择 |
| opacity、map alpha、alphaMap | 标准 Three shader 计算后才检查阈值；alphaMap 取绿色通道。UV 通道/变换、repeat/wrap、flipY、过滤和 mipmap 由原纹理路径决定。典型乘积仅适用于对应标准 shader，不能泛化为所有材质 | opacity 0.049/0.05/0.051；map 有孔；alphaMap 的绿色与 alpha 通道分别构造相反样例；测试 UV 偏移与 repeat |
| MASK / alphaTest | 保留原 alphaTest；例如 alphaTest=0.5 的区域不会因为大于 0.05 就重新可选 | 使用前景 alpha=0.25、alphaTest=0.5，确认命中后景 |
| BLEND / 半透明 | 新 ID pass 禁用混合且写深度；仍存活的前景片元通常遮挡后景，即使正常预览能透过它看见后景。不能称作“所有透明物体可穿透” | 透明前景实心区域选前景、孔洞选后景；不同深度两个半透明面交换顺序；保留特殊 depthTest/renderOrder 的独立样例 |
| 遮挡 / 可见性 / 材质数组 | 应使用同一当前帧的几何、父子 visible、material.visible、side、depthTest、groups 与原材质数组；ID pass 强制 depthWrite，因此与预览的透明排序不是同一契约 | 前后 Mesh/Line/Points 互相遮挡、背面/DoubleSide、隐藏父节点、隐藏单个材质组、相交表面 |
| SkinnedMesh / morph / 动画 | SkinnedMesh 属于 Mesh。复用原对象及克隆的标准材质，保留骨骼/形变 shader；不得换成静态包围盒或遗漏 skin/morph 的通用 ID 材质。须按点击时当前动画姿态渲染 | 骨骼和 morph 将模型移出静止位置后，点击变形后可见区域命中、静止旧位置不命中；带透明孔的变形材质再测一次 |
| 相机辅助体与运镜关键点 | 当前辅助体含 Mesh 和 Line；命中任何子几何均应映射到所属相机 studioId。运镜关键点先走现有屏幕空间拾取，成功就不启动 ID pass | 辅助体实心/轮廓/被模型遮挡；关键点与辅助体重叠时关键点优先；不可见辅助体不拾取 |
| 扩展材质与特殊渲染 | 标准 Physical transmission 可能进一步改变最终 alpha；alphaHash、alphaToCoverage、clipping、自定义 ShaderMaterial/onBeforeCompile、宽线与实例材质均不能由“clone”直接证明完整等价。官方仅覆盖上述三类，未由此证明 Sprite 支持；也未证明任意自定义 shader 中都存在 diffuseColor | 先登记实际导入材质与扩展；对出现的类型逐项做 GPU 样例。未知 shader 注入失败应可观测，不能静默退回 CPU 后宣称一致 |

依据本地已安装 Three 源码：`ShaderChunk/alphamap_fragment.glsl.js`、`map_particle_fragment.glsl.js`、`alphatest_fragment.glsl.js`、`opaque_fragment.glsl.js` 和 `webgl/WebGLPrograms.js`。`NoBlending` 使标准程序的 OPAQUE 条件不成立；若只设置 transparent=false 而漏掉 NoBlending，部分 shader 会把 diffuseColor.a 改成 1，透明孔阈值就失效。以上为源码推导，尚无本批像素验收。

## 最小改动方案

1. **新增独立 ScenePicker，不改变数据模型。** 内部持有一个 1×1、带 depth buffer、无 MSAA 的 RGBA 字节 target，颜色空间为 NoColorSpace。提供 `pick({scene, roots, camera, u, v, resolveObject})` 和 `dispose()`；返回对象 studioId、空白结果或失效结果，错误传播给 runtime.onError。0 编码为空白，对象编码从 1 起；请求内保存整数到 studioId 映射，检查 24 位上限，不把解码整数直接当持久对象 ID。
2. **克隆原材质，按官方 shader 末尾注入 ID。** Mesh/Line/Points 和材质数组均适用；保留原对象、纹理、骨骼、morph、side、裁剪及原 alphaTest。设置官方强制字段，追加 alpha 阈值和 ID RGB，不使用 scene.overrideMaterial 或把所有对象换成 MeshBasicMaterial。ID uniform 必须对每次实际绘制生效，不能因 shader program 复用让两个对象输出同色。缓存按源材质与 ID 管理；材质变化刷新或失效，切场景/重载释放缓存，dispose 克隆材质不释放共享纹理。
3. **只渲染 content 与 cameraPresentations.layer。** 隐藏网格、transform gizmo、selection box、motion overlay 等其余场景分支；不要 flatten 层级或改变原 visible。按当前 runtime 的 studioId 映射内容对象，辅助体向父级查 studioCameraId 并 resolve 到 runtime.find(cameraId)。内容中无法映射的可渲染对象需要显式处置，避免用正常材质颜色误解码为 ID。Group 自身无像素，不因其子 Mesh 可拾取而另造 Group 命中几何。
4. **复用当前 renderer，同步执行交换/绘制/发起读取，再立即 finally 恢复。** 保留克隆相机的完整投影，按下节将完整物理 viewport 平移到 1×1 target；CSS 相对坐标检查 0≤u,v<1，不修改自由视角相机。保存并恢复原材质、顶层可见性、background、shadowMap.enabled、render target（包括 cube face/mip level）、clearColor/clearAlpha；renderer 的逻辑 viewport/scissor/scissorTest 全程不修改，绑定/恢复 target 自动使用对应的物理状态。若方案修改其他状态，也一并恢复。所有同步异常均走恢复分支。ID pass 不套 displayMaterials.render，正常视图和导出继续使用原流程。不得跨 await 留下临时材质。
5. **runtime 仅替换 pointerup 的 Raycaster 分支并接入失效/释放。** 保留 motion.pick 优先级和现有点击移动阈值。每次 pointerdown/新请求递增 pickRevision；捕获 content、相机姿态/视口、场景 revision 与项目/会话身份。读取完成前若发生新点击、对象树选择、编辑/undo/redo、导航、显式 seek/播放切换、重载、切项目或关闭，则丢弃旧结果，避免迟到命中覆盖当前选择；正常连续 playback-tick 允许按点击帧的命中选择对象并停止动画，不因 time 自然前进就使点击失效。重载与关闭释放 picker；有 pending read 时延后 target 释放，材质恢复不等待读取。关闭 renderer 前等待 pending read 完成，包括拒绝结果的收束，防止销毁 context 后读回异常。
6. **先限制缓存与并发，再考虑优化。** 同一 renderer 上每次临时状态交换须完整结束后才允许下一次；pending 读回的结果各自有映射和 buffer。连续点击可串行排队并只保留最新请求，避免共享 1×1 target 的生命周期混乱。切场景清空缓存；连续 add/delete/reload 验证缓存不会无限保留已删对象。此方案不新增依赖，也不改保存、导出或 Agent 公共接口。

不建议把 CPU UV 采样作为完整修复：即使 Mesh 有 intersection.uv，也还要处理 alphaMap 绿色通道、双 UV/纹理矩阵、滤波/mipmap、压缩纹理、点精灵、骨骼/形变与可见性/深度路径；单纯 `opacity < .05` 或扩展 Raycaster 到 Line/Points 只能覆盖部分样例。若另行采用这种方案，必须标注近似范围及未通过样例，不能称一比一。

## 验证与交付门槛

下列为完整交付的验证要求；独立目标测试与主任务真实 GPU 的已知进展另见末节，不能将计划项目全部视为已通过：

- **聚焦单元验证：** ID 编解码与空白/越界；材质数组与源材质不变；alpha shader 注入位置及 NoBlending；同步 render/异步 read 分别失败后的状态恢复；旧请求/关闭/重载失效；pending target 的单次释放与共享纹理不释放。这些验证不能证明 GPU 像素行为。
- **真实 WebGL QA：** 建独立合成场景，不使用用户场景或上传官方数据；覆盖上表实际支持类型，记录固定点击坐标、预期/实际 studioId、DPR、视口、Three 版本、GPU/浏览器及截图。至少包含 DPR=1/2、画布偏移/resize、移动自由视角后点选、动画中点选、快速双击与关闭迟到结果。0.05 的边界用无贴图 opacity uniform 测；纹理滤波的边缘单独记录，避免把量化后的纹理值称作精确 0.05。
- **状态与资源回归：** 同场景拾取前后普通预览和拍摄导出无 ID 色；ID pass 自身不改 revision、studioV2 保存内容或原材质/纹理，命中后的选择沿用现有 runtime.select 语义；渲染失败后仍能继续预览；多次重载/关闭 geometry、原材质与 picker 缓存释放正确。
- **对齐结论：** 测试结果应逐项写“源码规则已实现 / 本地 GPU 样例通过 / 官方有内容场景未比较”。只有 CPU 或 mock 测试时维持“待 GPU 验收”；复杂扩展材质未测时列出未覆盖范围。当前官方证据来自已捕获发布源码，不能据此声称各 GPU、各资产与官方交互已完整一比一。

## 真实 QA 后的 viewport 修正

主任务执行者的 DPR=2 WebGL QA 已报告 alphaMap、opacity 阈值及 MASK 样例通过；但初版机械采用官方 `setViewOffset(...,1,1)` 时，可见橙色 Point sprite 的点击命中后景。纯线/虚线的取整探针也曾 miss，需区分细线点击坐标与实际光栅像素是否重合，不能把所有 miss 都归因于同一缺陷。这些是主任务传回的本地观察，本文作者未执行浏览器验收，也未在官方有内容场景复现。

Point 的根因是先将相机视锥缩到一个像素后，GPU 会按点中心裁剪整个点图元；屏幕上可见的 sprite 区域不保证中心落在这一小视锥中。另有 DPR 陷阱：Three 的 renderer.setViewport/setScissor 即使在 offscreen target 上也会乘 pixelRatio，原先设置 `(0,0,1,1)` 在 DPR=2 变成 2×2 viewport。

最终落盘方案保持 **1×1 framebuffer + 完整相机视锥 + 平移的完整物理 viewport**，不分配整帧 target：

```text
W = canvas.width，H = canvas.height（实际 drawing buffer 像素）
px = floor(u * W)，py = H - 1 - floor(v * H)
target.viewport = (-px, -py, W, H)
target.scissor = (0, 0, 1, 1)，target.scissorTest = true
renderer.setRenderTarget(target)
readRenderTargetPixelsAsync(target, 0, 0, 1, 1, pixels)
```

整数平移使点击像素落在 target 的唯一像素上，保留完整视锥的点中心裁剪及点精灵 gl_PointCoord、线段光栅化相位。Three 原 Points size 使用 `material.size * pixelRatio`，scale 使用 renderer 的 CSS height/2；这些不会因 target 是 1×1 而缩小。直接配置 target.viewport/scissor 后 setRenderTarget 使用物理单位，避免二次乘 DPR。负 viewport origin 合法，宽高仍受设备 MAX_VIEWPORT_DIMS 限制，并沿用当前 renderer 的尺寸预算；实现没有另行 setSize(W,H)，resize 或高 DPR 不会额外分配/遗留完整帧缓冲。

每个异步读取持有独立像素数组与 ID 映射；已安装 Three 的 readRenderTargetPixelsAsync 在首次 await 前将该像素同步复制到本次 PBO。后续 viewport 平移不改旧读取的快照；dispose 等全部读取成功或失败后才释放 target，runtime.close 随后释放 renderer。自定义依赖 gl_FragCoord.xy 的 shader 会观察到平移后的坐标，属于明确未保证等价的范围；普通视图 MSAA 边缘与单样本 ID 像素也不能仅凭“看得见一点抗锯齿颜色”推断命中必然相同。

独立已通过的目标包括：标准 Mesh/Line/Points shader 注入及材质数组、源材质原地更新、同步 render/异步 read 失败后的恢复、pending drain 与 close 顺序、自由视角/投影/视口失效、连续播放点击语义、真实 skinned/morph 对象及原顶点 shader 保留。viewport 修正后又仅复跑标准 shader/物理 viewport 和 skinned/morph 两项，2/2 通过；它们使用真实 Three 对象和 renderer fixture，不证明 GPU 光栅结果。Point 可见区域与细线的修正后实际 GPU 复测见下节。

这是为功能契约修正官方发布源码方案的本地偏差，**不是算法逐字一致**。alpha 阈值、Mesh/Line/Points 范围、相机辅助映射、关键点优先级、单节点返回及恢复/生命周期契约保留；不宣称官方所有设备或特殊资产已完整一比一。

## 主任务实际 GPU 复验（2026-10-03）

入口为 `src/features/studio-v2/qa/picking-main.html?session=gpu-picking-live-1003`，正式 SceneRuntime/ScenePicker、真实 trusted pointer、独立 IDB JSON 场景。合成几何不等于官方资产或生产 GLB 导入保存验证。环境：Three r186、Chrome 154、ANGLE Metal Apple M5，1280×720 CSS 视口；DPR 2 的 drawing buffer 为 2560×1440，另用 DPR 1 与正交投影检查。

- 最终方案：alpha 0.049 命中后景；0.05、0.051 命中前景。透视和正交的透明孔命中后景、实体命中前景，空白清除选择；alphaMap 绿色通道与 MASK 的两个分支已取得初版真实 GPU 证据，其 shader 保留路径未改变。
- Line 与虚线 DPR 1 在实际光栅整数行 `[439,284]` / `[348,441]` 命中。DPR 2 原始细线落在工具无法发出的半 CSS 像素，不能把表格四舍五入当真实命中；QA 专用按钮仅将合成线 Y 微移至整数指针对应的物理像素中心，未扩大生产线宽或改变预期。最终 DPR 2 线 `[439,284]`、虚线实段 `[348,441]`、空档 `[392,441]`、点中心 `[828,360]` 与透明角 `[848,380]` 全部命中预期 ID，空白 `[640,655]` 为 null。
- morph 与 skin 的变形实心区域分别选中原对象；透明孔与形变前位置选中后景，共六项通过。初始 fixture 的 PlaneGeometry 参数 JSON 丢失追加属性，已改真实 BufferGeometry 并校验完整回读顶点后才执行验收；不将初始错误样例记作生产失败。
- 相机辅助机身映射为 `qa-camera`，遮挡面选为前景，空白清除。辅助轮廓单独命中尚未验收，不能由机身通过推出。
- 连续播放中真实点击时 `playing=true/time=0.8755`，返回 `qa-animated`，随后 `playing=false/time=0/index=-1`；保留点击帧语义。因目标移动，QA 的静态邻近探针 match 为 null；以真实选中 ID 与播放前后状态记录结论。

源码专项 13 项及受影响 21 项通过，独立复核关闭材质原地变更缓存、导航迟到结果和播放守卫过严三个问题。真实 GPU 页面最终无 fixture 错误；早期本地 Meshopt WASM 被 QA CSP 阻止，fixture 增加与生产一致的 `wasm-unsafe-eval` 后消失，没有开放普通 JS unsafe-eval。

本机截图：`/tmp/freenow-gpu-hole-final-20261003.png`、`/tmp/freenow-gpu-lines-points-final-20261003.png`、`/tmp/freenow-gpu-deformation-20261003.png`。原始分阶段诊断（含修复前失败记录）在 `/tmp/freenow-gpu-picking-evidence-20261003.json`；临时标签已关闭。普通预览在点选后保持真实材质颜色；本次没有重新拍摄视频，视频导出不作为本批新实机证据。

仍未验：任意自定义 shader/gl_FragCoord、transmission 与特殊压缩材质、所有 MSAA 边缘、全部设备、复杂大场景性能、实际关闭时 GPU 错误及相机辅助线/关键点重叠的完整浏览器矩阵。生命周期与关键点优先级有定向代码测试，不替代上述 GPU 状态验收。
