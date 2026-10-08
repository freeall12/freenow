# 功能截图与复现

## 2026-10-08 时间轴与已有照片只读相册

独立公开验收项目使用真实生产入口、公开餐椅模型和已有本地 JPEG，不包含私人项目、供应商 Key 或模型生成。相册图为实际1280×720完整视口；其余三图为1280×637生产iframe区域截图，不冒充完整视口，无拼接或修图。[本批交互与范围](../verification/20261008-studio-temporal.md)

| 证据 | 范围 |
| --- | --- |
| [餐椅单目标时间轴](20261008-studio-temporal/timeline-chair.jpg) | 0/3000ms的X0→3与1500ms实际rootX1.5/base0；拖动单笔undo、匀速/时长阻断、循环不改revision与reload keys分别实机验。 |
| [历史照片只读相册](20261008-studio-temporal/photo-history.jpg) | 两张已有本地 JPEG 实际解码为1280×678；逆序、160px缩略图、方向键与Escape关闭已验。图片仅被读取，相册不恢复摄像机、不重渲染、不导出或生成新素材；普通快门不追加capturedPhotos。 |
| [关键帧相机拍摄](20261008-studio-temporal/keyed-shutter.jpg) | 35→36.396mm写key后真实快门成功且HUD保持；第二次ArrowRight同key至37.848mm，base35保持。 |
| [关键帧快门画布结果](20261008-studio-temporal/keyed-photo-nodes.jpg) | 实际4096×2304 JPEG节点与连线；完成/返回/reload revision18、ready/dirty=false、key37.848mm/base35，原相册仍2项。 |
| [公开QA状态回读](20261008-studio-temporal/temporal-state.json) | 已保存作者keys/base、runtime根、只读相册与持久状态诊断，不是渲染截图或全产品测试。 |

完整P2、模型导入/生成流程及V3 Agent尚未完成，真实SPZ像素未验，旧Alpha不含此批；时间轨道预览不能视为作者base的持久修改。

## 2026-10-08 离屏摄影、实体轮廓与镜头导出

独立本机 4196 的公开验收项目使用生产入口、本地人物/餐椅模型和空供应商 Key。以下六张 JPEG 来自实际 1280×720 浏览器视口，直接裁取 `(0,42,1280,678)` 生产 iframe，成图 1280×678；只去除 QA 顶栏，没有拼接或修图，不能称为完整原始视口。

| 证据 | 范围 |
| --- | --- |
| [镜头管理](20261008-studio-shots/camera-manager.jpg) | 真实独立机位 JPEG 缩略图，竖幅实际 101×180；改名保存、删除/撤销与分层 Escape 已验。 |
| [人物身体轮廓](20261008-studio-shots/actor-selection-outline.jpg) | 实际橙色 WebGL 身体轮廓；摄影排除该编辑描边。 |
| [画布照片与连线](20261008-studio-shots/canvas-photo-nodes.jpg) | 真实快门 JPEG、镜头输出节点及连接，不是浏览器视口放大图。 |
| [竖幅照片保存重试](20261008-studio-shots/portrait-photo-save-retry.jpg) | 2304×4096 JPEG 的保存错误与“重试保存照片”；重试和刷新复用原 capture ID、节点及素材。 |
| [原批次恢复与重试](20261008-studio-shots/batch-save-retry.jpg) | 两次 QuotaExceededError 后关闭/重开恢复原选中镜头，重试及刷新保留一个同回执输出节点。 |
| [资源守卫修复后竖幅快门](20261008-studio-shots/portrait-shutter.jpg) | 刷新生产代码后重新真实拍摄成功，显示“照片已保存到画布”，warn/error 日志为空。 |
| [真实动态 WebM](20261008-studio-shots/dynamic-chair.webm) | 浏览器编码的公开餐椅镜头：VP9、1280×720、30 fps、1 秒、56,649 bytes；完整解码 30 帧且 30 帧不同，0/15/29 帧非黑并有餐椅与地面。 |

[主验收记录](../verification/20261008-studio-shots.md)与[独立视频文件审核](../verification/20261008-studio-shots-video.json)记录操作、持久 ID 和解码结果。真实 SPZ 离屏 GPU/景深像素未实机验，GLB 景深和持物渲染尚未实现；当时尚无时间轴与只读历史相册，其最新子集以上方新证据为准；完整视图管理和 V3 Agent 仍未完成。现有 Alpha 不含此批源码；没有私人素材、供应商或原站请求。

## 2026-10-08 前批摄像机接管与 viewport PNG 照片

独立公开验收项目运行在本机4196，使用生产入口、原本地人物模型、零供应商Key。以下三张由CUA直接截图，截取1280×720中的 `(0,42,1280,678)` 生产iframe区域，只去除QA顶栏，无样式替换或拼接。

| 截图 | 范围 |
| --- | --- |
| [摄像机操控HUD](20261008-studio-camera/possession-portrait.jpg) | 29mm／9:16、真实光学滑尺与快门、GLB没有光圈/景深按钮；成功拍摄后仍保留接管 |
| [照片失败与守卫](20261008-studio-camera/photo-save-retry.jpg) | 两笔真实保存边界失败，HUD禁用非重试操作；返回/恢复视图/Escape保留镜头，文案明确先重试照片 |
| [画布照片与连线](20261008-studio-camera/canvas-photos.jpg) | 正式画布在45%缩放下的片场与PNG连接；实际五张763×1356，刷新同ID且全部解码，不代表任意4K离屏输出 |

操作、最终revision6与定向检查范围见[前批摄像机记录](../STUDIO-V3-CAMERA-POSSESSION-20261008.md)。上述 PNG 与尺寸保留为历史里程碑；当前离屏 JPEG 能力以上方最新记录为准。时间轴与只读相册的后续补齐以上方新证据为准；完整平面图/视图管理和 V3 Agent 仍未完成，现有 Alpha 未包含这批源码。

## 2026-10-08 导演片场实体与镜头

本地 4196 的真实生产工作区，公开人物／餐椅模型，模型 Key 为空。原始截图和两次真实存档回读集中在 `20261008-studio-entities/`，没有修图或模型生成。

| 截图 | 范围 |
| --- | --- |
| [人物属性与落地](20261008-studio-entities/actor-pose-ground.png) | 实际绿色 Sitting、坐标和属性；九姿态有实际 GLB／DOM 专项，未把全部鼠标路径算已验 |
| [状态删除确认](20261008-studio-entities/state-delete-confirm.png) | 父菜单保留、子确认和官方文案；Escape／保留／确认／最后状态与撤销重做实机通过 |
| [50mm 竖幅镜头](20261008-studio-entities/camera-portrait-preview.png) | 保存刷新后的真实 9:16 预览与黑边；普通 GLB 没有景深虚化 |

