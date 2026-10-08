# Studio V3 俯视放置与轨迹补充合同 · 2026-10-08

本批静态交叉审阅，承接 [完整平面图合同](STUDIO-V3-PLAN-20261008.md)，只补角色入口、placement、最高支撑与曲线／关键帧／控制点语义。不执行官方 bundle、API 或浏览器；不修改实现／测试／其他文档，不提交。当前实现由其他 agent 并行修改，本文不提供实现完成或运行验收结论。

证据目录：`/Applications/TapNow.app/Contents/Resources/web/assets/`。A=`ThreeDWorkspace-BzPphAqB.js`；P=`WorkspacePlanView-HeQ7o6cq.js`；E=`course-api-base-url-CGXqZmAy.js`；G=`EnvironmentLightingPickerContent-CigxxFZu.js`；B（仅 Escape 优先级）=`WorkspaceViewfinderButton-BHqIWibq.js`。offset 用 Node `readFileSync(file, 'utf8').indexOf(symbol)` 核验，单位是 **UTF-8 解码后的 JavaScript string UTF-16 code unit，零基**。E 含一个补充平面字符，Python 字符索引在此之后会比 JS offset 少 1；不得将 Python codepoint 或字节索引混入本文。

## 入口应如何打开

| 入口 | 官方动作 | 精确证据 |
| --- | --- | --- |
| 底部“放置”plus | 无 selected entity 时显示；`Zt` placement=top/align=start/icon plus20，active=pending placement；打开共同添加菜单 | A `cameraSpatialPlacement:"ground"`@752736，上游条件@752384附近 |
| 已有角色 | 菜单按 characterRoles 真实顺序列 label 与16px色圆。选中构造 `{kind:'character-role',roleId,label}`，设置 `{kind:'actor',actor}`，关闭菜单，进入 pending placement | A `Ym`@549055、`pV`紧随其后；底部调用@752652 |
| 新建角色 | submenu `mV→Kk`：角色名自动聚焦、颜色 palette、“添加并放置”；Enter 可提交，trim 空名禁用／拒绝。先保存 trim draft 再走同一 actor pending placement | A `mV`@550796、`Kk`@367087、`Ym`@549055 |
| 颜色变化 | draft 设 `gender:'neutral'`、`asset:xo`，不是另一个“选择模型／性别”流程；仅修改名称保留其他 draft 字段 | A `mV`@550796 |
| 底部添加摄像机 | `cameraSpatialPlacement:'ground'` 的子项使用“选择地面位置”文案；选择后 pending `{kind:'camera'}` 并 close。baseline 禁用，显示独立状态说明 | A `Ym`@549055、底部调用@752652 |
| 俯视空白右键 | `S$` anchor=clientX/Y，estimated256×200，instantOpen；同一 `Ym` 的 cameraSpatialPlacement='here'。role/new-role/camera 直接在右键 point 添加，不再要求第二次点画面 | A `S$`@902848、`u4`@499128、`i4`@497200 |
| 以当前视角添加 | 先清 pending placement、打开 viewfinder intent=`create-director-camera`；确认时 `NH` 从可见相机姿态创建 camera，然后选择实体、关闭 viewfinder。不是菜单点击就提交 | A `Re` callback@530291附近、`NH`@487357、viewfinder confirmation@530526附近 |

新建 submenu 的尺寸 `Uk='w-44 max-w-[calc(100vw-16px)] overflow-x-hidden'`；共同菜单第一段显示 scene-baseline／independent-state 的 scope 文案。已有角色颜色圆不能用通用人物 icon 替换。上述字符 offset 的“附近”段只用于读上下文，不作为精确符号 anchor；表中的具名函数和完整 string anchor 是可机器复核项。

官方添加菜单还挂载 common props／generation。root本批范围为scope、已有role、新role/color与camera放置；props／generation另属P4。实现这部分不能宣告完整官方context menu已还原。

submenu A `Un`@347051 默认 `side='right'`：pointerenter立即开；button click toggle；pointerleave延迟180ms，若子菜单仍hover或含focus则保持；右侧chevron14。通过共享group互斥激活。`Un`本体没有ArrowRight handler，因此“向右展开”有布局／hover证据，没有以ArrowRight键作为此函数必需打开动作的证据。新role宽176px；camera等默认submenu用共享`wf`宽度规则。

