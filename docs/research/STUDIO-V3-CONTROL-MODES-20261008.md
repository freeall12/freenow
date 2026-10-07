# Studio V3 官方操控模式源码合同 · 2026-10-08

依据本机 `/Applications/TapNow.app/Contents/Resources/web/assets/` 安装包的静态源码。下文给出可转译算法、输入与事务边界；没有执行官方bundle、调用供应商或进行视觉验收。角色／道具操控、摄像机possession、普通viewport飞行、transform gizmo是不同流程，不能以一个WASD开关替代。

## 1. 模式与入口

| 模式 | 官方入口／主体 | 改动对象 | 相机行为 |
| --- | --- | --- | --- |
| 场景基准角色／道具操控 | `_7`、`Z5`→`TF.enter`，authoring=`scene-object`、setupId=renderSetupId | scene-object transform，scout事务 | 保存viewport原相机，跟随实体 |
| 导演角色／道具操控 | `$4`→`op`→`TF.enter`，authoring=`director` | base transform或temporal key | 保存viewport原相机，跟随实体 |
| 摄像机操控 | `op`→`E2.enterDirectorCamera`；相机HUD或激活动作提供入口 | `E2`只预览viewport；`EV`另外负责camera/base/key写入 | 保存viewport原相机，进入被操控相机视角 |
| 普通viewport飞行 | `pl`→`applyDirectorFly` | viewport camera | 沿camera quaternion的三维forward/right自由移动 |
| transform gizmo | `cV/lV/Im/Tm`或baseline `Rk` | 独立editTransform session | pointer拖轴／平面／旋转环，不创建跟随操控session |

共享entity菜单`Am`为actor显示“操控角色”，prop显示“操控”，camera不由该菜单callback提供Control；相机选中HUD `sV`另显示“操控摄像机”。菜单图标`Gw`是keyboard，场景选中HUD的actor/prop图标`Ap`是gamepad-2，两者不可混淆。快捷键C仅为actor/prop的选择动作注册；F6没有为camera注册同样的C行为。

`op`顺序：验证kind为actor/prop/camera、拒playing；handoff当前camera edit；onBeforeEnter清编辑／放置；选实体；若当前viewfinder则关闭。进入camera前finish实体操控；同一被操控camera直接true。进入actor/prop前退出possession，计算Kn目标；同主体同目标直接true，同主体不同目标先finish再以animated=false/duration=0进入，不同主体以默认动画进入。

`Kn`优先同实体有效selected key；否则无track keys→base；有keys且playhead命中key→selected-key；剩余→time-key。摄像机若有selected key，`FH`通过Cm在该key时间采样完整camera作为进入初态；否则采用editableCameraStates。

## 2. 资格分层：不能臆造统一锁规则

- UI `_U`：usable=uiReady && !readonly && !gallery && !viewfinder；placement、playing/scrubbing、panorama与control都会影响闲置plan菜单；control使topView不active。`OU`在有editable setup且有control subject时返回controlling。
- scene baseline支持actor/prop scene-object操控；temporal能力`canAuthorTemporal`只为独立state。baseline相机创建UI禁用，不能由此推断baseline角色Control禁用。
- `TF.enter`拒已有active control与playing；要求Mc能取到实体state、history.begin成功。director再检查canEditEntity；该实现只验证editable setup、同stage的actor/camera/prop、activeSetup state含实体ID，**没有locked判断**。
- `op`和`TF.enter`没有直接拒scrubbing；`TF.applyGate`拒temporalPlayheadScrubbing，垂直transition在scrubbing时中断，UI闲置菜单同时隐藏。不能将“入口未拒绝”写成scrub期间允许姿态更新。
- `Et`只识别locked actor/prop。`WW`拒locked实体的temporal edit、insert key、path/key变更；base／scene-object直接transform路径没有同样Et gate。`Am`不因locked隐藏Control。locked实体的场景点击选择被阻止，已选中实体仍可有动作。复刻应保留这些边界，不能新增“locked一律禁用Control”的假官方合同。
- `E2`由enabled=!readonly调用，拒playing、失效camera lease、缺camera state；不额外检查canAuthorTemporal或locked。实际相机列表与UI入口受独立state／editableCameraStates作用域控制。
- keyboard事件拒defaultPrevented、IME、input/textarea/select/contenteditable/role=textbox、ignore-hotkeys。command还避button/menu/dialog；movement另检查block-movement-hotkeys。keyup始终清对应flag；blur/visibility hidden清全部移动与view flags。