具体操作、最终 revision 32 及尚未实现的功能见[本批实体与镜头验收](../STUDIO-V3-ENTITIES-20261008.md)。

## 2026-10-07 生产画布与节点入口

| 文件 | 实际内容与来源 |
| --- | --- |
| [首页画布原图](freenow-canvas-workflow-20261007.jpg) | 4195 独立新建的生产入口画布，CDP 正常 1448×1566 完整视口；通过正式 UI 编辑文本、创建 3D 片场与立方体，导入本批安装包片场截图为图片、8 秒 `qa/trim-scenes.mp4` 蓝色帧视频和 6 秒本地合成旋律 WAV。 |
| [画布高分辨率图](freenow-canvas-social-20261007.jpg) | 同一正式画布。原 6645×7188 工具截图按实际 DOM 区域 `(0,0,2193,2372)` 裁去工具黑边，成图 2193×2372；保留页面内容，没有修改页面。 |
| [节点类型高分辨率图](freenow-node-types-social-20261007.jpg) | 同一画布通过正式「添加节点」打开文本、图片、视频、音频、3D 与工具菜单；同样从 6645×7188 工具截图按 `(0,0,2193,2372)` 裁去黑边，成图 2193×2372。菜单打开证明渲染，不证明全部项目均逐态验收。 |

首页原图没有覆盖样式、改变 viewport 或拼接。正式视频播放器实际播放到 8 秒；提示词只编辑，未生成。只有文本→图片、图片→视频两条真实连接，video→audio 因当前模型不支持该素材而正确拒绝。没有真实 Key、付费推理或 TapNow 请求；图片为本批实际安装包片场截图，音频为本机合成旋律，不冒充模型输出。

该批音频摆放使用正式多选与文本一起移动、再独立回移完成；当时单 audio player 空白处不能独立拖动，已于 10 月 8 日补齐，见下方[本批手势证据](../AUDIO-PLAYER-GESTURES-20261008.md)。截图不代表全节点按钮、拖动、模型或全站验收。社交图的进一步区域裁切由 `docs/social/` 单独记录，不改写以上原始文件来源。

## 2026-10-08 音频手势、标题、搜索与模板保存

| 截图 | 真实页面与范围 |
| --- | --- |
| [音频拖动与标题](audio-player-drag-titles-20261008.jpg) | 4195 正式生产脚本的独立项目 `audio-1008-upload`；正式上传 3 秒合成 WAV，实际空白拖动后节点 240 / 210，标题 Enter/撤销重做/Escape 与刷新回读已验。 |
| [搜索焦点与高亮](canvas-search-focus-highlight-20261008.jpg) | 生产搜索组件的隔离 QA；橙色真实焦点位于图片 A，高亮仍为图片 B，Enter 确认 B。另验分类/清除焦点、空结果、两级 Escape/回焦。 |
| [模板正文保存回读](template-editor-save-readback-20261008.jpg) | 生产编辑器的自由 HTML QA；保存失败后保留草稿，恢复正常保存后真实 IndexedDB 为 revision 2、122 字符。不是缺失官方模板，刷新草稿恢复未实机验。 |

三张为实际 1280×720 / DPR 2 页面完整视口 JPEG，CDP `Page.captureScreenshot`，未改变视口、样式、裁切或拼接。素材均为合成公开测试数据；无真实 Key、模型调用或原站请求。本机 4173 属于另一个项目，本批只使用独立 freenow 4195 服务。定向回归与尚未验收范围见[交互清点](../INTERACTION-CHECK-20261008.md)。

| Ark 配置界面 | 实际范围 |
| --- | --- |
| [延长上传配置](ark-extension-publication-config-20261008.jpg) | 正式延长面板，合成 Ark metadata 未启用 `videoUpload`；独立 fal Key / `videoUploadProvider` 条件可见且确认禁用，POST/准备 hook/裁片均 0。QA 审计区域遮挡面板左部。 |
| [重拍上传配置](ark-reshoot-publication-config-20261008.jpg) | 正式重拍面板的 8 秒合成视频分镜、镜头控制及上传条件，生成禁用；关闭后正式 TaskService 前置检查明确失败，POST/裁片/生成媒体读取 0，准备 hook 1。 |

两张为 CUA 直接完整视口 JPEG，无裁切、视口/样式变更或模型调用；QA 审计控件覆盖部分页面，不作为一比一视觉证据，也不证明启用发布后的完整流程。[配置、合同与边界](../ARK-LOCAL-VIDEO-PUBLICATION-20261008.md)

## 2026-10-08 帮助快捷键与外部只读 MCP

| 截图 | 真实页面与范围 |
| --- | --- |
| [帮助快捷键面板](canvas-help-shortcuts-20261008.png) | 当前源码主壳QA的实际面板区域截图；默认1280×720视口内动效结束后面板640×606、x=320/y=98。21行两列快捷键及两张本地原始GIF实际解码，Escape回焦/二次关闭与离线教程新标签、窄屏目录章节切换已验。不是全部断点或官方帮助正文验收。 |
| [外部MCP原生批准后连接](external-agent-production-authorized-20261008.png) | 隔离、无Key的源码Electron，真实GUI建立公开QA画布和1个文本节点后原生批准标准stdio客户端。生产socket/main/preload/CanvasApp返回1节点/0边、revision绑定；Cmd+R后旧客户端撤权已验。截图记录只读范围和连接状态，不是现有Alpha包或商业Agent配置验收。 |

两张均来自本地公开QA数据，没有模型调用。帮助图是区域截图，不能当作完整视口；MCP只导出获批项目节点元数据，不含正文/提示词、媒体像素或文件路径。帮助、快捷键与MCP的操作和未验范围分别见[帮助记录](../CANVAS-HELP-20261008.md)、[实际快捷键](../CANVAS-SHORTCUTS-20261008.md)和[本机MCP连接](../../src/features/external-agent/README.md)。

## 2026-10-08 画布菜单、片场标签、人物情绪与桌面源码文件整理

