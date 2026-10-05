# 普通视频节点：Depth Anything Video（1005k）

## 正式入口与官方证据

入口使用现有视频节点底部的“选择生成模型”菜单，显示 **Depth Anything Video NEW** 和本地 freenow 品牌图标。没有新增 toolbar 工具或独立深度参数面板。

公开说明：<https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-video#使用视频深度工具>。流程是创建/选择视频节点、选择视频深度、连接或上传来源视频、保持提示词为空、生成；输出与来源时长相同。

本机官方源码审计（`reference/canvas-current-readable.js`，原始包仅作研究证据，不作为发布资源）：

- `VideoGenerationControls/ene`，31305–31318：Depth variant 的 `promptPolicy:'optional'` 使旧提示词清空，并允许空提示词生成。
- 31557、31617：提示词只读、无需提示词占位、隐藏 mention 提示、锁定语音输入。
- 29311–29331：规格入口保留，标签“视频编辑 · 自动”；生成方式为单一 EDIT，比例、清晰度和时长静态“自动”，无音频/turbo/mode 控件。
- 31617：没有 `timesOptions` 时普通数量选项为 `[1,2]`，Depth 没有模型专用次数列表。官网并没有隐藏数量入口。
- 31509：参考 picker 仍允许图片、视频、音频、文本，已连接参考正常展示。这里保留 picker；本地合同严格拒绝一个完整视频之外的参考组合，不冒称官方已过滤选择类型。
- `Zv/E`，22233–22319：当前视频节点 ID 是任务 target，来源视频来自 incoming edges，二者允许不同。默认 variants 将 outputs 写入当前 target 的视频历史；spread/pile 采用普通结果规划，空 target 首个结果复用 target、其余新增，有媒体 target 保留原节点并新增结果。
- 6376–6390：结果模式默认 variants。

主任务本轮真实官网 CUA 已观察底部模型菜单中的 “Depth Anything Video NEW”；账号选择时出现付费解锁提示，因此未操作原站生成或绕过账号限制。选中后的行为采用上述源码证据。

## 实现边界

- `node-editor.js` 增加现有模型菜单条目，选中时清空旧 prompt，禁用 prompt/语音输入；保留现有规格和 1/2 数量菜单。
- `src/features/video-depth/composer.mjs` 负责 UI 设置、原始请求、配置预检与实际来源读取。内部 `parameters.composer:'video-depth-node-v1'` 只存在于 TaskService 准备之前；发送到后端前移除。
- 请求 target `nodeId` 与单一来源 `inputs[0].id` 分别校验。来源使用真实 video URL，不能用 poster；额外参考、未物化 `clip/trim/sourceClip`、隐藏设置或非空提示词会停止。
- `prepareDepthNodeMedia` 在配置预检后读取来源，单任务缓存同一实测 resolver 结果以避免二次 probe；所有缓存使用仍执行来源与 abort 守卫。随后复用完整 MP4 传输、预算、原尺寸/原时长检查。
- 原生 profile 只接受明确的 `maxCount:1` 或 `2`；选择 2 而服务只声明 1 时，在 probe 前停止。2 个输出由后端执行两个独立原生任务，保持现有任务和历史/结果布局语义。
- `count/times` 是输出数量；有 canvasResults 时 `targetNodeIds.length` 必须匹配输出数。`batch_count` 是逻辑 requestPlans 数，不是输出数量；variants 无 canvasResults 时如声明则为 1，即使 `times:2`。
- 已准备的 Agent `local-depth-v1` 请求兼容旧链路，不执行普通节点专用编译。
- 模型仍为明确配置的独立 fal 替代实现，完整 MP4/CFR/偶数尺寸/5–30 fps、32 MiB、最多 2400 帧和 1920×1080；输出无声音灰度视频，保留来源尺寸与时长。没有声称与参考站供应商效果一致。

共享 GenerationAPI 和结果布局/持久保存接线由主任务完成；源码交审发现的来源守卫和恢复入口项目绑定缺口已修复并复核。模块测试与下方正式浏览器核验分别记录。

## 验证

2026-10-05 定向验证：

- `node --test src/features/video-depth/qa/composer.test.cjs`：8/8，覆盖模型切换、来源与目标独立、隐藏/额外意图拒绝、配置先于媒体、2-output capability、实际元数据、marker 移除、取消/来源变化、生产 `submitGeneration` 实际分支、完整 MP4 和单次 probe、variants/spread 批次语义。
- 既有深度前端专项 9/9；本轮修改后的普通节点 H3 defaults 与 footer/layout 测试共 6/6。只给已有 VM harness 补新的 module dependency stub，未放宽断言。
- 共享 `src/features/generation-results/recovery.mjs` 增加可选 guard，在解码、物化、原占位应用、创建和保存的异步边界执行；`src/features/video-depth/qa/recovery-guard.test.cjs` 3/3，通过项目切换时零迟到创建、保存失败重试不重建、晚到解码停止原占位应用。
- 最后收紧 `source.video===input.url`，清空来源但保留旧 URL 的定向回归 1/1 通过；旧来源兜底需要先真实导入节点，不将 poster 或旧 data 当成当前来源。
- 修改文件语法检查和 `git diff --check` 通过。

未执行全量套件、付费调用、真实 Key 读取、原站生成、用户媒体上传或共享浏览器操作。

## 独立生产节点 QA

沿用 `src/features/video-depth/qa/main.html`、隔离存储和 native server。来源是仓库实际 64×48 / 2s / 20fps / 40-frame 合成 MP4 data bytes，不是原站媒体。fal queue/download 仅注入固定实际灰度 MP4：用于合同、结果播放和归档验收，**不是推理深度质量证据**。

