# 本地恢复与交互补齐 · 2026-10-03

本批完成终态委派恢复、嵌套应用退出、人物灰模纹理兼容和工具栏扫描优化；不代表全部功能或 freenow 品牌替换完成。

## 实现

- Agent 仅在原父调用、轮次、绑定、来源及全部子任务终态匹配时，读取服务端完整委派结果；先持久保存原回执，再显式继续父任务，不重启子任务。未知或部分执行继续阻断。原委派卡按同一会话、提交和 callId 同步真实状态与正文，保留中断历史；失去上下文会在最终请求前停止。
- 双层 iframe 内的真实 Escape 可收起当前放大应用并恢复焦点；尊重内部 preventDefault、IME 和当前 source/nonce/焦点，没有扩大 sandbox 或 CSP。
- 人物情绪 v1 只对已知 SHA 的派生 HTML 切换到官方已有 TextureLoader。原 ImageBitmapLoader 的 fetch(blob) 被离线 connect-src 拦截；现改为允许的 img blob 路径。捕获 HTML、内嵌 GLB/JPEG、材质与 UI 原字节保留。仅该公共适配模块新增精确静态 CORS 路径，API 权限不变。
- 纯视口刷新复用当前选中节点列表，内容及选择变化仍重建。4000 节点、90 帧定向探针的选中成员检查从 360000 次降至 0；不是浏览器帧率结论。

## 验证

只执行相关检查，没有重跑全套。

| 范围 | 证据 |
|---|---|
| 终态恢复 | 作者实际 AgentRuntime/持久合同 3 项、生产生命周期 7 项及隔离 fixture 1 项通过；独立审阅身份、来源、持久化和重复执行边界 |
| 浏览器恢复 | 真实输入发送，中断后刷新重开并核对、继续；turn=1 / delegated-start=1 / delegated-result=1 / continue=1 / state=2。旧委派卡从取消更新为两项 completed 与完整正文，再刷新保持；0 新节点。固定 QA 回复明确标注非真实模型 |
| Escape | 29 项相关检查通过；原生键盘从内层提示按钮 Escape 只收起当前应用，焦点回到放大按钮，另一张卡和队列保留 |
| 灰模纹理 | 4 项字节/版本/路径检查通过；新页面无纹理 error/warn。真实选择喜悦、确认，参考图 2→3、队列 2→3。刷新后三图均解码 512×512，新 SHA 为 5c76d227075d9c87cf201b4fb5a87624384ab94710c8cea031774329d595e57e |
| 工具栏 | 8 项相关检查通过；隔离完整画布实际单选、多选、滚动平移、23%→25% 缩放，工具栏、选框、连线随视口更新 |
| 互动学习 | 真实完成逆光选择与逆光/低角度填词，q5 输入并交接生成需求；刷新保持 3/5、q4/q5 草稿及队列 2。只交接需求，没有伪造生成产物 |

开发机截图：`/tmp/freenow-terminal-recovery-20261003.png`、`/tmp/freenow-app-escape-focus-20261003.png`、`/tmp/freenow-actor-local-texture-20261003.png`、`/tmp/freenow-canvas-toolbar-viewport-20261003.png`、`/tmp/freenow-learning-state-20261003.png`。截图与开发机完整画布 QA 页面不作为公开仓库数据；测试代码和 fixture 保留。服务已重启加载本批后端改动，未配置模型 Key。

## 仍开放

SPZ 渲染和待授权依赖、Creative 精确模板正文、全部页面/菜单/状态组合验收、最大媒体性能、真实供应商联调、最终 freenow 品牌。Widget HTML preview 的嵌套 Escape 不在本批范围。详细关闭条件见 [本地化与品牌验收](FREENOW-LOCALIZATION-ACCEPTANCE.md)。
