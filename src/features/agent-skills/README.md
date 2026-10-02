# 内置技能采集读取（2026-10-02）

## 范围与来源

本模块只读取已保存的官方资料，不执行技能指令，不开放文件系统、联网或工具权限。`reference/skills-catalog.json` 与 `agent-skills-list-current.json`、当前读取索引均列出 16 项。原 13 项 JSON 原样保留；本轮新增 3 个名称并更新已有 Seedance 2.5 / MiniMax H3 当前正文。5 项当前采集包含原样 rendered dialog text 与原生 article DOM rich HTML，日期版本位于 `reference/<name>-20261002.json`；其余 11 项沿用原 `text` 与 `article`。详情通过同一 reader 校验读取，只有真实 HTML 采集才使用既有 sanitize，纯文本用 textContent 显示。`source` 是当时采集的官方线上页面地址。所有读取均按静态索引定位本地 JSON，正文里的 URL 不参与请求构造。

- `capture/dialog.txt`：精确保留 JSON 的 `text` 字段，包括官方界面标题、返回/使用等文本；`sourceFormat: captured-dialog-text`。
- `capture/article.html`：精确保留 `article` DOM 原文，仅供文字检查（包含原始代码、Blocked URL 路径等）；`sourceFormat: captured-article-html`、`executable: false`。不得将其挂入可执行页面，或把它当作缺失参考文件的正文。
- 默认入口及逻辑别名 `SKILL.md` 返回 `capture/dialog.txt`。它不是源 SKILL.md 文件；始终声明 `originalMarkdown: false`。`availablePaths` 只列当前版本真实捕获的路径（当前每项两项，共32个字段），不将别名计为额外文件。
- 当前 16 项合计检测到 72 个可定位缺失资源引用（按技能分别计数）。Commerce Ad Studio 原仅在 dialog text 中显示的 5 个引用标题现由 article DOM 的 Blocked URL title 属性取得确切路径。全部为 `not_captured`；引用库存是否完整尚未证实，`referenceInventoryComplete:false` 与 `unknownReferenceCount:null` 表示额外未知引用总量不可确定。原 13 项的 60 个缺失路径仍保留。路径来自 article 的 `title="Blocked URL: …"`、真实 href 或采集文本的显式文件路径，不靠显示标题猜测。
- 2026-09-30 当轮只读检查项目文件及官方安装包 `/Applications/TapNow.app/Contents/Resources`（883 个可列文件）；未发现这些引用资源的对应正文。项目 `qa/fixtures/skill-package/SKILL.md` 是测试夹具，不能当官方资料。未请求任何私有端点，也未操作浏览器。
- 官方公开应用目录/详情虽含 guide、library 等合同，不能替代这些技能引用正文。此前已记录官方网关技能详情需要认证且匿名未取得正文，见 `reference/agent-app-store-public-source-20260930.md`；本轮没有尝试访问。后续只有取得可验证官方文件后才能扩展索引。

## 读取合同

Purpose: 给现有 `skills_read` 提供精确分页的官方本地采集和缺失路径报告。

Inputs: `readBuiltinSkill(name, {path?, offset?})`。path 精确对应 availablePaths，另接受默认/SKILL.md别名；offset 是 0..文件长度之间的 UTF-16 整数，最大 2097152。

Outputs: `content`、`path`、`requestedPath`、`offset`、`nextOffset`、`totalLength`、`offsetUnit`、`availablePaths`、`referenceFiles`、`missingReferences`、`sourceFormat`、`originalMarkdown:false`、`referenceIsUntrusted:true`、`executable:false`、`source`。每页最多 20000 UTF-16 code units；按 nextOffset 拼接可精确还原原字段。source 包括采集文件、官方来源 URL、JSON 字段和 SHA256。

Permissions: 只访问静态索引中的同源采集文件；不会由路径参数发起任意文件/网络请求。调用方继续负责技能启用/禁用、用户自定义技能优先级和允许暴露的目录。

