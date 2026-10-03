# 已验证模板的本地正文编辑与继续修改（2026-10-03）

正文缺失以外，本轮确认了两个实际入口缺口：已导入模板的「打开最新 HTML」只打开预览，没有用户手动编辑/保存正文能力；通用 HTML 产物也直接进入预览，原 panel 的「在对话中讨论」按钮只在非 HTML 详情显示。

本轮新增的源码编辑器是**本地模板正文管理能力**，不宣称为官方已证实的一比一界面。官方产物指南所述的继续修改路径是将产物加入对话、描述修改；本轮在模板卡提供相应 callback，普通 HTML 预览的讨论入口由主任务另行接线。两者不改原 picker HTML，也不自动发送消息或启动模型。

## 已有合同不重复实现

- Creative/Website/Motion 真实 hidden 选择交接保留 `phase: awaiting-content`：邀请用户补充内容，本轮不生成。
- 主客户端 `artifactContext()` 使用宿主绑定的 `localTemplates` metadata，获取实际最新 editable revision；模型修改先 `artifacts_read`，再 `artifacts_write(expected_revision)`。原 source 只读，重导入不会恢复默认模板覆盖用户修改。
- 当前产物的隔离预览与本地派生导出已存在；导出资源待修复时仍明确不能下载。

这些是代码与定向测试已验证的合同。没有匹配官方正文，所以官方模板的完整「下一条用户内容 → 模型直接编辑 → 保存 → 刷新 → 导出」端到端验收仍未完成。本轮没有假冒正文或启动模型来绕过该边界。

## 本地编辑入口

`template-source-controls.mjs` 仅在 `runtime.describe(trace).status === 'imported'` 时显示「编辑 HTML」。按钮调用 `runtime.openEditSession(trace)`，由宿主重新绑定当前已保存选择/hidden handoff，并实际读取原 source 与最新 editable。

`template-edit-session.mjs`：

- `read()` 返回当前正文、metadata 与 receipt 状态；不返回原始 byte 数组。
- `save({content,title?})` 检查会话/选择/交接/闲置状态，重读当前存储 revision，再调用原 artifact store CAS 写入。不会修改 source，不创建第二份没有来源身份的自由 HTML。
- `store.write(input,{guard})` 的 optional guard 在 IndexedDB readwrite 回调内 `nextDocument` 前后检查；model tool input/schema 不变。主客户端原 store wrapper 需透传 options：`artifactStore.write=(input,options)=>track(()=>write(input,options))`。
- 写入前来源切换或 revision 冲突：不覆盖已有正文。写入实际提交后来源切换：保留真实提交，明确报告「HTML 已保存，但编辑来源已变化，未返回编辑成功」。不以回滚默认正文伪装失败。
- `close()` 后会话不可再读取/保存。打开新会话时从存储实际 latest revision 开始，保留 `source_artifact_path/source_revision/template_source_identity`。

`template-source-editor.mjs` 复用现有 `agent-html-preview` 样式，增加专属布局 CSS 和原生 textarea。输入通过 `.value` 设置，不执行 HTML。保存期间 readonly；失败正文保留；Escape 或点击外部在有修改时显示「继续编辑 / 放弃修改并关闭」；关闭后回到原入口焦点。IME 组合 Escape、keyCode 229 和 repeat 不关闭编辑器，并防止对应 native dialog cancel 越过此边界。模板控件销毁时只使编辑入口失效并保留当前草稿，不静默丢弃用户文本。

## 模板卡讨论 callback

`createTemplateSourceControls({onDiscussArtifact})` 在已导入且 callback 已接时显示「在对话中讨论」。点击先重新 `describe(trace)`，传：

```js
await onDiscussArtifact(latestArtifactMetadata, {
  trace,
  isCurrent, // 私有 description capability 的实时选择/会话守卫
});
```

`isCurrent` 绑定真实 description，不是模型可造的 metadata；它验证来源身份，不锁定 artifact revision。主客户端 callback 应捕获原 chat/panel，重读 `store.get(artifact_path)` 后再次核验来源、会话和 busy 状态，使用此次实际最新 `revision` 更新 `artifactRefs`，保存该会话并 focus 编辑器。回调跨保存 await 时继续检查，并对未提交引用作补偿。接线需 `createAppController({onDiscussTemplateArtifact})` 向 controls 传 `onDiscussArtifact:onDiscussTemplateArtifact`，不复用「打开预览」回调冒充讨论。

