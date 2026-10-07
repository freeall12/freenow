# 桌面打包数据路径审计

日期：2026-10-07。范围：当前 checkout 的 `server/`、`src/`，只读审阅，未启动服务、调用供应商或执行媒体处理。本报告记录审计时的代码，不代表桌面打包与迁移已经实现。

**后续实现更新（同日）：** 下文保留实现前审计。现有 `server/server.cjs` 已按 `FREENOW_DATA_DIR` 重定向上述私有目录，桌面使用预构建只读资源索引；Sonilo 已读取 `FFMPEG_PATH` / `FFPROBE_PATH`。桌面生命周期等待 Agent、片场和画布保存。当前代码与安装包验证应查看 [桌面指南](DESKTOP.md) 和 [关闭保存记录](DESKTOP-LIFECYCLE-VERIFICATION.md)，不要把下文的实现前缺口当作当前状态。长期临时目录清理、存储迁移和完整媒体压力验收仍未完成。

## 结论

当前生产入口没有读取 `FREENOW_DATA_DIR`。6类私有持久目录来自 `server/__dirname`，其中视频遮罩准备与视频深度批次目录由生成任务目录派生。另有启动时写入项目 `assets/local-resource-index.json` 的路径。打包后这些写入必须离开应用资源目录；仅改变进程 cwd 无法修复 `__dirname` 写入。

建议桌面主进程先确定一个绝对、可写、用户私有的数据根目录，通过 `FREENOW_DATA_DIR` 注入子服务；开发模式可保留现有默认。应用代码、静态 assets、manifest 和供应商模型配置应继续从只读资源根目录读取。下表是建议映射，尚未改代码。

| 当前生产路径 | 建议目标 | 文件/调用依据 | 内容与接口 |
| --- | --- | --- | --- |
| `server/.agent-sessions/` | `$FREENOW_DATA_DIR/.agent-sessions/` | `server/server.cjs:26`；`agent-session-store.cjs:40-144` | session UUID JSON、`.writer-lock`、`.writer-claim.<uuid>`、原子 `.tmp/.bak`；Agent turn/continue/state/cancel/delegated 系列接口使用 |
| `server/.generation-tasks/` | `$FREENOW_DATA_DIR/.generation-tasks/` | `server/server.cjs:18`；`generation.cjs:83`；`generation-store.cjs:5-29` | task UUID JSON、`.writer-lock`、原子 `.tmp`；`/api/generation/tasks`、按ID查询/取消、submission lookup/recovery |
| `server/.generation-media/` | `$FREENOW_DATA_DIR/.generation-media/` | `server/server.cjs:18`；`generation.cjs:77-78`；`generation-media-store.cjs:58-130` | UUID `.bin/.json`、`.writer-lock`、`.part/.manifest.part`；已本地化生成产物，`/api/generation/media/<resourceId>` 负责权限与字节读取 |
| `server/.segmentation-tasks/` | `$FREENOW_DATA_DIR/.segmentation-tasks/` | `server/server.cjs:10`；`video-segmentation.cjs:112-117`；`video-segmentation-replicate.cjs:11-27` | Replicate SAM2 task JSON/lease；`files/<taskId>/` 保存源片、方向分支、蒙层PNG与RLE；`/api/video-segmentation/*`。只有 `replicate-sam2-native` 分支使用此持久服务，legacy分支不写该仓库 |
| `server/.generation-tasks-video-mask/` | `$FREENOW_DATA_DIR/.generation-tasks-video-mask/` | `generation.cjs:46,48`；`generation-router.cjs:122`；`generation-video-mask.cjs:101-125,161` | `<preparationId>/manifest.json`、`video.bin`、`mask.bin`、可选 `audio.bin/reference.bin`、`result.bin`；生成任务的准备、上传、轮询与恢复。独立直接创建provider且未传directory时还会落入 `server/.video-mask-preparation/`，该默认也须审阅 |
| `server/.generation-tasks-video-depth/` | `$FREENOW_DATA_DIR/.generation-tasks-video-depth/` | `generation.cjs:47-48`；`generation-router.cjs:122`；`generation-video-depth.cjs:126`；`generation-video-depth-batch.cjs:28-39` | 双结果video-depth父批次 UUID JSON、原子 `.tmp`，保存子任务身份与状态；单结果不依赖持久父批次 |

