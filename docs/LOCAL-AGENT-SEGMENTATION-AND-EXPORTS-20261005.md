# Agent 目标识别、规格交互与实际导出 · 1005o

本批对照官方安装包、线上 Agent 技能详情和生产实现推进。范围不包含营销、团队、社区、分享或付费宣传；没有读取真实 Key、上传私人媒体或请求外部模型。

## 实现

- Agent 首次识别及原 UUID 查询、取消、续发和重存五个工具，共享视频面板的完整源传输。首次识别和续发始终独立确认；真实项目、节点回执和 Agent 检查点在创建请求前保存。
- 创建/续发绑定批准的模型版本和提供方指纹；服务端在读取请求体、准备媒体或调用提供方前拒绝缺失/过期批准。取消允许来源已经变化，但仍要求原项目、节点对象、UUID 和回执版本。
- 保存失败复用原蒙层资产。恢复成功后，仅能在原调用身份与完整来源可证明一致时补存单个原工具回执，再由用户核对、明确继续。原失败记录保留。
- 结果卡封面经正式 `LocalAssets.url` 解析，真实图片加载成功再替换现有类型图标；每个异步边界核对项目、对话、节点对象及媒体来源，迟到或失败保持图标。SAM2标题按实际结果显示，只有完整applied/saved回执才称已保存。
- 视频规格切换后保留焦点；自动滚入当前时长；鼠标垂直滚轮浏览横向选项，手动浏览不会被拉回。复用官方行为与原样式。
- Widget 增加可复现的实际 PNG、MP4、WebM 下载验收入口；HTML 导出验收使用独立存储和本地 Blob 资源，不读取私人资源索引。

## 已取得的浏览器证据

| 场景 | 实际结果与范围 |
| --- | --- |
| Agent 自动模式批准屏障 | 正式 composer 发起，确认前 sourceReads=0、native taskPosts=0、供应商 POST=0；仍显示独立确认卡。 |
| 完整源分割 | 320×180、5秒、10fps源视频，节点clip为1–4秒；绝对2.5秒映射原帧25。实际前向25帧、倒序26帧，51份PNG合并50帧完整RLE。 |
| 保存失败与原Agent闭环 | session-b原任务与原asset重存后补齐唯一原工具回执；用户核对并明确继续后服务端session completed、pending为空、receipts=1，仅增加一次LLM续轮，没有新识别/推理/asset。session-c用真实本地源和封面重复此闭环并刷新，保持同任务/同蒙层，零迁移提示。 |
| 批准后来源漂移 | 确认前把clip改为2–4秒，点击允许后明确拒绝；当前会话零来源读取、零任务创建。 |
| 停止等待后换clip再取消 | session-cancel3停止等待，把clip改2–4秒，再点正式取消卡；原UUID cancelled，无蒙层资产。已归档前向的取消回执confirmed；倒序仅上传中、没有派发prediction，不宣称两路云推理均被停止。刷新保留取消状态。 |
| 重启后独立确认续发 | session-resume2同store重启，前向25帧已归档、倒序pending；正式查询不重发，续发前再次确认。确认后native resume累计0→1、prediction 11→12，task创建仍7、LLM仍15；仅补倒序26帧，原UUID完成50帧，单个22684字节蒙层资产保存。计数是隔离宿主各会话累计值。 |
| 本地结果卡 | session-c刷新后两张结果卡均为本机Blob、自然尺寸320×180、complete=true，零alert；源视频、封面、clip、蒙层仍为原持久引用。初始sourceReads=1是QA导入公开合成视频，刷新为0，不能误计成审批前Agent传输。 |
| 视频规格 | 模式键盘切换与焦点、30秒滚入、真实wheel后保持位置、输入4秒及两级Escape通过。使用正式菜单的隔离宿主，完整画布外层关闭本批未重验。 |
| Widget下载 | 真实宿主按钮下载PNG、H.264 MP4、VP9 WebM；文件回读SHA匹配，两份视频均播放至ended，FFmpeg各解码40个不同帧并确认移动矩形轨迹。请求2秒不等于编码后的精确时长。 |
| HTML下载 | 正式按钮下载2359字节离线HTML，读回内嵌图片、opaque iframe与CSP；`file://`重开被浏览器安全策略拒绝，没有绕过，独立离线文件运行未验。 |

