# Studio V3 镜头管理、View 与历史照片合同 · 2026-10-08

本轮仅静态阅读安装包官方 JS。未执行官方 JS、未调用官方 API、未使用浏览器／CUA、未修改 production 或 tests、未提交。本文描述源码可证明的行为，不构成本地实现或官方运行时验收。所有 offset 均为 **UTF-8 解码后 JS string 的零基字符 offset**，不是 byte offset。

## 结论

三个对象不能混用：`View` 是状态内保存的相机领域快照；镜头管理是由 `shot` View 与摄像机实体派生的列表；历史照片是已有图片的只读兼容集合。当前拍摄直接添加画布，不追加历史照片，也不自动保存 View。已找到 `saveCurrentView` 与 `ensureIndependentShotViewFromCurrentCamera` 的领域能力，但未找到本版本 UI 调用，不能据此添加“保存 View”按钮并标为官方还原。

镜头管理缩略图是临时渲染与缓存；导出是另一条生成资产与添加节点的流程。缩略图 ready 不证明画布资产已保存；官方导出返回 boolean，也不证明服务端持久保存。宿主若增加 durable save、receipt 与重复提交防护，需作为本地增强单独验收。

## 证据文件

目录：`/Applications/TapNow.app/Contents/Resources/web/assets/`。下列字节数和 SHA-256 已在本轮重新读取原文件核验。

