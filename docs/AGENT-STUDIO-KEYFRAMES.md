# 片场 2.0 Agent 关键帧

## 接口与范围

现有 `scene_keyframe` 继续接受 `time`（0–120 秒）和可选 `entityId`。未指定对象时优先使用当前选中对象，其次使用拍摄镜头；未提供 `pose` 时保存调用时该对象的当前姿态。

新增可选字段：

- `pose: { position?, rotation?, scale? }`：每个字段均为三个有限数字；只覆盖提供的字段，其余沿用目标动画在 `time` 的姿态。
- `space: "parent-local" | "world"`：默认父级局部坐标。世界姿态会根据目标时间的父级动画转换到对象局部轨道。
- `animationIndex`：显式指定已有动画。省略时优先当前匹配动画，其次唯一匹配动画；多个候选时明确报错，无候选时创建动画。

Agent 旋转单位始终为 **XYZ 弧度**；`agent-scene/studio-bridge.mjs` 转为内部编辑器使用的度。不需要通过 `scene_update` 强行修改已有动画相机。

支持相机、模型、骨骼、光源及包含这些内容的组。纯空组、只有相机后代的组暂不支持普通对象播放，明确拒绝。`scene_read.supportedKeyframeKinds` 和 `animations[].cameraIds/keyframeTargets` 暴露实际范围及对象关键帧时间。

## 无动画相机闭环

在已经创建并选择相机后，依次提交：

```json
{"time":0,"entityId":"<camera-id>","pose":{"position":[0,1,4],"rotation":[0,0,0]}}
```

```json
{"time":2,"entityId":"<camera-id>","pose":{"position":[2,1,4],"rotation":[0,0.35,0]}}
```

第一帧建立真实单帧静态动画，第二个不同时间点后才形成运动。成功时选中该动画、暂停在写入时间；可立即调用 `scene_capture` 检查真实画面，或在片场播放/拖动时间轴后再次拍摄。播放控制工具由独立接口负责，本模块不假装启动外部生成服务。

返回 `{entityId, animationIndex, time, duration, times, space, playing:false}`。时间以 Float32 标准化，同一时间替换，不插入重复关键帧；相邻可表示的时间不会被近似比较合并。`times` 包含影响目标的父级变换关键帧，`keyframeTargets` 则列出每个实体直接绑定的轨道时间。

## 数据完整性

- 编辑在 rest pose 文档副本和克隆动画上预演，并实际导出 GLB 验证。验证失败、零父级缩放、不可表达的剪切和过期 revision 均在替换现场前拒绝。
- 相机沿用 `motion-data.isolateCamera` 克隆整条父级分支，保留相机实体 ID；原父级、原对象轨道不被覆盖。
- 普通对象只写目标自身 position/quaternion/scale 轨道，不改其他对象或父级轨道，也不修改父级缓动元数据。
- 成功应用记录一次完整文档撤销，再调用现有 `flush` 保存。持久化失败会抛出错误并标记 `applied=true`、`entityId`、`animationIndex`；现场修改保留可重试，不报告保存成功。
- 副本文档复用几何与材质，替换时不销毁这些仍在使用的资源。

## 依据和验证

官方参考：`reference/studio-v2-page-readable.js` 的 `motionHistoryEntry/changeMotion/editMotionKey`（约 770–817 行）提供文档快照、姿态编辑后定位时间、错误提示和统一撤销的行为依据。这是本地 Agent 工具扩展，不能据此宣称官方提供相同原生 API。

本轮最小复现使用真实 Three.js mixer 和 GLTFExporter/GLTFLoader，已验证：

- 空相机两个姿态、弧度转换、中点插值、同时间替换、一步撤销、实际 GLB 导出重载。
- `qa/studio-v2-edit-motion.gltf` 的共享父级相机世界姿态修改；原父级及对象轨道逐值保持。
- 普通对象共用动画但分别保持独立轨道；运动父级下世界坐标转换。
- 非法数值、零父级缩放、保存期间 revision 变化不会污染内容或撤销历史；持久化失败诚实报告已应用状态。

2026-09-30 后续真实浏览器记录已补齐：相机 0/2 秒关键帧创建、同时间替换及撤销、播放/暂停、1 秒中点插值、越界请求无变更，以及 0/1/2 秒实际 PNG 拍摄和刷新后资源/连接恢复。普通对象也已验证独立关键帧、中点姿态和 stop 后基础姿态恢复。详见 浏览器证据与边界（开发机来源：`reference/studio-v2-agent-keyframes-playback.md`）。此次文档更新仅整理已有记录，未重新运行测试。

普通对象的完整关键帧编辑面板仍未完成；现有 UI 主要提供对象动画播放/暂停，不能将工具可执行等同于时间轴、关键点拖动、删除及缓动交互均已完成。复杂骨骼、多动画组合及全部编辑交互仍需继续验收。

本地关键帧、播放与拍摄无需供应商 Key。本轮未调用 LLM、生图或生视频服务；外部生成接口未配置时保持 `configuration_required`，不会伪造成功媒体。直接工具验证不能替代接入 Key 后的模型自主编排长链验收。
