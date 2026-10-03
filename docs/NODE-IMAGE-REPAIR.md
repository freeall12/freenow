# 未知旧节点图片：人工本地修复

正式画布的待修复图片节点有「导入本地图片」按钮。用户选 PNG/JPEG/WebP 后，修复服务先校验文件、真实解码，再存入 LocalAssets 并回读实际 Blob，核对 MIME、字节长度和 SHA-256；最后检查目标仍属于当前画布、仍是同一对象且内容未变化，调用现有 `updateNode` 一次替换。`pendingOperation` 和 queued/running/applying 生成目标会阻止替换。允许目标在等待期间移动，位置及画布尺寸保持当前值。

只修改所选图片节点的旧原站 `image/fullImage` 字段，不改其他节点、历史任务、source journal、索引或参数。有效本地 alias 保留。当主图片被替换时，像素尺寸与 `provenance:{kind:'imported',mediaSource:ref,model:null}` 绑定新素材；不把用户文件声称为原件或旧模型生成结果。单边最多 8192、总像素最多 16777216、文件最多 20 MiB；SVG 不接受。全程不读取旧原站 URL。

## 编辑与保存合同

使用既有画布编辑/撤销合同：最后 guard 后同步 `updateNode`，再 await `saveProject`，只有 durable flush 成功且当前项目、目标对象和媒体字段仍一致才报告成功。默认 `readProject` 是 `app.projectSnapshot()`，用于当前字段一致性核对，**不是持久化回读证明**。实际数据库持久化由已有 `saveProject`/`CanvasStore.flush` 保证；刷新验收单独执行。

保存失败时，本地图片已经应用，页面明确显示「尚未确认画布保存」及错误，并提供仅保存重试；不重新导入、再加 undo 或虚构回滚。保存等待期间撤销、替换节点或切换画布，也返回 applied=true、persisted=false，不篡改新的编辑。已确认成功的重试幂等返回。校验或最后 guard 失败不发布节点补丁；guard 在素材落盘后失败可留一个未被引用的本地 Blob，不删除用户数据。

## 接口

```js
import {openNodeImageRepair} from '../src/features/local-resource-migration/node-image-repair-ui.mjs';
openNodeImageRepair({app:window.CanvasApp,nodeId,isCurrent});
```

service `createNodeImageRepair` 可注入 `getNode/getProjectId/isCurrent/getJobs/assets/updateNode/saveProject/readProject/decodeImage/hashBytes/readAsset`。UI 默认使用 LocalAssets 与 GenerationAPI。`repair(file)` 和 `retrySave()` 返回 applied/persisted/ref/bytes/sha256/dimensions；未应用错误抛出，已应用保存错误返回 `saveError`。

## 验证

新增 `tests/node-image-repair.test.cjs` 初始 6 项通过，覆盖真实字节、仅所选 aliases、源 journal/其他节点/单次 undo、MIME/预算/decode/维度/回读失败、迟到编辑/对象/项目保护、生成目标、保存失败与幂等重试。独立审阅指出保存 await 后仍需检查上下文及成功后重试状态一致性，修复后仅运行新增 `confirmation checks` 一项，1/1 通过。

浏览器入口：<http://127.0.0.1:4173/src/features/local-resource-migration/qa/node-image-repair.html>。独立数据库 `canvas-qa-node-image-repair-v1` 与 `assets-qa-node-image-repair-v1`；不会改个人画布。

1. 初始化独立画布，两个未知旧节点仍待导入。
2. 点击「打开并填入本机 QA 图片」，再点击生产对话框「导入并替换」。第一个节点真实解码本机 PNG，第二个不变；关闭回到有效原焦点或节点。
3. 回读保存画布并刷新，确认真实图片仍显示、另一个节点待导入。
4. 撤销测试替换恢复旧节点；勾选「下一次画布保存失败」后再次替换，确认 applied-unsaved 提示、重试保存不再导入或增加 undo。
5. 生产页使用真实文件选择器；QA 样本按钮只为浏览器验收预选本机 fixture，文件校验、素材落盘及替换都调用生产模块。

Node 回归与语法检查用于服务合同；正式主壳的浏览器显示及持久化证据见下。

## 正式主壳 QA

运行 `node scripts/create-node-image-repair-main-qa.cjs` 从当前 `index.html` 生成主壳，保留正式脚本及入口，只追加独立 fixture 与诊断控件：

<http://127.0.0.1:4173/src/features/local-resource-migration/qa/node-image-repair-main.html?session=main-review>

fixture 在正式脚本前设两个人工合成旧图片、以 `session` 隔离的 Canvas/Assets IndexedDB 和 Map 内存偏好。不写或清理真实 localStorage。网络仅允许本机静态/Blob 读取，配置 API 返回未配置，不请求原站或模型。正式 `app.js` 的节点按钮、原生文件 input、`LocalAssets`、`CanvasStore`、撤销与 asset 图片解析都保持生产实现；没有自建 CanvasApp 或 DataTransfer 预选。

验收直接点击左节点「导入本地图片」，使用原生 filechooser 选择 `/Users/laplace/Documents/Codex/2026-09-22/new-chat/outputs/canvas-replica/assets/agent-casting.png`，然后导入并关闭。控件「只回读持久记录」读取实际 CanvasStore；「刷新复验」重载相同 session；「撤销一次并保存」「重做一次并保存」调用真实 app.undo 和 saveProject。另一个节点的旧媒体/source journal 应保持，真实解码宽高与历史计数在诊断中显示。

### 2026-10-03 正式主壳 CUA 证据

root 在 <http://localhost:4173/src/features/local-resource-migration/qa/node-image-repair-main.html?session=main-live-1003> 完成实际浏览器验收：

- 点击正式节点「导入本地图片」按钮，通过真实 filechooser 的 `setFiles` 选择本机 `assets/agent-casting.png`，再点击「导入并替换」。真实图片解码为 200 × 200，15288 字节。
- 实际 `CanvasStore` 回读显示选中节点 `image/fullImage` 为同一个持久 `asset:` ID，provenance 为 imported、model 为 null。另一个节点旧媒体字段与 source journal 不变；一次替换增加一个 undo。
- 刷新相同 session 后，实际 `<img>` 自然尺寸仍为 200 × 200，使用重新建立的本地 Blob 地址，证明 asset 引用和图片字节经过持久化恢复。
- 调用真实撤销恢复旧节点、待导入占位和修复按钮；真实重做恢复实际 200 × 200 图片。
- `externalAttempts: []` 仅表示 fixture 包装的 fetch 没有外部尝试，不作为整个浏览器网络栈的完整请求证明。

截图：`/tmp/freenow-node-image-repair-main-20261003.png`。本次只补充 root 已取得的证据，没有重复测试或修改生产代码。