## 3. 输入合同

| 输入 | actor/prop control | camera possession／普通viewport |
| --- | --- | --- |
| WASD | followRig yaw对应XZ平面方向 | camera quaternion对应三维forward/right |
| Q/E held | 连续下／上移动；不是每keydown一次1米 | 世界Y下／上，与forward/right混合后归一化 |
| Shift | sprint倍率1.6 | sprint倍率5，叠加用户速度倍率 |
| G | 控制专用NF落地，body support算法 | 没有实体control G路径 |
| C/F/L | 闲置选择上下文注册Control／Focus／Lock；控制中常规选择快捷动作不复用 | camera选中HUD另提供control按钮 |
| 左键／中键拖 | viewportInputOwner接管，调整followRig yaw/pitch | 普通camera look；Alt左拖pivot orbit／中拖pivot pan |
| wheel／触控板双指 | rotate→followRig orbit；zoom→相机距实体距离 | rotate→camera look；zoom enabled时改变focalLength，已有pivot则改变距pivot距离 |
| 箭头键 | entity-control lease占用view-rotation，不能让普通camera tick另转一次 | 平滑转camera yaw/pitch |
| Escape | 完成并退出，提交当前操控事务 | finishCurrentCameraEdit成功才退出possession |
| HUD“还原并退出” | history.cancel，退出并恢复viewport camera | cancelCurrentCameraEdit，再退出possession |

`pl`使用pointer事件，accept按钮0或1；owner turn drag先于普通camera captured/leased gate。actor/prop取得owner=`entity-control`的camera-movement-capture、camera-drag、camera-wheel、view-rotation输入leases。owner drag允许自己这份lease，但若其他owner也占camera-drag/view-rotation则拒接管。`onWheel`先交viewport owner，再检查普通camera-wheel lease。

touch证据范围：scene mount为touch-action:none；control输入使用pointer而非mouse-only事件，rotation slider是touch-none pointer capture。未在该control路径发现独立touchstart/touchmove、多指缩放、移动端joystick或触控移动面板；不可凭“触控板双指滑动”文案补造这些功能。触控板双指输入由wheel处理。

wheel normalize：pixel=1；line×16；page×max(1,viewportHeight×0.8)。intent=zoom若ctrlKey或line/page；否则abs(dx)>0.75、非整数dx/dy、abs(dy)≤16→rotate；dx<0.75且整数abs(dy)≥48→zoom；其他rotate。普通camera连续wheel手势在180ms内锁intent；entity-control owner每次直接使用当前分类，不经过该锁。

## 4. 角色／道具实时算法

### 4.1 初始化与提交

`TF.enter`：Mc复制当前authoring目标state，开始scout.controlCharacter／scout.controlProp或director.controlEntity事务，复制viewport camera为returnCameraState；GW lease owner=entity-control、restore 0.55s；清移动flag／当前camera输入，取得输入leases；Wf建立spatialProfile；di绑定当前collider；初始化followRig、liveTransform、velocity(0,0)、speedMultiplier=1、verticalVelocity=0、grounded=true、manualHeightActive=false、supportContactValid=false、liveDirty=false。进入camera动画默认0.8s。actor animation override初始化idle/smooth。

每个simulation tick使用`dt=min(0.05, frameMilliseconds/1000)`。先FF处理垂直按钮动画；无动画则OF→D2。变化先经applyGate，更新liveTransform、renderable `gn(object,hn(kind,transform))`和跟随camera；不是每帧直接往domain写。

`finish`：hd flush最新live state；pending key creation不flush；若liveDirty仍true，停止finish，保持session；否则history.commit，transactionChanged且commit成功才markOwnedContent，restore viewport camera 0.55s并清leases／flags／actor override／HUD。`cancel`：history.cancel后同样恢复camera和清session。unmount cancel事务、release lease但不restore。实体state消失则cancel并恢复camera。

