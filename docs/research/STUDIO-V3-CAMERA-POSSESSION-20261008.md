# Studio V3 摄像机接管与编辑合同 · 2026-10-08

本轮只做静态研究；未执行官方 JS、未调用官方 API、未修改 production/test、未提交。官方证据来自安装包原文件及公开文档，现有本地实现仅用于定位缺口。所有 offset 均为 **UTF-8 解码后 JS string 的零基字符 offset**，不是 byte offset。

## 结论与可执行范围

摄像机接管必须有两个独立职责：`E2/GW` 保存并接管 viewport camera；`EV` 接收姿态／光学输入并写入摄像机领域事务。`$n` 只有编辑完成返回 true 才退出 possession，`Mf` 先取消领域编辑再退出。Escape 是完成；“还原并退出”是取消。只调用 viewport exit 不能算保存。

本地本批最小正确范围：独立状态、摄像机无 temporal keys 的 base 编辑；以真实摄像机姿态进入，三维移动／转向／光学预览，完成一笔 director history，取消恢复原领域状态，退出恢复原 viewport。已有 keys／selected key／time-key、播放／scrub、关键帧保存与录制入口明确拒绝；不能把修改 base 冒充修改 key。camera marker、完整光学滑尺、拍摄闭环须各有证据，不以接管完成推断完成。

## 官方入口顺序与资格

`op`：

1. `WH` 只允许 actor/prop/camera；playing 直接 false。
2. handoff 当前 camera edit；调用 onBeforeEnter（清临时编辑／放置）；选中实体。
3. 若当前 camera role 为 viewfinder，先关闭。
4. camera 分支先 finish actor/prop control；同一 camera 已接管返回 true。
5. 使用调用方 initialCameraState，或 `FH` 在同 camera selected key 的时间 `Cm` 采样 camera，或 `E2` 的 editableCameraStates camera。
6. `E2.enterDirectorCamera` 成功后外层 wrapper 关闭 viewfinder、清 active view；entity focus 退出。

`E2` 的显式 gate：enabled（调用为 `!readonly`）、非 playing、旧 lease 若存在必须仍 active、camera state 可取得。没有在此函数直接检查 locked 或 independent。UI 则有另一个边界：`$4` 只在 `canAuthorTemporal` 为真时把 editable cameras 放入选择候选；`NU` 的 camera states 使用 independent (`v`) && plan availability (`C`)。`lk` 的 canAuthorTemporal 为 editSetup 存在且非 scene-baseline。所以基线 camera 操控应由 UI/命令守卫拒绝；不能以低层 E2 可接 initial state 证明官方基线 UI 支持接管。

`Et` 只识别 locked actor/prop，camera 不在其范围。不要把本地统一 locked 判断标成官方摄像机锁合同；本地若为安全边界额外拒 locked camera，应说明是实现策略。渲染相机必须属于当前 setup/stage 且有效；不能接管另一 state 的 camera。

`Kn` 的 authoring target 顺序：同实体有效 selected key → selected-key；无 track keys → base；playhead 命中 key → selected-key；否则 time-key。camera 在非零 playhead但没有 keys 时仍是 base，不应仅用 playhead>0 推断要创建 key。

### 进入时的 rotation 与 lookAt

常规选中入口使用领域 camera 的 raw／temporal-sampled rotation，未采样已解析 lookAt 的 Three camera。源A `op`（488105；目标选择488560）优先调用方 initialCameraState，其次 `FH`（489295）选中key采样，最后由 `E2`（195115；读取editableCameraStates=195537）取 camera 并调用 `Gn(S)`。源A `Gn`（112311）直接复制 position/rotation并转换optics，返回字段不包含lookAt；源A `$t`来自源B `Ml`（50519），只规范frameAspectRatio。源A `qn`（152802）随后按传入rotation构造Euler→quaternion作为进入动画目标，没有读取辅助体或已派生的Three camera方向。

