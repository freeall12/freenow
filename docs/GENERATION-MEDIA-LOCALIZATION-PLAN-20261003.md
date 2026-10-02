# 生成结果媒体本地化：只读核查与最小完整实施方案

日期：2026-10-03。核查对象为本目录 `main`，初读 `git status --short` 为空。本次只读生产代码，新增此设计文档；没有提交生成、调用供应商、广泛测试或修改生产实现。以下结论为源码证据，不是实供应商或浏览器验收。

## 结论与完成边界

现有结果归档不能作为主画布完全资源隔离的基础：它在浏览器中下载且与结果入图并行。必须先把供应商所有可读取结果媒体存为本机持久文件，再对浏览器公开可应用结果。用户显式配置的合法供应商继续由本机服务调用；TapNow 服务、文件域及跳转不作为运行依赖。全局 CSP 要在真实生成、恢复、旧媒体迁移及全部页面资源验收之后启用。

不应通过封锁合法供应商结果、把远程 URL 改成文件后缀、仅保存任务 JSON 或仅确认文件存在来宣布本地化完成。

## 当前实际链路与根因

| 边界 | 当前代码与实际行为 | 缺口 |
| --- | --- | --- |
| 原生/网关返回 | `server/generation-ark.cjs`、`generation-minimax.cjs` 返回视频 HTTP URL；`generation-fal.cjs` 返回图片 URL；`generation-tripo.cjs` 返回模型和 poster URL；`generation-marble.cjs` 返回嵌套 SPZ/mesh/pano/poster URL；OpenAI 图片接受 URL 或内联字节 | 适配器未统一下载实际输出 |
| 持久任务接受 | `server/generation-durable.cjs: applyRemote` 在 `checkedOutputs` 后直接写 `status:succeeded, outputs`；输出可为 HTTP/data/blob | 成功只证明供应商响应，不证明本地媒体已存在；blob URL 无法跨进程恢复 |
| 公开响应 | `server/generation.cjs: publicJob` 原样公开 `job.outputs` | signed URL 仍到浏览器，任意结果字段可能继续触发远程读取 |
| 浏览器直接配置 | `generation-ui.js: configure` 的“保存配置”创建 `GenerationCore.httpProvider({baseUrl,apiKey})` | API 调用也可浏览器直连，不能仅改服务端结果链 |
| 验证与应用 | `generation-ui.js: validateOutputMedia` 经 `LocalAssets.url` 设置媒体 src；`workflow.mjs: apply`、`recovery.mjs: importRecoveredOutputs` 直接写 image/video/fullImage/poster | `LocalAssets.url` 对非 asset 原样返回；媒体可解码不等于已本地化 |
| 音频 | `audio-ui.js: localize` 浏览器 fetch、完整 response.blob 后检查 50MiB、decode、LocalAssets.put | CORS/私有 headers/签名过期问题仍在，体积限制在完整读取后才生效 |
| 3D | `world-node/resource.mjs: materialize` 浏览器 fetch，复用 `readModelBlob` 有界读取；GLB 经 Three.js 实际解码、封面生成、LocalAssets.put | 12MiB GLB 限额；SPZ明确拒绝渲染，不能宣称已有 Marble 可用闭环 |
| 历史归档 | `generation-history/entry.mjs` 订阅任务；`core.mjs: observeNow` 先保存输出快照，再异步 archive；`archive.mjs` 浏览器 fetch 后写 asset | 与画布应用分别运行。图片/视频 100MiB 限制在 blob 读取后；归档失败不会阻止远程结果入图 |
| 重启历史 | `generation-history/model.mjs: safeSource` 去除部分敏感 query；worldSnapshot 特例保留 signed query；原任务查询可取回旧结果 | 部分 signed URL 没有持久 source，只在 transient 内存中；剩余 URL 可能过期。嵌套世界数据仍可携带私有 signed URL |

## 哪些现成实现可复用

没有发现服务端通用“下载供应商结果并持久化”的模块或文件读取 API。

