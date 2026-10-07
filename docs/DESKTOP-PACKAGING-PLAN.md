# freenow 桌面打包决策与发布计划

核对日期：2026-10-07。源码基线：`88b93c9831526a963f161a6d93743c3b190bfe25`，工作目录已有未提交的业务修改；本研究不覆盖它们。本文件记录公开 GET 与源码阅读结果，不代表安装、运行桌面包、签名或发布已经完成。

## 决策

推荐 **Electron** 作为当前 freenow 的桌面宿主，先实现 macOS ARM64 的本地可验证包，再形成 unsigned prerelease。理由是当前软件已有真实 Node HTTP 服务、OpenAI SDK、媒体子进程、复杂浏览器渲染与沙箱应用链路。Electron 的内置 Node 和统一 Chromium 可直接保留这些接口，改造范围较小。mygo 可以承载现有页面并启动 Node sidecar，但须增加 Go 宿主、独立 Node 二进制和系统 WebView 回归；它的原生 Go UI 不能直接运行现有 HTML/Three/Fabric/Tiptap 页面。

mygo 是有效的备选，尤其适合从 Go 开始构建的新应用。它不是“不能运行后端”或“没有自动更新”。项目非常活跃，但到本次核对仅建立约 11 天，已有发布与修复不等于 freenow 场景经过长期跨平台验证。不能只拿其几 MB 的 Go 程序与完整 freenow 包比较。

## 本项目实际运行要求

| 需求与源码证据 | 打包影响 |
| --- | --- |
| `server/server.cjs` 使用 `node:http`、文件系统、OpenAI SDK；服务只监听 `127.0.0.1`，默认端口 4173 | 必须有 Node 运行时与后端生命周期，静态网页壳无法提供全部能力；Key 继续留在服务端 |
| 同一服务提供 `/api/agent/*` 流式回复、生成/转录/媒体接口、静态文件和 Range 响应 | 保留现有同 origin 请求、SSE、媒体播放与范围读取行为；不把供应商 Key 放到 renderer/preload |
| `.generation-tasks`、`.generation-media`、`.segmentation-tasks`、`.agent-sessions` 目前位于 `server/__dirname` 下 | 必须把可写数据移动到专属 userData；安装包/ASAR 内不得作为可写工作目录 |
| `writeLocalResourceIndex({root})` 启动时生成本地资源索引 | 发布阶段生成并校验索引，运行时避免写入只读安装包；不能随意把整个根目录换为 userData 使静态资源丢失 |
| `server/media.cjs`、`playlist.cjs`、`video-scene-media.cjs`、`generation-video-mask-media.cjs` 调用 `spawn`，使用 `libx264`；分割输入使用 `libx264rgb` | FFmpeg/FFprobe 是独立可执行文件需求；Electron 内部媒体解码库不等于可调用的 `ffmpeg` CLI |
| `index.html` importmap 直接使用 `/node_modules/three/...`；Spark 构建脚本锁 `2.3.1`，本地 bundle 内含 Worker/WASM | 发布白名单要保留实际 Three runtime/addons、Spark bundle 与许可证；验收 WebGL、worker、WASM，不用空白窗口证明支持 |
| `agent-apps/host.mjs`、`mcp-app-proxy.html` 双 iframe + `allow-scripts` opaque origin + nonce/source 检查 | 维持 sandbox 和消息身份验证，禁止为了兼容开放 Node 集成或把内层改为宿主同源；widget 链也需单独验收 |
| 项目、素材、对话使用 IndexedDB，偏好/兼容键使用 localStorage | origin、持久 session 和 userData 是升级数据契约；不能每次使用随机端口 |

本次目录尺寸快照：`assets/` 约 639 MB，Agent apps 模板约 18 MB，`server/` 约 1.3 MB。它们包括历史/测试/尚待许可证审计的资源，不是最终压缩安装包预算。应按实际消费者筛选，不能假设整个仓库都必须发布。

## mygo 与 Electron 的具体差异

