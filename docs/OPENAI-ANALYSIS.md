# OpenAI 原生焦点识别

原生适配接通现有焦点编辑的 `kind:'image.recognize'`：把完整原图和归一化点击位置提交给 Responses，返回单个 `type:'text'` JSON结果，再由原焦点会话的绑定校验应用候选标签。它仅完成点选物体识别，不新增文本节点或图片节点。

`video.analyze` 已由独立 [视频分镜适配](OPENAI-VIDEO-ANALYSIS.md) 接入本机完整选区检测、实际裁切和逐镜头描述。本模块仅处理图片识别；图片三帧概述不能替代完整镜头切分。

## 配置合同

焦点入口没有型号参数，原生提供方仅使用操作者明确配置的 `image.recognize` map key，不猜选其他图像或文本型号。以下是 `GENERATION_MODEL_MAP` 的一个条目；实际型号须同时支持图片输入和 Responses Structured Outputs，由操作者按账号权限选择。

```json
{
  "image.recognize": {
    "kind": "image.recognize",
    "model": "YOUR_ACCESSIBLE_VISION_MODEL",
    "detail": "high",
    "maxOutputTokens": 3000,
    "maxCount": 1
  }
}
```

仅允许 `kind`、`model`、`detail`、`maxOutputTokens`、`maxCount`。`detail` 可为 `low/high/auto/original`，默认 `high`；具体型号仍可能拒绝不适用的细节档位。输出预算为512–16000，默认3000；`maxCount` 只能为1。配置不会引入新的Key来源或供应商登录流程。

能力元数据为 `capabilities.analysis[alias]`，包含 `kind:'image.recognize'`、`operation:'point-detection'`、`transport:'inline'`、`maxImages:1`、PNG/JPEG/WebP MIME和 `maxImageBytes:20971520`，不公开实际模型或Key。

## 保持现有焦点合同

```js
{
  kind: 'image.recognize',
  label: '焦点编辑识别',
  nodeId: 'source-node',
  inputs: [{type:'image', url:'data:image/png;base64,…'}],
  parameters: {
    point: {x:0.4, y:0.3},
    binding: {sourceNodeId:'source-node', targetNodeId:'target-node', markId:'mark'},
    output: {
      format:'json',
      boxOrder:['top','left','bottom','right'],
      coordinates:'normalized-0-1'
    }
  }
}
```

- 原图由浏览器既有素材解析和安全传输边界转为inline；模块本身不抓取URL，不接受asset/blob/HTTP URL或SVG。真实图片字节和尺寸由 `inlineImage` 验证，只接受PNG/JPEG/WebP。
- 单图20 MiB、完整JSON请求64 MiB是本项目本地预算，不是供应商官方上限。可选声明宽高必须与图片实际尺寸一致。
- `point` 严格为完整画幅上的0–1坐标。裁切、改坐标顺序、像素坐标、额外提示词和未支持参数均在提交前拒绝；不进行隐藏裁切或容差放宽。
- `binding` 必须绑定原来源节点、不同的目标节点和mark。绑定留在本地prepared请求/任务记录中，不发送给模型；前端在结果应用前继续检查原焦点会话和素材身份。
- 返回 `{"items":[{"label_name":"…","label_desc":"…","box_2d":[top,left,bottom,right]}]}`。最多8项，全部字段固定，框必须正面积且包含点击点，边界点可包含。任一候选无效则整个结果为unknown，不静默删除候选或合成框。
- `{"items":[]}` 是有效的未识别结果，现有焦点入口显示“未识别到该位置的物体”并清理mark。刷新恢复的旧记录不能复用已结束的焦点会话，也不能作为普通JSON文本节点取回，应重新进入焦点编辑选择目标。

## 模块与集成接口

`server/generation-openai-analysis.cjs` 导出：

```js
validateAnalysisProfile(entry); // 非法配置抛 configuration_invalid
analysisCapabilities(entry);    // 仅报告本模块支持的识别合同
const prepared = prepareAnalysisRequest(request, entry);
// {kind:'image.recognize', body, point, binding}
const result = await submitAnalysis(prepared, {sdk, signal, timeoutMs:600000});
// {status:'succeeded', outputs:[{type:'text', text:'{"items":[…]}'}]}
```

提供方在配置、准备和提交阶段分别调用以上接口，复用现有SDK。请求仅调用 `sdk.responses.create`，发 `POST /responses`，使用完整inline原图、点击点和真实图片尺寸，`store:false`，`text.format.type:'json_schema'`、`strict:true`，不配置工具。提示词要求可空结果、不得编造对象，并将可见文字当场景数据处理。

输出只读取完整 `message` 的实际 `output_text` 正文，不信任孤立helper，不修补Markdown代码块或截断JSON。拒绝、incomplete、工具调用、非法JSON、额外字段、越界框或未覆盖点击点均为unknown。合法坐标和schema只能证明合同满足，不能证明物体名称或视觉定位准确。

## 取消、失败与记录

`maxRetries:0`；异常、429、超时和输出校验失败不会自动重复提交。AbortSignal和本地超时共同中止等待，并阻止忽略signal的SDK替身返回迟到成功；不承诺远端停止或退款。默认10分钟，显式超时须为1–600000毫秒。

任务结果继续使用现有持久记录与幂等查询，重启不会重新发起识别。模块不新增Key、图片、点位或供应商详细错误日志；生成记录仍可能包含既有本机持久任务所需的输入和输出，应按项目既有本地数据管理规则处理。

## 验证和来源

```sh
node --check server/generation-openai-analysis.cjs
node --test tests/generation-openai-analysis.test.cjs tests/focus-edit.test.cjs
```

专项7项与现有焦点3项通过，覆盖真实焦点请求、严格输出、原图与坐标绑定、失败/拒绝/partial输出、零重试、取消和超时、重启幂等。测试使用已安装OpenAI SDK及注入fetch核对一次 `/v1/responses` 请求，不调用真实供应商。独立复审另检查识别媒体及跨模块路由，没有发现阻断。

账号模型权限、真实图像识别效果、细小物体和空间定位准确性尚未经过真实供应商验收；仅凭本机合同测试不能宣布视觉质量达标。官方视觉指南也说明精确空间定位存在限制。

权威合同：[Images and vision指南](https://developers.openai.com/api/docs/guides/images-vision)、[Responses创建参考](https://developers.openai.com/api/reference/resources/responses/methods/create)、[Structured Outputs指南](https://developers.openai.com/api/docs/guides/structured-outputs)，以及已安装SDK的 `node_modules/openai/resources/responses/responses.d.ts`。Responses使用 `text.format` 配置结构化输出；当前图片输入合同不等同于原生视频输入或完整镜头切分。