hd用完整position/rotation/scale的1e-4阈值比较；没有变化则清dirty。scene-object写editSceneObjectTransform(entityId,transform,{setupId})；director base写editDirectorEntityWorldTransform；非base通过temporalAuthoring.editEntity(history=external,source=entity-control)。sampleLiveState为当前editable state的deepclone配liveTransform，保留pose等其他字段。

### 4.2 水平移动、朝向与动画

```text
basis.forward = (-sin(rig.yaw), -cos(rig.yaw))  // X,Z
basis.right   = ( cos(rig.yaw), -sin(rig.yaw))
intent = WASD加减basis向量
speedMultiplier = approach(old, shift ? 1.6 : 1, 8*dt)
speed = approach(length(oldVelocity), 6*speedMultiplier, 48*dt)
velocity = normalize(intent)*speed（无intent立即置0）
deltaXZ = velocity*dt
actor移动时heading=jl(velocity)，用ba(actor,nextTransform,heading)转向
prop保持原rotation
```

换方向立即改变velocity方向，只对速度大小加速；松键立即停止，不采用普通camera fly的friction。I2的动画阈值=6×(1+1.6)/2=7.8；moving=false或速度<0.03→idle，sprint或速度≥7.8→run，否则walk。V_支持facingYaw反向dot<-0.2→walkBack，但本control的D2→I2没有传facingYaw，不能声称当前WASD必然会触发walkBack。release动画transition=quick，其他smooth。

actor能力fallback：idle→idle/standing；walk→walk/idle/standing；walkBack→walkBack/walk/idle/standing；run→run/walk/idle/standing；无已知clip能力时保留期望state。animation override是会话预览，退出清掉；不能把行走动画误存为pose字段。

### 4.3 高度、重力与专用落地

held Q/E：deltaY=((up?1:0)-(down?1:0))×6×max(0,speedMultiplier)×max(0,dt)。active时verticalVelocity=0，manualHeightActive=true；上移不找支撑，下移snapDistance=abs(deltaY)+0.08且可land。manualHeightActive且没有输入时保持高度，禁gravity。正常离地gravity=-18units/s²；grounded且向下速度≤0不继续累加gravity，常规步行支撑snapDistance=0.35；空中下降为abs(deltaY)+0.08。landing成功清verticalVelocity/manualHeightActive。

HUD“上移／下移”走LF，每次±1米；下移找支撑maxSnapDistance=1+0.08，上移不找；200ms cubic ease-out `1-(1-t)^3`。HUD／G落地走NF，无限support snap，duration=clamp(180+abs(deltaY)×35,180,320)ms。prefers-reduced-motion立即应用。任何WASD/QE中断垂直transition，scrubbing也中断；Shift单独不打断。

control support是`lF/uF`，**不同于entity menu qS**：bottomY=position.y+profile.body.bottomOffsetY；XZ采样中心与四角、角偏移radius×0.7；从max(bottomY,position.y)+0.03向下射线，far=originY-bottomY+maxSnapDistance；每点取首个合格命中，各点取最高Y。法线按collider matrixWorld变换，朝射线方向则反转，要求normal.y≥0.2，无face也可接受。无hit用groundY；abs(targetY-bottomY)>maxSnapDistance则supported=false，否则平移Y。此路径只用collider／ground，没有surfaceObjects mesh集合。菜单Drop的AABB五点、normalY≥0.65、referenceY优先阈值规则见实体菜单研究文档，不可直接复用来代替control support。

水平碰撞`rF`：沿位移方向，身体3层sampleHeights各发射ray，far=moveDistance+body.radius+0.025；第一个face且world normal absY≤0.45视为墙；allowed=min(moveDistance,max(0,hit.distance-radius-0.025))；只截断XZ，不实现沿墙滑行。无collider原样通过。

### 4.4 spatialProfile与跟随相机

Wf优先实际world/canonical bounds。设h=max(bboxHeight,0.24)、b=minY-transformY、c=centerY-transformY、i=max(sizeX,sizeZ)、a=max(sizeX,sizeZ,h×0.45)。sizeX/Z至少0.1。actor优先canonical bounds，否则通用spatial metrics；prop通用metrics。

