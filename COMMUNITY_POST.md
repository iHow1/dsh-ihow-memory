# DeepSeek Harness 也能接上 iHow Memory 长期记忆了

DeepSeek Harness 现在可以通过 Cordis 插件直接接入 iHow Memory，全程不修改 DSH 源码。

当前已验证的能力：

- 任务开始时可通过 `memory.continue` 或 `memory.search` 主动召回相关历史；
- 回合结束后可通过 `memory.write_candidate` 治理式写回新的决策、经验与交接；
- 记忆保存在本机，支持多个已接入 iHow Memory 的 Runtime 显式共享同一记忆根；
- 支持搜索、状态检查、候选写入、forget、remember 与可审计治理；
- 可从已有 MCP 配置无损迁移到正式 DSH Bundle；
- 完整流程通过真实 DeepSeek Harness Host 验收，不只是直连 MCP 的单元测试。

```text
Host A 写入
  -> 销毁并重建 Host
Host B 召回
  -> forget
Host C 确认隐藏
  -> remember
Host D 确认恢复
```

安装预览版：

```sh
dsh plugin --profile web add dsh-ihow-memory@next
dsh web
```

如果已经有 iHow Memory MCP 配置，可在插件条目中显式填写原来的 `memoryRoot` 和 `stateRoot`，继续使用同一份记忆，不需要复制或重建数据。迁移步骤与可重复验收脚本见仓库 `DEMO.md`。

需要说明：当前 DSH 版本由模型调用原生记忆工具完成召回和治理式写回；自动 `pre-step` 注入和自动 turn-end capture 尚未作为已完成能力宣传。我们选择先把持久化边界、迁移安全和可验证性做实，再扩展自动生命周期。

GitHub：https://github.com/iHow1/dsh-ihow-memory

npm：https://www.npmjs.com/package/dsh-ihow-memory
