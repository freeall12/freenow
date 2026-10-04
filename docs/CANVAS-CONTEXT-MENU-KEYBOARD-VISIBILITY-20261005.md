# 短视口右键菜单键盘可见性 · 2026-10-05

本增量修复已存在的平铺右键菜单在短视口下的键盘可达性：菜单虽已限高且可滚动，End、Home和方向键此前仅执行 `focus({preventScroll:true})`，不会把远端焦点行滚入菜单。现在只调整菜单自己的 `scrollTop`，保证选中行可见；再次打开从首行开始。原世界坐标、屏幕位置计算和8px边距保持。

## 官方证据与范围核对

只读核对已安装TapNow 0.4.81的 `/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js` 的 `Pme` 与节点右键入口：空白右键“添加节点”和“添加辅助工具”使用点击 `onSelect` 创建command菜单；节点右键使用group/separator与平铺items。已抓官方Web `reference/canvas-current-readable.js:44914–45003` 的 `eut` 和44910的节点菜单与此一致。安装包通用Radix库虽有100ms子菜单打开和300ms指针grace，但本画布入口未使用这些Sub组件，不能把通用组件存在当作本入口hover子菜单的依据。

两个当前核实的官方Command实现都会在选中项变化后执行 `scrollIntoView({block:"nearest"})`：

- 安装包 `index-BsHyQ2qj.js` 字符5958254附近的 `P`，读取 `[cmdk-item][aria-selected="true"]` 后滚入视图。
- 已抓Web `reference/vendor-libs-DqoAc28N.js` 字符4148275附近的 `R`，相同选中项滚动逻辑。

本地 `canvas-menus.css` 已有 `#menu max-height:calc(100vh - 16px);overflow:auto`，此次没有重复添加限高。缺口在 `component-library/ui.js` 的 `createMenu` 键盘移焦后缺少可见性处理。

## 实现与验证

`component-library/ui.js` 新增内部 `reveal`：用容器和选中行的屏幕矩形计算上下超出量，除以presence scale还原为菜单CSS像素，只改变菜单 `scrollTop`。这样不使用可能滚动外层画布的 `scrollIntoView`。现有关闭、outside、Tab、窗口失焦和Escape归属不变，仍跳过禁用项。

修改前新增两项回归都失败：End后scrollTop仍为0。修改后：

```bash
node --test tests/menu-dismissal-ownership.test.cjs tests/component-library.test.cjs
node --check component-library/ui.js
node --check src/features/canvas-context-menu/qa/fixture.js
node --check src/features/canvas-context-menu/qa/store-bootstrap.js
node --check src/features/canvas-context-menu/qa/controls.mjs
git diff --check
```

12/12定向检查通过。新增覆盖End/Home/方向键绕回与反向、禁用项跳过、菜单位置不变、重新打开归零、presence缩放中滚动量；既有菜单关闭与焦点归属回归保留。未运行全库测试，未调用生成供应商。

## 公开隔离 Computer Use

入口：`http://127.0.0.1:4173/src/features/canvas-context-menu/qa/main.html?session=menu-review-1005`

顶层wrapper嵌入340px真实iframe视口；iframe直接加载生产 `index.html`，仅把四类data脚本替换为公开 `defaults/` 并插入隔离夹具。每次进入独立project/Canvas、LocalAssets、templates与recent模板IndexedDB、本页内存localStorage；不用真实用户画布或私有数据文件。公开logo与两个明确QA历史项构成图片菜单。模型配置明确未配置，其他API和外部fetch明确拒绝。

1. 在iframe里的公开图片节点（iframe相对x400–650、y100–260）右键，等待打开动画结束。菜单本身超过340px，应出现内部滚动。
2. 按End，底项应可见；按Home回首项；ArrowUp从首项绕到末项，ArrowDown反向返回。自动回执 `focusedRowVisible:true`。
3. 在菜单内滚轮，不拖动画布；`graphAndViewUnchanged:true`，`canvasScroll`保持0。
4. Esc关闭并回到原画布焦点，再右键应从首项、scrollTop=0开始；点击空白关闭。
5. 在iframe右下空白右键，菜单应保持原8px边距且 `menuFitsViewport:true`。
6. 点击wrapper“公开长中文菜单”显示明确标注的12行测试内容，其中第11行禁用；检查End、方向键、中文换行和滚动。该按钮复用生产 `CanvasMenus.show`，不修改图、不派发模型。
7. “560px视口”和“340px短视口”切换用于检查真实resize；“新隔离会话”重新载入夹具。

回执在iframe外自动更新，不点击菜单外诊断控件，因此不会干扰生产outside关闭和焦点。字段包括菜单打开、scrollTop、焦点文案、焦点行可见性、菜单边界、图与视口不变及请求隔离记录。

## 主线程实际浏览器验收

使用原生右键、键盘和滚轮完成如下操作；生产图片菜单与公开长中文夹具分开记录：

- 图片节点右键在实际339px高的iframe中打开。End将“反馈问题”滚入可视范围，scrollTop约169.697；Home回到首项，ArrowUp绕回末项、ArrowDown回首项，每步`focusedRowVisible:true`、`menuFitsViewport:true`。
- 公开长中文菜单在实际727×339视口中保持边界和换行。End到第12行后，ArrowUp跳过禁用第11行并选中第10行；scrollTop约450，焦点整行仍可见。
- 菜单内滚轮使自身scrollTop从约450回到0；直接读取DOM确认画布仍为`translate(0px, 0px) scale(1)`，画布滚动偏移均为0。
- 图片菜单Escape关闭并回到原图片节点焦点；再次右键以首项和scrollTop=0打开。恢复默认窗口后，实点画布空白关闭菜单。图和视图比对始终保持不变，外部请求及被阻止的API调用列表均为空。

为了核对短/窄窗口使用了临时浏览器viewport设置，最后已reset。以iframe报告的实际尺寸为准，不能把请求的浏览器尺寸当作CSS视口。截图API裁剪在此浏览器触发了resize并正常关闭菜单，因此最终保留的是重新打开后的原生完整截图：[长中文菜单与真实诊断](screenshots/canvas-menu-keyboard-visible-20261005.jpg)。没有改动生产布局或生成式修图。

独立审阅发现初始QA未指定模板库名称，可能访问默认模板库；已补`TEMPLATE_DB_NAME`并用全新session重载，以上结论来自修复后的会话。没有迁移、清除或改写默认模板库。QA随后也补充新会话加载提示和菜单scroll自动回执；滚轮结论依据实际DOM读取，不依赖旧回执。

本增量不代表完整菜单、画布或全站复刻完成。没有调用真实供应商、编辑官方画布内容或运行全库测试。