| 维度 | mygo，已核对源码/文档 | Electron，对 freenow 的判断 |
| --- | --- | --- |
| 浏览器引擎 | macOS WKWebView；Linux WebKitGTK；Windows WebView2；版本随系统/runtime变化 | 捆绑 Chromium，同版本各平台行为更接近现有 Chromium 页面；仍须验证 GPU/驱动差异 |
| 服务运行 | Go 本身不提供 Node；`resources/<platform>/bin/server` 支持辅助程序，`exec.Command` 可启动捆绑 Node 与现有 server | `utilityProcess.fork` 提供独立 Node 子进程；44.6.0 内置 Node 24.21.0，可重用现有 CJS server；Node 22 推荐环境与24的兼容仍需本项目测试 |
| 静态资源 | `frontendDist` 嵌入 Go binary，默认 `mygo://localhost/`；也可窗口加载显式 HTTP URL | 继续由本机服务提供 HTTP 资源，避免一次改造所有 `/api`、importmap 与沙箱 CSP；后续自定义协议需独立设计和迁移 |
| 自定义协议改造 | 默认 `mygo://` 与当前 HTTP Host/Origin 检查、硬编码 `http://${host}` CSP 不一致；需要代理/协议适配或改为Node同origin页面 | 固定本机 HTTP 入口保留已有契约；`file://` 不是此次选项 |
| WebGL / Spark | 系统 WebKit 支持情况取决于系统；自定义 scheme、blob Worker、WASM 与 opaque iframe 的完整组合未在本项目验证 | 统一 Chromium 减少一类移植风险；Spark LOD、WebGL2、取景捕获、音视频编解码仍不能靠框架宣传确认 |
| 数据隔离 | `PathUserData` 按应用名提供数据路径；webview storage的持久性/系统版本仍须实测 | 独立 userData + persistent Session 有明确 API；固定origin后升级保持 IndexedDB |
| 包装/平台 | CLI 支持 macOS app/DMG、Windows exe/NSIS、Linux archive/install.sh/deb；pure Go 跨编译可行，DMG签名只能在macOS完成；Linux仍依赖GTK/WebKitGTK | electron-builder 支持相应平台产物；首次只发布mac ARM64，不能把交叉构建成功称为Windows/Linux已验收 |
| 辅助程序签名 | 文档明确递归签Mach-O/库，helperEntitlements可声明Node JIT权限 | Electron签名链成熟；若内置FFmpeg仍须签helper并检查架构/动态库依赖 |
| 更新 | 已有Ed25519签名更新与delta：`internal/update/update.go` 实际使用 `crypto/ed25519`，验签SHA-256；不是只有README承诺 | 可选择electron-updater，但本批不添加/启用自动更新；其发布与签名条件先落实 |
| 维护 | 2026-09-26建仓；2026-10-07仍推送；最新版本v0.2.15，2026-10-06发布；开源MIT | Electron 44.6.0，2026-10-06 GitHub发布；官方仅维护最近三个稳定major及其最新minor，需持续更新运行时 |
| 已知问题 | #103修复WebView2创建失败/窗口关闭后页面调用悬置；#125/#129修复Linux原生UI全屏crash；#107/#112修复submenu nil。它们证明近期修复活跃，原生UI问题不直接等于web模式缺陷 | 未对整个Electron issue库做缺陷枚举；推荐依据是现有系统适配成本，不是宣称Electron无bug |
| 许可证 | 框架MIT，应携带版权声明；系统WebView/runtime的分发条件另行遵守 | Electron与electron-builder均MIT；捆绑Chromium、Node及其他第三方组件仍需完整LICENSE/第三方NOTICE |
| 体积 | README的few MB主要描述Go宿主；追加Node、FFmpeg、639MB候选资源后并不是few MB | 44.6.0 mac ARM64官方Electron zip约130.3MB十进制，安装展开更大；接受宿主体积换取兼容，最终包量需真实构建测量 |

## 本批新增依赖：供一次确认

只拟增加两项**开发依赖**，精确版本，不使用 `^`：

| 依赖 | 版本 | 用途/必要性 | 许可证 |
| --- | --- | --- | --- |
| `electron` | `44.6.0` | 桌面主进程、Chromium、内置Node utility process；运行时随安装包分发 | MIT及捆绑第三方声明 |
| `electron-builder` | `26.15.3` | macOS ARM64 app/DMG/zip，资源白名单、ASAR与后续签名配置 | MIT |

