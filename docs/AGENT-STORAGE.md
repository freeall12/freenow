# Agent 本地持久化与容量

Agent 会话与视频分镜操作使用现有 `CanvasStore` 的 IndexedDB `documents` records。没有数据库版本、object store 或服务端协议变更。

| 内容 | 权威记录 | 旧 localStorage |
| --- | --- | --- |
| 会话、草稿、队列、运行检查点 | `agent-conversations:<projectId>` | `tapnow-agent-chats` / `tapnow-agent-active-chat` 的项目专属 key 只作为已有读取来源；IndexedDB 成功后不再镜像完整聊天 |
| 视频分镜操作身份 | `agent-video-analysis-operations:<projectId>` | `tapnow.agent.video-analysis.operations.v1.<encodedProjectId>` 仅在 IndexedDB 记录缺失时读取、验证并迁移；原值保留 |
| 生成历史与任务回执 | `agent-generation-history:<projectId>` | 原有 IndexedDB 链路 |

旧 key 不删除、不清空、不覆盖；现有 localStorage 配额不会因为迁移自动释放。会话和分镜操作的新增长不再占用这项小额配额，已经满额也不会阻断这两条 IndexedDB 保存路径。素材库、主体库、个人技能、反馈和偏好仍有独立的 localStorage 路径，尚未完成统一迁移，不能宣称整个站点已摆脱容量限制。IndexedDB 自身也可能达到浏览器磁盘配额。

## 保存与派发顺序

`createAgentVideoAnalysis` 默认使用 `globalThis.CanvasStore`。宿主无需额外接线；独立测试或无 record adapter 的宿主明确保留原 localStorage fallback。存在 record adapter 但数据库打开、读取、迁移或写入失败时，禁止降级到旧 localStorage 继续提交。

1. 捕获当前项目和来源节点，等待该项目 journal 读取。读取期间出现过的来源/裁切/节点身份变化保持失效，即使原来源后来恢复也不能派发。
2. IndexedDB 记录缺失时验证旧 journal，保留 operationId、nodeId、fingerprint、状态和 taskId，等待迁移事务成功。坏记录、重复身份、错误项目或迁移失败都阻止提交。
3. API 配置核对仍只在显式 `configured:false` 时返回待配置；此分支不新增操作记录、不读取素材。
4. 素材读取前等待 `preparing` 身份事务完成。创建本地生成 job 后保存 taskId，在 `beforeDispatchReady` 中再次等待该身份和宿主检查点完成，随后才允许供应商派发。
5. 后续任务状态按项目串行保存。保存失败保留 `persistenceError`，`flush()` 拒绝，项目切换受阻；显式再次执行同一 operationId 可以重试保存原回执，不产生新任务。

有原 taskId 但无当前 job 时返回 `unknown` 并保留身份，只能查询原任务。刷新时仅有 `preparing`、没有 taskId 的操作也返回未知状态，不能自动重发。现有每项目 500 条操作记录上限保留；达到上限会明确报错，不淘汰不确定回执。

## 项目切换与多窗口

会话的项目身份由页面启动时捕获，继续使用 `conversationsLoaded`、异步写队列、`flushConversation()` 和离页保护。慢读取不能把旧 localStorage 镜像覆盖到新 IndexedDB 草稿。

分镜素材准备、journal 读取和派发确认期间阻止项目切换。后续 journal 状态写入通过导航 guard 等待 `flush()`，该方法同时追踪等待期间追加的新写入；存在保存错误时继续阻止切换。原生刷新在操作或写入尚未完成时提示未保存。异步事务提交之后仍再次检查取消、来源和页面状态，迟到事务不能开启新派发。

`CanvasStore.writeRecord` 保留现有事务内 revision 比较；另一窗口更新后，本窗口的过期回执保存必须失败。分镜 journal 不自动合并不同窗口的状态，也不覆盖较新记录。冲突会阻止派发，原窗口修改留在内存中供用户处理。

## 验证

```sh
node --test tests/agent-project-context.test.cjs tests/agent-video-analysis.test.cjs tests/canvas-storage-reliability.test.cjs tests/canvas-projects.test.cjs
pnpm check
```

回归包含：满额 localStorage、不再复制超过 5MB 的聊天、legacy 只读迁移、坏记录/迁移失败、慢 journal 读写、taskId 保存失败、无 IDB fallback、原任务未知状态不重发、取消后迟到提交阻断、来源暂时变化后仍失效、多窗口冲突及追加写入的 flush/导航保护。

QA 若需查看新的会话检查点，应读取 `await CanvasStore.readRecord('agent-conversations:' + CanvasProjects.id())`。legacy localStorage 不再反映新的聊天内容。此变更未读取或清理真实浏览器存储；Node 协议回归不能代替浏览器磁盘事务和真实模型验收。