## 放置与最高支撑

1. P surface pointerdown 先尝试 pending placement，再走 pan。placement 在 pointerdown 已开 `director.placeEntity` 事务，**没有普通 marker 的4px开启门槛**。`GC` 固定 start point；首次 preview 创建实体，随后 preview 只 rotateToHeading；commit 创建／旋转、commit history、markOwnedContent；cancel 回滚。无移动 click 在 pointerup 创建 heading0。E `wdt` 的默认 .05m 内朝向也回0；拖回 start 可回 heading0。
2. A `l4` 从 context resolveSurface `{kind:'top-down-support',groundY,fallback:'ground-plane'}` 解析，但有意只返回 `{x,z}`。A `xW`／`kW` 的领域创建再次通过真实 world surface 解析高度；已有 point.y 时 actor 使用该 y、camera 使用该 y+1.6m，缺省 y 时才取 support y。plan 正常入口去掉 y，因此不能把 projection-plane groundY 当最终高度。
3. G `ar` 合并 collider 与 surface meshes 的向下 ray 所有候选，过滤 world normal.y `<.65`，再取**最高有效 y**。ground 是没有有效 hit 时的 fallback；不参与 `max(groundY, hitY)`，所以有效低于 ground 的支撑仍是结果。
4. collider `cr`：更新 matrixWorld，以 collider bounds.max.y+10 向下发射，far=`max(1,height)+20`，`intersectObject(collider,false)`，需 face。mesh `lr` 同样以整体 bounds.max.y+10 发射，非递归 `intersectObjects(meshes,false)`。normal 用 `face.normal.clone().transformDirection(object.matrixWorld).normalize()`。
5. 未显式传 surfaceMeshes 时，G `Re→or→yn` 仅遍历 visible tree；有效 mesh 三角需 position／index count≥3，且 geometry.boundsTree 存在才收进候选，dedupe。显式传 surfaceMeshes 时 `lr` 直接用该集合。**普通 visible mesh 不自动等于可放置支撑面**；本地若没有官方 BVH adapter，可建立明确候选集合，但应注明这是实现适配，而不是声称官方无 boundsTree 门槛。
6. 普通 marker、key、endpoint、bend drag 是 preserve-depth。最高支撑只用于新增摆位等明确 placement 动作，不能让已有实体拖动自动跳台面。角色创建 pose='stand'；camera新建 position同时同步 transform与camera数据。

| 符号 | offset | 职责 |
| --- | ---: | --- |
| A `i4` / `GC` / `l4` / `u4` | 497200 / 498313 / 498905 / 499128 | 右键即时放置／pending placement事务／plan坐标转domain／pending与菜单状态 |
| A `sk` / `xW` / `kW` | 254779 / 254919 / 255465 | 最高支撑解析／actor transform／角色与camera创建 |
| E `wdt` | 1541369 | start→current heading；默认threshold .05m |
| G `Re` / `or` / `yn` | 52230 / 52265 / 52676 | 合格且可见surface mesh候选 |
| G `ar` / `cr` / `lr` / `Ri` / `Gt` | 53236 / 54076 / 54488 / 55005 / 55149 | 最高支撑／collider／mesh rays／最高y／world normal |
| G `const gn=10` | 52747 | rayMargin10、normalMinY.65、reference allowance.03 |

## 曲线 click、drag 与关键帧

