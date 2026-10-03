# 旧音频节点的人工本地替换

用户在正式旧音频节点点击「导入本地音频」，经原生文件选择器指定本机可解码文件。操作是用户替换，不声明精确恢复原件；不读取旧原站 URL、不修改映射索引、不调用音频生成服务。

## 实际字段与播放器

实际源是 `node.audio`，没有 EDITOR_DATA 回退。`audio-ui.js` 的私有探测器使用 AudioContext.decodeAudioData 和 `AudioCore.peaks(...,600)`；波形由播放器运行时重新解码生成，不是持久 node 字段。现有 upload 写 `audioDuration` 秒和 `audioMode:'upload'`，历史 archive 写 `durationMs` 毫秒。

修复同时写真实 `audioDuration/durationMs`、upload 模式，以及 `provenance:{kind:'imported',mediaSource:ref,model:null}`。不改变标题、x/y、画布 width/height、audioConfig、连线、历史任务或 source journal，也不生成不存在的音频封面。播放器从新 asset 重新解析波形，避免保留旧来源分析结果。

AudioAPI 没有导出其私有 decoder，因此新 decoder 复用相同浏览器解码 API 和已有 `AudioCore.peaks`，使用独立 AudioContext 并在成功、解码失败、预算失败后关闭。返回的 sampleRate 是 WebAudio 解码缓冲区采样率，可能由浏览器重采样，不宣称为文件容器的原始采样率。

## 字节、来源与保存合同

- 50 MiB 以内的非空 audio MIME 文件，也接受携带音频的 video/webm 或 application/ogg；最终必须被浏览器真实解码。UI 使用现有格式选择范围 `audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm`。
- 解码超时 15 秒；正数有限时长、8k..192k 解码采样率、1..32 通道，PCM 样本数乘通道最多 67108864。已有 peaks 生成最多 600 个有限 0..1 值。预算在解码缓冲区可用后校验，源字节始终受 50 MiB 约束。
- 存入 LocalAssets 后回读 Blob，校验 MIME、实际字节数和 SHA-256。初读哈希后释放字节数组引用再保存、回读。不请求旧源比对，不据用户选择文件建立精确原站映射。
- 每次异步等待后检查当前项目、目标对象、内容及来源；复用 imageRepairBusy 拒绝 pendingOperation 和 queued/running/applying 任务。仅 x/y 移动可继续。
- 最后 guard 后同步一次 `updateNode`，单项 undo 包含整个替换；await `saveProject` 与一致性核对后报告保存。每个保存 await 后复查全部 patch，包括两种时长单位、模式和来源归因。
- 默认 readProject 是当前 app.projectSnapshot，仅核对当前状态，持久化依靠既有 saveProject/flush；实际持久记录与刷新验收在独立 QA。
- 保存失败或等待期间状态变化返回 applied=true、persisted=false，不虚构回滚；重试仅保存，不重新导入或增加 undo，已成功重试幂等。素材落盘后 guard 失败可留未引用 Blob，不删除用户数据。

## 入口合同

```js
const {openNodeAudioRepair}=await import('./src/features/local-resource-migration/node-audio-repair-ui.mjs');
openNodeAudioRepair({app:window.CanvasApp,nodeId,isCurrent});
```

`isRepairableAudio(node)` 识别旧原站 `node.audio`。service `createNodeAudioRepair` 注入合同：nodeId/getNode/getProjectId/isCurrent/getJobs/getAudioSource/assets/updateNode/saveProject/readProject/decodeAudio/hashBytes/readAsset。repair(file) 和 retrySave 返回 ref、SHA/bytes、真实 duration/sampleRate/channels/waveformBins、applied/persisted；已应用保存错误通过 saveError 表达。

root 负责 audio-ui 正式按钮与阻止旧来源播放器。不能仅向 app.js body 追加按钮，因为 `audio-ui.reconcilePlayers` 会 replaceChildren。其他普通音频上传保持既有路径。UI 包含保存重试、焦点恢复、IME/repeat Escape 与创建失败清理。

