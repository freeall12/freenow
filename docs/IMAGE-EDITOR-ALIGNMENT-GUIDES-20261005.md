# 图片编辑器对象吸附与辅助线 · 2026-10-05

本增量补齐拖动对象时的画板边缘/中心吸附。使用现有 Fabric 6.7.0，不改生成接口、依赖或节点世界坐标。

官方依据为已捕获的原始 `vendor-packages-D5zYVFLI.js`：字符偏移 `1285657`的 `Va=10,DZ` 及 `1412847`的 `object:moving → DZ` / `object:modified → p1`。当前另一官方包 `vendor-packages-CN3JnHbF.js` 的 `_$` / `x1` 具有相同链路。原始私有摘录保留在 `reference/image-editor-alignment-official-source-20261005.txt`；应用、测试和公开 QA 均不读取此文件。

- 阈值严格 `< 10`，单位为画板逻辑像素，不读取视图缩放。0.5 倍视图中相当于 5 屏幕像素，1 倍中相当于 10 屏幕像素。
- 一次移动先捕获原始左、上、右、下和两轴中心，再依次检查左→上→右→下→水平中心→垂直中心。同轴多项命中时中心最后覆盖，全部命中的辅助线仍显示。
- 官方尺寸为 `width*(scaleX||1)` / `height*(scaleY||1)`；零缩放沿原代码回退为 1，不读取 angle、flip、skew 或旋转包围盒。本地对象有 center 等原点，因此先归一到等价的 left/top 存储约定；没有增加官方未提供的旋转包围盒吸附。
- 辅助线颜色 `#43A8FF`、逻辑宽度 1px、5/5 虚线、透明度 0.8。瞬时 DOM 覆盖层位于画板内，跟随既有画板变换；没有 Fabric 对象，不进入图层、文档、PNG/JPG/PSD 或历史。不会按用户对象 ID 前缀删除对象。
- 仅在选择工具、当前有效编辑器的 `object:moving` 中启用。裁剪、加载、绘画、画板调整与空格平移不激活。拖动结束、选择变化、文档恢复、视图缩放/平移、Escape、pointercancel、窗口失焦、pagehide 与关闭清理。
- 移动过程中只更新原目标位置；没有新增 record，现有 `object:modified` 为整次拖动记录一个撤销步骤。

验证命令：

```bash
node --test tests/image-editor-alignment-guides.test.cjs tests/image-editor.test.cjs tests/image-editor-object-editing.test.cjs
pnpm build:image
node --check image-editor-entry.mjs
node --check src/features/image-editor/qa/alignment.mjs
```

上述基础定向 12 项通过；追加现有 Agent 桥接/导出回归后共 21 项通过，包含严格阈值、小数位置、顺序覆盖、真实 Fabric center/left 原点、零/负缩放语义、旋转/flip 不改算法、生命周期与禁用状态。构建成功。Node 与 HTTP200 不能代替原生拖动/视图/导出验收。

公开隔离主壳入口：`/src/features/image-editor/qa/alignment.html?session=alignment-1005`。fixture 对 CanvasStore、LocalAssets、模板与偏好分别隔离，使用实际生产 bundle 和一张琥珀矩形；不依赖官方抓包文件、真实供应商或用户项目。

1. 点击“打开编辑器”，用真实鼠标把琥珀矩形拖近左侧/上下/中心，观察对应辅助线。命中辅助线时 QA 自动调用生产 `renderExport(1)`、生成 PNG 并用 `createImageBitmap` 实际解码。
2. 读取诊断：`lastExport.guidesAtSnapshot > 0`、`bluePixels === 0`、`documentObjects` 只有 `snap-target`、解码为 600×600；辅助线蓝色不能出现在输出。
3. 放开鼠标后 `lastDrag.historyAdded === 1`、`guidesAfterRelease === 0`。撤销/重做应恢复原位置/吸附位置。节点世界坐标始终 `52000.25/-1800.5`。
4. 切换 0.5/1 倍视图，复验阈值与辅助线定位；平移、Esc、失焦、裁剪/绘画/调整画板及关闭应无残留辅助线。
5. 保存并刷新同 session，重开确认真实文档位置保留、没有辅助线对象。

主线程已完成 Computer Use：0.72倍视图真实拖至左边缘，逻辑center-origin left精确为60，辅助线命中1条；松手追加1笔历史且辅助线为0，撤销恢复180.125/180.375。0.5倍拖至两轴中心精确300/300，命中2条，世界坐标保持52000.25/-1800.5。拖动期间生产PNG真实解码600×600，文档仅有snap-target且bluePixels=0。保存显示「已保存」，刷新同session重开保留300/300且无辅助线对象。

[真实左边缘拖动截图](screenshots/image-alignment-guides-20261005.jpg)。测试使用默认1280×720本地视口与隔离数据；完整媒体编辑器逐态视觉与真实供应商质量仍未最终验收。
