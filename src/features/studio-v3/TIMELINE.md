# 导演时间轴 UI 合同

`timeline.mjs` / `timeline.css` 是独立原生 DOM 组件。领域、真实场景采样、播放控制、摄像机编辑交接与 history 事务均由宿主负责；组件只展示当前轨道并管理菜单、焦点、拖动 lease 和隐式关键帧确认。

## 官方依据与范围

静态来源为安装包 `ThreeDWorkspace-BzPphAqB.js` 的 zV / x7 / k7 / Y6 / d7 / h7 / Km / zn；格式化参考位于 `reference/studio-v3-ui-20261008/ThreeDWorkspace-BzPphAqB.js`。源 A k7 字符偏移为 774080。中文来自安装包 `index-BsHyQ2qj.js` temporalBlocking 字典，且主线已现场确认“测试版”“播放时间调度”“定位时间轴”“按匀速重新分配”等入口。

- 官方只展示一条当前轨道：controlled entity → selected entity → selected key owner 的优先级由宿主选择。没有全轨表格或轨道选择下拉。
- 控件顺序：播放/暂停、循环、时间刻度与 key dots、按匀速重新分配、保存为关键帧、删除所选关键帧、时间轴操作菜单。
- 显式保存关键帧直接调用保存，不弹创建确认。非 key 时刻的隐式姿态/镜头写入才通过 Pr/Km 确认“开始时间轴？”或“创建关键帧？”。
- 现有官方 UI 没有缓动菜单、录制开始/停止或时间轴摄像机设置开关的可见消费者。schema 的 linear/hold 和空间曲线路径属于领域采样；本组件不制造这些未证实入口。

## 工厂与读取

```js
const timeline = createTimeline({
  read: () => host.timelineDescriptor(),
  onPlayheadChange: (ms, options) => host.seek(ms, options),
  onPlayingChange: playing => host.setPlaying(playing),
  onLoopingChange: looping => host.setLooping(looping),
  onScrubEnd: () => host.endScrub(),
  onDurationChange: ms => host.setDuration(ms),
  close: () => host.closeTimeline(),
  getReturnFocus: () => timelineTrigger,
  onError: error => host.showError(error)
});
container.append(timeline);
```

所有顶层操作回调和 `read` 必须提供。`close`、`onError` 和 `getReturnFocus` 可省略；frame 调度器 `requestFrame`、`cancelFrame` 仅用于专用测试注入。

`read()` 返回官方 panel 形状的扁平 descriptor：

```js
{
  setupId, visible: true, available: true,
  readOnly: false, baseline: false, canAuthorTemporal: true, busy: false,
  durationMs: 3000,
  durationMinimum: {kind: 'system', durationMs: 1000},
  // 或 {kind:'blocking-key', durationMs, timeMs, trackLabel}
  playheadMs, playing, looping, playbackShortcutAvailable,
  structureEditingDisabledReason: null,
  track: {
    id, entityId, kind: 'actor', label, selectedKeyId,
    keyItems: [{id, timeMs, moveRange: {minTimeMs, maxTimeMs}}],
    authoringDisabledReason: null,
    onSelectKey: keyId => host.selectKey(entityId, keyId),
    onSaveKeyAt: ms => host.saveKey(entityId, ms),
    onDeleteKey: keyId => host.deleteKey(entityId, keyId),
    onDeleteTrack: () => host.deleteTrack(entityId),
    onRedistributeTimingForUniformSpeed: () => host.redistribute(entityId),
    onBeforeKeyMoveStart: (keyId, {signal}) => host.prepareKeyMove(keyId, {signal}),
    onKeyMoveStart: keyId => host.keyMoveLease(entityId, keyId)
  }
}
```

`track` 可为 null；也可用 `id: pending:${entityId}`、空 keyItems 表示实体尚无轨道。actor、camera、prop 共用合同。轨道能力回调都可省略，对应按钮禁用或隐藏；宿主必须只对实际符合官方连续运动要求的轨道提供 redistribution callback，不能仅按 key 数量伪造能力。

`durationMinimum` 必须按整个 setup 所有 tracks 的最高 key 算出，最低 1000ms；不能只看当前显示轨道。组件缩短 1000ms，遇阻塞 key 停在 minimum；延长到下一个整秒。未提供 duration 时初值 3000ms。

顶层动作和普通 track action 允许异步，false / `{ok:false,message}` / throw 表示失败，保留 UI 并显示错误。void 被视为官方 setter / wrapper 的成功通知。seek 不阻塞播放或 RAF，宿主必须保证异步预览采样的最新请求与所有者隔离；异步拒绝会显示错误。

## 关键帧拖动

`onKeyMoveStart(keyId)` 必须同步返回以下 lease，或在无法开始时返回 null/false：

```js
{
  onMove(timeMs),  // preview 相同宿主事务
  onEnd(timeMs),   // 应用终点并 commit
  onCancel()      // cancel / rollback
}
```

这三个 lease 回调必须同步，void / true / `{ok:true}` 表示接受，false / `{ok:false}` / throw 表示失败。组件不操作 history 本身。拖动阈值严格大于 4px；RAF 只保留最后移动值，使用 keyItems.moveRange 限制范围。

