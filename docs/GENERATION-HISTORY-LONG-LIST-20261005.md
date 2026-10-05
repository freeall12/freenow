# 生成历史长列表的连续 DOM 与资源边界 · 2026-10-05

本批只修改 `src/features/generation-history/ui.mjs` 的列表刷新。布局依据为 既有官方历史来源记录（本机忽略文件 `reference/generation-history-20261002.md`，公开功能合同见[历史模块](../src/features/generation-history/README.md)）：官方 `Id/Eht/hb/Tht` 的实际日期分组、按结果 ID 选择、图片/视频/音频/3D、44px 列表缩图、显式预览与批量应用。该记录是先前官方源码和线上 CUA 捕获，本批未再次打开线上服务；localhost 仅为本地实现验收。

此前虽然缓存了 row 和 img 对象，每次选择或 busy 改变仍执行 `content.replaceChildren()`，再新建日期网格并搬入全量缓存行。对象相同不代表始终连接；整组移除会打断真实焦点/hover，并让浏览器重新考虑缩图的 intersection。

现在日期 heading/grid 按本地日历日期保存，先移除真正消失的子节点，再按身份插入真正新增或变序的子节点。同顺序、同内容的日期和行始终连接。行的选择/busy 状态未改变时跳过其 class/ARIA/disabled 写入。删除一个行不会把其后所有行搬运一遍。没有分页、裁掉结果、改变媒体来源或降低可见媒体质量。

预览来源按钮保持连接。确实被删除或替换的已聚焦行，按原位置选择仍存在的邻项；同 ID 的预览按钮替换后恢复到新的预览按钮；空结果回到可聚焦的历史列表容器。修复前已保存的 scrollTop 继续恢复，焦点恢复使用 preventScroll。搜索/类型切换只释放实际离开的行；关闭仍释放所有缩图 lease，不撤销 LocalAssets 的共享 URL。

## 可复算的工作量

通过同一计数 DOM 模型执行 `e501699` 的生产 UI 源码和本批 UI，600 行、两个日期分组、选择模式中同一行选择/取消 40 次：

| 操作 | e501699 | 本批 |
| --- | ---: | ---: |
| 已有 row 搬运 | 24,000 | 0 |
| 连接的 row 被移除 | 24,000 | 0 |
| row 的 ARIA 写入 | 48,000 | 80 |
| row 的选择 class 状态写入 | 24,000 | 40 |

新回归同时核对600条完整身份、日期 grid 对象、原预览按钮焦点、scrollTop、img 对象身份、单个 lease 读取/释放。Node计数DOM不执行图片像素解码；真实解码由下述浏览器证据验证。另覆盖删除聚焦行、元数据替换、日期变化、空结果、全批120条应用身份，沿用搜索/tab/销毁/迟到缩图和600行40次idle通知回归。

上述是实际生产函数的操作计数，**不是整页 FPS、GPU 或输入延迟测量**。每次有效变化仍扫描完整历史、计算签名与日期分组；本批没有把实时原地数据变化换成只比较对象地址，也不宣称已完成列表虚拟化。

## 独立正式壳 QA

```sh
node scripts/build-generation-history-long-list.cjs
# /qa/generation-history-long-list.html?session=long-list-1005p-root1
```

精确 route/session guard 只写 `qa-history-long-list:<session>:canvas/assets`。公开 defaults 起始为空，UI preferences 在内存；fetch/XHR/WS/EventSource/beacon 拒绝外部和其他 API，generation/agent config 在本页返回明确未配置。记录是明确的合成 QA 历史，不包含模型结果声明，也不调用模型。三个 Canvas 生成的真实1200×800 PNG及对应300×200缩图写入生产 LocalAssets；600条不同 ID 共享这些实际媒体引用，两个日期作为明确的 QA 分组数据。夹具 seed 不覆盖既有记录，不清空生产数据。