- `generation-store.cjs` 已有进程独占租约、0600 文件、0700目录、临时写入、fsync、rename 和目录 fsync；复用这些一致性方式及任务幂等键。
- `generation-durable.cjs` 已有 mutations 串行化、active 去重、controllers 取消、POST 前持久意图、providerTaskId、供应商配置指纹、重启不重发 POST。保留这些边界，扩展为结果落盘的持久状态。
- `video-segmentation.cjs` 已实现 `redirect:error`、Content-Length 提前检查、流式计数、取消与固定来源 RLE 取回。可抽取小型有界读取组件，但它下载的是 JSON 蒙层，不能当成现成媒体仓库。
- `generation-openai-speech.cjs: submitSpeech` 已有有界二进制读取及 WAV/MP3检查；当前仍把字节转为 data URL，下一步接入本机文件存储。
- `video-scene-media.cjs` 的本机 ffprobe/FFmpeg、取消、解码及40MiB结果预算可用于视频内容验证；命令协议限制 `file,pipe` 必须保留。
- `world-node/materialization.mjs` 的有界读取、source guard、取消与晚到 decoder 清理是前端验收模式；它依赖浏览器 API，不能原封不动 require 到服务端。
- `generation-history/archive.mjs` 的格式检查、缩略图、真实导入和历史幂等 `taskId:outputIndex` 继续使用，但只能读取本机端点/asset/data，不能再下载供应商 URL。

## 最小完整设计

### 1. 服务端只接受内部结果描述并落盘

新增 `server/generation-media-store.cjs` 和小型 `server/generation-media-download.cjs`，使用 Node 内建 fs/http/crypto/stream，不加依赖、不另开工程。

私有目录 `server/.generation-media/` 不在静态公开范围、不提交 Git。按随机不可猜资源 ID 保存 immutable 字节文件和 manifest；目录0700、文件0600。文件名由服务端生成，不使用供应商文件名或 URL pathname。manifest 含 `resourceId, taskId, outputIndex, role, mime, format, bytes, sha256, createdAt`；显示名称只作经过校验的 metadata。

下载写入 `.part`，同时计算哈希和实际字节量；完整下载及格式验证后 fsync 文件、原子 rename、fsync 目录，再提交资源 manifest 和任务结果。任何一步失败都不能发布成功输出。清理仅处理确认未被 manifest 引用的临时文件；不自动删除用户资产或历史结果。

结果下载只接收服务端已经接受的 `taskId + outputIndex + role`，不得增加 `GET /download?url=...` 任意 URL 代理。统一落盘范围：主 url/type alias、fullImage、poster，以及世界数据中可消费的所有 SPZ/mesh/pano URL；相同 URL+授权上下文在本任务内复用同一个下载。主图、原图和封面不同就保留不同文件，不能降级替换。

`text` 无需媒体落盘。HTTP/HTTPS结果和规范 base64 data URL分别有明确处理器；blob URL从服务端供应商合同中拒绝，因为它不是可跨进程取回的结果。现有内联 speech/分镜结果也落盘，避免大 JSON 在浏览器任务、历史和画布反复复制。

### 2. 私有源与公开结果分离

任务新增内部 `providerResult` 与 `localization`：保存原始响应身份和原任务输出 descriptor；公开 `outputs` 只在所有必需资源就绪后生成。`publicJob` 显式白名单输出本机媒体地址与普通元数据，禁止透传原始 URL/query/headers，sourceUrl 也必须审计处理。

内部 descriptor 可含短期 signed URL、expiresAt、固定供应商配置 ID和非秘密 header profile ID。Key从服务端供应商配置解析，不写进任务/manifest，不进入前端/history/log。signed URL本身按私有能力凭据处理，只在0600私有任务记录保留取回所需原文；公开来源用 provider ID、providerTaskId、sourceFileId 和 URL摘要，不输出 query。现有 `rejectCredentials` 不可为了支持 headers 全局放宽。

适配器增加内部 `resolveResultResource`/`refreshResultResource` 能力，通过原任务 ID查询或官方 file接口取新下载 descriptor。路由用已接受任务的 envelope/provider fingerprint定位原供应商，不按当前模型路由重选。原配置改变或缺失则提示重新配置原供应商，不能改用另一供应商再次生成。

