# 多图层合成 layer-composer@v1

官方资源 `resources/apps/layer-composer@v1.067126cf.html` 原字节保持不变。SHA256：`067126cfabf7768c81af9e5a5718d3cc1d2e0f5e126cdf63e65c5ad16fd5f080`。`layer-composer.mjs` 复制官方验证、几何和五语言消息合同；`layer-composer-runtime.mjs` 从真实当前本地源图读取完整像素，执行浏览器 Canvas 合成，保存实际 PNG 和一个新画布节点。

## 官方合同和展示

官方HTML脚本第278行（压缩脚本，以符号检索为准）：

| 符号 | 官方行为 | 本地对应 |
| --- | --- | --- |
| `m$/Ds/Rs/Bn/v$/h$` | 2–12层、画幅/尺寸/旋转/像素限制、等比、至少一层可见且与画板相交 | `prepareLayerComposer/validateLayerComposerState`，复制相同公式 |
| `Ns/f$/Ii` | state默认选择最上层；合法state恢复；无效恢复退回初始构图 | `initialLayerComposerState`；宿主保存非法state明确拒绝，不静默修复 |
| `g$` | canvas、背到前layers及title的准确Apply参数，不带预览 | `layerComposerApplyArguments` |
| `w$/hc/I$` | 五个画幅预设、64–4096自定义画幅、透明/纯色背景 | 官方原页面保留 |
| `x$/Pi/z$/T$` | 列表选择、显隐、上/下移、XY、等比宽度、旋转、透明度 | 官方原页面保留 |
| `U$/uf` | 拖动、角点等比缩放、旋转手柄、Shift15°旋转、方向键1px/Shift10px微调；预览背到前 | 官方原页面保留；输出按同一位置和变换绘制完整源图 |
| `Ve/mf/O$` | 修改后400ms保存state；Apply先flush | controller等待state保存；runtime核当前已保存参数 |
| `D$` | `layer_composer_apply`，`tapnow/callId`重试；明确失败可重试，未知结果禁止继续避免重复 | runtime真实合成/持久保存/幂等；正常host作用域工具 |
| `D$/sf.appliedContext` | 真正成功取得node_id后准确五语言`ui/update-model-context`，不发送新用户回合 | 回执/源hash/输出hash核验后保存`layerComposerContext` |
| `N$/sf.skipMessage` | 仅五语言固定Skip消息 | `capture.reply`核全源字节；进入正常用户队列 |

`vendor-packages-CN3JnHbF.js` 的 `wae/Bue` 未列layer-composer专属策略，因此适用默认 `allowExpanded:false, autoExpandOnReady:false`。源HTML展示的是可执行合成，不是方案交接。后端源码未提供：后端完整源图合成、hash核验与callId幂等职责是从真实前端参数和消息行为推断的；本地实现没有调用或猜测原站API。

## 输入、状态与接线

Agent输入示例：

```js
{
 resource_uri:'ui://tapnow/layer-composer@v1', title:'图片构图',
 data:{version:1, locale:'zh-CN', title:'图片构图',
  canvas:{width:960,height:540,background:'transparent'},
  layers:[
   {id:'background',node_ref:'node/<真实背景ID>',name:'背景',center_x:480,center_y:270,width:960,height:540,rotation_deg:0,opacity:1,visible:true},
   {id:'foreground',node_ref:'node/<真实前景ID>',name:'前景',center_x:700,center_y:270,width:320,height:320,rotation_deg:0,opacity:1,visible:true}
  ],summary:'调整图层位置后投放到画布。'}
}
```

每层id/node_ref/name及七个变换字段必填，尺寸须匹配源图真实宽高比。唯一来源为当前 `node/<id>` 图片，宿主读取 `fullImage || image`，允许本地asset/data/blob的PNG/JPEG/WebP，另复用 `isGenerationMediaRef` 仅允许精确 `/api/generation/media/<UUIDv4>` 同源不可变正式生成结果。Agent不许提供hash、source_width/height、preview、任意图片/预览URL。宿主生成 `source_sha256:'sha256:'+64hex`、真实源图宽高和真实WebP预览。未知字段拒绝。

title最多120个Unicode字符；data.title省略时用show_app title或Layer Composer。summary可省，官方最多取500字符；locale支持zh-CN/en-US/ja-JP/ko-KR/fr-FR，未知值遵官方回退en-US。

实际iframe响应是 `{version:1,locale,title,canvas,layers,summary}`，每层除Agent字段外增加hash、真实尺寸和 `preview:{data_uri,width,height}`。state保持官方形状：`{version:1,canvas,layer_order:[背到前ID],edits:{ID:{center_x,center_y,width,height,rotation_deg,opacity,visible}},selected_id:ID|null}`。

```js
const runtime=createLayerComposerRuntime({app,localAssets,store,getProjectId,persistConversation});
const args=await runtime.prepareAppArgs(showArgs,{signal,isCurrent});
const result=runtime.bindPreparedResult(prepareApp(args),args);
// Production controller callbacks:
getLayerComposerSourceContext:(response,trace,chat)=>runtime.capture(response,{trace,chat,isCurrent}),
onApplyLayerComposer:(args,trace,chat,options)=>runtime.apply(args,trace,chat,options),
onLayerComposerContext:(params,trace,chat,options)=>runtime.setModelContext(params,trace,chat,options)
```

