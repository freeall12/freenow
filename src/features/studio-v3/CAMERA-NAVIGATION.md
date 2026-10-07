# Studio V3 相机输入导航

`src/features/studio-v3/camera-navigation.mjs` 提供普通 viewport 与摄像机 possession 共用的输入算法。它只读相机快照、请求相机预览写入；领域编辑事务、摄像机租约、进入／返回动画、HUD 与完成／还原由 runtime/session 处理。

## 官方依据与范围

2026-10-08 本机安装包静态核对：

- `/Applications/TapNow.app/Contents/Resources/web/assets/WorkspaceViewfinderButton-BHqIWibq.js`：真正的 `class pl`、`applyDirectorFly`、drag/wheel/arrow 与 `$a/qa/Xa` 支点算法。
- `/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`：`E2/GW/EV` 分别负责 possession、viewport lease、领域编辑事务。该文件同名 `function pl` 是实体筛选函数。
- [操控模式源码合同](../../../docs/research/STUDIO-V3-CONTROL-MODES-20261008.md) 第 3、5 节。

模块覆盖自由相机三维飞行、camera look、箭头 look、滚轮 focalLength、Alt pivot orbit/pan/dolly。不会使用角色／道具跟随 rig，也不添加碰撞、重力、角色落地或移动端 joystick。

官方导航还含独立实体 orbit-view 策略、输入 owner 转交、租约能力检查、dragSuppressUntil 与共享 input-root 的事件命中。本模块不声称覆盖这些外部策略；主线 runtime 必须 gate 活跃模式及租约。输入目前直接监听 canvas，pointer 后续动作监听 ownerDocument（无 document 时使用 eventTarget）；原生捕获不会被当成多指触摸能力。

## 工厂接口

```js
const navigation = createCameraNavigation({
  canvas,
  eventTarget: canvas.ownerDocument.defaultView,
  readCamera: () => currentCameraSnapshot(),
  applyCamera: (next, {kind, reason}) => previewCamera(next, kind, reason),
  canInput: () => isCurrentViewportOwner() && !playing && !scrubbing,
  getScope: () => stableViewportScope,
  getMoveSpeedMultiplier: () => movementPreference,
  getWheelZoomEnabled: () => true,
  getWheelLookInverted: () => false,
  resolveNavigationPivot: ({clientX, clientY, camera}) => sceneHit(clientX, clientY, camera),
  onNavigationPivotChange: pivot => updateReticle(pivot),
  onInvalidate: () => requestRuntimeFrame(),
  onError: error => showNavigationFailure(error),
});
navigation.start();
// Runtime 的同一帧循环内，dt 为秒；模块没有自己的 RAF。
navigation.tick(dt);
if (navigation.needsFrame()) requestRuntimeFrame();
```

| 参数 | 合同／默认值 |
| --- | --- |
| `canvas` | 必需；支持 add/removeEventListener，可选原生 set/releasePointerCapture |
| `eventTarget` | keyboard／blur 监听对象；默认 canvas.ownerDocument.defaultView 或 window |
| `readCamera()` | 必需，返回领域 camera 快照，平铺 `position:{x,y,z}`、`rotation:{x,y,z,order}` 与 optics。位置／旋转必须 finite；order 默认 XYZ；模块保留其他字段 |
| `applyCamera(next,{kind,reason})` | 必需同步回调；`kind='pose'|'optics'`。**必须返回严格 `true` 才算成功**；不接受 Promise、undefined 或 false 作为成功 |
| `canInput(kind,event)` | 默认 true；kind 包括 start、tick、movement、view-rotation、camera-drag、camera-wheel。runtime 可忽略参数，返回统一资格；返回 false 清输入，但保留监听 |
| `getScope()` | 默认 null；返回 string、number、null 或稳定引用身份。start 保存值，输入／tick 比较 `!==`；作用域变化会 stop。不要每次返回新对象 |
| `getMoveSpeedMultiplier()` | 默认 1；finite clamp .25–100，NaN/Infinity 回落 1 |
| `getWheelZoomEnabled()` | 默认 true；禁用时全部非支点 wheel 都作 look |
| `getWheelLookInverted()` | 默认 false；只影响 wheel look，支点 dolly/focal 不反转 |
| `resolveNavigationPivot({clientX,clientY,camera})` | 默认 null；成功返回 `{position:{x,y,z},...}`，可带真实命中元数据。首次 Alt drag 无有效命中则拒绝启动，模块不构造地面交点 |
| `onNavigationPivotChange(pivot)` | 默认空回调；快照或 null，host 可用来绘 reticle |
| `onInvalidate()/onError(error)` | 默认空回调；runtime 唤醒渲染、呈现失败。回调异常不会遗留输入租用 |
| `now()` | 默认 performance.now/Date.now，毫秒；只用于手势时限，可在测试中注入 |

