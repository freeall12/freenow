# freenow 功能与供应商适配器

freenow 是本地 AI 创作工作台（AI infinite canvas）。本文说明已有功能与独立供应商的接入边界；快速启动见[中文首页](../README.md)或[English README](../README.en.md)。

## 使用方式

1. 在无限画布导入文本、图片、视频、音频或 3D 资源，连接相关节点。
2. 通过图片图层、音视频工具或 3D 片场编辑本地素材；使用需要 FFmpeg 的处理前先配置工具路径。
3. 需要生成时配置该操作对应的供应商；需要 Agent 时另行配置 Responses API 模型。
4. 检查任务回执与实际媒体，将结果应用到画布并保存；刷新后的继续操作查询原任务。

## 功能与验证边界

| 功能 | 已接入行为 | 证据与边界 |
| --- | --- | --- |
| 无限画布 | 项目、平移缩放、节点连接、搜索、分组、堆叠、自动布局、复制粘贴与撤销重做 | [画布项目](CANVAS-PROJECTS.md)、[复制粘贴](CANVAS-GROUP-COPY-PASTE-20261005.md)；逐态视觉与性能验收仍开放 |
| 文本与图片 | Tiptap 富文本/Markdown、Fabric 图层/画笔、裁剪、变换、蒙版、版本与导出 | [图层菜单](IMAGE-EDITOR-LAYER-MENU-20261005.md)、[图片吸附](IMAGE-EDITOR-ALIGNMENT-GUIDES-20261005.md)；AI 处理另需供应商 |
| 视频与音频 | 导入/播放、波形、取帧、裁切、播放列表、字幕、历史与本地结果归档 | [本机剪辑](VIDEO-TRIM-RESULT-RECOVERY-20261003.md)、[音频与恢复](LOCAL-AUDIO-AND-WORKFLOW-RECOVERY-20261003.md)；部分处理需 FFmpeg |
| 3D 片场 | Three.js、GLB、SPZ Gaussian Splatting、原生 LOD、对象/相机变换、运镜、照片与短视频、保存恢复 | [SPZ 渲染](SPZ-LOCAL-RENDERING-20261005.md)、[LOD](SPZ-LOD-20261005.md)、[GLB 导出](STUDIO-V2-SCENE-EXPORT-20261003.md)；高斯场景不能完整导出为 GLB，跨设备与长视频未验 |
| Agent | 工具循环、画布/片场控制、技能、附件、创作应用、只读子任务/DAG 编排 | [接口](AGENT-API.md)、[工作流目录](AGENT-WORKFLOW-INVENTORY-20261003.md)；22 个版本 URI / 20 个功能族是登记范围，不是验收率 |
| 工作流与恢复 | 分组依赖执行、持久回执、原任务查询、显式继续、来源与项目归属保护 | [预检](GENERATION-PREFLIGHT-READINESS-20261003.md)、[恢复](LOCAL-RECOVERY-AND-INTERACTIONS-20261003.md)；未知状态不自动重新提交 |

Sonilo Music、Product Kit 与导演批注的本地验证见[整批证据](LOCAL-SONILO-AGENT-AND-HISTORY-20261005.md)。固定音频/模拟响应证明本机调用、保存和播放，不能证明真实供应商生成质量。

