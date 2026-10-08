# 开发进度

更新：2026-10-08。持续开发中，未完成全站一比一复刻及真实供应商最终验收；不提供缺乏完整分母的“完成百分比”。

## 已有实现

| 方向 | 当前状态 | 证据入口 |
| --- | --- | --- |
| 本地画布 | 项目、节点、连线、分组、堆叠、布局、存储与撤销重做已接入 | [画布项目](CANVAS-PROJECTS.md) |
| 本地编辑 | 富文本、图片图层/蒙版、音视频导入播放/裁切、历史与素材迁移已接入 | [近期本地编辑](LOCAL-MEDIA-AND-LAYERS-20261003.md) |
| 3D 片场 | 场景/镜头/运镜、GLB 与 SPZ 原生 LOD、保存恢复、照片及短视频已接入；含高斯不能完整导出 GLB | [高斯渲染](SPZ-LOCAL-RENDERING-20261005.md) / [LOD](SPZ-LOD-20261005.md) / [网格导出](STUDIO-V2-SCENE-EXPORT-20261003.md) |
| Agent | 工具循环、画布/片场控制、技能、创作应用、只读子任务/DAG及持久恢复已接入 | [API](AGENT-API.md) / [应用历史记录](HISTORICAL-APPS-AND-NATIVE-TTS-20261003.md) |
| 生成接口 | 多供应商路由及若干原生适配已实现；其余能力保留任务接口 | [配置及每项限制](MULTI-PROVIDER-SETUP.md) |
| 本地化 | 本地资源/归档、原站出站阻断与显式资源修复已实现 | [验收清单](FREENOW-LOCALIZATION-ACCEPTANCE.md) |

## 最新：平面放置与时间路径编辑

- 当前源码按[官方原包合同](research/STUDIO-V3-PLAN-PLACEMENT-PATHS-20261008.md)接入已有角色、新角色名/六色草稿、原生子菜单 hover 与180ms延迟关闭；平面 pending placement 固定首点，拖动只改朝向。新增取 normal.y≥.65 的最高有效支撑，无命中才回退地面；摄像机加1.6m，已有实体拖动仍保原Y。
- temporal 路径 click 只选择实体或端点 key，不创建 key/history；曲线拖动写 bend，Bezier 首末控制点和 key 位置/朝向、camera key FOV 均可编辑。key 再次点击/右键仅“删除关键帧”，bend 右键直接 reset；每次手势一笔历史，保留 base、其他 key 和原Y。
- 实机新青绿角色 click 创建、undo/redo 与刷新持久化已验；摄像机放在餐椅支撑面上方，Y=2.04672378m、heading=1.14378rad。bend、endpoint、key 位置各一笔 history；camera key FOV32.2688→43.8414°、焦距25.1605mm、heading约0.074rad一次变更，base/其他key不变，undo还原；中间key删除/undo及pending Escape保留plan已验。[本批证据与原生截图](verification/20261008-studio-plan-placement-paths.md)
- 最终生产页复验bend直接右键reset：无菜单、可见SVG曲线改变，一次undo恢复原路径；此项未另读作者JSON。进入pending前清旧entity/key选择，实机selected key数0、工具条消失、提示可见，Escape留plan；遮挡修复专门回归1/1。提示bottom84是本地可见性适配，不是官方像素合同。
- 轨迹 geometry cache 排除纯 save revision，按作者 editEpoch/来源失效；保存回执不中断 lease。commit/cancel失败保留 lease 可重试，无变化事务被消费后释放，不留下输入锁。
- 分批定向通过：既有路径/temporal27/27、surface25/25、placement12/12、入口新增6/6及旧入口review11/11；随后cache+key optics4/4、surface key optics2/2、hover1/1、旋转2/2、失败边界3/3。不合计为全仓或全部用例重跑。
- P2仍不标完整；orbit/3D添加角色仍立即创建，不能代表3D放置已对齐。真实SPZ/DOF GPU、完整[Saved Views](research/STUDIO-V3-SAVED-VIEWS-20261008.md)、P4导入/生成UI、holding、完整V3 Agent及跨设备性能仍开放；GLB景深未实现。旧Alpha不含10月8日源码，无新依赖或供应商API请求。

## 前批：平面图、房间与空间来源

- 当前源码接独立正交renderer profile、真实六面房间/source、默认1.6m near-plane剖切、成功显示投影快照及SVG实体/FOV层。平移/缩放/旋转/剖切只改变导航，实体/光学编辑进入既有session/temporal作者事务。
- 真实UI在旋转−15°、zoom1.12后拖餐椅，原Y=0保持且一笔history。房间width输入9m、depth从6经一次64px scrub到7.9170474646m；Escape先panel再menu，刷新revision5房间/位置保持。
- 原生camera点击修复后实际FOV32.26880217→46.74428389°、heading0.22→0.03990825750rad；undo同时回35mm/0.22。剖切all near约44.8，reset回1.6m/near48.4；source empty可撤销回room。[当前证据与截图](verification/20261008-studio-plan.md)
- 房间尺寸/参考图案和本地场景选择已接；picker初始空态，显式导入公开GLB来源样本后实际选为history-world，source ready/root存在，保存回读revision10/dirty=false，undo回room；样本不是生成结果。原sourceBinding保持，拒绝远端/API来源，无供应商历史请求。
- 新模块分项结果见主证据：投影/导航21项、renderer/runtime各3项、surface全文件19项后旋转/键盘仅2项、作者桥8项及新增1项、room/space13项、菜单初7项及wheel定向补验、来源7项及混合格式新增1项、entry新增11项；不合并前批或重复用例为全项目测试数字。
- 路径/关键帧曲线交互、新placement支撑面、完整导入/生成生命周期及V3 Agent仍缺，P2不能标完整；真实SPZ/DOF GPU未验，Alpha不含当前源码。没有新增依赖或供应商API调用。[官方依据与缺口](research/STUDIO-V3-PLAN-20261008.md)；当时的路径/新增摆位缺口按[后续放置与路径增量](verification/20261008-studio-plan-placement-paths.md)更新。

## 前批：时间轴作者、循环预览与只读历史相册

