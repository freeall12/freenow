# TapNow 无限画布本地复刻

公开仓库首次运行会初始化空画布；`pnpm setup` 只创建缺少的默认数据文件，不覆盖本机已有画布。个人素材、原始抓包、运行会话、生成任务、API Key 和本机 QA 截图不提交。历史 `reference/` 验收链接是开发机资料，公开运行需要的技能捕获位于 `runtime-reference/`。

当前为持续开发版本。无 Key 时可使用本地画布、编辑器及片场；生成和 Agent 需按 `.env.example` 与 `docs/GENERATION-GATEWAY.md` 配置对应协议、模型和 Key。尚未完成所有供应商及官方页面的逐项验收。

2026-10-03 追加火山方舟原生视频任务适配、Agent会话/分镜的IndexedDB容量修复、真实媒体来源标记及视频请求持久化修复。官方接口交叉核验、浏览器操作与剩余边界见 [本轮记录](docs/LOCALIZATION-INCREMENT-20261003.md)。

2026-10-03 修复 Agent 分镜落图与续轮来源签名竞态，补缺配置入口、来源失效保护和本机媒体错误分类。浏览器验证重复操作仅一次派发、真实裁片可播放，见 [本轮验收](docs/AGENT-VIDEO-ANALYSIS-VERIFICATION-20261003.md)。

2026-10-02 追加原生视频分镜：本机全选区硬切检测、实际MP4裁片/海报、逐镜视觉描述接口与来源区间持久化；补来源变更取消及有界流式读取。124项回归、467模块检查和浏览器整批撤销/重做/播放/刷新通过，见 [接线验收](reference/video-analysis-native-integration-20261002.md)。真实模型、复杂转场与官方完整结果布局仍待验收。

2026-10-02 追加原生焦点识别接口、素材库/模板迟到回调保护、现有 SVG 图标复用与退场指针隔离。最新 51 项聚焦回归和实际浏览器验证见 [本轮验收](reference/focus-library-integration-20261002.md)；真实模型质量和全站一致性仍待验收。

2026-10-02 追加音频菜单键盘/异步保护与150ms微动效、真实视频首帧和旧历史按需补图、原生文字转语音及图片自适应参数修复。99项聚焦检查与浏览器操作范围见 [本轮验收](reference/audio-history-speech-20261002.md)；真实供应商和全站还原仍未完成。

2026-10-02 追加真实生成历史（图片/视频/音频/GLB、预览、批量导入与下载）、Agent显式继续、OpenAI普通图生图/多参考适配。历史列表复用DOM与缩略图，修复返回焦点和保存/导航边界。实际浏览器操作、下载文件与限制见 [本轮功能验收](reference/recovery-history-provider-20261002.md)。

2026-10-02 资源与响应增量：补官方技能默认图标、菜单/素材库/历史抽屉进退场、面板拖动取消与指针隔离；小地图稳定选区跳过重复排序。真实主入口复点和局部性能测量见 [本轮增量记录](reference/resources-interactions-performance-20261002.md)，完整同视口和所有交互仍未完成。

2026-10-02 Agent父运行已接持久检查点和浏览器“核对中断任务”：保留原调用身份与回执，重复提交不重复请求，未知中断不自动重发；未配置Key也可查已存状态。浏览器已追加完整真实回执核对后的显式继续；无完整父回执的子Agent/DAG中断仍仅查证，见 [继续合同](src/features/agent-recovery/README.md)。见 [检查点接线](reference/agent-checkpoint-integration-20261002.md)。

Agent 子任务已支持有前后依赖的编排：实际前序结果交接、失败分支跳过、独立分支继续，以及丢回包后的只读状态核对。每批最多6项、同时最多2个模型请求，子任务仍只读。子任务/DAG已追加跨重启检查点：保存原子任务、依赖和真实结果，未知在途请求不重发，见 [恢复合同](reference/agent-delegation-checkpoints-20261002.md) 和 [编排合同](reference/agent-delegation-integration.md)。

2026-10-02 Agent进一步接通：独立3D节点 `world_read/world_generate` 与真实素材/任务回填、片场 `scene_import/scene_redo` 与网格光照、个人技能改名/卸载。分别见 [世界生成](reference/agent-world-generation-20261002.md)、[片场本地控制](docs/AGENT-STUDIO-LOCAL-CONTROLS.md)、[个人技能管理](src/features/agent-skills/MANAGEMENT.md)。原生高斯泼溅渲染和完整跨重启Agent续跑仍开放；实际生成依赖供应商协议适配与Key。