## 专属检查

新增 `tests/node-audio-repair.test.cjs` 6/6 通过：所选字节、双时长单位、title/geometry/config/journal/其他节点/单undo 保留；文件/decode/元数据/波形/回读拒绝；迟到来源/对象/项目/生成任务守卫；保存失败与仅保存重试；全部 patch 和等待中上下文检查；默认 decoder 复用 peaks 并释放私有 Context。Node 音频字节与注入 decoder 是服务合同 fixture，不作为可播放音频证明。

只运行本批专属回归及语法/diff 检查，未重跑旧套件、加依赖、提交或改生产共享入口。

## 真实主壳 QA

`node scripts/create-node-audio-repair-main-qa.cjs` 从当前 index 生成正式主壳，并仅在不存在时写本机 PCM 测试音 `qa/node-audio-repair-tone.wav`：2 秒、440 Hz 正弦、48 kHz、16-bit mono、192044 字节。它是可审查的本机合成测试音，不是模型结果。

<http://127.0.0.1:4173/src/features/local-resource-migration/qa/node-audio-repair-main.html?session=audio-live-1003>

两个旧 audio 节点和一条连线，实际画布尺寸 280 × 230；session 隔离 Canvas/Assets IndexedDB，Map 内存偏好不写真实 localStorage。正式 AudioCore、AudioAPI、LocalAssets、CanvasStore 和原生 filechooser 均使用生产实现；没有自建 app facade 或 DataTransfer 预选。诊断默认 details 收起，显示实际波形状态、audio readyState/duration/currentTime/paused/ended、source journal、坐标尺寸、连线与持久记录。

点击左节点正式按钮，filechooser 选择 `/Users/laplace/Documents/Codex/2026-09-22/new-chat/outputs/canvas-replica/qa/node-audio-repair-tone.wav`，导入后检查实际波形/播放；只回读实际持久记录并刷新相同 session；真实撤销与重做后保存，另节点及连线应不变。fetch 包装的 externalAttempts 仅是局部诊断，不代表完整浏览器网络请求证明。

### 2026-10-03 首次 CUA 导入与播放证据

root 通过正式音频入口和真实文件选择器导入上述 PCM 测试音：界面显示 2.000 秒、解码采样率 44100 Hz、1 通道、192044 字节。源 WAV 是 48000 Hz，44100 Hz 是本次浏览器 AudioContext 重采样后的解码缓冲区采样率，UI 已明确标注，不能据此改写源文件信息。

实际持久记录为 asset 音频，audioDuration 约 1.999977 秒、durationMs 约 1999.977 毫秒；280 × 230 geometry、标题、另一个节点和连线保留，undo 为 1。真实播放器波形状态为 decoded，readyState 为 4，媒体时长 2 秒且播放时间已经推进。

QA 的 repairButton 诊断使用正式入口 `.audio-source-repair .audio-upload`。初始 QA 误查图片/视频入口 class 导致诊断失准，属于 QA 选择器问题，不是产品按钮缺失。

root 完成后续真实验收：audio currentTime 从 0.182 秒推进至 2 秒并 ended=true；刷新后持久 asset ID 不变、本地 Blob URL 重建，波形仍为 decoded。真实 undo 并保存恢复旧 URL 和旧 123 秒记录，旧来源播放器退场、导入按钮恢复；redo 并保存恢复真实波形和 2 秒播放器。实际持久回读确认右节点与 `qa-audio-edge` 连线保持不变。

截图：`/tmp/freenow-local-audio-repair-20261003.png`。fixture 的外部尝试数组为空仅代表 fetch 包装范围，不作为整个浏览器网络栈的完整证明。本轮只修改采样率文案、QA 选择器及证据文档，没有改 decoder 或重复测试。
