# 公开仓库检查与清理 · 2026-10-04

本批同步 origin 后，检查当前公开文件和全部本地可达 Git refs，包括 `origin/main` 的发布历史。扫描 2,445 个 blob，其中2,085份文本、360份二进制按首8KiB含NUL判定跳过。宽规则命中项逐一核对为测试假凭据或空配置示例；新增可复用检查过滤明确夹具、低熵文本及变量读取，最终报告0个需处理凭据、0个当前私有路径。未发现真实 API Key、访问令牌、JWT或私钥文本。

这是本次规则检查结果，不能证明所有编码、二进制元数据、不可达提交、Fork/PR或外部系统都没有凭据。当前远端仅发现main发布分支，无已抓取tag。未接触本机真实Key，也没有调用供应商验证任何候选。

## 当前发布树移出的文件

以下5件没有当前已跟踪代码、构建产物、文档或测试消费者，合计23,691,306字节。取消Git跟踪并精确忽略，本机字节保留，以兼容个人旧记录。

| 文件 | 依据 |
| --- | --- |
| `assets/studio/studio.hdr` | 与现用 `environments/studio-soft.hdr` 完全相同，预设已指向新路径 |
| `assets/agent-visualize.svg` | 与现用 `agent-app-visualize.svg` 完全相同 |
| `assets/agent-welcome-palette.svg` | 欢迎建议改用实际分类icon目录，旧文件没有消费者 |
| `assets/focus-edit-cursor.svg` | 现用 `focus-edit-pointer.svg` |
| `assets/studio-node.svg` | 当前节点图标来自 `CANVAS_SEARCH_ICONS.studio` |

仍需的字体、GLB/HDR、公开模板封面、测试视频/GLTF、历史应用版本和许可保留。特别是 `studio/tree.glb` 虽有重复副本，仍有动态路径消费者；不会只凭文件名搜索删除。旧文件仍存在历史提交，本批不改写历史。

官方模板正文的公开静态来源审计归档至 `docs/research/`，更新引用；它是可维护的公开证据，不作为私人抓包删除。`reference/` 在公开树仅保留 Tabler 许可。明确保留多场景GLTF测试夹具，修正其忽略例外。

## 开发服务的读取边界

Git忽略不等于HTTP访问隔离。原服务按项目根提供静态文件，本机 `reference/` 中未跟踪的原始抓包可能被直接请求。本批 `server/static-public-path.cjs` 作为共同路径规则，服务在读取字节前拒绝：

- 按不区分大小写的根目录保护 macOS 文件系统上的别名，原始 `reference/`（只公开 `TABLER-LICENSE`）、`scripts/`、`server/`、`tests/`。
- 点文件、上层路径、反斜杠路径，以及 HAR/私钥/备份/临时文件后缀。
- 除Three浏览器运行库外的node_modules。

运行所需 `runtime-reference/`、本地资源、功能模块、组件库、公开QA和文档继续提供。主页面本地CSP、服务端Key配置及原站出站阻断保持原合同。服务仍仅监听127.0.0.1；这不是公网部署方案。

实际HTTP：原始官方包抓取路径、审计脚本和 `.env.local` 均403；Tabler许可、运行技能、本轮QA、现用HDR及主页面均200。`Reference/Server/Scripts/NODE_MODULES` 大小写变体同样403，避免macOS默认不区分大小写文件系统的别名绕过。只读HEAD检查不输出文件正文。

## 后续发布检查

```sh
# 默认/--staged均扫描全部当前Git index字节，不读取未跟踪.env或服务器私有存储
python3 scripts/audit-public-repository.py --staged

# 同步所需refs后检查可达历史，输出规则、位置与blob身份，绝不打印匹配内容
git fetch origin
python3 scripts/audit-public-repository.py --history

# 新增边界的定向回归
node --test tests/public-repository-audit.test.cjs
```

脚本仅用Python标准库和Git；不加入应用运行依赖。匹配项只输出路径、规则、行号与对象身份，非零退出阻止“已通过”的误报。配置示例中的凭据字段必须为空；测试目录不能笼统豁免真实形态的供应商Token。私有路径、真实形态假Token检测、历史删除仍可检出、日志不回显Token以及静态运行资源放行均有回归。

有界模式对低熵通用凭据与二进制跳过存在限制；发现任何真实泄露时应先撤销/轮换，再按具体分支/历史范围制定清理，普通删文件不等于撤销凭据。