| 代号 | 文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| A | `ThreeDWorkspace-BzPphAqB.js` | 919292 | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| B | `WorkspaceViewfinderButton-BHqIWibq.js` | 99329 | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` |
| D | `index-BsHyQ2qj.js` | 12943515 | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| E | `course-api-base-url-CGXqZmAy.js` | 3444954 | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| F | `ThreeDActivityOverlay-CIotE4kO.js` | 5521 | `2c4c2f2137cb343da081df58245c214fe7ad262341e0f0f024277ed5174ee933` |

## View 数据与保存能力

A `qx`（245003）返回：

```js
{
  id, stageId, setupId, sourceCameraEntityId, label, camera, notes,
  referenceIds, tags, durationMs, generationContext, createdAt, updatedAt
}
```

缺省 `referenceIds=[]`、`tags=["capture"]`；createdAt 与 updatedAt 同为 now。camera 的画幅在 `frameAspectRatio`。没有独立 View revision、图片资产、像素尺寸、照片 sequence 或拍摄时刻字段。`Em`（244933）直接返回 view.camera；`nW`（244964）只替换 camera 字段。

A 277037 的 `saveCurrentView` callback：无 worldSpace／无 captureSetup／scene-baseline 则返回 null；否则 UUID、`_n(getCameraState())`、缺省 `View ${views.length+1}`，执行 `views.save(qx(...))` 后同步返回 ID。该 callback 没有直接 readonly 判断，也没有 await durable save。A 277362 的 ensureIndependentShotView callback 使用缺省 `["capture","shot"]`，调用上述保存后 setActive。

保存来源不是 Three 相机当前可见插值：A `_n`（112874）把 engine optical state 转为领域 position／rotation／fov／frameAspectRatio／焦距／光圈／焦点／DOF，不含 lookAt。engine 的 `Tn`（151796）getState 在正在进行 transition 时返回目标 pose/fov，`jo`（152525）getVisibleState 才读取当前 Three camera；saveCurrentView 绑定的是 getState。源码不能证明保存瞬间总等于屏幕可见过渡帧。

在安装包 assets 中，以上两个能力名仅在 A 声明／导出，未定位 UI 调用。领域可调用不等于已存在可见入口。

| 操作 | 领域约束与结果 | A offset |
| --- | --- | ---: |
| save reducer `aj` | 重复 ID no-op；setup 存在且非 baseline，stage/setup 匹配；追加并激活 view/stage/setup | 39692 |
| patch reducer `ij` | 按 ID 合并 patch，updatedAt=Date.now | 40038 |
| remove reducer `sj` | 删 View、其 source output、view reference targets；清同 ID activeView | 40211 |
| setActive `cj` | null 清 active；非 null 须 View/setup 存在且非 baseline，切 active stage/setup/view | 40592 |
| rename callback | readonly／空白／未变／不存在返回 false；trim 后 patch label | 277496 |
| remove callback | readonly／不存在返回 false | 277696 |
| restore callback | 以存储 camera 做 .8 秒 animated camera change，并 setActive | 278339 |

`He`（20647）领域 mutation 增加 dirtySeq/contentDirtySeq；成功接收领域写入与服务端 durable 保存是两件事。

## 镜头列表的派生合同

A `SK`（701015）只遍历当前 stage 的非 baseline setups，先用同 stage 的 baseline 与独立 setup 做有效状态合并 `Av`。每个 setup 的结果为显式 View 在前、未被链接占用的隐式 camera 在后。

显式镜头：同 stage/setup，且 `rW`（245344）要求 tags.includes("shot")，按 createdAt 升序、相同则 ID localeCompare（`CK` 702129）。只有 capture tag 的 View 不进入列表。若 sourceCameraEntityId 在有效 setup state 有 camera，镜头使用该 camera 覆盖 View 存储 camera；否则仍用 View camera。显式分支未做 visible=false 或实体 kind=camera 的过滤，不能擅自把这两个过滤写成官方显式 View 合同。

隐式镜头：`EK`（702212）找同 stage、kind=camera 的定义，排除已被显式 View 链接的 camera ID，按定义 createdAt/ID 排序；有效 setup state 必须有 camera 且 visible!==false。`RK`（702654）构造 ID `implicit-camera-shot:${setup.id}:${entity.id}`、tags=["shot"] 的临时 View 描述符，不执行 views.save。时间来自 max(entity/state/setup.updatedAt)，均零时有 Date.now fallback。

统一描述符包含 `id/index/source/stageId/setupId/setupLabel/title/kind/view/camera/cameraEntityId/durationMs/entities/setup`；source 为 `view` 或 `camera`。显式标题优先 View label，隐式优先 entity label，空则 Shot N。无实体链接的显式 View 可以在列表出现，但 jump 与隐式实体改名路径会抛 missing-linkage 错误；未见自动创建 camera 或使用导航视图替代的 fallback。

### 动态判定与时长

A `Y0`（703148）：必须有 camera ID，且有效 setup state 中同 ID 有 camera；然后对**整个 setup.temporal**调用 `XT`，不是只读该 camera 的轨道。XT 为 E 的 `kdt`（1552497）。

E `vT`（1551211）只保留 owner.kind=entity 且非空 entityId 的 tracks；`Ex`（1551416）将数字 key.timeMs 做 max(0,round)，按时间去重。`yLe`（1552636）只统计被 channel.values.keyId 引用的 keys，排序其时刻。`bLe`（1552218）在无有效 key 或只有一个 0ms key 时返回 null；只有一个正时刻 key 也有非 null duration。kdt 对所有 tracks 的非 null duration 取 max。顶层 temporal.durationMs 不决定 XT 结果。

因此一个静态 camera 所在 setup 若有其他实体有效动画，Y0 也可能把它分类 dynamic。Y0 对非 null 值做 max(0,round)。官方这一规范化链没有全面 finite 校验；本地拒绝 NaN/Infinity 属于边界增强。显式镜头在 static 时可保留 View.durationMs，descriptor 只接受 finite number，否则 null；dynamic 使用 Y0 结果。

显示元数据又是另一个判断：A `E6`（740800）使用 camera 自身轨道 `qT(rt(temporal,cameraId))`。它可能显示静态焦距，尽管 Y0 将导出分类为 dynamic。焦距优先 camera.focalLength，否则用 fov/ratio 换算；finite positive 四舍五入，否则“—”。秒数整秒显示整数，其他保留一位小数。

## Jump、改名、删除与历史事务

A `p6`（727003）jump 要求 cameraEntityId，且 entities 中有 kind=camera 定义。setup 不同则依次 `placement.cancel()` → `$n(runtime)` 完成当前 possession → `setActiveSetup(shot.setupId)`，随后 `op({entity,initialCameraState:Gn(shot.camera),onSelectEntity,runtime})`。这个切 setup 分支未检查 $n 返回值。它是切换状态并进入摄像机接管；不是单独调用 restoreView。

`p6→op`（488105）与 `WH`（489676）不检查visible，E2（195115）也没有visible门禁。BW的 `U`（274976）是当前**原始setup local**实体ID集合；`z`（275391）从采样W.cameraStates按U过滤，279594返回 editableCameraStates:z，没有按visible过滤。因此本地独立setup中隐藏camera的显式View可走官方jump；本地 requiresVisible 是额外限制。shared-baseline camera虽然可经initialCameraState进入低层E2，E2 effect（196067）发现camera不在editable local列表会退出，不能以列表可见推断可稳定作者接管基准摄像机。

QK rename（719330）trim，空／未变／不存在拒绝；source=view 调 renameView，source=camera 调 renamePlanEntity(cameraId,label,setupId)。实体 rename 修改全局 entity definition label，不是独立 setup 的局部 label。

QK delete（719600）playing 拒绝。先收集选中显式 View（若有）与**选中 setup 内所有链接同 camera 的 Views，不限 shot tag**，逐个 removeView，再 removePlanEntity(cameraId,setupId)。UI 若删除当前接管 camera，必须 $n 成功退出后才继续。

`wy`（255184）解析实体修改目标：请求 setup 自己包含实体则使用该 setup；请求独立 setup 无实体时，可回落到同 stage baseline 中的实体。`m1`（18840）对独立 setup 删除状态和该实体 temporal tracks；其他 setup／track／剩余 linked View 仍引用时保留定义，否则走全局 `Qc`。若解析到 baseline，直接 `Qc`（17611）全局级联：删定义、所有 setup 状态／轨道、所有 linked Views 与对应 outputs/references，清 activeView，也清其他状态指向该实体的 lookTarget/heldEntityId。这是源码现有共享基线语义，不能把“只删当前独立状态”写成所有情况的保证。

`dw`（720380）把 rename/delete 包在 director history：begin → mutation → commit/markOwnedContent；无变化、失败或异常 cancel，异常重新抛出。事务保护领域状态，不覆盖后续的资产上传与画布节点写入。

## 镜头管理 UI 与关闭生命周期

A `mY`（864312）readonly 时 center actions 为 null；directorPlan 与 activeSetup 存在，且 camera role 为 null 或 director-camera-possession 时才挂载 manager。viewfinder／camera-key-edit 不挂载该入口；actor/prop entity-control 分支也不显示常规 manager。不能仅以低层 QK 可调用推断 readonly UI 支持这些写入。

A `m6`（727910）normal 模式“镜头管理”，标题旁“导出到画布”进入 batch；batch 模式“批量导出”，旁“全选”。没有镜头显示“暂无镜头”。状态组标题经 `R6→N0`（688075），trim 后识别 Example State／Default Setup／Setup N／State N；中文分别“示例状态”“状态 {{index}}”，空值“未命名状态”，R6 明确 isSceneBaseline=false。

rename 用本地 input，下一 RAF focus/select。blur 提交；Enter 提交、Escape 取消，先 stopPropagation，IME guard `!ja(event)`。删除采用独立 anchored `gS` popover，anchorRef=删除按钮，placement=top、align=end、offset=8，宽 min(280px,100vw−24px)，onRequestClose 清 confirmation。提示“关联的机位和动画也会一并删除”。

| 状态／动作 | 源码行为 |
| --- | --- |
| 打开 | controlled open；`modal:false`；仅 open 时启动 thumbnail 工作 |
| Escape | panel priority；依次清 delete confirm → 取消 rename → 退出 batch → 关闭 panel |
| onOpenChange(false) | setOpen(false)，清 batch/selection、rename、delete confirm |
| exporting | trigger、jump、rename、checkbox、footer 动作 disabled；delete 还受 playing 禁用 |
| exporting 时 Escape／outside | m6 Escape 没有 busy 判断；onOpenChange 没有 busy 判断；dv 没有显式 onInteractOutside 拦截。未证明存在导出期间拒绝关闭门禁 |
| 导出点击 | p6 要先完成 possession；成功后把选择暂存，effect 等 possession=null 才开始 QK export |
| batch 生命周期 | onExport 同步返回 true 后立即退出 batch/清 selection；不等渲染或画布添加成功，失败不自动恢复选择 |

A 739339 footer 中的 onExport 为 `n(selected)&&exitBatch()`；这里 `n` 是 p6 包装后的同步 boolean callback，异步任务归 QK 管理。关闭 manager 不等于 QK task 已取消；QK cleanup 随 node/stage/activeSetup source key 改变而 abort 旧 task。

### 官方视觉数值

| 部位 | 数值／class；出处 |
| --- | --- |
| popup | min(560px,100vw−24px)，max-height min(620px,100vh−112px)，上方12px，align=center、collisionPadding12；A m6 |
| surface | F panelProminent：radius16、bg-popover/50、blur56、white14 border；m6 另加 border-0 与 `0 8px 28px rgba(0,0,0,.24)` shadow；z81 来自 B floatingPanel。class 合并后的最终边框需运行时验证 |
| header | min-height56；gap8；px16/pb8/pt12；title16px semibold leading24 white92；A h6 731251 |
| body/group | pb16/pl16/pr8；thin stable scrollbar white14；group pt20，首组0；h3 mb8、14px semibold leading20 white72；A g6 732146 |
| grid/article | auto-fill minmax(156px,1fr)、gap12；article bg-white/3.5、hover7、radius8（B Ol 56590）；A y6 733162 |
| thumbnail | 按有效 camera ratio，fallback16/9；image object-contain object-top；loading pulse；error“预览不可用”；A nf 738496；无 retry 按钮 |
| title/metadata | wrapper px12/py8；title行28px、14px medium leading20 white90、actions占位pr56；metadata12px leading16 white42 |
| checkbox | 隐藏真实 checkbox +右上18px圆、top/right8；选中white/black，check12px stroke2.5 |
| footer | border-top white10；px12/pb12/pt8；inner gap4；A w6 739339 |
| delete confirm | p12；title14px medium leading20 white92；description mt4、12px leading20 white55；buttons mt12、gap8；A b6 737564 |

图标：trigger clapperboard20/stroke1.75；导出 file-export16/1.9；rename pencil14/1.75；delete trash-2 14/1.75；rename 保存 check14/2。header 不放重复 manager 图标。

## 缩略图：signature、独立 renderer 与释放

A `o6`（721266）fingerprint=`JSON.stringify([d6(runtime),shot.id,shot.cameraEntityId,shot.camera,f6(shot)])`，cacheKey 加 nodeId。`d6`（725441）包括有效 stage、world source/meta、environment、ground、lighting、actor/prop 定义／资源、baseline states；`f6`（726287）保留镜头 setup 中有关 actor/prop/camera 状态和 temporal，剥离 state.updatedAt。不使用“照片 revision”。camera pose/fov/ratio/焦点/DOF 改变会改变 signature，旧 URL revoke、移除缓存、重新渲染。

只在 panel open 开始工作。优先当前 possessed camera，其次 active setup，再原始顺序；逐镜头 serial await render，各自更新 ready/error。失败继续后续项。cleanup abort，dispose adapter；unmount revoke 所有本地 object URLs。全局 Blob LRU：96 项／16 MiB，超大单 Blob 不入 cache。没有 View 或 durable image 写入。

`a6`（723476）以 `z0(shot,0,{strictTemporalCamera:true})` 采样，无 camera 时使用 shot.camera fallback。尺寸 `i6`（724266）按 camera ratio 等比适配 **320×180** 包围框，宽高至少1；合法正 finite ratio，否则16/9。首选 snapshot 独立 renderer `$0`，不修改 live viewport。独立 renderer 初始化／渲染失败后，仅 active setup 可回落 `sceneBridge.renderDirectorFrameBlob`；inactive setup 没有 live fallback，报 preview unavailable。

独立 renderer 的源链：

1. `Q0`（714950）structuredClone worldSpace、views、environment、source/meta、selected setups；thumbnail quality=preview，导出 final。
2. `X0`（708288）：empty/mesh-preset 可用；world-asset 需 `YK(meta,quality)` 有可渲染资源 URL。
3. `_K`（705445）新 canvas、新 Three scene、新 WebGLRenderer，antialias、high-performance、pixelRatio1；`$0`（708256）构造。
4. `LK`（708597）加载 snapshot world、actor/prop、skybox/HDR；world-asset final 优先 full_res，preview 优先100k，兼容另一档。
5. renderFrame 根据 sampled camera 创建输出相机，应用 actor/prop 状态，missingState=hide-renderable，调用 photographic pass，finally 恢复临时状态。资源 graph 不构造 director camera 编辑辅助体。
6. dispose abort prepare、释放 Spark／资源／WebGLRenderer、清 scene。初始化不等于图片已产生；每张必须 await renderFrame/encode。

通用 `nh` 返回 Blob 则 passthrough，canvas 默认 image/webp quality .82（A `const BU` 688503）；live fallback 返回值由宿主 encoder 决定，不能保证每张 thumbnail 必为同 MIME。

## 导出：渲染、上传、应用与失败

A `QK`（715938）快照所选 groups，默认 final，建立 AbortController。跨 setup 导出要求 eligible independent renderer（X0 与 t6）；不满足显示“动态镜头仅支持从当前状态导出”。标题 `S01 title`；分组 `${setupLabel} · ${镜头素材后缀}`。

`TK`（703474）对 groups/shots **逐个 await resolver**，收集成功资产与失败原因；普通失败继续，abort 抛出。全部渲染结束后，`PK`（704346）仅一次调用 exportGroupsToCanvas，空成功集不添加。QK rendering 全失败、添加失败、部分 render 失败有不同 toast。UI 不能把 collecting／rendering／adding 阶段标为已保存。

| 导出类型 | 官方数值与边界 |
| --- | --- |
| static still | A K0（699608）=`fS(16/9)`；B ii（35118）、st=4096 → **4096×2304**。这是固定输出尺寸，非 thumbnail 的 camera ratio 包围框算法 |
| dynamic video | A pK（698541）缺省 fps30、1280×720；按采样领域相机渲染。实际时长 max(1,durationMs??3000) |
| codec capability fallback | A bK（700115）仅 B0 判定的 unsupported capability error 才回落 XU（691387），缺省6张采样帧拼图；一般渲染错误仍失败 |
| 图像适配 | F0 对目标框做中心 cover；尺寸与画幅不等价，不能仅凭 camera.frameAspectRatio 宣称导出像素比同画幅 |

B `Tl`（45854）是画布 export adapter：过滤无 blob/src 项，active=false／无内容／不允许并发且已有任务则 false。groups `Promise.all`，每组 items `Promise.allSettled(Fi)`；即 **渲染串行，上传并行**。单项上传失败被计数，成功项继续。blob 经上传，data URL 经上传，普通 src 直接使用（`Ui` 48732）；`Fi`（48467）创建 image/video node。

所有 upload/node 构造完成后 await commitTail，检查 mounted active。成功 groups 经 `Wi`（48113）布局：单组单项可直接节点；多项或多个 groups 使用 grid group，padding40、nodeSpacing30、组间距72。位置在源节点右方避让已有／reserved nodes。然后依次一次 `addNodes(allNodes)`、一次 `addEdges(source→groupOrSingle)`，返回 true。

返回只含 boolean，没有 applied node IDs、receipt、服务器 save 结果或 rollback。upload 部分失败保留成功节点；若 addNodes 成功后 addEdges 抛错，catch false 且没有补偿，源码结构上可能留下已添加节点，但本轮没有运行触发此错误。QK 调 adapter 时 toast=false，QK 的成功计数是 render 成功数量，不能视为每个 upload 均成功。宿主实现 idempotent receipt/durable save 时需显式区分 rendered、uploaded、applied、saved。

## 历史照片：数据、持久化与相册

A `v1`（22081）只提供 loadHistoricalPhotos setter，未找到追加／改名／删除命令。`Aj`（56262）加载字段：id 必须 string、src 必须非空 string；sequence/width/height 数字否则0；source 只认 camera/possession/panorama_edit/entity_control，否则camera；cameraState 原样通过。`LS`（56055）序列化 id、四舍五入 sequence/width/height、source、src、经 Mj optical normalization 的 cameraState。

该集合不含 photo cameraId/setupId/viewId、revision、拍摄 timestamp、asset receipt 或 provenance schema。本版本把它作为只读兼容数据展示，但不能仅凭集合名证明每张照片都来自某个旧版本。当前 ScenePlay 保存 envelope 仍包含 capturedPhotos（Oj），load 从 server state.capturedPhotos 还原；不能写成“只存 legacy archive”。另一路 legacy-world materialize `T9`（837315）显式创建 capturedPhotos=[]。

当前 shutter `w2`（189537）capture→exportToCanvas，无历史集合 append。`CE`（856200）只在 items 非空显示“历史照片”入口，tooltip 说明新照片直达画布。

`S2`（191498）reverse 原数组（不是按时间或 sequence 排序），打开 index=0；空集合自动关闭，index 越界向内 clamp。打开时 acquireRenderPauseLease，关闭释放。此暂停不等于相册有独立 renderer；相册只显示既有 src。

A `yk`（313641）是 img-based gallery，`pk` 取 src??localSrc；无相机重渲染、asset生成、View写入、图片 onError fallback 或 retry。role=dialog、aria-modal=true，close button autofocus；未见 focus trap 保证。左右／上下键导航并 clamp，Escape关闭，忽略 INPUT/TEXTAREA，未见该键处理器的 IME/contenteditable guard。背景 button 与 close button 关闭；closeRequestId 变化也触发关闭；once guard 后160ms退出（$W 312977）。缩略图栏160px，按原图比例算高，缺省76；主图 max-width=100vw−220px，按 viewport留白限制高度。

中文 notice（D 9170567）：“以下历史照片仅供查看。新拍摄的照片会直接添加到画布，不再保存在片场中。” 不应新增历史照片删除、rename、重新渲染或上传按钮并称为官方相册能力。

## 保存与关闭边界

A `Xj`（60861）保存当前 ScenePlay 和兼容照片集合：readonly／无 canvasId／初始化失败拒绝；active domain transaction 推迟；sessionToken+worldNode owner fence，serverVersion/if_match_version乐观并发。autosave500ms；retry1s/3s/8s，耗尽 saveStatus=failed。返回 View ID 或 canvas export boolean 都不是这些保存阶段的凭证。

A `_D`（82403）workspace close 按 save blocker 判定，saving/failed 可出现“仍然离开”确认；A bR callback（305123）因 shutter capture pending 拒绝整个 workspace close并提示等待。这个 shutter gate 不等于 manager QK exporting 门禁，也不能推导出 manager popup exporting 时不能关闭。

## 本轮验证范围与后续验收

本轮已重新核验官方文件 hash、关键 function offset、字段与条件分支；只对本研究 Markdown 做格式检查。未执行官方 JS/API、未做 official UI 交互／截图、未测试 WebGL/codecs、未测服务器保存／网络失败／应用后异常，未评价并行实现的测试结果。

本地验收应分别覆盖：shot-only View过滤与隐式去重；baseline继承与删除级联；jump切setup及接管；signature随pose/optics变化刷新；inactive snapshot失败无live冒用；serial render→一次canvas apply；render/upload部分失败；apply后save失败receipt重试；export期间panel关闭；历史图只读与新capture不追加。这里列的是需要验收的边界，不代表已经通过。
