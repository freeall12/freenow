# 项目结构与迁移约定

当前入口是 `index.html`，由 `server/server.cjs` 在 4173 端口提供静态文件和本机 API。保持现有 pnpm、esbuild 和原生模块加载方式。

新增功能按业务收拢到 `src/features/<feature>/`，不再向项目根目录增加平铺的业务文件。现有模块在修改对应功能时逐步迁移；项目根目录的旧模块仍是实际运行依赖，尚未完成全项目迁移。

## 已落地的功能目录

### 视频工具目录

视频模块已从根目录整体迁入以下业务目录；`index.html` 直接加载 `video-tools/entry.js`，不保留根目录兼容壳。

| 目录（均在 `src/features/` 下） | 文件与职责 |
| --- | --- |
| `video-tools/` | `entry.js`：画布视频工具桥接、菜单及按需加载 |
| `video-creation/` | `core.mjs`、`ui.mjs`：创建、延长视频及参数面板 |
| `video-analysis/` | `ui.mjs`：视频解析面板与任务交互 |
| `video-capture/` | `core.mjs`：取帧与本机捕获 |
| `video-media/` | `frames.mjs`：共享帧读取 |
| `video-history/` | `core.mjs`、`ui.mjs`、`icons.mjs`、`styles.css`：历史数据、卡片与样式 |
| `video-mask/` | `core.mjs`、`ui.mjs`、`icons.mjs`、`segmentation.mjs`、`recovery.mjs`：蒙层编辑、分割客户端、原UUID恢复与受守卫保存；隔离验收在本目录 `qa/` |
| `video-reshoot/` | `core.mjs`、`ui.mjs`、`icons.mjs`、`stage.mjs`：重拍参数、预览及片场 |
| `video-trim/` | `core.mjs`、`ui.mjs`：剪辑范围、检测与本机处理 |
| `video-upscale/` | `core.mjs`、`ui.mjs`、`icons.mjs`：增强参数与任务交互 |

现有 `video-generation/` 保存节点生成规格；上述工具不与它合并。服务端仍在 `server/`；接口地址、节点存储身份、图标来源和模型适配合同不因源码搬迁变化。模块内部相对导入与 `new URL('./styles.css', import.meta.url)` 按所在目录解析；媒体输入继续相对页面 origin 解析。后续移动其他模块也需核对经典脚本中的动态导入、组件 catalog、静态 QA 入口及 VM 测试夹具。


`src/features/generation-results/`

- `plan.mjs`、`workflow.mjs`、`counts.mjs`：生成结果布局、事务编排、模型数量规则；画布事务的宿主桥接保留在 `app.js`。
- `entry.mjs`、`preferences.mjs/css`：账户入口与画布默认结果模式，排除计费/团队等导航。
- `action-button.mjs/css`：跨普通图片/视频、文本和音频的官方生成按钮与忙态。
- `pending-ui.mjs/css`：真实运行标记对应的媒体动效与文本骨架。
- `error-state.mjs`、`failure-bridge.mjs`、`error-ui.mjs/css`：失败收据、过期保护与展示；`generation-ui.js`只负责任务终态与画布所有权桥接。
- 功能契约见同目录README、pending-ui.md和error-ui.md；供应商KEY只留在原网关接口，不进入节点展示模块。


`src/features/world-node/`

- `model.mjs`：独立3D资源节点工厂、模型目录、引用约束和生成请求，不依赖DOM。
- `entry.mjs`、`styles.css`：资源节点与生成菜单/参考选择的画布桥接。
- `resource.mjs`：GLB导入、缩略图、独立WebGL预览、取景拍摄、创建独立片场；复用既有`studio-v2/model-io.mjs`。
- `preview-environment.mjs`、`preview-environment-ui.mjs`：HDR/EXR 解码、PMREM 光照、背景/旋转和环境菜单；`preview-tooltips.mjs`：滚动工具栏之外的悬停浮层。来源与验证见 `reference/world-preview-environment.md`。
- `icons.mjs`：已安装Tabler原始SVG；模型品牌图标来自官方发布包，保存于`assets/world-model-*.svg`。
- `world`只存资源/生成参数，`studio`存可编辑场景。接口、证据和未完成项见`reference/world-node.md`，不能把两种节点合并。

