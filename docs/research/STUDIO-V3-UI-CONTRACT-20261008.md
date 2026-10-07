# Studio V3 官方 UI 契约 · 2026-10-08

本契约依据本机 `/Applications/TapNow.app/Contents/Resources/web/assets/` 安装包静态源码。新导演工作区是覆盖画布的全屏场景，顶部 chrome、底部浮动操作条、按钮展开的面板与菜单、选择后的上下文 HUD 共同组成界面。源码没有 V2 的常驻左侧对象树和右侧 inspector；不得用旧 V2 布局替代当前工作区。下述静态事实不等同于浏览器视觉验收。

UI契约交付包含 `src/features/studio-v3/icons.mjs`、`src/features/studio-v3/official-layout.css` 和本文；后续追加独立菜单helper `menus.mjs` 与定向测试。未修改 runtime、数据模型、持久化、入口和全局样式；原始整理文件及提取脚本保存在 ignored `reference/studio-v3-ui-20261008/`，实现不得 import 官方 monolith。

本批随后已接入真实生产工作区、保存和Three渲染；实现子集、Computer Use截图及未完成门槛见[生产集成验收](../STUDIO-V3-PRODUCTION-20261008.md)。以下官方静态契约仍是后续逐态对照依据。

## 入口与根结构

官方入口链：`page-DVqoHdTT.js:Cve` → lazy `ThreeDOverlay-akWGliiq.js:P` → `ThreeDWorkspace-BzPphAqB.js:kp/KW/T$`。Overlay 是 `absolute inset-0 z-[100]`、250ms 淡入淡出，按 overlay epoch 区分会话。`studio` entry 携带 `studioNodeId/sourceNodeId/sourceKind/sourceSnapshot/title`；`asset-preview/panorama-preview` 属于只读预览。关闭必须走 guarded close。旧 V2 的 `/3d-studio/{id}?canvasId=...` 是独立路径。

`WorkspaceRoot:tC` 是 `tabindex=-1` 的绝对满屏黑底、overflow hidden、outline none 容器。进入后尝试 focus 根元素，但不抢 input、textarea、select、contenteditable、role=textbox 的焦点。`nC` 内有捕获闪光层 z55、场景 renderer mount（touch-action:none、click 转交 pointer model）、不可交互的可见视口测量层。chrome 不是场景渲染器的一部分。

可直接使用以下 DOM。每个实际控制都要有 button/输入的语义和显式事件；CSS 不执行布局计算、菜单关闭或模式切换。

```html
<div class="studio-v3" tabindex="-1" aria-label="Studio">
  <div class="sv3-render"></div>
  <div class="sv3-visible-viewport" aria-hidden="true" data-world-visible-viewport="true"></div>
  <div class="sv3-topbar">
    <div class="sv3-top-left">
      <div class="sv3-surface"><button class="sv3-button" aria-label="Back">…</button></div>
      <div class="sv3-surface"><button class="sv3-button" aria-expanded="false" aria-controls="environment">Environment</button></div>
    </div>
    <div class="sv3-top-center"><div class="sv3-wordmark">…</div></div>
    <div class="sv3-top-right">…</div>
    <!-- Environment 展开时挂在 topbar 内 -->
    <div class="sv3-environment" data-picker-open="false" hidden>
      <aside id="environment" class="sv3-panel sv3-environment-main" aria-label="Environment">…</aside>
      <aside class="sv3-panel sv3-environment-picker" data-tone="subtle" hidden>…</aside>
    </div>
  </div>
  <div class="sv3-dock">
    <div class="sv3-dock-upper"><div class="sv3-surface sv3-timeline">…</div></div>
    <div class="sv3-dock-toast">…</div>
    <div class="sv3-dock-leading"><div class="sv3-surface">Controls / Home / Undo / Redo</div></div>
    <div class="sv3-dock-center">
      <fieldset aria-label="Main actions" style="margin:0;border:0;padding:0;min-width:0;max-width:100%">
        <div class="sv3-actions"><div class="sv3-action-cluster">
          <div class="sv3-capsule" data-kind="viewfinder">…</div>
          <div class="sv3-capsule"><div class="sv3-control-row">State / 3D / Object / Place / context</div></div>
          <div class="sv3-capsule">Camera manager</div>
          <div class="sv3-capsule">Timeline</div>
        </div></div>
      </fieldset>
    </div>
  </div>
</div>
<!-- 仅在 Portal 位于 workspace 之外时需要独立局部作用域 -->
<div class="studio-v3 sv3-portal">
  <!-- 位置 transform 属于外层；motion transform 属于内层，二者不可合并 -->
  <div class="sv3-pointer-menu" style="transform:translate3d(100px,200px,0)">
    <div class="sv3-menu sv3-motion" data-motion="fromAbove" data-visible="true">
      <button class="sv3-menu-row"><span class="sv3-menu-icon">…</span><span>Action</span></button>
    </div>
  </div>
</div>
```

