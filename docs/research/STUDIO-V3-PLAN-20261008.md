# Studio V3 完整平面图合同 · 2026-10-08

本轮只静态读取本地安装包官方 JS、资源文件元数据和当前项目代码，新增本文。未执行官方 JS、未调用 API、未进行官方状态变更、未使用 CUA、未编辑 entry/runtime/production/tests、未运行测试。本文是实现依据，不能当作运行时或视觉还原验收。所有 offset 是 **UTF-8 解码后 JS string 零基字符位置**，不是字节位置。

## P2 应实现的最小完整闭环

官方平面图不是把现场摄像机改为俯视正交：它有独立 plan renderer profile、独立 orthographic camera、真实场景背景、SVG marker/path/FOV/hit层、剖切高度、缩放平移旋转与事务式实体交互。实现最小闭环为：进入俯视 → 真实房间或已有场景渲染 → 选择角色／对象／摄像机 → 拖位置和朝向 → 新增时点击摆位或拖出朝向 → 改剖切高度 → zoom/pan/rotate → 撤销提交 → 返回现场恢复renderer及输入。任何一步缺失都不能以“runtime支持俯视”宣告P2完成。

投影、显示和命中必须共用**最近一次成功渲染**的projection snapshot。navigation current值在阻尼变化，若命中使用target值或现场camera，会产生旋转／缩放后错选、跳位与错误方向。新增落地与拖已有实体是不同操作：前者找支撑面，后者保持原depth/y。

## 官方证据与资源

安装包目录：`/Applications/TapNow.app/Contents/Resources/web/`。本轮重新读取字节／hash。

