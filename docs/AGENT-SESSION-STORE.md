# Agent 会话快照存储

`server/agent-session-store.cjs` 提供独立文件存储，供服务端 runtime 保存与恢复会话检查点。它不请求模型、不执行工具、不自动重放会话；恢复后的状态、工具回执权限和凭据过滤由 runtime 负责。不能把模型客户端、配置对象或 API Key 传入快照。

## 接口合同

```js
const {createAgentSessionStore}=require('./agent-session-store.cjs');
const store=createAgentSessionStore({
 directory:'/absolute/private/agent-sessions',
 maxRecords:100,
 maxRecordBytes:32*1024*1024,
 maxTotalBytes:256*1024*1024
});
await store.ready;
await store.put({version:1,id:sessionUUID,updated:Date.now(),state:sessionState});
const snapshots=await store.list();
await store.close();
```

工厂同步返回 `{ready, list, put, close}`。所有容量选项必须是正安全整数，目录必须为绝对路径；配置错误同步抛出 `TypeError`。`ready` 为 `Promise<void>`，完成私有目录准备、独占写锁和全目录记录验证。`list(): Promise<record[]>`、`put(record): Promise<void>` 和 `close(): Promise<void>` 均等待初始化。

存储只校验根记录为普通 JSON 对象、`version === 1`、自有 `id` 为标准 UUID、自有 `updated` 为非负安全整数毫秒时间戳。其余会话字段与状态机约束由 runtime 校验；快照恢复不能只依赖本层基础校验。

`put` 在调用时立即取得独立 JSON 快照；稍后更改传入对象不会改写排队中的内容。接受空原型的普通对象与标准数组；拒绝循环、Proxy、访问器、Symbol、非枚举字段、稀疏/附加属性数组、`undefined`、函数、BigInt、非有限数值、Date 和自定义原型。序列化直接读取已校验的数据描述符，不执行自有或继承的 `toJSON` 钩子。`list` 返回独立深克隆，每次均重读文件；外部改写不会被缓存隐藏。

## 文件、权限与单写进程

目录为当前用户所有，权限设为 `0700`；记录、锁和临时文件均要求 `0600`。文件使用 `lstat` 验证为普通文件，符号链接和开放给其他用户的文件均拒绝。记录文件名为 `<UUID>.json`，内部 `id` 必须与文件名逐字相同。未知目录条目、损坏 JSON、未知版本、身份不匹配、丢失/替换写锁都阻止读取与写入，不自动修复或覆盖旧记录。

`.writer-lock` 使用 `wx` 独占创建，保存 PID 和随机令牌。活进程持有或 PID 权限状态不明确时拒绝初始化；损坏的锁保留，不能通过删除活锁强行运行第二个 writer。只有 `process.kill(pid, 0)` 明确报告 `ESRCH` 时才可回收崩溃进程的锁。PID 被复用时宁可拒绝。

额外的 `.writer-claim.<UUID>` 声明文件持续保留至关闭。声明文件名与内容令牌一致，而且不复用名称，避免多个进程回收同一旧锁时误删另一进程刚创建的活锁。竞争初始化可能双方都拒绝；调用方可以在完成各自 `close` 后显式重试。正常关闭只删除自己的令牌匹配锁与声明，不触碰其他 writer 的锁。

## 提交、容量与失败行为

`list` 和 `put` 共用串行队列。每次提交前验证全目录和容量；同 ID 更新替换原快照，不增加历史条数。默认最多 100 条会话、每文件 32 MiB、总预算 256 MiB。总预算包括保留的崩溃 `.tmp`/`.bak` 文件，避免忽略临时残留后突破预算。这些限制是保存的 UTF-8 文件字节限制，不能代替 runtime 的请求长度和内存限制。

不会按时间、状态或容量自动删除历史会话。满 100 条后新增会话明确失败，仍可在总字节预算内更新已有会话。临时目录中已知 UUID 格式的崩溃临时/备份文件保留且计入预算；无足够容量时拒绝，不擅自清理用户数据。

提交先 `wx` 创建同目录临时文件，写入并 `sync`，然后原子 `rename` 替换记录，再 `sync` 目录。Promise 仅在该提交完成后 resolve。已有快照通过同目录私有 `.bak` 硬链接保留旧 inode；临时写、文件同步或 rename 失败不影响原记录，rename 后目录同步失败会先原子恢复旧 inode 再报告失败。成功提交清理该次备份；自己的失败临时文件也会清理。

如果硬件/文件系统持续故障连回滚都无法完成，该实例进入不可用状态并保留旧备份，后续调用拒绝。此时应保留整个目录排查，不假设失败的新快照已提交或手动重放工具。真实掉电与底层文件系统故障不在临时目录 fixture 的验证范围内。

初始化、读写和关闭错误均为固定消息、`code: 'storage_error'`、`status: 503`，不附带输入记录、凭据、原始错误原因，也不打印日志。`close` 立即拒绝新操作，等待已接受的队列提交，然后释放自己的锁；可重复调用。

## 聚焦验证

```bash
node --test tests/agent-session-store.test.cjs
node --check server/agent-session-store.cjs
```

16 项测试只使用系统临时目录，包括：重新打开恢复、深克隆、立即截取输入、串行提交与 close 排空、活进程锁拒绝、实际子进程崩溃与并发旧锁回收、损坏锁保留、严格 JSON 边界、容量超限保留旧值、外部损坏和锁丢失、权限与符号链接拒绝、文件同步/rename 注入失败、目录同步失败回滚和崩溃临时文件预算。未访问生产目录、未运行全量测试或 E2E；这些检查验证存储合同，不代表 runtime 恢复工具执行已通过。