1. 新 session 点击“创建普通视频生成节点”。该按钮只调用正式 `addConnectionNode` 创建目标和 incoming edge，保留 Seedance 模型及非空旧提示词。
2. 用目标底部正式模型菜单选择 Depth Anything Video，核对旧 prompt 清空、只读占位、语音锁定、规格自动和数量 1/2。不要用 Agent 的“确认已查看并转换”代替普通入口验收。
3. 使用正式数量菜单选择 2，用正式“生成”按钮提交。审计应记录 `targetId !== inputId`、完整 MP4 和单一源视频，后端供应商 POST 增加 2；variants 当前 target 应保留两个视频历史选项。
4. 使用现有画布结果布局切换 spread/pile，创建新的空 target 再提交 2，检查普通目标规划、完整结果和两份归档。结果模式与已存在来源的行为以主任务共享接线为准。
5. “切换节点结果保存失败”打开后再提交；真实 CanvasStore 对结果快照保存报错。关闭开关，再点击正式任务托盘“重试应用结果”；不得重复供应商 POST 或重复结果节点。
6. 来源变化、配置延迟、取消与缺配置可在此隔离 session 验证；不得迁移真实账号或私人库数据。
7. 刷新复核 durable 来源、结果、历史/节点数与 migration diagnostics；测试前保存失败开关必须关闭。

新源文件加入后，应重启独立 native server：它在启动时快照 publicFiles 白名单，旧进程不会自动允许新增 `composer.mjs`。浏览器 CUA 与共享链路最终验收由主任务执行，已通过的结果见下方记录。

本轮新隔离入口：<http://127.0.0.1:60635/src/features/video-depth/qa/main.html?mode=pipeline&session=depth-native-1005k-root1>。PID `61342`，exec session `86867`；共享模块 GET 200，真实 routed profile `maxCount:2`。启动检查包括 HTTP 可达与配置检查；后续正式浏览器行为核验见下方记录。该地址为已结束的隔离验收服务，停服记录见下方。

### 首次正式模型选择 CUA 修复

主任务真实浏览器选择 Depth 后发现页脚中途抛错：深度分支的 `videoData` 为 `false`，`videoData?.options.supportsAudio` 未保护 `options`，导致后续语音/数量/生成控件和关闭菜单未执行。已改为 `videoData?.options?.supportsAudio`。新增 `qa/footer.test.cjs` 用实际 `refreshFooter` 函数与真实 depth/video settings 重现旧异常，并验证完整修复后页脚到达数量/生成控件，定向 1/1 通过。

QA 同时监听真实正式模型条目选择后的 DOM，审计 `depthModelSelectionAudit` 检查完整五控件、提示词只读、语音禁用和模型弹层关闭；这是生产页面实际 DOM 校验，需重载并用正式菜单选择 Depth 触发。首次 CUA 异常已记录，主任务已完成修复后正式模型选择复验。

## 正式入口浏览器核验（主任务 CUA）

2026-10-05，独立 native QA 页使用正式生产 UI 完成：

- 正式 Depth 模型切换不再抛错，菜单可关闭；提示词清空并只读、语音按钮禁用；规格弹层显示“视频编辑”与比例/清晰度/时长“自动”；数量菜单保留 1/2。
- 数量 2 正式生成成功，variants 在当前视频 target 的历史中保留两个版本，source 与 target 独立。
- 第二次双结果生成强制真实 CanvasStore 保存失败：任务已生成成功、`applied:false`；关闭故障后点击正式任务托盘“重试应用结果”，当前 target 保存两批、每批两个版本。重试没有新增 gateway POST 或原生供应商任务。
- 正式“个人账号 → 账户管理 → 画布设置”切换为铺开布局，对已有视频 target 再生成 2：原 target 保留，新增两个独立结果节点，真实 incoming source edges 保留。
- 三次正式生成合计 6 次供应商 POST；应用重试增加 0 次。夹具每次供应商 POST 分配独立 request ID，两个结果并非前端复制同一条回执。
- 有效刷新证据来自主任务 PW `reload`（wrapper.reload 那次没有重启，不计入验证）：页面会话 `posts:0`、jobs 空；持久画布仍为四节点（来源、原 target、铺开两个结果）。原 target 的两批、每批两个历史版本完整保留。
- 真实 MP4 为 64×48、2 秒，浏览器 `readyState:4`；完整预览的正式“播放”操作后变为“暂停”；播放结束时 DOM 视频 `currentTime=duration=2`、`ended:true`，实测视频宽高仍为 64×48。

截图：[视频节点历史与持久恢复](screenshots/video-depth-node-history-20261005.jpg)。

本轮没有再运行 pile 布局浏览器操作；其边界以已通过的结果规划/应用专项为准。以上核验均使用实际合成灰度 MP4、生产 gateway、编码验证和归档，并未调用真实付费模型，也不证明模型推理质量或参考站供应商效果。验证完成后按主任务指令停止隔离服务，未由本子任务提交 Git。

### 隔离服务清理

主任务确认播放结束后，本子任务向自己启动的 PID `61342` 发送 SIGTERM，沿 native server 原有 `close()` 关闭 server/gateway 并清理所属临时目录。exec session `86867` 返回 exit 0；PID 已退出、60635 无监听，唯一 `freenow-depth-native-qa-*` 临时目录已移除。未操作主服务 4173，也未提交 Git。
