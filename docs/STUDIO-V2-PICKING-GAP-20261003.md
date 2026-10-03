# 新版片场透明区域与线/点拾取缺口（2026-10-03）

状态：源码核对与最小方案，待实现和真实 GPU 验收。本批只补充本文，未修改拾取代码、启动浏览器或引入依赖。

依据唯一官方参考 `reference/studio-v2.md`，发布版 `eb1c3578957450302e3cff5edd2ad253d0874421`：

- `reference/studio-v2-page-readable.js:1992–2046` 的 `It` 使用 1×1 render target、克隆相机视口偏移与 GPU ID 颜色拾取。
- `2004–2010` 克隆原材质，保留标准材质纹理与形变路径，在片元着色器末尾追加 `diffuseColor.a < 0.05` 的 discard。这里只能断言到达这一步且 alpha 小于阈值的像素不阻挡后方物体；原材质的 alphaTest 等规则仍可能提前丢弃片元。
- `2022–2027` 覆盖 Mesh/Line/Points，包含相机辅助层。
- `2030–2046` 恢复原材质/可见性/渲染状态；异步读取与关闭释放有生命周期保护。
- `2674–2689` 调用方先拾运镜关键点，再拾内容/相机辅助层，通过 revision 丢弃迟到的旧结果。

当前生产 `src/features/studio-v2/runtime.mjs` 的 pointerup 仅遍历 visible Mesh，取 Raycaster 第一命中。它不会用贴图最终 alpha 排除透明孔；GLB 导入的纯 Line/Points 无法通过世界视图点选。用户仍可通过对象树选择；该差异是交互缺口，不是仅技术方案不同。

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
4. **复用当前 renderer，同步执行交换/绘制/发起读取，再立即 finally 恢复。** 克隆相机并以 drawing buffer 的实际宽高做 setViewOffset，CSS 相对坐标检查 0≤u,v<1；不修改自由视角相机。保存并恢复原材质、顶层可见性、background、shadowMap.enabled、render target、viewport、scissor/scissorTest、clearColor/clearAlpha；若方案修改其他 renderer 状态，也一并恢复。所有同步异常均走恢复分支。ID pass 不套 displayMaterials.render，正常视图和导出继续使用原流程。不得跨 await 留下临时材质。
5. **runtime 仅替换 pointerup 的 Raycaster 分支并接入失效/释放。** 保留 motion.pick 优先级和现有点击移动阈值。每次 pointerdown/新请求递增 pickRevision；捕获 content、相机姿态/视口、场景 revision 与项目/会话身份。读取完成前若发生新点击、对象树选择、编辑/undo/redo、导航/播放改变姿态、重载、切项目或关闭，则丢弃旧结果，避免迟到命中覆盖当前选择。重载与关闭释放 picker；有 pending read 时延后 target 释放，材质恢复不等待读取。关闭 renderer 前应等待 pending read 结束或用明确的取消/失效路径收束，防止销毁 context 后读回异常。
6. **先限制缓存与并发，再考虑优化。** 同一 renderer 上每次临时状态交换须完整结束后才允许下一次；pending 读回的结果各自有映射和 buffer。连续点击可串行排队并只保留最新请求，避免共享 1×1 target 的生命周期混乱。切场景清空缓存；连续 add/delete/reload 验证缓存不会无限保留已删对象。此方案不新增依赖，也不改保存、导出或 Agent 公共接口。

不建议把 CPU UV 采样作为完整修复：即使 Mesh 有 intersection.uv，也还要处理 alphaMap 绿色通道、双 UV/纹理矩阵、滤波/mipmap、压缩纹理、点精灵、骨骼/形变与可见性/深度路径；单纯 `opacity < .05` 或扩展 Raycaster 到 Line/Points 只能覆盖部分样例。若另行采用这种方案，必须标注近似范围及未通过样例，不能称一比一。

## 验证与交付门槛

本批仅完成源码核对。下列是实现后的验证计划，均未在本批执行：

- **聚焦单元验证：** ID 编解码与空白/越界；材质数组与源材质不变；alpha shader 注入位置及 NoBlending；同步 render/异步 read 分别失败后的状态恢复；旧请求/关闭/重载失效；pending target 的单次释放与共享纹理不释放。这些验证不能证明 GPU 像素行为。
- **真实 WebGL QA：** 建独立合成场景，不使用用户场景或上传官方数据；覆盖上表实际支持类型，记录固定点击坐标、预期/实际 studioId、DPR、视口、Three 版本、GPU/浏览器及截图。至少包含 DPR=1/2、画布偏移/resize、移动自由视角后点选、动画中点选、快速双击与关闭迟到结果。0.05 的边界用无贴图 opacity uniform 测；纹理滤波的边缘单独记录，避免把量化后的纹理值称作精确 0.05。
- **状态与资源回归：** 同场景拾取前后普通预览和拍摄导出无 ID 色；ID pass 自身不改 revision、studioV2 保存内容或原材质/纹理，命中后的选择沿用现有 runtime.select 语义；渲染失败后仍能继续预览；多次重载/关闭 geometry、原材质与 picker 缓存释放正确。
- **对齐结论：** 测试结果应逐项写“源码规则已实现 / 本地 GPU 样例通过 / 官方有内容场景未比较”。只有 CPU 或 mock 测试时维持“待 GPU 验收”；复杂扩展材质未测时列出未覆盖范围。当前官方证据来自已捕获发布源码，不能据此声称各 GPU、各资产与官方交互已完整一比一。