| 手势 | 官方行为 | 证据 |
| --- | --- | --- |
| 曲线 click | nearest segment 按 **xz 距离**寻找；t≤.001选择 fromKey，t≥.999选择 toKey，且传 pointerdown event 的 client anchor；其余选 entity。没有插入新 key、curve history 或 bend 写入 | A `k4`@514298、`const pb=.001`@514284；E `rLe`@1546464 |
| 曲线 drag | P 至少 Euclidean4px 才尝试 drag session；在 pointerdown point 冻结 nearest segment与t；拖后改该 segment 的 bendConstraint(point,t)，不重新在移动point选segment | P `Ur`@43706、`ct`@6037；A `S4`@513707、`k4`@514298 |
| drag保护区 | hold 拒绝；nearest t≤.05或≥.95拒绝；离任一端点3D距离≤`max(distance(p0,p3),1)*.05`拒绝 | A `S4`@513707、`x4`@514124；E `$q=.05`@1544900 |
| 未取得drag session | 发生移动但 drag禁用／session未创建，pointerup 回落 curve click；pointercancel 不调用click | P `Ur`@43706 |
| hover曲线 | 非playing允许 hoverDraggable；surface先把 hovered path提升为draggable。selected entity 或 selected key同entity时常驻可拖；playing只有展示，controls隐藏 | A `_4`@520026；P hovered适配@49640附近 |
| key marker click | 先清 selected entity；首次选择key不给菜单anchor；已选择同key再次click才给client anchor。key contextmenu总给anchor | A `y4`@506429 |
| key marker drag | 普通marker4px门槛，选择该key，单一 `director.moveTemporalEntityKey` 事务；写position channel该key，不改base、不改key time；y保原depth | A `y4`@506429、`CW`@263558；P `zt`@43120 |

P `Ur` 与 `zt` 是不同交互协议：`zt` 未达门槛时不提交，由 marker click负责选择；`Ur` 未drag时自己调用 path pointerStart。不能把一次 path click当作“开始曲线编辑”事务，也不能用4px drag guard吞掉合法click。

key二次click／右键打开的完整descriptor来自A `e4`@494565：label=entity.label、icon='timeline'、一个edit group，**唯一动作“删除关键帧”**（D `index-BsHyQ2qj.js`的`"deleteKeyframe"`@9178504），id='delete-keyframe'，icon='delete'，danger=true，disabled=!onRemoveTemporalKey。没有rename、duplicate、insert动作。A `t4`选择key时同步playhead到该key.timeMs；删除source='director-action-menu'，成功清selected key并关闭placement/action菜单。不能把entity菜单的重命名／复制动作移植到key菜单。

key菜单A `V6`@753714 用 `B6={width:256,height:64}`@753674 估计定位尺寸、`H6={x:12,y:10}`@753699、z120、instantOpen。**256不是固定CSS宽度**：Xi内容默认B `_s`@61219的`w-max min-w-44 max-w-[min(20rem,calc(100vw-16px))] overflow-x-hidden`。共享F `ThreeDActivityOverlay-CIotE4kO.js` menuFill@408为radius18/borderwhite10/bg rgba(38,38,38,.5)/blur28/轻shadow，menuContent radius18/p1.5。删除row用`text-red-200`、trash18；共享Ve row min-height36px/gap10px/px10px/py6px/font14。本文是源码class合同，未测实际computed width。

plan bend右键的合同是立即调用resetCurve，没有reset弹层、菜单标题或“重置曲线”可见文案。此处不能借其他trajectory surface文案发明plan菜单。

E `rLe` 初选每段默认48份采样，然后非hold最近段以10轮三分细化；比较距离只看xz，返回nearest t与timeMs。A保护端点距离检查看xyz；两个距离维度不可混同。首尾click阈值.001与禁止curve-drag阈值.05也是两个不同常量。

## 追加：key glyph朝向与camera FOV编辑

**官方有key朝向拖把和camera key两侧FOV编辑。仅实现key位置与live camera FOV不足以称完整P2。** A `L4`@520867生成key markers：camera的yaw、fov、frameAspectRatio来自该key采样state；actor／prop为person／object且yaw来自该key采样transform。A `_4`@520026按selectedTemporalKey(entityId,keyId)设selected；camera同时showExtendedFov=true，非选中只显示短FOV。A `b4`@511959在selected key属于live camera时隐藏对应live FOV，避免重复。

P `Hn`不区分live/key，camera均用`ir`@15396，person用`er`@11210，object用`tr`@12865；选中且有rotate callback才激活direction handle。P `fr`@22676把yaw方向(sin(yaw),0,−cos(yaw))投影后旋转marker rotator。camera key选中且FOV未hidden时有左右`Et` handles，hit priority40；整个key layer priority45。FOV的4px门槛、固定对侧边、ratio转换、局部RAF preview、end提交{yaw,fov}、cancel恢复与live camera完全相同。不能只给key一个简化圆点丢失朝向和FOV交互。