| profile | actor | prop |
| --- | --- | --- |
| cameraTargetHeight | max(0.18,b+0.82h,0.72h) | max(0.18,c) |
| default distance | clamp(1.85h,2.2,5.8) | clamp(max(1.8h,2.4a),1.6,7) |
| min distance | clamp(0.62h,0.9,2.6) | clamp(max(0.55h,0.8a),0.75,3.2) |
| max distance | clamp(max(4.2h,5a),4.5,18) | clamp(max(4h,5a),4,20) |
| body radius | clamp(0.48i,0.18,0.48) | clamp(0.55i,0.16,1.4) |
| body samples | max(0.18,b+h×[.18,.52,.78]) | max(0.18,[b+.28h,c,b+.72h]) |

body.bottomOffsetY=b。bounds fallback：actor未缩放高1.8、prop高1；高乘正finite scaleY（否则1），横向size=max(.35,正finite scaleX/Z否则1)。actor或prop presentationAnchor=bottom时b=0,c=h/2；其他prop b=-h/2,c=0。actor anchor固定bottom，prop来自asset.presentationAnchor缺省center。

Da基础参数defaultDistance=3.2、targetHeight=1.45、minDistance=1.2、maxDistance=10；实际由profile覆盖，sl保证minDistance≥0.8、maxDistance≥defaultDistance。actor初始rig yaw=-Or(actor)、pitch=-0.12、distance=profile default；prop从当前相机与target方向初始化yaw/pitch/distance。pitch clamp[-0.72,0.25]；拖拽yaw-=dx×.002、pitch-=dy×.002；wheel rotate用.003；zoom distance*=exp(dy×.001)并按profile范围clamp。

Pc以Euler(pitch,yaw,0,YXZ) forward计算desiredCamera=target-forward×distance+sideOffset×right，target=entity.position+(0,targetHeight,0)，初始sideOffset=0；lookAt得到YXZ camera rotation，保留base camera optics。dF target→desiredPosition ray near=.45，far=距离，firstHitOnly临时true；hit时camera距target=max(.45,hit.distance-.18)，避免穿墙。

profile cache key=object.uuid、anchor、renderableRevision、scale xyz toFixed(4)，不含position/rotation；出现真实renderable或revision/scale变化重新计算。profile变化时targetHeight更新，distance若仍在旧default±.01则换新default，否则clamp当前distance。复刻不能将相机距离硬编码3.2或targetHeight硬编码1.45用于所有模型。

## 5. 摄像机possession与viewport lease

`GW`只持有一个active lease：begin复制baseline（缺省getCameraState）与owner/restoreOptions，替换当前lease。handle.isActive按identity判断；release仅清owner占位，不改camera；restoreAndRelease仅当前lease有效时恢复deepclone baseline、sync optics并释放。旧lease不得恢复并覆盖新owner相机。

`E2`owner=`director-camera-possession`，第一次进入begin lease，切换camera复用原lease；同camera直接true。cancel当前navigation input，setCameraState(normalized target,{animated:true,duration:.8})、sync optics、setActiveView(null)、session={uuid,cameraEntityId}。previewDirectorCameraState仅同camera entity才更新。exit取消navigation，restoreAndRelease(.55s)、session=null。camera失效或enabled=false自动退出；unmount仅release。

`sD`断言camera roles互斥：possession、camera-key-edit、viewfinder不能同时为true。possession role=director-camera-possession，captureSource=possession，controls/optics/capture与liveRecord能力可用；actor/prop control拍照captureSource=entity_control。相机HUD不应使用角色跟随rig。

普通camera自由飞行`pl.applyDirectorFly`（possession同用）：base speed=3、sprint=5、acceleration=30、multiplier transition=8、friction=1e-8、deadzone=.015；用户moveSpeedMultiplier默认1，finite clamp[.25,100]。forward/right由camera quaternion，QE加世界Y，然后对完整三维intent归一化；speed/acceleration/deadzone均乘用户倍率。松开velocity*=friction^dt直到deadzone；与entity松键即停不同。

camera drag sensitivity=.002，look Euler YXZ pitch clamp±π×.45；左拖跨4px才active，中拖立即active；释放80ms内有新motion则保留惯性，每tick×.92，abs(vx)+abs(vy)<.1清零。箭头yaw/pitch目标±1.5rad/s，以12×dt approach，松开衰减1e-8^dt、deadzone .005。wheel look=.003；默认wheelLookInverted=false、wheelZoomEnabled=true（由存储偏好加载，profile可能禁focalLength使zoom=false）。zoom focalLength*=exp(-dy×.001)后Zn clamp。它不是control camera distance。

