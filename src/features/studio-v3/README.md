# V3 导演片场 · 2026-10-08

**已接入真实生产画布、IndexedDB 保存和 Three.js 工作区，当前完成 P0/P1 的部分闭环。** 本地模型预览可创建独立导演片场；人物、摄像机、道具、状态、基准、基础变换和失败保存重试已有实机证据。完整导演流程与 P2–P6 尚未完成，见[生产入口验收与截图](../../../docs/STUDIO-V3-PRODUCTION-20261008.md)。V3 是本项目内部代际名称，官方导演工作区与独立 GLB 编辑器并存；现有 v2 节点不隐式迁移。

## 实现范围

| 模块 | 职责 |
| --- | --- |
| `invariants.mjs` | 有路径/错误码的领域错误，纯 JSON 检查、结构相等及克隆；拒绝循环、非有限数、访问器、命名数组字段和稀疏数组 |
| `schema.mjs` | `schemaVersion=4` 的展开内存状态；stage、基准/独立状态、role、entity、setup state、view 构造；校验唯一 ID、所有者、stage/setup/role/view/reference/output/temporal 关系 |
| `world-space.mjs` | 不修改输入的领域操作；建立舞台/状态/角色/实体/view，实体/状态编辑、基准优先渲染状态合并、设置时间数据、实体全局/当前状态移除、view 移除及级联清理 |
| `history-patches.mjs` | 集合成员及 setup state 的逐项 forward/inverse patch、setup metadata、环境字段、source/room/active selection 补丁，原子重放与 touched/生命周期依赖 |
| `history.mjs` | 一个活动事务、preview/commit/cancel、world 与每 setup 的历史 lane、每 lane 50 条记录、全局 sequence、跨 lane undo/redo 冲突 |
| `ownership.mjs` | 明确 V3 标记、live owner/source 对象身份、project/source snapshot/session/revision 围栏与排队 snapshot gate |
| `persistence.mjs` | dirty/contentDirty 序列、不可变保存快照、单队列保存/重试和事务延迟 |
| `session.mjs` | 可供消费者直接使用的领域历史代理、change/getState/getFence、自动保存与关闭守卫 |
| `source.mjs` | 明确空片场或资源来源、独立 owner 标记、读取来源快照 |
| `entry.mjs` / `dom.mjs` | 生产工作区、实体/状态 UI、数字属性、异步重命名、保存和关闭生命周期 |
| `camera-optics.mjs` | 焦距/画幅与FOV换算、光圈/对焦配置、Three相机投影，以及显式Spark景深参数；普通GLB本身不具备虚化渲染 |
| `entity-inspector.mjs` / `inspector.css` | 实体位置/旋转/缩放、颜色/材质、原GLB姿态与摄像机光学属性；真实编辑草稿、IME、基准只读/锁定与错误回执保护 |
| `setup-actions.mjs` | 独立状态复制/删除，克隆私有实体/角色/view与关联引用，保留共享基准；删除最后独立状态时创建空替代状态 |
| `drop-placement.mjs` | 基于真实对象包围盒与站面命中的actor/prop落地变换，排除自身模型后计算支撑；不代表完整放置输入租约 |
| `transform-coordinates.mjs` | 人物领域／渲染与摄像机plan／optical双向转换、heading反射与quaternion等价判断 |
| `control-session.mjs` / `control-hud.mjs` | 人物／道具真实操控、支撑与碰撞、输入租约、一笔事务完成／还原及官方主操作工具条 |
| `camera-create.mjs` / `viewfinder-optics.mjs` | 地面命中和当前视角创建、独立临时取景相机及画幅／镜头参数 |
| `camera-marker.mjs` | 原GLB身体／材质、短视锥、layer5、独立拾取／outline目标与真实身体pivot |
| `camera-navigation.mjs` | 摄像机Quaternion三维飞行、惯性／滚轮／Alt支点、输入隔离与按需tick |
| `camera-edit-session.mjs` / `camera-history-adapter.mjs` | 作者事务、checkpoint、viewport lease、来源围栏和真实领域history接线 |
| `camera-control-hud.mjs` / `camera-control-hud.css` | 原光学工具、画幅菜单、log滑尺／弹簧、对焦和失败回执交互 |
| `photo-renderer.mjs` | 独立真实WebGLRenderTarget、默认4096长边RGBA读回与JPEG .92编码，摄影层/Spark/渲染状态恢复 |
| `selection-outline.mjs` | 真实实体选择/悬停身体轮廓pass，与摄影内容隔离 |
| `camera-capture.mjs` | 真实离屏JPEG、LocalAssets、连接画布图片、受守卫保存及同照片重试；前批viewport PNG保留历史证据 |
| `camera-shots.mjs` / `camera-manager.mjs` | 镜头目录、真实机位/已有View解析、改名/删除/批量选择及分层Escape交互 |
| `camera-shot-preview.mjs` | 独立运行时按真实画幅生成320×180包围框内JPEG缩略图，串行/取消/身份与资源释放 |
| `camera-shot-sampling.mjs` / `camera-shot-export.mjs` / `webm-encoder.mjs` | 静态JPEG、已有时序频道采样、1280×720/30fps原生WebM与明确unsupported时contact sheet回退；不等于时间编辑UI完成 |
| `camera-batch-publish.mjs` | 原批次本地素材、连线媒体节点与真实项目保存，保留幂等回执用于失败重试 |
| `runtime.mjs` / `render-graph.mjs` | 真实 Three 场景、GLB/SPZ、人物 clip、相机、Orbit/正交视图和事务变换 |
| `asset-loader.mjs` / `surface-hit.mjs` | 有界本地素材读取/解码/取消，站面与直接拾取基础 |
| `icons.mjs` / `menus.mjs` / CSS | 官方图标与布局、单活动菜单和嵌套子菜单、坐标夹紧、键盘/分层Escape回焦与退出动效 |