- 发生移动的 pointerup 只提交一次最终位置，并以 `{animated:false,preserveSelectedKey:true,previewMode:'viewing'}` seek。没有移动则取消空 lease，后续 click 正常选 key。
- pointercancel、lost capture、局部 Escape、blur、页面隐藏、scope/权限/结构状态变化会取消 lease。相同所有者 seek 回原 key 时间；所有者已经变化时不向新状态 seek。
- preview 或 commit 拒绝时尝试 rollback。rollback 拒绝会保留本地 drag lease，Escape 可重试，不能显示为成功。
- 轨道删除、状态切换和 dispose 移除旧 DOM 的监听器；过期节点与菜单不能执行新轨道的动作。

`onBeforeKeyMoveStart(keyId,{signal})` 是本地宿主异步准备能力，不增加官方 UI 控件。可用于等待 paused viewing preview 的实际复原完成，再取得上述同步 history lease。其间组件 capture pointer 并缓存最后位置；若准备期间已经移动并 pointerup，成功准备后仍提交该首次手势终点；未移动的 pointerup 取消候选而不新建空 history。Escape/cancel/所有者变化会 abort signal，之后准备结果不能开启旧事务。准备期间宿主 busy 可为 true，真正 begin 时必须已恢复可写。宿主应允许自身 preflight 的 `timeline.dragging`，避免将输入隔离标记误用为拒绝自己的条件。

## 时间定位与权限

刻度 slider 具有真实 aria min/max/now；ArrowLeft/Right 以 500ms 定位，Home/End 定位边界。pointer scrub 按 inset18 的真实 rail 宽度映射时间，持续请求 previewMode=scrubbing，结束为 viewing 并调用 onScrubEnd。官方 scrub cancellation 结束 scrub，但不恢复原 playhead。

readOnly、baseline、canAuthorTemporal=false、available=false 隐藏/拒绝 UI。busy 阻止动作。播放期间允许 pause/loop/seek/key selection，禁 save/delete/move/redistribute/duration。导演实体操控的 structureEditingDisabledReason 禁 move/delete/track-delete/duration，仍可 save 和 select；playbackShortcutAvailable=false 时不绑定 Space。锁定轨道禁 authoring，但不阻止 setup duration 的合法编辑。

Space 仅在有效能力与可见时间轴下绑定，过滤 IME、repeat、原生编辑字段和其他局部工具作用域。按钮自身 disabled 以外，所有处理器再次读取宿主当前状态，避免 stale closure 绕过权限。

## 隐式关键帧确认与输入隔离

```js
timeline.requestKeyCreationConfirmation({
  intent: {entity: {id, label}, impact: {timeMs, willCreateTrack}},
  onConfirm: () => host.applyPrepared(prepared, {confirmed: true}),
  onCancel: () => host.cancelPrepared(prepared),
  returnFocus: originElement
});
```

有 intent 时方法返回 false，直到用户显式确认才调用 onConfirm；无 intent 时直接调用 onConfirm，返回 true。确认失败保留对话框；取消同步调用 onCancel 恢复未接受的修改，失败保留以便重试。宿主必须让 prepared mutation 自身验证 state ownership 与时刻，不能把 UI 确认当作绕过领域检查的授权。

确认的标题、描述和按钮使用官方中文词条。隐藏时间轴也能呈现确认，同时隐藏 bar；只读/基线/播放时拒绝并调用 cancel。Escape 先取消确认、再取消 drag/scrub、再关菜单，最后通知 close。确认 Tab 保持按钮焦点；取消/确认后恢复 `returnFocus` 或原 focus。原目标不可用时可用工厂 `getReturnFocus()` 返回宿主时间轴 trigger，确保隐藏 bar 的确认也能恢复可见焦点。

只读 getters `timeline.confirming`、`timeline.dragging`（包括异步 preflight）、`timeline.scrubbing` 供宿主仲裁输入。UI 外部对象/相机字段产生的隐式编辑可共享这个确认入口，无需先打开时间轴。

## 生命周期、样式与验证

`timeline.refresh()` 用新 descriptor 刷新；key DOM 保持稳定，避免播放更新丢焦点。`handleEscape()` 提供宿主已有 Escape 优先级接入；`dispose()` 清 RAF、ResizeObserver、全局按键/blur监听、菜单与 key 节点监听，并取消未完成交互。宿主还需关闭真实 temporal controller、放弃未提交 prepared edit，并在卸载之前处理关键域 rollback 失败。

capsule 为48px、padding4/left6、width min(92vw,640px)、gap2、margin-right−12；bar 180ms 延迟/280ms 入场且尊重 reduced motion。scale 高40/最小148/inset18；key hit20、dot8/selected12，y33；刻度为安装包间隔规则与9px label。窄屏换行是本地防溢出补齐，不能宣称为官方移动端截图验收。

```sh
node --test tests/studio-v3-timeline.test.cjs
node --check src/features/studio-v3/timeline.mjs
```

专用 DOM tests 使用已安装 fabric 下的 jsdom，不增加依赖。累计 19 cases 覆盖官方几何与中文、播放/循环/Space、seek与scrub、单轨 key CRUD 能力、duration minimum、控制/锁定/readonly gates、同步drag rollback、异步首手势准备、确认/focus/Escape、过期节点与dispose、异步seek失败。初批后只重跑变更涉及的专项 cases。DOM 测试不证明真实 runtime 时间采样、GPU 播放或官方应用视觉一致性；主线负责接入与 CUA 验证。
