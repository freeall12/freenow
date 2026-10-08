# 镜头批量发布合同

`createCameraBatchPublish`把镜头导出器的真实图片或视频保存为本地素材，以一次分组写入连接到片场的画布节点，再确认项目持久保存。模块不调用模型或生成 API，也不追加历史照片或领域 views。

```js
import {createCameraBatchPublish} from './camera-batch-publish.mjs';

const batch = createCameraBatchPublish({
  app: window.CanvasApp,
  session,
  nodeId,
  renderer: shotExporter, // createCameraShotExporter(...) 的实例
  assets: window.LocalAssets,
  onStatus: refresh
});
try {
  const result = await batch.export(selectedShots);
  // 仅成功返回后报告已保存；按 successCount/errorCount 展示部分失败。
} catch (error) {
  // pending=true 时保留实例；error.applied 表示已有媒体节点。
  // 用户重试调用 batch.export()，复用原批次。
}
batch.busy;
batch.pendingReceipt; // null 或 {exportId,shotIds,nodeIds,applied}
batch.dispose();      // abort 当前 renderer signal，禁止迟到写入
```

## 输入与输出

`export(shots)`首次调用要求非空 JSON 数组，每个镜头具有唯一且非空的 `id`；可提供 `title/stageId/setupId`和渲染器需要的其他 JSON 字段。stage/setup 若提供必须对应当前状态。镜头列表和片场状态均复制后交给 renderer，不能包含 Blob。渲染结果的 Blob 保持真实引用，单独保存在回执中，不作为 JSON 克隆或序列化。

渲染器逐镜头、串行执行：

```js
renderer.render(shot, {state: snapshot, signal})
// Promise<Array<{
//   type: 'image' | 'video', blob: Blob, width: number, height: number,
//   duration?: number, posterBlob?: Blob, title?: string, provenance?: object
// }>>
```

主 Blob 必须非空且 MIME 与 image/video 类型对应；宽高为正安全整数。可选视频 duration 为正有限秒数；posterBlob 为非空 image MIME Blob。空数组或无效媒体作为该镜头失败。一镜头的结果整体校验，通过后才收入回执。只要至少一镜头成功，成功项继续保存；全部失败抛 `studio_v3_batch_no_results`及具体 `errors`，并清空回执。

成功结果为 `{ok:true,exportId,shotIds,nodeIds,applied,successCount,errorCount,itemCount,errors,items}`。`successCount`是成功镜头数，`itemCount`是媒体节点数；一镜头可产生多项。`errors`为 `{shotId,message,code?}`数组；`items`含节点、asset、可选 posterAsset、实际像素尺寸及 provenance，不含 Blob。image 使用节点 `image`，video 使用 `video`、可选封面 `image`与 `duration`。显示尺寸由既有 CanvasGeometry 决定，`pixelWidth/pixelHeight`保留输出尺寸。

## 状态与守卫

状态依次包括 `preparing`、每镜头 `rendering/shot-rendered/shot-failed`、`saving-asset`、可选 `saving-poster`、`adding-to-canvas`、`saving-canvas`、`saved/failed`、最终 `idle`；重试从 `retrying`开始。每条状态含 `busy`、公开回执、镜头和媒体计数；镜头/素材阶段附 `shotId/itemId`。错误状态含 message/code/errors。`onStatus`可直接使用无参数刷新函数，忽略参数即可；观察者抛错不会中断流程。

首次先要求无活动作者事务，等待 `session.flush()`成功且非 readonly/dirty，再固定完整 fence。flush 前后检查稳定身份和精确领域状态，允许此次 flush 自身增加 revision。随后每次异步返回和有外部回调的写入前检查：

- 片场 owner 与 source 节点对象身份、项目 ID、session ownership；`app.projectIdentity()`可返回 ID 字符串或含 `id`的对象，正常保存改变的 `updatedAt`等项目元数据不参与身份比较，非法 ID 拒绝；
- 完整 fence（含 revision/editEpoch/sourceBinding），精确 session 状态及 owner.studioV3 内容；
- 已应用媒体的类型、主 asset、像素尺寸、provenance，以及视频 duration/封面。

所以不只检查 setup 标识：同状态中的名称、时间轴、实体或其他内容变化同样拒绝。Session 必须实现真实 source 资格验证；默认使用 `session.isCurrent/getFence`，自定义 callbacks 不能放宽 ownership。源节点内容变更由真实 StudioSession 验证。

## 保存、重试与关闭

素材逐项保存；每个成功的主 asset 和 posterAsset立即记入回执。存储失败保留原 Blob，重试不重新渲染、不重复 put 已成功项。全部素材就绪后，调用一次 `app.createConnected(nodeId,outputs)`分组加入画布，再等待 `app.saveProject({beforeCommit})`。项目 writer 必须执行守卫并等待真正的存储队列。

provenance 强制包含 `batchExportId/itemId/shotId`和片场来源；渲染器不能覆盖这组身份。`createConnected`同步应用后若 rebuild 抛错，按 batchExportId/itemId 查找唯一节点恢复。正常重试不再次创建节点；若异常宿主只加入部分输出，仅补入缺失项。找到多个同身份节点、已应用节点删除或编辑时拒绝覆盖。已保存媒体不会因 `dispose`而删除。

所有失败都有真实 `applied/pending/retryable`；有回执时附 `pendingReceipt`和计数。只有渲染已完成、ownership及节点仍有效的写入失败能重试。尚未完成就失效的渲染不能当作完整批次发布。pending 时 `export()`或传相同、同序 shotIds 重试原批次，传其他镜头拒绝；原镜头内容不会被新参数替换。

宿主在 `busy`或 `pendingReceipt`期间阻止片场关闭、切 setup/source/project 与领域内容编辑，保留明确的“重试保存当前镜头导出”入口。可关闭镜头管理菜单；菜单关闭本身不能销毁 exporter 或丢弃回执。失效所有权需由宿主的会话失效清理调用 dispose，不能假称已保存或重试可行。

## 权限、日志与失败范围

权限仅为本机 renderer、LocalAssets IndexedDB 与用户当前画布项目保存；不读取凭据，不发送外部消息。renderer 可能执行的网络资源加载或编码能力由其自身合同定义。模块不授权额外外部调用。

状态日志提供 exportId/shotId/itemId/nodeIds、进度和错误，不输出 Blob 或凭据。尚未关联的素材可能在异步失效后留在本地存储；模块不会跨失效边界继续创建节点。部分镜头失败保留明确错误和成功数，不能把失败项报告为已导出。

专项：`node --test tests/studio-v3-camera-batch-publish.test.cjs`。使用真实 StudioSession/schema/worldSpace/CanvasGeometry，验证部分成功、真实 Blob 与封面、素材/持久保存重试、同步加入后抛错恢复、异步来源/owner/project/content/setup 守卫、flush 自身 revision、dispose 与并发、回执修改及观察者失效。渲染/编码与 IndexedDB writer使用适配器；真实视频像素、编码格式和重载持久性由对应 renderer 与浏览器验收负责。

主线已验证真实 4096×2304 输出、两笔保存失败、关闭面板后重开、原回执重试和刷新后无重复节点；详见 [Computer Use 证据](../../../docs/verification/20261008-studio-shots.md)。真实动态 WebM 编码独立通过，但动态批量生产保存、所有镜头组合仍未完整实机覆盖。