2026-10-02 新增本地画布项目：顶栏可新建、搜索、切换；菜单、抽屉与编辑器退出已完成一轮全局修复和实际交互检查，见 [项目与交互验收](reference/projects-and-interactions-20261002.md)。Agent 本轮追加 [真实联网检索与来源](reference/agent-web-search-20261002.md)、[长任务上下文整理](reference/agent-context-compaction-20261002.md) 和图片图层创建分组/解组。外部服务仍需支持对应协议的模型与配置，未完成真实供应商验收。

2026-10-02：继续官方逐项核对、并行修复和交叉复验。追加 Agent 欢迎页/空输入框/模型菜单及 Group 子图层修复，长期运行清理与容量保护已补。画布快捷键/粘贴、片场对象删除与动画恢复、Agent 姿态与主画布会话隔离、保存失败保护已补；官方技能目录更新至16项。新增 OpenAI 原生文字/无媒体文生图适配，其他供应商仍需对应协议，尚不能宣称只填各类 Key 即全部可用。见[本轮记录](reference/replica-cross-verification-20261002.md)。

Agent 已新增生成任务持久恢复：原 taskId 查询只走 GET，未知提交不自动重发；恢复结果须显式选择可验证原占位或新节点。生产任务记录位于静态拒绝目录 `server/.generation-tasks`。Agent 注册工具现为 92 项；任务恢复不等于对话/子 Agent/DAG 跨重启继续，详见 [生成网关](docs/GENERATION-GATEWAY.md)。深度视频准备/转换/重演已接主 Agent、真实帧续轮与执行卡；新增本地视频裁剪和单独重试保存。真实供应商与整体视觉仍待验收，见 [深度接线](reference/agent-depth-integration.md)、[本地裁剪](reference/agent-video-trim.md)。


白模追加：Widget 已接 PNG/录像 Blob 交接、宿主添加与下载、H264规范化及保存重试；新增视频模型合同查询与通用Agent本地素材传输，见 [集成记录](reference/agent-whitebox-handoff-integration.md)。GPU录制质量与真实模型仍待验收。

Agent 主体库追加：读取、保存、归档、按世界坐标导入画布已接工具循环，支持内容版本核对、同操作重试及真实素材引用；公共生成准备统一处理展开后的主体媒体。合同和限制见 [主体库接线](reference/agent-subjects.md)。

Agent 图片编辑追加：接入真实 Fabric 文档创建/打开、图层与画笔操作、撤销重做、全分辨率合成保存和关闭；当前会话/版本保护手工编辑。详见 [图片编辑工具](reference/agent-image-editor.md)。已追加源像素裁剪、原子逐图层擦除与 PNG/JPG/分层 PSD 导出；已补 Agent 本地姿态生成与重绘；已补 Group 子图层读取、更新、删除及组内排序，并通过真实保存重开检查；已追加同父级创建分组/解组，跨组重挂载仍未开放，见 [分组合同](reference/agent-group-hierarchy-20261002.md)。

预览：<http://localhost:4173/>。项目仍在逐项复刻与验收中，**尚未达到完整一比一功能与视觉一致**。进度和未完成项见 [覆盖清单](docs/REPLICA-COVERAGE.md)，实际验收证据见 [VERIFIED.md](VERIFIED.md)。

还原只以官方线上网站和官方安装包内容为准；localhost 仅用于检查本项目实现。营销、宣传、付费、团队协作、社区及分享内容不在实现范围内。详见 [还原依据与范围](docs/REFERENCE-SCOPE.md)。

## 启动

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

已实现内容的组件目录见 [组件库](component-library/README.md)，启动后可访问 <http://localhost:4173/component-library/> 查看交互预览、调用入口和依赖边界。

使用 Node.js 服务器提供静态资源、OpenAI Agent 和本地媒体接口，不再使用 Python 静态服务器。端口为 4173，绑定 127.0.0.1。常规前端模块直接加载；修改富文本入口后运行 `pnpm build:text`，由 esbuild 打包本地 Tiptap/Markdown 编辑器。修改 Agent 输入编辑器后运行 `pnpm build:agent`。图片编辑器修改后运行 `pnpm build:image`，浮动蒙版引擎修改后运行 `pnpm build:mask`。Three.js、OpenAI SDK、Tabler、Tiptap、Fabric 均使用锁文件中的版本。

需要本地视频处理时安装 FFmpeg，或通过 `FFMPEG_PATH` 指定已有可执行文件。裁切和片场录像封装在本机执行，无需模型服务。

项目目录及逐步迁移约定见 [项目结构](docs/PROJECT-STRUCTURE.md)。图片生成菜单已迁入 `src/features/image-generation/`，含原模型图标、独立参数、次数、参数记忆及空节点尺寸过渡，详见 [菜单还原记录](reference/image-generation-menus.md)。图片节点相机控制位于 `src/features/camera-control/`，原始资源与交互依据见 [相机控件还原记录](reference/camera-control.md)。

