# 摄像机历史适配器

`camera-history-adapter.mjs`把 `camera-edit-session.mjs` 的作者事件接到项目已有 history 和真实 `reduceEntityAction`，使 entry 只负责组装 runtime／session／UI。它不创建相机，不管理输入或 viewport lease，不访问存储／网络，也不接管 temporal key 作者。

```js
const adapter = createCameraHistoryAdapter({
  getState: session.getState,
  history: session.history,
  onLane(lane) { lastLane = lane; },
  onStatus(status) { refresh(); }
});

const runtime = createStudioV3Runtime({
  // 其他参数沿用现有集成。
  onCameraEdit: adapter.handle
});

// 正常关闭先完成／还原 runtime 操控，再清适配器。
adapter.dispose(); // 仅放弃本地 owner，绝不替调用者提交／取消 history。
```

`handle(event)`同步返回字面量 boolean。支持 begin/preview/commit/cancel；成功状态通知 `{status:'ready',phase,entityId}`，失败通知 `{status:'failed',phase,entityId,message,error}`。onLane 在 begin 成功后收到 lane 字符串。observer 异常不会回滚已经成功的领域操作；handle 防止 observer 重入作者动作。

## 资格、owner 与事务

begin 读取当前领域状态，只接受当前独立 setup 的 local、visible 摄像机。拒绝场景基准、独立状态中共享基准摄像机、缺失本地 camera、playing/scrubbing，以及该摄像机已有非空 keys 的轨道。空轨道不是已有关键帧。资格判断沿用 `resolveEntityControl`；不能把无法处理的 key 编辑降级为 base。

没有已有 owner／外部事务时，begin 调用 `history.begin(c.stateLane,'摄像机操控',{kind:'world-space'})`。只有返回 true 才记录 `{entityId,worldNodeId,stageId,setupId,transaction:{lane,label,scope}}`。begin 被拒绝不会记 owner，因此之后的 cancel 不会触碰外部事务。

preview 必须匹配原 entityId 和活动事务 descriptor，并重新验证当前 world/stage/setup 与摄像机资格；原 target 改变时拒绝写入。camera 和 transform 以完整合法字段接入真实 reducer；不能混入 renderer metadata 或无效 JSON。

commit/cancel 只处理自己记录的活动事务。终止 callback 返回 true 才清 owner；false 或异常保留 owner，并返回 false，让 camera-edit-session 保留主体供重试或还原。`history.preview`返回 false 是接受的空改动，handle 返回 true；session 的 dirty／no-op 判断负责避免空 commit。

cancel 不依据新的 activeSetup 寻找写入目标，也不跑领域 reducer；它取消已开始的原 history transaction。因此正常 setup 切换前可以完成／还原旧 owner，不能直接向新状态写旧 pose。

## lookAt 的原子删除

optics-only 保留 tracking；pose 改变的 session 事件带 `clearLookAt:true`且完整 camera 中不再含 lookAt。适配器在**同一次** `history.preview` reducer 内执行：

1. clone 原目标 camera，`delete camera.lookAt`；通过 `patchEntityState`建立合法的字段删除。
2. 执行 `reduceEntityAction`，同时验证完整 camera 与 plan transform 的一致性。

reducer 合并缺失字段的旧行为不会把 lookAt 补回来。第二步失败时 history 不接受候选状态，因此第一步删除也不会泄漏。不传 null/undefined 充当删除字段；`clearLookAt:true`与仍包含 lookAt 的 payload 是矛盾输入，直接拒绝。

## checkpoint 与生命周期

拍摄 `checkpoint`沿用 commit/cancel 事件清适配器 owner，camera-edit-session 保留 possession／viewport lease，并设 transactionOpen=false。此时真实 `StudioSession.flush`能保存拍摄态。下一次真实修改才再次 begin；之后 cancel 只还原下一段，不撤销已拍摄历史。

checkpoint 后如其他作者开启事务，适配器无 owner，任何直接 cancel 都拒绝；camera-edit-session 的闭事务退出不会调用适配器。重开 begin 被外部事务阻挡时，最后接受的 optical camera 保留，外部事务不变。

`dispose`不取消 history，不读新领域状态，不绕过 ownership guard。正常关闭顺序应先 runtime.finish/cancel 成功，后 dispose；ownership/source 失效时，宿主强制释放 viewport/input/GPU 资源并放弃旧 session。适配器不能为已失效的 `StudioSession`越权回写或伪造取消成功。

## 当前 descriptor 能力边界

项目 `history.getActiveTransaction()`目前只返回 lane/label/scope，没有 transaction ID 或 generation。适配器逐项匹配这三个字段并匹配自己的 entityId；不同 lane、label、scope 的后续事务都被拒绝。

如果外部代码跳过适配器取消原事务，再开启**相同 lane、相同 label、相同 scope**的事务，现有 history API 无法区分。此适配器的 owner 合同适用于已知 host 路由：摄像机事件统一由此适配器处理，其他模式在 handoff 后开自己的事务，不私自结束并重建摄像机事务。不能声称 descriptor 匹配等同不可伪造的事务 identity。

本适配器没有独立 getFence。source/session ownership 由真实 `StudioSession.history`的 guard 和 runtime camera-edit-session 的稳定 fence 执行；不能把 raw history 引擎用于生产后声称仍拥有持久化 ownership 防护。

## 验证

```sh
node --test tests/studio-v3-camera-history-adapter.test.cjs
```

11 个专项使用真实 `createStudioSession`、history、`createCameraEditSession`与 reducer：optics 保 lookAt／pose 清 lookAt、单 commit 和真实 flush、原始状态 cancel、删除与矛盾 plan pose 的原子失败、资格拒绝、外部事务与三字段 descriptor 拒绝、失败终止重试、checkpoint 再 begin、后续事务隔离、仅放弃本地 owner 的 disposal、observer 异常以及 literal false 的拒绝与成功状态通知。未重跑其他摄像机／runtime 专项；浏览器交互属于宿主集成验收。