`src/features/image-editor/`

- `linked-images.mjs`：关联输入过滤、可取消的并发加载、独立图片排版及已初始化文档判断；纯布局计算不依赖视口或世界坐标。
- 根目录 `image-editor-entry.mjs` 暂保留 Fabric 生命周期桥接，检查编辑/关闭/来源变化后再应用排版。构建仍使用现有 `pnpm build:image`。

`src/features/image-generation/`

- `catalog.mjs`：模型目录、规格约束、各模型参数记忆、供应商参数映射和空节点尺寸计算。没有 DOM 依赖。
- `request.mjs`：统一图片生成请求准备，使用真实提交输入校验并映射模型和相机参数。
- `capabilities.mjs`：官方创作输入上限、图生图能力和 Midjourney 分类参考数量校验。
- `assets.mjs`：从原站菜单采集的模型图标、徽章文案和参数 SVG。不是自行绘制的图标。
- `menus.mjs`：模型、规格与数量菜单，原生按钮和键盘交互。
- `menus.css`：菜单尺寸、悬停、选中与过渡。
- `layout.mjs`：空节点变形时的临时渲染位置。最终状态只提交一次，节点与连线共用过渡位置。

`node-editor.js` 暂作为旧节点编辑器与新图片生成模块的桥接入口。视频与参考图面板仍在旧入口，后续按各自业务迁移。不要在新图片模块里加入这些功能的分支。

`src/features/camera-control/`

- `catalog.mjs`、`assets.mjs`：官方设备目录与原始图标。
- `settings.mjs`：参数映射、旧节点迁移与本地偏好。
- `controls.mjs`、`controls.css`：相机滚轮、开关与悬停详情。

`src/features/prompt-shortcuts/`

- `catalog.mjs`：五项官方预设原文与已核对的 Tabler SVG。
- `menu.mjs`、`menu.css`：提示词斜杠菜单、键盘/鼠标、参考图门槛和过渡。
- 生成经现有图片任务接口提交，详细依据见 `reference/prompt-shortcuts.md`。

`src/features/canvas-search/`

- `core.js`、`ui.js`、`icons.js`、`styles.css`：现有节点搜索、排名、定位算法与交互资源从根目录迁入。
- 主入口、组件目录、Node调用与既有QA页面同步引用，保留原全局接口。样式仍兼容旧片场节点共享规则，未另复制一套。
- `app.js` 仅负责画布选择与动画桥接；屏幕固定的编辑器不参与搜索世界边界计算。

`src/features/agent-composer/`

- `confirmation.mjs`、`confirmation-icons.mjs`、`confirmation.css`：Agent确认模式偏好、原始图标、菜单/tooltip及生命周期。
- `model-catalog.mjs`、`model-icons.mjs`、`models.mjs`、`models.css`：官方模型菜单展示目录、原始资源、更多模型折叠与悬停说明，选择全局持久化。
- `thinking-catalog.mjs`、`thinking-settings.mjs`：官方目录元数据与纯参数规范；服务端复用同一份校验。`thinking-control.mjs`、`thinking.css`：粒子滑杆/开关及生命周期；`hover-intent.mjs`：模型说明浮层轨迹容错。
- `agent-client.js` 保留对话与工具队列桥接，读取全局确认偏好和模型选择。`server/agent-models.cjs` 校验服务端模型映射；OpenAI SDK只使用服务端解析的模型。
- `model-session.mjs`：首次模型绑定及旧会话未知身份保护；`tooltip.mjs`：锁定提示；`footer-layout.mjs`、`footer.css`：底栏分组及自适应；`panel-resize.mjs`：侧栏指针拖拽与宽度记忆。