`EV`才是possession编辑事务：owner由kV生成camera-possession，AV用setup/entity/selected-key或time-key/base和possession session ID稳定标识目标。possession复用E2 lease，EV不再抢一个camera-key-edit lease；timeline-settings才使用owner=camera-key-edit、restore .22s。onCameraPoseInput置poseDirty，optics callback分别置opticsDirty；history.begin(director,director.editCamera)后写base camera或external temporal key。没有变化cancel空事务。新time-key若Pr需要确认则请求确认，拒绝时恢复baseline pose并cancel；完成时不允许偷偷建立尚未确认key。

`$n`：先finishCurrentCameraEdit，有edit callback时必须返回true才exit possession；也finish actor/prop control。`Mf`：cancelCurrentCameraEdit、cancel entity control、exit possession。“完成”和Escape走$n；“还原并退出”走Mf。不能用E2.exit来冒充domain commit，也不能令Escape等同cancel。

## 6. temporal控制与退出边界

TF pending time-key的applyGate仅在reason=explicit且confirmation=idle时弹确认；被动支撑／gravity不触发创建确认。确认成功从请求transform与live state构建key，切session为selected-key后应用；取消记录cancelled，不继续每帧弹窗。

previewDirectorTarget先flush旧target，若仍dirty拒；重置velocity/height/ground/animation并按新目标state刷新跟随rig，可保留pending key请求。retarget先flush／commit旧事务，再hy开始新事务。saveDirectorKeyAt要求director、finite time、非playing、未locked，时间round且≥0；插入当前live state后session指向new selected-key。选择其他entity key通过ZH finish当前entity；同entity key retarget。

director entity操控期间时间轴仍可呈现并切key／保存key；zV禁move/delete key、delete track、duration等结构操作，文案“完成当前操控后，才能移动或删除关键帧以及修改时间轴时长”。playback Space注册enabled要求没有entityControl.session。camera authoring在playing／previewing／scrubbing时停用，开启播放先handoff camera edit。不要将控制session开放理解为全部timeline操作均可用。

退出Escape priority：菜单400、panel390、gallery360、viewfinderCommit355、viewfinder350、placement300、transformGizmo270、possession260、entityControl250、planView240、selection200、tool150。局部输入／拖拽Escape先取消自己的编辑；没有高优先级拦截时control Escape完成。scope切换（如State）先cancel placement并$n finish控制；这不是无条件抛弃未保存姿态。

## 7. HUD、文案、样式和图标

entity-control active时底部center完整替换常规动作组为bY，外fieldset aria-label=主操作，data-workspace-main-actions=true。不是在State/Place右侧追加一个小状态图标。timeline可作为另一个capsule存在。camera possession显示wY的optics/capture和IE结束组。

| HUD按钮／字段 | 中文 | 事件 | icon（index原symbol） |
| --- | --- | --- | --- |
| Drop to ground | 落到地面 | entityControl.dropToGround，成功toast | qI→OO arrow-down-to-line，18/1.8 |
| Move down | 下移 | nudgeHeight(down)；tooltip Q | ZI→RE arrow-down，18/1.8 |
| Move up | 上移 | nudgeHeight(up)；tooltip E | JI→PE arrow-up，18/1.8 |
| Rotation | 旋转 | setRotationDeg | slider，无独立icon |
| Restore and exit | 还原并退出 | cancel/Mf | hv→yme undo-2，18/1.8 |
| Done | 完成 | finish/$n；aria-keyshortcuts Escape | yo→Dh check，18/1.9 |

rotation only session && rotationDeg!==null呈现。UI 0–359，presets=[0,90,180,270,359]，linear trackWidth=360/readoutWidth=40，显示rounded整数°；setRotationDeg finite归一化 `(deg%360+360)%360`，>180映射deg−360后转弧度，再ba(subject.kind,liveTransform,heading)。不是直接写rotation.y。正在垂直transition时同时替换from/to rotation，避免下一动画帧回跳。

