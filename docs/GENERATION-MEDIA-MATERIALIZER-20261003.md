# 生成结果媒体落盘核心

仅说明 `generation-media-download.cjs`、`generation-media-materializer.cjs` 与专属测试。生产任务闸门和 HTTP 读取由 durable/gateway 接线完成；此文不代替完整浏览器或真实供应商验收。

## 接口

```js
const {createGenerationMediaMaterializer} = require('../server/generation-media-materializer.cjs');
const materializer = createGenerationMediaMaterializer({store}); // store.maxBytes 须为 256 MiB
const result = await materializer.localize(providerOutputs, {taskId, signal, revision: 0});
// result: {outputs, resources: UUIDv4[], manifests: immutableStoreRecords[]}
await materializer.verify(result.outputs, {taskId});
// {resources, manifests}; 对每个资源核验同任务归属及实际文件完整 SHA。
```

`taskId` 必须为已接受任务的 UUIDv4，`revision` 为非负安全整数。公开媒体字段统一为精确 `/api/generation/media/<UUIDv4>`，不保存监听端口。媒体实际 MIME 来自字节；有 `mime` 元数据时校验其兼容性，并将认可的通用 MIME/格式别名标准化为真实文件 MIME。

`localize` 克隆原描述，不修改调用者保留的供应商成功结果。全部媒体完成、最后一次任务取消检查及整组 `verify` 通过后返回结果。失败返回固定 `media_*` 错误码，原上游结果可继续持久保存、GET 取回；模块没有生成 POST 能力。

同 `taskId + revision` 的并行调用合并；后加入的调用取消只停止自己等待。主调用取消会停止该次真实下载和文件写入。失败清理 active 状态，可重试同描述；已提交的部分文件在当前进程内复用。相同 revision 换不同描述返回 `media_descriptor_conflict`，刷新签名 URL 或修复坏文件须递增 revision。缓存最多64个 task/revision，上限可显式降低；缓存淘汰不删除文件。跨进程已保存完整 outputs 可直接 `verify`，无网络请求；未持久提交整组结果的部分资源，重启可能重新读取 URL，store 的归属/revision 幂等写入仍复用已提交文件，不覆盖原字节。

同任务同 URL（含签名 query）复用一个 UUID，包括主URL、alias 和多个输出位置。资源首次出现的 index/role 是 manifest 归属；共享引用的所有使用位置只应断言 `taskId`，不能错误断言每个位置的 index/role。不同 URL 即使看似同文件也独立保存，避免把原图、封面、不同 LOD 或授权来源混为一项。

## 覆盖字段

- image/video/audio/model 的 `url` 和对应 type alias；`fullImage`、`poster`、`sourceUrl`。
- Marble `world.assets.splats.spzUrls` 的 100k、150k、500k、full_res 全部实际存在项。
- `world.assets.mesh` 的 colliderMeshUrl、fullResMeshUrl、hqMeshUrl。
- `world.assets.imagery.panoUrl`。
- 保留世界身份、模型、坐标系、尺度、地面偏移、选择LOD、原格式与表示方式。信息链接 `world.marbleUrl` 校验公开 HTTPS，移除 query/hash，保持链接元数据，绝不下载为媒体。`text` 不落盘。

blob URL 拒绝，因为服务端不能跨进程取回它。未知输出/world 字段拒绝，不通过任意递归URL代理猜协议。

