# freenow 文档导航

[中文项目首页](../README.md) · [English README](../README.en.md) · [功能与适配器](FEATURES.md)

freenow 是本地 AI 创作工作台：无限画布、图片/音视频工具、3D 片场和创作 Agent。先按要完成的任务找入口，再阅读对应合同与验收范围。详细文档目前以中文为主。

## 我想开始使用

| 任务 | 阅读入口 |
| --- | --- |
| 安装、启动与最小配置 | [项目首页](../README.md#快速开始)、[环境变量字段](../.env.example) |
| 下载、运行或构建 Electron 桌面预发布 | [macOS arm64 Alpha](https://github.com/freeall12/freenow/releases/tag/v0.1.0-alpha.1)、[桌面指南](DESKTOP.md)；固定 4183、独立用户目录、外部 FFmpeg，未签名/公证；ZIP、包内后台和实际安装包退出重开恢复已核验 |
| 用桌面源码整理授权文件夹 | [原生授权、整批确认与回执](DESKTOP-FILES-20261008.md)；仅子目录创建和普通文件移动/重命名，不在现有 Alpha 包内 |
| 操控导演片场摄像机并拍摄到画布 | [三维飞行、光学滑尺、完成/还原和照片重试](STUDIO-V3-CAMERA-POSSESSION-20261008.md)；当前源码，PNG保存/刷新已验，不在现有Alpha包内 |
| 新建与切换画布项目 | [画布项目](CANVAS-PROJECTS.md) |
| 使用画布帮助、离线教程与快捷键 | [五项帮助入口](CANVAS-HELP-20261008.md)、[实际快捷键与验证](CANVAS-SHORTCUTS-20261008.md) |
| 使用图片、视频、音频或 3D 生成 | [多供应商配置](MULTI-PROVIDER-SETUP.md)、[功能与适配器](FEATURES.md) |
| 把本地 MP4 交给 Ark 生成、延长或重拍 | [独立 fal 发布配置](ARK-LOCAL-VIDEO-PUBLICATION-20261008.md)，需要独立 fal Key 与显式型号映射；不会复用 Ark Key |
| 连接创作 Agent | [Agent API](AGENT-API.md)、[本地编辑工具](AGENT-LOCAL-EDITING-20261003.md)、[片场控制](AGENT-STUDIO-LOCAL-CONTROLS.md) |
| 让外部 Agent 读取当前画布 | [桌面源码MCP连接与原生批准](../src/features/external-agent/README.md)；本机stdio、两项只读元数据工具，不含写入/生成/素材/云连接器或现有Alpha包 |
| 理解数据位置、迁移和恢复 | [本地数据与运行](LOCAL-STORES-AND-RUNTIME-20261003.md)、[素材库容量与冲突](LIBRARY-LOCAL-CAPACITY-20261005.md)、[Agent 存储](AGENT-STORAGE.md) |
| 找真实界面及复现方法 | [截图索引](screenshots/README.md)、[验收证据索引](VERIFICATION-INDEX.md) |

## 我想开发或定位问题

| 任务 | 阅读入口 |
| --- | --- |
| 找代码位置与模块边界 | [项目结构](PROJECT-STRUCTURE.md)、[开发维护指南](DEVELOPMENT-GUIDE.md)、[组件目录](../component-library/README.md) |
| 修改生成路由、预检或结果归档 | [生成网关](GENERATION-GATEWAY.md)、[路由合同](generation-routing-contract.md)、[预检](GENERATION-PREFLIGHT-READINESS-20261003.md)、[媒体归档](GENERATION-MEDIA-MATERIALIZER-20261003.md) |
| 修改 Agent 检查点或继续执行 | [服务端会话](AGENT-SESSION-STORE.md)、[存储](AGENT-STORAGE.md)、[恢复合同](agent-stored-continuation.md) |
| 修改内嵌创作应用 | [本地生成合同](agent-apps-local-generation-contract.md)、[应用目录与历史](HISTORICAL-APPS-AND-NATIVE-TTS-20261003.md) |
| 核对导演工作区与GLB片场的版本边界 | [下一代实现映射](research/STUDIO-V3-IMPLEMENTATION-MAP-20261008.md)、[V3模块合同](../src/features/studio-v3/README.md)、[生产入口与保存实机证据](STUDIO-V3-PRODUCTION-20261008.md)；官方两入口并存，V3已接生产运行时/保存、时间作者及平面图/房间子集，P1–P6未全、旧Alpha未包含 |
| 修改V3平面图、房间与场景来源 | [官方合同与缺口矩阵](research/STUDIO-V3-PLAN-20261008.md)、[当前实机证据](verification/20261008-studio-plan.md)、[投影](../src/features/studio-v3/PLAN-PROJECTION.md)、[渲染](../src/features/studio-v3/PLAN-RENDERER.md)、[SVG交互](../src/features/studio-v3/PLAN-VIEW.md)、[作者桥](../src/features/studio-v3/PLAN-WORKSPACE.md)、[房间](../src/features/studio-v3/ROOM-SCENE.md)、[空间菜单](../src/features/studio-v3/SPACE-MENU.md)、[本地来源](../src/features/studio-v3/WORKSPACE-SOURCE.md) |
| 核对出站和公开文件边界 | [运行边界](LOCAL-RUNTIME-BOUNDARIES-20261003.md)、[依赖审计](RUNTIME-DEPENDENCY-AUDIT-20261003.md)、[公开仓库检查](PUBLIC-REPOSITORY-AUDIT-20261004.md) |
| 理解许可与第三方资源 | [第三方来源](THIRD-PARTY-RESOURCES.md)；当前没有覆盖全部内容的统一许可证 |

## 我想核对当前范围

- [平面图与房间最新证据](verification/20261008-studio-plan.md)：真实正交剖切、已有实体/FOV事务、尺寸scrub和刷新恢复；路径/关键帧曲线/新增摆位支撑面与完整P2仍开放。前批[摄影与导出](verification/20261008-studio-shots.md)、[时间轴/只读相册](verification/20261008-studio-temporal.md)保留各自测试和媒体范围，旧Alpha不含这些源码。
- [当前开发进度](STATUS.md)：已接入能力、本批变化和仍开放的验证。
- [有效功能缺口](CURRENT-FUNCTION-GAPS-20261003.md)：缺少的接口、精确模板、服务资格与质量验证。
- [本地化验收](FREENOW-LOCALIZATION-ACCEPTANCE.md)：资源、数据、原站请求与实际导出边界。
- [验收证据索引](VERIFICATION-INDEX.md)：分批交互、源码回归、真实本机媒体与模拟供应商的区别。

**本批验证：** [音频空白拖动](AUDIO-PLAYER-GESTURES-20261008.md)、[普通节点标题](../src/features/canvas-node-titles/README.md)、[搜索焦点确认](CANVAS-SEARCH-KEYBOARD-20261008.md)已按各自范围完成 Computer Use；标题控件懒创建减少未选中节点 DOM。[模板草稿](research/agent-template-source-followup-20261008.md)的失败保留与真实保存回读已验，刷新恢复仍只有定向检查。前批[桌面 Alpha](releases/DESKTOP-ALPHA-VERIFICATION-20261007.md)已公开且实际包退出重开恢复通过。范围见[当前状态](STATUS.md)，专项记录不等于全站已完成。

同批新增[画布菜单](canvas-command-menu-audit-20261008.md)、[GLB 片场 v2 标签](STUDIO-V2-PANEL-KEYBOARD-20261008.md)、[人物情绪确认/关闭](../src/features/agent-apps/ACTOR-EMOTION.md)和[桌面源码文件整理](DESKTOP-FILES-20261008.md)的定向及实机证据；完整范围与限制见[验收索引](VERIFICATION-INDEX.md)，图片来源见[截图索引](screenshots/README.md)。

[帮助与离线教程](CANVAS-HELP-20261008.md)、[实际快捷键](CANVAS-SHORTCUTS-20261008.md)及[本机外部MCP只读连接](../src/features/external-agent/README.md)已补当前源码实机记录；后者贯通原生批准、生产画布元数据读取和刷新撤权，不能推广成写操作、云端连接器或商业Agent产品全部配置已验。

## 文档组织约定

- 产品定义、最短启动与主要边界放在根 README；英文入口同步这些事实。
- 稳定的功能说明和配置入口放在本目录，源码职责说明放在功能目录 README。
- 带日期的专项文件保留输入、测试范围、截图与当时限制，不改写成全站验收结论。
- 公共来源及去敏核查材料放在 `docs/research/`，截图及来源放在 `docs/screenshots/`。
- 新增说明应补充这里或对应的功能索引；已有证据按当前目录模式保留，不为分类批量移动。

旧首页的详细增量和供应商目录分别保留在[历史快照](README-HISTORY.md)与[功能文档](FEATURES.md)。此前导航的完整分批表已迁到[验收索引](VERIFICATION-INDEX.md)。

`reference/` 原始账号抓包和本机 QA 证据未提交；早期报告中的这类链接仅供原开发机追溯。公开运行材料位于 `runtime-reference/` 或各功能资源目录。新的公开指南不依赖私人抓包。

## 项目检索与引用

[仓库发现性与 README 参考](REPOSITORY-DISCOVERY.md)说明产品名称、可引用事实、检索术语和 GitHub metadata 建议。根 [llms.txt](../llms.txt) 提供公开文档入口，不能保证任何搜索引擎收录或排名。
