# 图片本地修复、播放列表与生成预检

2026-10-03。本批延续完全本地化目标，未替换最终品牌，未调用真实生成模型。

## 已交付

- 旧图片节点新增「导入本地图片」正式入口。PNG/JPEG/WebP 经真实解码、尺寸/容量限制、SHA 与本地 Blob 回读校验后，替换所选节点的旧 image/fullImage。位置、节点身份、连线与来源日志保留；新主图标记为用户导入，支持单步撤销。保存失败明确保留未确认状态，可只重试保存。
- 画布节点能解析持久 asset 引用，加载失败尝试合法本地缩略图；节点重建/撤销/删除后拒绝迟到图片。
- 对照官方播放列表说明补齐 C/Q/E、1 秒限制、原始源文件按首次出现去重、合并复用源字节。导出/提取按时间线互斥，并检查异步来源/项目变化与取消；追加来源时间线也有快照保护。
- 生成预检按当前操作和公开模型映射给出具体错误及可用别名，在媒体读取、占位与派发之前停止无效请求。操作级 availability 与实际提交分别校验，不把 OpenAI 图片参考能力表冒充完整型号目录。

## 实际浏览器证据

1. 正式画布隔离页通过真实 filechooser 导入 200×200、15288 字节 PNG。实际 CanvasStore 回读 image/fullImage 为同一 asset；另节点与来源日志不变。刷新真实图片仍解码 200×200，撤销恢复待导入，重做恢复图片。
2. 正式播放列表按键：C 分为两个正确 offset 的片段，Q/E 分别裁当前片段左右侧；每次仅一个 undo。0.5 秒切割不改图。
3. 浏览器下载的原始 ZIP 仅含两份红/蓝视频，逐文件 SHA 与本机源视频一致；重复红源未重复归档。
4. 本机 FFmpeg 合并取消后没有结果节点；下一次合并得到一个结果节点。实际预览检查 0 秒红、5 秒蓝、8 秒红并播放，刷新结果仍保留。下载 MP4 实际为 H264/AAC、1280×720、9.021333 秒。这是合成红/蓝验收素材，不是模型生成质量证据。
5. 正式 Seedance 2.0 节点在合成 Ark 配置仅映射 2.5 时，显示具体 GENERATION_MODEL_MAP 提示与可用 seedance-2.5。真实 TaskService 状态 configuration_required，providerDispatched=false；QA POST/媒体读取/占位均为 0，没有真实 Key 或外部调用。

截图：`/tmp/freenow-node-image-repair-main-20261003.png`、`/tmp/freenow-playlist-merged-red-20261003.png`、`/tmp/freenow-playlist-merged-blue-20261003.png`、`/tmp/freenow-playlist-merged-tail-20261003.png`、`/tmp/freenow-direct-provider-readiness-20261003.png`。

## 检查与边界

各作者运行各自定向检查，不重复全量：图片显示 3 项；图片修复初始 6 项及审查修复 1 项；播放列表新增 8 项及追加来源回归 1 项、相关既有 18 项；生成配置 18 项及后续自定义操作边界 1 项。交叉审查复验了图片保存期间失效/撤销、幂等保存与时间线来源切换。root 另执行实际入口操作与下载检查。

本机长期 QA 的 localStorage 配额已满，新验收页改用内存偏好，实际图与素材仍写独立 IndexedDB；没有删除用户或旧 QA 数据。产品大容量存储与所有场景性能不是本批完成声明。

仍开放：92 份精确模板正文、SPZ 渲染、全站所有按钮/hover/坐标与大媒体组合、真实供应商 Key 联调、最终 freenow 品牌及输出水印验收。人工导入是用户替换，不声称恢复了未取得的官方原件；本批没有任意历史/App state 通用修复。

相关模块与详情：[图片修复](NODE-IMAGE-REPAIR.md)、[播放列表](PLAYLIST-EDIT-EXPORT-CONTRACT.md)、[生成预检](GENERATION-PREFLIGHT-READINESS-20261003.md)。
