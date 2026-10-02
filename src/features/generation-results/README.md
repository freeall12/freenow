# 生成结果布局规划

`plan.mjs` 只生成本地 flat graph 变更，无 DOM、API、随机数、时钟或原地修改。官方依据为 `reference/canvas-current-readable.js` 的 `g4e/S4e/N4e/fL`（21383–21458）及 `Cp/uL/dJ/uJ`（20851–21044）。

```js
const plan = planGenerationResults({
  nodes, edges, sourceNodeId,
  resultCount: 4, resultsPerRequest: 1,
  resultLayout: 'spread', // spread | pile；text 接受 variants 并转 spread
  runId, idFactory: kind => newId(kind), // node | edge | request | pile
  // 可选：sourceNodeSnapshot（提交时配置模板）、sourceInputEdges、editorPrompt
  // regenerationMode: 'preserve-source' | 'replace-source'
  // pileRules: { enabled, maxMembers: 50, allowedMemberTypes }
});
assertPlanCurrent(plan, currentNodes, currentEdges);
// app.commitGenerationPlan 在单次撤销事务中应用变更。
// workflow 将 requestPlans 作为规划元数据附在一个任务请求上；
// 当前没有在浏览器或本机网关按 requestPlans 拆成多个远端任务。
```

返回字段：

- `nodeChanges`：`{type:'replace',id,item}` 或 `{type:'add',item}`；`edgeChanges`：`{type:'add',item}`。`nodes/edges` 是规划时完整结果，用于预览；不要覆盖计划后无关编辑。
- `targetNodeIds / createdTargetNodeIds / layoutNodeIds / pendingTargetNodes / preservesSourceNode / isRegeneration / pileNode`。
- `requestPlans`：`[{requestId,targets:[{nodeId,resultIndex}]}]`，每个请求的 `resultIndex` 从 0 开始。
- 占位使用 `pendingOperation: '<type>.generate'`、`generationRun:{runId,requestId,resultIndex}`。实际任务和清理由 `workflow.mjs` / `generation-ui.js` 接入下述画布事务；取消保留占位，不回滚用户编辑。
- `additionalParameters`：`batch_count` 是 `requestPlans.length`，表示逻辑请求分组数量，不是当前实际发出的远端任务数；另有 `batch_id / is_regeneration / layout`。
- `snapshot / sourcePosition` 用于提交前检查。

已有图像/视频内容默认保留源，新建全部结果；空源首结果复用原 ID。文本始终 replace-source，复用原 ID 的首项暂保留旧正文直至结果回填。新克隆清理媒体、结果历史及当前文件标识，保留生成参数、提示词和父级；多结果/保留源时每个结果参数 count/times 降为 1。只克隆无 purpose、`generation-input` 或 `draft-reference` 的输入边，保留顺序及 handles/valueKey/purpose，不建立源到结果的假输入边。

`captureResultSnapshot(nodes,edges,id)` 与 `assertResultSnapshot(snapshot,nodes,edges)` 检查源、输入边及参考内容，忽略 x/y/selected，允许拖动；删除、内容/参数修改或源进入隐藏堆叠会拒绝。`assertPlanCurrent` 额外检查源坐标和新增 ID 冲突，因为提交前移动后应重新规划布局。该检查不是结果完成时目标编辑保护；调用方仍须检查目标占位及真实任务身份。

媒体 `variants` 抛出 `variants_history_required`，交回已有历史结果路径。其他参数错误抛出 `invalid_result_plan`，快照/坐标/ID 冲突抛出 `stale_result_plan`。模板只提供提交时内容和配置，不覆盖 live source 的几何及父级；调用方应在准备模板时捕获内容快照并于规划前验证。

## 当前运行接入

`generation-ui.js` 在 `GenerationAPI.submit` 时捕获结果模式、源节点和输入节点/连线快照。完成异步请求准备后，确认提供方已配置才调用 `workflow.prepare`；未配置时沿用任务托盘的 `configuration_required`，不创建结果占位。普通图片/视频 `variants` 使用已有历史路径；文本 `variants` 按 `spread` 规划。专用 `runInPlace` / `submitDerived` 与 Seedance 正式片仍走各自工作流。

画布事务已经接入：

```js
await app.commitGenerationPlan(plan, {isActive}); // -> {runId, targetNodeIds}
app.applyGenerationResults(runId, [{id, patch}]); // -> 所有回填目标 ID
app.clearGenerationResults(runId);               // -> 实际清理的目标 ID
```

commit 在模块加载完成后重新检查活动状态和规划有效性，只应用变更，不覆盖整张图或修改选择。apply 要求覆盖全部目标，先验证实际节点对象身份、任务标识和内容签名，再一次回填。x/y 移动可继续；目标内容变化、删除后撤销恢复为新对象时拒绝迟到结果。clear 仅清同对象且任务标识匹配的 `pendingOperation/generationRun`，保留节点、连线、堆叠及用户其他编辑。