**本批专项验收完成：** Sonilo SFX 原生接入通过 20 项定向检查与 4 项受影响 Music 回归，SFX 本批浏览器操作已验。Agent 调色本轮 10 项 runtime/派生回归及保存、交接重试、实际 PNG、刷新重开通过；macOS ARM64 安装包已通过文件、包内后台、原生 WebGL 与片场退出重开恢复验证，[Alpha 预发布已公开](https://github.com/freeall12/freenow/releases/tag/v0.1.0-alpha.1)。专项完成不等于全站或真实供应商 Key/质量验收完成。见[SFX 合同](SONILO-SFX-NATIVE-20261005.md)、[SFX UI 记录](SONILO-SFX-UI-QA-20261005.md)、[调色交互](AGENT-COLOR-ADJUST-INTERACTIONS-20261005.md)和[当前状态](STATUS.md)。

## 独立供应商适配器

下表保留此前首页的详细适配器目录。这里的“接入”指本仓库存在协议与路由实现；真实 Key、账号资格、线上输出及质量需要分别验收。未配置供应商时不会由菜单名称自动选择其他服务。

配置入口：[多供应商配置](MULTI-PROVIDER-SETUP.md) · [生成网关](GENERATION-GATEWAY.md) · [Agent 接口](AGENT-API.md)。

| 适配器 | 已接入用途 | 配置与限制 |
| --- | --- | --- |
| `openai-native` | 文本、文生图/参考图、语音、视觉识别与分镜描述 | [网关](GENERATION-GATEWAY.md) / [参考图](OPENAI-IMAGE-REFERENCES.md) |
| `openai-masked-edit-native` | 擦除、局部重绘、扩图 | [蒙版编辑](OPENAI-MASKED-EDIT-NATIVE.md) |
| `openai-relight-native` | 完整图片重新打光；面板与 Agent 共用全部五组参数 | [打光编辑](OPENAI-RELIGHT-NATIVE.md)，显式参数提示词编辑；不保证物理光照或输出与来源同尺寸 |
| `magnific-native` | Magnific Precision V2 完整图片放大、四参数面板与 Agent | [原生配置](MAGNIFIC-NATIVE-20261005.md)，本机原图直传；JPEG/WebP 结果需 FFmpeg，真实效果待 Key 验收 |
| `skin-tasks-v1` | 皮肤编辑三档、增强节点版本与 Agent 审批 | [专用网关](SKIN-EDITOR-PROVIDER-20261005.md)，需实际实现合同的外部服务器；不是 Enhancor 原生适配，仅填其 Key 不可用 |
| `ark-native` | 火山方舟视频任务 | [Ark](ARK-VIDEO.md) |
| `ark-video-extend-reference` | 工具栏延长镜头：片头/片尾、4–30秒、连续性与参考 | [延长镜头](VIDEO-EXTEND-NATIVE-20261005.md)，明确为参考生成；本地视频另需公网发布通道 |
| `ark-video-reshoot-edit` | 视频重拍：分镜、四种镜头模式与提示词编译 | [重拍](VIDEO-RESHOOT-EDIT-20261005.md)，实验性提示词模拟；Ark Key 外还需要独立 HTTPS 视频 |
| `fal-video-depth-native` | 普通视频节点与 Agent 视频深度转换 | [深度](VIDEO-DEPTH-NATIVE-20261005.md) / [节点入口](VIDEO-DEPTH-NODE-ENTRY-20261005.md)，完整 MP4、原尺寸/时长、1–2 个灰度结果；需 FFmpeg，支持多变体/铺开/堆叠 |
| `openai-panorama-edit-native` | 旧版 3D 片场全景局部编辑 | [局部编辑](OPENAI-PANORAMA-EDIT-NATIVE-20261005.md)，2048×1024 全景、可见凸四角选区；透视蒙版编辑后本地回投，硬边接缝与效果待验 |
| `fal-panorama-native` | 单张图片 → Hunyuan World Panorama | [全景](PANORAMA-NATIVE-20261005.md)，固定 2:1、单结果、原生尺寸；当前后端仅接受实际 PNG 像素，非区域编辑 |
| `minimax-native` | MiniMax H3 视频 | [H3](MINIMAX-H3-SETUP.md) |
| `minimax-music-native` | MiniMax Music 2.6 | [音乐](MINIMAX-MUSIC-NATIVE.md)，存在账号资格限制 |
| `elevenlabs-native` / `elevenlabs-sound-native` | TTS 与音效 | [TTS](ELEVENLABS-NATIVE-TTS.md) / [音效](ELEVENLABS-NATIVE-SOUND.md) |
| `elevenlabs-music-native` | Music 普通/纯音乐与单节自定义歌词 | [音乐](elevenlabs-music-native.md)，自定义歌词须明确3–120秒；节点目录上限300秒 |
| `mureka-native` | Mureka 8 / O2 自动与自定义歌词歌曲 | [Mureka](MUREKA-NATIVE-20261005.md)，精确型号、原任务查询与本地音频归档 |
| `seed-audio-native` | Seed Audio 1.0 多模态音频及字幕文本 | [Seed Audio](SEED-AUDIO-NATIVE-20261005.md)，独立语音 Key；Ogg Opus 仅48kHz |
| `sonilo-native` | Sonilo Music：视频音乐、文字分段音乐和 1–10 个 WAV 变体 | [原生协议](SONILO-NATIVE-20261005.md) / [前端验收](SONILO-NATIVE-UI-QA-20261005.md)，本地 MP4 直传；需独立 Sonilo Key 和 FFmpeg，每个变体计费 |
| `sonilo-native`（SFX 显式绑定） | Sonilo 原生文字音效 / 完整视频音效，单个 WAV，可含连续视频分段 | [SFX 合同](SONILO-SFX-NATIVE-20261005.md) / [UI 接线](SONILO-SFX-UI-QA-20261005.md)，仅 `Sound` / `sonilo-sfx`；不含 stems、ducking 或成片混流；真实供应商质量未验 |
| `fal-video-audio-native` | 单个完整 MP4 → ThinkSound 拟音 | [视频拟音](VIDEO-AUDIO-NATIVE-20261005.md)，显式替代 Sonilo SFX；时长跟随视频，供应商最大时长待验 |
| `fal-video-mask-native` | 已保存时序蒙层的视频物体移除／替换 | [Wan VACE](WAN-VACE-VIDEO-MASK-NATIVE-20261005.md)，显式替代；需 FFmpeg、fal Key 和完整蒙层，首次识别另需分割服务 |
| `fal-native` / `fal-video-native` | 图片抠图/增强、视频增强 | [图片](FAL-NATIVE-SETUP.md) / [视频](FAL-VIDEO-NATIVE-SETUP.md) |
| `tripo-native` | 3D 模型生成 | [Tripo](TRIPO-NATIVE-SETUP.md) |
| `marble-native` | World Labs 世界生成及本地 SPZ 渲染 | [Marble](MARBLE-NATIVE-SETUP.md)，预算内高斯已接通预览、片场、照片和视频；真实供应商效果待 Key 验收 |
| `tasks-v1` | 其他统一任务服务 | [任务协议](GENERATION-GATEWAY.md)，需实际实现该协议的后端 |


模型输出需校验并归档到本地。同步请求丢失回执时保留 `unknown`；查询和恢复核对原任务身份，避免重复生成与重复计费。

## 桌面运行

Electron 外壳提供独立窗口、用户目录和本机后台，桌面包版本 `0.1.0-alpha.1`，固定 4183；macOS arm64 ZIP已完成文件与包内后台核验，原生窗口待验、Release草稿，未公开发布下载。它沿用本表的供应商与功能边界，FFmpeg / FFprobe 需外部安装。[启动与配置](DESKTOP.md)

## 状态与历史

- [当前进度](STATUS.md)、[有效缺口](CURRENT-FUNCTION-GAPS-20261003.md)与[本地化验收](FREENOW-LOCALIZATION-ACCEPTANCE.md)记录当前范围。
- [验收证据索引](VERIFICATION-INDEX.md)和[截图与复现](screenshots/README.md)说明每次验证的真实输入与限制。
- [旧首页快照](README-HISTORY.md)保留原有完整描述；其“最新”与“待完成”不能直接用于判断当前状态。