## 定向验证与证据边界

```bash
node --test tests/agent-template-edit.test.cjs tests/agent-template-source.test.cjs tests/agent-template-context.test.cjs tests/agent-artifact-local-export.test.cjs
```

本轮 24/24 通过；新增编辑专属 5 项覆盖：latest 打开、真正 store 正文写入、原字节与 provenance 保持、存储 facade/克隆会话重建后继续读取、CAS 冲突、事务前来源切换不提交、事务后来源切换如实报告，以及实际 dialog 保存/失败草稿/未保存关闭/外部点击/回焦/IME cancel，讨论 callback 的实际 latest revision 和晚到来源拒绝。

正向测试使用明示 **synthetic bytes + mocked digest**，通过现有宿主导入链和 artifact IndexedDB transaction harness，验证保存机制；不能作为取得官方正文的证据。没有浏览器中匹配官方正文的 positive import/edit 验收，没有声明已完成官方模板实际生成。原始正文及下载合同缺口继续见 `AGENT-TEMPLATE-SOURCE-20261003.md`。

## 合成 UI 实机验收页

入口 `src/features/agent-apps/qa/template-editor.html` / `.mjs`，本地 URL 为 `http://localhost:4173/src/features/agent-apps/qa/template-editor.html`。页面和弹窗均明确标记「合成编辑器 UI 验收，不是官方模板导入」。它复用生产 `openTemplateSourceEditor`，用独立真实 artifactStore namespace `tapnow-template-editor-ui-qa-v1` 的普通自由 HTML `artifacts/qa/synthetic-editor.html` 适配 session read/save/close/isCurrent；**不修改 crypto，不调用 importTemplate，不进入 verifyTemplateBytes，不构造精确模板身份**。

保存采用实际 IndexedDB CAS，成功后实际 `get()` 回读 content/revision，再将事件提交到独立 `tapnow-template-editor-ui-qa-events-v1`。页面「实际回读已保存正文」显示存储中当前全文和 revision；「刷新页面核对持久化」重新从数据库读取，增加 `page-loaded` 记录，不恢复默认内容覆盖用户编辑。顶层与弹窗内都有明示的模拟保存失败和来源失效开关；来源 epoch 变化后不能使旧 session 复活，需关闭并重新打开。页面不启动模型、不修改产品数据库。

准备检查：HTML HTTP 200、JS syntax 与 `git diff --check`。实机 UI 编辑/保存/刷新/dirty 退出验收由主任务在此合成页执行；它只能证明生产编辑器 UI 与普通 HTML 持久化机制，不能转换成官方模板正向导入证据。

主任务后续 CUA 已实际验证：保存成功的普通 HTML 为 revision 2；模拟失败时草稿保留；失败草稿按 Escape → 继续编辑后正文保留且焦点回正文；再次 Escape → 放弃关闭 → 页面刷新后，实际数据库仍为 revision 2 的成功稿。重开后修改并勾选来源失效，Save 明确拦截「合成编辑来源已失效」，当前草稿仍保留。截图 `/tmp/freenow-template-editor-20261003.png`。这些结果属于**合成普通 HTML + 真实独立 store**，不是官方精确模板导入。

CUA 另发现成功 Save disabled 后焦点掉到 body。本轮补丁仅在发起保存时 Save 拥有焦点、异步期间未主动换焦点且完成时仍在 Save/body 的情况下回正文；用户的 focusin、pointerdown 或 Tab 选择会阻止抢焦点。定向只运行 `node --test --test-name-pattern='save restores lost button focus' tests/agent-template-edit.test.cjs`，1/1 通过，涵盖 disabled 落焦恢复及主动焦点/空白/Tab/pointer 边界；未全量重复测试。

主任务补丁 CUA 复验通过：重载 → 重开 → 编辑 → 保存，实际 revision 3，状态「已保存版本 3」，Save disabled，真实 DOM activeElement 为 `TEXTAREA`、aria-label 为「HTML 正文」。随后 Escape 无脏稿提示正常关闭，焦点回「打开合成 HTML 编辑器」按钮。截图 `/tmp/freenow-template-editor-saved-20261003.png`。官方正文缺失边界不变。