- 独立状态接入当前 actor/camera/prop 单目标轨道：保存/移动/删除 key、删除 track、匀速分配、时长及循环。作者内容和 render-only 预览分开，播放/seek 不覆写 base、不新增 history/revision；隐式创建关键帧先确认。
- 生产 UI 保存 0/3000ms 餐椅 X=0→3，1500ms 实际 root X=1.5、作者 base X=0；取消确认在修复视图复原并 reload 后重验，revision/keys保持。真实拖动2000→997ms为一笔undo，恢复0/2000/3000；redo/匀速、4→3秒/最短3秒阻断、key与track删除undo均已验。
- 实际循环播放头1766→1116ms跨过末端，revision4不变；刷新后keys保存。相机key0焦距35→36.3963426mm后拍摄真实4096×2304 JPEG，操控HUD保持；第二次编辑同key至37.848392988010275mm。完成/返回/reload为revision18、ready/dirty=false，key37.848mm/base35mm、原相册2项保持。[本批验收](verification/20261008-studio-temporal.md)
- 历史相册只读原capturedPhotos，两张已有本地JPEG真实解码1280×678，逆序/160px缩略图、方向键和Escape关闭已验；不恢复镜头、不重渲染、不生成素材，普通快门仍只追加画布图片。
- 领域作者23项、宿主最终17项与入口12项分别通过，其他播放/时间轴UI/运行时门禁专项按主证据实际批次列示，不与旧tests合计。
- 完整P2平面图/站面流程、模型导入/生成UI与完整V3 Agent仍缺，真实SPZ像素未验，旧Alpha不含此批。没有新依赖或供应商API请求，专项按模块和各次实际运行记录，不合并旧tests为全项目重跑。该批之后的平面放置/路径范围见[后续增量](verification/20261008-studio-plan-placement-paths.md)。

## 前批：离屏摄影、实体轮廓与镜头管理/导出

- 当前源码采用真实独立渲染目标和 RGBA 读回，默认 4096 长边 JPEG .92；实机 9:16 快门输出 2304×4096，DOM 自然尺寸实际解码。摄影排除编辑轮廓与 helper，人物身体橙色选择轮廓在生产界面可见。
- 摄影先等待 source 与可见非 camera 实体的必需资源；加载失败、身份失效或默认 30 秒超时均具体报错且不编码。新增 readiness 5 项与受影响 Spark/drain 2 项通过；刷新生产 UI 后重新拍摄 9:16 成功，warn/error 日志为空。
- 镜头管理接入独立运行时的真实机位缩略图、改名、删除确认/撤销、批量选择和分层 Escape。竖幅缩略图实测 101×180；改名保存、删除为空及撤销恢复原项已验。管理器不是完整 Saved Views/历史照片编辑器。
- 照片保存失败显示“重试保存照片”，重试复用原 capture ID、节点和素材，刷新仅一张新增照片。批次连续两次注入 QuotaExceededError 后，关闭/重开恢复原选中镜头；原批次重试成功，刷新保留一个输出节点和同素材。
- 真实浏览器 WebM 经 ffprobe/ffmpeg 独立审核为 VP9、1280×720、30 fps、1 秒、56,649 bytes；30 帧完整解码且 30 帧不同，0/15/29 帧均非黑、可见餐椅与地面。已有时序频道采样/导出不等于完整时间/关键帧编辑 UI；只有编码器明确不支持时才回退 contact sheet。
- 该摄影批次尚无时间轴与只读历史相册，现按上方最新增量补齐对应子集。完整平面图、视图管理、生成 UI、V3 Agent 编排仍未完成，真实 SPZ 离屏 GPU/景深像素及持物渲染仍有限制。没有私人项目/素材、供应商或原站请求，现有 Alpha 未包含本批源码。[当前验收与文件审核](verification/20261008-studio-shots.md)

## 前批：导演摄像机接管与 viewport PNG 拍摄

- 当前源码接通摄像机三维飞行、惯性、0.8s进入／0.55s返回、viewport lease、完成／还原及checkpoint；原camera GLB、材质、短视锥／层和身体pivot已接。接管时按官方上游列表规则隐藏全部camera marker。光学保留lookAt，真实位姿编辑原子清除lookAt。
- 原图标／圆环快门、画幅菜单、log焦距与光圈滑尺、弹簧微动效和点对焦参数已接。普通GLB没有DOF能力，因此隐藏光圈／对焦。修复window capture抢走HUD方向键，实机ArrowRight改焦距至29.386115702481316mm，保存revision6且pose不变；End／拖动后还原states与revision均回原值。
- 真实PNG→LocalAssets→连接图片→守卫保存已闭环。两笔保存失败保留同照片回执、锁住非重试操作；修复恢复视图／直接选择绕过守卫及关闭提示覆盖。顶部／快门两种重试均没有重复图片，刷新revision6、五张763×1356及所有ID／镜头参数保持，实际图片均解码成功。
- 新增scope回归用真实capture/session和生产入口闭包，asset写失败且无nodeId时所有相关入口无runtime副作用，原照片重试复用一次render/encode且只创建一节点，1/1通过；HUD捕获隔离新增2＋相关IME1通过。其他摄像机／runtime专项按各次定向范围记录，没有合计为全仓重跑或整体性能提升。
- 此批记录的是 viewport PNG 里程碑；当时缺少的身体 outline 与 4096 长边离屏 JPEG 已由上方最新增量补齐。当时的time／keyframes与只读历史相册缺口以上方最新增量为准，完整视图管理／平面图／生成 UI／V3 Agent仍缺，真实 SPZ 景深视觉未验。该批没有供应商请求或 Alpha 重打包。[历史合同、实机与截图](STUDIO-V3-CAMERA-POSSESSION-20261008.md)

## 本批：节点手势、标题、搜索与编辑草稿

- 音频节点外围空白恢复直接拖动，波形只处理左键播放定位。正式上传 3 秒 WAV 后实际拖动、播放、撤销/重做、刷新后的本地素材和 240 / 210 坐标保持；11 项手势与相邻播放器检查通过。[音频记录](AUDIO-PLAYER-GESTURES-20261008.md)
- 普通图片/视频/音频/文本/世界标题接通选中编辑、防抖、Enter/失焦提交、Escape、非空与来源守卫。实际音频标题提交后焦点回节点，立即撤销/重做和刷新已验；控件首次选中才创建，5000 个未选中节点新增编辑 DOM 为 0，100 轮切选不继续增加，20 项专项检查通过。真实系统 IME、全部类型/缩放仍未验。[标题模块](../src/features/canvas-node-titles/README.md)
- 搜索 Enter 统一确认高亮，14 项定向回归通过；分类/其他结果/清除焦点三条 Computer Use 路径均确认图片 B，空结果、两级 Escape 和回焦已验。没有重跑全库测试或宣称整体 FPS 提升。[搜索记录](CANVAS-SEARCH-KEYBOARD-20261008.md)
- 创意 HTML 编辑器新增本标签页草稿、明确恢复/放弃和版本冲突保护，待决定时锁正文及保存；21 项专项检查通过。实机保存失败保留、关闭提示与 revision 2 / 122 字符实际 IndexedDB 回读已验；控制层自动取消 beforeunload，刷新恢复仅有定向检查。92 份精确模板新增正文仍为 0。[来源与草稿](research/agent-template-source-followup-20261008.md)
- Ark 普通生成、延长与重拍新增显式本地 MP4 发布通道，必须配置 `videoUploadProvider` 和独立 fal Key；32 MiB 来源完整解码后上传，再向 Ark 传公网 HTTPS。准备阶段和原任务 ID 持久保存，unknown 不重传/重提，结果完整解码再归档；115 项定向检查通过，含真实 MP4、网关同库重启和归档。实机延长/重拍缺发布配置提示与禁用、重拍读取前失败已验；启用发布的 UI 全状态与真实供应商未验，不能写成只填 Ark Key 即可。[配置与范围](ARK-LOCAL-VIDEO-PUBLICATION-20261008.md)

