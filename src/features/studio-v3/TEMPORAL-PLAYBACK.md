# 导演时间轴的渲染预览与播放

`temporal-playback.mjs`是独立的render-only controller。它从捕获的作者状态反复生成新的采样快照，串行调用宿主渲染adapter；不dispatch、不写history、timestamps、View、素材或playhead领域字段。角色、道具、摄像机使用同一套原始temporal采样数学，未选择摄像机也可以预览。

## 原始采样接口

```js
const {state, setup, entityStates, timeMs} = sampleTemporalSetupState(
  authorState, {setupId, stageId}, timeMs,
);
```

`stageId`可选；setup必须为independent。`timeMs`需finite，以round并clamp>=0；这个pure函数不截断duration，越过最后key保持末值。controller的seek另外clamp到duration。`setup`是有效baseline+local setup快照，`entityStates=setup.entityStates`；返回state是另一个独立领域快照，只替换目标setup的本地entityStates并激活stage/setup、清activeView。源作者state、baseline优先级、时间戳全部保持。

现有`sampleCameraShotState`复用此入口，再执行严格linked camera资格校验，返回合同仍是`{state,camera}`。曲线、64-chord弧长计时、四元数最短旋转、log focal插值与discrete/hold通道没有另造一份数学。

作者工具还可复用两个纯几何接口，输入须为schema已验证track：

- `temporalPositionPathSegments(track)`返回used position keys相邻段，含from/toKeyId、from/toTimeMs、interpolation、p0/p1/p2/p3、bend、straight、lengths（曲线65个累计弦长值）、length。无position通道返回[]。
- `resolveTemporalPathSplit(track,timeMs)`只接受严格内部区间，端点/区间外返回null。t是弧长反查后的Bezier参数；left/right bend point分别是既有曲线`curvePoint(t*.5)`与`curvePoint(t+(1-t)*.5)`，两者bend.t=.5。返回值与源track分离，不修改路径。

## 宿主接口

```js
const playback = createTemporalPlayback({
  getState: () => authorState,
  getFence: () => ({owner, editEpoch}),
  getSourceKey: () => sourceIdentity,
  isCurrent: () => ownsScene(),
  isHidden: () => document.visibilityState === 'hidden',
  autoSchedule: false, // 复用runtime已有RAF时由draw调用tick(timestamp)
  capturePreview: ({state}) => captureNativeInstancesAndOptics(state),
  applyPreview: async ({state, setup, entityStates, timeMs, lease, assertCurrent}) => {
    assertCurrent();
    await applyRenderGraphSnapshot(state, lease);
    assertCurrent();
  },
  restorePreview: async ({state, lease, reason, isCurrent}) => {
    // 有效时可重用graph.sync；过期时只能清理lease捕获的同实例。
    await restoreSameNativeInstances(state, lease, {reason, current: isCurrent()});
  },
  onChange: status => updateTimelineUI(status),
  onError: error => showTemporalFailure(error),
});
```

`getFence/getSourceKey`必须返回JSON值，无身份时用null。每次session同时固定worldNodeId、activeStageId、activeSetupId；owner、来源、editEpoch、setup变化都会拒绝继续应用。生产宿主必须提供有意义的fence，不能只验证entityId。

`capturePreview`可选，默认null，必须同步捕获native引用与需要复原的pose/optics，不接受Promise。lease为opaque值，可以含Three实例；controller不序列化它。宿主restore必须验证捕获record/root/camera仍是同实例，不能把旧快照套到同ID的新资源，更不能在isCurrent=false时sync旧作者state到新source。

`applyPreview`/`restorePreview`必需，可异步。controller串行执行，合并尚未开始的seek；adapter在自己的await前后调用assertCurrent，防止旧请求在异步资源等待后继续改变graph。完成的快照通过previewState暴露。渲染snapshot仍符合领域schema，但仅用于graph分支，不能送到领域持久化入口。

## 控制与状态

