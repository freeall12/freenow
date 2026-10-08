# 时间轴宿主适配器

`temporal-workspace.mjs` 连接导演片场的作者会话、渲染器和 `timeline.mjs`。参考依据是本地官方安装包的时间轴作者路径及官方网页；不包含营销、团队或分享功能。

## 状态与权限

- `session.getState()` 始终返回持久作者状态。播放、循环和拖动播放头不会写入它，不会产生历史记录、脏状态或每帧时间戳。
- `displayState` / `renderState` 返回当前显示的采样状态。入口须把这个读取器传给 runtime，并在作者变化后调用 `onAuthorStateChanged()`，再同步 `displayState`。
- `sampleTemporalSetupState` 是唯一的采样实现。宿主不重新实现插值、曲线、旋转或镜头光学计算。
- 当前单轨依次选择正在操控的实体、实体选择、有效选中关键帧的实体。实体没有轨道时仍显示可保存首帧的轨道描述。
- 时间轴仅属于独立状态。场景基准中的普通实体编辑继续走实体作者 reducer；独立状态中继承的基准实体不可写。
- 作者目标在输入前固定：有效的自身选中帧优先；没有自身帧时编辑 base；时间点上已有帧时编辑该帧；其余时刻创建 time-key。首次隐式创建先确认，取消不改变作者状态。显式“保存为关键帧”直接保存。
- 取消隐式关键帧确认后恢复进入对话框前的暂停构图和播放头，作者 base 和历史保持不变；来源、状态或完整编辑 fence 已改变时不恢复旧构图。
- 片场、场景、状态、来源、所有权和编辑版本组成宿主 fence。异步准备和确认完成时重新检查。每次自己产生的 preview 更新 fence，但不能取消外部事务。
- 已确认的镜头帧授权在纯保存回执增加 persistence revision 时仍有效；`editEpoch`、来源、状态、所有权变化仍使它失效。拍摄前没有新输入的 checkpoint 只取消空历史事务，保留相同帧授权和相机接管。

## 入口合同

```js
const temporal = createTemporalWorkspace({
  getState: () => session.getState(), session,
  getRuntime: () => runtime,
  readCurrentSelection: () => selectedEntityId,
  select: id => selectEntity(id),
  refresh: refreshChrome, notice,
  getSourceKey: readCurrentSource,
  getBusy: () => capture.busy || capture.pendingReceipt || batch.busy || batch.pendingReceipt,
  isCurrent: () => session.isCurrent(),
  isHidden: () => document.hidden,
  onLane: lane => { lastLane = lane; }
});
temporal.mount(timelineContainer, {getReturnFocus: () => timelineButton});
// runtime getters use temporal.displayState; callbacks use the three bridges:
// onTransform/onControl => temporal.handleTransform(event, label)
// onCameraEdit => temporal.handleCameraEdit(event)
// canEditAnimatedEntity(id) => temporal.isPrimed(id)
```

`getBusy` 应包含外部拍摄、待保存回执、批量发布和其他独占模式，不应包含宿主自己的 history transaction 或 timeline 的拖动候选。

