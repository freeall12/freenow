# 3D 片场下一代实现映射 · 2026-10-08

> 范围：安装版 TapNow 0.4.81 的官方生产源码与 freenow 当前实现的静态对照。本文中的 **V3 是本项目拟建实现代际的名称，不是官方产品版本 3.0**。官方导演工作区与独立 GLB 编辑器仍然并存。
>
> 本地基线：`main`，`9237288e318beeaed37f9e1ed172d503199130f1`。本轮只新增本文；没有生产代码修改、安装依赖、测试运行、浏览器/桌面交互验证、提交或真实生成请求。以下“官方行为”指源码契约；验收流程是后续实施要求，尚未执行。

## 1. 决策与成功标准

新增独立的导演工作区实现，将“实体定义”“场景基准”“独立机位状态”“时间轨道”分离，通过本地资源和画布存储适配官方流程。保留旧片场与 v2 GLB 编辑器的数据和入口；不把导演能力直接塞进 v2 对象树，也不自动升级旧节点。

第一条完整验收链为：本地世界资源 → 具有独立所有者的片场 → 基准放置道具/建立角色 → 独立状态放置角色与摄像机 → 平面图摆位/菜单编辑 → 时间关键帧 → 真实取景截图进入画布 → 保存、关闭、重开。生成面板先接 mock 契约，以真实本地模型作为明确标记的模拟结果验证任务和放置；未经授权不调用生成供应商。

实现目标是入口、数据约束、交互状态和结果落盘一致。相同按钮文案、相同二进制资源、已有功能名，都不能单独证明行为或视觉一致。

## 2. 官方入口及版本边界

| 生产入口 | 源码链 | 语义及本地决策 |
| --- | --- | --- |
| 导演/世界片场 | `page-DVqoHdTT.js:Cve` → `ThreeDOverlay-akWGliiq.js:P` → `ThreeDWorkspace-BzPphAqB.js:kp/KW/T$` | 全屏 overlay，运行 WorldSpace、机位、实体、时间与拍摄；作为本地 V3 参照 |
| 画布片场节点 | `course-api-base-url-CGXqZmAy.js:fq`，组件名 `ThreeDStudioNode` → `bT` → `_v.open` | `entry.kind="studio"`，必须带 `studioNodeId/sourceNodeId/sourceKind/sourceSnapshot/title`；可有 `createdAt` |
| 独立模型编辑器 | 同文件 `mq`，组件名 `ThreeDStudioV2Node` | 导航 `/3d-studio/{id}?canvasId=...`，保留独立路径；不等同于上述导演 overlay |
| 资源只读预览 | 同文件 `uq/xDe` → overlay | `asset-preview`、`panorama-preview` 与 `studio` 分开；不能授予片场编辑所有权 |

`_v` 存储 `isOpen/entry/epoch`：每次打开增加 epoch，开始关闭仍保留 entry，关闭结束清空。overlay 验证 studio entry，使用 `tapnowThreeDOverlay` 历史状态保存 `canvasPath/entry/sessionId`；浏览器返回走已注册的 `guardedClose`，离开所属画布也关闭。退出动画为 0.25 秒，并清理相关下载提示。`kp` 调用 `KW` 后注册 session close guard。

官方 `Sje/Eje/IOe/pC` 有旧资源所有者拆分及升级流程，会核对所有者和源数据后保存资源/片场关系。这只能作为未来迁移的研究依据，本地本轮不迁移。

本地 `studio.mjs:open` 当前对 `node.studioV2 || !node.studio` 进入 v2，其余进入旧 `Studio`。新增代际必须先检查明确的 V3 标记，再保留现有分支。新入口不能因为缺少旧状态就默认解释成 V3。建议新增 `studioV3` 存储字段与 `binding.version=3`；这些是拟议本地设计，尚未写入代码。

## 3. 数据、所有权、历史与保存

### 3.1 官方实体关系

官方保存 envelope 的 `schemaVersion` 当前为 **4**，`RFe` 可读范围为 0–4；大于 4 返回 newer。**它与本地拟议的实现版本 3、v2 Agent binding version 均不是同一个版本号。**

