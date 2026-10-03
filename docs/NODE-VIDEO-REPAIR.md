# 旧视频节点的人工本地替换

用户在正式旧视频节点点击「导入本地视频」，通过原生文件选择器指定本机可解码视频。此操作属于用户替换，不声明精确恢复原件；不请求旧 URL、不修改可信映射索引、不调用生成服务。

## 实际媒体字段

`video-tools.js` 的播放源是 `node.video || EDITOR_DATA.nodes[id].video`，封面来自 `node.image`。因此修复既支持显式旧 `video`，也支持缺失时的旧 EDITOR_DATA 回退；只写所选 `node.video`，不改共享 EDITOR_DATA。

新视频真实解码后，以同一已解码 reader 的首帧生成 JPEG 封面，写 `image` 并同步此节点已有 `fullImage/poster/thumbnail` 封面别名。黑色首帧也是真实结果，不使用无关样图。像素写 `pixelWidth/pixelHeight`，实际秒数换算 `durationMs`，与现有历史归档 `archive.mjs:78` 的 node 合同一致。`generation.duration` 是未来生成设置，保持不变。

`clip.start/end` 直接控制 inline 播放和裁剪工具边界；不同用户文件无法沿用旧裁剪范围。因此替换明确设置 `clip:null`，UI 告知用户；inline bounds 和 trim-ui 以 `start || 0`、`end ?? 实测duration` 恢复整个新视频。保留位置、画布宽高、其他节点、生成参数、历史任务及 source journal。新 provenance 为 `imported`、绑定新视频 ref、`model:null`，防止归因于旧模型。

## 校验、存储与保存

- 文件必须有 `video/*` MIME，非空且不超过 100 MiB；实际浏览器解码支持决定容器/编码是否可用。不能解码、无首帧、零或无效时长均拒绝。
- 复用既有 `openVideoFrames` 与 `inspectVideoThumbnail`，读取真实 width/height/duration，并取得实际首帧；单边最多 8192、总像素最多 33554432。JPEG 首帧最大 2 MiB。
- 视频及封面分别 LocalAssets.put，回读 Blob 并核对 MIME、字节数、SHA-256，所有验证完成前不发布节点补丁。哈希后释放初读字节数组引用，再执行保存和回读；所有视频整读均受 100 MiB 预算约束。
- 对象身份、项目、旧媒体来源（包括回退值）、内容签名与 `isCurrent` 在异步流程后重新检查；复用 `imageRepairBusy` 阻止 pendingOperation 及 queued/running/applying 目标。节点 x/y 移动保留。
- 最后 guard 后同步 `updateNode` 一次，因此同视频和封面只有一项 undo，再 await 实际 `saveProject`。保存与快照核对的每个 await 后检查当前上下文及全部替换 patch：clip、duration、像素、封面别名和 provenance 都包括在内。
- 保存失败或等待期间状态变化，报告 `applied:true,persisted:false`，不虚构回滚；UI 可仅重试保存，不重复存素材或增加 undo。成功后的重试幂等。默认 `readProject` 为 `app.projectSnapshot()`，只用于当前字段核对；持久化证据来自 `saveProject` flush 和独立浏览器刷新验收。
- 素材落盘后 guard 失败可能留下未引用的本地 Blob；不删除用户数据。

## 正式入口接线

```js
const {openNodeVideoRepair}=await import('./src/features/local-resource-migration/node-video-repair-ui.mjs');
openNodeVideoRepair({app:window.CanvasApp,nodeId,isCurrent});
```

`isRepairableVideo(node,getVideoSource)` 识别待修复来源，默认含 EDITOR_DATA 回退。service `createNodeVideoRepair` 注入合同为 `nodeId/getNode/getProjectId/isCurrent/getJobs/getVideoSource/assets/updateNode/saveProject/readProject/decodeVideo/hashBytes/readAsset`。`repair(file)`、`retrySave()` 返回视频 ref、封面 ref、真实尺寸/时长/字节/SHA、applied/persisted；已应用保存错误用 `saveError` 表达。

root 负责 app.js 的正式按钮及旧回退 pendingMedia 接线。UI 独立 CSS；复用图片修复已验的焦点恢复、IME/repeat Escape、创建失败清理与保存重试交互。

## 专属验证

`node --test tests/node-video-repair.test.cjs`：初始 7/7 通过，覆盖视频与封面字节合同、旧回退、单次 undo/参数/journal 保留、clip 重置、MIME/大小/解码/尺寸/时长/首帧/回读失败、异步目标/来源/项目变化、生成目标、保存失败与重试、保存等待期间状态变化及 x/y 保留。Node fixture 使用合成字节和注入 decoder，仅证明服务合同，不宣称这些合成字节是可播放视频。

补充全部 patch 字段的等待保护后，只运行受影响的 `save/read awaits` 回归，1/1 通过；未重复全套或其他旧回归。模块/QA 语法及 diff 检查通过。

## 正式主壳浏览器 QA

运行 `node scripts/create-node-video-repair-main-qa.cjs` 从当前 index 生成真实主壳：

<http://127.0.0.1:4173/src/features/local-resource-migration/qa/node-video-repair-main.html?session=video-live-1003>

fixture 使用 session 隔离 Canvas/Assets IndexedDB，Map 内存偏好，不写真实 localStorage。左节点是显式旧 video，右节点仅有 EDITOR_DATA.video 旧回退；都保留独立 synthetic source journal。网络只允许本机/Blob 读取和未配置的配置响应，不连接原站或模型。

点击任一正式节点按钮，通过真实 filechooser 选择本机 `qa/trim-scenes.mp4`（或现有 playlist 红蓝合成视频），再导入。此主壳使用真实 app.js、video-tools、LocalAssets、CanvasStore，没有自建 app facade 或 DataTransfer 预选。诊断包括 live/持久化 node、真实 player videoWidth/videoHeight/duration/readyState、封面自然宽高与 undo/redo；控件可真实回读、刷新、保存、撤销/重做。另一个节点应保留旧引用，回退 map 始终不被改写。

诊断 details 默认收起，可点击「展开视频修复诊断」，减少截图时对正式节点标题的遮挡。

### 2026-10-03 正式主壳 CUA 证据

root 在上述正式主壳完成真实浏览器验收：

- 左侧显式旧 video 节点：点击正式修复按钮，使用原生 filechooser 选择本机 `playlist-contract-red.mp4`。真实解码为 320 × 180、8 秒、7144 字节；实际 CanvasStore 回读视频/封面均为持久 asset，右节点不变，一次替换只有一项 undo。
- 刷新后，真实 inline video 使用新 Blob 地址，readyState 为 4。实际播放时间从 0.267 秒推进至 8 秒并结束，验证了内容可播放。
- 真实 undo 并保存恢复旧 URL 和 clip 20..24；redo 恢复本地视频。
- 右侧 EDITOR_DATA 旧回退节点：通过其正式按钮和原生 filechooser 导入本机 `playlist-contract-blue.mp4`，7118 字节，替换成功。
- 再次刷新后，两节点使用独立 asset 视频及封面，封面真实 320 × 180，clip 为 null，durationMs 为 8000，undo 为 2；EDITOR_DATA fallback 与原 source journal 记录保留。
- `externalAttempts: []` 仅代表 fixture 包装的 fetch 无外部尝试，不作为完整浏览器网络栈的请求证明。

截图：`/tmp/freenow-local-video-repair-20261003.png`。本次只补 root 取得的证据及 QA 诊断折叠，没有重跑测试或改生产代码。
