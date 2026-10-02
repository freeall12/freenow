# Agent 已存回执续轮

`POST /api/agent/continue` 保持原请求结构：`sessionId`、原始 `binding` 和 `results`。

- `planned` 且没有待执行调用：用户显式发送 `results: []`，发出尚未派发的首轮模型请求。
- `receipts_saved` 且没有待执行调用：用户显式发送 `results: []`，直接继续当前已保存的输入；不新增回执记录或 `function_call_output`，也不查找早期空回执对应的历史响应。
- 已保存的 `show_form` 准备回执：上述空结果只将原任务完成，不请求模型，也不将表单默认值或准备结果视为用户答案。
- `waiting_tools`：需要与当前待执行调用精确匹配的真实回执。状态核对只返回调用 ID 和名称，不返回参数，不授权执行工具。
- 重试非空的已接受回执：仍返回该回执对应的历史响应。其调用可能已经执行，前端必须核对轮次与当前状态，禁止直接重放。
- `unknown`、配置不匹配、绑定不匹配、取消或正在执行：原有守卫继续生效，不改为新的任务请求。

局部回归：`node --test tests/agent-resume-stored.test.cjs`。测试使用内存检查点和可控 SDK 替身，不调用真实模型、浏览器或生产存储。
