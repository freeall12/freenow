# freenow 运行界面品牌名称 · 2026-10-05

用户已授权本批品牌替换。本记录仅覆盖业务模块中产品可见名称、动态标题和应用品牌标志；不把改名当作全站功能、离线资源或供应商最终验收完成。首页静态标题/favicon/logo及公共品牌样式由主线程完成；package.json项目名称也改为freenow，依赖版本及存储namespace不变。

## 本批修改

| 文件 | 用户可见变化 | 保留边界 |
| --- | --- | --- |
| `studio.mjs` | 旧片场品牌文字、标志及alt改为freenow | Three.js场景、保存、拍摄、用户对象名不改 |
| `studio-panorama.mjs` | 全景片场品牌文字、标志及alt改为freenow | 原全景与用户媒体不改图、不去标 |
| `agent-artifacts/html-preview.mjs` | HTML预览宿主品牌、alt及“观点不代表”提示改为freenow | iframe用户正文、原作品title、派生导出正文保持 |
| `agent-composer/model-catalog.mjs` | 16处固定模型label的TapNow前缀改为freenow | 全部id、路由alias、描述、能力、分组、图标与锁定会话兼容保持 |
| `node-editor.js` | 固定视频模型菜单alias在显示时呈现freenow前缀 | 原选项value、已存config.model、原模型解析与请求保持；未知自定义model文案不替换 |
| `agent-welcome/suggestions.mjs` | 一条系统默认“创建适合我的Agent Skill”建议prompt使用freenow | 用户历史消息、现有技能原文和自定义Skill保持 |
| `canvas-projects/core.js` | 动态页签从“用户项目名 · 画布复刻”改为“用户项目名 · freenow” | 项目title字段、页面项目按钮、存储与用户含TapNow的名称保持原文 |

业务标志统一引用主线程提供的 `assets/branding/freenow-mark.svg`，设置 `freenow-brand-mark` class，由公共样式在深色界面反色。资源为现有Tabler MIT filled/hexagon-letter-f原SVG，非新手绘图标。旧logo资源保留供来源与历史fixture使用。

## 盘点保留项

- `agent-manager/catalog.mjs` 原author/category与`agent-manager/manager.mjs` 原内置技能来源标注，`agent-skills/index.mjs` 原描述/sourceUrl属于来源资料或技能原文，不把原作者改成freenow。该类TapNow仍可能作为来源信息显示。
- `generation-results/media-ref.mjs` “此旧媒体来自TapNow，需迁移”是旧资源来源与修复提示，保持；原站域名、出站拒绝和迁移索引也保持。
- `ui://tapnow/*`、`window.tapnow`、SDK协议、localStorage/IndexedDB/WebLock/剪贴板/事件标识和GLB兼容字段不属于产品名称，不修改。
- `agent-apps/resources` 中的原SDK、构建备注与许可、捕获reference/manifest、历史文档和component-library来源说明保持真实来源。
- 模块QA里的旧首页拷贝未作巨大批量替换，QAfixture不作为生产页面品牌完成证据。
- 用户上传媒体、用户作品正文、标题与文件名可包含任何既有品牌，不作字符串替换或静默去水印。

## 导出盘点

检查运行模块中 `download`、`filename`、`fileName`、`generator` 入口，未发现应用自己使用TapNow作为当前导出默认文件名。现有名称来自用户节点/资源/作品名，或“片场全景图.png”“堆叠.zip”“Scene.glb”“Image Editor.*”等中性兜底；按本批范围保持。Three.js生成器元数据属于第三方来源，不改成freenow。

HTML品牌修改位于宿主预览侧栏，不修改用户HTML或离线wrapper的作品title；片场品牌DOM不静默覆盖用户像素。实际PNG/视频/GLB/HTML导出、像素及元数据回读仍由主线程最终验收，不能以源码盘点代替真实产物检查。

## 最小验证

- 7个变更运行源码 `node --check` 通过；`git diff --check` 通过。
- 实际导入当前与HEAD模型目录，比较除label外全部字段逐项一致；label只做固定TapNow前缀到freenow变换。
- 隔离执行真实`canvas-projects/core.js`，hydrate名称“TapNow 用户自定义画布”：metadata.title与项目按钮原文保留、document.title变为“TapNow 用户自定义画布 · freenow”；项目存储key保持原兼容值。
- 原视频alias数组与HEAD逐字一致；执行新展示函数验证已知“TapNow Omni Flash”显示“freenow Omni Flash”，未知“TapNow custom model”原文保留。
- 新品牌SVG文件存在，引用路径已核对；未以文件存在声称浏览器像素验收。
- `node --test tests/canvas-projects.test.cjs`：32项通过，覆盖旧项目/存储身份、保存/切换、标题、失败保护与CAS关系。本批未新增为简单文案复述实现的测试。

本子任务未操作浏览器、未提交或推送，未修改根index/generation-ui/config/styles、依赖、密钥或存储schema。实际可见状态由主线程统一Computer Use复验；来源归属仍准确保留。
