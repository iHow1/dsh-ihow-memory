# Cross-session DSH demo

This demo proves the plugin's durable behavior through DSH's real Host and tool registry. It creates a temporary workspace and memory root, so it does not touch an existing DSH profile or iHow Memory store.

## Reproducible core MCP flow

Run the six-process persistence flow directly against the bundled Core MCP server:

```sh
npm run demo:cross-session
```

The command asserts:

1. write a uniquely generated marker;
2. search it in a new MCP process;
3. forget it in another process;
4. confirm it is absent after another process restart;
5. restore it in a new process;
6. confirm it is searchable again after another restart.

## Reproducible DSH Host flow

The Host flow uses the official DSH `boot()` API and calls the namespaced DSH tools, not the MCP wire protocol directly. It requires an installed DSH profile and the DSH app-boot package:

```sh
DSH_PROFILE_DIR=/path/to/dsh-home/profiles/headless \
DSH_APP_BOOT=/path/to/@deepseek-ai/dsh-app-boot/lib/index.js \
node scripts/dsh-cross-session-demo.mjs
```

Run the command with the same Node executable that launches DSH. The demo itself does not modify plugin configuration or introduce a second Node runtime.

The Host command asserts that every phase goes through DSH's `mcp__ihow-memory__...` tool namespace:

```text
write through DSH tools in host A
  -> dispose and rebuild the Host
recall through DSH tools
  -> dispose and rebuild the Host
forget through DSH tools
  -> dispose and rebuild the Host
confirm hidden
  -> remember through DSH tools
  -> dispose and rebuild the Host
confirm restored
```

The command exits nonzero on a missing tool, failed startup, unexpected status, duplicate/missing result, or failed persistence assertion. It prints a JSON receipt containing only the random marker and temporary memory path.

Set `DEMO_RECEIPT_PATH` to save the same JSON receipt to a file for CI or a release artifact. The temporary memory store is still removed after the assertions finish.

## Public demo installation

Install the published bundle into an isolated DSH profile before running the Host flow:

```sh
mkdir -p /tmp/dsh-ihow-demo
cd /tmp/dsh-ihow-demo
DSH_HOME=/tmp/dsh-ihow-demo-home dsh plugin --profile headless add dsh-ihow-memory@next
```

Then point `DSH_PROFILE_DIR` at `/tmp/dsh-ihow-demo-home/profiles/headless` and run the Host command above. Restart the selected DSH profile after installation in normal use.

## Migrate an existing MCP row

Install the bundle, then replace the old generic MCP row with one plugin override. Preserve the exact storage paths:

```yaml
- id: ihow-memory
  config:
    memoryRoot: /path/from/old/MEMORY_ROOT
    stateRoot: /path/from/old/IHOW_MEMORY_STATE_ROOT
    workspace: /same/workspace/identity
    failOnStartupError: true
```

Stop the old Host before starting the new composition. Do not run the generic MCP row and the bundle against the same writable state directory at once. Verify `memory.status`, search a known pre-migration marker, write a new low-risk marker, and recall both from a fresh Host before removing any backup.

The flow uses lexical FTS by default. No API key, network service, embedding model, or existing memory is required.