核对时electron-builder的GitHub `releases/latest`显示 `26.17.0`，但npm `latest`为 `26.15.3`，精确版本API确认26.15.3可取；本批选择npm已确认的26.15.3，不凭不同渠道“latest”猜版本。该tag源码commit为 `512a57ec9bcda593d3e0970bd2b9a33a63beeb57`。

不新增生产依赖；不添加 `electron-updater`、`ffmpeg-static`、`ffprobe-static`，不另装Go/Bun/Node sidecar。`electron-updater`本次npm latest为 `6.8.9`，仅记录为未来候选。本项目已有pnpm锁，继续现有包管理器；安装前由主任务按AGENTS要求提交具体确认，确认后才更改manifest/lock并运行安装。

构建Node建议精确 `22.23.3`（本次Node公开发布列表的最新22 LTS），最低须满足Electron npm包 `>=22.12.0`。pnpm沿用实际项目版本，不擅自升级；锁文件已给定的前端依赖保持原版本。本次未下载或执行任何新二进制。

## 桌面数据与安全契约

1. **独立数据目录**：在app.ready前确定稳定的userData，例如macOS `~/Library/Application Support/freenow-desktop/`；持久session固定 `persist:freenow-desktop-v1`。server私有任务/媒体/会话目录通过拟实现的 `FREENOW_DATA_DIR` 输入；只读资源索引通过 `FREENOW_PREBUILT_RESOURCES` 选择发布阶段产物，安装资源根保持独立。开发与桌面不共用writer-lock或任务目录。
2. **稳定origin**：拟定专用 `http://127.0.0.1:4183`，由实现确定后永久记录。端口占用时明确失败，不自动随机换端口，不附着已启动的网页开发服务。持久session隔离意味着同地址也不读取Chrome个人浏览器数据。老浏览器 `http://localhost:4173` 数据只通过显式导出/导入迁移，不能暗中复制用户浏览器profile。
3. **升级迁移**：appId、userData、session和origin不能随版本变动。IndexedDB继续现有schema版本机制；服务端数据版本写manifest，迁移前创建可恢复备份，不覆盖未知较新schema；保持原任务provider身份，未完成/unknown任务不自动重新提交。升级需测试旧版→新版、重启后媒体读取与锁恢复；卸载不默认清空项目。
4. **最小权限**：`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`；不开放webviewTag或所有frame preload API。拒绝未列入允许范围的navigation/new-window和权限，外部链接仅经过明确HTTPS URL allowlist/用户动作。当前顶层CSP使用unsafe-inline/unsafe-eval，不能声称已完成最严格CSP硬化；先保留行为并记录后续收敛。
5. **本机API边界**：保留仅loopback、Host和Origin校验、静态私有路径拒绝。必要的桌面启动会话token仅作为本机API身份，不能注入renderer可读取的供应商Key；任何额外IPC必须验证sender为固定主frame，不接受opaque iframe调用。renderer不直接调用任意filesystem、shell或HTTP代理。
6. **生命周期**：应用单实例；server启动就绪后再创建/导航窗口，失败显示可行动的错误；退出发送停止信号/明确shutdown请求，等待任务store持久化再结束，超时必须报告；不能遗留占端口的后台进程。不要依赖utility process默认退出行为等同于现有SIGTERM处理已成功。
7. **网络**：未配置供应商时无需联网即可打开本地编辑器；不继承开发者本地`.env`或其他项目Key，不打包任何凭据，不接回原站。FFmpeg只处理现有受限输入/协议，不新增自动下载可执行文件逻辑。

## 资源发布白名单与实际许可证边界

以运行消费者构建文件白名单，内容包括主页面/样式/scripts、`src/features`实际运行模块、服务端依赖、defaults空数据、明确许可的运行资源与Three模块。ASAR外只放真正需要作为可执行文件的helper。不要把 `files:["**/*"]` 当作可发布清单。

明确排除个人`.env*`、Key、私有任务/媒体/会话目录、writer-lock、恢复锁、HAR/账号捕获、Git元数据、开发笔记/截图、tests/qa/scripts等非运行输入；生产打包时只排除，不删除现有仓库文件。许可证和必要第三方NOTICE必须保留。发布清单记录每个资源的路径、SHA-256、来源、许可证与运行消费者，不能仅通过品牌字符串全局替换证明合法分发。