| 对象 | 源码定位 | 核心字段/约束 |
| --- | --- | --- |
| 保存 envelope | `Oj/Wj/zj` | `schemaVersion, scenePlay, capturedPhotos, worldGenerationTasks`；可有 `legacyWorldVersionArchive`，任务/旧档案必须归属当前 owner |
| WorldSpace | `lk/BW/KW` 与 course 规范化函数 | `stages, activeStageId, characterRoles, entities, setups, activeSetupId, views, activeViewId, references, outputs, source, roomConfig` |
| EntityDefinition | `Nr` | `id, stageId, kind, label, locked?, roleId?, actorGender?, asset?, color?, materialMode?, generationOperationId?, referenceIds, createdAt, updatedAt`；种类包含 actor/camera/prop |
| CharacterRole | `tm/Jc` | 角色定义拥有 stage、label、gender、color、asset、references；actor 从角色生成独立实体，角色不等于场上实例 |
| EntitySetupState | `u1/ul` | `entityId, transform:{position:{x,y,z},rotation:{x,y,z},scale:{x,y,z}}, visible, lookTarget, updatedAt`；角色/摄像机有各自扩展，摄像机保存完整 camera 状态 |
| 基准状态 | `Rq` | `kind="scene-baseline"`，ID 由 stage 推导；共享场景状态 |
| 独立状态 | `cOe/gdt/dOe` | `kind="independent"`；不能使用基准 ID；渲染基准优先，独立状态仅添加不在基准中的实体；schema v4 排斥独立状态/轨道中的基准实体，时间创作仅允许独立状态 |
| View | `qx` | `id, stageId, setupId, sourceCameraEntityId?, label, camera, notes?, referenceIds, tags, durationMs?, generationContext?, createdAt, updatedAt`；view、camera entity、截图节点相互区分 |

`ES` 复制定义时生成新 ID、标签加 Copy，克隆 asset/references；`RS` 复制状态时去掉旧 entityId/updatedAt。`f1` 核对 stage 和唯一实体 ID，并按目标 setup 插入状态。

全局删除 `Qc` 清理所有 setup states、lookTarget、heldEntityId、时间轨道、摄像机派生 views、依赖 outputs/references 及 activeView。`m1` 从独立状态移除，只清理该状态与轨道；只有没有其他状态/轨道/view 引用时才全局删除定义。基准中的移除是全局语义。不能把所有 Remove 都映射为 Three.js `scene.remove`。

### 3.2 事务和撤销

`S1` 只允许一笔 active transaction，开始记录修改前快照，commit 计算 forward/inverse patches；无变化返回 false，不增加历史、不标记 owned content。cancel 恢复快照；transact 异常会 cancel 并继续抛错。拖拽预览必须位于同一事务，不能每个 pointermove 形成一笔记录。

历史 lane 为 `world` 与 `setup:<id>`；`scout/director` 经 `Ja` 映射到当前 setup，没有 active setup 才回退 world。每 lane undo/redo 上限 50，记录包含全局 sequence、时间戳和 touched 环境/空间/entity/setup/view。`Sf` 扫描其他已应用记录，若更晚记录与 touched 重叠，则旧记录 undo/redo 返回 conflict；事务活动时返回 transaction-active。新 commit 清空当前 lane redo；redo 获得新 sequence。

本地应实现独立的 patch/history reducer，再接 UI。旧 `Studio.remember` 整体快照与画布全局 undo 均不能自动提供上述冲突语义。

精读补充：`dOe` 保留基准 entityStates，独立状态仅合入基准没有的 entityId，`yOe` 在 schema v4 中剔除独立状态/轨道里的基准实体；这里不是同一实体的 override。官方 `a1` 历史 diff 覆盖 source/roomConfig/role/entity/setup/view，却未记录 `Qc` 级联影响的 references/outputs/activeViewId。拟议本地领域内核补充 stage/reference/output/active selection 的逐项 forward/inverse patch、精确时间戳/数组位置恢复和对应 touched 冲突，并清理删除后的 camera/temporal targets，以确保严格关系校验和 undo 完整恢复。上述是明确的本地补齐，不能写成官方已有契约，也不采用整场景快照作为历史记录。

### 3.3 异步所有权及本地保存