`editableCameraStates`来自源A `BW`中 `W.cameraStates`（275391），由 `km`（244016）调用 `PT(setup.entityStates,setup.temporal).sample()`。`PT`是源E `SLe`（1554494）：无temporal时直接以 `Xz`（1561033）clone camera；有channels时逐字段采样，camera.rotation赋采样Euler（1557065），camera.lookAt只clone字段（1557577），这里没有由lookAt计算rotation。selected-key的 `FH→Cm`（244763）也走此采样路径；`EV`的baseline `MV`（567317）再通过 `Gn`转换同类领域camera。只有显式initialCameraState调用方可覆盖这条默认入口，不能把默认路径写成“总是从当前可见镜头取方向”。

因此，若其他实现先解析lookAt展示镜头，再希望接管保持该可见方向，那是需要单独定义的行为策略，不能标为已证实的官方derived-lookAt进入合同。`Gn`在临时optical state不带lookAt不等于进入时删除领域lookAt；领域清除仍遵循后文的真实pose写入规则。

## Viewport lease 与进入／退出动画

`GW.begin` deep clone 原 viewport baseline，记录 owner 与 restoreOptions，替换唯一 active lease。旧 handle `isActive` 按 identity 判断；旧 lease 的 restoreAndRelease 必须无效，防止旧 owner 覆盖新相机。`release` 仅放弃所有权；`restoreAndRelease` 先清 active，再 set baseline 并 sync optics。

`E2` owner=`director-camera-possession`。第一次进入创建 lease；切换接管 camera 复用最初 lease，因此退出仍回到最初导航视角。同 camera no-op。进入取消 navigation input，`setCameraState(normalizedTarget,{animated:true,duration:.8})`，同步镜头参数，session=`{id:UUID,cameraEntityId}`。退出取消 navigation input，restoreAndRelease 的 duration=.55，并置 session=null。camera 消失或 enabled=false 自动退出；unmount 只 release，不执行 restore。

不是 CSS ease：`Q_` 是 cubic ease-in-out：

```text
ease(t) = t < .5 ? 4*t*t*t : 1 - (-2*t+2)^3/2
progress += dt/duration; progress=min(1,progress)
position = lerp(fromPosition,toPosition,ease(progress))
quaternion = slerp(fromQuaternion,toQuaternion,ease(progress))
fov = fromFov + (toFov-fromFov)*ease(progress)
```

`setCameraState` animated=false 立即复制 position/quaternion/fov；animation 开始前读取当前 viewport 为 fromPose。光学同步与导航动画不是 domain poseDirty 输入，不能进入时无操作就清掉 lookAt 或产生 history。

`sD` 断言 possession、camera-key-edit、viewfinder 三者互斥；possession role=`director-camera-possession`，captureSource=`possession`，frameOverlay/controls/optics/capture/liveRecord 可用。actor/prop 跟随 rig 不适用摄像机接管。

## Camera edit begin／preview／finish／cancel

`kV` 为 possession 建 owner（cameraEntityId、possessionSessionId、source=`camera-possession`）；无 possession 时仅打开 timeline camera settings 才有 settings owner。`AV` 用 setup+entity+base/key/time+owner session 构成稳定 sessionId。UI `zV` 传 `editingEnabled=!playing&&!previewing&&!scrubbing`。

`RV` 初始 baseline=null、history=null、poseDirty=false、opticsDirty=false、latestCameraState=null、latestOpticsPatch=null、closed=false。`MV` 以 renderSetup/activeSetup 和目标时间采样 baseline。possession 复用 E2 lease，**EV 不再创建 camera-key-edit viewport lease**；settings 编辑才另创建 owner=`camera-key-edit`、restore=.22s。

输入回调合同：

| 输入 | 状态 | 写回 |
| --- | --- | --- |
| 导航 pose input | 读取 engine camera，与 latest optics 合并；poseDirty=true | 完整 `ul` 摄像机 state，写 transform+camera |
| focal length | opticsDirty=true；FL+按当前 ratio 计算 FOV | optics-only patch |
| ratio | 正值才接受；ratio+当前 FL+新 FOV | optics-only patch |
| depth of field | aperture/mode/focusPoint或distance/focusDistance | optics-only patch |

