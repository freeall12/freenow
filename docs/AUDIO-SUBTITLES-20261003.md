# Seed 音频字幕闭环

适用：提交时接受的请求为 `audio.generate`、`parameters.model === 'doubao-seed-audio-1-0'` 且 `parameters.enable_subtitle === true`。完成时切换模型或配置不会重算这次字幕开关。

## 官方依据与本地合同

`reference/vendor-pkg-canvas-CvuTKiTt.js` 的 `WQ` 在音频任务完成后读取 `outputs.subtitle`：空白文本跳过，更新唯一 `sourceAudioNodeId` 对应文字，否则新建纯文字节点，位置为音频世界坐标加 `{x:(width ?? 300)+80,y:0}`，right → left 连线，不选中新文字。

本地标准生成合同保留 `outputs` 数组。每个实际 `type:'audio'` 输出可选 `subtitle:{text:string}`；只允许 `text` 键，UTF-8 最多 32768 字节，保留原始换行与空格。空白字幕省略；普通文字输出、prompt 和旧 envelope 不推断字幕。后端合同见 [GENERATION-AUDIO-SUBTITLE-CONTRACT-20261003.md](GENERATION-AUDIO-SUBTITLE-CONTRACT-20261003.md)。

官方默认原位完成音频并绑定原音频 ID；本地普通 UI/Agent 生成创建音频结果节点。因此本地绑定每项真正成功的 `resultIds[index]`，不将字幕挂到原空请求节点。没有重写既有音频结果布局。

## 应用、保存与迟到保护

`src/features/audio-subtitles/core.mjs` 核验显式字幕与对应音频的真实对象、实际本地化媒体引用、唯一字幕对象及内容。`generation-ui.js` 在音频结果创建/更新后的同步阶段捕获绑定，先于保存等待和 `didApply` 回调；保存失败重试复用原绑定，不重新猜当前音频或用户后改的文字。

`app.applyAudioSubtitle` 同步完成最终核验与事务：新节点为 `textMode:'pure'`、300×200、`sourceAudioNodeId` 绑定实际音频；节点和连线同一次撤销，既有字幕只更新 `content`，相同内容不新增撤销。选择保持不变。原位已有文字编辑器存在尚未保存的草稿/冲突时拒绝自动更新，由 `CanvasTextUI.hasPendingEdits` 保护用户草稿。

提交收据同时核验项目、原请求节点对象、节点内容及同来源最新音频任务。拖动/选择允许；来源替换、同 ID 重建、项目切换、更新任务和页面离开使旧回执失效。应用后的字幕编辑、来源媒体替换或撤销也拒绝旧重试，避免重新创建已撤销文字。多字幕重复绑定同一音频在写入前拒绝。

恢复 `new_nodes` 第一次创建通过 `importRecoveredOutputs.onApplied(ids,{created:true,audioRefs})` 同步捕获媒体和字幕收据。同页失败重试保留此收据。刷新后若已存在 retained 恢复节点且收据丢失，保留现有字幕并说明不自动重新绑定；持久化字幕身份恢复留待专门实现。`existing` 原占位恢复仍遵守其已有 workflow 能力，不虚称音频受支持。

## UI / Agent 入口

正式音频 UI：`audio-ui.js` 的 `buildRequest` → `GenerationAPI.submit`。Agent：`agent-client.js` 的 `generation_submit` 音频分支 → 相同 `AudioAPI.buildRequest` → 相同 `submit`；Agent `subtitle:true` 由 `src/features/agent-generation/audio.mjs` 映射为 `enable_subtitle:true`。默认、原位、批次和 derived 的应用路径均按实际音频结果捕获，custom apply 必须返回可验证的真实音频节点，不返回时安全拒绝字幕，不盲猜引用。

## 验证

