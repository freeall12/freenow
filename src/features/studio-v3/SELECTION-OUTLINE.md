# Selection / hover silhouette 合同

`selection-outline.mjs` 直接转译官方 WorkspaceViewfinder 的 inverted-hull 轮廓管线。它用真实 mesh 的外向法线扩张背面，保留骨骼、morph、batching、实例变换及深度遮挡；不生成 bbox，也不复制模型几何。无需新增依赖，不加载或执行官方 bundle。

## API 与集成顺序

```js
const selection = createSelectionOutline({scene, camera, presentation: 'selection'});
const hover = createSelectionOutline({scene, camera, presentation: 'hover'});
const outlineTarget = record => record.cameraMarker?.outlineTarget || record.root;

selection.setObjects(selectedRecord ? [outlineTarget(selectedRecord)] : []);
hover.setObjects(hoverRecord ? [outlineTarget(hoverRecord)] : []);

// 仅普通编辑 viewport：先写入实体与地面主 pass 的颜色/深度。
renderBaseAndGround();
hover.render({renderer, camera: activeCamera, outputTarget: null});
selection.render({renderer, camera: activeCamera, outputTarget: null});
renderEditorOverlays();

hover.dispose(); selection.dispose(); // 先于借用实体/scene 的释放
```

photographic capture 与 plan profile **不执行**上述轮廓 pass，这是官方 `_l/Ei/bi/Jt` 的分支。主线负责 profile 调度；模块只提供独立 pass。单独从 renderer 主 pass 中隐藏 guide，不足以自动禁用 actor/prop 轮廓 pass。

| 方法 / 字段 | 合同 |
| --- | --- |
| `createSelectionOutline({scene,camera,presentation,color,edgeWidthCssPx})` | 借用 Three Scene/Camera；presentation 默认 selection；color 默认 #ff6b00；width 默认由 profile 决定 |
| `setObjects(roots)` | 接受 Object3D 数组；去重并仅保留 `.visible=true` 的 root；给新增 root 下所有 isMesh 打开本 pass layer，移除 root 时关闭 |
| `render({renderer,camera,outputTarget})` | 无对象或已释放返回 false；执行成功返回 true；camera 可替换此前相机；outputTarget 默认 null；失败重抛且恢复借用状态 |
| `dispose()` | 幂等关闭当前 roots 的本 pass mesh layer，清空 membership，释放独占 shader material |
| `material / uniforms / layer / edgeWidthCssPx` | 主线调试与配置的实际 pass 数据 |
| `selectedObjects / camera / disposed` | getter；对象数组返回副本，避免调用者意外破坏 membership |

scene/camera、presentation、正有限 CSS width 与 Object3D 输入在边界验证。已 dispose 的 setObjects/render 返回 false。

相机必须传 `cameraMarker.outlineTarget`（iconRoot），所以 frustum 的 LineSegments2 不进入 silhouette。actor/prop 传真正的 renderable root；同一个 pass 支持多个实体。host 应在加载完成、切实体/selection/hover、实体隐藏、重建模型或切场景时刷新 membership。和原 `ll` 一样，已注册 root 的子 mesh 结构应稳定；传入 roots 应互相独立，不同时传同一实体的祖先与子 root。

## 官方算法

selection：layer 6，3 CSS px；hover：layer 7，2 CSS px；两者都是 `16739072`（#ff6b00）。两个实例材质独立，对同一 mesh 可同时启用两层；清理 selection 不影响 hover 或原 layer 0/5。layer 6/7 为这两个 pass 的保留层，每种 presentation 在一个 scene 内应只有一个 owner。

材质：`ShaderMaterial`，name=`WorkspaceSelectionSilhouetteMaterial`，BackSide、NoBlending、LessEqualDepth、depthTest=true、depthWrite=false、clipping=true、toneMapped=false、transparent=false。

vertex shader 包含 Three 的 morphinstance、batching、normal、morphnormal、skinnormal、morph-position、skinning-position、project、log-depth 与 clipping chunks。先抵消 BackSide 带来的 `FLIP_SIDED` normal 翻转，保留资产原来的 outward normal，然后计算：

```glsl
vec4 neighborClip = projectionMatrix * vec4(
  mvPosition.xyz + normalize(transformedNormal), 1.0
);
vec2 positionNdc = gl_Position.xy / max(abs(gl_Position.w), 0.000001);
vec2 neighborNdc = neighborClip.xy / max(abs(neighborClip.w), 0.000001);
vec2 direction = neighborNdc - positionNdc;
float directionLength = length(direction);
if (directionLength > 0.000001) {
  direction /= directionLength;
  gl_Position.xy += direction * thicknessPx * 2.0 / resolution * gl_Position.w;
}
```