内部模块由 `studio.mjs` 路由，只有明确 `studioV3` 标记进入新工作区。V3 Agent 目前仅暴露 `read/select/undo`，其余明确拒绝。

## 实体、状态与镜头增量

属性面板已接实体颜色/材质、原GLB九姿态及镜头焦距/画幅/光圈/对焦。状态可复制非当前状态并生成独立实体/角色/view ID，删除有嵌套确认；最后独立状态删除后自动建立空状态。落地使用真实模型包围盒与支撑命中，恢复摄像机摆放使用Y=1.6并保留光学。摄像机实体的只读预览使用真实投影和居中黑边，Escape返回原视图；这不等于完整官方viewfinder/摄像机创建流程。

主线实机刷新回读revision23：绿色Sitting人物X=1.5、Y=0.005886657753309876，摄像机位置1.5/1.6/5、50mm/9:16、FOV39.597752709049864；真实竖幅预览已验。非当前状态复制后revision26为4实体/2角色/4setup，副本ID独立；基准创建及继承全局删除后revision32为4实体/3角色/4setup，未引用第三角色按单实体删除合同保留。确认菜单Escape回父删除按钮、“保留状态”、连续两次删除/撤销/重做、最后状态删除/撤销，以及Delete/Backspace/G/L/⌘Z不穿透均已验。空`ground:{}`导致NaN的失败轮次已排除，有限地面缺省0修复后刷新重验成功。[最终实机、截图与专项范围](../../../docs/STUDIO-V3-ENTITIES-20261008.md)

前批runtime光学/取景11项、落地5项、状态7项、集成守卫5项通过；同lane连续redo新增3项，跨lane冲突仍阻断。其他光学、属性与嵌套菜单专项按上述证据页分别记录，不合计为全量重跑。六色/道具材质与九姿态没有覆盖全部浏览器鼠标路径，P1不能标为全部完成，旧Alpha不包含这些增量。操控／创建与摄像机拍摄的当前补齐范围见下。

## 最新：离屏摄影、身体轮廓与镜头管理/导出

当前快门接独立 WebGLRenderTarget、RGBA 读回和 JPEG .92，默认 4096 长边；实机 9:16 图像解码为 2304×4096。摄影排除轮廓与 helper，实体身体橙色 outline 已有生产界面证据。摄影前等待 source 与可见非 camera 实体的必需资源，失败/身份失效/默认 30 秒超时具体报错且零编码；新增 readiness 5 项与受影响 Spark/drain 2 项通过，刷新新代码后真实竖幅快门成功且 warn/error 为空。