Marble 原生字段核对来源：官方 [Get world](https://docs.worldlabs.ai/api/reference/worlds/get.md) 中 WorldAssets/SplatAssets/MeshAssets/ImageryAssets；与项目 `generation-marble.cjs` 的明确 snake_case → camelCase 映射一致。

## 下载边界

使用 Node 内建 http/https/net/dns/zlib，无新依赖。仅允许公开 HTTP(S) 或规范 base64 data image/video/audio/模型描述；拒绝userinfo、控制字符、blob/file协议、TapNow/tamaredge及已确认conversation服务域。WHATWG URL先标准化短/十进制/八进制/十六进制IPv4；IP判定覆盖IPv4私网、保留区、IPv6非全球单播、mapped/transition/文档区。DNS须所有结果均为认可公开地址，实际 socket 连接必须匹配所选地址；`agent:false` 与固定 lookup 防止第二次DNS解析或复用另一连接。Node transport不自动跟随跳转，所有3xx明确拒绝；不设置“允许跳转”回退。

供应商 Key 默认不会附到CDN。仅构造时传入的可信服务端回调可产生下载授权：

```js
createGenerationMediaMaterializer({
  store,
  resolveResource: async ({url, taskId, outputIndex, role, kind, revision}, {signal}) => ({
    url,
    origin: 'https://exact-download.example', // 必须等于解析后该URL的origin
    headers: {'Authorization': serverResolvedResourceAuthorization},
  }),
});
```

回调按原已接受任务及供应商配置解析；它不是浏览器输入协议。响应 header 及授权仅存在这次下载内存，不入 manifest、日志或公开结果。拒绝 Host、Cookie、代理认证及连接/内容长度注入；headers最多24个且总长度16KiB。生产无任意URL下载路由。可注入 `download` / downloader `lookup`、`requestImpl` 仅供受信任测试或服务器构造，不能由请求JSON提供。

## 预算和校验

| 项目 | 上限 |
| --- | --- |
| 图片/视频 | 每资源100 MiB |
| 音频 | 每资源50 MiB；原生Speech保留自身32 MiB |
| GLB | 每资源12 MiB |
| gzip SPZ | 每资源256 MiB；解压扫描1 GiB |
| 任务 | 512 MiB、最多50输出、128个不同资源 |
| 下载 | 一个materializer实例跨任务最多2并发；每下载120秒、整组600秒 |

预算可降低，不能经此接口扩大。Content-Length提前拒绝，实际stream逐块计数为硬边界；无长度、截断、超量、超时及取消均清理未提交part。store负责完整SHA和原子文件/manifest提交。物理已提交资源不因下一资源失败或晚到取消而删除；durable必须在公开整组结果前再次核对取消收据与revision。

内容检查包含图片/音视频常见魔数、报告MIME匹配、PNG头部尺寸/像素上限和IEND、JPEG结束标记、RIFF/GLB长度、WAV实际chunk边界。既有原生Speech streaming WAV的RIFF/data `0xffffffff` 合法标记通过实际数据校验，字节不改写。gzip SPZ用解压stream核验gzip CRC/完整性、NGSP头、版本1–3、点数与实际属性长度；官方Niantic [load-spz.cc](https://github.com/nianticlabs/spz/blob/main/src/cc/load-spz.cc) 当前仍说明v4为未发布zstd路径，本实现不猜测该协议。SPZ扩展标记允许有界尾部，但不解析扩展语义。

这些是有界格式与容器检查，**不是完整像素/帧/音频/模型解码**。MP4/WebM/AVIF仍仅识别容器头，不能因已落盘宣称可播放；前端应用前必须真实decode，GLB真实parse，SPZ renderer单独验收。SPZ落盘不等于已有高斯渲染能力。

## Tool/API 合同与验证

Purpose：在原供应商任务成功后，把所有可消费结果资源落为私有本机文件。

Inputs：已接受taskId、可信供应商输出描述、取消signal、descriptor revision；可选仅服务器控制的资源授权resolver。

Outputs：本机媒体路径、非秘密manifest摘要及resource IDs；不返回源URL或headers。

Permissions：只允许已接受任务的资源归属；下载地址统一执行公开网络边界；读取交由本机HTTP接口。

Failure modes：URL/DNS/实际peer/跳转/HTTP签名过期/长度/预算/MIME/格式/取消/超时/文件完整性/磁盘与身份冲突。所有错误消息固定脱敏，原URL及授权不拼接到消息。

Logging：模块不记录源URL、供应商body、header、Key或文件路径。调用者只能记录固定错误码和task/resource ID、字节与hash。

Tests：`node --test tests/generation-media-materializer.test.cjs`。专属16项定向测试覆盖IP变体、全部DNS答复、实际peer、无默认Key、跳转、MIME、流超量且不发布、内容及gzip SPZ、内联音视频、原生Speech streaming WAV、任务预算、所有嵌套映射、任务归属、并发复用、跨任务2并发、取消与part清理、partial失败重试及缺文件。HTTP transport使用受信任内存stream fixture，未请求真实供应商。视频fixture只用于容器闸门，不冒充可播放验收。