所有规则限定在 `.studio-v3`；Portal 根单独携带该类，避免为 document.body 添加全局样式。外层 `.sv3-portal` 不捕获点击，surface 子元素才恢复 pointer-events。动态 `left/top/maxHeight` 或 `translate3d` 由实现传入。`sv3-dock-trailing` 是空第三列的方便挂载类，当前源码 `RE` 没有向第三列插入常驻内容。

## 几何和视觉数值

| 区域 | 官方数值 | 对应类／实现要求 |
| --- | --- | --- |
| 默认可见视口 | 左16、右16、上72、下72 px | `--world-viewport-visible-*`；侧向/上下 inset 变化200ms |
| 顶栏 | top12；水平padding8；列间距12；三列 `minmax(0,max-content) minmax(0,1fr) minmax(0,max-content)` | `sv3-topbar`；三个 slot 高48；left可横滚，right隐藏溢出 |
| 中央品牌 | idle112×48；wordmark图高20、opacity .70 | `sv3-wordmark`；展开guide改20×20 logo opacity .80，logo slot40 |
| 顶视导航 | 中央surface高40、gap2，logo slot32 | `sv3-plan-controls`；rotate/zoom/reset按钮32×32，icon16/stroke1.75 |
| 底dock | bottom12；水平padding8；gap12；列 `minmax(max-content,1fr) minmax(0,max-content) minmax(0,1fr)` | `sv3-dock`；主动作row4；timeline row2；toast row1或3；上方内容margin-bottom12 |
| 主动作viewport | 最大宽度100%、横滚、隐藏scrollbar | `sv3-actions`；内层 `sv3-action-cluster` 高48、gap8、宽max-content |
| Capsule | outer48；inset4；actionInset6；动态最大1040×48 | `sv3-capsule`；viewfinder最大320×48；原文 `zs` 测量并动画，不是固定1040宽 |
| Chrome button | h36/min-w36/gap6/px10；control规格h40/min-w40/px12；font14/500 | `sv3-button`；active `data-active=true`；disabled保留真实disabled |
| 分隔符 | w1/h20/mx4、white14% | `sv3-separator` |
| 菜单surface | radius18/border white10%/bg rgba(38,38,38,.5)/blur28/shadow `0 4px 8px rgba(0,0,0,.04), inset 0 .5px 0 rgba(255,255,255,.12)` | `sv3-menu`；padding6/min176/max min(320px,100vw−16) |
| 菜单行 | min-h36/gap10/px10/py6/radiusfull/font14/white70% | `sv3-menu-row`；hover white10% bg/textwhite；disabled textwhite25% |
| 菜单icon/chevron | #a8a8a8/#8f8f8f → hover #f2f2f2/#d8d8d8 | `sv3-menu-icon/chevron` |
| Caption/description | caption11/white36%/tracking.16em；description12/20px/white48%/max256 | `sv3-menu-caption/description` |
| Prominent panel | radius16/borderwhite14%/bg-popover50%/blur56 | `sv3-panel`；shadow `0 4px 16px rgba(0,0,0,.16),inset 0 .5px 0 rgba(255,255,255,.16)` |
| Subtle panel | radius12/borderwhite10%/bg-popover32%/blur32/insetshadowwhite10% | `sv3-panel[data-tone=subtle]` |
| Floating bar | radiusfull/borderwhite12%/bg-popover50%/blur28 | `sv3-capsule`；外阴影2px+4px/insetwhite12% |
| 官方popover基色 | `--popover:#262626`，light/default与dark均相同；background#0f0f0f/foreground#f5f5f5 | scoped `--sv3-popover:38,38,38`；root scene仍black |
| 激活／加载 | gold#f0d887；cyan rgba(123,216,255,.9) | `--sv3-active/--sv3-loading` |

