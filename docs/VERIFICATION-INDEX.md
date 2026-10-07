# 功能验收与历史证据索引

本索引承接原文档导航中的分批记录，保留测试范围、真实界面、媒体证据和未验限制。当前产品与配置见[项目首页](../README.md)、[功能与适配器](FEATURES.md)和[文档导航](README.md)。专项文档的历史日期不代表统一发布版本。

## 2026-10-08 本批入口

| 记录 | 验收范围 |
| --- | --- |
| [音频节点手势](AUDIO-PLAYER-GESTURES-20261008.md) / [普通标题模块](../src/features/canvas-node-titles/README.md) | 正式上传 WAV、空白拖动/波形定位、标题 Enter/Escape/立即撤销重做、刷新；11 项音频与 20 项标题专项；5000 未选中节点零编辑 DOM，非整体 FPS 结论 |
| [搜索键盘](CANVAS-SEARCH-KEYBOARD-20261008.md) / [交互清点](INTERACTION-CHECK-20261008.md) | 官方根 Enter 事件、14 项定向回归；分类/结果/清除焦点、空结果、两级 Escape/回焦实机，真实系统 IME 未验 |
| [模板来源与草稿](research/agent-template-source-followup-20261008.md) | 92 份正文仍缺；21 项草稿/原来源回归；失败保留和 revision 2 真实回读已验，刷新恢复被控制层 beforeunload 取消，仅定向检查 |
| [Ark 本地 MP4 发布](ARK-LOCAL-VIDEO-PUBLICATION-20261008.md) | 独立 fal Key、全来源解码、公网 HTTPS、原 ID 只读恢复与结果归档；115 项定向检查，实际媒体/网关重启；实机延长/重拍缺发布条件与阻断，启用发布 UI/真实供应商未验 |
| [画布命令与媒体菜单](canvas-command-menu-audit-20261008.md) | 最终52项定向（新增17）；当前主壳QA开关/Tab/回焦、导航/创建、主画布焦点撤销重做同ID，以及hover视频→Enter/图片→Space真实创建/关闭/回焦已实机；旧视频/fullImage历史单独浏览器、上传/下载/PNG读回未验 |
| [片场 v2 标签键盘](STUDIO-V2-PANEL-KEYBOARD-20261008.md) / [下一代实现映射](research/STUDIO-V3-IMPLEMENTATION-MAP-20261008.md) | 17 项面板 + 3 项真实 GLB QA；主壳大场景左右循环/首尾、Tab进面板/首镜头、修饰键/Down/右键保护实机；官方导演/GLB并存，与V3生产增量分别验收 |
| [V3生产入口与保存](STUDIO-V3-PRODUCTION-20261008.md) / [模块合同](../src/features/studio-v3/README.md) | 实际entry/CanvasApp/CanvasStore防迟写保存/Three GLB与SPZ运行时、官方图标布局及P0/P1子集；实机刷新4实体/X=2、基准角色只读、注入Quota失败关闭保页/保存重试/撤销重做/IDB rev10实体5；公开GLB导入→独立owner/source绑定保留原source，刷新与真实键盘提交改名/X1.5后关闭IDB rev3，排除只改输入DOM轮次；Escape回焦 |
| 同批V3定向检查与边界 | 联合真实CanvasApp/CanvasStore/session受控IDB10/10、画布持久30/30、Transform取消/换选20/20、菜单10/10、改名4/4，未合计或宣称全部新重跑；P1光学/全局删除UI、P2放置租约及P3–P6仍不完整，Agent read/select/undo未实机；无官方紧凑存档支持，旧Alpha未包含 |
| [人物情绪确认与关闭](../src/features/agent-apps/ACTOR-EMOTION.md) | 4 项确认 + 5 项关闭 + 4 项资源检查；原嵌套应用实际512×512灰模/AE2/SHA、800ms慢保存、关闭失败保页重试及刷新62/87%/13%；鼠标全路径、严格350ms与完整失败组合未验 |
| [桌面文件整理](DESKTOP-FILES-20261008.md) | 15 项专项 + 18 项相关；最新源码 Electron 原生授权/确认3项、7字节/SHA回读、有效单项取消0/未创建、目录移动拒绝与撤销授权后列表阻断、正常⌘Q退出；不在已发布Alpha内，SDK/重启journal/实机回滚与恶意TOCTOU边界保留 |
| [帮助与离线教程](CANVAS-HELP-20261008.md) | 五项本地入口、现场SVG/原始GIF；5项初始定向及隐藏dialog新增回归；实机快捷键21行/GIF、640×606面板、Escape/二次关闭、教程新标签/窄屏章节切换；模块内两图打包白名单/原字节与自然尺寸通过，无新包验收，全部正文/断点未验 |
| [实际快捷键映射](CANVAS-SHORTCUTS-20261008.md) | 累计10项专项（原9+新增1），取消后残留AbortSignal修复及受影响语音3/3；主画布Cmd+A→G→Z、J开关/编辑区让出、I→Escape实机；V仅合成Recorder，真实麦克风/转写、硬件触控板及全部组合未验 |
| [本机外部MCP只读连接](../src/features/external-agent/README.md) / [先前缺口研究](research/EXTERNAL-AGENT-MCP-GAP-20261008.md) | 累计21项（含关闭守卫）；两工具标准stdio/socket、原生批准与真实main/preload/CanvasApp读取1节点/0边/revision绑定、刷新撤权；pending轮询焦点/Tab循环及最新实例正常退出0/空日志/释放4183实机。仅桌面源码元数据，不含旧Alpha、写入/生成/媒体/云连接器，第三方产品完整配置未验 |

