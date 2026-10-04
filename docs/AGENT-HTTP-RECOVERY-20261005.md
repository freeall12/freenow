# Agent HTTP 基线失败复核 · 2026-10-05

对 `AGENT-PROVIDER-CROSSCHECK-20261005.md` 中的三项 HTTP 失败，在当前 `main@e2a69d6` 精确重现：两个文件共 7 项，4 通过、3 失败。此次结论是 **fixture 的恢复前提及短流预期与现有安全合同不一致**，没有发现需要修改 Agent 快照或凭据保护实现的错误。只修改两个 HTTP 测试及本说明，生产代码不变。

## 两项 SIGKILL 失败

真实入口同时等待 generation 与 Agent 的存储就绪。SIGKILL 后：

- `agent-session-store.cjs` 允许在 PID 明确 `ESRCH` 后回收旧 lease/claim；不明 PID、活进程、损坏锁仍拒绝。
- `generation-media-store.cjs` 保留旧 `.writer-lock`，即便 PID 已死亡也返回 `media_store_locked`。源码明确要求停止所有 writer 后由操作人员移出锁，避免将非原子的 owner-read/unlink 当作安全自动回收。
- 因此 `server.cjs` 的启动 `Promise.all` 拒绝，输出 `Local task stores unavailable; server was not started.`。原测试直接调用 `start()` 的前提与媒体锁合同冲突，还没有到 Agent 状态读取阶段。

`tests/agent-checkpoint-http.test.cjs` 现在保留真实 SIGKILL，在**每一个**父/子请求中断用例中执行以下断言：

1. 子进程已退出，lease PID 与被杀子进程一致；文件为当前用户的私有普通文件，PID 查询明确 `ESRCH`。
2. 原入口首次重启仍必须被拒绝；媒体锁字节完全保留。
3. 直接打开同一临时媒体仓库明确返回 `media_store_locked`，进一步确认错误来源，拒绝后锁字节仍完全保留。
4. 再次确认 PID 已死亡，由测试显式将旧锁 `rename` 到临时 fixture 根目录的 `operator-retired-media-lock`；检查原锁内容保留。
5. 重启真实入口，所有 Agent 快照文件保持逐字节一致；父请求恢复为 unknown，跨对话身份读取被拒绝，continue 不重发模型请求。子请求恢复为 unknown，原父委派 callId/taskId 可读，启动及聚合请求不重复派发。

该步骤只操作 `os.tmpdir()` 下由本次 fixture 创建的隔离目录。它不是应用启动时的自动恢复实现，也不是生产操作脚本。**测试通过不表示整个应用支持无干预 SIGKILL 重启**。正式媒体仓库仍需现有明确恢复步骤；安全恢复体验应另行设计和审查。

## 短 SSE EOF/failed 失败

`outbound-client.cjs` 会暂存可能跨增量拼接凭据的文本尾段，并检查原文及百分号编码。只有通过整个 `response.completed` 的凭据检查后才释放尾段。原 fixture 在 EOF/failed 前只发送“你好，画布”，预期短文本已经到达浏览器；该预期违反现有保护合同。原断连 fixture 的“等待”同样被暂存，若只修第一处预期，它随后会等不到 delta 而超时。

`tests/agent-stream-http.test.cjs` 的组合用例现在同时覆盖：

- 正常 completed：仍使用短中文 UTF-8 跨码点拆分，严格断言 `session/text_delta/result` 和完整中文结果。
- EOF/failed：发送足够长的安全中文；保留原 `session/text_delta/error` 断言，并确认只输出安全前缀、错误码分别为 `stream_incomplete`/`response_failed`。
- EOF/failed 前附带完整工具 item：没有 completed 时不发布工具回执；状态为 unknown、pending 为空且不能续轮。
- 短 EOF/failed：严格断言仅 `session/error`，没有 text_delta，也没有 result。
- 假 fixture Key 前缀遇 EOF：没有向浏览器释放此前缀；完整假 Key 分两条 delta 返回时明确 `provider_response_rejected`，没有泄露完整值或前缀。
- 浏览器断连：使用足够长的“等待”中文前缀，实际观察 delta 后 abort，仍等待 SDK 上游连接关闭，continue 为 409；精确模型请求数为 9，状态查询和被拒绝的续轮没有派发请求。

没有去掉 EOF、失败、断连或恢复断言，没有禁用凭据保护，没有修改生产锁策略。

## 定向证据

```sh
node --test tests/agent-checkpoint-http.test.cjs tests/agent-stream-http.test.cjs
node --test tests/agent-session-store.test.cjs tests/agent-checkpoint-boundaries.test.cjs tests/generation-media-store.test.cjs tests/non-generation-outbound.test.cjs
node --check tests/agent-checkpoint-http.test.cjs
node --check tests/agent-stream-http.test.cjs
git diff --check
```

结果：HTTP 两文件 **7/7**，相关存储/检查点/凭据保护 **56/56**，语法及 diff 检查通过。没有运行全库测试、没有安装依赖、没有读取真实 Key、没有请求联网供应商、没有访问或修改正式任务存储。

这些证据验证真实本机 HTTP 入口及已安装 SDK 与 loopback 模拟端点的合同。真实供应商鉴权、额度、权限、模型身份、输出质量、后端计算取消及真实掉电恢复仍不在此次验收范围内。