fragment shader 使用固定 outlineColor，应用 log-depth / clipping 后输出 alpha=1，并通过 colorspace_fragment 输出屏幕色。轮廓沿模型真实外形扩张，而不是把模型包围盒投影到屏幕。

canvas pass：resolution=`renderer.domElement.width/height`（drawing-buffer pixels），thicknessPx=max(1,CSS width×renderer.getPixelRatio())。outputTarget pass：resolution=target.width/height，pixelRatio=1，避免把离屏尺寸再乘 DPR。与官方 `pn` 一致，不以 CSS canvas size 或独立 bbox 尺寸近似。

渲染复用同一 scene，暂置 background=null、overrideMaterial=本 shader、camera.layers=单独本 pass layer、autoClear=false，并设定目标 target；复用此前主 pass 的颜色和深度，不调用 clear/clearDepth。`finally` 恢复原 camera mask、scene background/overrideMaterial、renderer autoClear 和 renderTarget。保留主 pass 深度才能让前方实体遮住后方 silhouette。

shader 两份原模板与本地字符串已逐字节比较，完全一致：

- vertex SHA-256：`d2c20089715c9ec2cb595a52c0d7009601e7f912fed36e3769b5a2451d7b2703`
- fragment SHA-256：`8279d8c8648be0bfc7221eadf441d04e86d24a690ef993d96b80ade3fea7b8e4`

## 所有权与验证边界

模块仅拥有一份 shader material；借用实体的 geometry/material/texture/skeleton、scene、camera 与 renderer/outputTarget。setObjects 不替换实体材质、不 reparent；dispose 不释放模型和 render target。调用者需先 dispose 两个 outline pass，再释放实体或 scene。

定向测试：

```bash
node --test tests/studio-v3-selection-outline.test.cjs
```

2026-10-08：5 tests passed。覆盖官方 shader 完整 hash/材质策略、本地 Three 的 24 个递归 shader chunks 全部可解析、mesh layer membership 与 hidden/dedupe、selection/hover 独立清理、camera icon target 排除 frustum、真实 Three skinned/morph/instanced mesh、drawing-buffer/target/DPR 参数、相机替换、渲染失败状态恢复及资源释放归属。

这些测试使用真实 Three 数据对象与 renderer 状态 spy，未创建 WebGL context；它们不声称 GPU shader compilation、像素外观、深度遮挡实际画面或主线 hover 输入已完成视觉验收。主线集成后仍需浏览器检查：camera/actor/prop silhouette，选中/悬停切换，前后遮挡，骨骼变形，canvas DPR，以及 photographic/plan 排除。

## 直接来源

官方本地路径均位于 `/Applications/TapNow.app/Contents/Resources/web/assets/`。offset 为解码 JS string 的零基字符位置，不是 byte offset。

| 源文件 / symbol | offset | 内容 |
| --- | ---: | --- |
| WorkspaceViewfinderButton-BHqIWibq.js `$t` | 12972 | scene override、独立 layer pass、try/finally state restore |
| 同文件 `ir/Ca/Ma/Aa/Da/sl` | 13362 | orange、3px/2px、selection6/hover7 |
| 同文件 `cl / ll / pn / ul / Ft / Ia` | 13447 / 13716 / 13935 / 14335 / 14448 / 14537 | pass 创建、membership、分辨率/线宽、释放、mesh layers、完整 GLSL |
| 同文件 `_l / Jt / Ti / Ci / Mi / Ai` | 41745 / 42951 / 43712 / 44175 / 44289 / 44390 | profile、实体/地面/轮廓/overlay 顺序；Ci 先 hover 再 selection |
| ThreeDWorkspace-BzPphAqB.js `Uh/Ls` 调用 | 144757 / 144780 | selected silhouette 实例与 roots；第二实例用 hover profile |
| 同文件 `Kh` 调用 | 150120 / 150127 | 两个 pass 独立释放 |
| 同文件 `OH` | 485419 | 相机 outlineTarget 明确为 iconRoot |

WorkspaceViewfinderButton SHA-256：`4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0`；ThreeDWorkspace SHA-256：`85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`。

材质 import alias 解析追到同安装包 index-BsHyQ2qj.js：`l0→K1=1`（BackSide，2620995）、`l1→xN=3`（LessEqualDepth，2621216）、`l2→vm=0`（NoBlending，2621005）。没有借用其他应用或在线页面作为视觉/算法参考。

本批主线已通过真实浏览器看到角色的橙色轮廓，截图见 [Computer Use 证据](../../../docs/verification/20261008-studio-shots.md)。此证据不覆盖所有 camera/prop、遮挡、骨骼变形、DPR 与 hover 组合。
