# 拼装审阅 v1：真实编辑、确认与关闭保存

本批次补全 `ui://tapnow/cutlist-review@v1` 原页面的保留/裁切操作与本地保存交接闭环。审核确认只入普通对话队列，不授权或自动启动拼装，不删除来源节点。

## 来源与范围

- 原页面：`src/features/agent-apps/resources/apps/cutlist-review@v1.a3b10365.html`。
- 安装参考：`/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/apps/cutlist-review@v1.a3b10365.html`。
- 两份参考均核对 SHA-256：`a3b103653d65e220bde4ce6503a499d4a659a79dccf525dff0f59b1bf95771a8`。原件未修改。
- 派生入口：`src/features/agent-apps/cutlist-review-local-interactions.mjs`。仅接收完整相同 SHA 的 v1，并要求每处替换目标唯一；版本或原始字节变化直接报错。
- 继续使用原始固定片段顺序、100ms 步进、至少 100ms 区间、原始源时间坐标、保留/丢弃、单片段与全部复原、总时长校验、原生视频控件、点击时间值 seek、原始总结与 CR1。没有新增拖动裁切交互。

## 实际修复

原 `Qn` 延迟 400ms 保存，`wm` 吞掉保存失败；确认直接发送 CR1，“再改改”复原、保存和发送并发执行。刚改完立即确认可能因已保存状态仍旧而被宿主拒绝。

现在原按钮编辑完成后立即提交完整不可变状态快照，连续编辑仍保留原 debounce 兜底，状态串行保存。确认在首个 await 前冻结页面与按钮，捕获原顺序与同一裁切快照，等待实际 `tapnow/setWidgetState` 回执后才发送其精确总结与 CR1。“再改改”先按原 `Cs` 恢复建议，再等待保存，最后发送原始 revise 文本，不携带 CR1。

保存失败在原页可见，保存指纹只缓存成功状态，允许同页重试。来源通知变化、页面销毁或保存期间计划变化均阻止旧确认。慢保存若耗尽当前浏览器激活，只显示已保存、再次点击提示；下一次同状态点击复用成功保存，不绕过宿主真实点击检查。

复用现有 `local-lifecycle.mjs`，在原 SDK 连接前安装关闭桥。外部关闭必须收到最后编辑的实际保存回执；失败保留原页面与草稿，允许再次关闭。关闭不发送消息。主机与 controller 只增加精确 v1 URI 的关闭资格，专用 proxy 加载派生模块，静态服务器只增加该模块的精确 CORS 路径。

## 新增验证

仅运行本批次新增聚焦用例，没有重跑旧 core/runtime 套件：

```bash
node --test tests/agent-cutlist-review-interactions.test.cjs
node --test tests/agent-cutlist-review-lifecycle-sdk.test.cjs
node --check src/features/agent-apps/cutlist-review-local-interactions.mjs
node --check src/features/agent-apps/qa/cutlist-review.mjs
```

- interaction：6/6 通过。包含 SHA/version、完整派生脚本解析、真实原始裁切函数、即时编辑与精确 CR1、保存失败重试、revise 先复原保存、激活过期、无保留禁用、来源/状态/销毁阻止旧发送。
- actual SDK：3/3 通过。运行完整 pinned 官方 SDK + 派生脚本与真实 DOM click，以 Window 注册顺序接收消息；只替换 SDK 内未使用的 `import.meta.url` 为 fixture URL。验证慢保存前零消息、最终快照与精确总结、最后编辑保存后才关闭、失败页面保留/重试、`_meta` 保存状态重新渲染恢复、“再改改”复原保存后才原文发送。
- 专用 QA 模块语法与 HTML 控件完整性、默认折叠详情检查通过，专属文件 `git diff --check` 通过。
- Node DOM 环境不验证媒体真实播放。根任务已完成下面记录的 CUA，独立 reviewer 只读交审通过并独立运行新 actual SDK 3/3；没有重跑原 6 项或旧 core/runtime 套件。

## 专用真实浏览器验收