`KW` identity 的写入目标为 `studioNodeId`，同时持有 source identity/snapshot；sessionToken 和 `isCurrentSession` 阻止旧会话写新片场。`markOwnedContent` 要求当前所有者且不是 readonly。`Xj` 加载/保存再次核对 owner/session；dirtySeq 与 contentDirtySeq 区分变化，在历史事务期间延期保存，保存 structuredClone 快照；响应回来时忽略已切换会话，并处理发送途中新增的 dirty。

官方 PUT `/api/canvas/v1/canvases/{canvasId}/nodes/{worldNodeId}/state` 包含 `{state,if_match_version}`；冲突码 110130，schema newer/too_old 阻止错误读取，关闭时 flush 和处理失败。此处仅记录官方契约，**本地适配 CanvasStore/LocalAssets，不复制官方认证、云状态服务和账户字段**。

本地拟议 guard：`{canvasId, studioNodeId, sourceNodeId, sourceFingerprint, sessionId, stageId, setupId, expectedRevision, operationId}`。加载、放置、保存、生成回调前后均检查相关字段。源节点删掉/换资源、目标删掉、切片场、切状态、revision 变化要分别返回明确原因；迟到 decoder 结果 dispose。关闭 flush 失败保留编辑器与修改，重试成功再退出。

## 4. 导演菜单与 UI 契约

`e4` 只产生简化菜单 descriptor；完整实体菜单由 `V6` 组合 `Am + G6`，不能只抄 descriptor 后声称菜单完整。

| 菜单/交互 | 官方依据 | 实施要求 |
| --- | --- | --- |
| 名称 | `Hk/Am` | blur/Enter trim；空值恢复原名；Escape 恢复且跳过随后 blur commit；IME composing 不当作 Enter |
| 聚焦/控制 | `Am/op` | 根据 actor/prop/camera 类型与当前模式判断资格；菜单 Control 面向 actor/prop，camera 进入 possession；结束冲突 session，播放时阻止进入 |
| 落地/恢复摆放 | `d4/lb` | 使用实体变换编辑事务和真实 support surface；camera 有自己的编辑路径 |
| 复制 | `d4` | `history.begin("director","director.duplicateEntity")` → 克隆定义/状态 → commit → markOwnedContent → 选中新实体 |
| 锁定/解锁 | `Am` | 已有动画的未锁实体不能直接锁定；菜单禁用状态要说明原因 |
| Remove | `e4/Am/Qc/m1` | 根据基准/独立状态区分全局删除和当前状态移除，级联清理关联数据 |
| 角色姿态/颜色 | `U6/nE/oE/aE/d4` | 默认 builtin actor 提供姿态；颜色/材质是事务；姿态修改先决定 base、selected-key、time-key，必要时确认新建时间 key |
| 平面图空白右键 | `Ym/u4` | 保存 clientXY 和 world surface point；清空实体选中；放置模式不能再次打开菜单 |
| 添加角色 | `Ym/i4` | 已有 character roles 或新建 role 草稿（label/color/neutral gender/官方模型），实例落在当前合法状态 |
| 添加摄像机 | `Ym` | Place here/选择地面/从当前视角创建；场景基准禁用摄像机并有说明 |
| 添加模型 | `qk/g3` | 生成历史、示例库、几何体、上传、生成分组；基准共享与独立状态专属提示不能省略 |

菜单 `Xi/Qz/Jz` 通过 body portal 固定定位，client 坐标偏移 8px、边距 8px，根据测量尺寸夹紧；outside pointerdown capture 关闭，但不关闭同组子菜单；Escape 使用输入优先级 lease；退出内容 inert。`Ve` 执行后通常关闭，除非 disabled、defaultPrevented 或 closeOnSelect=false。

`Un` 子菜单支持 hover、点击、focus/blur 保持组内访问，关闭延迟 180ms，依据触发按钮与父菜单边界摆放，按钮有 `aria-expanded`。此函数没有独立方向键 handler；不能把推测的方向键行为写作已证实官方契约。实现阶段需统一键盘焦点、Escape 次序、右键/Ctrl-click、触发器恢复焦点，并通过实际操作验收。

`k$` 的 topView/onSet/controlling、readonly、playing、scrubbing、sceneEdit 等状态约束需要由显式 policy 派生。输入租约要仲裁菜单、放置、相机、实体控制、时间编辑，避免一个按键触发两种操作。完整视觉参数应从 scoped CSS/原图/icon paths 提取，再逐态对照；不直接导入全站 CSS。