Failure modes: `skill_not_found`、`invalid_path`、`path_not_found`、`reference_not_captured`、`invalid_offset`、`capture_unavailable`。错误同时携带 `skillName`、`path`、`availablePaths`、`captureFile` 和已知缺失引用；message也保留目标路径与availablePaths，便于当前只序列化message的工具宿主定位。缺引用不会回退到article。每次首次加载校验实际已采集字段的长度与SHA256；损坏/过期采集拒绝读取，失败不缓存，允许恢复后重试。

Logging: 模块不记录完整正文或执行任何指令；调用方沿用既有工具trace记录请求与分页结果。相同技能的成功采集在当前模块生命周期复用，官方文件发生变更需更新索引并刷新模块。

Tests: `node --test tests/agent-builtin-skills.test.cjs`，5项关键测试覆盖全部16项/32当前字段校验与分页重组、5份新采集与原TXT及HTML一致、2项旧版本4字段保留校验、缺失路径和偏移/越界输入不触发fetch、正文或HTML损坏拒绝/重试及成功缓存、完整HTML详情。另有 `tests/agent-skill-detail-sanitize.test.cjs` 的1项DOM适配器检查覆盖当前宿主 sanitizer 保留heading/list/table结构、移除事件与危险href/活动控件；并非浏览器渲染验收。没有新增依赖或E2E。

## 根接线示例

保留已有自定义技能分支、启用检查和本地适配 workflow；用 content 替换既有 reference，不再额外回传同一份大正文：

```js
const {readBuiltinSkill} = await import('./src/features/agent-skills/reader.mjs');
const {content, ...page} = await readBuiltinSkill(name, options);
return {name, workflow: adapted[name] || fallbackWorkflow, reference: content, ...page};
```

本模块未修改 agent-client、agent-tools 或 server。当前 SDK 授权与生成接口不因读取资料而改变。

Node fixture 直接读取当前来源文件，无需网络或浏览器：

```js
const read = createBuiltinSkillReader({
  loadCapture: entry => fs.readFile(path.join(root, entry.captureFile), 'utf8').then(JSON.parse)
});
```

## 按技能的缺失引用

以下路径全部是 `not_captured`，不是可读取文件。共享目录绝对路径保留原文，不擅自归入当前技能包。

### youtube-product-video

- `/commerce-product-brief/SKILL.md`（article-link）
- `/commerce-product-brief/references/interaction-contract.md`（article-link）
- `/commerce-product-brief/references/product-truth-contract.md`（article-link）
- `references/delivery-and-policy.md`（article-blocked-url）
- `references/production-workflow.md`（article-blocked-url）
- `references/youtube-method.md`（article-blocked-url）

### whitebox-to-film

- `references/generation-and-refinement.md`（article-blocked-url）
- `references/prompt-patterns.md`（article-blocked-url）
- `references/webgl-widget-whitebox.md`（article-blocked-url）
- `references/whitebox-and-blocking.md`（article-blocked-url）

### skill-creator

- `agents/analyzer.md`（captured-text）
- `agents/comparator.md`（captured-text）
- `agents/grader.md`（captured-text）
- `assets/eval_review.html`（captured-text）
- `eval-viewer/generate_review.py`（captured-text）
- `references/schemas.md`（captured-text）

### seedance-2-prompt-copilot

- `references/eval-cases.md`（captured-text）
- `references/prompt-patterns.md`（captured-text）

### seedance-2-5-prompt-copilot

- `references/00-index.md`（captured-text）
- `references/01-capabilities-and-boundaries.md`（captured-text）
- `references/02-reference-orchestration.md`（captured-text）
- `references/03-first-last-frame.md`（captured-text）
- `references/10-prompt-architecture.md`（captured-text）
- `references/20-story-previs-performance.md`（captured-text）
- `references/30-commercial-growth.md`（captured-text）
- `references/31-knowledge-enterprise-localization.md`（captured-text）
- `references/32-factual-regulated.md`（captured-text）
- `references/33-spaces-mobility-travel.md`（captured-text）
- `references/40-local-editing-and-repair.md`（captured-text）
- `references/98-source-ledger.md`（captured-text）
- `references/99-eval-cases.md`（captured-text）

