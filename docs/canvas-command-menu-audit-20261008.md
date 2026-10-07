# 画布菜单与命令入口定向核验 · 2026-10-08

范围：`canvas-menus.js`、`canvas-commands.js`；保留现有 SVG、节点类型、创建器及主画布接口。未改主壳、导航状态、提供方配置。以本轮实际代码为依据，没有沿用历史未完成清单。

## 来源与结论

- TapNow Electron 官方静态文件：`/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js`，SHA256 `8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86`。
- 该文件 `getNodeContextMenus` 中图片/视频的 `common.applyAllHistory` 和 `common.download` 都按同一 `data.src` 判定；图片 `getCopyUrlCommands` 调用 `pme(data.src,t)`。其解码后的字符位置约 `1363581` 附近可以复查这些条件。旧官方 `reference/context-menu-source.txt` 中 `qat/getNodeContextMenus` 也保存了相同规则。
- 本地模型的图片原图可以仅有 `fullImage`；旧视频有 `EDITOR_DATA.nodes[id].video` 的兼容来源。原本下载已支持它们，但历史/图片剪贴板入口只看 `image/video`。现在菜单统一判断主媒体可用性；保留原历史、下载、图片剪贴板的实际执行器。旧视频的当前媒体另在菜单执行入口正规化成历史 option，与 alternatives 一起进入真实 runtime/model，原节点及异步一致性检查不变。
- 历史无多版本时执行器仍报告“无可应用历史”，与官方入口根据有主媒体显示、执行时再读历史的结构一致。没有宣称引入云端历史。
- 官方命令项位于 `course-api-base-url-CGXqZmAy.js` 的 `lN`（字符约 29536）与 command menu（约 2934633）；其 `B3` 来自 `index-BsHyQ2qj.js` 的 `z4/W2.Item`。后者 cmdk 实现在字符约 5959301 的 `case"Enter"` 执行当前选中项，约 5960453 为 pointer selection/`aria-selected`，并非直接执行旧 DOM 焦点。`course-api-base-url-CGXqZmAy.js` SHA256 为 `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca`。本地 Enter 同样执行视觉/ARIA 选中项；Space 沿用按钮键盘确认语义并与 Enter 统一目标，hover 不抢焦点。
- `reference/command-menu-live.json`、`reference/dock-command-live.json`、`reference/utility-menu-live.json` 与现有 `canvas-command-icons.js` 是既有结构/图标证据，本轮未改尺寸、图标、文案、节点类型顺序。

## 本轮实际修复

1. 添加菜单 Tab 不再提前移除焦点元素；原生焦点真正移出后关闭，包括回到 `#add`。窗口失焦、浏览器工具栏方向的 focusout 也关闭。延后检查有版本号，旧检查不能关闭刚重开的菜单。
2. 方向键从当前真实焦点行移动，鼠标悬停的高亮不会改变下一次键盘移动起点。Enter/Space 执行当前视觉/ARIA 选中项，避免 hover 视频后 Enter 创建旧文本焦点；确认抑制按键 repeat，并尊重修饰键。行可见性只滚动菜单本身，避免 `scrollIntoView` 使祖先画布移动。
3. 支持输入法 `keyCode=229` / `Process`；已有事件所有者和外部输入框仍保留按键。Escape 只消费当前菜单，恢复打开前的焦点；点击创建先恢复焦点，再执行现有真实创建器。
4. `#add` 获得和现有 listbox 匹配的 `aria-haspopup` / `aria-controls`；仅 dock 模式标记展开。滚轮关闭不再把 WheelEvent 当作“恢复焦点=true”。
5. 空白双击入口跳过已消费事件、非主按钮和画布内交互控件。

这些键盘/关闭改动属于对当前本地可复现问题的完善；本轮没有登录官方页面逐态验证原站焦点策略，不能据此声称所有键盘行为与原站完全一致。

## 已验证

```sh
node --test tests/canvas-command-menu-lifecycle.test.cjs tests/canvas-node-menu-media-availability.test.cjs tests/canvas-menu-history-runtime.test.cjs tests/canvas-command-menu-qa-generator.test.cjs tests/node-history-expansion.test.cjs tests/canvas-keyboard-ownership.test.cjs tests/menu-dismissal-ownership.test.cjs tests/canvas-toolbar-measurements.test.cjs tests/canvas-toolbar-selection-performance.test.cjs
node --check canvas-commands.js
node --check canvas-menus.js
```

