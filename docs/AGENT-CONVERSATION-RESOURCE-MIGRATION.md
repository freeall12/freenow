# Agent 会话附件本地迁移

显式操作使用 `agent-conversations:<projectId>` 权威记录，保留旧 localStorage 作为只读来源。实际附件 schema 来自 `agent-attachments/uploads.mjs`：`{id,asset,name,type,mime,size}`，支持 `image`、`video`；队列展示还读取可选 `image` 封面。

## 合同

- Purpose：把会话中的已知附件引用迁移成 LocalAssets 可读取的 `asset:`，保留原任务、正文和未知来源。
- Inputs：`{chats,activeId}` 权威记录；exact UTF-8 SHA256 来源索引；LocalAssets、同源 fetch、可选测试哈希适配器。
- Outputs：仅修改 `chats[].uploads`、`chats[].messages[].uploads`、`chats[].queuedMessages[].uploads` 中 image/video 类型附件的 `asset`、可选 `image`。安全报告 `{status,persisted,summary,diagnostics:[{path,code}]}` 不含媒体地址或正文。
- Permissions：只读可信 `/assets/`，只写当前项目会话及本地素材数据库。未知来源不授权网络访问。不递归修改 tool args、文本、refs、composerDoc、恢复 journal、App state、provenance 或绑定。
- Failure modes：缺失/无效索引报告原样保留；类型未知、未索引、临时 blob 保留位置诊断；字节/MIME/SHA、存储失败抛错。`migrationStatus()` 记录失败；错误含 `persisted`。
- Logging：报告只记录计数和安全 schema 位置，不记录 URL、附件名、会话 ID 或提示词。
- Tests：专项测试涵盖字节验证、未知不请求、重复操作、CAS 重算、新草稿、晚提交、持久/UI 失败重试及非附件变更拒绝。

## 保存边界

`createConversations().migrateResources()` 进入已有会话保存队列，读取权威记录后重新计算；CAS 冲突最多重新读取两次。首次权威记录缺失时，显式迁移可以用调用时真实会话快照初始化记录；没有有效索引时不初始化。记录存在时不用旧 localStorage 替换它。

计算期间新增草稿或新的 save 使迁移返回 `local_edits/persisted:false`。如果新编辑发生在数据库提交期间，返回 `local_edits/persisted:true`，不覆盖内存，排队的新 save 保留新草稿。它可能重新写回尚未迁移的附件；再次显式迁移会重新计算。仅持久成功且草稿未变化后，才调用同步 `applyCommitted` 更新页面。

`applyCommitted` 失败必须报告 `migration_failed/persisted:true`。下次直接重试会重新协调已提交的权威记录，即使没有新增媒体变更。迁移完成表示引用与导入校验完成，不表示未知附件或全部媒体已成功解码。

## 接线

```js
const {createConversationMigration} = await import(
  './src/features/local-resource-migration/conversations.mjs'
);
const report = await conversations.migrateResources({
  migrate: createConversationMigration({
    assets: window.LocalAssets,
    fetchImpl: window.fetch.bind(window),
    // 可选 index / loadIndex / hashSource / hashBytes，仅供可信适配器与 QA。
  }),
  getCurrent: () => ({chats, activeId: draft().id}),
  canCommit: () => !pageLeaving && !busy,
  applyCommitted: record => {
    chats = record.chats;
    current = Math.max(0, chats.findIndex(chat => chat.id === record.activeId));
    render();
  },
});
```

生产入口还应阻止执行中任务、恢复操作及其他附件操作；刷新 renderer/editor 由页面负责。

## 检查

```bash
node --test tests/agent-conversation-resource-migration.test.cjs tests/agent-project-context.test.cjs
```

浏览器专项页：`/src/features/local-resource-migration/qa/conversations.html`。它使用独立 `canvas-qa-conversation-migration-v1`、`assets-qa-conversation-migration-v1` 数据库，不接触用户会话、不清库。明确标注非模型测试附件；精确索引映射现有 `/assets/agent-casting.png` 的真实 SHA 和字节数，调用同一生产模块。先初始化，再迁移，检查真实图片解码、未知位置诊断，然后回读及刷新复验。

该页面保留测试记录，重复初始化不会覆盖已有记录。测试原 URL 使用 `.invalid`，从不设成图片 src；仅 `asset:` 进入 LocalAssets 解码。
