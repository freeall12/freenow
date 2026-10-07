# Studio V3 实体菜单与状态操作契约 · 2026-10-08

结论：实体菜单依照callback资格显示动作；相机与角色／物体的菜单不同。基线实体删除是全局删除，独立状态的局部实体删除只移除该状态的state/track，失去所有引用后才回收definition。删除最后一个独立状态允许执行，随后补一个空默认状态。克隆状态会克隆局部实体、角色定义及关联views，保留track/key IDs。本文件只记录官方安装包静态证据，未执行bundle、未改代码／测试、未做CUA或浏览器验收。

## 实体菜单标签和资格

`Hk` 是底部「更多操作」按钮，top/start锚定、icon18、button36。`Am` 是共享内容；`U6`（director bottom）、`_7`（scene baseline bottom）、`V6`（director pointer）决定传入callback。不能单凭entity.kind给所有按钮相同资格。

| 顺序 | 翻译key | English fallback | 官方中文 | 显示／禁用条件 |
| --- | --- | --- | --- | --- |
| 1 | `world.object.name` | Name | 名称 | 始终是input；非一个Rename菜单项 |
| divider | | | | 始终存在 |
| 2 | `world.object.focusAction` | Focus | 聚焦 | 有onFocus；director仅actor/prop，camera省略 |
| 3 | `world.object.controlCharacter` / `controlObject` | Control character / Control | 操控角色 / 操控 | 有onEnterControl；actor/prop，director camera省略 |
| 4 | `world.object.snapToFloor` | Drop to ground | 落到地面 | 有onDropToGround；actor/prop，camera省略 |
| 5 | `world.object.resetPlacement` | Restore placement | 恢复初始摆放 | 有onResetPlacement；actor/prop/camera均可 |
| divider | | | | 上述四项至少一项有callback才呈现该组与divider |
| 6 | `world.object.duplicate` | Duplicate | 复制 | Am始终呈现；调用onDuplicate；caller须提供有效callback |
| 7 | `world.object.lock` / `unlock` | Lock object / Unlock object | 锁定 / 解锁 | 有onToggleLock；`ko(entity)`仅actor/prop；`animated && !locked`禁用 |
| explanation | `world.object.animatedCannotLock` | Objects with animation cannot be locked | 有动画的对象不能锁定 | 禁用lock说明；无快捷键；已locked即使animated仍可unlock |
| divider + 8 | `world.object.remove` | Remove from scene | 从场景移除 | 有onRemove才显示；红色；**Am直接执行，没有确认popover** |

`Am`名称编辑：初始entity.label；trim后非空且变化才onRename；空值恢复原label；Enter blur触发保存；Escape还原label并skip下一次blur提交；IME `ja(event)`期间不处理Enter/Escape。选择普通动作 `Ve` 默认closeOnSelect=true。

### caller矩阵

| caller | 列表资格 | camera | actor/prop | 锁定与visible |
| --- | --- | --- | --- | --- |
| 基线sceneLayout `_7` | `eW.items`来自editablePropStates + editableActorStates，`tW`只actor/prop；asset-backed selection列表 | 不在该sceneLayout菜单中 | Name/Focus/Control/Drop/Restore/Duplicate/Lock/Remove callback均提供 | 下拉列表允许选locked对象；菜单没有「locked就隐藏所有动作」规则 |
| director bottom `U6` | 当前plan list actor/camera/prop | Name/Restore/Duplicate/Remove；无Focus/Control/Drop/Lock；另有color控件 | Name/Focus/Control/Drop/Restore/Duplicate/Lock/Remove | `animated&&!locked`只禁用Lock；其他限制由操作层决定 |
| director pointer `V6` | menu.id必须匹配selectedEntity.id，否则不渲染 | Am无onRemove，仍有Name/Restore/Duplicate；G6另呈现Remove | Am无onRemove，仍有Name/Focus/Control/Drop/Restore/Duplicate/Lock；G6另呈现Remove | 避免Am和G6重复放两条Remove |
| temporal key pointer `e4` | 选中真实temporal key | Delete keyframe | Delete keyframe | 仅删key，不是实体Remove |

`Am`没有Hide/Show或visibility checkbox；`r4/Wd`构建plan选择列表以entity kind与有state映射为条件，没有按`state.visible`筛掉。`pl`也没有visible filter。渲染隐藏与菜单可选是两层，不得把「隐藏」自动等同不存在／不可删除。此结论不代表所有场景marker都显示：例如camera preview另检查visible。

