# 正式片无效连线落点 · 2026-10-04

本增量修复一个官方源码可证实的连线交互缺口：拖线落到不兼容或已有引用的 Seedance 2.5 正式片时，本地此前会显示错误提示并打开新增节点菜单；现在直接结束该手势，清理拖线预览、待执行帧和指针捕获，保持图不变。

## 官方依据与当前实现

保留的官方包 `reference/vendor-pkg-canvas-CwfaULgq.js` 的 `vQ` / `onConnectEnd`：先按起始端口方向构造 source/target 并执行 `u(P)` 验证；合法连接使用 `draft-reference`；验证失败且 `$b(I)` 为真则 `return`，不会继续创建临时 command 节点。可读采录 `reference/canvas-current-readable.js:12291–12320`，精确拒绝分支在12319；已有摘录 `reference/canvas-connections-official-source.txt` 的 `dragAndClick` 也包含该分支。

正式片定义来自同一可读源码11921：视频类型、模型 `SEEDANCE_2_5`、非空 `draftVideoId`。11930的 `fQ` 要求来源是已生成并带文件标识的样片，且正式片没有任何入边。

本地 `src/features/canvas-connections/entry.mjs` 复用现有 `direction`、`validateConnection`、`isFinalNode`；只有校验已失败且方向解析后的实际 target 是正式片时结束手势。反向从正式片输入端拖到普通图片仍以正式片为 target。合法样片重连、普通不兼容节点的菜单、空白落点菜单和既有取消行为保留；不改节点坐标、连线合同或生成调用。

## 定向回归

新增回归在修改前复现失败：无效正式片出现了 `.connection-menu`。修复后执行：

```bash
node --test tests/canvas-connection-dismissal.test.cjs tests/canvas-geometry.test.cjs tests/video-draft-final-core.test.cjs tests/canvas-connection-validation-performance.test.cjs
node --test tests/video-draft-final-workflow.test.cjs tests/canvas-keyboard-ownership.test.cjs
node --check src/features/canvas-connections/entry.mjs
node --check src/features/canvas-connections/qa/fixture.js
node --check src/features/canvas-connections/qa/store-bootstrap.js
node --check src/features/canvas-connections/qa/controls.mjs
git diff --check
```

本次定向回归29/29通过，相邻样片workflow与键盘归属回归13/13通过；上述JavaScript语法及diff空白检查通过。自动回归覆盖正向/反向无效正式片无菜单、无提示、无图修改；合法样片调用连接；普通纯文本错误仍打开菜单；已有样片边不被替换；Escape清理待执行帧与捕获，随后松手不创建边。

## 隔离 Computer Use 入口

`http://127.0.0.1:4173/src/features/canvas-connections/qa/main.html?session=final-drop-review-1004&case=invalid`

该页直接加载生产 `index.html`、生产 app 与连线模块，仅在读取前插入夹具。每个session/case具有独立 IndexedDB、本页内存 localStorage和独立project；按钮进入新session以免重复操作污染初始图。配置响应明确 `configured:false`；其余生产 API和外部fetch明确拒绝。红视频是已有本地QA文件，不是生成结果。

固定QA视口scale=.75，左节点约在(145,280)–(333,415)，右正式片约(595,280)–(835,415)，不调整生产节点坐标。源右加号中心约(363,347)，正式片左加号约(565,347)。左上“正式片连线落点验收”面板有六个切换按钮和“读取状态”；回执包含 `finalNodeIds`、`edges`、`graphUnchanged`、`menuOpen`、`preview`、手势记录和被阻止请求。

1. **无效正式片**：拖左图右加号到右正式片主体，原图不变、无菜单、无预览。
2. **反向无效正式片**：拖右正式片左加号到左图主体；实际target仍是正式片，同样取消。
3. **普通不兼容**：拖左图右加号到右纯文本，显示已有错误提示和新增菜单；Escape关闭。
4. **合法样片**：左节点使用生产 `isDraftNode` 定义，并提供真实本地视频和测试文件标识；拖到正式片新增一条 `purpose:"draft-reference"` 边；一次撤销可恢复原图。
5. **已占用正式片**：初始已有合法样片边，再拖入不替换边、不弹菜单。
6. **Escape取消**：拖动中按Esc，再在正式片上松手；原图不变、预览清除。

自动测试和HTTP可达性不代表真实鼠标或视觉验收。本页准备供主任务Computer Use复验；浏览器结果应按实际执行记录补充。本增量不代表完整画布交互或全站复刻已完成。

## 主线程实际鼠标复验

2026-10-04，正式生产模块在隔离画布中验证全部六个场景：无效正向、反向、已占用均graphUnchanged=true/原边保持、无菜单/预览；合法样片新增真实draft-reference边；普通纯文本仍显示错误和引用生成listbox；拖动预览已出现后Escape，再在正式片松开，原图不变且预览/手势清除。全部场景API和外部请求计数为空。

QA自动回执已改window捕获及菜单MutationObserver，避免生产stopImmediatePropagation漏记录、手动读取外点先关闭菜单；真实ordinary回执menuOpen=true、preview=true、graphUnchanged=true。截图见[正式菜单与原图](screenshots/canvas-final-drop.jpg)。本地样片夹具没有使用生成服务，旧媒体迁移提示不作供应商结果验收。