## 5. 平面图、命中、拖放与表面

平面图不是把 v2 摄像机换成正交投影。`WorkspacePlanView:wo` 使用真实场景渲染配置、平移/旋转/缩放和 SVG markers/轨迹/FOV；pointer down 建立 projection snapshot，随后解析表面，负责 pointer gesture lease、结束与取消。

| 命中策略 | `Je/In` 契约 | 使用场景 |
| --- | --- | --- |
| projection-plane | 与通过 projection.target 的平面相交 | 无实体深度的投影平面操作 |
| preserve-depth | 与通过实体 anchor 的平面相交 | 拖动保持对象深度 |
| top-down-support | 投影取得 xz，再求 collider 支撑表面，可选 ground fallback | 平面图放置/落地 |

client→normalized 由 `_t` 依据 view rect 处理，context 保留 `nx/ny/projection/resolveSurface`。空白点击取消阈值 `Yr=4`。`UC` 屏幕命中半径包括 camera 24、marker 22、bend 18、path 26px；优先级依次为 path 10、marker 20、selected camera 30、path control 35、camera FOV 40、trajectory key 45。不能把所有可见线和 marker 交给单次世界 raycast。

`EnvironmentLightingPickerContent:ar`（导出 n，workspace alias Hv）向下求 collider/scene mesh 支撑面，过滤 normal.y 的可站立阈值，选最高支撑，允许地面 fallback。`Ut`（导出 i，alias $v）处理视口射线：direct-surface 比较 collider/mesh/ground 最近命中；support-surface 委托支撑解析。返回 `{point,normal,source:"collider"|"mesh"|"ground-plane"}`。不得仅保存 point，normal/source 是后续底部锚定和重放的输入。

`GC` 的放置拖动 begin history → preview 只创建一次 → 根据起点/终点计算朝向 → commit/markOwnedContent；cancel 恢复事务，不残留 entity/state。`wV` hover 用 rAF 合并，只有主按钮开始，pointerup/cancel 结束并清理 listener。`SV` 区分 hover 和 selection outline，mesh ownership 由 render graph 解析。

本地 `studio-placement.mjs` 已有 ray、真实 mesh/ground 命中和 preview/session-state 检查，但只返回 point，actor/camera 强制 groundOnly；`scene-picker.mjs` GPU 选择保留 alpha/depth，可复用选择底层，不能代替上述物理支撑解析。新增落点测试需覆盖台面/叠层、斜面、墙面、无 collider、ground fallback、缩放/旋转资产底部对齐和拖动取消。

## 6. 导入、生成、资源与拍摄

### 6.1 模型导入与渲染

`h3` 官方上传只接受非空 `.glb`，最大 **100 MiB**（`Pje/Ije`），MIME `model/gltf-binary`；upload → downloading → succeeded，底部锚定，未能放置则回滚上传 URL。本地旧片场上传上限 40 MiB，v2/world GLB 加载上限 12 MiB，world SPZ 64 MiB。不能沿用 12 MiB 却宣称对齐 100 MiB。

V3 导入边界建议独立声明：兼容官方 UI 的 100 MiB GLB 文件限制，同时增加解码超时、内存/并发保护与资源释放；该建议需要实施时完成性能验证。已有 v2/world 限制保持原样。SPZ 世界来源通过 world resource 适配，不冒充 GLB 上传成功。

`_N/KW.placePropAsset` 在 renderable 真正加载后执行排队的表面/底部对齐；加载完成前不记成功。场景 render graph 区分世界源、角色、道具、摄像机 helper、annotation 和 selection outlines；helper/gizmo `captureExcluded=true`。渲染错误必须给出失败原因，可重试且无幽灵实体。

### 6.2 生成请求与状态机

`m3` 构造 TEXT_TO_WORLD + `TRIPO_TEXT_TO_MODEL_H3` 或 IMAGE_TO_WORLD + `TRIPO_IMAGE_TO_MODEL_H3`，传入 prompt/images/tripoParams。`Dge` 从 model metadata 验证型号，经主 index 的 `WOl → Nvs → Cvs/xvs` 转换，再由 `vOl` POST **`api/conversation/v2/generations`**。请求为 `type:"3d"`、provider/model/context、`threed_params:{threed_type:"object", ...}`；Tripo 选项由 `awa` 转换。