| 截图 | 真实页面与范围 |
| --- | --- |
| [画布添加菜单与键盘](canvas-command-menu-keyboard-20261008.png) | 当前源码主壳QA，默认1280×720；添加菜单含5种节点、3个辅助工具及上传，背景为真实本地节点。开关/Tab/回焦、画布焦点撤销重做，以及hover视频→Enter/图片→Space真实创建已实机验；旧来源历史、上传/下载/PNG剪贴板读回未单独实机验。无私人素材或原站截图。 |
| [片场标签与真实 GLB](studio-panel-keyboard-20261008.png) | 从当前 `index.html` 再生成的 freenow 主壳 QA，默认1280×720视口；真实GLB大场景、拍摄/场景标签、WebGL及镜头预览可见。左右循环/首尾、Tab进面板再进首镜头与修饰键/Down/右键保护已实机验；不证明并存的导演工作区或本地拟建V3生产入口已实现。 |
| [人物情绪关闭与刷新](actor-emotion-close-refresh-20261008.png) | 原嵌套HTML及生产controller/host/runtime的独立QA；正常Tab键盘确认真实512×512灰模，guides=1/replies=1，800ms慢保存、关闭失败保页后重试，刷新恢复强度62、悲伤87%/恐惧13%。未覆盖全部鼠标操作、严格350ms内确认或完整灰模/消息失败重试组合。 |
| [桌面三项真实结果](desktop-files-local-results-20261008.png) | 重启最新源码Electron QA，原生选择器授权该次临时目录，预览3项并原生确认completed=3；文件回读为`sorted/one.txt`、`renamed.txt`，原7字节/SHA保持且旧文件名消失。不是已发布Alpha包的新增能力。 |
| [桌面有效单项取消](desktop-files-cancel-receipt-20261008.png) | 同一源码QA的最后fresh单项`mkdir must-not-be-created`，获取完整AX后原生取消，回执cancelled/completed=0且文件系统未创建目标；不使用中间受“用户改变应用”干扰的两项尝试作取消证据。 |

本组是主线实际页面/窗口截图，素材与目录均为本地测试数据；没有真实供应商调用。完整操作、来源和未验范围见[画布菜单](../canvas-command-menu-audit-20261008.md)、[片场标签](../STUDIO-V2-PANEL-KEYBOARD-20261008.md)、[人物情绪](../../src/features/agent-apps/ACTOR-EMOTION.md)和[桌面文件整理](../DESKTOP-FILES-20261008.md)。桌面未知journal不重放有定向依据，尚未实机重启journal；恶意祖先路径TOCTOU及完整Agent SDK/实机回滚仍有限制。

## 2026-10-07 最终 macOS arm64 安装包重开

| 文件 | 实际内容与来源 |
| --- | --- |
| [安装包片场重开](freenow-desktop-packaged-restart-20261007.jpg) | 实际 `build/release/mac-arm64/freenow.app`，运行源码 `642d3db5c156ae82b0ee33f253fad2756ffe015a`。X 从 0 改 1.25、Tab 提交，在片场内 Cmd+Q 退出释放 4183；再启动同一包，选中立方体后 AX 为 X=1.25 / Y=0.5 / Z=0，真实 WebGL。 |

该图记录最终包窗口的实际保存和重开恢复，不是开发窗口替代。未调用模型，不证明全部页面、其他设备或真实 Key 效果。ZIP 字节、SHA-256 与上传结果见[安装包核验](../releases/DESKTOP-ALPHA-VERIFICATION-20261007.md)，使用方式见[桌面指南](../DESKTOP.md)。

## 2026-10-07 Electron 开发窗口与调色持久结果

| 文件 | 实际内容与来源 |
| --- | --- |
| [freenow Desktop 片场](freenow-desktop-studio-20261007.jpg) | 实际 Electron 开发窗口，运行正式 WebGL 片场；画布标题为 freenow，显示本地立方体、对象变换、片场设置和镜头预览控件。 |
| [调色持久结果](freenow-color-persistence-20261007.jpg) | 4195 独立 session 的正式双层 iframe / SDK / 本地像素 runtime。保存失败重试、曝光 25 的唯一 PNG 与上下文恢复后，曝光 30 草稿仍保留且提示未应用；原图和结果合计 2 节点，刷新/重开后不重建。 |

桌面图是开发外壳的实际运行证据，不是 ZIP 安装包验收截图，也不证明签名公证、跨设备或全部功能。调色图使用本地真实 PNG 像素，不调用外部模型；SHA、持久回读和具体操作见[调色记录](../AGENT-COLOR-ADJUST-INTERACTIONS-20261005.md)。源码运行、独立存储、原生关闭等待与当前打包范围见[桌面指南](../DESKTOP.md)。

## 2026-10-05 Sonilo 音乐、素材板、导演批注与长历史

| 文件 | 实际内容与来源 |
| --- | --- |
| [Agent原生音乐](sonilo-agent-native-approval-20261005.jpg) · [明确时长](sonilo-agent-explicit-duration-20261005.jpg) | `scripts/qa-sonilo-native.cjs` 的 `localhost` 独立 origin；真实8秒MP4、两个变体、完整音乐分段及明确5秒冲突。仅打开/取消审批卡，无新增生成；后端为独立本机HTTP夹具。 |
| [文字音乐完成](sonilo-text-music-local-20261005.jpg) | 同一夹具的 `127.0.0.1` origin，正式按钮生成两个10秒WAV、实际播放至结束。该origin继承33%浏览器缩放，保留作调用证据，不作像素等效依据。 |
| [Product Kit](agent-product-kit-interactions-20261005.jpg) | `src/features/agent-apps/qa/product-kit.html?session=product-kit-1005p-root1`；公开320×240合成PNG、砂岩配色、两调性、自然描述；失败重试关闭/重开，实际队列2。 |
| [导演批注](agent-director-markup-interactions-20261005.jpg) | `src/features/agent-apps/qa/director-markup.html?session=director-1005p-root1`；正文前缀后四批注/锚点恢复、一次DM1，工具条Escape回焦并保留选区。 |
| [长历史稳定选择](history-long-list-stable-20261005.jpg) | `qa/generation-history-long-list.html?session=long-list-1005p-root1&project=qa-long-history-long-list-1005p-root1`；600条合成记录与实际PNG，定位后10次点击滚动/焦点保持。 |

均为实际浏览器CDP视口截图，未修改页面样式、合成或修图；没有使用私人媒体。Sonilo合成固定音调证明本机调用、播放和归档，不代表音乐效果；批注与素材板确认仅进入本地Agent队列。更多原始计数、故障和未验边界见[本批记录](../LOCAL-SONILO-AGENT-AND-HISTORY-20261005.md)。