第一次要记录输入时 `history.begin("director","director.editCamera")`；history 已打开后后续输入累积 live dirty，flush/finish 再写剩余变化。base pose→editDirectorCamera；base optics→editDirectorCameraOptics；非base→external temporal authoring。记录无变化且新开事务时 cancel 空事务；完成时 history.changed=false 也 cancel，避免空 undo。

**lookAt 清除规则**：`ul(cameraState)` 使用 `_n` 重新构造 camera，字段列举不含 lookAt；因此真实 pose input 写回清除旧 lookAt。optics-only `ik(kind=camera-optics)` spread 旧 camera，并只改镜头字段，保留 lookAt、position/rotation和transform。不要用 viewport完整camera覆盖 optics-only change；不要“进入”或“单改焦距”清 lookAt。pose record 的 transform 保留既有 scale，以 optical position 和水平 heading 更新，而 camera.rotation 保留完整 optical rotation。

**HUD点对焦的字段链**：源A `k2.focusAtClientPoint`将client坐标转换为画布normalized坐标，调用光学 `focusAtScreenPoint`；源A `Zn`（155998）raycast后要求hit且depth>0，调用 `Ut({focusDistance:hit.depth,focusPoint:hit.position,mode:"aperture"},{input:true})`。`Ut`（143661）发 `onDepthOfFieldInput`，`EV`（564410）转换 `PV`（567038）得到 `{kind:"camera-optics",apertureFNumber,depthOfFieldMode,focus:{mode:"point",target:{...focusPoint}},focusDistance}`，其中point分支在567183。距离模式则为 `{mode:"distance",distance}`；无有效point/distance时PV传focus=null。源A `_n`（112874）也把optical focusPoint映射为同一point/target结构（113193）。这是optics-only patch，不能因拾取对焦而清lookAt或改pose。

结束：`EV.finish/handoff` 若 dirty，调用 flush(`allowCreateKey:false`)；若需要尚未确认的新 key，返回 false，不关闭 session、不恢复 viewport。finish 提交已修改 history；handoff additionally release settings lease。cancel 清 dirty/pending，cancel history，再恢复 baseline camera（possession baseline 用 animated=false；settings 用其 lease）。`$n` 必须拿到 finishCurrentCameraEdit=true 才 E2.exit；没有 callback 且 possession active 时拒绝退出。`Mf` 不要求 finish 成功，先 cancelCurrentCameraEdit 再 cancel entity control/exit possession。

`Pr` 的 time-key 需要确认时：未提供确认处理器／allowCreateKey=false 都不完成。确认取消恢复 baseline camera、清 dirty/pending/history；确认成功才真正 record。改变 setup/source/entity 或失去 owner 应退出／还原，不能让迟到回调写新 setup。关闭前先完成当前编辑；失败保留可恢复会话。

## 输入与 hidden／blur

摄像机走普通 `pl` 三维飞行：speed=3、Shift=5、acceleration=30、friction=1e-8、sprint transition=8、deadzone=.015，用户倍率 finite clamp[.25,100]。WASD 使用 camera quaternion forward/right；QE 使用世界 Y，合并三维向量后 normalize。松键有 friction，不能沿用 actor/prop 的平面移动和松键立即停。

drag sensitivity=.002、YXZ pitch clamp±π*.45；左拖跨4px才 active，中拖立即 active。箭头平滑 yaw/pitch，目标1.5rad/s。wheel normalize：pixel×1、line×16、page×max(1,height*.8)；ctrl/line/page→zoom，abs(dx)>.75／小数delta／abs(dy)≤16→rotate，dx<.75且整数abs(dy)≥48→zoom，其余rotate。普通手势180ms锁intent；先给 viewport owner，再检查 capture/lease gate。wheel rotate=.003；zoom `focalLength*=exp(-dy*.001)` clamp[8,400]，有 Alt pivot 时改 pivot distance而非焦距。