| 接口 | 行为 |
| --- | --- |
| seek(ms,{scrubbing=false}) → Promise<boolean> | finite时间clamp到[0,duration]；保留render-only预览，playing时重新定位clock anchor |
| play() → Promise<boolean> | 从当前time继续；在末端重播从0开始；duration=0返回false |
| pause() → Promise<boolean> | 按当前clock结算采样，再停RAF；保留已采样的entity和optical状态 |
| stop(reason)/exit()/cancel(reason) → Promise<boolean> | 同步停止调度并拒绝旧application，等待pending apply后恢复作者状态；恢复期间blocksWrites保持true |
| setLoop(bool) | 默认false；切换时以当前cycle重新anchor，避免关闭loop时跳到末端 |
| setSpeed(number) | positive finite，否则1；切换保持当前playhead连续 |
| tick(timestampMs) → Promise<boolean> | 同一now时钟的时间戳；loop modulo；非loop到duration停止，保留最后帧 |
| refresh() → Promise<boolean> | owner/source/editEpoch/setup/hidden变化时cancel并restore，未变时true |
| dispose() → Promise<void> | 同步禁止新请求、停止RAF；等待apply+restore drain，返回值始终resolve |
| whenIdle() → Promise<void> | 等当前队列，始终resolve；原操作Promise仍报告错误 |

getter：`active/playing/blocksWrites/previewState/disposed/status`。status包含active、playing、scrubbing、timeMs、durationMs、ended、loop、speed、busy、blocksWrites、disposed、error。作者writes必须由宿主在blocksWrites时拒绝；模块本身不截获领域commands。pause保留preview，因此仍锁author write；需要修改作者内容时先exit并await恢复。

默认autoSchedule=true时只在playing且无pending apply/restore时安排一个RAF。seek/pause/stop后不空转。autoSchedule=false时controller从不创建RAF，runtime在playing时调用tick，按需继续请求frame。宿主还负责document visibility listener调用refresh/cancel（隐藏时取消是本地生命周期增强，未发现官方隐藏窗口自动pause证据）、输入leases、camera preview lease与摄像机切换过渡。

## 渲染与摄影兼容

预览可对现有RenderGraph的同entity实例apply transform/visibility/pose/optics/lookTarget；不更改asset descriptor，因此ready graph无需重载。无法找到actor姿态clip时既有graph仍明确失败；controller恢复作者state并报告错误，不伪造姿态支持。heldEntityId等通道可采样进快照，其实际画面效果受既有RenderGraph能力约束。

摄影必须拍摄一个稳定采样时间：宿主先pause/seek并await whenIdle，再取得camera与完整snapshot，暂停其它渲染tick，按实际目标尺寸settle SPZ，再renderPhoto。readback期间不得恢复或推进时间轴；关闭时必须先await摄影drain和temporal drain，才能释放graph/GPU。模块不擅自决定摄影是否允许在播放中调用，不自动获得renderer lease。

## 官方证据与本地实现边界

静态来源`/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`：

- `jV`约568836（performance.now优先，fallback Date.now；未内置lastClock防回退）：duration round>=0、speed正finite否则1、默认speed1/loopfalse；play/seek带now；pause按clock；nonloop末端playingfalse/endedtrue，loop为`(raw%d+d)%d`归一化，非loop clamp0..duration。
- `FV`约569876、`LV`邻域：末端play回0，播放handoff camera edit/清selected key；temporal preview持有camera lease，scrub结束进入viewing并保留preview。
- `OV/NV`邻域：UI发布约32ms节流，但frameTick仍逐frame采样。宿主可在onChange端节流UI，不应以领域dispatch驱动画面。
- `zV`约582xxx：关闭timeline先pause/endScrub/exitPreview；setup/source变化重置时间0、loopfalse并释放preview。
- live输入leases排除camera drag/wheel/movement capture/view rotation；h7 scrub的首帧animation、后续RAF无animation与左右±500ms/Home/End键是宿主UI/镜头lease合同，独立controller尚未证明这些接入行为。

路径helper公式依据同文件`bm`210392／`wF`212160／`py`213701的静态拆段与64-chord查表；本地测试只证明shared math，不构成官方UI操作验收。

## 新鲜验证

```sh
node --test tests/studio-v3-temporal-playback.test.cjs
```

2026-10-08专项10/10通过：camera-free全实体采样、baseline precedence与作者不变；真实Three RenderGraph同root/camera上的pose/transform/scale/visibility与optics预览和恢复；RAF按需、speed/loop/end/pause、loop关闭连续；异步seek合并、stop/dispose drain、owner/source/editEpoch/setup/hidden边界与clock回退的非loop clamp/loop归一化、过期application拒绝、手动tick、失败恢复、shared curve split。

测试使用真实Three对象与RenderGraph，loader/RAF受控，不创建WebGL。runtime入口、输入锁、camera preview动画、timeline UI键盘/鼠标、SPZ实时排序、摄影中冻结时间和最终像素内容仍需主分支集成验收。本模块没有修改runtime/entry，没有增加依赖或提交。
