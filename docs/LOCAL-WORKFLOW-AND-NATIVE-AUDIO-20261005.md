# 公共工作流、原生音频与 Agent 组图 · 2026-10-05

本批把公开工作流模板接成真实本地图，新增 Mureka / Seed Audio 原生供应商协议，并修复 Agent 电商组图参数与交互。实现以官方安装包、官方 Web 和供应商合同为依据；本机页面用于验收。**全站一比一仍未完成，真实供应商 Key 与模型效果尚未验收。**

## 工作流模板与本地资源

- 10个公开工作流共72个原节点、112条内部连线；应用时另建外层分组，生成新ID并重映射引用。提示词、模型别名、版本、精确相对坐标和连线语义保留，不保留原站账号、组织、任务绑定或使用统计请求。
- 官方8类：Seedance 2.0、广告、电商、影视、生活、工具、有趣、ACG。未知历史分类ID不杜撰名称，模板仍在“全部”可见。支持分类与搜索交集、公共/我的/最近使用、详情、返回、应用和从选中分组创建模板。
- 详情保留原始日期语义，以本地中文时间显示；卡片hover与focus显示查看/应用，关闭恢复实际触发按钮。单次图插入对应一笔撤销。
- 最近使用保存在独立IndexedDB `TEMPLATE_DB_NAME + ':recent'`，最多30条身份/来源/时间记录，不挤占localStorage或修改个人模板库结构。写入失败明确提示，已插入的图不重复创建。等待期间关闭页面或切项目会阻止迟到的个人模板应用。

公开清单包含141个媒体槽位、91个不同原URL。全部已取得，复用15个既有引用，新增76个文件共295,757,453字节；按内容去重后为86个不同本地媒体。实际ffprobe容器/stream检查覆盖86/86，其中73 PNG、1 WebP、1 JPEG、11 H264视频，4个视频另带AAC。该检查不是全视频逐帧解码或画质验收。

旧媒体域名的下载失败按官方包 `AUe()` / `RY()` 确证的域名规范化规则解决。运行清单只含本地路径，原始公开响应/映射与研究截图保留在忽略目录，未发布私人画布。

10张封面保留95,114,405字节原图，列表和filmstrip改用640px WebP派生封面，共331,824字节，约减少99.65%的封面读取量。详情仍读原图，列表不实例化全部72个节点媒体；不能据此宣称整体FPS提高。派生脚本为 `scripts/build-workflow-template-thumbnails.cjs`，使用已有FFmpeg，没有新增依赖。

![本地完整工作流详情](screenshots/workflow-template-detail-20261005.jpg)

来源与实现：[官方源码核对](../src/features/workflow-templates/qa/official-source-audit-20261005.md) / [模块验收](../src/features/workflow-templates/qa/local-acceptance.md)。**这10个可执行工作流与92份尚待补齐的Creative HTML模板是不同内容。**

## 原生音频接口

| 协议 | 已实现范围 | 具体边界 |
| --- | --- | --- |
| `mureka-native` | 精确mureka-8/o2，自动或自定义歌词、原任务查询、完整MP3/WAV归档 | Auto最多2000字符；Custom提示1024/歌词1–5000；单首，无远端取消 |
| `seed-audio-native` | seed-audio-1.0，多模态引用、WAV/MP3/Ogg Opus、真实字幕文本 | 一图或最多三音频；不混用；Ogg仅48kHz；未物化选区拒绝；没有远端任务查询 |

两协议均接入共享gateway/router和正式节点能力预检，默认origin和型号映射可用，显式空map保持禁用。缺Key/缺路由在读取参考媒体前禁用；模式切换保留隐藏草稿但只发送当前模式字段。模型调用仍只去操作者配置的独立供应商，没有TapNow回退。

Mureka下载不把Key带到CDN；完整音频另验凭据回显，污染结果保持unknown并只查原ID。Seed未知同步结果不重发，字幕必须取实际响应。两者均保留既有本地媒体归档、项目身份与恢复保护。

