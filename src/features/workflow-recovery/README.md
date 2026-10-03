# 分组工作流持久恢复：最小合同（第一阶段）

官方调度证据见 `reference/workflow-templates.md`：依赖分层、层内并行、整层结束后推进、失败阻断后层、停止只阻止后续提交。官方刷新恢复界面尚未取证；本模块补足本地执行可靠性，不声称界面与官方一致。

## 存储与写入权限

复用 CanvasStore 的 `documents` store，键 `agent-workflow-runs:<projectId>`。不新增数据库、store、版本或依赖；无 localStorage 降级。存储适配器提供 `readRecord(key)` 和 `writeRecord(key,value,{expectedRevision,canCommit})`，事务内比较显式基线、验证同步 canCommit，成功返回 `{storageRevision}`。不采用共享 revisions Map 作为恢复控制器的基线。

`createWorkflowJournal({store,projectId,isCurrent,locks,ownerId,now})` 返回项目内唯一实例。`open()` 先获取项目 Web Lock（ifAvailable），持有到 `close()`；没有锁、另页持锁、项目变化或页面关闭时禁止写入、派发和结果应用。只读列表使用独立 `readWorkflowRuns(store,projectId)`，不会推进控制器基线。同页所有变更串行。close 同步废止提交资格，再释放锁，不取消已经提交的远程任务。

## 记录结构

Envelope：`{version:1,projectId,revision,storageRevision,runs:[...]}`。

Run：`{version:1,runId,projectId,groupId,ownerId,epoch,createdAt,updatedAt,stopping,plan:{layers,executable},members,versions,tasks}`。

`members` 是完整成员 ID 集合，`versions` 是全部成员及外部来源的签名；来源签名必须包含节点类型、成员归属、生成配置、媒体/文本、输入连线和原结果归属。`tasks` 按 executable ID 记录 `{nodeId,state,taskId,kind,createdAt,requestVersion,transportRequestVersion,error,application}`，state 为 `pending/submitted/unknown/failed/applying/applied`。pending 没有任务 ID；一旦写入 taskId 永不改成另一个 ID。application 是 `{beforeVersion,afterVersion,resultVersion,proposedNode,proposalVersion,createdAt}`；完整 proposedNode 保存已验证的画布节点、稳定本机素材引用和历史，避免刷新后重建 history/localize 改变应用意图。proposalVersion 为 proposedNode 的 SHA-256。不保存供应商原始响应或凭证。runId 和 job.id 分离。

持久请求的 `parameters.workflowRecovery` 必须精确包含 `{version:1,projectId,runId,groupId,nodeId}`，同时 request.workflowId=groupId、request.nodeId=nodeId、count=1。ack 计算初始规范请求 SHA-256；由于 prepareRequest/prepareInputs 会材料化资源，另外在最终 POST 前保存 transportRequestVersion，恢复请求必须与此最终签名及上述身份一致。缺最终签名仍可查询原 ID，但不得应用或重发。应用结果为单个类型正确且已经媒体验证/本地化的输出。

## 写入 API（全部 await）