镜头管理以独立 runtime 生成真实缩略图，竖幅实测 101×180；改名保存、删除确认/撤销、批量选择和分层 Escape 已验。照片失败重试保留原 capture ID、节点和素材；批次两次保存失败后关闭/重开恢复原选中项，重试与刷新保留同 export ID 的唯一输出节点及素材。普通快门不会追加 `capturedPhotos` 或 `views`，管理器不能当作完整 Saved Views/历史照片作者 UI。

动态镜头以已有 temporal 频道采样并导出 WebM。真实文件审核为 VP9、1280×720、30 fps、1 秒、56,649 bytes，30 帧解码且全部不同，0/15/29 帧有餐椅与地面；只有编码器明确不支持时才回退 contact sheet。完整证据、截图与视频审核见[本批验收](../../../docs/verification/20261008-studio-shots.md)。真实 SPZ 离屏 GPU/景深像素未实机验，GLB 景深/持物渲染未实现；时间/关键帧编辑、完整平面图、独立历史照片管理、生成与完整 V3 Agent 编排仍缺，旧 Alpha 不含此批。

## 前批：摄像机接管与 viewport PNG 拍摄

前批生产入口接通三维飞行、0.8s／0.55s进入返回、光学滑尺、完成／还原和拍摄checkpoint，摄像机helper采用原材质／短视锥／layer与身体pivot。当时快门为真实PNG→LocalAssets→连接画布图片→受守卫保存，重试保留同照片，接管排除全部camera marker。GLB隐藏不具备能力的景深工具，Spark已有光圈／点对焦参数但真实像素未验。

实机验证滑尺ArrowRight只改焦距不改pose；400mm与拖动后还原完整states，revision不变。两笔照片保存失败时锁非重试HUD，并保护恢复视图／选择／关闭入口；顶部或快门重试均不重复图片。最终刷新revision6、五张763×1356照片同ID并全部解码成功。完整源证据、模块合同、分批检查范围和截图见[摄像机接管与拍摄验收](../../../docs/STUDIO-V3-CAMERA-POSSESSION-20261008.md)。

此段保留五张 viewport PNG 的历史证据；当时缺少的身体轮廓 pass 与 4096 长边离屏 JPEG 已由上方最新增量补齐。独立 Saved Views／历史照片管理、时间／关键帧编辑、完整平面图、生成 UI 与完整 V3 Agent 编排仍未完成。领域 schema 字段和只读 Agent 接口不能代替这些功能；不声称完整官方工作区验收。

## 数据约束

上述实体批次之后，已接入人物／道具操控、地面放置和当前视角取景创建；早期缺口以[操控与创建最终增量证据](../../../docs/STUDIO-V3-CONTROLS-20261008.md)和上面的摄像机增量为准。该创建项目实机最终revision6为5实体、1角色、2setup，保留90°／Standing和35mm／9:16；摄像机拍摄另用独立项目，不混合两组revision与实体计数。新建镜头遮挡及空操控保存状态已修复，不称完整官方取景器或P1全部完成。

内存 envelope 为 `{schemaVersion:4,scenePlay:{id,worldNodeId,worldSpace,environment,editSessions},capturedPhotos,worldGenerationTasks}`。新领域构造器保留官方默认 ID：`stage-default`、`setup-default`、`setup:state-1`；其他 stage 的基准 ID 是 `setup:${stageId}:default`。

每 stage 必须有且仅有对应 ID 的基准、至少一个独立状态；所有 stage 属于同一 worldNodeId。entity definition 独立保存 asset/label/role，setup state 保存 transform/visible/lookTarget/heldEntityId/camera。actor 角色与实例分开，角色关联必须属于同一 stage。相同 entityId 可存在于不同独立状态，状态内不能重复；独立状态不能持有基准实体 ID，也不能为基准实体添加时间轨道。`renderSetup` 返回基准优先与独立实体合并的拷贝。

view 必须关联独立状态；sourceCameraEntityId 若存在，必须是同 stage 的 camera。reference targets 和 output 的来源 view 必须存在。look/held/camera/temporal target 不允许缺失或跨 stage。时间 track 归属当前独立状态中的实体，keyId/timeMs 唯一，channel value 必须指向现存 key 并满足字段类型。