`OD` 的 blur/hidden 调 `mg`，仅清全部 movement/view key flags。`pl.onWindowBlur` 绑定 cancelInput；hidden 同样 cancelInput，清 drag/inertia/fly velocity/wheel intent/Alt navigation。**这两条不是 EV.cancel，不取消 domain edit、不退出 possession、不恢复旧领域状态**。transform gizmo／slider 有不同的局部取消语义；不可混用。hidden暂停绘制时也必须清输入，resume 不得继续旧 held movement。

文本输入、IME、defaultPrevented、contenteditable、role=textbox、ignore-hotkeys 应避让；光学滑尺键盘事件先 stopPropagation，不能同时转摄像机。Escape 优先级 possession260，viewfinder/局部menu/slider在它前面；滑尺拖动中的 Escape 先结束该交互。

## 接管 HUD 顺序、原图标与数值

`sV` 选中 camera 的 anchored action：仅“操控摄像机”，`jr` 是 index `FE` **camera**（20px，stroke1.9），不是gamepad或video。接管后整个 bottom center 常规 action capsule 换为 `wY`；不在 State/Place 后追加控制小按钮。

`wY` 左→右：`ih/SA(Xl)` 光学工具 → separator（仅 optics&&capture）→ `fE/xA($l)` 拍摄 → separator（任一 optics/capture）→ `IE` 还原并退出 → 完成。

光学 toolbar 顺序：画幅 → separator → 焦距滑尺 → 光圈滑尺 → 拾取对焦。依据 profile 可隐藏 FL/DOF。画幅按钮宽96、高40，含动态矩形 ratio icon（`Ln` 自绘 SVG，stroke1.5、rx1.5）+label+chevron-down20。对焦 `no=index.doe` 是 **focus**，20/stroke1.75；已设距离显示一位小数m，无限显示翻译readout。capture 为自绘20px圆环（border2）+12px实心圆；不是camera icon。

还原图标 `hv=index.yme` **undo-2**，18/stroke1.8、text-white/72；完成 `yo=index.Dh` **check**，18/stroke1.9，aria-keyshortcuts=Escape，tooltip Esc，bg-white/10、text-white/92、hover-bg-white/14。

| 光学控件 | 官方合同 |
| --- | --- |
| 焦距 | 8–400mm，presets=[8,16,24,35,50,85,135,400]，readout整数mm；缺省24mm；水平track534px（原Oo公式），log scale、fixed indicator |
| 光圈 | ƒ/1.4–ƒ/22，presets=[1.4,2,2.8,4,5.6,8,11,16,22]，缺省11；track216、window124；terminal deep-focus，无穷readout |
| 画幅菜单 | 两组：16:9/9:16/4:3/3:4/1:1/3:2/2:3/4:5/9:19.5/9:21；1.33:1/1.37:1/1.43:1/1.66:1/1.85:1/2.00:1/2.20:1/2.35:1/2.39:1；五列、button高56、popup maxHeight360 |
| 左侧焦距尺 `w7` | 单独浮动left4px，152×48；vertical、preset scale、moving indicator，track/window108、endpoint emphasis、无内部readout，下方整数17px+mm13px；scale-x1.2 |

底条滑尺 `zt` 原型是 touch-none pointer capture，不是普通select/range弹出菜单。fixed slider超3px进入drag，presets点击立即change+commit；pointerup commit；pointercancel/lost capture/Escape 若给 onInteractionCancel 则取消，否则 fallback commit。horizontal fixed在底条用于拖动刻度带；moving vertical支持 Arrow/Page/Home/End（1%/10%长度）与keyup/blur commit。值到刻度默认 log；major/minor tick变化动态强调。shared height40、major tick2×8、endpoint12、indicator高12、minor5，spacing约6、highlight340ms、window默认132。未实现这套滑尺时需明确保留“简化光学控件”的缺口，预设值相同不足以声称交互一致。

## Camera guide 的真实层与渲染排除

`TH/Oc` 的 camera root/body/frustum/GLB children 均设 ThreeDWorkspace `fo`。该 alias 从 world-object-spatial-metrics `a` 导入，对应 `M=5`。短frustum：distance=.18、maxHalfHeight=.04125、maxHalfWidth=.07125；body local Z=+.13、最长轴归一化=.25、仅iconRoot加asset yaw π/2。camera光学位姿不可加这些body偏移。