Chrome focus outline1px white45%；disabled cursor-not-allowed/white25%/hover背景透明。Chrome `-webkit-app-region:no-drag`。原图标不是通用字母徽章或 Unicode 图标。

| 层 | 官方z |
| --- | --- |
| status / capture flash / editingInput | 40 / 55 / 63 |
| anchoredHud / planView | 66 / 68 |
| chrome / chromeRaised | 70 / 72 |
| floatingPanel / modalOverlay / topChrome | 81 / 82 / 85 |
| menu / pointerMenu / pointerSubMenu | 90 / 95 / 96 |
| directorPlanPointerMenu / panoramaTaskBubble | 120 / 9998 |

Portal内director plan上下文菜单须将根层z设120，普通指针菜单95、子菜单96。勿将所有菜单无差别升至9998。

## 模式和显示策略

`_U` 与 `OU` 是可直接转译的策略，以下名称对应官方参数。`independentSetupActive` 在 `NU` 使用 `setupContext.canAuthorTemporal`；`setupEditingActive` 使用 `canEditSetup`。

```text
usable = uiReady && !readonly && !galleryActive && !viewfinderActive
controlActive = entityControlActive || possessionActive

topViewAvailable = usable && !panoramaEditActive && setupEditingActive && topViewSceneAvailable
topViewActive = topViewRequested && topViewAvailable && !controlActive
idlePlan = usable && !panoramaEditActive && !placementActive && !temporalPreviewActive && !controlActive
planInteractionActive = idlePlan && independentSetupActive && !topViewActive
planMenusVisible = idlePlan && (independentSetupActive || (setupEditingActive && topViewActive))
sceneEditActive = usable && panoramaEditActive
annotationInputActive = sceneEditActive && (panoramaSelecting || promptOpen)

setupView = !setupEditingActive ? inactive
          : controlSubject ? controlling
          : topViewActive ? topView
          : independentSetupActive ? onSet
          : inactive
```

`temporalPreviewActive = temporalPlaybackPlaying || temporalPlayheadScrubbing`。播放和scrubbing期间不能沿用闲置计划的放置/编辑菜单。Top view需真实可绘制场景；有state数据不能证明top view可用。

`lY/mY/yY` 的dock composition：gallery或panorama编辑隐藏常规底dock；entity control用一整组移动/旋转/恢复/Done替代常规动作；viewfinder显示历史照片／viewfinder、optics与capture；camera possession显示optics/capture和恢复/Done；普通workspace显示State、View、Object/Place、Camera manager、Timeline。基线且非top view使用sceneLayout对象操作；独立state或top view使用directorPlan操作。read-only不呈现编辑fieldset。

源码 `worldSpace` 包含stage数据，`wp` 按activeStage过滤state。本轮没有找到独立stage切换UI或 `world.stage*` 文案，不应凭数据模型补造舞台切换器。

## 文案、可访问性和真实动作

表中是 `t(key, English fallback)` 直接出现的fallback，不能作为所有语言的运行态截屏证明；本地化应使用对应key及项目既有翻译。