位置/变换使用数值 xyz，Euler 旋转为弧度、camera fov 为角度、时间为整数毫秒。不会把 v2 的 animationIndex/keyIndex 或旧对象数组隐式映射为本领域实体/时间数据。

`assertState` 只接受 schemaVersion 4，拒绝旧版/未来版和不支持字段，不执行迁移或容错丢弃。这里验证的是**展开的内存域**：尚未实现官方紧凑 temporal 序列化（channel key index 等）、官方包的反序列化、云 schema 修复或编辑 session/生成任务/历史照片语义。本地保存只存该展开状态，不承诺读取任意官方 schema 4 存档。

## 事务与错误处理

```js
import {createState, createEntity} from './schema.mjs';
import {addEntity, patchEntity} from './world-space.mjs';
import {createHistory, setupLane} from './history.mjs';

const initial = createState({worldNodeId: 'local-studio-owner'});
const history = createHistory(initial);
history.begin('director', 'director.addEntity');
history.preview(state => addEntity(state, createEntity({
  id: 'prop:local-one', kind: 'prop', label: '本地道具'
})));
history.commit();

const lane = setupLane('setup:state-1'); // 官方 Jp 会得到 setup:setup:state-1。
history.transact(lane, 'director.renameEntity', state =>
  patchEntity(state, 'prop:local-one', {label: '桌面道具'})
);
history.undo(lane); // {ok:true}，或 {ok:false,reason:'empty'|'conflict'|'transaction-active'}。
```

`scout/director` 在 begin 时解析为当时 active setup 的 lane；显式 `world` 保持 world lane。事务期间再次 begin 返回 false，undo/redo 返回 transaction-active。preview 必须同步返回完整的有效 state，不能写 owner/envelope 或超出选定 scope；失败不会修改当前有效状态。`transact` 抛错时自动 cancel，普通 preview 抛错后调用者可修正再 preview 或 cancel。

preview 是临时域变化，不产生历史；commit 计算逐项差异，无变化返回 false、不耗 sequence；cancel 精确恢复开始状态、不改任何 lane。每条历史记录包含 forward/inverse patch、lane、label、时间戳、sequence 与 touched，不保存整个场景 before/after。只有活动事务临时持有开始快照，这是取消与计算差异所需。

撤销/重做检查其他已应用 lane：存在更新且触及相同环境/空间/entity/setup/view 等数据的记录，则返回 conflict。同lane按自身栈顺序重放，不把前一次redo获得的新sequence当成下一次redo的冲突；这是本地连续重做修复，不写成已证实的官方新行为，跨lane的重叠和生命周期依赖仍保留。局部 setup state 修改只写对应 setup；两个 setup 修改同一个 entity definition 的各自状态仍可以分别撤销。创建/删除的生命周期依赖会额外阻止悬空关系，例如后来创建 actor 使用 role、后来选择新 stage、后来设置 lookTarget 引用新实体。环境 scope 由 `{kind:'environment',fields:[...]}` 指定；环境任意字段间保持官方保守冲突语义。

新 commit 仅清空本 lane redo，redo 得到新的全局 sequence。history getters 返回拷贝，外部修改不会改私有状态或记录。active transaction 期间禁止 clear，先 commit/cancel。

## 对照官方函数及明确补齐

生产源码与 SHA256 见[实现映射](../../../docs/research/STUDIO-V3-IMPLEMENTATION-MAP-20261008.md)。本轮先精读了以下原函数，没有执行官方 bundle：

| 官方原函数 | 本地域对应 |
| --- | --- |
| course `gF/Ag/Rq/cOe/LLe` | stage、派生基准 ID、baseline/independent 构造与默认 WorldSpace |
| course `dOe/gdt/yOe/BLe` | 基准优先和独立排斥、stage/role/entity/setup/view 的关系；本地严格拒绝而非迁移/过滤 |
| workspace `Nr/tm/Jc/u1/qx/f1/p1/h1/g1` | 实体、角色、角色实例、状态、view 构造及局部编辑；目标 stage 不合法时明确报错，不静默 fallback |
| workspace `Qc/m1/aj/sj` | 全局实体移除/当前状态移除、view 添加激活/移除、state/track/view/output/reference 清理；本地增加 remaining camera/temporal targets 的清理以保持严格关系 |
| workspace `yi/Jp/ZA/JA/QA/S1/Ja/x1/k1/C1/Sf` | 单事务与 lane、50 条记录、全局 sequence、undo/redo 冲突与取消 |
| workspace `a1/c1/Cc/qc/i1/n1/t1` | 逐项 diff/apply/touched；本地补齐字段见下一段 |

