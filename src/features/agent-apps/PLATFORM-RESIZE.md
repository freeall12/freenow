# 官方平台适配

来源：未修改的 `resources/apps/platform-resize@v1.897f4688.html`；`ontoolresult/pm/hm/g_/mm/l_/b_` 定义输入、规格选择、拖动与调用去重。原文件SHA256为 `897f46887563e4ed59db6b0f33cb0896631715c0c39a7e8793470978c7383365`。

页面是**真实图片的本地裁切**：不消耗Tapies，每个ratio_id初选至多一个平台；选中同ratio另一平台时替换前者；拖动只改x/y；整批点击后调用 `resize_for_platform_apply`，成功才禁用同批重复按钮。官方没有widget state保存、ui/message、视频裁切、指定输出分辨率或扩图。重载按官方初始数据恢复取景与选中项；成功产物与去重凭据保存于画布和会话，不伪造可恢复的编辑状态。外部扩图仍由正常生成API工作流处理，本应用不接受或调用它。

## 模型输入与真实来源

模型只提供当前图片节点及实际需要的规格：

```json
{
  "resource_uri": "ui://tapnow/platform-resize@v1",
  "title": "主视觉平台适配",
  "data": {
    "image_id": "node/source-image",
    "platforms": [
      {"platform": "portrait", "label_zh": "竖屏 9:16", "label_en": "Portrait 9:16", "ratio_id": "r_9_16"},
      {"platform": "square", "label_zh": "方图 1:1", "label_en": "Square 1:1", "ratio_id": "r_1_1"}
    ],
    "locale": "zh-CN"
  }
}
```

`image_id` 为真实 `node/<id>`（节点ID仅A–Z/a–z/0–9/下划线/连字符，1–180字符）。`project_id` 可选，提供时须等于宿主当前项目。规格1–16条；platform唯一，匹配 `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`；中英文标签非空且各不超过120字符；ratio_id匹配 `r_<正整数>_<正整数>`，每项1–999；selected可选布尔。locale为zh-CN/en-US。HTML由输入驱动，没有官方固定平台目录的证据，不能把例示标签宣称为完整官方目录。

`createPlatformResizeRuntime.prepareAppArgs` 拒绝模型提供preview、源图URL、裁切尺寸、来源快照或hash；从当前画布图节点读取实际媒体字节并解码。图片支持PNG/JPEG/WebP；视频来源明确拒绝。按实际宽高计算最大中心取景，以1000为源图坐标基准。`bindPreparedResult` 将projectId、真实来源内容快照、字节SHA256、实际宽高和响应SHA256置于trace顶层 `platformResizeSourceContext`，只有官方响应进入iframe。

官方响应为 `{node_ref,project_id,preview:{data_uri,width,height},platforms:[{platform,label_zh,label_en,ratio_id,selected?,x,y,w,h}],locale,free:true}`。预览由真实源图像素缩放编码而来，width/height仍为原始解码尺寸以保留同一取景基准。坐标全为整数0–1000，x+w/y+h不得超界，w/h中至少一个为1000。官方预览只提供构图参考，实际裁切使用完整源图字节。

## 专属工具与真实保存

Purpose：将页面选中的实际裁切PNG整批加入当前画布。

Inputs：仅 `tools/call` name=`resize_for_platform_apply`，arguments=`{image_id,project_id,crops:[{platform,x,y,w,h}]}`。元数据为 `_meta['tapnow/callId']`（8–128位字母/数字/下划线/连字符）；官方SDK可能增加progressToken，宿主只作为传输身份核验。crops须按页面列表顺序、平台和ratio_id均不重复，w/h与展示时的真实计算值一致，x/y只能在合法范围取景。没有任意URL、素材、provider参数、输出ID或生成授权。

Outputs：真实保存完成后返回 `{callId,fingerprint,count,node_refs,source_sha256,crops,output_sha256}`。count与实际创建/仍在图中的节点一致；数组逐一对应PNG及真实字节hash。官方只检查工具isError，宿主不能把仅生成了Blob、开始保存或部分入图当作成功。

Permissions：同一当前会话、trace、项目、原始图片绑定、iframe代次与实际用户动作。runtime capture提供同步guard/isCurrent以及dispose取消；prepare/apply每次异步阶段再次检查来源。状态/message入口保持关闭，不存在消息队列交接。

