# 普通音频生成原位完成

普通 UI 与 Agent 提交 `audio.generate`，来源为音频节点时，真实本地化并解码全部返回音频后，更新原节点。ID、title、audioMode、audioConfig、坐标/尺寸、选择与既有连线保持；不创建第二个音频节点，也不把生成节点改成 upload 模式。首项写入 `audio`、实际 `audioDuration` 秒、`durationMs` 毫秒及与实际 asset 对应的任务 provenance。播放器重新读取真实媒体字节绘制波形。

## 官方依据与多结果语义

捕获文件 `reference/vendor-pkg-canvas-CvuTKiTt.js`：

- `WQ`，offset 1275437：普通音频 `batch_count:1`，callbacks 绑定原 nodeId，完成后先 `G.onTaskComplete`，Seed 字幕随后绑定原 nodeId。
- `Ci.onTaskComplete`，offset 715129：`generated_audios[].audio_url` 全部映射后交给 `NAe`，调用原节点 `updateNodeData`。任务 ID `result.ids[0]` 不是音频输出数量。
- `NAe`，offset 710017：`src:first`、`options:all`、清临时 historyPreviewSrc、保持 historyVariantsHidden 及相应本地队列/元数据、taskInfo completed。title/params/type/位置不在完成 patch 中。
- `FS`，offset 569930：音频也发送全部结果 URL 的历史事件。

本地采用 first + all：`resultIds:[原音频ID]`，live 第一项；`options` 保存本批全部真实本地引用，`audioResultMetadata` 保存逐项 ID/实际时长/字幕/provenance，`audioHistory` 保存批次及先前本地音频，不丢其他结果。既有 GenerationHistory 仍归档完整供应商输出。第一项显式字幕更新/创建原音频绑定文字，其余输出字幕随各项元数据保存，避免多字幕轮流覆盖同一来源。

当前官方可见音频 UI 没有可证明的 options 画廊：`ABe/qD`（1593519）只读 src 播放，`IU`（1616767）沿用此播放器，`SBe`（1591438）只有颜色/下载/素材保存，音频 context menu 只下载；`SJ/historyPreviewSrc` 切换调用位于图片/视频（1877906/2016469），没有音频调用。本地现也没有音频节点历史切换入口。保存所有选项与全局历史不等于完成节点 options 切换。本批未新增未经该版本官方可见行为证明的画廊；若以后增加，最小方案为节点工具栏历史入口、真实播放器、按批次选择、明确应用并同步音频/时长/provenance/字幕。

## 应用与迟到边界

`src/features/audio-generation/application.mjs` 只拥有普通 submit 的音频来源。`runInPlace` 组工作流、derived、恢复各自保留已有合同；非音频来源的直接请求沿用显式新节点语义。首项字幕通过既有字幕 helper/同步事务应用，继续保护用户文字草稿、同 ID 重建、字幕改写、撤销和旧回执。

`AudioAPI.buildRequest` 开始同步捕获来源、项目、参考媒体身份/内容与输入连线，所有异步准备完成后核验；未落盘的音频参数草稿也会拒绝旧请求。提交后收据固定已接受的请求；上游参考输入采用已提交的不可变媒体快照语义。普通结果应用在每次 localize/inspect 等待后核验原音频对象/完整内容、项目、最新任务和未落盘参数；允许拖动与选择，不允许替换、配置修改或撤销。供应商 outputs 开始应用时深拷贝，并在所有 guard 核验原 outputs 签名，避免解码期间修改字幕导致错绑媒体。

所有选项成功本地化及真实 decode 后才一次 `updateNode`。同步捕获音频及字幕收据后再等待保存。保存失败重试复用已应用的对象/媒体/outputs 签名，只确认保存并继续尚未完成的字幕步骤，不重复下载、解码、节点修改或供应商派发；已撤销或被编辑的 source 拒绝旧重试。

播放器修复：button/wave pointerdown 保持完整交互，不在 mouseup 前同步弹出 composer；空白播放器仍可选中节点。composer 下方空间不足、上方有空间时放在节点上方，避免覆盖已选中节点的播放控件。

## 验证

新增 `tests/audio-generation-in-place.test.cjs` 6/6 通过：first + all 与原字段/ID保留；localize/decode失败与来源/对象/owner/pending/outputs晚到变异零写入；保存失败重试、撤销与输出修改；原字幕 ownership；生产 buildRequest 异步参考准备中的 source/ref/project/pending 变化；生产播放器 pointer 与 composer 布局回归。更新受原位行为影响的 `tests/audio-subtitles.test.cjs` 7/7 通过，使用真实 TaskService、生产 applyResults/字幕事务及 application runner。新增生产/QA 文件语法检查与 scoped diff check 通过。未跑全套或冻结的旧音频修复/上传测试。

独立审阅确认官方 first + all；对生产 buildRequest 7 场景和 helper 迟到/保存/撤销场景复验。其 outputs 解码期间变异反例已修，复验零写入。工作流恢复分支由另一作者负责，本批没有替代其独立验收。

## 真实主壳 CUA

生成 QA：`node scripts/create-audio-subtitle-main-qa.cjs`。页面由当前 index 生成，独立 IndexedDB/内存偏好：`http://127.0.0.1:4173/src/features/audio-subtitles/qa/main.html?session=audio-original-v2-1003`。

控件：普通生成与第二次普通更新、下次两项真实音频、字幕确认保存阻断/重试、保存实际回读/刷新、暂停真实 decode/修改参数/释放。两项分别为本机真实 2 秒 440 Hz WAV 与 3 秒 660 Hz WAV；显式字幕为合同回放，不调用模型或 ASR。禁止外部/API派发。

主代理 CUA 已确认：

- 普通生成、刷新、多输出及第二次普通生成均保持原音频和字幕 ID，字幕来源仍绑定原音频。两选项真实约 2 秒/3 秒，均为本地 asset，逐项字幕元数据持久保存。
- 未选中节点时点击真实 play 按钮，`currentTime:0.343`、`paused:false`；选中后也能播放，`currentTime:0.439`、`paused:false`。composer 不再覆盖控件。
- 字幕确认保存失败后重试，供应商夹具调用保持 2，撤销数保持 6，节点集合相同；没有再次生成或重复应用。
- 暂停真实 decode 返回结果，修改原音频参数，再释放；旧结果被拒绝，原音频和字幕保留。

截图：`/tmp/freenow-audio-original-node-20261003.png`。这是实际 WAV 解码/播放与生产 TaskService/application/CanvasStore 的合同回放验收，不代表真实供应商生成。node options 画廊切换没有实现；恢复新导入 paths 的 CUA 不属于本批证据。
