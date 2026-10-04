# 图片多角度原生替代适配 · 2026-10-05

`image.multiAngle` 现在可以由操作者显式选择 fal 的 `fal-ai/qwen-image-edit-2511-multiple-angles`，完成单图提交、原任务查询恢复和本地图片归档。它是 **Qwen 2511 Multiple Angles 原生替代后端**。TapNow 实际使用的后端转换未公开，本项目不能据此宣称模型身份、参数效果或生成画面与 TapNow 等同。

## 配置与适用范围

服务端协议为 `fal-native`，只接受以下精确别名、操作和模型组合；Key 单独通过私有进程环境提供。已有供应商或模型配置时，合并相应 JSON 条目后重启服务，不要用以下单功能示例覆盖其他配置。`.env.example` 不会自动加载。

```sh
export GENERATION_PROVIDERS='{"fal":{"protocol":"fal-native","apiKeyEnv":"FAL_KEY","modelMapEnv":"FAL_MODEL_MAP"}}'
export GENERATION_ROUTES='{"image.multiAngle":{"models":{"image.multiAngle":"fal"}}}'
export FAL_MODEL_MAP='{"image.multiAngle":{"kind":"image.multiAngle","model":"fal-ai/qwen-image-edit-2511-multiple-angles"}}'
```

`FAL_KEY` 应在启动服务的进程环境中设置真实凭据，本文不提供 Key。普通 `fal-ai/qwen-image-edit-plus` 需要 `prompt`，没有这些相机字段；把它填进映射会使配置无效。模型映射别名也不能换成其他名称来隐式启用替代语义。只配置 BiRefNet 或 Topaz 不会启用多角度。

适配器只在精确映射存在时公开以下能力描述；凭据和供应商 endpoint 不包含在浏览器配置响应中：

```js
capabilities.multiAngle = {
  semantics: 'explicit-native-alternative',
  label: 'Qwen 2511 Multiple Angles',
  tiltRange: [-2 / 3, 1],
  wideAngle: false
}
```

前端与路由器都将未填写模型别名的 `image.multiAngle` 请求识别为公开别名 `image.multiAngle`。显式填写不同别名时必须按该别名验证，不能自动回退。

## 四项参数的明确解释

以下是本项目选择并公开的替代转换。它采用有符号水平角、已有预览的倾斜角度和原有缩放刻度，不能当作 TapNow 服务端实现的证据。转换接收的是现有请求字段；UI 在提交前已对水平旋转值取负，因此此处不会再次取负。

| 本地请求字段 | 必须提供的值 | 供应商字段及转换 |
| --- | --- | --- |
| `rotate_right_left` | 有限数值，[-90, 90] | `horizontal_angle = (value + 360) % 360`；例如 -30 → 330° |
| `vertical_angle` | 有限数值，[-2/3, 1] | `vertical_angle = value * 45`，即 [-30°, 45°] |
| `move_forward` | 有限数值，[0, 10] | `zoom = value` |
| `wide_angle_lens` | 布尔值 `false` | 无等价供应商字段；`true` 必须拒绝，不能丢弃后提交 |

fal schema 的垂直角允许 [-30°, 90°]，本地继续受原 UI 上限 1（45°）约束；原 UI 下限 -1 会产生 -45°，超出该后端范围，故替代后端下限为 -2/3。没有截断、自动改值或静默丢弃参数。供应商的水平角解释为 0° 正面、90° 右侧、180° 背面、270° 左侧；垂直角负值向上看、正值向下看；zoom 0 远景、5 中景、10 近景。这些是供应商语义，不保证模型画面精确遵循几何预览。

## 请求、输出与恢复

