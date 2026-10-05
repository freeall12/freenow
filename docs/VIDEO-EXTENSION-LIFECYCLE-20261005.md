# 视频延长：面板生命周期与原任务保存重试

本批修复延长面板关闭后仍可能提交的竞态，并保护异步准备期间的来源视频与继承输出参数。已派发任务保留原回执和结果；结果保存失败可以重试原任务应用，不重新请求模型、不重复创建节点。

## 已确认问题与修复

修改前用生产 `Creation.submit/close`、真实 `TaskService` 和媒体准备器复现：在 availability 等待中关闭面板，迟到回执仍导致一次 provider 请求与一个派生节点；等待期间把来源从 `1080p/无声` 改为 `720p/有声`，旧参数仍会提交。

- `core.mjs` 的来源守卫检查原项目、节点对象与类型、媒体 URL、clip、实际继承分辨率/声音，以及原参考节点对象、URL、clip。原对象被相同 ID 的新对象替换也失效。
- 面板生命周期守卫额外检查 `alive` 与面板 signal；提交守卫冻结延长设置、引用、主体快照。它只限制派发前准备，不撤销已发送任务的原结果应用权限。
- readiness 向 availability 传 signal，并把 lookup 与关闭事件竞争。即使上游忽略 signal、永不返回，关闭也会立即结束 submit；迟到回执不能继续提交。
- 请求 preparation 使用独立 task controller。关闭时，尚未 `providerDispatched` 的任务取消；已经派发的任务继续查询、应用原结果。任务托盘仍保留其回执和同任务恢复入口。
- busy 时禁用参数按钮、提示编辑和引用区域，仍以守卫处理异步回调或程序性修改。
- `application.mjs` 首次调用 `createConnected` 后缓存真实结果节点/连线对象与内容签名，然后等待 `CanvasStore.save(snapshot, projectId, {beforeCommit})` 与 `flush`。显式保存失败时，原 task 的 apply 闭包复用这些节点，只重新保存。来源、结果、连线被修改/替换/移除时拒绝重试；移动结果节点不撤销内容所有权。

保存确认使用现有 CanvasStore 合同；没有修改 `generation-ui.js` 的自定义 apply / onApplied 合同。原任务输出与 inPlace target 由共享结果应用器保留。缓存属于当前页面会话；刷新后的恢复入口仍由共享 generation recovery 流程负责。

## 自动验证

```sh
node --test tests/video-extension-lifecycle.test.cjs \
  tests/video-creation.test.cjs tests/video-extension-media.test.cjs \
  tests/video-creation-native-profile.test.cjs tests/generation-video-extend.test.cjs
```

2026-10-05：39/39 通过，其中生命周期 15/15。覆盖挂起 availability/configuration 关闭、路由 readiness 和媒体准备取消、来源/项目/引用对象/clip/输出参数漂移、一次正常派发、派发后关闭、结果应用失败后同任务重试、保存拒绝后复用原节点、删除/替换/修改结果与连线拒绝，以及 save 内 `beforeCommit` 再检查。

生命周期测试执行生产 `Creation.submit/close`、从 shared UI 原样提取的 `runInPlace`（包括 receipt gate、onSubmitted 与取消信号桥）、真实 core/media/TaskService/application runner/结果保存 helper。provider、DOM host、媒体应用 plumbing 和 CanvasStore 事务边界为测试替身；未运行完整浏览器 shared UI 或实际媒体解码器。自动测试不证明浏览器交互或真实 IndexedDB 故障。

模块、测试和 QA 脚本均通过 `node --check`；范围内 `git diff --check` 通过。

## 隔离浏览器入口

```sh
node scripts/serve-video-extension-fixture.cjs
```

默认 OS 分配临时端口，禁止 4173。控制台显示 URL：

```text
http://127.0.0.1:<port>/qa/video-extension-app.html?mode=normal&session=<unique>
```

服务仅提供 checkout 的公开静态资源与生成 HTML：不加载 env、不启用 gateway/用户 stores，拒绝 API、mutation、私有路径；MP4 支持 Range。CSP 禁止外部连接，仅增加 `wasm-unsafe-eval` 以允许已加载本地 meshopt 模块编译 WebAssembly；没有启用 JavaScript `unsafe-eval` 或修改生产 CSP。夹具 namespace 全部 `indexedDB.open`、Canvas/Assets/Template DB 与 localStorage，展示实际数据库名。每个案例使用不同 session；生成 HTML 为 git 忽略的可重建文件。

`unconfigured/native` 保留缺 Key / Ark 本地素材前置限制；`delayed/normal` 使用明确的**合成 tasks-v1 配置、任务回执和输出**。源视频是真实 tracked `qa/trim-scenes.mp4`；输出是不同的 tracked `src/features/video-generation/qa/media/2.mp4` 数据 URI。真实生产面板、TaskService、媒体准备、输出验证和隔离 IndexedDB 保存仍执行。夹具的 POST 计数只统计拦截的合成任务请求，没有请求真实模型。