只将生成任务 `directory` 移入新数据根目录，其 `-video-mask/-video-depth` 派生目录会随之移动；不能漏掉显式 `mediaDirectory` 与分割目录。不要把遮罩准备目录误归入一次性FFmpeg缓存：任务恢复仍需要其真实媒体与manifest。

## 启动资源索引写入

`server/server.cjs:22` 在启动时调用 `writeLocalResourceIndex({root})`，其中 root 是项目资源根目录。`src/features/local-resource-migration/cli.cjs:6-19` 默认输出 `assets/local-resource-index.json`，显式参数也只能等于这个项目内路径，并通过 `realpath` 禁止 assets 指向项目外部。函数先写 `assets/.local-resource-index-<pid>-<uuid>`，再rename，finally清理临时文件。

因此不能仅将新output传到数据目录：现有API会主动拒绝。服务器 `/assets/local-resource-index.json` 是专用JSON路由，返回该启动Promise的 `result.index`，不依赖静态磁盘读取；写入失败目前使该路由返回503，并不会阻止其他服务启动。

建议优先让生产启动调用只读 `buildLocalResourceIndex({root})` 并在内存返回有效index；显式CLI生成器继续用于开发/构建。若产品需要缓存，再把输出写到 `$FREENOW_DATA_DIR/local-resource-index.json`，保持资源核验root与输出目录分离，保留现有公共URL。构建器 `build-index.cjs:16-85` 仍读取只读 `reference/` manifest 与 `assets/`，并验证真实字节/sha256；不能以迁移为由跳过这些核验。

## FFmpeg/FFprobe临时路径与生命周期

这些路径都通过 `os.tmpdir()` + `mkdtemp` 创建，不来自项目/cwd，也不属于持久任务数据。默认可以继续使用系统临时目录。若桌面需要统一磁盘配额、崩溃后清理或支持目录内诊断，可在未来加入显式temp根目录注入；不要把临时文件和恢复任务仓库放进同一清理规则。

| 模块/入口 | 临时前缀与文件 | 正常/失败清理和取消 |
| --- | --- | --- |
| `server/media.cjs:5-7`，`POST /api/media/{finalize,trim,audio}` | `canvas-media-*`；`input`、`output.mp4/wav/webm` | 并发2；120秒命令超时；请求aborted/响应close发SIGTERM，超时发SIGKILL；finally逐个unlink后rmdir。超时Promise在子进程close前即reject，有清理与子进程退出竞争的风险；桌面退出流程尚未显式await此模块活跃作业 |
| `server/playlist.cjs:5-16`，`POST /api/media/playlist` | `canvas-playlist-*`；`input-N`、`part-N.mp4`、`parts.txt`、`merged.mp4` | 并发2；每个命令120秒；取消SIGTERM、超时SIGKILL，Promise等待child.close；finally卸载事件后逐个unlink/rmdir。没有跨重启残留清理 |
| `server/video-scene-media.cjs:14-32,65-119`，视频分析provider调用 | `canvas-video-scenes-*`；`input`、`scene-N.mp4`、`scene-N-frame-N.jpg` | 并发2；整体5分钟、单命令默认120秒；AbortSignal联动，SIGTERM后1秒SIGKILL，等待close；finally逐个unlink/rmdir |
| `server/video-segmentation-media.cjs:6,29-78`，SAM2分支准备 | `freenow-segmentation-media-*`；`source`、`source.rgb`、`forward.mp4/reverse.mp4` | 私有目录0700、源文件0600；并发2、120秒，AbortSignal联动共享media command；finally先关闭raw文件句柄，再recursive rm。raw磁盘预算最高2048 MiB，不能以输入视频大小估算所需磁盘 |
| `server/generation-video-mask-media.cjs:7,31-44,90-95`，遮罩prepare/validate/preserveAudio和depth inspect | `freenow-video-mask-*`；`source`、`video.mp4`、`mask.mp4`、`audio.wav/m4a`、`result.mp4`以及复用音频时的工作文件 | 并发2、120秒；SIGTERM后500ms SIGKILL，等待close；finally recursive rm。持久副本另存到上表video-mask仓库 |
| `server/generation-sonilo.cjs:57-95,97,152`，来源视频与SFX WAV解码 | `freenow-sonilo-*` 的 `source.mp4`；`freenow-sonilo-audio-*` 的 `supplier.wav/decoded.wav` | 目录0700/输入0600；provider媒体预算默认120秒；使用共享video-mask command的取消/close逻辑；finally递减计数并recursive rm |
| `server/generation-magnific.cjs:37-81`，图片真实解码 | `freenow-magnific-*`；`result.png/jpg/webp` | 非直接PNG解码路径才用工具；AbortSignal取消，SIGTERM后500ms SIGKILL，等待close；finally递减解码计数并recursive rm |