`src/features/agent-history/`

- `conversations.mjs`：历史条目、排序、标题和时间规则。
- `menu.mjs`、`styles.css`、`icons.mjs`：原历史菜单、重命名/删除/分页、两种锚点、官方及 Tabler 图标；读写通过回调，复用真实会话。
- `agent-client.js` 保留存储桥接及当前会话 ID，历史 UI 不再平铺在根入口。

## 边界

- `src/features/` 放运行时业务实现；原始网页、截图、外部报告索引放 `reference/`。
- `server/` 放服务端、媒体处理和供应商适配；密钥仅在服务端配置。
- `assets/` 放运行时静态媒体和已打包的编辑器资源。
- `component-library/` 是现有组件目录与复用入口，不复制一套业务实现。
- `qa/` 保留已有验证工具；不通过增加无意义的测试数量衡量完成度。
- `scripts/check.cjs` 检查根入口、`server/` 和 `src/` 的语法；功能验收必须有实际交互证据。

迁移时更新真实导入路径和组件目录，维持已有调用方；不批量移动文件后再依赖路径别名掩盖错误。每次迁移都应对应实际业务改动。


`src/features/agent-artifacts/`

- `model.mjs`、`store.mjs`：画布作用域的虚拟文件、修订冲突、分页读取及 IndexedDB 原子写入。
- `panel.mjs`、`layout.mjs`、`styles.css`、`icons.mjs`：官方文件侧栏、分组、普通详情、尺寸拖拽和官方/Tabler 图标。
- `html-preview.mjs`：隔离互动预览、HTML下载与分享服务适配器；不含供应商Key。
- `brainstorm-model.mjs`、`brainstorm.mjs`：官方结构化 Markdown 解析、章节与候选、未读状态、清空和作品入口。
- `brainstorm-menu.mjs`、`selection-quote.mjs`：菜单键盘/退场及真实文字选区引用。
- `generation.mjs`：独立于面板生命周期的生成状态、来源修订快照和结果保存。
- `server/agent-artifacts.cjs`：OpenAI Responses 生成 HTML 的服务端边界；可替换前端适配器。
- `agent-client.js` 是工具、会话引用和画布操作的现有桥接。


`src/features/studio-v2/`

- `entry.mjs`、`runtime.mjs`：新版全屏工作区生命周期、场景与持久化；旧版由 `studio.mjs` 桥接，既有状态暂不迁移。
- `ui.mjs`、`scene-panel.mjs`、`properties.mjs`、`dom.mjs`：空态、导入、光照、对象树、变换数值与错误重试。
- `model-io.mjs`：GLTF 关联资源、尺寸校验、解码、GLB 导出；`navigation.mjs`、`centered-transform.mjs`、`selection-box.mjs`、`display-materials.mjs`、`grid.mjs`：导航和实际渲染。
- `official-layout.css`、`classes.mjs`、`icons.mjs`：有来源的官方样式与 SVG；`styles.css` 为集成样式。详细限制见 `reference/studio-v2.md`。

- Studio 2.0 `playback.mjs` 管理动画分类/播放与初始姿态隔离，`shot-renderer.mjs` 独立镜头渲染，`shot-preview.mjs` 官方预览控件，`video-export.mjs` 本机视频输出。预览元数据按 `provenance.kind=studio-render` 排除默认生成模型回退。

- Studio 2.0 `motion-data.mjs` 负责相机父链隔离及关键帧数学，`motion-editor.mjs` 管理运镜历史、轨迹与世界手柄，`motion-ui.mjs` 管理官方时间轴/属性面板。

- Studio 2.0 `motion-easing.mjs` 管理时间映射与采样，`motion-easing-io.mjs` 管理官方 glTF 曲线元数据往返，`motion-easing-ui.mjs` 管理曲线浮层和控制柄。