| key/区域 | 官方fallback / tooltip | 真实动作 |
| --- | --- | --- |
| `world.environment.layer.environment` | Environment / Change the set and adjust the ground, lighting, and background | toggle panel；aria-controls/expanded；Escape关闭 |
| `world.hotkeys.title` | Controls / View 3D navigation and editing controls | bottom leading展开controls popover，非modal，top/start offset12 |
| `world.toolbar.resetCamera` | Restore home view / Restore the Studio home view without moving scene content | reset navigation camera；快捷键0 |
| `world.history.undo/redo` | Undo / Redo | 按activeSetup history availability禁用，禁用tooltip解释原因 |
| `world.gallery.historyOpen` | Historical photos | 仅已有照片时显示；gallery toggle；aria-pressed；新照片直接加入canvas |
| `world.object.selectObject` | Select object / Find and select objects in the scene | 搜索与选择entity；非永久树 |
| `world.object.searchSceneObjects` | Search scene objects | label/description/kind/fileName统一case-insensitive搜索；No matching objects |
| `world.place.label` | Place | 展开放置目录；角色/相机进入placement mode；点击场景落实位置 |
| `world.director.onSetView` | 3D；菜单 3D (On set) | request onSet |
| `world.director.topView` | Top view / Switch between the interactive 3D scene and top view | request topView |
| `world.director.shotManager.title` | Camera manager / Review, organize, and export shots | camera linkage关联真实entity/state；预览/打开/重命名/删除/批量export |
| `world.terms.timeline` | Timeline / Edit keyframes and animation duration | 开关timeline；基线禁用并解释独立state要求 |
| `world.entityControl.lower/raise` | Move down / Move up | Q / E nudgeHeight |
| `world.object.snapToFloor` | Drop to ground | 根据真实surface落地，不能仅改标签 |
| `world.entityControl.rotation` | Rotation | 0..359°；presets 0/90/180/270/359；track360/readout40 |
| `world.entityControl.restoreAndExit/finishControl` | Restore and exit / Done | cancel恢复session起始状态；finish提交；Done快捷键Escape |

Back语义由 `Q9` 决定：viewfinder→Close Viewfinder/Return to the Studio view；panorama→Exit panorama editing/Finish panorama editing and return to Studio；control/possession→Back/Exit the current mode and return to Studio；默认→Back/Exit Studio and return to canvas。不得所有Back统一销毁Studio。

保存 `Z9/J9`：`Saving...`、`Not saved`、`Saved` 为aria-live polite output；Saved仅展示3000ms；failed amber icon、saved emerald icon、saving spinner。没有保存状态时不渲染假“Saved”。tooltip通常delay300ms。

### State菜单

`wp/L7/N7`：trigger为active setup label或Scene baseline，最大180px；baseline tooltip“Edit content shared by every state”，独立state“Edit content in this state”。activeStage内独立state排序呈现，baseline通过底部“Edit scene baseline”进入；baseline内有独立state时“Exit”返回最后独立state或第一个state。

- 菜单state列表max-height256；row高36；label max208；activeGold；hover#303030。
- 每行Clone state、Rename state、Delete state三个14px图标action。Add state创建并激活独立state；clone创建并激活副本。
- Rename input高28、radius6、背景#343434/focus#3a3a3a/text#f2f2f2；进入focus/select，Enter提交、Escape取消、blur提交，composition事件不能触发提交。
- Delete先确认；popover位于delete anchor上方end、offset6，不能直接删除。切换state先取消placement并退出camera possession。

### Object选择和上下文

`iE/D6`仅有对象时呈现选择popover；无对象时显示“Add objects to the scene”或场景放置提示。idle trigger显示Object（小于1200px隐藏文本）；已选label最多80px。列表maxheight312，search高32，row最小40；每项thumbnail28×28，locked badge14×14且icon8；locked项优先，再按原顺序。选项aria-pressed，选中activeGold、bgwhite10%，点击关闭menu。

选择actor/prop展示Height、Pose（官方sample actor限定）、Material/color、Lock、entity menu。camera没有actor/prop keyboard control menu入口，使用camera session。Height显示m并支持drag/wheel scrub与输入；编辑遵循begin/update/commit/cancel。锁定和动画状态限制应来自runtime policy，不从样式推断权限。

### Environment

