# dsh-ihow-memory

把 [iHow Memory](https://github.com/iHow1/ihow-memory-core) 作为本地优先、跨 Agent 共享的记忆插件接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

本包是一个薄型 DSH Bundle：挂载 DSH 官方 MCP Client，并从插件自身的精确依赖中启动 `ihow-memory` Core。它不要求全局安装 iHow Memory，也不复制 Core 的存储和治理逻辑。

## 状态

Alpha。当前候选面向 DSH 官方 `0.1.1-rc.2` 生命周期与 iHow Memory Core `0.1.0-alpha.34`。

## Core 与插件的版本关系

`ihow-memory` 是 Core 包，负责存储、检索、治理和 MCP 契约；`dsh-ihow-memory` 只负责 DSH 适配与分发。安装本插件不会替换全局 `ihow-memory` 命令，也不会修改其他 Runtime 的适配器。

插件精确锁定 Core 版本，避免 Core 发布新版本后，已有 DSH 安装在未验证的情况下自动改变行为。因此两个包独立发版：

- Core 发版不等于插件必须同步发版。
- 只有需要升级固定 Core 以获得兼容功能或安全修复、MCP 契约变化、或 DSH 集成变化时，才发布新的插件版本。
- 每次插件发版前都必须通过 DSH 验证固定 Core；不要放宽 Core 依赖范围。

只有主动配置相同的 `MEMORY_ROOT` 或 `IHOW_MEMORY_ROOT` 时，各 Runtime 才共享持久记忆。DSH 的索引和运行状态使用独立的 `IHOW_MEMORY_STATE_ROOT`，共享记忆不等于共享可变运行状态。

Host 插件同时负责原生生命周期适配：

- `agent/session-start` 注入有界的 verify-first 交接包。
- 每轮第一次 `agent/pre-step` 执行相关性召回，只追加一条带身份的 `recall` 上下文消息。
- 持久 `compaction/summary` 事件生成仅含元数据的压缩 checkpoint；不会把原始摘要或 transcript 内容复制到激活账本。
- `agent/disposed` 会调度一次不完整覆盖的 session-end checkpoint 与生命周期完成证据；Host 插件关闭时会排空适配器已排队的写入。

这些 Hook 对模型执行 fail open。激活证据是同一 OS 用户可重放的本地证据，因此 Core 只报告 `READY — WAITING FOR FIRST ACTIVITY` / `ACTIVATION_COMPLETION_UNATTESTED`，不声称经过宿主认证的 `ACTIVE`。

## 安装

```sh
dsh plugin --profile web add dsh-ihow-memory@next
dsh web
```

Headless：

```sh
dsh plugin --profile headless add dsh-ihow-memory@next
dsh --profile headless "检查记忆状态"
```

安装后重启对应 DSH Profile。Agent 会通过稳定的 `mcp__ihow-memory__...` 命名空间获得 iHow Memory 工具。

## 存储

默认使用 iHow Memory 的本机托管空间：

```text
~/.ihow-memory/<workspace>-<hash>/
```

DSH 的索引状态位于：

```text
~/.ihow-memory/.state/dsh/
```

当前 DSH 工作区决定托管空间。需要在 Profile 中持久配置路径时，覆盖插件条目：

```yaml
- id: ihow-memory
  config:
    memoryRoot: /path/to/existing/memory
    stateRoot: /path/to/writable/dsh-state
    workspace: /path/to/workspace-identity
    space: main
```

`home`、`memoryRoot`、`stateRoot`、`workspace` 与 `space` 均按适用情况支持绝对路径、相对路径和 `~/...`。`space` 让不同会话工作目录仍落在同一个 iHow Memory 逻辑 lane。插件字段优先于环境变量；原有环境变量配置继续兼容：

| 环境变量 | 用途 |
|---|---|
| `IHOW_MEMORY_HOME` | iHow Memory 托管根目录 |
| `MEMORY_ROOT` 或 `IHOW_MEMORY_ROOT` | 已有共享记忆目录 |
| `IHOW_MEMORY_STATE_ROOT` | 运行时索引与状态目录 |
| `IHOW_MEMORY_CWD` | 覆盖工作区身份 |
| `IHOW_CAPTURE_FLOOR=0` | 关闭有界启动捕获扫描 |

从已有 MCP 条目迁移时，先把原 `MEMORY_ROOT` 写入 `memoryRoot`，把 `IHOW_MEMORY_STATE_ROOT` 写入 `stateRoot`，再删除旧条目。禁止让新旧两个条目同时访问同一存储。更新或卸载插件不会删除记忆。

## 验证

要获得确定性的持久化验收结果，可运行随包提供的 Core 流程：

```sh
npm run demo:cross-session
```

脚本会写入随机 marker，在新进程中搜索，执行 forget，在再次重启后确认 marker 隐藏，再执行 remember，并确认它恢复可搜索。完整 DSH Host 流程通过官方 DSH 工具注册表执行，详见 [DEMO.md](DEMO.md)。

手动验证时，让 DSH 调用记忆状态，搜索一条已知事实，写入一个低风险候选，再开启新会话搜索同一事实。完整 verify-first 接班路径应调用 `memory.continue`，并在行动前核对返回的实时锚点。

需要保留 Host 验收回执时，设置 `DEMO_RECEIPT_PATH`，脚本会写出 JSON 结果；临时记忆空间仍会在断言结束后删除。

## 更新与卸载

```sh
dsh plugin --profile web update dsh-ihow-memory
dsh plugin --profile web remove dsh-ihow-memory
```

卸载只移除 DSH Bundle，不删除 `~/.ihow-memory` 或用户配置的共享记忆目录。

## 安全边界

插件通过 stdio 启动随包安装的 Core，不保存模型凭据，并使用 DSH 的净化子进程环境。记忆可能含敏感项目上下文：晋升前应审阅候选，禁止保存密钥、Token、私钥、密码或 Cookie。

## 开发

```sh
npm install
npm run verify
dsh plugin --profile web add "link:/absolute/path/to/dsh-ihow-memory"
```

## 许可证

Apache-2.0
