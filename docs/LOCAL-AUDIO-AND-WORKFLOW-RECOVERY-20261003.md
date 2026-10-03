# 本地音频与分组持久恢复

本批保持运行时独立，不添加原站服务、账号、资源回退或新依赖。官方包仅作音频完成及分层调度依据。最终 freenow 可见品牌与应用生成水印替换仍按用户要求留到完整功能完成后，不修改来源证据、许可、兼容键或用户媒体内容。

## 实现

- 普通音频生成原位更新，原 ID、配置、模式、位置和连线保持。首项播放，全部真实本地音频及各项时长、字幕、来源保留；首项字幕绑定原音频。参数草稿、异步准备及解码期间变更有保护。播放器点击不再被新弹出的编辑面板截断。详见[音频合同与验证](AUDIO-GENERATION-IN-PLACE-20261003.md)。
- 分组保留依赖分层、同层并行、整层结果保存后推进。首次提交前保存计划和原任务 ID，材料化后另存最终请求签名，全部成功才允许生成。停止保留已登记任务，不取消原远程任务。
- 刷新恢复只查询原任务；unknown/404不视作未提交，不自动重发。用户明确继续才提交未启动层。原位应用先保存完整提案，再保存图，再写完成收据；两个崩溃窗口均保留原结果身份与本地引用，恢复保留用户新位置、尺寸、标题。
- 项目 Web Lock、同页串行队列、显式存储版本 CAS 及事务内资格校验防止抢占和覆盖。`CanvasStore.writeRecord` 新增可选 `expectedRevision/canCommit`，旧调用兼容，不变更数据库版本。详见[恢复合同](../src/features/workflow-recovery/README.md)和[前端接线](../src/features/workflow-recovery/INTEGRATION.md)。

## 实际浏览器证据

音频使用生产主壳与真实本机 WAV 合同回放；实测约 2 秒和 3 秒输出。普通生成、第二次生成与刷新保持原音频/字幕 ID。播放按钮未选中及选中时分别观察到 `currentTime=0.343/0.439`、`paused=false`。保存确认失败后重试，夹具调用数 2、撤销数 6 均不增加；真解码等待期间改参数拒绝旧结果。

分组使用 `src/features/workflow-recovery/qa/main.html`：生产主壳、WorkflowAPI、TaskService/httpProvider、IndexedDB 和 Web Locks；传输为页面内持久模拟 HTTP，输出明确标注合成合同文本。它验证生产浏览器接线，不证明真实服务器 GET 或供应商联调。

| 场景 | 实测结果 |
| --- | --- |
| 首层 A/B 并行后刷新 | POST 保持 2，重复 POST 为 0；C 仍 pending |
| 原 ID 查询后应用 A/B | 两节点原 ID 与结果标记保存；C 不自动提交 |
| 正式恢复弹窗明确继续 | POST 变为 3；释放 C 后三节点 applied，刷新图一致 |
| 同项目第二页面 | writable=false；正式运行确认按钮禁用 |
| 首层执行时停止 | POST=2、DELETE=0；A/B applied，C pending，执行 stopped |
| 图保存后完成回执失败 | 持久状态 applying/applied/pending；刷新只增加一次原 ID GET，补齐 applied，图完全相同，POST=2 |
| 原任务 GET 404 | 两项保留原 ID 与 unknown，C pending；POST=2、重复 POST=0，无结果落图 |

截图：`/tmp/freenow-audio-original-node-20261003.png`、`/tmp/freenow-workflow-recovery-dialog-20261003.png`。机器可读本机证据：`/tmp/freenow-audio-workflow-20261003.json`。不提交个人运行状态与本机截图。

## 定向检查及范围

音频专属 6 项、字幕 7 项；新生成桥接 10 项、工作流 journal 19 项、host 5 项、context 2 项、dialog 2 项与原调度 4 项均通过。存储记录相关 10 项和既有应用 9 项通过；还有作者运行的派发/恢复/媒体准备相关检查。独立复核修复停止语义、时间戳/媒体提案漂移、几何覆盖、输出解码元数据指纹及音频异步变异问题。没有为本批重复运行全套。

浏览器未覆盖图片/视频/音频混合分组全部组合，意图已存但图未存的恢复通过定向测试；实际浏览器覆盖的是图已存、完成收据失败窗口。真实供应商、92 份精确模板、SPZ、全站菜单/hover/坐标与大媒体性能仍待关闭。工作流保留最多 100 条运行记录，历史归档策略尚未补齐；不能把本批完成等同整站一比一复刻完成。
