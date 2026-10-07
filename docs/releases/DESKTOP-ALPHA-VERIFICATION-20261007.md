# freenow Desktop Alpha 安装包记录

日期：2026-10-07。目标 macOS ARM64 `0.1.0-alpha.1`，运行源码提交 `71cbf410daf902e060b589405165fe0dab4bdc38`。本记录区分文件、无窗口后台和实际原生窗口；它不代表全站复刻完成。

## 文件与ZIP

- 实际构建：Electron 44.6.0、electron-builder 26.15.3，macOS ARM64 ZIP。
- 包体729976742字节；SHA-256：`16708fc778a53e8a52f32c056b3b3da900ada18df47fec34f827dd8369b8dff3`。
- 6196个运行文件（含manifest），694800807字节；逐文件字节与SHA吻合。ASAR仅3文件：桌面主入口、配置模块及package元数据。
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

专项4196端口实际返回200：主页面、包内Three.js模块、关闭保存ES模块、预构建资源索引和生成配置。关闭保存模块SHA为`9487c24e116580c80df9e0efe9f69eeb04a296aa39ed58e7c1751beef26fa67b`，与源码相同。无Key配置不会生成；SIGTERM后后台退出0。Three的CommonJS导入有弃用警告，当前启动不受影响，未来须迁移到ES模块。

这些检查证明包内依赖与服务入口可运行，不能代替真实BrowserWindow/WebGL/Worker/保存重启验收。

## 原生窗口

Electron开发外壳已实机验证创建3D片场、添加立方体、真实WebGL与变换面板、回画布和退出释放4183，见[开发外壳截图](../screenshots/freenow-desktop-studio-20261007.jpg)。该图不是重新构建安装包的验收。

**安装包窗口验收待完成：** Computer Use尝试打开实际`.app`时Mac锁定，工具要求用户手动解锁。原生安装包的片场内直接退出、重启恢复和最后变换回读仍未记录；发布草稿不能当作已完成发布。