## 2026-10-07 前批入口

| 记录 | 验收范围 |
| --- | --- |
| [Sonilo SFX 合同](SONILO-SFX-NATIVE-20261005.md) / [正式 UI](SONILO-SFX-UI-QA-20261005.md) | 20 项定向检查与 4 项受影响 Music 回归；本批 CUA 实际编辑分段、8 秒与 0.5 秒 WAV 播放/刷新恢复、缺 Key 禁用且无第三次 POST；真实供应商未验 |
| [Agent 调色交互](AGENT-COLOR-ADJUST-INTERACTIONS-20261005.md) | 本轮 runtime/派生 10 项，保存失败、context-only 重试、实际 PNG 与刷新重开；非全部视觉/参数组合验收 |
| [Electron 桌面指南](DESKTOP.md) / [安装包核验](releases/DESKTOP-ALPHA-VERIFICATION-20261007.md) / [安装包重开截图](screenshots/freenow-desktop-packaged-restart-20261007.jpg) | 实际6197文件/ASAR/ZIP及包内Node后台已核验；原生包 X=1.25 提交、Cmd+Q 释放 4183、重开恢复已验，macOS arm64 Alpha 已公开；无签名公证，FFmpeg 外部安装 |

## 分批记录


| 记录 | 范围 |
| --- | --- |
| [Sonilo音乐、Agent交互与长历史](LOCAL-SONILO-AGENT-AND-HISTORY-20261005.md) | 1005p整批：真实上传/多变体/文字分段、保存关闭与连续DOM；实机和供应商边界分开记录 |
| [Sonilo独立原生协议](SONILO-NATIVE-20261005.md) · [正式UI验收](SONILO-NATIVE-UI-QA-20261005.md) | 公开官方合同、本地MP4直传、WAV与原任务、Agent时长/数量/分段说明 |
| [Product Kit交互](AGENT-PRODUCT-KIT-INTERACTIONS-20261005.md) · [导演批注交互](AGENT-DIRECTOR-MARKUP-INTERACTIONS-20261005.md) | 原件SHA、同快照交接、保存重试、关闭/恢复与键盘焦点 |
| [长历史性能](GENERATION-HISTORY-LONG-LIST-20261005.md) | 600条完整记录的结构计数、真实滚动/媒体与资源释放；非FPS结论 |
| [Agent识别、交互与实际导出](LOCAL-AGENT-SEGMENTATION-AND-EXPORTS-20261005.md) | 1005o整批：保存回执闭环、原任务取消/重启续发、本地封面、视频规格与真实下载 |
| [Agent 首次视频识别](AGENT-VIDEO-SEGMENTATION-20261005.md) · [隔离整链复现](../src/features/agent-generation/qa/agent-segmentation-README.md) | 独立确认、完整源像素、原UUID任务与真实画布保存；当前实机范围以专项记录为准 |
| [视频规格交互](VIDEO-SPECIFICATIONS-INTERACTION-20261005.md) · [Widget 实际下载](WIDGET-WHITEBOX-DOWNLOAD-QA-20261005.md) | 模式焦点、时长滚轮、Escape；真实PNG/MP4/WebM与逐帧运动证据 |
| [原生SAM2与人物站位补验](LOCAL-SAM2-AND-BLOCKING-20261005.md) · [分割配置](VIDEO-SEGMENTATION-SETUP.md) | 双向真实媒体、完整PNG/RLE、持久任务、保存恢复与真实鼠标 |
| [SAM2后台](REPLICATE-SAM2-NATIVE-20261005.md) · [前端](VIDEO-SEGMENTATION-FRONTEND-20261005.md) · [官方UI核对](VIDEO-SEGMENTATION-OFFICIAL-UI-20261005.md) | 独立供应商合同、原UUID恢复、费用说明与本地界面边界 |
| [SAM2媒体](VIDEO-SEGMENTATION-MEDIA-20261005.md) · [PNG/RLE](VIDEO-SEGMENTATION-MASK-CODEC-20261005.md) · [公开传输来源](REPLICATE-SAM2-TRANSPORT-20261005.md) | 原始帧磁盘流式处理、首帧一致性、严格像素和下载合同 |
| [模板来源增量审计](AGENT-TEMPLATE-SOURCE-AUDIT-20261005.md) | 当前安装包/ASAR完整摘要、22份原件与92份正文缺口 |
| [分组/多选复制](CANVAS-GROUP-COPY-PASTE-20261005.md) · [拼装审阅](AGENT-CUTLIST-REVIEW-INTERACTIONS-20261005.md) | 嵌套坐标/边/引用、40像素粘贴与撤销；同快照交接、保存失败重试及刷新 |
| [SPZ 原生 LOD](SPZ-LOD-20261005.md) | 官方层级、真实GPU近远预算、实际拾取、照片/两秒视频及末源释放；不等于内存上限 |
| [Replicate SAM2 接入研究](VIDEO-SEGMENTATION-REPLICATE-READINESS-20261005.md) · [导出品牌审计](FREENOW-EXPORT-BRAND-AUDIT-20261005.md) | 二值PNG与前后时轴研究，后续实现见上方；导出路径及实际验收边界 |
| [普通节点副本](CANVAS-SINGLE-DUPLICATE-20261005.md) · [人物走位](AGENT-CHARACTER-BLOCKING-INTERACTIONS-20261005.md) | 官方坐标/边序/历史、旧 ID 媒体与参数、真实拖动/确认/关闭及刷新 |
| [混合拾取](SPZ-MIXED-PICKING-20261005.md) · [视频延长生命周期](VIDEO-EXTENSION-LIFECYCLE-20261005.md) | 网格/高斯深度、四模式实际点击；取消、参数漂移、同任务保存重试 |
| [SPZ 本地高斯渲染](SPZ-LOCAL-RENDERING-20261005.md) · [Marble 配置](MARBLE-NATIVE-SETUP.md) | Spark、真实样本、变换/保存/撤销、照片/短视频与gzip实际预算；LOD见上方最新记录 |
| [深度双结果与画布交互](LOCAL-DEPTH-BATCH-AND-CANVAS-20261005.md) | 普通节点、持久父子任务、保存恢复、Agent 裁切互斥与搜索响应 |
| [深度节点同位入口](VIDEO-DEPTH-NODE-ENTRY-20261005.md) · [应用守卫](VIDEO-DEPTH-CANVAS-RECOVERY-GUARDS-20261005.md) | 自动规格、1/2 数量、三种布局、来源/项目变化与失败提示 |
| [平台裁切拖动](AGENT-PLATFORM-RESIZE-DRAG-SELECTION-20261005.md) · [搜索高亮](CANVAS-SEARCH-HOVER-RESPONSE-20261005.md) | 真实 PNG、单份回执、500 节点键盘与焦点实机证据 |
| [深度、全景局部编辑与关闭保存](LOCAL-DEPTH-PANORAMA-LIFECYCLE-20261005.md) | 真实 SDK/媒体归档、配置与来源保护、Computer Use 和截图 |
| [视频深度原生接口](VIDEO-DEPTH-NATIVE-20261005.md) · [前端与 Agent](VIDEO-DEPTH-FRONTEND-QA-20261005.md) | 完整 MP4、原尺寸时长、无声灰度与原任务恢复；普通节点见上方最新入口记录 |
| [全景局部编辑原生接口](OPENAI-PANORAMA-EDIT-NATIVE-20261005.md) · [前端隔离验收](../src/features/panorama-edit/qa/README.md) | 透视裁片/蒙版、2048×1024 本地回投、失败保留同一补丁 |
| [Agent 关闭生命周期](AGENT-CLOSE-LIFECYCLE-20261005.md) | Rhythm/Story 关闭保存握手、慢保存和失败重试；强制离页边界 |
| [Agent内嵌交互闭环](LOCAL-AGENT-INTERACTIONS-20261005.md) | 表演节奏键盘/保存与确认、剧本结构失败重试/恢复、模板本地能力说明及真实截图 |
| [表演节奏交互](AGENT-RHYTHM-INTERACTIONS-20261005.md) · [剧本与人物](AGENT-STORY-BLOCKING-INTERACTIONS-20261005.md) · [嵌套品牌审计](AGENT-EMBEDDED-LOCAL-BRAND-20261005.md) | 原HTML完整SHA、有限派生、交叉审阅与尚未验收的鼠标操作 |
| [皮肤编辑与Agent实机验收](LOCAL-SKIN-AGENT-20261005.md) | 三档/键盘/保存重试/原任务查询、派发前持久回执与刷新 |
| [皮肤专用网关](SKIN-EDITOR-PROVIDER-20261005.md) · [前端](SKIN-EDITOR-FRONTEND-20261005.md) · [Agent](AGENT-SKIN-AND-MASK-APPROVAL-20261005.md) | 完整原图、单结果、严格PNG、来源/参数/任务身份守卫 |
| [Enhancor原生合同核对](SKIN-EDITOR-NATIVE-CONTRACT-20261005.md) | 安装包精确三档；公网来源/回调与未证实映射，非仅Key可用 |
| [图片打光与Agent本机验收](LOCAL-RELIGHT-AGENT-20261005.md) | 正式控件/审批、真实SDK、原任务保存重试、刷新及初始化竞态修复 |
| [独立图片打光协议](OPENAI-RELIGHT-NATIVE.md) · [Agent](AGENT-RELIGHT-PARAMETER-EDIT-20261005.md) | 全部五组光照参数、OpenAI SDK 编辑、原尺寸输入与真实结果归档 |
| [Magnific面板与Agent实机验收](LOCAL-MAGNIFIC-AGENT-20261005.md) · [独立原生配置](MAGNIFIC-NATIVE-20261005.md) · [精确公开证据](MAGNIFIC-PRECISION-NATIVE-CONTRACT-20261005.md) | 四参数、原尺寸本机来源、UUID恢复、真实图片归档与Agent审批 |
| [打光原参数与独立编辑契约](RELIGHT-PARAMETER-EDIT-CONTRACT-20261005.md) · [预览分配优化](RELIGHT-STAGE-FRAME-ALLOCATION-20261005.md) | 安装包光位/轮廓资格/关闭逻辑；保持逐帧状态并减少临时对象 |
| [视频物体编辑与Agent实机验收](LOCAL-VIDEO-MASK-AGENT-20261005.md) | 正式工具栏/审批、真实媒体链路、播放、封面与刷新；分割及真实Key边界 |
| [Wan VACE 视频物体编辑](WAN-VACE-VIDEO-MASK-NATIVE-20261005.md) · [前端](VIDEO-MASK-FRONTEND-NATIVE-20261005.md) | 显式替代、完整时序蒙层、联合裁片、原任务与本地结果 |
| [蒙层媒体处理](VIDEO-MASK-MEDIA-PREPARATION-20261005.md) · [CDN上传](FAL-CDN-UPLOAD-20261005.md) · [准备恢复](VIDEO-MASK-DURABLE-RECOVERY-20261005.md) | 全帧时序、原音样本、分阶段持久化和恢复不重提 |
| [Agent 视频蒙层编辑](AGENT-VIDEO-MASK-CLOSURE-20261005.md) | 已保存蒙层、审批说明、高清参考、连接结果与保存重试 |
| [目标识别原fal合同](VIDEO-SEGMENTATION-FAL-CONTRACT-20261005.md) | 此候选的RLE编码语义仍未确认；独立Replicate原生实现见上方 |
| [运行品牌窄审计](FREENOW-RUNTIME-BRAND-AUDIT-20261005.md) | 平台尺寸应用固定提示本地化，保留用户内容与来源 |
| [全景、重拍与Agent图片处理](LOCAL-PANORAMA-RESHOOT-AGENT-20261005.md) | 正式菜单/卡片、高清原图、2:1实际解码、WebGL预览、刷新与零重复派发 |
| [Hunyuan全景原生协议](PANORAMA-NATIVE-20261005.md) · [前端](HUNYUAN-PANORAMA-FRONTEND-20261005.md) | 独立替代、PNG真实像素与参数白名单、原任务恢复 |
| [Ark视频重拍](VIDEO-RESHOOT-EDIT-20261005.md) | 官方相机提示词、来源设置/全不变守卫与本地上传限制 |
| [Agent图片处理](AGENT-IMAGE-PROCESSING-CLOSURE-20261005.md) | 抠图、显式多角度、高清输入、持久回执和全景交接 |
| [视频遮罩供应商研究](VIDEO-MASK-PROVIDER-READINESS-20261005.md) | 初始合同研究；编辑与分割原生实现见上方，真实供应商效果待验 |
| [视频工具、素材容量与嵌套品牌](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md) | 正式音频/Agent调用、延长菜单、6.6MB原图刷新、离页保护与实际截图 |
| [ThinkSound视频拟音](VIDEO-AUDIO-NATIVE-20261005.md) | 显式替代协议、完整MP4/WAV、时长与原任务恢复 |
| [延长镜头参考生成](VIDEO-EXTEND-NATIVE-20261005.md) | 官方Toolbar合同、Ark参数和本地媒体预检；[传输限制](ARK-LOCAL-VIDEO-TRANSPORT-20261005.md) |
| [个人素材库容量与冲突](LIBRARY-LOCAL-CAPACITY-20261005.md) | IndexedDB单事务、只读迁移、加载队列取消与草稿导出 |
| [制作进度卡本地品牌](FREENOW-PRODUCTION-PROGRESS-BRAND-20261005.md) | 原文校验后派生、中英文/深浅色、准确CORS资源范围 |
| [图片打光接口核查](IMAGE-RELIGHT-NATIVE-20261005.md) | 四个公开专用模型与完整参数的差异；后续已实现独立参数提示词编辑 |
| [短视口右键菜单](CANVAS-CONTEXT-MENU-KEYBOARD-VISIBILITY-20261005.md) | 键盘焦点自动滚入视野、禁用项跳过、画布位置保持和实际浏览器验收 |
| [工作流模板、原生音频与Agent组图](LOCAL-WORKFLOW-AND-NATIVE-AUDIO-20261005.md) | 10个真实图、8类筛选、媒体离线化、缩略图优化与浏览器验收 |
| [Mureka 8/O2原生接口](MUREKA-NATIVE-20261005.md) | 自动/自定义歌词、原任务恢复、真实音频归档与凭据保护 |
| [Seed Audio 1.0原生接口](SEED-AUDIO-NATIVE-20261005.md) | 多模态引用、三种音频容器、字幕与供应商参数限制 |
| [ElevenLabs Music原生接口](elevenlabs-music-native.md) | 公开Compose、歌词/时长预检、本地MP3播放与不重复提交 |
| [音频凭据字节保护](AUDIO-CREDENTIAL-BYTES-20261005.md) | 四适配器UTF-16回显拒绝、归档与重启保护 |
| [同源资源与持久引用](LOCAL-RESOURCE-SAME-ORIGIN-20261005.md) | 严格同源规范、多角度QA真实归档及刷新 |
| [堆叠索引分配优化](CANVAS-PILE-INDEX-ALLOCATION-20261005.md) | 一次扫描、分配计数、落点/标题/撤销验收 |
| [Agent HTTP基线修正](AGENT-HTTP-RECOVERY-20261005.md) | 强杀媒体锁合同、SSE安全尾段与fixture修正 |
| [官方与模型 Key 核验](OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md) | 官方文档、安装包、社区、24操作就绪状态与实际限制 |
| [多角度原生替代](FAL-MULTI-ANGLE-NATIVE-20261005.md) | Qwen 2511显式配置、参数转换、队列恢复和本地PNG归档 |
| [Agent供应商续轮](AGENT-PROVIDER-CROSSCHECK-20261005.md) | SDK规范化、模型别名、推理与工具身份 |
| [视频供应商核验](VIDEO-PROVIDER-CROSSCHECK-20261005.md) | Ark edit/extend、实际裁片与本地结果恢复 |
| [图片音频供应商核验](IMAGE-AUDIO-PROVIDER-CROSSCHECK-20261005.md) | PNG完整性、原生子集、官方/SDK/社区来源 |
| [freenow运行品牌](FREENOW-RUNTIME-BRAND-LABELS-20261005.md) | 主要界面名称、本地标识与历史alias兼容 |
| [素材原始媒体往返](LIBRARY-ASSET-ROUNDTRIP-20261005.md) | 原图、裁切与来源、picker本地解析、换源恢复保护 |
| [图片图层菜单](IMAGE-EDITOR-LAYER-MENU-20261005.md) | 复制、层序、删除、焦点关闭与迟到clone保护 |
| [Agent流式代码操作](AGENT-STREAMING-CODE-CONTROLS-20261005.md) | 流式复制/换行、控件身份、焦点及横向滚动保持 |
| [片场聚焦导航速度](STUDIO-V2-FOCUS-NAVIGATION-SPEED-20261005.md) | 对象取景保持速度，整场取景才按场景重算 |
| [图片拖动吸附](IMAGE-EDITOR-ALIGNMENT-GUIDES-20261005.md) | 官方阈值、边缘/中心、辅助线导出隔离和保存恢复 |
| [历史批次展开](CANVAS-HISTORY-EXPANSION-20261005.md) | 多批分行、单结果、来源隔离和一次撤销/重做 |
| [Agent消息附件](AGENT-MESSAGE-ATTACHMENTS-20261005.md) | 真实缩略图、失败回退、重绘复用与会话清理 |
| [片场关键帧拖动](STUDIO-V2-TIMELINE-KEY-DRAG-20261005.md) | 指针捕获、取消、同名运镜身份与迟到提交保护 |
| [片场数字草稿](STUDIO-V2-NUMERIC-DRAFT-20261004.md) | 原始精度、取消/失焦、精确提交和跨轴拖动 |
| [Agent目录导航](AGENT-REFERENCE-FOLDER-NAVIGATION-20261004.md) | 返回/整目录引用、键盘边界、焦点与正式bundle |
| [正式片连线落点](CANVAS-CONNECTION-FINAL-DROP-20261004.md) | 无效落点取消、合法样片、普通回退和拖动Escape |
| [Agent 时长取消层级](AGENT-GENERATION-DURATION-ESCAPE-20261004.md) | 整数时长两级Escape、音频取消不重复提交、真实blur复验 |
| [Agent 禁用模型反馈](AGENT-GENERATION-DISABLED-MODEL-HOVER-20261004.md) | 原因悬停/键盘反馈、禁用选择与关闭生命周期 |
| [视频模块目录整理](VIDEO-MODULE-ORGANIZATION-20261004.md) | 23 个根目录文件迁入功能目录，同步运行引用、组件库与验证入口 |
| [本机剪辑结果保护](VIDEO-TRIM-RESULT-RECOVERY-20261003.md) | 迟到结果归属、实际保存确认、原结果重试与刷新回读 |
| [蒙版、音效与性能](LOCAL-MASKED-SOUND-AND-PERFORMANCE-20261003.md) | 原生编辑/音效、输入失焦、千节点布局、片场目录及分页 |
| [音乐、视频增强与导出](LOCAL-NATIVE-MEDIA-AND-SCENE-EXPORT-20261003.md) | MiniMax Music、fal 视频、真实 GLB 下载与迟到保护 |
| [音频与分组恢复](LOCAL-AUDIO-AND-WORKFLOW-RECOVERY-20261003.md) | 原节点音频、输出保留、分组持久回执和显式继续 |
| [历史、参考与字幕](LOCAL-HISTORY-REFERENCES-SUBTITLES-20261003.md) | 视频历史、引用时长、学习预览和字幕落图 |
| [拾取与音频上传](LOCAL-PICKING-AND-AUDIO-UPLOAD-20261003.md) | GPU 点选、形变与异步上传保护 |

其他带日期文件是历史记录，保留具体输入、测试范围、截图位置和当时限制。优先阅读当前状态及较新的对应合同；不把模块计数、路由登记或模拟服务测试当作全站完成率。

`reference/` 原始账号抓包和本机 QA 证据未提交；早期报告中的这类链接仅供原开发机追溯。公开运行需要的材料位于 `runtime-reference/` 或各功能资源目录。新使用说明应链接仓库已跟踪的文档，不依赖私人抓包。