返回 `start()`、`stop()`、`cancelInput()`、`tick(dt)`、`needsFrame()`、`dispose()`，以及只读 `active:boolean`、`pivot:detachedSnapshot|null`。

- `start()` 无参数，首次成功返回 true；已 active、disposed 或入口资格无效返回 false。
- `stop()` 移除所有监听并清键、速度、drag/capture、惯性、支点、wheel intent；之后可再 `start()`。
- `cancelInput()` 同样清输入但保留监听与 active。blur／document hidden 使用此策略，与官方一致。
- `tick(dt)` 接受 finite、非负秒数；外层 runtime 负责限制大帧间隔。成功预览变更返回 true；闲置或拒绝返回 false。
- `needsFrame()` 只为 held movement/arrow、待消费 drag、速度／惯性请求下一帧。按住 Shift 单独不制造无限帧。
- `dispose()` stop 且永久禁止 restart。

## 算法与关键边界

| 行为 | 参数与公式 |
| --- | --- |
| WASD/QE | forward `(0,0,-1)` 与 right `(1,0,0)` 乘 camera quaternion，QE 叠世界 Y，完整三维 intent 归一化 |
| Fly | speed 3、sprint 5、acceleration 30、sprint approach `8×dt`；speed/acceleration/deadzone 同乘用户倍率 |
| 松键 | velocity 乘 `1e-8 ** dt`，小于 `.015×用户倍率` 清零，保留短暂惯性 |
| Pointer look | left drag 跨 4px 启动；middle／Alt drag 立即启动；YXZ yaw/pitch 减 `delta×.002`，pitch clamp `±π×.45` |
| Drag 惯性 | 释放时最后运动距今 ≤80ms 才保留 vx/vy；每 tick 乘 .92，abs(vx)+abs(vy)<.1 清零；松失 buttons 不保留惯性 |
| 箭头 | left/up 正 yaw/pitch、right/down 负；目标 ±1.5rad/s，approach `12×dt`；松键 `1e-8 ** dt`，deadzone .005 |
| Wheel normalize | pixel 1、line×16、page×max(1,height×.8)，复用 normalizeControlWheel 的采样分类 |
| Wheel gesture | zoom enabled 时两次间隔 ≤180ms 持续锁上次 intent；entity control 的逐次分类不继承到此路径 |
| Wheel look | yaw/pitch 减 `normalized delta×.003`；同样 YXZ 与 pitch clamp |
| Wheel focal | `focalLength×exp(-dy×.001)`，cameraOpticsPatch 同步 FOV 与 clamp 8–400；写入 kind=optics |
| Alt orbit | 世界 Y yaw 旋转 camera offset 与 quaternion；随后沿旋转后 camera right 进行 clamp 后 pitch，保留支点距离 |
| Alt pan | 每 pixel 平移尺度 `2×distance×tan(fov/2)/viewportHeight`；camera-right×(-dx) + camera-up×dy，同时移动 camera 与支点 |
| Pivot wheel | 现存 pivot 且 Alt held：距离乘 `exp(dy×.001)`，下限 `max(EPSILON,near×2)`、上限 finite far×.95；不改 focalLength |

本模块的 near 缺省 .01、far 缺省无穷，只用于支点距离边界；真实 runtime 应传实际 PerspectiveCamera near/far。Pan 优先使用快照 fov，缺失时从 focal/ratio 换算。

keyboard 拒绝 defaultPrevented、IME/Process/229、input/textarea/select/contenteditable/role=textbox、ignore-hotkeys、block-movement-hotkeys；keyup 无条件清对应键。它不处理 Escape：摄像机 Escape 必须先由外层 finishCurrentCameraEdit 成功才退出，不能等同 stop 或 cancel。

没有自行写本地存储；wheel 与移动速度偏好通过 getter 注入。没有供应商请求、provider 生成、网络或领域历史操作。

## 写入失败与验证

`applyCamera` 返回非 true 或抛异常立即 stop，清键／动量／捕获／监听，并调用 onError。返回 false 的错误 code 为 `studio_v3_camera_navigation_rejected`。不自动提交、取消或恢复领域 camera edit；主线 session 保留失败姿态的事务边界，用完成重试或明确“还原并退出”处理。

`tests/studio-v3-camera-navigation.test.cjs` 使用受控事件表面与实际 Three quaternion；2026-10-08 执行：

```sh
node --test tests/studio-v3-camera-navigation.test.cjs
```

11/11 通过，覆盖三维方向/归一化、速度与惯性、pointer 阈值/捕获、箭头、wheel intent与optics、支点 orbit/pan/dolly、IME/作用域/blur/hidden、拒绝与重启。该证据是模块与输入合同测试；尚不等同于浏览器原生捕获、真实场景支点命中或完整 possession/session 的端到端验收。