## 2026-10-05 视频规格、实际下载与 Agent 识别

| 文件 | 实际内容与来源 |
| --- | --- |
| [Agent原对话恢复](agent-sam2-local-recovery-20261005.jpg) | 独立宿主 `session=agent-sam2-1005o-c`；真实本地源和封面，保存失败后复用同一蒙层，补存原工具回执、明确继续并刷新；结果卡实际解码320×180。 |
| [Agent取消](agent-sam2-cancel-source-change-20261005.jpg) | `session=agent-sam2-1005o-cancel3`；停止等待后clip改为2–4秒，原UUID取消，前向已归档/取消确认，倒序未派发；无部分蒙层。 |
| [Agent重启续发](agent-sam2-resume-complete-20261005.jpg) | `session=agent-sam2-1005o-resume2`；同store重启后独立确认，仅补倒序26帧；原UUID完整50帧、单蒙层素材保存，无新LLM轮次或新识别任务。 |
| [视频规格](video-specifications-interaction-20261005.jpg) | `src/features/video-generation/qa/specifications.html`；生产菜单，模式焦点、真实滚轮、时长4秒与两级Escape，未调用生成接口。 |
| [Widget实际下载](widget-whitebox-download-20261005.jpg) | `src/features/agent-widgets/qa/whitebox-download.html`；正式双层sandbox与下载按钮，实际PNG、默认H.264 MP4、VP9 WebM。两份视频已播放到结束，文件SHA及40个不同帧见[下载证据](../research/widget-whitebox-download-20261005.json)。 |
| [HTML本地导出](html-export-local-20261005.jpg) | `src/features/agent-artifacts/qa/local-export.html?session=export-1005o`；实际预览与下载。已读回离线HTML内容；浏览器策略不允许`file://`重开，独立离线运行未验。 |
| [Agent来源漂移](agent-sam2-approval-drift-20261005.jpg) | 独立Agent SAM2宿主，`session=agent-sam2-1005o-drift`；正式确认前clip由1–4秒改为2–4秒，允许后正确拒绝，当前会话零媒体读取/零任务。供应商审计为该宿主各会话累计值。 |

以上均为实际浏览器原始截图，未修改页面样式或合成图像。Agent与供应商固定边界只用于公开合成素材的本机验证，不表示真实模型质量。

## 2026-10-05 原生视频识别与人物走位补验

| 文件 | 实际内容与来源 |
| --- | --- |
| [原生视频识别](video-segmentation-native-20261005.jpg) | `src/features/video-mask/qa/segmentation-app.html?mode=native&session=sam2-native-final1005n-b`；独立QA端口，真实本机FFmpeg、PNG/RLE、IndexedDB；同UUID/asset保存重试后直接刷新，提示2.5秒对应原帧25。供应商边界为合成响应。 |
| [人物走位原生拖动](agent-character-blocking-native-drag-20261005.jpg) | `src/features/agent-apps/qa/character-blocking.html?session=blocking-1005n-root1`；官方v3原件、合成PNG，本批clamp/吸附/朝向与失败重试后刷新，实际位置650/740/90°、队列1。 |

两图均为Browser Use直接截图，分别1280×720视口和1280×939全页JPEG。没有图片生成、修图、样式覆盖或拼接。实际故障、保存及服务器累计计数见[本批记录](../LOCAL-SAM2-AND-BLOCKING-20261005.md)，截图不代表真实模型效果。127.0.0.1继承33%缩放的早期页面不作为最终视觉证据，临时设备模拟已清除。

## 2026-10-05 原生 LOD、分组复制与拼装审阅

| 文件 | 实际内容与来源 |
| --- | --- |
| [SPZ原生LOD片场](spz-lod-studio-20261005.jpg) | `qa/spz-world.html?session=spzlod1005m-root2&lod`；跨视图补修后的真实Niantic MIT样本、鼠标选中物体、镜头预览；首轮root1的导出/释放/恢复及补修版近远/缓存点选/PNG见[专项记录](../SPZ-LOD-20261005.md) |
| [分组复制](canvas-group-copy-20261005.jpg) | `src/features/canvas-clipboard/qa/group-main.html?session=group-copy-1005m-root1`；实际⌘C/⌘V连续两次，相同指针位置40px偏移，公开合成PNG与节点 |
| [拼装审阅](agent-cutlist-review-20261005.png) | `src/features/agent-apps/qa/cutlist-review.html?session=interactions-1005m-root`；同快照保存/重试/刷新恢复后0.2–3s与4–7s两片，实际8秒合成MP4播放/seek |

两张JPEG是CDP完整2560×1440截图；PNG为1280×1128完整页面。没有修改产品样式、生成式修图或拼接。均使用隔离本地数据；没有真实模型调用。审阅未执行拼装；SPZ运行本地WASM/Worker，视频仅调用本机FFmpeg封装。单次工具下载超时，未把MP4文件级FFprobe核验或帧率计作已验。

## 2026-10-05 副本、人物走位、混合拾取与视频延长

| 文件 | 实际内容与来源 |
| --- | --- |
| [普通节点副本](canvas-single-duplicate-20261005.jpg) | `src/features/canvas-clipboard/qa/main.html?session=duplicate-1005l-root1`；正式右键副本、公开 PNG、分组外精确摆放与出入连线 |
| [人物走位](agent-character-blocking-20261005.png) | `src/features/agent-apps/qa/character-blocking.html?session=interactions-1005l-root`；正式人物板，真实拖动/面向/确认/关闭重试后刷新，公开合成头像 |
| [混合拾取](spz-mixed-picking-20261005.jpg) | `qa/spz-world.html?session=spzpick1005l-root1&picking`；真实 Niantic SPZ 与带透明孔网格，点击穿过孔选中高斯 |
| [视频延长生命周期](video-extension-lifecycle-20261005.jpg) | 独立 QA host 的 `mode=normal&session=ext-afterdispatch-1005l-root`；任务派发后关闭，合成 2 秒结果落入正式画布并实际播放，不代表模型延长效果 |

JPEG 来自当前页面 CDP 完整视口，PNG 为实际页面完整截图；没有视觉生成、拼接或样式覆盖。视频早期取消/漂移/保存重试案例的 `127.0.0.1` 浏览器 origin 原有 33% 缩放保持不变，最终截图使用 `localhost` 的正常显示；不将前者作为视觉还原证据。四项的验证范围分别记录在对应专项文档中。

