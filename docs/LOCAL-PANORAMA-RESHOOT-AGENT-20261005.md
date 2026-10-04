# 全景、视频重拍与 Agent 图片处理 · 2026-10-05

本批接通专用全景生成、实验性视频重拍与 Agent 高清图片处理的前后端。正式界面、来源守卫、任务回执和结果应用已做定向检查及 Computer Use；未调用真实供应商。项目仍未完成全站一比一验收。

## 能力与使用条件

| 能力 | 已接入行为 | 接入条件与限制 |
| --- | --- | --- |
| 图片转 360° 全景 | 节点菜单、Agent 确认卡、单图单结果、实际 2:1 解码、WebGL 预览与本地保存 | `fal-panorama-native`，显式 Hunyuan World Panorama 替代；FAL Key、精确模型映射与模型权限。原图按原尺寸转换 PNG；后端当前仅支持非交错 8-bit RGB/RGBA PNG。不是全景区域编辑 |
| 视频重拍 | 四种镜头模式、连续分镜、起止相机参数、提示词编译、来源设置与关闭取消保护 | `ark-video-reshoot-edit`，显式 `prompt_simulation`；Ark Key、可访问的视频编辑型号和独立 HTTPS 视频。暂不能直接上传本地视频，不能承诺镜头轨迹或不变片段逐帧一致 |
| Agent 图片处理 | 抠图、增强/打光分支、显式四参数多角度、高清图读取、先保存任务身份再派发、来源连接结果 | 原生适配器须支持对应操作；多角度是受限 Qwen 2511 替代，完整打光语义仍需独立适配。操作名称显示中文 |

配置示例见 [环境变量](../.env.example)，合同分别见 [全景后端](PANORAMA-NATIVE-20261005.md)、[全景前端](HUNYUAN-PANORAMA-FRONTEND-20261005.md)、[重拍](VIDEO-RESHOOT-EDIT-20261005.md)、[Agent 图片处理](AGENT-IMAGE-PROCESSING-CLOSURE-20261005.md)。未配置或不兼容输入会说明原因，不制造生成成功状态。

## 官方对照与实际浏览器证据

官方安装包的视频重拍路径具有保持不变、固定、切换、平滑移动，透视/正面相机、六个方向和四种景别。本次也实际打开官方 Web 中一段 5.1 秒视频的重拍页，核对时间轴、播放、分镜、模式切换和关闭；没有向官方提交生成任务。供应商合同另以 Ark 文档及 fal Hunyuan OpenAPI 核对，具体来源与哈希在专项文档。

本地 Computer Use 使用正式画布、TaskService、生成层和 Agent 卡，外部模型回复为明确标记的固定夹具。独立 session 隔离数据库，未读取或清理日常项目/素材/偏好。

| 实际操作 | 观察到的结果 |
| --- | --- |
| 节点全景：打开规格、Escape、生成、360° 预览、关闭、刷新 | 单参考、单结果、2:1、原生尺寸；512×320 输入只提交一次，256×128 合成结果真实解码；来源保持，刷新后图片仍可解码，未重新提交 |
| 错误画幅，再点“重试应用结果” | 明确显示实际尺寸不符；目标为空、来源保持、无全景按钮；原任务保留，仅一次提交 |
| 重拍：打开真实 8 秒 MP4，检查生成条件 | 正式 12 帧时间轴与全部模式可见；显示 1080p/无声及 Ark 上传条件，生成禁用。真实 TaskService 前置检查为 0 POST、0 本地源读取、0 裁片 |
| 重拍：配置延迟中关闭，再释放迟到配置 | 没有创建任务或读取/裁片，面板关闭后不恢复提交 |
| Agent 抠图：输入、允许、刷新 | 审批前 0 POST/0 原图读取；审批后一次提交，先持久化 Agent taskId，使用 512×320 原图而非 32×20 缩略图；两个节点一条连线。刷新仍是同一回执，结果真实像素 512×320，无新 POST |
| Agent 缺配置后允许操作 | 明确提示缺少 FAL_API_KEY；0 生成提交、0 原图读取、0 新任务，原图保持 |
| Agent 自动多角度 | 一次提交，四参数 `-30 / 2 / 0.5 / false` 保留，高清来源与持久回执正确；新连接结果成功应用 |
| Agent 全景：正式确认卡、确认、刷新 | Hunyuan / 2:1 / 1× 与限制可见；512×320 输入原尺寸编码，wire 仅 `type/id/url/width/height`，一次提交；1024×512 结果真实解码，刷新后保持 |

