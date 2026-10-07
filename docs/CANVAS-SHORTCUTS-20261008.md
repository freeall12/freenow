# 官方快捷键与实际操作映射 · 2026-10-08

## 参考与结果

参考仅来自官方安装资源和官方实机采集：`reference/help-shortcuts-live-20261008.json` 的完整面板 HTML，以及 `/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js`。本地页面仅用于后续验收，不作为官方行为来源。

发现并补齐三个缺失入口：Cmd/Ctrl+G 堆叠、Command+滚轮缩放、长按 V/再次 V 的 Agent 语音入口。Cmd/Ctrl+I 和 J 原来已有处理器，本轮补充输入法、编辑区、上层弹层及工具事件归属保护。其余清单保留既有实现。

官方 `oxe` 使用 `(metaKey || ctrlKey) && !shiftKey && !altKey && key.toLowerCase() === "g"`，阻止默认行为，repeat 不重复创建，选区不合法走提示。官方 `age` 使用 `oge=500` 的长按 V，排除输入区与修饰键，长按后打开 Agent 并设置待语音状态；已有录音时再次 V 设置待停止。keyup 清理尚未触发的定时器。语音逻辑位于该 bundle 约字符 1399264；没有把节点编辑器语音按钮另改成全局 V 的目标。

## 每项真实处理器

| 官方操作 | 本地实际操作入口 | 本轮处理 |
| --- | --- | --- |
| Delete/⌫ | `app.js` 画布 keydown → `removeSelected()` | 已有；保留画布选区及编辑区归属 |
| Cmd/Ctrl+Z；Shift+Cmd/Ctrl+Z | `app.js` → `undo(e.shiftKey)` | 已有；排除 Alt 组合 |
| Cmd/Ctrl+C；Cmd/Ctrl+V | `canvas-menus.js` keydown → `copy()`；浏览器 paste 事件 → 图节点/文件粘贴 | 已有；原生 paste 才带真实文件，不用 V keydown 代替 |
| Cmd/Ctrl+G | `app.js` → `CanvasApp.stack([...selected])`，复用 `CanvasPiles.plan` 与历史/持久流程 | 新增；repeat 不重复堆叠，不合法选区显示原提示 |
| Cmd/Ctrl+F | `app.js` → `CanvasSearchUI.open()` | 已有；排除 Shift/Alt，不重复打开 |
| Shift+点击 | `app.js` pointerdown 的选区增减 | 已有；不改变实际节点拖动与分组逻辑 |
| Cmd/Ctrl +/− | `app.js` → `animateView`，画布中心缩放，范围 0.15–2 | 已有；排除 Alt，支持 + 所需 Shift |
| Cmd+滚轮 | `app.js` 读取鼠标锚点 → `CanvasNavigation.wheel` 的 metaKey 分支 | 新增；锚点世界坐标保持稳定 |
| 触控板双指缩放 | 浏览器 ctrlKey wheel → `CanvasNavigation.wheel` | 已有；沿用原倍率与范围 |
| 触控板移动 | 无缩放修饰 wheel 的 deltaX/deltaY → 画布平移 | 已有；沿用原 1.2 倍率 |
| Cmd+Space+拖动 | `app.js` Space 状态 → pointerdown pan → gesture 更新视图 | 已有；keyup/blur 释放，本轮补 visibility hidden 释放；原 Space 单独平移也保留 |
| 时间轴 C/Q/E | `canvas-playlist-ui.js` capture keydown → `editAt(id,key)` → `CanvasPlaylistCore.cut/trimAt` | 已有；使用当前播放头、真实片段范围和一个撤销检查点；原 IME/修饰/重复/输入/工具守卫保留 |
| Cmd/Ctrl+J | `src/features/agent-composer/shortcuts.mjs` → Agent `toggle()` | 已有；新增共享归属和 229/Process 保护，编辑区与弹层不触发 |
| Cmd/Ctrl+I | `src/features/focus-edit/entry.mjs` → `toggle(selected[0])` | 已有；新增共享归属、IME、repeat、Shift/Alt 保护。有效类型沿用图片/视频，进行中仍以 Escape 退出 |
| 长按 V | `agent-client.js` 安装 `voice-hold.mjs` → 500ms → 加载完成后 `open()`、原 `voice()` | 新增；不提交 Agent 消息，不绕过原麦克风权限与转写提供方 |
| 再次 V 完成 | `voice-hold.mjs` → `VoiceInput.finish()` → 原录音 stop/转写/插入 | 新增；仅已有录音时确认，repeat 不重复提交；编辑区正常 V 输入不被抢占 |

## 事件边界与释放

共享 `src/features/canvas-shortcuts/scope.mjs` 尊重 `defaultPrevented`、`isComposing`、229 与 Process；用 composedPath/实际焦点识别输入区、菜单、dialog、listbox、slider 和显式工具范围。主画布快捷键不穿透帮助面板、上层 modal、媒体编辑或 3D 工作区。J 可从非编辑的 Agent 面板关闭，普通 V 在输入框仍作为文字。