- **目的：** 对一张绑定图片生成一个新视角结果。
- **输入：** 一个 `inputs` 图片、四项明确相机参数、空提示词；可保留已有画布结果/批次元数据。PNG/JPEG/WebP 内联字节或无凭据的公网 HTTPS 图片地址有效；私有资产标识、blob、本机地址、额外参考图和多个输出请求拒绝。host 应先完成源媒体绑定与规范化。
- **提交：** 一次 POST 到 `https://queue.fal.run/fal-ai/qwen-image-edit-2511-multiple-angles`，body 为 `image_urls:[source]`、`output_format:'png'`、`num_images:1`、`sync_mode:false` 及上述三个转换后的相机字段；不添加 prompt。
- **输出：** 只接受真实供应商 `images` 数组中的一个结果。URL、MIME、存在的宽高字段均检查；缺失尺寸时不编造尺寸。持久网关继续通过媒体 materializer 检查并归档图片，公开任务成功结果只有 `/api/generation/media/{resourceId}` 本地地址。
- **恢复：** 接受后保存 `fl1` 封装的原模型、供应商 request ID 和操作类型；重启后按原身份 GET `.../requests/{id}/status?logs=0`，`COMPLETED` 后 GET `.../requests/{id}`。路由移除仍可按已保存供应商恢复；原供应商模型映射移除或身份冲突时拒绝恢复。
- **取消：** 对原 endpoint/request ID 发 PUT `.../requests/{id}/cancel`。取消回执仅表示请求已接受，不宣称供应商执行已停止。
- **权限：** API Key 由服务器持有，只用于已验证的 fal queue HTTPS origin；任务不能携带凭据或选择目的地址。结果下载与本地媒体读取沿用既有权限、字节上限和任务归属校验。
- **失败：** 不支持的参数在 HTTP 前拒绝；缺失/多张/无效结果、未确认状态或不确定 POST 保持失败或 `unknown`，不会重新发起生成。查询恢复始终针对原任务。
- **记录：** 沿用持久任务的公开 ID、供应商身份、提交状态、恢复和归档状态。公开配置不暴露 Key/endpoint；错误消息不回显供应商错误正文。测试日志只含合成数据。

## 实际证据与限制

2026-10-05 读取当前安装 TapNow **0.4.81**：

| 官方安装文件 | SHA-256 | 证实的范围 |
| --- | --- | --- |
| `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` | `mOl` 向 TapNow 自有 `api/conversation/v1/generations/image` 发送 `scene:'image-edit'`、`provider:'fal'`、`model:'qwen-image-edit-plus'`、源图和四项原字段；只证明前端 wrapper |
| `/Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js` | `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` | 原 UI 默认旋转 -30、缩放 0、倾斜 .5、广角 false；原 UI 范围与提交转换 |

fal 依据来自公开无凭据 GET，未提交供应商任务：

- [Multiple Angles API](https://fal.ai/models/fal-ai/qwen-image-edit-2511-multiple-angles/api)
- [Multiple Angles queue OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-image-edit-2511-multiple-angles)
- [普通 Qwen Image Edit Plus queue OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-image-edit-plus)

前两项证实 `image_urls`、水平角 0–360、垂直角 -30–90、zoom 0–10、异步队列、`images[]` 输出以及 POST/GET/PUT 路径。第三项证实普通模型需要 prompt，不能把四项旧字段直接用于该接口。TapNow 自有打光 `image.relight` 不是本适配覆盖的操作。

## 验证

```sh
node --test tests/generation-fal-multi-angle.test.cjs
node --test tests/generation-fal.test.cjs tests/generation-fal-queue.test.cjs tests/generation-fal-integration.test.cjs
```

本次新专项 **12/12**、已有 fal/provider/queue/integration **23/23** 通过。专项覆盖精确 opt-in、公开能力、前端/路由默认别名一致、角度边界、所有字段严格校验、源图边界、原身份恢复、无效结果、取消和不确定 POST 一次提交。

其中一个测试启动真实本机 HTTP 服务，通过实际 router/gateway/materializer 走完整流程：一源 PNG → mock queue POST → 未确认状态多次查询 → 重启并移除当前路由 → 原 request ID 恢复 → 下载合成 PNG → 字节归档 → HTTP 读取本地结果。过程中 POST 总计一次，成功 `outputs` 无供应商媒体地址。mock 只代替外部 fal 和图片下载，不代替本地网关或归档模块。

这些证据验证本地协议、状态和媒体归档，不代表真实 fal 账号可用、供应商生成质量或 TapNow 视觉等效。没有真实 Key、付费 POST 或模型画面质量验证；浏览器交互验收由该功能对应的 UI 验证记录另行说明。

## 本批前端闭环

生产前端在配置确认后才解析源图和创建占位，公开能力标注Qwen2511原生替代及-30°/广角限制；该后端隐藏原站固定积分估算。源项目/对象及目标对象须保持身份，关闭面板的迟到读取不造节点，失败清理不能删除同ID的替换对象。初始及完成后所选结果使用完整包围盒取景，保持源节点的分数坐标。

Computer Use 通过广角/-45°两条零提交与默认一次提交/连线/180×320真实PNG解码；配置页routed/native/gateway/offline、清单展开/滚动、Escape回焦通过。浏览器任务响应为本机合同PNG，不证明真实模型效果。见[统一验收记录与截图](OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md)。