文本模式：prompt trim 后非空，禁止图片和视频；图片模式：恰好一个非空图片输入，禁止视频。`Dge` 必须收到 `data.task_ids`，无 task ID 明确失败。官方 context 包含账户 user/org 和 canvas/node；本地只注入本地 owner/session，不复制账户标识。

`p3` 固定 generation operation、目标 stage/setup、基准或独立来源以及 `{point,normal,source}`；epoch 过滤旧回调，源改变关闭输入。状态链包含 queued/pending/running → 非当前状态时 ready → placement downloading → renderable 成功后 succeeded；失败保留 error 与 retry/resubscribe，缺少 backend task ID 的恢复明确失败。`u3` 从 generated_threed/Tripo PBR/outputs 提取真实模型 URL、glb/spz、thumbnail 和 bottom anchor；`zy/s3/eC` 检查目标与 operation ID，防重复放置。

本地已有 `server/generation-tripo.cjs` 和 task gateway；拟议 UI 经该 gateway 的 mock mode 接口验证，不增加第二套 provider。模拟结果必须标记 mock；queued/running、已拿到 URL、已创建占位实体都不等于生成成功。真实 provider 接入、计费、账户、分享、营销不在当前实现范围。

### 6.3 拍摄输出

`w2` 使用真实 capture，直接 `exportToCanvas` 添加图片节点，最多 5 个并发待添加结果，按成功/部分失败反馈。`historicalPhotos` 为旧照片只读画廊；新的照片不再保存为 Studio 内历史相册。`qx` 保存的 view/shot 是结构化相机与机位关系，不是图片 blob。

本地复用 `scene-capture.mjs` 的 LocalAssets 入库→画布节点→CanvasStore.flush 顺序；V3 将 capture source（viewfinder/camera possession/key edit）、owner/source/setup/time/view 关联一同保存。要验证取景器与最终图片构图一致、helper/outline 不进入图片，失败不留下无图节点，关闭期间的迟到结果不写到另一片场。视频能力应另设阶段，已有 v2 视频导出不能证明导演时间轨道的视频正确。

## 7. 本地复用映射与新增边界

“可复用”表示源码上具备基础，不表示本轮运行通过。所有 module paths 相对仓库根；新模块名称是实施建议。

| 现有模块/资源 | 复用范围 | 必需适配/新增 |
| --- | --- | --- |
| `studio.mjs` | 入口调度、已存在 actor/camera loader、关闭保存处理 | 仅增加明确 V3 分支；旧 objects/setup 拷贝结构不承接新 WorldSpace |
| `studio-placement.mjs` | ray/preview、本地 asset/catalog 访问 | 新 `surface-hit.mjs` 返回 normal/source，支撑面策略、统一拖动事务；不修改旧模式约定 |
| `studio-library-data.mjs` + `assets/studio/*` | 本地分类 GLB/WebP/scale、角色/摄像机二进制 | URL/catalog adapter；目录项、缩略图、比例需逐项比对，未声称全目录一致 |
| `src/features/studio-v2/model-io.mjs` | GLTFLoader、Draco/Meshopt、primitive、dispose 思路 | 新代际导入预算和资产生命周期；不直接复用 12 MiB 上限 |
| `src/features/studio-v2/scene-import.mjs` | target/source/revision/session fencing、局部资源验证 | V3 stage/setup/operation/source snapshot guard；源资产保持原始元数据 |
| `src/features/studio-v2/generated-models.mjs` | job ID 去重、真实输出保留、在线/离线目标处理 | 显式支持 V3 binding，写入 entity definition + setup state；v2 行为保留 |
| `src/features/studio-v2/scene-picker.mjs` | alpha/depth 正确的 GPU object selection | entity ownership/render graph、plan SVG hit priority，支撑命中单独实现 |
| `src/features/studio-v2/scene-motion-controller.mjs` | 插值/相机编辑经验、现有运镜 UI 资源 | entity-owned tracks、稳定 keyId/timeMs、base/selected-key/time-key 决策；不直接 alias animationIndex/keyIndex |
| `src/features/studio-v2/scene-capture.mjs`、`shot-renderer.mjs` | 真实图像、资源保存、渲染隔离技术 | V3 director frame/capture source、helper 排除、画布关联与关闭 guard |
| `src/features/world-node/entry.mjs`、`resource.mjs`、`materialization.mjs` | 世界资源、GLB/SPZ 下载、本地 ownership、timeout/abort/late dispose | V3 source adapter；预算/碰撞体/metricScale 与 source identity 独立规范 |
| `src/features/agent-scene/studio-bridge.mjs` | 工具审计与显式 capability、字段校验 | 新版本/capability，stage/setup/entity/key ID；明确 position/rotation/time 单位，未支持字段继续拒绝 |
| `window.CanvasApp/CanvasStore/LocalAssets` | 本地 owner node、资源、持久化 | 保存 envelope adapter，事务延期 flush、关闭失败恢复、原节点删除 guard |
| `server/generation-tripo.cjs` | 现有 text/image gateway、明确版本配置 | mock transport/request 合同、状态恢复；已有 provider 代码不等于真实验证 |

