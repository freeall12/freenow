# 节点搜索 Enter 焦点一致性 · 2026-10-08

## 修复行为

搜索弹层内的 Enter 确认当前高亮结果，包括焦点位于分类按钮、清除按钮或其他结果行时。阻止按钮默认点击，避免分类重置高亮或 Tab 聚焦的结果覆盖箭头选择。Tab 只移动真实焦点，保持当前高亮；鼠标移动与箭头仍可改变高亮。鼠标点击结果或清除按钮保持各自原行为。

最小修改位于 `src/features/canvas-search/ui.js`：移除 Enter 分支的 `event.target === input` 条件。现有输入法保护、已消费事件保护、弹层范围、嵌套 dialog 范围、Escape 两阶段关闭和 cancel 处理沿用。

## 官方依据

本机只读检查 `/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js` 的 `gbe` 搜索组件（字符区间 1547988–1553896）。该 bundle SHA256 为 `8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86`。

- 弹层根 `pr` 绑定 `onKeyDown:j`。
- `j` 的 Enter：`R.key === "Enter" && (R.preventDefault(), P(E))`，不限制事件目标。`E=C[y]` 为高亮项，`P` 无结果时不做关闭或定位。
- 分类按钮 `onClick` 重设分类、高亮索引 0 和列表滚动。
- 结果按钮没有 `onFocus` 或特殊 `tabIndex`。高亮由箭头、鼠标移动和点击更新；Tab 的真实焦点与高亮可以不同。

官方源码未显示本地已有的 IME 守卫，本轮保留本地保护，不扩大为其他输入法行为变更。

## 回归证据

新增 `tests/canvas-search-keyboard.test.cjs` 运行真实 UI 源码，以小型 DOM 夹具模拟事件分发和未取消 Enter 后的按钮默认点击。修复前 8 项中 4 项失败，准确覆盖分类、Tab 结果焦点、清除按钮和空结果 Enter。修复后新测试 8/8 通过，连同已有搜索算法与高亮性能回归 14/14 通过。

```sh
node --test tests/canvas-search-keyboard.test.cjs tests/canvas-search.test.cjs tests/canvas-search-highlight-performance.test.cjs
node --check src/features/canvas-search/ui.js
node --check tests/canvas-search-keyboard.test.cjs
```

覆盖：分类焦点 ArrowDown→Enter、真实焦点与高亮不同的结果确认、清除按钮 Enter/鼠标 click 区分、空结果、`isComposing`/229/composition 状态、Escape/cancel 清词后关闭、composition 阻止 cancel、close 后重开恢复、已消费/弹层外/嵌套 dialog 不确认。既有 1000 节点索引与最多 30 项 UI 的 hover/滚动检查通过；本轮未运行全库测试。

## 浏览器复现入口

隔离页面：[http://localhost:4195/src/features/canvas-search/qa/keyboard.html](http://localhost:4195/src/features/canvas-search/qa/keyboard.html)。它加载真实搜索 UI/core/icons，使用 2 个图片与 1 个文本内存节点；`focusNode` 只把 ID 写到页面确认记录。主画布、存储与服务器无需改动，不执行真实模型。页面用橙色轮廓显示真实键盘焦点，灰色行底显示高亮。

1. **分类焦点**：点击「打开节点搜索」→点击「图片」→ArrowDown→Enter。应关闭弹层，页面显示 `最后确认: image-b`。修复前会触发「图片」分类的默认 click，把高亮重置为图片 A，弹层仍开。
2. **Tab 焦点**：重开→点击「图片」→ArrowDown→6 次 Tab，依次经过视频、文本、音频、World、分组、图片 A。不要把鼠标移到结果行。橙色焦点在图片 A，高亮仍为图片 B；Enter 应确认 `image-b`。修复前会确认焦点所在的 `image-a`。
3. **清除焦点**：重开→输入「图片」→ArrowDown→Tab 到清除按钮→Enter。应确认 `image-b`。鼠标点击清除按钮则仍清空查询并聚焦输入框。
4. **空结果**：重开→点击「音频」→Enter。弹层保持打开，音频分类和空状态不变，无新增确认记录。
5. **取消与焦点返回**：重开→输入「图片」→Escape 清词且保持弹层→Escape 关闭。浏览器应把焦点返回打开按钮；重开聚焦输入框。
6. **输入法**：输入框开启中文组词时按 Enter，只提交组词，不定位节点；完成组词后再 Enter 才确认。此项需要真实输入法检查，夹具仅验证三种 IME 事件守卫。

本轮隔离服务已核对为当前仓库的 `node server/server.cjs`（PID 22214，`127.0.0.1:4195`）；默认 4173 当前被另一项目占用，不作为本轮入口。

主页面可在 [http://localhost:4195/](http://localhost:4195/) 点击侧栏「节点搜索」或 Cmd/Ctrl+F，使用已有至少两个同类型节点重复分类与 Tab 流程；该步骤不会生成媒体。

## 实际浏览器与验证边界

主任务在上述独立 4195 入口通过 Computer Use 操作生产搜索组件：分类按钮焦点、6 次 Tab 后图片 A 的真实焦点、清除按钮焦点，三条路径的 Enter 均确认当前高亮 `image-b`。空音频分类按 Enter 保持弹层和空状态；查询「图片」后的两次 Escape 分别清词、关闭，焦点回到「打开节点搜索」。截图见[搜索焦点与高亮](screenshots/canvas-search-focus-highlight-20261008.jpg)。

这补充了浏览器原生按钮行为、Tab 顺序与关闭回焦证据。真实系统中文输入法仍未验，只有三种 IME 事件守卫的定向回归；全部分类/视口、主画布各类节点与全站状态一致性仍未逐一验收。本批没有调用模型，不作真实生成质量结论。