私有 headers只用于适配器声明的精确下载 origin/path范围；不把 API Authorization 默认附给第三方 CDN。默认拒绝跳转；需要跳转的真实供应商必须显式配置允许目标并逐跳验证，跨 origin时剥离凭据。取回任务和刷新 URL是只读 GET，禁止借本地重试触发新的生成 POST。

### 3. 原任务成功与本地就绪分别持久化

尽量保留现有前端 `queued/running/succeeded/...` 合同：新增独立 `providerStatus` 和 `localization:{state,revision,resources,errorCode,retryable}`。供应商成功后先持久 `providerStatus:succeeded` 和完整 descriptor，再 `localization:pending/downloading`；对外任务继续 running，只有资源集合原子提交后才公开 `status:succeeded, outputs`。

下载确定失败时对外 unknown，使用 `recovery.reason:media_localization_failed`，保留 `providerStatus:succeeded`；UI 显示“生成已完成，素材保存失败”，重试按钮明确“重新取回素材”。不能使用普通 `retry` 创建新请求。取消落盘时 providerStatus仍保留成功，public status cancelled，明确只是停止本地保存/应用，不能报告供应商计算已撤销。

以 `taskId + outputIndex + role + descriptorRevision` 做幂等资源提交；并发 lookup/get/retry合并一次落盘。资源齐全时重复请求直接复用原 manifest，不重复下载，不重复创建画布节点。哈希用于完整性，不把所有用户任务跨项目合并为共享访问权限。

重启读取：已有 localization ready检查文件和 manifest是否一致，缺失时转“本地素材缺失”并从原任务取回；pending/downloading不当成未完成生成，不重发 POST。重新开始GET下载，丢弃确认无引用的part；本阶段不做Range续传，避免signed URL变化和混拼。同步供应商无providerTaskId时只可重试已持久descriptor；URL过期且无只读刷新能力时明确“无法从原任务取回”，仍不自动重新生成。

取消必须先持久本地cancel receipt，再abort下载；每次资源发布与整组输出提交前重查cancel状态及revision。即使fetch/decoder晚到，也只能回收临时资源，不能发布结果。服务关闭时停止新发布，已保存providerResult保证下一进程只恢复下载。

### 4. 本机媒体接口兼容现有图像/视频使用方式

新增 `GET/HEAD /api/generation/media/:resourceId`，只接受资源ID并从manifest找文件。沿用精确localhost Host/Origin边界，无CORS放宽，无网络回退；支持单段Range、206/416、正确MIME、Content-Length、ETag、nosniff、禁止执行/下载文件名注入。传输流式读取本机文件。

持久内部输出以稳定本机resource ref保存；公开URL在当前请求host/port下构造。不要把开发端口写入永久manifest，也不能接受任意localhost URL为可信结果。公开输出可用精确 `/api/generation/media/<id>` 路径；更新 `generation-api.validateResult`、`generation-durable`元数据校验、history.safeSource、世界snapshot等，仅增加该精确路径与资源ID格式。读取时核验资源归属同一已接受任务，不放宽为任意relative/file/local URL。

这样当前 `img.src`、video、编辑器和Three loader可直接读本机地址，不必一次改造所有旧renderer为 `asset:`。`LocalAssets.url`仍支持用户本地 IndexedDB；历史archive只读本机输出再写asset，避免双份供应商下载。公开本机outputs中嵌套world.assets一并本地映射，并同步调整其校验；原始世界signed元数据留私有providerResult，保留worldId、坐标系、尺度和resolution，不把SPZ改成GLB。

SPZ字节本地化与SPZ渲染是两项验收。现 `resource.materialize` 不支持SPZ，此方案不会自动使Marble预览可用。

### 5. 浏览器供应商配置统一经本机中转

`generation-ui.configure` 保留用户填供应商baseUrl/Key的使用体验，但不能再创建远程httpProvider。新增本机供应商配置/session接口，任务仅携带opaque配置引用，始终由localProvider提交。可先使用进程内临时配置；退出后该供应商需重新配置，任务记录保留非秘密指纹并继续可检查。

需要跨重启保存Key时沿用明确的本机配置机制，并单独确定私有保存授权和方式；不能顺手把Key写浏览器localStorage/任务JSON。已配置.env或路由保持可用。配置合法供应商不意味着允许TapNow服务；服务端统一拒绝已确认TapNow/tamaredge运行域及重定向目标。不要把开发文档中的来源URL当作网络请求。