已查到的实际许可文件：

- `assets/branding/TABLER-LICENSE`及branding README：freenow F图形来自Tabler现有图标，路径数据未改，不应称独创商标图形。
- `assets/DAGRE-LICENSE`。
- `assets/licenses/spark-2.3.1-MIT.txt`、`assets/licenses/fflate-MIT.txt`；`scripts/build-spark.cjs`生成关联legal comments。
- Three及其addons需保留依赖包LICENSE；其他npm依赖从精确锁文件和包许可证生成声明。

尚未获得足够再分发证据的运行候选资源包括 `assets/fonts/HelveticaWorld-Bold.woff2`、`Boston Angel Bold.otf`、`LavaPro-Bold.ttf`、其他字体，部分GLB/HDR/封面，以及 `src/features/agent-apps/resources/apps/` 中官方来源模板。`manifest.json`记录widget hash和派生来源，但不是授予分发许可的许可证；`docs/PUBLIC-REPOSITORY-AUDIT-20261004.md`证明公开仓库私密输入清理与静态边界，不证明全部资产的分发权。下载来源公开、官方包可获取和已换品牌都不能自动赋予重新发布权。

**不据此删除/重写资产。** 首个本地reviewable包可保留现状用于内部兼容验收，公开prerelease须对将分发的实际文件逐项确认授权；可替换为已有许可的本地资产，或明确排除功能并给出缺资源状态。阻碍范围必须按包内具体文件报告；不能宣称“MIT桌面框架使整个官方包可重发”，也不能无证据断言整个项目侵权。项目根目前未见自有代码LICENSE；作者需明确本项目代码的发布许可，第三方许可各自保持。

## FFmpeg分发方案

首个unsigned prerelease不捆绑FFmpeg，延续 `FFMPEG_PATH` / `FFPROBE_PATH` 外部接口。GUI从Finder启动时PATH未必含Homebrew，应说明绝对路径配置；没有FFmpeg时编辑/浏览仍可用，相关导出明确提示缺依赖。这是一项真实功能限制，不能称全功能零安装包。

后续内置时：

