# Sonilo Music 原生前端与离线 QA

正式 `audio-ui.js` 的 Sonilo Music 场景接入 `sonilo-native` 公共配置，保留公开目录、按钮和菜单。Sonilo SFX 的 ThinkSound 显式替代继续使用独立协议。

- 文字音乐：5–360 整数秒，描述 1–1000 字符。
- 视频音乐：一个完整 MP4，读取真实时长并精确保留，5–360 秒、50,000,000 字节内；可省略描述。先物化参考选区，不会使用整片代替 `clip`、`trim`、`sourceClip` 或来源 `segments`。
- 数量：`count` 保留为单次任务的 1–10 个 WAV 变体，多个计数声明必须一致。
- 音乐分段：`parameters.segments` / Agent `segments` 为 1–30 个 `{start,prompt,label?}`；首段起点 0，相邻至少间隔 5 秒，最后保留至少 5 秒。分段描述 1–200 字符，标签使用官方枚举。来源节点的选区元数据与音乐分段参数分别校验。
- 明确 Agent 设置及源节点参数不会被悄悄删除后提交；不支持的指令、时长冲突、配置缺失及来源/项目漂移会拒绝准备请求。

```bash
node scripts/qa-sonilo-native.cjs
```

脚本输出隔离本机 URL、audit URL 与临时数据目录。它使用正式画布、AudioAPI、Agent 确认卡、持久 generation gateway 和媒体存储；读取仓库的真实 8 秒合成 MP4。供应商 HTTP fixture 验证 multipart 恰一个 `video` 且原字节相等，返回 async `task_id`，只允许 GET 原 ID，输出同长 PCM16 固定正弦波 WAV。`soniloDownloadImpl` 是该进程的显式媒体测试接口；供应商标识 URL 只映射到隔离 loopback。浏览器 CSP 限制外网。

它不读取私人 `.env`、不使用真实 Key、不调用模型，不证明 Sonilo 账号权限、音乐质量或供应商生产行为。

多变体会完整保存在节点的 `options` / `audioResultMetadata` / `audioHistory` 中，当前播放器默认展示首项，`resultIds` 仅指这个原位音频节点。访问第二项请打开左侧“历史”→“音频”，预览该任务第二条结果；点击该条主缩略图可将保存的音频作为独立节点应用到画布，也可选择两条一起导入。这些操作不会提交新供应商任务；当前没有音频节点内的变体切换控件。

正式 UI 检查顺序：

1. 点击面板“创建视频→音乐节点”，在正式音频参数区核对 Sonilo Music / 音乐 / 跟随视频；点击正式“生成音频”，核对 WAV 可播放及本地结果。
2. 面板“2个变体+分段”后再生成；audit 应有一次 POST、`count:2`、完整 `segments`、`originalBytesEqual:true`；本机任务应保存两项音频结果。固定 fixture 输出相同字节可能被媒体存储去重，结果项仍应保留两项。
3. “Agent默认跟随8秒”打开正式卡。确认后请求必须跟随视频；“Agent明确5秒”批准前须显示“明确指定 5 秒；提交前须与源视频实测时长一致”，确认后必须在准备阶段拒绝、无新增供应商 POST；取消卡片也无新增 POST。
4. “缺Key”/“缺路由”/“未物化选区”须禁止正式生成；“恢复配置”/“清除选区”恢复可操作状态。
5. “文字音乐10秒”移除视频引用与边，使用两个 5 秒音乐分段、两个变体；请求须走 `/v1/text-to-music`。
6. “重开gateway”复用临时任务与媒体目录；刷新页面后查询原任务、播放原素材，audit 的提交数量不得增加。本批只验已完成任务的同 store 重开与原 ID 查询，不据此声称运行中任务恢复或进程崩溃恢复。

```bash
node --test tests/sonilo-audio-native-ui.test.cjs tests/audio.test.cjs tests/agent-audio-video-duration.test.cjs tests/audio-video-native-profile.test.cjs tests/audio-native-profile.test.cjs
```

该聚焦回归已通过 35 项；随后仅补跑一项审批可见性新回归，验证视频及文字卡均显示实际数量、每变体计费、精确分段 start / prompt / label（默认展开，保留换行），也覆盖源 `times` 数量声明。新增 UI 回归使用显式模拟的视频 metadata/FileReader，以及正式 Agent card 的 DOM；它不能代替浏览器媒体解码验收。HTTP smoke 已核对真实 MP4 原字节上传、两个 8 秒本地 WAV、重开 gateway 后同 ID 完成状态与零重复 POST。