### 6. 预算、安全与验证

先统一现有预算：图片/视频每资源100MiB、音频50MiB（原生Speech仍32MiB）、GLB12MiB；新增SPZ暂定256MiB，必须在实施时核验实际渲染器预算与供应商合同，不能暗中放大GLB限额。每任务暂定最多50输出、128资源、512MiB总媒体，最多2并发下载，有限等待/整任务超时；作为显式本地限制展示，不能静默截断输出或只应用部分资源。

Content-Length只是提前拒绝依据，实际stream计数才是硬限制；同时限制响应metadata/URL长度、data URL编码长度、解码后字节、图片尺寸/像素量、视频时长/尺寸。数值元数据不能替代实际解码。下载落盘可先通过魔数/容器结构检查；前端应用前仍实际decode图片/音频/视频，Three真实parse GLB。坏内容保留原任务成功回执，但不进入主画布。

SSRF：结果URL来自外部响应也需校验；拒绝userinfo、非HTTP(S)、私网/loopback/link-local/metadata地址及全部IPv4/IPv6变体；解析DNS全部地址并让实际连接绑定经过校验的地址，防止仅字符串检查和DNS rebinding。该策略仅约束结果下载；用户显式配置的本机生成网关若允许localhost，应单独记录授权来源范围，不能因此允许任何返回结果访问任意本机端口。每跳都验证TapNow禁用域、来源授权和DNS结果。

重试与日志只暴露resource ID、任务ID、字节/哈希、状态和固定错误码；不打印原始供应商body、签名URL、Key或headers。磁盘不足、权限错误、超量、下载403/404、签名失效、类型不符、截断分别可诊断。

## 实施顺序与有限验收

1. 新增私有store、有界downloader、本机GET/HEAD/Range；用本机fixture验证实际字节/hash、超量流、坏MIME、截断、取消、原子写中断和重启，只测相关模块。
2. 在durable.applyRemote接落盘闸门；测试重复submit/get/lookup只一次POST、下载失败只GET、并发重试、取消晚到、跨重启、文件缺失、供应商配置变更、私有headers不串CDN。
3. 更新精确本机ref合同，接所有结果应用、历史归档/恢复、fullImage/poster/world nested；浏览器实际解码并入图、保存刷新、历史取回、重复应用不重复节点。通过一个混合来源fixture记录浏览器请求只向本机。
4. 将UI直连配置转本机，覆盖用户供应商配置入口、旧直接配置恢复提示、现有.env/routed原生链不回归。
5. 单独执行旧项目/旧历史远程资源盘点与迁移：逐条可检查、不删原记录、只读取回、入图前verify、失败可重试。应用层旧远程读取必须先经本机受控迁移或显示明确待迁移状态，不能自动向TapNow拉取，也不能用CSP坏图作为完成证据。
6. 对本地Three依赖/HDRI、用户HTML/Widget、旧资产及实际合法供应商联调完成后再启用主入口CSP：connect仅self，本机/data/blob媒体、保留实际所需worker/wasm权限；抓真实网络请求、播放/像素、下载与恢复证据。没有Key时只能报告本机fixture验收，不能声称供应商生成效果验证。

关键新增tool/API合同：Purpose=原任务媒体本地取回；Inputs=task/resource ID和固定retry动作；Outputs=非秘密本机ref/manifest摘要；Permissions=已接受任务及显式供应商配置；Failures=下载/预算/验证/磁盘/取消/原配置失效；Logging=ID+固定code+字节；Tests=上述定向状态、传输、恢复及浏览器实际媒体。

最小交付不能只做到下载器；必须包含durable闸门、本机读取、所有类型与嵌套结果替换、前端直连入口迁移和原任务恢复，之后才有启用全局资源隔离的依据。旧项目迁移与未接入SPZ renderer仍须分别列作未完成，不扩大本轮只读评估的完成声明。

## 后续底层实施

上述内容保留为最初只读审计。后续按根线程授权，已新增 `server/generation-media-store.cjs` 与 `tests/generation-media-store.test.cjs`；没有修改既有 durable/store/routes、供应商、auth/config，没有新增依赖。该实现只接可信materializer已经解析的metadata和字节流，不接受网络URL、请求headers或用户文件路径，也不自行请求供应商。