- 从[FFmpeg官网](https://ffmpeg.org/download.html)核对源码发行；官网提供源码与第三方编译来源，不存在涵盖所有第三方build的统一“官方可重发二进制授权”。为每个平台记录精确版本、upstream tar hash、编译脚本、configuration、编译器、所有外部库版本、产物hash/动态库依赖。
- 当前 `libx264` / `libx264rgb` 需求必须选择启用GPL且包括对应x264编码器的构建，或另外设计编码器替代并验证RGB无损/时序/音轨行为。不能直接选择不含x264的LGPL构建后声称原功能完整。`--enable-nonfree` 构建不可按普通GPL/LGPL再分发。
- 携带适用GPL/LGPL和x264等全部声明、对应完整源代码/合规源代码提供方式与构建材料，按确切构建条件审查义务。以独立进程调用不意味着无需提供所分发FFmpeg本身的合规材料；也不凭进程调用就武断断言整个freenow必须GPL。
- 使用`extraResources`按平台存放CLI，设置绝对路径，不从ASAR执行；保持现有args验证/输入限额/超时与取消机制。签名所有Mach-O/helper，核验arm64和动态库可达性；对首次解码、裁切、拼接、FFprobe、RGB帧准备做真实输出回归。
- Electron的 `ffmpeg-v44.6.0-...zip` 是其内部媒体库，不是本项目需要的FFmpeg/FFprobe工具，不能拿它替换CLI。

## macOS ARM64首发与平台验收

第一阶段完成可审阅实现、server data-root、固定origin、白名单、独立桌面测试；确认两项开发依赖后安装和构建。构建命令默认`--publish never`，生成本地app/zip/DMG，不因存在登录态自动上传GitHub。包内版本、appId、目标架构、许可证、SHA-256与数据目录写入构建报告。

mac ARM64验收必须是实际app进程：

1. 未配置Key/无开发server/空独立userData启动；从Finder启动也成功，无原站请求，明确缺供应商与FFmpeg状态。
2. 新建项目、中文文本编辑、图片导入/撤销/导出、音视频播放和Range；关闭后重新打开，IndexedDB/媒体任务恢复。
3. Three真实GLB与Spark SPZ/LOD Worker/WASM有内容渲染；取景/捕获正确，不能白屏通过。
4. 正式Agent app/widget双iframe握手、键盘和保存交接；opaque内容无法读取宿主storage/Node/Key，无权限提升。
5. 端口占用、第二实例、server crash、退出时任务持久化、只读安装目录；禁用功能给出准确错误，不绕过隔离。
6. 前一包升级/同路径重装后，origin和userData不变；旧项目、媒体与未完成任务保留。

所有结果按“实现/本地自动检查/实机桌面验收/未验证”区分。Windows x64与Linux x64后续在对应OS/GPU与本地FFmpeg条件验收，再发布资产；仅`--win`或`--linux`构建完成不算实际运行证据。Intel mac亦需独立验证，不优先打universal倍增包体。

## 签名、公证、自动更新与release条件

**Unsigned并非notarized。** 没有Developer ID/公证的外部下载包可能被Gatekeeper阻挡。prerelease必须清楚标记“未Developer ID签名/未公证，仅测试”，不声称用户可无警告安装，不自动关闭系统安全设置。锁定的electron-builder文档说明：默认会搜索本机keychain证书，没有证书时不自动adhoc；本批应显式关闭 `CSC_IDENTITY_AUTO_DISCOVERY` 且设置 `mac.identity:null`，避免意外使用用户证书。若后续选择 `identity:"-"` 生成adhoc包，需记录这是adhoc而非Developer ID签名；hardenedRuntime下需合适的 `allow-jit` / `disable-library-validation` entitlements，避免framework Team ID不一致导致启动失败。完全unsigned或adhoc包的实际启动能力都须在目标机器验证。

正式mac发行需要macOS构建环境、Xcode/command-line tools、Apple Developer Program资格、Developer ID Application证书及私钥、受控签名identity与notarytool认证，hardened runtime/JIT helper entitlements、timestamp；所有可执行/库完成签名，提交Apple notarization成功后staple并执行独立签名/Gatekeeper校验。没有凭据则停留unsigned artifact，不编造签名成功。证书/notary凭据只经批准的secret输入，不读本机其他项目配置或公开写到日志。

本批**手动更新**：用户从固定GitHub release下载，核对版本/hash，替换app，保留userData。自动更新不是只加一个npm包：未来需固定更新源/平台channel、HTTPS、完整性与签名校验、签名密钥管理、失败回退、升级迁移和运行中任务处理；mac更新依赖可验证签名链。锁定electron-builder文档明确mac自动更新须签名，mac Squirrel链另需zip以生成latest-mac.yml，Windows使用NSIS；自动化发布还需要对应metadata和完整产物，不是只有DMG。mygo已有Ed25519更新功能同样需要私钥管理与升级回归，不能凭框架能力宣称产品更新安全已完成。

公开release前实际发布资产许可证清单与运行验收必须完成；生成draft和上传也需要与发布授权范围一致。附清楚的未签名/外部FFmpeg/供应商未配置说明、CHANGELOG、SHA256SUMS、许可证/来源说明，不上传个人数据和全量源码工作目录。

## 预算（规划估计，不是测量结果）

| 项目 | 初始预算 |
| --- | --- |
| 新依赖 | 2个dev依赖，0个production依赖；无需Go/Bun/独立Node sidecar |
| 下载 | Electron arm64 runtime zip实测release元数据约130.3MB；builder工具/传递依赖/缓存额外预留0.5–1.5GB，需安装后记录实际值 |
| 构建磁盘 | 现候选assets639MB，重复stage/ASAR/展开产物/压缩包；至少预留3–5GB，许可和消费者筛选后重新测量 |
| 首个ARM64 unsigned包 | 宿主/数据路径/白名单/启动关闭/定向回归约1–2工程日；模板许可核对和复杂WebGL/iframe回归可能增加1–3日，非保证交付时间 |
| 后续 | 正式签名公证取决于已有开发者资格与证书；Windows/Linux分别另计实机验收；内置FFmpeg另计编译、许可材料与编码回归 |

## 公开来源与可复核版本

所有来源于2026-10-07以无凭据公开GET读取；未执行远程代码或新软件。mygo main源码commit `0f0d242e7f919d5ee35b8cc060cb064f45ea6c6c`；最新已发布v0.2.15 tag commit `da84fc54dfc532704f60d5a066c0d1025d4dd282`。main与发布tag可能含不同修复，不能把刚merge代码等同于已发布版本。

- [mygo README/许可](https://github.com/egoist/mygo/tree/0f0d242e7f919d5ee35b8cc060cb064f45ea6c6c)：系统WebView、Go/native与Go 1.27+；该commit go.mod为Go1.27.1。
- [mygo frontend源码](https://github.com/egoist/mygo/blob/0f0d242e7f919d5ee35b8cc060cb064f45ea6c6c/frontend.go)：生产`mygo://localhost`、embed与显式URL。
- [mygo distribution](https://github.com/egoist/mygo/blob/0f0d242e7f919d5ee35b8cc060cb064f45ea6c6c/docs/distribution.md)：helper、平台资源、签名/安装与GTK依赖。
- [mygo configuration](https://github.com/egoist/mygo/blob/0f0d242e7f919d5ee35b8cc060cb064f45ea6c6c/docs/configuration.md)、[更新源码](https://github.com/egoist/mygo/blob/0f0d242e7f919d5ee35b8cc060cb064f45ea6c6c/internal/update/update.go)、[更新文档](https://github.com/egoist/mygo/blob/0f0d242e7f919d5ee35b8cc060cb064f45ea6c6c/docs/updates.md)。
- [mygo releases](https://github.com/egoist/mygo/releases)、[#103](https://github.com/egoist/mygo/pull/103)、[#125](https://github.com/egoist/mygo/issues/125)、[#129](https://github.com/egoist/mygo/pull/129)、[#107](https://github.com/egoist/mygo/issues/107)：核对时最新release v0.2.15为2026-10-06，若当天新增release需重新核验。
- [Electron v44.6.0](https://github.com/electron/electron/releases/tag/v44.6.0)、[公开组件列表](https://releases.electronjs.org/releases.json)：Chromium152.0.7977.130、Node24.21.0；npm latest同为44.6.0。GitHub发布日期与组件列表构建日期不同，不混用。
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)、[session](https://www.electronjs.org/docs/latest/api/session)、[安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[版本支持](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)、[签名公证](https://www.electronjs.org/docs/latest/tutorial/code-signing)：latest文档会随版本更新，本方案仍需针对锁定44.6.0验证。
- [electron-builder 26.15.3源码](https://github.com/electron-userland/electron-builder/tree/512a57ec9bcda593d3e0970bd2b9a33a63beeb57)、[MIT LICENSE](https://github.com/electron-userland/electron-builder/blob/512a57ec9bcda593d3e0970bd2b9a33a63beeb57/LICENSE)、[npm精确元数据](https://registry.npmjs.org/electron-builder/26.15.3)、[已读取mac签名文档](https://github.com/electron-userland/electron-builder/blob/512a57ec9bcda593d3e0970bd2b9a33a63beeb57/website/docs/features/code-signing/code-signing-mac.md)、[已读取更新文档](https://github.com/electron-userland/electron-builder/blob/512a57ec9bcda593d3e0970bd2b9a33a63beeb57/website/docs/features/auto-update.md)。旧官网`code-signing-mac.html`/`auto-update.html`在本次返回404，不能当作已读取证据。
- [FFmpeg法律与许可证](https://ffmpeg.org/legal.html)、[源码/构建来源](https://ffmpeg.org/download.html)：LGPL/GPL/nonfree与对应源代码义务，编码专利亦不是开源许可证自动覆盖范围。
- [Node发行列表](https://nodejs.org/dist/index.json)：22.23.3，2026-09-23；[Electron npm元数据](https://registry.npmjs.org/electron/44.6.0)：安装工具Node最低22.12.0。

本次研究没有构建或桌面运行证据，没有真实生成调用，没有新增依赖，没有更改凭据/生产配置，没有commit或release上传。后续实施与实机证据由桌面实现任务写回本文件或专门验收记录。