渲染不能把两个源文件同名 alias当同一符号。WorkspaceViewfinderButton 导入 `io=a=5`（editor entities）、`so=W=3`（editor overlays）、`co=b=4`（ground references）。`_l` 分派：

| profile | editor entities5 | ground refs4 | editor overlays3/outline6/7 |
| --- | --- | --- | --- |
| photographic `Ei` | 不额外enable | render | 不render |
| plan `bi` | 不额外enable | render | 不render |
| viewport `_i` | 临时enable | render | render |

主相机默认mask不含5，`Ti` 仅 includeEditorEntities 才 enable5，finally恢复旧mask。`Mi` 单独用layer3 overlay pass，`Ci` 才画选中/hover轮廓。拍摄 `Pn` 明确传 profile=photographic，并 `fO(workspaceHelperRoot)` 临时隐藏 helper root。因此拍摄排除**所有**相机body/frustum和编辑轮廓，不仅自己相机。plan排除同类编辑guide。bi是plan，不能误称director-frame专用pass。

### possession普通viewport的上游辅助体列表门禁

普通viewport仍走true/true/true，但摄像机possession有另一条明确的上游门禁，移除**全部director-camera辅助体**，而不是只排自身camera。这条证据来自传给 `OH`的列表，不能由photographic规则推导：

1. 源A `LU`（685130）存在possessedCameraEntityId时返回 `{kind:"camera",entityId}`。`NU`（685305；传入possession camera id=685849）将其作为controlSubject。
2. 源A686029：`E=x?.kind==="camera", C=y&&!E&&!u`，其中y是canEditSetup、u是panoramaEditActive。possession时E=true，C=false。
3. 源A686220：`P=useMemo(()=>v&&C?[...editableCameraStates]:[],...)`，v是canAuthorTemporal；687903返回 `presentedCameraStates:P`。possession时P=[]；同一C还让plan marker/path layers不再传入。
4. 宿主 `k$`（903712）在906518解构 `presentedCameraStates:we`，908524调用 `OH({cameraStates:we,...})`。`OH`（485428）将列表传入 `LH`（486420）。
5. `LH`按列表构建id集合，在486593执行 `for(const[id,helper] of helpers) ids.has(id)||(scene.remove(helper.root),helper.dispose(),helpers.delete(id))`。P为空时所有TH创建的camera root/body/frustum移出scene；选中id只控制样式，不是隐藏条件。

交叉检查：源A146736的 `qr`只有photographic才临时隐藏workspaceHelperRoot；普通帧149348仍调用 `qr(Me)`且未传photographic。它调用源B `_l`（41745），default profile="viewport"→`_i`（42650）；`Ti`（43712；enable5=43938）仍临时开启编辑实体层。接管的camera guides缺席由上述空列表产生，与拍摄的layer/profile排除相互独立；不能把接管标为photographic，不能泛化为所有普通预览或所有actor/prop编辑辅助体都被隐藏，也不能以render camera对象identity比较解释官方上游规则。

## Temporal 未实现时必须显式拒绝的入口

schema能读取 temporal 字段，不表示能采样／编辑 temporal。以下拒绝要同时覆盖UI与API/domain入口：

1. selectedTemporalKey、明确 time-key/key-id、camera track有任何keys时的接管写入；若保留只读 preview，不能提供可写HUD。
2. 播放、scrub、timeline camera settings、保存为key、插入/移动/删除key或track、轨迹编辑、录制、时间段导出；不能 silently fallback base。
3. “以当前视角保存key”与外部 caller传timeMs/selected key；pending key确认不足以实现 sampling/edit，禁显示假确认。
4. 接管过程中setup/source变化、readonly、camera失效：先结束旧session或明确拒绝；所有dirty写回要再校验同一setup/entity与owner fence。

base target允许摄像机无keys；有其他实体轨道但自身无keys时官方Kn仍是base，保守本地策略若拒整setup temporal须明确比官方更窄。同样baseline camera缺少官方UI支持，应拒而不是绕过editable作用域。

