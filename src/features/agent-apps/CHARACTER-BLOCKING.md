# 人物站位 v3

Purpose：在官方人物站位页编辑人物位置、面向、目标和画幅。确认后保存精确 CB3 与可读场景，通过现有普通用户消息队列继续生成流程；应用本身不调用模型、生成 API 或画布修改工具。

## 官方来源

`/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/apps/character-blocking@v3.f1fd0e23.html` 与项目 `resources/apps/character-blocking@v3.f1fd0e23.html` 本次逐字节相同，SHA256 为 `f1fd0e23de67bf00f60ccf333b7d5b57262a01726a37adeef28c800d51a8815b`。原始 HTML 没有修改；UI 布局、交互、字形和装饰全部由它提供。

原始代码 `B_/W_` 定义版本3输入，`Ts/Ps/db/ub` 定义状态，`rb/kb/Sb` 定义确认。`portrait` 只接受 `data:image/webp;base64,` 与 `source:'image-crop'`，每头像最多20000字符、所有头像base64合计最多160000字符。原页不请求任何专属 `tools/call`、模型上下文或服务端生成。

## 输入

Agent 给 `show_app` 的参数必须先经过专属 runtime；头像只接受当前真实图片节点与可选裁切，Agent 不可直接传入 `portrait`、图片 URL 或任意图片字节。无头像时由官方页显示姓名首字母，没有虚构人物照片。

```json
{
  "resource_uri": "ui://tapnow/character-blocking@v3",
  "title": "站台对望",
  "data": {
    "locale": "zh-CN",
    "target": "image",
    "aspect_ratio": "16:9",
    "scene": "林岚站在左后方，周宁在右前方，两人对望。",
    "characters": [
      {"id":"lin","name":"林岚","role":"旅客","x":300,"y":350,"facing":90,"portrait_source":{"node_ref":"node/local-photo","crop":{"x":100,"y":100,"w":700,"h":800}}},
      {"id":"zhou","name":"周宁","x":750,"y":700,"facing":270}
    ]
  }
}
```

- `characters` 为1–12人，ID唯一且匹配 `^[a-z0-9][a-z0-9_-]{0,23}$`；保留实际来源数组顺序。
- `x/y` 为0–1000整数；X=0左、1000右，Y=0后景、1000镜头侧。左/中/右、后/中/前的摘要阈值为333和666，原页没有把坐标转为物理世界米数。
- `facing` 为0–359整数，省略时180；0°向后景、90°向右、180°向镜头、270°向左。方向摘要按四舍五入45°区间分成8向。
- `target` 为 `image|video`，画幅为 `16:9|9:16|1:1|4:3|3:4`；用户可在原页改变它们。
- `locale` 可省略，默认为中文；支持中文、英文、日文、韩文和法文。交接仅接受本次输入语言的精确官方摘要。
- `portrait_source.crop` 为千分比矩形，w/h>0且范围在0–1000内。默认取源图中心正方形；指定矩形时在矩形内取中心正方形，实际解码后裁为128×128 WebP，逐级压缩以符合官方容量。
- `title` 最多200字符、人物名200、角色1000、scene4000；纯文本输入合计最多12000字符。这些是本地容量上限，官方字符串 schema 本身没有这些文本长度上限。

runtime 读取源节点的 `fullImage||image`，只允许 `asset:` 本地素材，经 `localAssets.url` 取得 `blob:`。旧原站/外域URL明确要求先导入本地，读取前就拒绝。读取支持PNG/JPEG/WebP，单图8MiB、单轮合计16MiB、读取及解码30秒、源图最多16384边长及4000万像素。声明/实际字节超限、取消、迟到响应和来源变化都会取消响应流；解码取消会释放对象URL和Image载入。

## 状态与确认

```json
{
  "positions":{"lin":{"x":300,"y":350},"zhou":{"x":750,"y":700}},
  "facings":{"lin":90,"zhou":270},
  "selected_id":"lin","snap":false,"target":"image","aspect_ratio":"16:9"
}
```

保存必须完整覆盖实际人物，未知/遗漏人物、额外坐标轴、小数、非法面向和无效选择拒绝，不能把官方恢复时的默认修复冒充已保存有效状态。官方支持拖动人物、方向指针、数值输入、键盘精调；位置方向键步长10、Shift步长1，吸附时普通方向键步长50，面向普通步长5°、Shift步长1°。重置恢复初始建议位置和面向，保留目标、画幅与当前选择。

确认例：

```text
确认人物走位：林岚（左 · 中景，向右 90°）、周宁（右 · 前景，向左 270°）；目标 图片，画幅 16:9 — CB3 v=3;target=image;ratio=16:9;actors=lin~300~350~90,zhou~750~700~270
```

本地从实际已提交状态重新构造完整五语言摘要与 token，精确比较整条消息，不接受裸 CB3、附加任意命令、其他语言摘要、角色乱序或旧坐标。官方回对话按钮的五语言消息单独返回 `kind:'revise'`，不采纳未经确认的编辑。

官方页 `Ce` 300ms延迟且 `lb` 串行保存，但 `Ym` 捕获错误后不抛出，`Sb` 仍可能发送确认。宿主必须 `waitForState` 等待真实提交，保存失败不能入队；默认初始状态也必须在 onReady 经正常持久事务保存。状态和队列的实际 IndexedDB 提交、来源/trace/iframe代次核对及失败补偿由生产 controller 的现有保存链负责。

