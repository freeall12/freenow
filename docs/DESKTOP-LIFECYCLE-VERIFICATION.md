# 桌面关闭保存验证（2026-10-07）

`src/features/desktop/lifecycle.mjs` 仅编排现有页面保存接口，不增加渲染器 Node、IPC 或公开 UI API。桌面宿主应等待 `prepareDesktopClose()` 返回 `true` 才销毁或重载页面；拒绝时保留页面。

## 保存顺序与失败处理

1. 检查页面接口已就绪；图片编辑器、语音编辑和技能表单仍要求用户完成或取消。
2. 暂停页面输入，提交文本并检查冲突，保存画布与资源库。
3. 等待 `AgentUI.close()` 返回 `true`，确保内嵌应用参数、上下文交接和会话已提交。
4. 若原片场仍打开，等待其现有 `instance.close()`。片场自行检查导入、导出和编辑状态，并保存场景 GLB。成功后必须没有 active 片场。
5. 等待项目导航守卫与最终 `CanvasStore.flush()`。

片场关闭失败时保留原 instance。若场景已经关闭而后续项目或存储检查失败，仅在同项目、同节点对象且没有新片场的条件下重新打开已保存场景；恢复失败保留画布并报告原保存错误和恢复错误。Agent 面板原先打开时恢复面板。所有失败路径恢复页面输入。

## 本地回归证据

```sh
node --test tests/desktop-lifecycle.test.cjs
node --check src/features/desktop/lifecycle.mjs
git diff --check
```

2026-10-07：2 个测试通过。覆盖最后参数与会话事务等待、重复关窗去重、交接拒绝、末端事务拒绝、Agent→片场保存顺序、延迟场景提交、场景保存拒绝、close 返回但 active 未解除，以及末端存储失败后恢复原已保存场景。

测试使用异步边界模拟，不证明 Electron 原生关窗行为或实际 GLB 重启恢复。原生窗口、真实 3D 场景、重启恢复验证由桌面集成检查另行记录。
