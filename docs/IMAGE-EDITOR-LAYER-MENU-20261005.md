# 图片编辑器图层菜单 · 2026-10-05

图层缩略图补官方右键菜单：复制图层、上移一层、下移一层、删除图层。操作对象是被右键点击的缩略图，可以与当前画布选中对象不同；上下移动只移动一个层位。

## 官方依据

已捕获的原始 `vendor-packages-D5zYVFLI.js` 字符偏移 `1361951` 的 `J$`：

- 对目标 layer ID 查找实际 Fabric 对象，复制调用 `clone()`，位置分别加 10，新 ID，添加到最上层并选中新副本。
- 上移调用 `bringObjectForward`，下移调用 `sendObjectBackwards`；顶层上移和底层下移禁用。
- 删除只移除目标对象；菜单 `w-48`，复制和层序/删除之间有分隔线，删除使用红色文字。
- `eQ`（偏移 `1363430`）为每个缩略图传入其自身 `layer`，所以右键不需要先把图层选中。没有按 `selectable` 或锁定标志额外禁用菜单。

另一官方包 `vendor-packages-CN3JnHbF.js` 的 `UQ` 同样保留这四项动作和边界（`layers.copyLayer` 位于字符 `1381929`）。

私有原包摘录保留在 `reference/image-editor-layer-menu-official-source-20261005.txt`。公开 QA、测试和生产代码不读取该文件或官方站点。

## 实现与数据边界

`src/features/image-editor/layer-actions.mjs` 接入现有菜单框架、按钮与图标。菜单宽 192px，可用右键或 Shift+F10 / ContextMenu 键打开；所有菜单 keydown/keyup 均阻止冒泡到编辑器快捷键，避免方向键误移当前对象、Delete 误删和 Space 切入平移；方向键、Home/End 移动菜单焦点，Enter/Space 使用原生按钮，Escape 返回缩略图焦点。Tab 移出、外点、窗口失焦、文档/选择变化与关闭清理菜单。

每个成功操作调用一次既有 `record()`，保留撤销/重做和保存合同。顶底边界点击不产生历史。位置使用逻辑像素，编辑器缩放和平移不进入坐标；节点世界坐标不变。复制保留实际变换、素材来源和图层属性，但使用新 ID；生产 `record()` 的 `ensureArtworkIds` 为嵌套分组的副本子图层逐个生成新 ID。暂态 ActiveSelection 的复制先还原实际画板矩阵，避免把局部相对坐标当作画板位置。

复制等待期间重新检查项目 ID、来源节点对象/来源文档、编辑器存活/修订、完整当前文档、目标对象身份、加载/保存/拖动状态。关闭、移动、换文档、撤销重建、换源或切项目均拒绝迟到副本；没有插图、部分历史或自动保存。生成、供应商协议、公共 API 与依赖未改。

## 验证与公开隔离入口

```bash
node --test tests/image-editor-layer-actions.test.cjs tests/image-editor.test.cjs tests/image-editor-alignment-guides.test.cjs
pnpm build:image
node --check image-editor-entry.mjs
node --check src/features/image-editor/layer-actions.mjs
node --check src/features/image-editor/qa/layers.mjs
node --check src/features/image-editor/qa/layers-fixture.js
```

定向检查合计 23 项通过：13 项本次回归，包含真实 Fabric 副本、分组子图层 ID/矩阵、ActiveSelection、单步层序、未选中删除、6 类迟到结果拒绝，以及菜单全部键盘事件隔离/原生 Space、Enter、Tab 默认行为；加既有编辑器与吸附 10 项。键盘修复后重跑受影响 13 项通过。构建与语法通过，隔离入口 HTTP200。Node 结果不代替真实浏览器菜单、层序输出与刷新验收。

公开入口：`/src/features/image-editor/qa/layers.html?session=layer-menu-1005`。CanvasStore、LocalAssets、模板与 localStorage 分别使用 QA 隔离命名；数据仅为三个本地 Fabric 矩形，不调用生成或读取用户项目。

1. 打开编辑器，右键左侧绿色顶层：上移禁用。下移一层后诊断顺序变为琥珀→绿色→蓝色；一次历史，原对象坐标不变。
2. 点击“导出 PNG 检查层序”，调用生产 `renderExport(1)`、真实 PNG Blob 编码并 `createImageBitmap` 解码，中心像素应为蓝色 `[50,103,133,255]`。
3. 右键未选中的琥珀底层并复制，副本到顶层、独立新 ID、两轴 +10；中心像素应为琥珀 `[217,151,50,255]`。若未先上移恢复顶层，删除副本后恢复蓝色；本次实机先把绿色上移恢复顶层，删除副本后实际为绿色。每步分别一笔历史，撤销/重做恢复相应层序。
4. Shift+F10 打开缩略图菜单；方向键不能移动画布当前选中图层；Escape 回焦原缩略图，Tab 移出/外点关闭。
5. 点击“延迟下一次琥珀复制”，右键琥珀复制，立即“替换隔离文档”。2 秒迟到克隆必须拒绝，不新增副本/历史；诊断只包含文档替换的一笔记录。
6. 保存、刷新同 session、重开；层序/坐标和新副本 ID 应保持，世界节点始终 `52000.25/-1800.5`。

## 主线程原生验收与修复

主线程在同一隔离 session QA18 使用真实鼠标/键盘验证：

- 初版菜单只可点击默认聚焦的复制项，点击其他项时菜单消失但层序/历史不变。根因为按钮失焦与下一个按钮获焦之间 `document.activeElement` 短暂为 body，focusout 微任务提前删除菜单，丢失后续 click。
- 修复先读 `event.relatedTarget`：菜单/原缩略图内转移直接保留；真实外部转移再核对；缺 relatedTarget 时等完整焦点交接后核对，并以 popup 对象身份保护新菜单。
- 修复后下移实际一次历史，顺序琥珀→绿色→蓝色；真实 600×600 PNG 中心 `[50,103,133,255]`。随后上移实际一次历史，恢复琥珀→蓝色→绿色。
- 未选中的琥珀复制成功，新 ID、位置 `160.125/160.375`（两轴 +10），PNG 中心 `[217,151,50,255]`。
- Shift+F10 打开，ArrowLeft/Delete 未误移/误删当前画布对象；ArrowDown 跳过禁用项，Space 真正触发副本下移且一次历史。删除副本后实际保留三层，撤销还原副本；这条路径先恢复绿色顶层，删除后上方仍是绿色。
- Escape 菜单归零，焦点返回相同缩略图。

- 琥珀复制延迟 2 秒期间替换隔离文档，替换后 3 层、琥珀 `left=250.125`、`history=6/revision=9`；等迟到克隆结束再次读取，仍为同样 3 层和 `history=6/revision=9`，没有副本或额外历史。
- Tab 从复制→下移→删除→外部，第三次离开后菜单数为 0。

实机截图：

![实际图层菜单与隔离诊断](screenshots/image-editor-layer-menu-20261005.jpg)

本次完成上述菜单操作、键盘焦点、真实输出字节/像素和迟到结果保护的定向原生验收。保存/刷新及更多复杂图层组合仍保留既有专项验收边界；本页不把 Node 或 HTTP200 作为这些流程完成依据。全站视觉、所有字体/复杂图层逐态和真实模型质量仍属既有待验收范围。
