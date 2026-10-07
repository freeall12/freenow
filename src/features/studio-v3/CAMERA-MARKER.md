# Camera marker：官方身体、短视锥与选择目标

`camera-marker.mjs` 只创建本地 Three 编辑辅助对象，不加载模型、不访问网络、不写领域状态。算法静态转译自安装包；没有执行官方 bundle。现有 `three` 和其 `addons/lines` 足够，无新增依赖。

## 调用与目标

```js
const marker = createCameraMarker({
  assetRoot: loadedAsset.root, // 已解码官方 camera.glb 的 raw scene
  entityId: 'camera-1',
  color: '#3388cc',
  selected: false
});
scene.add(marker.root);
marker.update({camera: setupState, color: entityAccent, selected, visible: setupState.visible,
  transformPreviewActive: draggingCamera});
marker.dispose();
loadedAsset.dispose(); // 原资产仍由调用者负责
```

| 返回值 | 对象与用途 |
| --- | --- |
| `root` / `transformRoot` | optical world pose、单位 scale；变换拖拽对象 |
| `bodyRoot` / `transformPivot` | local Z=+.13 的身体；变换 pivot |
| `iconRoot` / `outlineTarget` / `pickTarget` | 独立相机图标；选择轮廓和拾取目标 |
| `frustumRoot` | 光学原点的短视锥两条线 |
| `update(options)` | 成功返回 true；已 dispose 返回 false |
| `dispose()` | 幂等释放 helper 自有资源，并从父对象移除 root |

`update.camera` 接受 raw optical camera config，或完整 `{camera, transform}` setup state。完整 state 的 pose 优先取 `camera.position/rotation`；缺省使用 `transform.position` 与既有 `planRotationToCamera(transform.rotation)`。raw config 缺少 pose 时使用原点与零旋转。rotation 保留 Euler order，默认 XYZ。pose 更新总是强制 root scale=(1,1,1)，忽略实体 scale。`transformPreviewActive=true` 时不覆盖 root position/rotation/scale，仍更新短视锥、颜色、selected、visible 和 world matrices。

这是同步 patch 接口：省略 `camera/color/selected/visible` 保留此前值，`color:null` 明确恢复官方默认身体色；官方 PH 的 host 每次传入完整当前状态，本地集成可采用同一路径。有限 pose、有效 Euler order、正有限 aspect 与 (0,180) 范围 FOV 在改变可见状态前验证；错误抛出 TypeError，保留此前 pose/geometry。调用者需先使用现有 optics 模块算好 FOV，marker 不进行 focal-length 转换。

## 几何、材质与层

```text
director-camera:<entityId>                 optical pose，scale=1
├─ director-camera-frustum                 local origin，helper layer 5
│  ├─ director-camera-outline-line         LineSegments2，renderOrder 20
│  └─ director-camera-stroke-line          LineSegments2，renderOrder 21
└─ director-camera-body                    local position.z=.13
   └─ director-camera-icon                 local rotation.y=π/2
      └─ director-camera-icon-normalized   longest AABB axis=.25，center=0
         └─ raw GLB scene 的节点 clone
```

归一化先把 raw clone 放入 normalized Group，读取 world AABB，统一 scale=.25/maxDimension；缩放后重新读取 center，再从 normalized.position 减去 center。空 bounds 或最长轴≤1e-4 时保持原样。bounds 读取沿用 Xc 的可见 renderable / skinned bounds / object-bounds fallback，不以主体偏移或视锥改变归一化尺寸。

短视锥使用 4 个远端矩形边和 4 个从原点连接角点的边，共 8 segments；两条线使用相同 endpoint 数据但独立 geometry/material：

```text
distance=.18                    far Z=-.18
halfHeight=min(tan(FOV/2)*.18, .04125)
halfWidth=min(halfHeight*aspect, .07125)
default FOV=50°                 default aspect=16/9
```

每个 GLB mesh 替换为独占 `MeshStandardMaterial`，不保留纹理：metalness=.06、roughness=.78、envMapIntensity=.18、DoubleSide、depthTest/depthWrite/toneMapped=true、renderOrder=22、frustumCulled=false。默认身体与内线色为 `15399156`（#eaf8f4）。未选中外线是当前身体 linear RGB×.58；选中外线为 `16739072`（#ff6b00），身体与内线仍保持 entity accent。颜色更改也更新独占身体材质。

