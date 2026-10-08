# 镜头管理独立组件

`createCameraManager` 只管理面板状态与DOM；宿主提供真实镜头、机位跳转、重命名、删除、缩略图与导出。没有新增依赖，不直接修改runtime、菜单控制器或schema。

```js
import {createCameraManager} from './camera-manager.mjs';

const panel = createCameraManager({
  read: () => ({
    shots: [{id, setupId, label, cameraId, camera, durationMs}],
    setupLabels: {[setupId]: '状态1'},
    readOnly: false,
    busy: false,
    playing: false,
    activeCameraId,
    pendingExportShotIds: [], // 宿主尚未持久保存的原批次，string shot ids[]
  }),
  openShot: async shot => true,
  renameShot: async (shot, name) => true,
  removeShot: async shot => true,
  loadThumbnail: async (shot, {signal, width, height}) => ({url, dispose}),
  exportShots: async shots => ({ok: true}),
  close: () => closePanel(),
  onError: error => notice(error.message),
});
```

返回 HTMLElement，附 `refresh()`、`dispose()`、`handleEscape()`。CSS自动加载并去重。宿主数据／busy变化时调用refresh；组件不会轮询或运行空RAF。

## 数据与结果

- `shots`保留宿主顺序；以`setupId + id`区分状态内镜头。分组标题来自`setupLabels[setupId]`，其次`shot.setupLabel`；镜头标题优先`label`，兼容`name/title`。
- `camera`可包含position/rotation/focalLength/fov/frameAspectRatio等真实字段，也支持扁平shot camera字段。durationMs或durationSeconds只有存在对应动画时才传；否则只显示`24 mm`等焦距。不能用planned duration假称动态镜头。
- 合法正数画幅保持真实缩略图比例；缺省16/9。焦距缺失时使用现有fov换算工具。预览数据必须来自宿主真实offscreen render。
- open/rename/remove回调接受完整shot，成功须返回true或`{ok:true}`，失败可throw Error或返回`{ok:false,message}`。read必须反映实际成功结果，组件不伪造删除或新名称。
- loadThumbnail收到clone后的shot与AbortSignal、320×180包围尺寸，返回URL或`{url,dispose?}`。宿主可按真实ratio调小实际尺寸，保证不拉伸。dispose用于归还Blob URL等资源；组件不生成假图、不下载远程图、不伪造渲染成功。

## 官方行为与布局

来源：安装包ThreeDWorkspace-BzPphAqB.js中A.m6/y6/R6/E6/gw/b6（约727910–7414xx），以及index-BsHyQ2qj.js shotManager中文键（约9164423），经源研究代理核对。

常规header“镜头管理”，有镜头才显示“导出到画布”。按状态分组；状态标题使用官方非baseline映射（Example State→示例状态，Default Setup→状态1，State/Setup N→状态N，空名→未命名状态）。镜头显示标题、`{focal} mm`，动态为`动态 · {duration} 秒 · {focal} mm`。

面板560px、最高620px、16px圆角与56px背景虚化；grid repeat(auto-fill,minmax(156px,1fr))、gap12，在常规560px下为三列；镜头缩略图保ratio，img contain/top；header、状态标题、item padding按源class；重命名/删除按钮28px，既有pencil/trash-2图标14px/1.75；导出既有file-export16px/1.9。

重命名自动聚焦全选，Enter/Blur只提交一次，trim空／同名不提交，Escape取消，IME组合键不提交。失败保留可编辑草稿与错误信息。

删除必须先显示280px、上方end、offset8的确认：“删除‘镜头名’？”（UI使用中文双引号）、“关联的机位和动画也会一并删除”、取消／删除。只有确认才调用removeShot，失败保留确认。若当前接管对应机位，宿主removeShot须先成功finish，再真实删除机位、镜头、动画关联。

批量header“批量导出”／“全选”；checkbox是原生input，视觉为18px圆标及check12px/2.5。全选只选全部镜头，不切换成清空。selection按宿主镜头顺序过滤导出，状态变更时剔除失效项。取消返回常规；没有选择时导出禁用；导出中显示“导出中…”且禁用操作；成功清选择返回常规，失败保批量与错误原文。

readonly隐藏整个组件；busy禁用open/rename/delete/selection/export，playing额外禁delete。HUD根有官方`data-world-workspace-block-movement-hotkeys="true"`，保证window捕获导航不消费面板方向键。Escape依次取消删除确认、重命名、批量模式，最后调用close；Escape/外点关闭不受busy限制。

## 宿主集成与失败恢复

角色dialog、焦点恢复、外点关闭由宿主surface/菜单控制器负责。普通冒泡键盘事件会由组件处理；如果现有菜单在document捕获阶段处理Escape，必须先调用`panel.handleEscape()`，才能保持确认→重命名→批量→close优先级。dispose在关闭后清监听与pending缩略图，迟到DOM结果被丢弃。

exportShots必须完成真实渲染、入画布及持久化，并持有幂等batch receipt。UI成功不等于仅创建节点；最终storage失败时不得返回ok。若失败Error含`applied/retryable/pending`，组件在当前批量模式冻结同一shots数组，只允许重试导出，回调仍必须凭receipt重试未完成保存，不能再创建一批节点。用户仍可Escape退出批量／关面板；宿主必须在组件dispose后继续保存receipt，重新打开时恢复路径由宿主负责。组件不能取消或删除已入画布的真实照片。

重新创建组件时，首次read可提供`pendingExportShotIds: string[]`。非空则自动恢复批量模式，按此数组顺序匹配当前shots并冻结原批次，显示“上次导出尚未保存，请重试保存”，footer变为“重试保存”。已有镜头的checkbox显示原选择且禁用，不能换全选或新批次。若任何原ID不存在，按钮禁用并报告具体缺失ID；不会将其他shot替补进批次。hydrate每个组件生命周期只执行一次，Escape退出后普通refresh不会强制再次进入批量；真正close/reopen生成新组件才恢复宿主receipt。

恢复回调仍是`exportShots(originalShots)`，宿主必须识别pending receipt并重试同outputs的未完成持久化，不能重新render或创建节点。只有最终保存完成才能返回true/ok:true并清宿主pending。组件本身不保存输出文件或照片节点。retry期间busy禁用动作，但Escape/关闭仍可用。

缩略图严格串行。机位/光学/版本签名变化或镜头删除时abort旧请求，以token阻止stale结果贴到当前镜头；场景角色/道具变化会影响offscreen画面，宿主应更新`shot.thumbnailRevision`（或updatedAt）以使已有预览失效。即使宿主忽略signal，仍等待当前任务结束后才开始下一请求。失败显示“预览不可用”与原clapperboard，无虚构图片。dispose归还已挂载及迟到资源。

## 验证

新增专项 `node --test tests/studio-v3-camera-manager.test.cjs`；涵盖官方分组/比例/图标、焦距换算、真实回调/权限、重命名边界、删除确认、批量顺序/selection失效、幂等恢复/重复点击、busy下Escape、串行缩略图/stale/dispose。DOM测试不能替代真实浏览器布局、真实offscreen缩略图与最终storage验收；这些由主线继续验证。

本批真实 UI 已补验重命名持久化、跳转、删除与撤销、层级 Escape／焦点、独立竖幅缩略图、批量保存失败后重开重试，见 [Computer Use 证据](../../../docs/verification/20261008-studio-shots.md)。