## 官方快门与历史照片／保存视图的边界

源A `w2`（189537）调用 `capture()`后，将 `{src,title:'3D world capture',aspectRatio}`交给 `exportToCanvas(...,{allowConcurrent:true,toast:false})`，最多5个 pending export（`ny=5`=189532）。当前快门直接加入画布；该函数没有追加 historicalPhotos 或 worldSpace.views。

源A `LS`（56055）序列化 legacy `capturedPhotos`，`Aj`验证加载数据；`historicalPhotos.load`（61666）是既有照片加载路径。源A明确的 `saveCurrentView` callback（277037，公开绑定281161）拒绝缺captureSetup或scene-baseline，独立调用 `qx`（245003）保存 camera、stage/setup和capture tags；shot view另加shot tag与active view。它们不能合并推断为快门的自动副作用。

源B `wl`（40167）clone光学camera，通过 `ii`（35118）以4096长边建立offscreen图像，`Qt`（34757）使用photo编码profile（JPEG quality .92）。本地PNG要求与native viewport截图是明确实现差异，不代表复现官方offscreen 4K细节。

## 本地 capture 路径与建议（不作为官方证据）

接入前本地快照（行号对应调研时，不表示当前集成完成）：

- `runtime.mjs:380 renderCapture` 已能 settle Gaussian，以指定camera绘制，检查sourceKey+entity camera identity+visible；withCaptureVisibility排helper，返回renderer DOM canvas。它不编码、入LocalAssets、不创建画布节点、不写capturedPhotos。
- `setCapturing(true)` 当前会 cancelControl('capture') 和清 navigationTransition；接入camera possession时需确认它仅冻结输入，不取消正在编辑的camera领域事务。
- `schema.mjs:337` 仅检查capturedPhotos为array；初态为空，未见V3拍摄append reducer。`entry.read()` capabilities仍read/select/undo，`entry.execute('capture')`显式拒绝；`studio.mjs`转发V3，不走旧版capture。
- V2 `scene-capture.mjs` 可参考 durable sequence：assertReady/flush→固定shot/revision→按真实aspect确定1280长边→真实render→PNG toBlob→LocalAssets.put→CanvasApp.createConnected→CanvasStore.flush；每await后检fence，flush失败报告applied/nodeId，不再造第二节点。它使用独立ShotRenderer，不能原样复用V3 runtime。
- app.js `CanvasApp.createConnected` 为现有入画布能力；`publishStudioV3`是有beforeCommit/ownership守卫的durable V3存储，不能直接写owner.studioV3 bypass。

最小capture合同：冻结当前live camera与ratio，固定owner/source/setup/entity/session/editEpoch，通过checkpoint提交需记录的live camera但不结束possession，再flush场景；真实渲染并在浏览器repaint前复制到独立canvas，按比例裁切有效画框避免黑边，PNG toBlob→LocalAssets→createConnected→受守卫保护的CanvasApp.saveProject。成功仅表示真实素材和图片节点已持久保存；在图片provenance记录source/pose/optics/setup/time，**不追加capturedPhotos，不自动保存View**。每异步段复验fence；关闭/切源/切setup/相机变化丢弃迟到结果。分阶段失败报告真实applied状态，重试复用capture/node identity，不重复图片节点。历史照片与明确的SaveCurrentView分别属于尚未交付的功能。

本地模块合同和专项验证见 [CAMERA-CAPTURE.md](../../src/features/studio-v3/CAMERA-CAPTURE.md)。模块测试不能替代真实浏览器拍摄验收；未接入时按钮须disabled／明确拒绝，不能仅toast“已拍摄”。只读预览不能拍摄，公开文档也明确如此。

## 证据索引

源A=`/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`，SHA-256 `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`，bytes919292、decoded chars917752。

