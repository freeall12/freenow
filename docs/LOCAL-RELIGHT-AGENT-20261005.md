# 图片重新打光与 Agent 本机验收 · 2026-10-05

已接通正式打光面板、Agent 五组参数、独立 OpenAI SDK 编辑、本地任务与 PNG 归档。保留官方控件与预览，移除固定“20点数”，显示实际配置状态。**这是显式参数提示词编辑，不保证原站私有模型效果、物理光照精度、输出尺寸或画幅与来源一致。真实 Key、账号资格及图像质量尚未验收。**

## 官方证据与本地实现

- 对照本机安装包和官方 Web：默认50% / 5600 K / 轮廓光开；主光移到后方会关闭并禁用轮廓光，回到前方不会自行打开；正面视图下重置保留视图；Escape关闭并取景。没有点击官方生成或请求私有打光接口。
- 26主光位、10个轮廓光资格位置、亮度10/50/100、六档色温、三种轮廓光位置均由原参数模块和后端逐项比对。来源路径、哈希、原关闭逻辑及仍未知的取消手势见[参数契约](RELIGHT-PARAMETER-EDIT-CONTRACT-20261005.md)。
- `openai-relight-native` 要求明确 `parameter-prompt-edit` 映射，将全部五参数编译到 `images.edit` 指令。使用完整原尺寸输入；支持的PNG保持字节，其余静态图片经浏览器原尺寸规范化，可能改变编码、元数据及ICC色彩；APNG拒绝。结果宽高来自真实PNG解码。[供应商配置](OPENAI-RELIGHT-NATIVE.md)
- Agent 审批绑定来源对象、项目、选区、参数和配置；先保存原任务ID，再准备媒体和派发。成功后只添加一个连接节点，保存失败重试复用该结果。[Agent合同](AGENT-RELIGHT-PARAMETER-EDIT-20261005.md)

## 实际 Computer Use

运行正式 `index.html` 派生的隔离宿主、正式 Three 预览、TaskService、AgentUI、routed gateway 和已安装 OpenAI SDK。仅模型回复/供应商响应固定为公开合成数据；测试陶瓶是几何PNG，不是模型打光效果。宿主使用独立 IndexedDB、临时服务目录和内存偏好，不访问私人素材或真实Key。

| 操作 | 实际结果 |
| --- | --- |
| 光位、正面视图、重置、键盘轨道和说明 | 后方禁用轮廓光、返回前方仍关；正面重置保留正面并开灯；End亮度100、Home色温2000，键盘焦点显示说明 |
| 面板生成 | 完整512×320、3029字节源图经真实SDK multipart；五参数完整；一个768×512结果、一个连接，保存后面板关闭 |
| 保存失败与正式“重试应用结果” | 出现“结果应用失败”；原节点保留，重试后保存成功；节点数不变、SDK POST不增加 |
| 缺Key | 正式生成按钮禁用并显示具体缺项，零新增模型提交 |
| 配置读取期间关闭或换fullImage | 释放迟到响应后没有新增任务、节点或SDK POST |
| Agent等待批准期间换图 | 正式“允许此操作”返回来源变化错误，零模型提交、零任务回执 |
| Agent正常批准 | 五参数和独立编辑说明完整；审批前零POST；正式会话持久化检查为`acknowledged:true`后才派发；一次SDK POST、一个连接结果、真实保存完成 |
| 刷新Agent会话与结果 | 原五参数和任务ID可从正式“调用详情”回读；结果768×512可解码，SDK POST保持1；TaskService内存任务列表不作为跨刷新证据 |

前一宿主的面板成功任务与保存失败任务分别为 `3c1037f0-7866-4c41-98e0-7c79de27d213`、`732d3993-a24a-49d3-8d20-e4097c9e2a2b`，两次生成共2次SDK POST，保存重试没有第3次。最终独立会话的Agent任务为 `c5a1bb49-5858-4190-9af6-4d2f925cd028`，一次SDK POST；刷新后“调用详情”仍为同一ID。任务ID只证明提交身份，成功与落图另由任务/保存及媒体解码状态确认。

![完整源图与正式打光面板](screenshots/image-relight-native-panel-20261005.jpg)

![正式Agent打光确认卡](screenshots/agent-relight-approval-20261005.jpg)

