# 普通 video.depth 画布占位与恢复守卫

日期：2026-10-05

## 范围与契约

普通 `video.depth` 结果仍是 `type: 'video'` 节点。此增量为画布提交、重载恢复、占位和失败显示加入这一精确操作；不支持任意 `video.*` 操作。

- spread/pile 的调用方使用普通 video 计划，并把 `pendingTargetNodes` 的 `pendingOperation` 标为 `video.depth`。目标与 `nodeChanges` 共享计划对象，提交仍验证真实来源快照。
- `CanvasApp.commitGenerationPlan` 仅允许 video 节点持有 depth 标识；持久基准的 `generationRecovery.kind` 为 `video.depth`。
- 恢复仍验证节点类型、任务 ID、请求 ID、结果索引、目标顺序、内容签名和真实对象身份。重载不会重新规划或新增目标；只有明确恢复才登记活跃守卫。
- hydration/undo 清理没有活跃守卫或可信基准的 depth 标识；即使错误类型节点具有自洽签名，也不能保留 depth 恢复标识。
- variants 的活跃任务显示源 video 节点占位。已有 canvasResults 的计划任务只显示真实 marker 目标，占位不能退回源节点，也不能匹配 `video.generate` 标识。
- provider failure 支持 depth，失败回执必须绑定 video 的真实对象与内容。新 video.generate/depth 任务、编辑、身份替换或其他操作永久使旧显示失效。

失败回执在清理前捕获仍受任务守卫保护的目标，然后沿用 `captureFailureReceipts → workflow.clear` 顺序。`failureSignature` 忽略清理一并删除的 `generationRecovery`、`generationRun`、`pendingOperation`，因此清理不会误判为用户编辑。节点身份、内容、尺寸、标题、生成设置仍参与校验，新任务和不同操作仍会永久使旧失败显示失效。恢复基准自身的完整签名验证仍由 CanvasApp 独立执行。

## 本轮检查

```bash
node --test --test-name-pattern=depth tests/generation-result-transaction.test.cjs tests/generation-pending-ui.test.cjs tests/generation-failure-bridge.test.cjs tests/generation-error-ui.test.cjs
node --test tests/generation-pending-ui.test.cjs tests/generation-failure-bridge.test.cjs tests/generation-error-ui.test.cjs
node --check app.js
node --check src/features/generation-results/pending-ui.mjs
node --check src/features/generation-results/error-state.mjs
node --check src/features/generation-results/failure-bridge.mjs
git diff --check
```

- 8 个 depth 定向测试通过：真实 planner 与 app VM 使用实际 hydration 源码验证 spread/pile、恢复、结果应用、终态清理、删除后 undo、错误类型和操作拒绝；DOM 替身验证 variants/计划占位与失败显示。
- 3 个修改模块的相关测试文件共 35 个测试通过，覆盖既有 image/video/text 行为及 depth 回归。该数量包含上述 depth 测试中的 5 个。
- 4 个生产文件语法检查及 diff 空白检查通过。

本轮没有浏览器、网络供应商或完整提交流程验收；workflow 和 generation-ui 的连接由主线程负责。本增量没有新增依赖或提交 Git commit。

## 失败清理签名补充回归

修复前，真实 depth 计划捕获回执后执行 `workflow.clear`，`generationRecovery` 被删除导致两个目标的失败显示均消失。新增回归使用真实 planner、app VM 和 workflow 重现该顺序，并覆盖当前任务及重载恢复任务。修复后两个目标正常显示失败；后续内容编辑和新 video.generate 任务仍永久使旧回执失效。

```bash
node --test --test-name-pattern='depth planned provider failure survives exact|signature is stable and ignores exactly|depth errors' tests/generation-result-transaction.test.cjs tests/generation-error-ui.test.cjs
node --check src/features/generation-results/error-state.mjs
git diff --check
```

此补充检查共 4 个定向测试通过，语法和 diff 空白检查通过；未重复全套测试。