## 当前实现

Agent新增真实只读子任务编排：继承父模型与推理配置，独立工具循环、并发调度、任务结论及取消链已接；写画布/生图生视频仍由主Agent按原权限执行。界面复用execution组件，尚无官方同态依据。关键协议验证通过，无新增依赖或E2E；长期恢复和真实模型任务质量仍待完成，见[子Agent接线](reference/agent-delegation-integration.md)。

Agent能力追加：节点全文/参数与版本读取、断连/重做/尺寸、运镜关键帧编辑与真实视频导出、仅回填重试、跨轮执行回执与历史分页已接入；内置技能13项采集可分页读取，60条缺失引用明确标注。应用详情补分类及安全Markdown。无新增依赖/E2E，关键接线检查通过；真实子Agent、长任务恢复和供应商联调仍未完成，见[本轮能力记录](reference/agent-capabilities-increment-20260930.md)。

2026-09-30 画布响应追加：分组/堆叠/文本工具栏复用尺寸缓存，多选连线移除逐ID全图扫描，文本生成浮层复用活动节点。502节点浏览器样本分组/堆叠/多选同步渲染改善约20%–30%，纯文本整页耗时未改善；坐标、引用、菜单和撤销保持，测量边界见[响应验收](reference/canvas-toolbar-response-20260930.md)。

2026-09-30 Agent模板交接已按官方hidden消息呈现，保留完整历史和来源；原生键盘选择、刷新、草稿保持及41项回归通过，见[交接验收](reference/agent-hidden-handoff-20260930.md)。另取得[官方公开应用目录与参数详情](reference/agent-app-store-public-source-20260930.md)，独立模板获取/编辑链仍未完成。

2026-09-30 响应优化追加：松手落点复用单次堆叠索引，时间线移除长媒体重复序列化，音频与节点工具栏保留按钮，3D材质减少重复赋值。重叠落点校验34.65→0.65ms；500节点完整更新1.62→约1.51ms，整页收益有限，测量范围和回归见[本轮验收](reference/canvas-response-batch-20260930.md)。

2026-09-30 Agent官方MCP卡片接通动效/创意/网站三个选择器：真实模板预览、state保存、稳定iframe和模板选择新回合；普通会话重绘保留暂停状态与输入草稿。38项聚焦回归通过，最终模板下载/编辑和另外19个专属工作流未完成，见[接线验收](reference/agent-apps-20260930.md)。

2026-09-30 媒体节点响应优化：音频播放器同步改为单次索引；3D封面和工具栏移除完整资源序列化及全页查询。201节点浏览器同步更新1.127→0.488ms（复测0.350ms），保留媒体DOM与播放进度，真实拖动/撤销和41项回归通过。测量不含GPU片场渲染，详见[媒体节点性能记录](reference/media-render-performance-20260930.md)。

Agent 聊天 HTML/Widget 卡已接真实工具、文件存储、动态高度与会话队列；普通重绘保留iframe和交互状态，失效版本/保存失败不再可操作。官方样式参数与实际键盘交互已核验；71项聚焦回归通过，原生像素及下载落盘仍待验，MCP应用卡已有三个选择器入口，其他工作流仍待接入。见[交互作品验收](reference/agent-widgets-20260930.md)。

2026-09-30 主体素材框选优化：高频输入逐帧处理，批量选择只刷新一次素材列表；500节点压力场景位置读取12,000→100，60项提交→1次，松手同步耗时74.5→4.0ms（复测72.3→4.1ms）。实际框选/追加/取消/完成及41项回归通过，坐标和顺序保持，测量范围见[框选性能记录](reference/subject-picker-performance-20260930.md)。

2026-09-30 生成等待节点优化：平移/缩放跳过擦除、扩图、重绘、打光的重复扫描，相同提示不再重写 DOM；保留浮层跟随与任务状态刷新。504 节点、90 帧对照下提示查询360→0，提示变更630→0，49项回归通过；范围与证据见[等待节点性能记录](reference/canvas-pending-performance-20260930.md)。

2026-09-30 高频输入优化：参考/首尾帧选择模式拖动改为逐帧提交，500节点同帧120事件压力样本重绘112→1次，累计同步渲染87–91→1.7–1.9ms；普通滚轮平移移除重复布局读取与菜单hidden写入。已修复拖动中缩放后继续移动的视口回退，真实选参考/连线撤销及40项回归通过。测量限定与复现见[输入响应记录](reference/canvas-input-response-20260930.md)。