配置：[多供应商](MULTI-PROVIDER-SETUP.md)、[Mureka](MUREKA-NATIVE-20261005.md)、[Seed](SEED-AUDIO-NATIVE-20261005.md)。账号资格、模型访问权、声线、成曲质量与真实供应商行为仍待Key验收，不能将模拟响应等同生成效果。

## Agent 组图

保留官方原HTML及SHA。Amazon质量固定low/medium/high，不再误受仅medium的可选项约束；Freeform省略质量时使用其选项默认值或首项。真实素材SHA、持久确认、一次交接、配置缺失零派发和TaskService恢复路径保持。

截图与原页面合同见[组图模块](../src/features/agent-apps/ecommerce-photoset.md)。Mureka本批是已有音频节点的原生接线，没有擅自在Agent音频目录新增官方尚未开放的型号。

## 本批实际验证

定向检查与独立交审：Mureka15项、Seed16项、共享接线3项、音频前端相关29项及最后差异10项、组图18项、模板与相邻存储35项、随后最近使用/异常保护17项。后续差异检查与前项存在重叠，**不累加成唯一测试总数**；没有重复全库测试。

本批31个变更JavaScript文件语法和差异格式检查通过；待提交138个文件的索引字节扫描无凭据发现、无私有路径、无单文件超过100MiB。原始reference、运行数据、Key与临时测试日志不提交。已有旁路 `sidebar-dismissal.test.cjs` 的两项主体库fixture仍缺 `readySubjects`；本批未修改该无关主体库，也未把全库标为通过。

实际Computer Use使用生产界面及隔离数据：

| 路径 | 实测结果 |
| --- | --- |
| Tech Product Ad卡片标题 | 2内容节点+1分组、1连线；一次撤销为空、重做身份/小数坐标一致，刷新恢复 |
| 通用产品全套电商图详情应用 | 29内容节点+1分组、51连线；与已有图合计33节点/52连线，刷新全部节点/边一致，一次撤销回3节点/1边 |
| 模板本地媒体 | PNG实际5504×3072；MP4为1280×720、5.06195秒、readyState4，正式播放至ended |
| 分类、搜索与详情 | 电商+Tech只显示对应模板；输入后首次点击查看有效；工具分类真实空态；ISO日期保留并显示中文本地时间；Escape回“查看”，Close回“浏览全部模板” |
| 创建个人模板与最近使用 | 真实保存“本机产品工作流”，个人/公共分别再次应用；刷新后最近使用仍保留两项，画布9节点/3边，零外站请求/模型POST |
| 存储失败页 | localhost已有额度耗尽时，独立QA明确ready:false及可见QuotaExceededError，追加script-src none停止后续脚本；没有清理旧存储 |
| Mureka | Custom1025字禁用；合法Custom成功，切Auto保留草稿但wire歌词为空；真实0.2秒MP3播放、刷新回读 |
| Seed | Ogg24k禁用，48k+字幕成功，实际Ogg 0.1265秒及供应商字幕节点/来源连线；31秒参考、缺Key/空routes禁用；刷新播放至ended |
| Agent组图 | 616×497真实本地产品图；high/low保存，编辑行、确认/Escape回焦；缺配置两项configuration_required且jobs=[]；Freeform初始/交接质量为high |

音频本机HTTP统计区分2次前置smoke与3次浏览器有效POST；没有真实计费调用。临时音频QA已优雅停服，重现见[专项说明](../src/features/audio-generation/qa/native-pair.md)。模板页面为 `/src/features/workflow-templates/qa/main.html?session=你的独立标识`；`localhost`与`127.0.0.1`存储不互通，日常使用请保持固定入口。

## 仍开放

继续逐态核对全站设计、菜单和微动效；补92份精确创意HTML、SPZ渲染及其待批准依赖、未接专用供应商的能力，继续品牌/导出清点和长期存储边界。现有freenow名称、本地F标识和Agent图片沿用前批实现，兼容alias、用户正文与来源许可保留。没有把本批模板或协议数量当作全站完成度。