官方 compiled JS 使用 React、主 index 中的 Three/UI/auth 别名和运行时 store；当前项目已有 Three 0.186、Spark 2.3.1、esbuild，没有按原入口加载这些 bundle 的完整运行环境。不能原样 import monolithic module 后称其可用。

可直接保留：已核对的 GLB/PNG 二进制、SVG path、颜色/布局数值。可提取并保留函数逻辑：projection/surface math、schema reducer、patch diff、hit priority；必须替换别名 imports，验证本地 Three 版本和坐标约定。React UI 则按当前原生模块结构重建，复用官方结构/行为/样式参数，不新增 React。全站 CSS 拆分并限定 `.studio-v3` 作用域。

## 8. 实施阶段与端到端验收门槛

建议目录 `src/features/studio-v3/`，遵循 domain→runtime adapters→UI 的单向依赖。每阶段先完成完整链路再进入下一阶段，不能以“面板已出现”代替完成。

| 阶段 | 拟议模块与产物 | 必须走通的验收 |
| --- | --- | --- |
| P0 入口/数据/存储 | `entry.mjs`、`schema.mjs`、`world-space.mjs`、`history.mjs`、`ownership.mjs`、`persistence.mjs` | 世界源创建独立 owner → 打开真实空场景 → 建基准/独立状态 → 修改/撤销/取消 → 关闭重开；未知 schema 拒绝编辑，旧/v2 节点保持原入口 |
| P1 实体与渲染 | `runtime.mjs`、`render-graph.mjs`、`asset-loader.mjs`、`entity-actions.mjs` | 本地道具进入基准 → 新 role/actor 进入独立状态 → 相机实例；切状态按基准优先+独立实体合并渲染；复制唯一 ID，锁定限制，remove 和 global delete 完整级联 |
| P2 平面图与输入 | `plan-view.mjs`、`plan-projection.mjs`、`plan-hit.mjs`、`surface-hit.mjs`、`placement.mjs`、`input-leases.mjs`、`menus.mjs` | 同一位置在 plan/viewport 找到可站表面；按住拖摆方向，up 只记一笔，Esc/pointercancel 零残留；右键边缘夹紧，子菜单跨界保持，重命名 Enter/Escape/IME 正确 |
| P3 时间/实体控制 | `temporal.mjs`、`timeline.mjs`、`entity-control.mjs`、`camera-session.mjs` | 独立状态建 key → 非 key 时修改姿态触发确认 → 确认/取消各正确 → 播放与 scrub 真实场景 → 播放时禁写；camera possession 与控制退出还原输入，不串 session |
| P4 导入/模拟生成 | `model-import.mjs`、`generation.mjs`、`generation-ui.mjs` | GLB 上传有效/无效/超限/取消；mock 文本/一图请求 → queued/running → 非当前 setup ready → 回到目标下载/放置 → 加载成功；retry/reopen 只有一个实体，源改动不落旧目标 |
| P5 取景/画布输出 | `capture.mjs`、`viewfinder.mjs`、`ui.mjs`、`styles.css` | 相机 view/焦距/比例 → 截图真实像素 → LocalAssets→图片节点→flush→关闭重开仍可见；无 helper/outline，失败可重试；逐态截图与官方参考对比 |
| P6 Agent/回归 | 现有 bridge 增量适配 + 定向验收记录 | 显式 V3 capability、stage/setup/entity/key；读取→编辑→捕获→保存；相同关键路径同时由 UI 和 Agent 走通，旧/v2 不误路由，mock 未发供应商请求 |