slider `zt`使用pointer capture，primary左键、3px activation threshold；pointerup结束，pointercancel/lost capture结束或取消局部interaction；bY仅传onChange，没有另一个history transaction回调，所以姿态仍属于整个control session。触控slider也是同一路径。对应ruler读数／按钮使用真实语义、focus与键盘，不能以装饰拖条取代。

样式：bY/wY=`flex min-w-0 items-center px-0.5`；chrome button h36、min-w36、gap6、px10、font14/500、rounded-full，hover white10%、focus outline1px white45%、disabled white25%；还原text white72%，完成bg white10%/text white92%/hover white14%。separator width1/height20，HUD override mx2px。rotation label text14/500 white84%，group gap4/pl8/pr4。

底dock RE bottom12、px8、gap12、grid三列；center h48，chrome z70。entity capsule collapsed/minExpanded48，maxExpanded1040×48，contentInset=actionInset6；按实际内容测量／动画，不固定1040px。常规action viewport横滚隐藏scrollbar、内层宽max-content。详细surface与responsive样式见已有UI合同；不得引入常驻对象树或右侧inspector来替代该HUD。

中文资源（index-BsHyQ2qj.js原字符offset）：lower=9167434；restoreAndExit=9167447；mainActions=9167472；rotation=9167492；finishBeforeTimelineStructure=9167508；raise=9167570；finishControl=9167583；controlCharacter=9160776；controlObject=9161344；controlCamera=9161163；controlDescription=9160989／9172906；twoFingerTouch=9171947；lockedEntityCannotAnimate=9178256。后一个controlDescription为“调整会实时保存；WASD 移动，Q / E 升降；Esc 完成”；这是用户文案，不能替代上文live preview／flush／history边界。

## 8. 与transform gizmo的具体区别

官方自定义`Im/Tm`支持translate axis/plane、rotate、scale；不是直接调用Three.js TransformControls的菜单模式。actor/prop capability=translate+rotate+scale，camera=translate+rotate，camera无scale。pivot根据presentation-center或camera transform-origin计算，可oriented；拖拽更新worldMatrix转成存储transform。

Tm pointerdown只pick并取得transform-gizmo输入lease；移动≥2px才tryBegin。pointermove合并到requestAnimationFrame，每帧onChange一次。pointerup flush pending并有变化才commit；Escape、pointercancel、buttons=0、blur→cancel，释放lease/恢复cursor。Control的Escape则finish，且有跟随／walking／support／animation与整段history事务，两者不可复用同一个结束语义。

`bB`在controlActive或planViewActive时featureActive=false、transformGizmoActive=false；sV另外在focused actor/prop时抑制gizmo。进入Control不能留下可拖轴控件同时消耗pointer。Control内rotation／height HUD也不是全自由scale编辑入口。

## 9. runtime可执行验收点与静态限制

实现须按session保留：subject、authoring target、return viewport camera lease、liveTransform、dirty／transactionChanged、velocity/sprint、verticalVelocity/ground/manualHeight/supportContact、profile cache、followRig、pending key confirmation。renderable预览使用hn／Ta角色heading转换；不能将actor姿态直接等同prop Euler。

可执行验收顺序：进入实体→按W与Shift实际移动／跟随→停止立即停→QE held升降后悬停→按钮1m与G落地→旋转HUD→完成后持久状态／undo→再进入并还原取消→切实体／key→camera进入与WASD三维飞行→完成／还原→确认viewport相机恢复。测试应包含IME/input focus、blur键清理、frame dt上限、旧lease不得恢复覆盖新owner、无变化事务、失败flush保留session、pending key拒绝与非explicit不弹确认。

未验证官方运行效果：touch硬件行为、实际collider/BVH／canonical bounds构建时机、脚底视觉、极端模型尺度、camera惯性与动画帧率、后端持久化与多端同步。静态合同不声称这些已验收。此研究仅新增本文，无生产／测试变更。

## 10. 原始source定位与hash

以下offset为原始文件解码JS string的零基字符位置，不是byte offset。Readable副本位于ignored `reference/studio-v3-ui-20261008/`，只作浏览便利；实现不得import官方bundle。

