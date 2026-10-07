# V3 操控 HUD 合同（2026-10-08）

`src/features/studio-v3/control-hud.mjs` 导出：

```js
const hud = createControlHUD({
  getControl: () => runtime.controlling,
  drop: () => runtime.dropControlToGround(),
  moveDown: () => runtime.nudgeControlHeight('down'),
  moveUp: () => runtime.nudgeControlHeight('up'),
  setHeading: degrees => runtime.setControlHeading(degrees),
  cancel: () => runtime.cancelControl(),
  finish: () => runtime.finishControl(),
  onError: error => notice(error.message, true),
});
```

返回 HTMLElement，附 `refresh()` 与 `dispose()`。宿主将其放到正常主操作组的位置，在 `runtime.controlling` 存在时替换该组。`getControl()` 返回 `null`，或 `{entityId,kind,label,headingDeg,dirty,inputActive,help}`；`headingDeg:null` 隐藏旋转控件。宿主在控制状态变化时调用 `refresh()`；没有私有 RAF 或轮询。

所有动作支持同步/异步，必须返回 **boolean true 或 `{ok:true}`** 才接受；`false`、`undefined`、`{ok:false,message}`、异常均显示可读失败并调用 `onError`。本模块不发成功 toast。只有宿主真实 session 消失才隐藏 HUD；`cancel`/`finish` 回调仍返回成功但没有实际结束 session 时，HUD 不伪造退出状态。

官方来源是安装包 `ThreeDWorkspace-BzPphAqB.js` 的 `bY`/`IE`/`iY`/`sY`/`cY` 与 `WorkspaceViewfinderButton-BHqIWibq.js` 的 `zt`（Xp）。动作顺序、标签、图标是：落到地面 G（dropGround）、下移 Q（moveDown）、上移 E（moveUp）、旋转、还原并退出（undo）、完成 Escape（check）。图标只复用已有原资源。原 Xp 底层轨长360、读数40、窗口参数132，推导可视刻度窗74、总宽116、固定指示线X=37；本地保留这些尺寸与0/90/180/270/359预设。

旋转 range 的 `input`、拖动刻度、刻度预设只调用 `setHeading` 预览，不调用 finish，不结束宿主事务。异步滑块预览合并未处理的中间值，保留最后一个值。number 的原生 input 草稿仅在 Enter/change/blur 提交；0–359 的有效有限数值才提交；未编辑的 blur 不写回显示舍入值；失败恢复 accepted。IME/229 Enter/Escape 与合成中的change/blur不提交。Escape 丢弃未接受草稿再调用 finish；还原并退出调用 cancel。dispose 清理本地监听器与草稿，不主动取消宿主事务。

HUD使用 `.sv3-control-hud` 与 `data-keyboard-scope="local-tool"`。宿主控制器的捕获阶段需要识别这个范围，暂停场景 movement keys并保留控制事务，让 HUD 处理 input 与按钮事件。按钮焦点上的G/Q/E本地执行一次；editable 中这些按键用于输入，不触发移动。keydown/keyup、指针与滚轮事件在HUD内消费，不能再穿透到场景。`inputActive:false` 代表输入暂停，HUD仍可调整，不按此字段取消事务。

新增样式由模块按现有entry链接模式加载 `control-hud.css`，dedupe一次；复用原sv3-capsule/sv3-button样式。移动端隐藏按钮文本但保留原图标与aria-label。无新依赖、供应商调用、域模型或runtime修改。