所有finally清理都无法保证强制结束进程、系统掉电或崩溃后的执行。当前没有发现上述前缀的启动残留扫描/TTL清理。若加入清理，需要区分活跃作业与旧目录，保证只处理明确属于本应用的临时前缀，不能删正在使用的文件。`FFMPEG_PATH`/`FFPROBE_PATH` 是可执行路径配置，不是数据路径；打包需独立验证实际可执行文件。Sonilo provider默认采用字面 `ffmpeg/ffprobe`，gateway目前未将这两个环境值显式传入Sonilo，不能只设置环境变量便声称该provider使用打包二进制。

## 持久仓库关闭与迁移约束

`server/server.cjs` 的SIGTERM/SIGINT关闭逻辑依次关闭runtime、session store、generation、segmentation；generation关闭先停止durable任务，再关闭媒体HTTP与媒体仓库。durable和SAM2服务会abort操作、等待活跃Promise与队列，再释放store lease。媒体仓库会abort活动写入、等事务收尾，随后释放自己的lease。不能在持久事务还运行时复制目录，也不能把 `.writer-lock` 当作普通可移植数据。

`generation-media-store.cjs:48-56` 明确拒绝自动抢占已存在writer锁，包括崩溃遗留锁；必须确认所有writer退出后再人工处理。generation store与Agent session store有自己的旧进程lease恢复逻辑，不能用一个统一“删锁”步骤替代。当前持久仓库没有自动任务/媒体TTL删除，HTTP DELETE主要改变取消状态，保留恢复记录或实际媒体；已取消、失败与未完成任务也应纳入迁移。

video-mask manifest write在rename失败时没有finally清除已写临时manifest；video-mask/depth provider本身没有专用close/跨进程writer lease。生产durable gateway负责作业取消和等待，桌面应采用单writer实例；残留临时文件处理需与任务恢复完整性规则配合，不应随意擦除目录。

## src、浏览器存储与开发生成器

生产 `src/` 直接Node磁盘写入仅发现上述local-resource CLI与 `src/features/workflow-templates/compile.mjs`。后者是显式命令行生成器，通过 `resolve(process.argv path)` 写media-slots/catalog JSON，相对参数使用cwd；未发现生产server引入它。`build-index.cjs` 仅磁盘读取。

浏览器运行时的画布、素材、Agent artifacts/工作流记录通过 `CanvasStore`、IndexedDB与部分localStorage存储，未直接写Node项目目录。例如 `src/features/agent-artifacts/store.mjs:5-24` 建立 `*-artifacts/documents`；subject-library使用CanvasStore并保留只读legacy迁移来源。`FREENOW_DATA_DIR`不会自动迁移这些浏览器资料。桌面必须另外保持稳定浏览器session/userData路径与origin；端口或origin改变可能让原IndexedDB不可见。用户明确下载的作品/媒体由浏览器导出流负责，不能笼统搬进服务器任务目录。

`src/**/qa/` 中的Node生成器会写fixture HTML、manifest、媒体及截图，例如video-history的 `generate-history-app.cjs`，studio-v2的 `generate-*-app.cjs`，workflow-templates的 `qa/generate-main.cjs`，node-history-expansion的 `qa/verify.cjs`。QA native server通常使用隔离 `os.tmpdir()` 并在close清除。它们未由生产server自动执行，应作为开发工具留在源码环境，桌面启动不能运行这些生成器。当前审计未把开发输出迁移为生产数据接口。

## 验证边界与建议验收

已通过 `rg` 枚举Node fs imports、写入/rename/mkdir/open、`__dirname`、cwd、temp路径及调用链；未运行迁移、FFmpeg或供应商请求，也未修改server/package/desktop文件。没有在生产server/src发现其他直接cwd磁盘持久写入；上述结论不覆盖依赖包或后续桌面层新增写入。

后续实现应验证：只读应用目录下可启动；全部6类数据进入选定根目录；索引路由仍可返回核验后的数据；真实媒体处理完成/失败/取消均清理temp；关闭等待持久事务；重启可查询原任务与媒体；浏览器资料在稳定origin下可回读。升级迁移应在旧writer停止后复制完整数据树并核对manifest/媒体哈希，保留旧目录直至新版本回读确认，不自动删除旧资料。
