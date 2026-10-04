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
- [Agent 存储](AGENT-STORAGE.md) · [服务端检查点](AGENT-SESSION-STORE.md)
- [本地编辑工具](AGENT-LOCAL-EDITING-20261003.md) · [片场控制](AGENT-STUDIO-LOCAL-CONTROLS.md)
- [供应商预检](GENERATION-PREFLIGHT-READINESS-20261003.md) · [媒体归档](GENERATION-MEDIA-MATERIALIZER-20261003.md)
- [运行边界](LOCAL-RUNTIME-BOUNDARIES-20261003.md) · [依赖审计](RUNTIME-DEPENDENCY-AUDIT-20261003.md)

## 最近验收批次

| 记录 | 范围 |
| --- | --- |
| [视频模块目录整理](VIDEO-MODULE-ORGANIZATION-20261004.md) | 23 个根目录文件迁入功能目录，同步运行引用、组件库与验证入口 |
| [本机剪辑结果保护](VIDEO-TRIM-RESULT-RECOVERY-20261003.md) | 迟到结果归属、实际保存确认、原结果重试与刷新回读 |
| [蒙版、音效与性能](LOCAL-MASKED-SOUND-AND-PERFORMANCE-20261003.md) | 原生编辑/音效、输入失焦、千节点布局、片场目录及分页 |
| [音乐、视频增强与导出](LOCAL-NATIVE-MEDIA-AND-SCENE-EXPORT-20261003.md) | MiniMax Music、fal 视频、真实 GLB 下载与迟到保护 |
| [音频与分组恢复](LOCAL-AUDIO-AND-WORKFLOW-RECOVERY-20261003.md) | 原节点音频、输出保留、分组持久回执和显式继续 |
| [历史、参考与字幕](LOCAL-HISTORY-REFERENCES-SUBTITLES-20261003.md) | 视频历史、引用时长、学习预览和字幕落图 |
| [拾取与音频上传](LOCAL-PICKING-AND-AUDIO-UPLOAD-20261003.md) | GPU 点选、形变与异步上传保护 |

其他带日期文件是历史记录，保留具体输入、测试范围、截图位置和当时限制。优先阅读当前状态及较新的对应合同；不把模块计数、路由登记或模拟服务测试当作全站完成率。

`reference/` 原始账号抓包和本机 QA 证据未提交；早期报告中的这类链接仅供原开发机追溯。公开运行需要的材料位于 `runtime-reference/` 或各功能资源目录。新使用说明应链接仓库已跟踪的文档，不依赖私人抓包。
