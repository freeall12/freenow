# V3 实体属性面板合同（2026-10-08）

`src/features/studio-v3/entity-inspector.mjs` 导出 `createEntityInspector(options)`，返回 HTMLElement，可直接用作 `createMenus` 的 content。只加载本地 `inspector.css`，复用官方提取的 icons 与现有 Studio 样式，无新增依赖。

```js
menus.toggle(anchor, ({close}) => createEntityInspector({
  control, // resolveEntityControl 的同步 getter，或它的快照
  applyAction: entityAction, // async action => {ok, state?, message?}
  onError: error => notice(error.message, true),
  close,
  onEditBaseline: setupId => switchSetup(setupId),
}), {label: '实体属性', width: 440});
```

`applyAction` 接收 `{type:'update', entityId, setupId, patch}`。**仅明确的 `ok:true` 才接受草稿**；`false`、缺少结果、`ok:false`、异常均恢复字段先前的 accepted 值并报告失败。返回 `state` 时重新 resolve control；getter 方式始终读取当前实体/当前状态，检测 ID 或 setup 改变。宿主负责保存、历史通道、运行时会话与渲染守卫。

返回节点具有 `ready:Promise<boolean>`、`refresh()` 和 `dispose()`。`ready` 在 actor 的本地 GLB 姿态校验后完成，内部处理失败并调用 `onError`，不会留下未处理 Promise。关闭菜单（包括外部点击、切换菜单与销毁）时宿主必须调用 `content.dispose()`，取消未提交草稿并中断本地文件加载。模块不监听整个 body。

数值字段仅显式输入草稿会提交；Enter、原生 change、blur 共享单次提交。聚焦后 blur 不会把显示舍入后的值写回，提交中重复 Enter/blur 不重复调用。Escape 丢弃所有未接受草稿并关闭面板；IME 的 Enter/Escape/229 不提交、不关闭；change 与 blur 在 composition 期间不提交。

字段权限：definition 的 color/materialMode 可在独立状态编辑，写入 world lane；actor 颜色仅修改实例，官方不会同步 characterRole。locked 禁止 transform/pose/camera，允许 visible；baselineReadOnly 禁止全部 setup state 字段，包括 visible，同时 definition 颜色/材质仍可编辑。最终边界由实体 reducer 再次执行，UI 禁用不是权限来源。

官方姿态证据：安装包 `ThreeDWorkspace-BzPphAqB.js` 的 T6/P6/M6/A6 和中文版 `index-BsHyQ2qj.js`。`character.glb` 实际含 14 个动画，但官方可编辑菜单仅 9 个姿态：站立、椅坐、地坐、蹲伏、单膝跪地、侧卧、自然仰卧、趴卧、伸展仰卧。`readCharacterPoseOptions` 真正解析 GLB JSON chunk 并校验 9 个动画 channels/samplers；UI 写入对应真实 clipName，适配当前本地 renderer。Idle/Walking/Walking Backward/Jump/Running 属于控制过程的动画，不添加为官方没有的姿态选项。

颜色采用官方 dm 的六个 hex 值；仅 prop 提供“默认材质”（`color:null`，reducer 删除 color 字段）。材质仅 prop 有 source/clay。无自定义颜色、透明度或凭空增加的材质。

摄像机读取 `camera-optics.mjs` 的 normalize 与 presets，patch 单参数交给实体 reducer 的 cameraOpticsPatch 联动更新焦距/FOV/画幅比例与 focus/focusDistance。光圈预设会启用 aperture；“全景深”写 deepFocus。`onPickFocus` 为可选宿主点选回调，返回场景世界坐标 target 后写入 point focus；宿主未接点选时不显示这个动作。`depthOfFieldRendered` 缺省 false，明确提示参数会保存但本地渲染尚未显示景深虚化，不能把字段存在当作虚化渲染已完成。