P0–P5 构成首个交付闭环。P6 不能通过宣称原 v2 bridge 支持新代际跳过；视频和旧节点迁移另设后续任务。生产依赖、公开工具契约或持久化迁移如需变化，应在实施前提交具体方案，本文不授权这些变更。

### 必须留证的失败/恢复矩阵

| 触发 | 预期结果 | 验证证据 |
| --- | --- | --- |
| 加载时换 source/删除目标/切片场 | 拒绝写入，迟到资源释放；资源本身可保留在原画布 | 前后 owner/source/revision 和实体数量、资源释放记录 |
| 拖动时切 setup、Esc、pointercancel | cancel 整笔事务，无幽灵实体/key/history | 状态快照、undo 数量、场景截图 |
| 当前 lane 撤销与更晚另一 lane 重叠 | 返回 conflict，未更改数据 | 两 lane patches/sequence/touched 对照 |
| upload/decode 错误、无模型 URL、task ID 缺失 | 明确 failed，不能 succeeded；retry 不复制实体 | task trace、operation ID、实体 ID、错误 UI |
| ready 结果所属 setup 未激活 | 保留 ready，激活目标后再放置 | 不同 setup entity states 与任务状态 |
| flush 失败、正在拍摄/生成时关闭 | 不假报保存；保留修改并可重试；不串新会话 | reopened 状态和资源、关闭重试记录 |
| readonly/基准/播放/文本输入/IME | 不越权修改、不误触快捷键、不错误建 key | 实际键鼠操作与状态前后对照 |
| 图片入库或画布写入失败 | 不留下不可读图片节点；可重试 | 资源可读性、node/source links、持久化结果 |

UI 证据至少覆盖 topView/onSet/controlling、menu/submenu、placement、role/color/pose、baseline/independent、key edit/play/scrub、generation pending/ready/failed、loading/empty/error、保存失败和长中文。需以真实 WebGL 页面操作与截图验证；源码阅读、HTTP 200、静态检查均不等同于运行验收。

## 9. 已关闭缺口与仍未验证的部分

已关闭的具体缺口只有：基础角色、摄像机模型的本地二进制资源缺失。`assets/studio/character.glb` 与官方 `world-model/characters/character.glb` 同为 3,294,764 bytes、相同 SHA256；`assets/studio/camera.glb` 与官方 `world-model/director/camera.glb` 同为 14,948 bytes、相同 SHA256。无需重复生成或复制。

官方角色 clip 名含 Standing、Idle、Sitting、Sitting Floor、Crouching、Kneeling、Sleeping Side、Sleeping Supine、Lying Prone、Sleeping Supine Straight、Walking、Walking Backward、Jump、Running；资产相同仍需检查实际 clip 选择、混合与时间播放。本地 tree.glb SHA256 为 `53c86be67f9283ede7ae203a9ed0b69006411df10248dd9d7026727f781e5912`，官方树来源是远程 URL，未比较字节。示例分类、缩略图、scale 仅确认本地存在，未做全目录逐项相等认证。

未关闭：新代际入口/WorldSpace/history/persistence adapter、完整菜单与输入仲裁、plan projection/hit priority/support surface、entity tracks、generation 生命周期、拍摄新语义、逐态视觉。本文没有执行官方或本地运行链路，没有真实供应商生成验证，不能称 V3 已实现或完整还原。

## 10. 源码证据清单

官方资源根：`/Applications/TapNow.app/Contents/Resources/web/assets/`。下表 SHA256 对原始文件字节计算；读取辅助文件在 `/tmp/tapnow-*.js`，由既有 esbuild 展开，其行号不作为官方源码行号。定位采用原始文件中的导出/函数名；附录中的行号从 1 开始，字符偏移从 0 开始（Unicode 字符，不是 byte offset）。安装版本更新后须重算并重新定位。

