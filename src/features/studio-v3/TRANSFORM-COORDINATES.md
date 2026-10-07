# 实体保存姿态与场景姿态

`transform-coordinates.mjs` 提供纯坐标转换，输入与返回值都是普通 JSON。使用项目已有的 Three 数学类，无渲染器、网络、存储或新增依赖，不修改输入。

## 原版证据

本次直接读取已安装 TapNow 的只读源码：

- `course-api-base-url-CGXqZmAy.js`，SHA-256：`157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca`。
- `ThreeDWorkspace-BzPphAqB.js`，SHA-256：`85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`。
- 所在目录：`/Applications/TapNow.app/Contents/Resources/web/assets/`。

课程模块导出 `Hq as c4`、`ZOe as cl`、`Wq as cs`、`QOe as ct`；Workspace 分别导入为 `hn`、`Ta`、`wa`、`Hc`。这里的 `ct` 是 `QOe` 的导出别名，不能使用同一压缩文件内无关的嵌套 `function ct`。

| 原函数 | 精确定义 |
| --- | --- |
| `HOe(from,to)` | 将 `to-from` 包裹到 `[-π,π)` |
| `hE(rotation)` | 用旋转后的局部 `(0,0,-1)` 求水平 heading |
| `vF(rotation,target)` | 左乘全局 Y 轴旋转，令 heading 指向 target |
| `xF(rotation)` | `vF(rotation,-hE(rotation))` |
| `Hq(kind,t)`、`ZOe(kind,t)` | 仅 actor 的 `rotation` 应用 xF；其他 kind 原样返回 |
| `Wq(rotation)`、`QOe(rotation)` | 均为 xF，用于 camera 的 plan ↔ optical |
| `Cdt` / Workspace `Or` | actor/prop 读取 Hq 后 heading；camera 优先读取 camera.rotation，否则 Wq(transform.rotation) |

给定欧拉角转换出的四元数 Q，`forward = Q × (0,0,-1)`，
`heading = atan2(forward.x,-forward.z)`。
只有纯 Y 轴旋转时，heading 才恰好等于 `-rotation.y`。
水平 forward 长度 ≤ `1e-8` 时，原版返回 heading 0。

`vF` 使用 `delta = wrap(target-heading)`，然后 `Q' = Ry(-delta) × Q`。
绝对 delta ≤ `1e-10` 时保持原旋转；否则以原 order 转回欧拉角，缺省 order 为 XYZ。
因此 xF 的目标是**原 heading 的相反数**，既不是归零，也不是直接将欧拉角 y 取负。
左乘全局 yaw 保留 forward 的竖直分量和其他倾斜关系。

## 保存契约

| kind | 保存值 | 场景值 | 场景读回 |
| --- | --- | --- | --- |
| actor | plan/domain transform | rotation 应用 xF，position/scale 不变 | rotation 再应用 xF |
| prop | domain transform | 直接应用 | 直接读回 |
| camera | transform.rotation 是 plan；camera.rotation 是 optical | camera.position/rotation 优先，缺失字段分别回退 transform.position/Wq(transform.rotation) | world position；QOe(world rotation)；保留已有 plan scale |

摄影机模型 root 应复制实际摄影机的光学姿态。摄影机通过 `lookAt` 得到的旋转也是光学场景姿态。此时不要再次对模型 root 或 camera.rotation 应用 xF。

## 公共接口

| 接口 | 返回 / 用途 |
| --- | --- |
| `rotationHeading(rotation)` | 场景旋转的 heading，弧度 |
| `wrapHeading(radians)`、`headingDelta(from,to)` | 包裹角 / 最短角差 |
| `setRotationHeading(rotation,target)` | 对已有场景旋转执行原 vF |
| `reflectRotationHeading(rotation)` | 原 xF |
| `planRotationToCamera(rotation)` | plan → optical，原 Wq |
| `cameraRotationToPlan(rotation)` | optical → plan，原 QOe/ct |
| `sameRotation(a,b,epsilon=1e-7)` | 以四元数比较朝向，容差单位是弧度；支持不同 Euler order 与 q/−q |
| `entityTransformToWorld(kind,domainTransform)` | actor 应用 Hq；prop 恒等；camera 明确组合 Wq |
| `entityTransformFromWorld(kind,worldTransform)` | actor 应用 ZOe；prop 恒等；camera 明确组合 QOe |
| `entityHeadingRadians(kind,domainTransform)` | 转换后的场景 heading，camera 此接口只读 plan transform |
| `setEntityHeading(kind,domainTransform,worldHeadingRadians)` | 将场景 heading 写回 domain transform |
| `applyEntityTransform(kind,setupState)` | 供渲染器应用一次的纯 world descriptor，含 camera state 优先规则 |
| `readEntityTransform(kind,worldTransform,previousDomainTransform?)` | 用于保存；camera 提供旧 plan 时保留其 scale |
| `entityStateHeadingRadians(kind,setupState)` | 完整状态 heading，含 camera.rotation 优先规则 |