- Studio 2.0 `camera-presentations.mjs` 管理官方相机辅助几何与显示，`object-inspector.mjs` 管理对象折叠属性面板和动画镜头关键帧入口。

- `src/features/agent-scene/`：片场专属 Agent 欢迎页、样式与弧度/能力边界桥接。
- `src/features/studio-v2/generated-models.mjs`：新版模型生成结果批量校验、追加、并发保护与幂等保存。

- `src/features/agent-scene/composer-channel.mjs`、`studio-composer.mjs`、`typing-placeholder.mjs`：片场双输入区共享会话草稿与原站占位轮播。

- `src/features/agent-attachments/`：共用添加菜单、官方图标、素材多选、附件存储和实际图片/视频采样；服务端视觉校验位于 `server/agent-media.cjs`。

- `src/features/agent-composer/editor-entry.mjs`、`editor-state.mjs`、`editor.css`：共享Tiptap编辑器、语义草稿及官方技能行内标签。`scripts/build-agent-editor.cjs` 使用既有esbuild输出浏览器ESM。
- `src/features/agent-composer/reference-{data,picker,node,preview,icons}.mjs`：真实节点/素材库/应用引用、官方 @ 菜单、语义节点及素材预览；复用共享输入编辑器。
- `src/features/agent-manager/`：官方应用目录/图标、技能管理UI、校验与应用适配状态；与引用菜单共享 `registry.mjs`，不在旧 `agent-client.js` 内继续堆叠页面。
- `src/features/agent-manager/app-detail.mjs`：应用详情固定标题/滚动正文/底栏、官方示例与技能行、分操作异步忙态；`manager.mjs` 保留卸载确认、引用插入和视图失效保护，`model.mjs` 要求安装适配器明确回执。来源与未完成的副标题、Markdown、connector/安装状态、4173存储配额及原生同态验收见 `reference/agent-manager-detail-20260930.md`。
- `src/features/agent-manager/skill-package.mjs`：包内路径、导入、分页与草稿引用迁移；`markdown.mjs` 复用Tiptap解析器，由现有Agent构建打包。
- `src/features/agent-messages/`：官方Markdown样式、安全解析、消息/代码操作、分叉数据及阅读位置管理；解析器复用 `assets/agent-editor.js`，界面模块独立加载。

Agent 流式会话按边界拆分：`src/features/agent-stream/transport.mjs` 处理 NDJSON/JSON、取消、断流与完整工具调用校验；`state.mjs` 处理逐轮消息、终态合并、刷新中断和逐帧批处理。`agent-messages/streaming.mjs` 负责增量 Markdown DOM、官方等待/思考动效与中断提示；`messages.mjs` 管理消息行、动作占位与终态操作。根 `agent-client.js` 保留会话/队列/工具宿主桥接，不直接解析事件字节。`server/agent-stream.cjs` 负责 SDK 流事件与 HTTP 写出，`server/agent.cjs` 继续拥有会话、参数验证和工具等待屏障。接口见 `docs/AGENT-API.md`；`qa/agent-stream-*` 仅为显式本地固定响应验收入口，不能用于生产推理。
- `src/features/agent-queue/`：提交快照/恢复、串行运行器、队列排序和原站输入区顶层面板；`agent-client.js` 仅连接当前会话、持久化及既有Agent请求。

## Agent 执行记录

`src/features/agent-execution/`：`trace.mjs` 负责真实执行与确认、中止、刷新恢复；`presentation.mjs` 映射本地工具说明；`view.mjs` 与 `styles.css` 负责步骤行、折叠摘要和确认卡。`icons.mjs` 保存官方 SVG 几何。`agent-client.js` 仅负责接入消息、工具、对话持久化及场景绑定。

`src/features/agent-generation/`

