# 个人技能重命名与卸载

`management.mjs` 复用管理器的个人技能集合、`skillVersion` 内容版本和保存回执。`skills_rename` 对应现有编辑页改名；`skills_uninstall` 对应详情页“卸载”。卸载真实移除个人记录，不提供归档库或恢复功能。内置技能不进入这些操作。

Purpose: 让 Agent 按用户请求管理已保存的个人技能，并在结果丢失时安全重试。

Inputs:

```js
renamePersonalSkill({
  name: 'old-name', new_name: 'new-name',
  base_version: '<skills_read 返回的64位小写SHA256>',
  operation_id: '<8至128位字母数字下划线或连字符>'
}, {storage: localStorage, builtinNames: catalog.map(skill => skill.name), signal});

uninstallPersonalSkill({
  name: 'old-name', base_version: '<当前版本>', operation_id: '<稳定操作ID>'
}, {storage: localStorage, builtinNames: catalog.map(skill => skill.name), signal});
```

名称与现有管理器一致，只允许1至64位小写字母、数字和连字符。新名称必须与原名称不同。管理不能用创建版本 `0`。工具登记的输入为 `additionalProperties:false`；模块同时拒绝未声明字段。

Outputs:

```js
{
  name: 'new-name', oldName: 'old-name', newName: 'new-name',
  version: '<重命名后的内容版本>', previousVersion: '<确认的旧版本>',
  saved: true, renamed: true, uninstalled: false,
  replayed: false, currentVersion: '<当前观察的版本>', currentMatches: true,
  disabled: true, currentDisabled: true
}
```

卸载返回 `newName:null`、`version:null`、`renamed:false`、`uninstalled:true`。成功回执重放保留历史结果；`currentVersion` 与 `currentMatches` 描述当前内容/标识状态，`currentDisabled` 描述当前禁用状态。若技能随后被编辑、重命名或重新创建，历史 `saved:true` 不表示当前仍匹配，调用方必须检查 `currentMatches`。已完成操作重放不会撤销用户之后手动启用/禁用的选择。

Permissions: 只管理 `tapnow-custom-skills` 中 `custom:true` 的个人记录，拒绝覆盖内置名称。宿主必须按用户实际请求执行，并复用现有执行卡的人工确认；自动生成模式也不能绕过重命名/卸载确认。模块没有可由模型提供的 `confirmed` 参数，确认是工具宿主的执行边界。不访问操作系统文件、不执行技能指令、不发起网络请求。

Persistence: 沿用 `tapnow-custom-skills`、`tapnow-skill-commits-v1` 和 `tapnow-disabled-skills`；没有新增持久化键、迁移或存储清理。重命名保留记录顺序、描述、指令、上传来源及全部参考文件，只更新标识和入口 Markdown frontmatter 的 `name`，保留其他 metadata、BOM、换行及原始正文。无文件的旧个人技能保留原有形式。禁用技能改名前先持久保护新旧名称均禁用，再更新技能，最后移除旧禁用名称；存储满、取消或结果丢失时，新技能仍保守禁用。最终清理失败返回错误并留下 prepared 回执，不声称操作完整完成。卸载完成后移除旧禁用名称；若清理尚未完成、随后用户重新创建同名技能，旧禁用名称会保守禁用新建技能；重试观察到重建后返回冲突，不删除或启用新记录。

Retry: 相同 `operation_id` 必须重用完全相同的参数。保存、重命名、卸载共用操作ID空间，改变参数或跨工具复用ID返回 `operation_conflict`。写入顺序是 prepared 回执 → 必要的禁用保护 → 集合 → 禁用名称清理 → committed 回执。若集合写入失败，尝试恢复禁用状态并回滚回执；若后续保存失败，同ID重试仅在实际结果仍匹配时完成禁用清理和回执，不重复改名或删除后来创建的记录。无法确定结果时返回 `commit_conflict`，需重新读取并确认。使用与现有保存管理器相同的 `tapnow-personal-skills` Web Lock；不支持 Web Locks 的宿主使用模块串行队列和写入前快照检查，跨窗口依赖 Web Locks。

Cancellation: options 中的 `signal` 属于宿主上下文，不进入模型参数或操作签名。等待锁、异步哈希后以及每次持久化写入前检查取消。技能集合已成功写入后发生取消，不回滚成功结果，保留 prepared 回执和禁用保护，允许同参数、未取消的新请求收尾。取消发生在 prepared/禁用保护写入后但集合更新前时，重试返回结果不确定冲突，避免删除可能后来重建的同版本技能；用户需重新读取并明确确认。

Host integration: `skills_list({includeDisabled:true})` 可提供禁用个人技能的名称/描述；禁用个人技能的 `skills_read` 仅提供管理所需元数据、内容版本和 `disabled:true`，不提供指令正文。操作不自动启用技能。成功后在 `currentMatches===true` 时复用已有 `rewriteSkillDraft` 桥接所有会话技能引用和输入框 mention，然后持久化对话并发送 `agent-skills-changed`。宿主不要再次迁移禁用名称，禁用持久化由本模块负责。若桥接保存失败，保留技能操作的历史回执并允许同操作重试桥接；不要再次写入个人技能集合或宣称所有会话已经同步。

Failure modes: `invalid_arguments`、`invalid_name`、`invalid_operation_id`、`invalid_version`、`invalid_storage`、`builtin_skill`、`skill_not_found`、`name_conflict`、`version_conflict`、`operation_conflict`、`commit_conflict`，以及真实存储读写错误。版本冲突必须重新读取；同操作结果不确定时不能以新ID自动重复危险操作。

若技能集合已写入、后续禁用清理或最终回执写入失败，错误携带 `applied:true` 和 `receipt:{...result,applied:true,receiptConfirmed:false,currentMatches:true}`。宿主应显示技能已变更、回执待确认，并把带 error 的实际结果回给模型，使用原 `operation_id` 和参数重试收尾，不冒充 committed。匹配的 prepared 回执收尾再次失败也保留这个标识。`AbortError` 不附加此失败回执，保持取消语义。

Logging: 复用宿主工具 trace 保存输入、确认和结果；模块不记录完整技能正文。回执保存必要标识、版本和结果，不保存已卸载指令作为隐藏归档。

Tests: `node --test tests/agent-skill-management.test.cjs`。12项聚焦协议检查覆盖改名文件保真、旧记录、内置/同名/版本保护、卸载后重建保护、跨保存操作ID冲突、写入失败/结果丢失恢复、历史结果失配、与保存并发时的集合保护，以及禁用保护/清理失败、取消前后和后续人工启用状态。没有运行E2E、服务器、浏览器或全量测试；这些检查不证明真实模型使用或界面视觉已验收。
