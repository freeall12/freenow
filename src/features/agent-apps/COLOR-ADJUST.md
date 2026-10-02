# 官方调色 color-adjust@v2

原始资源 `resources/apps/color-adjust@v2.285e6ccb.html` 未修改。`color-adjust.mjs` 是纯合同/官方像素算法，`color-adjust-runtime.mjs` 读取当前图片、生成真实预览、本地处理完整图片、保存 PNG 与新连接节点。`qa/color-adjust.html` 使用生产 registry/controller/host/runtime 和独立 IndexedDB；不调用模型。

## 官方源码证据

该页脚本压缩在 HTML 第265行，按函数名定位：

| 官方符号 | 实际行为 | 本地对应 |
| --- | --- | --- |
| `$i/or/bi` | 18参数顺序、范围、全0默认 | `colorAdjustKeys/colorAdjustParams` |
| `A_/L_/M_` | 白平衡/通道增益、分区色阶/褪色/压白/自然饱和/饱和度、RGBA逐像素转换 | `colorAdjustPixels` 原样复制同一公式 |
| `Hm/Ts` | 参数四舍五入并约束到范围 | 宿主拒绝非法值，合法整数保持精确 |
| `F_/H_` | 扁平保存参数及 `active_tab/advanced_open` | `initialColorAdjustState/validateColorAdjustState` |
| `Ve.ontoolresult` | 从 `node_ref/params/suggested/preview.data_uri/locale` 初始化；读取 widgetState | `prepareColorAdjust` + runtime来源绑定 |
| `W_` | 自动建议仅温度/色调/曝光；三项0不显示建议按钮 | `suggested:{temperature?,tint?,exposure?}` |
| `B_/Y_/X_` | 真实预览像素本地重绘；按住比较原图 | 原页面保留 |
| `e$/ki` | 修改后400ms保存扁平state | 生产 controller 保存链 |
| `n$` | `color_adjust_apply`，仅传 `{node_ref,params}` 和 `tapnow/callId`；不输出图片、不调用模型 | runtime `apply` 完整源图调色 |
| `n$/Pt.appliedContext` | 成功读取 `structuredContent.node_id` 后发送准确本地化 `ui/update-model-context` | `resolveColorAdjustContext/setModelContext` 核验真实持久回执 |
| `t$/Pt.skipMsg` | 五种固定语言跳过消息走 `ui/message` | `resolveColorAdjustReply` 只接受精确跳过消息 |

Apply 不发送聊天消息、不自动启动模型。成功上下文不会声称未落盘的操作已完成。官方页 Apply 可发生在400ms保存延迟前，本次真实操作以工具请求全部18参数为准；不将旧state参数冒充当前应用参数。上下文由已持久回执 `params` 校验，不根据随后变更的滑杆state猜测。

## 输入、状态和接线

Agent输入：`{resource_uri:'ui://tapnow/color-adjust@v2',title?,data:{node_ref,params?,suggested?,locale?}}`。`node_ref` 必须当前真实图片节点。Agent不能提供preview/图片地址/输出node ID/工具或完成状态。

参数：exposure、brightness、contrast、highlights、shadows、whites、blacks、temperature、tint、saturation、vibrance、red_gain、green_gain、blue_gain、split_tone_highlights、split_tone_shadows 均为 -100..100整数；fade、rolloff 为0..100整数。省略初始参数补0，实际Apply必须完整18参数且至少一项非0；未知字段、非整数和越界明确拒绝。

状态：`{...18params,active_tab:'light'|'color'|'effect',advanced_open:boolean}`，不增加官方状态字段。

宿主：

```js
const runtime = createColorAdjustRuntime({
  app, localAssets, store, getProjectId, persistConversation
});
const args = await runtime.prepareAppArgs(showArgs, {signal, isCurrent});
const result = runtime.bindPreparedResult(prepareApp(args), args);
// Controller hooks:
getColorAdjustSourceContext: (response, trace, chat) => runtime.capture(response, {trace,chat,isCurrent}),
onApplyColorAdjust: (args,trace,chat,options) => runtime.apply(args,trace,chat,options),
onColorAdjustContext: (params,trace,chat,options) => runtime.setModelContext(params,trace,chat,options)
```

`capture` 提供同步返回true的guard、bool isCurrent、dispose生命周期中止、validateReceiptCurrent、readReceipt。`apply` options 包括callId/userAction/isCurrent/sourceContext/signal?。`setModelContext` options 包括userAction/isCurrent/sourceContext/signal?；只能使用已成功Apply的窄动作许可，准确匹配官方成功文案。

`app` 必需getState/createConnected；localAssets必需put/url；store必需save，可选flush。`renderImage` 可注入媒体适配，默认使用真实浏览器Canvas；Node测试的renderer是明确PNG桩。`persistConversation`必须等待真实事务提交。