- `model.mjs`：生成草稿、模型能力、可编辑参数白名单与确认校验。
- `video-catalog.mjs`、`icons.mjs`：官方发布目录和原始图标。
- `card.mjs`、`menu.mjs`、`styles.css`：单任务确认卡、参数菜单、时长选择与生命周期。
- `jobs.mjs`：taskId匹配、有限状态快照、刷新恢复；不保存生成媒体正文。
- `agent-client.js` 保留工具桥接；`generation-ui.js` 在结果应用结束时通知订阅者。

- `agent-generation/batch.mjs`：同参数相邻请求分组、共享参数交集、逐项拒绝与实际提交；仅为内部编排，不添加新的对外工具。`trace.mjs/jobs.mjs` 递归恢复子项并匹配实际任务。

`src/features/agent-generation/audio.mjs`、`audio-assets.mjs`：官方Agent音频目录、原模型/标题图标、参数与请求映射、引用快照；复用该目录已有card/menu/batch模块。根目录`audio-ui.js`只增加现有请求构造与音色provider桥接，旧节点参数规则继续由`audio-core.js`维护。

`src/features/canvas-connections/`

- `geometry.mjs`：官方贝塞尔几何、连接方向、菜单翻转及媒体兼容规则。
- `layer.mjs`：增量 SVG 路径、20单位命中区、端点/边选中样式及真实状态动画。
- `entry.mjs`、`menu.mjs`、`styles.css`、`icons.mjs`：指针/键盘、磁吸、临时预览、官方菜单与有来源的图标。
- `app.js` 仅保留原图历史/持久化及原子节点+边创建；不在菜单模块复制画布存储。验收和边界见 `reference/canvas-connections.md`。


多选连线继续放在 `src/features/canvas-connections/selection.mjs`（交互）与 `selection-model.mjs`（排序、兼容性、世界坐标、模型选择）；`app.js:addSelectionConnectionNode` 只负责一次历史和增量图写入。官方源码证据在 `reference/canvas-selection-connections-official-source.txt`，验收数据在同目录 `canvas-selection-connections-qa.json`。

`src/features/world-node/`：独立资源节点及生成配置。`preview-optics.mjs`负责官方投影/安全区/输出尺寸，`preview-chrome.mjs`负责菜单、标尺、指引与焦点；`resource.mjs`只负责资产读取、Three渲染、高清拍摄和独立片场桥接。来源见`reference/world-preview.md`。

资源预览导航由 `world-node/navigation-motion.mjs` 负责纯数学与运动状态，`preview-navigation.mjs` 负责输入/焦点/卸载；环境由 `preview-environment.mjs` 与 `preview-environment-ui.mjs` 管理。与 `studio-v2/navigation.mjs` 分离，避免混用两种官方入口的规则。

## 图片全景与任务后端

`src/features/image-panorama/`：自然图像尺寸检测、360入口、悬停提示及Tabler原始图标。`src/features/world-node/panorama-stage.mjs`：Three等距柱状背景、全景片场快照；共用resource预览。

`server/generation.cjs`：本机任务路由与可替换提供方，复用`generation-api.js`生命周期。入口`server/server.cjs`，前端默认由`generation-ui.js`调用。契约见`docs/GENERATION-GATEWAY.md`。


`src/features/focus-edit/`：entry管理模式与标记，model校验候选与token，prompt管理安全渲染/序列化/剪贴板，styles/icons维护官方样式与原始资源。节点编辑器只保留入口和保存桥接，识别复用生成任务后端。


`src/features/node-composer/`：官方生成浮层的屏幕空间布局、内容高度/折叠、参考图滚动和响应样式；`icons.mjs`保留原版折叠图标及既有Tabler图标；`reference-preview.mjs`管理参考图portal/悬停生命周期，`reference-sort.mjs`管理指针与键盘排序，`references.mjs`组装参考行；`reference-model.mjs`负责实时连线/旧配置到类型输入的统一解析，`audio-preview.mjs`负责真实音频波形生命周期。`node-editor.js`只调用布局并传入实际显示几何；`app.js`对纯generation更新保留原节点DOM，图撤销/保存仍留在画布核心。