Agent 全景夹具明确将 `nodeId` 与参考源设为同一节点，所以更新该指定目标，不能把它记为“新增来源连接节点”。普通生成使用项目生成历史的持久化门控；它没有专用图片处理的 Agent `submittedTaskId` 回调，验收如实记录 `acknowledged:false`。已独立验证历史写入失败时 0 媒体读取、0 供应商调用，恢复拒绝重放不完整工具回执。

![正式全景预览](screenshots/hunyuan-panorama-preview-20261005.jpg)

![视频重拍完整面板及媒体接入条件](screenshots/video-reshoot-native-boundary-20261005.jpg)

## 交叉审阅与修复

- 全景适配先验证真实 PNG CRC、压缩数据、scanline/filter 和像素预算，再接受结果；队列 metadata、编码 URL、PNG metadata 和像素中的凭据回显会阻断发布。未知字段不静默丢弃，恢复只查原任务。
- 独立审阅发现并修复不一致的 `url/image/fullImage`、PNG 序列化无超时、恢复 proposal 绕过 2:1 检查；媒体等待可取消，临时画布和图片资源释放。
- 重拍来源清晰度/声音变化会使旧请求失效；全程保持不变在前后端均拒绝，独立七项定向复验通过。
- Agent 夹具最初因 origin localStorage 已满而中断；修复为内存偏好，CSP 先于脚本安装、异常禁止请求。后续实操又发现技能目录 baseURI 不一致和刷新私有资源索引请求：现只读取精确公开技能文件，私有映射由空合成数据替代，未放开真实 API 或外网。
- 主画布和片场固定欢迎统一为“你好，创作者！”，不改用户名称或兼容存储键。

后端专项使用实际本机 HTTP、durable service、媒体归档与原任务恢复，外部 queue/下载由夹具替代；前端 CUA 采用 fetch 夹具和真实生产 UI，不能将两者拼成一次真实供应商端到端测试。验证命令及各自数量以专项文档为准，重叠套件不累加成总数；没有重复执行全库测试。

## 复现与剩余事项

```sh
pnpm dev
# 全景：打开 /src/features/image-generation/qa/panorama/main.html?session=unique&case=success
node scripts/build-agent-image-processing-fixture.cjs
# Agent：打开 /qa/agent-image-processing-app.html?session=unique
# 多角度另加 &kind=angle&auto；全景另加 &kind=panorama
node scripts/serve-video-reshoot-fixture.cjs
# 使用输出的隔离端口，打开 /qa/video-reshoot-native-app.html?session=unique&mode=native
```

生成 HTML 保持忽略；跟踪夹具源码、合成图片、构建脚本和文档。全景来源/结果为程序绘制色块，重拍源为仓库红绿蓝测试片，不是供应商成品。临时视口只用于恢复后台零尺寸标签的实际操作；重拍截图按实测缩放裁出完整面板，未修改产品布局或生成式修图。

真实账号权限、Hunyuan 输出 PNG profile/画质/接缝、重拍视频编辑效果仍需配置 Key 后验证。视频遮罩编辑完成了 [Wan VACE 合同研究](VIDEO-MASK-PROVIDER-READINESS-20261005.md)，但 adapter、时序 mask 封装/上传和目标分割服务尚未实现。SPZ、92 份精确模板原文、剩余全站交互及全局性能验收继续开放。