1. 点击“保存600条真实PNG夹具”→“保存后刷新”，打开左侧正式“历史”。
2. 切换正式列表，进入“选择”，滚到中间。点击“记录结构计数基线”，再用真实鼠标选择/取消同一行几次，读取“结构与资源”。`renderedRecords=600`，两个日期；`rowAdds/rowRemoves=0`，每次单行选择约3次被监测属性写入。scrollTop和真实decoded缩图应稳定。
3. 使用搜索、清空搜索、类型切换和网格/列表，检查正确结果与日期。预览真实PNG，关闭后检查正式原预览按钮焦点。应用少量选择，通过生产媒体导入与IDB保存链核对真实像素和原记录身份；不需批量应用600项来验证单项更新性能。
4. 关闭正式历史，再读取QA。所有history自身URL应撤销，`nonSharedLive=0`；`sharedLive`允许留在LocalAssets缓存。再次打开列表和刷新，完整600条身份与媒体保留。

`window.HistoryLongListQA.read()` 返回 MutationObserver 的行增加/移除/属性写入、DOM记录数、日期、scroll、焦点ID、图片解码数和实际 object URL 创建/撤销账本。`nonSharedLive` 是本页未被 LocalAssets.url 认领的存活URL，做资源验收时先关闭完整媒体预览，避免把独立预览URL混算为侧栏资源。跨刷新账本只覆盖当前页面生命周期；不把共享缓存称为泄漏或宣称全应用内存为0。

## 主线程浏览器验收

主线程在 Tab92 使用 `http://localhost:4173/qa/generation-history-long-list.html?session=long-list-1005p-root1&project=qa-long-history-long-list-1005p-root1`，完成真实PNG夹具保存与刷新。生产历史侧栏恢复600条记录、2026-10-05/2026-10-04两个日期，在正式列表/选择模式滚到第208条。

| 真实浏览器操作 | 读回结果 |
| --- | --- |
| 同一行40次真实click | `rowAdds=0`、`rowRemoves=0`、`rowAttributeWrites=120`，焦点仍为“选择208” |
| 定位后新基线再10次click | 行增加/移除仍为0，属性写入30；`scrollTop` 始终为13185.5 |
| 当前列表真实缩图 | 11个img自然解码成功 |
| 正式预览/Escape | 真实1200×800 PNG打开并退出 |
| 正式侧栏实际关闭后 | `renderedRecords=0`、created46/revoked39、`sharedLive=7`、`nonSharedLive=0` |
| 本页网络/错误账本 | `externalAttempts/blockedAPIs/errors` 全空 |

首次Playwright定位点击将scrollTop从13446滚到13185.5，这是自动定位行为，不能归因于render漂移。因此定位后重新记录基线，再执行10次真实click，以上滚动保持证据只使用第二轮。首次关闭点击未生效，主线程先读状态，随后使用新AX的关闭控件31成功；资源释放数只取确认侧栏关闭后的最终回执，没有把第一次未关闭状态当作释放成功。

浏览器MutationObserver将单行class与两项ARIA写入合计为每次3项，因此40次为120，与Node表中分列的40项class/80项ARIA一致。`renderedRecords`是实际QA字段，表示DOM记录总数，不能理解为600项都在viewport里。

截图为第二轮10次click基线视图：[history-long-list-stable-20261005.jpg](screenshots/history-long-list-stable-20261005.jpg)。这些结果证明本页实际交互、媒体解码、滚动保持与关闭资源边界；仍不代表整页FPS、实际模型效果或全站视觉等效。

## 检查范围

```sh
node --test tests/generation-history-ui.test.cjs tests/generation-history-thumbnails.test.cjs tests/generation-history.test.cjs tests/generation-history-migration.test.cjs tests/media-preview.test.cjs tests/generation-history-long-list-fixture.test.cjs
node --check src/features/generation-history/ui.mjs
node --check src/features/generation-history/qa/long-list-fixture.js
node --check src/features/generation-history/qa/long-list-controls.mjs
git diff --check
```

Node 定向73项通过；主线程浏览器补验结果与边界如上。扩至 `sidebar-dismissal.test.cjs` 时，另外两个subject editor用例因其VM片段缺少 `readySubjects` 而失败；该公共模块与用例不在本批修改范围，已反馈主线程协调。这是当时扩展检查的观察，不代表公共模块当前最终状态。