## 2026-10-05 真实 SPZ 高斯世界

| 文件 | 实际内容与来源 |
| --- | --- |
| [SPZ 预览](spz-world-preview-20261005.jpg) | 正式 3D 预览渲染 Niantic MIT 样本 `hornedlizard.spz`，786,233 高斯，正向蜥蜴、台座与花园 |
| [片场照片](spz-shot-photo-20261005.jpg) | 正式摄影链生成的 1280×720 PNG，在画布完整预览中显示 |
| [运镜视频](spz-motion-video-20261005.jpg) | 正式镜头与 2 秒位移运镜经本机 FFmpeg 封装，完整预览实际播放至结尾 |
| [画布结果](spz-world-canvas-20261005.jpg) | 世界、片场、照片、视频及其来源连线，刷新后仍可恢复 |

四张来自 `qa/spz-world.html?session=spz1005k-root3` 的隔离正式模块，Computer Use 保存完整 1280×720 原始截图，没有修改 CSS、覆盖 viewport 或生成式修图。仅使用公开 MIT 真实样本和本地 WASM/Worker/FFmpeg，外部请求为零；不是供应商生成效果。原 SPZ 已按字节及 SHA 核对；没有取得输出 MP4 做 FFprobe，不声称容器帧率或零掉帧。复现和预算见 [本地渲染记录](../SPZ-LOCAL-RENDERING-20261005.md)。

## 2026-10-05 深度双结果与画布交互

| 文件 | 实际内容与来源 |
| --- | --- |
| [深度双结果历史](video-depth-node-history-20261005.jpg) | 正式视频节点的一批两个历史选项；64×48、2秒合成灰度 MP4，不代表模型推理质量 |
| [平台裁切拖动](agent-platform-resize-drag-20261005.jpg) | 实际 1200×800 网格图、同宽高比互斥、3张PNG写入与成功态；原内嵌应用的本地派生 |
| [画布搜索](canvas-search-hover-20261005.jpg) | 当前正式 freenow 页面，500个合成节点，查询“性能”并以键盘高亮003 |

均由 Computer Use 操作，完整 1280×720 截图；未改页面样式或做生成式修图。入口、数据和复现见[本批记录](../LOCAL-DEPTH-BATCH-AND-CANVAS-20261005.md)。深度使用独立本机网关与合成供应商，搜索禁用模型；不包含用户画布或账号。

## 2026-10-05 深度、全景局部编辑与关闭保存

| 文件 | 实际内容与来源 |
| --- | --- |
| [本地深度视频](video-depth-local-recovery-20261005.jpg) | 正式视频节点、来源连线与隔离审计；原任务恢复并刷新后可播放，固定灰度 MP4 不代表模型深度效果 |
| [全景框选](panorama-local-selection-20261005.jpg) | 正式旧片场的鼠标选区、修改描述和 freenow 标识 |
| [全景历史](panorama-local-history-20261005.jpg) | 真实保存并刷新后的同一补丁、控制点和历史菜单 |
| [节奏关闭保存](agent-close-save-20261005.jpg) | 保存失败时正式内嵌页保留最后备注和重试提示 |
| [剧本关闭保存](agent-story-close-save-20261005.jpg) | 中文保存失败提示，N1/N2 与 5 场结构仍保留 |

完整验收与隔离入口见[本批记录](../LOCAL-DEPTH-PANORAMA-LIFECYCLE-20261005.md)。均使用 localhost 的正常 1280×720 视口，保留正式页面样式；媒体接口仅供应商边界使用合成回复，不读取日常画布或调用原站 API。深度及两张全景图为完整 1280×720 截图；节奏完整页 1280×1851，裁切矩形 `(24,577)–(1024,1519)`；剧本完整页 1280×2025，裁切 `(24,544)–(1024,1450)`，保留卡片标题、错误和完整内页。只做裁切与 JPEG 转码，无生成式修图。

## 2026-10-05 Agent 内嵌页面交互

| 文件 | 实际内容与来源 |
| --- | --- |
| [表演节奏](agent-rhythm-interactions-20261005.jpg) | 正式原页的SHA限定派生；键盘删除b2、6.2秒驱动力37、慢保存/失败重试后的真实状态 |
| [剧本结构](agent-story-room-interactions-20261005.jpg) | 正式结构板新增“地下档案室”“旧钟楼”，真实IndexedDB保存/刷新恢复；未生成正文 |
| [硬件模板](agent-hardware-picker-local-20261005.jpg) | H08键盘调整、暂停和一次选择交接后重建；底部说明本地预览/录屏边界 |

来自三个 `src/features/agent-apps/qa/` 独立页面，使用生产registry/controller/card/host。节奏与剧本为 `?session=interactions-1005i` 的专用IndexedDB；Creative使用该页内存会话。未调用模型或原站API，也未读取日常画布。正常1280×720视口的完整页面截图分别为1280×1722、1280×1933、1280×2790，仅按实际DOM区域裁取（24,572–1024,1381）、（24,515–1024,1357）、（215,393–975,946）；没有生成式修图。Story QA外层标题/行高已设为整数，原应用样式保持。

详细操作和未验收的拖拽范围见[本批记录](../LOCAL-AGENT-INTERACTIONS-20261005.md)。

## 2026-10-05 Magnific 四参数与 Agent

| 文件 | 来源与实际范围 |
| --- | --- |
| [Magnific正式面板](image-magnific-native-panel-20261005.jpg) | 正式增强节点、模型菜单、四滑杆与独立原生状态；参数3/8/8/31，合成结果不代表实际放大效果 |
| [Agent Magnific审批](agent-magnific-native-approval-20261005.jpg) | 正式确认卡显示倍率3、锐化14、颗粒29、细节41及新建连接的目标；固定本机Agent回复 |

来自 `src/features/image-upscale/qa/server.cjs 0 agent` 的隔离正式入口，完整参数/任务/解码/归档/保存链路见[本批记录](../LOCAL-MAGNIFIC-AGENT-20261005.md)。保留浏览器现有缩放；原生截图11752×6609的实际控件按像素矩形分别裁为445×710（425,25至870,735）和462×437（3398,185至3860,622），未改变页面CSS、viewport或生成式修图。不发布官方账号画布截图。

## 2026-10-05 图片重新打光与 Agent

