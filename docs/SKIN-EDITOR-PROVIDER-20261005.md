# 皮肤编辑专用网关合同

本批实现 `skin-tasks-v1`，用于图片增强面板和 Agent 的独立 `image.skin` 操作。它需要额外的服务器实现本文合同，**不是 Enhancor 原生适配器，不能直接填写 Enhancor Key 启用**。`configured:true` 只证明本机网关地址和凭据配置完整；合成 HTTP 验证不证明远端厂商模型效果或其三档实现。

真实供应商公开合同见 [原生接口研究](SKIN-EDITOR-NATIVE-CONTRACT-20261005.md)。公开 Detailer 与 V1 的队列接口存在，但公网来源发布、必填公网回调、纹理参数映射、可信结果拉取和输出编解码仍未闭环。本批不向猜测的 fal、OpenAI 或 Enhancor endpoint 发送生成请求，不把更窄的接口称为等价三档。

## 配置与责任

选择独立协议 `skin-tasks-v1`，配置自己的任务服务地址、该服务的 Bearer Key，并将 `image.skin` 路由到该服务。`modelMap` 必须省略或为空对象；没有通用图片模型回退。普通 `tasks-v1` 或 `image.generate` 路由不会默认启用皮肤编辑。

专用服务自行实现完整来源和下列模式语义，不得忽略参数、退档、转成普通提示词或通过默认模型声称等价：

| mode | 已观察到的编辑语义 |
| --- | --- |
| `detailed` | `provider:enhancor`, `model:enhancor-detailed` |
| `standard` | `model:enhancor-realistic-skin`, `enhancement_mode:standard`, `skin_texture_level:0.32`, `skin_realism_level:1.7`, `preserve_eyes:true`, `preserve_mouth:true` |
| `heavy` | `model:enhancor-realistic-skin`, `enhancement_mode:heavy`, `skin_texture_level:0.42`, `skin_realism_level:2.3`, `portrait_depth:0.4`, `preserve_background:true` |

这些是原编辑器包装器的已知语义，不是可直接发送给公开 Enhancor API 的字段。`skin_texture_level` 与公开 `skin_refinement_level` 的对应关系未证实，不能自行乘以100。网关实际接入供应商、上传与回调是网关服务器的责任，须另外验证。

## HTTP wire

目的：完整图片皮肤编辑，保持所选档位，单个任务只产生一张图片。

认证：只向配置的任务服务发送 `Authorization: Bearer <gateway-key>`。禁止 redirect；服务返回的字符串、URL、原始和解码像素不得回显凭据。

输入：`POST <baseUrl>/tasks`，JSON 保持原请求：

```json
{
  "kind": "image.skin",
  "nodeId": "result-node",
  "sourceNodeId": "source-node",
  "prompt": "",
  "inputs": [{
    "type": "image",
    "role": "source_image",
    "nodeId": "source-node",
    "url": "data:image/png;base64,<complete-png>",
    "width": 1300,
    "height": 900
  }],
  "parameters": {"mode": "standard"}
}
```

`label` 可选；`count` 省略或为1，`references` 省略或为空数组。来源只允许 `type/role/url/nodeId/width/height`，参数只允许 `mode`。未物化的 `selection/sourceBox/clip/sourceClip/crop/projection/fullImage` 等字段会拒绝，包含空值也不忽略。客户端应先将明确选区保存为独立图片，再作为完整来源。

公开 URL、JPEG、WebP 不能直接作为后端请求来源。前端解析真实来源，在完整解码的原尺寸上转为静态 PNG，不缩小、不虚构尺寸；已支持 PNG 保留提交的字节，其他编码可能改变元数据或 ICC 色彩。输入本机上限32 MiB、32×1024×1024总像素，JSON 请求上限64 MiB。后端校验非交错8-bit RGB/RGBA PNG 的全 chunk CRC、完整 zlib、scanline filters 和全部像素；拒绝动画、未知关键 chunk、压缩文本/ICC metadata `zTXt/iTXt/iCCP`。声明尺寸必须等于解码尺寸。

队列回执：

```json
{"id":"original-task-id","status":"queued"}
```

恢复：`GET <baseUrl>/tasks/<encoded-original-id>`。原任务身份必须保持一致，任务 ID 必填。允许 `queued/running/succeeded/failed/cancelled/configuration_required/unknown`。未知或丢失 POST 回执不自动再提交；接收了任务 ID 后只查询原任务。

成功输出：只允许单张完整内联 PNG，不推测供应商的 URL、编码或尺寸：

```json
{
  "id": "original-task-id",
  "status": "succeeded",
  "outputs": [{
    "type": "image",
    "url": "data:image/png;base64,<complete-result-png>",
    "mime": "image/png",
    "width": 1700,
    "height": 1100
  }]
}
```

`mime/width/height/sourceFileId` 可选，但提供时必须有效并与真实媒体一致。实际输出尺寸由完整解码确定，不猜测为原图尺寸。多结果、非成功附结果、URL结果、错误尺寸、损坏像素及凭据回显保持未确认，不能发布成功或重新生成。输出本机限制为32 MiB、32×1024×1024 pixels；HTTP JSON 响应预算64 MiB。

取消：`DELETE <baseUrl>/tasks/<encoded-original-id>`。只有返回相同 ID 与 `status:cancelled` 才确认远端取消；其他可接受回执保留 `unknown`。

## 权限、失败与归档

媒体准备前检查专用能力，缺配置、普通任务协议、未接入档位、来源或参数变化会阻断读取与派发。模式能力允许诚实的子集，未接入档位给出理由，不自动换为另一个档位。

适配器不读真实 `.env`、不存储 Key 到任务请求、不修改来源、不声明物理效果。结果经过完整校验后进入已有 durable/media-store 私有归档；重启和幂等键查询保留原回执，归档失败复用已取得结果，禁止生成第二次。日志和错误返回通用中文信息及错误码，不包含原始 Key、URL或供应商报错文本。

## 实现与验证

- `server/generation-skin-tasks.cjs`：专用协议包装器，注入既有 HTTP transport，契约版本参与 fingerprint。
- `server/generation-skin-profile.cjs`：三档合同、完整来源和结果 PNG 校验。
- `src/features/image-skin/native-profile.mjs`：专用能力预检和配置披露。
- `src/features/image-skin/media.mjs`：有守卫的完整来源解析和原尺寸 PNG 物化。
- `tests/generation-skin-tasks.test.cjs`：实际 tasks wire、三档完整输入、原任务查询、全codec与凭据防护、来源拒绝、预检和媒体准备。
- `tests/generation-skin-integration.test.cjs`：direct/routed注册、真实私有PNG归档、三档与原尺寸、幂等键和服务重启恢复。

验证命令：`node --test tests/generation-skin-tasks.test.cjs tests/generation-skin-integration.test.cjs`，21/21通过。另以不分配巨大图片的边界夹具验证皮肤32 MiB与打光50 MiB容量文案。覆盖超过普通1 MiB任务响应预算的真实PNG，以及带合法CRC但坏zlib、scanline filter或像素长度的文件。测试只使用临时合成 PNG 与 mock HTTP 回复，不使用真实 Key、上传或付费请求。真实供应商效果、外部网关的供应商实现与公网回调仍需独立验收。

新增持久恢复边界：首个 POST 回执先通过凭据、合法原任务 ID 和状态检查，再等待 `onTaskIdentity` 持久确认，最后校验 PNG。即使首回执为损坏 PNG，也保留可查询身份；实际 routed durable 测试重启后 GET 原 ID 修正结果并归档，POST 始终为1。非法任务身份和凭据回显不写入检查点；检查点失败不发布结果。