2026-09-30 隐藏内容响应优化：跳过不可见节点/堆叠标题的缩放写入，500节点场景缩放同步耗时1.065→0.465–0.494ms，属性变更减少约80%；节点移出堆叠及撤销保持尺寸和坐标。另移除未选中/忙碌/展开图片的无用折叠历史深序列化，保留实时版本计数与状态。范围、测量限制和检查见[缩放记录](reference/canvas-hidden-zoom-performance-20260930.md)与[图片历史记录](reference/image-history-idle-performance-20260930.md)。

2026-09-30 响应优化追加：减少静止节点样式读取、图片版本/审核状态序列化、批量等待任务与拖线校验的重复扫描；同时修复工具栏尺寸过渡期间同步定位使用旧缓存的问题。500节点同条件更新平均2.14→1.50ms，142项聚焦测试及真实浏览器坐标/生成/版本回归通过。测量范围和边界见[响应优化记录](reference/canvas-response-additional-20260930.md)。

2026-09-30 生成状态增量：普通图片/视频、文本与音频共用官方生成按钮、hover和转圈；图片/视频/文本失败按真实任务所有权显示节点提示，确认不重试，编辑后的迟到失败不会覆盖用户内容。87项聚焦回归、21项生成结果浏览器回归及图片/文本/音频状态实机验证通过；来源与边界见 [生成状态记录](reference/generation-states-fidelity-20260930.md)。

2026-09-30 拖拽响应追加优化：深层分组改为线性可达遍历，重叠堆叠的落点校验共享单次索引。80个重叠候选压力测试平均36.90→0.65ms（复测68.72→1.18ms）；高频拖动/滚轮、坐标、撤销与生成忙态保持，具体范围和波动见 [验收记录](reference/canvas-drop-response-performance-20260930.md)。

最新响应优化：缓存工具栏尺寸、减少生成浮层布局测量，并移除文本引用的重复连线扫描和抠图全页查询。500节点同视口同步更新基准8.18→3.14ms；适用边界与交互验收见 [本轮性能记录](reference/canvas-response-next-performance-20260930.md)。

追加减少工具栏SVG与评论DOM重建、媒体URL重复解析、静止连线和焦点编辑空闲扫描，交互和测量边界见 [响应路径记录](reference/canvas-response-performance-20260930.md)。

画布性能已优化：纯视口复用布局、连线与小地图投影，同帧输入合并、工具栏与媒体历史避免重复重建。追加500节点/100堆叠场景的节点移动同步处理均值45.45→7.52ms，堆叠索引与DOM查询复用、小地图增量投影均已接入；测量限制及52节点/130连线的坐标/撤销验证见 [性能记录](reference/canvas-performance.md)。

Agent新增结构化分步提问与九字段 show_form：真实回答/提交后继续工具调用，草稿、摘要、跳过、修订和停止/刷新中断已接入。流式回复已接 OpenAI SDK、NDJSON 和增量 Markdown，支持停止、收起重开和刷新后的队列暂停；本地固定响应经真实 SDK/HTTP 验证，不代表真实模型质量。依据、实机证据与剩余边界见 [问答与设计差异](reference/agent-design-gaps.md)及[流式验收](reference/agent-streaming-20260930.md)。子Agent只读编排和当前执行循环的原生上下文整理已接线；自动重连和跨重启恢复仍待补齐。

最新并行增量：画布撤销/重命名保留实际媒体DOM，小地图已改为真实节点与视口动态投影；Agent可提取画布图片和视频抽样帧并通过OpenAI SDK回传，提示词节点/素材悬停与删除撤销已验收；3D运镜播放与对象动画分开，STEP轨迹不再出现虚假移动连线；主体库单媒体真实预览、宽度持久化及进出动效已接通。完整能力与缺口见 [Agent验收矩阵](reference/agent-capability-matrix.md)，数量和局部回归不代表全功能完成。

主体快捷入口、选择弹窗、新建侧栏及视频提示词/请求已接通，支持空主体保存、画布选材和稳定引用。个人主体管理已接网格/列表、改名、编辑、删除和批量导入；素材卡已补悬停/媒体预览及鼠标/键盘分类排序。画布选材已补实时增删、分类同步、追加框选及取消回滚，真实本地上传已验证。视觉细节和供应商适配仍待补，见 [主体库记录](reference/subject-library.md)。

生成面板提示词已接共享Tiptap、已连接素材及个人/团队素材库及主体库@引用，支持原子标签、真实剪贴板、排序/断连身份保持及文本正文提交；已接提示词展开/折叠、多类型参考横向滚动/媒体悬停/鼠标与键盘排序和模型自适应宽度，并保留多行输入；单节点生成已读取真实上游图片/视频/音频/文本，断连与旧引用缓存单步撤销；按官方节点浮层定位，修复底边遮挡；提示词/生成参数更新保留图片和视频节点，实际播放期间输入不再重建播放器，见[定位与性能验收](reference/node-composer.md)。

