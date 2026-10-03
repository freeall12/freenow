# 片场面板：目录快照与树控件焦点

## 官方证据与实际缺口

同版 `reference/studio-v2-page-readable.js`：

- `1748–1750` 的 `tc` 从已有 `view.animations` 派生镜头运镜关联；`1772–1785` 的 `oc` 从这份关联计算镜头数量并生成运镜行。
- `2618` 在场景加载时构建 `this.clips`，向 UI 提供动画快照；没有为每个镜头重新扫描轨道和对象图。
- `1758–1770` 的 `rn/nc` 在每个父级中保留 50 条分页与展开状态；React 复用展开和仍存在的“显示更多”按钮，点击后焦点继续可用。
- `2892–2894` 的对象选择将焦点交给视口。本轮保留该行为。

本地 `ScenePlayback.catalog()` 对每段动画的每条轨道执行真实 `THREE.PropertyBinding.findNode`，再遍历目标子树确定镜头和对象绑定。此前 `scene-panel.mjs` 为每个镜头调用一次 `catalog()`，生成运镜行时又调用一次：120 个镜头即 121 次重复图扫描。此外，展开或分页调用 `content.replaceChildren()`，删除了刚被点击的焦点控件。

## 窄修实现

生产代码 owner 仅 `src/features/studio-v2/scene-panel.mjs`：每次面板刷新只取一次新鲜 `catalog()`，拍摄页用同一目录计算镜头计数、运镜行；场景页对象动画也用这份目录。没有跨帧或跨 revision 缓存。每个 clip 的重复 camera ID 在计数中仍按原 `includes` 语义计算一次，运镜行继续保留原重复关联、顺序与失效对象过滤。

树控件携带对象/父级 ID。展开、收起后恢复到替换后的同一展开按钮；分页后如果“显示更多”仍存在就恢复到它，最后一页恢复到本次第一条新行。父级分页额度、展开状态与隐藏运镜源过滤继续沿用原规则；选择对象仍调用正式 select/focus 并聚焦视口。

独立测试、合成 QA 与本文未改变公共 API、依赖、保存合同或运行时其他模块。

## 已执行检查

```bash
node --test tests/studio-v2-scene-panel.test.cjs tests/studio-v2-scene-panel-snapshot.test.cjs tests/studio-v2-scene-panel-qa.test.cjs
node --check src/features/studio-v2/scene-panel.mjs
node --check src/features/studio-v2/qa/scene-panel-controls.mjs
node --check src/features/studio-v2/qa/scene-panel-fixture.js
git diff --check -- src/features/studio-v2/scene-panel.mjs
```

12/12 通过：原有隐藏源过滤、可选分页与完整镜头标签 3 条；真实 Three 400 Groups/120 cameras/120 clips 单次目录、共享/重复关联顺序与新快照、展开收起焦点、101 条最后页焦点、嵌套父级独立分页/完整重绘/切换、场景对象动画 6 条；合成 QA 实际 GLB 经生产导入回读、公开 active getter/真实 renderer canvas、网络隔离 3 条。实际回读确认 151 个 meshes、120 个 cameras、120 个正确绑定的两秒动画和 521 个根子节点。QA 页面 HTTP 200 只证明服务器路径可达。

可复现实验：

```bash
node src/features/studio-v2/qa/benchmark-scene-panel-catalog.cjs
```

同机一次新鲜运行，真实 Three 场景 520 个后代（400 Groups、120 cameras）、120 clips，每路径预热后采样 7 次：旧的目录重复路径 121 次 catalog，中位数 95.14 ms（94.70–101.38 ms）；单份目录路径 1 次，中位数 0.80 ms（0.79–0.85 ms）。两边均产生 120 个计数与 120 个顺序关联。

**这只测目录扫描、计数与顺序 camera ID 的元数据路径。** 不含 DOM 创建、`runtime.find`、加载、GLB 编码、GPU、完整帧或端到端操作。不能据此宣称整体帧率提升，数值也不是性能保证。

## 真实生产 shell 的可点 QA

```text
http://localhost:4173/src/features/studio-v2/qa/scene-panel-main.html?session=panel-oct03-01
```

生成器 `qa/generate-scene-panel-app.cjs` 从生产 `index.html` 生成入口，使用正式画布、片场/WebGL/runtime/UI，不替换场景目录或选择逻辑。准备按钮创建显式合成布景，调用正式 `exportGlb`、`LocalAssets.put`、`CanvasApp.addNode/saveProject`、`StudioAPI.open`，再次经生产 GLB loader 进入片场。默认布景包含可见的 151 个砖红色模型、120 个镜头、120 段运镜和用于图查找压力的 400 个真实空分组。

同一 session 复用独立 IndexedDB；不清除用户数据。配置请求返回明确未配置，生成/其他 API 与外网请求被阻止。没有模型生成调用或 Key。

1. 点“准备并打开真实大场景”。确认 WebGL 有实际模型，diagnostic `prepared=true/loadStatus=ready`。检查器位于中央下方，可收起以检查正式左侧面板。
2. 点“测一次正式拍摄页刷新”。该按钮先清零计数，再调用真实拍摄 tab。诊断应为 `catalog.panelCalls=1/allCalls=1`、`shotRows=120/motionRows=120`；镜头计数都是 1。统计包装始终返回真正的 `catalog()` 结果。
3. 在正式拍摄列表点“QA 镜头 120”（或显式 QA 委托按钮“选择正式镜头120”）。检查实际 `shotId=qa-panel-camera-119` 与正式行 `aria-pressed=true`，预览应随真实镜头变化。选择流程会引发其他预览/运行时目录调用，不能用其累计 allCalls 断言单次面板开销。
4. 点“打开正式场景页”，正式展开“QA 分页模型组”。应出现 50 个组内模型，焦点在同对象展开按钮、`aria-expanded=true`。收起应使焦点回同一按钮、`aria-expanded=false`；再次展开复用状态。
5. 点击该组正式“显示更多”（或 QA 委托按钮）。组内行数依次 100、150、151。前两次新 DOM 的“显示更多”仍有焦点；最后一次该按钮消失，焦点为“QA 模型 151”的 treeSelect，`objectId=qa-panel-model-150/parentId=qa-panel-models`。检查 `activeElement`；点检查器后可看保留的 `lastPanelFocus`。
6. 在正式树中选择模型 151。检查实际 selected ID 与模型属性检查器，焦点在实际渲染 canvas。切换拍摄/场景或重新展开应仍保留该组 151 条分页额度。

QA 的 `catalog.panelCalls` 通过同步调用栈的真实 `scene-panel.mjs` 路径区分，`allCalls` 记录所有实际目录调用；`panelCatalogMs/allCatalogMs` 只记录目录函数，`lastAction.synchronousMs` 只记录同步正式控件点击。所有时间均不包括异步保存或完整渲染。

新鲜浏览器验收由主执行者记录；本文没有把上述本地测试与服务器 200 等同于完成视觉验收。