真实回执：`{node_id,source_node_ref,params,source_sha256,output_sha256,width,height}`。输出节点 provenance.kind 为color-adjust，包含callId/scope/sourceSnapshot/requestFingerprint/outputMedia/receipt。show_app宿主来源存于 `result.colorAdjustSourceContext`；最新回执存于trace.colorAdjustReceipt；准确模型上下文存于trace.colorAdjustContext。任何一步失败不返回成功回执。

## 字节、生命周期与保存

- 完整源图读取上限16MiB；源图尺寸最多8192边长、16Mi像素；输出PNG最多32MiB。超出范围明确失败，不隐式缩小产物。
- 预览由真实源图生成，最长边512像素，data URI上限1,500,000字符。完整源图处理不使用缩略预览代替。
- 每65536像素分片计算，分片间yield并检查取消；完整18参数与官方 `M_` 相同，保留alpha。原图不修改，新图保留完整源图宽高。
- 读取使用流、声明和实际字节预算、20秒超时；HTTP失败/超限/取消会cancel流。页面dispose立即中止读取和渲染等待，迟到产物不入图；仅已提交的图节点继续等待真实画布保存，不能假称节点被撤销。
- 原来源绑定内容快照、准确初始参数/建议/预览及源字节SHA256；来源被改/删、同asset换字节、会话/项目/iframe代次变化均拒绝。拖动画布来源坐标合法。
- 保存素材后立即回读SHA256与实际解码尺寸，再创建节点。画布保存后和会话保存后重新核对当前来源、实际输出字节及节点媒体/provenance。
- 同scope同参数并发、同callId重试及真实已有provenance结果复用一份节点；callId更换参数拒绝。操作缓存上限128，dispose回收scope。最新已持久receipt节点删/撤销后，即使刷新同trace也拒绝自动重建。
- 画布保存失败可留下实际可见节点；重试保存同一节点，不造重复。会话失败仅在本次字段身份未被新操作替换时撤回，避免迟到失败覆盖新回执，再等待补偿事务；补偿失败明确报告。

## 聚焦验证及边界

```sh
node --test tests/agent-color-adjust.test.cjs
node --check src/features/agent-apps/color-adjust-runtime.mjs
node --check src/features/agent-apps/qa/color-adjust.mjs
```

18项聚焦测试：独立提取官方算法，对每个参数全部合法整数档位核对混合RGB/alpha，另核对18参数同时非零组合与恒等情况；官方扁平state、五语言成功/跳过原文；非法参数/来源；真实读取/PNG保存/尺寸/原图保留；并发/重试幂等；源asset同ID字节变化；存图/会话保存失败；存图期间删节点、改媒体、换字节；HTTP/声明/实际超限流取消；dispose停滞read/晚renderer；刷新后不自动重建已删最新结果；预览/初始参数/建议原地篡改拒绝；迟到旧Apply/context补偿不覆盖新成功回执。

浏览器验收页提供官方滑杆/建议/重置/三页签/通道展开/按住比较/Apply/Skip，以及持久PNG字节、解码尺寸、节点、会话回执与刷新恢复的回读证据。Node桩不能证明浏览器绘图或主画布视觉通过，真实浏览器结论由主任务验收记录补充。

边界：不提供RAW、HDR、ICC管理、动画逐帧调色、后台worker或模型自动分析建议；不伪造suggested。内存缓存和当前真实graph用于历史去重，最新receipt有持久删除保护；更早产物已删除且缓存已回收时没有无限期历史墓碑。解码尺寸在浏览器完成解码后核验，压缩源图的异常解码内存峰值仍受浏览器解码器控制。整图绘制、PNG编码、尺寸解码不是完全无阻塞；分片解决逐像素长任务，未声明主入口视觉或最大尺寸性能已验收。

2026-10-03 主任务真实CUA局部验收（随后本模块目检截图）：打开官方页→自动建议→键盘将曝光8改10（温度12、色调-4）→Apply→回读持久结果。实际新增1个960×540 PNG节点，29616字节；完整18参数、实际node_id及上下文已保存，普通队列0；实际图片/原图目检有内容且调色变化可见，IDB回读字节哈希/尺寸/live graph一致。截图 `/tmp/freenow-color-adjust-20261003.png`。该记录覆盖本地QA实际执行，不代表主画布视觉/全部18滑杆UI/最大尺寸性能已验收。

响应指纹防篡改是在本批开发中加入的。之前已保存而缺少 `colorAdjustSourceContext.responseFingerprint` 的旧QA卡片会严格拒绝继续Apply；真实历史PNG、节点、上下文和回读按钮均保留。不删除验收数据，不根据当前可变页面自动补原始来源绑定；可新开一个官方页获得完整绑定。
