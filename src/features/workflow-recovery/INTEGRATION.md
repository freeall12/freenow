# 分组恢复前端接线

`workflow-ui.js` 保留原整组按钮、预检与分层执行入口；异步加载 `context.mjs`、`host.mjs`，`WorkflowAPI.ready` 在项目记录读取完毕后完成。已有未结束记录时，原按钮打开 `dialog.mjs` 恢复弹窗。完全完成的记录可通过 `getRun(groupId)` 读取，不会自动重发。

## 对外入口

- `start(groupId,onChange)` 同步返回原 `WorkflowCore.Execution`；`execution.completion` 等待实际应用和全部收据。计划和当前画布保存成功后才登记首层任务。
- `query(groupId)` 只查询 journal 中的原任务 ID。恢复应用与查询不提交 pending 节点。
- `continue(groupId)` 返回 Promise，明确继续后返回 Execution；原 applied 节点不再生成。
- `stop(groupId)` 同步设置正在执行对象的 stopping 标志，再持久停止。已成功登记的原任务可完成材料化、派发、查询和应用；尚未登记的节点及后续层不能提交。不传取消 signal，也不调用任务 cancel。
- `recoverable(groupId)`、`getRun(groupId)` 提供恢复快照和运行状态。

弹窗显示层、节点状态、原任务 ID 和错误。未知状态禁止继续与新运行；只有所有原任务都已明确完成或失败时，才允许用户重新运行整组。恢复界面采用本项目原控件样式；官方刷新恢复界面尚未取证。

## 持久边界

1. `onSubmitted` 保存原 job ID；`onPrepared` 保存材料化后的请求签名；两个 Promise 完成才允许派发。
2. `beforeApply` 写入完整、已验证 proposal、原创建时间、before/after 节点版本、结果指纹和原任务标记。
3. 画布事务保存成功后，`onApplied` 才登记 applied 并允许下一层。
4. 刷新时节点仍为 beforeVersion：恢复完整原 proposal，保留历史和本地素材引用。节点为 afterVersion：再次验证本地媒体，并通过带来源 guard 的画布事务保存证明后补收据。第三种版本保留旧记录，阻止覆盖。

同层恢复共享一份来源基线，兄弟应用各自更新基线。签名包含媒体、生成配置、输入连线、历史与原任务结果归属；坐标、尺寸、标题和选中状态不改变任务归属。成员检测每次使用当前堆叠所有权。

项目 Web Lock、显式 CAS、页面关闭、来源或成员变化、保存错误均禁止继续提交。锁冲突页面仍能查看已读快照。自动关闭和项目导航不会取消远程任务。

## 本地验证

```bash
node --test tests/workflow.test.cjs tests/workflow-recovery-context.test.cjs tests/workflow-recovery-host.test.cjs tests/workflow-recovery-dialog.test.cjs tests/workflow-recovery-journal.test.cjs tests/generation-workflow-bridge.test.cjs
```

页面真实刷新、POST/GET/DELETE 计数和跨页锁检查使用 `qa/main.html` 的隔离合成合同任务，操作入口与生产页面相同。脚本测试不能替代实际浏览器验收；浏览器证据由主执行者记录。