焦点编辑已接点选识别、候选框/切换/移除、提示词标签、剪贴板与参考连线；识别走本机任务后端，缺Key明确待配置，见[焦点编辑记录](reference/focus-edit.md)。

图片全景入口已接真实环视、取景拍摄和独立旧版片场，比例菜单新增全景选项；后端任务支持提交/查询/取消及缺配置状态，见[全景验收](reference/image-panorama.md)和[生成网关](docs/GENERATION-GATEWAY.md)。真实生成服务仍待接入。

3D资源节点已与片场分开，支持Tripo/Marble参数和参考连线、真实GLB导入/旋转预览/取景拍摄、从预览创建独立片场。取景新增19画幅、24mm默认焦距、官方安全区/FOV及4096px长边独立拍摄，见[预览记录](reference/world-preview.md)。环境新增六组官方HDRI、真实HDR/EXR导入与光照、背景切换/旋转、重命名和悬停浮层，见[环境验收](reference/world-preview-environment.md)。生成经`world.generate`可替换接口，缺Key明确失败；高斯场景、完整导航和逐像素一致性尚未完成，见[3D资源节点记录](reference/world-node.md)。

资源预览已按官方包区分物品旋转与场景环视，接入拖动惯性、滚轮焦距/触控板判定及键盘运动。宽屏场景菜单与环视已实际验证；持续键盘输入仍待浏览器验收，详见 [导航记录](reference/world-preview-navigation.md)。

画布连接点已接方向菜单、磁吸/拖线预览、正反向连接、独立选边删除与单步撤销；多选统一入口可将全部来源连入新节点。图片编辑器按官方算法自动排版关联图片为独立图层，支持保存恢复、单步撤销及清空保护。增删连线及批量连接创建不重建原节点。世界坐标和官方新节点尺寸已核对，细节与未完成项见 [连线验收](reference/canvas-connections.md) 和 [图片编辑器](reference/image-editor.md)。

Agent 音频单项/同参数批量确认已接官方模型与场景、歌词、时长、音色接口及高级参数；实际参数提交、取消与移除项已在隔离页面验收，缺少Key时明确失败。官方同状态像素/hover仍待继续，详见 [音频确认记录](reference/agent-generation-audio.md)。

Agent 文件产物侧栏已接真实存储、详情、添加到画布、对话引用和隔离HTML预览。Brainstorm 已补章节/候选切换、未读提示、选文引用、清空及互动作品生成状态；默认调用服务端 OpenAI SDK，可替换供应商接口。来源、契约和验收边界见 [产物侧栏记录](reference/agent-artifacts.md) 与 [Brainstorm 记录](reference/agent-brainstorm.md)。

