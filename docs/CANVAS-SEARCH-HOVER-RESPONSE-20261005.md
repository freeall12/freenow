# 主画布节点搜索 hover 响应 · 2026-10-05

基线 `77ad190`。正式节点搜索的每个结果button在 `pointermove` 中设置选中行，再执行 `querySelectorAll('.search-item')` 和全部结果的 `classList.toggle('chosen',...)`。鼠标在同一行内每移动一次也重复此工作。

本次仅修改 `src/features/canvas-search/ui.js`：本次渲染持有自己的结果按钮数组，行变化时只移除旧行chosen、添加新行chosen；同一行的pointermove直接返回。重建结果时同时重建按钮数组及高亮引用，不缓存搜索文档跨打开。查询和正式30结果上限不变。

上下键即使到达首尾边界也继续按原公式检查滚动位置。输入/分类切换/空结果/重开、Enter定位、Escape先清查询再关闭、IME期间快捷键保护保持原行为。原实现没有pointerleave清选逻辑，本次继续在鼠标离开后保留当前选中行；没有引入 hover 清空、焦点跳转或新交互。

## 可复现控制变量

`tests/canvas-search-highlight-performance.test.cjs` 加载真实搜索core与完整生产UI，基线还原原highlight及pointermove两处实现，使用同一1000节点图、相同30个真实query结果和相同事件序列。合成DOM仅计数API调用/提供固定行高度，不模拟浏览器帧率。

| 相同输入 | 原实现 | 本次 |
| --- | ---: | ---: |
| 第一行240次pointermove：结果DOM扫描 | 240 | 0 |
| 第一行240次pointermove：chosen类API操作 | 7,200 | 0 |
| 再依次hover第2、13、30、1行：类API操作 | 120 | 8 |

逐步比较当前结果顺序、选中行、列表scrollTop、dialog打开状态、输入焦点及Enter定位节点，输出一致。另覆盖末行键盘重复、空列表、分类与查询重建、新节点后重开、IME、Escape与Enter。没有改节点坐标、视口或历史数据。此证据只说明重复DOM扫描和类操作减少，不能宣称整体FPS或真实浏览器耗时提升。

```sh
node --test tests/canvas-search-highlight-performance.test.cjs tests/canvas-search.test.cjs
node --check src/features/canvas-search/ui.js
node --check tests/canvas-search-highlight-performance.test.cjs
git diff --check
```

两条UI响应/等效回归和四条原查询/坐标检查通过。不跑全库、不新增依赖、不提交。

## 主线程 Computer Use 最短入口

现代隔离入口：`/src/features/canvas-search/qa/performance.html?session=search-hover-1005k-modern`。该HTML由当前 `index.html` 派生，保留正式 freenow DOM、importmap 与脚本顺序（含 CanvasProjects、project-context、app 前的 LocalAssets），只把四份数据文件换成公开defaults并在app前注入500合成节点（450张内联SVG、50段文本）。旧 `qa/canvas-groups-app.html` 外壳仍有历史品牌/控件及旧初始化缺口，不再用于本项最终截图或整链验收。

专属 `fixture.js` 在任何生产脚本前设置session的localStorage及全部IndexedDB命名空间；不读取实际用户项目。CSP和fetch拦截禁止原站/外网，API配置仅返回未配置状态，其他生产API和模型请求被拒绝。现代入口继续显示正式30结果上限，不人为提高limit。页面右上角明确标记隔离合成节点；`CanvasSearchPerformanceQA.audit()`提供隔离状态和被拒绝请求计数。若QA服务启动时固定了publicFiles列表，需要由主线程开一个能服务新文件的独立host；不要为加载新HTML删除旧host归档。

1. 点击侧栏「节点搜索」，在不同结果行内原生hover/来回移动；观察高亮只跟随当前行，移出后继续保留。
2. 输入「性能」，按上下键到超出可见区域，确认选中行自动滚动。中文输入期间方向键应留给输入法。
3. 回到搜索输入框，按Enter定位当前结果，确认搜索关闭且画布聚焦该节点。
4. 再开搜索，输入查询后按Escape一次清空，再按一次关闭，返回正常画布操作；切换图片/全部、清查询、重新打开应保持结果与高亮一致。

该开发分工未操作浏览器。新入口仅执行fixture语法与diff检查，没有重复新增测试；此前六项优化检查仍是算法/交互等效证据。

## 主线程实际 Computer Use 证据

主线程在本机现代隔离入口完成本轮验收：页面实际显示500合成节点，默认搜索显示30结果；输入「性能」后按Down两次，截图高亮「性能镜头 003」。第一次Escape清空查询且搜索仍打开，第二次关闭，原生焦点返回侧栏搜索按钮。该次正式QA的 `dev.log` 中 `error/warn=[]`。

![当前正式freenow搜索界面，高亮性能镜头003](screenshots/canvas-search-hover-20261005.jpg)

同项鼠标重复移动及20次键盘定位另在旧隔离壳中复验；它们证明对应搜索机制，不作为现代入口整链或最终外观截图证据。上表240次pointermove的扫描与类API数字来自定向JavaScript/合成DOM控制变量检查，不是Computer Use帧率测量。此次未测整体FPS、绘制或GPU耗时，不能将这些结果表述为整体帧率提升。