| source文件 | symbols | Character offsets |
| --- | --- | --- |
| ThreeDWorkspace-BzPphAqB.js | `op / Kn / FH` | 488105 / 487706 / 489295 |
| ThreeDWorkspace-BzPphAqB.js | `TF / hy / Mc` | 215031 / 226383 / 226557 |
| ThreeDWorkspace-BzPphAqB.js | `PF / hd / ll` | 227051 / 227508 / 228291 |
| ThreeDWorkspace-BzPphAqB.js | `I2 / D2 / L2 / N2` | 196746 / 197884 / 199436 / 200141 |
| ThreeDWorkspace-BzPphAqB.js | `Wf / eF / tF / sl` | 203509 / 204768 / 205110 / 204547 |
| ThreeDWorkspace-BzPphAqB.js | `B2 / z2 / K2 / Pc` | 201284 / 200831 / 202354 / 201776 |
| ThreeDWorkspace-BzPphAqB.js | `rF / lF / uF / dF` | 205591 / 206384 / 206734 / 207653 |
| ThreeDWorkspace-BzPphAqB.js | `OF / LF / NF / Yx / FF` | 229730 / 231378 / 232368 / 233216 / 234110 |
| ThreeDWorkspace-BzPphAqB.js | `Yl / xm / Xx / UF` | 235466 / 236089 / 237907 / 238069 |
| ThreeDWorkspace-BzPphAqB.js | `E2 / GW / sD` | 195115 / 282406 / 70784 |
| ThreeDWorkspace-BzPphAqB.js | `EV / AV / kV` | 560316 / 567587 / 559966 |
| ThreeDWorkspace-BzPphAqB.js | `$n / Mf / VC / ZH` | 158107 / 158412 / 492982 / 493204 |
| ThreeDWorkspace-BzPphAqB.js | `OD / _U / OU / NU` | 84539 / 684421 / 684967 / 685305 |
| ThreeDWorkspace-BzPphAqB.js | `bY / wY / IE / RE` | 869067 / 870813 / 871537 / 866485 |
| ThreeDWorkspace-BzPphAqB.js | `Am / F6 / _7 / Z5` | 362360 / 751524 / 788010 / 391511 |
| ThreeDWorkspace-BzPphAqB.js | `WW / lk / zV` | 267540 / 272562 / 575797 |
| ThreeDWorkspace-BzPphAqB.js | `Tm / cV / lV / bB` | 333876 / 544947 / 546503 / 441153 |
| ThreeDWorkspace-BzPphAqB.js | `V_ / bD` | 104533 / 75278 |
| WorkspaceViewfinderButton-BHqIWibq.js | `pl class` | 20099 |
| WorkspaceViewfinderButton-BHqIWibq.js | `pl fly / drag / wheel` | 25050 / 26118 / 29215 |
| WorkspaceViewfinderButton-BHqIWibq.js | `pl owner turn` | 33658 / 34326 |
| WorkspaceViewfinderButton-BHqIWibq.js | `Kc / Gc / ra / na` | 4522 / 4713 / 8930 / 8661 |
| WorkspaceViewfinderButton-BHqIWibq.js | `nl / rl / ol` | 9886 / 9937 / 9981 |
| WorkspaceViewfinderButton-BHqIWibq.js | `ma / fn / nt / Xo` | 10374 / 10489 / 4450 / 4250 |
| WorkspaceViewfinderButton-BHqIWibq.js | `Ie chrome / zt slider` | 56974 / 76888 |
| EnvironmentLightingPickerContent-CigxxFZu.js | `ic / oc / ac / cc` | 74522 / 74574 / 74632 / 74771 |
| course-api-base-url-CGXqZmAy.js | `hn→Hq / Ta→ZOe / ba→Sdt / Or→Cdt` | 1544423 / 1544467 / 1544702 / 1544564 |

