# freenow

本地 AI 创作工作台：无限画布、图片与音视频编辑、3D 片场，以及能够操作画布和编排创作流程的 Agent。

以 TapNow 官方界面与安装包为功能和交互参考，在本机实现前后端、资源与持久化。**项目仍在开发，尚未完成全站一比一验收。** 运行不需要 TapNow 账号或服务；生成能力通过独立供应商适配器接入。本项目与 TapNow 无隶属关系。

[快速开始](#快速开始) · [功能截图](#功能截图) · [当前能力](#当前能力) · [API 配置](#api-配置) · [未完成项](#未完成项) · [文档导航](docs/README.md) · [公开仓库与密钥检查](docs/PUBLIC-REPOSITORY-AUDIT-20261004.md)

## 快速开始

推荐 Node.js 22 LTS 和 pnpm。本地视频裁切、封装及分镜处理另外需要 FFmpeg / FFprobe。

```sh
git clone https://github.com/freeall12/freenow.git
cd freenow
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

打开 **http://localhost:4173/**。服务默认仅监听 `127.0.0.1:4173`；这是本机应用，不是多用户云部署方案。

首次运行创建空画布。`pnpm run setup` 仅初始化缺失的默认数据，不覆盖已有画布。这里需要保留 `run`，避免调用 pnpm 自身的环境安装命令。无需 Key 即可使用本地编辑能力；未配置的生成和 Agent 功能会显示配置要求。

FFmpeg 已安装在其他位置时，可配置 `FFMPEG_PATH`、`FFPROBE_PATH`。组件预览位于 http://localhost:4173/component-library/ 。

## 功能截图

以下是本地应用的实际界面，复用正式画布、编辑器、Agent 和 WebGL 片场。使用隔离示例数据和仓库内模型；未调用生成模型。2026-10-05 已替换主要运行界面的 freenow 名称、本地 F 标识和 Agent 图片。完整品牌/导出清点仍开放。

| 当前片场：本地 Agent 图片与场景控件 | 当前模型预览：本地 GLB 与 freenow 提示标识 |
| --- | --- |
| ![freenow WebGL片场与Agent入口](docs/screenshots/freenow-studio-agent-brand-20261005.jpg) | ![freenow本地自行车模型预览](docs/screenshots/freenow-local-model-preview-20261005.jpg) |

以下 2026-10-03 的历史截图保留当时标识：

| 无限画布：文本、素材、连线和片场入口 | 图片编辑：图层、选区与变换工具 |
| --- | --- |
| ![本地无限画布及素材连线](docs/screenshots/canvas.jpg) | ![实际 Fabric 图片图层编辑器](docs/screenshots/image-editor.jpg) |
| **3D 片场：本地 GLB 导入和场景树** | **Agent：欢迎建议、附件与模型控制** |
| ![Three.js 片场中的办公椅模型](docs/screenshots/studio.jpg) | ![本地 Agent 对话页面](docs/screenshots/agent.jpg) |

本机智能剪辑：实际 FFmpeg 输出、视频播放控件和来源连线。

![本机智能剪辑得到三段真实视频](docs/screenshots/video-trim.jpg)

截图证明对应页面的实际渲染，不代表全部功能已验收。[截图来源与复现步骤](docs/screenshots/README.md)。

## 当前能力

下表描述已经接入的能力，不代表所有状态、菜单和视觉细节均通过最终验收。

| 模块 | 已有能力 | 使用条件 |
| --- | --- | --- |
| 无限画布 | 新建/切换项目、平移缩放、搜索、连线、分组、堆叠、自动布局、撤销重做、素材与个人模板 | 本地使用 |
| 文本与图片 | Tiptap 富文本/Markdown、Fabric 图层/画笔、裁剪、变换、蒙版、版本历史与导出 | 本地编辑；AI 编辑另需供应商 |
| 音视频 | 本地导入、播放、波形、帧捕获、裁切、播放列表、生成历史与结果归档 | 部分操作需 FFmpeg；生成另需供应商 |
| 3D 片场 | Three.js 场景、模型与光照、对象变换、镜头与运镜、动画、取景、GLB 导出及保存恢复 | 本地使用；生成模型/世界另需供应商 |
| Agent | OpenAI SDK 工具循环、画布/片场操作、技能与附件引用、创作应用、只读子任务/DAG 编排 | 支持 Responses API 的模型与配置 |
| 工作流与恢复 | 分组依赖执行、任务持久回执、原任务查询、显式继续、项目/来源失效保护 | 未知状态不自动重新提交 |

Agent 应用已登记 22 个版本 URI、20 个功能族，包含剧本、分镜、人物、学习、产品等工作流。**登记覆盖不等于全部页面和交互验收完成。**

前批交互增量（2026-10-05）：图片图层右键菜单补复制、上移、下移和删除，以及键盘与焦点关闭；Agent流式代码即时支持复制与换行，增量更新保留焦点和横向滚动；片场聚焦小物体、大布景或镜头时保持整场导航速度。素材库保存/重新插入保留高清原图、视频裁切和来源，并修复本地视频下载。四项完成定向检查、交叉审阅及 Computer Use，见[图层菜单](docs/IMAGE-EDITOR-LAYER-MENU-20261005.md)、[流式代码](docs/AGENT-STREAMING-CODE-CONTROLS-20261005.md)、[聚焦导航](docs/STUDIO-V2-FOCUS-NAVIGATION-SPEED-20261005.md)、[素材往返](docs/LIBRARY-ASSET-ROUNDTRIP-20261005.md)。

| 图片编辑：真实图层右键菜单 | Agent：流式代码复制与换行 |
| --- | --- |
| ![图层层序与真实PNG验收](docs/screenshots/image-editor-layer-menu-20261005.jpg) | ![流式代码块控件与焦点验收](docs/screenshots/agent-streaming-code-controls-20261005.jpg) |

上批增量（2026-10-05）：图片编辑器补官方拖动吸附与辅助线；生成历史按批次分行，支持单结果；已发送 Agent 附件保留真实缩略图；运镜拖动补取消与同名片段切换保护。四项均完成定向检查、交叉审阅和 Computer Use，见[图片吸附](docs/IMAGE-EDITOR-ALIGNMENT-GUIDES-20261005.md)、[历史展开](docs/CANVAS-HISTORY-EXPANSION-20261005.md)、[消息附件](docs/AGENT-MESSAGE-ATTACHMENTS-20261005.md)、[运镜拖动](docs/STUDIO-V2-TIMELINE-KEY-DRAG-20261005.md)。

| 生成历史：两批结果分行 | Agent：已发送本地附件与失败回退 |
| --- | --- |
| ![正式画布按批次展开图片历史](docs/screenshots/canvas-history-batches-cua-20261005.jpg) | ![正式消息组件的真实本地图片视频与回退槽位](docs/screenshots/agent-message-attachments-20261005.jpg) |

上批精度、目录键盘导航和无效连线落点记录： [片场](docs/STUDIO-V2-NUMERIC-DRAFT-20261004.md)、[Agent目录](docs/AGENT-REFERENCE-FOLDER-NAVIGATION-20261004.md)、[连线](docs/CANVAS-CONNECTION-FINAL-DROP-20261004.md)。

![本地片场运镜参数和 Agent 目录引用](docs/screenshots/studio-numeric-draft.jpg)

## API 配置

配置示例在 [`.env.example`](.env.example)。服务读取进程环境，**不会自动加载 `.env`**。可以复制为未跟踪的本机文件，填写后显式加载：

```sh
cp .env.example .env.local
# 编辑 .env.local，填写需要使用的供应商配置
node --env-file=.env.local server/server.cjs
```

该命令替代 `pnpm dev`，不要同时启动两个服务。更改服务端配置后重启；Key 仅保存在服务端，不填写到源码或提交 Git。

**Agent** 至少需要 `OPENAI_API_KEY` 和 `OPENAI_MODEL`。可选 `OPENAI_BASE_URL` 必须支持所用的 Responses API/工具能力。菜单模型别名通过 `AGENT_MODEL_MAP` 映射，思考档位通过 `AGENT_REASONING_MAP` 映射；未映射选项不会静默回退。[Agent 接口](docs/AGENT-API.md)

**媒体生成** 按操作和模型分别路由。Key、模型访问权限、协议和参数能力都必须匹配；目前还不能保证只填任意厂商 Key 就能使用全部菜单。优先按 [多供应商配置](docs/MULTI-PROVIDER-SETUP.md) 选择适配器：

| 适配器 | 已接入用途 | 配置与限制 |
| --- | --- | --- |
| `openai-native` | 文本、文生图/参考图、语音、视觉识别与分镜描述 | [网关](docs/GENERATION-GATEWAY.md) / [参考图](docs/OPENAI-IMAGE-REFERENCES.md) |
| `openai-masked-edit-native` | 擦除、局部重绘、扩图 | [蒙版编辑](docs/OPENAI-MASKED-EDIT-NATIVE.md) |
| `ark-native` | 火山方舟视频任务 | [Ark](docs/ARK-VIDEO.md) |
| `ark-video-extend-reference` | 工具栏延长镜头：片头/片尾、4–30秒、连续性与参考 | [延长镜头](docs/VIDEO-EXTEND-NATIVE-20261005.md)，明确为参考生成；本地视频另需公网发布通道 |
| `ark-video-reshoot-edit` | 视频重拍：分镜、四种镜头模式与提示词编译 | [重拍](docs/VIDEO-RESHOOT-EDIT-20261005.md)，实验性提示词模拟；Ark Key 外还需要独立 HTTPS 视频 |
| `fal-panorama-native` | 单张图片 → Hunyuan World Panorama | [全景](docs/PANORAMA-NATIVE-20261005.md)，固定 2:1、单结果、原生尺寸；当前后端仅接受实际 PNG 像素，非区域编辑 |
| `minimax-native` | MiniMax H3 视频 | [H3](docs/MINIMAX-H3-SETUP.md) |
| `minimax-music-native` | MiniMax Music 2.6 | [音乐](docs/MINIMAX-MUSIC-NATIVE.md)，存在账号资格限制 |
| `elevenlabs-native` / `elevenlabs-sound-native` | TTS 与音效 | [TTS](docs/ELEVENLABS-NATIVE-TTS.md) / [音效](docs/ELEVENLABS-NATIVE-SOUND.md) |
| `elevenlabs-music-native` | Music 普通/纯音乐与单节自定义歌词 | [音乐](docs/elevenlabs-music-native.md)，自定义歌词须明确3–120秒；节点目录上限300秒 |
| `mureka-native` | Mureka 8 / O2 自动与自定义歌词歌曲 | [Mureka](docs/MUREKA-NATIVE-20261005.md)，精确型号、原任务查询与本地音频归档 |
| `seed-audio-native` | Seed Audio 1.0 多模态音频及字幕文本 | [Seed Audio](docs/SEED-AUDIO-NATIVE-20261005.md)，独立语音 Key；Ogg Opus 仅48kHz |
| `fal-video-audio-native` | 单个完整 MP4 → ThinkSound 拟音 | [视频拟音](docs/VIDEO-AUDIO-NATIVE-20261005.md)，显式替代 Sonilo SFX；时长跟随视频，供应商最大时长待验 |
| `fal-native` / `fal-video-native` | 图片抠图/增强、视频增强 | [图片](docs/FAL-NATIVE-SETUP.md) / [视频](docs/FAL-VIDEO-NATIVE-SETUP.md) |
| `tripo-native` | 3D 模型生成 | [Tripo](docs/TRIPO-NATIVE-SETUP.md) |
| `marble-native` | World Labs 世界生成后端 | [Marble](docs/MARBLE-NATIVE-SETUP.md)，SPZ 渲染尚未完成，前端阻止派发 |
| `tasks-v1` | 其他统一任务服务 | [任务协议](docs/GENERATION-GATEWAY.md)，需实际实现该协议的后端 |

模型输出会校验并归档到本地。同步调用丢失回执时保留 `unknown`，不会自动重试造成重复生成；可查询任务只核对原任务身份。

## 本地数据与资源

- 浏览器 IndexedDB 保存项目、素材、Agent 会话及工作流记录；部分偏好、技能等仍使用 localStorage。没有云同步。
- 个人素材库和文件夹现由 IndexedDB 单事务保存，旧 localStorage 数据只读迁移；大图保持原始字节。多标签冲突时保留草稿并可导出，不能盲目覆盖较新数据。[容量与恢复](docs/LIBRARY-LOCAL-CAPACITY-20261005.md)
- 服务端任务、生成媒体与 Agent 检查点保存在 `server/` 下的私有隐藏目录，不提供静态访问、不纳入 Git。
- `localhost` 与 `127.0.0.1` 是不同浏览器 origin，存储不互通；日常使用请保持同一个入口。清理站点数据会移除浏览器侧内容。
- 新克隆使用 `defaults/` 空数据；个人素材、原始账号抓包、本机运行数据与 API Key 不发布。
- 页面和内嵌应用使用本地资源限制；服务端拒绝向原站域名请求或转交原站媒体。未知旧资源须显式导入修复，不自动联网回源。[本地化验收边界](docs/FREENOW-LOCALIZATION-ACCEPTANCE.md)

## 最新接入与核验

图片转 360° 全景已接正式节点菜单、Agent 确认卡和独立供应商协议；真实 PNG 解码、WebGL 预览、刷新恢复及错误画幅拒绝均已实操。Agent 抠图与自动多角度使用高清原图，先保存任务身份再派发；补齐中文任务标题和固定欢迎文案。[本批实现与浏览器证据](docs/LOCAL-PANORAMA-RESHOOT-AGENT-20261005.md)

| 全景结果：实际 WebGL 预览 | 视频重拍：完整镜头控件与接入条件 |
| --- | --- |
| ![本地合成全景结果与取景入口](docs/screenshots/hunyuan-panorama-preview-20261005.jpg) | ![视频重拍正式面板及Ark媒体传输限制](docs/screenshots/video-reshoot-native-boundary-20261005.jpg) |

截图使用合成夹具，不代表真实模型质量。重拍的来源设置变更、关闭后的迟到回调和全“不变”计划已阻断；Ark 本地媒体上传、真实供应商效果仍待接入与验证。视频物体移除/替换完成了 [Wan VACE 合同核对](docs/VIDEO-MASK-PROVIDER-READINESS-20261005.md)，其适配、时序遮罩与分割服务仍未完成。

短窗口中的右键菜单现在会把键盘焦点滚入可视范围。End/Home、方向键绕回、禁用项跳过、关闭与重开已实际验证；菜单滚动保持画布位置。[交互与截图证据](docs/CANVAS-CONTEXT-MENU-KEYBOARD-VISIBILITY-20261005.md)

视频拟音与延长镜头已接入独立供应商协议，Agent 确认卡具备时长、配置预检和素材加载保护。正式按钮和 Agent 卡均通过本机 HTTP 服务，8 秒 WAV 实际播放到结束、刷新可读；明确时长冲突及缺配置不会派发。这里验证的是调用与媒体链路，音频是固定测试音调。[本批实现与验收](docs/LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)

| Agent 视频拟音：实际供应商与跟随时长 | 延长镜头：完整参数菜单与接入条件 |
| --- | --- |
| ![正式Agent视频拟音确认卡](docs/screenshots/agent-video-audio-native-20261005.jpg) | ![延长镜头参数与本地视频传输条件](docs/screenshots/video-extend-reference-20261005.jpg) |

个人素材库已用 6.6 MB、2048×1152 原图完成正式保存、picker 插入及刷新核对，原始 SHA、像素和来源保持；旧库键零写入。Agent 等待素材加载时可以取消排队，未保存模板有离页保护。嵌套制作进度卡完成 freenow 名称、F 图片、深浅色与中英文替换，用户正文和来源保持。[存储](docs/LIBRARY-LOCAL-CAPACITY-20261005.md) · [进度卡品牌](docs/FREENOW-PRODUCTION-PROGRESS-BRAND-20261005.md)

Ark 延长镜头使用官方工具栏的参考生成语义，当前仍要求公网 HTTPS 视频，不能只靠 Ark Key 上传本地视频。ThinkSound 是操作者明确选择的 Sonilo SFX 替代，未覆盖 Sonilo 音乐及分段。所有真实账号权限和生成效果仍待 Key 验收。

此前已落地 10 个公开工作流、8 类筛选、72 个原节点、112 条连线及全部引用媒体；列表约332KB缩略图，保留约95MB原封面。Mureka、Seed Audio 与 ElevenLabs Music 已接原生协议；Agent 组图质量及编辑交互也有专项证据。[工作流与音频](docs/LOCAL-WORKFLOW-AND-NATIVE-AUDIO-20261005.md) · [Music](docs/elevenlabs-music-native.md)

![本地工作流模板详情、分类与应用](docs/screenshots/workflow-template-detail-20261005.jpg)

生成配置列出 24 类操作的实际就绪条件；多角度已有受限 Qwen 2511 替代，不能将通用网关登记当作专用能力完成。[逐项 Key 条件](docs/OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md) · [多角度](docs/FAL-MULTI-ANGLE-NATIVE-20261005.md)

![freenow 配置与能力状态](docs/screenshots/generation-readiness-routed-20261005.png)

堆叠索引已减少全图扫描与临时数组分配；素材写入已移出同步 localStorage，QA 也避免将数 MB data URL 展开成 DOM 文本。尚未完成全局帧率和长时间内存验收。[性能记录](docs/CANVAS-PILE-INDEX-ALLOCATION-20261005.md)

## 开发

技术栈：原生 JavaScript/ES Modules、Node.js、Three.js、Fabric、Tiptap、OpenAI SDK、Tabler 和 esbuild；依赖版本以 pnpm 锁文件为准。

```text
index.html、app.js       主入口与现有画布宿主
src/features/           按业务组织的功能模块、Agent 应用与片场
server/                 Agent、供应商适配、任务和本地媒体服务
assets/                 运行需要的本地美术、字体及库资源
runtime-reference/      运行需要的本地技能材料
component-library/      组件预览与调用说明
defaults/               公开空项目初始数据
scripts/、tests/         构建、派生资源、定向检查与回归
docs/                  配置、功能合同、验收证据与历史记录
```

视频相关的 23 个源码与样式文件已归入 `src/features/video-*/`，根目录不再保留转发文件。其余旧业务模块按功能分批迁移，并同步更新生产入口、组件目录、服务端和验证页面。[结构约定](docs/PROJECT-STRUCTURE.md) · [功能入口、构建与定向验证](docs/DEVELOPMENT-GUIDE.md)

普通前端模块直接加载。修改对应编辑器入口后运行相应构建命令：

```sh
pnpm build:text
pnpm build:image
pnpm build:mask
pnpm build:agent
```

按改动选择验证，避免每次运行完整回归：

```sh
node --test tests/<相关测试>.test.cjs
node --check <修改的模块>
pnpm check   # 全部源码语法检查
pnpm test    # 全库回归，需要时运行
```

交互改动另做实际浏览器验收；测试绿灯、模拟供应商或资源文件存在不能代替真实页面、媒体内容和模型质量验证。

## 未完成项

- 全站菜单、hover、微动效、坐标与性能的逐态对照和交叉验收。
- 92 份精确创意模板正文，以及 SPZ 渲染与相应依赖接入。
- 其余专用生成能力的原生供应商适配，及真实 Key/账号下的端到端验证。
- 部分本地存储容量和长期运行边界的继续完善。
- 主要运行位置已替换为 **freenow** 名称和本地标识；剩余嵌套应用、导出和旧内容的品牌清点仍需逐项验收，保留来源与用户原文。

团队、社区、分享营销、计费和付费宣传不在复刻范围。兼容存储键、用户媒体、原始来源及第三方许可证不会随品牌替换被盲目改写。

完整状态以 [当前进度](docs/STATUS.md)、[功能缺口](docs/CURRENT-FUNCTION-GAPS-20261003.md) 和 [本地化验收清单](docs/FREENOW-LOCALIZATION-ACCEPTANCE.md) 为准。历史报告保留当时结论，不能把旧“待完成”直接当作现在缺失。

第三方代码和参考资源保留各自来源与许可；仓库目前未提供覆盖全部内容的统一开源许可证。
