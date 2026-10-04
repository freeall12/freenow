# 片场对象与关键帧数字草稿

本增量恢复官方数字输入的取消和提交语义，不代表片场所有交互或视觉已完成。

## 官方依据与实际缺口

官方发布 `eb1c3578957450302e3cff5edd2ad253d0874421` 的 `page-BLLZVxQI.js`，本机可读副本 `reference/studio-v2-page-readable.js:1373–1404` 的 `sn`：显示值 `tn(value,precision)` 与输入草稿 `u` 分开；无草稿时失焦返回；输入有效有限数字且与原始值不同才提交；Escape 清空草稿并保留输入焦点；轴向拖动开始时聚焦输入并清空草稿。`ha` 和 `Qa` 分别复用它编辑关键帧和普通对象。

原本地 `properties.mjs` 与 `motion-ui.mjs` 直接在 blur 读取显示字符串。显示位置/缩放只留3位、旋转只留1位，因此即使未输入，失焦也会将原始精度截断。Escape 先恢复格式化字符串，随后的 blur 同样会误提交；关键帧还立即 blur。

## 实现

`inspector-number-field.mjs` 只记录真实 `input` 事件产生的草稿；Enter 或普通失焦仅提交有效、非空且与原始值不同的数字。Escape 清空草稿、恢复显示并停止外层键盘冒泡，保留焦点。拖轴前清空草稿，拖后失焦不将显示舍入值再次写入。对象与关键帧复用同一绑定；实际更新仍分别调用原有 `SceneRuntime.update` 与 `MotionEditor.edit`，保留原坐标空间、显示精度与历史/保存路径。

关键帧字段提交期间的同步 `scene` 通知只更新现有字段读数，不重建字段DOM；其他场景通知保留原刷新行为。否则位置X草稿被位置Y手柄聚焦触发blur提交后，整个inspector会立即重建，正在按下的旧Y手柄在捕获指针前已移除。回归覆盖X提交一笔历史、Y完整拖动再提交一笔，保留两轴数据。QA捕获事件在下一动画帧读取回执，避免capture阶段的microtask先于目标输入处理而报告旧显示。

## 验证和公开复现

```sh
node --test tests/studio-v2-number-field.test.cjs tests/studio-v2-number-field-qa.test.cjs tests/studio-v2-viewport-shortcuts.test.cjs tests/studio-v2-scene-panel.test.cjs tests/studio-v2-agent-controls.test.cjs
node src/features/studio-v2/qa/generate-number-field-app.cjs
```

公开 QA 源码与页面均位于 `src/features/studio-v2/qa/number-field-*`；生成器从正式 `index.html` 接入实际 CanvasApp、片场加载器、WebGL 与正式控件。入口：`http://localhost:4173/src/features/studio-v2/qa/number-field-main.html?session=number-manual`。使用独立 IndexedDB 名与页面内偏好存储；本地配置读返回未配置，模型/API及外部请求在发送前拒绝，并有 CSP 限制。

1. 点击“准备并打开真实片场”，再点“正式树选择精确立方体”和“记录当前精度与历史基线”。原始位置为 `[2.375432109,0.5,-0.123456789]`、缩放X为 `1.234567891`，控件显示舍入值。
2. 只聚焦正式“位置 X”后失焦；输入 `987.654321`、Escape，再失焦。位置/旋转/缩放、revision、undo/redo应保持基线，Escape后焦点仍为输入框。
3. 在“位置 X”输入 `2.765432109` 按 Enter；应仅增加一次历史/版本，普通对象保存精确输入。再聚焦/失焦不增加历史。
4. 点“正式运镜选择第1关键帧”，记录新基线，重复上述操作。关键帧使用真实 GLB Float32轨道，原值约 `5.375432014465332`；提交精度以现有轨道类型为准，不将Float32差异当作本次输入舍入。
5. `window.StudioNumberFieldQA.read()` 与可见“数字字段真实数据回执”记录当前原始数据、基线、lastReceipt、焦点、版本、历史及被拒网络请求。主线程负责真实Computer Use；逻辑与GLB测试不替代GPU/实机验收。
6. 关键帧“位置 X”输入有效草稿但不失焦，再按下并拖动“位置 Y”的Y标签。X应提交一次，Y手柄继续捕获/拖动，松开再提交一次；不应出现失效指针捕获错误。

新增回归通过生产参数控件、Three对象、SceneRuntime更新路径、MotionEditor和真实动画轨道验证取消/失焦不变、精确Enter只提交一次、空白/非法/相同草稿不提交、拖轴接管丢弃草稿；检测外层keydown没有二次响应。QA测试验证实际GLB重新加载和网络/存储隔离。本增量不验证所有连续拖动/hover状态、全场景视觉或真实供应商。

## 主线程 Computer Use 与交叉复验

2026-10-04 通过正式 CanvasApp/StudioAPI/WebGL 入口验证：

- 普通对象位置 `2.375432109`、旋转与缩放：未编辑失焦、输入987.654321后Escape再失焦均保持原数据及revision/undo为0；Escape实际DOM显示2.375并保持输入焦点。Enter提交 `2.765432109` 后revision/undo各增加1、保存版本1；旋转/缩放取消没有提交。
- 实际GLB关键帧位置 `5.375432014465332`：未编辑失焦及Escape保持原轨道；Enter输入5.765432109只增加一次历史，轨道存为现有Float32的5.765431880950928，其他两帧不变。
- 交叉审阅发现跨轴失焦会重建DOM后失效捕获，已修复并重新载入：X草稿6.987654321→直接拖Y轴30px，X存6.987654209136963、Y从3.1234567165374756变为3.4234566688537598，各增加一次历史，没有指针捕获错误。
- 诊断捕获阶段的microtask曾显示按键处理前值，已改下一动画帧，实际输入值和精度通过DOM及原始数据回执交叉核对。

片场专项新增7项和QA2项通过；初批相邻12项通过，总计21个相关检查（最后修复后只重跑受影响专项）。截图见 [实际片场](screenshots/studio-numeric-draft.jpg)。

隔离QA初版阻止Meshopt静态WASM初始化；仅QA生成器及HTML追加 `wasm-unsafe-eval`，不允许JavaScript字符串eval、不改正式入口或服务端策略，网络/iframe限制保持。新增QA断言保护这个范围。真实新会话通过正式“上传模型”导入仓库 assets/studio/tree.glb（必需EXT_meshopt_compression），检查完成→添加到场景→模型已添加并保存，聚焦后真实绿色树冠/树干及镜头预览可见；刷新直接重入既有片场，树模型仍渲染。没有WASM错误；仅有GLTFExporter规范化非单位法线的两条警告。见[刷新后的压缩模型](screenshots/studio-meshopt-local.jpg)。该限制属于新隔离QA，不据此宣称正式入口此前缺少Meshopt。