截图为真实本地页面的矩形裁剪，保留完整面板/审批卡及相邻上下文；没有修改产品CSS或生成式修图。浏览器默认缩放导致整页留白较大，因此仅裁切文档所需区域。官方画布截图只保留开发机，不发布用户画布素材。

## 验收中发现并修复

1. **配置保存快照遗漏。** 配置写入成功后同步保存公开快照，避免后续派发误判变化；7项快照回归通过。旧供应商fixture补齐真实快照逻辑后15项通过，没有放松生产判断。
2. **Agent沿用过期配置。** 审批前主动刷新能力，再捕获快照，防止旧超时/缺配置缓存持续阻止已恢复服务。实际client审批段回归覆盖缓存恢复及刷新期间的来源、会话、参数、取消保护；正式确认卡已显示可用的独立编辑说明。
3. **PNG凭据回显边界。** 原字节与解码像素检查UTF-8/UTF-16；来源和结果拒绝未审阅的压缩元数据块。前端在原尺寸规范化此类静态PNG，readiness核对完整限制声明；不把该检查当成通用OCR或隐写检测。
4. **QA历史种子。** 初始`/src/`动态图片被写进撤销历史，触发两条资源迁移提示；改为真实PNG data URL。新会话刷新不再出现提示，没有修改生产白名单或清除旧会话数据。
5. **本地图片启动竞态。** 刷新已保存`asset:`节点时，缓存的动态图片模块可能早于后面的`local-assets.js`执行，导致`LocalAssets.url`未就绪，图片一直为空。正式入口前移依赖顺序；新宿主刷新后源图真实解码512×320、错误title为空，无迁移提示且SDK POST为0。旧宿主的失败证据保留，没有清理数据冒充恢复。

## 性能和定向验证

打光stage复用灯位Vector3、灯遍历数组和辅助线Color。60帧目标构造点从120/180/110次降到0；逐帧灯位、相机、shader时间、缓冲及屏幕投影严格一致。真实Three预览已渲染；未测GPU耗时或整体FPS，不能据分配下降宣称帧率提升。[性能证据](RELIGHT-STAGE-FRAME-ALLOCATION-20261005.md)

| 检查 | 范围与结果 |
| --- | --- |
| `tests/generation-openai-relight.test.cjs` | 12项通过：完整参数、真实SDK multipart、PNG、凭据、unknown、取消与一次调用 |
| `tests/generation-relight-integration.test.cjs` | 4项通过：直连/路由、归档、持久重启、原ID恢复与unknown不重发 |
| `src/features/image-relight/qa/frontend.test.cjs` / 原core | 16项前端/core通过；随后metadata声明变异与相邻readiness 2项通过 |
| `src/features/image-relight/qa/server.test.cjs` | 实际HTTP/SDK/routed/PNG归档与QA种子迁移1项通过 |
| `tests/agent-relight.test.cjs` | 12项Agent专项通过，后补实际审批刷新2项通过；通用图片处理7项通过 |
| `tests/image-relight-stage-allocation.test.cjs` / 原core | 2项逐帧/生命周期加7项参数/拖动/定位通过 |
| `tests/local-assets-entry-order.test.cjs` / 图片展示 | 2项启动顺序/真实资源字节回归加3项既有展示检查通过；浏览器刷新另验 |

这是分工执行、交叉审阅和必要回归，不是反复全库测试。直接加载的Agent client无需重建编辑器bundle。

## 复现与边界

```sh
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  node src/features/image-relight/qa/server.cjs 0 pipeline agent
```

在输出地址选择独立`session`。详细操作见[QA说明](../src/features/image-relight/qa/README.md)。关闭该临时宿主会回收其临时任务与结果目录，不用于日常项目；正式服务的归档目录独立保留。

浏览器QA内存localStorage会在刷新后清空TaskService列表，因此只证明画布、像素与Agent会话恢复，不证明浏览器任务列表或待应用结果跨刷新恢复。服务端持久任务重启与同ID不重发另由集成测试验证。保存失败应用重试仍依赖当前页面内的来源/结果身份，不承诺任意跨重启自动重建应用闭包。

未使用真实模型Key，未调用原站生成服务或付费API。同步图片编辑没有可查询的供应商任务ID；未知状态保留本地身份、不重POST。关闭本地面板或等待不能保证停止远端计算或计费。全站页面、92份精确创意HTML、SPZ、其他专用供应商和长期性能验收仍开放。