使用新会话：`http://localhost:4173/src/features/agent-apps/qa/cutlist-review.html?session=interactions-1005m`。`session` 限 1–48 个 ASCII 字母、数字或连字符，存储名后缀隔离历史 QA 数据。页面只操作专用 QA 图谱与 IndexedDB，无 Key、无模型调用。默认状态延迟 1800ms，详情区默认折叠，审核控件优先可见。

### 根任务已完成的 CUA 证据

真实 8 秒 MP4 的两片初始建议为 0–3s、4–7s。在 1800ms 状态保存延迟下，实际 proxy、host、controller、专用 IndexedDB 组合验收如下；`save` 是页面内成功状态提交计数，`queue` 是持久化普通队列条数。

| 实际操作 | 实际结果 |
| --- | --- |
| 首片出点减 100ms、第二片放弃，立即确认 | 等待保存后 `queue=1 / save=3`；CR1 首片 `0–2900ms`、第二片 `drop`，没有拼装产物。 |
| 模拟保存失败后首片入点加 100ms，立即确认 | 队列不增，旧存储不变；取消失败同页重试后 `queue=2 / save=4`，CR1 首片 `100–2900ms`、第二片 `drop`。 |
| 点击“再改改” | 原建议范围与 keep 恢复，`save=5 / queue=3`；精确原文“这版拼装计划再改改，我们回对话里继续调整。”入队，无 CR1。 |
| 首片入点加 100ms，立即关闭 | 等待 `save=6` 后关闭，重开首片恢复 `100–3000ms`。 |
| 首片入点再加 100ms，模拟保存失败后关闭 | 原面板保留；取消失败再次关闭取得 `save=7`。 |
| 实际刷新页面 | 首片恢复 `200–3000ms`，第二片 `4000–7000ms`，`queue=3`；页面内 save 计数重置为 0，持久化计划与队列仍在。 |
| 刷新后使用原生视频控件播放、点击原生时间轴 | `paused=false / currentTime=0.08` 后实际播放至 `ended=true / currentTime=8`；时间轴 seek 到 `5.623188s`，`readyState=4 / error=null`。 |

浏览器 console 的 warn/error 均为空。截图：[实际拼装审阅截图](screenshots/agent-cutlist-review-20261005.png)。本次未执行拼装、生成或真实 API。

6000ms 保存导致激活过期只由已有聚焦测试覆盖，未做 CUA；多语言未做浏览器验收。下面的复验步骤还包含重复确认去重、全部丢弃和点击裁切时间值 seek，不能把步骤列表本身当作这些状态的本次 CUA 证据。

### 复验步骤

1. 准备真实视频样例，再打开审阅，等待状态待完成归零。实际 `/qa/trim-scenes.mp4` 为 320×180、约 8 秒；两个真实 QA 视频节点的初始建议分别 0–3000ms、4000–7000ms，目标 6s。
2. 首段出点减 100ms，次段丢弃，立即确认。等待保存完成后队列增加一次，CR1 为首段 0–2900ms、次段 drop；确认期间禁止更改，产物数仍为零。重复同方案确认由原宿主交接指纹去重。
3. 勾选保存失败，首段入点加 100ms，立即确认。失败可见且队列不增加；取消失败，同页再次点击确认采用这次实际草稿。
4. 点击“再改改”，核对两个片段的原始建议范围与保留状态恢复、已保存状态一致，然后只原始 revise 消息入队。全部丢弃时确认禁用；复原按钮恢复建议和可确认状态。
5. 点击时间值，核对实际视频源时间 seek；原生控件播放实际字节。最后编辑后立即外部关闭，关闭等待状态保存完成；重新打开保留最终裁切值与 keep 标记。
6. 勾保存失败再编辑关闭，原页面保留；取消失败再次关闭成功，重开/刷新读取最终已保存状态与普通队列。可选把延迟改为 6000ms 验证激活过期提示、第一次零入队及实际再次点击成功。

“独立本地拼装授权与真实产物”保留原已有 FFmpeg 流程，默认折叠且明确本次交互验收无需执行。审核与关闭都不会自动运行它。强制刷新无法承诺保存尚未取得事务回执的编辑。
