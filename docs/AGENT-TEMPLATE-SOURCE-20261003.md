# 原模板正文到 HTML 编辑链（2026-10-03）

已接通「真实模板选择交接 → 本地原文件导入 → 原始字节 SHA256 → 只读原模板 + 可编辑 HTML → 最新 revision 续编」的本地合同。**尚未取得任何所选官方模板正文，也没有发现可核验的自动下载合同。** 本功能不会把整个 picker 页面当成模板，不猜远程域名，不调用 TapNow 原站 API。

## 已核验来源

- 当前安装包 `/Applications/TapNow.app` 的 `CFBundleShortVersionString` 为 `0.4.81`。
- 安装包 `Contents/Resources/web` 下共 30 个 HTML；逐文件 SHA256 与 Creative 46 + Motion 46 个目录引用比较，匹配模板正文为 **0**。
- `app.asar` 为 21,559,524 bytes；直接字节搜索 `html-templates`、`template_ref`、`tapnow-creative`、`tapnow-motion`、`SKILL.md`，各为 0 次。此搜索只能证明这些字面标记未出现，不能排除未知或编码后的合同。
- 本地 `runtime-reference` 和既有捕获资料未提供两套 picker 外层 skill 的完整包、真实资源获取合同或 92 份独立正文。已有证据入口：`reference/mcp-picker-template-handoff.md`、`reference/agent-app-store-public-source-20260930.md`、`docs/AGENT-WORKFLOW-INVENTORY-20261003.md`。
- Creative catalog SHA256：`10421d5dedd820104b167d60af250e2a6657365226b0bc7a456f5daffea56781`。
- Motion catalog SHA256：`13e17d4e2ab13c852cc6a45abc85d547574e05da87f6d9339956b1f94aac3576`。
- `creative-template-references.mjs` 和 `motion-template-references.mjs` 只复制保留 HTML 中的 `window.TemplateReferences`。92 是引用数量，包含已退役 A05；A05 不可建立新导入。
- 原始 Creative HTML SHA256 仍为 `2a07bc2e7e3874c49f012f1022cbf838939bf8ea502ca33af31b277986dadcc9`；Motion 为 `11addd0cd6cdf70ec7896452ea607ce3dc9800d95c0e0279c7cc30fdd7e2ff33`。本批不编辑这些页面。

例如 `html-templates/T01/a8621d546b3944a2c0465b35175e09eae987ab53ee454f48e4029f8d9ab96d3b.html` 是对象身份，不是可直接访问的 URL；文件只有与对应 SHA256 完全一致才可导入。引用不足以证明原模板正文已存在。

## 使用和权限合同

实际 picker 卡片下显示原模板状态及「导入所选原模板 HTML」。只有当前会话中真实保存过的 hidden 用户交接才可导入：必须有 `show_app` trace、匹配 `widgetOrigin.traceId/callId/resourceUri/handoffId`、`appHandoffs`、当前 pending selection 与完全一致的官方交接正文。模型传来的 `template_id`、URL 或自称已验证的 metadata 不能创建这份身份。

Creative 校验 saved signature、draft、initial inputs 及 host locale；Motion 校验其独立 saved draft 和原始 Motion spec，不强套 Creative schema。更换选择、修改草稿、切换会话、关闭面板、运行中、取消或文件读取期间来源变化都会拒绝。

### 本地导入

- Purpose：导入与真实已选目录引用一致的本地 HTML，供后续读取和直接编辑。
- Inputs：真实 host trace、本地 `File`、可选取消 signal。`getContext()` 为 `{chat,panelActive,pageLeaving,streaming?,running?}`；store 可为实例或 Promise。
- Outputs：`{status:'imported',receipt_status,source_identity,source,artifact}`，仅 metadata，不把全文或原始 byte 数组传到模型。
- Permissions：用户选择本地文件；不联网，不执行 HTML，不提供远程 resolver。
- Failure modes：身份/摘要/UTF-8/容量/来源过期/保存失败均给具体错误；失败不返回成功回执。
- Logging：host trace 的 `templateSourceImports` 保存原始来源身份和两份产物 metadata；正常工具 trace 保持原有审计链。
- Tests：`tests/agent-template-source.test.cjs`。

先对**原始字节**做 SHA256，再使用 fatal UTF-8 解码；保留 BOM，核对 decode/encode 字节无损。显示 byte 数和 UTF-16 字符数，两个单位不混用。限制维持已有 artifact 的 60,000 UTF-16 字符；前置 byte 上限为 240,000，空文件拒绝。不因缺少真实样本而放宽容量。

经过验证的原始字节保存在私有 WeakMap capability 中，再复制到 IndexedDB 原模板记录，避免验证后外部修改公开 buffer。保存使用原有 `documents` object store、数据库版本 1，没有 migration。

### 产物与 revision

`store.importTemplate()` 单事务创建两份产物：