Agent 停止守卫：正式 `agent-client.js` 音频分支在 `AudioAPI.buildRequest` 前后检查当前执行的 `signal`。准备前已停止则不读取媒体；准备期间停止则抛出现有 `AbortError`，不会调用 `GenerationAPI.submit`。媒体准备本身可能继续完成，但该准备结果不能继续付费提交。定向回归：`node --test tests/agent-audio-submit-cancellation.test.cjs`。


## 最终本地浏览器验收（root，2026-10-05）

使用正式画布、普通音频 Generate、正式 Agent 确认卡、历史面板及原生音频播放完成以下验证。去敏原始回执见 [local-browser-evidence.json](research/sonilo-native-20261005/local-browser-evidence.json)。供应商 HTTP baseline 为 `fixture-sonilo-1`；后续浏览器请求记录如下。

| 路径 | 实际结果 | 供应商提交计数 |
| --- | --- | --- |
| 普通视频音乐 Generate | `fixture-sonilo-2`：8 秒 MP4、9,865 原字节恰一个 multipart video；`count:2`，分段 `0 / intro / 轻柔吉他`；两个 WAV 均保存，来源节点默认首项实际播放至 8 秒 ended / readyState 4 | 2（含 baseline 1） |
| Agent 默认视频时长确认 | `fixture-sonilo-3`：同样保留两个变体与分段，跟随真实 8 秒源视频；应用并保存成功，前端任务 `63c54905…`、来源节点 `ec30a25d…` | 3 |
| Agent 取消及明确时长冲突 | 取消没有提交；明确 5 秒请求在准备阶段以“与真实源视频不一致”拒绝，零 POST。最新页面重新加载后，批准前准确显示“明确指定 5 秒；提交前须与源视频实测时长一致”，再次取消没有提交 | 3 |
| 第二变体历史访问 | “历史”→“音频”显示 4 条浏览器结果；实际预览 `63c54905-1e55-49c1-b6d2-7de1fa588015:1`，播放至 8 秒 ended / readyState 4。Escape 关闭后焦点回原预览按钮；第二项可应用为独立音频节点 | 3 |
| 配置与来源守卫 | 缺 Key、缺路由、未物化 clip 三种状态均实际禁用正式 Generate | 3 |
| 普通文字音乐 Generate | `fixture-sonilo-4`：无 video，10 秒，`count:2`，完整分段 `0 / intro / 铺垫` 与 `5 / verse / 主旋律`；生成应用并保存成功，实际播放至 10 秒 ended / readyState 4 | 4 |
| 同 store 重开与页面刷新 | “重开gateway”后重载保留 3 个画布节点、10 秒及 8 秒音频；10 秒素材重新播放进度大于 0。显式 HTTP GET 四个原持久 UUID 均返回 succeeded / outputs 2 | 4，无重复 POST |

两条 fixture 变体返回相同 WAV 字节，因此媒体存储可以合并同内容 URL；两条历史输出 ID 与所有结果项仍完整保留。这项验证证明保存、第二结果访问和本地播放，不证明两种不同音乐内容。

截图：

- [正式 Agent 原生审批](screenshots/sonilo-agent-native-approval-20261005.jpg)
- [明确视频音乐时长](screenshots/sonilo-agent-explicit-duration-20261005.jpg)
- [本地文字音乐结果](screenshots/sonilo-text-music-local-20261005.jpg)

验证边界：这里重开的是 gateway 对象并复用同一个 store；没有进程崩溃实验，也没有运行中远端任务恢复实验。该 QA 进程在最终共享公共错误回执及 optional-metadata 修复之前加载；这些后续修复由独立定向回归验证，不能把当前浏览器记录视为修复后的生产服务重跑。

后续专项验证分别为 root 公共错误回执 **2/2**、正式 Agent 音频取消分支 **1/1**，均经独立审阅通过；没有将它们累加成整套音频回归重跑。全批使用合成回执和固定正弦波，不涉及真实 Key、模型调用或音乐质量验收。


补充截图复验：原 `127.0.0.1` origin 的 `cssVisualViewport.zoom=0.33`，因此最终两张 Agent 卡截图在同服务 `localhost` 的独立 origin（zoom=1，1280×720视口）重新实拍。仅创建公开8秒源、设置两个变体/分段、打开并取消默认及明确5秒卡，没有新增生成。文字音乐完成截图保留原33%缩放，作为流程证据，不作为像素等效证据；没有改变用户浏览器缩放设置或页面样式。
