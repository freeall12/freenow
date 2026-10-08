# Studio V3 Saved Views／视图管理：官方证据与下一切片 · 2026-10-08

本轮只把安装包文件作为 UTF-8 文本读取，没有 import、eval 或执行官方 bundle，没有访问供应商，没有浏览器实机验收。当前工作区为 `outputs/canvas-replica`、分支 `main`；已有 plan/paths 等未提交变更均未修改。唯一新增文件是本文，不修改 production、tests、README，不提交。

## 1. 决策结论

原包有完整的 **View 领域基础**，但本轮没有找到独立 **Saved Views 面板、保存按钮、更新到当前视角按钮或 restoreView 的 UI 调用**。可确定实现创建、读取、相机快照更新、重命名、仅删除 View、选中、恢复和状态关系；其中「更新到当前视角」与独立管理 UI 需要标为本地增强，不能声称还原了不存在证据的官方界面。

官方可见的三个入口是「3D／俯视」导航切换、状态菜单、镜头管理。Saved View 是第四种领域对象，不能直接套用 `camera-manager` 后宣布完成：普通 capture View 不进入镜头目录；无摄像机链接的 View 可以恢复相机，但镜头卡片 jump 需要真实摄像机实体，当前 `openShot` 会拒绝它。

下一最小切片应完成真实 session 上的 View CRUD＋独立导航相机恢复，再接一个明确标为本地补齐的入口；摄影、镜头导出和 Agent 写操作各自保持现有合同。功能验收必须包含保存重开与 undo/redo，不能以列表出现或相机移动视为持久保存成功。

## 2. 可复查的官方文件与定位规则

官方目录：`/Applications/TapNow.app/Contents/Resources/web/assets/`。本轮重新读取并计算如下 SHA-256。

