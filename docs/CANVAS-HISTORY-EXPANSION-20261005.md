# 画布历史按批次展开 · 2026-10-05

右键图片或视频节点 →「应用所有历史」，将真实历史结果放入一个新分组，每次生成占一行。单个真实历史结果也可展开；没有历史、仅有一个当前资源的旧节点仍提示「无可应用历史」。源节点、连线及小数世界坐标保持原值。

## 官方依据

唯一设计依据为本机官方安装包 `reference/vendor-pkg-canvas-CvuTKiTt.js`；SHA-256 为 `5648122748e3c9d050cdf781a9308f8a584150eb717244dd5d291e108d68d2bb`。该参考包不作为公共静态资源发布。

- `Uat`（字节偏移 3051234）构造独立生成节点，使用每批提示词及参数，清空历史选项。
- `Vat`（字节偏移 3052048）按 `historyBatches` 分行；内边距 80、列间距 56、行间距 72；分组位于源节点右侧 `source.x + source.width + 200`，高度由各行最大节点高度计算。
- `qat.x` 在历史结果存在时创建分组，并 `fitView({duration:800,padding:.2})`；没有要求至少两个真实历史结果。旧 `Bat` 仅在去重后当前资源和备选总数大于 1 时提供一批旧历史。

本地生产入口 `canvas-menus.js` 动态加载 `src/features/node-history-expansion/runtime.mjs`，不新增页面入口或公共 CanvasApp API。模型复用图片/视频历史核心；本地画布储存绝对坐标，因此子节点写入 `group.x + rowOffset`，不把官方相对坐标直接覆盖源节点。

## 本地可靠性保护

这些保护是本地存储/撤销与原站媒体迁移所需，不宣称来自官方设计：

- 图片缺少像素尺寸时先解析真实本地图片；未知原站资源保留原引用，提示需本地导入，不联网回源。
- 解码前后校验源节点对象、内容快照及项目身份；解码失败、修改、撤销重建或切项目时不插入部分分组。
- 子节点只构造生成结果字段，保留历史结果媒体、尺寸、提示词、参数、来源与其自身 sourceRange。不会继承源 editorDoc、tool、agentImageEditor、片场/World 文档或运行任务身份。
- 所有新增组/子节点经既有 `insertGraph` 一次写入，产生一笔撤销；等待 `CanvasStore.flush()` 的真实提交。保存失败保留当前未保存图与既有存储错误提示，不假报成功，也不自动撤销用户后续修改。
- 提交等待后再核对项目与分组对象身份；等待期间撤销、重做重建或切项目不触发过期 fit。fit 仅修改视口，不写节点坐标。

## 验证

```sh
node --test tests/node-history-expansion.test.cjs tests/image-history.test.cjs tests/video-history.test.cjs
node src/features/node-history-expansion/qa/verify.cjs
```

定向单测 33/33 通过；覆盖批次几何、单结果、旧图片/视频、真实历史参数、源文档隔离、解码失败/源更改/撤销重建/项目变化、提交失败与迟到 fit 阻止。修改过的 4 件 JavaScript 文件语法及入口 diff 空白检查通过。

公开生产 QA 从 `git archive HEAD`（`1c17cf8550536a2b26d4021d1b0f68de14dbe943`）生成临时目录，仅覆盖本增量三件生产文件，使用原 `index.html` 与真实 server、CanvasStore、菜单、历史核心。克隆内的 `canvas-data.js` 为明确的本地测试素材，未改工作区数据；无供应商 Key，Fresh Chrome context，不调用生成接口。使用实际右键/菜单点击检查：

- 三个图片历史输出分成两行；180×320 真实图片解码；每批提示词与 count 正确；原节点 JSON 未改变。
- 图坐标精确保留，DOM 对应；Chromium 对 54,000 级 world 坐标的 CSSOM 字符串序列化最大偏差 0.025 世界单位，未据此回写图坐标。
- 新组完整可见的 fit；一次撤销回到原图，重做与刷新后图 JSON 一致。
- 单结果历史可展开；两批视频按行展开并保留各自原视频像素尺寸/时长。
- 页面异常 0，外部请求 0，Agent 配置明确未连接。官方参考文件请求为 403。

报告：[report.json](screenshots/history-expansion-20261005/report.json)；截图：[图片两行](screenshots/history-expansion-20261005/image-batch-rows.png)、[单结果](screenshots/history-expansion-20261005/single-result.png)、[视频两行](screenshots/history-expansion-20261005/video-batch-rows.png)。这些是隔离生产实现 QA，不是官方设计截图；不证明全站视觉同态或真实供应商质量。

主线程另用 Computer Use 在该公开隔离目录启动4298服务，通过正式右键「应用所有历史」得到2行3图并完成自动定位；实际DOM第一行Y=-4075.38、第二行Y=-3559.38（CSSOM显示值），整组一次⌘Z只剩原节点，⌘⇧Z恢复5个节点，刷新仍为5个。没有改工作区日常数据。[Computer Use截图](screenshots/canvas-history-batches-cua-20261005.jpg)。
