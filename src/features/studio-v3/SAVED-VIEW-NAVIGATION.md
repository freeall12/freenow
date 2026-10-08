# Saved View 导航相机恢复

`runtime.mjs` 增加独立的 Orbit 导航相机读写接口。它不借用摄像机接管、entity editor、摄影或 provider；不会改作者实体、setup、temporal、history、照片或画布。View 的领域选择、保存和持久化仍由宿主负责。

```js
runtime.getNavigationCameraState(); // detached camera 或 null
await runtime.restoreNavigationCamera(view.camera, {
  duration: .8,
  isCurrent: () => currentRestoreStillOwnsTheSession(),
}); // true: 完成；false: 拒绝、被替代、被打断或失败
```

## 读取与画幅

只有真实 Orbit 导航模式可读取。plan、entity control、camera preview、camera possession、viewfinder、已销毁或失效 runtime 返回 `null`。Saved View 恢复动画期间读取的是完整目标快照，而不是正在屏幕显示的插值帧；既有角色／摄像机返回导航动画也读取其目标 pose/FOV。

无已有导航光学元数据时 `frameAspectRatio:null`，表示尚未指定摄影画幅；不会把当前 viewport aspect 填成固定摄影画幅。恢复后固定画幅、FOV、焦距、光圈、景深模式及完整 focus 对象保留在 `orbitCamera.userData.studioV3Optics`。`resize()` 只更新真实 Orbit 投影的 viewport aspect，并按摄影传感器高度同步 filmGauge；固定 `9:16` 之类保存值不会变成窗口比例。

`getVisibleCameraState()` 的现有公共合同没有改变：它仍取真实可见相机及 viewport／preview aspect，仍可能返回正交视图派生的 perspective 描述。Saved View 创建、更新必须使用新接口，不可继续把该旧接口的结果当作摄影画幅或目标相机。

## 恢复与生命周期

输入先 detached clone，通过现有 `cameraOpticsPatch` 规范化及 `assertCamera` 校验。合法越界镜头数值沿用既有 clamp，非法 pose、focus、FOV／画幅等拒绝。动画复用原 `navigationTransition`、立方缓动与按需 RAF，不建立另一永久循环。pose 用 position lerp、quaternion slerp，FOV 同步插值；终点恢复规范化完整光学快照和 Euler order。实际 camera 始终为原 `orbitCamera`。

Saved View 动画从调用时的 `performance.now()` 计时，用实际 RAF timestamp 求 elapsed；即使后台 RAF 降为低频，首个达到 `.8s` 期限的帧仍完成恢复，不会每帧只累计 `.05s` 而拖成数秒。暂停／隐藏仍取消，而不是恢复后补跑旧动画。原角色／摄像机返回、camera possession、运动／物理和 graph tick 继续使用既有 `.05s` delta 上限。测试可注入同 RAF 时间基准的 `now()`，计时不会从上一次静态渲染开始而误计长时间 idle。

`OrbitControls.target = camera.position + opticalForward × max(.1, focusDistance ?? 10)`；point/object/none 的 null 距离采用稳定 10 m 导航距离，焦点对象本身仍完整保存。camera.up 随光学 quaternion 保留 roll。进入动画前以公开 `controls.update()` 排空旧原生阻尼，再恢复可见 pose，避免鼠标余量在终点继续推走相机。

每次恢复捕捉 runtime/source、worldNode、stage/setup、session/native owner 身份、资源描述及 graph epoch，并在每一帧检查宿主 `isCurrent`。revision/editEpoch 沿用既有导航身份规则排除；来源／状态／所有者仍需与已完成的 `sync()` 一致，未同步的场景不能接收恢复。宿主必须先领域 `set-active`，等待当前 `lastSync`，结束其他 viewport 角色并切回 Orbit，再调用恢复。

以下操作令旧 Saved View Promise 返回 `false`，保留当时可见 pose，不跳到旧目标：新恢复请求（即使新请求非法）、普通 pointerdown/wheel、focus、setView/home、选择或 gizmo 接管、entity/camera control、camera preview/viewfinder、source/setup/owner 换代、隐藏、render pause、capture、dispose，以及绘制失败。键鼠取消监听位于 capture phase，先释放动画锁，再让同一个原生输入继续导航；它遵循已有 `canControlInput` 门禁。程序化恢复不依赖该门禁，所以菜单打开本身不拒绝恢复。