| 编辑 | 官方key领域请求与事务 | A精确string anchor |
| --- | --- | --- |
| key方向drag | `director.rotateTemporalEntityKey`；camera patch=`{kind:'camera-framing',yaw}`；actor／prop patch=`{kind:'rotation',rotation:ba(kind,keyState.transform,yaw).rotation}`。方向距离<.05m返回null不写 | `b=C=>{if(m)return`@509671 |
| camera key FOV drag | `director.updateTemporalCameraKeyFraming`；patch=`{kind:'camera-framing',yaw,fov}`。同事务同时改yaw与FOV，不写live/base camera | `E=C=>{if(m)return`@510440 |

两类均先清selected entity、选定key，再以`zn`创建director事务，onBegin要求canEditDirectorEntity，playing拒绝，commit成功markOwnedContent，cancel回滚。请求固定 `{entityId,history:'external',source:'plan-view',target:{kind:'selected-key',entityId,keyId}}`，不得改成当前playhead time-key。

作者接口 A `WW`@267540 的editEntity→`fF`@208104：entity／setup／state不存在或locked拒绝；playing返回blocked；同entity selected-key映射key-id。`SW`@254451先确认该key仍存在，按其timeMs采样，再由`ak`@252003写回该key.timeMs；过期key不写。camera-framing由`ik`@252940同步transform.rotation.y、`xc(camera,yaw)`、ratio合法FOV及focalLength，其余pose/position/scale等采样字段保留。live marker则通过`Kn`@487706选择base／已有key／time-key；`Pr`@492075只对time-key影响需确认时走confirmation。这与已有key直接编辑是不同边界。

本地adapter还应冻结stage/setup/entity/key identity，readonly、scrubbing、key删除或scene切换时取消；这些是既有领域边界的接线要求，不能据官方callback省略guard推断本地可绕过它们。验收必须包括：actor／prop key旋转；camera key方向；camera key左右FOV各保留对侧边；base与其他key位置/optics不变；一次undo；playing/locked/deleted-key拒绝；scene switch/pointercancel不残留。

## 首末 endpoint、bend 与30px proxy

1. A `w4` 只处理 `draggable===true` 且 cubicSegments全部startMs/endMs finite的路径。过滤hold后，每段生成bend；position为既有 bendConstraint.point 或曲线 `Dl(segment,.5)`。start endpoint是非hold首段p1，end endpoint是非hold末段p2。它们是曲线切线控制点，不是fromKey/toKey位置。
2. bend marker drag冻结该段 `bendConstraint.t??.5`；curve本身drag用初始nearest t。A `yF` 持久写 segment transition.spatialBend(point,t)，clamp t=.05..95；point.y有传值则使用，否则保现有bend.y，再否则p0/p3按t插值。不移动p0/p3，不用bend替换p1/p2。
3. endpoint drag写整个track `pathEndpointControls.start/end.point`，保另一个endpoint。缺省y保已有endpoint.y；否则取整个displaySegments首段p0→p3的1/3或末段2/3插值y。E `tLe` 只把这些 authored endpoints 应用到整个sorted key序列第一段p1／最后一段p2。
4. E 路径渲染为base cubic `Kq`加bend delta：`delta=constraint.point-Kq(segment,tConstraint)`；t≤tc时权重=`smoothstep(t/tc)`，t>tc时=`smoothstep((1-t)/(1-tc))`，smoothstep(u)=u²(3−2u)。保证curve在tc穿过constraint point，首末key位置不动。playhead采样另做弧长映射；不能仅画折线或拿bend点当Bezier控制点宣告curve一致。
5. P `hr` 对path-control仅在距离**最近anchor** `<30px`时推出30px。bend anchors=[p0,p3]、fallback=p3；start anchors=[p0]、fallback=p3；end anchors=[p3]、fallback=p0。距anchor不足.5px时用另一anchor／fallback方向，再不足.5则向屏幕右方。画connector，proxy只影响显示和命中，不改world点。
6. P `zt(preserveTargetOffset=true)` 保存pointerdown world与真实control world之差，所有drag点加相同偏移，防proxy→real位置跳变。正常key drag不加这个proxy偏移。
7. bend contextmenu解析db id成功后立即resetCurve并markOwnedContent；endpoint id不符合db，故无reset行为。A `bF` reset仅移除该segment transition，保track endpointControls。controls click空处理，不能点一下就开启history。

