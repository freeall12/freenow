# 视频历史本地媒体与交互复验

本批只修改 `video-history-ui.mjs`，不改历史持久化契约、生成接口、世界坐标、撤销记录或现有媒体。页面上的元数据读取只更新 `core.batches` 克隆出的临时选项，明确选择主图后才提交节点变更。

## 官方依据与实现

官方捕获 `reference/vendor-pkg-canvas-Bx0RCmle.js`：`yJ`（字符偏移 1639288）视频小预览加载失败回退原视频；`iT`（1644643）传递各项 `itemDimensionsByItem` 与固定 `cellDimensions`；`kJ`（1685418）生成每项尺寸和首项网格。因此本地保持首项网格位置与 16 世界单位间距，同时每张卡片使用自己的实际比例，不额外创造避让布局。

- 视频首载、失败回退、重试与 poster 均经 `LocalAssets.url`；解析前后均复用 `display-media.mjs` 原站域名策略。原站预览不可用且原视频已本地化时直接回退原视频；没有可用原视频时显示可重试的真实错误。
- 解析完成、metadata 到达前检查活动实例、批次实例及旧 video 是否仍连接。换批次和关闭清理错误/metadata/timeupdate 回调、src、poster；迟到结果不更新替代画廊或已关闭节点。
- 只有原视频 metadata 才能更新原选项宽、高、时长。小预览已知比例供临时布局使用，不覆盖原视频像素或时长；缺失的原视频 metadata 保持未知。
- 错误覆盖层复用官方 `yJ` 的 click 阻止冒泡，不会通过底层卡片点击把加载失败的视频设为主图。
- 首项尺寸决定 grid，所有项尺寸决定各自卡片；任意项原视频 metadata 到达都更新布局，保留小数世界坐标。
- 复用现有 sidebar/pile/node-action 的关闭规则：原生 dialog、活动上层菜单和 Agent 所在交互先处理事件；IME、已消费事件和无关文本输入不穿透。Escape 回历史按钮焦点，空画布 outside 关闭，历史内部点击保持。

## 已验证

一次聚焦组合：`node --test tests/video-history-runtime.test.cjs tests/media-history-render.test.cjs tests/video-history.test.cjs`，21 项通过。独立交叉审核随后指出小预览 metadata 可能污染原源分辨率、错误层点击可能冒泡选择失败的视频，本批已修复并增加真实生产 `card.onclick → setMain` 与 DOM 父链冒泡回归；受影响专项 `node --test tests/video-history-runtime.test.cjs` 最终 9 项通过，`node --check video-history-ui.mjs` 通过。

专项覆盖混合横/竖/方尺寸、首项小数 cell、原站媒体及 resolver redirect 阻止、asset poster/回退/重试、换批次/关闭后迟到解析和 metadata、主图保留原源分辨率、未知元数据不伪造、上层 dialog/菜单/Agent/IME、outside 与 Escape 回焦。VM 测试运行实际模块，不代表原生浏览器媒体播放或 Computer Use 已通过。

## Computer Use 入口

独立主壳 QA 已落地：`/src/features/video-history/qa/history-main.html?session=video-history-live-1003`。该入口隔离 CanvasStore 和 LocalAssets IndexedDB，使用真实本地 MP4/PNG，不在用户画布注入虚构模型结果。验收包括真实 poster/loadedmetadata/playable、坏 preview 回退本地原视频、混合画幅、批次切换、帮助 dialog Escape、节点菜单 Escape、关闭后尺寸和焦点、保存/刷新恢复；结果见下节。

## 主任务实机证据与冻结

主任务已在上述隔离主壳以 Computer Use 完成 `video-history-live-1003` 会话验收，使用真实红色 320×180、绿色 180×320、蓝色 256×256 的 4 秒 MP4 和 PNG，导入 LocalAssets 与隔离 IndexedDB。以下为主任务回报的原生浏览器证据，本实现智能体未重复操作浏览器：

- 首预览产生真实 404/error 后回退到本地 blob 原片；所有播放器 readyState 为 4、currentTime 大于 0，poster 均为本地 blob。
- 首批卡片实际尺寸为 220×123.75、220×391.111、220×220；第二批方版与竖版尺寸正确，旧批次播放器释放。
- 帮助 modal 的原生 Escape 只关闭 modal，历史保留；节点菜单 Escape 只关闭菜单，历史保留；历史自身 Escape 关闭后焦点回到“历史版本 6”，播放器 src 全部清除。
- 收起 QA 面板后点击空白正常关闭。未收起时坐标 `(950,440)` 命中 QA 面板，不能计作画布 outside 失败。
- 设竖版主图、保存并刷新后恢复同一 `asset:cdeedcfb-a957-4311-a398-dc5ab3faac5b`；元数据为 180×320、4 秒，节点尺寸为 220×391.1111111；撤销记录共 2 项，对应导入与一次设主图。
- 在真实 LocalAssets 解析延迟 3 秒的情况下先关闭历史，之后 active 保持 null，已分离播放器无 src，历史未复活。

实机截图：`/tmp/freenow-video-history-local-20261003.png`。独立审核的 preview-metadata 与 error-click 两个原始反例均已复验闭合，本批未留下可复现 P1/P2。本批到此冻结，不扩大为整个画布或 Agent 的完整验收结论。