- `create({runId,groupId,plan,members,versions},guard)`：首个任务派发前保存完整计划与来源版本。
- `submitted(runId,nodeId,job,guard)`：在 GenerationAPI.runInPlace 的 onSubmitted 中登记原 job.id 和请求签名；事务完成才返回，供 beforeDispatchReady 放行。失败不发 POST。
- `prepared(runId,nodeId,job,guard)`：在 GenerationAPI.runInPlace 的 onPrepared 中保存材料化后的 transportRequestVersion；TaskService.beforeTransportReady 必须 await 它之后才可 POST。初始 taskId 不变。
- `preparingApplication(runId,nodeId,{taskId,beforeVersion,afterVersion,resultVersion,proposedNode,createdAt},guard)`：在原位改图之前保存完整应用提案与 SHA-256，beforeVersion 必须等于当前跟踪版本，createdAt 必须等于 submitted 记录的原创建时间。结果节点携带原 run/task 的 workflowRecoveryResult 标记；afterVersion 包含标记、历史和实际媒体引用。
- `applied(runId,nodeId,{taskId,afterVersion,resultVersion},guard)`：画布保存事务成功后，登记应用完成并更新 versions[nodeId]。此 Promise 完成才算调度节点完成。不得只凭 provider succeeded 或内存 didApply 推进。
- `settled(runId,nodeId,status,error,guard)`：记录 unknown 或真实失败。unknown 保留原 taskId，不得变回 pending。
- `stop(runId,guard)`：即时设置本控制器 stopping latch，再保存 stopping；pending→submitted 和后层提交检查该 latch。已成功登记 taskId 的原任务允许完成 prepared、派发、查询和应用，停止不传 abort 给它们。
- `claim(runId,guard)`：已重新获取 lock 的页面显式接管 journal ownerId/epoch。不会重新生成任务。
- `flush()` / `close()`：flush 等待串行事务且报告保存失败；close 立即撤销写资格。任何事务失败后控制器锁定写入并保留旧持久快照，必须新实例读取最新记录后再处理，不能回退为新生成。
- `get(runId)` / `list()`：返回克隆快照；`canContinue(runId,context)` 返回 `{ok,reason,nextLayer}`，要求上下文项目/组/成员/全部来源签名一致、所有已提交前驱确实 applied、无 failed/unknown、未停止。
- `assertActive(runId,{dispatch:false,nodeId,taskId})`：同步验证页面/项目/锁/owner；dispatch=true 阻止停止后的新提交，但相同原 nodeId/taskId 已登记任务继续。来源守卫仍由宿主执行。

## 查询恢复 API

`reconcile(runId,{context,query,apply,guard})`：query(taskId) 仅允许 GenerationAPI.recover/GET 原 ID；apply(job,{run,node,application}) 是宿主专属 recoverInPlace/保存接线，不调用 submit/retry。所有回包先验证原请求身份和哈希，再触及画布。每个已提交任务独立查询；层内并行，逐层 drain，但不启动 pending。失败/unknown 阻断后续新提交，不妨碍已提交兄弟任务查回。

context() 返回 `{projectId,groupId,members,versions}`。恢复应用前复核全部来源签名。对 applying 记录允许当前节点等于已持久 afterVersion，但只在同原 task 输出 resultVersion 一致且宿主验证结果标记后认定为图已保存、journal未登记的崩溃窗口；此时仅补 applied 收据，不再次写图。等于 beforeVersion 时宿主验证保存 proposal 的本机素材字节，复用原 proposedNode，不重建历史或重新本地化；核心先校验 proposalVersion。第三种版本禁止覆盖。普通 applied 收据亦必须匹配当前图版本，不能覆盖后来的用户编辑。

query 返回 succeeded/running/queued/unknown/failed/cancelled/configuration_required；网络异常/404为 unknown，不是“未发”。succeeded 仍须宿主验证输出，并由 apply 返回已持久收据 `{taskId,afterVersion,resultVersion}`。apply 回调负责 preparingApplication、图保存、结果身份验证；核心再 applied。context/guard 在每个异步边界及 store canCommit 内重查。前一个节点应用导致 versions 更新后，再检验后一个节点来源；一次 context 检验同时允许所有 applying 兄弟节点各自持久 afterVersion。

## 继续与失败

原首次运行可自动推进；刷新恢复永不自动提交 pending。用户明确继续后，宿主复用官方层调度，每层跳过已 applied，只提交 pending；submitted/unknown 必须先查询。不能将失败节点当作新提交重试。停止后不继续本 run；显式新运行需要新 runId。

保存失败、关闭页面、来源/项目变化、锁冲突都禁止后续派发。任务登记已保存但请求是否发送未知时仍使用原 job.id 查询，绝不二次 POST。应用意图已保存、画布未保存时恢复到 beforeVersion；画布保存成功、applied收据未保存时凭完整 afterVersion+原结果标记确认。无法证明任何一项时保留记录并告知需要人工处理。

## 验证范围

Focused tests 覆盖真实事务 gate、原任务 identity/hash、错误/unknown 不重发、层 barrier/显式继续判定、应用崩溃窗口、来源/成员/项目变化、写失败/关闭、竞争窗口/显式CAS、未知 schema fail closed。UI 接线和浏览器刷新验收由宿主协调完成。