- 无限画布：原区域 52 个节点、媒体和连线，平移、缩放、拖动、框选、连接、撤销重做、搜索、导入、预览和本地持久化；重置拟合当前图、空视口返回最新节点、平滑移镜和视图刷新恢复。
- 文本：Tiptap 富文本和 Markdown、H1–H3/段落/粗斜体/列表/分隔线、背景色、复制、素材库、八向缩放、全屏编辑与本地保存；独立文本生成面板接入参考素材、模型、思考强度、数量、语音、Agent 和分组工作流。
- 图片：节点参数、版本、标签、裁剪、像素缩放、切分、蒙版、标注及各类生成操作的参数界面。多角度调整已替换为原站结构：真实图片方块、旋转/倾斜/缩放、广角/重置、世界坐标定位和视图过渡；生成占位、回填、取消及过期结果保护见 [多角度验收](reference/image-angle.md)。重新打光已接入真实Three.js光源/轮廓光预览、45°吸附、分档滑杆及数值拖动，见[打光验收](reference/image-relight.md)。图片增强已接入Topaz/Magnific/皮肤三套参数、菜单/hover/刷新保存/原位生成接口，见[增强验收](reference/image-enhance.md)。调整像素已补原面板/比例锁定/变形确认/真实PNG输出及撤销，见[像素验收](reference/image-resize.md)；Pica采样待依赖确认。抠图已改为原站直接提交及结果节点hover再次抠图，见[抠图验收](reference/image-cutout.md)。扩图已补八向外框/比例/模型菜单/透明PNG与批次回填，见[扩图验收](reference/image-outpaint.md)；擦除已替换旧重绘表单，接入真实Fabric蒙版与透明原图提交，见[擦除验收](reference/image-erase.md)。标注已补原七色菜单/文字对象/对象擦除/本地PNG保存，见[标注验收](reference/image-annotation.md)。裁剪已补八手柄/原比例规则/真实像素导出，见[裁剪验收](reference/image-crop.md)。重绘已补真实蒙版/参考选图/上传/请求顺序/迟到结果保护，见[重绘验收](reference/image-redraw.md)。其余面板仍需逐项核对。
- 剪辑时间线：独立节点，真实片段选择/排序/裁剪/切割/预览、原片段ZIP、本机FFmpeg合并和导出回画布；添加菜单已区分侧栏与画布入口。独立图片编辑器已接入 Fabric 6.7.0，支持对象/图层/文字/路径/擦除/裁剪/姿态/保存与 PNG/JPG/分层 PSD；细节仍在逐态还原。
- 媒体预览：原版全屏结构、历史缩略条、提示词与元数据、主媒体切换/收藏/复制/下载；共享位置过渡、图片适屏/缩放/拖动/两级退出，视频进度/音量/全屏。见 [预览验收与边界](reference/media-preview.md)。
- 视频：原结构播放/静音/收藏/进度/全屏控制、当前/首/尾帧三级菜单与真实抽帧、直接提交分镜解析及可编辑结果回填、缩略图双手柄选区/吸附/快捷键/循环预览、本机 FFmpeg 裁切和镜头硬切检测；延长已接入独立参数菜单、@素材/主体引用；视频重拍已接入分镜时间轴与双机位Three.js控制，替换/移除已接选框、逐帧蒙层、素材选择/上传及独立分割接口；增强已按当前Topaz/FLUX双模型接入参数、约束和原位回填；未选中视频支持160ms悬停播放/移出释放。视频历史已接批次切换、悬停操作、主视频与参数恢复、独立复制、实际下载及撤销；生成任务走可替换接口。详见 [截帧与分镜解析](reference/video-capture-analysis.md)、[视频历史版本](reference/video-history.md)、[视频增强与悬停](reference/video-upscale.md)、 [视频蒙层编辑](reference/video-mask.md)、[延长与主体库](reference/video-creation.md)、[视频重拍](reference/video-reshoot.md)。剪辑详情与剩余差异见 [视频剪辑验收](reference/video-trim.md)。
- 合规验证：图片/视频菜单的独立审核状态、加载与禁用、通过/拒绝/规格受限标记及悬停提示；按素材共享结果并保护来源更换。网关未配置时明确反馈，详情见 [审核接口与验收](reference/media-review.md)。
- 音频：实际波形、播放/暂停/定位、上传与本地素材持久化；六模型目录、歌词/参数/参考素材及统一生成接口。下载仍待浏览器落盘验收。
- 3D 片场旧版：真实 Three.js 场景，原角色/摄像机 GLB与63个本地示例模型，白模/贴图、预放置与滚轮尺寸，姿态、变换、放置、锁定、复制、删除、房间、HDR、状态和基准、镜头、关键帧、PNG 拍摄、球面全景框选/环视/历史/局部层八点裁切/撤销/接口回填、四向图、视频录制、模型导入及生成回填。
- 3D 片场 2.0：按当前官方版本新增全屏工作区、导入/基础图形、对象树/变换、中心枢轴、网格/光照、保存/恢复与失败保护。已接镜头预览、比例、运镜播放/逐帧、本地视频输出、关键帧时间/姿态编辑、轨迹、缓动曲线、相机辅助显示、对象动画独立预览和撤销保存；复杂运镜、全部视觉状态与完整 Agent 联动尚未完成，不能沿用旧版完成结论；见 [新版验收与缺口](reference/studio-v2.md)。
- 语音输入：图片/视频/音频提示词与Agent共享真实录音、波形、取消、失败试听/重试和光标插入；转写走可替换接口。
- Agent：服务端 OpenAI Responses 工具循环；对话、历史、引用、执行确认、取消、结果卡片、原技能参考原文和自定义技能。历史菜单已接原双锚点、hover、行内重命名、实际删除和当前会话刷新恢复，见 [历史菜单验收](reference/agent-history.md)；消息Markdown、代码hover/复制/换行、反馈和局部分叉已接入，见 [消息验收与边界](reference/agent-messages.md)；Queue已接运行中输入、排序/编辑、串行调度和失败保留，见 [Queue验收与边界](reference/agent-queue.md)；工具步骤行、hover、耗时摘要、确认及中断记录已接真实工具循环，见 [执行记录验收](reference/agent-execution.md)；单任务图片／视频参数确认卡已接真实请求、编辑、取消及任务失败状态，见 [生成确认验收](reference/agent-generation.md)；同参数批量确认已接逐项编辑、移除/恢复和真实执行，见 [批量确认记录](reference/agent-generation-batch.md)；流式文字、等待/思考活动、取消及刷新中断已接入；上下文压缩、自动重连和子Agent编排仍待补齐。
- 堆叠画廊：真实成员关系、合并/取消/拖出、媒体浏览播放/收藏、复制删除撤销、分组/模板兼容和已落盘验收的ZIP下载；已接分阶段入场/开合/拖拽过渡和真实音频播放器；文本已按原尺寸渲染 Markdown；共享媒体预览过渡仍待补齐。
- 分组工作流：依赖分层/同层并行、停止后续调度、原节点结果回填、编辑失效保护；本地模板创建/更新/导入、参考绑定与撤销。
- 素材、历史、评论界面：已有本地实现；公共模板完整图数据、全部历史分类尚未完成。团队、社区、分享及云端协作不计入当前范围。

