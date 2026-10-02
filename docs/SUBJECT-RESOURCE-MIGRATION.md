# 主体库本地资源迁移

主体库面板的「迁移本地素材」是显式入口。它读取同源 `/assets/local-resource-index.json`，按完整 URL 的 SHA-256 精确映射已有本地文件；不下载未知远程素材、不清理或覆盖旧 localStorage。媒体引用原来已在 IndexedDB 的主体记录中，因此此次迁移直接更新权威库，不读取 legacy 内容作为媒体来源。

## 保存与冲突

`getSubjectStore().migrateResources()` 等待主体库读取，然后复制权威主体快照并调用 `migrateSubjectSnapshot`。有替换才通过现有 `CanvasStore.writeRecord` 保存；UI 与 Agent 共用缓存只有提交成功后更新。相同主体库 key 继续跨画布共享，不增加数据库 schema 或依赖。

异步读取索引或哈希期间，重命名、编辑、归档仍可正常保存；本次迁移在提交前核对完整旧快照，发生变化即返回 `local_edits`。另一窗口更新由现有事务内 revision/CAS 拒绝，迁移不会强制重读并覆盖较新主体。磁盘写入错误继续抛出，原权威缓存保持，用户可重试。项目导航等待在途迁移，刷新在迁移中提示。

只修改纯函数列出的媒体字段。名称、文本、素材顺序、ID、归档状态、provenance、操作回执和旧 `agentContentVersion` 原样保留。已归档主体也可映射媒体，但不会被恢复为可见主体。新媒体引用改变主体内容版本，Agent 应重新读取实际版本；历史 operationId 回执保留，重放会如实显示 `currentMatches`。

## 状态

结果为 `{status,persisted,summary,diagnostics}`；`migrationStatus()` 可读最近一次结果。成功修改后会清除过期状态。主体面板显示迁移数量和未解决字段位置，不显示原 URL、签名、主体 ID 或提示词。

| 状态 | 行为 |
| --- | --- |
| `ready` | 当前检查没有待导入引用；仅存在实际改动才提交 |
| `pending_import` | 已知引用可迁移；未知或临时引用保留，按主体/素材序号列出 |
| `index_missing` / `index_invalid` / `index_unavailable` | 保留所有原引用，面板提示修复索引或重试 |
| `local_edits` | 主体内容或持久版本变化，暂停本次迁移，不覆盖新内容 |
| `migration_failed` | 读取、映射或提交错误，保留原缓存，面板提供重试入口 |

无有效索引时不构造合法空映射；合法空表则把未知引用保留为 `pending_import`。再次执行是幂等的，无改动时不写记录。普通主体修改会使上次迁移结果失效，需要再次核对。

## 静态素材再保存闭环

迁移后的静态媒体通过 Agent 再存主体时，复用 `importIndexedAsset(source,{index,assets,fetchImpl,signal,maxBytes,expectedKind,hashBytes,beforePut})`。它只接受经过路径校验且精确出现在可信索引的本地 ref；同源读取禁止重定向，按字节流限制实际读取，核对索引长度、SHA-256 和 MIME 后才调用 `LocalAssets.put` 转成 `asset:`。主体默认预算 80 MiB；共享 helper 允许宿主明确传入最高 100 MiB，供既有历史媒体预算复用。未知路径、错字节、错误类型、超限、取消或来源 guard 失败均不会导入或保存主体。相同来源只导入一次。

## 聚焦验证

```sh
node --test tests/subject-resource-migration.test.cjs tests/indexed-asset-import.test.cjs
node --test --test-name-pattern="saving mapped static subject" tests/agent-subjects.test.cjs
```

7 项通过：权威 IDB 字段迁移及未知/回执/归档保留；迟到重命名和归档保护；跨窗口 CAS/磁盘错误不降级、不更新缓存；缺失或无效索引不写伪空表；实际静态字节受控导入、未知路径/错误字节/超限/取消拒绝及 Agent 再保存闭环。修改模块语法及 diff 检查通过。本批未跑完整测试、未操作真实浏览器存储，未验证真实用户旧资源的匹配覆盖率。
