# 普通音频上传：迟到结果保护

根因：旧 `audio-ui.js upload(node)` 在原生文件选择后 await decode 与 LocalAssets.put，随后只凭 node.id 调用 updateNode。期间切换项目、删除/恢复同 id、替换来源、打开新选择器或修改配置，旧回调仍可能覆盖当前节点；durationMs 也未同步。

现在打开选择器时同步捕获原目标对象、项目、深快照和 per-node 最新 attempt。每次文件选择有 selection 版本，pagehide 递增 epoch，使旧操作无效；bfcache 返回后的新选择仍可继续。新选择器即使取消，也不允许更早解码结果迟到覆盖。取消本身不改变节点。

新 `src/features/audio-upload/guard.mjs` 在 module await 后、真实 decode 后、LocalAssets.put 后检查最新 attempt、项目、原对象身份与内容快照；只忽略 x/y/selected，因此移动保留，来源/标题/配置改变会拒绝。pendingOperation 与活跃生成目标阻止普通上传写回。所有 await 结束后同步一次 app.updateNode，仍使用普通上传的 filename 标题与 300 × 300 行为，同时写 audioDuration 秒、durationMs 毫秒及 imported provenance。source journal 和其他节点不变。

保留现有正常上传文件选择器，不强塞旧资源 repair 对话框。updateNode 的既有自动保存与单 undo 保持；随后 await saveProject 确认 flush。失败或等待期间状态改变，报告已应用、自动保存未确认，引导保留页面并通过现有画布菜单重试保存。无新成功提示、虚构回滚、重复导入或额外 undo。

`tests/audio-upload-guard.test.cjs` 定向 4/4 通过，包括 decode/put 后对象/source/config/项目/任务变化、单 undo/普通300×300/title/双时长单位、保存失败/等待变化，以及直接提取生产 chooser 验最新选择、取消、pagehide 与返回后新操作。未重复旧 repair 回归或全套测试。

## 独立主壳竞态验收

使用原音频 QA 主壳：

<http://127.0.0.1:4173/src/features/local-resource-migration/qa/node-audio-repair-main.html?session=audio-upload-live-1003>

1. 点「新建普通空音频节点」，记录当前历史基线。
2. 点「暂停下一次真实解码结果」，再「打开普通上传选择器」，通过原生 filechooser 选 `qa/node-audio-repair-tone.wav`（2 秒）。等待诊断出现 heldDecodeDuration。
3. 再「打开普通上传选择器」，选 `qa/node-audio-upload-newer.wav`（3 秒、660Hz、48kHz16-bit mono、288044字节）。待实际写回后回读保存记录。
4. 释放旧真实解码结果；节点应保持新 filename、约3秒的两个时长字段和同 asset，历史只有新文件的一次上传变化。验证真实播放、刷新与另节点/连线保持。

fixture 仅包装原生 AudioContext.decodeAudioData，延迟返回真实已解码 buffer，不构造虚拟元数据。新增 PCM 文件由现有 QA generator 在不存在时生成，是本机测试样本。session 独立 IDB 与 Map 偏好；不读写个人存储。

### 2026-10-03 CUA 竞态、播放与刷新证据

root 在 session `audio-upload-live-1003` 使用正式普通上传入口与原生 filechooser：旧 2 秒 WAV 真实解码结果暂停，heldDuration 为 1.999977 秒；随后选择 3 秒、660 Hz 新 WAV，成功应用到节点 `e618ceea-4849-445d-adb3-9ec77414671d`，持久 asset 为 `asset:812e3304-99d7-4f90-b4b5-46779a15a027`。

新节点保持普通上传语义：300 × 300、标题为新 filename、durationMs 为 3000、provenance 为 imported。释放旧真实 decode 后，asset、时长和 undoCount 仍不变；undoCount 为 2，分别是新节点创建与新文件上传。实际 CanvasStore 回读确认相同值，另外两个旧节点与原连线保持。

真实播放 currentTime 从 0.417875 秒推进至 3 秒并 ended；刷新后持久 asset 不变、Blob URL 重新建立，波形 decoded、播放器 readyState 为 4。截图：`/tmp/freenow-audio-upload-latest-20261003.png`；本轮 QA 浏览器标签 82 已关闭。

本机测试没有调用模型或原站服务。fixture 的 externalAttempts 只覆盖包装的 fetch，不能作为整个浏览器网络栈完整请求证明。本次仅追加 root 已取得的证据，没有修改生产代码或重跑测试。
