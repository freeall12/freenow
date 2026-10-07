# 角色／道具操控会话

`control-session.mjs`持有单个操控事务和原生输入监听，`runtime.mjs`连接真实 Three 对象、渲染调度、模型包围盒和碰撞射线。不是 TransformControls 的别名。输入语义依据只读官方 bundle 的 `TF/I2/D2/L2/Wf/Pc`，定位见 [官方合同研究](../../../docs/research/STUDIO-V3-CONTROL-MODES-20261008.md)。

## API 与事务

```js
const runtime = createStudioV3Runtime({
  canvas, getState, getFence, isCurrent,
  canControlInput: () => !menus.isOpen() && !placing,
  onControl({phase, entityId, kind, transform, reason}) {
    // begin / preview / commit / cancel 接项目既有 history。
    // transform 始终为领域坐标；actor 渲染/world 的朝向转换只在边界执行。
    // 返回 false 拒绝操作；undefined/true 接受。
  }
});
runtime.startControl(entityId);         // actor / prop；返回 boolean
runtime.finishControl();               // 提交，失败时留在已停止的会话
runtime.cancelControl('menu');         // 回滚，并释放监听
runtime.nudgeControlHeight('up');       // 或 'down'：1 米，200ms 动画
runtime.dropControlToGround();         // 控制专用五点支撑，180–320ms 动画
runtime.setControlHeading(180);        // 度；预览，未单独提交
runtime.controlling;                   // null 或下面的 HUD 快照
```

快照：`{entityId, kind, label, headingDeg, dirty, inputActive, help}`。`dirty`按 position/rotation/scale 与进入前状态比较；`inputActive`包含按键、拖拽、高度动画。HUD 动作返回 boolean；接受 bool 或 `{ok:true}`的宿主 UI 应适配该结果。

每次开始只发一次 `begin`；接受的输入发 `preview`；Escape／完成发 `commit`，取消发原始领域 transform 的 `cancel`。提交回调返回 false 或抛错时停止当前按键／高度动画并保留会话，允许重试完成或取消。取消回调即使失败也回滚画面、释放监听；取消／完成回调重入不会重复终止事务。

普通变换工具继续独立使用 `onTransform`。其取消恢复 world 快照到 Three 对象，取消 payload 使用原始领域快照；preview 使用 `readEntityTransform`转换。开始操控先结束原生 gizmo drag，不留下 Three dragging 标志。

## 原生输入与调度

- WASD 沿跟随相机 yaw 的 XZ 平面移动，速度 6、加速度 48；对角线归一化。
- Shift 速度倍率平滑趋近 1.6，倍率每秒变化 8；松开移动键立即停止水平速度。
- actor 面向移动方向；prop 保留朝向。朝向编辑使用 quaternion heading helper，保留倾斜与 Euler order。
- Q/E held 连续升降，速度为 `6×speedMultiplier`；手动释放保持悬停。HUD Q/E 按钮快捷键由 HUD 本地处理，每次 ±1 米。
- G 使用控制专用 support 算法，不复用实体菜单 Drop placement。
- canvas 左／中 pointer 拖拽改变跟随 rig，yaw/pitch 灵敏度 .002、pitch 限制 `[-.72,.25]`。使用 pointer capture，并收回 pointerup/cancel。
- wheel 归一化 pixel/line/page，小幅或小数触控板事件旋转（.003）；整数大幅滚轮、Ctrl、line/page 事件缩放（距离乘 `exp(dy×.001)`）。page 单位乘 viewportHeight×.8。
- Escape 完成；HUD 数字草稿、slider、按钮事件由 `.sv3-control-hud`优先处理，聚焦 HUD 时清 held keys，保留事务。外部文本输入聚焦取消控制。

控制模块不拥有 RAF。宿主 runtime `draw`调用 `tick(dt)`，dt 上限 .05 秒。只在 held movement、有限高度动画或离地后的重力尚未落地时请求后续帧；控制模块的静止 simulation 不自循环。runtime 仍会为真实动态素材／Idle clip 绘制，不能把含动态轨道的 Idle 宣称为全局无 RAF。鼠标拖拽／wheel 仅事件到达时失效画面。退出返回 orbit 的 .55 秒相机恢复动画为有限循环；plan 恢复直接切回原 camera。

