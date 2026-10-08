# 已保存视图：生产接线与原生浏览器验收

日期：2026-10-08。当前源码实现 View 创建、恢复、更新当前视角、中文改名、仅 View 删除、保存失败重试和刷新恢复。使用真实生产 entry、Three.js、作者 session/history、CanvasApp 与 CanvasStore；不是只在菜单内缓存的演示。

**官方依据与本地补齐分开记录。** [安装包研究](../research/STUDIO-V3-SAVED-VIEWS-20261008.md)证实 View 数据、CRUD、保存当前相机、设置活动 View 和恢复相机。未找到独立 Saved Views 管理面板或“更新到当前视角”按钮调用点。本地在 `3D/俯视 → 已保存视图` 增加管理入口，复用既有菜单和官方图标；它是领域语义对照后的本地能力补齐，不称为官方独立面板的像素复刻。普通 View、镜头目录和已有照片相册仍为不同对象。

## 实现与保存边界

| 模块 | 行为 |
| --- | --- |
| [动作](../../src/features/studio-v3/SAVED-VIEW-ACTIONS.md) | 列出所有真实 View；create/update-camera/rename/remove/set-active，严格 JSON、光学、所属 stage/setup 和只读校验。内容操作进入目标 setup 的历史 lane；活动选择用 world/content:false。 |
| [作者桥](../../src/features/studio-v3/SAVED-VIEW-WORKSPACE.md) | 复用 session/history/ownership/persistence。跨 setup 先选中并保存、等待真实场景同步，再导航。检查来源、runtime/graph、编辑代际、事务和 dispose，防止迟到结果进入新片场。 |
| [导航](../../src/features/studio-v3/SAVED-VIEW-NAVIGATION.md) | 读取 Orbit 完整相机；初始摄影画幅为 null，固定画幅不跟随窗口比例。恢复 pose/roll/Euler order、FOV/焦距/光圈/对焦，保持真实 OrbitControls。 |
| [菜单](../../src/features/studio-v3/SAVED-VIEW-MENU.md) | 原生控件、中文长名、IME/Enter/blur/Escape、删除确认、分层 Escape 和异步完成后回焦。成功通知清除原保存失败提示。 |

删除只移除 View 与其领域引用/输出关联，不删除摄像机、实体状态、已有照片或已经导出的画布媒体。恢复只修改活动选择与导航相机，不写实体 camera 或 temporal。保存失败保留原 View ID、动作回执和 dirty 状态；重试只 flush，不重新 create、增加历史或再导航。

恢复仍使用按需 RAF 与默认 `.8s` 过渡，改为 `performance.now()`/RAF 时间计算，低帧率不会因每帧 `.05s` 上限拖成长动画。原物理/graph/摄像机接管和返回动画继续采用已有 delta 上限。模拟 RAF 专项验证此计时；本轮没有测量真实机器上的精确 wall-clock 动画时长。

实机发现俯视全屏层覆盖右下导航按钮：修前中心点命中 `.sv3-plan-view`，鼠标打不开而 Enter 可开。`official-layout.css` 为 dock trailing 增加相对定位与 z-index72，修后中心命中按钮内容，QA 与完整生产页面原生鼠标均可打开父子菜单。这是本地层级修复，不据此宣称整站坐标/像素完全一致。

## 原生操作与回读

独立服务 `localhost:4196`，公开项目 `qa-views-public-1008`；[复现页](../../src/features/studio-v3/qa/saved-views.html)显式准备房间、公开餐椅、摄像机及两个独立状态。准备不覆盖已有项目；生产动作全部通过实际菜单完成。额外 9:16 光学样本是显式 QA fixture，不是模型生成结果，准备时不直接导航。最终截图另从无 QA 顶栏的完整生产页面取得。

[诊断 JSON](20261008-studio-saved-views.json)来自 QA 页渲染的只读文本。`readOnly:true` 表示诊断动作只读，不表示生产场地不可编辑；诊断不 flush、不导航、不改变选择。仅将历史补丁正文精简为 ID、label、sequence、forward/inverse 类型和计数，保留实际作者、存储、运行相机与保存回执。

