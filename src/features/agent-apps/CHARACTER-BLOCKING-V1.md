# 历史人物站位 v1

人物站位 v1 已按其实际协议独立接线：本地文字与位置输入进入保留的官方页面，实际保存后重新核对完整 CB1 确认，沿既有用户队列继续处理目标。应用不调用模型、生成服务或外部 API。

## 官方来源与版本差异

项目 `resources/apps/character-blocking@v1.596deb3b.html` 与当前安装包同名资源逐字节一致，SHA256：`596deb3b4e840b54f9636d8641a00b1a698f02db7877a8fca94d42163cb68d24`。manifest 同时保留 v1 和 v3。本批只引用官方原文件，没有修改其源码、样式或品牌。

| 合同 | v1 | v3 |
|---|---|---|
| 输入版本 | 1 | 3 |
| 人物字段 | id/name/role?/x/y | 另有 facing、宿主裁切 portrait |
| 保存状态 | positions/selected_id/snap/target/aspect_ratio | 另有 facings |
| UI 人物标记 | 官方姓名首字母 | 可使用真实本地头像 |
| 确认 token | `CB1 v=1;...;pos=id~x~y,...` | `CB3 v=3;...;actors=id~x~y~facing,...` |
| 确认范围 | 位置、景深、目标、画幅 | 另含面向和头像来源 |

v1 没有头像或面向数据，不能映射成 v3 后补默认面向，也不能用其他人物图片替代。v1 的官方函数 `D_/N_` 定义输入，`Ss/K_` 定义状态，`Z_/L_/n$/r$` 定义区域、CB1 和确认。五语言、image/video、五种画幅和坐标分类与 v3 相近，协议仍分别实现。

## 真实本地输入

```json
{
  "resource_uri":"ui://tapnow/character-blocking@v1",
  "title":"车站对望",
  "data":{
    "locale":"zh-CN",
    "target":"image",
    "aspect_ratio":"16:9",
    "scene":"两人处于不同景深。",
    "characters":[
      {"id":"lin","name":"林岚","role":"旅客","x":300,"y":350},
      {"id":"zhou","name":"周宁","x":750,"y":700}
    ]
  }
}
```

- 1–12人；ID唯一且匹配 `^[a-z0-9][a-z0-9_-]{0,23}$`。姓名必填，role可省略。
- x/y为0–1000整数；X=0左、1000右，Y=0后景、1000镜头侧。摘要边界为333/666，位置不当作世界坐标米数。
- target为image/video；画幅为16:9、9:16、1:1、4:3、3:4。
- locale支持zh-CN/en-US/ja-JP/ko-KR/fr-FR。本地省略时补zh-CN；官方页面接收该明确字段后渲染对应语言，而不是依赖其无效locale时的英文fallback。
- 拒绝 v3 的 facing/portrait/portrait_source/facings，额外工具、URL与权限字段也不属于此输入。
- 本地标题最多200字符、姓名200、role1000、scene4000、规范输入合计12000。完整交接最多16384字符。这些是本地容量上限，官方schema并未为每个字符串声明相同限制。

这是一份真实文本位置板；没有图片输入读取、像素裁切或伪造的头像来源。

## 实际保存与交接

```json
{
  "positions":{"lin":{"x":410,"y":350},"zhou":{"x":750,"y":700}},
  "selected_id":"lin",
  "snap":false,
  "target":"video",
  "aspect_ratio":"9:16"
}
```

只接受完整实际人物集合、合法整数坐标与选中ID；遗漏、未知人物、额外轴、facings和非法类型都拒绝。官方恢复函数会回退坏坐标，但本地不会把恢复后的修补默认值当成一份有效已提交状态。

实际确认例：

```text
确认人物走位：林岚（中 · 中景）、周宁（右 · 前景）；目标 视频，画幅 9:16 — CB1 v=1;target=video;ratio=9:16;pos=lin~410~350,zhou~750~700
```

从已保存状态按原始人物数组顺序重新构造完整五语言摘要及token，整条消息必须精确一致；裸CB1、旧坐标、其他版本token或附加命令不得确认。官方「回对话调整」文案单独处理，不采纳未确认的位置变化。

原页300ms debounce、`V_`串行提交；`Fm`捕获保存失败后仍可进入`r$`发送确认。生产controller必须等待状态事务，初始状态也经onReady真实保存，保存失败不得入队。source runtime的`reply(message,state)`进一步要求`state === trace.appState`，确认只能读取该trace的真实已存对象；resolver使用规范克隆，跨await检查原对象身份与内容。保存x300而传入未保存x900、哈希等待期间替换对象或原地修改坐标，均明确拒绝。