本批新增 `node --test tests/audio-subtitles.test.cjs`：7/7 通过。包含严格合同/门控、多音频绑定、既有字幕更新、保存失败重试/撤销保护，以及真实 `TaskService`、生产 `applyResults`、应用 runner 与生产字幕事务的定向 VM 集成。恢复测试在实际保存等待中替换音频，旧字幕拒绝；刷新 retained 不重新绑定。普通旧结果在较新提交/项目切换/原请求节点修改后拒绝。新增 helper、生成接线及 QA 脚本均通过语法检查。

独立审阅另核对 9 个 helper/事务场景、真实 recovery helper 的逐项引用及 callback-before-persist 顺序，并复验文本脏草稿保护，无新增阻断问题。没有重跑冻结的旧音频上传/修复测试。

## 真实主壳 QA

生成：`node scripts/create-audio-subtitle-main-qa.cjs`。现有服务入口：`http://127.0.0.1:4173/src/features/audio-subtitles/qa/main.html?session=subtitle-live-1003`。

页面由当前 `index.html` 生成，使用正式 `app.js`、TaskService、音频验证/本地化及 CanvasStore，独立 IndexedDB 和内存偏好。供应商夹具只返回已验证的本机 `qa/node-audio-repair-tone.wav`（2 秒 PCM）及显式 `subtitle.text`；这是结果合同回放，非 ASR、非模型生成。页面禁止外部网络和模型 API；不会调用模型。可用正式音频 UI 生成按钮或「Agent 同入口请求并生成」控件。

验收顺序：生成 → 实际音频播放 → 查看纯文字与 right/left 连线和 gap80 → 保存并实际回读 → 刷新复验 → 撤销/重做。已有字幕更新控件通过真实 `runInPlace`，用于验证同一实际音频 ID 的更新路径。保存阻断控件明确模拟一次 `saveProject` 确认失败；生产自动保存可能已保存图，不能把此控件当真实磁盘故障。QA 提供任务状态、接受参数、真实媒体引用、节点/连线、撤销和存储回读诊断。

主代理已在 `subtitle-live-1003` 完成真实主壳 CUA：

- 点击「Agent 同入口请求并生成」，实际 `AudioAPI.buildRequest` 接受 `model:'doubao-seed-audio-1-0'` 与 `enable_subtitle:true`，TaskService/application 成功应用。真实 2 秒 WAV 从本机 blob 播放，`readyState:4`，播放时间观察到 `0.151086` 秒。
- 音频节点 `64b212ae-cd17-4d5d-b6af-84288729ae25` 位于 `(500,140)`、宽 300；字幕节点 `48a89c66-2e0b-489d-8502-c04ed402ec0d` 位于 `(880,140)`、300×200、pure，`sourceAudioNodeId` 正确绑定实际音频。字幕首尾空格与换行保留。
- 原位修改字幕，并显式阻断一次确认保存，任务显示 `applicationError`，提示画布可能已由生产自动保存。重试后成功，`applicationAttempts:2`；没有新增节点/撤销记录，夹具供应商调用仍为 2 次。撤销数初始为 2，原位音频及字幕更新后为 4，重试后仍为 4；撤销一次恢复原字幕，重做恢复新版。
- 实际保存、回读、刷新后，最终音频引用 `asset:c50fede4-57a7-4277-8e8e-7f5d397b5733`、字幕 ID 和来源绑定保持，音频真实解码仍为 2 秒。控制台 warn/error 与 `externalAttempts` 均为空。

截图：`/tmp/freenow-audio-subtitle-local-20261003.png`。以上是本机真实 WAV 与显式字幕合同回放的生产主壳验收，不代表 LLM / Seed 真实供应商生成，也不代表 ASR。刷新后的任务 `new_nodes` 新导入路径尚未做 CUA，该路径当前证据为专属测试与独立检查。

公开 QA 将此次实测的同一合成 WAV 保存在 `src/features/audio-subtitles/qa/contract-tone.wav`，192044 字节，SHA-256 `668081a4332d9ae2e3e4ecaf6067e2fac05b8199f5b880a607fd95bc5878332f`。仅迁移相同字节的静态位置，不再依赖被忽略的开发机 `/qa/` 音频路径。
