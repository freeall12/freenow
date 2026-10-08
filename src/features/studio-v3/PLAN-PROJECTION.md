# Studio V3 平面图投影与本地导航

`plan-projection.mjs` 提供不依赖 Three/DOM 的投影快照、屏幕反解、平移换算和剖切 slider；`plan-navigation.mjs` 只管理当前 viewport 的局部导航值。它们不接受作者状态、相机实体、历史或持久化回调，也没有网络、存储和领域写入。

依据：[完整平面图源码合同](../../../docs/research/STUDIO-V3-PLAN-20261008.md) 与本机 `/Applications/TapNow.app/Contents/Resources/web/assets/WorkspacePlanView-HeQ7o6cq.js` 中 `Lt/Nn/jn/xt/Ot/vr/kr/Cr/Sr/Ar/xr/yr`；角度规范化核对同安装包 `course-api-base-url-CGXqZmAy.js` 的 `xdt`。只静态阅读官方源码，不执行安装包模块。

## 投影合同

```js
const projection = createPlanProjection({
  bounds: {min: {x: -2.5, y: 0, z: -6}, max: {x: 2.5, y: 3.2, z: 6}},
  width: 560, height: 420, groundY: 0,
  pan: {x: 0, z: 0}, zoom: 1, rotation: 0, sectionHeight: 1.6,
});
const screen = projectPlanPoint(projection, entity.position);
const moved = unprojectPlanPoint(projection, {nx: .4, ny: .6}, entity.position);
const delta = planPanDelta(projection, {dx: 31, dy: -17});
```

返回 plain object：`{width,height,target,right,down,forward,halfWidth,halfHeight,cameraPosition,near,far,zoom,rotation,sectionHeight}`。输入 bounds/pan 不会被引用或修改。width/height 默认 560/420，必须有限且大于零，输出 round 且至少 1；bounds 三轴有限、min≤max，零体积仍以最小 half-size `.1` 成像。无效 bounds、viewport 和导航值抛 TypeError，几何计算溢出抛 RangeError；host 应进入真实失败态。

- basis：right=`(cosθ,0,sinθ)`、down=`(-sinθ,0,cosθ)`、forward=`(0,-1,0)`。target 为 bounds 的 x/z 中心加 pan，y=groundY。
- 八角点范围按旋转 basis 计算，再 padding `1.1` 和 viewport aspect fit；half-size 除 zoom。zoom 限 `.5..3`，rotation 用 `atan2(sinθ,cosθ)` 规范化。
- camera distance=`max(50,maxY-groundY+10)`。原 near/far 按八角点 depth，加 padding `2`，near≥`.01`、span≥`.5`。
- section 非 `all`：near=`clamp(distance-height,originalNear,far-.5)`；far 保持。负高度归零，非有限高度在创建时回落 1.6；`all` 使用原 near。真实 renderer 用 near 截去上部几何，marker 投影不按 section 隐藏。
- `projectPlanPoint` 返回 `{x,y,nx,ny,inView}`；inView 的 normalized 余量为 `-.08..1.08`。无有效 projection/point 或计算溢出返回 null。
- `unprojectPlanPoint` 返回 `{x,y,z}`，默认 y=target.y，传 anchor 时只保留 anchor.y；可传 `{y}`。屏幕坐标允许超出 viewport，无效输入返回 null。它不做支撑面查询；新增落地应由 host 接既有 surface resolver。
- `planPanDelta` 返回 world `{x,z}`；正 pointer delta 令画面内容同向移动。输入使用当前已显示的 projection，旋转和 zoom 都已包含在 basis/half-size。无效输入返回 `{x:0,z:0}`。

section slider 为非线性双向映射：`sectionSliderValue(h)=h/(h+1.6)`；`sectionHeightFromSlider(u)=1.6*u/(1-u)`；u=1 对应 `all`。负数归零，slider clamp 0..1，非有限输入归零。

## 导航合同

```js
const navigation = createPlanNavigation();
navigation.zoomBy(1.12);              // 放大；缩小用 1 / 1.12
navigation.rotateBy(Math.PI / 12);    // 点按左旋；右旋用负值
navigation.panBy(planPanDelta(displayedProjection, {dx, dy}));
navigation.setSection('all');
const changed = navigation.tick(dtSeconds);
const {pan, zoom, rotation, sectionHeight} = navigation.read();
```

`read()` 和只读 `current/target` 均返回脱离内部引用的 `{pan:{x,z},zoom,rotation,sectionHeight}`。初值 pan=0、zoom=1、rotation=0、section=1.6。`active` 表示 current 尚未收敛 target，用于请求后续渲染帧；它不是输入权限或视图激活开关。

| 方法 | 合同 |
| --- | --- |
| `zoomBy(factor)` | target 乘正 finite factor，限 `.5..3`；current 在 tick 中跟随 |
| `rotateBy(radians)` | finite delta 加 target，规范化角度；tick 沿最短角差跟随 |
| `panBy({x,z},{syncCurrent=true}={})` | 相对当前 pan 更新 target；默认同步 current，符合官方拖动；设 false 才阻尼跟随。delta 和结果必须 finite |
| `setSection(height)` | `all` 或 finite 数字；负数归零，非有限值保留原值；立即同步 current/target |
| `tick(dt)` | 秒，finite且>0，clamp `.08`；zoom/pan/rotation 阻尼 12/10/14；snap ε `.0005`，pan 两轴一起判断，rotation 先判断旧角差。返回实际 current 是否变化 |
| `reset()` | 立即重置 current/target 和剖切高度1.6，清除待收敛变化 |

各 mutation 返回是否修改了内部值；非法请求返回 false。导航工厂不安装监听，不持有 renderer，相机或作者 state；多个工厂彼此独立。host 负责 pointer/wheel/key 分类、权限、输入 owner、退出和 scene revision，旋转拖动用官方 `-dx*.008`，arrow 每次 42px。官方 pointer drag 可将“从 pointerdown 算出的总 delta”先相对保存的初始 pan 转成目标值，再换成相对当前 pan 的 delta 传入。

**渲染成功后才保存 displayedProjection。** 同一快照必须用于 SVG、命中、已有实体保高度反解和 pan 换算。navigation.target 不是屏幕当前值；render 失败或场景来源变化应由 host 清旧快照，不能继续用其命中。runtime 使用 projection 给独立 OrthographicCamera 设置 position、up=`-down`、lookAt(target)、near/far 和 half-size；不改现场 PerspectiveCamera。

## 验证范围

专项执行：

```sh
node --test tests/studio-v3-plan-projection.test.cjs tests/studio-v3-plan-navigation.test.cjs
```

2026-10-08 一次专项执行 **21/21 通过**。覆盖旋转/aspect/zoom/pan 往返、保 anchor y、真实 room near 剖切、marker 高度不筛选、pan 画面位移一致、invalid/overflow、非线性 slider、导航 clamp/damping/shortest arc/dt/reset、快照隔离和独立 viewport。此处仅是纯模块合同；真实场景 renderer profile、成功快照发布、原生输入和 UI 需由主线集成并另验收。