LLM与Replicate供应商回复为明确的本机合成边界；实际AgentRuntime、NDJSON、审批、任务存储、FFmpeg、PNG/RLE、LocalAssets和CanvasStore均运行生产链路。识别效果、线上编码兼容和账号资格不能由该证据推出。

## 验收中发现与修复

普通画布发送原先无条件读取尚未注册的StudioAPI；现发送`activeScene:null`，片场会话仍拒绝错误或未就绪片场。恢复卡原先把供应商succeeded显示为“正在保存”，现在按applied/save_failed显示实际画布状态。保存失败使原工具journal未就绪的问题，新增严守原callId/runId/UUID、完整蒙层字段及来源版本的补存路径。独立审阅进一步要求完整mask字段与原patch相等，不能仅凭asset/task相同就移除patch比对来源。

实机还发现结果卡把`asset:`直接赋给img而无法显示，现复用正式解析并对异步读取和图片load分别作来源守卫；未撤销共享Blob缓存。工具返回needs_resume也曾被统一done标题称为“已保存”，现五个工具仅在真实applied/saved且无错误时使用该标题。原历史调用及错误不被改写。

QA初版Three.js经pnpm隐藏目录的realpath被静态边界拒绝；已限定到精确安装包的公开URL映射，私有路径仍拒绝。后加模块遇到QA启动时的公开文件清单快照问题；验收服务需要保留原任务和审计后重载。初版HTTP源的刷新迁移提示保留为QA来源边界，不据此放宽生产资源政策。

两次8秒delay情景在停止按钮操作前已正常完成，仅算额外成功任务，不算取消通过。一次needs-resume情景超过上传30秒超时后失败，未发布部分蒙层；不能把此失败算作重启续发通过。

最终成功使用独立新session：取消任务`586513f4-b245-4fb2-9e84-b3473bc91ed4`，续发任务`dd315cfb-1d40-49a8-bff5-39012c49cc4b`、蒙层`asset:c022e2b7-6856-483a-b336-286062173c8e`。失败尝试与完整审计仍保留，不清空原任务或用新UUID冒充恢复。成功截图见[原Agent恢复](screenshots/agent-sam2-local-recovery-20261005.jpg)、[取消](screenshots/agent-sam2-cancel-source-change-20261005.jpg)、[续发](screenshots/agent-sam2-resume-complete-20261005.jpg)。

## 检查与仍开放的范围

本批只运行新增/改动相关检查与实机路径，没有重跑全库。批准身份HTTP新增3项、视频规格新增5项以及Agent工具/保存/来源/回填定向回归通过，独立交审补齐完整蒙层字段校验。旧settlement两个VM夹具缺少`appCardsReadyProjection`，旧菜单一个夹具将异步import永久挂起，均已确认是基线问题，未通过放宽生产行为掩盖。

缩略图异步来源守卫与五工具结果标题各新增一条定向回归并通过；最终真实页面已显示本地320×180封面和准确的待续发/完整保存标题。续发成功后再次刷新，原UUID、clip、asset和applied状态保持，页面无warning/error日志。主4173服务经所属进程及目录核实后正常关闭、以无模型Key环境启动，未删除writer锁；主画布刷新后项目菜单与Agent入口可用，页面无error日志。变更Markdown的504个相对链接均指向已存在的目标。

官方线上当前16个已装技能和动效库详情未提供92份精确HTML模板正文；相对来源链接显示blocked，未绕过。此结论仅覆盖已观察页面，不证明安装后或服务器端不存在模板。全站视觉/交互、剩余精确资源、其他供应商适配与真实Key效果验收仍开放。

入口与证据：[Agent合同](AGENT-VIDEO-SEGMENTATION-20261005.md) · [QA复现](../src/features/agent-generation/qa/agent-segmentation-README.md) · [任务审计](research/agent-sam2-cua-20261005.json) · [视频规格](VIDEO-SPECIFICATIONS-INTERACTION-20261005.md) · [Widget下载](WIDGET-WHITEBOX-DOWNLOAD-QA-20261005.md) · [导出品牌边界](FREENOW-EXPORT-BRAND-AUDIT-20261005.md) · [官方模板来源](AGENT-TEMPLATE-SOURCE-AUDIT-20261005.md)