`Et = ko(entity) && !!locked`影响scene直接选择／聚焦／pointer context（例如`q5`场景路径用z(entityId)拦截），但Object下拉可选locked实体、显示lock badge。`Am`本身不把Focus/Control/Drop/Restore/Duplicate/Remove随locked禁用。`ZC`在**非base temporal编辑目标**且locked时拒绝transform/pose。`setEntityLocked`检查readonly、canEditSetup、actor/prop、stage一致、值变化；上锁额外要求全worldSpace.setups中无该实体任何有key的track（`Ul/R2`），解锁允许。Lock字段是entity definition属性，非独立state字段。

菜单外仍应遵守readonly/gallery/viewfinder/panorama/placement/playback/scrub策略。`removeSelectedEntity`和director remove callback在playing时拒绝；`Wn`同时排除playing和scrubbing。菜单显示规则不意味着绕过runtime gate。

## Remove：全局和局部不能混用

`sceneLayout:eW.C`使用`scenePlayActions.entities.remove(id)`→`Qc`，是全局删除。

`removePlanEntity:kW.x`先 `wy({ entityId, requestedSetupId: requested ?? getEditableSetupId(), worldSpace })` 决定真正owning setup：

```js
// 原始 wy 的核心条件；requested setup通常是active edit setup。
return setup.entityStates.some(state => state.entityId === entityId)
  ? setup.id
  : isSceneBaseline(setup)
    ? null
    : sameStageBaselineContainingEntity?.id ?? null;
```

- requested独立state包含自己的entityState：`removeFromSetup(id, ownSetupId)`→`m1`删除该state的entityState与owner track。
- requested独立state只从baseline继承实体：wy回落到baseline，m1检测baseline后调用Qc全局删除；不是仅隐藏当前state。
- m1发现其他setup.entityState、其他temporal owner track、任意view.sourceCameraEntityId仍引用实体时，保留entity definition；否则调用Qc回收。
- requested entity/setup不存在、stage不一致或无自己state时保持数据不变。

`Qc`全局级联：移除entity definition；所有setup.entityStates对应记录和temporal owner tracks；其他剩余state的lookTarget若指向删实体则kind:none、heldEntityId若指向它则undefined；删sourceCameraEntityId匹配的views及source.id引用这些views的outputs；清references里的该entity targets及对应view targets；activeViewId被删时null。Qc本身没有顺便删除characterRole definition。

### 删除确认弹层的准确范围

- **普通实体More actions / director pointer Remove**：`Am/Ve`和`e4/G6`直接onRemove，无确认popup。统一新增实体确认属于本地设计补充，不能说是官方原样。
- **Camera manager shot card**：`y6/b6`先确认；`gS` top/end offset8、width min(280px,100vw−24)。标题`world.director.shotManager.deleteConfirmTitle`：`Delete "{{shot}}"?` / `删除“{{shot}}”？`；说明`The related camera and animation will also be deleted.` / `关联的机位和动画也会一并删除`；按钮Cancel/取消、Delete/删除。删除disabled=busy||temporalPlaybackPlaying；当前possessed camera必须成功exit后才deleteShot。
- **State row**：下节独立确认；不要拿shot wording替换state wording。

## State删除、最后一项与完整级联

`wp`只将activeStage内**独立state**列入菜单。基线不提供delete row。`N7`的delete icon先打开`gS` top/end offset6，minimum width min(288px,100vw−16)，`F7`内容radius10/bgwhite7%/padding10。标题`world.states.deleteConfirmTitle`：`Delete "{{label}}"?` / `删除“{{label}}”？`；说明`Also deletes its characters, objects, cameras, and animation` / `同时删除其中的角色、对象、摄像机和动画`；按钮`world.states.keep` Keep state/保留状态，`world.states.delete` Delete state/删除状态，高32。

Confirm前`wp.w`取消placement并退出相机scope；confirm调用removeSetup(targetId)，markOwnedContent，关闭确认／菜单。没有最后一个state的disabled条件。

`bj`删除算法按最终worldSpace执行：

1. 目标setup不存在或kind为scene-baseline：原对象返回，不变。
2. 从setups移除目标。同stage剩余独立state若零，则`Sv({stageId:target.stageId})`补一个新的空默认独立state；否则fallback=同stage剩余独立state原数组第一项。基线保留。
3. 原始短片段（变量名沿官方，`Fe`=isSceneBaseline，`Sv`=默认state factory）：