- 图片版本：旧版扇出支持弹簧展开/折叠、悬停放大、设主图/收藏/撤销和高清资源。新版生成批次历史已接批次切换、复制/下载、参数恢复、独立尺寸、底边中心定位、全屏与原节点生成回填，45项专项及关联回归通过。原站新版同视口视觉、云端历史与下载落盘尚未验收，见 [旧版版本](reference/image-versions.md)、[新版批次历史](reference/image-history.md)。

图标优先使用采集的原 SVG，其余使用 Tabler；不依赖自行绘制的图标。原站 Skill 正文仅作为参考数据，不提供脚本执行权限。

片场 Agent 已补专属欢迎页、上下文绑定、角度单位桥接和新版模型追加回填，见 [本轮接入与边界](reference/studio-v2-agent.md)。

Agent 添加菜单已接共用素材选择、上传附件和真实视觉输入，官方图标来源与验收边界见 [附件接入记录](reference/agent-attachments.md)。

技能引用已改为共享 Tiptap 行内节点，包含整体删除、剪贴板、刷新保存和消息呈现，见 [行内引用记录](reference/agent-skill-mention.md)。

## 模型接口

Agent 需要服务端环境变量 `OPENAI_API_KEY`、`OPENAI_MODEL`；可选 `OPENAI_BASE_URL` 必须支持 Responses API。密钥不写入前端或浏览器存储。启动服务前配置环境变量。

Agent 模型菜单的选择通过 `modelSelection.id` 提交。`Auto` 使用 `OPENAI_MODEL`，其他选项通过服务端 `AGENT_MODEL_MAP` JSON 映射，例如 `{"g-3-8-flash":"your-provider-model-id"}`。这些键是前端展示别名，不代表已接入同名官方模型；完整别名见 `src/features/agent-composer/model-catalog.mjs`。未映射选项明确返回待配置，不会退回默认模型；映射在新一轮开始时固定，工具续跑保持一致。更改映射后重启本地服务。

思考参数通过 `modelSelection.thinking` 提交，须用服务端 `AGENT_REASONING_MAP` 显式映射展示档位到 `reasoning.effort`；例如 `{"deepseek-v4-1-flash":{"low":"low","high":"high","max":"xhigh"}}`，具体值按实际供应商能力配置。未配置时不静默忽略；Auto省略思考字段。控件与验收见 [思考参数](reference/agent-thinking.md)。会话首次发送后锁定展示模型，支持调整思考强度；侧栏可拖拽并保存宽度，详见 [会话与侧栏](reference/agent-model-session.md)。

文字、图片、视频、音频、3D 模型的生成服务使用独立可替换适配器。默认经本机`/api/generation`任务后端，配置服务端`GENERATION_API_BASE_URL`和`GENERATION_API_KEY`；协议与限制见[生成网关](docs/GENERATION-GATEWAY.md)。前端“连接 API”也接受统一 `/tasks` 协议的服务；直接提供其他厂商 KEY 仍需相应协议适配。未配置时明确显示“待连接 API”，不会伪造生成成功。

详情见 [Agent/API 文档](docs/AGENT-API.md)。真实模型调用尚未联网验收。

## 数据与验收

画布和模型文件分别存储在浏览器 IndexedDB，对话、技能及部分面板状态使用 localStorage；没有云端同步。清理站点数据会移除本地编辑。原小地图保留大项目标记，而导入节点仅限已采集区域。

```sh
pnpm check
pnpm test
```

自动测试覆盖工具参数、SDK 调用循环、取消、生成适配器、世界坐标、状态隔离、模型延迟回填与取景投影。自动测试不能替代截图、实际视频内容检查及浏览器操作验收。

## 主要文件