隐藏、暂停、capture、播放／scrub、非 Orbit viewport 或失效 owner 拒绝开始恢复。失败／取消恢复可用时重新开启原控件；capture/pause 继续持有自己原来的禁用权，释放后恢复导航。无 RAF/autoRender 的 runtime 拒绝需要动画的请求，可使用 `duration:0` 明确立即恢复。既有角色和摄像机 `.55s` 返回动画的中断／结束行为保持原合同。

## 官方等价与本地补齐

证据来自 [Saved Views 源码研究](../../../docs/research/STUDIO-V3-SAVED-VIEWS-20261008.md)，本次再按 UTF-8 文本读取官方 A 文件，没有 import、eval 或执行 bundle。

| 项目 | 官方证据／本地行为 |
| --- | --- |
| 目标快照 | A `Tn`（151790）在 transition 存在时返回 toPos/toQuat/toFov；`jo`（152525）读可见帧。本地新接口采用目标语义，旧可见接口保留。 |
| 摄影画幅 | A `oe=c.useRef(null)`（139266）及 `_n`（112874）保留独立摄影 ratio/null。本地未指定时同样 null，固定 ratio 独立于 viewport。 |
| 恢复时长／存储相机 | A restoreView（278339）取 View.camera，经 `Gn`（112311）转换并发出 animated/duration .8。本地恢复存储 pose/optics，默认 .8，保持原 Orbit 相机。 |
| 本地安全补齐 | 官方 callback 未见 readonly/playing/capture/history guard 或完成回执。本地增加同步场景围栏、输入取消、Promise 成功／失败、暂停和资源生命周期保护；宿主仍负责 readonly/领域事务。 |
| 本地初始化和视觉边界 | 原导航 camera 的初始 pose/FOV 沿用现有 runtime；缺少光学字段沿用项目 camera-optics 默认值。没有新增官方 viewport 约 50% 取景框的 `Fo/Uo` FOV 补偿；保留摄影 FOV与固定 ratio 不代表官方 GPU 构图像素完全一致。Orbit/plan 的既有零景深显示规则保持，保存光圈不代表 mesh 已实现虚化。 |

## 定向验证

```bash
node --test tests/studio-v3-saved-view-navigation.test.cjs
node --check src/features/studio-v3/runtime.mjs
git diff --check
```

新增专项 **11/11 通过**，使用真实 Three 相机／OrbitControls／render graph 与模拟 GPU 入口：目标对可见帧、.8s 插值与终点、完整 roll/order/optics/pivot、固定画幅与 resize、null画幅/焦距、模式拒绝、原生输入／新请求／来源／setup／session／native／宿主围栏取消、暂停／隐藏／capture／失败清理、旧阻尼排空、dispose 全监听释放、作者文档和编辑回调不变，以及原角色／摄像机返回导航动画。新增低帧率 case 验证 400+400ms 两帧按真实时间完成、首帧延迟 5s 即完成、先 idle 5s 不提前完成、hidden 后旧动画不迟到，以及旧 possession/return/graph 的 delta 仍被限制为 .05s。

仅抽查受影响旧返回／销毁窄 case 5 项：1 pass、4 fail。用临时只读 Node loader 将 runtime 替换成 `git show HEAD:src/features/studio-v3/runtime.mjs` 后，同样 1 pass、4 fail：两项摄像机测试 renderer 替身缺少 `getRenderTarget`，角色返回位置断言失败，旧取消测试已残留两个 canvas 监听却断言零（新增捕获监听使当前为四个）。未改其他 tests 修饰这些基线失败；新专项 renderer 具备轮廓所需接口，旧返回动画另行通过。

这些测试不证明真实 WebGL 像素、SPZ 景深、正式 UI 持久保存或全仓回归。生产浏览器验收已由宿主完成，见[集成验收](../../../docs/verification/20261008-studio-saved-views.md)。本切片未新增依赖。
