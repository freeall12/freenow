# Agent 图片图层跨组移动 · 2026-10-03

这是本项目高级 Agent 的本地能力扩展，不宣称官方图层 UI 已有跨组拖放。当前实际 UI 的 `image-editor-entry.mjs` 图层栏只列出顶层，拖放调用 `canvas.moveObjectTo`；既有 Agent 同父级创建/解组已存在，本次没有重做。已捕获官方参考见 `image-editor.md`，仅确认图层排序等，不足以声称官方跨组交互。

## 合同

Purpose：在真实打开的 Fabric 文档内，将一个图层或整个 Group 移至另一直接父级，同时保留叶子作品的画板变换和 ID。

Inputs：`image_editor_edit`，`action: "reparent"`；沿用 `nodeId/sessionId/expectedRevision`，另需 `objectId`、显式 `parentObjectId`（Group ID 或 `null` 表示画板根层）及整数 `index`（目标直接子层底到顶插入槽，0 至目标子层数量）。不接受任意 Fabric JSON、URL 或代码。

Outputs：普通 summary/revision/dirty/changed，加 `movedObjectId/previousParentObjectId/parentObjectId/index`。`read.capabilities` 增加 `groupReparent/groupReparentRequiresPlainAncestors`，`groupChildActions` 包含 reparent；既有 `groupSameParentOnly` 仍专指 group 创建动作。

Permissions：沿用已有写工具确认、会话版本和来源节点保护，不隐式解锁。对象、移动子树、来源祖先、目标组及目标祖先锁定均拒绝；目标组已有锁定兄弟保持不动。临时 ActiveSelection 包装的锁也拒绝。

Failure modes：缺失/重复 ID、非 Group 目标、同父级（请用 reorder）、自身/后代循环、无效 index、不可逆变换、内部辅助对象、来源组仅剩最后一个子层、旧版本/来源变化/取消均拒绝。最后一个子层不隐式删除其父组，应显式解组或移除组。

Logging：沿用工具 trace 与上述移动回执，不新增永久任务账本。单次成功只调用一次现有 editor.record；另调 image_editor_save 才写生产存储。

## 变换与视觉边界

准备阶段将既有作品解码成独立真实 Fabric 树；调用 Group 的 remove/insertAt 与标准 layout 转换父平面。顶层 ActiveSelection 变换先投影到画板平面。所有暂存变更通过版本和取消校验后才替换 live 树，采纳失败恢复旧树；异步准备失败不修改当前画布或历史。

组的 fit-content 边界和中心允许重新计算，但叶子作品的画板矩阵保持（专项容差 1e-8）。JSON 序列化浮点有有限舍入，不要求浮点字符串逐字相等。

矩阵等价不自动等于像素等价，因此采用保守拒绝：

- 来源与目标的全部祖先（包括共同祖先及当前 ActiveSelection 包装）必须可见、opacity=1，无 clipPath、shadow、backgroundColor 或非 source-over 合成。
- 来源/目标直接容器涉及的兄弟子树必须没有非 source-over 图层合成，避免改变隔离边界后擦除或混合影响其他对象。若一端是根层，会保守扫描该画板相关根对象子树。
- 包装状态不总在保存 JSON 中，故在暂存完成、采纳前再次校验当前 live 层级，阻止等待期间新增的包装透明度等效果。
- 被移动子树本身的普通对象样式及内部效果保持；改变父级与插入槽会按用户显式指定改变堆叠关系，重叠对象可能遮挡不同。这不是承诺任意换层后整图像素不变。

## 验证及范围

`node --test tests/image-editor-agent-group.test.cjs`：15/15（11 既有、4 新跨组专项）。新增覆盖旋转/非均匀缩放/翻转/斜切/嵌套 Group、组→组/组→根/根→组、多次移动后的单撤销、重做与真实 Fabric JSON 解码；来源/目标锁、循环、槽位、空父组和合成效果拒绝；版本/来源变更、取消、布局失败；ActiveSelection 开始时及等待期间的整体透明度拒绝。保存回执在 Node 专项使用明确的存储适配器，不作为生产 IndexedDB 实测证据。

`npm run build:image` 成功。两个生产模块和 QA 脚本语法检查通过。独立只读复核确认普通 ActiveSelection 可移动，opacity=.4、锁及异步期间新增 opacity 均拒绝。

真实浏览器 QA：`/src/features/image-editor/qa/reparent.html?session=reparent-1003-native`。完整当前生产应用壳、真实 Fabric/agent bridge、隔离 IndexedDB、页内 Map 偏好设置；不读写或清理旧 localStorage。原始 fixture 矩阵固定存储于 QA 数据，刷新后仍可核对。按钮顺序：打开→琥珀层移到目标组→撤销→重做→保存→关闭重开；输出 parent/index、实际 history 增量、叶子矩阵最大误差及无限画布节点世界坐标。可刷新同 session 继续检查生产保存。

## 主任务实际浏览器补证

主任务通过 CUA 实际操作并反馈以下结果，本分工仅记录，没有重复验收：

- 打开真实生产图片编辑器，将琥珀色图层由 `inner` 移至 `target-group` 的 `index: 1`。真实 parent 树改变，history 从 1 增至 2，单次操作只新增一个撤销记录。
- 全部叶子作品的画板矩阵最大误差 `5.684e-14`；无限画布节点世界坐标始终为 `(52000.25, -1800.5)`。
- 前后截图肉眼确认五块几何作品非空、位置无漂移；右侧 Group 缩略图反映成员变化。这是本 fixture 的视觉检查，不是任意混合效果或全站逐像素一致性证明。
- 撤销恢复原 parent 树，矩阵误差为 0；重做后保存返回 `saved: true`、`currentMatches: true`。
- 关闭重开，以及整页刷新后再次打开，parent/index 仍保持，`dirty: false`，矩阵误差 `5.684e-14`。

本机截图：`/tmp/freenow-reparent-before-20261003.png`、`/tmp/freenow-reparent-after-20261003.png`、`/tmp/freenow-reparent-reloaded-20261003.png`。截图路径作为实机记录，不纳入公开仓库资源。

QA 调用真实生产 bridge/Fabric 和保存链路；没有调用 LLM，不能据此宣称真实模型编排已验证。共享 schema 与中文回执的 5 项专项由主任务执行并通过。此条操作闭环验收完成，普通图层 UI 仍未新增跨组拖放，也不宣称官方已有同一交互。
