# Studio V3 导演时间轴合同 · 2026-10-08

本轮仅静态阅读已安装 TapNow 源码和本地领域模块，新增本文。未执行官方 JS、未调用官方 API、未使用 CUA、未修改 production/tests、未运行测试、未提交。本文不构成官方或本地运行时验收。offset 均为 **UTF-8 解码后 JS string 的零基字符 offset**，不是 byte offset。

## 结论与范围

官方可见时间轴是底部胶囊中的**单个当前目标轨道**：播放、循环、标尺、匀速重新分配、保存关键帧、删除所选关键帧、时长／删除轨道菜单。没有找到全实体轨道表、独立关键帧属性弹窗、easing 下拉或可见录制开始／停止入口。`liveRecord:true` 是相机会话能力声明，不能当作定时录制 UI 的证据。

普通编辑按 `base → selected-key → time-key` 目标规则落地；有有效同实体选中 key 时，选中 key 优先于播放头。没有轨道 keys 时，即使播放头非零，普通编辑仍是 base。显式“保存为关键帧”直接插入；普通编辑在非 key 时间创建 key 才请求确认。camera possession 与 timeline-settings 通过同一个相机编辑会话实现这些目标，不能用 View 保存、照片或视频导出代替关键帧写入。

轨道与时长属于独立 setup 的领域数据，进入当前 setup 撤销历史。播放头、播放／拖动、循环、面板开关为临时状态；未找到持久保存它们的证据。采样与作者提交必须分开，采样结果不能覆写 base。

## 证据文件

目录：`/Applications/TapNow.app/Contents/Resources/web/assets/`。字节数与 SHA-256 在本轮重新读取核验。