普通 outline/stroke CSS widths=1.7/.9，选中=2.4/1.05。各 LineSegments2 的 `onBeforeRender(renderer)` 读取 `getViewport()` 的宽高作为 material.resolution，并令 linewidth=CSS width×getPixelRatio()，与原 `tu/rp` 一致。主线渲染无需额外调用 linewidth 更新。

所有节点始终只在 layer 5，selected 不切 layer。为适配本地 runtime，所有节点增加 `userData.helper/captureExcluded=true`，groups 保留 `worldEntityId` 并添加 `entityId`；这些本地标签不冒充原函数字段。选取需明确使用 `pickTarget` 并让 pick raycaster 检测 layer 5。导航相机需 enable(5)；拍摄/optical view 的 layer/guide 策略由主线负责。此模块不加入距离阈值隐藏逻辑。

## 资源所有权与失败

- caller 持有 raw GLB、原 mesh geometry、原 material、texture。marker 仅 clone 节点，geometry 与原资产共享；不移动原 root，也不释放这些原资源。
- marker 持有所有新身体材质、两份 line geometry 和两份 line material。`dispose()` 只释放这些对象；被 clone 的原 texture material 已由替换断开，不接管所有权。
- 创建中 clone/normalization/material 替换/update 抛错时，清理此前分配的 line geometry/material 与身体 material，清空 helper 节点并重抛错误。失败不释放 caller 的原模型。
- 成功后必须先 dispose marker，再 dispose raw loader result；原 geometry 被释放后，不应继续渲染其 marker clone。

## 验证

只运行新增独立测试：

```bash
node --test tests/studio-v3-camera-marker-helper.test.cjs
```

2026-10-08：5 tests passed。覆盖真实官方 GLB hash/几何与 caller ownership、完整八边短视锥与 aspect/FOV clamp、两层 LineSegments2 及 viewport/DPR、layer5/material、选中与未选中颜色、finite optical root/pivot、transform preview、invalid update 的状态保留、幂等 dispose，以及已分配身体材质后失败的 cleanup。

Node 只为 GLB 内嵌 PNG 提供尺寸 metadata shim，测试不是 GPU 渲染或真实纹理视觉验证。本文件没有声称浏览器画面、官方实际运行效果、主线 transform/pick/capture 集成已经验收；这些由主线后续验证。

## 直接来源

原始 UTF-8 文件：`/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`。

SHA-256：`85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`。下列 offsets 为解码 JavaScript string 的零基字符位置，非 byte offsets。

| 官方 symbol | offset | 转译内容 |
| --- | ---: | --- |
| `tu / rp` | 479946 / 480022 | 渲染前 viewport/DPR 同步 |
| `vH / SH` | 480119 / 480353 | 光学短视锥截面与八条 segment |
| `io / kH` | 480832 / 481024 | 资产、材质参数、独占 icon 与色更新 |
| `CH / EH / RH / ab` | 481505 / 481596 / 481948 / 482247 | 缓存资产边界、归一化、材质替换、layer |
| `IH / it / TH` | 482311 / 482322 / 482553 | 身体偏移、常量与树结构 |
| `PH / BC / MH / AH` | 483667 / 483907 / 484098 / 484327 | pose 优先级、preview、optics 与 selected |
| `jH / DH / Gm` | 484605 / 484780 / 484885 | accent、默认色与未选中外线颜色 |
| `ib / Oc / sb / _H / OH` | 484937 / 485037 / 485103 / 485305 / 485419 | line、layer、endpoint 写入、同步与独立目标 |

ThreeDWorkspace 的 import alias 还需要追到同一个官方安装包中确认常量：`WorkspaceViewfinderButton-BHqIWibq.js` 的 `ir=16739072`（offset 13362，export bd→fA）、`Ht=16/9`（50477，export aJ→Gp）；`index-BsHyQ2qj.js` 的 `yp=2`（2621000，export ex→Wi，DoubleSide）；`world-object-spatial-metrics-B9CCwPzJ.js` 的 `M=5`（63，export a→fo），以及 `z/c` bounds 函数。它们只用于解析官方主文件引用的字面常量与 bounds，不运行/import 任何官方 bundle。

本地 `assets/studio/camera.glb` 与官方 `web/assets/world-model/director/camera.glb` 一致：14948 bytes，SHA-256=`00f5a46007aee91cf8a9accd2584ad83b7dc3ce2396c1dd325ff61c3304004e7`；测试直接检查这个原资产。