| 文件 | 来源与实际范围 |
| --- | --- |
| [重新打光面板](image-relight-native-panel-20261005.jpg) | 正式源节点、工具栏和Three预览，默认50%/5600K/轮廓光开启，独立编辑说明；原图是公开合成512×320几何PNG |
| [Agent打光审批](agent-relight-approval-20261005.jpg) | 正式AgentUI确认卡，显示右上前方/100%/3000K/低位轮廓光及独立供应商语义；批准前零生成POST |

使用`src/features/image-relight/qa/server.cjs 0 pipeline agent`的独立数据库、临时服务归档和合成模型回复。原始CDP截图2560×1440，按实际像素分别裁出完整480×490面板上下文和400×420审批区域；没有修改页面CSS、为截图调整viewport或生成式修图。画面不证明真实模型效果，完整SDK/保存/刷新范围见[本批验收](../LOCAL-RELIGHT-AGENT-20261005.md)。

## 早期批次与通用复现

首批于2026-10-03通过 Computer Use 在本机4173服务操作正式界面并截图，后续批次如下。图片不来自官方网站，也没有生成式修图；这些截图只展示本地实现。首批使用后台浏览器默认1280×720视口，各后续批次尺寸另记，不代表全部响应式布局验收。

| 文件 | 实际内容 | 数据来源 |
| --- | --- | --- |
| [canvas.jpg](canvas.jpg) | 文本、图片参考、连线、编辑器和片场节点 | 公开示例简报、两个几何图层与仓库内模型缩略图 |
| [image-editor.jpg](image-editor.jpg) | 正式 Fabric 编辑器，选中前景图层后的操作栏 | 示例矩形和圆形；非生成图片 |
| [studio.jpg](studio.jpg) | 正式 Three.js 片场，GLB 导入、保存、聚焦和场景树 | `assets/studio/library/chair-office.glb`，实际 WebGL 渲染 |
| [agent.jpg](agent.jpg) | 正式 Agent 欢迎建议、输入、附件、确认及模型控件 | 空白示例会话；没有真实模型响应 |
| [video-trim.jpg](video-trim.jpg) | 正式智能剪辑输出三段视频、时长和来源连线 | 仓库内红绿蓝测试片，本机 FFmpeg 实际输出 |
| [agent-disabled-model.jpg](agent-disabled-model.jpg) | 2026-10-04 正式生成模型菜单的原因覆盖层（局部截图） | 模块内隔离选项；零选择回调、零模型派发 |
| [agent-duration-escape.jpg](agent-duration-escape.jpg) | 2026-10-04 首次Escape取消后保留时长浮层（局部截图） | 同模块隔离选项；恢复5秒、0次选择回调 |

不包含私人画布、账号抓包、API Key、聊天内容或供应商生成质量宣称。旧参考标识仍按 README 的最终品牌阶段处理；模型来源与第三方许可按原资产记录保留。

## 重现

启动正式服务后，生成与当前 `index.html` 同步的演示入口：

```sh
node scripts/prepare-screenshot-demo.cjs
```

打开 http://localhost:4173/docs/screenshots/demo.html?session=manual 。更换 `session` 得到独立示例数据库；不要附加 `project` 参数。演示使用独立 IndexedDB 和内存偏好，不读取日常画布、素材或会话。API 派发在该演示页禁用，不用于验证真实供应商或剪辑服务。

1. 点“重置”适应当前窗口，截取画布。
2. 点“AI 助手”，待展开动效结束后截取欢迎页，再收起。
3. 点“打开编辑器”，选择“前景形状”图层后截取；关闭编辑器。
4. 点“进入片场”→“导入模型”→“上传模型”，选择仓库中的 `chair-office.glb`，点“添加到场景”。等“模型已添加并保存”后聚焦，取消选择，收起镜头预览，切换“场景”页后截图。

`demo.html` 由生产入口派生，不另写一套产品 UI。修改入口加载顺序后重新执行脚本；修改示例只编辑 `demo-fixture.js`。截图属于文档资源，不进入正式项目初始化数据。

视频截图使用另一个[剪辑隔离 QA](../../src/features/video-trim/qa/main.html)：打开选区后收起验收面板，从正式视频工具栏重新进入剪辑，点“智能剪辑”。实际输出为 2.2、1.8、4 秒三段；读取后收起验收面板，点“重置”适应内容。该页允许本机 FFmpeg 接口，不调用生成模型。具体保护与验证见[剪辑结果恢复](../VIDEO-TRIM-RESULT-RECOVERY-20261003.md)。

Agent 模型反馈截图来自 `/src/features/agent-generation/qa/disabled-model.html`，使用真实生产菜单。鼠标进入禁用行出现原因，离开撤销；键盘焦点、点击禁用项、Escape与外部关闭的复验见[专项记录](../AGENT-GENERATION-DISABLED-MODEL-HOVER-20261004.md)。

时长取消截图来自 `/src/features/agent-generation/qa/duration-dismissal.html`；输入19后Escape，恢复5并保留浮层。实际第二次关闭、Enter提交及音频取消blur回调的结果见[专项记录](../AGENT-GENERATION-DURATION-ESCAPE-20261004.md)。

2026-10-04新增：`canvas-final-drop.jpg` 来自生产连线隔离QA的普通不兼容回退菜单，诊断同时证明菜单打开而原图不变；`studio-numeric-draft.jpg` 来自正式WebGL片场/运镜编辑和Agent，使用隔离精确坐标夹具与本机目录引用。见[连线](../CANVAS-CONNECTION-FINAL-DROP-20261004.md)、[片场数字草稿](../STUDIO-V2-NUMERIC-DRAFT-20261004.md)、[目录导航](../AGENT-REFERENCE-FOLDER-NAVIGATION-20261004.md)。没有调用真实模型。

`studio-meshopt-local.jpg` 为上述数字QA通过正式文件选择/上传模型添加仓库tree.glb后，刷新重入并聚焦的实际画面；树的压缩字节本机解码，未调用模型API。

2026-10-05新增，均为主线程Computer Use、默认1280×720本地画面，未调用生成接口：

