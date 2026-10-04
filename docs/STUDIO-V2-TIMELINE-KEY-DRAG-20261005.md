# 片场时间轴关键帧捕获与运镜身份

本批闭合时间轴拖动的指针捕获与文档身份缺口；不代表片场全部交互与视觉已完成。

## 官方依据

官方发布 `eb1c3578957450302e3cff5edd2ad253d0874421` 的 `page-BLLZVxQI.js`，可读副本 `reference/studio-v2-page-readable.js`：

- `442–450` 的 `Gs/mr`：时间草稿夹在相邻关键帧之间，邻帧间隔0.001秒，末帧上限7200秒；不是限制在原运镜duration以内。
- `752–757` 的 `seekMotion`：预览切回选定camera animation、暂停并更新播放时间；保留选中关键帧。
- `764–768` 的 `selectMotionKey`：时间轴按下选中对应关键帧并暂停/seek；第二参数false仅避免聚焦世界，不意味着取消选择。
- `1462–1477` 的 `La`：只处理当前按钮持有capture的move；开始记录文档身份，mouseup只有当前文档仍为该文档才提交；pointercancel、lostpointercapture及Escape清空时间草稿。取消不回退已经预览的播放时间。

官方包为设计依据，本地QA只验证实现。最初将drag预览推断为取消关键帧选择，经精读上述两函数撤回；本批保留选中与原关键帧参数面板。

## 实现

`timeline-key-drag.mjs` 管理单一拖动草稿，按按钮、pointerId和capture过滤事件。Three动画在本地原位修改，因此以content、clip对象、editor index、cameraId和revision共同对应官方不可变文档身份；同名运镜不能凭名字视为同一文档。

`motion-ui.mjs` 接入控制器，预览使用现有 `ScenePlayback.seekMotion` 保证回到选中camera animation。只有有效同文档release调用原 `MotionEditor.move`，继续使用真实Float32轨道、统一历史与原保存路径。刷新时间轴、关闭/销毁编辑器、Escape及指针取消清空草稿；旧按钮迟到的取消事件不能清掉新按钮的手势。取消先清草稿再释放本按钮仍持有的capture，避免lostpointercapture重入；diamond恢复已保存时间位置，播放时间继续保留。

没有添加图标、光学控件、供应商接口、依赖或公共API。

## 验证与公开复现

```sh
node --test tests/studio-v2-timeline-key-drag.test.cjs tests/studio-v2-timeline-key-drag-qa.test.cjs tests/studio-v2-number-field.test.cjs tests/studio-v2-viewport-shortcuts.test.cjs tests/studio-v2-scene-panel.test.cjs
node src/features/studio-v2/qa/generate-timeline-key-drag-app.cjs
```

27项定向检查通过，其中本批11项真实生产MotionUI/SceneRuntime/ScenePlayback/MotionEditor回归及2项QA检查。覆盖正常单笔历史、非本指针/无捕获过滤、丢捕获/取消/Escape不提交、clip/content/revision变化拒绝、同名运镜切换与旧事件不能影响新手势、对象预览切回camera、末帧越过旧duration。真实GLB生成/重新解析验证两段同名运镜有不同姿态与一致原时间。

入口：`http://localhost:4173/src/features/studio-v2/qa/timeline-key-drag-main.html?session=timeline-manual`。从正式index接入实际CanvasApp、StudioAPI和WebGL，独立IndexedDB与页面内偏好存储。模型/API和外部请求在发送前拒绝，CSP限制网络/iframe。

1. 点击“准备并打开真实片场”，导入真实GLB并经正式运镜入口打开A。A/B名称相同，B位置X较A加10。
2. “记录轨道与历史基线”；实际拖动第2关键帧，松开只改A对应镜头轨道并追加一笔历史，保存revision最终跟上。
3. 再拖第2关键帧并按Escape，diamond返回已保存时间，轨道/历史/revision不变；播放时间保留，选中关键帧仍保留。
4. 打开A并记新基线；点击“下次拖动350ms后切换同名B”。按下并拖动任意关键帧持续超过350ms，QA通过正式入口切B；松手后两段轨道保持基线，不出现错误或迟到旧提交。
5. 末关键帧可以拖到旧duration之外；正常release通过原Move/Float32路径延长duration。
6. `window.StudioTimelineKeyDragQA.read()` 与可见回执记录全轨道、history、revision/savedRevision、playback target/index/time和motion index/selected。

主线程 Computer Use 使用实际GLB、正式WebGL/运镜入口：第2关键帧从1秒拖到1.1971831321716309秒，只增加1笔历史，savedRevision跟上revision=2；下一次拖动Escape后轨道及undo均不变，选择保留，播放时间保留预览的1.338028202594166秒。再次持有拖动时通过正式入口切同名B，松手后A/B全轨道JSON等于基线，undo仍为1，播放目标camera/index=1/time=0，无错误。

[真实片场与运镜截图](screenshots/studio-timeline-key-drag-20261005.jpg)。本批未重复刷新片场和全GPU能力验收，持续指针与身份边界以本次实机和专项回归为限。
