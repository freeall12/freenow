# 生成前的操作与模型配置检查

2026-10-03：服务已填 Key 不代表当前节点型号已经映射。`provider-configuration.mjs` 增加具体配置诊断，正式任务在读取媒体、预留结果或派发之前使用它。

## 行为

`providerConfigurationStatus(metadata, request, {operationOnly: false})` 返回 `configured`、`reason`、`message`、当前操作/供应商、公开模型别名、可用别名和缺少的环境变量名称。`providerConfigured` 保留布尔或 `null` 返回值，并复用相同检查。

- 缺路由：指出 `GENERATION_ROUTES` 与具体操作 kind。
- 缺 Key/模型映射：列出缺失环境变量名称，不展示值。
- 当前原生适配器不支持操作：列出已配置操作，提示连接支持此操作的适配器或 tasks-v1 网关。
- 原生适配器支持操作、但该操作未配置：指出对应操作需要模型映射。
- 型号未映射：指出当前公开别名、操作 kind、模型配置入口及同操作可用别名。直接原生配置提示 `GENERATION_MODEL_MAP`；路由配置提示所选供应商的 `modelMap` / `modelMapEnv`。
- 完整提交没有模型别名：拒绝提交并提示选择已配置型号。识别/分镜解析等已有隐式公开别名保持不变。

`availability({kind})` 是操作级查询：没有指定别名时传入 `operationOnly:true`，判断是否存在可用模型，包括只有别名路由而没有 default 的配置。`availability({request})` 和实际提交使用默认严格检查；显式选择未映射型号不会因操作级查询而获得放行。配置查询期间服务切换仍重新检查当前服务。

## 元数据边界

完整 `capabilities.models` 表具有模型别名检查能力。直接 Ark 的 `capabilities.video`、直接 OpenAI 的 `speech` / `analysis` / `videoAnalysis` 也是对应操作的完整别名表，前端可用已有字段检查，无需更改服务端响应契约。

直接 OpenAI 图片/文字目前没有公开完整模型表。前端检查已配置操作与合法别名，具体别名是否映射仍由后端验证。`imageReferences` 只包含支持图片参考的模型，不能据此拒绝普通文生图。配置测试确认默认无图片参考模型仍能通过后端 prepare，同时不存在的图片/文字别名仍被后端拒绝。

旧直接元数据只有 `configured` / `protocol` 时保留兼容行为。tasks-v1 的模型能力由所接任务网关决定。就绪状态不证明供应商账号权限、参数支持、生成质量或真实计费调用成功。

## 定向验证

```sh
node --test tests/generation-direct-provider-readiness.test.cjs tests/generation-provider-configuration.test.cjs
node --check src/features/node-composer/provider-configuration.mjs
node --check qa/provider-routing-fixture.js
node --check qa/provider-routing-controls.mjs
git diff --check
```

18 项相关测试通过。覆盖实际原生 metadata、默认模式和模型 prepare、单供应商与路由缺别名、操作级查询、请求级严格检查、服务切换、具体错误以及零媒体读取/结果预留/派发。旧 VM 测试夹具补上已存在的配置刷新、配置身份与本机会话保存接口；不替换产品运行链。

## 正式节点的合成界面入口

既有隔离页：`/qa/provider-routing-app.html?session=独立验收标识`。

1. 点击“合成直连 Ark：仅映射 Seedance 2.5”。
2. 点击“准备正式 Seedance 2.0 视频节点”。这通过实际 `CanvasApp` / `NodeEditor` 设置正式节点，不创建第二个 TaskService。
3. 点击正式节点编辑器的生成按钮。
4. 预期显示 `seedance-2.0` 未映射，配置入口 `GENERATION_MODEL_MAP`，可用别名 `seedance-2.5`；`posts=0`、`mediaReads=0`、`pendingNodes=0`，任务 `configuration_required`、`providerDispatched=false`。

该模式仅模拟公开配置能力，没有 Key 或供应商地址。计数先记录所有 POST 尝试，再拒绝未允许请求，避免将一次失败派发误报为零派发。夹具禁止外部 fetch；偏好存在页面内 Map，避免本机 localStorage 配额满导致验收无法初始化；实际图/素材继续使用隔离 session 的 IndexedDB。没有删除用户或其他 QA 数据。刷新会重置合成模式与计数。

主任务已通过 Computer Use 在 `http://localhost:4173/qa/provider-routing-app.html?session=direct-ark-live-1003` 执行上述步骤：切换合成直连 Ark，准备正式 Seedance 2.0 视频节点，并点击真实节点编辑器的生成按钮。

实际任务为 `configuration_required`、`providerDispatched=false`；`posts`、`mediaReads`、`pendingNodes` 均为 0。正式任务面板明确显示公开别名 `seedance-2.0` 未映射、配置入口 `GENERATION_MODEL_MAP`、可用别名 `seedance-2.5`，并提供“连接 API”按钮。截图保存在开发机 `/tmp/freenow-direct-provider-readiness-20261003.png`，公开仓库不依赖此文件。

该浏览器结果确认合成公开配置下的正式节点提示与零派发行为，不代表真实供应商 Key、账号权限、生成质量或计费调用成功。补录此结果后冻结文档，没有重新运行测试。