API：

```js
const {createGenerationMediaStore} = require('./server/generation-media-store.cjs');
const media = createGenerationMediaStore({directory: privateAbsoluteDirectory, maxBytes: 100 * 1024 * 1024});
await media.ready;
const record = await media.put(
  {taskId, outputIndex: 0, role: 'main', mime: 'image/png', format: 'png', descriptorRevision: 0},
  trustedByteStream,
  {signal, maxBytes: 50 * 1024 * 1024, expectedBytes: knownActualLength},
);
const metadata = await media.info(record.resourceId, {taskId, role: 'main'});
const {info, handle} = await media.open(record.resourceId, {taskId, outputIndex: 0});
try { /* Range路由使用只读handle读取；不把路径交给浏览器。 */ }
finally { await handle.close(); }
await media.close();
```

`put` 的流支持Node异步可迭代二进制流及Web ReadableStream。`taskId`是UUIDv4，`outputIndex`为0–49，role为有界标识，mime/format/filename严格校验；未提供descriptorRevision时为0。每资源随机UUIDv4，固定属于 `taskId + outputIndex + role + descriptorRevision`。相同归属和metadata合并正在进行的写入或复用已提交资源；metadata变化拒绝覆盖，新内容需要明确的新revision。重复等待者取消只结束自己的等待，不取消原写入。

目录0700、文件0600；实际stream逐块计数、SHA256、非空/预期长度校验；字节文件fsync与rename、目录fsync之后，再提交fsync过的atomic manifest。最后一次取消检查之后开始原子发布，之后的取消不撤销已经提交的资源。读流中断、超量、取消或提交失败清理本次未提交part/bin，source.destroy同步抛错也不能跳过其余清理。已提交媒体和遗留无引用文件不自动删除。模块不声称已做MIME/codec解码，跨资源总预算与内容验证属于后续materializer。

重启回读manifest并核验文件长度及完整SHA；`open/info` 每次也通过只读FD重新核验完整SHA，拒绝缺失、同长度篡改、符号链接、错误mode、manifest损坏与归属不匹配。当前校验成本为每次访问O(完整文件字节数)，即使后续只返回小段Range或HEAD，也会先完整读取文件；这是本阶段明确的正确性优先选择，不能宣称已做高性能视频Range服务。后续若缓存验证结果，必须另行解决文件修改失效与竞态。

锁恢复策略在独立复审后改为 **fail closed**：仅通过 `wx` 原子创建 `.writer-lock`，任何已有锁返回 `media_store_locked`，包括死进程遗留锁。没有自动读取死PID后unlink的回收操作，因此不会因迟到unlink删掉另一个进程刚获得的新锁。人工恢复须先确认全部写入进程均已退出，再把 `.writer-lock` 移到私有仓库外的保留位置，随后重启；保留原锁用于诊断，不操作媒体文件，不能在活跃writer运行时移动其锁。正常 `close()` 仅释放自己token对应的锁。该修复只作用于本次新增模块，没有扩大到既有 `generation-store.cjs`。

局部验收：`node --test tests/generation-media-store.test.cjs` 12项全部通过。覆盖原字节/hash/权限/只读FD、重启幂等、并发重复/metadata冲突、流式超量/空内容/截断、独立等待者取消、停滞读取取消与晚到字节、关闭取消、同长度篡改/缺失/损坏manifest、路径URL/headers拒绝、symlink、提交失败清理。新增真实两个Node子进程争用同一遗留锁均拒绝且原token不变、手动移锁后原媒体恢复；初始化失败取消输入流；抛错destroy不覆盖原错误且不遗留part。独立审计者另外复现并核查上述锁及流清理问题，本段不把定向测试等同于实际供应商验收。

**仍未接线：** 供应商下载器、durable本地就绪闸门、本机GET/HEAD/Range、signed URL/headers刷新、公开outputs转换、浏览器直连入口迁移、全部结果类型/嵌套世界资源和旧资产迁移。文件仓库存在本身不代表生成媒体本地化完成；主入口全局资源CSP仍须等待真实端到端及旧资源验收。
