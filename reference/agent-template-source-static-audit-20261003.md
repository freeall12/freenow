# 官方模板正文来源审计（2026-10-03）

本轮只读取官方安装包静态文件和已知公开文档/应用目录。未使用登录凭据、私有技能 API、模型调用、付费操作或用户浏览器；未改变 runtime、picker 原文件及模板登记。核验时间约为 2026-10-03 01:40 UTC。

**结论：本轮仍没有取得 92 个登记引用中的任何独立模板正文，也没有找到对象键到正文的可核验下载映射。** 这只描述以下已审计范围，不推断服务端没有正文。

## 安装包精确字节核验

安装包为 `/Applications/TapNow.app` 0.4.81，Resources 根目录共 883 个文件。将每个文件的原始字节 SHA256 与 `creative-template-references.mjs` + `motion-template-references.mjs` 中 92 个登记摘要比较，匹配数为 **0**。这扩大了此前只检查 30 个 HTML 的范围。

使用 Python 标准库解析 `app.asar`（21,559,524 bytes）头部，递归得到 2,521 个叶文件；2,521 个均有 offset，按原始 offset/size 取出内容后计算 SHA256，匹配数仍为 **0**，没有跳过叶文件。ASAR SHA256：`ebf99b3b70514d71b5d862f1b6e230ec3b87861a670c987dd5902e7a32bea8bc`。

解析依据：LE uint32 `data[4:8]` 为 headerSize，`data[12:16]` 为 JSON size；JSON 位于 `data[16:16+jsonSize]`，文件数据区始于 `8+headerSize`。递归 `header.files` 中的 `files`，叶内容为 `data[dataStart+offset:dataStart+offset+size]`。全部叶文件摘要比较比整个 ASAR 字面词检索更强，但仍不能排除没有明确身份的编码或组合内容。

`web/usercontent-proxy/apps/manifest.json`（SHA256 `8c2c08873c86f14d7d28e0c5fb9ef0a5b0f834292144bed98855cd6b414c3e79`）登记 22 个 `widget-name@version → 8 位摘要前缀`。其中 Creative、Website 指向 `2a07bc2e`，Motion 指向 `11addd0c`；它没有 `html-templates`、独立模板摘要/正文或下载地址。

## 找到的真实合同及其边界

- `web/assets/HtmlArtifactFrame-BLzUcmrV.js`（SHA256 `a9a1b46d7e7b0c7d02cf2adbf914c9ca391c6d0123aab70a8bd9f34ad823d21b`）提供 **HTML 预览代理**地址解析：本地 `/usercontent-proxy/<proxy-name>`，或已识别 host 下的 usercontent origin + 固定版本 `fa3dd6f60a/<proxy-name>`。`HtmlArtifactFrame` 实际请求 `artifact-proxy.html`，随后通过 postMessage 传入已经取得的 HTML。该合同不能解释模板 `html-templates/<id>/<sha>.html` 对象键；不能把相同 origin 与模板键拼接后称为官方下载路径。
- `web/assets/page-DVqoHdTT.js` 只识别 `ui://tapnow/<name>@v<number>`，资源通知传 `{name,version}`，启动 `mcp-app-proxy.html`。该 UI widget 加载合同不能代替模板正文获取合同。
- `web/assets/context-D6hXl-WU.js`（SHA256 `256ea01872d5939d760bb71fbf22cddc53bb626dc3a1410bf49257ff41d8c01a`）公开目录路径为 `/api/bff/app-store/catalog` 与 `/api/bff/app-store/items/<kind>/<encoded-name>`。另有真实 `getSkill` 与 `getPluginSkill` gateway 路径；没有发现模板下载器。本轮没有请求这些私有技能路径。
- `web/assets/use-chat-attachment-file-input-BcpbCD8t.js`（SHA256 `990461a9b1f38b6311465d992b7c0ce5a33af388e9eebfe1e1b4414936c9d84b`）中的技能 UI mapper 读取 `name/description/instructions/provider/status/version/skipped_file_count`，没有映射 skill package 的二进制附件或 HTML 模板资源清单。单凭 UI mapper 不能推断服务端完整响应字段。

## 公开来源刷新

沿用此前由安装包常量和真实目录 item 得到的五个公开 GET；均 HTTP 200。没有添加猜测的路径。下表为本次响应**原始字节** SHA256，旧的格式化保存 JSON 仍在 `reference/agent-app-store-public-*-20260930.json`，不是本次 raw bytes 文件。

基址：`https://app.tapnow.media/api/bff/app-store/`。

| 路径 | bytes | 本次 raw SHA256 |
| --- | ---: | --- |
| `catalog` | 54495 | `2baaa19f63d38b20323b49336400ec112e8ba9496945b91066a463fd8f5316cd` |
| `items/app/motion-library` | 4409 | `8941e57a3cbfdcbf9f84f7e1aadd06fefb3f8edeef07dd2860703787995e26f9` |
| `items/app/website-design` | 5772 | `2a36bddcb23be95c04c37d49265c8c52833cd63dd4d947b6c87b8be38458041c` |
| `items/app/creative-generative-art` | 4867 | `8c941683ee172a0a8a9d67b06c63128e5d2ceee1e3485cdbe5618428c0002173` |
| `items/app/creative-hardware-mg` | 5348 | `50a2a1c4db2ee5f112c51c2293750dc176b4d25d083a27592ebef0da662caa9d` |

五份响应均未出现 `html-templates/template_ref/object_key/SKILL.md/download_url/resource_uri`。四个应用的 `library.templates` 仍是 name/description/family/interaction 等产品描述及 featured ID，没有独立 HTML 正文或资源下载身份。

已知 [Apps 文档（media）](https://docs.tapnow.media/zh/docs/agent/apps) 和 [Apps 文档（ai）](https://docs.tapnow.ai/zh/docs/agent/apps) 本次均 200、108,537 bytes；均未出现 `SKILL.md/html-templates/template_ref`，页面实际链接未给出这些模板的下载器或技能包。沿其真实链接读取 [使用素材库与模板](https://docs.tapnow.media/zh/docs/canvas/use-library-and-templates)（200、88,444 bytes，SHA256 `001c9f142720013bea7905f7ee5c1e53d43dd4e1814e933ebbf1cf1425d0507f`）：内容明确是**节点、连线和画布结构模板**，不是 HTML picker 的 92 个正文来源；同样没有上述下载合同。

## 仍缺的具体材料

1. 与当前 Creative/Motion picker 版本相符的官方外层 skill 完整包，或具有同等权威的资源 manifest。
2. `template_ref.object_key` 的官方解析规则：来源 origin/路径、字节取得方式、鉴权/签名要求及版本语义。现有 widget preview origin 不足以建立这份合同。
3. 对应 92 个精确摘要的独立 HTML 字节（包含已退役 A05 引用；A05 不可建立新导入）。真实可编辑验收仍需当前真实选择的正文，不能由 picker 全库页面、预览函数或合成 fixture 代替。

拿到这些材料后，先离线校验精确 identity + 原始字节 SHA256，再沿已有本地原模板导入机制保存来源与可编辑 revision。研究时的公开读取不构成产品 runtime 的远程依赖；本轮未增加自动 fetch。