[交互清点](INTERACTION-CHECK-20261008.md)与[实际截图](screenshots/README.md)区分本批源码、实机和未验范围。

## 本批：菜单、片场标签、人物情绪与桌面文件

- 画布添加菜单实际开关、Tab 离开关闭、Shift+Tab/Escape 回焦、悬停后从真实焦点导航和真实文本创建已验。主画布焦点下 ⌘Z 删除、⌘⇧Z 恢复同 ID 文本；dock 的 `+` 焦点下不响应画布撤销，不能推广为任意焦点可撤销。旧视频当前历史、fullImage来源与hover→Enter/Space视觉高亮执行已补修，最终52项定向检查通过（新增17项）。最后实机补验hover视频→Enter新增真实video、hover图片→Space新增真实image，均关闭回焦且画布未滚动/外部尝试为0；旧来源历史单独浏览器与上传、下载、PNG剪贴板读回仍未验。[菜单核验](canvas-command-menu-audit-20261008.md)
- 当前 GLB 片场 v2 接通单一 Tab 停留、左右循环/首尾键和标签/面板关联；17 项面板与 3 项真实 GLB QA 检查通过。当前主壳真实大场景已验拍摄↔场景、Home/End、Tab 进入面板再进首镜头，以及修饰键/Down/右键不切换。官方导演工作区与独立GLB编辑器并存，V3是本项目代际名称，两者验收范围仍需区分。[片场标签](STUDIO-V2-PANEL-KEYBOARD-20261008.md) · [下一代实现映射](research/STUDIO-V3-IMPLEMENTATION-MAP-20261008.md)
- V3领域基础现已接真实生产入口、CanvasApp/CanvasStore防迟写保存适配和实际Three.js GLB/SPZ运行时，官方图标/布局及P0/P1子集已接入。空导演刷新恢复4实体与X=2，基准新增角色回独立状态呈现只读；新摄像机保存注入Quota失败后关闭保页，明确保存重试、撤销/重做再关闭，实际IndexedDB revision10/entities5。公开餐椅经真实WorldNode.importAt→资源预览“在3D片场中使用”创建独立V3 owner/source绑定，原source保留；刷新重开恢复角色，真实键盘提交“本地演员”及X=1.5后关闭回读owner revision3/entities1/roles1。之前仅改输入DOM的尝试不算成功；属性Escape回焦已验。[生产入口与实机证据](STUDIO-V3-PRODUCTION-20261008.md)
- 前批联合真实CanvasApp/CanvasStore/session受控IndexedDB检查10/10、画布持久30/30、运行时Transform取消/换选20/20、菜单10/10、改名4/4，分别按记录通过，并非全部重新全量运行。官方紧凑存档仍不支持，v2并存，旧Alpha不含本批新增能力；不能宣称全新工作区全量完成。[模块合同](../src/features/studio-v3/README.md)
- V3前批补实体属性、颜色/原GLB姿态、落地/恢复、镜头光学和真实黑边预览、独立状态复制/嵌套删除及同lane连续redo修复。实机刷新revision23保持绿色Sitting、X1.5/Y0.005886657753309876及50mm/9:16/FOV39.597752709049864；非当前状态复制产生独立ID，revision26为4实体/2角色/4setup；基准创建/继承全局删除后revision32为4实体/3角色/4setup，未引用第三角色按合同保留。确认菜单回焦/保留、连续删除撤销重做、最后状态删除撤销及快捷键不穿透已验；空地面NaN修复后重验成功。runtime11/11、落地5/5、状态7/7、集成守卫5/5及同lane新增3项分别通过。Gaussian景深视觉未验，GLB无虚化；九姿态/材质鼠标全路径、P2放置租约及P3–P6仍未闭合，Agent未实机，不标P1全完成。操控与创建的当前增量见下。[实体、状态与镜头实机证据](STUDIO-V3-ENTITIES-20261008.md)
- V3本批接人物/道具原生WASD、Q/E、G、Shift、指针/滚轮跟随、heading HUD及完成/还原；临时Idle/Walking/Running不覆盖用户姿态，坐标转换保留原约定。地面/此处创建取站面Y+1.6，当前视角必须经独立取景器确认并可编辑画幅/光学，摄像机无缩放UI。实机完成后人物Y=0.9999451279999999、90°，再次270°后还原保留90°/Standing；创建35mm/9:16后刷新revision3、地面创建刷新revision4，最终revision6为5实体/1角色/2setup，原35mm/9:16保留。camera body偏移修复后导航/预览/Escape、空地右键创建关闭菜单，以及“编辑中”禁用/空完成“已保存”可用均已验。[操控、创建与最终存档](STUDIO-V3-CONTROLS-20261008.md)
- 前批坐标13、HUD14、光学/实体动作29、创建/集成11、取景器runtime5、参数UI9分别通过；control原14项及末次失焦定向2项通过，当前文件15项未整套重跑，camera-marker真实GLB几何新增1项通过。人物／道具失焦隐藏保守取消是该模式的本地差异；摄像机接管／过渡／helper／滑尺和拍摄已由[摄像机增量](STUDIO-V3-CAMERA-POSSESSION-20261008.md)补齐对应子集，身体 outline 与离屏摄影另见上方最新增量。Gaussian景深像素、temporal/keyframes 编辑、P2真平面图与P3–P6/完整Agent仍未全，无供应商验证或本批Alpha重打包，也不声称全部Idle零帧循环。
- 人物情绪原嵌套应用接通确认等待真实保存及关闭失败保页，4 项确认、5 项关闭和4项资源完整性检查通过。生产 controller/host/runtime QA 实际生成512×512灰模指导图，AE2 face=-65~-65~68 与图片 SHA 一致，guides=1/replies=1；800ms慢保存、关闭失败后原卡重试与刷新恢复强度62/悲伤87%/恐惧13%已验。原HTML SHA不变；鼠标全路径、严格350ms内确认及灰模/消息失败完整重试组合未验。[人物情绪合同](../src/features/agent-apps/ACTOR-EMOTION.md)
- 桌面源码新增六个 Agent 文件工具、原生单目录授权/整批确认和 journal，只创建子目录及移动/重命名普通文件；15项专项与18项相关检查通过。重启最新 source QA 后实机确认3项、两份7字节文件SHA保持；最新单项取消回执 completed=0且目标未创建，目录移动预览阻断且实际未移动。撤销授权后 authorized=false且列表明确阻断，正常⌘Q退出已验。未知批次重启不重放有定向检查，重启journal尚未实机验；恶意祖先路径并发替换仍有 TOCTOU 窗口，完整 Agent SDK/实机回滚未验。这项源码功能不在已发布642d3db Alpha包内。[文件整理与限制](DESKTOP-FILES-20261008.md)