构造必需app.getState/createConnected、localAssets.put/url、store.save、getProjectId、persistConversation；store.flush/app.projectSnapshot可选。默认renderPreview/renderImage是真实浏览器Canvas；Node测试注入明确媒体桩，只验证事务合同，不证明视觉合成。支持fetchImpl、getOrigin（默认页面location.origin）和timeoutMs注入以测试限额/取消。

capture提供同步guard/isCurrent、operationSignal/dispose、validateState、reply、readSources、validateSourcesCurrent、validateReceiptCurrent及readReceipt。apply options={callId,userAction:true,isCurrent,sourceContext,signal?}；setModelContext同样要求真实动作许可。shared host只接受这一页的layer_composer_apply，成功后授予一次准确context许可；scope/nonce/页面代次变化使许可失效。Skip普通队列在持久提交后还须调用第6个validator核真实源字节，失败撤回并补偿保存。

## 合成、保存、撤销与失败

- 官方画板64..4096，最多16,777,216像素；每层中心支持画幅外2倍/3倍边界，尺寸不超过画幅4倍、面积最多16,777,216，旋转-180..180，旋转包围盒最多33,554,432像素；实际源图最多40,000,000像素。等比检测使用官方四舍五入及1%/2px容差。
- 每层源文件最多16MiB、全部源图总共64MiB、完整PNG输出最多64MiB。每层真实WebP预览最多250000字符，最长边初始512，必要时有界缩小；iframe响应上限4MiB。源图不会为了输出预算而隐式缩小。
- 按完整canvas顺序逐层绘制，先填纯色或保持透明，忽略隐藏/零透明层，位置为中心坐标、等比尺寸、弧度旋转和globalAlpha。预览网格、选中边框和手柄不会出现在PNG；使用完整源图，绝不把WebP缩略图冒充输出。
- 所有层（包括隐藏层）在Apply/Skip及保存后核实际SHA；来源内容快照拒删改，允许画布位置拖动。源hash/预览/response指纹绑定当前project/chat/trace；同地址替换字节、会话/卡片替换、state变更及dispose取消均拒绝成功。
- 输出PNG先本地asset保存，再回读实际SHA与真实解码尺寸；再核源字节，使用已有 `app.createConnected` 画布撤销事务创建新图，源图片不修改。provenance记录kind/scope/callId/requestFingerprint/sourceSnapshots/outputMedia/receipt。
- 回执 `{node_id,canvas,layers,title,output_sha256,width,height}` 存于trace.layerComposerReceipt；持久callId与构图记录存于trace.layerComposerReceipts，用于刷新后防重复及阻止撤销/删除后自动重建。等构图并发/重试复用同一真实结果；同callId改变参数拒绝。当前操作缓存最多128项，dispose回收本scope。
- 新节点创建后必须等待画布save/flush、回执及会话真实事务；任何保存失败不返回成功。画布保存失败留下实际可见节点，重试保存同一节点。会话保存失败只回滚仍属本操作的Receipt/ledger字段，再等待补偿保存；补偿失败明确报告。
- 正式生成媒体路径须严格匹配UUIDv4且无query/hash，解析为当前页面同源完整地址；fetch使用same-origin模式/同源凭据和redirect:error，响应URL必须与原请求完全相同且不可opaque/redirected；任意其他相对路径、绝对HTTP来源、跨域peer或重定向一律拒绝，返回体取消。此路径不会经由asset resolver重写。
- 读取须字节流，声明和实际超限均取消流；每个完整读取/渲染阶段30秒超时，dispose中止等待，迟到解码/编码结果不入图。图层之间yield；浏览器整图解码、绘制和PNG编码仍会占用主线程，不声称最大尺寸性能已验证。

未调用外部模型，官方合成功能也不要求模型。后续生成使用已有可配置工具路径；本页不给未配置模型伪造产物。暂不支持新增/删除/替换源层、遮罩、混合模式、文字层、阴影、RAW/ICC/HDR或动画逐帧合成；更换源图按官方提示重新引用节点打开页面。

## 验证与专属QA

```sh
node --test tests/agent-layer-composer.test.cjs
node --check src/features/agent-apps/layer-composer.mjs
node --check src/features/agent-apps/layer-composer-runtime.mjs
node --check src/features/agent-apps/qa/layer-composer.mjs
```

18项局部测试已通过：独立提取官方合同/五语/几何、非法尺寸/等比/显隐/重复源、Agent注入/远程来源、完整源blob及PNG保存/源图不变、并发与重试幂等、必须匹配已保存state、隐藏源同址字节变化、渲染期间换源/换state、会话/卡片/项目变化、save失败/补偿、撤销/删除后的刷新重试保护、已保存output换字节/节点变更、dispose停滞流/晚渲染、实际及声明超限取消、会话提交中迟到等构图callId持久保护、精确同源generation ref真实HTTP PNG读取与合成、重定向/任意相对与绝对路径/响应peer变化拒绝。

`qa/layer-composer.html` 使用生产registry/controller/host/runtime和独立IndexedDB `tapnow-qa-layer-composer-v1`。输入是页面明确生成的专属QA PNG背景及透明前景几何图，非真实用户素材、官方示例或模型结果。验收应：打开官方页→调整位置/尺寸/旋转/显隐/顺序→Apply→回读PNG字节SHA/真实解码尺寸/节点/会话→刷新回读→撤销最近合成→同构图Apply被拒，且无重复节点。Undo后历史receipt回读会明确报节点不存在，保存历史证据不冒称它仍在画布。不得删除该数据库作为测试前置。

真实浏览器结论由主任务的CUA验收记录补充；Node桩和代码检查不代表浏览器绘图、主画布或最大尺寸性能完成验收。