准备过程中源/参考内容变化会拒绝提交。保留源模式提交完成后，源的后续修改不阻止独立结果占位回填；目标守卫仍生效。生成失败与取消采用保留占位并解除忙态的本地策略。结果应用失败保留原任务的目标守卫与结果数据，供仅应用重试；pending overlay 依据实际 application 状态退出，节点的任务标记保留至成功回填。撤销/重做及页面恢复会清理失去活跃任务所有权的生成标识，保留其他自定义任务字段。运行注册表不跨刷新恢复。

## 单任务与有序输出

`workflow.prepare` 在一个请求的 `parameters` 中附加 `batch_count/batch_id/is_regeneration/layout` 和 `canvasResults:{runId,targetNodeIds,requestPlans}`。一个前端任务提交一次提供方 `generate`；本机网关原样转交该规划，不负责远端分组执行。提供方适配器可以内部拆分调用，但必须把结果汇总为按 `targetNodeIds` 排列的完整 `outputs` 数组。字段和数量示例见 [生成网关合同](../../../docs/GENERATION-GATEWAY.md#画布结果模式与有序输出)。

普通图像、视频、文本的每组规划一个结果；Midjourney 每组四个结果，界面 8× 对应 `count:2`、两组各四个 target。`outputs[i]` 回填 `targetNodeIds[i]`，不按完成先后排序，也不依赖 output 自带的 nodeId。数量或类型不符、任一媒体无法解码时整组不应用，不产生部分成功回填。

图片/视频写入真实解码尺寸及 `currentSourceFileId: output.sourceFileId ?? null`；视频另写 `videoMetadata:{width,height,duration}`。缺少供应商文件标识时明确保留 null，不根据 URL 伪造标识。文本写入本地 `content`，新克隆清空旧正文，复用的首节点保留旧正文至结果回填。

可编辑的原始提示词按 `request.parameters.prompt ?? request.prompt ?? node.generation.prompt ?? ''` 捕获，写入结果节点的生成配置。给模型的最终文本仍是准备后的 `request.prompt`，可能已经展开参考文本和素材标签。文本编辑入口显式提供 `parameters.prompt`，Agent 直接提交的新提示词不会被旧节点默认值替换。

## 验证与待接入

```bash
node --test tests/generation-results-plan.test.cjs tests/generation-result-transaction.test.cjs tests/generation-results-workflow.test.cjs tests/generation-result-counts.test.cjs
```

这些测试覆盖规划、原子事务、取消竞态、文本和媒体映射、数量与顺序，使用本地替身，不调用真实模型。真实供应商模型映射、素材上传、按逻辑分组执行与汇总、供应商取消仍待接入。当前没有持久化任务恢复、分组进度、部分结果回填或分组失败重试；完整复刻和真实生成质量不能由上述测试推定完成。

## 展示模块

`action-button.mjs/css`由普通图片/视频、文本、音频入口调用，统一官方空闲/忙态/hover，使用不显示价格的官方分支。`pending-ui.mjs/css`与`error-ui.mjs/css`由`generation-ui.js`安装，分别消费真实运行标记与严格所有权失败收据；它们不负责派发任务。

`failure-bridge.mjs`在失败清理前调用只读`app.getGenerationFailureTargets(runId)`，或校验普通来源的提交快照，再写入当前job的`nodeFailures`。确认仅隐藏错误，不改任务历史。错误收据不持久化，刷新任务恢复仍未实现。详细状态、范围与实机证据见 [生成状态验收](../../../reference/generation-states-fidelity-20260930.md)、[错误契约](error-ui.md)、[等待契约](pending-ui.md)。

## 已生成结果的应用重试

`await GenerationAPI.retryApplication(taskId)` 只复用本次页面会话中已成功任务的 `outputs`，不调用 provider、不重新 prepare、不创建新任务。重复调用合并正在进行的同一次应用；已成功应用返回现有回执。普通 `retry` 在已生成未应用时拒绝重新生成，提示使用此入口。

返回回执为 `{id,status,applied,applying,applicationStatus,applicationAttempts,resultIds,applicationError?,sceneResult?}`，不携带原始媒体或请求。生成状态 `status:'succeeded'` 不代表已回填；`applicationStatus` 为 `applying | failed | applied`，失败保留 `applicationError`；回填重试仍失败时 resolve 一个 failed 回执，调用方必须检查 `applied`，不能仅凭 Promise 完成宣称成功。未知 ID、未成功任务或丢失结果会 reject。

权限：此入口修改现有画布/片场，应与普通变更工具相同确认；只能传本地 task ID，不能更换目标/输出/模型。旧目标的对象身份、内容、任务标记和片场绑定检查仍执行，过期目标不强制覆盖。已有 `resultIds` 的部分成功（例如画布输出已保存、片场放置失败）重试时不重复创建画布节点。

每次尝试记录 `applicationAttempts`，通过现有 subscribe 通知开始与结束。记录及绑定不跨刷新恢复；Agent 历史中的未回填任务刷新后标记为 unknown，不能伪称可继续应用。

关键回归：`node --test tests/generation-application.test.cjs tests/generation.test.cjs tests/generation-results-workflow.test.cjs tests/generation-result-transaction.test.cjs`。覆盖 provider 仅调用一次、并发合并、重复成功、片场部分失败、计划目标守卫及全景绑定失败。