| 原始文件 | SHA-256 |
| --- | --- |
| ThreeDWorkspace-BzPphAqB.js | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| WorkspaceViewfinderButton-BHqIWibq.js | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` |
| EnvironmentLightingPickerContent-CigxxFZu.js | `b9b06fd215e4a951798c1b88e32842fe71aac5a94f57f7128d5eaf6aa8f9d8e8` |
| course-api-base-url-CGXqZmAy.js | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| index-BsHyQ2qj.js | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |

图标index字符offset：arrow-down-to-line `OO`=1190514；arrow-down `RE`=1191326；arrow-up `PE`=1195112；undo-2 `yme`=1578602；check `Dh`=1259964；keyboard `Yle`=1393980；gamepad-2 `ese`=1358420。均为官方SVG，不使用emoji替代。

## 11. Camera marker：身体、视锥和局部轴证据

本段重新静态读取原始安装包，未以代理消息或本地实现作为证据。`io`明确引用`/assets/world-model/director/camera.glb`，size=.25、assetForwardYaw=π/2；实体marker的结构是：

```text
root director-camera:<entityId>          optical camera world pose，scale=(1,1,1)
├─ frustumRoot director-camera-frustum  无body偏移；outline/stroke line
└─ bodyRoot director-camera-body        local position.z=+0.13
   └─ iconRoot director-camera-icon     local rotation.y=π/2
      └─ director-camera-icon-normalized
         └─ camera.glb scene
```

`TH`令bodyRoot.position.z=`IH=.13`，不是给camera optical position加0.13世界Z。frustumRoot与bodyRoot是两个独立Group，但二者与root、icon／线条都在**同一helper layer 5**；不是frustum/body各用一个不同layer。`fo`从world-object-spatial-metrics export `a`导入，对应`M=5`；`Oc/ab`给root及全部children设置该layer。

`EH`把GLB放入normalized Group，求世界AABB，取`max(size.x,size.y,size.z)`，统一scale=.25/maxDimension；缩放后重新求bounds中心，再`normalized.position.sub(center)`使中心归零。这里“0.25m身体”指最长轴归一化为0.25场景单位，不是每轴固定0.25，也不是iconRoot额外乘entity.scale。bbox为空或maxDimension≤1e-4时原样返回。`CH`缓存异步load promise，失败返回null；不执行模型加载也能核对以上合同。

`kH`只在iconRoot施加π/2资产朝向修正，不能把它加到root camera optics rotation或frustumRoot。`PH/BC`优先用state.camera.position/rotation，否则transform与转换rotation；root.scale始终1。transformPreviewActive时PH暂不覆盖root pose，仍更新颜色／视锥与matrixWorld。

视锥是单独的line geometry：distance=.18、maxHalfHeight=.04125、maxHalfWidth=.07125，aspect来自camera或defaultAspect，fov缺省50；模型body renderOrder=22，frustum outline/stroke=20/21。`RH`以独立材质替换GLB mesh：metalness=.06、roughness=.78、envMapIntensity=.18、depthTest/depthWrite/toneMapped=true、side=io.materialSide；frustum lines depthTest/depthWrite=true、toneMapped=false。这些都是编辑helper，不能当实体实际拍摄内容。

`OH`返回不同目标：transformRoot=root，transformPivot=bodyRoot，outlineTarget与pickTarget=iconRoot。因此把身体与视锥合成单个body bbox用于拾取／选择轮廓会改变官方行为。上述marker创建／更新函数没有按viewport与camera的距离阈值隐藏身体的分支；不能把任意proximity threshold写成该函数的官方规则。本段未验证全局optical render的guide排除策略，不对本地“当前optical preview临时排除自身guide”的实现作官方运行验收结论。

原始解码JS string的零基字符offset：

| source | symbol | offset |
| --- | --- | ---: |
| ThreeDWorkspace-BzPphAqB.js | io | 480832 |
| 同文件 | kH / CH / EH / RH / ab | 481024 / 481505 / 481596 / 481948 / 482247 |
| 同文件 | IH / TH | 482311 / 482553 |
| 同文件 | PH / BC / MH / AH | 483667 / 483907 / 484098 / 484327 |
| 同文件 | ib / Oc / OH | 484937 / 485037 / 485419 |
| world-object-spatial-metrics-B9CCwPzJ.js | M=5（export a→fo） | 63 |

原始本地source路径为`/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`，SHA-256=`85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`；同目录world-object-spatial-metrics-B9CCwPzJ.js SHA-256=`921daef1e9d52eb5d7d4fe322c465dd9964b267ac6ca219e942876d385086564`。原GLB已确认在同目录`world-model/director/camera.glb`，14948 bytes，SHA-256=`00f5a46007aee91cf8a9accd2584ad83b7dc3ce2396c1dd325ff61c3304004e7`；未执行GLB renderer或官方bundle。
