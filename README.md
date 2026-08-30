# dsh-ihow-memory

Install [iHow Memory](https://github.com/iHow1/ihow-memory-core) as a local-first shared memory plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The package is a thin DSH bundle. It mounts DSH's MCP client and starts an exact `ihow-memory` Core dependency from the plugin installation. It does not require a global iHow Memory binary and does not duplicate Core storage or governance logic.

## Status

Alpha. The current release candidate targets the official DSH `0.1.1-rc.2` lifecycle and iHow Memory Core `0.1.0-alpha.33`.

## Core and plugin lifecycle

`ihow-memory` is the Core package: it owns storage, retrieval, governance, and the MCP contract. `dsh-ihow-memory` is only the DSH adapter and distribution bundle. Installing this plugin does not replace a global `ihow-memory` command or modify another runtime's adapter.

The plugin pins an exact Core version so an existing DSH installation cannot change behavior when Core publishes a new release. The two packages therefore use independent versions:

- A Core release does not automatically require a plugin release.
- Release a new plugin when the pinned Core must move for a compatible feature or security fix, when the MCP contract changes, or when DSH integration changes.
- Test the pinned Core through DSH before each plugin release; do not widen the Core dependency range.

Runtimes share durable memory only when they intentionally use the same `MEMORY_ROOT` or `IHOW_MEMORY_ROOT`. DSH keeps its index and runtime state under its own `IHOW_MEMORY_STATE_ROOT`, so shared memory does not imply shared mutable runtime state.

The host plugin also owns the native lifecycle adapter:

- `agent/session-start` injects the bounded verify-first handoff packet.
- The first `agent/pre-step` in each turn performs relevant prompt recall and appends one identified `recall` context message.
- Durable `compaction/summary` events create metadata-only pre-compact checkpoints; raw summaries and transcript bytes are never copied into the activation ledger.
- `agent/disposed` schedules a partial session-end checkpoint and lifecycle completion; Host-plugin shutdown drains the adapter's queued writes.

These hooks fail open for model execution. Activation evidence is local and replayable by the same OS user, so Core reports `READY — WAITING FOR FIRST ACTIVITY` / `ACTIVATION_COMPLETION_UNATTESTED`, not authenticated `ACTIVE`.

## Install

```sh
dsh plugin --profile web add dsh-ihow-memory@next
dsh web
```

For Headless:

```sh
dsh plugin --profile headless add dsh-ihow-memory@next
dsh --profile headless "Check memory status"
```

Restart the selected DSH profile after installation. The agent receives iHow Memory tools under DSH's stable `mcp__ihow-memory__...` namespace.

## Storage

By default the plugin uses iHow Memory's managed local storage:

```text
~/.ihow-memory/<workspace>-<hash>/
```

It keeps DSH index state under:

```text
~/.ihow-memory/.state/dsh/
```

The active DSH workspace determines the managed memory space. For persistent profile configuration, override paths on the plugin row:

```yaml
- id: ihow-memory
  config:
    memoryRoot: /path/to/existing/memory
    stateRoot: /path/to/writable/dsh-state
    workspace: /path/to/workspace-identity
    space: main
```

`home`, `memoryRoot`, `stateRoot`, `workspace`, and `space` accept absolute paths, relative paths, and `~/...` where applicable. `space` keeps DSH on the same logical iHow Memory lane across per-session working directories. Plugin fields take precedence over environment variables. Existing environment-based installs remain compatible:

| Variable | Purpose |
|---|---|
| `IHOW_MEMORY_HOME` | Managed iHow Memory home directory |
| `MEMORY_ROOT` or `IHOW_MEMORY_ROOT` | Existing shared memory directory |
| `IHOW_MEMORY_STATE_ROOT` | Runtime index/state directory |
| `IHOW_MEMORY_CWD` | Workspace identity override |
| `IHOW_CAPTURE_FLOOR=0` | Disable the bounded startup capture sweep |

When migrating an existing MCP row, copy its `MEMORY_ROOT` to `memoryRoot` and `IHOW_MEMORY_STATE_ROOT` to `stateRoot` before removing the old row. Never run both rows against the same store. The plugin never deletes memory when it is updated or uninstalled.

## Verify

For a deterministic persistence receipt, run the bundled Core flow:

```sh
npm run demo:cross-session
```

It writes a random marker, searches it from a new process, forgets it, verifies it is hidden after another restart, restores it, and verifies it is searchable again. The full DSH Host flow uses the official DSH tool registry and is documented in [DEMO.md](DEMO.md).

For the manual flow, ask DSH to call memory status, search a known fact, write a low-risk candidate, start a new session, and search for the same fact. For the full verify-first handoff path, call `memory.continue` and validate the returned live anchors before acting on its narrative.

Set `DEMO_RECEIPT_PATH` to retain the Host result as JSON; the temporary memory space is still removed after the assertions complete.

## Update and remove

```sh
dsh plugin --profile web update dsh-ihow-memory
dsh plugin --profile web remove dsh-ihow-memory
```

Removing the plugin removes the DSH bundle only. It does not remove `~/.ihow-memory` or a configured shared memory root.

## Security

The plugin spawns the bundled Core over stdio. It stores no model credentials and uses DSH's scrubbed child-process environment. Memory can contain sensitive project context; review candidates before promotion and never store secrets, tokens, private keys, passwords, or cookies.

## Development

```sh
npm install
npm run verify
dsh plugin --profile web add "link:/absolute/path/to/dsh-ihow-memory"
```

## License

Apache-2.0
