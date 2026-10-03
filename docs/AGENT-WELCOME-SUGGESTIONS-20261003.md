# Agent 欢迎建议：本地静态来源（2026-10-03）

`src/features/agent-welcome/suggestions.mjs` 保留已抓取官方 bundle 中 `const Oz=` 的 **30 个 `home-fallback-zh-*` 对象**，原 `id/title/prompt/icon_category` 逐字段一致。模块不联网，也不执行原 bundle；不代表动态个性化建议已经取得。静态对象没有 description，UI 可以显示完整 prompt 作为说明并通过 CSS 截断，不能将另写的描述标成官方 description。

本地画布欢迎页按用户排除营销的要求，只展示原第 **13–30 条，共 18 条** Brainstorm、创作记忆、Skill 和创作脉络建议。原第 1–12 条供应商/型号推广文案不展示，但全部原数据仍保留；这项显示过滤不修改或移除现有模型选择能力。`getCanvasWelcomeSuggestionPage()` 是此本地展示范围；原 `getWelcomeSuggestionPage()` 继续支持全部 30 条，不能把过滤后的 18 条称为官方完整目录。

来源 `reference/index-D02YDfUC.js`：1,971,067 bytes，SHA256 `27dccf2a786dadbf30a925930b8b0e9f01cae7803ae4dfb57539a49a9ac627b1`。抽取只定位 `const Oz=[` 到 `],Uz=`，把四个已知对象 key 改成 JSON key 后 JSON.parse；没有 eval/import 下载的 JS。30 对象按原键序 JSON.stringify 的 SHA256 为 `28dd87b1b798811961980bb8d878aaf78681c3c57c3bdd6e39419fb15210f994`。

## 点击和轮换事实

- 首页 `fs()` 从原数组取 `id/title/prompt`，不使用 icon_category。`tm()` 展示标题，点击建议的 `K()` 将 `fo(C.prompt)` **填入输入框**，不会自动发送；发送 `H()` 优先使用用户输入，空输入才使用当前建议完整 prompt。
- 原 `fo()` 匹配 `/\{\{[a-zA-Z0-9_-]+:[^}]+\}\}/g`，把所有匹配 marker 收集并移到开头，以空格连接；剩余正文只去掉开头 space/tab。13–18 的 `{{brainstorm:brainstorm}}` 本来就在开头，因此这六条 `fo()` 结果与原 prompt 完全相同。
- 同版本 `reference/vendor-pkg-canvas-CwfaULgq.js` 的 `Qit()` 中，点击将完整 `R.query` 交给 `setInputValue()`，识别 Brainstorm 后 `setActivePlugin('brainstorm')`，保存 `suggestionContext`。新会话卡片显示 2 条，既有会话常量为 3 条；刷新偏移 `(offset+size)%count`，在末尾环回。动态建议来源 API 存在于原代码，但本地模块不调用它，也不构造远程回执。
- 「搭建可视化创作工作台」未出现在这个已抓首页 bundle 的 30 条中文 fallback 中。它可能来自另一版本或动态来源；本轮没有取得此标题的精确官方 prompt，不添加伪造记录。

## 图标映射

同版本 canvas 中 `Jre={inspiration:fP,character:Tot,reference:mde,analyze:pde,next_step:ude,organize:g7}`。沿该文件对 `vendor-libs-DqoAc28N.js` 的 import/export alias 确认下面的原图标。canvas 文件 SHA256 为 `cf4df1be70ee5b4379f539d93fc3b1b9b566bf307817aa215b1272cb37725946`，libs 为 `2d4895c31bc64e8dcee4560dd8f865c48e6f6a4757e46abab2932dc16414a7ff`。

| icon_category | 原组件 | 本地已安装 Tabler SVG |
| --- | --- | --- |
| inspiration | Lucide Sparkles | sparkles |
| character | Tabler MasksTheater | masks-theater |
| reference | Lucide Palette | palette |
| analyze | Lucide ScanSearch | zoom-scan |
| next_step | Lucide Lightbulb | bulb |
| organize | Lucide LayoutGrid | layout-grid |

本地六份 `assets/agent-welcome-icon-*.svg` 是从既有 `@tabler/icons@3.47.0/icons/outline` **直接逐字节复制**，没有新依赖或自绘。Lucide 与对应 Tabler 图标形状存在差异，不能声称像素一致。模块 `welcomeSuggestionIcons` 同时记录 originalName/originalLibrary 和 localName/localLibrary/path。category 不会产生虚构 description，也不修改标题或 prompt。

## 接线 API

```js
import {
  getCanvasWelcomeSuggestionPage,
  getWelcomeSuggestionPage,
  getWelcomeSuggestionCard,
  getWelcomeSuggestionPrompt,
  getWelcomeSuggestionInput,
} from './src/features/agent-welcome/suggestions.mjs';

const page = getCanvasWelcomeSuggestionPage({ offset: 0, size: 2 });
// page: {items:[原第13、14条], offset:0, nextOffset:2, size:2, total:18}
// getWelcomeSuggestionPage() 仍保留原全部30条的分页API。
const card = getWelcomeSuggestionCard(page.items[0].id);
// card 保留四原字段，增加 description:null、icon 本地路径。
const prompt = getWelcomeSuggestionPrompt(card.id); // 完整原 prompt string；未知 ID 返回 null。
const input = getWelcomeSuggestionInput(card.id);
// input: {prompt:完整原文, text:去掉开头 Brainstorm marker 的正文, references:[...]}。
// 非 Brainstorm references=[]；Brainstorm 为 [{kind:'app',id:'brainstorm',label:'头脑风暴'}]。
```

卡片可显示 `item.title`，说明用 `getWelcomeSuggestionInput(id).text`，图标用 `card.icon`。本地画布换一组采用 `getCanvasWelcomeSuggestionPage({offset:page.nextOffset,size:2})`，9 次翻页完整轮转 18 条。

点击应填入编辑器并 focus，用户仍可修改再发送。Brainstorm 的语义激活在现有编辑器是 **app referenceMention**，不能用纯字符串或 `insertSkill('brainstorm')` 代替：先 `editor.setText('')`，再 `editor.insertReference(input.references[0],input.text)`；无 reference 时 `editor.setText(input.text)`。接线者还需遵守现有 busy/readOnly/session guards 并保存实际草稿。此模块没有写主客户端，未声称已完成主界面浏览器验收。

## 验证

```bash
node --test tests/agent-welcome-suggestions.test.cjs
```

测试核对完整数据指纹、当前抓取 literal 的逐字段一致（缺失 ignored 抓取时仅跳过该项）、30 条原分页与 18 条本地创作建议轮换/末尾环回、完整 prompt 和 Brainstorm referenceDocument 语义、所有 SVG 与现有依赖逐字节一致。静态资产及纯数据模块不依赖原网站。

## 主客户端接线与实机

`agent-client.js` 已采用 getCanvasWelcomeSuggestionPage，点击一次以单个 composer snapshot 写入完整正文和 Brainstorm referenceMention。只保存草稿，不发送；轮换重建后恢复刷新按钮焦点。实机已验证 Brainstorm 正文/标签刷新保留、三组轮换到记忆建议及普通正文无残留应用引用，见 [本批验收](LOCAL-WORLD-AND-SCENE-20261003.md)。