| 代号 | assets文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| P | `WorkspacePlanView-HeQ7o6cq.js` | 55090 | `b71be13b4f56e74d4e5fa7a41a43402070ec2366bf8156d65940c952ddbc735e` |
| A | `ThreeDWorkspace-BzPphAqB.js` | 919292 | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| B | `WorkspaceViewfinderButton-BHqIWibq.js` | 99329 | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` |
| D | `index-BsHyQ2qj.js` | 12943515 | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| E | `course-api-base-url-CGXqZmAy.js` | 3444954 | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| F | `ThreeDActivityOverlay-CIotE4kO.js` | 5521 | `2c4c2f2137cb343da081df58245c214fe7ad262341e0f0f024277ed5174ee933` |
| G | `EnvironmentLightingPickerContent-CigxxFZu.js` | 94564 | `b9b06fd215e4a951798c1b88e32842fe71aac5a94f57f7128d5eaf6aa8f9d8e8` |

P由A `x$` lazy import，A `k$`（903712）挂载。P没有外部平面图底图资源：marker、相机glyph、FOV、cursor、路径由SVG几何生成；room用程序几何与纹理。真实scene源来自workspace render graph。

| 资源 | 用途／本轮可证明事实 |
| --- | --- |
| `/logo.png` | B Ec（92248）variant=logo，img alt TapNow、size20、opacity80；安装包文件存在3219bytes |
| `/tapnow-brand-logo.png` | 同组件wordmark；安装包存在18684bytes；plan常规nav用logo，不能用wordmark代替 |
| `/assets/world-model/characters/character.glb` | actor领域默认模型，A fx160001附近；安装包存在3294764bytes；平面marker本身为SVG圆和方向符 |
| `/assets/world-model/director/camera.glb` | 现场摄像机3D glyph，安装包存在14948bytes；plan摄像机用P gt/vt内联path，不加载此GLB来画2D marker |
| P Bn/Gn data-SVG cursor | 24×24、白线stroke2、hotspot12/12、fallback grab；分别表示转向和FOV横向调节 |
| room texture | A zO124444构造64×64 RGBA DataTexture，repeat=尺寸/(2*spacing)、anisotropy8；不是图片下载 |

## 入口、可用性与退出

A `O7`（790593）视图menu在底部状态区：当前显示“3D”或“俯视”；选项“3D（现场）”和“俯视”；tooltip“在可交互 3D 场景与俯视图之间切换”。icon18/stroke1.75，menu placement=top/align=start。现场icon mouse-pointer-2（A Oh→D mw→F1e1437010）；俯视icon map（A _h→D mv→C0e1419818）。不是两个无限可用的孤立toggle。

A `_U`（684421）topViewAvailable要求 uiReady、非readonly、gallery关闭、非viewfinder、非panorama编辑、canEditSetup、scene有可用bounds。topViewActive还要求topViewRequested且无actor/prop control或camera possession。独立setup不是俯视本身的必需条件：baseline可进入俯视编辑共享内容，但不可新增摄像机或temporal。plan menu另外要求无placement、temporal preview或control；不可把播放期间所有navigation都禁用。

A `NU`（685305）失去topViewActive时把setupView切回onSet；Escape plan priority240返回现场，菜单／placement／selection有更高或另行注册的优先级。loading变true且plan active时P也调用returnToOnSet。进入actor/camera control、gallery、viewfinder或readonly不可保留可操作plan层。源码未证明navigation状态持久存储，P Or中的pan/zoom/rotation/section为本地refs/state，reset将section也恢复1.6m。

## Renderer、bounds、剖切与回退

P `Or`（36098）setup需renderer/scene/renderGraph；graph有sparkRenderables时还需Spark。B `Sl`（44741）bounds优先clone sceneBounds并union entityRenderables bounds；无有效sceneBounds才由renderableRoots计算。空、非finite bounds拒绝。P `jr`（35054）提取bounds并aspect fit，padding1.1；默认display560×420，真实viewport尺寸round且至少1，ResizeObserver更新projection。

独立OrthographicCamera的basis向下看，position=target−forward*distance，up=−screenDown；现场PerspectiveCamera不被plan改写。target.x/z=bounds中心+pan，target.y=groundY；distance=max(50,bounds.max.y−target.y+10)。`Ot`（31616）把bounds的8个角投影到right/down，按aspect与padding1.1求halfW/H；zoom除half-size。`vr`（32218）按8角深度与padding2求near/far，near至少.01、span至少.5。

section不是marker的高度筛选。P `kr`（32675）将 `groundY+height` 平面沿forward的深度转换为near，clamp到[原near,far−.5]，far不变；因此高于截面的屋顶／上部几何被切去。section=`all`用原near/far。默认height1.6m；slider `xr/yr`（30809／30867）双向映射：`height=1.6*u/(1-u)`，`u=height/(height+1.6)`，u=1为all。不能用0–3.2m线性slider代替。负高度拒绝／归0，非finite保持当前值。显示米数<1两位、<10一位、其余整数并去末尾0。

渲染P `Wr`（35555）暂时清scene.background、clearColor=#030507且alpha1、Spark apertureAngle/focalDistance=0、spark roots frustumCulled=false；finally恢复全部。P调用A `fO`（112197）暂隐藏workspace helper root并finally恢复。B `_l→bi→Jt`（41745）profile plan不含editor entities/overlays，含ground references；scene自身的真实内容仍渲染，SVG承担editor marker。Jt finally恢复renderTarget和autoClear。不能永久清背景、关闭DOF或改culling。

A profile registry `ZO`（134882）activate返回release，release只清同identity的当前profile，避免旧cleanup释放新profile。A frame（147934附近）仍运行director/simulation，再执行active profile.render并提前返回，不跑现场摄像机导航链。P只在active且非failed时activate plan；failed撤掉profile，workspace恢复常规render。P Or先render成功才保存displayedProjection并isReady；失败清projection/隐藏SVG，显示“俯视图加载失败”与“重试”。retry重做setup；没有找到假的棋盘格或2D底图fallback，也没有强行创建room来遮盖缺scene的行为。

cleanup：P window pointer session cancel/remove listeners、wheel remove、ResizeObserver disconnect、FOV RAF cancel、局部refs reset；profile release由layout effect返回；workspace整体dispose才销毁共享renderer。plan不能dispose共享scene/renderer或仍在使用的model。source/sceneRevision变化active时重做setup；新graph未成功render前不可继续用旧projection命中。

## 投影与命中模型

| 函数 | 精确合同 | P offset |
| --- | --- | ---: |
| Rn / Lt | basis向量normalize、两两dot≤1e−6，否则throw；right=(cosθ,0,sinθ)，down=(−sinθ,0,cosθ)，forward=(0,−1,0) | 2919／3217 |
| Nn | δ=world−target；nx=.5+dot(δ,right)/(2halfW)，ny同down；pixel=normalized×width/height；inView容差−.08..1.08 | 3912 |
| jn / xt | normalized屏幕坐标反解target+right/down偏移；preserve-depth用anchor沿forward校正 | 4261／4136 |
| Je | projection-plane取target plane；preserve-depth取entity anchor plane；top-down-support先反解xz再找支撑 | 4400 |
| In / Fn | 回调context含nx/ny、复制projection、resolveSurface；不传现场camera或未显示target projection | 5411／5574 |
| _t | client坐标按SVG实际bounding rect反解nx/ny；零size拒绝 | 44151 |
| fr | 每渲染帧更新SVG marker位置与direction相对basis角；超inView隐藏，不按section height隐藏marker | 22676 |

plan.svg `preserveAspectRatio=none`，视图大小跟renderer实际viewport。marker visualScale=1.55保持屏幕大小，不随world zoom增大。yaw方向向量=(sin(yaw),0,−cos(yaw))，投影角=`atan2(dot(dir,right),−dot(dir,down))`。camera领域rotation与plan heading须复用已有transform-coordinates合同，不能把camera.rotation.y直接当plan yaw。

SVG DOM按priority低→高排序；命中层次A UC504069：path10、markerBase10、marker20、selectedCameraWithFov30、pathControl35、FOV edge40、trajectoryKey45。paths先于markers渲染；基础hit透明circle人/对象r22、camera r24，path透明stroke至少26px或core width+18，bend r18。不能只按距离选最近实体忽略FOV/trajectory命中优先级。

## 实体、camera FOV、路径与事务

A `r4`（496702）将同kind editable states与entities join，`b4`（511959）actor→person、prop→object、camera→camera markers；camera.position优先camera数据，showExtendedFov仅entity selected，selected temporal key的对应live camera FOV隐藏，避免重复。颜色优先实体color，否则确定性ID hash palette；P fallback camera#B7A66A/person#66B8A6/object#D8B45F。

P `zt`（43120）marker drag以原entity depth anchor反解，**移动距离≥4px**才创建domain session；onMove preview/onEnd commit/onCancel rollback。普通marker保持height；path proxy额外保留初始screen offset避免跳位。统一`$n`（6106）window capture pointermove/up/cancel，按pointerId过滤，结束解绑；active=false/unmount先cancel。拖后抑制click并setTimeout0清guard。空白click仅位移Manhattan≤4px清selection，拖pan不清；plan placement onPointerDown优先于pan。右键contextmenu若无handler仍消费事件防浏览器菜单。

A `y4`（506429）position/rotation/FOV用 `Kn` 确定base或key/time，沿用time-key确认，不直接改采样base；playing／locked实体拒绝。domain drag一个director history事务，preview使用external history。P `zt`取消必须调用domain.onCancel。`ub`（505366）朝向距离<.05m返回null，`zq` E1541471为atan2(dx,−dz)。camera pose和plan transform同步更新；actor/prop不能随drag丢失scale/其他rotation。细节见时间轴文档。

camera FOV用**水平**视角：A `V$`（480601）将领域fov依ratio转换half-angle，左右ray=(-sin(a)*r,−cos(a)*r)/(sin(a)*r,−cos(a)*r)，SVG圆弧扇形。P `Ln`（5763）drag left保留right edge、drag right保留left edge，回算新的center yaw与领域fov；ratio参与两次换算和合法clamp，不是仅改fov一个数。P `ir`（15396）SVG+RAF做局部preview，≥4px才取得FOV事务；结束交 `{yaw,fov}`，cancel/unmount清preview/RAF/session。该session回调仅end/cancel包裹，不能想当然地每帧写domain。readout为“{{fovDegrees}}° · {{focalLengthMm}}mm”，两者整数。

已有temporal paths也在plan层：P `mr/wr/fr`（27192／27461／22676）支持polyline/cubic、hold符号、playhead和hover rhythm；path hit可创建或drag。bend/endpoint proxy若距anchor<30px被推出30px并画connector；A `w4`（512569）生成首末endpoint和非hold bend；timeline key marker优先45。最小闭环可先交entity/FOV，但P2完整验收必须另记路径交互未完成，不能隐藏差距。

## 新增摆位、房间与场景来源

A `u4`（499128）pending placement分actor/camera；P surface handler反解projection plane并带context，A `l4`（498905）通过top-down-support解析xz。G `ar/cr`（53236／54076）从上向下raycast collider／可用surface mesh，normal.y至少.65，选最高支撑，无支撑则ground fallback。A kW（255465）重新用world surfaces解析height：actor落在support，camera在support+1.6m（by255177）；普通drag仍保持既有y。不得把所有entity都强塞groundY。

A `GC`（498313）一个director.placeEntity事务：start point固定，move按start→current算heading；首次preview创建actor/camera，后续rotateToHeading；end创建／旋转并commit/markOwnedContent，cancel回滚。无drag点按也在onEnd创建默认heading0。A i4（497200）context“放置在此处”直接新实体事务。camera只独立状态可放；角色在baseline共享、独立setup局部。

右键菜单A S$（902848）：anchor clientX/Y、estimated256×200、instantOpen、z120；Ym（549055）逐项：scope说明、既有character roles、新建角色submenu、添加摄像机submenu（放置在此处／以当前视角添加）、生成3D对象、生成历史、示例库、几何体、上传3D模型。可用项来自setDressingAssets能力；没有generation provider时隐藏相应入口。来源资源与真实资产加载由既有adapter处理，不应把菜单点击标为已生成。new-character trim空名拒绝，提交前确认当前stage/setup的role。

room与scene不是plan独立数据；A d9（819805）的环境面板修改worldSpace.source。空白场地→empty；房间→mesh-preset room；3D场景→world-asset或history-world。room默认E bF1538292：width5/depth12/height3.2，trackingGuides enabled=true/lineMarkers=false/mode=standard/spacing=.5。A sx（118836）在groundY创建floor、groundY+height创建ceiling、四面wall；bounds取真实几何。section1.6切掉天花板而保留房间下部，不能用plane替代room。

| 场地／放置控件 | 中文、值与行为 | 证据 |
| --- | --- | --- |
| 视图切换 | 3D／3D（现场）／俯视；“在可交互 3D 场景与俯视图之间切换” | A O7；D director9164411 |
| 场地选项 | 场地／空白场地／房间／3D 场景／原始场景／设置 | A d9；D space9175347 |
| 房间尺寸 | 宽度/深度1..100m、高度2..20m；exponential scrub，begin/update/commit/cancel | A e9/o9 812288／814032 |
| 房间参考图案 | 参考图案开关；样式全白/标准/校准；线标注（全白隐藏）；间距.25/.5/1/2m | A o9；D space.trackingGuides |
| scene选择 | 搜索场景、没有匹配的场景、暂无生成场景、正在加载场景…、加载更多 | A z7/B7/H7/V7 798650／800422／801148／801920；静态source合同不证明API可用 |
| 新角色 | 新建角色／角色名／添加并放置；已有role显示真实label/color | A Ym/mV；D placement9174609/object9160675 |
| camera | 添加摄像机→放置在此处、以当前视角添加；基准禁用说明“请先选择或新建独立状态，再添加摄像机” | A Ym；D stateRestrictions9169975 |
| scope | “添加到场景基准，在所有状态中共享。”／“仅添加到当前状态。如需在所有状态中共享，请切换到场景基准。” | A Ym；D placement |
| 摆位说明 | “点击可以放置，拖动可以设置朝向”；camera“点击可以放置机位，拖动可以设置朝向” | D director |
| props | 生成历史／几何体／上传 3D 模型；geometry立方体/球/圆柱体/圆锥体 | A qk383271/W5384119/z5384903/B5385221；D object |

scene列表取generation_type=threed且有效非object metadata，来源可以带thumbnail/createdAt，search同时匹配label和createdAtLabel；不会把所有canvas图片作为room scene。A zS（71743）选择empty/procedural room/glb/spz/progressive splat，用source+config+metrics构成load key。A d9 source选择关闭picker并回焦；room源离开时关闭room settings。

space.source/roomConfig是world-space字段；A ve/Le/oe（285000附近）readonly/current identity/history门禁，ea160001将事务记当前setup lane，scope world-space。room dimensions连续交互Rt288029一条`space.editRoomConfig`事务并merge trackingGuides，cancel还原；不是纯本地导航参数。P pan/rotation/zoom/section未见写worldSpace或history。跨来源时需release旧profile/旧pointer事务和重建bounds，不得把旧projection带到新scene。

## 控件中文、CSS与图标逐项

D `planView` JSON对象9167752包含17项。基础导航排列：左旋→右旋→分隔→缩小→倍率→放大→分隔→重置；logo前置。controls可portal到A top chrome host，也可fallback自身top16中心胶囊；f=null时不显示fallback，f=undefined才显示。P active返回surface，z68；独立nav top16px，顶端fade层h128px。

| 控件 | label／tooltip | 图标定义与尺寸 |
| --- | --- | --- |
| 左旋 | 左旋／按住向左旋转俯视图 | P en→D i6→mVn，Tabler rotate-2；D4669336；16/stroke1.75 |
| 右旋 | 右旋／按住向右旋转俯视图 | tn→i7→yVn，rotate-clockwise-2；D4670258；16/1.75 |
| 缩小 | 缩小／缩小俯视图 | nn→i8→CWe，Tabler minus；D4434904；16/1.75 |
| 放大 | 放大／放大俯视图 | rn→hR→fy，Tabler plus；D4596720；16/1.75 |
| 重置 | 重置视图／重置俯视图 | on→gj→iHn，Tabler refresh；D4639629；16/1.75 |
| 剖切 | 剖切高度；all=显示全部 | 无额外icon；vertical slider，min0/max1/step.001 |
| loading/error | 加载中...／俯视图加载失败／重试 | 文本+重试button，无fake成功badge |
| 倍率 | displayedZoom.toFixed(1)+x | h32/minw36/px2/font11 medium/white88/tabular |
| camera readout | {{fovDegrees}}° · {{focalLengthMm}}mm | SVG foreignObject label，round整数 |
| 取消放置 | 字典为“取消放置” | P没有引用该key；不可据字典发明plan专属可见按钮，已有Escape/placement入口管理 |

放置menu icons均18px：camera A jr→D k4→FE camera1247844；new-character／生成3D对象 A dr→hm→qE plus1471714；生成历史 Dh→m2→vle history1381013；“生成示例库”tI→m1→YJ boxes1228828，旁Beta字典原样；几何体Mp→m3→Cae cuboid1297937；上传qw→hh→AB upload1581407。既有role用16px色圆/borderwhite30，不用通用人物icon。space主选项以label/active与settings展开动作表达，没有依据要求给空白/room/scene每项增加装饰icon；room settings共享控件的计算样式应由后续浏览器核验。

| 部位 | 精确视觉数值 |
| --- | --- |
| surface | absolute inset0/fullsize/select-none/overflow-hidden/rounded inherit/outline-none；touchAction none；正常grab/active grabbing，loading wait；tabIndex可用0，否则−1 |
| nav | buttons h32/w32/minw32、px0；分隔mx2/h16；自身fallback胶囊h40/gap2；共享bar white10 border/bg rgba38,.5/blur28；tooltip delay300ms |
| 剖切slider | absolute left8/top50%，h112/w44、translateY−50%；pointer事件隔离；交互时readout左50%+ml16；bg#18191c/92、px8/py4、font11/white92、ringwhite12；150ms opacity/translate |
| loading/error | bg#030507；loading font11/medium/uppercase/tracking.24em/white72；errorwhite68；retryrounded-full/borderwhite20/bgwhite8→16/px12/py4/font11 |
| top overlay | inset-x0/top0/z1/h128，black#030507/55→20→透明gradient；为官方原样，不外推全UI渐变 |
| marker | scale1.55；person圆r7.1、object9.6方块/radius2；方向y−17/size5.8；core border1.05；selected outlinegold#EFD77A/1.7 |
| camera | glyphscale.68并rotate−90；短FOV radius48、扩展1040；gradient maxradius390；direction；lens/body由P gt/vt原path |
| FOV edge | handler沿ray距66；visual17×7/radius3.5、hit30×24；guide1.6*.5=.8；selected扩展渐变opacity .24/.12，其余扩展.16/.08，短.34/.17 |
| labels | y32/h28；font15/medium/white88/px10，F statusChip表面；width64..500，中文按15px/字、ASCII8.5，最多72codepoints再截断 |
| motion | enter/reveal300ms cubic(.16,1,.3,1)，state opacity200ms cubic(.65,0,.35,1)，reduced-motion关闭 |
| placement menu | anchored256×200估计/z120；camera、plus、history、cuboid、upload常用icon18；scope小字来自共享menu description |
| room picker | width min(280px,100vw−32px)，maxheight min(680px,100vh−144px)，≤760px overlay宽100%；房间fields minheight36、px10/gap8；guides切换gold#f0d887 |

navigation精确交互：zoom clamp.5..3，每次倍率1.12；平移量按framedHalf/zoom、viewport size、当前rotation转换world dx/dz。button rotation点按±π/12，拖动−dx*.008rad，>4px才视为drag；pointercancel复用pointerup，未移动取消亦可能step，这是源码行为。zoom阻尼speed12、pan10、rotation14；dt最多.08sec，snapε.0005。surface左／中键且primary pan，Manhattan>4px启动；arrows每次42px。B fn10489将ctrl/line/page/大整数竖wheel判断为zoom，其余“rotate”分类在P中执行**pan**，不是wheel转俯视角；line delta×16、page×max(1,height*.8)。没有cursor-anchored zoom证据，不要新增成官方合同。

## 建议本地接口与验收矩阵

以下是给root的实现接口建议，不是官方export API；不需要新增生产依赖。

| 边界 | 必要输入／输出与责任 |
| --- | --- |
| PlanProjection纯模块 | createBasis、frameBounds、depthRange、sectionRange、worldToScreen、screenToWorld(policy)、panDelta；finite/basis/零size拒绝；不写作者state |
| PlanRenderer adapter | getScene/getRenderer/getWorldRenderGraph/getSpark/helperRoot/groundY/viewport；activate profile返回release；render成功返回projection snapshot；失败返回真实error并恢复render参数 |
| PlanNavigation | current/target pan zoom rotation、section；frame(dt)与pointer/wheel/key handlers；reset；只本地状态、无history/save |
| PlanLayer model | markerLayers/pathLayers、IDs、kind/position/yaw/fov/ratio/color/selected、hitPriority；render使用同snapshot，不创建假entity |
| PlanInteraction | marker select/context、beginMove/Rotate/Fov、beginPlacement；同步事务onMove/onEnd/onCancel；pointer identity与source/stage/setup fence；gate readonly/control/playing/locked |
| EntityPlacement domain | support resolver、actor role/source、camera+1.6m、point/headings；一个director/setup history事务，cancel回滚、成功mark dirty并持久保存 |
| Room/Scene source adapter | current source/config、bounded room edits、scene picker返回真实metadata；source更新通过领域history与save，graphready后重建projection |

| 验收项 | 操作与必须观察的结果 |
| --- | --- |
| 真背景／section | room有四wall/floor/ceiling；1.6m能看下部房间，all能看完整顶部；GLB／splat源使用自身真实bounds与内容 |
| 投影一致 | 不同aspect、缩放.5/1/3、旋转15/90°、pan后世界点↔屏幕误差受控；点击marker准确；不能只测无旋转默认视图 |
| 2D实体 | actor/prop/camera准确position/yaw，gold选中与label；FOV正常／selected扩展，hit优先级覆盖重叠case |
| 移位／转向 | ≥4px才开事务、单次undo；保持原y与scale；cancel/source change/unmount回滚；key time edit不改base |
| FOV | left/right各保留对侧edge、yaw/fov/ratio/focal同步；SVGpreview、end提交、cancel无残留 |
| 新增 | 点按heading0、drag heading正确；support平台高度actor落地/camera+1.6；baseline仅actor/prop共享、camera禁用有官方说明 |
| navigation | wheel分型、左/中pan、arrows42、rotate tap/drag、zoomclamp/resetsection、ResizeObserver；导航无作者dirty/history |
| 失败恢复 | missingbounds/Spark/renderfail显示错误/重试；取消profile恢复现场renderer；background/DOF/culling/target/autoClear全部恢复 |
| 生命周期 | switchscene/loading/gallery/control/readonly/Escape/source fence释放pointer/profile/RAF/observer；旧cleanup不释放新profile |
| 保存／历史 | 位置朝向/房间/source有可回读state、单条undo/redo、刷新持久；viewport导航不改View/shot/photo |
| 路径完整性 | temporal key/path/hold/playhead/bend/endpoint、proxy30px与priority45专项；若第一批未做，明确记录P2未完部分 |

本轮当前本地 `entry.mjs` 381附近仍是3D／俯视两个button，`runtime.mjs`的view=plan是现场runtime正交分支；尚不足以代表上述独立SVG层、剖切、FOV交互和plan profile完成。本地已有schema/world-space/entity/temporal/history/coordinates可复用，避免另起plan实体数据。新增实现后的单元与浏览器验收由root另行执行；本文没有运行或引用本轮测试成功结论。

## 本轮静态核验

7份官方源码字节数／SHA-256一致；79个function offset锚点逐项匹配；13个D图标definition offset匹配；D planView全部17条中文逐值与本文对应；4个安装包资源存在／字节数核验；Markdown行末空格、表格闭合、终末换行检查通过。没有official runtime、browser、GPU、asset loading或保存API验证。源码可读不能证明本地实现完成。