实现：`platform-resize.mjs` 负责官方响应/输入/坐标合同；`platform-resize-runtime.mjs` 负责真实字节、Canvas像素裁切与持久化。官方千分比w/h只表达预览取景，不能把量化边缘的801×800产物声称为1:1。实际产物按宿主已绑定ratio_id约分的整数宽高单位，从真实源图取最大可容纳的整倍数像素矩形，例如1200×800源图对应800×800方图、1200×675横屏16:9。起点由用户选择x/y乘源图尺寸/1000四舍五入，并仅在源图边缘夹到精确矩形合法范围；不缩放、不拉伸或伪造分辨率。provenance同时保留原始规范crop和实际像素rect，量化差可追溯。

每张PNG实际重新解码并核对尺寸，写入LocalAssets后，一次 `app.createConnected(sourceId,patches)` 加入全部图节点，整批只有一次画布undo。节点记录scope、callId、原始源图hash、裁切规范坐标/像素矩形、输出素材身份和输出hash。画布保存和会话保存前后复核每个节点的身份、媒体、尺寸、provenance，以及本地输出实际字节；插入前、画布保存后、会话保存后也复读源图字节。成功回执存于trace.platformResizePlacements。

同callId不得替换内容；同来源页相同裁切的并发调用复用一个pending批次；失败保存重试或同trace重载依已有真实provenance/回执复用节点。已保存结果被删、撤销或改媒体时明确失败，禁止自动重建掩盖用户操作。另一张新show_app卡片具有新的trace作用域，是新的用户裁切操作。

Failure modes：非法输入/来源变化/媒体解码失败/读取或像素超限/当前动作过期/保存失败均返回错误。加入画布以后保存失败可能留下可见节点；会话回执失败会撤销本次回执并提交补偿事务，补偿失败另报 `conversation_rollback_failed`。不能宣称整个图操作已回滚，也不提交生成任务。

读取边界：源图及各输出最多12MiB，严格核对声明与实际stream字节；无有界reader明确失败；非2xx/来源失效/超限/取消都会取消读取。源图解码尺寸每边至多16384、总量32MP，同批实际裁切总量64MP，最多16规格。预览编码最多590000字节、data URI最多800000字符。整个prepare/apply有30秒期限；dispose/外部AbortSignal取消挂起stream和图片探测，解码对象/ObjectURL在失败路径清理。已开始的持久化事务可能继续完成，后续检查拒绝过期成功。

Logging：持久trace来源绑定、逐产物provenance、批次真实保存回执；内容hash和节点标识用于来源复核与去重。没有KEY、外部生成或虚假任务状态。

## 验收

`/src/features/agent-apps/qa/platform-resize.html` 使用生产prepareApp/controller/card/host和未修改官方页。独立数据库 `tapnow-qa-platform-resize-v1` 保存Blob、画布、单次undo和会话回执；不接触主画布存储。可选择真实PNG/JPEG/WebP，也可用真实Canvas编码的1200×800四象限网格图。可验收多规格、拖动、同批撤销、保存失败及刷新去重；显示真实PNG尺寸和规范坐标。明确未调用模型/生成服务。

```sh
node --check src/features/agent-apps/platform-resize.mjs
node --check src/features/agent-apps/platform-resize-runtime.mjs
node --check src/features/agent-apps/qa/platform-resize.mjs
node --test tests/agent-platform-resize.test.cjs tests/agent-apps-edit-review.test.cjs
```

本模块15项聚焦测试使用明确的像素编解码adapter桩验证合同/保存链：规范矩形、无模型预览、视频拒绝、源字节hash、用户动作、项目/iframe失效、整批单次undo、失败重试/刷新/并发去重、节点/媒体/provenance/像素修改、源字节替换、会话补偿及挂起stream取消。独立review另检查HTTP/来源失效取消、有界读取与解码清理。它们不替代实际Canvas与浏览器产物验收。

主任务实际浏览器已确认原始页握手、1200×800真实源图预览、四张PNG同批加入图中、一次undo记录与一份保存回执。首轮发现1:1/16:9被千分比量化成801×800/1200×676；已按实际精确比例修复，保留原规范crop和实际rect，并增加旧量化产物拒绝/不改写回归。重新加载后新开卡片，实际PNG解码为450×800、800×800、1200×675、1200×600；刷新仍有源图+旧4张+新4张，点击一次撤销由9张变5张、undo记录2变1，旧产物原样保持。截图 `/tmp/freenow-platform-resize-fixed-20261003.png`。嵌套iframe拖动受工具坐标检查限制，尚未实际验收；不能由键盘选择与算法测试推定拖动已通过。