| A符号 | offset |
| --- | ---: |
| op / FH / Kn | 488105 / 489295 / 487706 |
| E2 / GW / sD | 195115 / 282406 / 70784 |
| EV / RV / AV / kV | 560316 / 565818 / 567587 / 559966 |
| $n / Mf | 158107 / 158412 |
| ul / _n / ik / Pr | 245410 / 112874 / 252940 / 492075 |
| Q_ / eO / nO | 108291 / 108342 / 108653 |
| sV / wY / IE | 541713 / 870813 / 871537 |
| ih / w7 / fE / w2 | 770394 / 771332 / 772763 / 189537 |
| mg / lk / WW | 88039 / 272562 / 267540 |
| TH / camera it constants / optical Pn | 482553 / 482324（it=起点） / 154398 |
| Gn / qn(setCameraState) / km / Cm | 112311 / 152802 / 244016 / 244763 |
| Zn(focusAtScreenPoint) / PV / MV | 155998 / 567038 / 567317 |
| LU / NU / possession E/C gate / presented list P | 685130 / 685305 / 686029 / 686220 |
| k$ / OH / LH / helper removal loop | 903712 / 485428 / 486420 / 486593 |

最后一行 Pn 是callback局部名字，不是export；具体调用证据 `profile:"photographic"`=154468。camera constants证据 `frustumDistance:`=482347。

源B=`同目录/WorkspaceViewfinderButton-BHqIWibq.js`，SHA-256 `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0`。

| B符号／段 | offset |
| --- | ---: |
| pl / wheel handler / hidden handler | 20099 / 29215 / 32959 |
| ma / fn | 10374 / 10489 |
| Xl (A.SA) / zt (A.Xp) | 87562 / 76882 |
| mc / gc / Ln | 89183 / 90700 / 86876 |
| $l (A.xA) / vc shutter | 91314 / 91712 |
| Ei / bi / _i / Jt | 42184 / 42417 / 42650 / 42951 |
| Ti / Mi / Ai | 43712 / 44289 / 44390 |
| _l profile dispatcher / Ml(A.$t) | 41745 / 50519 |

源C=`同目录/world-object-spatial-metrics-B9CCwPzJ.js`，SHA-256 `921daef1e9d52eb5d7d4fe322c465dd9964b267ac6ca219e942876d385086564`；`const b=3,O=4,M=5` offset49，M=5 offset63；末尾export映射见原文件。

源D=`同目录/index-BsHyQ2qj.js`，SHA-256 `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4`。`FE=F("camera")`1247844；`doe=F("focus")`1344428；`yme=F("undo-2")`1578602；`Dh=F("check")`1259964。SVG数组都在同一声明前，不可用emoji替代。

源E=`同目录/course-api-base-url-CGXqZmAy.js`，SHA-256 `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca`。源A导入 `cm as PT`，对应源E `SLe`（1554494）；`Xz`（1561033）clone camera，camera.rotation channel=1557065，camera.lookAt channel=1557577。用于证明进入目标的领域采样路径，不作为运行验收证据。

公开文档：[创作文本与3D](https://docs.tapnow.media/zh/docs/canvas/create-text-and-3d)，本轮HTTP200、85754 bytes、SHA-256 `8ed53576f2cb08a60fccd13def3362c49f16cf7398be2cde2a8369fc7df741d2`。明确取景器→拍摄→直接成为画布图片；只读不能拍摄/从预览创建片场；预览/拍摄/进入片场本身不调用生成模型。文档自称只介绍画布核心入口，工作空间控件随内容/权限/版本变化；没有提供possession HUD顺序、ease、temporal edit或guide规则，所以这些只能归属安装包静态证据，不能归于公开文档运行验收。

## 最小验收清单

进入未动→无history且lookAt保留；只改FL/ratio→pose/transform/lookAt不变；WASD/拖动→真实camera光学位姿写回且lookAt清除；完成→一笔director undo且viewport复原；取消→领域与viewport均复原；空操作→无undo。切camera仍恢复最初viewport；旧lease无效不能覆盖新owner；blur/hidden→运动停止但编辑保留；finish失败→HUD/session保留。UI/API对有keys、baseline、scrub/playing的拒绝一致。拍摄另验真实photo、ratio、无所有camera guide/outline、失败无假节点及重试无重复。全部均需本地新证据；本文静态阅读不算通过。