节点提示词：`src/features/node-composer/prompt-state.mjs` 为无DOM的token/身份映射与提交展开；`prompt-editor.mjs` 负责Tiptap/已连接@菜单。通过现有 `src/features/agent-composer/editor-entry.mjs` 导出并以 `pnpm build:agent` 更新 `assets/agent-editor.js`，共享已安装依赖，不新增根目录构建入口。`reference-preview.mjs` 参数化缩略条即时hover与行内标签300ms hover。

节点素材库：`src/features/node-composer/library-mentions.mjs` 负责官方Asset快照/解析/媒体投影及模型策略，`library-picker.mjs` 负责目录/搜索/键盘/媒体hover；通过CanvasLibrary读取本地素材和目录。`generation-request.mjs` 为GenerationAPI共用的请求准备入口，引用解析后调用既有图片参数准备，不重复编辑器文本展开。

`src/features/video-generation/`：settings.mjs负责官方视频规格、输入匹配与请求参数；menus.mjs/menus.css负责节点菜单。复用agent-generation/video-catalog.mjs的官方数据，不复制模型目录。node-editor.js保留面板宿主与保存调用；generation-request.mjs统一投影后校验。

`src/features/video-generation/draft-final.mjs`：样片身份、实时唯一引用和独立正式片节点规划；`draft-final-workflow.mjs`：画布/Agent/重试共用提交与迟到结果守卫；`draft-final-ui.mjs/.css`及`draft-final-icons.mjs`：官方样片tabs、定稿卡、原始SVG与动效。`src/features/agent-generation/draft-final.mjs`和`draft-final-card.mjs`复用该语义提供审批指纹与确认卡，禁止普通生成回退。验收见`reference/seedance-draft-final-gap.md`。

`src/features/video-generation/frames.mjs` / `frames.css`：首尾帧槽与画布图片选择覆盖层，复用现有引用模型和网关，不增依赖。

`src/features/canvas-reference-picker/`：共享画布参考选择生命周期、候选、来源遮罩、悬停标签、平移和返回视口；从视频首尾帧模块提取，图片和视频生成面板共用。 平移输入在本模块逐帧合并，导航交错结束旧手势，关闭/失效清理帧及pointer capture；回归与压力样本见 `reference/canvas-input-response-20260930.md`。

## 主体库

`src/features/subject-library/`：`store.mjs` 本地持久化，`model.mjs` 稳定引用与请求快照，`entry.mjs` 选择弹窗/快捷入口，`editor.mjs` 编辑侧栏，`canvas-picker.mjs` 独立画布多选，`ui.mjs` / `styles.css` / `icons.mjs` 原样式和 SVG。根 `subject-library.mjs` 仅保留既有消费者兼容导出。验收边界见 `reference/subject-library.md`。

个人管理补充：`subject-library/manager.mjs`、`manager-preview.mjs`、`manager-icons.mjs` 与 `apply.mjs` 分别负责管理状态、预览、成熟图标和原子批量导入。`sidebars.js` 仅保留路由桥接。团队/社区/分享不再作为迁移或验收目标。

主体素材卡补充：`asset-preview.mjs` 负责悬停与模态媒体生命周期，`asset-sort.mjs` 负责指针/键盘排序及分类槽位映射，`asset-icons.mjs` 收录已安装Tabler SVG。名称输入仅更新保存按钮，不重建素材卡。

主体选材事务：`selection-session.mjs` 保存选择会话的增删与原顺序，`canvas-picker.mjs` 只负责指针/键盘/候选覆盖层。Agent个人技能提交统一在 `agent-manager/skill-commit.mjs`，生成确认提示词组件在 `agent-generation/prompt.mjs`、`prompt-editor.mjs`，避免扩大根文件职责。