| 文件 | 来源与已验证行为 |
| --- | --- |
| [image-alignment-guides-20261005.jpg](image-alignment-guides-20261005.jpg) | `src/features/image-editor/qa/alignment.html`，实际Fabric左边缘拖动，截图保留隔离诊断；另验半倍中心、撤销和刷新恢复 |
| [agent-message-attachments-20261005.jpg](agent-message-attachments-20261005.jpg) | `src/features/agent-messages/qa/agent-message-attachments.html`，正式消息renderer，真实本地图片/测试视频及失败槽位；另验重绘和会话持久化 |
| [studio-timeline-key-drag-20261005.jpg](studio-timeline-key-drag-20261005.jpg) | `src/features/studio-v2/qa/timeline-key-drag-main.html`，真实GLB与正式运镜，取消与同名片段切换后轨道未污染 |
| [canvas-history-batches-cua-20261005.jpg](canvas-history-batches-cua-20261005.jpg) | 公开隔离clone的4298正式入口，真实右键批次展开；整组一次撤销/重做和刷新恢复 |

历史隔离clone复现脚本见[专项记录](../CANVAS-HISTORY-EXPANSION-20261005.md)。这些证据覆盖上述具体行为，不等于全站同态视觉或真实供应商质量验收。

本批新增：

| 文件 | 来源与验证范围 |
| --- | --- |
| [image-editor-layer-menu-20261005.jpg](image-editor-layer-menu-20261005.jpg) | `src/features/image-editor/qa/layers.html`，正式Fabric图层菜单；真实PNG、上下移/复制/删除、键盘及迟到clone保护 |
| [agent-streaming-code-controls-20261005.jpg](agent-streaming-code-controls-20261005.jpg) | `src/features/agent-messages/qa/code-stream.html`，正式streaming/message renderer；本地增量文字，不是模型生成 |
| [studio-focus-navigation-speed-20261005.jpg](studio-focus-navigation-speed-20261005.jpg) | `src/features/studio-v2/qa/focus-navigation-speed-main.html`，真实GLB/WebGL片场；树选择、F、聚焦与全景速度保持 |

[高清素材往返截图](library-original-roundtrip-20261005.jpg)来自 `src/features/library-asset-roundtrip/qa/roundtrip.html`：正式保存/picker及刷新后两张2048×1152原图；128×72预览和真实PNG下载Blob已核对。QA偏好/收据/媒体均独立IDB，不代表正式素材库已迁移；浏览器下载落盘未确认。

[视频素材往返截图](library-video-roundtrip-20261005.jpg)来自同一隔离入口：真实本地原文件为4秒320×180、clip .5–2.5；正式下载经本机FFmpeg输出3256字节、2秒320×180，画布真实导出节点与连线渲染。未调用供应商模型，下载落盘不在证据范围。

## 2026-10-05 官方合同核验与 freenow

- [24类操作配置状态](generation-readiness-routed-20261005.png)：使用正式配置函数、隔离公开metadata、真实滚动/关闭和小窗口按钮可达性。
- [freenow 多角度原生替代面板](freenow-multi-angle-native-20261005.png)：本地 F 标识、原滑杆范围与专用模型限制说明；源图为仓库合同PNG，不是模型生成效果。

复现与接口边界见[交叉核验记录](../OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md)。

## 2026-10-05 本地品牌与资源刷新

以下均为1280×720实际Computer Use截图，无生成式修图、私人内容或供应商生成请求。

| 文件 | 来源与验证范围 |
| --- | --- |
| [freenow片场Agent入口](freenow-studio-agent-brand-20261005.jpg) | 正式入口派生的独立generation-config QA中，新建3D片场并进入真实WebGL；两处Agent图片30×30、加载正常，按钮尺寸保持 |
| [freenow本地模型预览](freenow-local-model-preview-20261005.jpg) | 同一独立页面正式上传`assets/studio/library/bicycle-city.glb`并进入预览；真实自行车、环境控件和本地F提示标识 |
| [多角度素材刷新](local-assets-refresh-20261005.jpg) | `generation-config/qa/main.html?session=readiness-local-assets-1005b&profile=angle`刷新后；两张本机合同PNG经真实LocalAssets归档，源坐标100.25/80.5不变，无待本地化提示；不是模型效果 |

ElevenLabs Music 的正式参数、生成、播放和刷新已完成浏览器交互验收；该临时入口截图尺寸异常，未发布无效截图，也未据此声明音乐像素验收。实际媒体与请求范围见[Music专项](../elevenlabs-music-native.md)。

## 2026-10-05 Agent组图与工作流模板

[组图质量与编辑](photoset-quality-20261005.jpg)来自隔离入口 `src/features/agent-apps/qa/ecommerce-photoset.html?session=20261005-photoset-quality`，实际593×783页面截图。产品图为仓库公开Sony PNG，原HTML的质量选择、行编辑、确认/Escape回焦、配置缺失零任务与freeform交接已实际操作。未调用供应商生成；[专项结果](../../src/features/agent-apps/ecommerce-photoset.md)。

[工作流模板详情](workflow-template-detail-20261005.jpg)来自正式入口隔离页 `src/features/workflow-templates/qa/main.html?session=workflow-template-1005-local`，保留完整1100×700弹窗及邻近画布。封面、节点和媒体来自公开模板的本地归档；已实际应用29内容节点/51连线，刷新、撤销和本地视频播放通过。浏览器默认缩放导致整页截图尺寸异常，本图使用截图API按实测比例裁出整个弹窗，没有改viewport或页面样式，没有生成式修图。[完整范围](../LOCAL-WORKFLOW-AND-NATIVE-AUDIO-20261005.md)。

## 2026-10-05 视频工具与制作进度

以下三张均由主线程真实 Computer Use 保存，裁剪保留完整组件和周围上下文，没有改造布局或 viewport，没有生成式修图。全部数据是本地合成内容；图片不是原站截图，也不证明真实供应商生成质量。

| 文件 | 来源与验证范围 |
| --- | --- |
| [Agent 视频拟音卡](agent-video-audio-native-20261005.jpg) | `scripts/qa-video-audio-native.cjs` 的隔离 HTTP 正式画布；真实 Agent 卡显示 ThinkSound 显式替代 / 跟随视频。正式按钮与 Agent 卡各提交一个 fixture 任务；8 秒真实 MP4及两份固定 440 Hz PCM WAV 原生播放、刷新恢复；无真实模型 |
| [延长镜头参考流程](video-extend-reference-20261005.jpg) | `qa/video-extension-app.html?mode=native` 的生产创作层；片头 30 秒 / 延续运镜、1080p / 无声和固定 seedance-2.5。Ark 本地传输缺口使确认禁用，POST / trim 为 0；截图为本地页面，官方只读操作对照另记文档 |
| [制作进度 freenow](freenow-production-progress-brand-20261005.jpg) | `src/features/agent-apps/qa/production-progress-brand.html` 的真实 card / host / opaque iframe；两条精确 CORS 修复并重启后，中英 / 深浅 / 错误额度状态为 freenow，F 图已解码，用户标题“TapNow 用户自定义项目”保留 |