正常队列文本携带已核验场景、人物姓名/role、实际位置、目标和画幅，并明确此版本未确认头像或朝向。`blocking1_`加规范结果SHA256为稳定交接ID：视图选择/吸附和对象键顺序不改变ID；实际位置、场景、目标或画幅改变ID。重复确认和刷新后确认可沿既有队列去重，确认不等于已制作媒体或提交生成任务。

## 宿主 API 与权限

```js
const runtime=createCharacterBlockingV1Runtime({getProjectId});
const args=await runtime.prepareAppArgs(showAppArgs,{isCurrent,signal});
const result=runtime.bindPreparedResult(prepareApp(args),args);
const source=runtime.capture(result.response,{trace,chat,isCurrent});
await source.guard();
const reply=await source.reply(officialText,trace.appState);
```

- 模型：`prepareCharacterBlockingV1(data,title='人物站位')`、`initialCharacterBlockingV1State(data)`、`validateCharacterBlockingV1State(state,data)`、`characterBlockingV1Token/Confirmation`、`resolveCharacterBlockingV1Reply`。
- runtime：`prepareAppArgs(args,{isCurrent,signal})`、`bindPreparedResult(result,args)`、`capture(response,{trace,chat,isCurrent})`。忽略非v1 URI，便于主入口串联各版本的专属runtime。
- 来源绑定：私有WeakMap使结果必须经过规范准备；顶层`characterBlockingV1SourceContext`保留项目、明确v1 URI/版本和response fingerprint，不能混用v3来源。卡片恢复时重新校验规范v1输入。
- capture返回`guard(signal?)`、`reply(message,state)`、`validateState`、`isCurrent`、`dispose`。更换项目、trace/chat ID、response对象/内容、绑定或URI、关闭卡片及取消均失效。生产`isCurrent`还核对当前会话、trace结果对象、完成状态、错误和卡片代次。
- 主入口按真实resource URI分派v1/v3。registry和controller采用v1独立初始状态、验证器与reply；不设置版本别名。

Purpose：确认历史v1实际保存的画面位置，交接到现有普通队列。

Inputs：本地文本板数据、官方UI实际已存状态、完整官方确认文案。

Outputs：规范v1结果、可读交接文本、稳定handoff ID；没有图像、任务ID或生成成功结果。

Permissions：scripts-only官方双iframe及已有nonce/source/current检查；不新增网络、模型、画布修改或工具权限。

Failure modes：输入/状态不符、未提交状态、来源或状态晚到变化、取消、保存失败明确拒绝；不能生成成功回执。

Logging：现有show_app trace、来源绑定、appState、appHandoffs与真实队列widgetOrigin。来源绑定由既有模型结果投影剔除。

## 定向检查与实机证据

```bash
node --test tests/agent-character-blocking-v1.test.cjs
node --test tests/agent-template-qa-storage.test.cjs
node --check src/features/agent-apps/character-blocking-v1.mjs
node --check src/features/agent-apps/character-blocking-v1-runtime.mjs
node --check src/features/agent-apps/qa/character-blocking-v1.mjs
```

v1专属7/7通过：原HTML哈希、独立提取原始`Ss/Z_/L_/Am/n$`比较全部语言/目标/画幅和333/666边界、精确已存消息、拒v3字段与缺失状态、去重范围、文本来源恢复、零网络、过期scope/response/abort以及实际trace状态对象/内容的await竞态。独立review复验了未保存x900拒绝和真实`crypto.subtle.digest` gated时修改状态拒绝；在其本批历史应用/host组合19项检查中全部通过。

QA：`/src/features/agent-apps/qa/character-blocking-v1.html`。真实官方页面、registry/controller/runtime，独立IndexedDB `tapnow-character-blocking-v1-qa-chat-v1` 保存本地输入、状态和交接，未接模型/生成服务。无localStorage读写；复用QA事务工具时明确指定独立数据库名，模板QA默认不变。实际数据从输入JSON读取，不以静态占位图模拟人物板。

Root已完成实机：实际iframe将目标image改video、画幅16:9改9:16、X300改410；saved_state与实际输入吻合；native Tab+Return确认后，完整CB1进入队列一次且有`blocking1_`哈希；真正整页reload恢复X410/video/9:16及相同已存队列。截图：`/tmp/freenow-character-blocking-v1-20261003.png`。

CUA鼠标drag报`Cannot safely inspect fractional iframe input coordinates`，因此未完成鼠标拖动验收。fill/键盘确认和整页刷新已实际通过，不把这些证据扩展成全部拖动、全部视觉或正式媒体生成验收。