| 接口 | 合同 |
| --- | --- |
| `mount(container, {getReturnFocus}?)` | 创建和插入时间轴 DOM，返回可刷新、取消和销毁的视图。 |
| `read()` | 提供真实时长、阻止缩短的最晚关键帧、播放头、循环状态、单轨及作者回调。 |
| `setVisible(bool)` / `visible` | 显示或关闭时间轴；关闭播放预览会恢复作者状态。 |
| `seek(ms, options)` / `setPlaying(bool)` / `setLoop(bool)` | 所有显示采样都保持作者状态不变；异步 seek 由 playback controller 隔离。同 fence 下被较新 seek 替换的请求返回 `{ok: true, superseded: true}`，真实阻塞仍返回 false。 |
| `endScrub()` | 等待最后的 pointer seek 和渲染队列结束后暂停，避免 pause 读取旧帧并覆盖最终播放头。 |
| `beforeWrite()` | 结构编辑、撤销/重做、切换状态、创建和关闭前停止播放并等待渲染及恢复；清理准备的作者目标。 |
| `prepareEntityEdit(action)` | 异步停止显示预览、固定 update 的作者目标，并完成必要确认；不写作者状态。 |
| `applyEntityEdit(prepared, patch?)` | 在原 fence 下应用已准备的实体编辑，一次 history change。 |
| `entityAction(action)` | 前述两个方法的入口封装；定义编辑和非 update 动作继续走原实体 reducer。 |
| `primeTransform(entityId)` | 操控/变换/摄像机操控前先 await；获准后显示固定目标的样本，返回布尔。 |
| `handleTransform(event, label?)` / `handleCameraEdit(event)` | 同步 begin、preview、commit、cancel 桥接。每个连续操控只产生一个历史事务。 |
| `getSubject(entityId)` / `isPrimed(entityId)` | 读取显示样本和已确认的目标授权；镜头拍摄 checkpoint 后继续保留同一帧的操控资格。 |
| `beforeCapture()` | 先提交 runtime 摄像机 checkpoint，再 await 此方法。暂停并 drain，保留准确采样画面；返回 `{ok, timeMs, release}`。拍摄完成或失败均在 finally release。 |
| `getTemporalStatus()` | 提供播放、拖动、编辑、确认和拍摄状态，用于入口输入隔离。 |
| `dispose()` | 同步关闭新输入，取消自己的事务，等待正在准备的资源及预览恢复，再销毁时间轴。 |

## 操作与历史

轨道提供选择、保存、删除、删除轨道、匀速重新分配和关键帧拖动。删除空轨道、清理值引用、邻帧移动边界、最小时长及曲线维护都由 `temporal-actions.mjs` 决定。

关键帧拖动先使用 `onBeforeKeyMoveStart` 等待暂停预览恢复，随后同步取得 `{onMove, onEnd, onCancel}` 事务 lease。preview 不写历史栈，end 只提交一次，cancel 恢复开始前的键、通道和曲线。UI 负责取消等待期间已失效的指针候选，宿主负责源和作者身份校验。

摄像机操控的 `clearLookAt` 转为合法的 `camera.lookAt: {mode: 'none'}`。在关键帧上保存为 `camera-look-at` hold 值，以覆盖继承目标；移除通道值会回落到旧目标，不能用于清除跟踪。

## 渲染和拍摄边界

首次预览先等待 `runtime.sync(author)` 完成资源加载，再捕获原生 root 和 camera 对象；这样 loading record 变为 ready 后第二帧仍使用同一 lease。默认恢复只在 runtime、graph、source、record、root、camera 及会话 fence 都匹配时同步作者状态。来源过期后不把旧状态同步到新场景。

播放中的 UI 更新约每 32ms 刷新时间轴，播放模式变化立即刷新入口。逐帧 apply 的 busy 状态不禁用暂停按钮。

拍摄 lease 阻止播放、seek 和作者写入，但不改变作者状态。照片模块重试已有待保存回执时不需要重新获取拍摄 lease。保存元数据是否包含 `timeMs` 由拍摄模块负责。

## 验证

```sh
node --check src/features/studio-v3/temporal-workspace.mjs
node --test tests/studio-v3-temporal-workspace.test.cjs
```

专项使用真实 schema、temporal reducer 和 history engine；覆盖轨道优先级、确认与取消、键目标固定、单事务拖动、基准编辑、来源变更、拍摄采样隔离、镜头 canonical none、原生资源首次加载、时长阻塞与轨道清理。真实 `createCameraEditSession` 与 `createStudioSession` 的 ownership/persistence 回归通过异步作者同步验证 50mm 首先写入原关键帧，拍摄 checkpoint 和保存后保留同一相机接管对象，随后仍可编辑该帧；纯 revision ack 可继续，外部 editEpoch 改变会撤销授权。完整浏览器交互和截图验收由入口集成阶段负责。