### CUA 验收步骤与预期

| 案例 | 操作 | 预期 |
| --- | --- | --- |
| 缺 Key | `mode=unconfigured`，打开生产视频延长 | 生成禁用；`posts=mediaPrepares=0`，jobs 空，nodes=1 |
| Ark 本地限制 | `mode=native`，打开生产视频延长 | 本地素材限制可见；生成禁用；同上 |
| 准备中关闭 | `mode=delayed`，打开并等生成可用 → 延迟下一次配置 → 点击生产生成 → pendingConfigs=1 → 关闭视频创作 → 释放迟到配置 | `posts=mediaPrepares=0`，jobs 空，nodes=1；无迟到节点 |
| 来源参数变化 | 新 delayed session，同上但 pending 时点击改变来源分辨率与声音 → 释放配置 | 原设置变化错误；`posts=mediaPrepares=0`，jobs 空，nodes=1 |
| 正常应用 | `mode=normal`，打开 → 生成 | posts=1、mediaPrepares=1、nodes=2；同一 job succeeded/applied，request 1080p/false；explicitSaves=1 |
| 派发后关闭 | 新 normal session，保留下一任务为运行中 → 打开 → 生成 → posts=1 / providerDispatched=true → 关闭 → 释放合成结果 | 同一 job 完成并应用；posts=1、nodes=2 |
| 应用前失败 | 新 normal session，下一次应用在插入前失败 → 打开 → 生成 → 关闭 → 重试原任务应用结果 | 原 job 完成应用；posts=1、nodes=2；applyFailures=1 |
| 保存确认失败 | 新 normal session，下一次显式保存失败 → 打开 → 生成 | posts=1、nodes=2、saveFailures=1、applicationStatus=failed |
| 原节点保存重试 | 接上例，关闭面板 → 重试原任务应用结果 | job ID 不变、posts=1、nodes=2、explicitSaves=2、applicationStatus=applied |

保存失败按钮仅让带 `beforeCommit` 的显式 CanvasStore.save Promise 拒绝一次；不是磁盘故障、IndexedDB 事务 abort 或真实存储耗尽证明。其重试调用真实原 CanvasStore.save/flush。应用前失败按钮在插入节点之前抛错，不能与保存失败案例混淆。

### 已执行的 CUA 证据

2026-10-05 主任务在上述只读 host 使用真实生产按钮完成以下案例：

- `127.0.0.1:53252` / `ext-close-1005l-root`：delayed 的 pendingConfigs=1 → 真实关闭 → 释放迟到配置，posts/mediaPrepares/jobs 均为 0，nodes=1。
- 同 origin / `ext-drift-1005l-root`：预检等待期间把来源 `1080p/false` 改为 `720p/true` → 释放，出现明确来源/生成设置变化提示；posts/mediaPrepares/jobs 均为 0。
- 同 origin / `ext-save-1005l-root`：保存 Promise 注入拒绝后 posts=1、nodes=2、explicitSaves=1、applicationStatus=failed；使用**真实任务托盘的「重试应用结果」按钮**后，同一 job `c38649b2…` applied、attempts=2、explicitSaves=2，posts=1、nodes=2 不变。
- `localhost:53252` / `ext-afterdispatch-1005l-root`：同一 job `ef97262f…` 已派发 running → 真实关闭 → 释放合成结果，applied、outputs=1、nodes=2、explicitSaves=1、posts=1。正式播放器显示 `0.3 / 2.0s`；真实 reload 后两个节点和连线仍存在，新页面 posts=0。

截图：[100% 缩放的 localhost 验收画面](screenshots/video-extension-lifecycle-20261005.jpg)。`127.0.0.1` origin 原有用户缩放为 33%，未修改；它的截图不作为视觉比例证据。截图中的 2 秒素材是合成应用结果，不能证明视频被延长。

初次 CUA devlogs 发现 meshopt WASM 被 QA CSP 拒绝，以上延长 UI 链路仍通过；之后仅调整 QA host 的 `wasm-unsafe-eval` 并重启。主任务已重新加载最终页面，按此次 reload 时间过滤日志，无新增 warning/error。保存故障依旧是 Promise 拒绝注入，不是实际 IndexedDB 事务故障；刷新保留节点与连线是隔离浏览器真实持久化证据。

## 能力边界

本批不建立新 Ark 本地二进制上传路线，不使用真实 Key，不请求付费模型，不改变延长的 `prompt_simulation` 能力声明。合成输出仅用于生命周期、结果应用和保存验收；不能证明真实镜头延长、接续一致性、音画效果或模型质量。原任务保留意味着避免重新付费提交，不承诺远端取消成功。
