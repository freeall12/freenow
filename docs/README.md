# 文档导航

从 [项目首页](../README.md) 启动应用；本目录保存使用配置、模块合同和分批验收记录。

## 使用与当前状态

- [当前开发进度](STATUS.md)
- [多供应商配置](MULTI-PROVIDER-SETUP.md) · [环境变量示例](../.env.example)
- [Agent 接口](AGENT-API.md) · [生成网关](GENERATION-GATEWAY.md)
- [画布项目](CANVAS-PROJECTS.md) · [本地数据与运行](LOCAL-STORES-AND-RUNTIME-20261003.md)
- [当前有效缺口](CURRENT-FUNCTION-GAPS-20261003.md) · [最终本地化验收](FREENOW-LOCALIZATION-ACCEPTANCE.md)

## 开发与模块合同

- [开发维护指南](DEVELOPMENT-GUIDE.md) · [项目结构](PROJECT-STRUCTURE.md) · [组件目录](../component-library/README.md)
- [功能截图与复现](screenshots/README.md)
- [公开仓库与密钥检查](PUBLIC-REPOSITORY-AUDIT-20261004.md)
- [Agent 存储](AGENT-STORAGE.md) · [服务端检查点](AGENT-SESSION-STORE.md)
- [本地编辑工具](AGENT-LOCAL-EDITING-20261003.md) · [片场控制](AGENT-STUDIO-LOCAL-CONTROLS.md)
- [供应商预检](GENERATION-PREFLIGHT-READINESS-20261003.md) · [媒体归档](GENERATION-MEDIA-MATERIALIZER-20261003.md)
- [运行边界](LOCAL-RUNTIME-BOUNDARIES-20261003.md) · [依赖审计](RUNTIME-DEPENDENCY-AUDIT-20261003.md)

## 最近验收批次

| 记录 | 范围 |
| --- | --- |
| [图片打光与Agent本机验收](LOCAL-RELIGHT-AGENT-20261005.md) | 正式控件/审批、真实SDK、原任务保存重试、刷新及初始化竞态修复 |
| [独立图片打光协议](OPENAI-RELIGHT-NATIVE.md) · [Agent](AGENT-RELIGHT-PARAMETER-EDIT-20261005.md) | 全部五组光照参数、OpenAI SDK 编辑、原尺寸输入与真实结果归档 |
| [打光原参数与独立编辑契约](RELIGHT-PARAMETER-EDIT-CONTRACT-20261005.md) · [预览分配优化](RELIGHT-STAGE-FRAME-ALLOCATION-20261005.md) | 安装包光位/轮廓资格/关闭逻辑；保持逐帧状态并减少临时对象 |
| [视频物体编辑与Agent实机验收](LOCAL-VIDEO-MASK-AGENT-20261005.md) | 正式工具栏/审批、真实媒体链路、播放、封面与刷新；分割及真实Key边界 |
| [Wan VACE 视频物体编辑](WAN-VACE-VIDEO-MASK-NATIVE-20261005.md) · [前端](VIDEO-MASK-FRONTEND-NATIVE-20261005.md) | 显式替代、完整时序蒙层、联合裁片、原任务与本地结果 |
| [蒙层媒体处理](VIDEO-MASK-MEDIA-PREPARATION-20261005.md) · [CDN上传](FAL-CDN-UPLOAD-20261005.md) · [准备恢复](VIDEO-MASK-DURABLE-RECOVERY-20261005.md) | 全帧时序、原音样本、分阶段持久化和恢复不重提 |
| [Agent 视频蒙层编辑](AGENT-VIDEO-MASK-CLOSURE-20261005.md) | 已保存蒙层、审批说明、高清参考、连接结果与保存重试 |
| [目标识别供应商合同](VIDEO-SEGMENTATION-FAL-CONTRACT-20261005.md) | SAM2 公开输出缺少完整编码语义；独立分割服务仍必需 |
| [运行品牌窄审计](FREENOW-RUNTIME-BRAND-AUDIT-20261005.md) | 平台尺寸应用固定提示本地化，保留用户内容与来源 |
| [全景、重拍与Agent图片处理](LOCAL-PANORAMA-RESHOOT-AGENT-20261005.md) | 正式菜单/卡片、高清原图、2:1实际解码、WebGL预览、刷新与零重复派发 |
| [Hunyuan全景原生协议](PANORAMA-NATIVE-20261005.md) · [前端](HUNYUAN-PANORAMA-FRONTEND-20261005.md) | 独立替代、PNG真实像素与参数白名单、原任务恢复 |
| [Ark视频重拍](VIDEO-RESHOOT-EDIT-20261005.md) | 官方相机提示词、来源设置/全不变守卫与本地上传限制 |
| [Agent图片处理](AGENT-IMAGE-PROCESSING-CLOSURE-20261005.md) | 抠图、显式多角度、高清输入、持久回执和全景交接 |
| [视频遮罩供应商研究](VIDEO-MASK-PROVIDER-READINESS-20261005.md) | 初始合同研究；适配与上传已有后续实现，分割服务仍开放 |
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