## 本批：帮助、快捷键与外部只读 MCP

- 帮助菜单五项已接本地更新、离线教程、外部Agent连接、本地反馈和快捷键；现场SVG与两张原始GIF按来源保留，运行时只读本地资源。5项初始定向及新增隐藏dialog回归通过；实机已验21行两列快捷键/GIF解码、Escape回焦、二次点击关闭和教程新标签/窄屏目录/章节同步。教程两张公开截图改为模块内原字节资产，打包白名单/字节核对通过，实际章节图片解码为1447×1566和1280×720；未重建Alpha，不是官方全部帮助正文或全部断点验收。[帮助与离线教程](CANVAS-HELP-20261008.md)
- 快捷键补齐Cmd/Ctrl+G堆叠、Command滚轮缩放、长按V/再次V语音入口，并保护输入法、编辑区、上层弹层及生命周期；累计10项专项通过（原9项及新增1项），取消后同按钮再点的残留AbortSignal已修，新增及受影响语音3项通过。主画布实际Cmd+A→G→Z保持原图片ID、J开关/输入框让出、图片I→Escape已验。V仍只用合成Recorder/转写回归，真实麦克风、硬件触控板和全部组合未验。[快捷键接线](CANVAS-SHORTCUTS-20261008.md)
- 当前桌面源码已实现本机stdio/私有socket的外部MCP只读连接，两项`workspace_status`/`canvas_read`只返回获批当前画布元数据。累计21项定向通过；真实Electron stdio→socket→main/preload→CanvasApp链经原生批准返回1节点/0边，revision绑定，Cmd+R后旧客户端撤权已验。待批准客户端轮询焦点及动态Tab/Shift+Tab循环实机通过；最新关闭守卫实例正常Cmd+Q退出0、日志为空并释放4183，未重新授权读取。浏览器版无本机通道；写入、生成/回填、媒体/素材/文件、OAuth和云端HTTP连接器仍未接入，独立第三方Agent产品配置未验。这项源码功能不在642d3db Alpha包内。[实际连接与权限](../src/features/external-agent/README.md)；[先前缺口研究](research/EXTERNAL-AGENT-MCP-GAP-20261008.md)保留官方远端账户级服务的区别。

## 前批：SFX / 调色专项验收与桌面预发布