- `app.js`、`canvas-geometry.js`、`canvas-navigation.js`、`canvas-store.js`：画布交互、坐标与保存。
- `src/features/canvas-search/core.js`、`src/features/canvas-search/ui.js`、`studio-node.js`：原节点搜索、像素留白定位与专用片场节点。
- `canvas-piles.js`、`canvas-pile-motion.js`、`canvas-piles-ui.js`、`pile-archive.js`：堆叠关系/画廊、成员移交与真实媒体ZIP。
- `canvas-groups.js`、`canvas-groups-ui.js`、`canvas-groups.css`：真实分组关系、八边缩放、颜色、宫格及本地Dagre布局。
- `feedback.js`、`feedback.css`：真实本地反馈、截图附件与可替换反馈服务。
- `src/features/studio-v2/`：新版片场界面、Three.js 运行时、模型导入/保存、变换与官方资源；`studio.mjs` 桥接旧新版。
- `studio-state.js`、`studio-camera.js`：旧版状态与镜头数学。
- `studio-environment.mjs`、`studio-environment-ui.mjs`、`studio-environment-data.mjs`：六HDRI、独立背景、房间米制图案、环境面板与持久化导入。
- `studio-panorama.mjs`、`studio-panorama-math.mjs`、`studio-panorama.css`：全景编辑器、球面方向投影、隔离回填与真实2:1捕获。
- `studio-panorama-history.mjs`、`studio-panorama-layers.mjs`：位置历史、相机恢复、独立球面编辑层合成与重新取景。
- `studio-panorama-crop.mjs`、`studio-panorama-crop-ui.mjs`：八点裁切坐标、真实合成预览、画面选中与历史悬浮预览。
- `studio-camera-ui.mjs`：原站画幅菜单、焦距刻度尺及取景器控件；景深UI依原发布版默认关闭。
- `studio-placement.mjs`、`studio-placement-ui.mjs`、`studio-library-data.mjs`：放置交互、原站层级菜单与63模型目录。
- `studio-optics.mjs`：真实景深、镜头对焦和预览/拍摄统一光学，保留功能开关与Agent接口。
- `studio-timeline.mjs`、`studio-timeline-ui.mjs`：逐对象关键帧、路径曲线、插值和时间轴交互。
- `agent-client.js`、`agent-tools.js`、`server/agent.cjs`：Agent 前端、受限工具和 SDK 循环。
- `generation-api.js`、`generation-ui.js`：生成任务及结果回填。
- `canvas-text.js`、`canvas-text-ui.js/css`、`text-generation-ui.js`：文本语义、富文本交互及模型参数。
- `text-editor-entry.mjs`、`scripts/build-text-editor.cjs`：本地 Tiptap/Markdown 入口与打包。
- `workflow-core.js`、`workflow-ui.js`：分组依赖执行、停止调度和失效保护。
- `templates-core.js`、`templates-ui.js`、`workflow.css`：本地模板持久化、原弹层和世界坐标导入。
- `audio-core.js`、`audio-ui.js`、`audio.css`：音频目录、校验、真实播放器与生成编辑器。
- `voice-core.js`、`voice-input.js`、`voice-input.css`、`server/voice.cjs`：共享语音输入和SDK转写。
- `server/media.cjs`、`media-tools.js`：本机 FFmpeg 视频操作。
- `reference/`：原站界面、SVG、Skill 和公共资源参考；`qa/`：验收产物。


### 片场共享输入区增量

中央与 Agent 侧栏已共享会话草稿、模型状态及已发送标记，并补原三条占位文字轮播；已有模型场景恢复自动打开 Agent。228 模块语法检查与 33 项 Agent 回归通过，已人工验证双向编辑、刷新恢复和缺少 Key 的实际错误。富文本引用、添加菜单和完整附件仍待还原。详见 [记录](reference/studio-composer.md)。

Agent `@` 节点/应用/素材库引用的实现、官方证据和未完成边界见 [引用还原记录](reference/agent-references.md)。

视频生成规格开始替换通用参数：已提取的12个模型按方式/输入显示选项，支持横向时长、Seedance2.5数值输入、声音与真实请求映射；旧模型与首尾帧专用参考槽仍待补齐，见[视频规格验收](reference/video-generation-specs.md)。


2026-09-30并行增量：Agent已接带确认/版本校验/幂等提交的个人技能保存与生成确认素材原子编辑；3D新增跨相机、运镜和普通对象统一历史；原始52节点画布纯平移已消除重复节点/边属性写入。各项证据、未完成状态和供应商边界见 [覆盖清单](docs/REPLICA-COVERAGE.md)。

2026-09-30 编辑响应优化：去除整图重复保存，素材完整后一次入图，堆叠长文本预览改为字段快照，小地图关闭时停止图扫描与SVG更新；500节点浏览器保存/撤销/投影验收及性能边界见 [验收记录](reference/canvas-response-edit-performance-20260930.md)。

2026-09-30 图片与审核监听优化：图片load只刷新自身，审核徽标按节点失效，减少拖动时的重复尺寸读取及DOM扫描。500节点同条件同步更新平均3.20ms→2.15–2.22ms；50项回归及审核27项浏览器验收通过，范围与限制见 [性能记录](reference/canvas-listeners-performance-20260930.md)。
