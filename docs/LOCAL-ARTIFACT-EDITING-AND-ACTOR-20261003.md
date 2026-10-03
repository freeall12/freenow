# 本地作品编辑、预览退出与人物参考迁移

2026-10-03。本批为增量交付，完整一比一与最终 freenow 品牌仍未完成。运行输入不增加原站请求；生成能力仍走独立可配置供应商。

## 交付

- HTML 产物侧栏接入「在对话中讨论」：重新读取最新版本，保留中文草稿和其他引用，等待真实会话持久保存，不自动发送。切换项目/会话时拒绝迟到回写。
- HTML 预览双 iframe 转发真实 Escape，内部菜单和原生 dialog 优先关闭；保留原文 doctype、离线 sandbox/CSP 与导出原文边界。
- 已校验来源的模板可编辑本地正文：原 source 只读、编辑副本使用 revision CAS；失败留稿、脏稿退出确认、IME 保护与保存回焦。源码编辑器属于本地管理能力，不能作为已证实官方界面的一比一依据。
- 旧人物卡的精确 reference_nodes.preview_url 槽位可迁移：只读已收录本机字节，核对 SHA/MIME/容量/真实图片尺寸后保存。未知来源明确待导入，不联网回源；参数、来源快照、引导与恢复记录不改。
- 独立复核关闭大写 HTTPS 协议识别问题；哈希继续使用原始 URL 字符串，避免破坏精确映射。

## 实际验证

主任务通过 Computer Use 操作真实浏览器：

1. 完整画布隔离页保存 HTML revision 2，保留既有中文草稿，侧栏讨论后 composer 获得焦点。CanvasStore 回读 artifactRefs 为 revision 2、messages 为 0；刷新草稿/引用仍在。
2. HTML 内部菜单及原生 dialog 各自消费第一下 Escape，第二下退出外部预览并回到打开按钮。
3. 合成普通 HTML 使用真实 artifactStore：成功保存 revision 2；失败留稿、继续编辑、放弃后刷新仍为已保存正文；来源失效阻止写入；修复焦点后保存 revision 3，正文 textarea 获得焦点，干净退出返回打开按钮。
4. 旧人物卡已收录 PNG 迁移后，实际嵌套 iframe 缩略图为 data PNG 且解码为 200×200，灰模输出为 512×512；刷新后两图仍可解码。未知引用保持待导入。该 QA fetch 计数为 localReads 1、originalReads 0，不能泛化为全站网络验收。

截图留在本机：`/tmp/freenow-html-discussion-20261003.png`、`/tmp/freenow-html-preview-escape-20261003.png`、`/tmp/freenow-template-editor-saved-20261003.png`、`/tmp/freenow-actor-preview-migration-20261003.png`。

定向检查已分别完成：预览/导出 16 项、讨论草稿 6 项、模板编辑相关 24 项及新增焦点专项 1 项、人物迁移/typed proof/原会话 17 项及新增大写协议专项 1 项。修复后仅跑新增相关项，未重复全套。独立审查复验大写/小写双 fixture，未发现剩余本批已复现 P1/P2。

## 边界

- 合成编辑器页面及 mock digest 的单元 fixture 仅验证机制，不证明取得官方 92 份模板正文；真实模板正文仍缺失。
- 未扩展到任意 App state/恢复日志迁移；普通内嵌 Widget 的退出逻辑也未在本批改动。
- 既有 CanvasStore 使用共享 revision map，额外同键读取可能推进旧写入基线；独立最小复现证实其合同限制，但当前迁移调用链未发现该并发路径，留待存储专项。
- SPZ 渲染、全部菜单/hover/坐标与复杂性能组合、真实 Key 供应商联调、最终品牌及导出水印验收仍开放。
- 顺序保持：功能与资源闭环 → 全面交互验收 → 产品可见品牌统一 freenow → 发布/导出复验。来源证据、许可证与内部旧数据兼容标识单独处理。

细节见 [预览退出](HTML-PREVIEW-EXIT-AND-DISCUSSION-20261003.md)、[模板编辑](AGENT-TEMPLATE-EDITING-20261003.md)、[人物迁移](ACTOR-PREVIEW-MIGRATION.md)、[最终清单](FREENOW-LOCALIZATION-ACCEPTANCE.md)。