| 代号 | 文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| A | `ThreeDWorkspace-BzPphAqB.js` | 919292 | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| B | `WorkspaceViewfinderButton-BHqIWibq.js` | 99329 | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` |
| D | `index-BsHyQ2qj.js` | 12943515 | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| E | `course-api-base-url-CGXqZmAy.js` | 3444954 | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| F | `ThreeDActivityOverlay-CIotE4kO.js` | 5521 | `2c4c2f2137cb343da081df58245c214fe7ad262341e0f0f024277ed5174ee933` |

## 真实入口与目标选择

A `lY`（858538）保留本地时间轴开关。入口要求非 readonly、存在 temporalBlocking、`setupContext.canEditSetup`、gallery 关闭、非 panorama 编辑、workspace 模式、无实体操控或是 director 实体操控。入口的可用性另由 `chrome.available` 判断；基准 setup 可以编辑，但不能 author temporal，仍可能看到禁用入口。失去可用性会关闭开关并调用 `onTimelineInteractionChange(false)`。

A `hY`（867588）入口显示“时间轴”，aria 为“打开时间轴”／“关闭时间轴”；正常 tooltip“编辑关键帧和动画时长”。基准禁用说明：

> 场景基准不包含时间变化。请在底部「状态」中新建或选择独立状态后制作动画。

A `gY`（868328）仅在 timelineVisible 与 temporalBlocking 存在时挂载 `x7`（773280）。x7 组合可选 optics 行和 `k7`（774080）。`zV`（575797）按 controlled entity → director selected entity → selected key entity 选择匹配 stage 的 actor/camera/prop；已有 track 则取该 track，否则存在可编辑实体状态时用 `pending:${entity.id}` 空轨道。没有目标仍可播放／定位，保存 key 禁用。时间轴不是全部 entities 的列表。

zV 返回 `onCameraSettingsToggle` 能力，但整个安装包 assets 静态搜索只有该导出位置，未定位 `.onCameraSettingsToggle` 消费者。不能从能力导出推导可见设置按钮。possession 相机仍可使用已有 optics HUD。`liveRecord` 全包只在 A 能力区域出现五次；`recordCameraState` 只见领域导出与 EV 调用；`recordEntityState` 只见领域导出。现有证据不足以声称连续采集摄像机移动并按时间自动录制。

## 官方视觉数值与图标

A `Vn` → B export `W=cs`（57410）→ B `Eo` → F export `d=X`，F X class 字符串起点1656：`pointer-events-auto flex h-12 items-center rounded-full p-1 ${f.bar}`。这是48px高、4px padding、圆胶囊；不是 panelProminent 的16px radius。

| 部位 | 源码数值／class | 证据 |
| --- | --- | --- |
| 胶囊表面 | border white10；rgba(38,38,38,.5)；blur28；shadow `0 4px 8px rgba(0,0,0,.04)` + inset `0 .5px 0 rgba(255,255,255,.12)` | F f.bar，X |
| 时间轴胶囊 | width min(92vw,640px)，max-width100%，mr−12px，gap2px，pl6px，overflow visible | A k7 774080 |
| 入场 | fade + translateY12px；delay180ms、duration280ms、fill both；reduced-motion关闭 | A k7 |
| 测试版 badge | absolute top−8/right12/z10；border white12、bg rgba(38,38,38,.92)、white72、shadow-sm、blur-md | A k7；字号来自共享 Xw，未在此强推 CSS 计算值 |
| 播放按钮 | h36/w36/minw36，mr6、fullround、bg white10→16、text white88→white；play图标向右1px | A k7 |
| 其他按钮 | h36/minw36、px0；常规white72→white；删除red200/80→red100；首key保存gold82→gold | A k7 |
| 标尺容器 | relative，min-width148px、flex1；左右有效轨道inset18px | A k7；常量759802 |
| 标尺线／刻度 | baseline y33/h2；tick y17/w1；label/major/minor/micro高度9/6/5/3px | A g7 766936；常量759802 |
| 时间标签 | y4、字号9px；密度依有效宽度选择 | A g7；e7 758616 |
| 关键帧 | top33；hit20px；普通圆8px、选中12px；gold #f0d887；连接段h2 | A d7 759861 |
| 播放头 | gold #fbbf24、竖线2px、hit16px | A b7 769035 |
| 时长菜单 | placement top、align end；触发h36/minw36，ellipsis19/stroke2.25；增减项closeOnSelect:false | A Y6 756235 |

标尺 `e7` 用候选间隔 `[50,100,250,500,1000,2000,5000]` ms 和 micro2.5/minor8/major18/label56px 密度阈值；`q6=420` 为默认宽度。最后 endpoint 总有标签，不能仅用固定秒刻度代替。

| 控件 | A alias → D export → 图标定义 | 尺寸／stroke |
| --- | --- | --- |
| 时间轴入口 | QI → mU → Mb，chart-no-axes-gantt；D1258750 | 18／2 |
| 播放／暂停 | vI→kj→Lue，play D1470865；wI→kX→Zde，pause D1459343 | 19／2.35 |
| 循环关闭／开启 | xI→mt→fHn，Tabler repeat-off D4642701；SI→kI→LWe，repeat D4643138 | 18／2.25 |
| 匀速重新分配 | kI→mu→nse，gauge D1358876 | 18／2.2 |
| 保存关键帧 | dr→hm→qE，plus D1471714 | 19／2.35 |
| 删除关键帧 | Ra→l_→_B，trash-2；D1571922为名称字符串起点 | 18／2.2 |
| 时间轴操作 | $w→l$→i8，ellipsis D1314838 | 19／2.25 |
| 缩短时长 | bI→hk→cB，minus D1432048 | 18／默认 |

## 编辑目标与创建确认

| 解析层 | 行为 | A offset |
| --- | --- | ---: |
| UI `Kn` | 同实体有效selected key优先；无keys→base；播放头精确key→selected-key；其余time-key | 487706 |
| authoring `fF` | playing→blocked；显式base→base；无setup→blocked；time/playhead target取非负round毫秒；同实体selected→key-id，异实体selected→playhead；resolve context.active才落playhead，否则base | 208104 |
| 隐式意图 `Pr` | 仅actor/camera/prop的time-key检查创建影响 | 492075 |
| 影响 `uW` | 同时刻key／track存在性；requiresConfirmation=`!track || !key`，记录willCreateTrack/key | 246203 |
| 确认 `Km` | ID含entity/time；新track“开始时间轴？”，已有track新key“创建关键帧？”；创建／取消callback；pending返回false | 523356 |

确认说明：“将 {{label}} 在 {{time}} 的状态保存为关键帧。”`K4` 将时间格式为 `(round(ms/100)/10).toFixed(1)+"s"`，始终一位小数。取消必须撤销待创建编辑，不能保留未确认的key或把预览写回base。

zV 的显式保存 `R→C→$H` 直接请求插入，成功后markOwnedContent并选择新key，没有经过 Pr/Km。新增轨道的第一颗显式key同样不是每次强制确认。base普通编辑由既有实体／相机base路径处理；WW temporal editEntity对base target返回false，不负责base更新。

## Key、channel 与曲线作者合同

领域形态是 `setup.temporal={durationMs,tracks}`；track含 `id,owner:{kind:"entity",entityId},keys,channels`，可有 `pathEndpointControls,segments`。channel以property标识，values引用keyId并携带 `{kind,value}` 和可选 `interpolation`。key time是毫秒；不能把View或shot descriptor用作track。

| 操作 | 已证明的行为 | A offset |
| --- | --- | ---: |
| 创建／更新 `Qx` | 同实体track写入；duration至少existing、key time、3000ms；新temporal默认3000ms | 246444 |
| 同时刻保存 `hW` | 重用同time key，去同ID／同time重复，按时间排序；camera清entity.rotation channel，写gW自动快照 | 248795 |
| 删除 `fW` | 删除key与其channel values，空channel、相邻segment；随后清理孤立数据 | 247438 |
| 移动 `pW/tk` | 保留ID／values；限制prev+1ms／next−1ms，首min0，末max(duration,原time)；非finite输入保留原time | 247871／248455 |
| 清理 `nk/rk` | 无values引用的keys、空channels／tracks、无效segments清理；首末key变化时去相应endpoint control | 251127／251507 |
| 编辑 `ak/SW` | 先在目标时间采样再patch，已有key覆盖，无key创建；base取base，不将采样保存为base | 252003／254451 |
| 删除轨道／时长 | WW入口在playing拒绝，按独立setup mutation；时长至少1000和全部keys最大time | 267540／272475 |

A `gW`（249236）自动快照规则：所有实体保存position、scale、visibility（hold）；非camera保存rotation；actor存在pose时保存pose（hold）。camera保存rotation、focalLength（缺省由fov换算）、数字ratio（hold）、存在focus/lookAt/DOF（hold）、数字focusDistance/aperture。**不会自动保存entity.lookTarget或heldEntityId，不自动写camera.fov**，虽然这些属性有schema channel。缺失条件字段也未见主动清除该key原有channel value。

`linear|hold` 是channel采样语义，没有证据支持ease-in/out presets。position linear仍使用邻接曲线、endpoint、spatialBend和弧长时间，并非所有段都直线。

插入位置key时，`bm`（210392）在现有段中用弧长重映射参数 `IT` 定位；`ek`（246884）仅无同time key时拆段；`wF`（212160）要求插入后邻接关系一致。`py`（213701）对旧曲线左区间中点 `split*.5`、右区间中点 `split+(1-split)*.5` 取point，两段各写`t=.5` bend constraint。这不是保存精确De Casteljau控制点，不能声称整个曲线形状严格不变。

匀速重新分配：`ck/OW/LW/NW/FW`（265822／266072／266261／266626／266940）要求至少3keys和至少2个可重新分配的移动段。使用实际曲线长度分配移动段原总时长，hold／零距离段保留原时长；每段至少1ms，余数按largest remainder分配，保持首末时间跨度。不是给用户选择easing。

## 指针、键盘与结构编辑门禁

`d7`：左键down开启 `onKeyMoveStart` 同步事务并capture；位移**大于4px**才拖动；RAF合并preview，邻接range clamp；seek使用nonanimated/scrubbing且保留selected key。up移动则onEnd+viewing seek，未移动则cancel；pointercancel回滚事务并seek原key.timeMs，不是任意原playhead；unmount取消事务。拖动后吞click；click优先select key，否则animated seek。Delete/Backspace删除该key。d7自身未见IME／文本guard，不能把全局guard自动视为这些局部handler已包含。

`h7`（764144）：role slider、tabIndex0、aria min0/maxduration/current round。down animated scrubbing seek，超过4px记录drag，RAF nonanimated seek；up结束viewing并onScrubEnd。pointercancel结束scrub，**不恢复原playhead**。未消费drag click才animated viewing seek。ArrowLeft/Right ±500ms，Home0，Endduration；playing时仍可seek。

zV 对director actor/prop操控禁用移动／删除keys和修改时长，但仍提供保存当前key路径；禁用说明：

> 完成当前操控后，才能移动或删除关键帧以及修改时间轴时长

locked actor/prop的authoring被Et限制；camera不在Et锁对象中。playing禁用保存、删除、匀速、时长与相机编辑；previewing/scrubbing亦禁用相机提交。不可将此扩大为“播放期间不能拖动播放头”。

全局Space桥 `OD`（84539）、`LD`（87718）只在available、timelineInteractionActive、无entityControl.session时切播放；先经过全局`ln`文本／输入守卫，repeat只被消费不重复切换。局部key／slider快捷键与此桥是两层。

## 相机编辑与播放预览

A `EV/AV/kV/RV`（560316／567587／559966／565818）区分possession与timeline-settings owner；会话身份含setup/entity/base或key或time/owner。基线在精确编辑目标采样。possession复用lease，settings进入 `director-camera-key-edit` lease，恢复.22秒。首个真实pose/optics dirty才可能请求隐式创建确认；pending只请求一次，确认写最新dirty意图；取消还原相机baseline、清patch/dirty并cancel history。pose dirty保存完整相机key，optics-only patch保留无关字段。一次 `director.editCamera` 事务，未解决确认时finish不创建，空变更不留history。选择同possession camera key由 `JH`（493753）精确采样并立即nonanimated preview。

`jV`（568836）优先performance.now，fallback Date.now；内部**无lastNow单调防回退保护**。duration取finite/nonnegative round，speed需finite positive否则1；播放时间=start+(now−anchor)*speed。seek重设anchor；pause保持当前time；非loop末尾精确duration/playing=false/ended=true；loop正模运算。`LV`（569750）末尾重播从0；`NV`（569807）ended立即发布，否则32ms间隔。

`FV`（569876）订阅engine director frame tick，每tick sampleTemporalFrame/applyDirectorFrame，UI playhead限32ms发布。stage:setup session fence变化时暂停、loop=false、playhead0并释放preview lease。seek非播放时也立即应用entity frame，播放中seek重设clock。viewing/scrubbing/previewing是不同camera preview模式；possession复用previewDirectorCameraState，settings以temporal-preview owner取lease。seek camera transition .16秒，并在180ms内防frame覆盖transition；lease恢复.22秒。scrubbing/previewing取消当前camera input，阻止camera-drag/wheel/movement-capture/view-rotation。启动播放可完成已有control；cleanup停播放和scrub。未定位隐藏窗口自动pause的官方证据。

## 持久化与撤销边界

`yj`（46624）拒绝baseline setup，structuredClone temporal并更新setup.updatedAt；`setSetupTemporal`（50963）经`He`（20647）写activeScenePlay并增加content dirty计数。源码证明内容进入保存链的脏状态，不证明服务端已经durable保存；本轮未调用API验证。

`WW`（267540）默认包装 `transact("director",label,mutation)`；history external供已有拖动／相机事务使用。`Ja`（25441）将director/scout转换为当前activeSetup的 `setup:${id}` lane，缺setup才world；`Jp`（7060）构造lane。事务begin（22342）只允许一个active transaction；commit无diff不入栈，cancel恢复before。`x1`（24366）每lane保留最近50条，commit清redo，undo/redo有跨lane触碰冲突门禁。`zn`（505126）key拖动begin→external previews→end commit/markOwnedContent，cancel撤销。

WW未直接接收readonly；低层setter本身也未包含readonly。可见入口、独立setup可用性与编辑会话有上层门禁，不能把低层可调用解释为readonly允许编辑。`BW`（273309）本地React state持有playhead/playing/scrubbing，按stage:setup重置；FV本地clock/loop state。未找到它们写setup或history的证据。

## 精确中文

D `temporalBlocking` 字典起点9177017；“时间轴”terms起点9171665。以下为官方中文，不使用英文fallback翻译替代。

| key | 中文 |
| --- | --- |
| confirmStartTimelineTitle / confirmCreateKeyTitle / createKey | 开始时间轴？／创建关键帧？／创建 |
| confirmImplicitKeyDescription | 将 {{label}} 在 {{time}} 的状态保存为关键帧。 |
| openTimeline / closeTimeline / timelineTooltip / betaBadge | 打开时间轴／关闭时间轴／编辑关键帧和动画时长／测试版 |
| play / pause | 播放时间调度／暂停时间调度 |
| enableLoopPlayback / disableLoopPlayback | 开启循环播放／关闭循环播放 |
| saveCurrentStateAsKey | 保存为关键帧 |
| selectTargetToSaveKeyframe | 先选择角色、摄像机或对象，再保存关键帧 |
| pauseToSaveKeyframe | 暂停播放后保存关键帧。 |
| deleteSelectedKeyframe / deleteKeyframe | 删除所选关键帧／删除关键帧 |
| selectKeyframeToDelete / pauseToDeleteKeyframe | 选择要删除的关键帧。／暂停播放后删除关键帧。 |
| deleteTrackFor / timelineActions | 删除「{{name}}」轨道／时间轴操作 |
| redistributeKeyframeTiming | 按匀速重新分配 |
| selectTargetToRedistributeTiming | 请选择至少包含三个关键帧的运动轨道。 |
| timingRedistributionNeedsContinuousKeys | 至少添加三个形成连续运动的关键帧后再按匀速重新分配时间。 |
| pauseToRedistributeTiming | 暂停播放后按匀速重新分配关键帧时间。 |
| seekTimeline / playheadAtTime | 定位时间轴／播放头位于 {{time}} |
| increaseDuration / decreaseDuration | 延长时间轴 1 秒／缩短时间轴 1 秒 |
| increaseDurationToTime / decreaseDurationToTime | 延长时间轴到 {{time}}／缩短时间轴到 {{time}} |
| durationAtMinimum | 已是最短时长：1 秒。 |
| durationBlockedByTrackKey / durationBlockedByKey | {{name}} 在 {{time}} 有关键帧，不能再缩短。／{{time}} 有关键帧，不能再缩短。 |
| durationLockedDuringPlayback / durationUnavailable | 暂停播放后才能编辑时长。／当前无法编辑时长。 |
| timelineLockedDuringPlayback | 暂停播放后才能编辑时间轴。 |
| lockedEntityCannotAnimate | 请先解锁此场景对象，再添加或编辑动画。 |
| pauseToEditCameraSettings | 暂停后可编辑摄像机设置 |
| finishScrubbingToEditCameraSettings | 结束时间轴拖动后可编辑摄像机设置 |
| finishPreviewToEditCameraSettings | 结束时间轴预览后可编辑摄像机设置 |

## 当前本地实现对照与验收边界

此节是本轮静态读取的文件快照；同一工作树其他代理正在接线，不能作为最终功能完成清单。

| 本地文件 | 对照／区别 |
| --- | --- |
| `src/features/studio-v3/schema.mjs` | 严格schema4、owner必须属于local独立setup、known property和linear/hold、引用／重复关系拒绝；与官方部分normalize容错不同，属于边界增强 |
| `world-space.mjs` | renderSetup复用baseline优先；setTemporal仅独立setup、复制值、updatedAt；mutation不应改别的setup |
| `history.mjs` | setup lane、单事务、50-entry、跨lane冲突；temporal reducer返回lane与historyLabel，宿主仍须执行事务／保存 |
| `temporal-actions.mjs` | 已有base/selected/time resolver、prepare/apply确认、快照／key/channel/轨道CRUD、duration allkeys、曲线拆段／匀速；readonly/playing/scrubbing/共享基准严拒比官方低层回调更明确 |
| `camera-shot-sampling.mjs` | detached setup/camera采样、baseline优先、64弦弧长、shortest quaternion、focal几何插值；无history/save/GPU副作用；focus/lookAt/pose/held字段是否呈现仍由runtime决定 |
| `temporal-playback.mjs` | 已有独立预览快照、clock/replay/loop/source fence；hidden取消、显式错误／restore是本地强化，不应标官方已验证；transition和实体renderer需宿主落实 |
| `timeline.mjs` / `timeline.css` | 已有compact单目标轨道、邻接拖动、slider、时长菜单；本轮读到部分中文如“播放”“重新分配时间以匀速移动”与字典不同；自建confirmation UI／窄屏wrap是本地策略，需要单独验收 |

采样详证见 `src/features/studio-v3/CAMERA-SHOT-SAMPLING.md`；View／照片／镜头管理见 `docs/research/STUDIO-V3-VIEWS-PHOTOS-20261008.md`。timeline时长最小值统计**全部 authored keys**，动态shot时长只统计channel.values引用的keys；不能复用同一计算。官方共享基准没有temporal，不能给基准添加轨道来解决独立状态编辑问题。

本文完成的检查仅为原文件hash、符号／字典锚点和Markdown结构检查。没有新测试或浏览器验收；实际key拖动回滚、相机接管/确认、播放中seek、刷新持久化、撤销重做和真实actor/prop呈现仍应由实现代理／父代理的独立验收记录证明。