`entityTransformToWorld('camera',…)` 是显式组合的应用层接口，**不等同于**原 Hq 的 camera 分支。原 Hq 本身不转换 camera。
同样，camera 的 `setEntityHeading` 定义为设置 optical heading；它对应先编辑 camera.rotation 再 QOe 写回 plan 的实际 Workspace 流程。原 `Sdt` 直接处理 camera plan transform 时不承担这个双状态同步职责。

所有接口校验有限数值、kind 与六种 Euler order，失败抛出 `StudioDomainError`。新增应用层拒绝非法输入；原 GOe 对非有限角度返回 0 的宽松容错不作为可保存的 domain 行为。

## 接入位置

- `render-graph.mjs` 的实体 `apply`：先 `applyEntityTransform(kind,state)`，再交给原始 `applyTransform`。后者保持纯 Three 场景坐标操作，避免双重转换。
- 同文件的 camera pose/fallback：使用光学 descriptor，并让模型 root 拷贝 camera pose。`targets()` 的 `camera.lookAt` 及 root quaternion 拷贝已是光学结果。
- `runtime.mjs` 的 `transformEvent`：将 `readTransform(root)` 经 `readEntityTransform(kind,world,state.transform)` 后保存。`begin` 的 before 与 `cancel` 回放保留原始 world snapshot。
- `entity-actions.mjs` 的 camera `statePatch`：transform.rotation → Wq → camera.rotation；camera.rotation → QOe → transform.rotation。双输入比较两者对应的光学朝向，用 `sameRotation`，position 保持数值一致性比较。
- `drop-placement.mjs` 的 actor/prop bbox 和支撑面计算：用 world transform；结果经 `entityTransformFromWorld` 写回。camera Drop 不在此模块范围。
- actor 行走控制：移动向量 `(dx,dz)` 的 heading 为 `atan2(dx,-dz)`；使用 `setEntityHeading` 写回 domain。跟随 rig 的 yaw 为 `-heading`。

示例：

```js
const world = applyEntityTransform(entity.kind, setupState);
applyTransform(root, world);
// 操作 Three root 后，仅在保存时转换。
const stored = readEntityTransform(entity.kind, readTransform(root), setupState.transform);
```

## 奇异边界与验证范围

常规倾斜姿态的两次 xF 能恢复同一四元数朝向。**不能对所有近竖直姿态保证 involution。**
原 `Gq` 与 Three 的欧拉角分解使用 `.9999999` 奇异阈值。在阈值内，某个欧拉分量会置零；微小 forward 分量的丢失可能显著改变 heading，即使第一次转换的四元数误差很小。

已复现：YXZ，`x = ±(π/2−1e−7), y = −.52, z = .27`。第一次 xF 在 `1e−7` 四元数容差内保留目标姿态，但分解后的 heading 约为 `−.79` / `−.25`，再次 xF 与原朝向相差约 `.54` 弧度。原版函数与本实现均有这个边界，专项测试明确验证其一致性，不以扩大常规容差掩盖。
完全竖直、水平长度 ≤ `1e−8` 时 xF 因 heading 0 保持原旋转。
如果以后要求这类姿态严格往返，需要另行设计四元数保存或奇异策略，不应静默改变原版 Euler 契约。

运行专项：

```bash
node --test tests/studio-v3-transform-coordinates.test.cjs
```

覆盖真实 Three Euler/Quaternion 六种 order、倾斜、左右乘差异、heading 包裹、actor/prop 往返、camera state 优先、camera plan 读回、真实 PerspectiveCamera.lookAt、竖直/近竖直/gimbal 边界、q/−q 与跨 order 等价、输入验证和不变性。
原版对照测试先验证课程文件 SHA，仅抽取纯数学函数运行，不执行应用 bundle。没有安装此源码时只跳过该对照项，其余测试仍可运行。
本专项验证数学与数据契约，不代表屏幕渲染或交互验收。