`d9`挂在topbar内left0/top60，main与secondary gap8；main最大min(680px,100vh−144)，grid列max-content/fit-content240px、padding8。main包含Set（Blank set/Room/3D scene及Original scene说明）、Ground、Lighting（Direction）、Background，底部可有Edit panorama。secondary width min(280px,100vw−32)，相同高度边界；header高32、font14，首次focus第一个enabled button/input。

≤760px secondary覆盖同一main panel区域left0/top0、w100%，main暂停pointer events。关闭secondary时焦点返回触发button。Escape先关闭secondary、再环境面板。场景来源真正切换后须重建渲染状态；只改菜单active不是功能完成。

### Camera manager

`m6`自bottom trigger向上展开，center、offset12、collisionPadding12。panel宽min(560px,100vw−24)，maxheightmin(620px,100vh−112)，shadow `0 8px 28px rgba(0,0,0,.24)`。Header min56/padding12,16,8，title16/600。state分组，grid `repeat(auto-fill,minmax(156px,1fr))`、gap12；每张按真实aspectRatio呈现preview，object-contain/top。没有camera时“No cameras”；错误“Preview unavailable”；loading和ready要有实际状态。

普通card点击Jump to camera并切到对应setup；rename/删除按钮28、icon14；删除confirmation说明“The related camera and animation will also be deleted.”。Batch export先进入checkbox选择模式，有Select all和Export to canvas；没有选择时export disabled；busy禁用。Escape依次取消delete confirmation、rename、batch export、最后关闭panel。不要为缩略图生成伪截图。

### Timeline

`k7`浮动bar width min(92vw,640px)、margin-right−12、padding-left6、gap2；入场opacity/translateY12，delay180ms/duration280ms，Beta top−8/right12。Play/Pause按钮36×36/icon19/stroke2.35，Space只在playbackShortcutAvailable时绑定；loop18/stroke2.25。time seek高40、min148/flex1，role slider/tabindex0、aria min0/maxduration/currentround；scrub必须onScrubEnd。

Save as key存 `Math.round(playheadMs)`；删除选中key；至少3个连续移动key才可Redistribute for uniform speed；播放时不能保存、删除、重分配或改duration。Timeline actions包含缩短1s/延长至下一个整秒，以及存在track时Delete track。基线禁用文案：Scene baseline has no changes over time. In the bottom State menu, select or add an independent state to animate the scene.

### Top view与viewfinder

`WorkspacePlanView:wo`真实plan surface z68，背景#030507，loading/retry遮罩及SVG路径和marker层。rotate按钮按下保持旋转、pointer up/cancel停止；zoom out/readout one decimal + x/zoom in/reset；导航controls Portal到topbar center host。无host时可top16独立浮动bar。切片高度slider是左8/垂直居中/44×112，“Section height”，顶部“Show all”，不是缩放slider；Arrow/Home/End/Page键处理并停止传播。

frame `Ji` 外侧dim black55%，frame radius16/border2 white60%，三分线1pxwhite20%，坐标尺寸变化300ms；计算frame时top/bottom safe60。光学参数focal 8..400mm，presets8/16/24/35/50/85/135/400；aperture1.4..22，presets1.4/2/2.8/4/5.6/8/11/16/22。依据camera capabilities显示，禁止在无capture能力时放可点击假按钮。生成图片分辨率/format属runtime任务，本文未实施capture。

## Portal坐标、关闭和180ms子菜单

`Jz` pointer anchor使用浏览器client坐标，默认offset8×8、margin8，估计240×220；先 `anchor+offset` 再将left/top夹在 `[margin, viewport−size−margin]`，最终translate3d使用round值。director `V6`覆盖offset12×10，entity菜单估计256×360、blank菜单256×64，instantOpen且z120。

`vs`按钮锚定菜单默认估计224×180、viewport margin8。start沿trigger.left、center沿中心减半菜单宽、end沿trigger.right−menu.width，水平clamp。默认bottom offset0/top offset4；指定侧不够时flip，两个侧都不够则选合理可用侧并设置maxHeight，overflowY:auto。位置随window resize/捕获scroll与实际surface resize重新计算。

