# freenow Desktop Alpha 安装包记录

日期：2026-10-07。目标 macOS ARM64 `0.1.0-alpha.1`，运行源码提交 `642d3db5c156ae82b0ee33f253fad2756ffe015a`。本记录区分文件、无窗口后台和实际原生窗口；它不代表全站复刻完成。

## 文件与ZIP

- 实际构建：Electron 44.6.0、electron-builder 26.15.3，macOS ARM64 ZIP。
- 包体729978385字节；SHA-256：`42dc247b909a8e7a2f0322f75c00e6ec212917491ea730426d1cf83f21bf821f`。
- 6197个运行文件（含manifest），694802127字节；逐文件字节与SHA吻合。ASAR仅3文件：桌面主入口、配置模块及package元数据。
- 四类启动数据与公开空默认值逐字节相同。未含私有Key文件、任务/媒体存储、QA、research或HAR。保留公开`provider.env.example`。
- ZIP中核对OpenAI SDK、Three模块、关闭保存模块、实际图标、空默认画布与同一manifest。
- 使用现有Tabler F资源构建桌面图标，不新增自绘图形。ICNS SHA：`0a2d8dd703680558967ffa72eebfe095c103715647f1f69887b1cbd148d7b06c`。
- 未使用Developer ID、未公证。`codesign -dv`显示Electron可执行文件为arm64、Signature=adhoc、TeamIdentifier=not set、Sealed Resources=none；ad-hoc标记不构成开发者签名。

实际产物审计命令（在对应源码提交构建后运行）：

```sh
pnpm desktop:pack
node scripts/audit-desktop-artifact.cjs
```

首轮实际审计发现builder排除runtime根`node_modules`，修为独立显式复制OpenAI和Three。其次移除collector额外复制到ASAR的前端依赖；重新构建后文件检查通过。旧运行目录自动归档，不合并或删除任意目录。

[机器可读结果](desktop-artifact-audit-20261007.json)。不把文件名过滤视为全部供应链安全审计；当前Git index凭据检查2556个blobs、2020个文本、536个二进制跳过，findings=0、private_paths=0。原参考模板/部分字体许可证据仍不完整，没有统一MIT许可承诺。

## 安装包自带后台（无窗口）

通过包内`Contents/MacOS/freenow`的Electron Node模式，在干净环境和独立临时数据目录启动**包内server**，没有使用系统Node运行后台，也没有读取个人Key文件。实际版本Node24.21.0、Electron44.6.0、arm64。

专项4196端口实际返回200：主页面、包内Three.js模块、关闭保存ES模块、预构建资源索引和生成配置。最新642d3db包再次使用自带Node在新临时目录启动，配置200，SIGTERM后退出0。关闭保存模块SHA为`5f7908e58ef50a9ac48cf7ceb09f3f79c110d646bbde928046deb86799e0986d`，与源码相同。无Key配置不会生成；SIGTERM后后台退出0。Three的CommonJS导入有弃用警告，当前启动不受影响，未来须迁移到ES模块。

这些检查证明包内依赖与服务入口可运行，不能代替真实BrowserWindow/WebGL/Worker/保存重启验收。

## 原生窗口

Electron开发外壳已实机验证创建3D片场、添加立方体、真实WebGL与变换面板、回画布和退出释放4183，见[开发外壳截图](../screenshots/freenow-desktop-studio-20261007.jpg)。该图不是重新构建安装包的验收。

2026-10-07 Computer Use 已打开实际 `build/release/mac-arm64/freenow.app`。运行包仍来自本页记录的 `642d3db5c156ae82b0ee33f253fad2756ffe015a`，没有用开发 Electron 窗口代替。

1. 打开已保存的片场，本地立方体恢复并在真实 WebGL 中显示。
2. 位置 X 从 0 修改为 1.25，Tab 提交。
3. 保持在片场内 Cmd+Q 直接退出，退出后确认 4183 释放。
4. 再次打开同一 `.app`，进入片场并选择立方体；AX 回读位置 X=1.25、Y=0.5、Z=0，真实 WebGL 与对象面板一致。

[安装包重开与持久变换截图](../screenshots/freenow-desktop-packaged-restart-20261007.jpg)。这证明实际包的片场保存、正常退出、后台释放和重开恢复；没有调用真实模型，也不代表全部功能、跨设备、长时间运行或干净设备安装验收。

## 上传与发布

GitHub Release 资产核对结果：ZIP `state=uploaded`，729,978,385 字节，远端 digest 为 `42dc247b909a8e7a2f0322f75c00e6ec212917491ea730426d1cf83f21bf821f`，与本地 SHA-256 相同。2026-10-07 主任务将 Release 从草稿改为公开 prerelease，`gh release edit` 返回成功（退出 0），最终链接：[v0.1.0-alpha.1](https://github.com/freeall12/freenow/releases/tag/v0.1.0-alpha.1)。上传完整性与发布状态均已核对，保留 Alpha、Unsigned/未公证、外部 FFmpeg、全站与真实 Key 未验及许可边界。
