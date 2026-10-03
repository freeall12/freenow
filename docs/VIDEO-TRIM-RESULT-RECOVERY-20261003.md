# 本机视频剪辑结果归属与保存确认 · 2026-10-03

本批修复手动剪辑与智能硬切剪辑的后台结果归属及保存回执。实际裁剪仍使用既有本机 FFmpeg，不新增依赖或供应商，不改变视频/logo素材。

## 依据与缺口

官方本地行为证据为 `reference/video-trim.md`、`reference/video-trim-live.json`、`reference/video-trim-shortcuts-live.json` 与 `reference/video-player-live.json`。已捕获的流程包含手动选区、智能剪辑、后台进度/停止、真实片段与来源连线。此次恢复保护属于本地可靠交付补齐，不声称捕获了官方同名保存恢复面板。

此前生产 `video-trim-ui.mjs` 用节点 ID、video URL、clip 判断来源。编辑器关闭后允许后台继续，但该判断不能区分另一个项目的同 ID/URL，或删除后撤销恢复的新对象。结果 `createConnected` 已触发自动保存，但 handler 立即显示成功，没有等待 `saveProject()` / store flush 确认；保存失败没有独立重试入口。

## 实现

- `src/features/video-trim/result-transaction.mjs` 在进入编辑器时捕获项目 ID、来源节点对象、视频与 clip。素材读取、FFmpeg、逐帧读取、结果序列化与最后插入都重新检查；同 ID/URL 的其他项目、撤销重建的新对象、已换源/clip及停止的处理均不能投放迟到结果。源坐标移动不使裁剪失效。
- `createConnected` 一次插入完整片段批次及连线，继续复用现有单步撤销和自动保存。随后明确等待生产 `saveProject()` 确认，再显示剪辑成功。插入之后停止不删除已显示的结果。
- 保存失败保留实际节点与连线，浮条显示“保存未确认”，提供“重试保存剪辑结果”和“关闭保存提示”。重试只保存原对象，不重复 FFmpeg、序列化或插入。结果及连线身份/内容改变、删除、撤销或项目切换会拒绝重试；不会回滚用户操作或重建结果。结果坐标移动可继续保存。
- 所有成功路径均复用同一事务。`pagehide` 停止未投放的任务并释放解码器；关闭可见编辑器仍允许合法后台处理。

## 定向验证

```bash
node --test tests/video-trim-result-transaction.test.cjs tests/video-trim-ui-ownership.test.cjs tests/video-trim.test.cjs tests/agent-video-trim.test.cjs
node --check video-trim-ui.mjs
node --check src/features/video-trim/result-transaction.mjs
node --check src/features/video-trim/qa/fixture.js
node --check src/features/video-trim/qa/controls.mjs
git diff --check
```

27项通过，包括本次新增12项：纯事务7项、提取实际生产类方法的handler5项；另有既有选区/硬切5项、Agent视频裁剪10项兼容回归。测试涵盖手动/智能保存等待、项目及对象变化、逐帧检测阶段失效、停止后迟到序列化、保存失败和并发重试、结果/连线修改、换项目与撤销后拒绝重建。Node内媒体对象是明确测试夹具，不能作为真实浏览器视频验收。

## 浏览器复验入口

```text
http://localhost:4173/src/features/video-trim/qa/main.html?session=video-trim-recovery-20261003
```

该页动态载入实际 `index.html`、生产画布/剪辑模块，使用单独 project ID、CanvasStore 和 LocalAssets 数据库。输入为已存在的本机8秒红蓝测试片 `/qa/trim-scenes.mp4`，读取实际MP4后转换为durable data引用再种入新项目；仅允许本机 `/api/media/trim`，拦截外部请求。它不操作用户的正式画布。`session` 保持相同即可刷新读取同一隔离项目；更换它可得到新夹具。验收面板可收起，露出生产浮条的鼠标操作区。

1. 点击“验证真实剪辑并等待保存”，期望一个2秒真实结果，实际 `openVideoFrames` 解码并报告尺寸、时长、请求数。
2. 点击“注入保存失败，保留结果后手动重试”，原handler实际执行裁剪并创建视频。保存API回执被故意拒绝；生产浮条须显示保存未确认。点击“重试保存剪辑结果”，再点击“读取保存重试结果并解码视频”，应保留原ID且FFmpeg请求数不增加。
3. 点击“验证后台剪辑拒绝撤销重建的同 ID 来源”。夹具在实际裁剪完成、序列化等待时关闭编辑器，通过生产 `remove` + `undo` 恢复同 ID/URL 的新来源对象，再释放真实输出序列化。期望来源对象改变、节点数不增加、一次本机裁剪被拒绝回填。
4. 刷新后点击“读取已保存剪辑（可先刷新页面）”，应实际回读并解码原结果。

结果记录于页面 `#trim-transaction-results`，同时保留 `VideoTrimFixture.events`。“保存失败”是专门注入的回执故障；`createConnected` 的自动保存仍可能完成，不能把它宣称为操作系统磁盘故障或全链路崩溃恢复。

主任务 Computer Use 已完成以下复验（2026-10-03）：

| 实际操作 | 观察结果 |
| --- | --- |
| 手动裁剪1–3秒 | 真实输出2秒、320×180，一次FFmpeg，实际帧解码；保存确认后才成功 |
| 裁剪4–6秒并注入保存回执失败 | 原结果节点和连线保留；随后通过生产重试按钮的Enter操作保存，累计处理仍为2次，原输出ID不变，无重复裁剪 |
| 刷新手动结果 | 两个原ID均回读，均为2秒、320×180 |
| 新种子通过正式“智能剪辑”按钮 | 硬切分析生成2.2、1.8、4秒三段，均为320×180，总时长8秒；实际红、绿、蓝画面及来源连线可见 |
| 在结果序列化等待期间删除来源并撤销 | 原ID相同但节点对象换代；处理一次，节点数4→4，迟到输出未添加 |
| 刷新智能结果 | 三个原ID均可再次解码；夹具记录的外部fetch尝试为0 |

智能剪辑截图已发布于[功能截图](screenshots/video-trim.jpg)，展示实际本机输出，不是模型生成效果。初测QA面板曾遮挡重试浮条，现已增加收起按钮；保存重试实际使用键盘确认。新种子将测试视频持久化为data引用，避免旧`/qa`媒体来源触发迁移提醒；旧隔离session保留原数据，未批量改写。

独立只读交叉审查核对生产`createConnected/saveProject/undo`与新增事务，没有发现发布阻断。保存重试浮条的通知可能在关闭提示后仍完成，已显示结果不会因此重复插入；测试与当前浏览器证据不涵盖全部关闭/取消组合。

## 保留边界

保存重试收据属于当前页面，关页后不重建未确认结果；已经成功持久化的结果沿既有项目加载/撤销流程恢复。来源/结果检查在异步阶段边界执行；不引入全项目版本锁。没有本机FFmpeg时实际裁剪仍失败。80MB、最短1秒及既有媒体接口限制保持。全站同态视觉、SPZ、真实供应商与精确模板的开放问题不在本批结论中。