| 代号 | 文件 | bytes | SHA-256 |
| --- | --- | ---: | --- |
| A | `ThreeDWorkspace-BzPphAqB.js` | 919292 | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| B | `WorkspaceViewfinderButton-BHqIWibq.js` | 99329 | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` |
| D | `index-BsHyQ2qj.js` | 12943515 | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| E | `course-api-base-url-CGXqZmAy.js` | 3444954 | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| F | `ThreeDActivityOverlay-CIotE4kO.js` | 5521 | `2c4c2f2137cb343da081df58245c214fe7ad262341e0f0f024277ed5174ee933` |
| H | `EnvironmentLightingPickerContent-CigxxFZu.js` | 94564 | `b9b06fd215e4a951798c1b88e32842fe71aac5a94f57f7128d5eaf6aa8f9d8e8` |

本文 offset 均为 `fs.readFileSync(file,'utf8')` 之后 **JavaScript 字符串的零基 UTF-16 code-unit offset**，不是字节、行号或 Unicode code-point offset。用 `source.slice(offset, offset + length)` 复查；下面短字符串是定位锚点，不执行它们。

| 文件／offset | 锚点 | 证明内容 |
| --- | --- | --- |
| A 39692 / 40038 / 40211 / 40592 / 40979 | `function aj(` / `ij(` / `sj(` / `cj(` / `lj(` | View save／patch／remove／setActive 与 store action |
| A 20647 | `function He(` | mutation 的 content／background／none 脏标记 |
| A 43461 / 43742 | `function fj(` / `function pj(` | stage／setup 切换清 activeView |
| A 245003 / 245344 | `function qx(` / `function rW(` | View 构造、shot tag 条件 |
| A 244933 / 244964 | `function Em(` / `function nW(` | 读 camera／派生描述符替换 camera |
| A 277037 | `te=c.useCallback(oe=>{if(!u||!w.captureSetup` | saveCurrentView |
| A 277362 / 277496 / 277696 / 278339 | `le=c.useCallback` / `he=c.useCallback` / `ce=c.useCallback` / `Re=c.useCallback` | shot View 包装、改名、删除、恢复 |
| A 281161 / 281180 / 281254 | `saveCurrentView` / `ensureIndependentShotViewFromCurrentCamera` / `restoreView` | 能力导出；前两者及 restoreView 各仅一次能力名命中 |
| A 272562 / 273309 | `function lk(` / `function BW(` | captureSetup 来源、activeView 解析与运行时装配 |
| A 112311 / 112874 / 151790 / 152525 | `function Gn(` / `function _n(` / `const Tn` / `jo=c.useCallback` | 领域/引擎转换、目标相机与可见相机区别 |
| A 195767 | `o.setActiveView(null)` | camera possession 进入时解除 View 选中 |
| A 300773 / 303574 / 680883 | `activeView?.id` / `activeView?.camera` / `activeView:g` | entity focus 退出、光学 HUD 上下文、导出命名来源 |
| A 701015 / 702129 / 702212 / 702654 | `function SK(` / `CK(` / `EK(` / `RK(` | 显式 View／隐式 camera 镜头派生与排序 |
| A 719330 / 719600 / 720380 / 727003 | QK rename／delete callback、`function dw(` / `function p6(` | 镜头事务、级联删除、jump 接管 |
| A 727910 / 731251 / 732146 / 733162 | `function m6(` / `h6(` / `g6(` / `y6(` | 镜头管理面板、header、组、卡片 |
| A 737564 / 738496 / 739339 | `function b6(` / `nf(` / `w6(` | 删除确认、preview、批量 footer |
| A 790593 / 791261 / 793876 / 795073 | `function O7(` / `wp(` / `L7(` / `N7(` | 3D/俯视、状态入口/面板/行 |
| A 343501 / 797948 | `function Ve(` / `function af(` | 普通菜单行关闭、状态辅助按钮 hover／tooltip |
| A 856200 / 857190 / 864312 | `function CE(` / `function rY(` / `function mY(` | 历史照片、home、编辑入口条件 |
| A 721266 / 723476 / 724266 | `function o6(` / `a6(` / `i6(` | 镜头临时缩略图、零时刻采样、320×180包围框 |
| E 1526038 / 1527028 | `const Hd=` / `iOe="setup:state-1"` | 缺省 stage-default／setup:state-1 |
| E 1562633 / 1566916 / 1568031 | `function BLe(` / `HLe(` / `cY(` | View 关系规范化、反序列化、camera 保存规范化 |
| B 56590 / 57642 / 59112 / 64408 | `Ol=` / `floatingPanel` / `function vs(` / `function Ps(` | radius、层级、锚定夹紧、outside pointer dismiss |
| H 76831 / 78812 | `function Yr(` / `function yc(` | 导航／状态共用 disclosure menu、300ms tooltip |
| D 9164345 / 9164698 / 9165037 / 9165837 | `状态 {{index}}` / `镜头管理` / `关联的机位` / `3D（现场）` | 中文文案；同内容另见 10046xxx–10048xxx 字典 |

对全部 `assets/*.js` 的字面字符串扫描结果：`saveCurrentView`、`ensureIndependentShotViewFromCurrentCamera`、`restoreView` 只在 A 的能力导出出现；`saveView` 在 A 有 store 声明及 adapter 映射两处；`views.patch` 仅 rename callback 一处。`Saved Views`、`Saved View`、`savedViews`、`savedView`、`保存视图`、`视图管理` 未命中。`updateView` 在 E 的数据库 grid view config 命中三处，与 3D View 无关，不能串用。字面扫描不能排除远程下发、其他版本或间接动态访问；结论只限定这份安装包。

## 3. View、镜头、照片与状态分别保存什么

| 对象 | 真正的数据 | 关联与来源 | 不应推断的能力 |
| --- | --- | --- | --- |
| `worldSpace.views` | 相机 pose/FOV/画幅/光学、名称、stage/setup、tags、时间戳、可选 notes/reference/duration/generationContext | 必须所属独立 setup；可选 sourceCameraEntityId | 不是照片、不是整个 scene 快照、不冻结所属 setup 的角色/布景/环境或动画 |
| camera-shots | `SK` 派生列表；shot-tag View 或 `implicit-camera-shot:${setupId}:${entityId}` | 显式 View 优先；剩余 visible camera 自动派生 | 隐式项不写 views；列表项出现不是已保存新 View |
| `capturedPhotos`／historicalPhotos | 已有 id/src/sequence/width/height/source/cameraState | 与 scenePlay 平级的兼容图片集合 | 无 View CRUD；无来源 setup/view ID；不恢复相机、不重渲染、不自动追加新快门照片 |
| setup | 角色/道具/摄像机状态、temporal、planDrawing | baseline 共享内容与 independent 内容合并 | restoreView 只选择已有 setup，不回滚它到创建 View 时的布景 |

`qx` 的精确构造字段为 `{id,stageId,setupId,sourceCameraEntityId,label,camera,notes,referenceIds,tags,durationMs,generationContext,createdAt,updatedAt}`；默认 `stageId='stage-default'`、`setupId='setup:state-1'`、`referenceIds=[]`、`tags=['capture']`、`now=Date.now()`，createdAt/updatedAt 同 now。camera 是必传参数，View 构造本身没有「默认 50mm」或其他默认镜头。

E 的保存还处理已有 `viewportDrawing`：序列化 camera、drawing、duration/timestamps 四舍五入，反序列化 drawing；qx 不创建 drawing，A 没有 View drawing 编辑 UI 证据。本地 schema 已允许该字段；本轮不能宣布 drawing 创建/绘制已实现。

E `BLe` 过滤不存在 stage、setup 非 independent、setup/stage 不同以及 sourceCameraEntityId 指向非同舞台 camera 的 View；保留无 sourceCameraEntityId 的 View。合法 activeView 优先决定 activeStage/activeSetup；references 去除悬空 view target，outputs 只保留源 View 仍在的项。本地 schema 严格拒绝不合法关系，不做官方迁移修复。

## 4. 逐操作的精确能力与守卫

| 操作 | 原包可证明的行为 | 守卫与返回值 | 本地下一切片限制 |
| --- | --- | --- | --- |
| 创建 `saveCurrentView(options)` | UUID；相机 `_n(getCameraState())`；名称 `options.label ?? 'View '+(全局views.length+1)`；notes；tags `options.tags ?? ['capture']`；当前 captureSetup | 无 worldSpace、无 captureSetup、baseline → null；否则调用 views.save 后返回 ID，无 await | 必须宿主 readonly/播放/事务/来源门禁；英文默认名是官方原值，中文名需明确本地设计 |
| `ensureIndependentShotViewFromCurrentCamera` | 在上项基础默认 tags capture+shot，保存后再 setActive | 无结果 → null；否则 ID | 不自动创建 independent setup、camera entity 或 sourceCameraEntityId；不能直接交给 openShot |
| 更新到当前视角 | store `patchView(id,patch)` 可替换 camera 与其他字段，updatedAt=Date.now | `ij` 仅 ID 存在才变；浅合并，未见字段 whitelist／无变化判定 | 无官方 update-current-camera callback 或可见按钮；要新增纯 reducer，锁住 id/stageId/setupId/createdAt，按实际相机源写 camera |
| 重命名 | trim；仅 patch label | readonly、空、名称未变、View 不存在 → false；成功 true | 非 shot View 不能依赖当前只列 shot 的 renameShot；采用同样 name guard |
| 仅删除 View | 移除 View、source.id 同 ID 的 outputs、references 的 view targets；同 ID activeView=null | readonly/不存在 → false；成功 true | 不删除 camera、setup、temporal、照片或已导出的画布节点；不要调用 removeShot 代替 |
| 选中 `setActiveView(id)` | 设置 activeViewId 并切 activeStageId/activeSetupId | null 只清 view；不存在/所属 setup 不存在/baseline/已选同 ID → no-op | 不移动相机、不进入摄像机接管；selectedEntityId 是另一个选择体系 |
| 恢复 `restoreView(id)` | 存储的 `view.camera` 经 Gn 转为 engine state，`animated:true,duration:.8`，然后 setActive | 仅查 View 存在；不存在不动作；未见 readonly、playing、capture、history guard；callback 无成功回执 | 必须走独立导航 camera API，不能借 editor camera 写作者状态；跨 setup 等同步后再恢复并作来源围栏 |
| 切状态 | pj 设置 active stage/setup 并 activeView=null | 不存在或同 setup → no-op；同 setup 点击不会清已有 activeView | 沿当前 switchSetup 门禁；不要把列表点击当 View restore |
| 切舞台 | fj 确保独立状态，切到该舞台首个 independent setup，清 activeView | 未找到 stage → no-op；同 stage 可由 dj 保证结构后 no-op | 本地没有舞台管理 UI，跨舞台 View 的恢复须明确是否支持后再呈现可用 |

创建 callback 没有传 `sourceCameraEntityId`、`referenceIds`、`durationMs`、`generationContext`；即使 options 里有这些字段也不会传播给 qx。`label:''` 不触发 nullish fallback，官方低层保存没有 trim/非空校验；本地 strict schema 不应为复刻这种弱门禁而放宽。

`captureSetup` 来自 `lk` 的当前 stage baseline+independent 合并 `renderSetup`，ID 仍是 independent setup ID。保存相机不采样整个 setup，也不保存 playhead。创建是 `getState` 目标相机：Tn 在相机 transition 中返回目标 pose/fov；jo/getVisibleState 才返回正在屏幕显示的插值帧。当前本地只有 `runtime.getVisibleCameraState()` 公共 API，且会从真实 active camera 读取；若下一切片直接使用它，应写明「保存当前可见视角」是本地确定的语义，不能写成已经一比一实现官方 transition 保存行为。正交俯视图转换出的伪 perspective FOV 也不能直接作为 Saved View 真相机，首切片应明确只支持 3D 导航视角。

`nW(view,camera)` 只生成内存派生对象，未 views.patch。显式 shot 若 source camera 在有效状态中有 camera，目录优先当前 camera 覆盖 View 存储 camera；恢复 View 仍取存储 camera。更新 View camera 可能改变恢复构图，但链接 camera 的镜头缩略图仍使用实体 camera，不能误判更新失效或暗中把两者都写掉。

## 5. 选中、恢复与控制生命周期

1. `save` reducer aj 追加并激活 View/stage/setup；重复 ID、非独立或跨舞台结构 no-op。callback 返回 ID 不意味着 reducer 已接受或已持久保存。
2. `cj` 只选择；`restoreView` 同时发相机动画与选择。没有自动根据 `activeViewId` 重载 pose 的通用 effect 证据，打开存档时 ID 选中不能证明相机已恢复。
3. activeView 或 activeSetup ID 改变时 A 的 entity-focus effect 调 `yt.exit()`；HUD 接收 activeView.camera（部分 cameraSession 情况屏蔽），导出工具使用 activeView.label 作 camera label。
4. 进入 director camera possession 显式 `setActiveView(null)`，它不是创建/更新 View。camera manager jump 切 setup 后调用 op→enterDirectorCamera，用 shot.camera 作初始值；不能将它叫 restoreView。
5. 只删除 View 后当前相机位置不被 sj 重置；只清相关领域选择与关系。reset home（快捷键 0）是独立导航操作，不能拿来删除/覆盖 Saved View。

官方 restore callback 的调用次序是先 camera change，再 setActive。未运行原包证明跨 setup 异步资源切换期间的画面；本地已有 async graph.sync，应依当前 session 的源身份等待该 setup 的真实资源同步，再以一次有围栏的导航恢复避免迟到动画落到新片场。此顺序调整属于接线稳健性补齐。

## 6. 每个已证实的按钮／菜单；Saved Views 缺证据处

独立 Saved Views 的创建、更新、恢复、删除按钮、空态、缩略图策略、排版、hover、tooltip、快捷键、dismiss 全部 **未定位**。下面只列当前包确实存在的相关 UI；可作风格材料，不能冒充独立 Saved Views 截图验收。

| 入口／按钮 | 视觉／hover | 键盘与关闭 | 真正动作 |
| --- | --- | --- | --- |
| 导航 View trigger | O7 图标18px/1.75；label 3D 或俯视；上方/start disclosure；H Yr tooltip 延迟300ms；普通 chrome 胶囊圆角 | click toggle；enabled 时注册 menu Escape；outside pointerdown 关闭；disabled 后关闭；没有 Saved View 快捷键 | 仅 onSet/topView 两项 |
| 3D（现场）／俯视 row | 两项图标18px/1.75；Ve 普通菜单 row，标题可截断，hover/focus 共用菜单样式 | 默认 closeOnSelect；onClick 未 preventDefault、未 disabled 时关闭；未见 O7 自定义方向键或 View 列表 | 切显示模式，不写 views |
| home | locate-fixed20px；tooltip 含 0 | aria-keyshortcuts=0；独立导航 reset | 恢复 home，不是恢复 View |
| 状态 trigger/row | trigger max180px 截断，上方/start；行高36px，主按钮32px，选中 gold class；hover #303030；名称最大208px截断 | 行点击切状态并关闭；rename 下一 RAF focus/select；blur/Enter 提交、Escape 取消，IME guard，stopPropagation；close 清 rename/delete | 独立 setup 列表，createdAt/ID 排序 |
| 状态克隆／重命名／删除 | 三个28px圆按钮、图标14px/1.75；tooltip300ms；hover #3a3a3a；delete hover #ff9a9a | 辅助 click preventDefault+stopPropagation；删除 anchored top/end offset6；cancel dismiss；与主行选择分离 | clone 会重映射已有 views；删除状态移除其 views |
| 镜头管理 trigger | clapperboard20px/1.75；active/aria-pressed；tooltip「查看、整理和导出镜头」；busy disabled | controlled nonmodal；Escape 分层 delete→rename→batch→panel；onOpenChange(false) 清内部选择/草稿/确认 | 进入 camera-shots 管理，不列纯 capture View |
| 镜头卡片 jump | card #fff/3.5%，hover7%；thumbnail object-contain/top；button focus内描边2pxwhite55；title14px、metadata12px | 原生 button，点击 jump；busy disabled；未见独立 View 恢复快捷键 | 必须 camera linkage；切 setup并进入作者 possession |
| 镜头重命名／保存名称 | 28px圆按钮；pencil14px/1.75；check14px/2；white78，hover8%；input 28px/radius4/bg8% | 下一 RAF focus/select；blur/Enter 提交、Escape取消；IME guard；check pointerdown.preventDefault 保持 input focus | 显式项 renameView；隐式项改全局 camera definition label |
| 镜头删除／取消／确认 | trash-2 14px/1.75；rose hover15%；confirm top/end offset8，宽min280px/100vw−24；p12；button36px；确认 hover rose20% | playing 或 busy 禁删除；必须先成功退出当前相关 possession；Escape先关闭confirm | View＋链接机位/动画级联，强于仅删除 View |
| 导出到画布／全选／批量 checkbox／footer导出／取消 | header56px、button36px；export16px/1.9；checkbox18px圆，选中white底black check12px；footer border10%/px12 | 无选项/忙时导出disabled；Escape从batch返回normal；export callback同步true即退出batch，不等最终保存 | 使用拍摄/导出管线，不创建 View |
| 历史照片 | items.length>0 才有 image20px/1.75按钮；tooltip明确新照片直接到画布 | gallery 生命周期见 photo-history 专项；不为它新增 View 写操作 | 只读已有 capturedPhotos 图片 |

镜头面板精确几何：width `min(560px,100vw−24px)`，maxHeight `min(620px,100vh−112px)`，top offset12、align center、collisionPadding12，shadow `0 8px 28px rgba(0,0,0,.24)`；F panelProminent radius16/bg-popover50/blur56，B floatingPanel z81；body pb16/pl16/pr8；组 pt20/首组0；网格 auto-fill minmax156px、gap12，thumbnail radius8。源码里的 skeleton 有白色透明渐变与pulse；这不是用户授权新增渐变式产品设计，若复用需限定 loading 占位。本轮未运行 CSS cascade，最终 border/颜色/布局视觉不宣称实机核验。

H Yr 的具体 dismiss 证据只有 menu Escape 与 B Ps 的 capture-phase outside pointerdown；surface/trigger/menu group 内目标忽略。不要将本地 menus 的 blur/wheel/focusout 关闭全部写成官方此按钮已证实行为。镜头 manager 使用另一套 popover，未显式 busy-on-outside 或 busy-on-Escape 阻止关闭；关闭不等于 export task 取消。

中文已定位 `world.director.shotManager.*`：镜头管理、查看/整理/导出镜头、暂无镜头、批量导出、保存名称、重命名“{{shot}}”、删除“{{shot}}”？、跳转到{{camera}}、关联的机位和动画也会一并删除、取消、全选、导出到画布、预览不可用。`保存名称` 只代表 rename 提交，不是保存当前 View。默认 `View N` 是英文字符串，无该保存能力的中文 i18n key。

图标均可复用现有 `src/features/studio-v3/icons.mjs`，来自 D 的静态 geometry：`onSet` mouse-pointer-2（1437010）、`topView` map（1419818）、`cameraManager` clapperboard（1273059）、`rename` pencil（1462322）、`delete` trash-2（1571916）、`check`（1259964）、`historicalPhotos` image（1388608）、`restoreHome` locate-fixed（1409265）。这些 UTF-16 offset 与现有 metadata 逐项读取对照；没有找到专用 Saved Views icon，不引入新图标依赖。

## 7. 照片、缩略图与 Agent 的关系

官方临时缩略图 o6 的 fingerprint 是 runtime scene signature＋shot.id＋cameraEntityId＋shot.camera＋setup状态，不是 View 的 image revision。仅面板 open 才开始，串行零时刻采样渲染，按画幅适配320×180包围框，非法 ratio fallback16/9，ready/error分别呈现，旧URL revoke；它既不 `views.save` 也不追加 capturedPhotos。把 Saved View 列表做缩略图是可用渲染能力上的本地增强，首切片可先不渲染，不能用旧照片冒充构图预览。若接入已有 preview，要使用 **View 存储 camera**、所属 setup 当前内容与独立 renderer；不要先用 listCameraShots 的 linked camera 覆盖 Saved View 构图。

官方快门直接 exportToCanvas，没有找到 saveCurrentView 或 appendHistoricalPhotos 调用。保存 View 不能暗中拍照，恢复 View 不能生成新资产；View 移除的 outputs 是领域关联数据，不能据此删除现有画布导出节点或 LocalAssets 文件。`generationContext` 只是可选领域字段，没有证据表明创建 Saved View 自动发起 Agent／模型任务。

A DU 680599 把 `activeView.label` 交给 `getActiveCameraLabel` 用作 export 命名，不能推断它授权 Agent View CRUD。当前本地 `entry.mjs:617` 的 read 返回完整严格 state，因此 Agent 能看到 views；capabilities 仍仅 read/select/undo，`select` 只接受当前有效实体 ID，不能传 View ID；其他动作明确抛错。本切片不增加 Agent 写能力。将来显式授权接入应调用同一纯 reducer/session/门禁并返回实际 dirty/saved 结果，不直接改 host payload 或假称能力。

## 8. 当前 V3 缺口与真实 session 接线

本轮只读当前源码，未重新运行既有测试；以下是源码状态，不代替之前各批浏览器验收记录。

| 已有基础 | 文件／位置 | 仍缺什么 |
| --- | --- | --- |
| createView＋严格关系校验 | `schema.mjs:292,372` | 对外动作层；保持 JSON/finite/独立setup/reference关系与相机光学校验 |
| addView／removeView | `world-space.mjs:91,164` | patchView、setActiveView；现有 addView 已 clone＋assertState，不直接写 array |
| view逐项diff／active选择/级联undo | `history-patches.mjs:7,10` / `history.mjs` | 新动作选显式目标setup lane，跨stage/setup选择采用既有 world选择合同 |
| guarded session＋500ms autosave | `session.mjs:6,58` / `ownership.mjs` / `persistence.mjs` | 新入口不得跳过 isCurrent/source/project/revision 与 flush/closeGuard |
| 镜头 rename/remove | `camera-shots.mjs:66` | 只覆盖当前 setup shot目录；不能用于普通 View，removeShot会删除camera |
| setup clone/delete | `setup-actions.mjs:5,37,62` | 已映射 View ID和camera source／target并级联清理；新管理列表须刷新并清失效选中/异步预览 |
| 导航 menu、相机 control/viewfinder | `entry.mjs:120` / `runtime.mjs:571,602` | 既有 menu仅3D/俯视；getVisibleCameraState可读；缺公共 restoreSavedViewCamera 动画API，不能外部直改orbitCamera绕过leases |
| 来源/事务/摄影/播放门禁 | `entry.mjs:74,367,375,454` | 新View动作须复用；恢复等待 lastSync 与来源围栏；Saved View restore不进入 temporal authoring |

建议接口仅作为 **下一实施切片**，本轮未创建：`listSavedViews(state,{stageId,setupId})`、`reduceSavedViewAction(state,{type:'create'|'update-camera'|'rename'|'remove'|'set-active',...},{now})`，返回 `{ok,changed,state,lane,viewId,reason,message}`。create明确实际camera源与tags，不默认加shot或sourceCameraEntityId；update-camera只改camera/updatedAt；remove只复用 removeView。list 读取全部真实 views，显示 tags 与所属状态，不能仅以 `!shot` 隐藏用户已有View，也不能加入implicit-camera-shot。

真实写入步骤：

1. 复用 finishControlScope；photo gallery、待关键帧确认、导出busy/待receipt、拍照busy/待receipt、房间草稿、未提交entity/camera control都先结束或拒绝。取消placement/plan gestures、camera creation和transform，关闭旧菜单；这不是给用户新增确认，而是已有会话守卫。
2. await allowStructuralWrite（它调用 temporal.beforeWrite、lastSync，并复核 session/source/setup identity），在 await 后从 session.getState 重新查目标View与setup，不能提交 await 前缓存的完整state。
3. 内容创建/更新/改名/删除：`session.change(reducer,{lane:setupLane(view.setupId),label,scope:{kind:'world-space'},content:true})`；由宿主传唯一UUID。若修改跨setup目标，使用目标setup显式lane，不用director的当前setup自动lane冒写。
4. select/restore 的 active stage/setup/view reducer应沿既有状态选择 `lane:'world',content:false`；它仍是持久state变化，会标dirty。runtime导航相机变化不写实体camera、temporal、history preview或camera history adapter。
5. 恢复：选择合法目标＋等待 lastSync，再用 detached navigation camera API应用完整stored optics/pose、0.8s动画；以session/source/stage/setup/fence标识恢复租约，新切换/关闭/恢复请求/控制进入打断旧动画。restore失败报告清楚领域选中是否已变化，不假称整体成功。不要将当前同viewId的setActive no-op误当restore无需执行。
6. UI反馈区分「私有领域已改／等待保存／已保存／保存失败」；真实 flush成功前不能显示已持久保存。复用session保存失败保留dirty及关闭阻断、重新保存与来源围栏；不得使用无守卫 `CanvasApp.updateNode` 代替 publishStudioV3。

## 9. 最小实施切片与验收界线

| 切片 | 具体产物／行为 | 完成证据 |
| --- | --- | --- |
| S1 View动作与session | 无新依赖纯reducer，create/camera-update/rename/view-only-delete/setActive；真实session接线，精确lane与脏状态 | 默认值/非法baseline和跨stage/重复ID/无变化/删除outputs+refs/undo恢复全部字段及选择/来源变化拒绝；刷新重开真实View保留 |
| S2 3D导航恢复 | runtime独立导航恢复API，完整光学、0.8秒动画，可打断、跨setup await同步；只读导航范围单独定义 | 构图/焦距/画幅/DOF正确；不动实体camera或temporal；动画中再restore/切setup/关闭/改source没有迟到覆盖；恢复同ID仍移动相机 |
| S3 本地管理入口 | 可读真实View列表，创建、恢复、更新、rename、仅删除确认、真实active状态与保存状态；名称/文案/视觉明确本地补齐 | 空/加载/保存失败、长中文、Enter/Escape/IME、输入焦点、outside-dismiss与分层Escape、按钮busy、plan/possession租约和来源切换实机检查 |
| S4 可选真实thumbnail | 把现有独立摄影/preview用在View存储camera，取消与URL释放 | 真实像素、非camera entity替代、正确setup内容、更新cache失效、关闭/删除无迟到URL；不创建照片或画布节点 |

S1/S2 必须先闭环，不能用可点击 mock UI 标成「完整 Saved Views」。S3可以满足用户工作流，但官方忠实度只能标「领域语义对照；独立面板为本地补齐」。不以 Agent、照片、批量导出、分享/账号/付费扩大本批范围。

读取camera还要区分用户选定画幅与viewport实际aspect：当前 `getVisibleCameraState` 使用 active camera.aspect（正交时以frustum比值计算）覆盖返回的frameAspectRatio。新snapshot adapter须明确取配置画幅还是当前可见viewport，不可把返回值未经核对就称为官方 `_n(getState)` 等价。恢复也须重新建立navigation target与光学frame，不能只设置position/rotation后被OrbitControls下一帧覆盖。

未确定：官方其他版本是否有 Saved Views UI、间接动态调用、安装包运行时菜单最终布局、跨setup restore动效、打开存档是否自动应用相机、更新View的官方按钮与键位、View绘图交互。以上没有证据，不补写假合同。本轮完成6个文件hash复核、72个官方UTF-16锚点逐项匹配、8个图标metadata与D源码注册点对照；新增Markdown无尾部空白，diff whitespace检查通过。没有运行产品功能测试或官方实机完成声明。