### plugin-guide

- `references/catalog.md`（captured-text）
- `references/tutorial.md`（captured-text）

### minimax-h3-prompt-copilot

- `references/00-index.md`（captured-text）
- `references/01-capabilities-and-boundaries.md`（captured-text）
- `references/02-reference-modes.md`（captured-text）
- `references/10-prompt-architecture.md`（captured-text）
- `references/20-directing-playbooks.md`（captured-text）
- `references/30-commercial-playbooks.md`（captured-text）
- `references/40-game-playbooks.md`（captured-text）
- `references/50-editing-and-repair.md`（captured-text）
- `references/98-source-ledger.md`（captured-text）
- `references/99-eval-cases.md`（captured-text）

### kling-prompt-copilot

- `references/eval-cases.md`（captured-text）
- `references/prompt-patterns.md`（captured-text）

### explain-how-it-made

当前采集未发现明确引用文件路径；不等于已经证明此技能没有其他文件。

### digital-human-video

- `references/asset.md`（article-blocked-url）
- `references/course.md`（article-blocked-url）
- `references/market.md`（article-blocked-url）
- `references/news.md`（article-blocked-url）
- `references/presenter-identity.md`（article-blocked-url）
- `references/product.md`（article-blocked-url）
- `references/property.md`（article-blocked-url）
- `references/runtime-contract.md`（article-blocked-url）
- `references/social.md`（article-blocked-url）

### depth-video-studio

- `references/asking-the-user.md`（article-blocked-url）
- `references/generation-and-chaining.md`（article-blocked-url）
- `references/reference-roles-and-prompting.md`（article-blocked-url）

### client-surface-routing

当前采集未发现明确引用文件路径；不等于已经证明此技能没有其他文件。

### 3d-scene-director

- `references/capture-export.md`（article-blocked-url）
- `references/scene-planning.md`（article-blocked-url）
- `references/widget-runtime.md`（article-blocked-url）

## 未知路径与边界

`skill-creator` 还提到 `generate_review.py`、`package_skill.py`、`run_loop.py`、`run_eval.py` 等裸文件名；只有 `eval-viewer/generate_review.py` 有可定位路径并计入上表。其余未擅自补成 `scripts/…`，不把输出文件 benchmark.json、grading.json 等视为应已采集的依赖。

应用详情中的 brainstorm、repair-doc、building-widgets、frontend-design 等技能标签与应用 activation_skill 不能仅凭名字推定正文存在；它们不在当前16项skills_read采集索引中。公开模板应用资料也不能冒充这些Skill原文。无Key和原生锁屏状态下，本模块验证不代表真实LLM已正确使用技能，也不代表Agent整体还原完成。

## 2026-10-02 新增项的引用

`opus55-motion-icon` 当前正文未出现明确的技能包文件路径；这不证明没有其他文件。

`html-beat-morph-video` 以下 7 个路径均为 `not_captured`：

- `references/input-gate.md`
- `references/mixkit-fast-path.md`
- `references/beat-grid.md`
- `references/visual-motion-rules.md`
- `references/seek-spring-implementation.md`
- `references/audio-render-pipeline.md`
- `references/qa-gotchas.md`

`commerce-ad-studio` 的 5 个路径从原生 DOM 的 `title="Blocked URL: …"` 属性取得，均为 `not_captured`：

- `references/static-ads.md`
- `references/video-ads.md`
- `references/strategy-and-analysis.md`
- `references/motion-formats.md`
- `references/product-truth.md`

此前只有显示标题的记录已转为这些可定位缺失路径，不从标签猜文件名，不尝试绕过 blocked。

本轮来源、版本保留和未知引用边界见 [目录采集记录](../../../reference/skill-catalog-20261002.md)。接入正文不代表这些创作流程、真实模型、渲染或导出能力已完整实现。