| 符号 | offset | 职责 |
| --- | ---: | --- |
| A `w4` / `k4` / `C4` | 512569 / 514298 / 516165 | controls生成／手势回调／非hold对应segment解析 |
| A `gF` / `yF` / `bF` / `kF` / `ao` | 210914 / 211278 / 211846 / 214606 / 214930 | endpoint写入／bend写入／reset／endpoint默认y／坐标保y |
| P `hr` / `zt` / `Ur` | 26560 / 43120 / 43706 | screen proxy／marker/control drag／curve click-drag分流 |
| E `eLe` / `tLe` / `Xc` / `hLe` / `pLe` / `CF` | 1544951 / 1545519 / 1548530 / 1549916 / 1550072 / 1551007 | curve组合／endpoint应用／取curve point／bend delta／权重／bend t clamp |

存在源码边界：controls展示过滤hold后选首末，但endpoint storage与E应用针对整个key序列首末；首尾为hold时两者可能不同。本文确认两侧代码，未运行官方case，不能自行推断官方会把track endpoint转移到首个非hold段。实现应保留此差异并用明确case验收。

## 菜单、放置与退出

- A `Yt`@487042仅clearSelectedAction+closePlacementMenu；`cb`@486964才另clearPathControl+stopPlacement。菜单关闭不能等价为退出俯视，也不能把所有dismiss都当取消placement。
- 空白右键在已有pending placement时拒绝开菜单；正常开菜单清selection。placement成功／失败完成回调会清menu和pending mode，并保存new-character draft供下次使用；cancel pointer事务仅rollback，不负责自行清pending mode（Escape由placement handler处理）。
- A注册menu Escape@686729附近、placement Escape@687646附近、plan Escape@687384附近。B `ga`@10774定义menu400、placement300、planView240、selection200。高优先级先消费：菜单关闭，随后pending placement取消，随后俯视返回现场；不能一次Escape越过仍打开的菜单直接onSet。
- A `Gt`@533630 在contextMenu打开时只`Yt`并return true；placement handler只setPlacementMode(null)。plan返回时P active=false/unmount取消window pointer session，`$n`@6106按pointerId且capture监听，end/cancel先解绑再回调；不能让取消后迟到pointerup提交。
- selected key/editable entity还需playback/scrubbing、readonly、locked、stage/setup identity与history-busy门禁；领域拒绝时不伪造成功。path controls preview/end/cancel一条director事务，`zn`@505126 commit仅成功时markOwnedContent，cancel回滚。

## 本批执行验收与既有缺口

建议最小有判别力的case：底部role/new角色pending→click与drag；右键role/new角色即时添加；baseline camera禁用；独立camera点击support+1.6；最高台面／倾斜normal<.65／有效support低于ground／无eligible mesh四种surface；旋转zoom后的proxy30px拖动不跳点；path click没有history或新key；curve端点.001选择与.05保护区；key drag仅改key位置并undo；bend versus endpoint写入差异；hold首末边界；菜单→placement→plan逐层Escape；pointercancel／scene change回滚。

本次读到的并行实现快照已出现`plan-placement.mjs`、`character-menu.mjs`、surface最高支撑与plan path入口；这些文件正在修改，不能把它们存在当作入口接通或验收完成。需要root另行确认入口挂载、history回读、持久保存以及curve数学仍与本合同对应。读到的`plan-view.mjs`旧分支曾在未drag的path pointerup调用openEdit，已通知负责agent按官方click选择语义纠正；本文不对随后代码状态作未核验判断。

静态核验只确认上述官方符号与合同；没有官方GPU/render/浏览器行为、菜单计算样式、provider/API可用性或本地运行结果。