主体共用媒体与布局：`subject-library/preview-media.mjs` 负责实际播放器/波形及销毁，`panel-layout.mjs` 负责宽度持久化与进出动效；manager与editor共用。
Agent视觉回路：`agent-vision/inspect.mjs` 提取媒体并临时关联像素，`server/agent-vision.cjs` 验证待执行节点和SDK图片工具结果，像素不进入持久化trace。Agent提示词悬停独立在 `agent-generation/prompt-preview.mjs`、`prompt-subject-preview.mjs`。3D轨迹渲染独立在 `studio-v2/motion-overlay.mjs`。

`agent-questions/` 负责分步问答状态、视图和样式；`agent-question-runtime/waiter.mjs` 负责真实等待/取消与调用身份绑定。agent-client只接宿主与主输入路由，工具schema与服务端SDK续轮继续使用现有入口。
动态小地图在 `canvas-minimap/{geometry.mjs,entry.mjs,styles.css}`，app.js只提供实际布局与视口桥接。

## Agent 表单与片场拍摄

- `src/features/agent-forms/`：表单规范/九类控件/样式/Tabler图标，组件不直接操作SDK。
- `src/features/agent-form-runtime/waiter.mjs`：等待、取消和提交边界；与已有question waiter共享生命周期。
- `src/features/agent-composer/shortcuts.mjs`：独立安装/释放Cmd或Ctrl+J监听。
- `src/features/studio-v2/scene-capture.mjs`：拍摄机位、离屏渲染、PNG与画布持久化编排；渲染复用shot-renderer，路由沿runtime/entry/agent-scene bridge。
- `qa/studio-capture-controls.mjs`：显式查询参数启用的本地手动验收按钮，不进入正式页面、不提供伪模型结果。

高频手势队列暂沿用根目录canvas-navigation与app入口，未在性能修改中大范围移动旧代码。后续迁移须保留静态页面的加载顺序与对外桥接。


### 新版片场 Agent 动画边界

- `src/features/studio-v2/scene-keyframes.mjs`：副本文档中写入相机/对象姿态、GLB验证、原子应用与撤销；时间与坐标合同在 `docs/AGENT-STUDIO-KEYFRAMES.md`。
- `src/features/studio-v2/scene-playback.mjs`：Agent预览播放与seek校验，复用`playback.mjs`，不改轨道。
- `src/features/agent-scene/studio-bridge.mjs`：版本能力检查、Agent弧度与编辑器角度转换。
- `qa/studio-capture-controls.mjs`、`qa/studio-v2-mixed-easing.gltf`：仅显式QA入口使用的真实工具手动验收与混合插值素材；不是生产模型输出或官方设计依据。

- `src/features/studio-v2/scene-settings.mjs`：Agent画幅/光照验证、原子更新、持久化与已应用错误语义；UI仍共用runtime setter。无新图标/框架/生成依赖。

## Agent 交互作品卡

`src/features/agent-widgets/`：`tools.mjs`验证展示参数/文件收据，`cards.mjs`管理卡片与官方双iframe，`integration.mjs`绑定会话/版本/队列。`widget-proxy.html`复用官方文件；`styles.css`/`icons.mjs`保存官方呈现。接口、权限、失败与测试见该目录 `README.md`。宿主和执行区使用 `agent-messages/reconcile.mjs` 保持连接中的iframe，避免普通会话重绘清空Widget。MCP应用运行时不并入此模块。

## Agent MCP Apps

`src/features/agent-apps/` 独立管理官方版本模板、registry、JSON-RPC宿主、卡片和会话接线；自由HTML/Widget继续位于`agent-widgets`。资源存在不等于业务工作流完成。接口与剩余范围见该目录README和`reference/agent-apps-20260930.md`。

`src/features/studio-v2/viewport-shortcuts.mjs` 集中新版片场的键盘事件过滤与快捷键分发；视口焦点交接仍由场景树、对象检查器和工具栏所属feature执行。
