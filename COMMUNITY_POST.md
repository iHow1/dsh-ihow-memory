# Cross-session memory for DeepSeek Harness, with a reproducible Host-level receipt

I built `dsh-ihow-memory`, an Apache-2.0 DSH bundle that mounts iHow Memory Core as native `mcp__ihow-memory__...` tools. The package is intentionally thin: DSH owns the agent and tool registry, while Core owns durable storage, retrieval, governance, forget/remember, and the MCP contract.

The useful claim is not that another memory package exists. It is that the persistence boundary is reproducible through DSH's real Host:

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

The demo fails on a missing namespaced tool, startup error, duplicate or missing search result, failed forget, failed remember, or failed persistence assertion. It uses a unique marker, temporary workspace, temporary memory root, lexical FTS, and no model/API key.

Install the current preview into an isolated profile:

```sh
DSH_HOME=/tmp/dsh-ihow-demo-home \
  dsh plugin --profile headless add dsh-ihow-memory@next
```

Then run the Host flow documented in `DEMO.md`. Set `DEMO_RECEIPT_PATH=/tmp/dsh-ihow-receipt.json` to retain the JSON result for CI or review.

Verified against a fresh install of `dsh-ihow-memory@0.1.0-alpha.1` on August 16, 2026. The run completed all six phases through `DeepSeek Harness` and produced `ok: true`.

Repository: https://github.com/iHowAI/dsh-ihow-memory
npm: https://www.npmjs.com/package/dsh-ihow-memory