```js
const r = e.worldSpace.setups.filter(w => w.id !== n.id);
const o = r.filter(w => w.stageId === n.stageId && !Fe(w));
const a = o.length === 0 ? Sv({ stageId: n.stageId }) : null;
const i = a ? [...r, a] : r, s = a ?? o[0];
```

4. 删除`view.setupId===target.id`的views；outputs删`source.id`在这些view IDs集合中的记录。若删除的是activeSetup，activeStageId=fallback.stageId、activeSetupId=fallback.id、activeViewId=null；否则只在activeViewId指向删view时置null。
5. candidate实体IDs = target.entityStates实体IDs ∪ target.temporal.tracks owner实体IDs。逐个检查**删除后的**其他setup.entityStates、其他temporal owner track、remaining view.sourceCameraEntityId；仍被任一种引用则保留，否则Qc全局回收。不能把所有目标state实体不分来源全删，因为baseline和其他state可能仍引用。
6. candidate角色IDs仅来自**原worldSpace**中candidate实体的roleId；删除后仍有entity.roleId引用则保留该definition，否则删除。其他与目标state无关的unused角色定义不做批量清理。
7. references保留对象本体，只filter targets：setup target排除删除setup；view target排除步骤4视图IDs；entity target仅保留步骤5后存活entity IDs；其他kind原样保留。
8. `bj`不修改UI entitySelection。workspace effect在selected entity已不属于current plan时clear；wp提前清placement／camera scope。数据算法应保持UI清理与history事务可追踪，不将UI字段混入worldSpace。

`course-api Sv→dM`生成kind=independent、empty entityStates/tags、label="State 1"、createdAt/updatedAt=now。id由`lOe(stageId)`给定（默认stage是setup:state-1，其他stage采用`setup:${stageId}:state-1`），并非bj随机uuid。UI `N0/zU`显示中文“状态 1”。

## State Clone：完整复制合同

`wp.E`允许克隆inactive独立state：先清placement/scope，再`cloneEditableSetup(row.setup.id, {activate:true,label:t('world.states.copyName','Copy of {{label}}',{label:row.label})})`，markOwnedContent、close menu。中文label为`{{label}} 副本`。baseline不可clone； API不传label时沿用源label。

`hj`不只是复制entityStates：

1. 确认source独立state、新setupId不重名。所有新ID使用调用方createId（默认uuid）且检查与既有ID冲突。
2. local entity候选 = source.entityStatesIDs ∪ source.temporal.ownerIDs，**排除同stage baseline所有entityStatesIDs**。仅对同stage候选existing entities生成新entity ID。
3. 对候选实体使用的同stagecharacterRole definitions生成新role IDs。深拷贝roles/entities，更新id/time并remap entity.roleId；实体label保留原label（不是加Copy），locked、asset等通过structuredClone保留。
4. source.setupId下所有views复制，new view IDs/new setupId/time；sourceCameraEntityId映射到克隆相机（无映射时保留原引用）；camera.focus(object)/lookAt(entity)的entity ID同样remap。
5. source setup整体structuredClone，所以planDrawing、tags等其他state字段保留；替换id/label/time。entityStates只保留能找到local entity映射的记录：remap entityId/lookTarget(entity)/heldEntityId/camera.focus/lookAt，updatedAt=now。
6. temporal整体deepclone，track只保留owner实体可映射的项；remap owner及channel values里的look-target、camera-focus(mode:object)、camera-look-at(mode:entity)、entity.heldEntityId(text)引用。无映射的引用保留原ID。
7. **Sj没有重新生成track/key/channel IDs**；这些ID通过deepclone保留，在新setup作用域内继续使用。
8. 原worldSpace角色/实体/views数组append副本，再`_S`添加setup并按activate激活。不复制outputs或worldSpace.references。基线实体不克隆、继续共享，clone state自身也不存baseline state快照。

## Restore placement与Drop

「恢复初始摆放」中文容易误导：官方目标不是creation initialPose字段，也不是从baseline snapshot恢复。

- `la()`是`structuredClone(em)`，identity = position(0,0,0)、rotation(0,0,0)、scale(1,1,1)。baseline `eW.k`对当前setup调用updateTransform(identity)。
- director `d4.y` actor/prop调用`lb({initialTransform:selectedState?.transform, transform:la(),selectedTemporalKey})`；initialTransform是**当前编辑事务的起始值，用于commit/cancel/undo**，恢复目标仍identity。lb通过temporal-aware editTransform.tryBegin应用base/key目标，不能把selectedState initialTransform误当永久创建pose。
- camera `kW.b`重置transform position(0,1.6,0)、rotation0、scale1；保留现有camera optics，camera.position同步，camera.rotation xyz0/orderXYZ。没有camera state时用current navigation camera optics作为fallback。
- lock会限制非base temporal变更；菜单仍可显示Restore，执行权限以runtime为准。

