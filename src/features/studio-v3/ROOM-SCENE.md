# 真实房间场景

`room-scene.mjs` 是房间资源适配器，不创建 renderer、摄像机、场地状态或历史事务。使用项目现有 Three，不新增依赖。

```js
import {createRoomScene, disposeRoomScene} from './room-scene.mjs';

const room = createRoomScene({config: state.scenePlay.worldSpace.roomConfig, groundY});
renderGraph.worldRoot.add(room);
const worldBounds = room.userData.bounds.clone().applyMatrix4(room.matrixWorld);

// 来源、尺寸、参考图案或 groundY 变化时，由宿主替换资源。
renderGraph.worldRoot.remove(room);
disposeRoomScene(room);
```

## API 与真实几何

`createRoomScene({config, groundY = 0})` 返回 `THREE.Group`，含真实 floor、ceiling 和四面 wall，各自是 `PlaneGeometry`。宽深围绕 x/z 原点居中，floor 位于 `groundY`，ceiling 位于 `groundY + height`，四墙中心位于 `groundY + height / 2`。六面法线指向室内，材质为官方 `FrontSide` 的 `MeshStandardMaterial`，并非空白网格或替代平面。

`config` 必须是完整合法 roomConfig：width/depth 1..100m、height 2..20m；trackingGuides 的 enabled/lineMarkers 是 boolean，mode 为 white/standard/calibration，spacingMeters 为 .25/.5/1/2。非有限数及未知字段在资源分配前拒绝。`groundY` 是宿主现场坐标，不加入 roomConfig 或作者状态。

`room.userData` 提供以下可检查字段：

| 字段 | 含义 |
| --- | --- |
| spaceSource | `{kind: 'mesh-preset', preset: 'room'}` |
| roomConfig | 完整配置的独立 JSON 副本 |
| groundY | 场地实际地面高度 |
| bounds | `THREE.Box3`，从六面真实几何计算；局部 root 坐标；capture 时转换 min/max 数组或对象 |
| surfaceCount | 6 |
| disposed | 是否已回收本模块资源 |

bounds 在添加参考线前计算。后续添加的 camera helper、灯光或其他外部 child 不改变它；宿主转换到世界坐标时应 clone 后 applyMatrix4，不改此源 bounds。浮点几何坐标可能有微小精度误差。

## 官方静态来源与图案

依据 `docs/research/STUDIO-V3-PLAN-20261008.md`、本机官方 `ThreeDWorkspace-BzPphAqB.js` 的 sx/MO/AO/Us/um/zO/HO/VO/LO/NO，以及 `index-BsHyQ2qj.js` 的常量 export。官方代码没有在本模块执行，也没有下载图案图片。

standard/calibration 使用 64×64 RGBA `DataTexture`，按官方棋盘与校准 L 形标志逐像素生成；RepeatWrapping，mag=NearestFilter(1003)，min=LinearMipmapLinearFilter(1008)，SRGB，anisotropy 8，启用 mipmaps。每面 repeat 为 `max(1, 面宽或面高 / (spacingMeters * 2))`。全白模式禁用图案与参考线，roughness .82；standard/calibration 开关关闭时是官方灰色 7895160/roughness .9。

lineMarkers 开启时添加真实 12 条边缘 CylinderGeometry，以及 x/y/z 三组 InstancedMesh 标线。轴色分别为官方 16724016、2283119、3108351；辅助标线不参加 raycast。全白模式始终隐藏这些标线。

## 资源生命周期

`disposeRoomScene(group)` 返回是否找到并释放该 room 的自有资源，第二次或传入外部 group 返回 false。模块用 WeakMap 记录自己创建的 geometry/material/texture/instanced mesh，逐个释放一次；不遍历并释放调用方附加的 child，不处理共享 renderer/scene，也不从父级移除 room。宿主须先 remove，再 dispose，并在新来源 graph 就绪前取消旧投影和交互事务。

## 验证与限制

`node --test tests/studio-v3-room-scene.test.cjs tests/studio-v3-space-actions.test.cjs`：13/13 通过。专项覆盖真实六面及 ground 偏移、室内法线、真实 Box3、图案像素/滤波/repeat、白色/关闭模式、三轴实例标线、外部 helper 排除和资源只释放一次。

这些是 geometry/资源专项证据，不能代替宿主 GPU、剖切、来源切换和现场/俯视完整浏览器验收。剖切仍由 plan near/far profile 实现，room 不承担摄像机逻辑；其他 GLB/SPZ 场景仍由既有资源适配器加载。