| 官方原始文件 | bytes | SHA256 |
| --- | ---: | --- |
| `ThreeDOverlay-akWGliiq.js` | 5299 | `531a0b81890bc1aae86a557786f8366d6ac8441cd0530c8fea5a14a9a80078bc` |
| `ThreeDWorkspace-BzPphAqB.js` | 919292 | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| `WorkspacePlanView-HeQ7o6cq.js` | 55090 | `b71be13b4f56e74d4e5fa7a41a43402070ec2366bf8156d65940c952ddbc735e` |
| `course-api-base-url-CGXqZmAy.js` | 3444954 | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| `page-DVqoHdTT.js` | 1785533 | `8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86` |
| `index-BsHyQ2qj.js` | 12943515 | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| `world-object-spatial-metrics-B9CCwPzJ.js` | 2337 | `921daef1e9d52eb5d7d4fe322c465dd9964b267ac6ca219e942876d385086564` |
| `world-object-camera-framing-CAbqcro9.js` | 78897 | `62fd36b27ff8aaac02f44332e545334d8e9bf92abe7d2b4f1b5b5f69565c8f27` |
| `WorkspaceViewfinderButton-BHqIWibq.js` | 99329 | `4497c9f0e4be6e4290257ecc1f2b18f18ecf405c3f4d8587139082acc33947e0` |
| `EnvironmentLightingPickerContent-CigxxFZu.js` | 94564 | `b9b06fd215e4a951798c1b88e32842fe71aac5a94f57f7128d5eaf6aa8f9d8e8` |
| `ThreeDActivityOverlay-CIotE4kO.js` | 5521 | `2c4c2f2137cb343da081df58245c214fe7ad262341e0f0f024277ed5174ee933` |
| `three-d-overlay-asset-downloads-CDh6thZC.js` | 2034 | `bd7dbec17a985cdc08088d0ccc812f422c4a96f71bf13a9718ed2762ba141fef` |
| `index-CF4eb3PV.css` | 666332 | `332cb65e334bd1b6cea0eafae238093ec0bfda5e9b62132941387445a687a52d` |
| `world-model/characters/character.glb` | 3294764 | `2a9cad40a4625a695f4c3b87bb4d93cad8fd1d5d38783fc2414e577157d122bf` |
| `world-model/director/camera.glb` | 14948 | `00f5a46007aee91cf8a9accd2584ad83b7dc3ce2396c1dd325ff61c3304004e7` |
| `camera-control-bg-BWXIpVpf.png` | 4096 | `19fb68a14e5ce8cd0293a2806801d557cff8582959939404ec9bef899fa705b1` |

### 原始源定位（行号@字符偏移）

| 文件 | 符号与原始定位 |
| --- | --- |
| `page-DVqoHdTT.js` | `Cve` 187@1700575 |
| `ThreeDOverlay-akWGliiq.js` | `q` 2@4660 |
| `ThreeDWorkspace-BzPphAqB.js` | `kp` 548@917274；`KW` 7@282869；`Nr` 2@15305；`u1` 2@16086；`Qc` 2@17611；`m1` 2@18840；`S1` 2@22190；`Sf` 2@25210；`Xj` 2@60861；`Am` 7@362360；`V6` 548@753714；`Ym` 376@549055；`GC` 376@498313；`k$` 548@903712；`p3` 7@401485；`h3` 7@407909；`u3` 7@400620；`w2` 7@189537；`qx` 7@245003 |
| `course-api-base-url-CGXqZmAy.js` | `bT` 281@1463420；`fq` 281@1466967；`mq` 281@1467551；`_v` 281@1463257；`Rq` 593@1527219；`cOe` 593@1527397；`gdt` 593@1527957；`RFe` 593@1516935；`Dge` 81@386028 |
| `WorkspacePlanView-HeQ7o6cq.js` | `Je` 1@4400；`In` 1@5411；`wo` 1@44327 |
| `EnvironmentLightingPickerContent-CigxxFZu.js` | `ar` 1@53236；`Ut` 1@56642 |
| `index-BsHyQ2qj.js` | `vOl` 5366@6709623；`WOl` 5370@6904695；`Nvs` 5370@6904434；`xvs` 5370@6901492；`Cvs` 5370@6901955 |

复核示例（macOS，读取原始安装文件）：

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/TapNow.app/Contents/Info.plist
shasum -a 256 /Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js
shasum -a 256 assets/studio/character.glb assets/studio/camera.glb
```

本文未引用记忆或旧运行截图作为新代际验收；静态事实与拟议实现已分别标注。