`blocking_` 加 SHA256 是稳定内容交接 ID：绑定场景、人物姓名/角色、位置、面向、目标、画幅、头像字节与本地来源节点/字节哈希；忽略选择和吸附等视图状态。重复确认与刷新后确认可去重；状态保存或排队失败可以重试，不重复提交媒体任务。最终文本最多16384字符，不把头像base64塞入模型历史。

## 宿主接线

```js
const runtime = createCharacterBlockingRuntime({app,localAssets,getProjectId});
const args = await runtime.prepareAppArgs(showAppArgs,{isCurrent,signal});
const result = runtime.bindPreparedResult(prepareApp(args),args);
const source = runtime.capture(result.response,{trace,chat,isCurrent});
await source.guard();
const next = await source.reply(officialText,trace.appState);
```

- 模型：`prepareCharacterBlocking`、`initialCharacterBlockingState`、`validateCharacterBlockingState`、`resolveCharacterBlockingReply`；`characterBlockingConfirmation/Token` 用于精确合同检查。
- runtime：`prepareAppArgs` 返回官方字段与实际WebP；`bindPreparedResult` 写入顶层 `characterBlockingSourceContext`，WeakMap 确保不能跳过真实读取阶段。无头像仍创建当前项目/会话绑定。
- `capture` 返回 `guard(signal?)`（异步重新核对源字节）、`isCurrent()`（同步当前身份/快照检查）、`validateState`、`reply`、`dispose`。来源拖动可保持有效；删除、替换、内容/关联输入改变、项目/卡片切换和关闭失效。
- 生产 `getCharacterBlockingSourceContext` 连接 `capture`，消息必须调用 `source.reply`；它追加真实 `portrait_sources` 的人物ID、node_ref、裁切和字节哈希供正常生成流程读取。不能只调用裸模型 resolver 后丢失来源引用。
- `characterBlockingSourceContext` 与portrait预览只给宿主/iframe；模型回合投影应剔除它们。任何后续媒体生成均通过普通queue/API，不向iframe开放新工具。

Permissions：scripts-only双iframe、既有nonce/source/current动作检查、真实项目与来源绑定；没有额外网络授权或画布写入权限。

Failure modes：输入/状态无效、未提交状态、来源改变、媒体超限/解码失败、取消/超时、持久事务失败明确拒绝，不返回虚假成功。

Logging：现有show_app trace保留源绑定、appState、appHandoffs和队列widgetOrigin；实际头像来源/字节哈希进入已核对可读交接，不记录凭据。

## 专项验证与QA

```sh
node --test tests/agent-character-blocking.test.cjs
node --check src/features/agent-apps/character-blocking.mjs
node --check src/features/agent-apps/character-blocking-runtime.mjs
node --check src/features/agent-apps/qa/character-blocking.mjs
```

13项聚焦测试通过：从原始HTML独立提取真实恢复、方向分类、CB3及五语言文案；覆盖全部画幅/目标、边界坐标/面向、精确已存状态核对、视图去重、来源字节改变、无头像、删除/重载/失效、原站URL拒绝、媒体预算、迟到Response取消和decoder释放。Node runtime测试明确桩化像素渲染，不能替代浏览器真实解码与视觉验收。

专属页 `/src/features/agent-apps/qa/character-blocking.html` 使用生产 registry/controller/host 和真实runtime。`tapnow-qa-character-blocking-v1` 专用IndexedDB实际保存本地PNG资产、节点、状态及交接队列，默认输入是明确标注QA的测试人物绘图，用户可上传真实本地图片。页面不调用模型或生成API，队列只观察实际保存的交接。

浏览器检查：打开页→修改位置/面向/目标/画幅→确认→检查已保存状态和队列CB3→重复确认不增加队列→刷新恢复状态/去重→开启保存失败并修改坐标，确认不得排队→关闭保存失败重试成功→上传新图片使旧卡片失效，新卡片使用新真实本地头像。

主任务本次真实浏览器已确认：实际本地头像渲染；目标改为 `video`、画幅改为 `9:16`；键盘把林岚X从300改为310、面向从90°改为96°；确认后的精确CB3进入1次真实已保存队列，包含2个本地来源node_ref与字节哈希；真正刷新浏览器后恢复相同站位和队列。鼠标拖动因CUA的fractional iframe coordinate安全检查被阻止，没有完成这项验证。

主任务随后完成保存失败分支的真实浏览器检查：勾选“模拟状态保存失败”，把X从310改到320，视觉位置更新后点击确认；页面显示“模拟：站位状态事务保存失败”和“发送失败，请重试”，没有新增交接队列。取消模拟后真正刷新浏览器，恢复实际持久状态X310、面向96°、`video`/`9:16`，队列仍为1条。截图保存在 `/tmp/freenow-character-blocking-local-20261003.png`。保存失败后不刷新、直接在原UI重试尚未单独验证，不能把此次刷新恢复视为该分支通过。

专项实现、Node检查和这些局部浏览器通过不代表全站复刻、正式模型生成或全部交互视觉已验收。