官方 `a1` 不记录 stages/references/outputs/active selection；但删除 `Qc` 会修改其中部分数据。本地增加这些对象的**逐项补丁**，加入 role/stage/reference/output touched 与生命周期依赖，不把补齐写成官方现有行为。`setup.patchMeta` 还保存 updatedAt，补丁新增/恢复带相邻 ID 锚点与 index fallback，以精确还原时间戳和交错删除项的数组顺序。锚点也是生命周期/位置依赖，后续另一 lane 删除或重排恢复所需锚点时会保守返回 conflict，普通锚点属性编辑不产生位置依赖冲突。真正的集合重排只记录 ID 顺序；没有整场景替换补丁。删除级联原子重放，全部补丁应用后才执行关系校验，避免中间阶段合法恢复顺序被误判为缺失关系。

领域操作不访问源资源、权限、UI mode 或外部网络。runtime/session 已施加来源身份/revision/session fence 和关闭保存失败保留；播放/放置/输入租约仍需后续接入，领域基础不能替代它们。

## 定向验证

```sh
node --test tests/studio-v3-domain.test.cjs tests/studio-v3-history.test.cjs
node --check src/features/studio-v3/invariants.mjs
node --check src/features/studio-v3/schema.mjs
node --check src/features/studio-v3/world-space.mjs
node --check src/features/studio-v3/history-patches.mjs
node --check src/features/studio-v3/history.mjs
```

2026-10-08 定向结果：先跑两份领域测试 **39/39 通过**；随后补充 collection.order/插回锚点冲突，按任务要求只跑新增回归 **1/1 通过**（当前共 40 项领域测试）。五个领域模块语法检查通过，最后修改的 history-patches 再次单独检查通过。涵盖非法 schema/JSON、唯一 ID、owner/跨 stage/基准排斥、时间关系、级联删除、cancel/无变化/异常、50 条与 sequence、局部独立撤销、跨 lane 重叠/角色/舞台/选择/实体 target/锚点删除与排序依赖、交错多删顺序恢复、scope 和私有状态隔离。只读交叉审阅指出的数组恢复顺序、active selection/锚点依赖遗漏、非 JSON 数组属性问题均已修复并加入回归。

上述纯领域批次未做浏览器或保存重开验收；后续生产集成已独立完成部分实机闭环，见[生产验收](../../../docs/STUDIO-V3-PRODUCTION-20261008.md)。没有全仓测试、模型生成或全态视觉完成承诺。

## 本地会话与保存契约 · 2026-10-08 增量

持久标记必须为 `studioV3:{version:3,state:<展开 schema4>,revision,sourceBinding:{sourceNodeId,sourceKind,sourceSnapshot}}`。`revision` 是非负安全整数；`worldNodeId` 必须等于目标节点 ID。来源 ID/kind 显式指定，snapshot 为 JSON；没有旧 studio/V2 自动接管或迁移。初次创建标记属于 entry 的职责。

```js
import {createStudioSession} from './session.mjs';

const session = createStudioSession({
  nodeId,
  app: CanvasApp,
  store: CanvasStore,
  publishNode: (id, patch, options) => CanvasApp.publishStudioV3(id, patch, options),
  getSourceSnapshot: (sourceNode, sourceKind) => readSourceSnapshot(sourceNode, sourceKind),
  onChange: state => runtime.sync(state),
  onStatus: status => renderSaveStatus(status)
});
session.change(state => patchEntity(state, entityId, {label: '桌面道具'}), {
  lane: 'director', label: 'director.renameEntity'
});
await session.flush();
await session.closeGuard(); // 只有成功才由 UI 关闭页面；失败保留页面并呈现错误。
```