V 的 500ms 等待在短按释放、焦点改变、指针操作、开始组词、修饰键、窗口失焦、页面隐藏/离开和卸载时清理。已触发但尚在等待 Agent/录音准备的请求带 AbortSignal，过期来源不能晚启动。正常长按后释放 V 不完成录音；再次 V 或既有完成按钮才完成。`VoiceInput` 原录音取消与 pagehide 清理继续有效。

## 本轮定向验证

新增 `tests/canvas-shortcuts.test.cjs` 共 9 项，运行真实 app 键盘/wheel/pan 代码片段、实际 J 安装器/I 处理器和真实 VoiceInput UI。语音使用合成 Recorder 与固定转写替身，未获取麦克风、未读取 Key、未发起提供方请求。

- 实际 G handler：合法选区堆叠一次；输入、IME、已消费、修饰、repeat、modal 均让出。
- 已有搜索/撤销/重做/删除/缩放仍连到实际方法；Command+Space 能进入 pan，释放/blur/隐藏清理 Space。
- Command wheel 保持鼠标锚点；无修饰 trackpad 平移与 ctrlKey pinch 保留；上层 modal 不改变视图。
- 实际 J 和 I：合法画布触发；229、IME、输入、修饰、repeat、已消费和上层 dialog 不触发。
- V 499ms不启动、500ms启动一次；短按/重复不启动，release不提交，下一次V完成一次。
- V 待处理取消与生命周期清理；输入区域不启动，晚到异步请求不能跨失焦开始。
- 真实 VoiceInput 使用合成录音完成并插入一次，准备中 abort 恢复按钮且不提交迟到结果。

第一轮 6 项通过、3 项因测试宿主缺少 `window.addEventListener` 未执行；补齐夹具后只重跑这 3 项，全部通过。没有重复已通过的测试或既有套件，没有运行全库测试。以下命令为复现命令，不表示本轮重复执行：

```sh
node --test tests/canvas-shortcuts.test.cjs
```

`app.js`、`canvas-navigation.js`、`voice-input.js`、`agent-client.js`、共享 scope/voice-hold、FocusEdit entry、Agent shortcuts 和新增测试的语法检查通过。

## 本轮真实画布复验

根代理通过 Computer Use 操作当前源码主壳，入口为 `http://localhost:4195/qa/canvas-command-menu/app.html?session=help-1008`。独立数据库只有两张公开本地 QA 图片；以下操作不使用麦克风、Key 或生成服务。

- 主画布 Cmd+A → Cmd+G：真实新增一个选中的 pile；Cmd+Z 后 pile 移除，两张原图片的 ID 保持不变。
- 主画布 Cmd+J：真实打开 Agent；输入框聚焦后 Cmd+J 不关闭面板；回到主画布再 Cmd+J 正常收起。
- 点击本地图片 → Cmd+I：出现「焦点编辑模式」和退出控件；Escape 后模式退出，连接点与节点参数恢复。
- 各操作后公开诊断 `externalAttempts=[]`。这些结果仅证明所列主壳交互，不扩展到真实模型或全站验收。

## 尚未实机验证的范围

本轮尚未通过实机完成 Shift 多选、Cmd/Ctrl+F、Command wheel、Space 拖动后释放，以及帮助面板打开时快捷键不穿透的全部组合。V 仅以合成 Recorder 回归验证，不能据此宣称真实麦克风或转写链已验。

本轮不宣称真实麦克风、供应商转写质量、真实触控板硬件输入或全站工具归属完成验收。C/Q/E、copy/paste、基础拖动的已有专项不重跑；本记录的映射核对不替代其完整回归。

## 交叉审阅补修：取消语音准备后的同按钮恢复

审阅发现，快捷键启动时把 AbortSignal 放进常驻 `bind` 闭包；若准备阶段取消，恢复显示的麦克风按钮仍读到已取消的 signal，后续鼠标点击一直返回 false，直到界面重绘或再次绑定。

`voice-input.js` 现在把传入 signal 作为单次启动信号：每次 onclick 开始时取出并清空 `nextAttemptSignal`，该轮录音/取消/清理闭包捕获自己的信号。取消后同一按钮的下一次鼠标点击直接走正常准备流程，无需重绘、重新绑定或递归点击。旧轮迟到的 Recorder 结果不影响新轮控件或录音，原 abort 与 finish 语义保留。

新增第 10 项窄回归使用真实 VoiceInput 与合成 Recorder：首次准备中取消→直接再次点击同一按钮→首次迟到 resolve 不清理第二轮→第二轮准备/录音成功→finish 插入一次。本次仅运行新增与受影响的 VoiceInput 3 项，3/3 通过；voice-input 与测试语法、差异检查通过。未重复其他快捷键/全库测试，未读取麦克风、Key 或供应商。

```sh
node --test --test-name-pattern='real VoiceInput' tests/canvas-shortcuts.test.cjs
```