52 项通过，包括本轮新增 17 项；其余覆盖生产剪贴板权限、分数缩放素材导入、共享右键菜单、工具栏测量与 4000 节点视图更新。本分支未操控浏览器。主线已实机确认二次点击 + 关闭、菜单内部/末项退出 Tab、Shift-Tab、Escape 回焦、hover 后 ArrowDown 到图片，以及画布焦点下 ⌘Z 删除文本、⌘⇧Z 恢复同 id。主线重新生成并 reload 当前主壳后，实机确认文本按钮保持焦点、hover 视频使其 aria-selected=true，Return 新增真实 video（id 前缀 `32ccb388`）并关闭；再次 hover 图片后 Space 新增真实 image（id 前缀 `596d4d31`）并关闭。两次均回焦 dock `+`，`canvasScroll=[0,0]`、`externalAttempts=[]`。旧视频及 fullImage 历史仍仅由真实 runtime/model 测试覆盖，未独立 CUA 复验。

## 正式主壳 QA

正式 QA source 位于可版本化的 `src/features/canvas-command-menu/qa/{fixture.js,controls.mjs}`。生成器从当前 `index.html` 生成并递归创建 `qa/canvas-command-menu`；后者是被忽略的本地生成输出，不提交。新 clone 不依赖旧私有 QA 文件。

```sh
node scripts/create-canvas-command-menu-main-qa.cjs
```

在已确认的本地监听器打开 `/qa/canvas-command-menu/app.html?session=menu-review-1008`。该页采用真实当前入口、真实 `app.js` 和菜单模块；仅偏好、数据库、种子节点和提供方状态隔离。数据库名包含 `qa-canvas-command-menu`，所有 API 生成调用禁止。不要把此页当成原站静态副本。

人工检查：

1. 点击左侧 `+`，再次点击应关闭而不重开；核对文本/图片/视频/音频/3D、三个辅助工具和上传；检查八种创建器通过各自既有流程新增实际节点。3D/图片编辑器保持现有可用性，不触发生成。
2. 保持文本行的键盘焦点，鼠标移到视频行，按 Down 应移到图片行。重新打开，保持文本焦点并 hover 视频，Enter 或 Space 应创建视频；hover 不移动 DOM 焦点，确认目标与视觉/ARIA 一致。End/Up/Home 在短窗口内保持焦点行可见，诊断中的 `canvasScroll` 保持 `[0,0]`。
3. Tab/Shift-Tab 在菜单内自然移动；真正离开菜单时关闭，外部焦点不被抢回。Escape 关闭并回到 `+`；输入法合成期间保持当前菜单。
4. 切换另一窗口或 Tab 到浏览器工具栏后回来，旧菜单应消失。关闭再快速重开，旧延后 focusout 不得关闭新菜单。
5. 点菜单“文本”创建实际节点，先点击空白画布让 `#canvas` 获得焦点，再 ⌘Z/⌘⇧Z 撤销/重做恢复同一节点；dock 的 `+` 属于外部交互范围，焦点仍在它上面时快捷键守卫不操作画布。菜单关闭后焦点不留在被删除的按钮上。上传仍通过原生文件选择器。
6. 空白双击出现 288px 命令菜单，`addExpanded=false`；在节点、输入框、按钮内双击不出现空白命令菜单。点击外部/滚轮关闭时保持目标焦点。
7. 有本地图片的右键菜单包含下载/图片剪贴板；空图片不显示这些命令且保存素材禁用。真实下载/图片剪贴板应分别验证落盘文件和 PNG 剪贴板读取。

`window.CanvasCommandMenuQA.diagnostics()` 提供当前菜单、真实焦点行、焦点行可见性、画布滚动、节点数、撤销状态和外部请求尝试。诊断面板不会主动聚焦或覆盖左侧 dock 菜单。

## 边界

本分支未执行浏览器操控；主线上述实机已验，旧媒体及 fullImage 历史浏览器复验、原生文件上传/下载/PNG 剪贴板读回、官方在线动态插件菜单、菜单动效逐像素比对仍未验证。未新增依赖、未读取 Key、未调用外部生成、未提交。