adapter 必须提供 `app.getState().nodes` 的 live 节点引用、`app.projectIdentity()`（字符串 ID 或 `{id}`）、`app.registerNodeWriteGuard(id, guard)` 返回 unregister。持续 node guard 接受被保存快照内的 `capturedNode`；画布完整保存必须在存储事务内再次调用捕获的 guard，不能只检查保存调用时的 live 节点。会话交接需要替换未来保存捕获的旧 session guard，同时旧排队保存保留旧闭包并拒绝迟到写入。成功关闭时先 unregister、再 release；失败不解除保护。

`publishNode(id,{studioV3}, {beforeCommit})` 应先验证并保存含新 payload 的完整候选画布，在事务内与回执后检查 owner/source/session 和 graph revision，再成功发布 live 节点与画布 history。失败保持原 host/history，只保留 session 私有 dirty。它已经执行保存，会话仅追加 `store.flush()`，不会再调用 `store.save()`。不能用会自动触发无守卫保存的 `updateNode` 代替。会话也兼容替身 adapter 失败后保留 host staged payload：同 revision 重试以及失败后再编辑的较新 payload 都可保存；进程内会话交接继承已发布未确认 payload 为 dirty，避免把失败内存误当已保存。生产默认并不提前发布该 staged payload。

`getState/history/getStatus/getFence` 都返回私有数据的拷贝；history mutation 代理自动标脏。`history.begin/preview/commit/cancel` 支持拖动；preview/cancel 不产生持久脏状态，已有脏状态在活动事务期间延后保存。`change(reducer,{lane,label,scope,content})` 默认内容编辑，`content:false` 用于实际修改领域状态但只影响后台内容的操作。undo/redo 视为内容变化。`getFence` 包含 session/source/project、私有 revision 与 editEpoch，preview/cancel 也更新 epoch，可供 renderer 的异步结果围栏；private 编辑不使已经拥有的较早保存回执失效。

`flush()` 共享单个 promise，循环保存不可变快照，直到最新 dirtySeq 持久化或遇到活动事务。保存中出现新编辑仅确认捕获的 dirty/contentDirty 序列，后续继续保存，不错误清洁。活动事务且存在待保存内容时返回 `{ok:false,reason:'transaction-active'}`；只读返回 `{ok:true,readonly:true}`，不写入。`closeGuard()` 拒绝活动事务、存储失败、来源/owner/session 变化或 flush 后仍未保存内容。打开只读会话时如果存在活动可写会话，明确拒绝 `session-active`，不会抢占可写 lease 或把失败 staged 编辑困在无法保存的只读会话中。

默认自动保存延迟 500ms，可用 `autosaveMs:null` 禁用；`schedule/unschedule` 可注入测试时钟。错误保留 dirty 和 error 状态，通过再次 `flush/closeGuard` 重试；不自动发起云请求或无限重试。UI 观察器异常不能影响保存结果。这里没有替代播放/放置/输入租约、真实 storage CAS、官方 cloud conflict/schema repair 或 beforeunload 保存流程。

revision 达到安全整数上限时，change/transact/commit/undo/redo 在修改已提交 state/history 前拒绝；preview 仍可取消。同步 reducer 导致 owner/source 失效时，已经提交的私有变化仍标 dirty，关闭失败，不会以 clean 状态漏掉编辑。

增量验证：`node --test tests/studio-v3-session.test.cjs` 随 adapter 改为先存储后发布，定向重跑 **27/27**；随后兼容 staged host 失败后新编辑重试与只读不抢占 staged writer，两项回归 **2/2**；最后 revision 上限/同步 reducer 改源回归 **2/2**（当前共 30 项会话测试）。三个会话模块语法检查与 README diff whitespace 检查通过。覆盖事务预览延迟/取消/无变化、dirty/contentDirty、保存中编辑/快照隔离、失败关闭保页/同版和新版重试、来源变化/删除/替换、目标删除/替换、版本/revision/content 变化、项目切换、会话交接、旧排队守卫、只读、undo/redo、自动保存时钟和私有 getter。真实 IndexedDB/生产 entry/浏览器保存重开已由[集成批次](../../../docs/STUDIO-V3-PRODUCTION-20261008.md)独立验收，范围与未完成门槛分开记录。