| 操作 | 实际结果 |
| --- | --- |
| 空态保存 | 创建 View 1；相机 `(7,6,9)`、45°、画幅 null，真实持久化。 |
| 中文改名与确认取消 | Enter 提交、Escape 取消草稿，Tab/blur 保存为“房间 A · 主视角”；删除确认 Escape 只关确认并回删除按钮。真实系统 IME 全部组合未实机覆盖。 |
| 拖动后恢复同一活动 View | 相机回 `(7,6,9)`/45°；history 与所有 setup entityStates 不变，原控件恢复启用。 |
| 跨 A→B 恢复 | 实际位置 `(-3,2.5,4)`、rotation `(-.25,-.35,.14,YXZ)`、FOV52°、9:16、36.905469mm、光圈5.6、focus6；实体不变。 |
| 更新当前视角 | 原生 Orbit 拖动后只更新 View camera，增加一条历史，保留52°/9:16。存储采样位置 `(-4.558270522,3.282418477,2.810615738)`；采样后原阻尼稍继续，不把后续可见终点冒充采样值。 |
| 真实存储失败 | 一次 CanvasStore QuotaExceededError：作者3 View/存储2 View，dirty=true，pending ID `view:413c0740-c329-4f7a-bd34-43617448f2c8`。关菜单重开仍保原回执。 |
| 原回执重试 | 存储3 View、clean、原 ID 不变，history 与失败时完全相同；回保存按钮焦点。成功通知不再保留旧失败提示。 |
| 删除/撤销/重做 | 作者 View 数2→3→2，实体与 setup 保持；photos0/media0。undo/redo 诊断采样时尚有 autosave 在途，不能将中间 persisted 数称为完成值。 |
| 关闭、刷新、重开 | 最终 revision12、dirty=false、作者/存储各2 View。房间 A 与更新后的房间 B 名称、ID和camera保持，再次恢复 B 成功。 |
| 俯视门禁 | 保存/更新禁用并提示切回可用3D导航；允许恢复 View 返回 Orbit。完整生产页面父子菜单、恢复、删除取消及俯视禁用再次原生确认。 |

最终持久 View：

- `view:2b9dd857-c96f-457b-a06e-15bae7836675`，房间 A · 主视角，画幅 null。
- `qa-views-optics:059c062c-df9c-45ac-8b5c-a4555bce0ab8`，房间 B · 竖幅光学样本，画幅9:16。

## 正式页面截图

四张均为实际1280×720 JPEG，没有改变视口/样式、裁剪、拼接或生成修图；仅含公开验收项目，不含 Key 或私人素材。

| 截图 | 状态 |
| --- | --- |
| [无限画布与节点类型](../screenshots/20261008-studio-saved-views/canvas-node-types.jpg) | 实际已保存导演节点与添加节点菜单。 |
| [已保存视图菜单](../screenshots/20261008-studio-saved-views/saved-view-menu.jpg) | 真实恢复房间 B、两个持久 View 与当前状态；独立菜单为本地补齐。 |
| [删除确认](../screenshots/20261008-studio-saved-views/view-delete-confirm.jpg) | 仅 View 删除确认；截图后取消，没有删除房间 B。 |
| [俯视保存门禁](../screenshots/20261008-studio-saved-views/plan-save-gate.jpg) | 真正俯视渲染、可鼠标打开菜单和禁用说明。 |

## 定向检查与限制

按独立专项记录：动作13/13、作者桥20/20、菜单15/15、导航11/11、实际入口10/10通过；受影响旧关闭入口4/4，通知包装后仅复跑父子菜单原回执/跨状态恢复2/2。不累加为全仓重新测试，也不重复执行已通过专项。

导航曾窄查旧返回/销毁5项：当前与 HEAD 同为1通过/4失败，两项 renderer 替身缺 `getRenderTarget`、角色返回位置旧断言及旧监听数量断言失败。未改旧断言粉饰结果，详情见[导航合同](../../src/features/studio-v3/SAVED-VIEW-NAVIGATION.md)。

本批没有新依赖、供应商调用或 TapNow 服务请求，现有 Alpha 包不含这些源码增量。未验全部原生中断/IME/移动端/跨设备/大场景路径；真实 SPZ 与景深 GPU、GLB虚化、官方视口 FOV 补偿、视图缩略图、P4导入/生成 UI、持物渲染与完整 V3 Agent 仍开放。3D/orbit 角色仍立即创建，不能称完整3D放置已对齐；整体复刻任务仍在进行。
