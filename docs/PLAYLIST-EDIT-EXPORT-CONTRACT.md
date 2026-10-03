# 播放列表编辑与导出

官方说明：[使用播放列表](https://docs.tapnow.ai/zh/docs/canvas/use-playlists)。本轮补齐播放头快捷键、原始素材去重与异步导出保护，沿用现有本机 FFmpeg 服务，不增加依赖。

## 编辑

- `C`：在当前播放头切割定位到的片段，两侧均至少 1 秒。
- `Q`：裁掉当前片段在播放头左侧的部分，保留正确源视频 offset；剩余至少 1 秒。播放头移到该片段的新起点。
- `E`：裁掉当前片段在播放头右侧的部分；剩余至少 1 秒。
- 每次实际操作只调用一次 `CanvasApp.updateNode`，共享原画布的撤销与保存路径。
- 快捷键属于时间线预览、时间线片段，或单选时间线的画布焦点。输入框、文本编辑、滑块、菜单、模态对话框、IME、组合键和重复键不接管。

纯逻辑位于 `canvas-playlist.js` 的 `trimAt`、`cut`；页面通过 `CanvasPlaylist.editAt(id,'c'|'q'|'e')` 执行。

## 导出

原始片段按时间线首次出现顺序，以原媒体 URL 去重。切割或不同裁剪区间引用相同原文件时，只读取及归档一次完整原文件；ZIP 文件编号连续，与首次出现顺序一致。

合并仍按全部片段的实际顺序和 `trimStart/duration` 提交。重复引用的源媒体只读取、转换一次，独立时间范围不会合并或丢失。`/api/media/playlist` 使用现有本机 FFmpeg 解码、规格统一和串联合并；服务只接收上传字节。

每条时间线同时只允许一个原始下载、合并或提取操作。重复调用明确拒绝。操作捕获页面项目 ID 与片段媒体、源节点、源时长、裁剪范围、标题/封面快照，读取完成、转换完成、FFmpeg 返回及输出提交前核对。来源改动、删除或项目变化后，不下载迟到结果、不创建画布节点。

取消及 pagehide 中止网络；最终 FileReader 转换迟到也不能应用。项目导航守卫在处理中提示等待或取消。仅来源仍一致时，导出到画布才调用现有 `createConnected`，保留原撤销与保存行为。

媒体读取复用原站显示策略并限制同源、`data:`、`blob:`；合法 `asset:` 会先解析到本机 Blob。未知外部原地址保留而不访问。添加片段也核对目标时间线与源视频/源播放列表在异步读取期间未变化。

## 验证

```bash
node --test tests/playlist-edit-export-contract.test.cjs
node --test tests/playlist.test.cjs tests/canvas-playlist-render-performance.test.cjs tests/playlist-search-dismissal.test.cjs
```

专项覆盖：offset/最短片段、单次撤销、快捷键归属、原始顺序去重、合并请求快照、重复点击、源改删/切项目、取消/页面离开迟到转换、提取保护、追加来源变化与外部媒体不请求。

## 实际视频 QA

```bash
node scripts/create-playlist-contract-qa.cjs
```

访问 `/qa/playlist-contract.html?session=playlist-review`。生成器使用当前 `index.html` 壳，加载可跟踪的 `src/features/canvas-playlist/qa/fixture.js`、`controls.mjs`，生成的 HTML 与红/蓝二进制视频不必入 Git。FFmpeg 生成两个 320×180、H264、8 秒的红/蓝测试视频，明确标注不是模型结果。默认时间线为红 `[1,5]` → 蓝 `[2,5]` → 红 `[5,7]`，总计 9 秒。

页面 UI 偏好使用独立内存 Map，即使本机 localStorage 满也能启动。画布及素材仍写 `qa-playlist-contract:<session>:` 下的独立 IndexedDB，刷新可回读；不删除或修改用户、旧 QA 存储。

通过“预览并定位 2 秒”聚焦画布，再实际按 `C/Q/E`；验证一次撤销和保存回读。用真实导出按钮检查红蓝帧顺序、原始 ZIP 只有两个文件，并刷新验证。可先选“下一次合并延迟 6 秒”，在真实 FFmpeg 完成而响应延迟期间取消，验证迟到结果不写画布。

自动检查及 ffprobe 只证明逻辑、容器与时长；实际播放、图像内容、下载及刷新结果以浏览器 QA 为准。

## 2026-10-03 浏览器验收记录

Root 使用隔离页面 `?session=local-workflow-1003` 实际操作并检查下载文件：

- `C` 在 2 秒把第一个红色片段切成源 `[1,3]` 与 `[3,5]`；`Q` 得到源 start=3、duration=2；`E` 得到源 start=1、duration=2。每次只需一次撤销即恢复原 3 个片段。0.5 秒处 `C` 未增加撤销记录。
- 原始 ZIP 实际保存到 `/Users/laplace/Downloads/QA 红蓝时间线 · 非模型-原始片段.zip`，仅有红、蓝两个成员；每个文件的 SHA 与源 MP4 一致。
- 真实 FFmpeg 响应延迟 6 秒期间取消；迟到响应后合并节点数量仍为 0。下一次合并成功，新增节点 1、撤销记录增加 1。
- 合并预览实际检查 0 秒红、5 秒蓝、8 秒红，并点击播放。导出的实际 MP4 经 ffprobe 确认为 H264/AAC、1280×720、9.021333 秒；刷新后合并节点保留。
- 截图证据：`/tmp/freenow-playlist-merged-red-20261003.png`、`/tmp/freenow-playlist-merged-blue-20261003.png`、`/tmp/freenow-playlist-merged-tail-20261003.png`。

独立只读审查确认键盘归属、源/项目迟到保护、提取前守卫；发现追加来源播放列表在等待期间变化时缺少检查，已补 clip 字段快照与按值捕获的 sourceType，专属回归通过。没有据此宣称全部像素、音质或大文件性能已验收。

追加问题的状态：实现与专属回归已闭合；审查者最后已交付结论仍记录修复前复现，未取得修复后的独立复验结果。本次收口遵照不再运行测试的要求，仅记录该验证边界。