## 模型尺度、支撑与碰撞

profile 根据实际模型包围盒设定目标高度、默认／最小／最大相机距离、body bottom、radius 和三层采样高度。水平碰撞沿实际位移方向发三层射线，遇法线 absY≤.45 的墙，在 hitDistance−radius−.025 截断 XZ，无侧滑。

支撑从 `max(bodyBottomY, positionY)+.03`向下发中心与四角五条射线，角偏移 radius×.7，朝上法线阈值 .2；各点首个合格命中取最高，无命中用当前 groundY。向下 held 输入 snap 范围为 abs(deltaY)+.08，普通步行 .35，空中下降 abs(deltaY)+.08，G 无限。重力 −18；手动悬停不受重力。bodyBottomOffsetY 用于调整根对象位置，避免模型穿支撑。

runtime 使用可见 source 与其他实体的 mesh，排除当前控制实体、相机、helper、loading 对象；比官方单一 collider 路径额外支持本地场景道具。Gaussian 点云不是三角网格碰撞体，缺少 mesh 时使用地面，不能宣称点云碰撞精确成立。

跟随 camera 也执行 target→desiredPosition 射线，near=.45、padding=.18，避免在场景 mesh 内。actor 默认从自身 heading 后方进入，prop 从当前 camera 方向进入；改变相机不会写实体 transform。

## 权限与生命周期

本地版本保留项目既有严格权限：只接受 ready、visible、actor/prop、未锁定、当前状态可写的实例；独立状态中共享基准实例拒绝，必须切到其基准 owner。官方 Control 的 lock 分层较宽，但这里不借新模式静默放宽本地 lock。playing/scrubbing（宿主若提供）也拒进入。

source、stage、setup、session ownership identity 改变时取消；revision/editEpoch 的自己的 preview 更新不抢走会话。每次 sync 验证存在、visible、lock 和 owner，随后重应用 live preview。hidden、window blur、pointercancel、外部编辑输入、其他模式抢输入、dispose 均取消。生产入口在切换状态／打开菜单前先 `finishControl()`保留本次修改，提交失败时不得继续切换；`canControlInput`防止漏接入口继续推进，并以取消作为抢占兜底。window blur/hidden 当前取消与官方仅清 flags 的行为不同，不能宣称逐项完全一致。

结束释放 window key/pointer/blur、canvas pointer/wheel、document focus/visibility 的会话监听；runtime 自己的 visibility 生命周期独立保留到 dispose。Dispose 不残留控制 RAF、native pointer capture 或 history 活动事务。旧会话回调异常不阻止 GPU 清理。

## 暂不覆盖的边界

此模块只负责 actor/prop；摄像机 possession／viewfinder 使用独立 camera 输入与 optics 事务，不能复用实体跟随 rig。time-key 创建确认、selected-key retarget、保存临时记录和完整 temporal authoring 尚未在此模块实现，不能视为官方时间轴操控全覆盖。进入 follow 当前立即对齐，未复刻官方 .8 秒 entering 动画。

`onMotion({entityId,state:'idle'|'walk'|'run'|null,transition})`提供临时动画意图，state=null 表示清 override、恢复 authored pose。runtime 已将该钩子连接到 `graph.setControlMotion`，按资产真实 Idle/Walking/Running clips 预览，退出恢复 authored pose，不将行走动画写入 domain pose；`control-session`自身不操作 mixer。缺少移动 clip 的自定义资产按官方能力 fallback 使用 walk/idle/standing。真实动态 Idle 继续动画渲染，只有静态 clip 才完全停止帧。

## 检查

```sh
node --test tests/studio-v3-control-session.test.cjs
node --test tests/studio-v3-runtime.test.cjs tests/studio-v3-runtime-locks.test.cjs tests/studio-v3-runtime-optics.test.cjs
```

专项使用原生 EventTarget keyboard/pointer/wheel 事件、真实 Three 场景对象与 `createHistory`，覆盖加速度/对角线/sprint/立即释放、actor/prop 朝向差异、静态 clip idle 无 RAF、真实 Idle 动画持续绘制、preview revision sync、一次 history commit、回滚、归位、listener 清理、HUD 输入优先、拒绝回调、重入取消、mesh 支撑/撞墙/相机遮挡。浏览器视觉与 production 入口验证属于宿主集成验收。