Drop只actor/prop有callback。baseline `eW.v`与director `kW.E`走`hn(kind,storedTransform)`→`qS`→`Ta(kind,result)`；director先检查canEditDirectorEntity，再将结果交给temporal-aware transform编辑流程。以下为静态官方源码证据，未执行官方bundle。

**坐标转换**：workspace import `hn=c4`→course `Hq`，`Ta=cl`→`ZOe`。二者对prop都直接返回原transform；对actor都调用`Uq`，只替换rotation为`xF(rotation)`，position/scale不换单位或原点。`xF(r)=vF(r,-hE(r))`，`vF`第二参是**目标heading**，`HOe(current,target)=wrap(target-current)`；不是增量，也不是去除heading。`hE`将局部forward `(0,0,-1)`经Euler quaternion旋转后投影到XZ，用`atan2(x,-z)`取heading；`vF`以绕世界Y的quaternion左乘原姿态，再按原Euler order（缺省XYZ）返回。该转换把heading目标设为原heading的负值，不能用`rotation.y=0`或直接逐轴取反替代。

**包围盒与采样**：`ZS`暂存object position/rotation/scale，应用传入transform后求值，finally恢复原姿态并updateMatrixWorld。`Xc`→spatial metrics export `r`→`z`→`c`计算世界AABB：优先采用skinned mesh对象boundingBox或geometry.boundingBox并乘matrixWorld，合并非空bounds；无结果时回退Box3.setFromObject。这里不是脚点、模型原点或旋转后的局部OBB。`c`的traverse仅跳过当前node.visible=false的node，不能推断其会剪掉整个不可见父节点分支；support mesh收集的可见性规则另见下文。

- 非空bbox的**五个**XZ采样点依次为中心、`(min.x,min.z)`、`(min.x,max.z)`、`(max.x,min.z)`、`(max.x,max.z)`。中心是主点，四角传入samplePoints；referenceY=`bbox.min.y`。
- 无renderable object或bbox为空时，只有transform.position的XZ主点，referenceY=`transform.position.y`。
- `qS`最终仅改Y：有bbox时`newY=oldY+targetY-bbox.min.y`，否则`newY=targetY`。X/Z/rotation/scale在qS层保留；没有地面法线对齐、平均高度或多数采样点表决。

**支撑候选与高度选择**：workspace `Bh`是EnvironmentLightingPickerContent export `o`→`Ma`，规则为：

```text
candidates = [ground-plane(center.x, groundY, center.z)]
           + all accepted collider/mesh hits at center and four corners
preferred = candidates where hit.y <= referenceY + 0.03
target = highest(preferred), or lowest(candidates) when preferred is empty
```

因此没有`maxY`输入或无条件“取最高表面”。`referenceY+0.03`是优先筛选阈值，不是严格高度上限：ground也高于阈值且其他候选均不符合时，fallback可把物体向上抬到最低候选。`Ri`/`ur`分别以严格`>`/`<`比较，等高时保留先出现候选（ground先于射线命中）。五点命中共用同一个候选集合，单个角上的较高支撑就可能决定整物体的目标Y。

`Ai`对每点合并collider `cr`与mesh `lr`的**全部**命中。两路都从对应世界bbox的`max.y+10`沿`(0,-1,0)`发射，near=0、far=`max(1,bboxHeight)+20`；collider用intersectObject(collider,false)，mesh用intersectObjects(meshes,false)。无face命中忽略；face.normal用命中对象matrixWorld的transformDirection后normalize，默认仅接收`normal.y>=0.65`。它不是沿物体底部往下的一条短射线，也不使用相机高度偏移。

`Re`→`or`以`yn`递归收集surfaceObjects中**整个可见分支**的mesh，按对象identity去重；几何index.count或position.count至少3且geometry.boundsTree存在才加入候选mesh。几何有效但缺boundsTree会置complete=false并跳过，Ma只取meshes，未消费complete。这条筛选不等于所有可见对象均可支撑；collider路径独立，未证明同样应用yn可见性剪枝。