`kl` submenu估计224×220、横向gap8；首选parent.right+8或parent.left−8−width，不足时flip，然后clamp。纵向start=trigger.top−6，center=trigger中心−height/2，end=trigger.bottom−height+6，auto先start再end再clamp。source限制submenu内容resize是否重算，默认false。

`Un`精确close delay为**180ms**。pointer enter立即打开并取消close timer；pointer leave延迟关闭；trigger/submenu的relatedTarget和focus归属维持打开。一个menu group同时仅一个active submenu；click toggles；aria-expanded绑定实际状态。外部pointerdown使用document capture listener，同menu group不dismiss；surface内部pointerdown停止传播。Esc走menu级处理。静态读取没有证明原生submenu实现完整Arrow键导航，不应把本地补充键盘导航描述成官方已有行为。

Menu motion150ms ease-out；fromAbove/fromBelow±10pxY，fromLeft/fromRight±10pxX，exit仅opacity0。退出期间surface inert/aria-hidden/tabIndex−1/pointer-eventsnone，等transition完成再unmount；reduced motion立即完成、无transform。`sv3-motion`只给动画样式，inert/unmount时机须runtime负责。

## SVG接口与来源

```js
import { icons, icon, iconMetadata, iconSource } from './icons.mjs';
button.innerHTML = icon('environment', { size: 18, strokeWidth: 1.75 });
button.setAttribute('aria-label', 'Environment');
```

`icons`为冻结的可信静态SVG map，default20×20/stroke2/currentColor；`icon(name,{size,strokeWidth})`允许调用处保留官方不同尺寸，不接受未知名或非正有限数值。svg自身aria-hidden，button承担label。`iconMetadata`记录原source factory family、icon name、array symbol、symbol、字符offset和exportAlias；无bundle执行。`iconSource`提供源文件hash。

主接入keys：back, environment, camera, add, delete, control, controls, undo, redo, historicalPhotos, restoreHome, dropGround, moveDown, moveUp, timeline, onSet, topView, exitBaseline, export, play, pause, loop, loopOff, redistribute, clone, rename, settings, download, more, chevronRight。另有cameraManager/object/character/objectLock/objectUnlock及planRotateLeft/planRotateRight/planZoomOut/planZoomIn/planReset，这些按workspace实际import alias提取，优先使用；close/check/search/upload/focus/capture等是同bundle具名geometry扩展。

## 静态证据和验证边界

下列行号对应ignored prettier-style readable副本，由既有esbuild仅format而成，源文件hash用于复核安装包版本。实现样式采用语义类重述utilities，不复制全站CSS。隔离作用域/Portal、少量便于DOM挂载的类属于本地实现接口；模式与布局数值、文案fallback、几何路径来自官方源。

| 源文件 | 关键symbol／readable行 |
| --- | --- |
| ThreeDOverlay-akWGliiq.js | `P` fullscreen entry、close guard |
| ThreeDWorkspace-BzPphAqB.js | `tC/nC`7807/7837；`Jz/Qz/Xi/Un`6892–6990；`_U/OU/NU`13823–13860；`m6`14862；`iE/D6/F6/V6`15037–15113；`k7`15336；`wp/L7/N7`15562–15625；`d9/f9`15868–15902；`q9/Q9/lY/mY/RE`16161–16270；`T$`16768 |
| WorkspaceViewfinderButton-BHqIWibq.js | `Ji`frame1271；`Ie/mr`1283–1290；`vs/kl`1320–1370；`Ns/Os`1417 onward；`Ec/ql/Zl`1900–1924；numeric optics1900以前 |
| WorkspacePlanView-HeQ7o6cq.js | `Dn`beginning slider；`Gr`753 sectionHeight；`wo`819 onward；navigation/surface974–983 |
| ThreeDActivityOverlay-CIotE4kO.js | surface token object及outerSize48/inset4/actionInset6；minified source |
| index-BsHyQ2qj.js | icon export mapping与Lucide/Tabler静态路径array |
| index-CF4eb3PV.css | default/dark `--popover:#262626`；不全量引用 |