1. `artifacts/templates/<template_id>/<host-identity-hash>/source.html`：原始 byte 数组、UTF-8 原文、host source identity，普通 `artifacts_write` 不可改。
2. 同目录 `editable.html`：初始正文一致，附 `source_artifact_path/source_revision`。后续 ordinary write 读取最新内容并提交精确 `expected_revision`，保留 source identity 和原始版本。

普通 model write 不能创建 `template_source_*`、冒用只读原模板、替换已验证来源或把其编辑产物改成非 HTML。同一选择重复导入会校验原模板身份，返回当前可编辑 revision，**不会把用户编辑恢复成默认模板**。源记录每次 `store.get/read` 都重新校验保存的原始 bytes；元数据剔除原始 byte 数组。

字节和两份产物保存成功、会话回执保存失败时，不删除实际产物。精确撤回本次 trace receipt 并补偿保存，持续显示「会话导入回执未确认」，允许打开核对或导入同一文件重试。补偿失败也明确报告。来源在事务完成后变化时，实际产物可能已保存，但不回报导入成功。

`runtime.describe(trace)` 会实际读取来源并返回 `missing/imported/unavailable` 和最新 artifact metadata；已存产物但没有匹配会话 receipt 时，返回 `receipt_status:'unconfirmed'`。`runtime.isDescriptionCurrent(originalDescription)` 通过私有 WeakMap 复用完整来源守卫，供主客户端在其他异步读取结束后、发送模型上下文前再次检查。复制或模型伪造的 description 不带此能力。此守卫检查选择/会话身份；artifact 写入仍由 revision CAS 保护。

## 编辑与预览入口

`createAppController()` 可注入 `templateSourceRuntime/onOpenTemplateArtifact`；真实 Creative、Website、Motion card 自动挂载 controls，render 刷新，dispose 清理。主客户端提供 namespace 相同的 artifact store、真实 conversation save 和现有 preview 入口。

打开按钮传最新 metadata，主客户端重新读取 artifact；沿用 `openHtmlPreview` / `createHtmlExportSession` 的隔离 iframe、资源迁移、版本守卫和派生导出。导入步骤不直接执行 HTML；原文不被离线包装覆盖。

未导入时保留「原模板正文尚未取得」的准确状态。静态 picker 投影告知自动下载未配置；若模型上下文存在本轮 host 校验的 source/latest metadata，模型先 `artifacts_read` 再编辑最新 HTML。**独立自由 HTML 创作不要求先导入模板，也不能自称来自缺失的官方正文。**

## 验证及边界

```bash
node --test tests/agent-template-source.test.cjs tests/agent-creative-family.test.cjs tests/agent-artifact-local-export.test.cjs
```

本批最终定向检查 24/24 通过。其中模板专属 10 项覆盖目录映射、真实 SHA256 拒绝、UTF-8/容量、两套 handoff、晚到会话/选择变化、私有 description currentness、不可变来源与 latest revision、会话失败补偿、真实 controls 失败提示和 actual store 单事务的 abort/commit 合同。

由于没有任何可匹配的官方正文，成功导入路径测试明确使用**合成正文与 mock digest**；这些测试只能证明本地合同和错误/续编行为，不能证明已导入官方模板。actual controls 使用项目已安装的 jsdom；store 事务测试使用 IndexedDB transaction harness。没有增加依赖。

验收页：`/src/features/agent-apps/qa/template-source.html`。它使用官方 picker/host/controller、专用 IndexedDB 会话和真正 IndexedDB artifact store；提供不匹配文件检查、独立自由 HTML 保存、busy/save failure 开关。页面不接模型。4173 listener 的工作目录与该 checkout 相符，验收页 HTTP 200。

初次 CUA inventory 的 `browsers` 为空，IAB 暂不可用；后续 root 恢复实机浏览器并完成此 QA 页验证：打开真实 picker，搜索「字符花房」并点击「使用此模板」，确认 `missing/can_import:true` 和真实 handoff 入队；点击「检验不匹配 HTML」明确显示 SHA256 不符、未导入且 artifacts 为空；保存自由 HTML 后整页 reload，仍准确显示原模板 missing，同时真实 handoff 与 `free-creation.html` revision 1 均恢复。双层 iframe 的 click 接口失效，采用浏览器 native Tab + Return 完成真实按钮操作。截图：`/tmp/freenow-template-source-20261003.png`。这证明负向摘要检查、自由创作及会话/产物刷新链，不是原模板 positive import 验收。接到真实匹配本地文件后，仍需验证：生产卡片导入 → 实际 HTML read/edit → 修改后整页刷新 → 当前 revision 预览/导出。未知依赖资源仍遵守现有离线导出合同，不能因为正文已导入就声称资源已全部本地化。

验收页后续发现同源 localStorage quota exceeded；会话已切换至独立 QA IndexedDB `tapnow-template-source-qa-chat-v2`，save 只在事务提交后成功，并串行保留调用时快照。旧专用 QA key 仅首次读取以保留历史，不写入、不清除任何 localStorage，也不修改产品数据库 schema。