**自排除与边界**：两种caller都传`getSurfaceObjects([entityId])`，先排除本实体；qS再filter `surfaceObject!==object`排除同一renderable root。qS没有向collider传实体排除ID，因此尚不能仅凭该函数保证collider中没有本实体烘焙几何。尚未验证boundsTree构建时机、运行时collider内容、模型足底与AABB的视觉差异或斜面/薄片的运行表现；源码算法不能替代这些场景的视觉验收。

Drop补充证据（原始解码JS string的零基字符offset）：

| 文件／symbol | Character offset | 作用 |
| --- | ---: | --- |
| ThreeDWorkspace `qS` / `ZS` / `g_` | 93067 / 94594 / 94789 | Drop、临时姿态、五点采样 |
| EnvironmentLightingPickerContent `Re` / `or` / `Ti` / `yn` | 52230 / 52265 / 52550 / 52676 | 支撑mesh与可见分支 |
| 同文件 `rn` / `Ma` / `Ai` | 52773 / 53498 / 53866 | ground、优先高度策略、两路命中 |
| 同文件 `cr` / `lr` / `Ri` / `ur` / `Gt` | 54076 / 54488 / 55005 / 55077 / 55149 | 射线、最高／最低、法线 |
| course-api `HOe` / `hE` / `vF` / `xF` | 1541334 / 1543842 / 1543893 / 1544056 | 目标heading转换 |
| course-api `Hq` / `ZOe` / `Uq` | 1544423 / 1544467 / 1544512 | hn／Ta actor转换 |
| world-object-spatial-metrics `c` / `z` | 1134 / 1744 | 世界AABB计算与导出 |

SHA-256：EnvironmentLightingPickerContent-CigxxFZu.js=`b9b06fd215e4a951798c1b88e32842fe71aac5a94f57f7128d5eaf6aa8f9d8e8`；world-object-spatial-metrics-B9CCwPzJ.js=`921daef1e9d52eb5d7d4fe322c465dd9964b267ac6ca219e942876d385086564`。course-api与ThreeDWorkspace hash见下方Source证据。

camera没有Drop菜单action，`resolvePlanEntityDropTransform`也拒绝camera；不应提供camera Drop再补y=1.6的假官方行为。相机的1.6m属于Add at ground和Restore位置逻辑。

## Add camera：默认视角与放置位置

`Ym`：cameraPlacementAvailable=setupContext.canAuthorTemporal；baseline为disabled Add camera，说明`world.stateRestrictions.camera`：Select or add an independent state before placing a camera. / 请先选择或新建独立状态，再添加摄像机。独立state下Add camera为子菜单：

- bottom Place (`cameraSpatialPlacement=ground`)：Choose ground position / 选择地面位置，进入camera placement mode。
- scene right-click (`cameraSpatialPlacement=here`)：Place here / 放置在此处，使用该surface hit。
- 两种都还有Create from current view / 以当前视角添加，调用Re，**先打开viewfinder用于调整／确认**，不是立即执行entity add。

Re检查Wn（非playing/scrub）与canAuthorTemporal，清placement，然后`ui.openViewfinder('create-director-camera')`；Ae确认仅当该intent有效，执行NH、选择new entity、closeViewfinder；Escape在该intent对应viewfinderCommit优先级也调用Ae，即确认当前视角。

`NH`用director.addEntity history transaction调用addDirectorCameraFromCurrentView，无entity/commit失败cancel。`kW.P`将`getVisibleCameraState()`转成`_n`→normalize camera，**取当前渲染可见pose**，不是保存的home view或另一个setup.camera：

```js
const D = $t(_n(getVisibleCameraState()));
const transform = {
  position: { ...D.position },
  rotation: Hc(D.rotation),
  scale: { x: 1, y: 1, z: 1 }
};
return addCamera(D, transform);
```

`_n`复制position/rotation/fov/frameAspectRatio，focalLength由fov+ratio换算；从depthOfField传aperture/mode，focusPoint→point focus，否则正有限focusDistance→distance focus。保存camera使用当前完整姿态，entity transform.rotation用Hc转换（course ct→QOe→xF，`xF(rotation)=vF(rotation,-hE(rotation))`：把目标heading设为原heading的负值，按世界Y旋转后保留原Euler order；不是去除heading，也不能简单将rotation.y取反）。不能把两个rotation字段混为一个。new entity label是`Camera ${sameStageCameraCount+1}`，kind=camera，同activeStage/editSetup，color按ID；setupState visible:true。