[本批完整实机记录](../LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)另载素材容量保存 / picker / 两次刷新及模板脏稿 reload 边界；没有把未观察到的 beforeunload 原生 dialog 写成已见到，也没有为这些无独立截图的路径杜撰图片。

## 2026-10-05 短视口菜单

[长中文菜单与键盘焦点](canvas-menu-keyboard-visible-20261005.jpg)来自`src/features/canvas-context-menu/qa/main.html`。实际iframe为727×339，End后ArrowUp跳过禁用第11行，选中第10行；诊断同时显示焦点可见、菜单边界合法、图和视图保持。图片和菜单文字均为公开QA数据。原生完整截图保留浏览器缩放产生的外围空白；截图API裁剪会触发resize关闭菜单，未使用这类关闭后的截图冒充打开状态。临时viewport已恢复。[完整操作证据](../CANVAS-CONTEXT-MENU-KEYBOARD-VISIBILITY-20261005.md)。


## 2026-10-05 全景与重拍

| 文件 | 来源与验证范围 |
| --- | --- |
| [Hunyuan 全景预览](hunyuan-panorama-preview-20261005.jpg) | `src/features/image-generation/qa/panorama/main.html`，正式图片节点、实际合成 PNG 与 WebGL 球面预览；512×320 输入、256×128 结果、刷新可解码。界面 F 图与取景/片场入口为本地资源 |
| [视频重拍](video-reshoot-native-boundary-20261005.jpg) | `scripts/serve-video-reshoot-fixture.cjs` 的隔离页面，正式 8 秒/12 帧时间轴、四种镜头模式、方向/景别与真实 Ark 接入条件；按实测浏览器缩放裁出整个 600px 面板及周围上下文 |
| [Agent 全景确认卡](agent-panorama-confirmation-20261005.jpg) | `qa/agent-image-processing-app.html?kind=panorama`，生产确认卡，固定 LLM 回复和合成图。截图是窄卡局部，包含单参考/单结果/2:1/原生尺寸说明与确认/取消；不代表模型生成质量 |

全景与 Agent 夹具使用独立数据库和内存偏好；无真实模型调用、用户素材或账号抓包。后台标签零尺寸影响点击，曾临时设置桌面视口恢复操作；没有改变页面 CSS。截图保持原始截图字节，不做生成式修图。重拍所在 origin 的浏览器缩放会使整页截图异常放大，组件截图按实际缩放换算捕获。[本批完整证据](../LOCAL-PANORAMA-RESHOOT-AGENT-20261005.md)。

## 2026-10-05 视频物体编辑与 Agent

| 文件 | 来源与实际范围 |
| --- | --- |
| [视频物体替换面板](video-mask-native-panel-20261005.jpg) | `src/features/video-mask/qa/native-server.cjs` 的隔离pipeline页，正式工具栏、真实10.1秒合成来源及已保存时序蒙层、实际picker选择；没有真实模型调用 |
| [视频物体编辑结果](video-mask-native-result-20261005.jpg) | 同页实际后端归档1280×720 / 81帧 / 8.1秒MP4、刷新及播放。CDN和模型传输使用合成响应，FFmpeg/adapter/持久服务/媒体HTTP真实运行 |
| [Agent审批](agent-video-mask-approval-20261005.jpg) | `qa/agent-video-mask-app.html?session=agent-mask-cua1`，实际ask确认卡显示替代模型、上传说明与原音策略，批准前素材读取及生成POST为0；固定LLM回复与合成mask |
| [来源变化保护](agent-video-mask-source-guard-20261005.jpg) | 同QA的`agent-mask-drift-cua3`，正式待审批时来源clip改2..6、原蒙层仍绑定1..5；确认后拒绝、素材读取及生成POST为0 |

四张均通过当前标签的CDP原生JPEG截图取得完整页面像素，没有viewport覆盖、缩放修改或生成式修图。各origin保留当时实际浏览器缩放，未将异常放大的常规截图冒充正常画幅。QA控制数据及图像均为公开合成素材；没有私人会话或Key。

复现先运行`node scripts/build-agent-video-mask-fixture.cjs`或`node src/features/video-mask/qa/native-server.cjs`，使用不同session的隔离数据库；具体交互和供应商边界见[本批验收](../LOCAL-VIDEO-MASK-AGENT-20261005.md)。

## 2026-10-05 皮肤编辑与 Agent

| 文件 | 来源与实际范围 |
| --- | --- |
| [正式皮肤编辑结果和面板](image-skin-result-panel-20261005.jpg) | `src/features/image-skin/qa/server.cjs` 的pipeline/agent隔离宿主，正式增强节点、原400×176控件；PNG是合成供应商回复，不代表皮肤效果 |
| [Agent皮肤审批](agent-skin-approval-20261005.jpg) | 同页真实Agent确认卡：重度警告、完整来源、新增强节点及网关条件；确认前零POST，批准后验证持久回执和真实本地归档 |

两图均从原生完整截图按实测DOM坐标矩形裁出，保留完整控件及邻近内容。没有修改CSS/viewport、拼接或生成式修图；原截图因浏览器缩放附带大面积空白。源图、回复、任务与会话均为隔离合成数据，无真实Key或用户素材。[本批实机记录](../LOCAL-SKIN-AGENT-20261005.md)。


## 2026-10-08 导演片场生产接入

| 文件 | 来源与实际范围 |
| --- | --- |
| [模型、人物与属性](20261008-studio-director/local-model-actor-inspector.jpg) | 独立公开 QA 项目，真实生产 GLB 导入→预览→V3独立 owner；官方本地人物和餐椅真实 WebGL；本地演员 X=1.5 用实际键盘提交并从IndexedDB回读 |
| [保存失败保留页面](20261008-studio-director/save-failure-retained.jpg) | 真实保存边界仅一次注入QuotaExceededError，新增摄像机后关闭被拒；不是实际磁盘容量测试，随后实际保存按钮重试成功 |

1280×720完整页面原字节截图，未裁切、拼接、调整CSS或生成式修图。顶部是QA控件，下方是生产片场；无私人项目、供应商Key或生成调用。第一次只改DOM值的数字输入轮次已排除，图片用真实提交后的截图覆盖。[操作、检查与未完成范围](../STUDIO-V3-PRODUCTION-20261008.md)。
