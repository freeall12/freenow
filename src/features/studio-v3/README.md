# V3 片场领域基础 · 2026-10-08

**本目录只实现独立的纯领域内核。P0 生产入口与保存重开闭环未完成，P1–P6 仍未完成。** 没有接入 `studio.mjs`、画布 UI、Three.js 渲染、浏览器存储、生成供应商或 Agent 工具，也没有迁移任何旧节点。V3 是本项目代际名称；参照的 TapNow 0.4.81 导演工作区与官方 V2 独立模型编辑器并存。

## 实现范围

| 模块 | 职责 |
| --- | --- |
| `invariants.mjs` | 有路径/错误码的领域错误，纯 JSON 检查、结构相等及克隆；拒绝循环、非有限数、访问器、命名数组字段和稀疏数组 |
| `schema.mjs` | `schemaVersion=4` 的展开内存状态；stage、基准/独立状态、role、entity、setup state、view 构造；校验唯一 ID、所有者、stage/setup/role/view/reference/output/temporal 关系 |
| `world-space.mjs` | 不修改输入的领域操作；建立舞台/状态/角色/实体/view，实体/状态编辑、基准优先渲染状态合并、设置时间数据、实体全局/当前状态移除、view 移除及级联清理 |
| `history-patches.mjs` | 集合成员及 setup state 的逐项 forward/inverse patch、setup metadata、环境字段、source/room/active selection 补丁，原子重放与 touched/生命周期依赖 |
| `history.mjs` | 一个活动事务、preview/commit/cancel、world 与每 setup 的历史 lane、每 lane 50 条记录、全局 sequence、跨 lane undo/redo 冲突 |

所有导出都是未接入生产的内部模块接口，不构成新公开 API 或工具能力。

## 数据约束

内存 envelope 为 `{schemaVersion:4,scenePlay:{id,worldNodeId,worldSpace,environment,editSessions},capturedPhotos,worldGenerationTasks}`。新领域构造器保留官方默认 ID：`stage-default`、`setup-default`、`setup:state-1`；其他 stage 的基准 ID 是 `setup:${stageId}:default`。

每 stage 必须有且仅有对应 ID 的基准、至少一个独立状态；所有 stage 属于同一 worldNodeId。entity definition 独立保存 asset/label/role，setup state 保存 transform/visible/lookTarget/heldEntityId/camera。actor 角色与实例分开，角色关联必须属于同一 stage。相同 entityId 可存在于不同独立状态，状态内不能重复；独立状态不能持有基准实体 ID，也不能为基准实体添加时间轨道。`renderSetup` 返回基准优先与独立实体合并的拷贝。

view 必须关联独立状态；sourceCameraEntityId 若存在，必须是同 stage 的 camera。reference targets 和 output 的来源 view 必须存在。look/held/camera/temporal target 不允许缺失或跨 stage。时间 track 归属当前独立状态中的实体，keyId/timeMs 唯一，channel value 必须指向现存 key 并满足字段类型。

位置/变换使用数值 xyz，Euler 旋转为弧度、camera fov 为角度、时间为整数毫秒。不会把 v2 的 animationIndex/keyIndex 或旧对象数组隐式映射为本领域实体/时间数据。

`assertState` 只接受 schemaVersion 4，拒绝旧版/未来版和不支持字段，不执行迁移或容错丢弃。这里验证的是**展开的内存域**：尚未实现官方紧凑 temporal 序列化（channel key index 等）、官方包的反序列化、云 schema 修复、编辑 session/生成任务/历史照片语义或本地 persistence adapter。因此不能把成功验证一个本地构造状态当作读取任意官方 schema 4 存档的承诺。

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

撤销/重做检查所有已应用 lane：存在更新且触及相同环境/空间/entity/setup/view 等数据的记录，则返回 conflict。局部 setup state 修改只写对应 setup；两个 setup 修改同一个 entity definition 的各自状态仍可以分别撤销。创建/删除的生命周期依赖会额外阻止悬空关系，例如后来创建 actor 使用 role、后来选择新 stage、后来设置 lookTarget 引用新实体。环境 scope 由 `{kind:'environment',fields:[...]}` 指定；环境任意字段间保持官方保守冲突语义。

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

领域操作不访问源资源、权限、UI mode 或外部网络。未来 runtime 仍须施加 readonly、播放/放置/输入租约、源身份/revision/session fence、关闭保存失败恢复等约束；这里没有替代它们。

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

未跑全仓库测试/构建：没有生产集成、依赖或 bundling 改动。未进行浏览器/桌面操作、截图、模型生成、保存重开或视觉验收。下一步应由独立任务完成 P0 entry/ownership/persistence adapter，再走真实端到端；本轮不宣称 P0 完成交付。
