# 功能截图与复现

2026-10-03，通过 Computer Use 在本机 4173 服务中操作正式界面并截图。图片不来自官方网站，也没有生成式修图；这些截图只展示本地实现。发布版本使用后台浏览器默认的 1280×720 视口，不代表全部响应式布局验收。

| 文件 | 实际内容 | 数据来源 |
| --- | --- | --- |
| [canvas.jpg](canvas.jpg) | 文本、图片参考、连线、编辑器和片场节点 | 公开示例简报、两个几何图层与仓库内模型缩略图 |
| [image-editor.jpg](image-editor.jpg) | 正式 Fabric 编辑器，选中前景图层后的操作栏 | 示例矩形和圆形；非生成图片 |
| [studio.jpg](studio.jpg) | 正式 Three.js 片场，GLB 导入、保存、聚焦和场景树 | `assets/studio/library/chair-office.glb`，实际 WebGL 渲染 |
| [agent.jpg](agent.jpg) | 正式 Agent 欢迎建议、输入、附件、确认及模型控件 | 空白示例会话；没有真实模型响应 |
| [video-trim.jpg](video-trim.jpg) | 正式智能剪辑输出三段视频、时长和来源连线 | 仓库内红绿蓝测试片，本机 FFmpeg 实际输出 |

不包含私人画布、账号抓包、API Key、聊天内容或供应商生成质量宣称。旧参考标识仍按 README 的最终品牌阶段处理；模型来源与第三方许可按原资产记录保留。

## 重现

启动正式服务后，生成与当前 `index.html` 同步的演示入口：

```sh
node scripts/prepare-screenshot-demo.cjs
```

打开 http://localhost:4173/docs/screenshots/demo.html?session=manual 。更换 `session` 得到独立示例数据库；不要附加 `project` 参数。演示使用独立 IndexedDB 和内存偏好，不读取日常画布、素材或会话。API 派发在该演示页禁用，不用于验证真实供应商或剪辑服务。

1. 点“重置”适应当前窗口，截取画布。
2. 点“AI 助手”，待展开动效结束后截取欢迎页，再收起。
3. 点“打开编辑器”，选择“前景形状”图层后截取；关闭编辑器。
4. 点“进入片场”→“导入模型”→“上传模型”，选择仓库中的 `chair-office.glb`，点“添加到场景”。等“模型已添加并保存”后聚焦，取消选择，收起镜头预览，切换“场景”页后截图。

`demo.html` 由生产入口派生，不另写一套产品 UI。修改入口加载顺序后重新执行脚本；修改示例只编辑 `demo-fixture.js`。截图属于文档资源，不进入正式项目初始化数据。

视频截图使用另一个[剪辑隔离 QA](../../src/features/video-trim/qa/main.html)：打开选区后收起验收面板，从正式视频工具栏重新进入剪辑，点“智能剪辑”。实际输出为 2.2、1.8、4 秒三段；读取后收起验收面板，点“重置”适应内容。该页允许本机 FFmpeg 接口，不调用生成模型。具体保护与验证见[剪辑结果恢复](../VIDEO-TRIM-RESULT-RECOVERY-20261003.md)。
