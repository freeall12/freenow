# 视频历史真实本地媒体隔离 QA

入口：`/src/features/video-history/qa/history-main.html?session=video-history-live-1003`。

生成器从当前生产 `index.html` 复制主壳，追加本目录的 fixture / controls；正式 `src/features/video-history/ui.mjs`、CanvasApp、CanvasStore、LocalAssets、菜单及帮助 dialog 均使用生产代码。页面不含自动点击流程。开发者未操作浏览器；以下是待主任务执行的验收步骤。

```sh
node src/features/video-history/qa/generate-history-app.cjs
```

生成器使用本机已有 FFmpeg（可通过 `FFMPEG_PATH` / `FFPROBE_PATH` 指定），生成三段 4 秒 H.264 / yuv420p MP4 及第一帧 PNG：横 320×180、竖 180×320、方 256×256。素材仅为 lavfi 色块和 drawbox，无私人资产、原站资源或模型请求。`media-manifest.json` 来自真实 ffprobe，文件存在时不重新编码。文件解码或元数据检查不代表浏览器播放验收完成。

fixture 在所有生产脚本前设置 `qa-video-history:<session>:canvas/assets` 两个独立真实 IndexedDB；UI preferences 使用内存。主图及历史初始数据为空，数据脚本改用公开 defaults，避免读取开发机个人画布。CSP 和请求 guard 只允许同源/blob/data；generation/agent config 返回明确未配置，其余 API、外部 fetch/XHR/WebSocket/EventSource/beacon 被阻止并记录。CSP 的 `wasm-unsafe-eval` 仅支持生产 Three 模块导入时的本机 WASM，不允许 JavaScript `unsafe-eval`。

## 手动验收

1. 点击「导入合成 MP4 / PNG 并保存」。真实文件通过 `LocalAssets.put(Blob)` 保存；首批含横/竖/方/横重复四项，第二批含方/竖两项。历史 options 初始不提供 resolution/duration，让真实 `loadedmetadata` 驱动生产预览。节点主图已有横片尺寸。导入后记录 `agent-video-history-qa-fixture` 保存 refs、源尺寸、字节及 SHA-256；重复导入按钮保留已有节点。
2. 点击节点的正式历史版本标记，或「打开正式视频历史」。第一项设置唯一坏路径 `deliberately-missing-preview.mp4`，其真实媒体 error 必须回退同项 `asset:` 原视频。确认红/绿/蓝画面、MP4 metadata、播放状态及 `blob:` poster/currentSrc。QA 不派发错误事件、不替换媒体实现。
3. 查看诊断 `cards` 的 style / screen geometry、videoWidth/videoHeight/duration/currentTime、paused/readyState；`mediaEvents` 保留真实 error → src 变更 → metadata / playing，`urlCalls` 保留真实 LocalAssets.url 返回值。混合比例使用生产的首项 cell 网格与每项实际尺寸；诊断不另行重排，也不假设所有卡片等高或绝无视觉溢出。
4. 切换正式批次，用左右箭头/Home/End 检查焦点与批次；点击真实卡片「设为主图」，核对 currentVideoOptionId、主 video/image、尺寸及视频元数据。用「保存并读取真实 IDB」比较 `node/savedNode`，然后「保存后刷新页面」，确认相同 session 仍是原节点及 refs。刷新不会自动重新导入或打开历史。
5. 刷新后点击「核对 6 个 asset 字节」，真实 LocalAssets.url → blob fetch 的类型、尺寸及 SHA-256 应与导入源一致。它只读取隔离 assets；不能代替播放、poster 解码或生产下载验收。
6. 历史打开时点击「打开原生帮助 modal」，检查 modal 内及外侧 pointer/Escape 先交给原生 dialog，历史 activeId 保留。再用「回焦正式历史」发出 Escape，核对历史关闭、owner inert=false、焦点回到正式历史版本按钮。QA 面板本身使用生产 `floating-panel` 输入边界，读取诊断按钮不应自动关闭历史。
7. 打开历史再点「打开正式节点菜单」。这是生产 CanvasMenus.node，测试菜单内、Escape 及菜单外 pointer 的优先关闭行为；再从真实画布空白 pointer 验证历史关闭。`inputEvents` 只记录真实事件及事件处理后的 activeId/defaultPrevented，不自动触发输入。
8. 关闭历史，点击「下一次历史解析延迟 3 秒」再重新打开并快速关闭。此按钮在接下来 10 秒内对本 fixture refs 的真实 LocalAssets.url 结果等待 3 秒，底层仍实际读 IDB。等结果返回后核对 `detachedMedia` 无迟到 src/poster、paused=true，activeId 仍空。延迟不改变结果内容，不模拟成功。直接媒体 DOM mutations、metadata 和播放状态持续只读记录。

`window.VideoHistoryQA.read()` / `.refresh()` 返回相同诊断；`.saveReadback()` 仅调用正式保存/flush/load。读诊断是 fixture instrumentation，不是实际交互或通过结论。开发只做生成、真实文件 ffprobe/解码、语法和静态合同检查；最终结果必须由主任务实际浏览器点击、画面与诊断确认。