- Electron 桌面外壳已接入独立后台、固定 4183、用户目录、`providers.env` 模板、单实例和保存后关闭/刷新。版本 `0.1.0-alpha.1`，开发 Electron 中真实 WebGL 片场已运行，macOS arm64 ZIP 已从642d3db构建，6197个运行文件及包内后台通过核验；实际 `.app` 已通过 Computer Use：片场内 X=1.25 提交、Cmd+Q 退出释放 4183，重开恢复 X=1.25 / Y=0.5 / Z=0。ZIP 上传已核对大小与 digest，[v0.1.0-alpha.1 macOS arm64 prerelease](https://github.com/freeall12/freenow/releases/tag/v0.1.0-alpha.1)已公开发布。FFmpeg / FFprobe 不随包附带。旧 runtime 仅在 manifest 标明 version 1 / dataIncluded false 时自动归档；退出与刷新等待 Agent 及片场正常关闭。[桌面启动与配置](DESKTOP.md)、[安装包重开截图](screenshots/freenow-desktop-packaged-restart-20261007.jpg)、[实际包核验](releases/DESKTOP-ALPHA-VERIFICATION-20261007.md)
- Sonilo SFX 独立原生接入已完成源码接线，20 项定向检查与 4 项受影响 Music 回归通过；文字音效、完整视频单 WAV 与连续分段分别按官方合同预检。本批浏览器实际修改连续分段边界到 3.5 秒，正式提交 8 秒完整视频和 Agent 0.5 秒文字音效，单 WAV 原生播放及 gateway 重开/刷新恢复通过；缺 Key 后禁用，累计仍为 2 次 POST。其余非法配置的零提交范围依据源码回归；固定正弦波不证明真实供应商音质、Key 或账号资格。[SFX 合同](SONILO-SFX-NATIVE-20261005.md)、[前端与范围](SONILO-SFX-UI-QA-20261005.md)
- Agent 调色本轮 4 项 runtime 与 6 项派生回归通过。主任务实际浏览器验证曝光 15 的关闭/重开、保存失败保页与重试后恢复 25，以及生成 960×540 PNG。上下文失败后节点仍为 2（原图加一个结果）；修改到曝光 30 再重试只交接已有曝光 25 结果，不重建输出。持久 PNG 回读与 graph/commit 一致性以及刷新/重开已验，本批 CUA 结束；全参数组合、hover、大图压力与全部视觉仍不作完成承诺。[调色交互与来源](AGENT-COLOR-ADJUST-INTERACTIONS-20261005.md)
- 首页、英文入口和文档按产品使用、功能配置、开发与证据重新组织；长适配器表、旧首页和完整验收批次分别保留在[功能文档](FEATURES.md)、[历史快照](README-HISTORY.md)、[验收索引](VERIFICATION-INDEX.md)。发现性工作限清晰定义、公开入口和准确引用，不宣称搜索排名提升。

## 前批 Sonilo Music、应用交互与长历史

- Sonilo Music接通独立原生API：本地MP4文件上传、视频/文字分段音乐、1–10变体、原任务查询及WAV归档。正式节点与Agent已验真实上传字节、8秒/10秒播放、第二变体历史应用、缺配置/选区阻断与同库重开；固定音频只证明本地链路。[本批证据](LOCAL-SONILO-AGENT-AND-HISTORY-20261005.md) · [配置](SONILO-NATIVE-20261005.md)。
- Product Kit与Director Markup补同快照确认、慢保存合并、失败保留、关闭等待和键盘焦点。实机验证配色/调性、四类批注锚点、真实交接去重及刷新；精确原件SHA保持，鼠标拖选和全部语言/视口仍未验。
- 历史日期网格与行保持连接，600条记录40次选择无行增删，定位后再次10次点击滚动/焦点稳定；关闭后非共享URL为0。定向操作计数减少，不代表整体帧率。交叉审阅另修复Agent音频准备取消后仍提交、预上传失败公开回执遗漏两处实际问题。Agent世界工具旧“只支持GLB/无LOD”描述也已与现有SPZ原生LOD能力同步，未改接口权限。

## 前批 Agent 识别与实际导出

- Agent 首次 SAM2 识别接通源像素选区、原任务查询/取消/续发/重存；首次识别与续发独立确认，批准绑定模型及提供方身份。实机验证保存失败后的同素材重存、原工具回执补存及明确继续，以及换clip后取消、服务重启后仅补未派发分支；未调用真实模型。[本批实现与证据](LOCAL-AGENT-SEGMENTATION-AND-EXPORTS-20261005.md)。
- Agent 结果卡通过正式本地资源解析显示封面，异步读取遇到项目/对话/节点/来源变化时保留原图标。视频规格菜单补模式焦点、当前时长滚入及鼠标横向浏览，键盘与两级Escape通过实机检查。
- Widget 正式入口已实际下载PNG、H.264 MP4与VP9 WebM，视频播放到结束并解码确认40个不同帧；离线HTML完成下载和文件回读，浏览器独立file重开仍未验。[下载证据](WIDGET-WHITEBOX-DOWNLOAD-QA-20261005.md) · [导出边界](FREENOW-EXPORT-BRAND-AUDIT-20261005.md)。

## 前批原生识别与人物站位

- 新视频首次识别接入独立Replicate SAM2原生协议：前向/倒序实际视频、逐帧二值PNG、完整原轴RLE、持久UUID、原任务恢复、兄弟任务失败收尾及显式续发。前后端和本机整链已接通；缺Key时不会调用，真实模型效果未验。[配置](VIDEO-SEGMENTATION-SETUP.md) · [实现与实机记录](LOCAL-SAM2-AND-BLOCKING-20261005.md)。
- 实机与独立审阅补齐来源指纹/供应商身份、下载中状态竞态、短窗口恢复按钮可达性和画布保存恢复。人物站位新增超界clamp、吸附开关、0°/90°朝向、失败原卡重试和一次CB3/刷新证据。[人物站位](AGENT-CHARACTER-BLOCKING-INTERACTIONS-20261005.md)。
- 官方安装包重算883个Resources文件、2,521个ASAR叶文件，92份精确模板正文仍无匹配；22份已存官方应用原件逐字节相同。不以猜测URL或替代模板冒充完成。[来源审计](AGENT-TEMPLATE-SOURCE-AUDIT-20261005.md)。

## 前批分组、拼装与LOD

- 分组/多选复制补完整后代、父子坐标、内部与外部入边、图库和运行归属清理及旧参数引用映射。真实⌘C/⌘V、40像素重复粘贴、Shift多选、⌘D与精确撤销通过；44项定向回归，最终params改动独立单项复核通过。[复制粘贴](CANVAS-GROUP-COPY-PASTE-20261005.md)。
- Agent 拼装审阅补最后编辑保存、同快照CR1、复原建议后“再改改”、关闭等待/失败保留。真实8秒视频播放/seek、慢保存、失败重试、重开与刷新恢复通过；交互6项、实际SDK3项和精确版本宿主回归通过。[拼装审阅](AGENT-CUTLIST-REVIEW-INTERACTIONS-20261005.md)。
- SPZ 使用官方tiny-lod；每视图最多25万参与绘制/排序，完整源与LOD树保留。实机近249,999/远83,321、实际点选、照片/两秒视频、删除释放与撤销/刷新已验。发现并修复主视图/镜头共享场景覆盖拾取状态；补修版近远往返、缓存点选和PNG导出保持同一LOD。原9项LOD、1项相关拾取及新增2项跨视图回归通过。驻留内存、跨设备FPS和长视频未作完成承诺。[LOD实现与实机记录](SPZ-LOD-20261005.md)。
- Replicate二值PNG与双向时轴的前批研究已进入上方1005n实现。导出品牌审计未发现前批新增旧标识；当时缺少的Widget下载实机证据已在本批补齐。[研究来源](VIDEO-SEGMENTATION-REPLICATE-READINESS-20261005.md) · [导出审计](FREENOW-EXPORT-BRAND-AUDIT-20261005.md)。

## 前批副本、人物走位与生命周期

- 普通单节点“副本”还原右移宽度+100、纵坐标保持、分组子节点脱离、完整出入连线顺序及历史清理。交审补齐旧 ID 视频/参数回退，并避免上传图片副本新增默认生成面板；真实右键和一次撤销恢复均通过。[范围与证据](CANVAS-SINGLE-DUPLICATE-20261005.md)。
- Agent 人物走位完成真实拖动/面向、慢保存确认锁、同快照 CB3、失败原卡重试和关闭前保存。浏览器已验最后编辑关闭失败保留、成功重开及真实刷新；没有扩展消息或工具权限。[实机记录](AGENT-CHARACTER-BLOCKING-INTERACTIONS-20261005.md)。
- SPZ 与网格混合点击按同一物理像素的实际深度比较；本地 786,233 高斯的前/后网格、透明孔和隐藏四模式真实点击正确。保持官方 opacity 0.2 拾取语义，未宣称等同最终半透明合成像素。[混合拾取](SPZ-MIXED-PICKING-20261005.md)。
- 视频延长补关闭前取消、来源/设置漂移保护、已派发任务保留及显式画布保存。实机已验取消/漂移零提交，保存失败用正式任务按钮重试仍为同任务/同节点，以及关闭后结果播放与刷新保留；响应为隔离合成数据。[生命周期](VIDEO-EXTENSION-LIFECYCLE-20261005.md)。

## 前批 SPZ 与视频深度

- 用户批准后接入 Spark 2.3.1，复用现有 Three.js，本地 WASM/Worker 按需加载。真实 786,233 高斯通过预览、片场变换/撤销重做/保存刷新、删除清空与恢复、1280×720 PNG 和 2 秒运镜播放，外部请求为零。实际 gzip 展开预算、坐标、地面偏移和渲染生命周期完成定向回归与独立交审；不将本地样本视为真实 Marble 生成验收。[实现与限制](SPZ-LOCAL-RENDERING-20261005.md)。
- 普通视频节点补 Depth Anything Video 同位菜单、自动规格与 1/2 数量；双结果父子任务先持久身份再提交，重启恢复只 GET。真实浏览器验证双版本、铺开、保存失败后零重复提交、刷新后的四节点与两批历史；来源/目标/连线/项目变化及结果应用竞态有定向回归。[本批记录](LOCAL-DEPTH-BATCH-AND-CANVAS-20261005.md)。
- Agent 平台尺寸拖动时取消同宽高比的旧选择，实际裁切得到三张 PNG、一次撤销和单份回执。搜索同项 hover 不再扫描/重写整组结果；500 节点页面的高亮、两级 Escape 和焦点恢复通过实机检查。性能证据限 DOM 操作数，不声称整体 FPS。

## 前批深度与全景

- 视频深度新增 fal 原生接口，正式 Agent 准备、查看回执、完整 MP4 验证、结果归档与播放已贯通；多供应商元数据字段错位已修复。原任务恢复不重提，保存失败只重试应用；该批未接普通入口，已在上方最新批次补齐。
- 旧片场全景局部编辑新增 OpenAI 透视蒙版与球面回投；支持可见局部选区，保留区域外像素，真实保存事务完成才标记已应用。实机核对缺 Key、框选、失败保护、重试与刷新；整图编辑及真实接缝效果尚未验收。
- Agent 关闭保存、配置身份与来源守卫已接线，细项证据和当前边界见[本批记录](LOCAL-DEPTH-PANORAMA-LIFECYCLE-20261005.md)。没有调用真实模型，不将定向验收等同全站完成或整体性能提升。

## 前批 Agent 内嵌交互

- 表演节奏修复键盘删除错目标、快速确认、慢保存合并、失败重试和焦点恢复；剧本结构板确认前等待实际保存，失败不交接，成功状态可恢复。原始安装包HTML保持SHA，生产代理在校验后加载本地派生。[本批记录](LOCAL-AGENT-INTERACTIONS-20261005.md)。
- Computer Use实际验证节拍删除、1800ms慢保存双确认、保存失败重试、关闭/重开与刷新，以及剧本新增场景和两条持久交接。H08预览、暂停和单次模板交接已验；跨幕鼠标拖拽和全部视口尚未验收。
- 三选择器五语言说明当前预览/录屏能力，移除未实现的视频导出承诺；制作进度QA不再使用旧logo作为新完成图片。新回归分别通过并经独立交叉审阅；未调用真实模型或宣称整体FPS改善。

## 前批 Magnific 与 Agent

- Magnific Precision V2 新增独立原生协议，按官方现行 API 的 raw Base64 与四参数直连；无需原站账号或公网素材托管。正式面板、Agent 新建/指定增强目标、来源守卫和原 UUID 恢复已接通。[原生配置](MAGNIFIC-NATIVE-20261005.md)。
- Computer Use 核对官方默认值/范围，验本地缺配置禁用、滑杆、两级 Escape、关闭阻止迟到派发、保存失败只重试保存、unknown 原任务查询与 Agent 审批。专项合同/持久重启与交叉审阅见[本批记录](LOCAL-MAGNIFIC-AGENT-20261005.md)。
- PNG/JPEG/WebP 完整解码后按真实字节/尺寸归档，JPEG/WebP 使用已有 FFmpeg；真实 Key、供应商效果与费用仍未验收。本批未修改整体帧率指标，也未把接口联调当作全站完成。

## 前批皮肤编辑与Agent

- 皮肤编辑三档、配置预检、重度警告、两级Escape、同节点版本和原任务查询已接入；Agent支持新建相连增强节点与既有目标。正式面板保存失败只重试保存，unknown查询不重复生成；Agent派发前持久任务ID、真实PNG归档与刷新回读已Computer Use验证。[本批记录](LOCAL-SKIN-AGENT-20261005.md)。
- 修复审批后新增选区仍可能落图、并发查询跳过来源守卫、坏PNG首回执丢失可恢复任务ID三项问题。专用适配器21/21、Agent11/11及共享恢复5/5等定向检查通过，独立交叉审阅无剩余阻断。
- `skin-tasks-v1`是明确声明的外部网关合同，非Enhancor原生适配；需要网关真实实现三档。仅Enhancor Key不足，公网素材/回调/参数映射和真实供应商效果仍开放。[接口](SKIN-EDITOR-PROVIDER-20261005.md) / [公开原生合同](SKIN-EDITOR-NATIVE-CONTRACT-20261005.md)。

## 前批图片打光与Agent

- 图片重新打光接入独立OpenAI编辑协议：26主光位、亮度、色温、轮廓光完整保留；正式面板与Agent确认、一次SDK调用、PNG归档、来源变化/关闭零提交、保存失败只重试应用已验。[本批记录](LOCAL-RELIGHT-AGENT-20261005.md)。
- Agent审批前刷新配置并先持久任务ID；配置保存同步公开快照。本地图片依赖前移，解决刷新时`LocalAssets.url`尚未初始化造成空图的竞态。新入口刷新512×320源图可解码，零生成、零迁移提示。
- Three打光预览复用每帧临时对象，60帧减少120次Vector3、110次Color、180次数组分配；逐帧状态与投影一致，未宣称整体帧率提升。[性能记录](RELIGHT-STAGE-FRAME-ALLOCATION-20261005.md)。
- 这是显式`parameter-prompt-edit`替代，真实Key/账号与效果待验；不保证物理精确照明或相同输出画幅。浏览器任务列表/待应用结果跨刷新不在本批证据范围。[配置和限制](OPENAI-RELIGHT-NATIVE.md)。

## 前批视频蒙层与Agent

- 视频物体移除／替换新增显式 Wan VACE 原生协议：完整 MP4 与时序蒙层同裁、fal CDN 上传、原任务持久恢复、真实结果校验、原音轨保留和本地归档。正式面板已验证缺配置禁用、关闭阻止迟到派发、移除/替换各一次本机生成、实际播放和刷新恢复。[本批验收](LOCAL-VIDEO-MASK-AGENT-20261005.md)。
- Agent 已保存蒙层编辑接通正式审批与单结果任务，绑定审批时来源和供应商配置；高清替换图、派发前持久回执、连接结果与保存失败重试已验证。结果使用真实首帧封面，刷新保持。[Agent合同](AGENT-VIDEO-MASK-CLOSURE-20261005.md)。
- 平台尺寸应用固定提示改为 freenow / 本机图片裁切，原文按版本和 SHA 派生；保留用户内容与来源。后续1005k已验中文拖动、三张真实PNG及成功回执；其他语言尚未复验。[品牌记录](FREENOW-RUNTIME-BRAND-AUDIT-20261005.md)。
- 新视频首次识别需独立分割配置：1005n已接Replicate二值PNG原生协议，原fal SAM2 RLE合同缺口仍保留。真实供应商权限与模型效果待Key。[原合同缺口](VIDEO-SEGMENTATION-FAL-CONTRACT-20261005.md) · [当前配置](VIDEO-SEGMENTATION-SETUP.md)。

## 前批全景、重拍与图片处理

- Hunyuan图片转360全景接入节点/Agent菜单与原生协议；严格PNG解码、2:1结果验证、原任务恢复、配置预检和原尺寸媒体准备完成。正式菜单、生成、WebGL预览、刷新及错误画幅重试零重提已实操。[本批记录](LOCAL-PANORAMA-RESHOOT-AGENT-20261005.md)。
- 视频重拍补实验性Ark编辑适配，四种镜头模式编译为提示词；来源规格变化和全“不变”前后端阻断。真实8秒视频面板、媒体上传限制与关闭期间迟到配置已验。仅Key不足以提交本地Ark视频，真实生成效果未验。[重拍合同](VIDEO-RESHOOT-EDIT-20261005.md)。
- Agent抠图和显式四参数多角度补高清来源、派发前持久回执与中文标题；确认前零派发、原图512×320、连接结果、刷新同任务已Computer Use验证。全景卡只提交一次并实际解码1024×512，普通生成仍依靠项目历史门控。主画布/片场固定欢迎本地化，不改用户名称。[Agent专项](AGENT-IMAGE-PROCESSING-CLOSURE-20261005.md)。

## 前批视频工具与存储交付

- 短视口右键菜单补键盘焦点自动滚入视野、重开归零；12项定向检查、独立审阅和实际339px高视口验收通过。长中文与禁用项跳过、菜单滚轮、Escape及空白关闭均已实操，画布位置保持。[菜单证据](CANVAS-CONTEXT-MENU-KEYBOARD-VISIBILITY-20261005.md)。
- 视频拟音新增 ThinkSound 显式替代协议，延长镜头新增 Ark 参考生成协议；节点、Agent 卡、路由和缺配置预检已接线。正式按钮/Agent各一次本机HTTP提交，真实8秒WAV播放结束并刷新恢复；时长冲突、缺Key、缺映射零新增任务。延长菜单和两级Escape已实操，本地Ark视频在读取/裁片前阻止。[本批证据](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)。
- 个人素材与文件夹改由现有IndexedDB record单事务保存，旧库只读迁移；6.6MB原图经正式保存、picker插入和刷新后原始SHA/像素一致，旧localStorage库键零写入。补素材加载中的Agent队列取消、收藏离页保护和冲突草稿导出；不盲目覆盖另一标签数据。[容量与恢复](LIBRARY-LOCAL-CAPACITY-20261005.md)。
- 创意HTML编辑器补未保存/保存中的离页保护。官方Web新入口和目录复查未发现92份缺失原文；不制造模板URL。制作进度卡在原文SHA校验后替换固定品牌、F图片和供应商错误指引；深浅色/中英文嵌套iframe实际加载通过。[品牌记录](FREENOW-PRODUCTION-PROGRESS-BRAND-20261005.md)。

## 前批工作流与音频交付

- 10个公开工作流模板、8个真实分类和全部引用媒体本地化，保留72个原节点、112条连线、提示词及相对坐标。实际应用简单/29节点复杂模板、单次撤销/重做、刷新与MP4播放通过；约95MB原封面的列表派生资源降至332KB，原图保留。[本批记录](LOCAL-WORKFLOW-AND-NATIVE-AUDIO-20261005.md)。
- Mureka 8/O2与Seed Audio 1.0原生接口、路由和节点预检接入。31项适配器、3项接线检查及音频前端专项通过；正式按钮播放MP3/Ogg、字幕落图、刷新和缺配置零提交已验，真实供应商待Key。[Mureka](MUREKA-NATIVE-20261005.md) / [Seed Audio](SEED-AUDIO-NATIVE-20261005.md)。
- Agent电商组图质量选项与freeform默认值修复；18项专项及原HTML真实编辑/确认/Escape回焦/无配置零任务通过，freeform提交保留high与真实来源。[组图记录](../src/features/agent-apps/ecommerce-photoset.md)。

## 前批本地化与音频交付

- ElevenLabs Music 原生协议已接入节点、路由与能力预检，支持普通/纯音乐及3–120秒单节自定义歌词。48项定向检查及正式菜单/播放/刷新/缺配置零派发通过；本机0.2秒MP3夹具验证47秒请求合同，不代表真实成曲效果。[音乐适配](elevenlabs-music-native.md)。
- 四个原生音频适配器统一拒绝UTF-8/UTF-16及编码凭据回显；56项独立检查通过，拒绝结果不归档、不发布，重启不重发。[字节保护](AUDIO-CREDENTIAL-BYTES-20261005.md)。
- 同源资源规范化与多角度QA真实归档修复；22项定向检查通过，新session刷新两张PNG可解码、源坐标100.25/80.5保持，没有媒体待本地化提示，旧11项提示会话未改。[资源修复](LOCAL-RESOURCE-SAME-ORIGIN-20261005.md)。
- 堆叠索引单次扫描，51,000节点每次少建51,000个临时数组。25项定向检查与实际落点、隐藏标题、撤销复验通过；大场景中位数未改善，不宣称整体FPS提升。[性能记录](CANVAS-PILE-INDEX-ALLOCATION-20261005.md)。
- 新本地Agent图片替换主画布与片场入口，模型预览提示复用F标识；真实WebGL片场、GLB上传与预览已Computer Use验证并补README截图。[品牌范围](FREENOW-RUNTIME-BRAND-LABELS-20261005.md)。
- Agent三项HTTP基线失败确认为fixture与安全合同不一致，修正后HTTP 7/7、相邻合同56/56。生产锁与凭据保护不变；强杀后媒体锁仍需操作人员恢复。[具体边界](AGENT-HTTP-RECOVERY-20261005.md)。

## 前批接口交付

- 对照官方帮助、安装包 0.4.81、官方 Web 与创作者工作流完成新一批接口核查；修复 Agent 续轮输出字段、Ark edit/extend 输入限制、OpenAI 截断 PNG 响应。[交叉核验与具体 Key 条件](OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md)。
- 新增受限 Qwen 2511 多角度原生替代：服务端队列/原 ID 恢复/真实 PNG 本地归档已验；前端广角与 -45° 零提交、默认单次提交和真实解码通过。不是原站私有转换的视觉等效实现，见[配置](FAL-MULTI-ANGLE-NATIVE-20261005.md)。
- API 配置补全24类操作、缺失路由、网关待核验和真实Key待测说明，修复迟到配置竞态与小窗口按钮遮挡。主要运行品牌和新本地 F 标识已替换为 freenow，来源/许可/用户内容保持；[品牌记录](FREENOW-RUNTIME-BRAND-LABELS-20261005.md)。

## 前批交付

- 图片图层正式右键菜单：复制偏移、新ID、真实层序/删除、一次撤销；修复内部焦点切换提前关闭，补键盘边界与异步clone来源保护。真实PNG和鼠标/键盘通过，见[图层菜单](IMAGE-EDITOR-LAYER-MENU-20261005.md)。
- Agent流式代码即时复制/自动换行；增量和完成保留code/toolbar身份、焦点及横向滚动，复制读取当前内容。实际复制粘贴、流式增量、完成与切空通过，见[流式代码](AGENT-STREAMING-CODE-CONTROLS-20261005.md)。
- 片场对象聚焦保持整场导航速度，仅全景按当前场景半径重算。真实GLB场景树、F、对象聚焦与查看全景通过，见[聚焦导航](STUDIO-V2-FOCUS-NAVIGATION-SPEED-20261005.md)。

- 素材库保留高清原图、像素、裁切和来源；picker解析本地资源。修复 `asset:` 视频下载并补项目/源身份保护，真实PNG哈希、FFmpeg两秒320×180导出和刷新通过，见[素材往返](LIBRARY-ASSET-ROUNDTRIP-20261005.md)。正式素材库容量迁移已在本批接入；浏览器配额、长期运行和自动冲突合并仍不在完成范围。

- 图片编辑器补官方逻辑像素吸附与瞬时辅助线；真实左边缘/半倍中心拖动、一次撤销、PNG排除辅助线与刷新恢复已验，见[图片吸附](IMAGE-EDITOR-ALIGNMENT-GUIDES-20261005.md)。
- 「应用所有历史」按生成批次分行并允许单个真实结果；新节点隔离源编辑文档，解码及保存后保护项目身份。正式菜单、整组一次撤销/重做和刷新已验，见[历史展开](CANVAS-HISTORY-EXPANSION-20261005.md)。
- Agent已发送消息补48px图片/视频缩略、失败回退、重绘复用与媒体清理；实际解码、会话刷新恢复和切空通过，见[消息附件](AGENT-MESSAGE-ATTACHMENTS-20261005.md)。
- 片场关键帧拖动补capture与文档身份保护，取消主动释放捕获。同名运镜切换后旧松手不污染轨道，正常提交一笔历史，见[运镜拖动](STUDIO-V2-TIMELINE-KEY-DRAG-20261005.md)。四路并行开发和互相只读交叉审阅完成，验证限本批与相邻功能，没有重复全库测试。

- 片场数字草稿补官方取消/提交语义，未编辑失焦与Escape保持真实精度；跨轴拖动保留控件和两笔历史，见[片场精度验收](STUDIO-V2-NUMERIC-DRAFT-20261004.md)。
- Agent目录返回/整目录引用纳入键盘索引，补Tab、两级Escape和鼠标焦点；正式bundle写入真实引用已验，见[目录导航](AGENT-REFERENCE-FOLDER-NAVIGATION-20261004.md)。
- 无效正式片连线落点按官方结束手势；六条实际鼠标路径及正常回退菜单已验，见[连线验收](CANVAS-CONNECTION-FINAL-DROP-20261004.md)。

- 公开仓库移出5件冗余/无引用资源，扫描当前树和可达历史未发现真实凭据；补静态抓包读取隔离与可复用检查，见[仓库检查](PUBLIC-REPOSITORY-AUDIT-20261004.md)。
- 视频23个根模块移入业务目录；Agent禁用模型说明补官方hover/focus覆盖层及关闭保护，并经真实Computer Use，见[视频目录整理](VIDEO-MODULE-ORGANIZATION-20261004.md)、[模型反馈](AGENT-GENERATION-DISABLED-MODEL-HOVER-20261004.md)。
- Agent整数时长数字输入补两级Escape，音频取消抑制关闭/回焦期间的重复blur提交；真实输入与回调已复验，见[时长取消](AGENT-GENERATION-DURATION-ESCAPE-20261004.md)。

- 手动/智能视频剪辑补项目与来源对象保护，保存确认后再显示成功；保存失败保留结果并只重试保存。真实 FFmpeg、撤销重建拒绝迟到结果与刷新解码通过浏览器复验，详见[剪辑验收](VIDEO-TRIM-RESULT-RECOVERY-20261003.md)。重试收据仍限当前页面。
- README 增加五张实际本地功能截图及隔离复现入口，补充[开发维护指南](DEVELOPMENT-GUIDE.md)，明确入口、构建、定向验证及资源/存储边界。
- OpenAI 原生擦除、带参考图重绘和扩图；三类正式编辑器请求、真实 PNG 解码与刷新回读通过本机模拟供应商验证。
- ElevenLabs 原生音效；1.25秒、循环、0.37影响度准确提交，实际 MP3 播放/刷新验证，修复音频数字输入失焦丢值。
- 千节点布局保留精确坐标和撤销/重做/保存；片场120镜头目录单次读取、151模型分页焦点通过实际浏览器验证。
- Product Kit 独立演示资源清理与来源/派生哈希记录。详细结果随该模块文档记录，不以网络拦截代替资源修复。

[本批完整记录](LOCAL-MASKED-SOUND-AND-PERFORMANCE-20261003.md)列出定向检查、Computer Use 和实际证据。供应商均用本机夹具，未使用真实 Key；该证据只证明请求/状态/媒体流程。

## 继续推进

1. 按官方参考逐项完成全站菜单、hover、坐标、微动效和性能验收。
2. 补齐92份精确创意模板与仍缺失的资源；继续 SPZ 设备压力、长视频、按页流式加载和复杂半透明场景验收。原生LOD与普通混合拾取已按对应专项范围补齐。
3. 完善专用供应商适配，配置真实Key后验证可访问型号、账号资格与输出质量。
4. 完成剩余长期存储、恢复和跨页面边界。
5. 继续完成品牌、嵌套应用与导出清点，并验证旧项目兼容和运行无原站依赖。

排除团队、社区、分享营销、付费宣传与计费。保留用户数据、来源记录和第三方许可。更细限制见 [当前缺口](CURRENT-FUNCTION-GAPS-20261003.md)；旧文档中的阶段待办不自动代表当前未实现。