`addDirectorCameraAt({point,yaw=0})`另一路：若point.y存在就用它，否则support查询得到groundY；position.y=surfaceY+1.6；transform.rotation(0,yaw,0)；optics继承getCameraState()，camera.position按新位置替换、rotation转换，默认yaw0。不能说该一路复制当前view位置；两条菜单动作的数据来源不同。

## Source offset与中文翻译证据

所有offset为原始UTF-8文件被解码为JS string后的**零基字符offset**，不是byte offset。Readable行号仅辅助查阅ignored研究副本。

| ThreeDWorkspace symbol | Character offset | 作用 |
| --- | ---: | --- |
| `Am` | 362360 | entity shared content |
| `Hk` | 362096 | bottom More actions |
| `_7` | 788010 | baseline caller |
| `U6` | 755091 | director caller |
| `V6` | 753714 | pointer caller |
| `e4` | 494565 | pointer entity vs key menu |
| `eW` | 240653 | baseline global remove/reset/drop |
| `Qc` | 17611 | global cascade |
| `m1` | 18840 | local remove and orphan collection |
| `wy` | 255184 | owning setup resolver |
| `bj` | 46838 | delete state and fallback |
| `hj` | 44528 | clone state |
| `Sj` | 48889 | clone temporal without ID reissue |
| `vj` | 48561 | clone entity-state references |
| `xj` | 49204 | clone channel entity references |
| `OS` | 49727 | clone camera references |
| `la` | 92898 | identity reset |
| `qS` | 93067 | drop support and self exclusion |
| `kW` | 255465 | camera add and plan entity operations |
| `d4` | 500645 | temporal-aware UI operations |
| `NH` | 487357 | camera from view history |
| `Ym` | 549055 | placement menu |
| `wp` | 791261 | state callbacks and labels |
| `N7` | 795073 | state delete anchor |
| `F7` | 796993 | state confirmation |
| `Ul` | 196470 | animation lookup |
| `R2` | 196573 | lock qualification |
| `ZC` | 534785 | temporal transform gate |
| `_n` | 112874 | visible camera serialization |

Course-api：`lOe` default state ID offset1527115；`mdt` isSceneBaseline offset1527170；`dM` default independent factory offset1527648 (`bI as Sv`)；`cOe` independent schema offset1527397；`dOe/gdt`baseline state merge（baseline IDs优先）offset1527746（gdt offset1527957）；camera rotation `QOe` offset1544870、`Wq` offset1544842、`xF` offset1544056。

| 中文key（world下） | 精确值 | Character offset |
| --- | --- | ---: |
| `moreActions` | 更多操作 | 9161656 |
| `name` | 名称 | 9161730 |
| `focusAction` | 聚焦 | 9161241 |
| `controlCharacter` | 操控角色 | 9160776 |
| `controlObject` | 操控 | 9161344 |
| `snapToFloor` | 落到地面 | 9160838 |
| `resetPlacement` | 恢复初始摆放 | 9161318 |
| `duplicate` | 复制 | 9161146 |
| `animatedCannotLock` | 有动画的对象不能锁定 | 9160928 |
| `remove` | 从场景移除 | 9161260 |
| `remove` | 移除图片 | 9168713 |
| `lock` | 锁定 | 9160685 |
| `unlock` | 解锁 | 9161742 |
| `deleteConfirmTitle` | 删除“{{label}}”？ | 9164099 |
| `deleteConfirmTitle` | 删除“{{shot}}”？ | 9164646 |
| `deleteConfirmDescription` | 同时删除其中的角色、对象、摄像机和动画 | 9164310 |
| `deleteConfirmDescription` | 关联的机位和动画也会一并删除 | 9164875 |
| `keep` | 保留状态 | 9164359 |
| `copyName` | {{label}} 副本 | 9164254 |
| `cameraFromCurrentView` | 以当前视角添加 | 9174622 |
| `cameraChooseGroundPosition` | 选择地面位置 | 9174656 |
| `cameraPlaceHere` | 放置在此处 | 9174856 |
| `sceneBaselineScope` | 添加到场景基准，在所有状态中共享。 | 9174815 |
| `independentStateScope` | 仅添加到当前状态。如需在所有状态中共享，请切换到场景基准。 | 9174926 |
| `addCamera` | 添加摄像机 | 9174795 |

| 原始source | SHA256 |
| --- | --- |
| ThreeDWorkspace-BzPphAqB.js | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| course-api-base-url-CGXqZmAy.js | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| index-BsHyQ2qj.js | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |

静态读取已交叉核对UI callback、domain纯函数与中文资源，不运行官方bundle。范围只新建本文；未加入任何production dependency。
