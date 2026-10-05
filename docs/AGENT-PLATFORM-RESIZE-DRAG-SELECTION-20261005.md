# 平台裁切拖动互斥选择修复 · 2026-10-05

从 `77ad190` 基线检查本机安装包与本地模板后发现：拖动一个未选中的预览规格，会直接选中它；已有同宽高比规格却没有取消。页面因此构造两个相同比例的裁切项，正式输入校验拒绝整批提交。普通点击规格按钮已经正确实现按比例互斥；本次让拖动完成遵守同一规则。

## 来源与根因

以下两份原 HTML 的完整 SHA-256 均为 `897f46887563e4ed59db6b0f33cb0896631715c0c39a7e8793470978c7383365`：

- 本机安装包 `/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/apps/platform-resize@v1.897f4688.html`
- 项目 `src/features/agent-apps/resources/apps/platform-resize@v1.897f4688.html`

原 `v_()` 按钮先用 `hm(ratio_id)` 找到同比例已选项并取消，再选新项；`g_()` 拖动完成只执行 `re.add(n.platform)`。合法输入可以令首项 `selected:false`、第二项同 `ratio_id` 为选中：`ontoolresult` 始终将首项作为默认预览，所以无需修改或伪造页面内部状态即可复现。

旧真实拖动事件后，选择从 `portrait_alt + square` 变为 `portrait_alt + square + portrait`。正式 `validatePlatformResizeApply()` 明确拒绝“每宽高比只选一个”。失败发生在编码与入图前，不是供应商或模型问题。

## 修复边界

`platform-resize-local-interactions.mjs` 只替换 `g_()` 的提交选择片段：先移除当前比例的另一已选规格，再选当前预览规格。裁切 x/y、指针捕获、边界夹取、原 pointercancel 提交行为、按钮版式、用户标签与标题、`tapnow/callId`、`resize_for_platform_apply` 参数、成功/失败文字和去重逻辑均保留。

磁盘原模板不修改。该转换仅接受 platform-resize v1，完整原 SHA 或现有四处 freenow 固定文字派生后的 SHA `7a1fa947d13cecfce3a51abcf989db260c600ec8ae96aa2c820f263f6fcc0001`；改任意字节、未知版本或替换目标不唯一均拒绝。其他应用原样返回。

共享 proxy 需按以下顺序接线，避免现有品牌转换的原 SHA 校验被交互派生破坏：

```js
// Existing stage, unchanged:
.then(function (templateHtml) {
  return localizePlatformResizeBrand(templateHtml, name, version);
})
// New stage, before inner.srcdoc:
.then(async function (templateHtml) {
  if (name !== "platform-resize") return templateHtml;
  var interactions = await import("../platform-resize-local-interactions.mjs");
  return interactions.localizePlatformResizeInteractions(templateHtml, name, version);
})
```

本修复不需要改 registry、host、card、integration 或用户输入合同。

## 已验证

仅运行此次新增定向验证，未重复已有平台裁切套件：

```bash
node --test tests/agent-platform-resize-local-interactions.test.cjs
node --check src/features/agent-apps/platform-resize-local-interactions.mjs
node --check src/features/agent-apps/qa/platform-resize.mjs
```

3 项通过：

1. 执行原 `g_` 的真实 pointerdown/move/up 回调复现重复比例及正式校验失败；派生回调移除同比例旧选择、保留其他比例，并能通过正式裁切参数校验。
2. 无位移不改选择、busy 不进入拖动、越界坐标夹取、pointercancel 保留原语义和释放捕获。
3. 原/品牌导数 SHA 与版本边界、用户文字和整段后续 preset/apply RPC/去重/status 脚本不变、派生脚本语法有效、原文件未变。

模块、QA 脚本语法和定向 diff 检查通过。事件验证是原模板函数的 Node VM 执行，不能替代真实鼠标、iframe 渲染和浏览器 PNG 解码验收。

## 原生操作入口

打开 `/src/features/agent-apps/qa/platform-resize.html`。本页仍使用正式 controller/card/host/runtime、独立既有 IndexedDB 与真实本机像素；新加的同比例开关只影响之后新打开的卡片。

1. 如需全新明确计数，点击“载入实际像素测试图”：得到 1200×800 网格源图，清除本 QA 的旧测试卡片/图节点，保留主项目存储。
2. 勾选“同宽高比冲突场景”，打开官方平台适配。初始预览是未选的“竖屏 9:16”，选中的是“另一竖屏 9:16”、方图和横屏。
3. 使用实际鼠标在预览上向右拖动约一格网格宽度。释放后“竖屏 9:16”应选中、“另一竖屏 9:16”应取消，方图/横屏保持选中。不得变成“添加 4 张”。
4. 点击内层原生“添加 3 张”。正式回执应有 `portrait/square/landscape` 三项、无 `portrait_alt`；实际 PNG 应为 450×800、800×800、1200×675，首项 crop.x 随拖动改变。源图加 3 个输出、1 次同批 undo、1 份回执。成功按钮按原去重逻辑禁用，不得重复加图。
5. 检查页面成功文案指向 freenow 画布；普通重绘和刷新不应重复裁切。可撤销该批并核对来源保留。
6. 切换 English 后新开卡片，重复拖动和添加。标签来自已配置中英字段，品牌与裁切交互一致；该页面原包只支持中英，未增加虚构的其他语言。
7. 可勾选画布/会话保存失败后操作：页面必须失败而非成功，取消失败开关后重试使用原调用去重，不复制已插入批次。

## 本轮实机结果

根任务通过 CUA 在中文页面完成真实指针拖动与原生添加操作：初始“另一竖屏 9:16”选中，拖动首项后 crop.x 从 313 变为 451；首项选中、另一竖屏取消，方图与横屏保持选中。点击内层“添加 3 张”后，实际保存为源图加 3 个输出，共 4 张图、1 次同批 undo、1 份持久回执。

三个输出实际尺寸为 450×800、800×800、1200×675，回执没有 `portrait_alt`。页面成功文字为“已添加 3 张到项目，请在 freenow 画布中查看。”；成功按钮按原去重逻辑禁用。截图：[中文拖动与裁切保存](screenshots/agent-platform-resize-drag-20261005.jpg)。

本轮中文拖动、opaque iframe 原生添加、实际 PNG 尺寸与保存回执已验。English、刷新恢复及失败/重试交互本轮未重复验收；上述专项通过不代表全部平台裁切交互全面完成。
