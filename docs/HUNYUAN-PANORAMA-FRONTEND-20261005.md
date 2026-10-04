# Hunyuan 图生360全景前端

公开型号 `hunyuan-world-panorama` / `Hunyuan World Panorama` 是独立供应商替代，不是捕获的 TapNow 型号，不替换其他图片型号，也不提供世界生成或全景区域编辑。

## 操作与约束

在图片生成节点绑定一张普通参考图后选择型号。规格固定为图生360全景、2:1、单结果、供应商原生尺寸；没有画质、种子、步数、思考、相机、风格或区域编辑开关。已开启的相机或风格意图会阻断型号选择/请求；关闭相机后的记忆标签可以保留，但不会作为供应商参数提交。切换回原图片型号恢复之前尺寸和数量设置。

Agent图片确认卡及独立目标批量确认同样提供此型号，显式透传 `isPanoramaPrompt:true`、`aspect:'2:1'`、`count:1`。固定参数来自型号选择；原调用明确指定的不兼容参数保留并阻断确认，不由规范化偷偷删除。每个批量子任务仍必须只有一张实际源图。

仅精确别名和 `fal-panorama-native`、已声明的 `capabilities.panorama[alias]` 可以通过配置守卫。服务端目前的可靠输入/输出子集为非交错8-bit RGB/RGBA内联PNG；源图片须在项目、对象身份、选择和配置守卫通过后按原尺寸真实解码再物化PNG。实际媒体准备、任务路由、源对象守卫、恢复和结果插入由 `generation-ui.js` 与 `panorama-media.mjs` 集成。

## 辅助模块

`src/features/image-generation/panorama-native.mjs` 提供：

- `prepareNativePanoramaRequest(request)`：先验证原始参数和单图输入，再投影供应商白名单。未选择此型号的请求保持原样。
- `assertNativePanoramaConfiguration(metadata, request)`：检查精确路由与原生全景能力，返回准备后的请求，不进行媒体读取。
- `validateNativePanoramaOutputs(outputs, {decode, signal})`：单张图片真实解码后，严格检查实际宽度为高度两倍及回执尺寸一致。`image/fullImage` 非空时必须与 `url` 相同，避免验证和应用使用不同引用。返回测量尺寸；不创建节点或写历史。

结果必须在画布/历史插入前验证，验证之后再核对源对象守卫；360按钮仍由既有图片全景模块通过实际解码尺寸显示。不能凭提示词、型号名称或供应商尺寸标签接受结果。

## 验证

```bash
node --test tests/image-panorama-native.test.cjs tests/agent-generation-counts.test.cjs tests/generation-result-counts.test.cjs tests/generation.test.cjs
```

覆盖精确型号、单参考/单结果、请求纯函数与幂等性、配置路由、相机/区域等意图零派发、实际解码/尺寸/多引用不一致、编辑器重开、Agent真实schema及批量确认。既有 `agent-generation-counts` teardown测试补充 `audioMetadataRevision:0` VM变量，匹配生产已有音频卡清理代码；未修改生产清理行为。

隔离生产画布QA：`/src/features/image-generation/qa/panorama/main.html`。使用公开图片与本地PNG夹具，独立CanvasStore、LocalAssets、模板数据库和内存localStorage；阻断真实API和外部请求。提供正常2:1、未配置、错误画幅、损坏图片、延迟回执和状态待确认场景，以及相机/第二张源图控制。夹具结果不代表真实付费模型生成。浏览器验收由主任务单独记录，本文不将脚本测试等同于生产画布实测。