| Source | SHA256 |
| --- | --- |
| ThreeDOverlay-akWGliiq.js | `531a0b81890bc1aae86a557786f8366d6ac8441cd0530c8fea5a14a9a80078bc` |
| ThreeDWorkspace-BzPphAqB.js | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| WorkspacePlanView-HeQ7o6cq.js | `b71be13b4f56e74d4e5fa7a41a43402070ec2366bf8156d65940c952ddbc735e` |
| WorkspaceViewfinderButton-BHqIWibq.js | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` |
| ThreeDActivityOverlay-CIotE4kO.js | `2c4c2f2137cb343da081df58245c214fe7ad262341e0f0f024277ed5174ee933` |
| index-BsHyQ2qj.js | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| index-CF4eb3PV.css | `332cb65e334bd1b6cea0eafae238093ec0bfda5e9b62132941387445a687a52d` |

本轮验证：SVG模块语法、56个静态路径的可生成性、unknown/dimension输入保护；CSS解析与每个selector作用域检查。未运行CUA、未做官方或本地浏览器截图验收，未声称新UI已具备runtime/persistence。菜单坐标、focus和关闭延迟应在接入后的浏览器验收中进一步验证。

## 本地菜单helper接入与验证

新增 `src/features/studio-v3/menus.mjs`，无domain依赖：

```js
import { createMenus } from './menus.mjs';
const menus = createMenus({ root: studioRoot, onError: reportError });
menus.toggle(stateButton, ({ close }) => {
  const content = document.createElement('div');
  const row = document.createElement('button');
  row.className = 'sv3-menu-row';
  row.textContent = 'Add state';
  row.onclick = () => { addState(); close(); };
  content.append(row);
  return content;
}, { label: 'States', width: 260, placement: 'top', align: 'start' });
menus.openAt({ x: event.clientX, y: event.clientY }, buildObjectMenu);
menus.close({ restoreFocus: true });
menus.isOpen();
menus.contains(event.target);
menus.dispose();
```

单一active menu；factory须返回same-document DOM；宽度可number px或CSS字符串，pointer坐标必须finite。默认anchor top/start，top offset4；pointer offset8。测量实际surface、按8px viewport margin clamp/flip，ResizeObserver在内容尺寸改变后重算。窗口resize/blur、outside pointer/wheel关闭并回焦origin；菜单内部wheel保留列表scroll。原anchor pointer不提前关闭，允许click toggle。document焦点移出menu时关闭且保留destination。关闭后立即inert/aria-hidden/停止交互，160ms后移除（CSS过渡150ms，留10ms余量）；reduced motion立即移除；dispose清除监听器/observer/待退出DOM。

局部键盘增强：enabled buttons ArrowUp/Down循环、Home/End，Escape/Tab在菜单行关闭并回焦。Enter/Space保留原生button激活，不合成click。输入／textarea／select／contenteditable／role=textbox以及IME事件完全让出；重命名的Enter/Escape需caller处理，input原生Tab移出时由focusin关闭。static bundle未证明Arrow键完整导航，因此这里明确属于本地helper增强。helper不自动执行或关闭选择action，caller通过factory context.close显式结束；context.close绑定本次menu，旧异步回调不会关闭新menu；detached旧按钮click capture被拦截。

`node --test tests/studio-v3-menus.test.cjs`：10/10通过，覆盖夹紧/独立motion层、单active替换与dispose、enabled键盘顺序、IME/input让出、外部事件关闭及内部scroll、pointer坐标、stale action与stale close、factory失败清理、input原生Tab目的焦点保留、菜单Escape capture优先于scene router。`node --check`两模块通过；esbuild CSS解析零warning，116个顶层selectors全部 `.studio-v3` scope；56 icons路径与source offset/dimensions/unknown输入校验通过。浏览器视觉与真实domain action仍由集成工作负责。
