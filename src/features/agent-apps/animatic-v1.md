# 历史动态分镜 v1

来源为保留的 `resources/apps/animatic@v1.7f4d2fcb.html`。此模块独立实现该页实际使用的播放、总览、状态和消息协议；原 HTML 字节保持不变。

## 输入与来源

`show_app` 使用 `ui://tapnow/animatic@v1`。原始 `data` 只接受：

```js
{
  version: 1, // 可省略
  locale: 'zh-CN', // 可省略，原页采用宿主 locale，然后回退 en-US
  title: '动态分镜', // 可省略
  sheets: [{
    sheet_id: 'board-1', label: '场景一', node_ref: 'node/actual-image-id',
    // cells 可省略，宿主默认 3×3；所有矩形在真实图片的归一化范围内
    shots: [{shot_code:'S01', cell:0, duration:2, move:'push_in',
      transition:'cut', size:'MS', script_text:'打开信封'}]
  }]
}
```

每张必须引用当前画布真实本地图片；不能注入 URL、纹理、单镜头替换图或新版编辑参数。宿主有界读取 PNG/JPEG/WebP，解码真实像素生成预览，同时记录快照、实际字节 SHA256 和当前项目。支持本地 asset、blob、data，以及严格同源生成媒体引用。上限：32 张、每张 9 镜、总 96 镜；镜头时长大于 0、至多 60 秒；单图 16MiB、源图总量 64MiB、预览总量 2MiB、最终数据 4MiB。

`createAnimaticV1Runtime` 只提供 `prepareAppArgs`、`bindPreparedResult` 和 `capture`，不含生成、变体提交／查询或画布修改。准备回执存储 `animaticV1SourceContext`。

## 原版状态与协议

时间线保持故事板顺序，每张按 `cell` 排序，时长不作新版编辑／夹取。

```js
{selected_shot_code:'S01', view:'player', playing:false}
```

总览为 `view:'overview'`。保存状态必须引用真实镜头，始终暂停；新版 `v/selected_shot/edits/order/deleted/variants` 字段会被拒绝。

确认：`AN1 v=1;a=confirm;sheets=N;shots=N;dur=X.X`。退回：`AN1 v=1;a=reject`。消息必须精确匹配原页五种语言之一的完整摘要、` — ` 和 token。确认时重新读取全部来源字节，核验当前卡片、项目、会话、trace、response、保存状态对象与指纹；异步核验期间变化、图片同址替换、超时和关闭均失败。取消后迟到的媒体响应会释放真实流。

这是普通新用户回合交接，不意味着媒体已生成，也不扩大普通工具或生成权限。

## 专项验证

```bash
node --test tests/agent-animatic-v1.test.cjs tests/agent-apps-historical-tools.test.cjs
node --test tests/agent-historical-resource-loader.test.cjs tests/agent-animatic-local-errors.test.cjs
node --check src/features/agent-apps/animatic-v1.mjs
node --check src/features/agent-apps/animatic-v1-runtime.mjs
node --check agent-tools.js
```

协议、几何和五种语言消息以原 HTML 的独立函数作为 oracle。测试覆盖来源／状态变化、URL注入、版本越界、并发迟到、读取预算与取消流。单元测试的解码 adapter 使用受控预览；生产画布、原 iframe 展示和跨刷新恢复需通过真实浏览器验收。

2026-10-03 首次真实浏览器检查发现 proxy 按 `animatic` 家族无条件启用 v2 专用错误适配，导致历史 v1 在加载阶段被拒绝。加载器现在只对 `animatic@v2` 启用该适配。回归执行正式 `handleResourceReady` 与 manifest 路径读取实际磁盘资源，确认 v1 不导入 v2 适配，传入 CSP 构造前的原 HTML 字节完全一致；新版适配的哈希和错误分类专项保持通过。
